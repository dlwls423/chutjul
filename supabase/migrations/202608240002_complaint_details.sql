alter table public.rag_documents
  add column if not exists application_number text,
  add column if not exists receipt_number text,
  add column if not exists application_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists expected_completion_at timestamptz,
  add column if not exists summary text,
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists handler_masked text,
  add column if not exists processor_masked text,
  add column if not exists notification_at timestamptz,
  add column if not exists answer_confirmed_at timestamptz,
  add column if not exists related_laws jsonb not null default '[]'::jsonb,
  add column if not exists application_channel text,
  add column if not exists complaint_kind text,
  add column if not exists processing_result text,
  add column if not exists public_status text,
  add column if not exists processing_period_days integer,
  add column if not exists notification_method text;

create index if not exists idx_rag_documents_application_number on public.rag_documents(application_number);
create index if not exists idx_rag_documents_receipt_number on public.rag_documents(receipt_number);
create index if not exists idx_rag_documents_received_at on public.rag_documents(received_at desc);
