-- Migration 184 (13-Nov-2026, branch next-post-queue-anyway; written, NOT run: the owner reads it and runs it). Item C of
-- the posting reliability plan, approved by the owner: a posting that holds some entries an earlier posting already holds.
-- Cloud side only: no bridge change, no new request to Tally; the bridge's rules (a request at most 2 s, one in flight,
-- postings first, the typing gate) untouched.
--
-- Before: one entry of a new posting found in a posting still waiting, taken or running refused them ALL ("Some of these
-- entries are already waiting to be posted; wait for that posting to finish."), and an entry whose FinCom id was live in
-- another posting (tally_post_ids: sent and not settled, or in Tally) raised at the insert and refused them all too. Two
-- pages posting overlapping entries at the same moment: the second saw nothing of the first (not committed yet) and was
-- refused whole by the id's unique index.
--
-- tally_post_enqueue_core (161's text, the same arguments and grants; every other line kept):
--   1. an advisory lock for the firm and client, held to the end of the transaction: one posting of a client is queued at
--      a time; the second waits (the caller's statement timeout bounds it), then sees the first one's posting.
--   2. the entries an earlier posting holds are left out, the others queued: a new posting holds only the NEW entries
--      (n counts them and the masters). An entry is held by: a posting of the client still waiting, taken or running with
--      the same entry id (the check as before), or a posting whose FinCom id of it is live (tally_post_ids, another
--      posting). Nothing is ever queued twice: the id's unique index stays the last guard, as before.
--   3. the answer names them: dupes: [{id, job, status}] (the entry, the posting that holds it, that posting's status).
--      Every entry held: nothing inserted, {ok: false, none: true, dupes, error: plain words} (ok false so a page built
--      before this branch shows the words, as it showed the refusal; the page of this branch follows the posting named).
-- Retry (the same posting id again) is as before, behind the same lock.
-- ADD-ONLY: one function replaced (create or replace, the same signature); no table, column, index, row or policy
-- changed; nothing dropped or deleted. Grants restated: service_role only. One transaction, lock_timeout 10 s, safe twice.
-- Runs after 161 and 174. Deploy order: 184, then the app build of this branch (without the build: an older page shows the
-- words for a posting wholly held, and for one partly held follows the new posting and says "Not posted." for the held
-- entries, which their own posting settles).
-- Tested on pg_stand: tests/run_migration184.py (RED_WITHOUT_184=1 fails).

begin;
set local lock_timeout = '10s';

-- 161's tally_post_enqueue_core; changed: the lock (1.), the held entries left out and named (2., 3.)
create or replace function public.tally_post_enqueue_core(p_id uuid, p_client text, p_payload jsonb, p_device uuid, p_target text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); c record; n int; dup text; allowed text; cname text; j record; dev uuid; rr jsonb;
        vs jsonb; dupes jsonb;   -- 184: the entries queued now, and those an earlier posting holds
begin
  if f is null then raise exception 'not allowed'; end if;
  if not can_write() then raise exception 'Only the firm''s owner or staff can post to Tally.' using errcode = '42501'; end if;
  -- 184: one posting of a client is queued at a time (two pages posting overlapping entries at the same moment: the second
  -- waits here, then sees the first one's posting); held to the end of the transaction
  perform pg_advisory_xact_lock(hashtext('tally_post_enqueue'), hashtext(f::text || ':' || coalesce(p_client, '')));
  select t.company, t.device_id into c from tally_companies t
   where t.firm_id = f and t.client_id = p_client and t.device_id is not null
     and not exists (select 1 from tally_split_links x where x.firm_id = f and x.book_id = t.book_id and x.client_id = p_client and x.state = 'linked')
   order by t.last_seen desc nulls last limit 1;
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
  -- 184: an entry an earlier posting holds is left out of this one, not a reason to refuse the rest: one in a posting
  -- still waiting, taken or running (by its entry id, as before), or one whose FinCom id is live in another posting
  -- (tally_post_ids: sent and not settled, or in Tally; before 184 the insert below raised on it and refused them all).
  -- Each is answered with the posting that holds it (dupes: [{id, job, status}]); the page follows that posting
  with lv as (select v->>'id' as id, j2.id as job, j2.status, j2.created_at
                from tally_post_jobs j2, jsonb_array_elements(case when jsonb_typeof(j2.payload->'vouchers') = 'array' then j2.payload->'vouchers' else '[]'::jsonb end) v
               where j2.firm_id = f and j2.client_id = p_client and j2.status in ('waiting', 'taken', 'running')),
       x as (select t.v, t.o, coalesce(a.job, b.job) as job, coalesce(a.status, b.status) as status
               from jsonb_array_elements(case when jsonb_typeof(p_payload->'vouchers') = 'array' then p_payload->'vouchers' else '[]'::jsonb end) with ordinality t(v, o)
               left join lateral (select lv.job, lv.status from lv where lv.id = t.v->>'id' order by lv.created_at limit 1) a on true
               left join lateral (select i.job_id as job, j3.status from tally_post_ids i join tally_post_jobs j3 on j3.id = i.job_id
                                   where i.firm_id = f and i.live and i.fincom_id = tally_fincom_id(t.v) and i.job_id <> p_id limit 1) b on true)
  select coalesce(jsonb_agg(x.v order by x.o) filter (where x.job is null), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('id', x.v->>'id', 'job', x.job, 'status', x.status) order by x.o) filter (where x.job is not null), '[]'::jsonb)
    into vs, dupes from x;
  -- every entry is in an earlier posting: nothing is queued (ok false with the words an older page shows; none: the page
  -- of this branch follows the posting named instead)
  if jsonb_array_length(dupes) > 0 and jsonb_array_length(vs) = 0 then
    return jsonb_build_object('ok', false, 'none', true, 'company', c.company, 'dupes', dupes,
      'error', case when exists (select 1 from jsonb_array_elements(dupes) d where d->>'status' in ('waiting', 'taken', 'running'))
        then 'These entries are already waiting to be posted in an earlier posting, which goes on by itself. Nothing was queued again.'
        else 'These entries are held by an earlier posting (sent to Tally, or waiting to be settled there); they are not sent twice. Nothing was queued again.' end);
  end if;
  n := jsonb_array_length(vs) + coalesce(jsonb_array_length(p_payload->'masters'), 0);
  -- review M4: the computer: the target's; else the newest that may post and has the company open
  dev := coalesce(p_device, tally_post_device_for(f, c.company, c.device_id));
  if dev is null then return jsonb_build_object('ok', false, 'company', c.company, 'error', tally_post_nobody_words(f, c.company)); end if;
  insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, target_bridge)
    values (p_id, f, p_client, c.company, dev, jsonb_build_object('masters', coalesce(p_payload->'masters', '[]'::jsonb), 'vouchers', vs, 'ledger', coalesce(p_payload->>'ledger', '')), n,
            case when p_device is null then null else p_target end);
  return jsonb_build_object('ok', true, 'id', p_id, 'company', c.company) || case when jsonb_array_length(dupes) > 0 then jsonb_build_object('dupes', dupes) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) to service_role;

commit;
