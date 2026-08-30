-- 活教参 1.2：账号隔离、用户 DeepSeek Key 与备课草稿
create extension if not exists pgcrypto;

create table if not exists public.user_deepseek_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'deepseek' check (provider = 'deepseek'),
  model text not null check (model in ('deepseek-v4-flash', 'deepseek-v4-pro')),
  key_ciphertext text not null,
  key_iv text not null,
  key_tag text not null,
  key_fingerprint text not null,
  key_hint text not null,
  is_active boolean not null default false,
  last_test_status text not null default 'untested' check (last_test_status in ('untested', 'valid', 'invalid')),
  last_tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key_fingerprint)
);
create index if not exists user_deepseek_keys_user_idx on public.user_deepseek_keys (user_id, created_at desc);

create table if not exists public.lesson_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '未命名备课',
  question text not null default '',
  scope jsonb not null default '[]'::jsonb check (jsonb_typeof(scope) = 'array'),
  lesson_context jsonb not null default '{}'::jsonb check (jsonb_typeof(lesson_context) = 'object'),
  answer jsonb not null default '{}'::jsonb,
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  cards jsonb not null default '[]'::jsonb check (jsonb_typeof(cards) = 'array'),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lesson_drafts_user_updated_idx on public.lesson_drafts (user_id, updated_at desc);

-- The current PageIndex fixture uses string document ids, so ownership is kept
-- in a separate table instead of forcing a UUID cast on the existing catalog.
create table if not exists public.document_access (
  document_id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  object_key text,
  created_at timestamptz not null default now()
);
create index if not exists document_access_owner_idx on public.document_access (owner_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

alter table public.user_deepseek_keys enable row level security;
alter table public.lesson_drafts enable row level security;
alter table public.document_access enable row level security;

drop policy if exists user_deepseek_keys_owner_select on public.user_deepseek_keys;
create policy user_deepseek_keys_owner_select on public.user_deepseek_keys for select to authenticated using (auth.uid() = user_id);
drop policy if exists user_deepseek_keys_owner_insert on public.user_deepseek_keys;
create policy user_deepseek_keys_owner_insert on public.user_deepseek_keys for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists user_deepseek_keys_owner_update on public.user_deepseek_keys;
create policy user_deepseek_keys_owner_update on public.user_deepseek_keys for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists user_deepseek_keys_owner_delete on public.user_deepseek_keys;
create policy user_deepseek_keys_owner_delete on public.user_deepseek_keys for delete to authenticated using (auth.uid() = user_id);

drop policy if exists lesson_drafts_owner_select on public.lesson_drafts;
create policy lesson_drafts_owner_select on public.lesson_drafts for select to authenticated using (auth.uid() = user_id);
drop policy if exists lesson_drafts_owner_insert on public.lesson_drafts;
create policy lesson_drafts_owner_insert on public.lesson_drafts for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists lesson_drafts_owner_update on public.lesson_drafts;
create policy lesson_drafts_owner_update on public.lesson_drafts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists lesson_drafts_owner_delete on public.lesson_drafts;
create policy lesson_drafts_owner_delete on public.lesson_drafts for delete to authenticated using (auth.uid() = user_id);

drop policy if exists document_access_owner_select on public.document_access;
create policy document_access_owner_select on public.document_access for select to authenticated using (auth.uid() = owner_id or visibility = 'public');
drop policy if exists document_access_owner_insert on public.document_access;
create policy document_access_owner_insert on public.document_access for insert to authenticated with check (auth.uid() = owner_id);
drop policy if exists document_access_owner_update on public.document_access;
create policy document_access_owner_update on public.document_access for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists document_access_owner_delete on public.document_access;
create policy document_access_owner_delete on public.document_access for delete to authenticated using (auth.uid() = owner_id);

drop trigger if exists user_deepseek_keys_touch_updated_at on public.user_deepseek_keys;
create trigger user_deepseek_keys_touch_updated_at before update on public.user_deepseek_keys for each row execute function public.touch_updated_at();
drop trigger if exists lesson_drafts_touch_updated_at on public.lesson_drafts;
create trigger lesson_drafts_touch_updated_at before update on public.lesson_drafts for each row execute function public.touch_updated_at();
