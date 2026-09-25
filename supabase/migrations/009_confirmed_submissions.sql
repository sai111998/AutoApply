-- Confirmed Auto Apply submissions. Queue items stay internal until confirmation.

alter table public.applications
  add column if not exists is_confirmed_submission boolean not null default false;

alter table public.applications
  add column if not exists submitted_job_description_snapshot text;

alter table public.applications
  add column if not exists confirmation_number text;

alter table public.applications
  add column if not exists confirmation_text text;

alter table public.applications
  add column if not exists submitted_at timestamptz;

alter table public.applications
  add column if not exists application_url text;

comment on column public.applications.is_confirmed_submission is
  'True only after a real employer submission was confirmed. Unconfirmed Auto Apply attempts must not appear as Applied.';

comment on column public.applications.submitted_job_description_snapshot is
  'Frozen job description captured at confirmed submission time.';

update public.applications
  set is_confirmed_submission = true
  where status = 'applied' and is_confirmed_submission is distinct from true;

alter table public.auto_apply_queue
  add column if not exists job_description_snapshot text;

alter table public.auto_apply_queue
  add column if not exists location text;

alter table public.auto_apply_queue
  add column if not exists confirmation_number text;

alter table public.auto_apply_queue
  add column if not exists confirmation_text text;

alter table public.auto_apply_queue
  add column if not exists submitted_at timestamptz;
