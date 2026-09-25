-- Cached structured resume evidence and full match payloads.
-- Idempotent. Does not delete existing analyses.

alter table public.resumes
  add column if not exists evidence_profile jsonb;

alter table public.resumes
  add column if not exists evidence_hash text;

alter table public.job_matches
  add column if not exists analysis_payload jsonb;

alter table public.job_matches
  add column if not exists summary text;
