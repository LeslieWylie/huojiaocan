from __future__ import annotations

import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import create_app


class ServiceAuthenticationTests(unittest.TestCase):
    def test_known_production_runtime_refuses_to_start_without_key(self) -> None:
        with tempfile.TemporaryDirectory() as root, patch.dict(
            os.environ,
            {"VERCEL": "1", "PAGEINDEX_SERVICE_API_KEY": ""},
            clear=False,
        ):
            with self.assertRaisesRegex(RuntimeError, "PAGEINDEX_SERVICE_API_KEY"):
                create_app(root)

        with tempfile.TemporaryDirectory() as root, patch.dict(
            os.environ,
            {"VERCEL": "", "K_SERVICE": "pageindex-service", "PAGEINDEX_SERVICE_API_KEY": ""},
            clear=False,
        ):
            with self.assertRaisesRegex(RuntimeError, "PAGEINDEX_SERVICE_API_KEY"):
                create_app(root)

    def test_configured_service_protects_internal_routes_but_keeps_health_public(self) -> None:
        with tempfile.TemporaryDirectory() as root, patch.dict(
            os.environ,
            {"PAGEINDEX_SERVICE_API_KEY": "service-secret", "VERCEL": ""},
            clear=False,
        ):
            client = TestClient(create_app(root))
            self.assertEqual(client.get("/healthz").status_code, 200)
            self.assertEqual(client.get("/internal/v1/indexes").status_code, 401)
            response = client.get(
                "/internal/v1/indexes",
                headers={"Authorization": "Bearer service-secret"},
            )
            self.assertEqual(response.status_code, 200)

    def test_remote_request_fails_closed_when_key_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as root, patch.dict(
            os.environ,
            {
                "PAGEINDEX_SERVICE_API_KEY": "",
                "PAGEINDEX_ALLOW_INSECURE_LOCAL": "true",
                "VERCEL": "",
                "K_SERVICE": "",
            },
            clear=False,
        ):
            client = TestClient(create_app(root))
            response = client.get(
                "/internal/v1/indexes",
                headers={"X-Forwarded-For": "203.0.113.10"},
            )
            self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
