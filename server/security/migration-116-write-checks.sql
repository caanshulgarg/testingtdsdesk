-- Migration 116 (27-Oct-2026, branch next-sec-fix-sql; NOT run on staging: the owner reads it and runs it). Security review
-- of 27-Oct-2026, run 2, the items the owner approved: verify-sql-bridge.md V1, V3, V4 and verify-browser-known.md item 4.
--   1. A look-only member ('readonly') could queue a failed or cancelled posting again (Retry) and cancel a waiting one
--      (V1). tally_post_enqueue_to and tally_post_enqueue_core (migration 110's text) and tally_post_cancel (migration 5's
--      text) now refuse anyone who may not write (can_write(): an active owner or staff member), errcode 42501. The
--      3-argument tally_post_enqueue (migration 54) only calls tally_post_enqueue_to, so it is covered too. A call with
--      no signed-in person (the service role) is answered exactly as before: enqueue_to and enqueue_core still stop at
--      "f is null" first, and tally_post_cancel checks only a signed-in person (tally-ingest calls none of the three).
--   2. tally_post_row_remove and tally_post_row_restore (migration 49's text) refuse a member who may not write, after
--      the key check as before (V4).
--   3. lockout_access_token_hook (migration-3-phase2's text) refuses a token to a locked account only for a password
--      sign-in (the event's authentication_method = 'password'); a refresh, Google/Microsoft (oauth), two-step code
--      (totp) and the others pass, so an attacker who types wrong passwords for someone's email no longer signs that
--      person out or keeps them out through Google (item 4). The 15-minute lock on password sign-in stays.
--   4. tally_bridge_switches (migration 115): members read every column but from_firm and from_device, the other firm's
--      internal ids (V3). The app reads neither (it never reads the table); tally_bridge_whose answers booleans only.
-- Each function is its last definition in the repo with only the lines named above added or changed; every grant
-- restated explicitly. create or replace only; nothing dropped or deleted. One transaction, lock_timeout 10 s. Safe to
-- run twice. Runs after 110 and 115 (and migration-3-phase2). Tested on pg_stand: tests/run_migration116.py.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. posting: Retry / queue again, and cancel
create or replace function public.tally_post_enqueue_core(p_id uuid, p_client text, p_payload jsonb, p_device uuid, p_target text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); c record; n int; dup text; allowed text; cname text; j record; dev uuid; rr jsonb;
begin
  if f is null then raise exception 'not allowed'; end if;
  if not can_write() then raise exception 'Only the firm''s owner or staff can post to Tally.' using errcode = '42501'; end if;
  select t.company, t.device_id into c from tally_companies t
   where t.firm_id = f and t.client_id = p_client and t.device_id is not null order by t.last_seen desc nulls last limit 1;
  if c.company is null then return jsonb_build_object('ok', false, 'error', 'No Tally computer keeps this client''s company yet.'); end if;
  -- the one Tally company this client may post to: its link record's (migration 110), never clients.data postTo
  select tally_link_post_to(f, p_client, c.company), cl.name into allowed, cname from clients cl where cl.firm_id = f and cl.id = p_client;
  if allowed is null then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', case when exists (select 1 from tally_links l where l.firm_id = f and l.client_id = p_client and l.state = 'linked')
        then 'Posting into Tally is stopped for ' || coalesce(cname, 'this client') || ': allow it on the Tally page (the company''s ⋯ Post entries here). Nothing was posted.'
        else 'Link ' || coalesce(cname, 'this client') || ' to its company in Tally first (the Tally page). Its books in FinCom''s cloud come from ' || c.company || '.' end); end if;
  if lower(tally_nm(allowed)) <> lower(tally_nm(c.company)) then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', coalesce(cname, 'This client') || ' may post only to ' || allowed || ', but its books in FinCom''s cloud come from ' || c.company || '. Nothing was posted.'); end if;
  -- the same posting again (Retry, by its id alone): a failed or cancelled one waits again, under the same id (and on the
  -- same computer as before: never moved to another computer key, review M2; its bridge no longer able to post: that
  -- computer's bridge that may post, else refused in plain words, review M-B)
  select * into j from tally_post_jobs where id = p_id;
  if found then
    if j.firm_id <> f or j.client_id <> p_client then raise exception 'not allowed'; end if;
    if j.status in ('failed', 'cancelled') then
      select coalesce(i.entry_id, i.fincom_id) into dup from tally_post_ids i
       where i.job_id = p_id and exists (select 1 from tally_post_ids o where o.firm_id = i.firm_id and o.fincom_id = i.fincom_id and o.job_id <> p_id and o.live) limit 1;
      if dup is not null then return jsonb_build_object('ok', false, 'error', 'Not queued again: the entry ' || dup || ' is being posted in another posting; wait for that one to finish (or cancel it).'); end if;
      rr := tally_post_reroute(p_id, false);
      if rr ->> 'state' = 'stranded' then return jsonb_build_object('ok', false, 'company', j.company, 'error', 'Not queued again for ' || j.company || ': ' || (rr ->> 'words')); end if;
      update tally_post_jobs set status = 'waiting', message = 'Retry: waiting for the Tally computer', taken_at = null, updated_at = now(),
             attempts = coalesce(attempts, 0) + 1, resend_only = null where id = p_id;     -- final review M1: a person's Retry is a whole Retry
      return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'retry', true);
    end if;
    -- still waiting for a bridge that can no longer post: moved, or failed in plain words (review M-B)
    if j.status = 'waiting' then
      rr := tally_post_reroute(p_id, true);
      if rr ->> 'state' = 'stranded' then return jsonb_build_object('ok', false, 'company', j.company, 'error', 'Not posted into ' || j.company || ': ' || (rr ->> 'words')); end if;
    end if;
    return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'again', true);
  end if;
  if octet_length(p_payload::text) > 8 * 1024 * 1024 then return jsonb_build_object('ok', false, 'error', 'Too many entries in one go; post fewer at a time.'); end if;
  n := coalesce(jsonb_array_length(p_payload->'vouchers'), 0) + coalesce(jsonb_array_length(p_payload->'masters'), 0);
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'Nothing to post.'); end if;
  select v->>'id' into dup from tally_post_jobs j2, jsonb_array_elements(j2.payload->'vouchers') v
   where j2.firm_id = f and j2.client_id = p_client and j2.status in ('waiting', 'taken', 'running')
     and v->>'id' in (select x->>'id' from jsonb_array_elements(coalesce(p_payload->'vouchers', '[]'::jsonb)) x) limit 1;
  if dup is not null then return jsonb_build_object('ok', false, 'error', 'Some of these entries are already waiting to be posted; wait for that posting to finish.'); end if;
  -- review M4: the computer: the target's; else the newest that may post and has the company open
  dev := coalesce(p_device, tally_post_device_for(f, c.company, c.device_id));
  if dev is null then return jsonb_build_object('ok', false, 'company', c.company, 'error', tally_post_nobody_words(f, c.company)); end if;
  insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, target_bridge)
    values (p_id, f, p_client, c.company, dev, jsonb_build_object('masters', coalesce(p_payload->'masters', '[]'::jsonb), 'vouchers', coalesce(p_payload->'vouchers', '[]'::jsonb), 'ledger', coalesce(p_payload->>'ledger', '')), n,
            case when p_device is null then null else p_target end);
  return jsonb_build_object('ok', true, 'id', p_id, 'company', c.company);
