from __future__ import annotations

import hashlib
import tempfile
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Callable, Protocol

from .llm_config import LLMConfig, load_llm_config
from .models import QualityStatus, SelectedPage, TreeNode
from .pageindex_runtime import run_pageindex
from .shadow_pdf import create_shadow_pdf


class PageIndexAdapter(ABC):
    """Stable integration seam between Huojiaocan page records and PageIndex."""

    name = "abstract"

    @abstractmethod
    def build_tree(self, document_id: str, document_title: str, pages: list[SelectedPage]) -> TreeNode:
        raise NotImplementedError


class PageTextProvider(Protocol):
    """Produces the page-text contract consumed by the PageIndex vendor adapter."""

    def build_payload(self, document_id: str, pages: list[SelectedPage]) -> dict[str, Any]: ...


class HuojiaocanPageTextProvider:
    """Convert selected page records into PageIndex's physical-page input contract.

    This boundary deliberately performs no page renumbering. A physical page number is
    either preserved in the payload or the page is omitted because it is not eligible
    for indexing.
    """

    def build_payload(self, document_id: str, pages: list[SelectedPage]) -> dict[str, Any]:
        page_numbers = [page.pdf_page_number for page in pages]
        if len(page_numbers) != len(set(page_numbers)):
            raise ValueError("duplicate pdfPageNumber in PageIndex page-text input")

        eligible_pages = sorted(
            (
                page
                for page in pages
                if page.include_in_index
                and page.quality_status != QualityStatus.failed
                and page.retrieval_text.strip()
            ),
            key=lambda page: page.pdf_page_number,
        )
        return {
            "documentId": document_id,
            "pages": [
                {
                    "pdfPageNumber": page.pdf_page_number,
                    "text": page.retrieval_text,
                    "textSource": page.text_source.value,
                    "qualityScore": page.quality_score,
                }
                for page in eligible_pages
            ],
        }


class FixturePageIndexAdapter(PageIndexAdapter):
    """Deterministic tree builder used by the runnable thin slice and tests."""

    name = "fixture"

    def _node_id(self, document_id: str, path: list[str]) -> str:
        digest = hashlib.sha1((document_id + "\0" + "\0".join(path)).encode("utf-8")).hexdigest()[:12]
        return f"node_{digest}"

    def build_tree(self, document_id: str, document_title: str, pages: list[SelectedPage]) -> TreeNode:
        searchable = [page for page in pages if page.include_in_index and page.retrieval_text]
        all_pages = pages or []
        start = min((page.pdf_page_number for page in all_pages), default=1)
        end = max((page.pdf_page_number for page in all_pages), default=start)
        root = TreeNode(
            id=self._node_id(document_id, []),
            title=document_title,
            level=0,
            startPdfPage=start,
            endPdfPage=end,
            sectionPath=[],
            children=[],
        )
        node_by_path: dict[tuple[str, ...], TreeNode] = {(): root}
        for page in sorted(searchable, key=lambda item: item.pdf_page_number):
            parent = root
            for level, title in enumerate(page.section_path, start=1):
                path = tuple(page.section_path[:level])
                node = node_by_path.get(path)
                if node is None:
                    node = TreeNode(
                        id=self._node_id(document_id, list(path)),
                        title=title,
                        level=level,
                        startPdfPage=page.pdf_page_number,
                        endPdfPage=page.pdf_page_number,
                        sectionPath=list(path),
                        children=[],
                    )
                    parent.children.append(node)
                    node_by_path[path] = node
                else:
                    node.start_pdf_page = min(node.start_pdf_page, page.pdf_page_number)
                    node.end_pdf_page = max(node.end_pdf_page, page.pdf_page_number)
                parent = node
        return root


