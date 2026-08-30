-- 活教参：PDF 页级解析、PageIndex 与最小任务状态模型
-- 原始 PDF 保存在对象存储；本迁移只保存不可变定位信息、解析结果和必要任务状态。
create extension if not exists pgcrypto;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  document_type text not null check (document_type in ('textbook', 'teacher_guide', 'other')),
  original_filename text not null,
  original_object_key text not null unique,
  mime_type text not null default 'application/pdf',
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-fA-F]{64}$'),
  page_count integer not null default 0 check (page_count >= 0),
  text_profile text not null default 'unknown' check (text_profile in ('native', 'scanned', 'mixed', 'unknown')),
  default_extraction_policy text not null default 'auto' check (default_extraction_policy in ('auto', 'native', 'ocr')),
  pdf_status text not null default 'uploaded' check (pdf_status in ('uploaded', 'inspecting', 'ready', 'encrypted', 'damaged', 'failed')),
  active_index_provider text,
  active_index_ref text,
  index_status text not null default 'pending' check (index_status in ('pending', 'processing', 'partial', 'ready', 'failed')),
  index_dirty boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists documents_sha256_unique on public.documents (lower(sha256));

create table if not exists public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  pdf_page_number integer not null check (pdf_page_number > 0),
  printed_page_label text,
  width numeric(12,3),
  height numeric(12,3),
  rotation integer not null default 0 check (rotation in (0, 90, 180, 270)),
  has_native_text boolean not null default false,
  native_text text,
  native_quality_score numeric(6,5) check (native_quality_score between 0 and 1),
  ocr_text text,
  ocr_provider text,
  ocr_model text,
  ocr_confidence numeric(6,5) check (ocr_confidence between 0 and 1),
  selected_text_source text not null default 'none' check (selected_text_source in ('native', 'ocr', 'merged', 'none')),
  retrieval_text text,
  retrieval_checksum text,
  text_quality_status text not null default 'review' check (text_quality_status in ('normal', 'review', 'failed')),
  quality_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(quality_flags) = 'array'),
  page_title text,
  section_path jsonb not null default '[]'::jsonb check (jsonb_typeof(section_path) = 'array'),
  include_in_index boolean not null default true,
  active_attempt_id uuid,
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processing', 'ready', 'review', 'failed', 'excluded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, pdf_page_number)
);
create index if not exists document_pages_document_status_idx on public.document_pages (document_id, processing_status, pdf_page_number);
create index if not exists document_pages_indexable_idx on public.document_pages (document_id, include_in_index, text_quality_status) where include_in_index;

create table if not exists public.page_extraction_attempts (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.document_pages(id) on delete cascade,
  method text not null check (method in ('native', 'ocr', 'merged')),
  provider text,
  model text,
  status text not null default 'processing' check (status in ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  result_text text,
  result_checksum text,
  confidence numeric(6,5) check (confidence between 0 and 1),
  quality_score numeric(6,5) check (quality_score between 0 and 1),
  quality_status text not null default 'review' check (quality_status in ('normal', 'review', 'failed')),
  quality_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(quality_flags) = 'array'),
  error_summary text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'succeeded' or (result_text is not null and length(btrim(result_text)) > 0)),
  check (status <> 'failed' or error_summary is not null)
);
create index if not exists page_extraction_attempts_page_created_idx on public.page_extraction_attempts (page_id, created_at desc);

alter table public.document_pages
  add constraint document_pages_active_attempt_fk
  foreign key (active_attempt_id) references public.page_extraction_attempts(id) on delete restrict;

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  job_type text not null check (job_type in ('inspect', 'index', 'page_rerun', 'validate')),
  status text not null default 'processing' check (status in ('processing', 'partial', 'ready', 'cards_ready', 'failed', 'cancelled')),
  current_stage smallint not null default 1 check (current_stage between 1 and 7),
  stage_name text,
  total_pages integer not null default 0 check (total_pages >= 0),
  processed_pages integer not null default 0 check (processed_pages >= 0),
  success_pages integer not null default 0 check (success_pages >= 0),
  warning_pages integer not null default 0 check (warning_pages >= 0),
  failed_pages integer not null default 0 check (failed_pages >= 0),
  page_start integer,
  page_end integer,
  processing_options jsonb not null default '{}'::jsonb check (jsonb_typeof(processing_options) = 'object'),
  result_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(result_summary) = 'object'),
  error_summary text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (processed_pages <= total_pages or total_pages = 0),
  check (page_end is null or page_start is null or page_end >= page_start)
);
create index if not exists ingestion_jobs_document_created_idx on public.ingestion_jobs (document_id, created_at desc);

create table if not exists public.ingestion_job_pages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ingestion_jobs(id) on delete cascade,
  page_id uuid not null references public.document_pages(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'warning', 'failed', 'skipped')),
  retry_count integer not null default 0 check (retry_count >= 0),
  current_step text,
  error_summary text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, page_id)
);
create index if not exists ingestion_job_pages_job_status_idx on public.ingestion_job_pages (job_id, status);

