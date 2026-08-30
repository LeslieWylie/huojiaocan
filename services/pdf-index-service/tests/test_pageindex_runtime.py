from __future__ import annotations

import ast
import importlib.util
import inspect
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
VENDOR_ROOT = WORKSPACE_ROOT / "services" / "pageindex" / "vendor" / "PageIndex"
UTILS_PATH = VENDOR_ROOT / "pageindex" / "utils.py"
RETRIEVE_PATH = VENDOR_ROOT / "pageindex" / "retrieve.py"
PAGE_INDEX_PATH = VENDOR_ROOT / "pageindex" / "page_index.py"


@contextmanager
def loaded_vendor_modules(monkeypatch: pytest.MonkeyPatch, *, retrieve: bool = False):
    """Load vendor modules with dependency stubs; no PageIndex dependency install is needed."""
    package_name = "pageindex_runtime_test_pkg"
    package = ModuleType(package_name)
    package.__path__ = [str(VENDOR_ROOT / "pageindex")]  # type: ignore[attr-defined]

    dotenv = ModuleType("dotenv")
    dotenv.load_dotenv = lambda: None  # type: ignore[attr-defined]

    yaml = ModuleType("yaml")
    yaml.safe_load = lambda _stream: {}  # type: ignore[attr-defined]

    pypdf = ModuleType("PyPDF2")
    pypdf.PdfReader = object  # type: ignore[attr-defined]
    pymupdf = ModuleType("pymupdf")

    monkeypatch.setitem(sys.modules, package_name, package)
    monkeypatch.setitem(sys.modules, "dotenv", dotenv)
    monkeypatch.setitem(sys.modules, "yaml", yaml)
    monkeypatch.setitem(sys.modules, "PyPDF2", pypdf)
    monkeypatch.setitem(sys.modules, "pymupdf", pymupdf)

    utils_name = f"{package_name}.utils"
    utils_spec = importlib.util.spec_from_file_location(utils_name, UTILS_PATH)
    assert utils_spec and utils_spec.loader
    utils = importlib.util.module_from_spec(utils_spec)
    monkeypatch.setitem(sys.modules, utils_name, utils)
    utils_spec.loader.exec_module(utils)

    if not retrieve:
        try:
            yield utils, None
        finally:
            monkeypatch.delitem(sys.modules, utils_name, raising=False)
            monkeypatch.delitem(sys.modules, package_name, raising=False)
        return

    retrieve_name = f"{package_name}.retrieve"
    retrieve_spec = importlib.util.spec_from_file_location(retrieve_name, RETRIEVE_PATH)
    assert retrieve_spec and retrieve_spec.loader
    retrieve_module = importlib.util.module_from_spec(retrieve_spec)
    monkeypatch.setitem(sys.modules, retrieve_name, retrieve_module)
    retrieve_spec.loader.exec_module(retrieve_module)
    try:
        yield utils, retrieve_module
    finally:
        monkeypatch.delitem(sys.modules, retrieve_name, raising=False)
        monkeypatch.delitem(sys.modules, utils_name, raising=False)
        monkeypatch.delitem(sys.modules, package_name, raising=False)


def function_node(path: Path, name: str) -> ast.FunctionDef:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node  # type: ignore[return-value]
    raise AssertionError(f"function {name!r} not found in {path}")


def test_pinned_vendor_entrypoint_and_signatures_are_explicit():
    page_index = ast.parse(PAGE_INDEX_PATH.read_text(encoding="utf-8"))
    page_index_functions = {
        node.name: node
        for node in page_index.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    assert {"page_index", "page_index_main"} <= page_index_functions.keys()

    public_args = [
        arg.arg
        for arg in page_index_functions["page_index"].args.args
        if arg.arg != "self"
    ]
    assert public_args == [
        "doc",
        "model",
        "toc_check_page_num",
        "max_page_num_each_node",
        "max_token_num_each_node",
        "if_add_node_id",
        "if_add_node_summary",
        "if_add_doc_description",
        "if_add_node_text",
    ]
    assert not {
        "base_url",
        "api_base",
        "api_key",
        "pages",
        "page_texts",
        "retrieval_text",
    } & set(public_args)

    main_args = [arg.arg for arg in page_index_functions["page_index_main"].args.args]
    assert main_args == ["doc", "opt"]
    source = PAGE_INDEX_PATH.read_text(encoding="utf-8")
    assert "get_page_tokens(doc, model=opt.model)" in source


def test_vendor_model_router_places_openai_compatible_gateway_model_in_litellm_branch(
    monkeypatch: pytest.MonkeyPatch,
):
    with loaded_vendor_modules(monkeypatch) as (utils, _):
        assert utils._is_openai_model("deepseek-chat") is True
        assert utils._is_openai_model("openai/mlamp/deepseek-v4-flash") is True
        assert utils._is_openai_model("mlamp/deepseek-v4-flash") is False
        assert utils._is_openai_model("litellm/mlamp/deepseek-v4-flash") is False


def test_vendor_litellm_call_does_not_receive_gateway_parameters(monkeypatch: pytest.MonkeyPatch):
    calls: list[dict] = []
    litellm = ModuleType("litellm")

    def completion(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="mock response"),
                    finish_reason="stop",
                )
            ]
        )

    litellm.completion = completion  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "litellm", litellm)

    with loaded_vendor_modules(monkeypatch) as (utils, _):
        assert utils.llm_completion("mlamp/deepseek-v4-flash", "test prompt") == "mock response"

    assert calls == [
        {
            "model": "mlamp/deepseek-v4-flash",
            "messages": [{"role": "user", "content": "test prompt"}],
            "temperature": 0,
            "drop_params": True,
        }
    ]
    assert "api_key" not in calls[0]
    assert "api_base" not in calls[0]
    assert "base_url" not in calls[0]


