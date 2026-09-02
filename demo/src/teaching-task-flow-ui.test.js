import { appSource } from './test-app-source.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const app = appSource;
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('8.0 makes the teacher next action and class continuity a first-class home workflow', () => {
  assert.match(app, /班级接续/u);
  assert.match(app, /rootRequest\('\/api\/drafts\/tasks'\)/u);
  assert.match(app, /rootRequest\('\/api\/drafts\/class-profiles'\)/u);
  assert.match(app, /每份方案只显示一个最关键的下一步/u);
  assert.match(app, /只汇总教师确认的班级事实，不保存学生姓名与逐人表现/u);
  assert.match(app, /\['dashboard', '\/', Route, '教学任务'\]/u);
  assert.match(app, /TASK_PHASE_META/u);
  const primaryNav = app.match(/const PRIMARY_NAV = \[([\s\S]*?)\n\];/u)?.[1] || '';
  assert.equal((primaryNav.match(/^\s*\[/gmu) || []).length, 4);
  assert.match(app, /MORE_TOOL_NAV/u);
  assert.match(app, /更多工具/u);
  assert.match(app, /TASK_PHASE_META\[task\.phase\] \|\| TASK_PHASE_META\.continue_preparation/u);
});

test('task flow has honest login, loading, error and empty states', () => {
  assert.match(app, /登录后显示个人任务/u);
  assert.match(app, /正在读取你的方案状态/u);
  assert.match(app, /个人教学任务暂时没有读取完整/u);
  assert.match(app, /当前没有未完成的教学任务/u);
  assert.match(app, /不会建立学生个人画像/u);
});

test('task flow CSS recomposes at desktop, tablet and phone widths', () => {
  assert.match(css, /\.teaching-flow-layout\{display:grid;grid-template-columns:minmax\(0,1fr\) 350px/u);
  assert.match(css, /@media\(max-width:1180px\)[\s\S]*?\.teaching-flow-layout\{grid-template-columns:1fr\}/u);
  assert.match(css, /@media\(max-width:820px\)[\s\S]*?\.teaching-task-list>li\{grid-template-columns:48px minmax\(0,1fr\)/u);
  assert.match(css, /@media\(max-width:520px\)[\s\S]*?\.teaching-task-list>li\{grid-template-columns:1fr/u);
  assert.match(css, /\.teaching-task-list>li>a\{[^}]*min-height:44px/u);
  assert.match(css, /\.sidebar-tool-group>div\{display:grid;grid-template-columns:1fr 1fr/u);
  assert.match(css, /\.class-continuity-panel>div>a\{display:grid/u);
  assert.match(css, /\.mobile-menu\{width:44px!important;height:44px!important\}/u);
});
