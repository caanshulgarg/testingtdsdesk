-- Migration 43 (03-Oct-2026, round 15, build 2.1.8: posting by Tally's reply). Runs AFTER 42 (fresh database:
-- 39 -> 40 -> 41 -> 42 -> 43; docs/MIGRATION-ORDER.md). Add-only (columns added if missing; functions created or replaced
-- with the same arguments; two new functions; no table, nothing dropped or deleted), safe to run twice. Shown to the
-- owner before it runs.
--
--   1. THE CAP GAP. THE 8-ARGUMENT tally_ingest_day HERE SUPERSEDES 42's (42's text byte for byte, but the count the cap
--      tests); the 7-argument wrapper of 41 stays as it is (it calls this one by name). 42 counted the book's days with
--      an empty read recorded in the LAST 24 HOURS, so a read fault that lists no entries for a book with entries, repeated
--      every 25 hours (a nightly catch-up on a slow night), found the cap lifted each night: the ten days recorded pending
--      on night 1 would be marked on night 2 as their "second empty read". Here pend counts (a) every PENDING day of the
--      book however old: empty_at set and the note starting 'empty day with' (a first empty read never confirmed by a
--      second one, nor cleared by a file with entries), plus (b) the days an empty read MARKED in the last 24 hours (the
--      note starting with a number and containing 'marked deleted on the second empty read'); days recorded 'empty day,
--      nothing to mark' never count. So a repeating read fault records at most 10 days as pending once and then refuses
--      every day of the book (emptyCapped) however long it repeats, and the live count never changes; a genuine emptying
--      of up to 9 days still marks on the second read; a file with entries clears a day's pending record (as 42) and the
--      cap counts it no more. Nothing else of 42 changes.
--   2. PER-COMPUTER POSTING SETTINGS (owner item F3). tally_devices.post_only jsonb (null = no restriction; a JSON array of
--      company names; [] = any company), post_batch_bills integer, post_batch_bank integer (how many vouchers one Tally
--      request carries, 1..500), post_settings_at timestamptz, post_settings_by uuid. The owner's
--      tally_device_post_settings(p_device uuid, p_post_only jsonb, p_bills integer, p_bank integer) returns jsonb:
--      the caller must be an owner of the device's firm (the owner check of tally_read_stop, migration 35; a revoked
--      computer or another firm's is 'not a computer of your firm'); a NULL argument leaves that value as it is;
--      p_post_only '[]' means any company (stored as []), 'null'::jsonb clears to no restriction (stored null), an array of
--      names is cleaned (strings only, trimmed, cut to 200, blanks dropped, at most 20), anything else is refused with
--      words; p_bills / p_bank 1..500 else refused with words; post_settings_at / post_settings_by stamped on every change;
--      the answer carries the row's four values (postOnly, postBatchBills, postBatchBank, at). Granted to authenticated;
--      the four columns readable by the firm (as migration 22's main_*). tally-ingest's beat answers them to the bridge.
--   3. TALLY'S REPLY IDS. tally_post_ids.reply_vch text (Tally's exact voucher id when the request held one voucher; NOT
--      named vch: 36b's tally_post_id_accept and tally_post_job_mark_posted declare a local `vch`, and a column of that
--      name would make their updates of tally_post_ids ambiguous in PL/pgSQL - the stamp and the owner's mark would stop
--      working on staging), batch_end text (the LASTVCHID of the request's reply), batch_n integer (how many vouchers
--      that request held), matched_at timestamptz, matched_vch text (for the later comparison with the day read back;
--      nothing writes them yet).
--      tally_post_id_accept_reply(p_job uuid, p_id text, p_vch text, p_batch_end text, p_batch_n integer) returns jsonb:
--      the companion of tally_post_id_accept (36b; its text is NOT changed, this one calls it): stamps accepted_at if
--      null, accepted_vch and reply_vch when p_batch_n = 1, batch_end and batch_n always; live stays true (36b's rules on an
--      owner's release apply as there). Service role only; stamped 0 when no id of the posting matches.
--   4. THE REPLY STATES. tally_post_result_taken(r) (40) is also true for a result with byReply = true and ok = true
--      (posted by Tally's reply: taken, never held open) and for needsReview = true with accepted = true (Tally created
--      something: the id stays locked, never resent); tally_post_result_confirmed stays its wrapper. tally_post_job_settle
--      (36b, the same arguments): a byReply ok result counts as posted; a needsReview result counts as 'needs review'
--      (neither posted nor failed): a posting with the bridge whose entries are all posted, needing review or failed, with
--      at least one needing review, is 'done' with checking false; everything failed is 'failed' as today; the answer
--      also carries review (K) and message: 'Posted N of M; K need review' when K > 0, else 'Posted N of M'.
--      tally_post_job_accepted (41's text): a needsReview + accepted entry is accepted-not-confirmed (held by the resend
--      guard, the requeue and the sync); a byReply ok entry is confirmed. tally_post_ids_sync: unchanged rule (40's text
--      stays): a needsReview + accepted id and a byReply ok id stay live when the posting ends done or failed.
--   5. tally_post_jobs.timing jsonb: the bridge's request timings of a posting ({reqs: [{n, seconds, created, altered,
--      exceptions, ignored, lastVchId}], secondsTotal}), written by tally-ingest's posts_update.
--   Every function here: security definer where it reads tables, search_path = public, pg_temp; grants as before.

