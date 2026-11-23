-- Migration 216 (23-Nov-2026, branch next-db-load-2). Written and tested here (tests/run_migration216.py on pg_stand);
-- NOT run anywhere: the coordinator runs it on staging after the review, after migration 215 (its indexes: the beat's
-- held lines by computer key and bridge, the ":resolved" rows by firm and line id).
--
-- tally-ingest's heartbeat, cheaper (staging, 23-Nov-2026, 3 h 41 min: ~25,000 reads of tally_recorder_lines by the beat,
-- up to 2,600 buffers each, nearly all of it the lines' bodies and payloads, never sent to the bridge):
--   1. tally_held_light(firm, device, bridge, books, seen): ONE call a heartbeat for what heldLines, refetch and
--      ledgersWanted read (server/tally-cloud/index.ts heldOwnLines, ledgersWantedFor): this bridge's own held and
--      fetching lines (any age, at most 2,000), the held lines of the books it follows (migration 146; 30 days, at most
--      400), and the ":resolved" rows of all of them - light columns only. A line's body comes as {"vouchers": [0]} when
--      it has entries (else null) and its payload as its waitLedgers only: all the beat's rules look at. With them a
--      fingerprint (fp) of all that and of the books' month locks; when the beat's last fingerprint (seen) is the same,
--      the answer is {same: true} and nothing else: the beat keeps what it worked out the last time (at most 2 minutes).
--   2. tally_work_claim (migration 146): a claim this bridge holds with more than half its time left is kept as it is,
--      not written again. Before, each heartbeat of a serving bridge wrote every line it follows again (43,436 updates of
--      tally_work_claims in under 4 hours, each a new row version: 23 MB of WAL, the second most of any statement).
--      Who gets what is unchanged. Replaced only when the function is migration 146's.
-- ADD-ONLY: one new function; tally_work_claim replaced by the same rules (the renewal skipped while over half the time
-- is left). No table, column, row or policy changed. Safe to run twice. One transaction, lock_timeout 10 s.
-- UNDO (by hand): drop function if exists public.tally_held_light(uuid, uuid, text, uuid[], text); and migration 146's
-- tally_work_claim (server/tally-cloud/migration-146-reads-follow-company.sql) run again.
begin;
set local lock_timeout = '10s';

do $names$
declare bad text[] := '{}'; src text;
begin
  if to_regclass('public.tally_recorder_lines') is null or to_regclass('public.tally_work_claims') is null then
    raise exception 'migration 216: tally_recorder_lines or tally_work_claims is not on this database (migrations 44, 146). Nothing was changed.';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tally_held_light'
               and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'beat light (migration 216)') then bad := bad || 'function tally_held_light'::text; end if;
  select md5(p.prosrc) into src from pg_proc p where p.oid = to_regprocedure('public.tally_work_claim(uuid,uuid,text,text[],uuid,text,integer)');
  if src is null then bad := bad || 'function tally_work_claim (not here: run migration 146 first)'::text;
  elsif src not in ('1a78022e9f48f618749a94dea8900781',      -- migration 146's, as on staging on 23-Nov-2026
                    'a09f9462f13664925446a8568c032fe2') then                   -- this migration's
    bad := bad || 'function tally_work_claim (changed since migration 146)'::text;
  end if;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 216: these names are already used by something else: %. Nothing was changed.', array_to_string(bad, ', ');
  end if;
end $names$;

