import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('10.0 combines multi-class reuse and teacher handoff without adding navigation', () => {
  assert.match(app, /教学接棒/u);
  assert.match(app, /\/adapt-class/u);
  assert.match(app, /sourceVersion: draft\.version/u);
  assert.match(app, /targetClassName: target/u);
  assert.match(app, /保留：<\/b>篇目、教材页码、教学主线和三卡内容/u);
  assert.match(app, /隔离课堂记录与学生信息/u);
  assert.match(app, /buildSubstituteTeachingPack/u);
  assert.match(app, /下载代课交接单/u);
  const primaryNav = app.match(/const PRIMARY_NAV = \[([\s\S]*?)\n\];/u)?.[1] || '';
  assert.equal((primaryNav.match(/^\s*\[/gmu) || []).length, 6);
});

test('class adaptation preserves pending work and continues inside the same ask flow', () => {
  assert.match(app, /当前还有未保存修改，请先保存后再建立目标班版本/u);
  assert.match(app, /\/ask\/\?draftId=\$\{encodeURIComponent\(nextId\)\}&adapt=1/u);
  assert.doesNotMatch(app, /\/ask\/\?draftId=\$\{encodeURIComponent\(nextId\)\}&q=/u);
  assert.match(app, /系统不会自动改写方案，也不会清空原有三卡/u);
});

test('class adaptation layout recomposes instead of squeezing the desktop grid', () => {
  assert.match(css, /\.class-adaptation-body\{display:grid;grid-template-columns:minmax\(240px,\.72fr\) minmax\(0,1\.35fr\)/u);
  assert.match(css, /@media\(max-width:1050px\)\{\.class-adaptation-body\{grid-template-columns:1fr\}/u);
  assert.match(css, /@media\(max-width:680px\)[\s\S]*?\.class-adaptation-form\{grid-template-columns:1fr\}/u);
  assert.match(css, /\.class-adaptation-form input\{[^}]*height:46px/u);
  assert.match(css, /\.cards-page button\{min-height:44px!important\}/u);
});
