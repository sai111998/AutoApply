-- Link each application to the user-selected resume version and its latest match.
-- Does not duplicate resume content. Does not alter master resume files.
-- Preserves existing application rows. Idempotent.

alter table public.applications
  add column if not exists selected_resume_version_id uuid references public.resume_versions (id) on delete set null;

alter table public.applications
  add column if not exists current_match_id uuid references public.job_matches (id) on delete set null;

alter table public.applications
  add column if not exists current_match_score integer;

comment on column public.applications.match_id is
  'Original job analysis for this application. Never overwritten when a tailored version is selected.';

comment on column public.applications.selected_resume_version_id is
  'Resume version the user chose for this job. Null means the master/source resume is selected.';

comment on column public.applications.current_match_id is
  'Match analysis that belongs to the currently selected resume version.';

comment on column public.applications.current_match_score is
  'Score from the match engine for the currently selected resume version.';

create index if not exists applications_selected_resume_version_id_idx
  on public.applications (selected_resume_version_id);

create index if not exists applications_current_match_id_idx
  on public.applications (current_match_id);

-- Existing applications keep their original analysis as the current match until the user selects a version.
update public.applications
set current_match_id = match_id
where current_match_id is null
  and match_id is not null;

update public.applications as application
set current_match_score = job_matches.overall_score
from public.job_matches
where application.current_match_score is null
  and application.current_match_id = job_matches.id;
