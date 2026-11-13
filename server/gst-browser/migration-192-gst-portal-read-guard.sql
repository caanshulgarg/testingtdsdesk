-- Migration 192 (13-Nov-2026, branch next-sec-client; written, NOT run: the owner reads it and runs it). Needs migration 93
-- (the GST browser helper's portal login: gst_portal_logins, gst_portal_login_events, gst_portal_login_read) and Supabase
-- Auth (auth.jwt(), auth.mfa_factors); independent of every other migration. Web side: src/js/84-gst-browser.js asks for
-- the person's two-step code when the answer says need 'two_step', then reads once more (an older page shows the answer's
-- words and reads nothing: safe either way round, the migration may run before or after the app is published).
--
-- WHY. gst_portal_login_read hands a client's GST portal password (kept in Vault) to the page of the firm's owner, or of
-- a staff member the owner allowed, for the one fill of the portal's login form. 93 logs every read but does not slow
-- them: one signed-in page could read every client's password in a few seconds. Two conditions are added, both checked
-- on the server, in the function itself:
--   1. A FRESH TWO-STEP. The caller's sign-in must carry a two-step code (an authenticator app's) given in the last 10
--      minutes: the token is aal2 and its amr holds a second-step entry stamped inside that time (Supabase stamps it when
--      the code is checked, and keeps the stamp through token refreshes). Else nothing is read and the answer says
--      need 'two_step' (the page asks for the code); for a person who has not turned two-step sign-in on, the answer says
--      to turn it on. Not logged as a refusal: it is the ordinary first answer of every "Log in to GST portal".
--   2. A LIMIT. At most 5 passwords a minute and 40 an hour for one person (counted from gst_portal_login_events, the
--      reads 93 already logs; one person's calls are taken one at a time, so calls sent together cannot slip past the
--      count). Over it nothing is read; the refusal is logged ('refused', note 'read: too many', at most 3 such lines a
--      minute for a person, so a loop cannot fill the log) and the firm's members see it in the log as before.
-- 93's own rules are kept as they are, in the same order (signed in to the firm; a login saved; the owner, or a staff
-- member the owner allowed, else refused and logged; every read logged; the answer's fields).
--
-- ADD-ONLY: one new function (gst_portal_two_step_at: when the caller's sign-in last passed its second step; called by
-- the function below only, executable by no signed-in user), one new index (gst_portal_login_events by person and time,
-- for the count), and gst_portal_login_read REPLACED with the same signature, owner, security and grants (stated again
-- below). No table, column, row, policy or grant removed; nothing dropped; no 'delete from'; safe to run twice; one
-- transaction (lock_timeout 10 s). Migration 93 must not be run again after this one (it would put its own
-- gst_portal_login_read back); run 192 again if it ever is.
-- Tested by tests/run_migration192.py (pg_stand; twice; RED_WITHOUT_192=1 shows the same checks failing on 93 alone).

begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regprocedure('public.gst_portal_login_read(text, text)') is null or to_regclass('public.gst_portal_login_events') is null then
    raise exception 'migration 192 needs migration 93 (gst_portal_login_read, gst_portal_login_events): run 93 first';
  end if;
end $$;

-- the count below reads one person's lines of the last hour
create index if not exists gst_portal_login_events_by_user on public.gst_portal_login_events (user_id, at);

-- when the caller's sign-in last passed its second step (null: never, or the token is not aal2)
create or replace function public.gst_portal_two_step_at()
returns timestamptz language sql stable set search_path = '' as $$
  select max(to_timestamp((a ->> 'timestamp')::bigint))
  from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) a
  where coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    and jsonb_typeof(a) = 'object' and a ->> 'method' in ('totp', 'mfa/phone', 'mfa/webauthn')
    and jsonb_typeof(a -> 'timestamp') = 'number' and (a ->> 'timestamp') ~ '^[0-9]{9,11}$'
$$;

create or replace function public.gst_portal_login_read(p_client text, p_gstin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := public.my_firm(); r public.gst_portal_logins; g text := upper(btrim(coalesce(p_gstin, ''))); v_role text := public.gst_portal_role(); pw text;
  v_at timestamptz; n_min int; n_hour int;
begin
  if f is null or auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Sign in to the firm account first.'); end if;
  select * into r from public.gst_portal_logins l where l.firm_id = f and l.client_id = p_client and l.gstin = g and not l.deleted;
  if r.id is null or r.secret_id is null then return jsonb_build_object('ok', false, 'error', 'No GST portal login is saved for ' || g || '.'); end if;
  if not (v_role = 'owner' or (v_role = 'staff' and auth.uid() = any(r.staff_allowed))) then
    insert into public.gst_portal_login_events (firm_id, client_id, gstin, user_id, action, note) values (f, p_client, g, auth.uid(), 'refused', 'read: not allowed');
    return jsonb_build_object('ok', false, 'error', 'You are not allowed to use this client''s GST portal login. The firm''s owner can allow you in GST settings.');
  end if;
  -- 192, 1: a two-step code given in the last 10 minutes (a stamp from the future is not one)
  v_at := public.gst_portal_two_step_at();
  if v_at is null or v_at < now() - interval '10 minutes' or v_at > now() + interval '2 minutes' then
    if not exists (select 1 from auth.mfa_factors m where m.user_id = auth.uid() and m.status::text = 'verified') then
      return jsonb_build_object('ok', false, 'error', 'Turn on two-step sign-in first (Settings): a saved GST portal login is used only right after your two-step code.');
    end if;
    return jsonb_build_object('ok', false, 'need', 'two_step', 'error', 'Type your two-step code to use the saved GST portal login.');
  end if;
  -- 192, 2: at most 5 a minute and 40 an hour for one person; that person's calls one at a time
  perform pg_advisory_xact_lock(hashtextextended('gst_portal_login_read:' || auth.uid()::text, 0));
  select count(*) filter (where e.at > now() - interval '1 minute'), count(*) into n_min, n_hour
    from public.gst_portal_login_events e where e.user_id = auth.uid() and e.action = 'read' and e.at > now() - interval '1 hour';
  if n_min >= 5 or n_hour >= 40 then
    if (select count(*) from public.gst_portal_login_events e where e.user_id = auth.uid() and e.action = 'refused' and e.note = 'read: too many' and e.at > now() - interval '1 minute') < 3 then
      insert into public.gst_portal_login_events (firm_id, client_id, gstin, user_id, action, note) values (f, p_client, g, auth.uid(), 'refused', 'read: too many');
    end if;
    return jsonb_build_object('ok', false, 'error', 'Too many saved GST portal logins were used from your sign-in in a short time. Wait a few minutes, then try again.');
  end if;
  select d.decrypted_secret into pw from vault.decrypted_secrets d where d.id = r.secret_id;
  if pw is null then return jsonb_build_object('ok', false, 'error', 'The saved password could not be read; save it again in GST settings.'); end if;
  insert into public.gst_portal_login_events (firm_id, client_id, gstin, user_id, action) values (f, p_client, g, auth.uid(), 'read');
  return jsonb_build_object('ok', true, 'gstin', g, 'username', r.username, 'password', pw);
end $$;

-- the grants, stated again: the read as 93 gave it (signed-in users, never anon); the new function for the function above only
revoke all on function public.gst_portal_login_read(text, text) from public, anon;
grant execute on function public.gst_portal_login_read(text, text) to authenticated, service_role;
revoke all on function public.gst_portal_two_step_at() from public, anon, authenticated;
grant execute on function public.gst_portal_two_step_at() to service_role;

commit;
