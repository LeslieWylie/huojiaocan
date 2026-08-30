import { appSource } from './test-app-source.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = appSource;
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../slides/index.html', import.meta.url), 'utf8');

test('6.0 teaching slides are reachable from navigation and confirmed classroom design', () => {
  assert.match(app, /\['slides', '\/slides\/', PanelTop, '课堂课件'\]/u);
  assert.match(app, /function TeachingSlidesPage\(\)/u);
  assert.match(app, /生成课堂课件/u);
  assert.match(app, /\/api\/drafts\/\$\{encodeURIComponent\(draftId\)\}\/slides/u);
  assert.match(page, /data-route="slides"/u);
});

test('slides explicitly separate the student projector from teacher-only preparation notes', () => {
  const start = app.indexOf('function TeachingSlidesPage');
  const end = app.indexOf('function ObservationProtocolPage', start);
  const view = app.slice(start, end);
  assert.match(view, /学生投屏/u);
  assert.match(view, /教师备课/u);
  assert.match(view, /教师提示（不会进入投屏文件）/u);
  assert.match(view, /学生投屏隔离/u);
  assert.match(view, /teachingSlideDeckHtml\(deck\)/u);
});

test('slide workbench keeps a large projection canvas and recomposes on narrow screens', () => {
  assert.match(styles, /\.slides-workbench\{display:grid;grid-template-columns:230px minmax\(480px,1fr\) 350px/u);
  assert.match(styles, /\.slides-stage:fullscreen\{width:100vw;height:100vh/u);
  assert.match(styles, /@media\(max-width:760px\)[\s\S]*?\.slides-workbench\{grid-template-columns:1fr\}/u);
  assert.match(styles, /\.slides-thumbnails\{display:flex;overflow-x:auto/u);
});
