import { appSource } from './test-app-source.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = appSource;
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../observation/index.html', import.meta.url), 'utf8');

test('5.3 observation protocol is generated from a confirmed comparison and is directly printable', () => {
  assert.match(app, /function ObservationProtocolPage\(\)/u);
  assert.match(app, /compare\/\$\{encodeURIComponent\(rightId\)\}\/observation/u);
  assert.match(app, /observationProtocolMarkdown\(protocol\)/u);
  assert.match(app, /window\.print\(\)/u);
  assert.match(app, /生成听评课观察单/u);
  assert.match(page, /data-route="observation"/u);
});

test('observation protocol records classroom evidence without ranking teachers or identifying students', () => {
  const start = app.indexOf('function ObservationProtocolPage');
  const end = app.indexOf('function TeachingSharePage', start);
  const view = app.slice(start, end);
  assert.match(view, /不评价教师表现/u);
  assert.match(view, /课堂事件/u);
  assert.match(view, /学生表现/u);
  assert.match(view, /教师动作/u);
  assert.match(view, /教材原文依据/u);
  assert.match(view, /不记录学生身份/u);
  assert.doesNotMatch(view, /教师排名|教师得分|学生姓名|学号|座位号/u);
});

test('observation protocol has a landscape print composition and a narrow-screen fallback', () => {
  assert.match(styles, /@media print\{[^}]*@page\{size:A4 landscape/u);
  assert.match(styles, /\.sidebar,\.topbar,\.no-print\{display:none!important\}/u);
  assert.match(styles, /\.observation-record table\{width:100%;border-collapse:collapse;table-layout:fixed\}/u);
  assert.match(styles, /@media\(max-width:800px\)[\s\S]*?\.observation-record table\{min-width:800px\}/u);
});
