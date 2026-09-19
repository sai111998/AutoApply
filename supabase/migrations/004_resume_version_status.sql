-- Resume version lifecycle: generation status, author, selection, and follow-up analysis.
-- Idempotent. Does not alter master resume files.

alter table public.resume_versions
  add column if not exists status text not null default 'completed';

alter table public.resume_versions
  add column if not exists created_by text not null default 'ai';

alter table public.resume_versions
  add column if not exists is_selected boolean not null default false;

alter table public.resume_versions
  add column if not exists generation_id text;

alter table public.resume_versions
  add column if not exists comparison_analysis_id uuid references public.job_matches (id) on delete set null;

alter table public.resume_versions
  add column if not exists original_content jsonb;

alter table public.job_matches
  add column if not exists parent_match_id uuid references public.job_matches (id) on delete set null;

alter table public.job_matches
  add column if not exists resume_version_id uuid references public.resume_versions (id) on delete set null;

create index if not exists resume_versions_source_job_idx
  on public.resume_versions (user_id, source_resume_id, job_id, created_at desc);

create index if not exists resume_versions_selected_idx
  on public.resume_versions (user_id, job_id, is_selected)
  where is_selected = true;

create index if not exists job_matches_parent_match_id_idx
  on public.job_matches (parent_match_id);

create index if not exists job_matches_resume_version_id_idx
  on public.job_matches (resume_version_id);

alter table public.resume_versions enable row level security;

drop policy if exists "Users can manage own resume versions" on public.resume_versions;
create policy "Users can manage own resume versions"
  on public.resume_versions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
