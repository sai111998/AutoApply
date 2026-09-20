-- Persistent Auto Apply question answers. Does not store employer passwords.

create table if not exists public.application_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  normalized_question text not null,
  prompt text not null,
  answer text not null,
  answer_type text not null default 'text',
  source text not null default 'user',
  user_approved boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_question)
);

create index if not exists application_answers_user_id_idx
  on public.application_answers (user_id, updated_at desc);

grant select, insert, update, delete on table public.application_answers to authenticated, service_role;

alter table public.application_answers enable row level security;

drop policy if exists "Users can manage own application answers" on public.application_answers;
create policy "Users can manage own application answers"
  on public.application_answers for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
