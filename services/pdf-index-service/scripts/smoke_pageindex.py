from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.llm_config import LLMConfig, load_llm_config, normalize_base_url, normalize_model, safe_error_message
from app.models import QualityStatus, SelectedPage, TextSource
from app.pageindex_adapter import HuojiaocanPageTextProvider, VendorPageIndexAdapter
from app.pageindex_runtime import _load_vendor
from app.shadow_pdf import create_shadow_pdf

PINNED_COMMIT = "d5c4e62c20172ce400aef84545dfba3a0580b9ae"
DEFAULT_VENDOR_ROOT = PROJECT_ROOT.parent / "pageindex" / "vendor" / "PageIndex"
DEFAULT_GATEWAY_BASE_URL = "https://llm-gateway.mlamp.cn/v1"
DEFAULT_GATEWAY_MODEL = "mlamp/deepseek-v4-flash"


def emit(**values: object) -> None:
    print(json.dumps(values, ensure_ascii=False, sort_keys=True))


def selected_page(number: int, text: str) -> SelectedPage:
    return SelectedPage(
        pdfPageNumber=number,
        printedPage=str(number - 4),
        sectionPath=["第一单元", "测试篇目"],
        retrievalText=text,
        textSource=TextSource.native,
        qualityScore=0.98,
        qualityStatus=QualityStatus.normal,
        qualityFlags=[],
        includeInIndex=True,
    )


def check_vendor(vendor_root: Path) -> None:
    import subprocess

    commit = subprocess.run(
        ["git", "-C", str(vendor_root), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    pageindex, utils = _load_vendor(vendor_root)
    options = utils.ConfigLoader().load(
        {
            "model": "openai/mlamp/deepseek-v4-flash",
            "summary_model": "openai/mlamp/deepseek-v4-flash",
            "retrieve_model": "openai/mlamp/deepseek-v4-flash",
            "if_add_node_summary": "no",
            "if_add_doc_description": "no",
            "if_add_node_text": "no",
        }
    )
    pages = [selected_page(55, "中文课堂内容。"), selected_page(57, "第二页教学建议。")]
    payload = {
        "documentId": "smoke_vendor",
        "pages": [
            {"pdfPageNumber": page.pdf_page_number, "text": page.retrieval_text}
            for page in pages
        ],
    }
    with tempfile.TemporaryDirectory(prefix="huojiaocan-smoke-") as temp_dir:
        shadow = create_shadow_pdf(payload, Path(temp_dir) / "shadow.pdf")
        from PyPDF2 import PdfReader

        extracted = [page.extract_text() or "" for page in PdfReader(str(shadow.path)).pages]
    markers_ok = "<real_pdf_page_55>" in extracted[0] and "<real_pdf_page_57>" in extracted[1]
    emit(
        check="vendor",
        ok=commit == PINNED_COMMIT and markers_ok,
        commit=commit,
        pinnedCommit=PINNED_COMMIT,
        importable=callable(pageindex.page_index_main),
        configuredModel=options.model,
        shadowPages=len(extracted),
        physicalPageMarkersPreserved=markers_ok,
    )


def gateway_smoke(config: LLMConfig) -> None:
    url = f"{config.base_url.rstrip('/')}/chat/completions"
    body = json.dumps(
        {
            "model": config.model,
            "messages": [{"role": "user", "content": "只回复 OK"}],
            "temperature": 0,
            "max_tokens": 8,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=config.timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
        choices = payload.get("choices") if isinstance(payload, dict) else None
        ok = isinstance(choices, list) and bool(choices)
        emit(check="gateway", ok=ok, **config.public_summary())
    except Exception as error:
        emit(
            check="gateway",
            ok=False,
            **config.public_summary(),
            error=safe_error_message(error, config.api_key),
        )
        raise SystemExit(1) from None


def pageindex_smoke(vendor_root: Path, config: LLMConfig) -> None:
    pages = [
        selected_page(55, "《我爱这土地》以鸟的歌唱表达对土地深沉的爱。"),
        selected_page(57, "朗读时要把握忧郁、悲愤而深沉的感情基调。"),
        selected_page(60, "教学中可通过意象、情感和时代背景形成问题链。"),
    ]
    adapter = VendorPageIndexAdapter(
        vendor_root,
        page_text_provider=HuojiaocanPageTextProvider(),
        config_loader=lambda **_: config,
    )
    try:
        tree = adapter.build_tree("smoke_pageindex", "PageIndex 本地冒烟测试", pages)
        ranges: list[list[int]] = []

        def walk(node: object) -> None:
            start = getattr(node, "start_pdf_page", None)
            end = getattr(node, "end_pdf_page", None)
            if isinstance(start, int) and isinstance(end, int):
                ranges.append([start, end])
            for child in getattr(node, "children", []) or []:
                walk(child)

        walk(tree)
        allowed = {55, 57, 60}
        mapped = all(start in allowed and end in allowed for start, end in ranges)
        emit(
            check="pageindex",
            ok=bool(ranges) and mapped,
            **config.public_summary(),
            nodeRanges=ranges,
            physicalPagesMapped=mapped,
        )
    except Exception as error:
        emit(
            check="pageindex",
            ok=False,
            **config.public_summary(),
            error=safe_error_message(error, config.api_key),
        )
        raise SystemExit(1) from None


def resolve_config(args: argparse.Namespace) -> LLMConfig:
    if not args.prompt_api_key:
        return load_llm_config()

    api_key = getpass.getpass("LLM Gateway API key (input hidden, not persisted): ").strip()
    if not api_key:
        raise SystemExit("LLM Gateway API key cannot be empty")
    return LLMConfig(
        base_url=normalize_base_url(args.base_url),
        api_key=api_key,
        model=normalize_model(args.model),
        timeout_seconds=args.timeout,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Safe local PageIndex/Gateway smoke checks")
    parser.add_argument("mode", choices=("vendor", "gateway", "pageindex"))
    parser.add_argument(
        "--vendor-root",
        type=Path,
        default=Path(os.getenv("PAGEINDEX_VENDOR_ROOT", DEFAULT_VENDOR_ROOT)),
    )
    parser.add_argument(
        "--prompt-api-key",
        action="store_true",
        help="read the API key from a hidden TTY prompt; never persist it or place it in argv",
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("LLM_GATEWAY_BASE_URL", DEFAULT_GATEWAY_BASE_URL),
        help="OpenAI-compatible base URL used with --prompt-api-key",
    )
    parser.add_argument(
        "--model",
        default=os.getenv("LLM_GATEWAY_MODEL", DEFAULT_GATEWAY_MODEL),
        help="gateway model used with --prompt-api-key",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.getenv("LLM_GATEWAY_TIMEOUT_SECONDS", "120")),
        help="request timeout in seconds used with --prompt-api-key",
    )
    args = parser.parse_args()
    if args.timeout <= 0 or args.timeout > 1800:
        parser.error("--timeout must be between 0 and 1800 seconds")
    if args.mode == "vendor":
        check_vendor(args.vendor_root.resolve())
        return

    config = resolve_config(args)
    try:
        if args.mode == "gateway":
            gateway_smoke(config)
        else:
            pageindex_smoke(args.vendor_root.resolve(), config)
    finally:
        # Best effort: drop the only local reference immediately after the smoke call.
        config = None


if __name__ == "__main__":
    main()
