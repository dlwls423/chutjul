-- The application authorizes users in server routes. Browser database roles
-- must not bypass that boundary, even if an older permissive policy remains.
begin;
do $$
declare table_name text; rpc regprocedure;
begin
  foreach table_name in array array[
    'ingestion_jobs','source_files','rag_documents','rag_chunks',
    'user_profiles','department_change_requests','answer_logs',
    'answer_format_settings','departments','complaint_workspaces',
    'legal_sources','legal_versions','legal_provisions','legal_sync_runs'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
      execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
    end if;
  end loop;
  for rpc in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('match_rag_chunks','mutate_complaint_workspace')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', rpc);
    execute format('grant execute on function %s to service_role', rpc);
  end loop;
end $$;
commit;
