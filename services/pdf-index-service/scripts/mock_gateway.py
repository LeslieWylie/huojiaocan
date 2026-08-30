"""Local-only OpenAI-compatible mock gateway for isolated smoke tests.

This module intentionally contains no external network client and binds only to
127.0.0.1.  It is suitable for short-lived local tests, not for deployment.
"""

from __future__ import annotations

import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = "127.0.0.1"
MOCK_API_KEY = "test-key"
MOCK_MODEL = "test-model"
MAX_BODY_BYTES = 1 * 1024 * 1024


class _MockGatewayHandler(BaseHTTPRequestHandler):
    """HTTP handler with a deliberately small, deterministic API surface."""

    server_version = "LocalMockGateway/1.0"
    sys_version = ""

    @property
    def gateway(self) -> "MockGateway":
        return self.server.gateway  # type: ignore[attr-defined]

    def log_message(self, _format: str, *_args: object) -> None:
        # Do not log request headers, bodies, or credentials.  The mock is quiet
        # by default so a test transcript cannot accidentally expose them.
        return

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str, error_type: str, code: str) -> None:
        self._send_json(
            status,
            {
                "error": {
                    "message": message,
                    "type": error_type,
                    "param": None,
                    "code": code,
                }
            },
        )

    def _authorized(self) -> bool:
        return self.headers.get("Authorization") == f"Bearer {MOCK_API_KEY}"

    def _read_json(self) -> dict[str, Any] | None:
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "0")
        except ValueError:
            self._error(400, "Content-Length must be an integer", "invalid_request_error", "invalid_content_length")
            return None

        if length < 0:
            self._error(400, "Content-Length must not be negative", "invalid_request_error", "invalid_content_length")
            return None
        if length > MAX_BODY_BYTES:
            self._error(413, "Request body is too large", "invalid_request_error", "request_too_large")
            return None

        try:
            raw_body = self.rfile.read(length)
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._error(400, "Request body must be valid JSON", "invalid_request_error", "invalid_json")
            return None

        if not isinstance(payload, dict):
            self._error(400, "Request body must be a JSON object", "invalid_request_error", "invalid_body")
            return None
        return payload

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        self.gateway.record_request()

        if self.path == "/healthz":
            self._send_json(200, {"status": "ok"})
            return

        if self.path == "/v1/models":
            if not self._authorized():
                self._error(401, "Authentication required", "authentication_error", "invalid_api_key")
                return
            self._send_json(
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": MOCK_MODEL,
                            "object": "model",
                            "created": 0,
                            "owned_by": "local-mock",
                        }
                    ],
                },
            )
            return

        self._error(404, "Route not found", "invalid_request_error", "not_found")

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        self.gateway.record_request()

        if self.path != "/v1/chat/completions":
            self._error(404, "Route not found", "invalid_request_error", "not_found")
            return

        if not self._authorized():
            self._error(401, "Authentication required", "authentication_error", "invalid_api_key")
            return

        payload = self._read_json()
        if payload is None:
            return

        model = payload.get("model")
        if model != MOCK_MODEL:
            self._error(
                400,
                f"model must be {MOCK_MODEL}",
                "invalid_request_error",
                "invalid_model",
            )
            return

        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            self._error(
                400,
                "messages must be a non-empty array",
                "invalid_request_error",
                "invalid_messages",
            )
            return

        for message in messages:
            if not isinstance(message, dict):
                self._error(
                    400,
                    "each message must be an object",
                    "invalid_request_error",
                    "invalid_messages",
                )
                return
            if message.get("role") not in {"system", "user", "assistant", "tool"}:
                self._error(
                    400,
                    "each message role is invalid",
                    "invalid_request_error",
                    "invalid_messages",
                )
                return
            if not isinstance(message.get("content"), str):
                self._error(
                    400,
                    "each message content must be a string",
                    "invalid_request_error",
                    "invalid_messages",
                )
                return

        # The body is intentionally deterministic and does not echo user text or
        # authorization data.  message_count makes the request contract testable.
        self._send_json(
            200,
            {
                "id": "chatcmpl-local-mock",
                "object": "chat.completion",
                "created": 0,
                "model": MOCK_MODEL,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "MOCK_GATEWAY_OK"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 0, "completion_tokens": 1, "total_tokens": 1},
                "x_mock": {"validated_model": MOCK_MODEL, "message_count": len(messages)},
            },
        )


class _BoundMockHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class MockGateway:
    """A short-lived local mock gateway usable as a context manager."""

    def __init__(self, port: int = 0) -> None:
        if port < 0 or port > 65535:
            raise ValueError("port must be between 0 and 65535")
        self._request_count = 0
        self._request_lock = threading.Lock()
        self._server = _BoundMockHTTPServer((HOST, port), _MockGatewayHandler)
        self._server.gateway = self  # type: ignore[attr-defined]
        self._thread: threading.Thread | None = None

    @property
    def host(self) -> str:
        return HOST

    @property
    def port(self) -> int:
        return int(self._server.server_address[1])

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    @property
    def request_count(self) -> int:
        with self._request_lock:
            return self._request_count

    def record_request(self) -> None:
        with self._request_lock:
            self._request_count += 1

    def start(self) -> "MockGateway":
        if self._thread is not None and self._thread.is_alive():
            return self
        self._thread = threading.Thread(target=self._server.serve_forever, name="local-mock-gateway", daemon=True)
        self._thread.start()
        return self

    def serve_forever(self) -> None:
        self._server.serve_forever()

    def stop(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            self._server.shutdown()
            self._thread.join(timeout=5)
        self._server.server_close()
        self._thread = None

    def __enter__(self) -> "MockGateway":
        return self.start()

    def __exit__(self, _exc_type: object, _exc_value: object, _traceback: object) -> None:
        self.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a local-only OpenAI-compatible mock gateway.")
    parser.add_argument("--port", type=int, default=8765, help="TCP port; use 0 to select an ephemeral local port")
    args = parser.parse_args()

    gateway = MockGateway(port=args.port)
    print(
        json.dumps(
            {"host": gateway.host, "port": gateway.port, "base_url": gateway.base_url},
            separators=(",", ":"),
        ),
        flush=True,
    )
    try:
        gateway.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        gateway.stop()


if __name__ == "__main__":
    main()
