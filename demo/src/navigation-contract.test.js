import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { appSource } from './test-app-source.js';
const vitePath = new URL('../vite.config.js', import.meta.url);

async function source(url) { return readFile(url, 'utf8'); }

function routeIdsFromApp(text) {
  const block = text.match(/const ROUTES = \[([\s\S]*?)\n\];/u)?.[1] || '';
  return [...block.matchAll(/\['([^']+)',/gu)].map(match => match[1]);
}

function entryIdsFromVite(text) {
  const block = text.match(/input:\s*\{([\s\S]*?)\n\s*\}/u)?.[1] || '';
  return [...block.matchAll(/^\s*,?([a-z][a-z-]*):\s*page\(/gmu)].map(match => match[1]);
}

test('every built page has a teacher-facing route title', async () => {
  const app = appSource;
  const vite = await source(vitePath);
  const routeIds = new Set(routeIdsFromApp(app));
  const entries = entryIdsFromVite(vite).map(id => id === 'dashboard' ? 'dashboard' : id);
  assert.ok(entries.length >= 30, `expected the full multi-page build, got ${entries.length}`);
  assert.deepEqual(entries.filter(id => !routeIds.has(id)), []);
});

test('teacher workflow entry points do not send an unbound user to a naked cards page', async () => {
  const app = appSource;
  const guide = app.match(/(?:export\s+)?function GuidancePage\(\)[\s\S]*?\n\}/u)?.[0] || '';
  const decision = app.match(/(?:export\s+)?function Decision\(\)[\s\S]*?\};\n/u)?.[0] || '';
  assert.doesNotMatch(guide, /href=["']\/cards\/["']/u);
  assert.doesNotMatch(decision, /href=["']\/cards\/["']/u);
  assert.match(guide, /继续追问并保存方案/u);
  assert.match(decision, /围绕示例开始备课/u);
});

test('ask and cards evidence links preserve their exact draft return path', async () => {
  const app = appSource;
  assert.match(app, /const askReaderReturn = draftId \? `\/ask\/\?draftId=/u);
  assert.match(app, /const cardsReaderReturn = draftId \? `\/cards\/\?draftId=/u);
  assert.match(app, /TeachingEvidenceChain chain=\{teachingEvidenceChain\} returnTo=\{cardsReaderReturn\}/u);
  assert.match(app, /DualSourceEvidenceDesk[^\n]*returnTo=\{askReaderReturn\}/u);
  assert.doesNotMatch(app, /returnTo="cards"/u);
  assert.doesNotMatch(app, /&return=share/u);
  assert.match(app, /const shareReturnTo = `\/share\/#\$\{token\}`/u);
});

test('teacher-facing copy does not expose internal feature version numbers', async () => {
  const app = appSource;
  assert.doesNotMatch(app, /活教参\s+\d+\.\d+\s*·/u);
});

test('URL lesson identity normalization is consistent with tree matching normalization', async () => {
  const app = appSource;

  // App.jsx must import normalizeLessonIdentity from reader-target.js with an
  // alias (normalizeReaderLessonIdentity) for the initial URL-correction step.
  // The reader-target.js version strips leading digits ("21 标题" → "标题"),
  // so both "21 标题" and "标题" normalise to the same key and match the same
  // tree node.
  const readerTargetImport = "import { buildPdfPageUrl, buildReaderHref, findTreeNodeByNormalizedTitle, normalizeLessonIdentity as normalizeReaderLessonIdentity, pairedDocumentId, pairedFocusQuery, pairedLessonQuery, resolveCrossDocTarget, resolveReaderReturn } from './reader-target.js';";
  assert.ok(
    app.includes(readerTargetImport),
    'App.jsx must import normalizeLessonIdentity as normalizeReaderLessonIdentity from reader-target.js'
  );

  // App.jsx must keep the shared normalizeLessonIdentity import from
  // same-lesson-comparison.js for教研资产 comparison (the shared version
  // does NOT strip leading digits, so it preserves the full lesson key for
  // asset matching).
  const sameLessonImport = "import { emptySameLessonComparison, normalizeLessonIdentity, normalizeSameLessonComparison } from '../shared/same-lesson-comparison.js';";
  assert.ok(
    app.includes(sameLessonImport),
    'App.jsx must keep normalizeLessonIdentity import from same-lesson-comparison.js for教研资产 comparison'
  );

  // The URL lesson normalization call site must use the reader-target alias
  // (normalizeReaderLessonIdentity), not the shared variant.
  assert.ok(
    app.includes('const normalized = normalizeReaderLessonIdentity(urlLesson)'),
    'The address-correction effect must call normalizeReaderLessonIdentity(urlLesson) ' +
    'with the reader-target normalizer, which strips leading digits so that ' +
    '"21 标题" and "标题" match the same tree node.'
  );

  // Behaviour assertion: the reader-target normalizer strips leading digits,
  // so both "21 标题" and "标题" produce the same normalised key.
  // (This is a white-box check on the normalizer's contract.)
  const { normalizeLessonIdentity } = await import('./reader-target.js');
  assert.equal(
    normalizeLessonIdentity('21 你是人间的四月天'),
    normalizeLessonIdentity('你是人间的四月天'),
    'normalizeLessonIdentity must strip leading digits so that "21 标题" and "标题" match the same tree node'
  );
});
