# Huojiaocan PDF Index Service

这是“活教参”的本地 PDF 页级文本与 PageIndex 集成原型。它验证以下关键假设：业务侧可以逐页选择原生文本或页面识别文本，在不改变原始 PDF 物理页码的前提下交给固定版本 PageIndex 建树，并将结果重新映射到原始 PDF 页面。

> 当前是可运行的本地 prototype，不是持久化任务队列。默认使用 JSON 文件存储并同步执行索引；不要直接用于大规模生产任务。

## 已实现

- `GET /healthz`
- `POST /internal/v1/indexes`
- `GET /internal/v1/jobs/{jobId}`
- `GET /internal/v1/indexes/{documentId}/tree`
- `GET /internal/v1/indexes/{documentId}/pages/{pageNumber}`
- `PATCH /internal/v1/indexes/{documentId}/pages/{pageNumber}`
- `POST /internal/v1/retrieve`
- `POST /internal/v1/indexes/{documentId}/refresh`
- `POST /internal/v1/indexes/{documentId}/validate`
- `GET /internal/v1/indexes/{documentId}/validation`
- `POST /internal/v1/ingest`：从内部 PDF 字节或白名单路径逐页读取并按策略识别。
- 每页 `auto | native | ocr` 文本来源选择。
- `ocr` 不把大模型网关当作识别器；扫描页使用独立的 PaddleOCR 适配器。
- 保存页面识别来源、模型、置信度和文本块坐标，无法识别时标记失败，不冒充已识别。
- 精确保留 `pdfPageNumber`，不从数组位置重新生成页码。
- 混合 PDF 按页选择唯一 `retrievalText`。
- 低质量页标记为 `review`/`failed`，失败页不进入检索。
- `FixturePageIndexAdapter`：无模型依赖的稳定开发夹具。
- `VendorPageIndexAdapter`：使用固定 PageIndex、临时影子 PDF、真实物理页回映和严格结构校验。
- Gateway 配置仅来自服务端环境变量，对外状态和错误不返回 API Key。

## 固定 PageIndex

上游源码位于：

```text
../pageindex/vendor/PageIndex
```

固定 commit：

```text
d5c4e62c20172ce400aef84545dfba3a0580b9ae
```

业务代码不写入 vendor。`VendorPageIndexAdapter` 会：

1. 接收已选择好的逐页 `retrievalText`；
2. 在临时目录生成一页对一页的影子 PDF；
3. 在每页嵌入影子页序号和原始 `pdfPageNumber` marker；
4. 调用固定 PageIndex 建树；
5. 将 PageIndex 的 `start_index/end_index` 映射回原始物理页；
6. 拒绝越界、反向、空结构或父子范围不一致的结果；
7. 调用结束后删除影子 PDF。

影子 PDF 只用于 PageIndex 文本传输，绝不用于前端展示或证据核验；原始 PDF 始终是唯一展示真源。

## 本地运行

```bash
uv sync --python 3.13 --dev
uv run uvicorn app.main:app --reload --port 8000
```

默认使用 fixture：

```bash
export PAGEINDEX_ADAPTER=fixture
```

启用固定 PageIndex：

```bash
export PAGEINDEX_ADAPTER=vendor
export PAGEINDEX_VENDOR_ROOT="$(cd ../pageindex/vendor/PageIndex && pwd)"
export PAGEINDEX_SHADOW_FONT_FILE="/System/Library/Fonts/STHeiti Medium.ttc"
```

macOS 会自动尝试系统中文字体；Linux/Docker 建议显式安装并配置文泉驿字体。

## LLM Gateway 服务端配置

真实 Key 只能通过服务端进程环境临时注入，不得写入前端、源码、测试、命令历史、镜像或仓库中的 `.env` 文件。

```bash
export LLM_GATEWAY_BASE_URL='https://gateway.example.com/v1'
export LLM_GATEWAY_MODEL='provider/model-name'
export LLM_GATEWAY_API_KEY='由本机安全方式注入的密钥'
export LLM_GATEWAY_TIMEOUT_SECONDS='120'
```

兼容旧变量名：

- `PAGEINDEX_LLM_BASE_URL`
- `PAGEINDEX_LLM_MODEL`
- `PAGEINDEX_LLM_API_KEY`
- `PAGEINDEX_LLM_TIMEOUT_SECONDS`

对于本项目当前测试网关，未鉴权探测确认 OpenAI-compatible API 位于 `/v1`，因此本地测试应把 `LLM_GATEWAY_BASE_URL` 配置为完整的 `https://…/v1`，而不是网站根地址。模型 `mlamp/deepseek-v4-flash` 会在 PageIndex 内部规范化为 LiteLLM 所需的 `openai/mlamp/deepseek-v4-flash`。

推荐用密码管理器、IDE 的 secret environment 或当前终端会话注入 Key。测试结束后执行：

```bash
unset LLM_GATEWAY_API_KEY
```

## 安全冒烟检查

脚本只输出网关 host、模型、成功状态、节点范围和物理页映射；不会输出请求头或 API Key。

无需凭据，检查固定 commit、vendor 导入、模型配置和中文影子 PDF：

```bash
uv run python scripts/smoke_pageindex.py vendor
```

在已经安全设置环境变量的终端中检查 Gateway：

```bash
uv run python scripts/smoke_pageindex.py gateway
```

检查真实 Gateway + PageIndex 的 3 页最小建树：

```bash
uv run python scripts/smoke_pageindex.py pageindex
```

真实调用失败时脚本仅返回脱敏后的摘要并以非零状态退出。真实 PageIndex 失败不会静默回退到 fixture。

## Docker

