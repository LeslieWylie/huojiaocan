from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

_SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_-]{8,}"),
    re.compile(r"(?i)(api[_ -]?key\s*[=:]\s*)[^\s,;]+"),
    re.compile(r"(?i)(authorization\s*[=:]\s*bearer\s+)[^\s,;]+"),
)


@dataclass(frozen=True, slots=True)
class LLMConfig:
    base_url: str
    api_key: str
    model: str
    timeout_seconds: float = 120.0

    @property
    def pageindex_model(self) -> str:
        model = self.model.removeprefix("litellm/").removeprefix("openai/")
        return f"openai/{model}"

    @property
    def gateway_host(self) -> str:
        return urlparse(self.base_url).netloc

    def public_summary(self) -> dict[str, str | float]:
        return {
            "gatewayHost": self.gateway_host,
            "model": self.model,
            "timeoutSeconds": self.timeout_seconds,
        }


def _first_env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip():
            return value.strip()
    return None


def normalize_base_url(value: str) -> str:
    normalized = value.strip().rstrip("/")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError("LLM Gateway URL must use http:// or https:// and include a host")
    if parsed.username or parsed.password:
        raise RuntimeError("LLM Gateway URL must not contain credentials")
    return normalized


def normalize_model(value: str) -> str:
    model = value.strip().removeprefix("litellm/").removeprefix("openai/")
    if not model or any(char.isspace() for char in model):
        raise RuntimeError("LLM Gateway model is missing or invalid")
    return model


def load_llm_config(*, require_api_key: bool = True) -> LLMConfig:
    base_url = _first_env("LLM_GATEWAY_BASE_URL", "PAGEINDEX_LLM_BASE_URL")
    model = _first_env("LLM_GATEWAY_MODEL", "PAGEINDEX_LLM_MODEL")
    api_key = _first_env("LLM_GATEWAY_API_KEY", "PAGEINDEX_LLM_API_KEY") or ""
    timeout_raw = _first_env("LLM_GATEWAY_TIMEOUT_SECONDS", "PAGEINDEX_LLM_TIMEOUT_SECONDS") or "120"

    if not base_url:
        raise RuntimeError("LLM Gateway URL is not configured")
    if not model:
        raise RuntimeError("LLM Gateway model is not configured")
    if require_api_key and not api_key:
        raise RuntimeError("LLM Gateway API key is not configured")
    try:
        timeout = float(timeout_raw)
    except ValueError as error:
        raise RuntimeError("LLM Gateway timeout must be a number") from error
    if timeout <= 0 or timeout > 1800:
        raise RuntimeError("LLM Gateway timeout must be between 0 and 1800 seconds")

    return LLMConfig(
        base_url=normalize_base_url(base_url),
        api_key=api_key,
        model=normalize_model(model),
        timeout_seconds=timeout,
    )


def redact_secret(value: str, secret: str | None = None) -> str:
    redacted = value
    if secret:
        redacted = redacted.replace(secret, "[REDACTED]")
    for pattern in _SECRET_PATTERNS:
        if pattern.groups:
            redacted = pattern.sub(r"\1[REDACTED]", redacted)
        else:
            redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def safe_error_message(error: BaseException, secret: str | None = None) -> str:
    return redact_secret(str(error), secret=secret)[:1000]