begin;

-- ---------------------------------------------------------------- 1. the cap gap: 42's tally_ingest_day with the pending days counted however old
create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer, p_empty boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare touched date[]; f uuid; sent text[]; marked int := 0; n_in int := case when jsonb_typeof(p_vouchers) = 'array' then jsonb_array_length(p_vouchers) else 0 end; short text; emptied boolean := false; live_n int; prev_empty timestamptz; d_empty timestamptz; d_note text; pend int; capped boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  select coalesce(array_agg(distinct x->>'guid'), '{}') into sent from jsonb_array_elements(p_vouchers) x where coalesce(x->>'guid', '') <> '';
  select array_agg(distinct d) into touched from (
    select p_day as d
    union select v.day from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  ) q;
  -- 8: the lines these entries hold now go on their current version rows before anything is replaced
  perform tally_voucher_version_lines(p_book, array(select v.guid from tally_vouchers v where v.book_id = p_book and (v.day = p_day or v.guid = any(sent))));
  -- the entries in the file: inserted, or brought up to date in place (deleted_at cleared); a version row for each AlterID
  insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos, ref, ref_date, cmp_gstin, fincom_id, deleted_at)
  select distinct on (x->>'guid') p_book, f, x->>'guid', p_day, coalesce((x->>'alter')::bigint, 0), coalesce(x->>'type', ''), coalesce(x->>'no', ''),
         tally_nm(x->>'party'), left(coalesce(x->>'narr', ''), 300), coalesce((x->>'cancel')::boolean, false), coalesce((x->>'opt')::boolean, false),
         left(upper(coalesce(x->>'gstin', '')), 15), left(coalesce(x->>'pos', ''), 60),
         left(coalesce(x->>'ref', ''), 60), tally_d8(x->>'refDate'), left(upper(coalesce(x->>'cmp', '')), 15),
         case when coalesce(x->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then x->>'fid' end, null
    from jsonb_array_elements(p_vouchers) x
   order by x->>'guid', coalesce((x->>'alter')::bigint, 0) desc
  on conflict (book_id, guid) do update set
     day = excluded.day, alter_id = excluded.alter_id, vtype = excluded.vtype, vno = excluded.vno, party = excluded.party, narration = excluded.narration,
     cancelled = excluded.cancelled, optional = excluded.optional, gstin = excluded.gstin, pos = excluded.pos, ref = excluded.ref, ref_date = excluded.ref_date,
     cmp_gstin = excluded.cmp_gstin, deleted_at = null,
     fincom_id = coalesce(excluded.fincom_id, substring(excluded.narration from 'TDSDesk:([A-Za-z0-9._-]+)'), tally_vouchers.fincom_id),
     origin = case when excluded.fincom_id is not null or excluded.narration ~ 'TDSDesk:[A-Za-z0-9]' then 'fincom' else tally_vouchers.origin end;
  insert into tally_voucher_versions (book_id, firm_id, tally_guid, alter_id, payload)
  select v.book_id, v.firm_id, v.guid, coalesce(v.alter_id, 0), to_jsonb(v) from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  on conflict (book_id, tally_guid, alter_id) do nothing;
  -- the day's entries not in the file: marked, kept (lines and bills kept too) - but NEVER on a short read (migration 38,
  -- item 9): a file with no entries, or fewer than the bridge counted for the day (p_n), upserts what came and marks
  -- nothing; the answer says refused: 'short read: n of p_n' and tally-ingest logs it
  select d.empty_at into prev_empty from tally_days d where d.book_id = p_book and d.day = p_day;
  select count(*) into live_n from tally_vouchers v where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
  if n_in = 0 and coalesce(p_n, 0) = 0 and p_empty is true then
    -- migration 39: the bridge positively read the day and Tally listed no entries. Migration 42: a day that still has
    -- live entries is emptied only on the SECOND consecutive empty read (the first is recorded in tally_days.empty_at
    -- and refused); a day with no live entries has nothing to mark and is recorded as empty at once. Decided by
    -- empty_at and the live count alone, never by tally_days.n. A later file with entries un-marks them and clears the record
    -- the cap (migration 43): the book's days still PENDING a second empty read, however old (a first empty read never
    -- confirmed), plus the days an empty read MARKED in the last 24 hours; days with nothing to mark never count
    select count(*) into pend from tally_days d where d.book_id = p_book and d.empty_at is not null
       and (d.note like 'empty day with%' or (d.empty_at >= now() - interval '24 hours' and d.note ~ '^\d+ entries marked deleted on the second empty read'));
    if live_n = 0 then
      emptied := true; d_empty := now(); d_note := 'empty day, nothing to mark';
    elsif pend >= 10 then
      short := format('%s days of this book read empty within 24 hours: a read fault; this day is not emptied and not recorded; nothing marked', pend);
      capped := true;
    elsif prev_empty is null then
      short := format('empty day with %s live entries: confirm by a second empty read', live_n);
      d_empty := now(); d_note := short;
    else
      update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
      get diagnostics marked = row_count; emptied := true;
      d_empty := now(); d_note := format('%s entries marked deleted on the second empty read (the first at %s)', marked, to_char(prev_empty at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS "UTC"'));
    end if;
  elsif n_in = 0 or n_in < coalesce(p_n, 0) then
    short := format('short read: %s of %s', n_in, coalesce(p_n, 0));
  else
    update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null and not (v.guid = any(sent));
    get diagnostics marked = row_count;
  end if;
  -- a re-sent entry's lines and bills are replaced (its old ones are on its old version row)
  delete from tally_bills b where b.book_id = p_book and b.guid = any(sent);
  delete from tally_lines l where l.book_id = p_book and l.guid = any(sent);
  insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, hsn, rate)
  select p_book, f, x->>0, p_day, tally_nm(x->>1), (x->>2)::numeric, left(coalesce(x->>3, ''), 20), nullif(x->>4, '')::numeric from jsonb_array_elements(p_lines) x;
  insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due)
  select p_book, f, x->>0, p_day, tally_nm(x->>1), left(coalesce(b->>0, ''), 200), left(coalesce(b->>1, ''), 20), (b->>2)::numeric,
         case when b->>1 in ('New Ref', 'Advance') then p_day end,
         nullif(b->>3, '')::integer,
         case when b->>1 = 'New Ref' and nullif(b->>3, '') is not null then p_day + (b->>3)::integer end
    from jsonb_array_elements(p_lines) x, jsonb_array_elements(case when jsonb_typeof(x->5) = 'array' then x->5 else '[]'::jsonb end) b
   where coalesce(b->>2, '') <> '';
  perform tally_voucher_version_lines(p_book, sent);
  -- the day cache, from live entries only
  delete from tally_ledger_day t where t.book_id = p_book and t.day = any(touched);
  insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
  select p_book, f, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
    from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
   where l.book_id = p_book and l.day = any(touched) and v.deleted_at is null and not v.cancelled and not v.optional
   group by l.ledger, l.day;
  -- the day's bookkeeping. An empty read is recorded (empty_at, note); a file with entries clears the record. Migration 42:
  -- an empty file that marked nothing (a refused first empty read, a short read) keeps the n the day had, so the day's
  -- count is never zeroed by a read that changed nothing
  insert into tally_days (book_id, firm_id, day, n, alter_max, bytes, at, empty_at, note) values (p_book, f, p_day, p_n, p_alter, p_bytes, now(), d_empty, d_note)
  on conflict (book_id, day) do update set
     n = case when n_in = 0 and not emptied then tally_days.n else excluded.n end,
     alter_max = excluded.alter_max, bytes = excluded.bytes, at = now(),
     empty_at = case when n_in > 0 then null else coalesce(excluded.empty_at, tally_days.empty_at) end,
     note = case when n_in > 0 then null else coalesce(excluded.note, tally_days.note) end;
  update tally_books set days_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'day', p_day, 'touched', to_jsonb(touched), 'marked', marked, 'sent', coalesce(array_length(sent, 1), 0)) || case when short is null then '{}'::jsonb else jsonb_build_object('refused', short) end || case when emptied then jsonb_build_object('empty', true) else '{}'::jsonb end || case when d_empty is not null and not emptied then jsonb_build_object('emptyPending', true) else '{}'::jsonb end || case when capped then jsonb_build_object('emptyCapped', true) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean) from public, anon, authenticated;
