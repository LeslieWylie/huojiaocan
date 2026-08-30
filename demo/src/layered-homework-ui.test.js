import { appSource } from './test-app-source.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = appSource;
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../homework/index.html', import.meta.url), 'utf8');

test('6.1 layered homework is reachable from classroom design and has its own route', () => {
  assert.match(app, /\['homework', '\/homework\/', ClipboardCheck, '分层作业'\]/u);
  assert.match(app, /function LayeredHomeworkPage\(\)/u);
  assert.match(app, /生成分层作业/u);
  assert.match(app, /\/api\/drafts\/\$\{encodeURIComponent\(draftId\)\}\/homework-pack/u);
  assert.match(page, /data-route="homework"/u);
});

test('student assignment and teacher marking guide remain explicit separate views and exports', () => {
  const start = app.indexOf('function LayeredHomeworkPage');
  const end = app.indexOf('function ObservationProtocolPage', start);
  const view = app.slice(start, end);
  assert.match(view, /学生作业/u);
  assert.match(view, /教师批改单/u);
  assert.match(view, /参考要点（每行一项）/u);
  assert.match(view, /学生与教师内容分开/u);
  assert.match(view, /layeredHomeworkStudentHtml\(pack\)/u);
  assert.match(view, /layeredHomeworkTeacherMarkdown\(pack\)/u);
});

test('homework workbench is paper-led and recomposes on narrow screens', () => {
  assert.match(styles, /\.homework-workbench\{display:grid;grid-template-columns:220px minmax\(500px,1fr\) 370px/u);
  assert.match(styles, /\.homework-paper\{min-width:0;min-height:720px/u);
  assert.match(styles, /@media\(max-width:760px\)[\s\S]*?\.homework-workbench\{grid-template-columns:1fr\}/u);
  assert.match(styles, /\.homework-levels\{display:flex;overflow-x:auto/u);
});
