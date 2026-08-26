alter table public.source_files
  add column if not exists masked_storage_path text,
  add column if not exists redaction_status text,
  add column if not exists redaction_count integer not null default 0,
  add column if not exists redaction_error text;

comment on column public.source_files.masked_storage_path is '민감정보를 물리적으로 제거하고 검증한 PDF의 비공개 Storage 경로';
comment on column public.source_files.redaction_status is 'PDF 마스킹 처리 상태: verified 또는 failed';
comment on column public.source_files.redaction_count is 'PDF에서 제거한 민감정보 항목 수';
comment on column public.source_files.redaction_error is 'PDF 마스킹 또는 잔존 검증 실패 사유';
