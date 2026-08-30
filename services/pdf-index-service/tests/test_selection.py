from app.models import ExtractionPolicy, PageInput, QualityStatus, TextSource
from app.selection import select_page_text


def test_auto_prefers_reliable_native_text():
    page = PageInput(
        pdfPageNumber=57,
        nativeText="可靠的原生文本",
        nativeQualityScore=0.91,
        ocrText="识别文本",
        ocrQualityScore=0.99,
    )
    selected = select_page_text(page, ExtractionPolicy.auto)
    assert selected.pdf_page_number == 57
    assert selected.text_source == TextSource.native
    assert selected.retrieval_text == "可靠的原生文本"
    assert selected.quality_status == QualityStatus.normal


def test_auto_uses_recognition_for_bad_native_text():
    page = PageInput(
        pdfPageNumber=103,
        nativeText="����",
        nativeQualityScore=0.1,
        ocrText="扫描页识别后的可检索文本",
        ocrQualityScore=0.88,
    )
    selected = select_page_text(page, ExtractionPolicy.auto)
    assert selected.pdf_page_number == 103
    assert selected.text_source == TextSource.ocr
    assert selected.retrieval_text == "扫描页识别后的可检索文本"
    assert "native_text_missing_or_low_quality" in selected.quality_flags


def test_no_text_is_failed_and_not_renumbered():
    selected = select_page_text(PageInput(pdfPageNumber=612), ExtractionPolicy.auto)
    assert selected.pdf_page_number == 612
    assert selected.text_source == TextSource.none
    assert selected.quality_status == QualityStatus.failed


def test_explicit_ocr_without_page_image_is_failed_and_is_not_claimed_as_ocr():
    selected = select_page_text(
        PageInput(pdfPageNumber=5, nativeText="", ocrProvider="paddleocr", ocrError="ocr_input_missing"),
        ExtractionPolicy.ocr,
    )
    assert selected.quality_status == QualityStatus.failed
    assert selected.text_source == TextSource.none
    assert "ocr_input_missing" in selected.quality_flags


def test_ocr_metadata_is_preserved_for_page_audit():
    selected = select_page_text(
        PageInput(
            pdfPageNumber=57,
            nativeText="乱码",
            nativeQualityScore=0.1,
            ocrText="识别后的教材文字",
            ocrQualityScore=0.94,
            ocrConfidence=0.94,
            ocrProvider="paddleocr",
            ocrModel="PP-OCRv6",
            ocrBlocks=[{"text": "识别后的教材文字", "confidence": 0.94}],
        ),
        ExtractionPolicy.auto,
    )
    assert selected.text_source == TextSource.ocr
    assert selected.ocr_provider == "paddleocr"
    assert selected.ocr_model == "PP-OCRv6"
    assert selected.ocr_confidence == 0.94
    assert selected.ocr_blocks[0]["confidence"] == 0.94
