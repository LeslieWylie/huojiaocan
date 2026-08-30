from __future__ import annotations

from pathlib import Path

import pytest
from PyPDF2 import PdfReader

from app.llm_config import LLMConfig
from app.main import create_app
from app.models import QualityStatus, SelectedPage, TextSource
from app.pageindex_adapter import HuojiaocanPageTextProvider, VendorPageIndexAdapter


def selected_page(pdf_page_number: int, *, retrieval_text: str = "可检索文本", include_in_index: bool = True, quality_status: QualityStatus = QualityStatus.normal, text_source: TextSource = TextSource.native, quality_score: float = 0.9) -> SelectedPage:
    return SelectedPage(pdfPageNumber=pdf_page_number, includeInIndex=include_in_index, retrievalText=retrieval_text, textSource=text_source, qualityScore=quality_score, qualityStatus=quality_status)


def vendor_root(tmp_path: Path) -> Path:
    root = tmp_path / "PageIndex"
    (root / "pageindex").mkdir(parents=True, exist_ok=True)
    return root


def config() -> LLMConfig:
    return LLMConfig("https://gateway.example/v1", "test-only-key", "mlamp/deepseek-v4-flash")


def structure() -> dict:
    return {"structure": [{"title": "第一单元", "start_index": 1, "end_index": 3, "nodes": [{"title": "我爱这土地", "start_index": 2, "end_index": 2}]}]}


def test_page_text_provider_filters_sorts_and_preserves_physical_pages():
    provider = HuojiaocanPageTextProvider()
    pages = [selected_page(57, retrieval_text="第五十七页", text_source=TextSource.ocr, quality_score=0.94), selected_page(4, retrieval_text="不应索引", include_in_index=False), selected_page(31, retrieval_text="失败页", quality_status=QualityStatus.failed), selected_page(18, retrieval_text="   "), selected_page(9, retrieval_text="第九页", quality_score=0.81)]
    assert [p["pdfPageNumber"] for p in provider.build_payload("doc_123", pages)["pages"]] == [9, 57]


def test_page_text_provider_rejects_duplicate_physical_pages_even_when_excluded():
    with pytest.raises(ValueError, match="duplicate pdfPageNumber"):
        HuojiaocanPageTextProvider().build_payload("doc", [selected_page(12), selected_page(12, include_in_index=False)])


def test_vendor_adapter_requires_page_text_provider(tmp_path: Path):
    with pytest.raises(RuntimeError, match="requires a page-text provider"):
        VendorPageIndexAdapter(vendor_root(tmp_path))


def test_vendor_adapter_maps_shadow_ranges_to_real_pages_and_cleans_temp(tmp_path: Path):
    observed: dict = {}
    def runtime(path, supplied_config, root, **kwargs):
        observed["path"] = Path(path)
        observed["mapping_text"] = "\n".join((p.extract_text() or "") for p in PdfReader(str(path)).pages)
        observed["config"] = supplied_config
        return structure()
    adapter = VendorPageIndexAdapter(vendor_root(tmp_path), HuojiaocanPageTextProvider(), config_loader=lambda **_: config(), runtime=runtime)
    tree = adapter.build_tree("doc", "九上语文", [selected_page(60, retrieval_text="第六十页"), selected_page(55, retrieval_text="第五十五页"), selected_page(57, retrieval_text="第五十七页")])
    assert (tree.start_pdf_page, tree.end_pdf_page) == (55, 60)
    assert (tree.children[0].start_pdf_page, tree.children[0].end_pdf_page) == (55, 60)
    assert (tree.children[0].children[0].start_pdf_page, tree.children[0].children[0].end_pdf_page) == (57, 57)
    serialized = tree.model_dump_json(by_alias=True)
    assert '"startPdfPage":1' not in serialized and '"endPdfPage":3' not in serialized
    assert "real_pdf_page_55" in observed["mapping_text"]
    assert not observed["path"].exists()


@pytest.mark.parametrize("bad,match", [
    ({"structure": []}, "empty or invalid"),
    ({"structure": [{"title": "x", "start_index": 0, "end_index": 1}]}, "outside"),
    ({"structure": [{"title": "x", "start_index": 3, "end_index": 1}]}, "reversed"),
    ({"structure": [{"title": "x", "start_index": 1, "end_index": 2, "nodes": [{"title": "child", "start_index": 3, "end_index": 3}]}]}, "outside its parent"),
])
def test_vendor_adapter_rejects_invalid_vendor_tree(tmp_path: Path, bad: dict, match: str):
    adapter = VendorPageIndexAdapter(vendor_root(tmp_path), HuojiaocanPageTextProvider(), config_loader=lambda **_: config(), runtime=lambda *_a, **_k: bad)
    with pytest.raises(RuntimeError, match=match):
        adapter.build_tree("doc", "title", [selected_page(55), selected_page(57), selected_page(60)])


def test_missing_key_or_no_eligible_pages_never_calls_runtime(tmp_path: Path):
    calls = []
    def runtime(*args, **kwargs):
        calls.append(1)
        return structure()
    missing = VendorPageIndexAdapter(vendor_root(tmp_path), HuojiaocanPageTextProvider(), config_loader=lambda **_: (_ for _ in ()).throw(RuntimeError("API key is not configured")), runtime=runtime)
    with pytest.raises(RuntimeError, match="API key"):
        missing.build_tree("doc", "title", [selected_page(55)])
    empty = VendorPageIndexAdapter(vendor_root(tmp_path), HuojiaocanPageTextProvider(), config_loader=lambda **_: config(), runtime=runtime)
    with pytest.raises(RuntimeError, match="without eligible"):
        empty.build_tree("doc", "title", [selected_page(55, include_in_index=False), selected_page(57, quality_status=QualityStatus.failed)])
    assert calls == []


def test_runtime_failure_is_not_replaced_with_fixture_and_temp_is_deleted(tmp_path: Path):
    observed = {}
    def runtime(path, *_a, **_k):
        observed["path"] = Path(path)
        raise RuntimeError("vendor failed")
    adapter = VendorPageIndexAdapter(vendor_root(tmp_path), HuojiaocanPageTextProvider(), config_loader=lambda **_: config(), runtime=runtime)
    with pytest.raises(RuntimeError, match="vendor failed"):
        adapter.build_tree("doc", "title", [selected_page(55)])
    assert not observed["path"].exists()


def test_create_app_rejects_unknown_pageindex_adapter(monkeypatch, tmp_path):
    monkeypatch.setenv("PAGEINDEX_ADAPTER", "typo-adapter")
    with pytest.raises(RuntimeError, match="expected 'fixture' or 'vendor'"):
        create_app(data_root=tmp_path)
