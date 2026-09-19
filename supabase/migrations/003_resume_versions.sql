-- Tailored resume versions. Does not alter existing resume files or master flags.
-- Idempotent.

create table if not exists public.resume_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_resume_id uuid not null references public.resumes (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  analysis_id uuid references public.job_matches (id) on delete set null,
  version_name text not null,
  resume_content jsonb not null default '{}'::jsonb,
  tailoring_summary jsonb not null default '{}'::jsonb,
  changes jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.resume_versions add column if not exists user_id uuid;
alter table public.resume_versions add column if not exists source_resume_id uuid;
alter table public.resume_versions add column if not exists job_id uuid;
alter table public.resume_versions add column if not exists analysis_id uuid;
alter table public.resume_versions add column if not exists version_name text;
alter table public.resume_versions add column if not exists resume_content jsonb not null default '{}'::jsonb;
alter table public.resume_versions add column if not exists tailoring_summary jsonb not null default '{}'::jsonb;
alter table public.resume_versions add column if not exists changes jsonb not null default '[]'::jsonb;
alter table public.resume_versions add column if not exists warnings jsonb not null default '[]'::jsonb;
alter table public.resume_versions add column if not exists created_at timestamptz not null default now();
alter table public.resume_versions add column if not exists updated_at timestamptz not null default now();

create index if not exists resume_versions_user_id_idx on public.resume_versions (user_id);
create index if not exists resume_versions_source_resume_id_idx on public.resume_versions (source_resume_id);
create index if not exists resume_versions_job_id_idx on public.resume_versions (job_id);
create index if not exists resume_versions_created_at_idx on public.resume_versions (created_at desc);
create index if not exists resume_versions_user_created_at_idx on public.resume_versions (user_id, created_at desc);

drop trigger if exists resume_versions_set_updated_at on public.resume_versions;
create trigger resume_versions_set_updated_at
  before update on public.resume_versions
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on table public.resume_versions to authenticated, service_role;

alter table public.resume_versions enable row level security;

drop policy if exists "Users can manage own resume versions" on public.resume_versions;
create policy "Users can manage own resume versions"
  on public.resume_versions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
