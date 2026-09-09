create table if not exists public.slide_media_assets (
  asset_id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  object_key text not null unique,
  mime_type text not null default '',
  byte_size bigint not null check (byte_size >= 0),
  revision integer not null default 1 check (revision >= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists slide_media_assets_owner_updated_idx
  on public.slide_media_assets(owner_id, updated_at desc);

alter table public.slide_media_assets enable row level security;

create policy "slide assets are readable by their owner"
  on public.slide_media_assets for select
  using (auth.uid() = owner_id);

create policy "slide assets are insertable by their owner"
  on public.slide_media_assets for insert
  with check (auth.uid() = owner_id);

create policy "slide assets are updatable by their owner"
  on public.slide_media_assets for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "slide assets are removable by their owner"
  on public.slide_media_assets for delete
  using (auth.uid() = owner_id);
