-- Production-safe RLS probe: synthetic users and rows live only in a subtransaction.
-- No credentials, real user data, model calls, or persistent policy changes.
-- Run as the database administrator, never as service_role via the application.
do $probe$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  own uuid; other uuid; owner_column text; pk text; t text;
  n integer; passed integer := 0; denied boolean;
begin
  begin
    insert into auth.users(id) values (a),(b);
    insert into public.lesson_drafts(id,user_id,title,cards) values
      (a,a,'RLS rollback fixture A','[{"type":"board","items":[{"text":"A-only"}]}]'),
      (b,b,'RLS rollback fixture B','[{"type":"board","items":[{"text":"B-only"}]}]');
    insert into public.user_deepseek_keys(id,user_id,model,key_ciphertext,key_iv,key_tag,key_fingerprint,key_hint)
      select x,x,'deepseek-v4-flash','synthetic-not-a-key','synthetic','synthetic',x::text,'test' from unnest(array[a,b]) x;
    insert into public.document_access(document_id,owner_id,visibility)
      values(a::text,a,'private'),(b::text,b,'private');
    execute 'set local role authenticated';
    foreach own in array array[a,b] loop
      other := case when own=a then b else a end;
      perform set_config('request.jwt.claim.sub',own::text,true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',own,'role','authenticated')::text,true);
      foreach t in array array['lesson_drafts','user_deepseek_keys','document_access'] loop
        owner_column := case when t='document_access' then 'owner_id' else 'user_id' end;
        pk := case when t='document_access' then 'document_id' else 'id' end;
        execute format('select count(*) from public.%I where %I::text=$1',t,pk) into n using own::text;
        if n<>1 then raise exception 'Own row unavailable: %',t; end if; passed:=passed+1;
        execute format('select count(*) from public.%I where %I::text=$1',t,pk) into n using other::text;
        if n<>0 then raise exception 'Foreign row visible: %',t; end if; passed:=passed+1;
        execute format('update public.%I set %I=%I where %I::text=$1',t,owner_column,owner_column,pk) using other::text;
        get diagnostics n=row_count;
        if n<>0 then raise exception 'Foreign update allowed: %',t; end if; passed:=passed+1;
        execute format('delete from public.%I where %I::text=$1',t,pk) using other::text;
        get diagnostics n=row_count;
        if n<>0 then raise exception 'Foreign delete allowed: %',t; end if; passed:=passed+1;
        denied:=false;
        begin
          execute format('update public.%I set %I=$1 where %I::text=$2',t,owner_column,pk) using other,own::text;
        exception when insufficient_privilege then denied:=true;
        end;
        if not denied then raise exception 'Owner transfer allowed: %',t; end if; passed:=passed+1;
        execute format('update public.%I set %I=%I where %I::text=$1',t,owner_column,owner_column,pk) using own::text;
        get diagnostics n=row_count;
        if n<>1 then raise exception 'Own update unavailable: %',t; end if; passed:=passed+1;
      end loop;
    end loop;
    execute 'set local role anon';
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','{}',true);
    foreach t in array array['lesson_drafts','user_deepseek_keys','document_access'] loop
      pk:=case when t='document_access' then 'document_id' else 'id' end;
      begin
        execute format('select count(*) from public.%I where %I::text in ($1,$2)',t,pk) into n using a::text,b::text;
        if n<>0 then raise exception 'Anonymous private row visible: %',t; end if;
      exception when insufficient_privilege then null;
      end;
      passed:=passed+1;
    end loop;
    -- Deliberate exception rolls back users, fixtures, updates and SET LOCAL ROLE.
    raise exception using errcode='P9998',message='rollback probe fixtures';
  exception when sqlstate 'P9998' then null;
  end;
  if exists(select 1 from auth.users where id in(a,b))
     or exists(select 1 from public.lesson_drafts where id in(a,b))
     or exists(select 1 from public.user_deepseek_keys where id in(a,b))
     or exists(select 1 from public.document_access where document_id in(a::text,b::text))
  then raise exception 'Probe cleanup failed'; end if;
  perform set_config('huojiaocan.rls_probe',jsonb_build_object('checks_passed',passed,'fixtures_rolled_back',true,'mode','database_roles_not_browser_sessions')::text,true);
end $probe$;
select current_setting('huojiaocan.rls_probe')::jsonb as isolation_result;
