-- 活教参 4.0：不可篡改的教研共备快照
create table if not exists public.teaching_shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  draft_id uuid references public.lesson_drafts(id) on delete set null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  snapshot_digest text not null check (snapshot_digest ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  version integer not null default 1 check (version > 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists teaching_shares_owner_created_idx on public.teaching_shares(owner_id, created_at desc);
create index if not exists teaching_shares_draft_idx on public.teaching_shares(owner_id, draft_id, created_at desc);
alter table public.teaching_shares enable row level security;

revoke all on table public.teaching_shares from anon;
grant select, insert, update, delete on table public.teaching_shares to authenticated;

-- 普通账号只能管理自己的分享。公开读取不开 RLS 策略，只允许服务端
-- 使用 token hash 解析单个快照，避免枚举和跨账号读取。
drop policy if exists teaching_shares_owner_select on public.teaching_shares;
create policy teaching_shares_owner_select on public.teaching_shares for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists teaching_shares_owner_insert on public.teaching_shares;
create policy teaching_shares_owner_insert on public.teaching_shares for insert to authenticated with check ((select auth.uid()) = owner_id);
drop policy if exists teaching_shares_owner_update on public.teaching_shares;
create policy teaching_shares_owner_update on public.teaching_shares for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists teaching_shares_owner_delete on public.teaching_shares;
create policy teaching_shares_owner_delete on public.teaching_shares for delete to authenticated using ((select auth.uid()) = owner_id);

drop trigger if exists teaching_shares_touch_updated_at on public.teaching_shares;
create trigger teaching_shares_touch_updated_at before update on public.teaching_shares for each row execute function public.touch_updated_at();
