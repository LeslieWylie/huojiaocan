from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def make_client(tmp_path) -> TestClient:
    return TestClient(create_app(tmp_path))


def register_payload(document_id: str = "doc_textbook") -> dict:
    return {
        "operation": "register",
        "documentId": document_id,
        "documentTitle": "九年级语文上册",
        "documentType": "textbook",
        "extractionPolicy": "auto",
        "originalFilename": "九年级语文上册.pdf",
        "originalObjectKey": f"materials/{document_id}.pdf",
        "mimeType": "application/pdf",
        "byteSize": 123456,
        "sha256": "a" * 64,
        "pageCount": 168,
        "pdfUrl": f"/materials/{document_id}.pdf",
        "metadata": {"edition": "2026"},
    }


def pages_payload() -> list[dict]:
    return [
        {
            "pdfPageNumber": 57,
            "printedPage": "51",
            "pageTitle": "我爱这土地",
            "sectionPath": ["第一单元", "我爱这土地"],
            "nativeText": "我爱这土地 第一节 假如我是一只鸟",
            "nativeQualityScore": 0.95,
        },
        {
            "pdfPageNumber": 103,
            "printedPage": "97",
            "pageTitle": "课外古诗词诵读",
            "sectionPath": ["第三单元", "课外古诗词诵读"],
            "nativeText": "����",
            "nativeQualityScore": 0.1,
            "ocrText": "朗读处理建议 注意节奏和重音",
            "ocrQualityScore": 0.91,
            "ocrProvider": "fixture-recognizer",
            "ocrModel": "fixture-v1",
        },
    ]


def register_and_build(client: TestClient, document_id: str = "doc_textbook") -> tuple[dict, dict]:
    registered = client.post("/internal/v1/indexes", json=register_payload(document_id))
    assert registered.status_code == 202, registered.text

    built = client.post(
        "/internal/v1/indexes",
        json={
            "operation": "build",
            "documentId": document_id,
            "pages": pages_payload(),
        },
    )
    assert built.status_code == 202, built.text
    return registered.json(), built.json()


def test_list_indexes_returns_document_catalog(tmp_path):
    client = make_client(tmp_path)
    register_and_build(client)

    response = client.get("/internal/v1/indexes")
    assert response.status_code == 200
    assert response.json()["adapter"] == "fixture"
    assert response.json()["documents"][0]["id"] == "doc_textbook"
    assert response.json()["documents"][0]["pageCount"] == 168


def test_register_build_get_document_and_job_preserve_registered_metadata(tmp_path):
    client = make_client(tmp_path)

    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json()["adapter"] == "fixture"

    registered, built = register_and_build(client)
    assert registered["status"] == "pending"
    assert registered["document"]["id"] == "doc_textbook"
    assert built["documentId"] == "doc_textbook"

    job = client.get(f"/internal/v1/jobs/{built['jobId']}")
    assert job.status_code == 200
    job_data = job.json()
    expected_job = {
        "documentId": "doc_textbook",
        "operation": "build",
        "status": "ready",
        "totalPages": 2,
        "processedPages": 2,
        "warningPages": 0,
        "failedPages": 0,
    }
    assert {key: job_data[key] for key in expected_job} == expected_job

    response = client.get("/internal/v1/indexes/doc_textbook")
    assert response.status_code == 200
    document = response.json()["document"]
    assert document["title"] == "九年级语文上册"
    assert document["documentType"] == "textbook"
    assert document["extractionPolicy"] == "auto"
    assert document["originalFilename"] == "九年级语文上册.pdf"
    assert document["originalObjectKey"] == "materials/doc_textbook.pdf"
    assert document["mimeType"] == "application/pdf"
    assert document["byteSize"] == 123456
    assert document["sha256"] == "a" * 64
    assert document["pageCount"] == 168
    assert document["pdfUrl"] == "/materials/doc_textbook.pdf"
    assert document["metadata"] == {"edition": "2026"}
    assert response.json()["status"] == "ready"


