# 活教参 PageIndex 服务

独立部署的 FastAPI BFF，封装固定 commit 的 PageIndex vendor。业务站点只通过 `/internal/v1/*` 调用；`PAGEINDEX_SERVICE_API_KEY` 只在服务端配置。

生产部署必须设置 `PAGEINDEX_SERVICE_API_KEY`；已识别的生产运行时若缺少该变量会拒绝启动。
所有 `/internal/v1/*` 请求都使用 `Authorization: Bearer <service key>`，不要把该服务直接暴露给浏览器。
仅本机回环地址可在无密钥时用于开发；带代理来源头或来自非回环地址的内部请求仍会拒绝。

- `/healthz`：服务健康与 PageIndex commit
- `/internal/v1/indexes`：登记/构建页级文本索引
- `/internal/v1/ingest`：从内部 PDF 字节或白名单路径逐页读取并按策略识别
- `/internal/v1/retrieve`：统一检索结果
- `/internal/v1/indexes/{documentId}/tree`：目录树
- `/internal/v1/indexes/{documentId}/text`：按 PDF 物理页读取可复用纯文本快照

当前 Vercel demo 使用不可变 seed index 让教材库在无持久化数据库时可冷启动；新导入文档会走 `PAGEINDEX_ADAPTER=vendor` 的固定 PageIndex 适配器。原始 PDF 不在本服务中生成或替换。

## 内置教材纯文本快照

内置的学生教材与教师教学用书同时保留原始 PDF 和一份按物理页分隔的纯文本快照。
快照由 Poppler `pdftotext -layout` 从 PDF 原生文字层生成，页码边界写入
`seed-runtime/text/*-pages.jsonl`，整本文本写入对应的 `*.txt`。纯文本只用于目录、搜索、
PageIndex 建树与问答上下文；教师端仍以原始 PDF 页面作为唯一展示和核验真源。

服务启动时会把快照复制到运行时目录，检索结果保留 `pdfPage`、`printedPage` 和文本来源。
因此问答或其他服务可以按范围复用：

```text
GET /internal/v1/indexes/{documentId}/text?startPage=51&endPage=57
```

扫描版 PDF 不会被伪装成原生文字。需要页面识别时仍走成熟的 PaddleOCR 镜像；识别失败保留
页面状态和警告，不覆盖已有有效文本。

## 页面识别运行时

页面识别不调用大模型网关，也不把原生文字层改写成识别结果。两份内置教材默认使用质量合格的
原生文字层；只有明确选择“页面识别”，或自动判断原生文字层缺失/质量不足时，才会把对应 PDF
页面渲染为图片并交给官方 PaddleOCR 中文 PP-OCRv6 管线。每页保存识别来源、模型、置信度和文本块
坐标，原始 PDF 仍是展示和核验真源。

Vercel 轻量函数不打包 PaddleOCR CPU 运行时，避免把大型推理依赖塞进普通索引函数。真正处理扫描
PDF 时使用同目录的成熟 OCR 镜像：

```bash
docker build -f Dockerfile.ocr -t huojiaocan-pageindex:ocr .
docker run --rm -p 8000:8000 \
  -e OCR_PROVIDER=paddleocr \
  -v "$PWD/runtime:/data" \
  huojiaocan-pageindex:ocr
```

未部署 OCR 镜像时，显式页面识别会返回可解释的 `ocr_unavailable` 或
`ocr_provider_not_configured`，不会把没有识别结果的页面伪装成已完成；普通原生文字索引不受影响。
`POST /internal/v1/ingest` 只接受 `pdfBase64` 或 `PDF_INPUT_ROOT` 下的 `pdfPath`，不接受任意远程 URL。

## 持久化索引（2026-09-13，待生产连接配置）

新增 `supabase/migrations/202609130001_pageindex_persistence.sql`，独立保存文档、完整索引、
质检与任务。该迁移已应用到现有项目；没有迁移或重新处理内置教材。

**启用前**在 Vercel 的 `pageindex-service` 项目 Production 环境安全配置：

- `SUPABASE_URL`：现有项目地址 `https://wknmrnducmlnynpbcssm.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`：同一项目的服务端密钥，通过安全配置页面填入，不能放入浏览器、源码或聊天。
- `PAGEINDEX_REPOSITORY=supabase`：上述连接配置就绪后开启，再重新部署服务。

不要复用被导出为 `[SENSITIVE]` 的占位文本，不增加转发密钥的接口。
现有 `PAGEINDEX_SERVICE_API_KEY`、vendor/OCR 配置不变。前端/BFF 必须先部署本次
`expectedRevision` 与 409 支持；旧客户端缺少版本号时拒绝覆盖并提示重新读取。

`file` 仍是未配置时的本地/兼容默认值，**不是 Vercel 新材料的可靠存储**。
生产尚未连接数据库之前，不能把本次提交称为线上索引丢失问题已解决。

### 一致性与回退边界

- 每次请求读取一个文档快照；整份索引、文档状态、质检和本次任务记录通过一次 CAS 事务提交。
  提交失败返回 503，不返回已完成的任务。并发旧版本返回 409，不自动覆盖。
- GET 页面返回 `revision`；PATCH 必须发送原值 `expectedRevision`，成功返回提交后的版本。
  冲突时保留编辑框输入；教师先复制需要保留的内容，再手动重新加载。
- 数据库记录优先；仅明确列出的公共 seed 材料可在数据库无记录时只读回退。数据库故障不等于无记录，
  不回退临时文件。首次编辑 seed 才写入数据库。删除保存墓碑，不让 seed 重新出现。
- 编辑使旧质检失效；文本快照从持久化索引派生。按材料检索不下载其他整本索引。
- 本实现仍同步完成索引请求；运行中任务不另行提前提交。没有新增队列或后台 worker。

### 当前证据和上线验收

真实数据库合成记录已验证首写冲突、旧版冲突、任务身份不匹配整笔回滚，以及跨请求读回
修订文本与任务状态；验证记录随后清理。独立服务实例的 HTTP 模拟检查覆盖保存、读取、
质检、提交失败和删除墓碑；**这不是服务已连上真实数据库的证据**。

配置后仅重建一份两页合成 PDF：在真实页面校正中保存，刷新读回，再重新部署服务读回
同一页面、任务与质量结果，同时确认课文/单元/返回草稿上下文保持不变。
未做完这条实际路径前，不验收持久化上线。原始教材不重跑。

回退：保留新增表和已写入记录，不删除数据；必要时暂缓新材料写入。
把生产切回 `file` 会看不到数据库新材料，不能作为无损回退。