end $function$;
revoke all on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) to service_role;

create or replace function public.tally_post_enqueue_to(p_id uuid, p_client text, p_payload jsonb, p_target text default null, p_device uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); t text := nullif(left(btrim(coalesce(p_target, '')), 40), ''); own record; tdev uuid; is_owner boolean; r jsonb; seen record; co text;
        allowed text; pick jsonb; lk boolean; mine boolean := true; note text;
begin
  if f is null then raise exception 'not allowed'; end if;
  if not can_write() then raise exception 'Only the firm''s owner or staff can post to Tally.' using errcode = '42501'; end if;
  -- the same posting again: the core decides, by 36b's rules, and never moves it to another computer key
  if exists (select 1 from tally_post_jobs j where j.id = p_id) then
    r := tally_post_enqueue_core(p_id, p_client, p_payload, null, null);
    return r || jsonb_build_object('target', (select j.target_bridge from tally_post_jobs j where j.id = p_id and j.firm_id = f));
  end if;
  -- no Tally company for the client, or not the one it may post to: the core's own words (nothing queued)
  select t2.company into co from tally_companies t2 where t2.firm_id = f and t2.client_id = p_client and t2.device_id is not null order by t2.last_seen desc nulls last limit 1;
  allowed := tally_link_post_to(f, p_client, co);
  if co is null or allowed is null or lower(tally_nm(allowed)) <> lower(tally_nm(co)) then
    return tally_post_enqueue_core(p_id, p_client, p_payload, null, null) || jsonb_build_object('target', null); end if;
  is_owner := exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true));
  select mb.device_id, mb.bridge_id into own from tally_member_bridges mb where mb.firm_id = f and mb.user_id = auth.uid() and mb.bridge_id is not null;
  if t is null then
    -- 9a: the poster's own bridge: the linked one (when it may post, is still bound to the linked computer, and has the
    -- company open or no other own bridge has it), else the newest of their own that may post with the company open
    lk := own.bridge_id is not null and own.device_id is not null and tally_bridge_device(f, own.bridge_id) is not distinct from own.device_id
          and tally_bridge_may_post(own.device_id, own.bridge_id);
    pick := tally_post_own_bridge(f, co, auth.uid());
    if lk and (pick is null or tally_bridge_has_open(own.device_id, own.bridge_id, co)) then
      t := own.bridge_id; tdev := own.device_id;
    elsif pick is not null then
      tdev := (pick ->> 'device')::uuid; t := pick ->> 'bridge';
    else
      return jsonb_build_object('ok', false, 'company', co, 'error', tally_post_own_words(f, co, auth.uid()));
    end if;
  else
    tdev := tally_bridge_device(f, t);
    mine := tally_bridge_is_own(f, auth.uid(), tdev, t);
    if not mine and not is_owner then
      return jsonb_build_object('ok', false, 'error', 'Only an owner of the firm can post through another bridge than your own.'); end if;
    if tdev is null then
      return jsonb_build_object('ok', false, 'error', 'FinCom has not heard from that bridge on any of the firm''s computers; nothing was queued.'); end if;
    -- review M3: named with its computer, the one the bridge id is bound to
    if p_device is null or p_device <> tdev then
      return jsonb_build_object('ok', false, 'error', 'That bridge is not on the computer named; nothing was queued. Refresh the Tally page and choose it again.'); end if;
    if tally_bridge_changes_only_on(tdev, t) then
      return jsonb_build_object('ok', false, 'error', 'That bridge is set to changes only: it reads Tally''s changes and never posts. Nothing was queued.'); end if;
    if not tally_bridge_may_post(tdev, t) then
      return jsonb_build_object('ok', false, 'error', 'That bridge only reads Tally: another bridge of the same Windows user is the main one on its computer. Nothing was queued.'); end if;
  end if;
  -- 9b: not heard from for more than 3 minutes: queued all the same; the bridge takes it when it is back
  if t is not null then
    select d.info -> 'bridges' -> t ->> 'at' as at, d.info -> 'bridges' -> t ->> 'user' as u into seen from tally_devices d where d.id = tdev;
    if coalesce(seen.at, '') !~ '^\d{4}-\d\d-\d\dT' or seen.at::timestamptz < now() - interval '3 minutes' then
      note := 'Queued: waits for ' || case when mine then 'your' else 'the' end || ' FinCom Bridge on ' || tally_bridge_words(tdev, t) || ' (not heard from since '
        || coalesce(to_char(case when coalesce(seen.at, '') ~ '^\d{4}-\d\d-\d\dT' then seen.at::timestamptz end at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST', 'it was set up')
        || '); it is posted as soon as that bridge is back. If it does not come back by itself, start it there (sign in to Windows' || coalesce(' as ' || nullif(seen.u, ''), '') || ').';
    end if;
  end if;
  r := tally_post_enqueue_core(p_id, p_client, p_payload, tdev, t);
  if note is not null and coalesce((r ->> 'ok')::boolean, false) then
    update tally_post_jobs set message = left(note, 300) where id = p_id and firm_id = f and status = 'waiting';
    r := r || jsonb_build_object('note', note);
  end if;
  return r || jsonb_build_object('target', (select j.target_bridge from tally_post_jobs j where j.id = p_id and j.firm_id = f));
end $function$;
revoke all on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) to authenticated, service_role;

create or replace function public.tally_post_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not can_write() then raise exception 'Only the firm''s owner or staff can cancel a posting to Tally.' using errcode = '42501'; end if;
  update tally_post_jobs set status = 'cancelled', message = 'Cancelled before the Tally computer took it', updated_at = now()
   where id = p_id and firm_id = my_firm() and status = 'waiting';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;
revoke all on function public.tally_post_cancel(uuid) from public, anon;
grant execute on function public.tally_post_cancel(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. the posting list: remove and restore rows
create or replace function public.tally_post_row_remove(p_keys text[], p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); ks text[]; k text; j text; n int := 0; c int; why text := nullif(left(btrim(coalesce(p_why, '')), 300), ''); ja int; js text;
begin
  ks := tally_post_row_keys(p_keys);
  if not can_write() then raise exception 'Only the firm''s owner or staff can remove rows from the posting list.' using errcode = '42501'; end if;
  if cardinality(ks) > 1 and not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can remove more than one row at a time' using errcode = '42501'; end if;
  -- the postings named, locked against a Retry until this call ends (a Retry updates the row: it waits for us)
  perform 1 from tally_post_jobs x where x.firm_id = f
     and x.id in (select split_part(q, ':', 1)::uuid from unnest(ks) q where q !~ '^local:') order by x.id for share;
  -- removing never cancels a posting: a row whose posting is still going on is refused, and nothing is removed
  foreach k in array ks loop
    j := split_part(k, ':', 1);
    if j <> 'local' and exists (select 1 from tally_post_jobs x where x.id = j::uuid and x.firm_id = f and (x.status in ('waiting', 'taken', 'running') or coalesce(x.checking, false)))
      then raise exception 'this row cannot be removed: its posting is still going on (%)', left(k, 80); end if;
  end loop;
  foreach k in array ks loop
    j := split_part(k, ':', 1); ja := null; js := null;
    if j <> 'local' then select x.status, coalesce(x.attempts, 0) into js, ja from tally_post_jobs x where x.id = j::uuid and x.firm_id = f; end if;
    insert into tally_post_row_flags (firm_id, row_key, kind, user_id, why, job_attempts, job_status)
      values (f, k, 'remove', auth.uid(), why, ja, js)
      on conflict (firm_id, row_key) where kind = 'remove'
      do update set user_id = excluded.user_id, at = now(), why = excluded.why, restored_at = null, restored_by = null,
                    job_attempts = excluded.job_attempts, job_status = excluded.job_status
         -- taken up again when restored, or when the removal went void (the posting started again since)
         where tally_post_row_flags.restored_at is not null or tally_post_row_flags.job_attempts is distinct from excluded.job_attempts;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end $function$;
revoke all on function public.tally_post_row_remove(text[], text) from public, anon;
grant execute on function public.tally_post_row_remove(text[], text) to authenticated;

create or replace function public.tally_post_row_restore(p_keys text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); ks text[]; n int; own boolean;
begin
  ks := tally_post_row_keys(p_keys);
  if not can_write() then raise exception 'Only the firm''s owner or staff can restore rows to the posting list.' using errcode = '42501'; end if;
  own := exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true));
  if cardinality(ks) > 1 and not own
    then raise exception 'only an owner of the firm can restore more than one row at a time' using errcode = '42501'; end if;
  -- another member restores only a removal they made themselves
  if not own and exists (select 1 from tally_post_row_flags x where x.firm_id = f and x.row_key = any(ks) and x.kind = 'remove' and x.restored_at is null and x.user_id <> auth.uid())
    then raise exception 'only an owner, or the member who removed it, can restore this row' using errcode = '42501'; end if;
  update tally_post_row_flags set restored_at = now(), restored_by = auth.uid()
   where firm_id = f and row_key = any(ks) and kind = 'remove' and restored_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'n', n);
