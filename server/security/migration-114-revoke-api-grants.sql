-- migration 114: table privileges nobody should hold (OWASP review of 26-Oct-2026, branch next-sec-owasp; NOT RUN).
-- Add-only (revokes and grants only: no table, column, row, policy or function changed), one transaction, safe twice.
--
-- Why. Row level security already returns nothing for these, so no data has leaked; these are the second lock (A01, A05):
--   1. tally_period_pulls, tally_period_days, tally_ledger_progress (migration 98): its comment says "no grant to
--      authenticated or anon" (the app reads them only through 98's security definer functions; tally-ingest writes as
--      the service role), but 98 granted nothing away, so Supabase's default privileges left anon and authenticated
--      with SELECT, INSERT, UPDATE and DELETE (seen on staging 26-Oct-2026). The tables have no policy, so RLS refuses
--      every row; a single policy added later would have opened them to anyone holding the public key.
--   2. platform_secrets (the platform's API keys): anon and authenticated hold SELECT, with no SELECT policy (RLS
--      returns nothing). Nobody but the service role (the functions) reads it.
--   3. platform_admins: anon holds SELECT; its one policy (admins_read, is_superadmin()) is for authenticated only, which
--      keeps SELECT and nothing more.
-- Who is affected: nobody. Every read and write of these goes through the service role or a security definer function,
-- which keep their privileges; the grants to service_role are written out again below.
-- Deploy order: any time (no function or app change depends on it). Tested on pg_stand: tests/run_migration114.py.
begin;
set local lock_timeout = '10s';

do $do$
declare t text;
begin
  foreach t in array array['tally_period_pulls', 'tally_period_days', 'tally_ledger_progress'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on table public.%I from anon, authenticated', t);
      execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    end if;
  end loop;
  if to_regclass('public.platform_secrets') is not null then
    revoke all on table public.platform_secrets from anon, authenticated;
    grant select, insert, update, delete on table public.platform_secrets to service_role;
  end if;
  if to_regclass('public.platform_admins') is not null then
    -- authenticated: SELECT only (as staging holds it); on a fresh copy the default privileges would also give it
    -- INSERT/UPDATE/DELETE, one policy away from anyone making themself an administrator
    revoke all on table public.platform_admins from anon, authenticated;
    grant select on table public.platform_admins to authenticated;
    grant select, insert, update, delete on table public.platform_admins to service_role;
  end if;
end $do$;

commit;
