import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.resolve(here, '../../supabase/migrations');
const file = fs.readdirSync(migrations).find(name => name.endsWith('_teaching_shares.sql'));
const sql = file ? fs.readFileSync(path.join(migrations, file), 'utf8') : '';

test('teaching shares keep public resolution behind the service boundary', () => {
  assert.match(sql, /create table if not exists public\.teaching_shares/iu);
  assert.match(sql, /token_hash text not null unique/iu);
  assert.match(sql, /alter table public\.teaching_shares enable row level security/iu);
  assert.match(sql, /revoke all on table public\.teaching_shares from anon/iu);
  assert.doesNotMatch(sql, /to anon/iu);
  assert.match(sql, /using \(\(select auth\.uid\(\)\) = owner_id\)/iu);
  assert.match(sql, /with check \(\(select auth\.uid\(\)\) = owner_id\)/iu);
});
