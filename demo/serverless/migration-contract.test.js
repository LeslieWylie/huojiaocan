import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationUrl = new URL('../../supabase/migrations/202608060001_pdf_index_core.sql', import.meta.url);
const sql = fs.readFileSync(migrationUrl, 'utf8');

const requiredTables = [
  'documents',
  'document_pages',
  'page_extraction_attempts',
  'ingestion_jobs',
  'ingestion_job_pages',
  'document_nodes',
  'document_links'
];

test('PDF index migration defines all required tables and page uniqueness', () => {
  for (const table of requiredTables) {
    assert.match(sql, new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}\\s*\\(`, 'i'));
  }
  assert.match(sql, /unique\s*\(\s*document_id\s*,\s*pdf_page_number\s*\)/i);
  assert.match(sql, /create\s+unique\s+index[^;]+lower\s*\(\s*sha256\s*\)/i);
});

test('active attempt relationship is restrictive and guarded', () => {
  assert.match(sql, /constraint\s+document_pages_active_attempt_fk[\s\S]*foreign\s+key\s*\(\s*active_attempt_id\s*\)[\s\S]*references\s+public\.page_extraction_attempts\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i);
  assert.match(sql, /function\s+public\.guard_document_page_active_attempt\s*\(/i);
  assert.match(sql, /function\s+public\.guard_active_extraction_attempt_mutation\s*\(/i);
  assert.match(sql, /function\s+public\.activate_page_extraction_attempt\s*\(\s*p_attempt_id\s+uuid\s*\)/i);
});

test('activation only accepts successful, non-failed, non-empty extraction attempts', () => {
  const match = sql.match(/create\s+or\s+replace\s+function\s+public\.activate_page_extraction_attempt[\s\S]*?\$\$;/i);
  assert.ok(match, 'activation function missing');
  const fn = match[0];
  assert.match(fn, /attempt\.status\s*<>\s*'succeeded'/i);
  assert.match(fn, /attempt\.quality_status\s*=\s*'failed'/i);
  assert.match(fn, /length\s*\(\s*btrim\s*\(\s*attempt\.result_text\s*\)\s*\)/i);
  assert.match(fn, /where\s+id\s*=\s*attempt\.page_id/i);
});

test('activation declare block has no duplicate variable names', () => {
  const match = sql.match(/function\s+public\.activate_page_extraction_attempt[\s\S]*?declare([\s\S]*?)begin/i);
  assert.ok(match, 'activation declare block missing');
  const variables = [...match[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s+/gim)].map(item => item[1].toLowerCase());
  assert.equal(new Set(variables).size, variables.length, `duplicate variables: ${variables.join(', ')}`);
});
