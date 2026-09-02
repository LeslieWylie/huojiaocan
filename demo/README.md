# 活教参教师端

“活教参”面向初中语文教师：从课程标准、学生教材和教师教学用书出发，围绕同一篇目连续追问，确认方案后生成、编辑和锁定一课三卡，并把课堂记录接续到复盘与下一课。

## 核心工作区

1. **教材库**：读取自部署 PageIndex 目录，跨材料搜索并定位到原始教材页。
2. **备课问答**：固定篇目身份与备课条件，保存历史消息，支持连续追问和有限轮次的检索—审校。
3. **教师定稿**：教师编辑目标、重点难点、课堂流程和依据后确认当前版本。
4. **课堂设计**：生成板书卡、提问卡和评价卡；支持编辑、保存、锁定、投影和导出。
5. **课后接续**：记录课堂事实、完成复盘，并把已确认的班级情况带入下一次备课。

## 教材依据规则

- 教材 PDF 第 7 页：第一单元“活动·探究”与三项任务；
- 教材 PDF 第 7—8 页：学习鉴赏及六篇诗歌结构；
- 教材 PDF 第 20 页：诗歌朗诵；
- 教材 PDF 第 24—26 页：尝试创作；
- 教师教学用书 PDF 第 51 页：教学目标；
- 教师教学用书 PDF 第 51—53 页：重点难点；
- 教师教学用书 PDF 第 53 页：建议 1 课时；
- 教师教学用书 PDF 第 54—56 页：教学活动建议。

原始教材页面是最终核验真源；解析文本只用于搜索和复制。所有引用身份由服务端绑定，模型不能生成页码、文档 ID、PDF 地址或教材来源。公共教材的远程搜索摘要会重新绑定到仓库中的不可变页级文本，避免聚合摘要被误当作原页引文。

## 本地运行

前置条件：Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

浏览器访问 `http://127.0.0.1:5173`。

提交前验证：

```bash
npm run check
npm run build
```

`npm run check` 会执行服务端语法检查、前端未解析引用守卫和生产构建；`npm test` 覆盖 API、索引、问答、引用、导航、草稿、三卡和课堂工具。

浏览器端到端验证：

```bash
npm run e2e:install
npm run test:e2e
npm run test:e2e:headed
npm run test:smoke:production
npm run verify
```

详细覆盖、环境变量和生产 smoke 说明见 [`e2e/README.md`](./e2e/README.md)。

## AI、账号与连续问答

系统默认使用服务端配置的 OpenAI 兼容模型网关。用户也可以在 `/settings/` 添加自己的 DeepSeek 连接；数据库只保存 AES-256-GCM 加密结果，前端只看到末四位和记录 ID。个人连接固定请求 `https://api.deepseek.com/chat/completions`，只允许 `deepseek-v4-flash` 和 `deepseek-v4-pro`。

连续问答由应用保存历史消息并在每一轮重新拼装上下文。`lessonIdentity` 固定篇目和核心问题，`lessonContext` 保存课时、班级、目标和方式，`followUpInstruction` 只描述本轮调整，避免“换成两课时”污染篇目与板书标题。

服务端环境变量：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `USER_DEEPSEEK_KEY_ENCRYPTION_SECRET`
- `LLM_GATEWAY_BASE_URL`
- `LLM_GATEWAY_API_KEY`
- `LLM_GATEWAY_MODEL` 或 `LLM_TEXT_MODEL`
- `INDEX_MAINTAINER_EMAILS`（逗号分隔；仅这些账号可以重建、校正、校验或删除教材索引）
- `ALLOW_ANONYMOUS_LOCAL_UPLOAD=false`（只用于本地离线测试；生产上传始终要求登录）
- `DOCUMENT_INDEX_PROVIDER`、`PAGEINDEX_BASE_URL`、`PAGEINDEX_API_KEY`

认证配置只放在服务端。当前前端通过同源 `/api/auth` 使用账号能力，不需要也不应配置 `VITE_SUPABASE_*`。

可选图片能力还需要：

- `LLM_IMAGE_MODEL`
- `LLM_IMAGE_ENDPOINT`

曾在聊天中出现过的密钥必须先轮换，不能复制到源码、文档、截图或前端环境变量。

## 部署地址

- Cloudflare 公网入口：`https://app.huojiaocan.workers.dev`
- Vercel 固定源站：`https://live-teacher-guide.vercel.app`

对外演示请使用 Cloudflare 地址。

## 本地登录态全链路演练

仓库提供确定性的 Supabase/网关 mock，只用于本地功能回归，不代表真实模型质量：

```bash
cd demo
MOCK_PORT=54321 node scripts/mock-supabase.mjs > /tmp/huojiaocan-mock-data.log 2>&1 &
MOCK_PORT=54322 node scripts/mock-supabase.mjs > /tmp/huojiaocan-mock-llm.log 2>&1 &

SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_ANON_KEY=mock-anon \
SUPABASE_SERVICE_ROLE_KEY=mock-service \
USER_DEEPSEEK_KEY_ENCRYPTION_SECRET=mock-secret \
LLM_GATEWAY_BASE_URL=http://127.0.0.1:54322 \
LLM_GATEWAY_API_KEY=mock-key \
LLM_TEXT_MODEL=mock-model \
ALLOW_INDEX_PROVIDER_FALLBACK=true \
PORT=8790 node server/index.js
```

打开 `http://127.0.0.1:8790/login/`，自行注册本地演示账号后走通：登录 → 提问 → 连续追问 → 定稿 → 生成三卡 → 编辑/锁定 → 刷新恢复。

## 生产验收

公开能力：

```bash
SITE_URL=https://app.huojiaocan.workers.dev npm run verify:production
```

若需验证受保护的完整问答链路，只向当前 shell 临时注入短时 Supabase access token：

```bash
PRODUCTION_AUTH_TOKEN='短时令牌' SITE_URL=https://app.huojiaocan.workers.dev npm run verify:production
```

脚本不会读取账号密码，也不会保存令牌。

## 当前边界

- 公共教材可匿名阅读；AI、个人 Key 和草稿必须登录。
- PageIndex 为服务端索引 Provider；个人 DeepSeek 密钥不进入索引服务。
- 应用保存的是教师确认后的教学记录和班级聚合事实，不建立学生个人画像。
- 未经授权的教材原文和生产密钥不得进入仓库、日志、URL 或浏览器存储。