class VendorPageIndexAdapter(PageIndexAdapter):
    """Adapter for the pinned PageIndex vendor using an ephemeral page-text PDF.

    The upstream package only accepts PDF files. We therefore create a temporary
    one-page-per-business-page PDF, run PageIndex, then translate every vendor page
    range back to immutable physical PDF page numbers before returning it.
    """

    name = "vendor"

    def __init__(
        self,
        vendor_root: str | Path,
        page_text_provider: PageTextProvider | None = None,
        *,
        config_loader: Callable[..., LLMConfig] = load_llm_config,
        runtime: Callable[..., dict[str, Any]] = run_pageindex,
    ):
        self.vendor_root = Path(vendor_root)
        if not (self.vendor_root / "pageindex").exists():
            raise RuntimeError(f"PageIndex vendor not found at {self.vendor_root}")
        if page_text_provider is None or not callable(getattr(page_text_provider, "build_payload", None)):
            raise RuntimeError("Vendor PageIndex adapter requires a page-text provider")
        self.page_text_provider = page_text_provider
        self.config_loader = config_loader
        self.runtime = runtime

    @staticmethod
    def _stable_node_id(document_id: str, path: list[str], start: int, end: int) -> str:
        value = "\0".join([document_id, *path, str(start), str(end)])
        return f"node_{hashlib.sha1(value.encode('utf-8')).hexdigest()[:12]}"

    @staticmethod
    def _map_range(node: dict[str, Any], mapping: dict[int, int]) -> tuple[int, int]:
        start = node.get("start_index")
        end = node.get("end_index", start)
        if not isinstance(start, int) or not isinstance(end, int):
            raise RuntimeError("PageIndex node is missing an integer page range")
        if start > end:
            raise RuntimeError("PageIndex node has a reversed page range")
        if start not in mapping or end not in mapping:
            raise RuntimeError("PageIndex node page range is outside the shadow PDF")
        return mapping[start], mapping[end]

    def _convert_nodes(
        self,
        document_id: str,
        nodes: list[dict[str, Any]],
        mapping: dict[int, int],
        *,
        parent_path: list[str],
        level: int,
    ) -> list[TreeNode]:
        converted: list[TreeNode] = []
        for raw in nodes:
            if not isinstance(raw, dict):
                raise RuntimeError("PageIndex structure contains a non-object node")
            title = raw.get("title")
            if not isinstance(title, str) or not title.strip():
                raise RuntimeError("PageIndex node is missing a title")
            start, end = self._map_range(raw, mapping)
            path = [*parent_path, title.strip()]
            raw_children = raw.get("nodes", [])
            if raw_children is None:
                raw_children = []
            if not isinstance(raw_children, list):
                raise RuntimeError("PageIndex node children must be a list")
            children = self._convert_nodes(
                document_id,
                raw_children,
                mapping,
                parent_path=path,
                level=level + 1,
            )
            if any(child.start_pdf_page < start or child.end_pdf_page > end for child in children):
                raise RuntimeError("PageIndex child page range falls outside its parent")
            converted.append(
                TreeNode(
                    id=self._stable_node_id(document_id, path, start, end),
                    title=title.strip(),
                    level=level,
                    startPdfPage=start,
                    endPdfPage=end,
                    sectionPath=path,
                    children=children,
                )
            )
        return converted

    def build_tree(self, document_id: str, document_title: str, pages: list[SelectedPage]) -> TreeNode:
        payload = self.page_text_provider.build_payload(document_id, pages)
        eligible = payload.get("pages")
        if not isinstance(eligible, list) or not eligible:
            raise RuntimeError("PageIndex cannot build an index without eligible page text")
        config = self.config_loader(require_api_key=True)

        with tempfile.TemporaryDirectory(prefix="huojiaocan-pageindex-") as temporary_dir:
            shadow = create_shadow_pdf(payload, Path(temporary_dir) / "shadow.pdf")
            result = self.runtime(shadow.path, config, self.vendor_root, add_summaries=False)
            structure = result.get("structure") if isinstance(result, dict) else None
            if not isinstance(structure, list) or not structure:
                raise RuntimeError("PageIndex returned an empty or invalid structure")
            children = self._convert_nodes(
                document_id,
                structure,
                shadow.shadow_to_physical,
                parent_path=[],
                level=1,
            )

        physical_pages = sorted(shadow.shadow_to_physical.values())
        return TreeNode(
            id=self._stable_node_id(document_id, [], physical_pages[0], physical_pages[-1]),
            title=document_title,
            level=0,
            startPdfPage=physical_pages[0],
            endPdfPage=physical_pages[-1],
            sectionPath=[],
            children=children,
        )