def test_get_patch_and_rerun_page_preserve_physical_page_and_viewer(tmp_path):
    client = make_client(tmp_path)
    register_and_build(client)

    before = client.get("/internal/v1/indexes/doc_textbook/pages/103")
    assert before.status_code == 200
    assert before.json()["page"]["pdfPageNumber"] == 103
    assert before.json()["page"]["textSource"] == "ocr"
    assert before.json()["viewer"] == {
        "pdfUrl": "/materials/doc_textbook.pdf#page=103",
        "page": 103,
    }

    patched = client.patch(
        "/internal/v1/indexes/doc_textbook/pages/103",
        json={
            "printedPageLabel": "九七",
            "title": "教师校正标题",
            "sectionPath": ["第三单元", "人工校正"],
            "retrievalText": "教师校正后的朗读建议 保留物理页码",
            "includeInIndex": True,
        },
    )
    assert patched.status_code == 200, patched.text
    page = patched.json()["page"]
    assert page["pdfPageNumber"] == 103
    assert page["printedPage"] == "九七"
    assert page["pageTitle"] == "教师校正标题"
    assert page["sectionPath"] == ["第三单元", "人工校正"]
    assert page["retrievalText"] == "教师校正后的朗读建议 保留物理页码"
    assert page["qualityStatus"] == "review"
    assert "teacher_edited_text" in page["qualityFlags"]
    assert patched.json()["viewer"]["page"] == 103

    rerun = client.post(
        "/internal/v1/indexes/doc_textbook/refresh",
        json={"pages": [103]},
    )
    assert rerun.status_code == 202
    assert rerun.json()["status"] == "ready"

    after = client.get("/internal/v1/indexes/doc_textbook/pages/103").json()
    assert after["page"]["pdfPageNumber"] == 103
    assert after["page"]["retrievalText"] == "教师校正后的朗读建议 保留物理页码"
    assert after["viewer"]["page"] == 103


def test_validation_post_get_round_trip_uses_physical_pages(tmp_path):
    client = make_client(tmp_path)
    register_and_build(client)

    created = client.post(
        "/internal/v1/indexes/doc_textbook/validate",
        json={"questions": ["朗读处理建议来自哪里"]},
    )
    assert created.status_code == 202, created.text
    report = created.json()
    assert report["documentId"] == "doc_textbook"
    assert report["status"] == "ready"
    assert report["totalPages"] == 2
    assert report["indexedPages"] == 2
    assert {check["id"] for check in report["checks"]} >= {
        "pages_locatable",
        "retrievable_pages",
        "viewer_mapping",
        "tree_range",
    }
    assert report["questions"][0]["passed"] is True
    assert report["questions"][0]["hits"][0]["pdfPage"] == 103

    fetched = client.get("/internal/v1/indexes/doc_textbook/validation")
    assert fetched.status_code == 200
    assert fetched.json() == report


def test_retrieve_accepts_canonical_and_alias_fields_and_preserves_viewer_page(tmp_path):
    client = make_client(tmp_path)
    register_and_build(client)

    canonical = client.post(
        "/internal/v1/retrieve",
        json={"query": "朗读节奏", "documentIds": ["doc_textbook"], "topK": 1},
    )
    assert canonical.status_code == 200
    canonical_result = canonical.json()["results"][0]
    assert canonical_result["documentId"] == "doc_textbook"
    assert canonical_result["pdfPage"] == 103
    assert canonical_result["printedPage"] == "97"
    assert canonical_result["textSource"] == "ocr"
    assert canonical_result["viewer"] == {
        "pdfUrl": "/materials/doc_textbook.pdf#page=103",
        "page": 103,
    }

    aliases = client.post(
        "/internal/v1/retrieve",
        json={"query": "朗读节奏", "scope": ["doc_textbook"], "limit": 1},
    )
    assert aliases.status_code == 200
    assert aliases.json() == canonical.json()

    excluded_scope = client.post(
        "/internal/v1/retrieve",
        json={"query": "朗读节奏", "scope": ["another_document"], "limit": 1},
    )
    assert excluded_scope.status_code == 200
    assert excluded_scope.json()["results"] == []


