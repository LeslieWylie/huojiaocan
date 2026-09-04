import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeCatalogItem } from './app-core.js';

const librarySource = readFileSync(new URL('./views/library-page.jsx', import.meta.url), 'utf8');
const readerSource = readFileSync(new URL('./views/document-page.jsx', import.meta.url), 'utf8');

test('catalog normalization is shared by the library, reader and application shell', () => {
  const guide = normalizeCatalogItem({
    id: 'teacher-guide',
    documentType: 'teacher_guide',
    title: '九上教师教学用书',
    pageCount: 612,
    indexed_pages: 612
  });
  assert.equal(guide.documentType, 'teacher_guide');
  assert.equal(guide.short, '教师教学用书');
  assert.equal(guide.pageCount, 612);
  assert.equal(guide.indexedPages, 612);
  assert.equal(guide.tone, 'blue');
  assert.equal(normalizeCatalogItem(null), null);
});

test('catalog-backed pages import the shared normalizer instead of relying on a missing global', () => {
  assert.match(librarySource, /import \{[^\n]*normalizeCatalogItem[^\n]*\} from '\.\.\/app-core\.js';/u);
  assert.match(readerSource, /import \{[^\n]*normalizeCatalogItem[^\n]*\} from '\.\.\/app-core\.js';/u);
});
