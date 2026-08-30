from __future__ import annotations

"""Mature page-recognition boundary for scanned and mixed PDFs.

The PageIndex service never uses the LLM gateway as an OCR substitute. The
official PaddleOCR runtime is loaded lazily so native-text-only documents keep
the lightweight path, while an explicit OCR request fails clearly when the
OCR runtime has not been installed in this deployment.
"""

import base64
import json
import os
import tempfile
from dataclasses import dataclass, field
from typing import Any, Protocol


class OCRProviderError(RuntimeError):
    code = "ocr_failed"


class OCRProviderUnavailable(OCRProviderError):
    code = "ocr_unavailable"


class OCRProvider(Protocol):
    name: str

    def recognize(self, image_bytes: bytes, *, mime_type: str = "image/png") -> "OCRResult": ...


@dataclass(frozen=True)
class OCRResult:
    text: str
    confidence: float
    provider: str
    model: str
    blocks: list[dict[str, Any]] = field(default_factory=list)


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    tolist = getattr(value, "tolist", None)
    if callable(tolist):
        return _jsonable(tolist())
    return str(value)


def _result_dict(result: Any) -> dict[str, Any]:
    value = result
    if hasattr(value, "json"):
        value = value.json
    elif hasattr(value, "to_json"):
        value = value.to_json()
    if callable(value):
        value = value()
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {"text": value}
    value = _jsonable(value)
    if isinstance(value, dict):
        nested = value.get("res")
        return nested if isinstance(nested, dict) else value
    return {"raw": value}


def _normalise_boxes(value: Any) -> list[Any]:
    value = _jsonable(value)
    return value if isinstance(value, list) else []


def _normalise_paddle_result(result: Any) -> tuple[list[dict[str, Any]], str]:
    """Accept current PaddleOCR result objects and the legacy `.ocr()` shape."""

    raw = _result_dict(result)
    texts = raw.get("rec_texts") or raw.get("texts") or raw.get("text")
    scores = raw.get("rec_scores") or raw.get("scores") or raw.get("confidences") or []
    boxes = raw.get("rec_boxes") or raw.get("rec_polys") or raw.get("dt_polys") or raw.get("boxes") or []

    if isinstance(texts, str):
        texts = [texts]
    if not isinstance(texts, list):
        legacy = raw.get("raw", raw)
        if isinstance(legacy, list):
            if (
                len(legacy) == 1
                and isinstance(legacy[0], list)
                and not (len(legacy[0]) == 2 and isinstance(legacy[0][1], (list, tuple)))
            ):
                legacy = legacy[0]
            texts, scores, boxes = [], [], []
            for line in legacy:
                if not isinstance(line, (list, tuple)) or len(line) < 2:
                    continue
                box, payload = line[0], line[1]
                if isinstance(payload, (list, tuple)):
                    texts.append(str(payload[0]))
                    scores.append(payload[1] if len(payload) > 1 else 0.8)
                else:
                    texts.append(str(payload))
                    scores.append(0.8)
                boxes.append(box)
        else:
            texts = []

    scores = scores if isinstance(scores, list) else []
    boxes = _normalise_boxes(boxes)
    blocks: list[dict[str, Any]] = []
    for index, text in enumerate(texts):
        clean = str(text or "").strip()
        if not clean:
            continue
        score = scores[index] if index < len(scores) else 0.8
        try:
            confidence = max(0.0, min(1.0, float(score)))
        except (TypeError, ValueError):
            confidence = 0.8
        blocks.append({
            "text": clean,
            "confidence": round(confidence, 4),
            "box": boxes[index] if index < len(boxes) else None,
        })
    return blocks, "\n".join(block["text"] for block in blocks)


class PaddleOCRProvider:
    """PaddleOCR 3.x provider using the Chinese PP-OCRv6 pipeline."""

    name = "paddleocr"

    def __init__(self, *, model: str | None = None):
        self.model = model or os.getenv("PADDLEOCR_MODEL", "PP-OCRv6")
        self.language = os.getenv("PADDLEOCR_LANGUAGE", "ch")
        self._engine: Any = None

    def _load_engine(self) -> Any:
        if self._engine is not None:
            return self._engine
        try:
            from paddleocr import PaddleOCR  # type: ignore
        except ImportError as exc:
            raise OCRProviderUnavailable(
                "paddleocr_not_installed: install the pinned OCR image before enabling scanned PDF ingestion"
            ) from exc
        options = {
            "lang": self.language,
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        }
        try:
            self._engine = PaddleOCR(**options)
        except TypeError:
            self._engine = PaddleOCR(lang=self.language, use_angle_cls=True)
        return self._engine

    def recognize(self, image_bytes: bytes, *, mime_type: str = "image/png") -> OCRResult:
        if not image_bytes:
            raise OCRProviderError("ocr_image_empty")
        engine = self._load_engine()
        suffix = ".jpg" if "jpeg" in mime_type or "jpg" in mime_type else ".png"
        with tempfile.NamedTemporaryFile(prefix="huojiaocan-ocr-", suffix=suffix) as image:
            image.write(image_bytes)
            image.flush()
            try:
                output = list(engine.predict(image.name)) if hasattr(engine, "predict") else engine.ocr(image.name, cls=True)
            except Exception as exc:
                raise OCRProviderError("paddleocr_request_failed") from exc

        blocks: list[dict[str, Any]] = []
        text_parts: list[str] = []
        for item in output or []:
            item_blocks, item_text = _normalise_paddle_result(item)
            blocks.extend(item_blocks)
            if item_text:
                text_parts.append(item_text)
        text = "\n".join(part for part in text_parts if part).strip()
        if not text:
            raise OCRProviderError("paddleocr_empty_result")
        confidence = sum(float(block["confidence"]) for block in blocks) / max(1, len(blocks))
        return OCRResult(
            text=text,
            confidence=round(max(0.0, min(1.0, confidence)), 4),
            provider=self.name,
            model=self.model,
            blocks=blocks,
        )


def create_ocr_provider() -> OCRProvider | None:
    provider = os.getenv("OCR_PROVIDER", "paddleocr").strip().lower()
    if provider in {"", "none", "disabled", "off"}:
        return None
    if provider == "paddleocr":
        return PaddleOCRProvider()
    raise RuntimeError(f"Unsupported OCR_PROVIDER={provider!r}; expected 'paddleocr' or 'disabled'")


def decode_image_base64(value: str) -> bytes:
    """Decode a data URL or raw base64 image without accepting remote URLs."""
    payload = value.split(",", 1)[1] if value.startswith("data:") and "," in value else value
    try:
        return base64.b64decode(payload, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise OCRProviderError("ocr_image_base64_invalid") from exc
