alter table public.resumes
  add column if not exists parsed_text text;

alter table public.job_matches
  add column if not exists summary text;

alter table public.job_matches
  add column if not exists analysis_payload jsonb;
