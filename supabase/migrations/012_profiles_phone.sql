-- JobPilot AI: candidate contact phone on the canonical profile.
-- The application agent requires a phone number; previously no storage existed.
-- Idempotent: safe to re-run.

alter table public.profiles add column if not exists phone text;
