create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 2 and 40),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.departments enable row level security;
create index if not exists departments_active_order_idx on public.departments(active,sort_order,name);

insert into public.departments(name,sort_order) values
  ('위원장실',10),('대변인실',20),('범정부마이데이터추진단',30),('혁신기획담당관',40),
  ('심사총괄담당관',50),('법무감사담당관',60),('국제협력담당관',70),('운영지원과',80),
  ('개인정보보호정책과',90),('침해평가과',100),('신기술개인정보과',110),('데이터안전정책과',120),
  ('인공지능프라이버시팀',130),('조사총괄과',140),('조사1과',150),('조사2과',160),
  ('조사3팀',170),('예방조정심의관',180),('사전실태점검과',190),('분쟁조정과',200),
  ('자율보호정책과',210),('공공실태점검단',220)
on conflict(name) do update set active=true,sort_order=excluded.sort_order,updated_at=now();