-- 1. the beat's held lines, light, in one call
create or replace function public.tally_held_light(p_firm uuid, p_device uuid, p_bridge text, p_books uuid[], p_seen text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare own jsonb; fol jsonb; res jsonb; locks text; fp text; books uuid[] := coalesce(p_books, '{}'::uuid[]);
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_firm is null or p_device is null or coalesce(p_bridge, '') !~ '^go-[0-9a-f]{6,32}$' then return jsonb_build_object('ok', false); end if;
  if coalesce(array_length(books, 1), 0) > 100 then books := books[1:100]; end if;
  -- this bridge's own held and fetching lines (index tally_recorder_lines_held_bridge, migration 215)
  select coalesce(jsonb_agg(z.j order by z.received_at, z.id), '[]'::jsonb) into own from (
    select x.id, x.received_at, jsonb_build_object('id', x.id, 'line_id', x.line_id, 'company', x.company, 'company_guid', x.company_guid, 'event', x.event,
             'master_id', x.master_id, 'vch_type', x.vch_type, 'vch_no', x.vch_no, 'vch_date', x.vch_date, 'book_id', x.book_id, 'received_at', x.received_at,
             'bridge', x.bridge, 'device_id', x.device_id, 'object_guid', x.object_guid, 'held_why', x.held_why, 'state', x.state,
             'body', case when jsonb_typeof(x.body -> 'vouchers') = 'array' and jsonb_array_length(x.body -> 'vouchers') > 0 then '{"vouchers": [0]}'::jsonb end,
             'payload', case when jsonb_typeof(x.payload) = 'object' and x.payload ? 'waitLedgers' then jsonb_build_object('waitLedgers', x.payload -> 'waitLedgers') end) as j
      from tally_recorder_lines x
     where x.firm_id = p_firm and x.device_id = p_device and x.bridge = p_bridge and x.state in ('held', 'fetching')
     order by x.received_at, x.id limit 2000) z;
  -- the held lines of the books this bridge follows (another bridge's lines among them; the beat's rules choose)
  select coalesce(jsonb_agg(z.j order by z.received_at, z.id), '[]'::jsonb) into fol from (
    select x.id, x.received_at, jsonb_build_object('id', x.id, 'line_id', x.line_id, 'company', x.company, 'company_guid', x.company_guid, 'event', x.event,
             'master_id', x.master_id, 'vch_type', x.vch_type, 'vch_no', x.vch_no, 'vch_date', x.vch_date, 'book_id', x.book_id, 'received_at', x.received_at,
             'bridge', x.bridge, 'device_id', x.device_id, 'object_guid', x.object_guid, 'held_why', x.held_why, 'state', x.state,
             'body', case when jsonb_typeof(x.body -> 'vouchers') = 'array' and jsonb_array_length(x.body -> 'vouchers') > 0 then '{"vouchers": [0]}'::jsonb end,
             'payload', case when jsonb_typeof(x.payload) = 'object' and x.payload ? 'waitLedgers' then jsonb_build_object('waitLedgers', x.payload -> 'waitLedgers') end) as j
      from tally_recorder_lines x
     where x.firm_id = p_firm and x.book_id = any(books) and x.state in ('held', 'fetching') and x.event in ('created', 'altered', 'imported')
       and x.received_at > now() - interval '30 days'
     order by x.received_at, x.id limit 400) z;
  -- the ":resolved" rows of all of them, in any state, of any bridge of the firm (index tally_recorder_lines_firm_line, 215)
  select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'line_id', y.line_id, 'state', y.state, 'held_why', y.held_why, 'received_at', y.received_at,
           'body', case when jsonb_typeof(y.body -> 'vouchers') = 'array' and jsonb_array_length(y.body -> 'vouchers') > 0 then '{"vouchers": [0]}'::jsonb end,
           'payload', case when jsonb_typeof(y.payload) = 'object' and y.payload ? 'waitLedgers' then jsonb_build_object('waitLedgers', y.payload -> 'waitLedgers') end)
           order by y.id), '[]'::jsonb) into res
    from tally_recorder_lines y
   where y.firm_id = p_firm
     and y.line_id = any(array(select distinct (e ->> 'line_id') || ':resolved' from jsonb_array_elements(own || fol) e where coalesce(e ->> 'line_id', '') <> ''));
  select string_agg(k.book_id::text || '|' || k.month::text || '|' || coalesce(k.unlocked_at::text, ''), ',' order by k.book_id, k.month, k.unlocked_at) into locks
    from tally_month_locks k
   where k.book_id = any(array(select distinct (e ->> 'book_id')::uuid from jsonb_array_elements(own || fol) e where coalesce(e ->> 'book_id', '') <> ''));
  fp := md5(own::text || '#' || fol::text || '#' || res::text || '#' || coalesce(locks, ''));
  if fp = p_seen then return jsonb_build_object('ok', true, 'same', true, 'fp', fp); end if;
  return jsonb_build_object('ok', true, 'same', false, 'fp', fp, 'own', own, 'follow', fol, 'resolved', res);
end $function$;
comment on function public.tally_held_light(uuid, uuid, text, uuid[], text) is 'beat light (migration 216)';
revoke all on function public.tally_held_light(uuid, uuid, text, uuid[], text) from public, anon, authenticated;
grant execute on function public.tally_held_light(uuid, uuid, text, uuid[], text) to service_role;

-- 2. a claim held with over half its time left: kept, not written again
create or replace function public.tally_work_claim(p_firm uuid, p_book uuid, p_kind text, p_units text[], p_device uuid, p_bridge text, p_ttl integer)
returns text[] language plpgsql security definer set search_path = public, pg_temp as $function$
declare u text; got text[] := '{}'; ttl int := greatest(30, least(coalesce(p_ttl, 300), 3600));
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('period', 'check', 'held', 'masters') or coalesce(p_bridge, '') !~ '^go-[0-9a-f]{6,32}$' or p_device is null then return got; end if;
  if tally_bridge_device(p_firm, p_bridge) is distinct from p_device then return got; end if;
  if not exists (select 1 from tally_links l where l.firm_id = p_firm and l.book_id = p_book and l.state = 'linked') then return got; end if;
  perform pg_advisory_xact_lock(hashtext('tally_work_claim:' || p_book::text || ':' || p_kind));
  for u in select distinct x from unnest(coalesce(p_units, '{}'::text[])) x where coalesce(x, '') <> '' limit 400 loop
    -- 216: this bridge's own claim with more than half its time left: kept as it is (no new row version)
    if exists (select 1 from tally_work_claims c where c.book_id = p_book and c.kind = p_kind and c.unit = left(u, 120)
                 and c.device_id = p_device and c.bridge_id = p_bridge and c.firm_id = p_firm and c.until > now() + make_interval(secs => ttl / 2.0)) then
      got := got || left(u, 120);
      continue;
    end if;
    insert into tally_work_claims as c (firm_id, book_id, kind, unit, device_id, bridge_id, claimed_at, until)
    values (p_firm, p_book, p_kind, left(u, 120), p_device, p_bridge, now(), now() + make_interval(secs => ttl))
    on conflict (book_id, kind, unit) do update set firm_id = excluded.firm_id, until = excluded.until,
      claimed_at = case when c.device_id = excluded.device_id and c.bridge_id = excluded.bridge_id and c.until > now() then c.claimed_at else now() end,
      device_id = excluded.device_id, bridge_id = excluded.bridge_id
     where c.until <= now() or (c.device_id = excluded.device_id and c.bridge_id = excluded.bridge_id);
    if found then got := got || left(u, 120); end if;
  end loop;
  return got;
end $function$;
revoke all on function public.tally_work_claim(uuid, uuid, text, text[], uuid, text, integer) from public, anon, authenticated;
grant execute on function public.tally_work_claim(uuid, uuid, text, text[], uuid, text, integer) to service_role;

commit;
