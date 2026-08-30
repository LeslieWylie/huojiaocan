from __future__ import annotations

import json
import selectors
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


SERVICE_ROOT = Path(__file__).resolve().parents[1]
MOCK_GATEWAY_SCRIPT = SERVICE_ROOT / "scripts" / "mock_gateway.py"
MOCK_API_KEY = "test-key"
MOCK_MODEL = "test-model"


def _read_startup_line(process: subprocess.Popen[str], timeout: float = 5.0) -> dict[str, Any]:
    assert process.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    try:
        if not selector.select(timeout):
            stderr = process.stderr.read(2000) if process.stderr is not None else ""
            raise AssertionError(f"mock gateway did not announce readiness: {stderr}")
        line = process.stdout.readline()
    finally:
        selector.close()

    startup = json.loads(line)
    assert startup["host"] == "127.0.0.1"
    assert isinstance(startup["port"], int) and startup["port"] > 0
    assert startup["base_url"] == f"http://127.0.0.1:{startup['port']}"
    return startup


def _request_json(
    base_url: str,
    method: str,
    path: str,
    *,
    payload: object | None = None,
    api_key: str | None = MOCK_API_KEY,
    raw_body: bytes | None = None,
) -> tuple[int, dict[str, Any]]:
    headers: dict[str, str] = {}
    if api_key is not None:
        headers["Authorization"] = f"Bearer {api_key}"
    if raw_body is not None:
        body = raw_body
        headers["Content-Type"] = "application/json"
    elif payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    else:
        body = None

    request = Request(f"{base_url}{path}", data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=3) as response:
            return int(response.status), json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        return int(error.code), json.loads(error.read().decode("utf-8"))


@pytest.fixture
def gateway_process() -> Any:
    process = subprocess.Popen(
        [sys.executable, str(MOCK_GATEWAY_SCRIPT), "--port", "0"],
        cwd=SERVICE_ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    try:
        startup = _read_startup_line(process)
        yield process, startup["base_url"]
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            _stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            _stdout, stderr = process.communicate(timeout=5)
        assert "test-key" not in stderr


def test_gateway_binds_loopback_and_lists_synthetic_model(gateway_process: Any) -> None:
    _process, base_url = gateway_process
    assert base_url.startswith("http://127.0.0.1:")

    status, payload = _request_json(base_url, "GET", "/v1/models")

    assert status == 200
    assert payload["object"] == "list"
    assert payload["data"][0]["id"] == MOCK_MODEL
    assert "test-key" not in json.dumps(payload)


def test_models_reject_missing_or_wrong_authentication(gateway_process: Any) -> None:
    _process, base_url = gateway_process

    missing_status, missing_payload = _request_json(base_url, "GET", "/v1/models", api_key=None)
    wrong_status, wrong_payload = _request_json(base_url, "GET", "/v1/models", api_key="wrong-test-key")

    assert missing_status == wrong_status == 401
    assert missing_payload["error"]["code"] == "invalid_api_key"
    assert wrong_payload["error"]["code"] == "invalid_api_key"
    assert "wrong-test-key" not in json.dumps(wrong_payload)


def test_chat_completion_validates_model_and_messages(gateway_process: Any) -> None:
    _process, base_url = gateway_process
    request_payload = {
        "model": MOCK_MODEL,
        "messages": [
            {"role": "system", "content": "system fixture"},
            {"role": "user", "content": "user fixture"},
        ],
    }

    status, payload = _request_json(base_url, "POST", "/v1/chat/completions", payload=request_payload)

    assert status == 200
    assert payload["object"] == "chat.completion"
    assert payload["model"] == MOCK_MODEL
    assert payload["choices"][0]["message"] == {"role": "assistant", "content": "MOCK_GATEWAY_OK"}
    assert payload["x_mock"] == {"validated_model": MOCK_MODEL, "message_count": 2}
    assert "user fixture" not in json.dumps(payload)
    assert MOCK_API_KEY not in json.dumps(payload)


@pytest.mark.parametrize(
    ("payload", "expected_code"),
    [
        ({"messages": [{"role": "user", "content": "fixture"}]}, "invalid_model"),
        ({"model": MOCK_MODEL}, "invalid_messages"),
        ({"model": MOCK_MODEL, "messages": "not-an-array"}, "invalid_messages"),
    ],
)
def test_chat_completion_rejects_invalid_request_shape(
    gateway_process: Any,
    payload: dict[str, Any],
    expected_code: str,
) -> None:
    _process, base_url = gateway_process

    status, response = _request_json(base_url, "POST", "/v1/chat/completions", payload=payload)

    assert status == 400
    assert response["error"]["code"] == expected_code


def test_chat_completion_rejects_invalid_json_and_unknown_route(gateway_process: Any) -> None:
    _process, base_url = gateway_process

    invalid_status, invalid_payload = _request_json(
        base_url,
        "POST",
        "/v1/chat/completions",
        raw_body=b"not-json",
    )
    missing_route_status, missing_route_payload = _request_json(
        base_url,
        "GET",
        "/v1/not-supported",
    )

    assert invalid_status == 400
    assert invalid_payload["error"]["code"] == "invalid_json"
    assert missing_route_status == 404
    assert missing_route_payload["error"]["code"] == "not_found"
