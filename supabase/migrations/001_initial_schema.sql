-- JobPilot AI initial schema
-- Matches src/lib/mappers.ts, src/types/domain.ts, src/context/WorkspaceContext.tsx,
-- src/context/AuthContext.tsx, and server/services/persist.ts.
-- Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- profiles.id is the auth.users.id. Other user-owned tables FK to profiles
-- (and therefore to auth.users) via user_id.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  location text,
  target_job_titles text[] not null default '{}'::text[],
  years_of_experience numeric,
  work_authorization text,
  sponsorship_required boolean not null default false,
  preferred_work_arrangement text,
  target_salary_min integer,
  target_salary_max integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists target_job_titles text[] not null default '{}'::text[];
alter table public.profiles add column if not exists years_of_experience numeric;
alter table public.profiles add column if not exists work_authorization text;
alter table public.profiles add column if not exists sponsorship_required boolean not null default false;
alter table public.profiles add column if not exists preferred_work_arrangement text;
alter table public.profiles add column if not exists target_salary_min integer;
alter table public.profiles add column if not exists target_salary_max integer;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_work_authorization_check;
alter table public.profiles add constraint profiles_work_authorization_check
  check (
    work_authorization is null
    or work_authorization in (
      'us_citizen',
      'us_permanent_resident',
      'work_visa',
      'needs_sponsorship',
      'other'
    )
  );

alter table public.profiles drop constraint if exists profiles_preferred_work_arrangement_check;
alter table public.profiles add constraint profiles_preferred_work_arrangement_check
  check (
    preferred_work_arrangement is null
    or preferred_work_arrangement in ('remote', 'hybrid', 'onsite', 'flexible')
  );

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  proficiency text not null default 'intermediate',
  years_experience numeric,
  created_at timestamptz not null default now()
);

alter table public.skills add column if not exists user_id uuid;
alter table public.skills add column if not exists name text;
alter table public.skills add column if not exists proficiency text not null default 'intermediate';
alter table public.skills add column if not exists years_experience numeric;
alter table public.skills add column if not exists created_at timestamptz not null default now();

alter table public.skills drop constraint if exists skills_proficiency_check;
alter table public.skills add constraint skills_proficiency_check
  check (proficiency in ('beginner', 'intermediate', 'advanced', 'expert'));

create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  file_name text not null,
  file_type text,
  version_label text not null,
  is_master boolean not null default false,
  file_size integer,
  storage_path text,
  parsed_text text,
  created_at timestamptz not null default now()
);

alter table public.resumes add column if not exists user_id uuid;
alter table public.resumes add column if not exists file_name text;
alter table public.resumes add column if not exists file_type text;
alter table public.resumes add column if not exists version_label text;
alter table public.resumes add column if not exists is_master boolean not null default false;
alter table public.resumes add column if not exists file_size integer;
alter table public.resumes add column if not exists storage_path text;
alter table public.resumes add column if not exists parsed_text text;
alter table public.resumes add column if not exists created_at timestamptz not null default now();

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  company text not null,
  location text,
  job_url text,
  description text not null,
  created_at timestamptz not null default now()
);

alter table public.jobs add column if not exists user_id uuid;
alter table public.jobs add column if not exists title text;
alter table public.jobs add column if not exists company text;
alter table public.jobs add column if not exists location text;
alter table public.jobs add column if not exists job_url text;
alter table public.jobs add column if not exists description text;
alter table public.jobs add column if not exists created_at timestamptz not null default now();

create table if not exists public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  resume_id uuid references public.resumes (id) on delete set null,
  overall_score integer,
  skills_matched jsonb not null default '[]'::jsonb,
  skills_partial jsonb not null default '[]'::jsonb,
  skills_missing jsonb not null default '[]'::jsonb,
  experience_match jsonb,
  education_match jsonb,
  location_match jsonb,
  work_authorization_notes text,
  strengths text[] not null default '{}'::text[],
  concerns text[] not null default '{}'::text[],
  recommendation text,
  analysis_status text not null default 'pending',
  analysis_source text not null default 'api',
  provider text,
  error_message text,
  summary text,
  analysis_payload jsonb,
  created_at timestamptz not null default now(),
  analyzed_at timestamptz
);

