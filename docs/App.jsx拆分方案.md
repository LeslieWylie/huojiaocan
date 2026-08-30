# App.jsx 拆分方案（待执行）

> 编写：2026-08-30（DeepSeek Harness）
> 状态：**已完成 ✅（2026-08-30 第 23 轮收官）**
> 结果：App.jsx 4946 → 89 行（纯路由壳）；31/31 页 0 运行时异常；179/0 守卫测试全绿；远端已同步 9787944。
> 执行日志见 docs/DSH完善进度-供Codex协调.md 各轮小结。
> 目标：把约 4900 行单文件拆成按页面的模块，降低后续迭代与合并成本，且**行为零变化**。

## 一、现状

`src/App.jsx`（约 4946 行）包含：
- 第 1—199 行：imports、`API` 常量、`fetchJson`/`request`、UI_COPY 引入、纯工具函数（scopeDocumentIds / docName / citationLink / normalizeShelfItem / boardLabelFromText / planIdentity / cardGuidance 等）与常量表（CARD_EDIT_GUIDANCE、GUIDANCE_STEPS、CLASSROOM_STAGE_LABELS 等）
- 第 200—317 行：原子组件（Logo/Badge/Stat/SectionHead/Sidebar/Layout）+ GuidancePage/Dashboard
- 第 318—4946 行：31 个页面/视图组件（见下方映射表）

## 二、目标结构

```
src/
  app-core.js        # 工具函数、常量表、纯组件(Badge/Stat/SectionHead...)  ← 从 App.jsx 迁出
  copy.js            # 已独立的文案（保持）
  views/
    dashboard.jsx    # Dashboard/教学任务
    guidance.jsx     # GuidancePage
    decision.jsx     # Decision
    unit.jsx         # Unit + board 相关(SvgLabel/MindMapBoard/CardSourceList...) + PeriodPlanner
    cards.jsx        # Cards（最大，约 800 行）
    ask.jsx          # AskPage + 其子组件(ConversationTurn/RouteTrace/PlanAnswer/EvidenceShelf/
                     #   DualSourceEvidenceDesk/WorkflowChecklist/ConversationSide/...)
    library.jsx      # LibraryPage + Tree
    document.jsx     # DocumentPage + ProviderResult
    align.jsx        # CurriculumAlignmentPage
    inspect.jsx      # IngestPage/JobsPage/InspectPage/ValidationPage
    assets.jsx       # AssetsPage + AssetCoverage/PlanQualitySummary/SharedPlanList
    research.jsx     # ResearchLedgerPage + ComparisonPractice/SameLessonComparisonPage
    lesson.jsx       # RehearsalPage/PreClassPulsePage/ClassroomWorksheetPage/LearningEvidencePage
    reflections.jsx  # ReflectionPage/LessonStudyPage/TeachingSlidesPage/LayeredHomeworkPage/
                     #   AnonymousMarkingPage/ObservationProtocolPage
    share.jsx        # TeachingSharePage
    misc.jsx         # LoginPage/SettingsPage/Pitch
  App.jsx            # 仅保留 App() 壳：路由分支 + 全局状态 + Layout
```

行→页面映射（现 App.jsx 行号，以 2026-08-30 为基准）：
| 组件 | 起行 | 归入 |
|---|---|---|
| Logo/Badge/Stat/SectionHead/Sidebar/Layout | 200-317 | app-core.jsx（改为 .jsx） |
| Dashboard | 337 | views/dashboard.jsx |
| GuidancePage | 318 | views/guidance.jsx |
| Decision | 375 | views/decision.jsx |
| Unit + MindMapBoard 等 | 376-701 | views/unit.jsx |
| SvgLabel 等 board 助手 | 702-836 | views/unit.jsx（或 ui-board.jsx） |
| Cards | 896-1734 | views/cards.jsx |
| Rehearsal..Worksheet | 1735-1994 | views/lesson.jsx |
| Learning..Reflection | 1995-2455 | views/lesson.jsx / reflections.jsx |
| LessonStudy..Observation | 2456-2896 | views/reflections.jsx |
| Share/Research/Assets/Pitch | 2949-3187 | views/share.jsx 等 |
| LibraryPage+Tree | 3188-3472 | views/library.jsx |
| ask 子组件+AskPage | 3473-4258 | views/ask.jsx |
| Ingest..Validation | 4259-4524 | views/inspect.jsx |
| DocumentPage | 4525-4749 | views/document.jsx |
| Alignment/Login/Settings | 4750-4946 | views/align.jsx、views/auth-settings.jsx |

