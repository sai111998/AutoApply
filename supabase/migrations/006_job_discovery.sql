-- Live job discovery metadata on existing jobs + saved-job state.
-- Does not drop columns or replace the jobs table.

alter table public.jobs add column if not exists provider text;
alter table public.jobs add column if not exists provider_job_id text;
alter table public.jobs add column if not exists remote boolean;
alter table public.jobs add column if not exists work_arrangement text;
alter table public.jobs add column if not exists employment_type text;
alter table public.jobs add column if not exists posted_at timestamptz;
alter table public.jobs add column if not exists discovered_at timestamptz;
alter table public.jobs add column if not exists last_verified_at timestamptz;
alter table public.jobs add column if not exists salary_min numeric;
alter table public.jobs add column if not exists salary_max numeric;
alter table public.jobs add column if not exists salary_currency text;
alter table public.jobs add column if not exists source text;
alter table public.jobs add column if not exists identity_key text;
alter table public.jobs add column if not exists raw_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists jobs_user_identity_key_idx
  on public.jobs (user_id, identity_key)
  where identity_key is not null;

create index if not exists jobs_provider_job_id_idx
  on public.jobs (provider, provider_job_id)
  where provider is not null and provider_job_id is not null;

create table if not exists public.saved_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create index if not exists saved_jobs_user_id_idx on public.saved_jobs (user_id, created_at desc);

grant select, insert, update, delete on table public.saved_jobs to authenticated, service_role;

alter table public.saved_jobs enable row level security;

drop policy if exists "Users can manage own saved jobs" on public.saved_jobs;
create policy "Users can manage own saved jobs"
  on public.saved_jobs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
