from __future__ import annotations

import os
import hmac
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response

from .models import (
    DocumentResponse,
    HealthResponse,
    IndexCommand,
    JobRecord,
    JobRef,
    PagePatch,
    PageResponse,
    PdfIngestRequest,
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
from .seed_runtime import seed_runtime
from .service import IndexService
from .ocr_provider import create_ocr_provider

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SERVICES_ROOT = SERVICE_ROOT.parent
DEFAULT_VENDOR_ROOT = SERVICES_ROOT / "pageindex" / "vendor" / "PageIndex"
DEFAULT_DATA_ROOT = SERVICE_ROOT / "runtime"
DEFAULT_SEED_ROOT = SERVICE_ROOT / "seed-runtime"
PIN_FILE_CANDIDATES = tuple(
    Path(value)
    for value in (
        os.getenv("PAGEINDEX_PINNED_COMMIT_FILE"),
        str(SERVICE_ROOT / "pageindex" / "PINNED_COMMIT"),
        str(SERVICES_ROOT / "pageindex" / "PINNED_COMMIT"),
    )
    if value
)


def _production_runtime() -> bool:
    presence_markers = ("K_SERVICE", "RENDER_SERVICE_ID", "FLY_APP_NAME", "AWS_LAMBDA_FUNCTION_NAME")
    boolean_markers = ("VERCEL", "PAGEINDEX_PRODUCTION")
    return any(os.getenv(name, "").strip() for name in presence_markers) or any(
        os.getenv(name, "").strip().lower() in {"1", "true", "production"}
        for name in boolean_markers
    ) or os.getenv("ENVIRONMENT", "").strip().lower() == "production"


def _local_request(request: Request) -> bool:
    host = (request.client.host if request.client else "").strip().lower()
    forwarded = request.headers.get("forwarded") or request.headers.get("x-forwarded-for")
    return not forwarded and host in {"127.0.0.1", "::1", "localhost", "testclient"}


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
    seed_runtime(repository, os.getenv("PAGEINDEX_SEED_ROOT", str(DEFAULT_SEED_ROOT)))
    service = IndexService(repository, adapter, ocr_provider=create_ocr_provider())

    app = FastAPI(title="Huojiaocan PDF Index Service", version="0.2.0")
    app.state.index_service = service

    # The public deployment is called by the BFF, not by browsers. Internal
    # routes must never become public merely because an environment variable
    # was omitted. Local loopback and tests can opt into an unauthenticated
    # fixture service, while known deployment runtimes fail during startup.
    service_key = os.getenv("PAGEINDEX_SERVICE_API_KEY", "").strip()
    if not service_key and _production_runtime():
        raise RuntimeError("PAGEINDEX_SERVICE_API_KEY is required in production")

    @app.middleware("http")
    async def require_service_key(request: Request, call_next):
        if request.url.path.startswith("/internal/v1/"):
            if not service_key:
                if not _local_request(request):
                    return Response(status_code=503, content='{"detail":"service authentication is not configured"}', media_type="application/json")
                return await call_next(request)
            authorization = request.headers.get("authorization", "")
            supplied = authorization.removeprefix("Bearer ").strip()
            if not supplied or not hmac.compare_digest(supplied, service_key):
                return Response(status_code=401, content='{"detail":"unauthorized"}', media_type="application/json")
        return await call_next(request)

    @app.get("/healthz", response_model=HealthResponse)
    def healthz() -> HealthResponse:
        commit = next(
            (path.read_text(encoding="utf-8").strip() for path in PIN_FILE_CANDIDATES if path.exists()),
            None,
        )
        return HealthResponse(status="ok", adapter=service.adapter.name, vendorCommit=commit)

    @app.post("/internal/v1/indexes", response_model=DocumentResponse | JobRef, status_code=202)
    def index_command(request: IndexCommand) -> DocumentResponse | JobRef:
        if request.operation == "register":
            return service.register_document(request)
        return service.start_index(request)

    @app.post("/internal/v1/ingest", response_model=JobRef, status_code=202)
    def ingest(request: PdfIngestRequest) -> JobRef:
        try:
            return service.ingest_pdf(request)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @app.get("/internal/v1/indexes")
    def list_indexes() -> dict[str, object]:
        documents = service.repository.list_documents()
        return {
            "status": "ok",
            "adapter": service.adapter.name,
            "documents": [document.model_dump(by_alias=True, mode="json") for document in documents],
        }

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

    @app.get("/internal/v1/indexes/{document_id}/text")
    def get_text_snapshot(document_id: str, startPage: int | None = None, endPage: int | None = None) -> dict[str, object]:
        try:
            return service.get_text_snapshot(document_id, startPage, endPage)
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
            report = service.get_validation(document_id)
            # Seeded reports created before the production validation contract
            # only contained page metadata. Refresh those reports on demand so
            # the first page always opens a structured, text-backed hit rather
            # than an empty directory placeholder.
            needs_refresh = any(
                not hit.get("text")
                for question in report.questions
                for hit in question.get("hits", [])[:1]
            )
            if needs_refresh:
                return service.validate(
                    document_id,
                    ValidationRequest(questions=[question.get("question", "") for question in report.questions if question.get("question")]),
                )
            return report
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
