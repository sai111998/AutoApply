-- Auto Apply queue persistence. Does not alter master resumes or existing application statuses.

create table if not exists public.auto_apply_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'running',
  config jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists auto_apply_runs_user_id_idx on public.auto_apply_runs (user_id, created_at desc);

create table if not exists public.auto_apply_queue (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.auto_apply_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id text,
  application_id text,
  resume_version_id text,
  identity_key text,
  title text not null,
  company text,
  application_url text,
  initial_match_score integer,
  final_match_score integer,
  c2c_status text,
  c2c_evidence jsonb not null default '[]'::jsonb,
  application_status text not null default 'queued',
  failure_reason text,
  questions jsonb not null default '[]'::jsonb,
  resume_version_name text,
  tailored_resume_text text,
  session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists auto_apply_queue_run_identity_idx
  on public.auto_apply_queue (run_id, identity_key)
  where identity_key is not null;

create index if not exists auto_apply_queue_user_id_idx on public.auto_apply_queue (user_id, created_at desc);

grant select, insert, update, delete on table public.auto_apply_runs to authenticated, service_role;
grant select, insert, update, delete on table public.auto_apply_queue to authenticated, service_role;

alter table public.auto_apply_runs enable row level security;
alter table public.auto_apply_queue enable row level security;

drop policy if exists "Users can manage own auto apply runs" on public.auto_apply_runs;
create policy "Users can manage own auto apply runs"
  on public.auto_apply_runs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own auto apply queue" on public.auto_apply_queue;
create policy "Users can manage own auto apply queue"
  on public.auto_apply_queue for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
