-- M1: people and roles
-- Creates: profiles (one row per person) and student_links (who mentors / parents which student).
-- Security model (see CLAUDE.md 6.2):
--   * RLS on, policies below decide WHICH ROWS a logged-in user can see.
--   * GRANTs decide WHETHER a role can touch the table at all (auto-expose is OFF in our project).
--   * Creating, deleting and re-linking people is done only by server code using the secret key
--     (service_role), from the admin invite screen. Logged-in users cannot insert or delete here.
--   * anon (logged-out visitors) gets nothing.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('student', 'mentor', 'parent', 'admin');
create type public.link_relationship as enum ('mentor', 'parent');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  role                public.user_role not null,
  display_name        text not null check (char_length(btrim(display_name)) between 1 and 60),
  year_level          smallint check (year_level between 7 and 12),
  -- When a parent/guardian's consent was recorded (required for students).
  guardian_consent_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint students_need_guardian_consent
    check (role <> 'student' or guardian_consent_at is not null)
);

comment on table public.profiles is
  'One row per person. Minimal data only: no DOB, address, phone or photos (CLAUDE.md 6.1).';

create table public.student_links (
  student_id     uuid not null references public.profiles (id) on delete cascade,
  linked_user_id uuid not null references public.profiles (id) on delete cascade,
  relationship   public.link_relationship not null,
  created_at     timestamptz not null default now(),
  primary key (student_id, linked_user_id),
  constraint no_self_link check (student_id <> linked_user_id)
);

create index student_links_linked_user_id_idx on public.student_links (linked_user_id);

-- ---------------------------------------------------------------------------
-- Private helpers (the "private" schema is NOT exposed through the API)
-- ---------------------------------------------------------------------------
create schema if not exists private;

-- True if the current user is an admin. SECURITY DEFINER so it can read
-- profiles without triggering the profiles RLS policy again (avoids recursion).
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Keeps updated_at current.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

revoke all on schema private from public;
revoke all on all functions in schema private from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.student_links enable row level security;

-- profiles: you can see
--   * yourself,
--   * students you are linked to (as their mentor or parent),
--   * the mentors/parents linked to you (if you are a student),
--   * everyone, if you are an admin.
create policy "profiles: read self, linked people, or all if admin"
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_admin())
    or exists (
      select 1 from public.student_links l
      where (l.student_id = profiles.id and l.linked_user_id = (select auth.uid()))
         or (l.linked_user_id = profiles.id and l.student_id = (select auth.uid()))
    )
  );

-- profiles: you can update only your own row, and (via the column GRANT below)
-- only your display name. Nobody can change their own role.
create policy "profiles: update own row"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- student_links: you can see links you are part of; admins see all.
create policy "student_links: read own links, or all if admin"
  on public.student_links
  for select
  to authenticated
  using (
    student_id = (select auth.uid())
    or linked_user_id = (select auth.uid())
    or (select private.is_admin())
  );

-- ---------------------------------------------------------------------------
-- Grants (auto-expose is OFF, so nothing is reachable until granted)
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.student_links from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.student_links to authenticated;

-- Server-side admin code (secret key) manages people and links.
grant select, insert, update, delete on public.profiles, public.student_links to service_role;
grant usage on type public.user_role, public.link_relationship to authenticated, service_role;
