# 活教参资源复用与 PageIndex 架构说明

## 仓库里已经有的资源

### 1. 原始展示资源

- `demo/public/materials/九年级语文上册-学生教材.pdf`：168 页学生教材原文件。
- `demo/public/materials/九年级语文上册-教师教学用书.pdf`：612 页教师教学用书原文件。
- `demo/public/materials/pages/`：少量关键页预览图，用于本地检查和降级展示。

原始 PDF 是唯一展示真源。解析文本、目录节点和命中片段都必须通过 `documentId + pdfPage` 回到原始 PDF。

### 2. 已解析的页级资源

- `demo/data/index/manifest.json`：本地目录清单、文档元数据和目录树。
- `demo/data/index/textbook-pages.parts/`：学生教材 168 页的页级记录。
- `demo/data/index/teacher-guide-pages.parts/`：教师用书 612 页的页级记录。
- `demo/data/index/*-tree.json`：篇目、单元和教学建议的目录节点。

页级记录包含物理页码、印刷页码、章节路径、检索文本、文本来源和质量状态。它们用于本地 fallback、测试和内容回归，不是另一份展示教材。

### 3. PageIndex 资源

- `services/pageindex/vendor/PageIndex/`：固定版本的 PageIndex 源码。
- 固定 commit：`d5c4e62c20172ce400aef84545dfba3a0580b9ae`。
- `services/pageindex-service/app/pageindex_adapter.py`：业务页文本与 PageIndex 的适配层。
- `services/pageindex-service/app/pageindex_runtime.py`：加载 vendor 并执行建树。
- `services/pageindex-service/seed-runtime/indexes/`：两本现有教材的可冷启动索引快照。
- `services/pageindex-service/seed-runtime/documents/`：两本教材的文档元数据和状态。

`demo/serverless/index-provider.js` 统一本地索引和远程 PageIndex 的结果格式。问答、检索、目录和 PDF 核验都复用同一套页级结果，而不是各自维护一份页码映射。

### 4. PDF 处理资源

`services/pdf-index-service/` 已包含 PDF 预检、逐页文本提取、扫描页解析策略、页级质量判断、PageIndex Adapter、任务状态、校正和验证代码。它是后续导入新教材时的处理服务，不替代现有原始 PDF。

## 现在的生产链路

```text
浏览器
  → 活教参 BFF
  → 自部署 PageIndex Service
  → 固定版本 PageIndex vendor
  → 页级索引 / 目录 / 检索结果
  → BFF 重新绑定真实 PDF 物理页
  → 浏览器打开原始 PDF
```

生产环境的 `/api/index/health` 当前返回 `activeProvider=pageindex`、`adapter=vendor`，并返回上面的固定 commit。教材目录接口返回 612 页教师用书和 168 页学生教材，状态为 `ready`。

## PageIndex 是否使用官方 API Key

不是。

- 没有调用 PageIndex 官方托管 API。
- PageIndex 源码已放在 `services/pageindex/vendor/PageIndex/`，由我们的 FastAPI 服务自部署和调用。
- `PAGEINDEX_SERVICE_API_KEY`（如果配置）只是“活教参 BFF → 我们自己的 PageIndex Service”的内部鉴权，不是 PageIndex 官方 Key。
- PageIndex 在需要重新建树时使用服务端配置的 OpenAI-compatible 网关；当前网关模型是 `mlamp/deepseek-v4-flash`。
- 网关 Key 只进入服务端环境变量，不进入浏览器、索引结果或仓库。

## 本次教材选择改造

教材库现在先展示“选择教材来源”卡片：

- 学生教材和教师教学用书分别显示角色、页数、可检索页数和索引状态。
- 点击卡片切换当前目录和 PDF 阅读页。
- “查看目录”只切换当前文档，不触发重新构建。
- “从这本开始备课”会把检索范围带入备课问答。
- 搜索范围仍可选单本或“教材与教参”。
- 侧边栏项目卡片也从 `/api/index/documents` 动态读取，不再写死页数和教材名称。

