-- JobPilot AI: application profile fields on public.profiles.
-- The application agent needs first name, last name, and phone. full_name stays for existing features.
-- Row-level security is unchanged: the existing "Users can manage own profile" policy covers these columns.
-- Idempotent: safe to re-run.

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists phone text;

-- The Supabase API caches the table schema; until it reloads, saves that include these columns are rejected.
notify pgrst, 'reload schema';
