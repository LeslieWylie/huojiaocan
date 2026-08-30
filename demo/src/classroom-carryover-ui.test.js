import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('6.4 classroom carryover closes the loop inside reflection and the next lesson', () => {
  assert.match(app, /课堂时间线 · 逐条决定去向/u);
  assert.match(app, /写入本课复盘/u);
  assert.match(app, /带到下一课/u);
  assert.match(app, /本次忽略/u);
  assert.match(app, /上一课待接事项/u);
  assert.match(app, /\/carryover\/\$\{encodeURIComponent\(item\.sourceMomentId\)\}/u);
});

test('carryover copy must be explicit and the UI keeps it separate from textbook authority', () => {
  assert.match(app, /至少写 4 个字/u);
  assert.match(app, /不属于教材结论/u);
  assert.match(app, /处理时仍要回到本课学生教材与教师用书/u);
  assert.match(app, /处理后点一下完成/u);
});

test('carryover layouts recompose at tablet and phone widths', () => {
  assert.match(styles, /@media\(max-width:1024px\)[\s\S]*?\.reflection-moment-review>div\{grid-template-columns:1fr\}/u);
  assert.match(styles, /@media\(max-width:1024px\)[\s\S]*?\.prior-carryover-panel>div\{grid-template-columns:1fr\}/u);
  assert.match(styles, /@media\(max-width:620px\)[\s\S]*?\.reflection-moment-actions\{grid-template-columns:1fr\}/u);
  assert.match(styles, /@media\(max-width:620px\)[\s\S]*?\.prior-carryover-panel>div>button\{grid-template-columns:24px minmax\(0,1fr\)/u);
});
