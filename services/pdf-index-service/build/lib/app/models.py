from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True, extra="forbid")


class DocumentType(str, Enum):
    textbook = "textbook"
    teacher_guide = "teacher_guide"
    other = "other"


class ExtractionPolicy(str, Enum):
    auto = "auto"
    native = "native"
    ocr = "ocr"


class TextSource(str, Enum):
    native = "native"
    ocr = "ocr"
    merged = "merged"
    none = "none"


class QualityStatus(str, Enum):
    normal = "normal"
    review = "review"
    failed = "failed"


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    partial = "partial"
    ready = "ready"
    failed = "failed"


class PageInput(ApiModel):
    pdf_page_number: int = Field(alias="pdfPageNumber", ge=1)
    printed_page: str | None = Field(default=None, validation_alias=AliasChoices("printedPage", "printedPageLabel"), serialization_alias="printedPage")
    page_title: str | None = Field(default=None, validation_alias=AliasChoices("pageTitle", "title"), serialization_alias="pageTitle")
    section_path: list[str] = Field(default_factory=list, alias="sectionPath")
    include_in_index: bool = Field(default=True, alias="includeInIndex")

    native_text: str | None = Field(default=None, alias="nativeText")
    native_quality_score: float | None = Field(default=None, alias="nativeQualityScore", ge=0, le=1)
    ocr_text: str | None = Field(default=None, alias="ocrText")
    ocr_quality_score: float | None = Field(default=None, alias="ocrQualityScore", ge=0, le=1)
    ocr_provider: str | None = Field(default=None, alias="ocrProvider")
    ocr_model: str | None = Field(default=None, alias="ocrModel")

    text: str | None = None
    text_source: TextSource | None = Field(default=None, alias="textSource")
    quality_score: float | None = Field(default=None, alias="qualityScore", ge=0, le=1)

    @model_validator(mode="after")
    def validate_preselected_pair(self) -> "PageInput":
        if bool(self.text and self.text.strip()) != bool(self.text_source and self.text_source != TextSource.none):
            raise ValueError("text and textSource must be supplied together")
        return self


class SelectedPage(ApiModel):
    pdf_page_number: int = Field(alias="pdfPageNumber")
    printed_page: str | None = Field(default=None, alias="printedPage")
    page_title: str | None = Field(default=None, alias="pageTitle")
    section_path: list[str] = Field(default_factory=list, alias="sectionPath")
    include_in_index: bool = Field(alias="includeInIndex")
    retrieval_text: str = Field(alias="retrievalText")
    text_source: TextSource = Field(alias="textSource")
    quality_score: float = Field(alias="qualityScore")
    quality_status: QualityStatus = Field(alias="qualityStatus")
    quality_flags: list[str] = Field(default_factory=list, alias="qualityFlags")
    native_text: str | None = Field(default=None, alias="nativeText")
    ocr_text: str | None = Field(default=None, alias="ocrText")
    ocr_provider: str | None = Field(default=None, alias="ocrProvider")
    ocr_model: str | None = Field(default=None, alias="ocrModel")


class IndexCommand(ApiModel):
    operation: Literal["register", "build"] = "build"
    document_id: str = Field(validation_alias=AliasChoices("documentId", "id"), serialization_alias="documentId", min_length=1)
    document_title: str | None = Field(default=None, validation_alias=AliasChoices("documentTitle", "title"), serialization_alias="documentTitle")
    document_type: DocumentType = Field(default=DocumentType.other, alias="documentType")
    extraction_policy: ExtractionPolicy = Field(default=ExtractionPolicy.auto, alias="extractionPolicy")
    pages: list[PageInput] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    original_filename: str | None = Field(default=None, alias="originalFilename")
    original_object_key: str | None = Field(default=None, alias="originalObjectKey")
    mime_type: str | None = Field(default=None, alias="mimeType")
    byte_size: int | None = Field(default=None, alias="byteSize", ge=0)
    sha256: str | None = None
    page_count: int = Field(default=0, alias="pageCount", ge=0)
    pdf_url: str | None = Field(default=None, alias="pdfUrl")

    @model_validator(mode="after")
    def validate_unique_physical_pages(self) -> "IndexCommand":
        page_numbers = [page.pdf_page_number for page in self.pages]
        if len(page_numbers) != len(set(page_numbers)):
            raise ValueError("pdfPageNumber must be unique within a document")
        return self


class CreateIndexRequest(ApiModel):
    document_id: str = Field(alias="documentId", min_length=1)
    document_title: str = Field(alias="documentTitle", min_length=1)
    document_type: DocumentType = Field(alias="documentType")
    extraction_policy: ExtractionPolicy = Field(default=ExtractionPolicy.auto, alias="extractionPolicy")
    pages: list[PageInput] = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def unique_physical_pages(self) -> "CreateIndexRequest":
        page_numbers = [page.pdf_page_number for page in self.pages]
        if len(page_numbers) != len(set(page_numbers)):
            raise ValueError("pdfPageNumber must be unique within a document")
        return self


