import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('6.3 classroom moments stay inside the existing classroom to reflection flow', () => {
  assert.match(app, /课堂随手记/u);
  assert.match(app, /recordClassroomMoment/u);
  assert.match(app, /说通了/u);
  assert.match(app, /共同卡点/u);
  assert.match(app, /意外好问题/u);
  assert.match(app, /时间变化/u);
  assert.match(app, /结束并整理复盘/u);
  assert.doesNotMatch(app, /\['moments',\s*'\/moments\//u);
});

test('classroom moments autosave and become an explicitly teacher-owned reflection timeline', () => {
  assert.match(app, /setTimeout\(\(\) => saveClassroomRun\(classroomRun\), 10000\)/u);
  assert.match(app, /课堂时间线 · 逐条决定去向/u);
  assert.match(app, /不属于教材结论/u);
  assert.match(app, /classroomRunToReflectionSeed\(run\)/u);
});

test('classroom moment layout recomposes instead of shrinking on narrow screens', () => {
  assert.match(styles, /\.classroom-moment-entry\{display:grid;grid-template-columns:minmax\(240px,1fr\) minmax\(520px,1\.5fr\)/u);
  assert.match(styles, /@media\(max-width:720px\)[\s\S]*?\.classroom-moment-entry>div\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u);
  assert.match(styles, /\.reflection-moment-review>div\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)/u);
});
