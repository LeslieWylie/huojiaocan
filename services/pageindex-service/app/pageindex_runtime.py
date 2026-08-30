from __future__ import annotations

import importlib
import os
import sys
import threading
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from typing import Any, Iterator

from .llm_config import LLMConfig, safe_error_message

_RUNTIME_LOCK = threading.RLock()
_ENV_KEYS = ("OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_TIMEOUT")
_PROXY_KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")


@contextmanager
def isolated_openai_environment(config: LLMConfig) -> Iterator[None]:
    previous = {key: os.environ.get(key) for key in (*_ENV_KEYS, *_PROXY_KEYS)}
    os.environ["OPENAI_API_KEY"] = config.api_key
    os.environ["OPENAI_BASE_URL"] = config.base_url
    os.environ["OPENAI_TIMEOUT"] = str(config.timeout_seconds)
    # The desktop environment may expose a SOCKS proxy without socksio. The
    # configured gateway is directly reachable, and leaving those variables in
    # place makes the OpenAI-compatible client fail before it sends a request.
    for key in _PROXY_KEYS:
        os.environ.pop(key, None)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _reset_cached_clients(utils_module: Any) -> None:
    for name in ("_openai_sync_client", "_openai_async_client"):
        if hasattr(utils_module, name):
            setattr(utils_module, name, None)


@contextmanager
def writable_runtime_directory() -> Iterator[None]:
    """Give the upstream package a writable cwd on read-only serverless hosts."""

    directory = Path(os.getenv("PAGEINDEX_RUNTIME_DIR", "/tmp/huojiaocan-pageindex"))
    directory.mkdir(parents=True, exist_ok=True)
    previous = Path.cwd()
    os.chdir(directory)
    try:
        yield
    finally:
        os.chdir(previous)


def _load_vendor(vendor_root: Path) -> tuple[Any, Any]:
    root = str(vendor_root.resolve())
    if root not in sys.path:
        sys.path.insert(0, root)
    pageindex = importlib.import_module("pageindex")
    utils = importlib.import_module("pageindex.utils")
    return pageindex, utils


def run_pageindex(
    pdf_path: str | Path,
    config: LLMConfig,
    vendor_root: str | Path,
    *,
    add_summaries: bool = False,
) -> dict[str, Any]:
    """Run the pinned PageIndex package without persisting credentials.

    PageIndex has module-level OpenAI clients, so the prototype serializes in-process
    vendor runs and clears those clients before and after every invocation.
    """
    vendor_path = Path(vendor_root)
    if not (vendor_path / "pageindex" / "page_index.py").exists():
        raise RuntimeError(f"PageIndex vendor not found at {vendor_path}")

    with _RUNTIME_LOCK:
        pageindex = utils = None
        try:
            with writable_runtime_directory(), isolated_openai_environment(config):
                pageindex, utils = _load_vendor(vendor_path)
                _reset_cached_clients(utils)
                options = utils.ConfigLoader().load(
                    {
                        "model": config.pageindex_model,
                        "summary_model": config.pageindex_model,
                        "retrieve_model": config.pageindex_model,
                        "if_add_node_summary": "yes" if add_summaries else "no",
                        "if_add_doc_description": "no",
                        "if_add_node_text": "no",
                    }
                )
                # Vendor prints parsing/retry diagnostics that may include provider errors.
                # Keep them out of service logs; callers receive a redacted exception.
                with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                    result = pageindex.page_index_main(str(pdf_path), options)
                if not isinstance(result, dict):
                    raise RuntimeError("PageIndex returned a non-object result")
                return result
        except Exception as error:
            raise RuntimeError(f"PageIndex execution failed: {safe_error_message(error, config.api_key)}") from None
        finally:
            if utils is not None:
                _reset_cached_clients(utils)
