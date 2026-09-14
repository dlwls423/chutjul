-- 현행 행정규칙이 존재하지 않는 수집 대상을 버전·조문과 함께 제거한다.
delete from public.legal_sources
where canonical_name = '공공기관의 가명정보 결합 및 반출 등에 관한 고시';
