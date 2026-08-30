-- 活教参 1.3：可检索教研资产与三源材料绑定
create table if not exists public.teaching_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  asset_key text not null,
  draft_id uuid references public.lesson_drafts(id) on delete set null,
  title text not null default '未命名备课',
  lesson_key text not null default '',
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  visibility text not null default 'private' check (visibility in ('private', 'shared')),
  tags jsonb not null default '[]'::jsonb check (jsonb_typeof(tags) = 'array'),
  content jsonb not null default '{}'::jsonb,
  source_coverage jsonb not null default '{}'::jsonb,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique(owner_id, asset_key, version)
);
create index if not exists teaching_assets_owner_updated_idx on public.teaching_assets(owner_id, updated_at desc);
create index if not exists teaching_assets_owner_lesson_idx on public.teaching_assets(owner_id, lesson_key);
alter table public.teaching_assets enable row level security;
drop policy if exists teaching_assets_owner_select on public.teaching_assets;
create policy teaching_assets_owner_select on public.teaching_assets for select to authenticated using (auth.uid() = owner_id);
drop policy if exists teaching_assets_owner_insert on public.teaching_assets;
create policy teaching_assets_owner_insert on public.teaching_assets for insert to authenticated with check (auth.uid() = owner_id);
drop policy if exists teaching_assets_owner_update on public.teaching_assets;
create policy teaching_assets_owner_update on public.teaching_assets for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists teaching_assets_owner_delete on public.teaching_assets;
create policy teaching_assets_owner_delete on public.teaching_assets for delete to authenticated using (auth.uid() = owner_id);
drop trigger if exists teaching_assets_touch_updated_at on public.teaching_assets;
create trigger teaching_assets_touch_updated_at before update on public.teaching_assets for each row execute function public.touch_updated_at();
