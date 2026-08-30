from __future__ import annotations

from pathlib import Path

import pytest
from PyPDF2 import PdfReader

from app.shadow_pdf import create_shadow_pdf


def extracted(path: Path) -> list[str]:
    return [(page.extract_text() or "") for page in PdfReader(str(path)).pages]


def test_shadow_pdf_preserves_one_page_mapping_markers_and_long_text(tmp_path: Path):
    tail = "LONG_TEXT_TAIL_987654321"
    long_text = "中文课堂内容。" * 2500 + tail
    result = create_shadow_pdf(
        {
            "pages": [
                {"pdfPageNumber": 55, "text": "第一页"},
                {"pdfPageNumber": 57, "text": long_text},
                {"pdfPageNumber": 60, "text": "第三页"},
            ]
        },
        tmp_path / "shadow.pdf",
    )
    texts = extracted(result.path)
    assert len(texts) == 3
    assert result.shadow_to_physical == {1: 55, 2: 57, 3: 60}
    assert "physical_index_1" in texts[0] and "real_pdf_page_55" in texts[0]
    assert "physical_index_2" in texts[1] and "real_pdf_page_57" in texts[1]
    assert tail in texts[1]


@pytest.mark.parametrize(
    "payload,match",
    [
        ({"pages": []}, "without eligible"),
        ({"pages": [{"pdfPageNumber": 1, "text": ""}]}, "no eligible retrieval text"),
        ({"pages": [{"pdfPageNumber": 1, "text": "a"}, {"pdfPageNumber": 1, "text": "b"}]}, "duplicate"),
    ],
)
def test_shadow_pdf_rejects_invalid_payload(tmp_path: Path, payload: dict, match: str):
    with pytest.raises(RuntimeError, match=match):
        create_shadow_pdf(payload, tmp_path / "shadow.pdf")
