-- User-owned, sanitized answer workspaces. No source files or AI approval tokens.
create table if not exists public.complaint_workspaces (
 id uuid primary key, user_id uuid not null references public.user_profiles(id) on delete cascade,
 snapshot jsonb not null, revision integer not null default 1 check (revision > 0),
 updated_at timestamptz not null default now(),
 check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 300000)
);
create index if not exists complaint_workspaces_owner on public.complaint_workspaces(user_id, updated_at desc);
alter table public.complaint_workspaces enable row level security;
-- All writes use the server API's schema/privacy checks and service-role RPC.
revoke all on public.complaint_workspaces from anon, authenticated;
grant all on public.complaint_workspaces to service_role;
create or replace function public.mutate_complaint_workspace(p_user_id uuid,p_id uuid,p_revision integer,p_action text,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.complaint_workspaces; saved public.complaint_workspaces;
begin
 if not exists(select 1 from public.user_profiles where id=p_user_id and approval_status='approved') then raise exception 'ACCOUNT_NOT_APPROVED'; end if;
 -- Serialize per owner so parallel requests cannot create more than ten tabs.
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 select * into existing from public.complaint_workspaces where id=p_id and user_id=p_user_id for update;
 if (existing.id is null and p_revision <> 0) or (existing.id is not null and existing.revision <> p_revision) then return jsonb_build_object('status','conflict'); end if;
 if p_action='delete' then
  delete from public.complaint_workspaces where id=p_id and user_id=p_user_id;
  return jsonb_build_object('status','deleted');
 end if;
 if p_action<>'save' or p_revision<0 or p_snapshot is null then raise exception 'INVALID_INPUT'; end if;
 if existing.id is null then
  if exists(select 1 from public.complaint_workspaces where id=p_id) then return jsonb_build_object('status','conflict'); end if;
  if (select count(*) from public.complaint_workspaces where user_id=p_user_id)>=10 then return jsonb_build_object('status','limit'); end if;
  insert into public.complaint_workspaces(id,user_id,snapshot) values(p_id,p_user_id,p_snapshot) returning * into saved;
 else
  update public.complaint_workspaces set snapshot=p_snapshot,revision=revision+1,updated_at=now() where id=p_id and user_id=p_user_id returning * into saved;
 end if;
 return jsonb_build_object('status','saved','workspace',jsonb_build_object('id',saved.id,'revision',saved.revision,'snapshot',saved.snapshot,'updated_at',saved.updated_at));
end $$;
revoke all on function public.mutate_complaint_workspace(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_complaint_workspace(uuid,uuid,integer,text,jsonb) to service_role;
