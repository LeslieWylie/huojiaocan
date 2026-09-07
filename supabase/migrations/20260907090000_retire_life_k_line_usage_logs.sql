create schema if not exists retired_life_k_line;
revoke all on schema retired_life_k_line from public, anon, authenticated;
alter table if exists public.usage_logs set schema retired_life_k_line;
comment on schema retired_life_k_line is 'Retired Life K Line data retained for rollback; not part of live teacher workflows.';
