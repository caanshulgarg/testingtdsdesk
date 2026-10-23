-- Migration 42 (03-Oct-2026, round 12, the owner's decision after 41 ran on staging). Runs AFTER 41 (fresh database:
-- 39 -> 40 -> 41 -> 42; docs/MIGRATION-ORDER.md). Add-only (one function created or replaced with the same arguments; no
-- column, no table), safe to run twice. Shown to the owner before it runs.
--
--   THE 8-ARGUMENT tally_ingest_day HERE SUPERSEDES 41's (41's text plus the rule below); the 7-argument wrapper of 41
--   stays as it is (it calls this one by name). Nothing else of 41 changes.
--
--   The rule: an empty read the bridge vouches for (p_empty = true, no entries, p_n = 0) marks a day's entries deleted
--   only on the SECOND consecutive empty read, for ANY day that still has live entries in the copy (41 did this only
--   for a day with more than 25 entries: the four entries lost on 03-Oct were on days with one or two). The first
--   empty read marks nothing, records tally_days.empty_at = now() and note = 'empty day with N live entries: confirm by
--   a second empty read', and answers refused with those words (emptyPending: true). The second empty read marks (the
--   note names the first read's time). A day with no live entries marks nothing either way (nothing to mark) and is
--   recorded as empty at once.
--   What decides "second": tally_days.empty_at alone, never tally_days.n. (In 41 the first refused read overwrote n with
--   0; the second read then marked because empty_at was set, not because of n. Here the count tested is the live
--   entries in tally_vouchers, read at the moment of the call, and tally_days.n is NO LONGER overwritten by an empty
--   file that marked nothing: a refused empty read and a short read keep the n the day had.)
--   The cap (the owner's decision, 03-Oct night, after an Update now that listed 0 entries for a whole year): fewer than
--   10 days of one book may be emptied by empty reads within 24 hours. pend = the book's days with an empty read
--   recorded (empty_at) in the last 24 hours that had something to mark (pending or marked), this day's own record
--   included. An empty read (first or second) is refused while pend >= 10, with 'N days of this book read empty within
--   24 hours: a read fault; this day is not emptied and not recorded; nothing marked' (emptyCapped: true), and the
--   day's record is left as it was. So a round that lists no entries for a book with entries records at most 10 days
--   as pending and marks nothing, and repeated within 24 hours it refuses every day (the 10 pending ones included); a
--   genuine emptying of up to 9 days still marks on the second read. The cap lifts by itself 24 hours after the last
--   such read. Days with no live entries (nothing to mark) are outside the cap.
--   What clears empty_at: only a file WITH entries for the day (n_in > 0: the day is un-marked and the record cleared,
--   as in 41). A short read in between (an empty file without the flag, or fewer entries than the bridge counted)
--   neither sets nor clears it: it says nothing about the day. So "consecutive" means: no file with entries between
--   the two empty reads, however far apart they are.
--   Every function here: security definer, search_path = public, pg_temp; grants as before.

begin;

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
    -- the cap: the book's days with an empty read recorded in the last 24 hours that had something to mark
    select count(*) into pend from tally_days d where d.book_id = p_book and d.empty_at >= now() - interval '24 hours' and coalesce(d.note, '') <> 'empty day, nothing to mark';
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

commit;
