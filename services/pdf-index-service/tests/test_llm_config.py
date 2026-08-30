from __future__ import annotations

import pytest

from app.llm_config import LLMConfig, load_llm_config, normalize_base_url, normalize_model, safe_error_message


def test_load_config_prefers_new_names_and_normalizes(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LLM_GATEWAY_BASE_URL", "https://gateway.example/v1/")
    monkeypatch.setenv("LLM_GATEWAY_MODEL", "openai/mlamp/deepseek-v4-flash")
    monkeypatch.setenv("LLM_GATEWAY_API_KEY", "test-secret-key")
    monkeypatch.setenv("LLM_GATEWAY_TIMEOUT_SECONDS", "45")
    config = load_llm_config()
    assert config.base_url == "https://gateway.example/v1"
    assert config.model == "mlamp/deepseek-v4-flash"
    assert config.pageindex_model == "openai/mlamp/deepseek-v4-flash"
    assert config.public_summary() == {
        "gatewayHost": "gateway.example",
        "model": "mlamp/deepseek-v4-flash",
        "timeoutSeconds": 45.0,
    }
    assert "test-secret-key" not in str(config.public_summary())


def test_load_config_supports_legacy_names(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("PAGEINDEX_LLM_BASE_URL", "https://legacy.example/v1")
    monkeypatch.setenv("PAGEINDEX_LLM_MODEL", "litellm/vendor/model")
    monkeypatch.setenv("PAGEINDEX_LLM_API_KEY", "legacy-test-key")
    config = load_llm_config()
    assert config.model == "vendor/model"
    assert config.pageindex_model == "openai/vendor/model"


@pytest.mark.parametrize("missing", ["url", "model", "key"])
def test_load_config_fails_closed(monkeypatch: pytest.MonkeyPatch, missing: str):
    monkeypatch.setenv("LLM_GATEWAY_BASE_URL", "https://gateway.example/v1")
    monkeypatch.setenv("LLM_GATEWAY_MODEL", "vendor/model")
    monkeypatch.setenv("LLM_GATEWAY_API_KEY", "test-key")
    names = {"url": "LLM_GATEWAY_BASE_URL", "model": "LLM_GATEWAY_MODEL", "key": "LLM_GATEWAY_API_KEY"}
    monkeypatch.delenv(names[missing])
    with pytest.raises(RuntimeError, match={"url": "URL", "model": "model", "key": "API key"}[missing]):
        load_llm_config()


@pytest.mark.parametrize("url", ["gateway.example", "ftp://gateway.example", "https://user:pass@gateway.example"])
def test_base_url_rejects_invalid_or_embedded_credentials(url: str):
    with pytest.raises(RuntimeError):
        normalize_base_url(url)


@pytest.mark.parametrize("model", ["", "bad model", "openai/", "litellm/"])
def test_model_rejects_invalid_values(model: str):
    with pytest.raises(RuntimeError):
        normalize_model(model)


@pytest.mark.parametrize("timeout", ["nope", "0", "-1", "1801"])
def test_timeout_rejected(monkeypatch: pytest.MonkeyPatch, timeout: str):
    monkeypatch.setenv("LLM_GATEWAY_BASE_URL", "https://gateway.example/v1")
    monkeypatch.setenv("LLM_GATEWAY_MODEL", "vendor/model")
    monkeypatch.setenv("LLM_GATEWAY_API_KEY", "test-key")
    monkeypatch.setenv("LLM_GATEWAY_TIMEOUT_SECONDS", timeout)
    with pytest.raises(RuntimeError, match="timeout"):
        load_llm_config()


def test_error_message_redacts_explicit_and_openai_style_secrets():
    explicit = "private-test-token"
    message = safe_error_message(
        RuntimeError(f"api_key={explicit} Authorization: Bearer sk-abcdefghijk123"), explicit
    )
    assert explicit not in message
    assert "sk-abcdefghijk123" not in message
    assert "[REDACTED]" in message
