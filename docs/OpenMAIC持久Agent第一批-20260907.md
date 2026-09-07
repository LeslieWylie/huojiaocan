# OpenMAIC 持久 Agent 第一批

日期：2026-09-07。

## 本批完成

- 新增独立 Cloudflare Agent Runtime Worker 源码，直接使用 `@openmaic/storage@0.29.0` 的 `PgAgentSessionStore`，没有复制一套自建租约或事件系统。
- 生成 OpenMAIC 六张标准会话表及活教参 `teaching_agent_requests` 请求表迁移。
- 落地六个会话接口、Queue consumer、每分钟 reconciler、90 秒租约、20 秒心跳、初次执行加最多三次过期接管、120 秒共享截止时间。
- `(owner_id, client_request_id)` 的请求登记和 OpenMAIC 用户消息事件在同一个 PostgreSQL 事务中提交；重复提交只返回原请求，不重复唤醒 Queue。
- 模型调用开始前持久增加调用计数。若 Worker 在模型返回前失联，接管者把该轮标记为 `interrupted`，不会盲目再次付费调用。
- 结果先落 `ready_to_save`；正式保存失败可只重试保存，不重新执行模型。
- 会话读取和事件重放均校验 owner；事件接口支持 `Last-Event-ID`。

## 验证

- PGlite PostgreSQL 兼容及代理契约测试 14 项通过：重复 requestId、并发领取、租约过期、接管上限、取消、事件顺序、账号隔离、保存失败不重跑模型、执行错误终态、白名单关闭边界和 Service Binding 路由。
- Wrangler 4.129.0 dry-run 通过，Worker 产物 256.80 KiB，gzip 53.67 KiB。
- 迁移由已安装 OpenMAIC 包的 `AGENT_SESSION_PG_SCHEMA` 生成，避免手抄上游六表定义后漂移。

## 还不能声称上线

当前 Cloudflare 账号中没有 Queue 或 Hyperdrive；Vercel 生产变量也没有 PostgreSQL 连接串。仓库因此只提交了无凭据的生产配置模板，没有创建云资源或修改公网 `app` Worker。

此外，后台执行仍需要一个内部 `TEACHING_BACKEND` Service Binding，用现有教材检索、个人 DeepSeek 连接和草稿版本校验完成真实生成与保存。未建立该绑定前，Runtime 会明确返回 `agent_executor_not_configured`，不会退回系统网关或把浏览器 token、个人密钥写入数据库/Queue。

下一批应先补齐专用 PostgreSQL 角色与 Hyperdrive，再把现有问答领域逻辑包装为内部 Worker，并只对白名单测试账号接通公网路由。
