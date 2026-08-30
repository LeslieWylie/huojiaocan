# 活教参 1.2

“活教参”面向教师备课：选择教材篇目，查看原始 PDF 依据，调用个人 DeepSeek Key 生成可执行方案，并保存、编辑和锁定一课三卡。

## 核心工作区

1. **教材库**：动态读取文档、PageIndex 目录、搜索和原始 PDF 核验。
2. **备课问答**：在课时、班级、目标和教学方式条件下生成结构化方案。
3. **课堂设计**：保存草稿，编辑、锁定和导出板书卡、提问卡、评价卡。

## 已核验证据样例

- 教材 PDF 第 7 页：第一单元“活动·探究”与三项任务；
- 教材 PDF 第 7—8 页：学习鉴赏及六篇诗歌结构；
- 教材 PDF 第 20 页：诗歌朗诵；
- 教材 PDF 第 24—26 页：尝试创作；
- 教师教学用书 PDF 第 51 页：教学目标；
- 教师教学用书 PDF 第 51—53 页：重点难点；
- 教师教学用书 PDF 第 53 页：建议 1 课时；
- 教师教学用书 PDF 第 54—56 页：教学活动建议。

原始 PDF 是展示真源；解析文本只用于检索和复制。所有引用由服务端根据检索结果绑定，模型不能生成页码或 PDF 地址。

## 本地运行

前置条件：Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

浏览器访问 `http://127.0.0.1:5173`。

验证生产构建：

```bash
npm run check
npm run build
npm run start
```

## DeepSeek 与账号

问答只使用 DeepSeek 官方 API。用户登录后在 `/settings/` 添加自己的 Key；数据库只保存 AES-256-GCM 加密结果，前端只看到末四位和 Key ID。服务端固定请求 `https://api.deepseek.com/chat/completions`，只允许 `deepseek-v4-flash` 和 `deepseek-v4-pro`。

服务端环境变量：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `USER_DEEPSEEK_KEY_ENCRYPTION_SECRET`
- `INDEX_MAINTAINER_EMAILS`（逗号分隔；仅这些账号可以重建、校正、校验或删除教材索引）
- `ALLOW_ANONYMOUS_LOCAL_UPLOAD=false`（只用于本地离线测试；生产上传始终要求登录）
- `DOCUMENT_INDEX_PROVIDER`、`PAGEINDEX_BASE_URL`、`PAGEINDEX_API_KEY`

认证配置只放在服务端。当前前端通过同源 `/api/auth` 使用账号能力，不需要也不应配置 `VITE_SUPABASE_*`。

图片生成还需要：

- `LLM_IMAGE_MODEL`
- `LLM_IMAGE_ENDPOINT`

曾在聊天中出现过的密钥必须先轮换，不能复制到源码、文档、截图或前端环境变量。

## 部署地址

- Cloudflare 公网入口：`https://app.huojiaocan.workers.dev`
- Vercel 固定源站：`https://live-teacher-guide.vercel.app`

对外演示请使用 Cloudflare 地址。

## 当前边界

- 公共教材可匿名阅读；AI、个人 Key 和草稿必须登录。
- PageIndex 为服务端索引 Provider；用户 Key 不进入索引服务。
- 暂不包含多租户后台、复杂审计和大规模任务调度。
