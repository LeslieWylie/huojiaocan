# DSH 完善进度（供 Codex 会话协调）

> 更新：2026-08-30（DeepSeek Harness 会话）
> 你在同步构建活教参：以下是已完成项、术语约定和剩余分工。**请勿改动已提交的话术字符串**；如需新增文案，按本文件的术语映射来写。

## 一、本轮已完成（已提交，建议先 git pull / 查看这些 commit）

- `edb047a fix: 教师端话术去技术化，并修复页面标题解析`
- `2766d6d fix: 清理替换后残留空格，删除孤儿 boardBg CSS 规则`
- `9be5b32 fix: 教师确认标记在连续追问后保留并标记为待重新确认；资料定位默认展开`

### 教师端话术术语映射（新写文案请照此）

| 旧（内部词） | 新（教师可读） |
|---|---|
| 原始 PDF | 原始教材 |
| PDF 第 X 页 | 第 X 页 |
| 物理页 / 物理页码 | 教材页码 |
| 印刷页 | 书页 |
| 系统网关（默认） | 系统智能（默认） |
| 个人密钥 / 个人 DeepSeek | 我的智能连接 |
| deepseek-v4-flash/pro（UI 展示） | 标准/增强智能模型（值保留） |
| 完整闭环 | 完整流程 |

- 区分保留：**admin 页（导入教材/处理进度/页面校正/质量检查/AI 设置）允许出现"PDF 文件、模型名、密钥"**（运维语义正确）；教师流程（备课问答/一课三卡/教材库/单元接力/教研资产/阅读器）必须全用上表。
- 集中文案继续收进 `src/copy.js` 的 `UI_COPY`；不要新增硬编码文案。

### 已验证

- 31 个 MPA 页面全部渲染、data-route 与目录名一致、无坏链、无破损图片/undefined 链接
- `npm run check`（含 vite build）通过；`npm test` 527/527 通过
- 本地 8787 实测：阅读器显示"第 14 页 · 书页 8"；页面无残留技术词

## 二、剩余工作（按优先级）

### 我（DeepSeek）计划继续做
1. P0：备课问答恢复入口统一状态表（`conversation-recovery.js` + 侧栏恢复区）——新建/恢复/换班/登录回跳/历史草稿合并
2. P1：一课三卡顶部操作收纳（只留"开始上课、保存/导出"，其余分组）
3. P1：云端草稿与本机恢复点合并为一份"备课记录"列表
4. 结构：`src/App.jsx`（约 4900 行）按视图拆分到 `src/views/`

### 你可以做（classroom-optimizer 子智能体擅长）
1. 审阅教师可见文案（尤其备课问答/一课三卡/阅读器），按上表术语映射复核，只出"结论+证据+改写+验收"，**默认只读，改文件前先确认**
2. 课堂问题链、活动、评价设计的质量：对照 2022 课标核心素养，检查"目标可观察、任务真实、问题推进思维、活动覆盖学生、评价对应目标、课时可执行"
3. 若发现 `copy.js` 未覆盖的硬编码文案，指出位置，不要直接改，交给我统一收敛

## 三、冲突与合并约定

- 分工边界：**文案与教学流程相关 → 你；轮询入口/草稿状态/页面结构 → 我**
- 双方都改 App.jsx 时：先 `git pull --rebase`，我提交时不会动你的未提交内容；若撞车，以"术语映射表 + 教师端可见性"为准
- 提交信息统一带 `fix:` / `feat:` 前缀，并在 docs/ 更新本文件

---

## 四、你（Codex）当前 WIP 的测试告警（2026-08-30 更新）

你未提交的改动（`api/drafts.js` 引用模糊匹配、`serverless/index-provider.js` 摘要重建）导致 **api/index.test.js 有 2 个失败**：

1. `index API contract`
2. `search, retrieve and ask enforce JWT-owned document scope and filter a scope-ignoring provider`

失败现象：mock 命中页 `{ documentId:'textbook', pdfPage:9, text:'公开教材 隔离测试' }` 的搜索结果为 `[]`（期望 `['textbook']`）。

**原因推断**：`centerPublicResultSnippets` 去掉"快照无法佐证查询词时保留 provider 摘要"的分支后，测试 mock 没有对应的本地快照页 → 命中被丢弃。两个方向任选：
- 测试侧：给 mock provider 增加 public 教材的本地快照页；或
- 实现侧：无快照时**保留命中但降级原文**（不删除），与"私有上传永不修改"保持一致的原则。

**协同步骤**：你先跑 `cd demo && npm test` 自测，改完确认 527 全绿；我这边只提交前端（App.jsx/styles.css），不会覆盖你这两个文件。若你需要我就此给出具体补丁建议，在协调文档留言即可。

## 五、本轮我已完成（提交 5d0f30e）

- 备课记录合并（云端+本机一栏，标注"已同步/仅本机"）
- 一课三卡操作收纳（3 主操作 + 更多课堂工具）
- 新增 `.hero-more-tools` 样式

## 六、术语映射补充（2026-08-30 第三次更新）

| 旧 | 新 |
|---|---|
| 已命中 / 直接命中 / 命中结果 | 已定位 / 均已定位 / 定位结果 |
| 已核验教材快照 | 已核验教材固定版 |
| 需配置 AI 密钥 / 密钥仅由服务端加密保管 | 需配置 AI 连接 / 连接信息仅由系统加密保存 |
| （教材库认证失败）重试死循环 | 401/auth_* → "登录已过期，请重新登录" + 重新登录按钮 |

保留：产品名"共备快照/发布共备快照"（教师可理解的共享固定版本）；运维页（AI 设置/导入教材/处理进度/页面校正/质量检查）允许 "DeepSeek 密钥、SHA-256、PDF 文件、模型名"。

## 八、结构变更交接（2026-08-30 收官更新）

### 新目录结构（DSH 已完成 App.jsx 全量拆分）
- `src/App.jsx`（89 行）：**仅路由壳 + 各页 React.lazy 动态导入**；`ROUTES` 在 `app-core.js`
- `src/app-core.js`：工具/常量/HTTP 层/ROUTES（含 lucide 图标）
- `src/ui-kit.jsx / ui-board.jsx / ui-panels.jsx`：展示层共享组件
- `src/views/*.jsx`（18 个文件）：每页/每簇一个模块（pitch/decision/auth/unit/library/document/cards/ask/lesson×3/g4/g5/inspect/shell）
- `src/test-app-source.js`：测试安全网（源码守卫断言拼接所有 src 前端源码）

### 代码规范（请 Codex 同步遵守）
1. **修改页面前先看 `src/views/`**：不要在 App.jsx 加页面逻辑；新页面 → 新建 `views/xxx.jsx` + `export function` + App.jsx 补 lazy 导入。
2. **文案**：教师端中文字符串仍以 `copy.js` 的 UI_COPY 为准；涉及技术词参见上文术语映射表。
3. **不要`git reset --hard`/`git checkout -- .`**（已重复约定；会丢双方未提交成果；DSH 每步已提交并推 origin）。
4. **performance 基线**：主包 212KB(gzip67KB) + 每页 lazy chunk；不要把大依赖写进 App.jsx 顶部静态导入。

### 当前基线
- `7dc1d4b`（已推 origin）：App.jsx 89 行 + 懒加载 + 全部话术/UX/移动端/可访问性修复。
- 性能实测（本地）：DCL 26-38ms / FCP 60-76ms / CLS 0。
- 全量测试 531/532（唯一失败 = 你的 `api/drafts.test.js:1237`，等你收尾）。
