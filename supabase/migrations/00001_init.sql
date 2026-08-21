-- JobPilot AI schema
-- Run in the Supabase SQL editor after creating a project.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  location text,
  target_job_titles text[] not null default '{}',
  years_of_experience numeric,
  work_authorization text,
  sponsorship_required boolean not null default false,
  preferred_work_arrangement text,
  target_salary_min integer,
  target_salary_max integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  proficiency text not null default 'intermediate'
    check (proficiency in ('beginner', 'intermediate', 'advanced', 'expert')),
  years_experience numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  file_name text not null,
  file_type text,
  version_label text not null,
  is_master boolean not null default false,
  file_size integer,
  storage_path text,
  created_at timestamptz not null default now()
);

create unique index if not exists resumes_one_master_per_user
  on public.resumes (user_id)
  where is_master;

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
  strengths text[] not null default '{}',
  concerns text[] not null default '{}',
  recommendation text check (recommendation in ('APPLY', 'REVIEW', 'SKIP')),
  analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'queued', 'complete', 'failed', 'unavailable')),
  analysis_source text not null default 'api'
    check (analysis_source in ('sample', 'api')),
  provider text,
  error_message text,
  created_at timestamptz not null default now(),
  analyzed_at timestamptz
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  match_id uuid references public.job_matches (id) on delete set null,
  resume_id uuid references public.resumes (id) on delete set null,
  status text not null default 'ready'
    check (status in ('ready', 'applied', 'interview', 'offer', 'rejected', 'withdrawn')),
  date_added date not null default current_date,
  date_applied date,
  next_action text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  ai_model_preference text,
  include_cover_letter boolean not null default true,
  min_match_score integer not null default 70,
  target_roles text[] not null default '{}',
  target_locations text[] not null default '{}',
  preferred_work_arrangements text[] not null default '{}',
  notify_on_strong_match boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

alter table public.profiles enable row level security;
alter table public.skills enable row level security;
alter table public.resumes enable row level security;
alter table public.jobs enable row level security;
alter table public.job_matches enable row level security;
alter table public.applications enable row level security;
alter table public.user_preferences enable row level security;

create policy "Users can manage own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can manage own skills"
  on public.skills for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own resumes"
  on public.resumes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own jobs"
  on public.jobs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own matches"
  on public.job_matches for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own applications"
  on public.applications for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own preferences"
  on public.user_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

create policy "Users can upload own resumes"
  on storage.objects for insert
  with check (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can read own resumes"
  on storage.objects for select
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update own resumes"
  on storage.objects for update
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own resumes"
  on storage.objects for delete
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