alter table public.job_matches add column if not exists user_id uuid;
alter table public.job_matches add column if not exists job_id uuid;
alter table public.job_matches add column if not exists resume_id uuid;
alter table public.job_matches add column if not exists overall_score integer;
alter table public.job_matches add column if not exists skills_matched jsonb not null default '[]'::jsonb;
alter table public.job_matches add column if not exists skills_partial jsonb not null default '[]'::jsonb;
alter table public.job_matches add column if not exists skills_missing jsonb not null default '[]'::jsonb;
alter table public.job_matches add column if not exists experience_match jsonb;
alter table public.job_matches add column if not exists education_match jsonb;
alter table public.job_matches add column if not exists location_match jsonb;
alter table public.job_matches add column if not exists work_authorization_notes text;
alter table public.job_matches add column if not exists strengths text[] not null default '{}'::text[];
alter table public.job_matches add column if not exists concerns text[] not null default '{}'::text[];
alter table public.job_matches add column if not exists recommendation text;
alter table public.job_matches add column if not exists analysis_status text not null default 'pending';
alter table public.job_matches add column if not exists analysis_source text not null default 'api';
alter table public.job_matches add column if not exists provider text;
alter table public.job_matches add column if not exists error_message text;
alter table public.job_matches add column if not exists summary text;
alter table public.job_matches add column if not exists analysis_payload jsonb;
alter table public.job_matches add column if not exists created_at timestamptz not null default now();
alter table public.job_matches add column if not exists analyzed_at timestamptz;

alter table public.job_matches drop constraint if exists job_matches_recommendation_check;
alter table public.job_matches add constraint job_matches_recommendation_check
  check (recommendation is null or recommendation in ('APPLY', 'REVIEW', 'SKIP'));

alter table public.job_matches drop constraint if exists job_matches_analysis_status_check;
alter table public.job_matches add constraint job_matches_analysis_status_check
  check (analysis_status in ('pending', 'queued', 'complete', 'failed', 'unavailable'));

alter table public.job_matches drop constraint if exists job_matches_analysis_source_check;
alter table public.job_matches add constraint job_matches_analysis_source_check
  check (analysis_source in ('sample', 'api'));

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  match_id uuid references public.job_matches (id) on delete set null,
  resume_id uuid references public.resumes (id) on delete set null,
  status text not null default 'ready',
  date_added date not null default current_date,
  date_applied date,
  next_action text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.applications add column if not exists user_id uuid;
alter table public.applications add column if not exists job_id uuid;
alter table public.applications add column if not exists match_id uuid;
alter table public.applications add column if not exists resume_id uuid;
alter table public.applications add column if not exists status text not null default 'ready';
alter table public.applications add column if not exists date_added date not null default current_date;
alter table public.applications add column if not exists date_applied date;
alter table public.applications add column if not exists next_action text;
alter table public.applications add column if not exists notes text;
alter table public.applications add column if not exists created_at timestamptz not null default now();
alter table public.applications add column if not exists updated_at timestamptz not null default now();

alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check
  check (status in ('ready', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'));

create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  ai_model_preference text,
  include_cover_letter boolean not null default true,
  min_match_score integer not null default 70,
  target_roles text[] not null default '{}'::text[],
  target_locations text[] not null default '{}'::text[],
  preferred_work_arrangements text[] not null default '{}'::text[],
  notify_on_strong_match boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences add column if not exists ai_model_preference text;
alter table public.user_preferences add column if not exists include_cover_letter boolean not null default true;
alter table public.user_preferences add column if not exists min_match_score integer not null default 70;
alter table public.user_preferences add column if not exists target_roles text[] not null default '{}'::text[];
alter table public.user_preferences add column if not exists target_locations text[] not null default '{}'::text[];
alter table public.user_preferences add column if not exists preferred_work_arrangements text[] not null default '{}'::text[];
alter table public.user_preferences add column if not exists notify_on_strong_match boolean not null default true;
alter table public.user_preferences add column if not exists created_at timestamptz not null default now();
alter table public.user_preferences add column if not exists updated_at timestamptz not null default now();

alter table public.user_preferences drop constraint if exists user_preferences_work_arrangements_check;
alter table public.user_preferences add constraint user_preferences_work_arrangements_check
  check (preferred_work_arrangements <@ array['remote', 'hybrid', 'onsite', 'flexible']::text[]);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists skills_user_id_idx on public.skills (user_id);
create index if not exists skills_user_id_name_idx on public.skills (user_id, name);
create unique index if not exists resumes_one_master_per_user on public.resumes (user_id) where is_master;
create index if not exists resumes_user_id_created_at_idx on public.resumes (user_id, created_at desc);
create index if not exists jobs_user_id_created_at_idx on public.jobs (user_id, created_at desc);
create index if not exists job_matches_user_id_created_at_idx on public.job_matches (user_id, created_at desc);
create index if not exists job_matches_job_id_idx on public.job_matches (job_id);
create index if not exists job_matches_resume_id_idx on public.job_matches (resume_id);
create index if not exists applications_user_id_date_added_idx on public.applications (user_id, date_added desc);
create index if not exists applications_job_id_idx on public.applications (job_id);
create index if not exists applications_match_id_idx on public.applications (match_id);
create index if not exists applications_resume_id_idx on public.applications (resume_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create profile + preferences on auth signup
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Grants (authenticated client; service_role bypasses RLS)
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated, anon, service_role;
grant select, insert, update, delete on table public.profiles to authenticated, service_role;
grant select, insert, update, delete on table public.skills to authenticated, service_role;
grant select, insert, update, delete on table public.resumes to authenticated, service_role;
grant select, insert, update, delete on table public.jobs to authenticated, service_role;
grant select, insert, update, delete on table public.job_matches to authenticated, service_role;
grant select, insert, update, delete on table public.applications to authenticated, service_role;
grant select, insert, update, delete on table public.user_preferences to authenticated, service_role;

revoke all on function public.handle_new_user() from public;
grant execute on function public.set_updated_at() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.skills enable row level security;
alter table public.resumes enable row level security;
alter table public.jobs enable row level security;
alter table public.job_matches enable row level security;
alter table public.applications enable row level security;
alter table public.user_preferences enable row level security;

drop policy if exists "Users can manage own profile" on public.profiles;
create policy "Users can manage own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Users can manage own skills" on public.skills;
create policy "Users can manage own skills"
  on public.skills for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own resumes" on public.resumes;
create policy "Users can manage own resumes"
  on public.resumes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own jobs" on public.jobs;
create policy "Users can manage own jobs"
  on public.jobs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own matches" on public.job_matches;
create policy "Users can manage own matches"
  on public.job_matches for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own applications" on public.applications;
create policy "Users can manage own applications"
  on public.applications for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own preferences" on public.user_preferences;
create policy "Users can manage own preferences"
  on public.user_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage: private resumes bucket
-- Upload path used by the app: {user.id}/{resume.id}/{fileName}
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Users can upload own resumes" on storage.objects;
create policy "Users can upload own resumes"
  on storage.objects for insert
  with check (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can read own resumes" on storage.objects;
create policy "Users can read own resumes"
  on storage.objects for select
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can update own resumes" on storage.objects;
create policy "Users can update own resumes"
  on storage.objects for update
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own resumes" on storage.objects;
create policy "Users can delete own resumes"
  on storage.objects for delete
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