end $function$;
revoke all on function public.tally_post_row_restore(text[]) from public, anon;
grant execute on function public.tally_post_row_restore(text[]) to authenticated;

-- ---------------------------------------------------------------- 3. the lock holds for password sign-ins only
-- Customize Access Token hook payload: {user_id, claims, authentication_method}; authentication_method is one of oauth,
-- password, otp, totp, recovery, invite, sso/saml, magiclink, email/signup, email_change, token_refresh,
-- oauth_provider/authorization_code, anonymous (Supabase Auth docs, auth-hooks/custom-access-token-hook)
create or replace function public.lockout_access_token_hook(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare until timestamptz;
begin
  select l.locked_until into until
  from public.auth_lockout l join auth.users u on lower(u.email) = l.email
  where u.id = (event->>'user_id')::uuid and l.locked_until > now();
  if until is not null and event->>'authentication_method' = 'password' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403,
      'message', 'Too many wrong passwords. Try again after ' || to_char(until at time zone 'Asia/Kolkata', 'HH24:MI') || ', or ask the firm''s owner to unlock you.'));
  end if;
  return event;
end $$;
grant execute on function public.lockout_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.lockout_access_token_hook(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. tally_bridge_switches: not the other firm's ids
-- revoking the table's select also takes back any column grant; then the safe columns only (no from_firm, from_device)
revoke select on public.tally_bridge_switches from authenticated;
grant select (id, bridge_id, state, to_firm, to_device, by_user, revoked_old, why, at) on public.tally_bridge_switches to authenticated;

commit;