def test_failed_refresh_preserves_previous_valid_page_and_attempt_metadata(tmp_path):
    client = make_client(tmp_path)
    register_and_build(client)

    valid_refresh = client.post(
        "/internal/v1/indexes/doc_textbook/refresh",
        json={
            "pages": [
                {
                    "pdfPageNumber": 103,
                    "printedPage": "97",
                    "pageTitle": "课外古诗词诵读",
                    "sectionPath": ["第三单元", "课外古诗词诵读"],
                    "text": "朗读处理建议 先把握情感再确定节奏",
                    "textSource": "ocr",
                    "qualityScore": 0.97,
                    "ocrText": "朗读处理建议 先把握情感再确定节奏",
                    "ocrProvider": "gateway-recognizer",
                    "ocrModel": "recognizer-v2",
                }
            ]
        },
    )
    assert valid_refresh.status_code == 202
    assert valid_refresh.json()["status"] == "ready"

    failed_refresh = client.post(
        "/internal/v1/indexes/doc_textbook/refresh",
        json={
            "pages": [
                {
                    "pdfPageNumber": 103,
                    "printedPage": "错误页码不应覆盖",
                    "pageTitle": "失败结果不应覆盖",
                    "sectionPath": ["错误章节"],
                }
            ]
        },
    )
    assert failed_refresh.status_code == 202
    assert failed_refresh.json()["status"] == "partial"

    job = client.get(f"/internal/v1/jobs/{failed_refresh.json()['jobId']}").json()
    assert job["warningPages"] == 1
    assert job["failedPages"] == 0

    page_response = client.get("/internal/v1/indexes/doc_textbook/pages/103")
    assert page_response.status_code == 200
    page = page_response.json()["page"]
    assert page["pdfPageNumber"] == 103
    assert page["printedPage"] == "97"
    assert page["pageTitle"] == "课外古诗词诵读"
    assert page["sectionPath"] == ["第三单元", "课外古诗词诵读"]
    assert page["retrievalText"] == "朗读处理建议 先把握情感再确定节奏"
    assert page["textSource"] == "ocr"
    assert page["ocrProvider"] == "gateway-recognizer"
    assert page["ocrModel"] == "recognizer-v2"
    assert page_response.json()["viewer"]["page"] == 103

    retrieved = client.post(
        "/internal/v1/retrieve",
        json={"query": "把握情感", "documentIds": ["doc_textbook"], "topK": 5},
    )
    assert retrieved.status_code == 200
    assert retrieved.json()["results"][0]["pdfPage"] == 103
    assert retrieved.json()["results"][0]["text"] == "朗读处理建议 先把握情感再确定节奏"


def test_duplicate_physical_page_is_rejected_for_register_and_build(tmp_path):
    client = make_client(tmp_path)
    duplicate_pages = pages_payload()
    duplicate_pages[1]["pdfPageNumber"] = 57

    register = register_payload()
    register["pages"] = duplicate_pages
    register_response = client.post("/internal/v1/indexes", json=register)
    assert register_response.status_code == 422
    assert "pdfPageNumber must be unique" in register_response.text

    build_response = client.post(
        "/internal/v1/indexes",
        json={
            "operation": "build",
            "documentId": "doc_textbook",
            "pages": duplicate_pages,
        },
    )
    assert build_response.status_code == 422
    assert "pdfPageNumber must be unique" in build_response.text


def test_delete_removes_document_index_validation_and_retrieval(tmp_path):
    client = make_client(tmp_path)
    register_and_build(client)
    validation = client.post(
        "/internal/v1/indexes/doc_textbook/validate",
        json={"questions": ["朗读节奏"]},
    )
    assert validation.status_code == 202

    deleted = client.delete("/internal/v1/indexes/doc_textbook")
    assert deleted.status_code == 204
    assert deleted.content == b""

    assert client.get("/internal/v1/indexes/doc_textbook").status_code == 404
    assert client.get("/internal/v1/indexes/doc_textbook/tree").status_code == 404
    assert client.get("/internal/v1/indexes/doc_textbook/pages/103").status_code == 404
    assert client.get("/internal/v1/indexes/doc_textbook/validation").status_code == 404
    assert client.delete("/internal/v1/indexes/doc_textbook").status_code == 404

    retrieve = client.post(
        "/internal/v1/retrieve",
        json={"query": "朗读节奏", "documentIds": ["doc_textbook"], "topK": 5},
    )
    assert retrieve.status_code == 200
    assert retrieve.json()["results"] == []


def test_missing_resources_return_404(tmp_path):
    client = make_client(tmp_path)
    assert client.get("/internal/v1/jobs/missing").status_code == 404
    assert client.get("/internal/v1/indexes/missing").status_code == 404
    assert client.get("/internal/v1/indexes/missing/tree").status_code == 404
    assert client.get("/internal/v1/indexes/missing/pages/1").status_code == 404
    assert client.patch("/internal/v1/indexes/missing/pages/1", json={"title": "x"}).status_code == 404
    assert client.post("/internal/v1/indexes/missing/refresh", json={"pages": []}).status_code == 404
    assert client.post("/internal/v1/indexes/missing/validate", json={"questions": []}).status_code == 404
    assert client.get("/internal/v1/indexes/missing/validation").status_code == 404
