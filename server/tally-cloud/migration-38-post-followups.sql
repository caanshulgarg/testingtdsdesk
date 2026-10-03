-- Migration 38 (03-Oct-2026, round 9: the posting follow-ups 6, 7 and 9). Runs AFTER 36b and 37 (and 36, in either order:
-- docs/MIGRATION-ORDER.md). Add-only in effect: two functions replaced with the same arguments, two foreign keys of
-- tally_post_marks re-made without ON DELETE CASCADE (the one place a constraint is dropped, to be put back stricter in the
-- same statement block). Safe to run twice. To be shown to the owner before it runs.
--
--   6. ids live by the words   tally_post_ids_sync (the trigger that follows a posting's status) keeps an id live, when
--                              the posting fails or is cancelled, not only when accepted_at is stamped but also when the
--                              posting's results or items carry an acceptance by Tally for that entry and nobody released
--                              it (tally_post_job_accepted, migration 36b): a stamp that never came (an older tally-ingest,
--                              stamped 0) no longer frees an id Tally took. A new posting for such an id is refused.
--   7. marks never cascade     tally_post_marks (who marked / released what, when, why) is history: its foreign keys to
--                              tally_post_jobs and firms no longer delete the marks with the row; a job with a mark cannot
--                              be deleted (ON DELETE RESTRICT).
--   9. short reads             tally_ingest_day: a day file with no entries, or fewer than the bridge counted for the day
--                              (p_n), upserts what came and MARKS NOTHING deleted; its answer carries refused: 'short read:
--                              n of p_n' (tally-ingest logs it). A full file marks the day's entries it lacks, as 37 does.
--   Every function here: security definer, search_path = public, pg_temp; grants as before (service role).

begin;

-- ---------------------------------------------------------------- 6. tally_post_ids_sync: an acceptance in the words keeps the id live
create or replace function public.tally_post_ids_sync() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare acc text[];
begin
  if tg_op = 'INSERT' then
    insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live)
    select distinct on (tally_fincom_id(v)) new.firm_id, new.client_id, tally_fincom_id(v), new.id, v->>'id', new.status not in ('failed', 'cancelled')
      from jsonb_array_elements(coalesce(new.payload->'vouchers', '[]'::jsonb)) v where tally_fincom_id(v) is not null;
  elsif new.status is distinct from old.status then
    -- failed or cancelled: the ids may be queued again; waiting again (Retry): live again, unless another posting has them.
    -- An id Tally accepted is never freed here: stamped (accepted_at, 36b) or said by the posting's own results / items
    -- (tally_post_job_accepted: accepted, lastVchId, a voucher number, CREATED / ALTERED with a voucher id, held) and not
    -- released; a released id is never revived
    acc := string_to_array(coalesce(tally_post_job_accepted(new.id, new.results, new.items), ''), ', ');
    update tally_post_ids i set live = (i.accepted_at is not null and i.released_at is null)
        or (new.status not in ('failed', 'cancelled') and i.released_at is null)
        or (i.released_at is null and exists (select 1 from unnest(acc) a where a <> '' and tally_post_id_match(i.fincom_id, i.entry_id, a)))
     where i.job_id = new.id;
  end if;
  return new;
exception when unique_violation then
  raise exception 'This bill is already being posted to Tally in another posting (its FinCom id is taken); wait for that posting to finish.' using errcode = '23505';
end $function$;
revoke all on function public.tally_post_ids_sync() from public, anon, authenticated;

-- ---------------------------------------------------------------- 7. tally_post_marks: history that no deletion takes with it
do $$
declare c record;
begin
  for c in select con.conname, con.confrelid::regclass::text as t, a.attname as col
             from pg_constraint con join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
            where con.conrelid = 'public.tally_post_marks'::regclass and con.contype = 'f' and con.confdeltype = 'c' loop
    execute format('alter table public.tally_post_marks drop constraint %I', c.conname);
    execute format('alter table public.tally_post_marks add constraint %I foreign key (%I) references %s(id) on delete restrict', c.conname, c.col, c.t);
    raise notice 'migration 38: tally_post_marks.% -> %: ON DELETE CASCADE replaced by RESTRICT', c.col, c.t;
  end loop;
end $$;

-- ---------------------------------------------------------------- 9. tally_ingest_day: a short read marks nothing
-- migration 37's text (upsert, mark, never delete an entry; versions with lines; the day cache from live entries), with the
-- short-read rule around the mark. Answer: ok, day, touched, marked, sent, and refused when the read was short
create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare touched date[]; f uuid; sent text[]; marked int := 0; n_in int := case when jsonb_typeof(p_vouchers) = 'array' then jsonb_array_length(p_vouchers) else 0 end; short text;
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
  if n_in = 0 or n_in < coalesce(p_n, 0) then
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
  insert into tally_days (book_id, firm_id, day, n, alter_max, bytes, at) values (p_book, f, p_day, p_n, p_alter, p_bytes, now())
  on conflict (book_id, day) do update set n = excluded.n, alter_max = excluded.alter_max, bytes = excluded.bytes, at = now();
  update tally_books set days_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'day', p_day, 'touched', to_jsonb(touched), 'marked', marked, 'sent', coalesce(array_length(sent, 1), 0)) || case when short is null then '{}'::jsonb else jsonb_build_object('refused', short) end;
end $function$;
revoke all on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer) from public, anon, authenticated;
grant execute on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer) to service_role;

commit;
