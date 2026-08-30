from __future__ import annotations

import re

from .models import ExtractionPolicy, PageInput, QualityStatus, SelectedPage, TextSource

_NATIVE_ACCEPT_THRESHOLD = 0.65
_NORMAL_THRESHOLD = 0.75


def _clean(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[ \t]+", " ", value.replace("\r\n", "\n").replace("\r", "\n")).strip()


def _candidate(text: str | None, score: float | None) -> tuple[str, float]:
    cleaned = _clean(text)
    if not cleaned:
        return "", 0.0
    return cleaned, score if score is not None else 0.5


def select_page_text(page: PageInput, policy: ExtractionPolicy) -> SelectedPage:
    flags: list[str] = []
    source = TextSource.none
    text = ""
    score = 0.0

    if not page.include_in_index:
        flags.append("excluded_from_index")
    elif page.text and page.text_source:
        text, score = _candidate(page.text, page.quality_score)
        source = page.text_source
        flags.append("preselected_upstream")
    else:
        native = _candidate(page.native_text, page.native_quality_score)
        ocr = _candidate(page.ocr_text, page.ocr_quality_score)
        if page.ocr_error:
            flags.append(page.ocr_error)

        if policy == ExtractionPolicy.native:
            text, score = native
            source = TextSource.native if text else TextSource.none
            if not text:
                flags.append("native_text_missing")
        elif policy == ExtractionPolicy.ocr:
            text, score = ocr
            source = TextSource.ocr if text else TextSource.none
            if not text:
                flags.append("page_recognition_text_missing")
        elif native[0] and native[1] >= _NATIVE_ACCEPT_THRESHOLD:
            text, score, source = native[0], native[1], TextSource.native
        elif ocr[0]:
            text, score, source = ocr[0], ocr[1], TextSource.ocr
            flags.append("native_text_missing_or_low_quality")
        elif native[0]:
            text, score, source = native[0], native[1], TextSource.native
            flags.append("native_text_low_quality_no_recognition_fallback")
        else:
            flags.append("no_retrieval_text")

    if not page.include_in_index or not text:
        status = QualityStatus.failed
        source = TextSource.none
        text = ""
        score = 0.0
    elif score >= _NORMAL_THRESHOLD:
        status = QualityStatus.normal
    else:
        status = QualityStatus.review
        flags.append("low_text_quality")

    return SelectedPage(
        pdfPageNumber=page.pdf_page_number,
        printedPage=page.printed_page,
        pageTitle=page.page_title,
        sectionPath=page.section_path,
        includeInIndex=page.include_in_index,
        retrievalText=text,
        textSource=source,
        qualityScore=round(score, 4),
        qualityStatus=status,
        qualityFlags=list(dict.fromkeys(flags)),
        nativeText=_clean(page.native_text) or None,
        ocrText=_clean(page.ocr_text) or None,
        ocrProvider=page.ocr_provider,
        ocrModel=page.ocr_model,
        ocrConfidence=page.ocr_confidence,
        ocrBlocks=page.ocr_blocks,
        ocrError=page.ocr_error,
    )
