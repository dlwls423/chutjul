-- 부서 표시명 변경. 기존 사용자·자료·답변 기록의 소관 범위도 함께 이전합니다.
do $$
begin
  if to_regclass('public.departments') is not null then
    insert into public.departments(name, sort_order, active, created_by)
    select '마이데이터추진단', sort_order, active, created_by
    from public.departments
    where name = '범정부마이데이터추진단'
    on conflict(name) do update set active=true, updated_at=now();
  end if;
end $$;

update public.user_profiles set department='마이데이터추진단' where department='범정부마이데이터추진단';
update public.department_change_requests set current_department='마이데이터추진단' where current_department='범정부마이데이터추진단';
update public.department_change_requests set requested_department='마이데이터추진단' where requested_department='범정부마이데이터추진단';
update public.ingestion_jobs set owning_department='마이데이터추진단' where owning_department='범정부마이데이터추진단';
update public.source_files set owning_department='마이데이터추진단' where owning_department='범정부마이데이터추진단';
update public.rag_documents set department='마이데이터추진단' where department='범정부마이데이터추진단';
update public.answer_logs set department='마이데이터추진단' where department='범정부마이데이터추진단';

delete from public.answer_format_settings
where department='마이데이터추진단'
  and exists(select 1 from public.answer_format_settings where department='범정부마이데이터추진단');
update public.answer_format_settings set department='마이데이터추진단' where department='범정부마이데이터추진단';

update public.legal_sources source
set related_departments=(
  select coalesce(jsonb_agg(case when value='범정부마이데이터추진단' then '마이데이터추진단' else value end),'[]'::jsonb)
  from jsonb_array_elements_text(source.related_departments)
),updated_at=now()
where source.related_departments ? '범정부마이데이터추진단';

delete from public.departments where name='범정부마이데이터추진단';
alter table public.ingestion_jobs alter column owning_department set default '마이데이터추진단';
alter table public.source_files alter column owning_department set default '마이데이터추진단';
