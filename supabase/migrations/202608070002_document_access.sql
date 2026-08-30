create table if not exists public.document_access (
  document_id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  object_key text,
  created_at timestamptz not null default now()
);
create index if not exists document_access_owner_idx on public.document_access (owner_id, created_at desc);
alter table public.document_access enable row level security;
drop policy if exists document_access_owner_select on public.document_access;
create policy document_access_owner_select on public.document_access for select to authenticated using (auth.uid() = owner_id or visibility = 'public');
drop policy if exists document_access_owner_insert on public.document_access;
create policy document_access_owner_insert on public.document_access for insert to authenticated with check (auth.uid() = owner_id);
drop policy if exists document_access_owner_update on public.document_access;
create policy document_access_owner_update on public.document_access for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists document_access_owner_delete on public.document_access;
create policy document_access_owner_delete on public.document_access for delete to authenticated using (auth.uid() = owner_id);
