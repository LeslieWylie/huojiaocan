from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parents[1]
SOURCE = WORKSPACE / "demo" / "data" / "index"
OUT = ROOT / "seed-runtime"
QUESTIONS = [
    "《我爱这土地》第二节为什么不能删",
    "第一单元三项任务之间是什么关系",
    "《我爱这土地》的教学重点和依据",
    "朗读的重音和节奏建议来自哪里",
    "某项练习如何处理",
    "单元目标和篇目目标有什么关系",
    "教师用书如何说明诗歌意象",
    "《乡愁》的教学入口是什么",
    "诗歌朗诵任务如何评价",
    "尝试创作任务如何承接鉴赏学习",
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def tree_paths(nodes: list[dict], prefix: list[str] | None = None, by_id: dict | None = None, all_nodes: list | None = None):
    prefix = prefix or []
    by_id = by_id if by_id is not None else {}
    all_nodes = all_nodes if all_nodes is not None else []
    for node in nodes:
        path = [*prefix, str(node.get("title") or "")]
        item = {"node": node, "path": path}
        all_nodes.append(item)
        if node.get("id"):
            by_id[str(node["id"])] = item
        tree_paths(node.get("children") or [], path, by_id, all_nodes)
    return by_id, all_nodes


def node_path(page: dict, by_id: dict, all_nodes: list) -> list[str]:
    node_id = page.get("nodeId")
    if node_id and str(node_id) in by_id:
        return by_id[str(node_id)]["path"]
    page_number = int(page["pageNumber"])
    candidates = [
        item for item in all_nodes
        if int(item["node"].get("startPage", 0)) <= page_number <= int(item["node"].get("endPage", 0))
    ]
    if not candidates:
        return []
    return max(candidates, key=lambda item: int(item["node"].get("level", 0)))["path"]


def convert_tree(nodes: list[dict], prefix: list[str] | None = None) -> list[dict]:
    prefix = prefix or []
    result = []
    for node in nodes:
        title = str(node.get("title") or "未命名章节")
        path = [*prefix, title]
        result.append({
            "id": f"seed-{node.get('id') or hashlib.sha1('/'.join(path).encode()).hexdigest()[:12]}",
            "title": title,
            "level": int(node.get("level", len(path))),
            "startPdfPage": int(node.get("startPage", 1)),
            "endPdfPage": int(node.get("endPage", node.get("startPage", 1))),
            "sectionPath": path,
            "children": convert_tree(node.get("children") or [], path),
        })
    return result


def build_document(document_id: str, page_file: str, tree_file: str, title: str, document_type: str, filename: str) -> tuple[dict, dict]:
    pages = json.loads((SOURCE / page_file).read_text(encoding="utf-8"))
    tree_source = json.loads((SOURCE / tree_file).read_text(encoding="utf-8"))
    by_id, all_nodes = tree_paths(tree_source)
    selected = []
    for raw in pages:
        text = str(raw.get("text") or "").strip()
        quality_status = "normal" if len(text) >= 80 else "review"
        selected.append({
            "pdfPageNumber": int(raw["pageNumber"]),
            "printedPage": raw.get("printedPage"),
            "pageTitle": raw.get("title") or "",
            "sectionPath": node_path(raw, by_id, all_nodes),
            "includeInIndex": True,
            "retrievalText": text,
            "textSource": "native",
            "qualityScore": 0.96 if quality_status == "normal" else 0.72,
            "qualityStatus": quality_status,
            "qualityFlags": ["short_page_text"] if quality_status == "review" else [],
            "nativeText": text,
            "ocrText": None,
            "ocrProvider": None,
            "ocrModel": None,
        })
    root = {
        "id": f"seed-root-{document_id}",
        "title": title,
        "level": 0,
        "startPdfPage": 1,
        "endPdfPage": len(selected),
        "sectionPath": [],
        "children": convert_tree(tree_source),
    }
    timestamp = now()
    document = {
        "id": document_id,
        "title": title,
        "documentType": document_type,
        "extractionPolicy": "auto",
        "originalFilename": filename,
        "originalObjectKey": f"materials/{filename}",
        "mimeType": "application/pdf",
        "byteSize": None,
        "sha256": None,
        "pageCount": len(selected),
        "pdfUrl": f"/materials/{filename}",
        "pdfStatus": "ready",
        "indexStatus": "ready",
        "metadata": {"seeded": True, "seedProvider": "prebuilt-page-text"},
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    index = {
        "documentId": document_id,
        "documentTitle": title,
        "documentType": document_type,
        "extractionPolicy": "auto",
        "pages": selected,
        "tree": root,
        "metadata": {"seeded": True, "seedProvider": "prebuilt-page-text"},
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    return document, index


def write_seed(document_id: str, document: dict, index: dict):
    (OUT / "documents").mkdir(parents=True, exist_ok=True)
    (OUT / "indexes").mkdir(parents=True, exist_ok=True)
    (OUT / "documents" / f"{document_id}.json").write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "indexes" / f"{document_id}.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    documents = [
        build_document(
            "textbook", "textbook-pages.json", "textbook-tree.json",
            "义务教育教科书 语文 九年级上册", "textbook", "九年级语文上册-学生教材.pdf",
        ),
        build_document(
            "teacher-guide", "teacher-guide-pages.json", "teacher-guide-tree.json",
            "义务教育教科书教师教学用书 语文 九年级上册", "teacher_guide", "九年级语文上册-教师教学用书.pdf",
        ),
    ]
    for document, index in documents:
        write_seed(document["id"], document, index)

    # Generate an initial validation snapshot using the same service retrieval
    # implementation. This avoids a first-view empty state on a new Vercel
    # instance; subsequent explicit validation requests overwrite it.
    os.environ["PAGEINDEX_ADAPTER"] = "fixture"
    os.environ["PDF_INDEX_DATA_DIR"] = str(OUT.parent / ".seed-validation-runtime")
    os.environ["PAGEINDEX_SEED_ROOT"] = str(OUT)
    from fastapi.testclient import TestClient
    from app.main import create_app
    client = TestClient(create_app(os.environ["PDF_INDEX_DATA_DIR"]))
    for document, _ in documents:
        response = client.post(f"/internal/v1/indexes/{document['id']}/validate", json={"questions": QUESTIONS})
        response.raise_for_status()
        (OUT / "validations").mkdir(parents=True, exist_ok=True)
        (OUT / "validations" / f"{document['id']}.json").write_text(response.text, encoding="utf-8")
    shutil.rmtree(OUT.parent / ".seed-validation-runtime", ignore_errors=True)
    print("seeded", ", ".join(document["id"] for document, _ in documents))


if __name__ == "__main__":
    main()
