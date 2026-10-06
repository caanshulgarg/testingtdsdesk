-- Migration 58 (06-Oct-2026, bridge 2.3.1: the deferred cloud Low of the 2.3.0 review round 1). Runs after 55 (fresh
-- database and staging; independent of 56 and 57: it touches only the privileges of tables 54 and 55 made). ADD-ONLY: no
-- table, column, row, policy or function removed; no statement here removes rows; safe to run twice; one transaction.
--
-- 54 and 55 revoked only insert and update from anon and authenticated on their new tables. Supabase grants both roles
-- every privilege on a new public table (and its sequence) by default, so they kept delete, references, trigger and the
-- privilege that empties a table at once, which row security does not cover. Here: all revoked from anon and
-- authenticated on the seven tables and their id sequences, select granted back to authenticated (row security still shows
-- a firm only its own rows). The functions (security definer) and the service role are unchanged.
-- Tested by tests/run_migration58.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

do $$
declare t text; s text;
begin
  foreach t in array array['tally_bridge_prefs', 'tally_member_bridges', 'tally_bridge_ids', 'tally_bridge_alerts', 'tally_bridge_rollbacks',
                           'tally_bridge_release_log', 'tally_post_checks'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'Migration 58: public.% is not there (run 54 and 55 first); skipped', t;
      continue;
    end if;
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    s := case when exists (select 1 from pg_attribute where attrelid = ('public.' || t)::regclass and attname = 'id' and not attisdropped)
              then pg_get_serial_sequence('public.' || t, 'id') end;
    if s is not null then
      execute format('revoke all on sequence %s from anon, authenticated', s);
    end if;
  end loop;
end $$;

commit;
