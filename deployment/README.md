# Cloudflare 公网防护层

`cloudflare-worker.js` 是“活教参”Demo V1.1 的固定源站反向代理。

- 公网入口：`https://app.huojiaocan.workers.dev`
- 固定源站：`https://live-teacher-guide-roy-leos-projects.vercel.app`
- Worker：`app`

Worker 不接受用户指定上游地址，因此不是开放代理。它负责：

- 补充 CSP、HSTS、COOP、CORP、Permissions Policy 等安全响应头；
- 对 `/api/*` 强制设置 `no-store`；
- 对 HTML 外壳强制设置 `no-store`，避免固定地址在发布后继续引用旧的 Vite 入口；带内容哈希的静态资源仍可缓存；
- 删除可删除的 Vercel 标识头并重写站内跳转；
- 在源站不可用时返回不含内部细节的 `502` JSON。

2026 年 8 月 6 日，V1.1 已重新部署到 Vercel，并将 `live-teacher-guide.vercel.app` 重新指向最新生产实例。Cloudflare 固定入口已通过 ego lite 回归。

模型网关配置不属于 Worker。`LLM_GATEWAY_API_KEY` 等敏感值只能保存于 Vercel 服务端环境变量，不能提交到源码。
