# 活教参持久 Agent Runtime

该 Worker 直接复用 `@openmaic/storage@0.29.0` 的 `PgAgentSessionStore`，把会话租约、心跳、取消、事件序列和断点接管保存在 PostgreSQL。Queue 只负责唤醒，数据库是执行状态权威。

首批接口：

- `POST /api/agent/sessions`
- `POST /api/agent/sessions/:id/messages`
- `GET /api/agent/sessions/:id`
- `GET /api/agent/sessions/:id/events`
- `POST /api/agent/sessions/:id/cancel`
- `POST /api/agent/sessions/:id/retry-save`

运行约束固定为单消息批次、单 consumer、90 秒租约、20 秒心跳、最多三次接管和单轮 120 秒截止时间。同一个 `(owner_id, client_request_id)` 只登记一次；模型开始前先递增 `model_call_count`，因此接管到无结果的模型阶段会停在 `interrupted`，不会盲目再次计费。

## 状态一致性

持久任务的 Hyperdrive **必须禁用查询缓存**（`caching.disabled=true`）。任务状态与租约是实时读写数据，不能沿用适合目录查询的缓存。2026-09-11 线上实测出现数据库已保存而页面仍停在 composing，已关闭此连接的查询缓存；连接池保持启用。

## 部署前置条件

1. 在目标 PostgreSQL 执行 `migrations/0001_agent_runtime.sql`。
2. 创建 Hyperdrive 和 `huojiaocan-agent-runs` Queue。
3. 从 `wrangler.production.example.jsonc` 生成本机生产配置，不提交 ID、账号白名单或任何 secret。
4. 配置 `SUPABASE_ANON_KEY` secret，并把 `AGENT_RUNTIME_ALLOWLIST` 限定为测试账号。
5. 配置内部 `TEACHING_BACKEND` Service Binding；它负责执行现有问答领域逻辑和带版本保存，Agent Worker 不持久化浏览器 token、个人模型密钥或原始工具参数。

2026-09-11 已核对并更新线上 Worker，保留已有 Hyperdrive、Queue、测试账号白名单及内部 teaching backend。生产专用配置保存在本机，凭证不提交。发布时使用 `--keep-vars` 保留控制台变量；数据库迁移仅在目标环境缺失时执行。
