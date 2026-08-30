import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../marking/index.html', import.meta.url), 'utf8');

test('6.2 anonymous marking is reachable from a confirmed homework pack', () => {
  assert.match(app, /\['marking', '\/marking\/', FileCheck2, '匿名批改'\]/u);
  assert.match(app, /function AnonymousMarkingPage\(\)/u);
  assert.match(app, /批改匿名答案/u);
  assert.match(app, /\/homework-review\/analyze/u);
  assert.match(page, /data-route="marking"/u);
});

test('the marking UI never promises to store raw student answers', () => {
  const start = app.indexOf('function AnonymousMarkingPage');
  const end = app.indexOf('function ObservationProtocolPage', start);
  const view = app.slice(start, end);
  assert.match(view, /答案原文已从页面清除/u);
  assert.match(view, /输入内容不会写入本地恢复或草稿/u);
  assert.match(view, /这里只保存数量、共性问题和后续动作，不保存学生原文/u);
  assert.doesNotMatch(view, /localStorage/u);
  assert.match(view, /homeworkReviewCsv\(results\)/u);
});

test('marking workbench keeps input feedback and class decision distinct on narrow screens', () => {
  assert.match(styles, /\.marking-workbench\{display:grid;grid-template-columns:300px minmax\(390px,1fr\) 330px/u);
  assert.match(styles, /\.marking-summary\{position:sticky/u);
  assert.match(styles, /@media\(max-width:820px\)[\s\S]*?\.marking-workbench\{grid-template-columns:1fr\}/u);
});
