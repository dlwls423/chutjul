alter table public.rag_documents
  add column if not exists question_summary text,
  add column if not exists answer_summary text,
  add column if not exists summary_version integer not null default 1;

create index if not exists idx_rag_documents_summary_search
  on public.rag_documents using gin (
    to_tsvector('simple', coalesce(question_summary, '') || ' ' || coalesce(answer_summary, ''))
  );

create table if not exists public.answer_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  department text not null,
  application_number text,
  complaint_title text,
  approved_summary jsonb not null default '{}'::jsonb,
  answer_text text not null,
  evidence jsonb not null default '[]'::jsonb,
  quality_checks jsonb not null default '{}'::jsonb,
  version_number integer not null default 1,
  created_at timestamptz not null default now()
);

alter table public.answer_logs
  add column if not exists user_id uuid,
  add column if not exists department text,
  add column if not exists application_number text,
  add column if not exists complaint_title text,
  add column if not exists approved_summary jsonb not null default '{}'::jsonb,
  add column if not exists answer_text text,
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists quality_checks jsonb not null default '{}'::jsonb,
  add column if not exists version_number integer not null default 1,
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_answer_logs_user_created
  on public.answer_logs(user_id, created_at desc);
create index if not exists idx_answer_logs_department_application
  on public.answer_logs(department, application_number, version_number desc);

create table if not exists public.answer_format_settings (
  department text primary key,
  organization_name text not null default '개인정보보호위원회',
  closing_message text not null default '연락주시면 친절히 안내해 드리도록 하겠습니다. 감사합니다. 끝.',
  max_sections integer not null default 4 check (max_sections between 1 and 8),
  updated_at timestamptz not null default now()
);

alter table public.answer_logs enable row level security;
alter table public.answer_format_settings enable row level security;

notify pgrst, 'reload schema';
