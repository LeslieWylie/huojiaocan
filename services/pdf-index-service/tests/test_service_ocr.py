from app.models import CreateIndexRequest
from app.ocr_provider import OCRResult
from app.pageindex_adapter import FixturePageIndexAdapter
from app.repository import FileRepository
from app.service import IndexService


class FakePaddleOCR:
    name = "paddleocr"

    def recognize(self, image_bytes: bytes, *, mime_type: str = "image/png") -> OCRResult:
        assert image_bytes == b"image"
        assert mime_type == "image/png"
        return OCRResult(
            text="扫描页中的教材文字",
            confidence=0.96,
            provider="paddleocr",
            model="PP-OCRv6",
            blocks=[{"text": "扫描页中的教材文字", "confidence": 0.96}],
        )


def test_ocr_policy_runs_provider_and_persists_auditable_metadata(tmp_path):
    service = IndexService(FileRepository(tmp_path), FixturePageIndexAdapter(), ocr_provider=FakePaddleOCR())
    job = service.create_index(
        CreateIndexRequest(
            documentId="scan-doc",
            documentTitle="扫描教材",
            documentType="textbook",
            extractionPolicy="ocr",
            pages=[{
                "pdfPageNumber": 5,
                "nativeText": "",
                "imageBase64": "aW1hZ2U=",
                "imageMimeType": "image/png",
            }],
        )
    )
    assert job.status == "ready"
    page = service.repository.get_index("scan-doc").pages[0]
    assert page.pdf_page_number == 5
    assert page.text_source.value == "ocr"
    assert page.ocr_provider == "paddleocr"
    assert page.ocr_model == "PP-OCRv6"
    assert page.ocr_confidence == 0.96
    assert page.retrieval_text == "扫描页中的教材文字"
