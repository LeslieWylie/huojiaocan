from __future__ import annotations

import math
import re
import uuid
import hashlib
import base64
import os
import json
from collections import Counter
from pathlib import Path
from typing import Iterable

import fitz

from .models import (
    CreateIndexRequest,
    DocumentRecord,
    DocumentResponse,
    IndexCommand,
    IndexDocument,
    JobRecord,
    JobRef,
    JobStatus,
    PageInput,
    PagePatch,
    PageResponse,
    QualityStatus,
    RefreshIndexRequest,
    RetrieveRequest,
    RetrieveResponse,
    RetrievedPage,
    SelectedPage,
    ValidationReport,
    ValidationRequest,
    utc_now,
)
from .ocr_provider import OCRProvider, OCRProviderError, decode_image_base64
from .pageindex_adapter import PageIndexAdapter
from .repository import FileRepository
from .selection import select_page_text


class IndexService:
    def __init__(self, repository: FileRepository, adapter: PageIndexAdapter, ocr_provider: OCRProvider | None = None):
        self.repository = repository
        self.adapter = adapter
        self.ocr_provider = ocr_provider

    def _new_job(self, document_id: str, operation: str, total_pages: int) -> JobRecord:
        now = utc_now()
        return JobRecord(
            jobId=f"job_{uuid.uuid4().hex}",
            documentId=document_id,
            status=JobStatus.pending,
            operation=operation,
            totalPages=total_pages,
            processedPages=0,
            warningPages=0,
            failedPages=0,
            createdAt=now,
            updatedAt=now,
        )

    @staticmethod
    def _index_version(pages: list[PageInput | SelectedPage]) -> str:
        source = "\n".join(
            f"{page.pdf_page_number}:{getattr(page, 'retrieval_text', '') or getattr(page, 'text', '') or ''}:{getattr(page, 'text_source', '')}"
            for page in sorted(pages, key=lambda item: item.pdf_page_number)
        )
        return hashlib.sha256(source.encode("utf-8")).hexdigest()[:16]

    def _document_for_command(self, command: IndexCommand, *, index_status: JobStatus | None = None) -> DocumentRecord:
        existing = self.repository.get_document(command.document_id)
        now = utc_now()
        title = command.document_title or (existing.title if existing else None) or command.original_filename or command.document_id
        document_type = (
            command.document_type
            if not existing or "document_type" in command.model_fields_set
            else existing.document_type
        )
        extraction_policy = (
            command.extraction_policy
            if not existing or "extraction_policy" in command.model_fields_set
            else existing.extraction_policy
        )
        return DocumentRecord(
            id=command.document_id,
            title=title,
            documentType=document_type,
            extractionPolicy=extraction_policy,
            originalFilename=command.original_filename if command.original_filename is not None else (existing.original_filename if existing else None),
            originalObjectKey=command.original_object_key if command.original_object_key is not None else (existing.original_object_key if existing else None),
            mimeType=command.mime_type if command.mime_type is not None else (existing.mime_type if existing else None),
            byteSize=command.byte_size if command.byte_size is not None else (existing.byte_size if existing else None),
            sha256=command.sha256 if command.sha256 is not None else (existing.sha256 if existing else None),
            pageCount=max(command.page_count, len(command.pages), existing.page_count if existing else 0),
            pdfUrl=command.pdf_url if command.pdf_url is not None else (existing.pdf_url if existing else None),
            pdfStatus=existing.pdf_status if existing else "registered",
            indexStatus=index_status or (existing.index_status if existing else JobStatus.pending),
            metadata={**(existing.metadata if existing else {}), **command.metadata},
            createdAt=existing.created_at if existing else now,
            updatedAt=now,
        )

    def register_document(self, command: IndexCommand) -> DocumentResponse:
        document = self._document_for_command(command)
        self.repository.save_document(document)
        return DocumentResponse(status=document.index_status, document=document)

    def start_index(self, command: IndexCommand) -> JobRef:
        existing_index = self.repository.get_index(command.document_id)
        pages: list[PageInput] = list(command.pages)
        # An explicit OCR choice must never silently reuse a native-text
        # snapshot. OCR needs the original PDF rendered into page images; the
        # ingest endpoint is the only path that can provide those images.
        if not pages and existing_index and command.extraction_policy.value != "ocr":
            document = self.repository.get_document(command.document_id)
            version = str(existing_index.metadata.get("indexVersion") or self._index_version(existing_index.pages))
            status = document.index_status if document and document.index_status in {JobStatus.ready, JobStatus.partial} else JobStatus.ready
            job = self._new_job(command.document_id, "build-reused", len(existing_index.pages))
            job.status = status
            job.processed_pages = len(existing_index.pages)
            job.warning_pages = sum(page.quality_status == QualityStatus.review for page in existing_index.pages)
            job.failed_pages = sum(page.quality_status == QualityStatus.failed for page in existing_index.pages)
            job.reused = True
            job.index_version = version
            job.updated_at = utc_now()
            self.repository.save_job(job)
            return JobRef(jobId=job.job_id, documentId=job.document_id, status=job.status, reused=True, indexVersion=version)

        document = self._document_for_command(command, index_status=JobStatus.running if pages else JobStatus.partial)
        self.repository.save_document(document)

        if not pages:
            job = self._new_job(command.document_id, "build", document.page_count)
            job.status = JobStatus.partial
            job.error = "ocr_requires_pdf_ingest" if command.extraction_policy.value == "ocr" else "waiting_for_pages"
            job.updated_at = utc_now()
            self.repository.save_job(job)
            return JobRef(jobId=job.job_id, documentId=job.document_id, status=job.status)

        request = CreateIndexRequest(
            documentId=command.document_id,
            documentTitle=document.title,
            documentType=document.document_type,
            extractionPolicy=document.extraction_policy,
            pages=pages,
            metadata=document.metadata,
        )
        return self.create_index(request, operation="build")

    def create_index(self, request: CreateIndexRequest, operation: str = "create") -> JobRef:
        job = self._new_job(request.document_id, operation, len(request.pages))
        self.repository.save_job(job)
        self._run_create(job, request)
        final = self.repository.get_job(job.job_id)
        assert final is not None
        return JobRef(jobId=job.job_id, documentId=job.document_id, status=final.status)

    def _run_create(self, job: JobRecord, request: CreateIndexRequest) -> None:
        try:
            job.status = JobStatus.running
            job.updated_at = utc_now()
            self.repository.save_job(job)
            pages = [select_page_text(self._with_ocr(page, request.extraction_policy), request.extraction_policy) for page in request.pages]
            # Sorting is deterministic only. Physical page numbers are never renumbered.
            pages.sort(key=lambda page: page.pdf_page_number)
            tree = self.adapter.build_tree(request.document_id, request.document_title, pages)
            index_document = IndexDocument(
                documentId=request.document_id,
                documentTitle=request.document_title,
                documentType=request.document_type,
                extractionPolicy=request.extraction_policy,
                pages=pages,
                tree=tree,
                metadata={**request.metadata, "indexVersion": self._index_version(pages)},
            )
            self.repository.save_index(index_document)
            job.processed_pages = len(pages)
            job.warning_pages = sum(page.quality_status == QualityStatus.review for page in pages)
            job.failed_pages = sum(page.quality_status == QualityStatus.failed for page in pages)
            if job.failed_pages == len(pages):
                job.status = JobStatus.failed
            elif job.failed_pages or job.warning_pages:
                job.status = JobStatus.partial
            else:
                job.status = JobStatus.ready
            existing = self.repository.get_document(request.document_id)
            command = IndexCommand(
                operation="build",
                documentId=request.document_id,
                documentTitle=request.document_title,
                documentType=request.document_type,
                extractionPolicy=request.extraction_policy,
                pageCount=max(len(pages), existing.page_count if existing else 0),
                metadata=request.metadata,
                originalFilename=existing.original_filename if existing else None,
                originalObjectKey=existing.original_object_key if existing else None,
                mimeType=existing.mime_type if existing else None,
                byteSize=existing.byte_size if existing else None,
                sha256=existing.sha256 if existing else None,
                pdfUrl=existing.pdf_url if existing else None,
            )
            self.repository.save_document(self._document_for_command(command, index_status=job.status))
        except Exception as exc:
            job.status = JobStatus.failed
            job.error = str(exc)
            document = self.repository.get_document(request.document_id)
            if document:
                document.index_status = JobStatus.failed
                document.updated_at = utc_now()
                self.repository.save_document(document)
        finally:
            job.updated_at = utc_now()
            self.repository.save_job(job)

    @staticmethod
    def _selected_to_input(page: SelectedPage) -> PageInput:
        return PageInput(
            pdfPageNumber=page.pdf_page_number,
            printedPage=page.printed_page,
            pageTitle=page.page_title,
            sectionPath=page.section_path,
            includeInIndex=page.include_in_index,
            text=page.retrieval_text or None,
            textSource=page.text_source if page.retrieval_text else None,
            qualityScore=page.quality_score if page.retrieval_text else None,
            nativeText=page.native_text,
            ocrText=page.ocr_text,
            ocrProvider=page.ocr_provider,
            ocrModel=page.ocr_model,
            ocrConfidence=page.ocr_confidence,
            ocrBlocks=page.ocr_blocks,
            ocrError=page.ocr_error,
        )

    @staticmethod
    def _native_score(text: str) -> float:
        compact = re.sub(r"\s+", "", text or "")
        if not compact:
            return 0.0
        replacement = compact.count("�") + compact.count("�")
        readable = sum(char.isalnum() or "\u3400" <= char <= "\u9fff" for char in compact)
        score = min(0.98, 0.55 + min(len(compact), 1800) / 2200)
        if replacement:
            score -= min(0.7, replacement / max(1, len(compact)) * 2.4)
        if readable / max(1, len(compact)) < 0.45:
            score -= 0.25
        return round(max(0.0, min(1.0, score)), 4)

    def _with_ocr(self, page: PageInput, policy) -> PageInput:
        native_exists = bool((page.native_text or "").strip())
        native_score = page.native_quality_score if page.native_quality_score is not None else self._native_score(page.native_text or "")
        needs_ocr = policy.value == "ocr" or (policy.value == "auto" and (not native_exists or native_score < 0.65))
        if not needs_ocr or (page.ocr_text and page.ocr_text.strip()):
            return page
        if not page.image_base64:
            return page.model_copy(update={"ocr_error": "ocr_input_missing"})
        if self.ocr_provider is None:
            return page.model_copy(update={"ocr_error": "ocr_provider_not_configured"})
        try:
            result = self.ocr_provider.recognize(
                decode_image_base64(page.image_base64),
                mime_type=page.image_mime_type,
            )
        except OCRProviderError as exc:
            return page.model_copy(update={"ocr_error": exc.code})
        return page.model_copy(
            update={
                "ocr_text": result.text,
                "ocr_quality_score": result.confidence,
                "ocr_provider": result.provider,
                "ocr_model": result.model,
                "ocr_confidence": result.confidence,
                "ocr_blocks": result.blocks,
                "ocr_error": None,
            }
        )

    def ingest_pdf(self, request):
        """Read a PDF in physical page order and OCR only when required.

        The original PDF bytes are never replaced by recognition text. This
        endpoint is internal and accepts bytes or a path under PDF_INPUT_ROOT;
        it never fetches arbitrary remote URLs.
        """
        if bool(request.pdf_base64) == bool(request.pdf_path):
            raise ValueError("provide exactly one of pdfBase64 or pdfPath")
        if request.pdf_base64:
            payload = request.pdf_base64.split(",", 1)[1] if "," in request.pdf_base64 else request.pdf_base64
            try:
                pdf_bytes = base64.b64decode(payload, validate=True)
            except (ValueError, base64.binascii.Error) as exc:
                raise ValueError("pdf_base64_invalid") from exc
        else:
            allowed_root = os.getenv("PDF_INPUT_ROOT", "").strip()
            if not allowed_root:
                raise ValueError("pdf_path_not_allowed")
            root = Path(allowed_root).resolve()
            path = Path(request.pdf_path).expanduser().resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValueError("pdf_path_not_allowed")
            pdf_bytes = path.read_bytes()
        if not pdf_bytes.startswith(b"%PDF"):
            raise ValueError("invalid_pdf_signature")

        pages: list[PageInput] = []
        with fitz.open(stream=pdf_bytes, filetype="pdf") as pdf:
            for number, pdf_page in enumerate(pdf, start=1):
                native = pdf_page.get_text("text") or ""
                native_score = self._native_score(native)
                needs_image = request.extraction_policy.value == "ocr" or native_score < 0.65
                image_base64 = None
                if needs_image:
                    pixmap = pdf_page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                    image_base64 = base64.b64encode(pixmap.tobytes("png")).decode("ascii")
                pages.append(PageInput(
                    pdfPageNumber=number,
                    pageTitle=f"PDF 第 {number} 页",
                    nativeText=native,
                    nativeQualityScore=native_score,
                    imageBase64=image_base64,
                    imageMimeType="image/png",
                ))
        create = CreateIndexRequest(
            documentId=request.document_id,
            documentTitle=request.document_title,
            documentType=request.document_type,
            extractionPolicy=request.extraction_policy,
            pages=pages,
            metadata=request.metadata,
        )
        job = self.create_index(create, operation="ingest")
        document = self.repository.get_document(request.document_id)
        if document:
            document.page_count = len(pages)
            document.pdf_url = request.pdf_url
            document.original_filename = request.original_filename
            document.original_object_key = request.original_object_key
            document.pdf_status = "ready"
            document.updated_at = utc_now()
            self.repository.save_document(document)
        return job

    def _refresh_inputs(self, existing: IndexDocument, request: RefreshIndexRequest) -> Iterable[PageInput | int]:
        values: list[PageInput | int] = list(request.pages)
        if request.start_page is not None or request.end_page is not None:
            start = request.start_page or 1
            end = request.end_page or start
            if end < start:
                raise ValueError("endPage must be greater than or equal to startPage")
            values.extend(range(start, end + 1))
        return values

    def refresh_index(self, document_id: str, request: RefreshIndexRequest) -> JobRef:
        existing = self.repository.get_index(document_id)
        if not existing:
            raise KeyError(document_id)
        policy = request.extraction_policy or existing.extraction_policy
        merged = {page.pdf_page_number: page for page in existing.pages}
        failed_attempts = 0
        seen: set[int] = set()
        for value in self._refresh_inputs(existing, request):
            if isinstance(value, int):
                page_number = value
                if page_number in seen:
                    continue
                seen.add(page_number)
                # Prototype rerun reuses the last valid extraction. The real worker replaces
                # this input only after a new extraction has passed quality checks.
                if page_number not in merged:
                    failed_attempts += 1
                continue
            page_number = value.pdf_page_number
            if page_number in seen:
                continue
            seen.add(page_number)
            selected = select_page_text(value, policy)
            previous = merged.get(page_number)
            if selected.quality_status == QualityStatus.failed and previous and previous.retrieval_text:
                failed_attempts += 1
                continue
            merged[page_number] = selected

        request_for_build = CreateIndexRequest(
            documentId=existing.document_id,
            documentTitle=existing.document_title,
            documentType=existing.document_type,
            extractionPolicy=policy,
            pages=[self._selected_to_input(page) for page in sorted(merged.values(), key=lambda item: item.pdf_page_number)],
            metadata=existing.metadata,
        )
        job_ref = self.create_index(request_for_build, operation="refresh")
        completed = self.repository.get_job(job_ref.job_id)
        if failed_attempts and completed:
            completed.warning_pages += failed_attempts
            if completed.status == JobStatus.ready:
                completed.status = JobStatus.partial
            completed.updated_at = utc_now()
            self.repository.save_job(completed)
            document = self.repository.get_document(document_id)
            if document:
                document.index_status = completed.status
                document.updated_at = utc_now()
                self.repository.save_document(document)
        final = self.repository.get_job(job_ref.job_id)
        assert final is not None
        return JobRef(jobId=job_ref.job_id, documentId=document_id, status=final.status)

    def get_document(self, document_id: str) -> DocumentResponse:
        document = self.repository.get_document(document_id)
        if not document:
            index = self.repository.get_index(document_id)
            if not index:
                raise KeyError(document_id)
            document = DocumentRecord(
                id=index.document_id,
                title=index.document_title,
                documentType=index.document_type,
                extractionPolicy=index.extraction_policy,
                pageCount=len(index.pages),
                indexStatus=JobStatus.ready,
                metadata=index.metadata,
            )
            self.repository.save_document(document)
        return DocumentResponse(status=document.index_status, document=document)

    def _viewer(self, document_id: str, page_number: int) -> dict[str, object]:
        document = self.repository.get_document(document_id)
        pdf_url = document.pdf_url if document else None
        if not pdf_url:
            return {"pdfUrl": "", "page": page_number}
        separator = "&" if "#" in pdf_url else "#"
        return {"pdfUrl": f"{pdf_url}{separator}page={page_number}", "page": page_number}

    def get_page(self, document_id: str, page_number: int) -> PageResponse:
        document = self.repository.get_index(document_id)
        if not document:
            raise KeyError(document_id)
        page = next((item for item in document.pages if item.pdf_page_number == page_number), None)
        if not page:
            raise LookupError(page_number)
        return PageResponse(documentId=document_id, page=page, viewer=self._viewer(document_id, page_number))

    def update_page(self, document_id: str, page_number: int, patch: PagePatch) -> PageResponse:
        document = self.repository.get_index(document_id)
        if not document:
            raise KeyError(document_id)
        page = next((item for item in document.pages if item.pdf_page_number == page_number), None)
        if not page:
            raise LookupError(page_number)
        updates: dict[str, object] = {}
        if "printed_page" in patch.model_fields_set:
            updates["printed_page"] = patch.printed_page
        if "page_title" in patch.model_fields_set:
            updates["page_title"] = patch.page_title
        if "section_path" in patch.model_fields_set:
            updates["section_path"] = patch.section_path or []
        if "include_in_index" in patch.model_fields_set:
            updates["include_in_index"] = bool(patch.include_in_index)
        if "retrieval_text" in patch.model_fields_set:
            text = (patch.retrieval_text or "").strip()
            updates["retrieval_text"] = text
            if text:
                updates["quality_status"] = QualityStatus.review
                updates["quality_flags"] = list(dict.fromkeys([*page.quality_flags, "teacher_edited_text"]))
            else:
                updates["quality_status"] = QualityStatus.failed
                updates["quality_flags"] = list(dict.fromkeys([*page.quality_flags, "retrieval_text_cleared"]))
        replacement = page.model_copy(update=updates)
        document.pages = [replacement if item.pdf_page_number == page_number else item for item in document.pages]
        document.tree = self.adapter.build_tree(document.document_id, document.document_title, document.pages)
        document.updated_at = utc_now()
        self.repository.save_index(document)
        record = self.repository.get_document(document_id)
        if record:
            record.index_status = JobStatus.partial
            record.updated_at = utc_now()
            self.repository.save_document(record)
        return PageResponse(documentId=document_id, page=replacement, viewer=self._viewer(document_id, page_number))

    def get_tree(self, document_id: str):
        document = self.repository.get_index(document_id)
        if not document:
            raise KeyError(document_id)
        return document.tree

    def get_text_snapshot(self, document_id: str, start_page: int | None = None, end_page: int | None = None) -> dict[str, object]:
        """Return the canonical page-delimited text used by retrieval.

        This is intentionally an internal service capability.  The browser
        continues to display the original PDF; callers that need to build a
        local cache or compare adapters can reuse the exact text-to-page
        contract without parsing the PDF a second time.
        """
        index_document = self.repository.get_index(document_id)
        if not index_document:
            raise KeyError(document_id)
        rows: list[dict[str, object]] = []
        sidecar = self.repository.text_dir / f"{document_id}-pages.jsonl"
        if sidecar.exists():
            for line in sidecar.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                page_number = int(row.get("pdfPageNumber") or 0)
                if start_page is not None and page_number < start_page:
                    continue
                if end_page is not None and page_number > end_page:
                    continue
                rows.append(row)
        if not rows:
            for page in index_document.pages:
                if start_page is not None and page.pdf_page_number < start_page:
                    continue
                if end_page is not None and page.pdf_page_number > end_page:
                    continue
                rows.append({
                    "pdfPageNumber": page.pdf_page_number,
                    "printedPage": page.printed_page,
                    "pageTitle": page.page_title,
                    "sectionPath": page.section_path,
                    "text": page.retrieval_text,
                    "textSource": page.text_source,
                })
        rows.sort(key=lambda row: int(row.get("pdfPageNumber") or 0))
        blocks = []
        for row in rows:
            blocks.append(
                f"===== PDF_PAGE: {row.get('pdfPageNumber')} | PRINTED_PAGE: {row.get('printedPage') or '未标注'} =====\n"
                f"{row.get('text') or ''}"
            )
        return {
            "documentId": document_id,
            "documentTitle": index_document.document_title,
            "format": index_document.metadata.get("plainTextFormat", "page-delimited-v1"),
            "source": index_document.metadata.get("plainTextSource", "index-retrieval-text"),
            "pages": rows,
            "text": "\n\n".join(blocks) + ("\n" if blocks else ""),
        }

    @staticmethod
    def _terms(text: str) -> Counter[str]:
        lowered = (text or "").lower()
        words = re.findall(r"[a-z0-9_]+", lowered)
        cjk = re.findall(r"[\u3400-\u9fff]", lowered)
        bigrams = ["".join(cjk[index : index + 2]) for index in range(max(0, len(cjk) - 1))]
        return Counter(words + cjk + bigrams)

    @staticmethod
    def _compact(text: str) -> str:
        return re.sub(r"[^a-z0-9\u3400-\u9fff]", "", (text or "").lower())

    @staticmethod
    def _query_anchors(text: str) -> list[str]:
        compact = IndexService._compact(text)
        # Keep the full Chinese runs and meaningful 4–8 character windows.
        # A natural-language question often appends “为什么不能删” after a
        # lesson title; the windows recover the concrete title without
        # letting short generic phrases such as “为什么” boost a TOC page.
        anchors: set[str] = set()
        for chunk in re.findall(r"[\u3400-\u9fff]{3,}", compact):
            if chunk in {"教师用书", "学生教材", "教学设计"}:
                continue
            anchors.add(chunk)
            for size in range(4, min(8, len(chunk)) + 1):
                anchors.update(chunk[index:index + size] for index in range(len(chunk) - size + 1))
        return sorted(anchors, key=len, reverse=True)

    def retrieve(self, request: RetrieveRequest) -> RetrieveResponse:
        query_terms = self._terms(request.query)
        if not query_terms:
            return RetrieveResponse(query=request.query, results=[])
        allowed = set(request.document_ids or [])
        scored: list[RetrievedPage] = []
        for index_document in self.repository.list_indexes():
            if allowed and index_document.document_id not in allowed:
                continue
            for page in index_document.pages:
                if not page.include_in_index or not page.retrieval_text:
                    continue
                if page.quality_status == QualityStatus.failed:
                    continue
                if page.quality_status == QualityStatus.review and not request.include_review:
                    continue
                page_terms = self._terms(page.retrieval_text)
                overlap = sum(min(count, page_terms.get(term, 0)) for term, count in query_terms.items())
                if not overlap:
                    continue
                score = overlap / math.sqrt(max(1, sum(query_terms.values())) * max(1, sum(page_terms.values())))
                page_context = self._compact(" ".join([page.page_title or "", *page.section_path]))
                page_text = self._compact(page.retrieval_text)
                anchors = self._query_anchors(request.query)
                # Title/section and exact phrase matches are much stronger
                # signals than raw character overlap.  This prevents a TOC
                # page from outranking the actual lesson while retaining the
                # lightweight local fallback when the vendor adapter is down.
                if anchors and any(anchor in page_context for anchor in anchors):
                    score += 0.35
                if anchors and any(anchor in page_text for anchor in anchors):
                    score += 0.12
                if self._compact(request.query) in page_text and len(self._compact(request.query)) >= 6:
                    score += 0.08
                scored.append(
                    RetrievedPage(
                        documentId=index_document.document_id,
                        documentTitle=index_document.document_title,
                        documentType=index_document.document_type,
                        pdfPage=page.pdf_page_number,
                        printedPage=page.printed_page,
                        sectionPath=page.section_path,
                        text=page.retrieval_text,
                        textSource=page.text_source,
                        qualityStatus=page.quality_status,
                        score=round(score, 6),
                        viewer=self._viewer(index_document.document_id, page.pdf_page_number),
                        providerMetadata={
                            "adapter": self.adapter.name,
                            "qualityScore": page.quality_score,
                            "plainTextSource": index_document.metadata.get("plainTextSource"),
                            "plainTextFormat": index_document.metadata.get("plainTextFormat"),
                        },
                    )
                )
        scored.sort(key=lambda item: (-item.score, item.document_id, item.pdf_page))
        return RetrieveResponse(query=request.query, results=scored[: request.top_k])

    def validate(self, document_id: str, request: ValidationRequest) -> ValidationReport:
        index_document = self.repository.get_index(document_id)
        if not index_document:
            raise KeyError(document_id)
        indexed = [page for page in index_document.pages if page.include_in_index and page.retrieval_text and page.quality_status != QualityStatus.failed]
        warnings = sum(page.quality_status == QualityStatus.review for page in index_document.pages)
        failures = sum(page.quality_status == QualityStatus.failed for page in index_document.pages)
        checks = [
            {"id": "pages_locatable", "passed": all(page.pdf_page_number >= 1 for page in index_document.pages), "detail": f"{len(index_document.pages)} pages"},
            {"id": "retrievable_pages", "passed": bool(indexed), "detail": f"{len(indexed)} indexed pages"},
            {"id": "viewer_mapping", "passed": all(self._viewer(document_id, page.pdf_page_number).get("page") == page.pdf_page_number for page in indexed), "detail": "physical page mapping preserved"},
            {"id": "tree_range", "passed": index_document.tree.start_pdf_page <= index_document.tree.end_pdf_page, "detail": f"{index_document.tree.start_pdf_page}-{index_document.tree.end_pdf_page}"},
        ]
        question_results: list[dict[str, object]] = []
        for question in request.questions:
            response = self.retrieve(RetrieveRequest(query=question, documentIds=[document_id], topK=5))
            # Directory/front-matter pages often share many terms with a lesson
            # question. Keep them available for audit, but put a structured
            # chapter hit first so the validation surface opens the lesson
            # rather than a table of contents.
            ordered_hits = sorted(
                response.results,
                key=lambda hit: (0 if hit.section_path else 1, -hit.score),
            )
            question_results.append({
                "question": question,
                "passed": bool(response.results),
                "hits": [
                    {
                        "documentId": hit.document_id,
                        "documentTitle": hit.document_title,
                        "documentType": hit.document_type,
                        "pdfPage": hit.pdf_page,
                        "printedPage": hit.printed_page,
                        "sectionPath": hit.section_path,
                        "text": hit.text,
                        "textSource": hit.text_source,
                        "qualityStatus": hit.quality_status,
                        "score": hit.score,
                        "viewer": hit.viewer,
                    }
                    for hit in ordered_hits
                ],
            })
        passed = all(check["passed"] for check in checks) and all(item["passed"] for item in question_results)
        if not indexed:
            status = JobStatus.failed
        elif passed and failures == 0:
            status = JobStatus.ready
        else:
            status = JobStatus.partial
        report = ValidationReport(
            documentId=document_id,
            status=status,
            totalPages=len(index_document.pages),
            indexedPages=len(indexed),
            warningPages=warnings,
            failedPages=failures,
            checks=checks,
            questions=question_results,
        )
        self.repository.save_validation(report)
        record = self.repository.get_document(document_id)
        if record:
            # A few cover/版权 pages are intentionally marked review because
            # they contain little searchable text. They do not mean the
            # document is being rebuilt or unavailable; only failed pages or
            # an empty index should downgrade the built index.
            record.index_status = JobStatus.failed if status == JobStatus.failed else JobStatus.ready
            record.updated_at = utc_now()
            self.repository.save_document(record)
        return report

    def get_validation(self, document_id: str) -> ValidationReport:
        report = self.repository.get_validation(document_id)
        if not report:
            raise KeyError(document_id)
        return report

    def delete_document(self, document_id: str) -> bool:
        return self.repository.delete_document(document_id)
