-- 신용정보법 체계 검색 범위를 법률·시행령·시행규칙·핵심 감독규정으로 확장한다.
-- 운영 DB 반영 전 테스트 환경에서 최초 동기화 결과와 현행 시행일을 검증한다.
insert into public.legal_sources(canonical_name,source_target,priority,related_departments)
values
  ('신용정보의 이용 및 보호에 관한 법률','law',90,'["마이데이터추진단"]'),
  ('신용정보의 이용 및 보호에 관한 법률 시행령','law',90,'["마이데이터추진단"]'),
  ('신용정보의 이용 및 보호에 관한 법률 시행규칙','law',85,'["마이데이터추진단"]'),
  ('신용정보업감독규정','admrul',85,'["마이데이터추진단"]')
on conflict (canonical_name) do update
set source_target=excluded.source_target,
    priority=excluded.priority,
    related_departments=excluded.related_departments,
    enabled=true,
    updated_at=now();
