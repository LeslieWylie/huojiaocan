from __future__ import annotations

import json
import os
from pathlib import Path
from threading import RLock
from typing import Any

from .models import DocumentRecord, IndexDocument, JobRecord, ValidationReport


class FileRepository:
    """Inspectable prototype repository using atomic file replacement."""

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.jobs_dir = self.root / "jobs"
        self.indexes_dir = self.root / "indexes"
        self.documents_dir = self.root / "documents"
        self.validations_dir = self.root / "validations"
        # Plain-text snapshots are retrieval artifacts, not a second display
        # source.  Keeping them beside the index makes the canonical text
        # reusable by search, validation, exports and future adapters while
        # preserving the immutable PDF page number in every block.
        self.text_dir = self.root / "text"
        for directory in (self.jobs_dir, self.indexes_dir, self.documents_dir, self.validations_dir, self.text_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()

    def _write_json(self, path: Path, value: dict[str, Any]) -> None:
        payload = json.dumps(value, ensure_ascii=False, indent=2, default=str)
        temp = path.with_suffix(path.suffix + ".tmp")
        with self._lock:
            temp.write_text(payload, encoding="utf-8")
            os.replace(temp, path)

    def _read_model(self, path: Path, model):
        if not path.exists():
            return None
        return model.model_validate_json(path.read_text(encoding="utf-8"))

    def save_job(self, job: JobRecord) -> None:
        self._write_json(self.jobs_dir / f"{job.job_id}.json", job.model_dump(by_alias=True, mode="json"))

    def get_job(self, job_id: str) -> JobRecord | None:
        return self._read_model(self.jobs_dir / f"{job_id}.json", JobRecord)

    def save_document(self, document: DocumentRecord) -> None:
        self._write_json(self.documents_dir / f"{document.id}.json", document.model_dump(by_alias=True, mode="json"))

    def get_document(self, document_id: str) -> DocumentRecord | None:
        return self._read_model(self.documents_dir / f"{document_id}.json", DocumentRecord)

    def list_documents(self) -> list[DocumentRecord]:
        return [DocumentRecord.model_validate_json(path.read_text(encoding="utf-8")) for path in sorted(self.documents_dir.glob("*.json"))]

    def save_index(self, document: IndexDocument) -> None:
        self._write_json(self.indexes_dir / f"{document.document_id}.json", document.model_dump(by_alias=True, mode="json"))

    def get_index(self, document_id: str) -> IndexDocument | None:
        return self._read_model(self.indexes_dir / f"{document_id}.json", IndexDocument)

    def list_indexes(self) -> list[IndexDocument]:
        return [IndexDocument.model_validate_json(path.read_text(encoding="utf-8")) for path in sorted(self.indexes_dir.glob("*.json"))]

    def save_validation(self, report: ValidationReport) -> None:
        self._write_json(self.validations_dir / f"{report.document_id}.json", report.model_dump(by_alias=True, mode="json"))

    def get_validation(self, document_id: str) -> ValidationReport | None:
        return self._read_model(self.validations_dir / f"{document_id}.json", ValidationReport)

    def delete_document(self, document_id: str) -> bool:
        deleted = False
        for directory in (self.documents_dir, self.indexes_dir, self.validations_dir):
            path = directory / f"{document_id}.json"
            if path.exists():
                path.unlink()
                deleted = True
        return deleted