## 三、执行步骤（每步一个提交，可独立回滚）

### 步骤 0 — 测试安全网（先做，最优先）
把 `src/major-iteration.test.js` 等测试的 `appSource` 从"只读 App.jsx"改为**拼接所有 src 前端源码**：
```js
const srcDir = path.resolve(process.cwd(), 'src');
const appSource = [ 'App.jsx', 'app-core.js', ...fs.readdirSync(srcDir).filter(f => /^(views\/)?.*\.(jsx|js)$/.test(f)) ]
  .flatMap(f => { try { return fs.readFileSync(path.join(srcDir, f), 'utf8'); } catch { return ''; } })
  .join('\n');
```
这样**先建立"代码在哪都能被守卫测试找到"的安全网**，之后每步迁移都不会触发守卫回归。
（其他测试文件如 teaching-share-ui.test.js 同法处理。）

### 步骤 1 — 抽出 app-core.js
纯函数/常量（无 JSX）先迁：docName、citationLink、normalizeShelfItem、scopeDocumentIds、planIdentity、boardLabelFromText、wrapSvgText、CARD_EDIT_GUIDANCE、GUIDANCE_STEPS、CLASSROOM_STAGE_LABELS、statusLabel 映射、范围常量等。
- App.jsx 顶部改为 `import { ... } from './app-core.js'`
- 回车 + `npm run check` + `node --test src/*.test.js`（安全网下应全绿）

### 步骤 2 — 原子组件层
Logo/Badge/Stat/SectionHead/Sidebar/Layout → `src/ui-kit.jsx`（无状态，纯 props）。

### 步骤 3+ — 按页面迁移 views/*.jsx
顺序（先小后大）：Pitch → Decision → GuidancePage → Dashboard → Alignment → Login/Settings → Unit → Library → Document → 板书工具 → Cards → AskPage → 其余。
每个页面迁移时：
1. 把该组件（含其私有子组件）整段搬入 `views/xxx.jsx`
2. 顶部从 `app-core.js`、`ui-kit.jsx` 导入所需符号（lucide 图标按需导入）
3. App.jsx 只留 `import XxxPage from './views/xxx.jsx'` + 路由分支
4. 每 2—3 个页面一个提交，跑 `npm run check` + 全量 `npm test` + ego-browser 扫该页渲染、无 console 错误

### 收尾
- `npm run check`（vite build）通过；`npm test` 全绿（525/527，其中 2 个属 Codex 域，以其收尾为准）
- ego-browser 全页面扫雷 31/31 + 主链路回归
- 更新 docs/ 协调文档，注明新目录结构，Codex 后续改 App.jsx 前先看本方案

## 四、风险与约束

1. **行为零变化**：只移动代码，不改逻辑、不改文案字符串、不改 className。
2. **文案位置变化**：守卫测试在步骤 0 后不再绑定文件位置，安全。
3. **与 Codex 冲突**：执行前在文档确认"Codex 近期不改 App.jsx"；若冲突，以 `git stash` + 分步验证恢复。
4. **回滚**：每步独立提交，任一步构建/测试失败即 `git revert` 该步。
5. **引用完整性**：迁移后立即 grep 找出 App.jsx 中残留的未定义引用（vite build 会兜底报错）。

## 五、预期收益

- App.jsx 从 ~4900 行降到 ~300 行（壳 + 路由）
- 单页面改动不再触发整文件 diff，Codex 与我合并冲突面缩小 90%
- 新视图可独立测试（每页可加页面级 contract 测试）
- 与 serverless/ 的模块化风格对齐，符合"仓库会持续演进"的预期
