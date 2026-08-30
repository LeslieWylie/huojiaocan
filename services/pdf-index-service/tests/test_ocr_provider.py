from app.ocr_provider import OCRResult, _normalise_paddle_result, decode_image_base64


def test_normalise_paddleocr_v3_result_preserves_text_confidence_and_boxes():
    blocks, text = _normalise_paddle_result({
        "rec_texts": ["第一行", "第二行"],
        "rec_scores": [0.98, 0.86],
        "rec_boxes": [[1, 2, 30, 40], [2, 42, 31, 80]],
    })
    assert text == "第一行\n第二行"
    assert blocks[0] == {"text": "第一行", "confidence": 0.98, "box": [1, 2, 30, 40]}
    assert blocks[1]["confidence"] == 0.86


def test_normalise_legacy_paddleocr_result():
    blocks, text = _normalise_paddle_result([
        [[[0, 0], [10, 0], [10, 10], [0, 10]], ["教材文字", 0.91]],
    ])
    assert text == "教材文字"
    assert blocks[0]["confidence"] == 0.91


def test_data_url_is_decoded_without_remote_fetch():
    assert decode_image_base64("data:image/png;base64,SGVsbG8=") == b"Hello"
