create extension if not exists pgcrypto;

create table if not exists public.legal_sources (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  source_target text not null check (source_target in ('law','admrul')),
  external_id text,
  source_url text,
  authority text not null default '법제처 국가법령정보센터',
  priority integer not null default 50,
  related_departments jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.legal_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.legal_sources(id) on delete cascade,
  external_serial text not null,
  proclamation_number text,
  proclaimed_at date,
  effective_from date,
  effective_to date,
  revision_type text,
  version_hash text not null,
  status text not null default 'current' check (status in ('current','upcoming','history')),
  raw_document jsonb not null,
  fetched_at timestamptz not null default now(),
  unique(source_id, version_hash)
);

create table if not exists public.legal_provisions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.legal_versions(id) on delete cascade,
  source_id uuid not null references public.legal_sources(id) on delete cascade,
  provision_key text not null,
  article_number text,
  heading text,
  body text not null,
  sequence integer not null default 0,
  created_at timestamptz not null default now(),
  unique(version_id, provision_key)
);

create table if not exists public.legal_sync_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running','completed','partial','failed')),
  checked_count integer not null default 0,
  changed_count integer not null default 0,
  failed_count integer not null default 0,
  error_summary jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_legal_versions_current on public.legal_versions(source_id,status,effective_from desc);
create index if not exists idx_legal_provisions_source on public.legal_provisions(source_id,version_id,sequence);
create index if not exists idx_legal_provisions_search on public.legal_provisions using gin(to_tsvector('simple',coalesce(heading,'')||' '||body));

insert into public.legal_sources(canonical_name,source_target,priority,related_departments) values
('개인정보 보호법','law',100,'["전체"]'),('개인정보 보호법 시행령','law',100,'["전체"]'),('개인정보 단체소송규칙','law',60,'["분쟁조정과"]'),
('신용정보의 이용 및 보호에 관한 법률','law',65,'["범정부마이데이터추진단"]'),('신용정보의 이용 및 보호에 관한 법률 시행령','law',65,'["범정부마이데이터추진단"]'),
('민원 처리에 관한 법률','law',55,'["전체"]'),('민원 처리에 관한 법률 시행령','law',55,'["전체"]'),('행정절차법','law',50,'["전체"]'),
('개인정보 처리 방법에 관한 고시','admrul',90,'["전체"]'),('표준 개인정보 보호지침','admrul',95,'["전체"]'),('개인정보의 안전성 확보조치 기준','admrul',100,'["신기술개인정보과"]'),
('개인정보 보호법 위반에 대한 과징금 부과기준','admrul',95,'["조사총괄과"]'),('개인정보 영향평가에 관한 고시','admrul',85,'["자율보호정책과"]'),
('개인정보 처리방침 평가에 관한 고시','admrul',85,'["자율보호정책과"]'),('개인정보 보호수준 평가에 관한 고시','admrul',85,'["자율보호정책과"]'),
('개인정보 보호책임자 경력 인정에 관한 고시','admrul',70,'["자율보호정책과"]'),('가명정보의 결합 및 반출 등에 관한 고시','admrul',95,'["데이터안전정책과"]'),
('(개인정보보호위원회) 개인정보 보호 자율규제단체 지정 및 운영 등에 관한 규정','admrul',70,'["자율보호정책과"]'),
('개인정보 보호위원회의 조사 및 처분에 관한 규정','admrul',80,'["조사총괄과"]'),('개인정보 전송 및 개인정보관리 전문기관 지정 등에 관한 고시','admrul',100,'["범정부마이데이터추진단"]'),
('보건의료 분야 개인정보 전송에 관한 고시','admrul',100,'["범정부마이데이터추진단"]'),('전기 분야 개인정보 전송에 관한 고시','admrul',100,'["범정부마이데이터추진단"]'),
('국경 간 개인정보 보호 규칙 인증제도의 운영에 관한 지침','admrul',70,'["국제협력담당관"]'),('정보보호 및 개인정보보호 관리체계 인증 등에 관한 고시','admrul',80,'["신기술개인정보과"]')
on conflict (canonical_name) do update set priority=excluded.priority,related_departments=excluded.related_departments,enabled=true,updated_at=now();

comment on table public.legal_versions is '법령 현행·시행예정·연혁 원문을 변경 불가능한 버전으로 보관';
comment on table public.legal_provisions is '법령 검색 및 답변 인용을 위한 조·항·호 단위 본문';
