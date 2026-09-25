-- Optional seniority on saved/discovered jobs.
-- Does not replace jobs or saved_jobs.

alter table public.jobs add column if not exists seniority text;
