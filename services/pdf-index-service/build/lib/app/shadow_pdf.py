from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class ShadowPdf:
    path: Path
    shadow_to_physical: dict[int, int]


_FONT_CANDIDATES = (
    # Explicit deployment override always wins.
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font7/eb257c12d1a51c8c661b89f30eec56cacf9b8987.asset/AssetData/STHEITI.ttf",
)


def _shadow_font_path() -> Path:
    configured = os.getenv("PAGEINDEX_SHADOW_FONT_FILE", "").strip()
    candidates = (configured, *_FONT_CANDIDATES) if configured else _FONT_CANDIDATES
    for candidate in candidates:
        path = Path(candidate)
        if path.is_file():
            return path
    raise RuntimeError(
        "No PageIndex shadow PDF CJK font is available; set PAGEINDEX_SHADOW_FONT_FILE "
        "to a readable TrueType font or install fonts-wqy-zenhei"
    )


def _wrap_text(text: str, width: int = 100) -> list[str]:
    """Deterministically wrap text without changing its searchable character order."""
    lines: list[str] = []
    for logical_line in text.splitlines() or [""]:
        if not logical_line:
            lines.append("")
            continue
        lines.extend(logical_line[index : index + width] for index in range(0, len(logical_line), width))
    return lines


def create_shadow_pdf(payload: dict[str, Any], output_path: str | Path) -> ShadowPdf:
    """Create one PyPDF2-searchable shadow page per eligible physical PDF page."""
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.pdfgen.canvas import Canvas
    except ImportError as error:
        raise RuntimeError("ReportLab is required to create the PageIndex shadow PDF") from error

    pages = payload.get("pages")
    if not isinstance(pages, list) or not pages:
        raise RuntimeError("PageIndex cannot build an index without eligible page text")

    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    mapping: dict[int, int] = {}
    font_name = "HuojiaocanShadowCJK"
    try:
        pdfmetrics.getFont(font_name)
    except KeyError:
        try:
            pdfmetrics.registerFont(TTFont(font_name, str(_shadow_font_path()), subfontIndex=0))
        except Exception as error:
            raise RuntimeError("Configured PageIndex shadow PDF font cannot be loaded") from error

    canvas = Canvas(str(destination), pagesize=(1000.0, 842.0), pageCompression=1)
    try:
        for shadow_number, page in enumerate(pages, start=1):
            physical = page.get("pdfPageNumber")
            text = page.get("text")
            if not isinstance(physical, int) or physical < 1:
                raise RuntimeError("Shadow PDF input contains an invalid physical page number")
            if physical in mapping.values():
                raise RuntimeError("Shadow PDF input contains a duplicate physical page number")
            if not isinstance(text, str) or not text.strip():
                raise RuntimeError(f"Physical page {physical} has no eligible retrieval text")

            body = f"<physical_index_{shadow_number}>\n<real_pdf_page_{physical}>\n{text.strip()}"
            lines = _wrap_text(body)
            page_height = max(842.0, 84.0 + len(lines) * 10.0)
            if page_height > 14_000:
                raise RuntimeError(
                    f"Physical page {physical} retrieval text is too large for one shadow page"
                )
            canvas.setPageSize((1000.0, page_height))
            text_object = canvas.beginText(36.0, page_height - 42.0)
            text_object.setFont(font_name, 7.0)
            text_object.setLeading(10.0)
            for line in lines:
                text_object.textLine(line)
            canvas.drawText(text_object)
            canvas.showPage()
            mapping[shadow_number] = physical
    finally:
        canvas.save()

    if not destination.exists() or destination.stat().st_size == 0:
        raise RuntimeError("Shadow PDF creation produced an empty file")
    return ShadowPdf(path=destination, shadow_to_physical=mapping)
