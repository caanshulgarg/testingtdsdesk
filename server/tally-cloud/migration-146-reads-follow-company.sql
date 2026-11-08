-- Migration 146 (08-Nov-2026, branch next-link-follow; written, NOT run: the owner reads it and runs it).
-- "Reads follow the company". The owner, 08-Nov-2026: "it should automatically bring all the data"; "I need a permanent
-- fix"; and "Every function of the Tally page should work with every person who has connected Tally; nothing should
-- remain with only the connected person."
-- Found on staging (twice in two days): a client's Tally company was linked (tally_links.device_id) to one Windows login's
-- bridge on the office server; the owner opened the same company in HIS login's Tally (another bridge of the same firm,
-- same computer). The linked bridge was offline since the day before, so the reads handed out for the book (Bring books,
-- Bring missing days, check for changes: the beat's periodDays, given only where the computer key's "read older entries"
-- switch is on) waited for a bridge that never answered, with no message. Fixed by hand by moving
-- tally_links.device_id / windows_user / tally_port to the owner's bridge. From here the cloud does that itself:
--
--   1. tally_read_follow(firm, book) (tally-ingest, service role; called from the beat for each linked company the beat
--      says open, at most every 20 s a book): the bridge that reads the book NOW, deterministically:
--        candidates: the bridges of the SAME firm only (tally_devices.firm_id = the link's firm, not revoked; a "go-" id
--        bound to that computer key, tally_bridge_device), heard within 3 minutes with the company open in their own beat
--        under the link's GUID (142's tally_bridge_serves: a company of the same name under another GUID is another
--        company), reading the link's data location (127's tally_link_loc; a bridge naming no real folder counts, as
--        tally_link_place_check applies its data; a copy in another folder never), reading not stopped (the bridge's
--        readStopped, FinCom's readStop for that computer key);
--        order: the link's own computer key first, then the link's computer (another Windows login of the same server),
--        then the newest heard, then the key and bridge ids (a tie never depends on timing);
--        - the link's key has a candidate: it reads (state linked);
--        - no candidate: state none (the page says the linked computer is offline / the company is open nowhere);
--        - else the reads MOVE to the first candidate: the link record's device_id, computer, windows_user and tally_port
--          (and tally_companies.device_id of the book) take the new bridge's, exactly as the manual fix did; the move is
--          recorded in tally_read_moves with everything it replaced (the old key, computer, Windows user, port, the old
--          tally_companies.device_id, when the old key was last heard) for rollback; why: offline (the linked key not heard
--          for more than 5 minutes) or not_open (heard, but its Tally does not have the company open while another does).
--          Nothing else of the link changes: the client, the GUID, the data location, posting_allowed and the version
--          stay; postings keep 142's rules (below). A book moved less than 2 minutes ago does not move again (settling);
--          a move a person rolled back (tally_read_move_back) holds the book for 24 hours (held: nothing moves by itself).
--      Two bridges never take one book's hand-out at once: tally-ingest gives the book's periodDays (Bring books, Bring
--      missing days, Bring another year, check for changes) and its held-line re-asks only to the bridge this function
--      names; the existing lease (tally_company_lease, 32 / 37 / 55) still guards every read and posting in the bridge.
--      fetchOn: the reader's computer key's "read older entries" switch (tally_devices.period_fetch), or the switch of the
--      key the book moved FROM when both are on the same computer (the switch is the owner's per COMPUTER: another
--      Windows login of the same server reads under it). A follow to another computer whose switch is off reads no older
--      days (the page says so); the switch is never changed here.
--   2. tally_read_moves: every move (add-only for members: RLS, members of the firm read their own firm's rows; no
--      direct writes); undone_at / undone_by when rolled back.
--   3. tally_read_move_back(move) (an owner of the firm): the link record (and the book's tally_companies.device_id) put
--      back as the move found it, only while the link is still where that move put it; the book held for 24 hours.
-- Postings (the owner's rule "only the main bridge posts" kept): nothing here changes who may post. 142 already hands a
-- WAITING posting that was never taken to any bridge of the firm that has the company open now and may post (not
-- Changes only, the main bridge of its Windows user: tally_bridge_may_post), the link record's key preferred; the move
-- only changes that preference. A posting already TAKEN by a bridge stays with that bridge (142, 3.): it may have reached
-- Tally without the bridge saying so, so handing it to another bridge could post it twice.
--
-- ADD-ONLY: one new table (RLS on, explicit grants), three new functions (create or replace); nothing dropped, no column
-- or row of another table removed; the only writes to existing tables are the moves themselves (tally_links' device_id,
-- computer, windows_user, tally_port, updated_at; tally_companies.device_id), each recorded. One transaction,
-- lock_timeout 10 s, safe to run twice. Runs after 54, 110, 127, 142.
-- Deploy order: this file, then tally-ingest of next-link-follow (without this file it answers as before: the function
-- is missing, nothing moves), then the app build (without the table the page reads no moves and says where the book is
-- read from the beats alone). Tested on pg_stand: tests/run_migration146.py.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 2. the moves
create table if not exists public.tally_read_moves (
  id              bigserial primary key,
  firm_id         uuid not null references public.firms(id) on delete cascade,
  book_id         uuid not null,
  company_name    text,
  company_guid    text,
  from_device     uuid,
  from_computer   text,
  from_user       text,
  from_port       integer,
  from_co_device  uuid,
  from_heard_at   timestamptz,
  to_device       uuid not null,
  to_bridge       text not null,
  to_computer     text,
  to_user         text,
  to_port         integer,
  why             text not null check (why in ('offline', 'not_open')),
  fetch_on        boolean not null default false,
  at              timestamptz not null default now(),
  undone_at       timestamptz,
  undone_by       uuid
);
create index if not exists tally_read_moves_book on public.tally_read_moves (firm_id, book_id, id desc);
alter table public.tally_read_moves enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_read_moves' and policyname = 'tally_read_moves_read') then
    create policy tally_read_moves_read on public.tally_read_moves for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_read_moves from public, anon, authenticated;
grant select on public.tally_read_moves to authenticated;
grant all on public.tally_read_moves to service_role;
grant usage, select on sequence public.tally_read_moves_id_seq to service_role;

-- ---------------------------------------------------------------- 1. the bridge that reads a book now
create or replace function public.tally_read_follow(p_firm uuid, p_book uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare l tally_links%rowtype; co text; guid text; serving jsonb; n int; home_at timestamptz; online boolean; mv tally_read_moves%rowtype;
        top jsonb; why text; fon boolean; cod uuid; mid bigint; reader jsonb; st text; rdev uuid; same boolean; home_pc text;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into l from tally_links where firm_id = p_firm and book_id = p_book and state = 'linked';
  if not found then return jsonb_build_object('ok', true, 'state', 'nolink', 'serving', '[]'::jsonb); end if;
  perform pg_advisory_xact_lock(hashtext('tally_read_follow:' || p_book::text));
  select c.company, c.device_id into co, cod from tally_companies c where c.firm_id = p_firm and c.book_id = p_book order by c.last_seen desc nulls last limit 1;
  co := coalesce(co, l.company_name);
  guid := nullif(lower(btrim(coalesce(l.company_guid, ''))), '');
  -- the link's computer: its key's own (as its beat names it), else the record's
  home_pc := lower(btrim(coalesce((select coalesce(nullif(btrim(d.info ->> 'computer'), ''), nullif(btrim(d.info -> 'beat' ->> 'computer'), '')) from tally_devices d where d.id = l.device_id), l.computer, '')));
  -- the candidates, in the order that decides (the link's key, the link's computer, the newest heard, the ids)
  select coalesce(jsonb_agg(x.j order by x.lk desc, x.sm desc, x.at desc nulls last, x.dev, x.br), '[]'::jsonb) into serving from (
    select jsonb_build_object('device', d.id, 'bridge', k.key, 'at', k.value ->> 'at', 'computer', x2.pc,
             'user', nullif(btrim(coalesce(k.value ->> 'user', '')), ''),
             'port', case when coalesce(k.value ->> 'tallyPort', '') ~ '^[0-9]{1,5}$' and (k.value ->> 'tallyPort')::int between 1 and 65535 then (k.value ->> 'tallyPort')::int end,
             'linked', d.id is not distinct from l.device_id) as j,
           (d.id is not distinct from l.device_id) as lk,
           (x2.pc is not null and home_pc <> '' and lower(x2.pc) = home_pc) as sm,
           k.value ->> 'at' as at, d.id::text as dev, k.key as br
      from tally_devices d
      cross join lateral jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
      cross join lateral (select coalesce(nullif(btrim(k.value ->> 'computer'), ''), nullif(btrim(d.info ->> 'computer'), ''), d.name) as pc) x2
     where d.firm_id = p_firm and not coalesce(d.revoked, false) and k.key ~ '^go-[0-9a-f]{6,32}$'
       and tally_bridge_device(p_firm, k.key) = d.id
       and tally_bridge_serves(d.id, k.key, co, guid)
       and jsonb_typeof(k.value -> 'readStopped') is distinct from 'object'
       and jsonb_typeof(d.info -> 'readStop') is distinct from 'object'
       and (l.data_loc is null or coalesce(tally_link_loc(d.id, k.key, co) ->> 'loc', l.data_loc) = l.data_loc)) x;
  n := jsonb_array_length(serving);
  -- when the link's own computer key was last heard (any of its bridges, or any call with its key)
  select greatest(d.last_seen, (select max(case when b.value ->> 'at' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d' then (b.value ->> 'at')::timestamptz end)
                                  from jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) b))
    into home_at from tally_devices d where d.id = l.device_id and d.firm_id = p_firm;
  online := coalesce(home_at > now() - interval '5 minutes', false);
  select * into mv from tally_read_moves m where m.firm_id = p_firm and m.book_id = p_book order by m.id desc limit 1;
  if n = 0 then
    st := 'none'; reader := null;
  elsif coalesce((serving -> 0 ->> 'linked')::boolean, false) then
    st := 'linked'; reader := serving -> 0;
  elsif mv.id is not null and mv.undone_at is not null and mv.undone_at > now() - interval '24 hours' then
    st := 'held'; reader := null;
  elsif mv.id is not null and mv.undone_at is null and mv.at > now() - interval '2 minutes' then
    st := 'settling'; reader := serving -> 0;
  else
    -- the move, under the firm's link lock (tally_link_write's), only while the link is still as read above
    perform pg_advisory_xact_lock(hashtext('tally_links:' || p_firm::text));
    if not exists (select 1 from tally_links x where x.firm_id = p_firm and x.book_id = p_book and x.state = 'linked'
                     and x.device_id is not distinct from l.device_id and x.client_id = l.client_id) then
      return jsonb_build_object('ok', true, 'state', 'changed', 'serving', serving);
    end if;
    top := serving -> 0; reader := top; rdev := (top ->> 'device')::uuid;
    why := case when online then 'not_open' else 'offline' end;
    same := l.device_id is not null and home_pc <> '' and lower(btrim(coalesce(top ->> 'computer', ''))) = home_pc;
    fon := coalesce((select d.period_fetch from tally_devices d where d.id = rdev), false)
           or (same and coalesce((select d.period_fetch from tally_devices d where d.id = l.device_id), false));
    insert into tally_read_moves (firm_id, book_id, company_name, company_guid, from_device, from_computer, from_user, from_port, from_co_device, from_heard_at,
                                  to_device, to_bridge, to_computer, to_user, to_port, why, fetch_on)
    values (p_firm, p_book, co, guid, l.device_id, l.computer, l.windows_user, l.tally_port, cod, home_at,
            rdev, top ->> 'bridge', top ->> 'computer', top ->> 'user', (top ->> 'port')::int, why, fon)
    returning id into mid;
    update tally_links set device_id = rdev, computer = coalesce(top ->> 'computer', computer), windows_user = coalesce(top ->> 'user', windows_user),
           tally_port = coalesce((top ->> 'port')::int, tally_port), updated_at = now()
     where firm_id = p_firm and book_id = p_book and state = 'linked';
    update tally_companies set device_id = rdev where firm_id = p_firm and book_id = p_book and device_id is distinct from rdev;
    return jsonb_build_object('ok', true, 'state', 'moved', 'move', mid, 'why', why, 'reader', reader, 'fetchOn', fon, 'serving', serving,
                              'from', jsonb_build_object('device', l.device_id, 'heardAt', home_at));
  end if;
  -- the reader's switch, or the one of the key the book moved from on the same computer (the move's fetch_on)
  rdev := (reader ->> 'device')::uuid;
  fon := rdev is not null and (coalesce((select d.period_fetch from tally_devices d where d.id = rdev), false)
         or exists (select 1 from tally_read_moves m where m.firm_id = p_firm and m.book_id = p_book and m.to_device = rdev and m.undone_at is null and m.fetch_on
                      and m.id = (select max(m2.id) from tally_read_moves m2 where m2.firm_id = p_firm and m2.book_id = p_book)));
  return jsonb_build_object('ok', true, 'state', st, 'reader', reader, 'fetchOn', fon, 'serving', serving,
                            'linked', jsonb_build_object('device', l.device_id, 'heardAt', home_at, 'online', online));
end $function$;
revoke all on function public.tally_read_follow(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tally_read_follow(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- 3. a move put back (an owner)
create or replace function public.tally_read_move_back(p_move bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); mv tally_read_moves%rowtype;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true)) then
    raise exception 'Only an owner of the firm can put a move of the reads back.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || f::text));
  select * into mv from tally_read_moves where id = p_move and firm_id = f for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'No such move in this firm.'); end if;
  if mv.undone_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if not exists (select 1 from tally_links l where l.firm_id = f and l.book_id = mv.book_id and l.state = 'linked' and l.device_id is not distinct from mv.to_device) then
    return jsonb_build_object('ok', false, 'error', 'The link changed since this move; nothing was put back.');
  end if;
  update tally_links set device_id = mv.from_device, computer = mv.from_computer, windows_user = mv.from_user, tally_port = mv.from_port, updated_at = now()
   where firm_id = f and book_id = mv.book_id and state = 'linked';
  update tally_companies set device_id = mv.from_co_device where firm_id = f and book_id = mv.book_id and mv.from_co_device is not null;
  update tally_read_moves set undone_at = now(), undone_by = auth.uid() where id = mv.id;
  return jsonb_build_object('ok', true, 'move', mv.id, 'heldUntil', now() + interval '24 hours');
end $function$;
revoke all on function public.tally_read_move_back(bigint) from public, anon;
grant execute on function public.tally_read_move_back(bigint) to authenticated, service_role;

commit;