grant execute on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean) to service_role;

-- ---------------------------------------------------------------- 2. per-computer posting settings (owner item F3)
alter table public.tally_devices add column if not exists post_only jsonb;              -- null: no restriction; []: any company; ["ZZ CO"]: these alone
alter table public.tally_devices add column if not exists post_batch_bills integer;     -- vouchers per Tally request, bills (1..500)
alter table public.tally_devices add column if not exists post_batch_bank integer;      -- vouchers per Tally request, bank lines (1..500)
alter table public.tally_devices add column if not exists post_settings_at timestamptz;
alter table public.tally_devices add column if not exists post_settings_by uuid;
grant select (post_only, post_batch_bills, post_batch_bank, post_settings_at, post_settings_by) on public.tally_devices to authenticated;

create or replace function public.tally_device_post_settings(p_device uuid, p_post_only jsonb, p_bills integer, p_bank integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); po jsonb; d tally_devices%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can change a computer''s posting settings' using errcode = '42501'; end if;
  if p_device is null or not exists (select 1 from tally_devices x where x.id = p_device and x.firm_id = f and not coalesce(x.revoked, false))
    then raise exception 'not a computer of your firm'; end if;
  if p_bills is not null and (p_bills < 1 or p_bills > 500) then raise exception 'the batch size for bills must be between 1 and 500 (%s given)', p_bills; end if;
  if p_bank is not null and (p_bank < 1 or p_bank > 500) then raise exception 'the batch size for bank lines must be between 1 and 500 (%s given)', p_bank; end if;
  -- post_only: a SQL null leaves it; the JSON null clears it; an array of names is cleaned; anything else is refused
  if p_post_only is not null and jsonb_typeof(p_post_only) not in ('null', 'array') then raise exception 'post_only must be a list of company names, [] for any company, or null for no restriction'; end if;
  if p_post_only is not null and jsonb_typeof(p_post_only) = 'array' then
    if exists (select 1 from jsonb_array_elements(p_post_only) e where jsonb_typeof(e) <> 'string') then raise exception 'post_only must be a list of company names (strings)'; end if;
    select coalesce(jsonb_agg(n), '[]'::jsonb) into po from (select left(btrim(e.val #>> '{}'), 200) n from jsonb_array_elements(p_post_only) with ordinality as e(val, ord) where btrim(e.val #>> '{}') <> '' order by e.ord limit 20) s;
  end if;
  perform pg_advisory_xact_lock(hashtext('tally_device_post_settings:' || p_device::text));
  update tally_devices set
     post_only = case when p_post_only is null then post_only when jsonb_typeof(p_post_only) = 'null' then null else po end,
     post_batch_bills = coalesce(p_bills, post_batch_bills), post_batch_bank = coalesce(p_bank, post_batch_bank),
     post_settings_at = now(), post_settings_by = auth.uid()
   where id = p_device and firm_id = f;
  select * into d from tally_devices where id = p_device;
  return jsonb_build_object('ok', true, 'device', p_device, 'postOnly', d.post_only, 'postBatchBills', d.post_batch_bills, 'postBatchBank', d.post_batch_bank, 'at', d.post_settings_at);
end $function$;
revoke all on function public.tally_device_post_settings(uuid, jsonb, integer, integer) from public, anon;
grant execute on function public.tally_device_post_settings(uuid, jsonb, integer, integer) to authenticated;

-- ---------------------------------------------------------------- 3. Tally's reply ids
alter table public.tally_post_ids add column if not exists reply_vch text;        -- Tally's exact voucher id, when the request held this voucher alone (not `vch`: see the header)
alter table public.tally_post_ids add column if not exists batch_end text;        -- the LASTVCHID of the request's reply
alter table public.tally_post_ids add column if not exists batch_n integer;       -- how many vouchers that request held
alter table public.tally_post_ids add column if not exists matched_at timestamptz; -- the later comparison with the day read back (nothing writes it yet)
alter table public.tally_post_ids add column if not exists matched_vch text;
alter table public.tally_post_jobs add column if not exists timing jsonb;         -- 5. {reqs: [{n, seconds, created, altered, exceptions, ignored, lastVchId}], secondsTotal}

-- the companion of tally_post_id_accept (36b, unchanged: it is called here, so its rules on an owner's release and on an
-- id live in another posting hold): the stamp of a reply Tally gave to a request that held this voucher. Service role.
create or replace function public.tally_post_id_accept_reply(p_job uuid, p_id text, p_vch text, p_batch_end text, p_batch_n integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare one boolean := p_batch_n = 1; v text := nullif(left(btrim(coalesce(p_vch, '')), 60), ''); acc jsonb; n int;
begin
  if auth.role() <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  if regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g') = '' then return jsonb_build_object('ok', false, 'error', 'no id'); end if;
  acc := tally_post_id_accept(p_job, p_id, case when one then v end);
  update tally_post_ids set reply_vch = case when one then coalesce(v, reply_vch) else reply_vch end,
         batch_end = nullif(left(btrim(coalesce(p_batch_end, '')), 60), ''), batch_n = p_batch_n
   where job_id = p_job and tally_post_id_match(fincom_id, entry_id, p_id);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'stamped', n, 'batchN', p_batch_n, 'accept', acc);
end $function$;
revoke all on function public.tally_post_id_accept_reply(uuid, text, text, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. the reply states
-- a result or item says Tally took the entry: verified, in_tally, sent (40), posted by Tally's reply (byReply + ok), or
-- Tally created something that needs review (needsReview + accepted): the bridge never re-sends such an entry
create or replace function public.tally_post_result_taken(r jsonb) returns boolean language sql immutable as $function$
  select tally_post_bool(r->>'verified') or coalesce(r->>'state', '') in ('in_tally', 'sent')
      or (tally_post_bool(r->>'byReply') and tally_post_bool(r->>'ok'))
      or (tally_post_bool(r->>'needsReview') and tally_post_bool(r->>'accepted'))
$function$;
create or replace function public.tally_post_result_confirmed(r jsonb) returns boolean language sql immutable as $function$
  select public.tally_post_result_taken(r)
$function$;

-- 41's tally_post_job_accepted, with one change: a needsReview + accepted result is accepted-not-confirmed (taken for the
-- sync, so its id stays live; not confirmed here, so the posting is never sent again while nobody has reviewed it)
create or replace function public.tally_post_job_accepted(p_job uuid, p_results jsonb, p_items jsonb) returns text
language sql stable security definer set search_path = public, pg_temp as $function$
  with ids as (select fincom_id, entry_id, accepted_at, released_at from tally_post_ids where job_id = p_job),
  res as (select r->>'id' id, tally_post_result_accepted(r) acc, (tally_post_result_taken(r) and not tally_post_bool(r->>'needsReview')) conf from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where r->>'id' is not null),
  its as (select i->>'id' id, (not tally_post_bool(i->>'postOnly') and (tally_post_bool(i->>'accepted') or tally_post_bool(i->>'held') or tally_post_accept_text(i->>'reason'))) acc, tally_post_result_taken(i) conf from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where i->>'id' is not null),
  conf as (select id from res where conf union select id from its where conf),
  sig as (select id from res where acc union select id from its where acc),
  hits as (select coalesce(entry_id, fincom_id) id from ids i where accepted_at is not null and released_at is null
             and not exists (select 1 from conf c where tally_post_id_match(i.fincom_id, i.entry_id, c.id))
           union select s.id from sig s where not exists (select 1 from conf c where c.id = s.id)
             and not exists (select 1 from ids i where i.released_at is not null and tally_post_id_match(i.fincom_id, i.entry_id, s.id)))
  select nullif(string_agg(distinct id, ', ' order by id), '') from hits
$function$;
revoke all on function public.tally_post_job_accepted(uuid, jsonb, jsonb) from public, anon, authenticated;

-- 36b's tally_post_job_settle (the same arguments; the owner's mark and release call it), with the reply states: an entry
-- whose result is byReply + ok is posted (ok counts, as before); an entry whose result says needsReview and that is not
-- posted needs review: neither posted nor failed. A posting with the bridge (running, taken, or held for checking) whose
-- entries are all settled with at least one needing review is done with checking false; everything failed stays failed.
-- The answer also carries review (how many) and the message for the posting
create or replace function public.tally_post_job_settle(p_status text, p_checking boolean, p_payload jsonb, p_results jsonb, p_items jsonb)
returns jsonb language plpgsql immutable as $function$
declare total int; posted int; pending int; unknown int; review int; st text := p_status; chk boolean := coalesce(p_checking, false);
begin
  with v as (select tally_fincom_id(x) fk, x->>'id' ek from jsonb_array_elements(coalesce(p_payload->'vouchers', '[]'::jsonb)) x where tally_fincom_id(x) is not null),
  e as (select fk,
          exists (select 1 from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where tally_post_id_match(fk, ek, r->>'id') and tally_post_bool(r->>'ok'))
            or exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where tally_post_id_match(fk, ek, i->>'id') and i->>'state' = 'in_tally') is_posted,
          exists (select 1 from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where tally_post_id_match(fk, ek, r->>'id') and tally_post_bool(r->>'needsReview')) needs_review,
          (select i->>'state' from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where tally_post_id_match(fk, ek, i->>'id') limit 1) state,
          exists (select 1 from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where tally_post_id_match(fk, ek, r->>'id')) has_result
        from v)
  select count(*), count(*) filter (where is_posted),
         count(*) filter (where not is_posted and (state in ('waiting', 'sending', 'sent') or (state is null and not has_result))),
         count(*) filter (where not is_posted and state = 'unknown' and not needs_review),
         count(*) filter (where not is_posted and needs_review)
    into total, posted, pending, unknown, review from e;
  if posted >= total then st := 'done'; chk := false;
  elsif p_status in ('running', 'taken') or coalesce(p_checking, false) then
    if pending > 0 then null;
    elsif unknown > 0 then st := 'done'; chk := true;
    elsif review > 0 then st := 'done'; chk := false;
    else st := 'failed'; chk := false; end if;
  end if;
  return jsonb_build_object('status', st, 'checking', chk, 'posted', posted, 'total', total, 'review', review,
    'message', format('Posted %s of %s', posted, total) || case when review > 0 then format('; %s need review', review) else '' end);
end $function$;

commit;
