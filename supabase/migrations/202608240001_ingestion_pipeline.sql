create extension if not exists vector with schema extensions;

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(), file_name text not null, file_size bigint not null,
  mime_type text not null, document_type text not null default 'complaint', status text not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100), total_records integer default 0,
  document_count integer default 0, chunk_count integer default 0, pii_count integer default 0,
  error_code text, error_message text, attempt_count integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);

create table if not exists public.source_files (
  id uuid primary key default gen_random_uuid(), job_id uuid references public.ingestion_jobs(id) on delete set null,
  original_name text not null, mime_type text not null, size_bytes bigint not null, sha256 text not null unique,
  document_type text not null, storage_bucket text, storage_path text, page_count integer, record_count integer default 0,
  parse_status text not null default 'pending', created_at timestamptz not null default now()
);

create table if not exists public.rag_documents (
  id uuid primary key default gen_random_uuid(), source_file_id uuid references public.source_files(id) on delete set null,
  title text not null, document_type text not null, department text, category_major text, category_middle text, category_minor text,
  question_original text, answer_original text, content_original text not null, content_masked text not null,
  pii_findings jsonb not null default '[]'::jsonb, linked_pdf_name text, pdf_storage_path text, page_count integer,
  chunk_count integer not null default 0, metadata jsonb not null default '{}'::jsonb, status text not null default 'processing',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.rag_chunks (
  id bigint generated always as identity primary key, document_id uuid not null references public.rag_documents(id) on delete cascade,
  chunk_index integer not null, content text not null, token_estimate integer, embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(document_id,chunk_index)
);

create index if not exists idx_jobs_status_created on public.ingestion_jobs(status,created_at desc);
create index if not exists idx_source_files_job on public.source_files(job_id);
create index if not exists idx_documents_source on public.rag_documents(source_file_id);
create index if not exists idx_documents_linked_pdf on public.rag_documents(linked_pdf_name) where linked_pdf_name is not null;
create index if not exists idx_chunks_document on public.rag_chunks(document_id);
create index if not exists idx_chunks_embedding on public.rag_chunks using hnsw (embedding vector_cosine_ops);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('complaint-originals','complaint-originals',false,104857600,array['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.ingestion_jobs enable row level security;
alter table public.source_files enable row level security;
alter table public.rag_documents enable row level security;
alter table public.rag_chunks enable row level security;

create or replace function public.match_rag_chunks(query_embedding extensions.vector(1536), match_count integer default 5)
returns table(id bigint,document_id uuid,content text,metadata jsonb,similarity float)
language sql stable security invoker set search_path='' as $$
  select c.id,c.document_id,c.content,c.metadata,1-(c.embedding <=> query_embedding) similarity
  from public.rag_chunks c where c.embedding is not null order by c.embedding <=> query_embedding limit match_count;
$$;
