"""Build canonical, page-addressable plain-text snapshots for the two books.

The original PDFs are the display source.  These files are only retrieval
artifacts: every block carries its immutable PDF physical page number, so a
plain-text search can never silently renumber the page shown to a teacher.

The PDFs currently contain a usable native text layer.  We therefore use the
mature Poppler ``pdftotext`` extractor instead of running OCR over clean pages.
OCR remains an ingest-time fallback for genuinely scanned uploads.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parents[1]
PDF_ROOT = WORKSPACE / "demo" / "public" / "materials"
SOURCE_INDEX = WORKSPACE / "demo" / "data" / "index"
SEED_ROOT = ROOT / "seed-runtime"

BOOKS = {
    "textbook": {
        "pdf": PDF_ROOT / "九年级语文上册-学生教材.pdf",
        "source": SOURCE_INDEX / "textbook-pages.json",
    },
    "teacher-guide": {
        "pdf": PDF_ROOT / "九年级语文上册-教师教学用书.pdf",
        "source": SOURCE_INDEX / "teacher-guide-pages.json",
    },
}


def clean_text(value: str) -> str:
    """Keep readable PDF text while removing extraction control noise."""

    value = (value or "").replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    value = value.replace("\u00a0", " ").replace("\u2002", " ").replace("\u2003", " ").replace("\u2009", " ")
    value = "".join(char for char in value if char in "\n\t" or ord(char) >= 32)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in value.split("\n")]
    return "\n".join(lines).strip()


def extract_page(pdf: Path, page_number: int, pdftotext: str) -> str:
    command = [pdftotext, "-f", str(page_number), "-l", str(page_number), "-layout", "-enc", "UTF-8", str(pdf), "-"]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return clean_text(result.stdout)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build_book(document_id: str, config: dict[str, Path], pdftotext: str) -> dict[str, object]:
    source_pages = json.loads(config["source"].read_text(encoding="utf-8"))
    page_rows: list[dict[str, object]] = []
    for raw in source_pages:
        page_number = int(raw["pageNumber"])
        text = extract_page(config["pdf"], page_number, pdftotext)
        if not text:
            # Keep the existing text only as a last-resort warning path.  It
            # is never used to overwrite a non-empty native extraction.
            text = clean_text(str(raw.get("text") or ""))
        page_rows.append({
            "pdfPageNumber": page_number,
            "printedPage": raw.get("printedPage"),
            "pageTitle": raw.get("title") or "",
            "sectionPath": raw.get("sectionPath") or [],
            "text": text,
            "textSource": "native",
            "qualityScore": 0.98 if len(text) >= 80 else 0.72,
            "qualityStatus": "normal" if len(text) >= 80 else "review",
        })

    text_dir = SEED_ROOT / "text"
    text_dir.mkdir(parents=True, exist_ok=True)
    plain_path = text_dir / f"{document_id}.txt"
    jsonl_path = text_dir / f"{document_id}-pages.jsonl"
    blocks = []
    for row in page_rows:
        printed = row["printedPage"] or "未标注"
        blocks.append(f"===== PDF_PAGE: {row['pdfPageNumber']} | PRINTED_PAGE: {printed} =====\n{row['text']}")
    plain_path.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
    jsonl_path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in page_rows), encoding="utf-8")
    return {
        "pages": page_rows,
        "plainTextFile": f"text/{document_id}.txt",
        "plainTextPagesFile": f"text/{document_id}-pages.jsonl",
        "plainTextFormat": "page-delimited-v1",
        "plainTextSource": "pdftotext-layout-native",
        "plainTextSha256": sha256(plain_path),
        "plainTextGeneratedAt": datetime.now(timezone.utc).isoformat(),
    }


def update_index_artifacts(document_id: str, result: dict[str, object]) -> None:
    """Replace retrieval text in both the seed index and local fallback data."""

    pages = result["pages"]
    seed_index_path = SEED_ROOT / "indexes" / f"{document_id}.json"
    index = json.loads(seed_index_path.read_text(encoding="utf-8"))
    by_page = {int(row["pdfPageNumber"]): row for row in pages}
    for page in index["pages"]:
        row = by_page[int(page["pdfPageNumber"])]
        page["retrievalText"] = row["text"]
        page["nativeText"] = row["text"]
        page["textSource"] = row["textSource"]
        page["qualityScore"] = row["qualityScore"]
        page["qualityStatus"] = row["qualityStatus"]
        page["qualityFlags"] = [] if row["qualityStatus"] == "normal" else ["short_page_text"]
    index["metadata"] = {**index.get("metadata", {}), **{key: result[key] for key in result if key != "pages"}}
    seed_index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    seed_document_path = SEED_ROOT / "documents" / f"{document_id}.json"
    document = json.loads(seed_document_path.read_text(encoding="utf-8"))
    document["metadata"] = {**document.get("metadata", {}), **{key: result[key] for key in result if key != "pages"}}
    seed_document_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    local_path = SOURCE_INDEX / f"{document_id}-pages.json"
    local_pages = json.loads(local_path.read_text(encoding="utf-8"))
    local_by_page = {int(row["pageNumber"]): row for row in local_pages}
    for row in pages:
        local_by_page[int(row["pdfPageNumber"])]["text"] = row["text"]
    local_path.write_text(json.dumps(local_pages, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    pdftotext = shutil.which("pdftotext")
    if not pdftotext:
        raise SystemExit("pdftotext is required to build the canonical native-text snapshots")
    for document_id, config in BOOKS.items():
        result = build_book(document_id, config, pdftotext)
        update_index_artifacts(document_id, result)
        print(document_id, len(result["pages"]), result["plainTextSha256"])


if __name__ == "__main__":
    main()
