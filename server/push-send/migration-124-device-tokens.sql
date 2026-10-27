-- migration-124-device-tokens (27-Oct-2026, branch next-mobile; the owner: FinCom on Android and iOS, docs: the mobile
-- plan, mobile-plan.md). NOT run on staging yet: the owner runs it in the SQL editor. Numbers 119 to 123 are kept for the
-- console's modules; this one is the phone app's.
-- Push notifications to the FinCom phone app (due dates, alerts and the bell, posting results, call invites):
--   device_tokens       one row a phone (its push token from FCM): whose (user), which firm, android or ios, when the
--                       app last said it is there (last_seen), and disabled_at when the person signed out on it or FCM
--                       said the token is gone. A token is unique: a phone signed in by someone else moves to them.
--   device_token_save   the app, after sign-in (native only): adds or refreshes the signed-in person's phone
--   device_token_forget the app, on sign-out: that phone gets nothing more for this person
-- A member reads their own phones only (never another member's, never the token itself); every write goes through the
-- two functions above or the push-send function (service role). Nothing is sent from here.
-- Add-only: one table, one index, one policy, two functions, explicit grants (from 30-Oct-2026 Supabase gives none by
-- default). Nothing dropped or deleted. One transaction, lock_timeout 10 s, safe to run twice.
begin;
set local lock_timeout = '10s';

create table if not exists public.device_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  firm_id       uuid not null references public.firms(id),
  platform      text not null check (platform in ('android', 'ios')),
  token         text not null unique check (length(token) between 20 and 4096),
  app_version   text check (app_version is null or length(app_version) <= 40),
  created_at    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  disabled_at   timestamptz,
  disabled_why  text check (disabled_why is null or disabled_why in ('signed_out', 'unregistered', 'invalid', 'too_many'))
);
-- the sender's one read: a firm's (or some members') phones still in use
create index if not exists device_tokens_live on public.device_tokens (firm_id, user_id) where disabled_at is null;

alter table public.device_tokens enable row level security;
do $do$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'device_tokens' and policyname = 'device_tokens_own') then
    create policy device_tokens_own on public.device_tokens for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $do$;

-- the signed-in person's phone, added or refreshed (the app calls this after sign-in and when it comes to the front)
create or replace function public.device_token_save(p_platform text, p_token text, p_app_version text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  firm uuid := public.my_firm();
  kept uuid;
begin
  if uid is null then raise exception 'Sign in to the firm account first.' using errcode = '42501'; end if;
  if firm is null then raise exception 'This account is not a member of a firm.' using errcode = '42501'; end if;
  if p_platform is null or p_platform not in ('android', 'ios') then raise exception 'Unknown phone platform.' using errcode = '22023'; end if;
  if p_token is null or length(p_token) not between 20 and 4096 or p_token ~ '\s' then raise exception 'Not a push token.' using errcode = '22023'; end if;
  insert into public.device_tokens as d (user_id, firm_id, platform, token, app_version)
       values (uid, firm, p_platform, p_token, left(p_app_version, 40))
  on conflict (token) do update
     set user_id = excluded.user_id, firm_id = excluded.firm_id, platform = excluded.platform,
         app_version = coalesce(excluded.app_version, d.app_version), last_seen = now(), disabled_at = null, disabled_why = null
  returning d.id into kept;
  -- at most 10 phones in use a person: the ones not heard from longest are put aside
  update public.device_tokens set disabled_at = now(), disabled_why = 'too_many'
   where id in (select id from public.device_tokens where user_id = uid and disabled_at is null and id <> kept
                 order by last_seen desc offset 9);
  return jsonb_build_object('ok', true, 'id', kept);
end $$;

-- the app's sign-out: this phone gets nothing more for this person (only their own row; another person's is left alone)
create or replace function public.device_token_forget(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null then raise exception 'Sign in to the firm account first.' using errcode = '42501'; end if;
  update public.device_tokens set disabled_at = now(), disabled_why = 'signed_out'
   where token = p_token and user_id = uid and disabled_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'forgotten', n);
end $$;

-- ---------------------------------------------------------------- grants (explicit)
revoke all on public.device_tokens from public, anon, authenticated;
grant select (id, platform, app_version, created_at, last_seen, disabled_at, disabled_why) on public.device_tokens to authenticated;
grant select, insert, update, delete on public.device_tokens to service_role;
revoke all on function public.device_token_save(text, text, text) from public, anon;
grant execute on function public.device_token_save(text, text, text) to authenticated;
revoke all on function public.device_token_forget(text) from public, anon;
grant execute on function public.device_token_forget(text) to authenticated;

commit;