镜像安装完整项目依赖与 `fonts-wqy-zenhei`，但不会把 vendor 或密钥打进镜像。

Fixture 模式：

```bash
docker build -t huojiaocan-pdf-index .
docker run --rm -p 8000:8000 \
  -v "$PWD/runtime:/data" \
  huojiaocan-pdf-index
```

Vendor 模式需要只读挂载固定 PageIndex，并在运行时安全注入环境变量：

```bash
docker run --rm -p 8000:8000 \
  -v "$PWD/runtime:/data" \
  -v "$(cd ../pageindex/vendor/PageIndex && pwd):/opt/pageindex:ro" \
  -e PAGEINDEX_ADAPTER=vendor \
  -e LLM_GATEWAY_BASE_URL \
  -e LLM_GATEWAY_MODEL \
  -e LLM_GATEWAY_API_KEY \
  huojiaocan-pdf-index
```

`-e NAME` 只从当前终端传值，不把值直接写进命令文本。当前阶段不要部署该镜像。

## API 示例

```bash
curl -sS http://localhost:8000/internal/v1/indexes \
  -H 'content-type: application/json' \
  -d '{
    "documentId": "doc_demo",
    "documentTitle": "九年级语文上册",
    "documentType": "textbook",
    "extractionPolicy": "auto",
    "pages": [
      {
        "pdfPageNumber": 57,
        "printedPage": "51",
        "sectionPath": ["第一单元", "我爱这土地"],
        "nativeText": "",
        "nativeQualityScore": 0.1,
        "ocrText": "为什么我的眼里常含泪水？因为我对这土地爱得深沉……",
        "ocrQualityScore": 0.94,
        "ocrProvider": "gateway",
        "ocrModel": "configured-server-side"
      }
    ]
  }'
```

持久化记录中的物理页仍为 `57`；印刷页 `51` 只是独立展示元数据。

## 文本选择规则

- `auto`：原生文本存在且质量至少 `0.65` 时使用原生文本，否则选择页面识别文本；如果识别文本不存在，低质量原生文本保留为 `review`。
- `native`：只考虑原生文本。
- `ocr`：只考虑页面识别文本。
- 上游已完成解析时，可同时传入 `text`、`textSource` 和 `qualityScore`。
- 当前薄切片不拼接原生文本与页面识别文本，避免重复与错位。

## 页面识别运行时

当前两本内置教材的页面文字层质量足够，默认 `auto` 会保留原生文字，避免对已经
准确的文字重复识别。只有明确选择 `ocr`，或 `auto` 判断原生文字缺失/乱码，才会
把 PDF 页面渲染成图片并交给页面识别服务。

页面识别采用 PaddleOCR 3.x 的中文 PP-OCRv6 管线；它与 LLM 网关完全分离，不会把
页面图片发送给 DeepSeek 或其他大模型。生产镜像构建方式：

```bash
docker build -f Dockerfile.ocr -t huojiaocan-pdf-index:ocr .
docker run --rm -p 8000:8000 \
  -e OCR_PROVIDER=paddleocr \
  -v "$PWD/runtime:/data" \
  huojiaocan-pdf-index:ocr
```

`POST /internal/v1/ingest` 只接受 `pdfBase64` 或 `PDF_INPUT_ROOT` 下的 `pdfPath`，
不接受远程 URL 拉取。接口逐页渲染并保存 `pdfPageNumber`、`ocrProvider`、
`ocrModel`、`ocrConfidence` 和文本块坐标；原始 PDF 永远不被识别结果覆盖。未安装
OCR 运行时或没有页面图像时，页面会进入 `failed/review` 并显示原因，不会被标记成
“正常页面识别”。

成熟方案选择依据：PaddleOCR 负责中文页面文字与坐标，必要时可在独立镜像中扩展
PP-StructureV3 做版面结构化；OCRmyPDF 适合额外生成可搜索 PDF 层，但不作为本系统
的检索主文本来源。

## 测试

```bash
uv run pytest
```

测试覆盖 API、页码保留、重复物理页拒绝、页级来源选择、Gateway 配置脱敏、影子 PDF 中文提取、临时文件清理、PageIndex 范围回映与异常结构拒绝。

## 进入生产前仍需完成

- 用持久队列/Worker 替换进程内同步建树。
- 用 PostgreSQL 与对象存储替换 JSON prototype repository。
- 对 168 页教材和 612 页教师用书做耗时、成本与失败恢复基准。
- 增加任务取消、有限重试、指标和服务健康观测。
- 在固定标准问题集上完成 Local Provider 与 PageIndex 影子对比后，才允许切换默认 Provider。


## 安全交互式真实网关冒烟

真实密钥不要写进 `.env`、源码、命令行参数或 shell history。可使用隐藏输入模式；密钥只存在于当前 Python 进程内存中，进程退出后即释放：

```bash
cd /Users/mlamp/Documents/ChatGPT/乐乐外包/services/pdf-index-service

.venv/bin/python scripts/smoke_pageindex.py gateway --prompt-api-key
.venv/bin/python scripts/smoke_pageindex.py pageindex --prompt-api-key
```

隐藏输入模式默认使用：

```text
base URL: https://llm-gateway.mlamp.cn/v1
model:    mlamp/deepseek-v4-flash
```

需要测试其他兼容网关时，可以显式传入非敏感参数：

```bash
.venv/bin/python scripts/smoke_pageindex.py gateway \
  --prompt-api-key \
  --base-url https://gateway.example/v1 \
  --model vendor/model
```

脚本输出只包含网关主机、模型、状态和脱敏错误摘要；不会输出密钥、Authorization header 或完整供应商响应。该能力仅用于本地验证，不会进入部署配置。
