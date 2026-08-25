create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  department text not null,
  position text not null,
  office_phone text not null,
  role text not null default 'user' check (role in ('admin','user')),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.department_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  current_department text not null,
  requested_department text not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_department_request_one_pending on public.department_change_requests(user_id) where status='pending';
create index if not exists idx_profiles_approval on public.user_profiles(approval_status,created_at);
create index if not exists idx_profiles_department on public.user_profiles(department);
create index if not exists idx_department_requests_status on public.department_change_requests(status,created_at);

alter table public.user_profiles enable row level security;
alter table public.department_change_requests enable row level security;

-- 첫 관리자 Auth 계정을 만든 뒤 아래 예시를 이메일에 맞게 별도로 실행하세요.
-- update public.user_profiles set role='admin',approval_status='approved',approved_at=now() where email='admin@example.com';
