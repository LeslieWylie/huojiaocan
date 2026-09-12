-- Durable service-only aggregate; existing public seed books are NOT imported.
create table public.pageindex_documents (
  document_id text primary key,
  document jsonb,
  index_data jsonb,
  validation jsonb,
  revision bigint not null check (revision > 0),
  deleted boolean not null default false
);
create table public.pageindex_jobs (
  job_id text primary key,
  document_id text not null references public.pageindex_documents(document_id),
  job jsonb not null
);
create index pageindex_jobs_document_id on public.pageindex_jobs(document_id);
alter table public.pageindex_documents enable row level security;
alter table public.pageindex_jobs enable row level security;
revoke all on public.pageindex_documents, public.pageindex_jobs from anon, authenticated;
grant all on public.pageindex_documents, public.pageindex_jobs to service_role;

create function public.pageindex_commit(
  p_document_id text, p_expected_revision bigint, p_document jsonb,
  p_index_data jsonb, p_validation jsonb, p_jobs jsonb, p_deleted boolean default false
) returns bigint language plpgsql security invoker set search_path = public as $$
declare next_revision bigint; item jsonb;
begin
  if p_expected_revision < 0 or p_expected_revision is null
    or (not p_deleted and (p_document is null or p_document->>'id' is distinct from p_document_id))
    or (p_index_data is not null and p_index_data->>'documentId' is distinct from p_document_id)
    or (p_validation is not null and p_validation->>'documentId' is distinct from p_document_id)
    or jsonb_typeof(p_jobs) is distinct from 'array' then
    raise exception 'invalid aggregate identity' using errcode = '22023';
  end if;
  -- Unique insert also serializes two revision-zero writers. All job writes
  -- occur AFTER successful CAS, in the same transaction.
  if p_expected_revision = 0 then
    insert into public.pageindex_documents values
      (p_document_id,p_document,p_index_data,p_validation,1,p_deleted)
    on conflict do nothing returning revision into next_revision;
  else
    update public.pageindex_documents set document=p_document,index_data=p_index_data,
      validation=p_validation,revision=revision+1,deleted=p_deleted
    where document_id=p_document_id and revision=p_expected_revision
    returning revision into next_revision;
  end if;
  if next_revision is null then
    raise exception 'pageindex_revision_conflict' using errcode = 'PT409';
  end if;
  for item in select value from jsonb_array_elements(p_jobs) loop
    if item->>'documentId' is distinct from p_document_id or coalesce(item->>'jobId','') = '' then
      raise exception 'invalid job identity' using errcode = '22023';
    end if;
    if item->>'status' in ('ready','partial') and p_index_data is null
      and coalesce(item->>'error','') not in ('waiting_for_pages','ocr_requires_pdf_ingest') then
      raise exception 'terminal job requires index' using errcode = '22023';
    end if;
    insert into public.pageindex_jobs values (item->>'jobId',p_document_id,item)
    on conflict (job_id) do update set job=excluded.job
      where pageindex_jobs.document_id=excluded.document_id;
    if not found then
      raise exception 'job belongs to another document' using errcode = '22023';
    end if;
  end loop;
  if p_deleted then delete from public.pageindex_jobs where document_id=p_document_id; end if;
  return next_revision;
end $$;
revoke all on function public.pageindex_commit(text,bigint,jsonb,jsonb,jsonb,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.pageindex_commit(text,bigint,jsonb,jsonb,jsonb,jsonb,boolean) to service_role;
