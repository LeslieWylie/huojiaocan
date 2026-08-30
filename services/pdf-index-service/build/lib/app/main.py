from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response

from .models import (
    DocumentResponse,
    HealthResponse,
    IndexCommand,
    JobRecord,
    JobRef,
    PagePatch,
    PageResponse,
    RefreshIndexRequest,
    RetrieveRequest,
    RetrieveResponse,
    TreeNode,
    ValidationReport,
    ValidationRequest,
)
from .pageindex_adapter import (
    FixturePageIndexAdapter,
    HuojiaocanPageTextProvider,
    VendorPageIndexAdapter,
)
from .repository import FileRepository
from .service import IndexService

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SERVICES_ROOT = SERVICE_ROOT.parent
DEFAULT_VENDOR_ROOT = SERVICES_ROOT / "pageindex" / "vendor" / "PageIndex"
DEFAULT_DATA_ROOT = SERVICE_ROOT / "runtime"
PIN_FILE = SERVICES_ROOT / "pageindex" / "PINNED_COMMIT"


def create_app(data_root: str | Path | None = None) -> FastAPI:
    adapter_name = os.getenv("PAGEINDEX_ADAPTER", "fixture").strip().lower()
    if adapter_name == "fixture":
        adapter = FixturePageIndexAdapter()
    elif adapter_name == "vendor":
        adapter = VendorPageIndexAdapter(
            os.getenv("PAGEINDEX_VENDOR_ROOT", str(DEFAULT_VENDOR_ROOT)),
            page_text_provider=HuojiaocanPageTextProvider(),
        )
    else:
        raise RuntimeError(
            f"Unsupported PAGEINDEX_ADAPTER={adapter_name!r}; expected 'fixture' or 'vendor'"
        )
    repository = FileRepository(data_root or os.getenv("PDF_INDEX_DATA_DIR", str(DEFAULT_DATA_ROOT)))
    service = IndexService(repository, adapter)

    app = FastAPI(title="Huojiaocan PDF Index Service", version="0.2.0")
    app.state.index_service = service

    @app.get("/healthz", response_model=HealthResponse)
    def healthz() -> HealthResponse:
        commit = PIN_FILE.read_text(encoding="utf-8").strip() if PIN_FILE.exists() else None
        return HealthResponse(status="ok", adapter=service.adapter.name, vendorCommit=commit)

    @app.post("/internal/v1/indexes", response_model=DocumentResponse | JobRef, status_code=202)
    def index_command(request: IndexCommand) -> DocumentResponse | JobRef:
        if request.operation == "register":
            return service.register_document(request)
        return service.start_index(request)

    @app.get("/internal/v1/jobs/{job_id}", response_model=JobRecord)
    def get_job(job_id: str) -> JobRecord:
        job = service.repository.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job not found")
        return job

    @app.get("/internal/v1/indexes/{document_id}/tree", response_model=TreeNode)
    def get_tree(document_id: str) -> TreeNode:
        try:
            return service.get_tree(document_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="index not found") from None

    @app.get("/internal/v1/indexes/{document_id}/pages/{page_number}", response_model=PageResponse)
    def get_page(document_id: str, page_number: int) -> PageResponse:
        try:
            return service.get_page(document_id, page_number)
        except KeyError:
            raise HTTPException(status_code=404, detail="index not found") from None
        except LookupError:
            raise HTTPException(status_code=404, detail="page not found") from None

    @app.patch("/internal/v1/indexes/{document_id}/pages/{page_number}", response_model=PageResponse)
    def update_page(document_id: str, page_number: int, patch: PagePatch) -> PageResponse:
        try:
            return service.update_page(document_id, page_number, patch)
        except KeyError:
            raise HTTPException(status_code=404, detail="index not found") from None
        except LookupError:
            raise HTTPException(status_code=404, detail="page not found") from None

    @app.post("/internal/v1/indexes/{document_id}/refresh", response_model=JobRef, status_code=202)
    def refresh(document_id: str, request: RefreshIndexRequest) -> JobRef:
        try:
            return service.refresh_index(document_id, request)
        except KeyError:
            raise HTTPException(status_code=404, detail="index not found") from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @app.post("/internal/v1/indexes/{document_id}/validate", response_model=ValidationReport, status_code=202)
    def validate(document_id: str, request: ValidationRequest) -> ValidationReport:
        try:
            return service.validate(document_id, request)
        except KeyError:
            raise HTTPException(status_code=404, detail="index not found") from None

    @app.get("/internal/v1/indexes/{document_id}/validation", response_model=ValidationReport)
    def get_validation(document_id: str) -> ValidationReport:
        try:
            return service.get_validation(document_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="validation not found") from None

    @app.delete("/internal/v1/indexes/{document_id}", status_code=204)
    def delete_document(document_id: str) -> Response:
        if not service.delete_document(document_id):
            raise HTTPException(status_code=404, detail="document not found")
        return Response(status_code=204)

    @app.get("/internal/v1/indexes/{document_id}", response_model=DocumentResponse)
    def get_document(document_id: str) -> DocumentResponse:
        try:
            return service.get_document(document_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="document not found") from None

    @app.post("/internal/v1/retrieve", response_model=RetrieveResponse)
    def retrieve(request: RetrieveRequest) -> RetrieveResponse:
        return service.retrieve(request)

    return app


app = create_app()
