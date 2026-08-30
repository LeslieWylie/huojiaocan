import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(here, 'App.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(here, 'styles.css'), 'utf8');
const model = fs.readFileSync(path.resolve(here, '../shared/lesson-study.js'), 'utf8');
const vite = fs.readFileSync(path.resolve(here, '../vite.config.js'), 'utf8');
const html = fs.readFileSync(path.resolve(here, '../study/index.html'), 'utf8');

test('5.0 lesson study is a reachable teacher workflow rather than a static concept page', () => {
  assert.match(app, /function LessonStudyPage\(/u);
  assert.match(app, /\/api\/drafts\/\$\{encodeURIComponent\(draftId\)\}\/lesson-study\/generate/u);
  assert.match(app, /确认本次教学判断/u);
  assert.match(app, /整理一课一研/u);
  assert.match(app, /\['study', '\/study\/', Microscope, '一课一研'\]/u);
  assert.match(vite, /study: page\('\.\/study\/index\.html'\)/u);
  assert.match(html, /data-route="study"/u);
});

test('lesson study visibly separates teaching assumptions, observed facts and teacher conclusions', () => {
  assert.match(app, /上课前怎么想/u);
  assert.match(app, /课堂里发生了什么/u);
  assert.match(app, /系统只整理事实，不替教师宣布“教学有效”/u);
  assert.match(model, /不代表教材结论，也不推断个别学生/u);
  assert.match(styles, /\.study-canvas/u);
  assert.match(styles, /\.study-observation/u);
  assert.match(styles, /\.study-conclusion-fields/u);
});

test('unfinished lesson-study edits are recoverable for the same account and draft version', () => {
  assert.match(app, /lessonStudyRecoveryKey/u);
  assert.match(app, /baseVersion: draft\.version/u);
  assert.match(app, /recovered\?\.userId === userId/u);
  assert.match(app, /serverStudy\.status !== 'confirmed'/u);
});
