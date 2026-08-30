import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../research/index.html', import.meta.url), 'utf8');

test('5.2 research ledger is reachable from navigation and teaching assets', () => {
  assert.match(app, /\['research', '\/research\/', FileText, '教研问题簿'\]/u);
  assert.match(app, /function ResearchLedgerPage\(\)/u);
  assert.match(app, /rootRequest\('\/api\/assets\/research'\)/u);
  assert.match(app, /打开教研问题簿/u);
  assert.match(page, /data-route="research"/u);
});

test('research ledger tracks the next research move instead of vanity generation metrics', () => {
  assert.match(app, /不统计做了多少份方案/u);
  assert.match(app, /课堂样本/u);
  assert.match(app, /可开始对照/u);
  assert.match(app, /已确认命题/u);
  assert.match(app, /下一步/u);
  assert.doesNotMatch(app.slice(app.indexOf('function ResearchLedgerPage'), app.indexOf('function AssetsPage')), /调用次数|Token|生成量统计/u);
});

test('research ledger recomposes for narrow screens', () => {
  assert.match(styles, /\.research-line-body\{display:grid;grid-template-columns:/u);
  assert.match(styles, /@media\(max-width:1050px\)\{\.research-seal\{display:none\}\.research-line-body\{grid-template-columns:1fr/u);
  assert.match(styles, /\.research-hypothesis blockquote\{[^}]*font:600 18px/u);
});
