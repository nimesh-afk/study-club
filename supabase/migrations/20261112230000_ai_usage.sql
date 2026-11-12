-- M2 (pulled forward from M6): ai_usage
-- One row per Claude API call, written by server code AFTER the call (CLAUDE.md 6.3, 6.4).
-- Used for: the monthly budget cap, the per-student daily cap, and an admin spend view.
-- Security model (see CLAUDE.md 6.2):
--   * Rows are written only by server code using the secret key (service_role).
--   * Logged-in users can read rows only if they are an admin (RLS below).
--   * No prompts, responses, names or emails are stored here: just counts and cost.
--   * anon (logged-out visitors) gets nothing.

create table public.ai_usage (
  id            bigint generated always as identity primary key,
  -- Who the call was made for. Null for background jobs with no user.
  -- "set null" keeps the cost history if a person is removed.
  user_id       uuid references public.profiles (id) on delete set null,
  purpose       text not null check (char_length(purpose) between 1 and 60),
  model         text not null,
  input_tokens  integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  -- Cost in US cents, with fractions: a small Haiku call costs well under 1 cent.
  cost_cents    numeric(12, 4) not null check (cost_cents >= 0),
  created_at    timestamptz not null default now()
);

comment on table public.ai_usage is
  'One row per Claude API call: counts and cost only, never prompt or response text (CLAUDE.md 6.1).';

create index ai_usage_created_at_idx on public.ai_usage (created_at);
create index ai_usage_user_id_created_at_idx on public.ai_usage (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Spend so far this calendar month (Melbourne time), in cents.
-- A database function, so the total is always complete (the API would
-- otherwise return at most 1000 rows to sum). Only server code may call it.
-- ---------------------------------------------------------------------------
create or replace function public.ai_spend_this_month_cents()
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(cost_cents), 0)
  from public.ai_usage
  where created_at >= date_trunc('month', now() at time zone 'Australia/Melbourne')
                      at time zone 'Australia/Melbourne';
$$;

revoke all on function public.ai_spend_this_month_cents() from public, anon, authenticated;
grant execute on function public.ai_spend_this_month_cents() to service_role;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.ai_usage enable row level security;

-- Only admins can read usage (for a future spend page). Nobody writes through
-- their own session: server code logs usage with the secret key.
create policy "ai_usage: admins read all"
  on public.ai_usage
  for select
  to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Grants (auto-expose is OFF, so nothing is reachable until granted)
-- ---------------------------------------------------------------------------
revoke all on public.ai_usage from anon, authenticated;

grant select on public.ai_usage to authenticated;
grant select, insert on public.ai_usage to service_role;