def test_process_wrapper_can_inject_litellm_api_base_without_modifying_vendor(
    monkeypatch: pytest.MonkeyPatch,
):
    upstream_calls: list[dict] = []
    upstream = ModuleType("litellm")

    def upstream_completion(**kwargs):
        upstream_calls.append(kwargs)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="wrapped response"),
                    finish_reason="stop",
                )
            ]
        )

    upstream.completion = upstream_completion  # type: ignore[attr-defined]

    configured_litellm = ModuleType("litellm")

    def configured_completion(**kwargs):
        # This is the wrapper seam: the vendor calls the familiar LiteLLM function,
        # while the process-owned adapter supplies gateway-only parameters.
        return upstream.completion(  # type: ignore[attr-defined]
            **kwargs,
            api_base="https://gateway.invalid/v1",
            api_key="test-only-key",
        )

    configured_litellm.completion = configured_completion  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "litellm", configured_litellm)

    with loaded_vendor_modules(monkeypatch) as (utils, _):
        assert utils.llm_completion("mlamp/deepseek-v4-flash", "test prompt") == "wrapped response"

    assert upstream_calls == [
        {
            "model": "mlamp/deepseek-v4-flash",
            "messages": [{"role": "user", "content": "test prompt"}],
            "temperature": 0,
            "drop_params": True,
            "api_base": "https://gateway.invalid/v1",
            "api_key": "test-only-key",
        }
    ]


def test_openai_sdk_wrapper_configures_process_before_first_client_creation(
    monkeypatch: pytest.MonkeyPatch,
):
    created_clients: list[dict[str, str | int | None]] = []
    openai = ModuleType("openai")

    class FakeClient:
        def __init__(self):
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(create=self.create),
            )

        def create(self, **kwargs):
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content="openai-compatible response"),
                        finish_reason="stop",
                    )
                ]
            )

    def openai_client(**kwargs):
        created_clients.append(
            {
                "max_retries": kwargs.get("max_retries"),
                "api_key_at_creation": os.environ.get("OPENAI_API_KEY"),
                "base_url_at_creation": os.environ.get("OPENAI_BASE_URL"),
            }
        )
        return FakeClient()

    openai.OpenAI = openai_client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "openai", openai)
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://gateway.invalid/v1")

    with loaded_vendor_modules(monkeypatch) as (utils, _):
        assert utils.llm_completion("openai/mlamp/deepseek-v4-flash", "test prompt") == (
            "openai-compatible response"
        )
        assert utils.llm_completion("openai/mlamp/deepseek-v4-flash", "second prompt") == (
            "openai-compatible response"
        )

    assert created_clients == [
        {
            "max_retries": 0,
            "api_key_at_creation": "test-only-key",
            "base_url_at_creation": "https://gateway.invalid/v1",
        }
    ]


def test_config_loader_rejects_gateway_options_because_vendor_schema_is_closed(
    monkeypatch: pytest.MonkeyPatch,
):
    with loaded_vendor_modules(monkeypatch) as (utils, _):
        loader = object.__new__(utils.ConfigLoader)
        loader._default_dict = {"model": "test-model", "summary_model": "test-summary"}

        with pytest.raises(ValueError, match="Unknown config keys"):
            loader._validate_keys(
                {
                    "model": "test-model",
                    "base_url": "https://gateway.invalid/v1",
                    "api_key": "test-only-key",
                }
            )


def test_retrieve_prefers_business_page_text_cache_and_does_not_open_pdf(
    monkeypatch: pytest.MonkeyPatch,
):
    with loaded_vendor_modules(monkeypatch, retrieve=True) as (_, retrieve):
        assert retrieve is not None

        class ExplodingReader:
            def __init__(self, *_args, **_kwargs):
                raise AssertionError("cached pages should avoid reading the original PDF")

        retrieve.PyPDF2.PdfReader = ExplodingReader
        doc_info = {
            "path": "/not-read/original.pdf",
            "page_count": 3,
            "pages": [
                {"page": 3, "content": "business page three"},
                {"page": 1, "content": "business page one"},
            ],
        }

        assert retrieve._get_pdf_page_content(doc_info, [1, 2, 3]) == [
            {"page": 1, "content": "business page one"},
            {"page": 3, "content": "business page three"},
        ]


def test_runtime_wrapper_does_not_claim_page_text_injection_when_vendor_has_no_hook():
    source = PAGE_INDEX_PATH.read_text(encoding="utf-8")
    signature = inspect.signature(
        lambda doc, model=None, toc_check_page_num=None, max_page_num_each_node=None,
        max_token_num_each_node=None, if_add_node_id=None, if_add_node_summary=None,
        if_add_doc_description=None, if_add_node_text=None: None
    )
    assert "page_texts" not in signature.parameters
    assert "get_page_tokens(doc, model=opt.model)" in source
    assert "page_texts" not in source
    assert "retrieval_text" not in source
