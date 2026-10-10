-- Migration 70 (08-Oct-2026, the independent review of next-alerts-clear: M2 and L(a)). Runs after 68 (68 is already run
-- on staging, md5 184e7959..., and is never edited). Needs only 68's table and functions; independent of 61-67 and 69.
-- ADD-ONLY: a privilege taken back, three CHECK constraints added and one function's text replaced; no row removed or
-- changed, nothing dropped; safe to run twice; one transaction (lock_timeout 10 s).
--
--   M2   68 granted INSERT on app_alert_dismissals to authenticated, so a browser could write rows past alert_dismiss's
--        caps (500 a call, key and fingerprint 2000 characters, words 500). Now the only way in is alert_dismiss
--        (security definer): INSERT is revoked from authenticated (SELECT kept; the add-own policy stays, unused).
--        And the lengths are CHECK constraints for every writer: alert_key and fingerprint <= 2000, words <= 500, added
--        NOT VALID then VALIDATEd (no long lock; rows written through alert_dismiss are within them already).
--   L(a) alert_dismissals_list lists up to 20000 rows (68: 5000), own and not undone, newest first. A dismissal cannot be
--        pruned when its notification is gone (the notification is worked out in the browser), so the cap is raised.
-- Tested by tests/run_migration70.py and tests/run_migration_order.py (70 after 68, both orders).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

revoke insert on public.app_alert_dismissals from authenticated;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.app_alert_dismissals'::regclass and conname = 'app_alert_dismissals_key_len') then
    alter table public.app_alert_dismissals add constraint app_alert_dismissals_key_len check (char_length(alert_key) <= 2000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.app_alert_dismissals'::regclass and conname = 'app_alert_dismissals_fp_len') then
    alter table public.app_alert_dismissals add constraint app_alert_dismissals_fp_len check (char_length(fingerprint) <= 2000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.app_alert_dismissals'::regclass and conname = 'app_alert_dismissals_words_len') then
    alter table public.app_alert_dismissals add constraint app_alert_dismissals_words_len check (char_length(words) <= 500) not valid;
  end if;
end $$;
alter table public.app_alert_dismissals validate constraint app_alert_dismissals_key_len;
alter table public.app_alert_dismissals validate constraint app_alert_dismissals_fp_len;
alter table public.app_alert_dismissals validate constraint app_alert_dismissals_words_len;

create or replace function public.alert_dismissals_list()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(jsonb_agg(jsonb_build_object('key', x.alert_key, 'fp', x.fingerprint, 'batch', x.batch, 'clearedAt', x.cleared_at) order by x.cleared_at desc), '[]'::jsonb)
    from (select d.* from app_alert_dismissals d
           where d.user_id = auth.uid() and d.firm_id = my_firm() and d.undone_at is null
           order by d.cleared_at desc limit 20000) x
$function$;
revoke all on function public.alert_dismissals_list() from public, anon;
grant execute on function public.alert_dismissals_list() to authenticated;

commit;
