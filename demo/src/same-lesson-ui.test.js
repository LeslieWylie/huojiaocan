import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../compare/index.html', import.meta.url), 'utf8');

test('5.1 same-lesson comparison is a reachable teacher workflow', () => {
  assert.match(app, /\['compare', '\/compare\/', GitCompareArrows, '同课异构'\]/u);
  assert.match(app, /function SameLessonComparisonPage\(\)/u);
  assert.match(app, /\/api\/assets\/\$\{encodeURIComponent\(leftId\)\}\/compare\/\$\{encodeURIComponent\(rightId\)\}/u);
  assert.match(page, /data-route="compare"/u);
});

test('comparison language prevents ranking and causal overclaiming', () => {
  assert.match(app, /不评哪节课更好/u);
  assert.match(app, /不把达成比例直接解释为教学因果/u);
  assert.match(app, /不把相关性写成因果/u);
  assert.match(app, /适用边界/u);
  assert.match(app, /下一次怎样继续验证/u);
});

test('same-lesson comparison has responsive, readable practice and synthesis layouts', () => {
  assert.match(styles, /\.comparison-grid\{display:grid;grid-template-columns:repeat\(2/u);
  assert.match(styles, /\.comparison-practice>section>p\{[^}]*font-size:16px/u);
  assert.match(styles, /@media\(max-width:1050px\)\{\.comparison-grid\{grid-template-columns:1fr/u);
  assert.match(styles, /\.comparison-fields textarea\{[^}]*font:15px/u);
});