create table if not exists public.document_nodes (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  provider text not null,
  provider_node_id text,
  parent_id uuid references public.document_nodes(id) on delete cascade,
  title text not null,
  level integer not null default 0 check (level >= 0),
  start_pdf_page integer not null check (start_pdf_page > 0),
  end_pdf_page integer not null check (end_pdf_page >= start_pdf_page),
  section_path jsonb not null default '[]'::jsonb check (jsonb_typeof(section_path) = 'array'),
  summary text,
  sort_order integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, provider, provider_node_id)
);
create index if not exists document_nodes_tree_idx on public.document_nodes (document_id, parent_id, sort_order);
create index if not exists document_nodes_range_idx on public.document_nodes (document_id, start_pdf_page, end_pdf_page);

create table if not exists public.document_links (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.documents(id) on delete cascade,
  source_start_page integer not null check (source_start_page > 0),
  source_end_page integer not null check (source_end_page >= source_start_page),
  target_document_id uuid not null references public.documents(id) on delete cascade,
  target_start_page integer not null check (target_start_page > 0),
  target_end_page integer not null check (target_end_page >= target_start_page),
  lesson_key text not null,
  relation_type text not null check (relation_type in ('lesson', 'unit', 'objective', 'guidance', 'exercise', 'activity', 'other')),
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_document_id <> target_document_id),
  unique (source_document_id, source_start_page, source_end_page, target_document_id, target_start_page, target_end_page, relation_type)
);
create index if not exists document_links_lesson_idx on public.document_links (lesson_key, relation_type);

-- active_attempt_id 只能指向同一页面、成功且质量非 failed 的尝试。
-- 因此失败重跑无法覆盖已有有效结果。
create or replace function public.guard_document_page_active_attempt()
returns trigger
language plpgsql
as $$
declare
  attempt public.page_extraction_attempts%rowtype;
begin
  if new.active_attempt_id is null then
    return new;
  end if;
  select * into attempt from public.page_extraction_attempts where id = new.active_attempt_id;
  if not found or attempt.page_id <> new.id then
    raise exception 'active_attempt_must_belong_to_page' using errcode = '23514';
  end if;
  if attempt.status <> 'succeeded' or attempt.quality_status = 'failed' or coalesce(length(btrim(attempt.result_text)), 0) = 0 then
    raise exception 'active_attempt_must_be_successful' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists document_pages_guard_active_attempt on public.document_pages;
create trigger document_pages_guard_active_attempt
before insert or update of active_attempt_id on public.document_pages
for each row execute function public.guard_document_page_active_attempt();

-- 已被激活的尝试不能事后改成失败、取消或空结果。
create or replace function public.guard_active_extraction_attempt_mutation()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.document_pages p where p.active_attempt_id = old.id) then
    if new.page_id <> old.page_id or new.status <> 'succeeded' or new.quality_status = 'failed' or coalesce(length(btrim(new.result_text)), 0) = 0 then
      raise exception 'cannot_invalidate_active_attempt' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists extraction_attempts_guard_active_mutation on public.page_extraction_attempts;
create trigger extraction_attempts_guard_active_mutation
before update on public.page_extraction_attempts
for each row execute function public.guard_active_extraction_attempt_mutation();

-- 唯一推荐的激活入口：在一个事务内校验并复制生效文本。
create or replace function public.activate_page_extraction_attempt(p_attempt_id uuid)
returns public.document_pages
language plpgsql
as $$
declare
  attempt public.page_extraction_attempts%rowtype;
  updated_page public.document_pages%rowtype;
begin
  select * into attempt from public.page_extraction_attempts where id = p_attempt_id for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if attempt.status <> 'succeeded' or attempt.quality_status = 'failed' or coalesce(length(btrim(attempt.result_text)), 0) = 0 then
    raise exception 'attempt_not_activatable';
  end if;

  update public.document_pages
  set active_attempt_id = attempt.id,
      selected_text_source = attempt.method,
      retrieval_text = attempt.result_text,
      retrieval_checksum = attempt.result_checksum,
      text_quality_status = attempt.quality_status,
      quality_flags = attempt.quality_flags,
      processing_status = case when attempt.quality_status = 'normal' then 'ready' else 'review' end,
      updated_at = now()
  where id = attempt.page_id
  returning * into updated_page;

  if not found then raise exception 'page_not_found'; end if;
  return updated_page;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;


drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at before update on public.documents for each row execute function public.touch_updated_at();
drop trigger if exists document_pages_touch_updated_at on public.document_pages;
create trigger document_pages_touch_updated_at before update on public.document_pages for each row execute function public.touch_updated_at();
drop trigger if exists ingestion_jobs_touch_updated_at on public.ingestion_jobs;
create trigger ingestion_jobs_touch_updated_at before update on public.ingestion_jobs for each row execute function public.touch_updated_at();
drop trigger if exists ingestion_job_pages_touch_updated_at on public.ingestion_job_pages;
create trigger ingestion_job_pages_touch_updated_at before update on public.ingestion_job_pages for each row execute function public.touch_updated_at();
drop trigger if exists document_nodes_touch_updated_at on public.document_nodes;
create trigger document_nodes_touch_updated_at before update on public.document_nodes for each row execute function public.touch_updated_at();
drop trigger if exists document_links_touch_updated_at on public.document_links;
create trigger document_links_touch_updated_at before update on public.document_links for each row execute function public.touch_updated_at();
