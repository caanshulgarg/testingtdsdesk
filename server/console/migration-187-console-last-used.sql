-- migration-187-console-last-used.sql (13-Nov-2026, branch next-sec-db; the database review of 13-Nov-2026, item M2).
-- Written, NOT run yet: the owner reads it and runs it. Needs migration 122.
-- Why: the console's Keys page shows when each platform key was last used (console_secret_last_used, migration 122). It
-- read each time through console_try_ts(p_sql), a helper that ran the text it was given. Only this file's own fixed
-- texts were ever passed to it, but the helper itself took any text and the service role could call it.
-- What it does:
--   console_last_ts(p_what)      new: the latest time of ONE named reading from a fixed list written here (a name it does
--                                not know: null; a table or column that is not on this database: null, as before). It
--                                takes a name, never a query. Nobody but the owner of the database may call it.
--   console_secret_last_used()   replaced, same arguments, same answer: each reading by its name.
--   console_try_ts(p_sql)        replaced, same arguments: it runs nothing any more and answers null (kept so that
--                                nothing that names it fails); taken back from the service role.
-- The Keys page needs no change (server/console/modules/keys.ts calls console_secret_last_used as before).
-- Add-only: one new function, two replaced with the same arguments; no table, column or row changed; grants restated.
-- One transaction, lock_timeout 10 s; safe twice. Tested by tests/run_migration187.py (pg_stand).
begin;
set local lock_timeout = '10s';

create or replace function public.console_last_ts(p_what text)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare v timestamptz; q text;
begin
  q := case p_what
    when 'wallet_claude'      then $q$select max(at) from public.wallet_entries where code = 'claude'$q$
    when 'wallet_vision'      then $q$select max(at) from public.wallet_entries where code = 'vision'$q$
    when 'assistant_log'      then $q$select max(at) from public.assistant_log$q$
    when 'assistant_usage'    then $q$select (max(day) + 1)::timestamp at time zone 'Asia/Kolkata' - interval '1 second' from public.assistant_usage$q$
    when 'call_captions_made' then $q$select max(created_at) from public.call_captions$q$
    when 'call_captions_at'   then $q$select max(at) from public.call_captions$q$
    when 'call_transcripts'   then $q$select max(created_at) from public.call_transcripts$q$
    when 'mis_runs_emailed'   then $q$select max(created_at) from public.mis_runs where emailed > 0$q$
    when 'call_invites'       then $q$select max(created_at) from public.call_invites$q$
    when 'gst_returns'        then $q$select max(fetched_at) from public.gst_returns$q$
    when 'gst_filing_log'     then $q$select max(at) from public.gst_filing_log$q$
    when 'gst_sessions'       then $q$select max(updated_at) from public.gst_sessions$q$
    when 'zoho_api_usage'     then $q$select max(at) from public.zoho_api_usage$q$
    when 'zoho_log_at'        then $q$select max(at) from public.zoho_log$q$
    when 'zoho_log_made'      then $q$select max(created_at) from public.zoho_log$q$
    when 'call_rooms_made'    then $q$select max(created_at) from public.call_rooms$q$
    when 'call_rooms_started' then $q$select max(started_at) from public.call_rooms$q$
  end;
  if q is null then return null; end if;
  execute q into v;
  return v;
exception when others then
  return null;
end $$;

-- when each key was last used, where FinCom can know it: the latest row its features wrote (null: not known)
create or replace function public.console_secret_last_used()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'claude', greatest(public.console_last_ts('wallet_claude'), public.console_last_ts('assistant_log'), public.console_last_ts('assistant_usage')),
    'vision', public.console_last_ts('wallet_vision'),
    'groq', greatest(public.console_last_ts('call_captions_made'), public.console_last_ts('call_captions_at'), public.console_last_ts('call_transcripts')),
    'resend', greatest(public.console_last_ts('mis_runs_emailed'), public.console_last_ts('call_invites')),
    'taxpro', greatest(public.console_last_ts('gst_returns'), public.console_last_ts('gst_filing_log'), public.console_last_ts('gst_sessions')),
    'zoho', greatest(public.console_last_ts('zoho_api_usage'), public.console_last_ts('zoho_log_at'), public.console_last_ts('zoho_log_made')),
    'fyn', null,
    'cf_realtime', greatest(public.console_last_ts('call_rooms_made'), public.console_last_ts('call_rooms_started')),
    'call_guest', public.console_last_ts('call_invites'));
end $$;

-- 122's helper: nothing is run from a text any more
create or replace function public.console_try_ts(p_sql text)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
begin
  return null;
end $$;

revoke all on function public.console_try_ts(text), public.console_last_ts(text) from public, anon, authenticated, service_role;
revoke all on function public.console_secret_last_used() from public, anon, authenticated;
grant execute on function public.console_secret_last_used() to service_role;

commit;