class RefreshIndexRequest(ApiModel):
    pages: list[PageInput | int] = Field(default_factory=list)
    extraction_policy: ExtractionPolicy | None = Field(default=None, alias="extractionPolicy")
    start_page: int | None = Field(default=None, alias="startPage", ge=1)
    end_page: int | None = Field(default=None, alias="endPage", ge=1)


class PagePatch(ApiModel):
    printed_page: str | None = Field(default=None, validation_alias=AliasChoices("printedPage", "printedPageLabel"), serialization_alias="printedPage")
    page_title: str | None = Field(default=None, validation_alias=AliasChoices("pageTitle", "title"), serialization_alias="pageTitle")
    section_path: list[str] | None = Field(default=None, alias="sectionPath")
    include_in_index: bool | None = Field(default=None, alias="includeInIndex")
    retrieval_text: str | None = Field(default=None, alias="retrievalText")


class JobRef(ApiModel):
    job_id: str = Field(alias="jobId")
    document_id: str = Field(alias="documentId")
    status: JobStatus


class JobRecord(JobRef):
    operation: str
    total_pages: int = Field(alias="totalPages")
    processed_pages: int = Field(alias="processedPages")
    warning_pages: int = Field(alias="warningPages")
    failed_pages: int = Field(alias="failedPages")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    error: str | None = None


class TreeNode(ApiModel):
    id: str
    title: str
    level: int
    start_pdf_page: int = Field(alias="startPdfPage")
    end_pdf_page: int = Field(alias="endPdfPage")
    section_path: list[str] = Field(alias="sectionPath")
    children: list["TreeNode"] = Field(default_factory=list)


class IndexDocument(ApiModel):
    document_id: str = Field(alias="documentId")
    document_title: str = Field(alias="documentTitle")
    document_type: DocumentType = Field(alias="documentType")
    extraction_policy: ExtractionPolicy = Field(alias="extractionPolicy")
    pages: list[SelectedPage]
    tree: TreeNode
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now, alias="createdAt")
    updated_at: datetime = Field(default_factory=utc_now, alias="updatedAt")


class DocumentRecord(ApiModel):
    id: str
    title: str
    document_type: DocumentType = Field(alias="documentType")
    extraction_policy: ExtractionPolicy = Field(alias="extractionPolicy")
    original_filename: str | None = Field(default=None, alias="originalFilename")
    original_object_key: str | None = Field(default=None, alias="originalObjectKey")
    mime_type: str | None = Field(default=None, alias="mimeType")
    byte_size: int | None = Field(default=None, alias="byteSize")
    sha256: str | None = None
    page_count: int = Field(default=0, alias="pageCount")
    pdf_url: str | None = Field(default=None, alias="pdfUrl")
    pdf_status: str = Field(default="registered", alias="pdfStatus")
    index_status: JobStatus = Field(default=JobStatus.pending, alias="indexStatus")
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now, alias="createdAt")
    updated_at: datetime = Field(default_factory=utc_now, alias="updatedAt")


class DocumentResponse(ApiModel):
    status: JobStatus
    document: DocumentRecord


class PageResponse(ApiModel):
    document_id: str = Field(alias="documentId")
    page: SelectedPage
    viewer: dict[str, Any] = Field(default_factory=dict)


class RetrieveRequest(ApiModel):
    query: str = Field(min_length=1)
    document_ids: list[str] | None = Field(default=None, validation_alias=AliasChoices("documentIds", "scope"), serialization_alias="documentIds")
    top_k: int = Field(default=5, validation_alias=AliasChoices("topK", "limit"), serialization_alias="topK", ge=1, le=50)
    include_review: bool = Field(default=True, alias="includeReview")
    mode: str | None = None


class RetrievedPage(ApiModel):
    document_id: str = Field(alias="documentId")
    document_title: str = Field(alias="documentTitle")
    document_type: DocumentType = Field(alias="documentType")
    pdf_page: int = Field(alias="pdfPage")
    printed_page: str | None = Field(default=None, alias="printedPage")
    section_path: list[str] = Field(alias="sectionPath")
    text: str
    text_source: TextSource = Field(alias="textSource")
    quality_status: QualityStatus = Field(alias="qualityStatus")
    score: float
    viewer: dict[str, Any] = Field(default_factory=dict)
    provider_metadata: dict[str, Any] = Field(default_factory=dict, alias="providerMetadata")


class RetrieveResponse(ApiModel):
    query: str
    results: list[RetrievedPage]


class ValidationRequest(ApiModel):
    questions: list[str] = Field(default_factory=list)


class ValidationReport(ApiModel):
    document_id: str = Field(alias="documentId")
    status: JobStatus
    checked_at: datetime = Field(default_factory=utc_now, alias="checkedAt")
    total_pages: int = Field(alias="totalPages")
    indexed_pages: int = Field(alias="indexedPages")
    warning_pages: int = Field(alias="warningPages")
    failed_pages: int = Field(alias="failedPages")
    checks: list[dict[str, Any]] = Field(default_factory=list)
    questions: list[dict[str, Any]] = Field(default_factory=list)


class HealthResponse(ApiModel):
    status: str
    adapter: str
    vendor_commit: str | None = Field(default=None, alias="vendorCommit")
