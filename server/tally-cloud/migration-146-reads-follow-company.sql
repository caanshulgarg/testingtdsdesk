-- Migration 146 (08-Nov-2026, branch next-link-follow; written, NOT run: the owner reads it and runs it).
-- "Every bridge that has the company open serves it." The owner, 08-Nov-2026: "it should automatically bring all the
-- data"; "Every function of the Tally page should work with every person who has connected Tally; nothing should remain
-- with only the connected person"; and, deciding: "it should connect to both Tally rather than switching… would post by
-- both, like Tally can be opened by n persons and used simultaneously."
-- Found on staging (twice in two days): a client's company was linked to one Windows login's bridge on the office server;
-- the owner opened it in HIS login's Tally (another bridge of the firm, same computer); the linked bridge was offline, the
-- older days were handed out only where that key's "read older entries" switch was on, and nothing came, with no message.
--
-- No single reader, no moving links: EVERY bridge of the firm that SERVES a linked book reads it at the same time, and
-- the work is SHARED, never duplicated: each unit is claimed by one bridge at a time in this database.
--   1. tally_read_serving(firm, book) / tally_read_serving_many(firm, books): the bridges serving a linked book now: of the
--      SAME firm (the link's; the key not revoked), a "go-" id bound to that key (tally_bridge_device; a v1 bridge never),
--      not in test mode, heard within 3 minutes (5 for the link's own key: present until it counts as offline), whose OWN
--      record (info.bridges[id].cos, kept by tally-ingest of next-link-follow from that bridge's own beat) lists the
--      company open WITH the link's Tally GUID (a link with no GUID: none), reading the link's data location (127's
--      tally_link_loc; a copy in another folder never), reading not stopped (its readStopped, FinCom's readStop).
--   2. tally_work_claims: one row a unit of work (book, kind, unit): period (a day of Bring books / Bring missing days),
--      check (a day of Check for changes), held (a held line asked again), masters (the book's full ledger list); the
--      bridge holding it and until when. tally_work_claim(firm, book, kind, units, device, bridge, ttl): under one lock per
--      book and kind, each unit free, expired or already this bridge's is (re)claimed for it and returned; the others are
--      not. An unfinished claim returns to the pool when it expires.
--   3. tally_days_claim(firm, book, device, bridge, kind, max, night): 98's tally_period_next_paced (kind period) or 135's
--      tally_check_next_open (kind check) as they are (their order, pace and stop rules), asked for as many more days as
--      other bridges hold, the days another bridge holds left out, the rest claimed for this bridge (5 minutes, renewed
--      while it is handed them again); nothing for a bridge not serving the book. Two bridges read different days of one
--      book in parallel; a day is never handed to two at once.
--   4. tally_fetch_on(device): "read older entries" for this key: its own switch, or the CURRENT switch of a key of the
--      same firm on the same computer that has it on (the owner's switch is per computer; turned off there, off here). The
--      switch itself is never changed.
--   5. tally_read_view() (members; the page): each linked book's serving bridges (key, bridge, Windows user, whether it is
--      the link's key), when the link's key was last heard, fetchOn on a serving key, and the held lines the cloud asks a
--      serving bridge again (another bridge's, not serving now; the last 7 days, or ended slow in the last 30 days for a
--      bridge of 2.3.4 or later; never one with its "<line id>:resolved" line in FinCom; never of a locked month). Its
--      presence is the page's sign that 146 is here.
-- The per-book lease (tally_company_lease, 32 / 37 / 55) is unchanged: the keeper's run (Update now: masters and the live
-- days; bridge-go keep.go) still holds it, so a book's masters are read by one bridge at a time; the older days
-- (bridge-go daypull.go) never took it. Postings are unchanged: 142 hands a WAITING posting that was never taken to a
-- bridge with the company open that may post (not Changes only, the main bridge of its Windows user), atomically (for
-- update skip locked: one bridge); a posting TAKEN stays with its bridge. Postings of one book still go one at a time
-- (the bridge's "post" lease, bridge-go jobs.go).
--
-- ADD-ONLY: one new table (RLS on, explicit grants), eight new functions (create or replace); nothing dropped, no existing
-- table, column, function or row changed. One transaction, lock_timeout 10 s, safe to run twice. Runs after 54, 98, 110,
-- 127, 133, 135, 142.
-- Deploy order: this file, then tally-ingest of next-link-follow (until it runs no bridge record has cos: nobody is
-- serving by these rules and the beat hands days as before; without this file tally-ingest answers as before), then the
-- app build (without tally_read_view the page is as before). Tested on pg_stand: tests/run_migration146.py.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 2. the claims
create table if not exists public.tally_work_claims (
  firm_id     uuid not null references public.firms(id) on delete cascade,
  book_id     uuid not null,
  kind        text not null check (kind in ('period', 'check', 'held', 'masters')),
  unit        text not null,
  device_id   uuid not null,
  bridge_id   text not null,
  claimed_at  timestamptz not null default now(),
  until       timestamptz not null,
  primary key (book_id, kind, unit)
);
create index if not exists tally_work_claims_live on public.tally_work_claims (book_id, kind, until);
alter table public.tally_work_claims enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_work_claims' and policyname = 'tally_work_claims_read') then
    create policy tally_work_claims_read on public.tally_work_claims for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_work_claims from public, anon, authenticated;
grant select on public.tally_work_claims to authenticated;
grant all on public.tally_work_claims to service_role;

-- ---------------------------------------------------------------- when a computer key was last heard (any bridge, any call)
create or replace function public.tally_read_heard(p_device uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $function$
  select greatest(d.last_seen, (select max(case when b.value ->> 'at' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d' then (b.value ->> 'at')::timestamptz end)
                                  from jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) b))
    from tally_devices d where d.id = p_device
$function$;
revoke all on function public.tally_read_heard(uuid) from public, anon, authenticated;
grant execute on function public.tally_read_heard(uuid) to service_role;

-- ---------------------------------------------------------------- 1. the bridges serving a linked book now
create or replace function public.tally_read_serving(p_firm uuid, p_book uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  with l as (select x.*, nullif(lower(btrim(coalesce(x.company_guid, ''))), '') as g,
                    coalesce((select c.company from tally_companies c where c.firm_id = x.firm_id and c.book_id = x.book_id order by c.last_seen desc nulls last limit 1), x.company_name) as co
               from tally_links x where x.firm_id = p_firm and x.book_id = p_book and x.state = 'linked')
  select coalesce((select jsonb_agg(jsonb_build_object('device', d.id, 'bridge', k.key, 'at', k.value ->> 'at',
                           'user', nullif(btrim(coalesce(k.value ->> 'user', '')), ''), 'version', nullif(btrim(coalesce(k.value ->> 'version', '')), ''),
                           'computer', coalesce(nullif(btrim(k.value ->> 'computer'), ''), nullif(btrim(d.info ->> 'computer'), ''), d.name),
                           'linked', d.id is not distinct from l.device_id)
                         order by (d.id is not distinct from l.device_id) desc, k.value ->> 'at' desc, d.id, k.key)
     from l, tally_devices d
     cross join lateral jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
    where l.g is not null and d.firm_id = l.firm_id and not coalesce(d.revoked, false) and k.key ~ '^go-[0-9a-f]{6,32}$'
      and tally_bridge_device(l.firm_id, k.key) = d.id
      and coalesce(k.value ->> 'mode', '') <> 'test'
      and coalesce(k.value ->> 'at', '') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d'
      and (k.value ->> 'at')::timestamptz > now() - case when d.id is not distinct from l.device_id then interval '5 minutes' else interval '3 minutes' end
      and jsonb_typeof(k.value -> 'cos') = 'array'
      and exists (select 1 from jsonb_array_elements(k.value -> 'cos') c where jsonb_typeof(c) = 'array'
                    and lower(tally_nm(c ->> 0)) = lower(tally_nm(l.co)) and lower(btrim(coalesce(c ->> 1, ''))) = l.g)
      and jsonb_typeof(k.value -> 'readStopped') is distinct from 'object'
      and jsonb_typeof(d.info -> 'readStop') is distinct from 'object'
      and (l.data_loc is null or coalesce(tally_link_loc(d.id, k.key, l.co) ->> 'loc', l.data_loc) = l.data_loc)), '[]'::jsonb)
$function$;
revoke all on function public.tally_read_serving(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tally_read_serving(uuid, uuid) to service_role;

create or replace function public.tally_read_serving_many(p_firm uuid, p_books uuid[])
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(jsonb_object_agg(b::text, tally_read_serving(p_firm, b)), '{}'::jsonb)
    from (select distinct x as b from unnest(coalesce(p_books, '{}'::uuid[])) x where x is not null limit 200) z
$function$;
revoke all on function public.tally_read_serving_many(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.tally_read_serving_many(uuid, uuid[]) to service_role;

-- the bridge serves the book (1.)
create or replace function public.tally_read_serves(p_firm uuid, p_book uuid, p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select exists (select 1 from jsonb_array_elements(tally_read_serving(p_firm, p_book)) s where s ->> 'device' = p_device::text and s ->> 'bridge' = p_bridge)
$function$;
revoke all on function public.tally_read_serves(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_read_serves(uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- 2. claim units of work for one bridge
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

-- ---------------------------------------------------------------- 3. the days of a book for one bridge, shared
-- p_kind 'period': 98's tally_period_next_paced(book, n, night); 'check': 135's tally_check_next_open(book, n). n is p_max
-- plus the days other bridges hold now (they come last in both orders: asked in the last 2 minutes), the days others hold
-- left out, the rest claimed for this bridge (5 minutes)
create or replace function public.tally_days_claim(p_firm uuid, p_book uuid, p_device uuid, p_bridge text, p_kind text, p_max integer, p_night boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare lim int := least(greatest(coalesce(p_max, 3), 0), 30); others int; got jsonb; e jsonb; mine text[] := '{}'; want text[] := '{}'; ok text[]; out jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if lim = 0 or p_kind not in ('period', 'check') or not tally_read_serves(p_firm, p_book, p_device, p_bridge) then return out; end if;
  perform pg_advisory_xact_lock(hashtext('tally_days_claim:' || p_book::text || ':' || p_kind));
  select count(*)::int into others from tally_work_claims c where c.book_id = p_book and c.kind = p_kind and c.until > now()
     and not (c.device_id = p_device and c.bridge_id = p_bridge);
  got := case when p_kind = 'period' then tally_period_next_paced(p_book, least(30, lim + others), p_night) else tally_check_next_open(p_book, least(30, lim + others)) end;
  for e in select x from jsonb_array_elements(coalesce(got, '[]'::jsonb)) x loop
    if coalesce(e ->> 'day', '') !~ '^\d{8}$' then continue; end if;
    if exists (select 1 from tally_work_claims c where c.book_id = p_book and c.kind = p_kind and c.unit = e ->> 'day' and c.until > now()
                 and not (c.device_id = p_device and c.bridge_id = p_bridge)) then continue; end if;
    if cardinality(want) >= lim then exit; end if;
    want := want || (e ->> 'day');
  end loop;
  ok := tally_work_claim(p_firm, p_book, p_kind, want, p_device, p_bridge, 300);
  for e in select x from jsonb_array_elements(coalesce(got, '[]'::jsonb)) x loop
    if (e ->> 'day') = any(ok) and not ((e ->> 'day') = any(mine)) then out := out || jsonb_build_array(e); mine := mine || (e ->> 'day'); end if;
  end loop;
  return out;
end $function$;
revoke all on function public.tally_days_claim(uuid, uuid, uuid, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.tally_days_claim(uuid, uuid, uuid, text, text, integer, boolean) to service_role;

-- ---------------------------------------------------------------- 4. "read older entries" for a key
create or replace function public.tally_fetch_on(p_device uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((select coalesce(d.period_fetch, false) or exists (
             select 1 from tally_devices o where o.firm_id = d.firm_id and o.id <> d.id and not coalesce(o.revoked, false) and coalesce(o.period_fetch, false)
                and lower(btrim(coalesce(nullif(btrim(o.info ->> 'computer'), ''), o.name, ''))) <> ''
                and lower(btrim(coalesce(nullif(btrim(o.info ->> 'computer'), ''), o.name, ''))) = lower(btrim(coalesce(nullif(btrim(d.info ->> 'computer'), ''), d.name, ''))))
           from tally_devices d where d.id = p_device and not coalesce(d.revoked, false)), false)
$function$;
revoke all on function public.tally_fetch_on(uuid) from public, anon, authenticated;
grant execute on function public.tally_fetch_on(uuid) to service_role;

-- ---------------------------------------------------------------- 5. the page (members)
create or replace function public.tally_read_view()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm();
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'books', (select coalesce(jsonb_agg(z.j), '[]'::jsonb) from (
    select jsonb_build_object('book', l.book_id, 'client', l.client_id, 'linkDevice', l.device_id, 'linkHeardAt', tally_read_heard(l.device_id),
      'serving', sv.srv, 'fetchOn', fo.fon,
      -- the held lines the cloud asks a serving bridge again (tally-ingest heldOwnLines' follow rules)
      'reask', case when jsonb_array_length(sv.srv) > 0 then (
        select coalesce(jsonb_agg(h.id), '[]'::jsonb) from (
          select x.id from tally_recorder_lines x
           where x.firm_id = f and x.book_id = l.book_id and x.state = 'held' and x.event in ('created', 'altered', 'imported')
             and coalesce(x.line_id, '') <> '' and x.line_id not like '%:resolved'
             and not exists (select 1 from jsonb_array_elements(sv.srv) s where s ->> 'device' = x.device_id::text and s ->> 'bridge' = x.bridge)
             and (x.received_at > now() - interval '7 days'
                  or (x.received_at > now() - interval '30 days'
                      and (x.held_why like '%FinCom does not ask Tally for this company''s entries%' or x.held_why like '%Tally did not answer in time for this entry when asked again%')
                      and exists (select 1 from jsonb_array_elements(sv.srv) s where coalesce(s ->> 'version', '') ~ '^\d+\.\d+\.\d+$'
                                    and string_to_array(s ->> 'version', '.')::int[] >= array[2, 3, 4])))
             and not exists (select 1 from tally_recorder_lines y where y.firm_id = f and y.line_id = x.line_id || ':resolved')
             and not exists (select 1 from tally_month_locks k where k.book_id = x.book_id and k.unlocked_at is null and x.vch_date is not null
                               and left(k.month::text, 7) = to_char(x.vch_date, 'YYYY-MM'))
           order by x.id limit 2000) h) else '[]'::jsonb end) as j
      from tally_links l
      cross join lateral (select tally_read_serving(f, l.book_id) as srv) sv
      cross join lateral (select exists (select 1 from jsonb_array_elements(sv.srv) e where tally_fetch_on((e ->> 'device')::uuid)) as fon) fo
     where l.firm_id = f and l.state = 'linked') z));
end $function$;
revoke all on function public.tally_read_view() from public, anon;
grant execute on function public.tally_read_view() to authenticated, service_role;

commit;
