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

function routePathsFromApp(text) {
  const block = text.match(/const ROUTES = \[([\s\S]*?)\n\];/u)?.[1] || '';
  return [...block.matchAll(/\['[^']+',\s*'([^']+)'/gu)].map(match => match[1]);
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

test('every literal internal page link resolves to a declared route', () => {
  const declared = new Set(routePathsFromApp(appSource));
  const literalHrefs = [...appSource.matchAll(/href=["'](\/[^"']*)["']/gu)]
    .map(match => match[1])
    .filter(href => !href.startsWith('/api/'));
  const unknown = [...new Set(literalHrefs.map(href => {
    const pathname = href.split(/[?#]/u, 1)[0] || '/';
    return pathname.endsWith('/') ? pathname : `${pathname}/`;
  }).filter(pathname => !declared.has(pathname)))];
  assert.deepEqual(unknown, [], `found literal links without a declared page route: ${unknown.join(', ')}`);
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

test('starting another lesson uses a recoverable in-page confirmation', async () => {
  const ask = await source(new URL('./views/ask-page.jsx', import.meta.url));
  assert.doesNotMatch(ask, /window\.confirm/u, 'native confirmation dialogs block browser recovery and must not be used');
  assert.match(ask, /role="dialog"/u);
  assert.match(ask, /保留草稿，另起一课/u);
  assert.match(ask, /当前草稿、教材依据和历史问答都会保留在账号中/u);
  assert.equal((ask.match(/<h1>\{UI_COPY\.ask\.title\}/gu) || []).length, 1, 'ask page should render one primary heading');
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
