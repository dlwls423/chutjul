alter table public.ingestion_jobs add column if not exists owning_department text;
alter table public.source_files add column if not exists owning_department text;

update public.ingestion_jobs set owning_department='범정부마이데이터추진단' where owning_department is null;
update public.source_files set owning_department='범정부마이데이터추진단' where owning_department is null;

alter table public.ingestion_jobs alter column owning_department set default '범정부마이데이터추진단';
alter table public.source_files alter column owning_department set default '범정부마이데이터추진단';
alter table public.ingestion_jobs alter column owning_department set not null;
alter table public.source_files alter column owning_department set not null;

create index if not exists idx_ingestion_jobs_department on public.ingestion_jobs(owning_department,created_at desc);
create index if not exists idx_source_files_department on public.source_files(owning_department,created_at desc);
create index if not exists idx_rag_documents_department on public.rag_documents(department,created_at desc);
alter table public.source_files drop constraint if exists source_files_sha256_key;
create unique index if not exists idx_source_files_department_sha256 on public.source_files(owning_department,sha256);

drop function if exists public.match_rag_chunks(vector,integer);
create or replace function public.match_rag_chunks(query_embedding vector(1536),scope_department text,match_count integer default 5)
returns table(id bigint,document_id uuid,content text,metadata jsonb,similarity float)
language sql stable security invoker set search_path = public, extensions as $$
  select c.id,c.document_id,c.content,c.metadata,1-(c.embedding <=> query_embedding) similarity
  from public.rag_chunks c
  join public.rag_documents d on d.id=c.document_id
  where c.embedding is not null and d.department=scope_department
  order by c.embedding <=> query_embedding limit match_count;
$$;
