-- Migration 196 (13-Nov-2026, next-fix-no-held: the owner's decision "no entry made in Tally is ever held in FinCom"). Runs AFTER 67
-- (staging's tally_recorder_line is 67's text: prosrc md5 193dbe733ea916e999919d7682ed7014). One transaction (lock_timeout 10 s),
-- safe to run twice; no statement removes a row; the one table change widens tally_recorder_lines' state check by one value
-- ('fetching'), as 50 widened it for 'replaced'. Every line ends applied, duplicate, stale or replaced, or is 'fetching' (being
-- fetched: the cloud and the bridge keep asking by themselves); 'held' is never written again, and the re-run turns every held line
-- into one of those. GUID + MasterID are the entry's identity and AlterID orders its versions. In tally_recorder_line (67's text,
-- lines marked "196"):
--   a. a line WITH Tally's entry under its own GUID is applied whatever the line's own words name (older than the copy: 'stale');
--      the copy takes Tally's number, date and type on the same row by GUID; at the AlterID the copy holds, Tally's entry that
--      differs in number, date or type is applied (a renumbering; again at the same AlterID: the earlier applied line 'replaced').
--   b. the add-on's line of a NEW entry carrying the previous entry's MasterID (the bridge proved it): 'duplicate' when the copy
--      holds the one live entry with its type, number and date; its number and date are never written onto the MasterID's entry.
--      Not in the copy: 'fetching', and the candidate search asks Tally by GUID for MasterID +1..+5 (c below); a candidate's answer
--      is applied only when Tally's type, number and date are the line's, and replaces the line; any other answer is 'stale'.
--   c. a delete / cancel without a GUID that nothing in the copy can be: applied, nothing deleted; one WITH a GUID the copy does
--      not hold: applied, nothing to remove (57 deletes a later copy of that GUID again).
--   d. a FinCom id naming no posting of this firm at all (or one matched to another entry): a plain Tally entry by its GUID, with
--      Tally's body only (a body FinCom built from its posting's XML is asked again by the GUID); one naming a posting not accepted
--      yet waits for it (tally_recorder_short_held / _retry find it by state and FinCom id).
--   e. a filed (locked) month: applied anyway, and an alert "Entry changed in Tally in a filed month: <type> <no> <date>".
--   f. ledger lines the ledger list holds (by name, or by GUID at the line's AlterID or above): 'duplicate' / 'stale'; a delete of
--      a ledger the list does not hold: applied, nothing to mark.
--   g. every 'fetching' line ends: (1) its date's day check done after it came (FinComDayHeads of that day, the entries FinCom lacked
--      taken by GUID): settled by the copy, else 'stale' "No such entry in Tally for <date> (checked <time>)"; (2) a ledger line
--      once Tally's whole ledger list was stored after it: settled to the list ("Tally kept the ledger", the list's name, or 'stale');
--      (3) 7 days of tries (from its first re-run) still being fetched: 'stale' in plain words.
-- Also: tally_month_locked passes the lock for tally_recorder_line's own calls only; the candidate search (tally_recorder_probes,
-- _probe_words, _probe_take: every GUID-less line with a MasterID, MasterID +1..+5 by GUID through tally-ingest's refetch while its
-- typing gate is quiet, the book's lock taken and the line's state checked); the day check (136) takes every GUID-less entry line;
-- the ledger asks (tally_recorder_ledger_asks: names by FinComLedgerByName, the full list at most once in 30 minutes a book); the
-- readers of held lines (45, 50, 53, 54, 92, 136, 137, 146, 158) read 'fetching' alike; tally_held_status counts the lines being
-- fetched with a retry scheduled; tally_recorder_held_rerun(book, max), service_role only, the least recently tried first
-- (tally_recorder_tries), called by tally-ingest's beat once per book in each new isolate (after every deploy), then every 10
-- minutes. Tested on pg_stand: tests/run_migration196.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'tally_recorder_line' and (p.prosrc like '%-- 67%' or p.prosrc like '%-- 196%'))
     or to_regproc('public.tally_held_status') is null or to_regclass('public.tally_check_days') is null then
    raise exception 'migration 196 replaces migration 67''s tally_recorder_line, and the one here is not 67''s (nor 196''s): run 67 and 136 / 137 first (nothing changed)';
  end if;
end $guard$;

-- ---------------------------------------------------------------- 67's line with the lines marked "196"

-- ---------------------------------------------------------------- 196 a: the state 'fetching' (being fetched from Tally)
-- The owner's decision (13-Nov-2026): no line ends 'held'. A line whose entry FinCom does not have yet is 'fetching': the cloud
-- and the bridge keep asking for it by themselves (the candidate search below, the bridge's refetch by MasterID, 133 / 136's
-- day check of its date), never a person. 50's way: the state check rebuilt with one value more (every value it allowed stays)
do $state$
declare c text;
begin
  select con.conname into c from pg_constraint con where con.conrelid = 'public.tally_recorder_lines'::regclass and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%state%' and pg_get_constraintdef(con.oid) like '%held%' limit 1;
  if c is not null and not exists (select 1 from pg_constraint con where con.conname = c and con.conrelid = 'public.tally_recorder_lines'::regclass and pg_get_constraintdef(con.oid) like '%fetching%') then
    execute format('alter table public.tally_recorder_lines drop constraint %I, add constraint %I check (state in (''received'', ''applied'', ''duplicate'', ''stale'', ''held'', ''failed'', ''replaced'', ''fetching''))', c, c);
  end if;
end $state$;

-- ---------------------------------------------------------------- 196 b: a filed (locked) month never holds a recorder line
-- 44's text, and nothing locked while tally_recorder_line passes the lock for its own calls (fincom.lock_pass 'on', set and reset
-- there, transaction-local); every other caller sees the lock as before. tally_recorder_line raises the alert itself
create or replace function public.tally_month_locked(p_book uuid, p_days date[]) returns date
language sql stable security definer set search_path = public, pg_temp as $function$
  select min(k.month) from tally_month_locks k
   where k.book_id = p_book and k.unlocked_at is null
     and k.month = any(array(select date_trunc('month', d)::date from unnest(p_days) d where d is not null))
     and coalesce(current_setting('fincom.lock_pass', true), '') <> 'on'     -- 196
$function$;
revoke all on function public.tally_month_locked(uuid, date[]) from public, anon, authenticated;

-- ---------------------------------------------------------------- 196 c: the candidate search (existing XML only)
-- Tally's own GUID is the company GUID, a dash and the MasterID as 8 hex digits. A line being fetched without its entry's GUID but
-- with a MasterID (whatever its words; a ":resolved" row too: the add-on's line of a new entry often carries the entry before it's
-- MasterID): the entry is asked for by the MasterIDs after it, +1 to +5, one at a time, through the beat's existing refetch (FinCom Bridge asks
-- FinComVoucherObject by that MasterID, one request, and takes the answer only when type, number and date are the line's:
-- liveVoucherWrong), each as a line of its own ("<line id>.p<round>c<k>"), handed only while the beat's typing gate is quiet
-- (lightIdle: 5 s after the last keystroke, Tally not busy, no posting), at most one a line every 2 minutes. A round of 5
-- unmatched: the next round only after the gap check sees a new AlterID in Tally; 3 rounds at most (15 asks): never a loop
create table if not exists public.tally_recorder_probes (
  line_row    bigint primary key references public.tally_recorder_lines(id) on delete cascade,
  book_id     uuid not null,
  firm_id     uuid not null,
  base_mid    bigint not null,                                  -- the line's own MasterID (the entry before the new one)
  round       integer not null default 1 check (round between 1 and 3),
  handed      integer not null default 0 check (handed between 0 and 15),   -- candidates handed out (or known from the copy), all rounds
  round_alter bigint,                                           -- Tally's highest voucher AlterID the gap check had when the round began
  last_at     timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.tally_recorder_probes enable row level security;
revoke all on public.tally_recorder_probes from public, anon, authenticated;
grant select, insert, update on public.tally_recorder_probes to service_role;

-- what the search did, in plain words (null: no search for this line)
create or replace function public.tally_recorder_probe_words(p_row bigint) returns text
language sql stable security definer set search_path = public, pg_temp as $function$
  select case when p.handed = 0 then 'being searched for: Tally is asked for the MasterIDs after ' || p.base_mid || ', one at a time'
              else format('not found yet: asked Tally for %s of the 5 MasterIDs after %s (round %s of 3)%s', p.handed - (p.round - 1) * 5, p.base_mid, p.round,
                          case when p.handed >= 15 then '; no match after 15 asks: the day''s own list from Tally settles it'
                               when p.handed >= p.round * 5 then '; none matched yet: asked again after Tally''s next new entry' else '' end) end
    from tally_recorder_probes p where p.line_row = p_row
$function$;
revoke all on function public.tally_recorder_probe_words(bigint) from public, anon, authenticated;
grant execute on function public.tally_recorder_probe_words(bigint) to service_role;

-- the candidates to hand this bridge now (the beat's refetch rows: line_id, company, company_guid, event, master_id, vch_type,
-- vch_no, vch_date): its own lines (the same computer key and bridge id), at most p_max (1..5), nothing unless p_idle
create or replace function public.tally_recorder_probe_take(p_firm uuid, p_device uuid, p_bridge text, p_idle boolean, p_max integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare l record; p tally_recorder_probes%rowtype; out jsonb := '[]'::jsonb; k int; cm bigint; ga bigint; n int := 0;
  lim int := least(greatest(coalesce(p_max, 1), 0), 5); handed_now boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not coalesce(p_idle, false) or lim = 0 or p_firm is null or p_device is null or coalesce(p_bridge, '') = '' then return out; end if;
  for l in select r.* from tally_recorder_lines r
            where r.firm_id = p_firm and r.device_id = p_device and r.bridge = p_bridge and r.state in ('held', 'fetching')
              and r.event in ('created', 'altered', 'imported') and r.received_at > now() - interval '30 days'
              and (r.object_guid is null or r.object_guid ~ '-0{8}$') and r.line_id !~ '\.p[1-3]c[1-5]' and length(r.line_id) <= 75
              and coalesce(r.master_id, '') ~ '^[0-9]{1,9}$' and r.master_id::bigint between 1 and 4294967290
              and nullif(btrim(r.vch_type), '') is not null and nullif(btrim(r.vch_no), '') is not null and r.vch_date is not null
              and nullif(r.company_guid, '') is not null and nullif(r.company, '') is not null
            -- the line asked least recently first (one never asked before all), so no line waits behind others
            order by (select pr.last_at from tally_recorder_probes pr where pr.line_row = r.id) asc nulls first, r.id limit 50 loop
    exit when n >= lim;
    -- the book free (no apply, re-run or release running on it) and the line still being fetched, under its row lock
    continue when not pg_try_advisory_xact_lock(hashtext(l.book_id::text));
    perform 1 from tally_recorder_lines x where x.id = l.id and x.state in ('held', 'fetching') for update;
    continue when not found;
    select * into p from tally_recorder_probes where line_row = l.id for update;
    if not found then
      select case when coalesce(c.gap->>'tally_altvchid', '') ~ '^[0-9]{1,15}$' then (c.gap->>'tally_altvchid')::bigint end into ga from tally_sync_cursor c where c.book_id = l.book_id;
      insert into tally_recorder_probes (line_row, book_id, firm_id, base_mid, round_alter) values (l.id, l.book_id, l.firm_id, l.master_id::bigint, ga)
      on conflict (line_row) do nothing;
      select * into p from tally_recorder_probes where line_row = l.id for update;
    end if;
    continue when p.last_at > now() - interval '2 minutes';
    if p.handed >= p.round * 5 then
      continue when p.round >= 3;
      ga := null;
      select (c.gap->>'tally_altvchid')::bigint into ga from tally_sync_cursor c
       where c.book_id = l.book_id and c.gap is not null and coalesce(c.gap->>'tally_altvchid', '') ~ '^[0-9]{1,15}$'
         and (c.gap->>'tally_altvchid')::bigint > coalesce(p.round_alter, 0);
      continue when ga is null;
      p.round := p.round + 1; p.round_alter := ga;
    end if;
    handed_now := false;
    while p.handed < p.round * 5 and not handed_now loop
      k := p.handed - (p.round - 1) * 5 + 1; cm := p.base_mid + k; p.handed := p.handed + 1;
      -- a MasterID the copy holds as an entry already is known without asking (the one that is this entry settles the line by rule c)
      continue when exists (select 1 from tally_vouchers v where v.book_id = l.book_id and lower(v.guid) = lower(l.company_guid) || '-' || lpad(to_hex(cm), 8, '0') and v.deleted_at is null);
      out := out || jsonb_build_array(jsonb_build_object('line_id', l.line_id || '.p' || p.round || 'c' || k, 'company', l.company, 'company_guid', l.company_guid,
               'event', 'created', 'master_id', cm::text, 'vch_type', btrim(l.vch_type), 'vch_no', btrim(l.vch_no), 'vch_date', to_char(l.vch_date, 'YYYYMMDD')));
      n := n + 1; p.last_at := now(); handed_now := true;
    end loop;
    update tally_recorder_probes set handed = p.handed, round = p.round, round_alter = p.round_alter, last_at = coalesce(p.last_at, last_at) where line_row = l.id;
    update tally_recorder_lines set held_why = left(regexp_replace(coalesce(held_why, ''), '; (not found yet|being searched for): .*$', '') || coalesce('; ' || tally_recorder_probe_words(l.id), ''), 2000)
     where id = l.id;
  end loop;
  return out;
end $function$;
revoke all on function public.tally_recorder_probe_take(uuid, uuid, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.tally_recorder_probe_take(uuid, uuid, text, boolean, integer) to service_role;

-- ---------------------------------------------------------------- 196 e: every line's last try (the re-run takes the least recently tried first)
create table if not exists public.tally_recorder_tries (
  line_row  bigint primary key references public.tally_recorder_lines(id) on delete cascade,
  book_id   uuid not null,
  first_at  timestamptz not null default now(),                 -- its first try (the 7-day ceiling counts from it)
  tried_at  timestamptz not null default now(),
  n         integer not null default 0
);
alter table public.tally_recorder_tries enable row level security;
revoke all on public.tally_recorder_tries from public, anon, authenticated;
grant select, insert, update on public.tally_recorder_tries to service_role;

-- ---------------------------------------------------------------- 196 f: ledger lines brought to an end by Tally's ledgers
-- The ledger lines being fetched end once the ledger list settles them (tally_recorder_line, rule (2)). What to ask this bridge for,
-- only while its typing gate is quiet: names, the new or current name of each of its ledger lines the list lacks (FinComLedgerByName,
-- one small request a name: tally-ingest's ledgersWanted, at most 20); full, the companies whose book has a ledger line being fetched
-- for over an hour with no whole ledger list stored since it came (the existing full-list wake: FinComLedgerList, 2,000 ledgers a
-- request), asked at most once in 30 minutes a book
create table if not exists public.tally_recorder_ledger_lists (
  book_id   uuid primary key references public.tally_books(book_id) on delete cascade,
  firm_id   uuid not null,
  asked_at  timestamptz not null default now()
);
alter table public.tally_recorder_ledger_lists enable row level security;
revoke all on public.tally_recorder_ledger_lists from public, anon, authenticated;
grant select, insert, update on public.tally_recorder_ledger_lists to service_role;

create or replace function public.tally_recorder_ledger_asks(p_firm uuid, p_device uuid, p_bridge text, p_idle boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare names jsonb := '[]'::jsonb; full_ jsonb := '[]'::jsonb; x record;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not coalesce(p_idle, false) or p_firm is null or p_device is null or coalesce(p_bridge, '') = '' then return jsonb_build_object('names', names, 'full', full_); end if;
  select coalesce(jsonb_agg(jsonb_build_object('company', q.company, 'company_guid', q.company_guid, 'name', q.nm) order by q.at), '[]'::jsonb) into names from (
    select distinct on (r.book_id, nm) r.company, r.company_guid, nm, r.received_at as at
      from tally_recorder_lines r, lateral (select left(coalesce(nullif(btrim(r.body->>'to'), ''), nullif(btrim(r.body->>'name'), '')), 300) as nm) n
     where r.firm_id = p_firm and r.device_id = p_device and r.bridge = p_bridge and r.state in ('held', 'fetching')
       and r.event in ('ledger_created', 'ledger_altered', 'ledger_renamed') and r.received_at > now() - interval '30 days'
       and n.nm is not null and nullif(r.company, '') is not null and nullif(r.company_guid, '') is not null
       and not exists (select 1 from tally_ledgers l where l.book_id = r.book_id and l.name = n.nm and l.deleted_at is null)
     order by r.book_id, nm, r.received_at limit 20) q;
  for x in select b.book_id, b.company from tally_books b
            where b.firm_id = p_firm
              and exists (select 1 from tally_recorder_lines r where r.book_id = b.book_id and r.device_id = p_device and r.bridge = p_bridge and r.state in ('held', 'fetching')
                           and r.event like 'ledger\_%' and r.received_at < now() - interval '1 hour' and (b.ledgers_at is null or b.ledgers_at < r.received_at))
              and not exists (select 1 from tally_recorder_ledger_lists a where a.book_id = b.book_id and a.asked_at > now() - interval '30 minutes')
            order by b.book_id limit 5 loop
    insert into tally_recorder_ledger_lists (book_id, firm_id, asked_at) values (x.book_id, p_firm, now()) on conflict (book_id) do update set asked_at = now();
    full_ := full_ || to_jsonb(x.company);
  end loop;
  return jsonb_build_object('names', names, 'full', full_);
end $function$;
revoke all on function public.tally_recorder_ledger_asks(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_recorder_ledger_asks(uuid, uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------- 196 d: every reader of a held line reads a 'fetching' one alike
-- (each the text of its latest migration, staging's own; only the lines marked "196" changed)

create or replace function public.tally_check_days_held_settle() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare mxd timestamptz; r tally_held_reads%rowtype;
begin
  if not exists (select 1 from tally_recorder_lines l where l.book_id = new.book_id and l.vch_date = new.day and l.state in ('held', 'fetching')) then return null; end if;     -- 196
  begin
    select max(l.received_at) into mxd from tally_recorder_lines l
     where l.book_id = new.book_id and l.vch_date = new.day and l.state in ('held', 'fetching') and l.event in ('deleted', 'cancelled')     -- 196
       and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why);
    if mxd is not null and new.via = 'day' and new.listed_at > mxd then
      select * into r from tally_held_reads where book_id = new.book_id and day = new.day;
      if r.book_id is null or r.first_at is null or r.first_at < mxd then
        insert into tally_held_reads (book_id, firm_id, day, first_at) values (new.book_id, new.firm_id, new.day, new.listed_at)
        on conflict (book_id, day) do update set first_at = excluded.first_at, second_at = null;
      elsif new.listed_at >= r.first_at + interval '60 seconds' then
        update tally_held_reads set second_at = new.listed_at where book_id = new.book_id and day = new.day;
      end if;
    end if;
    perform tally_held_settle_day(new.book_id, new.day);
    -- the second whole-day list still to take: the day asked again (after the others: handed out at least a minute on)
    if mxd is not null and new.via = 'day' and new.listed_at > mxd
       and exists (select 1 from tally_recorder_lines l where l.book_id = new.book_id and l.vch_date = new.day and l.state in ('held', 'fetching') and l.event in ('deleted', 'cancelled')     -- 196
                    and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why))
       and not exists (select 1 from tally_held_reads h where h.book_id = new.book_id and h.day = new.day and h.second_at is not null) then
      update tally_check_days set done_at = null, same = null, asked_at = now(), source = 'held' where book_id = new.book_id and day = new.day and done_at is not null;
    end if;
  exception when others then
    raise log 'tally_check_days_held_settle: book % day %: % %', new.book_id, new.day, sqlstate, sqlerrm;
  end;
  return null;
end $function$;

create or replace function public.tally_days_held_settle() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d record;
begin
  for d in select distinct n.book_id, n.day from new_days n
            where exists (select 1 from tally_recorder_lines l where l.book_id = n.book_id and l.vch_date = n.day and l.state in ('held', 'fetching') and l.event in ('created', 'altered', 'imported'))     -- 196
            order by n.book_id, n.day loop
    begin
      perform tally_held_settle_day(d.book_id, d.day);
    exception when others then
      raise log 'tally_days_held_settle: book % day %: % %', d.book_id, d.day, sqlstate, sqlerrm;
    end;
  end loop;
  return null;
exception when query_canceled or others then
  raise log 'tally_days_held_settle: stopped (the days stored): % %', sqlstate, sqlerrm;
  return null;
end $function$;

create or replace function public.tally_days_recorder_release() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d record;
begin
  for d in select distinct n.book_id, n.day from new_days n
            where exists (select 1 from tally_recorder_lines l where l.book_id = n.book_id and l.state in ('held', 'fetching', 'applied') and l.event in ('created', 'altered', 'imported', 'deleted', 'cancelled'))     -- 196
            order by n.book_id, n.day loop
    begin
      perform tally_recorder_release_day(d.book_id, d.day);
    exception when others then
      raise log 'tally_days_recorder_release: book % day %: % %', d.book_id, d.day, sqlstate, sqlerrm;
    end;
  end loop;
  return null;
exception when query_canceled or others then
  raise log 'tally_days_recorder_release: stopped (the days stored, the held lines left for the next store): % %', sqlstate, sqlerrm;
  return null;
end $function$;

create or replace function public.tally_days_recorder_settle() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d record;
begin
  for d in select distinct n.book_id, n.day from new_days n
            where exists (select 1 from tally_recorder_lines l where l.book_id = n.book_id and l.vch_date = n.day and l.state in ('held', 'fetching') and l.event in ('deleted', 'cancelled'))     -- 196
            order by n.book_id, n.day loop
    begin
      perform tally_recorder_settle_unnamed(d.book_id, d.day);
    exception when others then
      raise log 'tally_days_recorder_settle: book % day %: % %', d.book_id, d.day, sqlstate, sqlerrm;
    end;
  end loop;
  return null;
exception when query_canceled or others then
  raise log 'tally_days_recorder_settle: stopped (the days stored, the held lines left for the next store): % %', sqlstate, sqlerrm;
  return null;
end $function$;

create or replace function public.tally_held_delete_by_heads(p_book uuid, p_day date, p_heads jsonb, p_device uuid, p_bridge text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare cg text; f uuid; l record; g text; hx text; mid bigint; nv int; vg text; va bigint; res jsonb; n int := 0; done jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_book is null or p_day is null or p_device is null or coalesce(p_bridge, '') = ''
     or jsonb_typeof(coalesce(p_heads, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_heads) = 0 then
    return jsonb_build_object('ok', true, 'removed', 0);
  end if;
  if not exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = p_day and k.done_at is null and k.upload_at is null) then
    return jsonb_build_object('ok', true, 'mine', false, 'removed', 0);
  end if;
  select lower(btrim(coalesce(c.start_guid, c.company_guid))), c.firm_id into cg, f from tally_sync_cursor c where c.book_id = p_book;
  if coalesce(cg, '') !~ '^[0-9a-f][0-9a-f-]{7,99}$' then return jsonb_build_object('ok', true, 'mine', true, 'removed', 0); end if;
  for l in select x.id, x.master_id, x.vch_no, x.vch_type, x.received_at from tally_recorder_lines x
            where x.book_id = p_book and x.vch_date = p_day and x.state in ('held', 'fetching') and x.event = 'deleted'     -- 196
              and x.device_id = p_device and x.bridge = p_bridge and x.received_at > now() - interval '10 minutes'
              and (x.object_guid is null or x.object_guid ~ '-0{8}$')
              and coalesce(x.master_id, '') ~ '^[0-9]{1,15}$' and x.master_id::bigint > 0
              and lower(btrim(coalesce(x.company_guid, ''))) = cg
              and btrim(coalesce(x.vch_no, '')) <> '' and btrim(coalesce(x.vch_type, '')) <> ''
              and coalesce(x.held_why, '') not like 'month locked%' and coalesce(x.held_why, '') not like 'FinCom id %'
            order by x.id loop
    mid := l.master_id::bigint; hx := to_hex(mid);
    g := cg || '-' || case when length(hx) < 8 then lpad(hx, 8, '0') else hx end;
    -- this Tally's whole list of the day names neither that GUID nor that MasterID
    continue when exists (select 1 from jsonb_array_elements(p_heads) h
                           where jsonb_typeof(h) <> 'array' or lower(coalesce(h->>0, '')) = g
                              or (coalesce(h->>1, '') ~ '^[0-9]{1,15}$' and (h->>1)::bigint = mid));
    -- exactly one live entry of the day with the line's number and type, and it is that GUID
    select count(*), min(v.guid), min(v.alter_id) into nv, vg, va from tally_vouchers v
     where v.book_id = p_book and v.day = p_day and v.deleted_at is null and v.vno = l.vch_no and v.vtype = l.vch_type;
    continue when nv <> 1 or lower(vg) <> g or va is null;
    -- (review 2) the version FinCom holds now was held before the delete line arrived (a MasterID reused by a new entry
    -- taken later is never removed by an older delete line)
    continue when not exists (select 1 from tally_voucher_versions vv where vv.book_id = p_book and vv.tally_guid = vg and vv.alter_id = va and vv.seen_at <= l.received_at);
    res := tally_ingest_delete(p_book, vg, null, false, 'day check: deleted in Tally (MasterID)');
    continue when coalesce(res->>'state', '') <> 'applied' or coalesce((res->>'already')::boolean, false);
    insert into tally_fetch_log (book_id, firm_id, via, what, guid, day) values (p_book, f, 'check', 'deleted', vg, p_day);
    update tally_recorder_lines set state = 'applied', applied_at = now(),
           held_why = format('deleted in Tally: %s %s of %s (Tally''s MasterID %s) removed from FinCom - Tally''s whole list of the day, read %s, no longer has it',
                             l.vch_type, l.vch_no, to_char(p_day, 'DD-Mon-YYYY'), mid, to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'))
     where id = l.id and state in ('held', 'fetching');     -- 196
    n := n + 1; done := done || to_jsonb(vg);
  end loop;
  return jsonb_build_object('ok', true, 'mine', true, 'removed', n, 'guids', done);
end $function$;

create or replace function public.tally_held_front(p_book uuid, p_device uuid, p_bridge text, p_max integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_check_runs%rowtype; p tally_period_pulls%rowtype; has_p boolean; ca timestamptz; out jsonb := '[]'::jsonb; d date; lim int := least(greatest(coalesce(p_max, 1), 0), 30);
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_book is null or p_device is null or coalesce(p_bridge, '') = '' or lim = 0 then return out; end if;
  select * into r from tally_check_runs where book_id = p_book;
  if not found or r.state <> 'going' then return out; end if;
  select * into p from tally_period_pulls where book_id = p_book;
  has_p := found;
  if has_p and p.state = 'paused' then return out; end if;
  if has_p and p.state = 'stopped' and not (r.chosen_at > coalesce(p.stopped_at, p.chosen_at)) then return out; end if;
  ca := case when has_p and p.state = 'going' then p.chosen_at else r.chosen_at end;
  for d in select x.day from tally_check_days x
            where x.book_id = p_book and x.done_at is null and x.upload_at is null and x.day <= today
              and (x.asked_at is null or x.asked_at < now() - interval '3 minutes')
              and exists (select 1 from tally_recorder_lines l
                           where l.book_id = p_book and l.vch_date = x.day and l.state in ('held', 'fetching') and l.event in ('deleted', 'cancelled')     -- 196
                             and (l.object_guid is null or l.object_guid ~ '-0{8}$') and l.device_id = p_device and l.bridge = p_bridge
                             and l.received_at > now() - interval '1 day')
            order by x.day desc limit lim loop
    out := out || jsonb_build_array(jsonb_build_object('day', to_char(d, 'YYYYMMDD'), 'fetch', true, 'chosenAt', ca, 'check', true, 'held', true));
  end loop;
  update tally_check_days x set asked_at = now(), first_asked_at = coalesce(x.first_asked_at, now())
   where x.book_id = p_book and x.day in (select to_date(e->>'day', 'YYYYMMDD') from jsonb_array_elements(out) e);
  return out;
end $function$;

create or replace function public.tally_held_queue_of(p_book uuid, p_days date[]) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; today date := (now() at time zone 'Asia/Kolkata')::date; x record; c tally_check_days%rowtype; r tally_held_reads%rowtype; want date[] := '{}'; n int := 0;
begin
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return 0; end if;
  for x in select l.vch_date as day, max(l.received_at) as mx,
                  max(l.received_at) filter (where l.event in ('deleted', 'cancelled')) as mxd
             from tally_recorder_lines l
            where l.book_id = p_book and l.state in ('held', 'fetching') and l.vch_date <= today and l.vch_date >= date '2000-04-01'     -- 196
              and (p_days is null or l.vch_date = any (p_days))
              and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why)
            group by l.vch_date order by l.vch_date desc limit 400 loop
    select * into c from tally_check_days where book_id = p_book and day = x.day;
    if c.book_id is null then want := want || x.day; continue; end if;
    if c.done_at is null and c.upload_at is null then continue; end if;                       -- being checked
    if c.upload_at is not null then
      if c.upload_at < x.mx then want := want || x.day; end if;                              -- given up before these lines
      continue;
    end if;
    if c.listed_at is null or c.listed_at < x.mx then want := want || x.day; continue; end if;  -- listed before these lines
    -- listed after them; the GUID-less deletes wait for a second whole-day list: the first recorded, the day queued again
    if x.mxd is not null and c.via = 'day' then
      select * into r from tally_held_reads where book_id = p_book and day = x.day;
      if r.second_at is null or r.first_at is null or r.first_at < x.mxd then
        insert into tally_held_reads (book_id, firm_id, day, first_at) values (p_book, f, x.day, c.listed_at)
        on conflict (book_id, day) do update set first_at = excluded.first_at, second_at = null
          where tally_held_reads.first_at is null or tally_held_reads.first_at < x.mxd;
        want := want || x.day;
      end if;
    end if;
  end loop;
  if array_length(want, 1) is null then return 0; end if;
  insert into tally_check_runs (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
  insert into tally_check_days (book_id, firm_id, day, source, queued_at)
  select p_book, f, d, 'held', now() from unnest(want) d
  on conflict (book_id, day) do update set source = excluded.source, queued_at = now(), asked_at = null, first_asked_at = null, lists = 0, tally_n = null, heads = null, via = null,
    listed_at = null, gone1 = null, gone1_at = null, added = 0, updated = 0, removed = 0, same = null, done_at = null, upload_at = null, upload_words = null
    where not (tally_check_days.done_at is null and tally_check_days.upload_at is null);
  get diagnostics n = row_count;
  return n;
end $function$;

create or replace function public.tally_held_settle_day(p_book uuid, p_day date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare c tally_check_days%rowtype; r tally_held_reads%rowtype; t tally_days%rowtype; t_ok boolean := false; ne int := 0; nd int := 0; at_txt text;
begin
  if p_book is null or p_day is null then return jsonb_build_object('entries', 0, 'deletes', 0); end if;
  if not exists (select 1 from tally_recorder_lines l where l.book_id = p_book and l.vch_date = p_day and l.state in ('held', 'fetching')) then     -- 196
    return jsonb_build_object('entries', 0, 'deletes', 0);
  end if;
  -- what FinCom knows of the day, read first (a line the re-run holds again may queue the day afresh)
  select * into c from tally_check_days where book_id = p_book and day = p_day;
  select * into r from tally_held_reads where book_id = p_book and day = p_day;
  select * into t from tally_days where book_id = p_book and day = p_day;
  begin
    perform tally_recorder_release_day(p_book, p_day);
  exception when others then
    raise log 'tally_held_settle_day: release of book % day %: % %', p_book, p_day, sqlstate, sqlerrm;
  end;
  if t.at is not null and t.n is not null then
    t_ok := t.n = (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = p_day and v.deleted_at is null);
  end if;
  at_txt := to_char(coalesce(c.listed_at, now()) at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI');
  -- the entry lines: FinCom holds the entry live, and at or above the line's AlterID, or as Tally's whole list of the day
  -- (taken after the line arrived) has it, or as a complete Day Book of the day stored after the line arrived has it
  update tally_recorder_lines l
     set state = 'duplicate',
         held_why = case
           when coalesce(v.alter_id, 0) >= coalesce(l.alter_id, 0) then format('already in the books: FinCom holds this entry at AlterID %s', coalesce(v.alter_id, 0))
           when c.done_at is not null and c.via = 'day' and c.listed_at > l.received_at
                and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.heads) = 'array' then c.heads else '[]'::jsonb end) h
                             where jsonb_typeof(h) = 'array' and h->>0 = l.object_guid and coalesce(h->>2, '') = coalesce(v.alter_id, 0)::text)
             then format('already in the books: checked against Tally on %s (Tally lists this entry at AlterID %s, as FinCom holds it)', at_txt, coalesce(v.alter_id, 0))
           else format('already in the books: the Day Book for %s, complete and stored after this change arrived, holds this entry (AlterID %s)', to_char(p_day, 'DD-Mon-YYYY'), coalesce(v.alter_id, 0)) end
    from tally_vouchers v
   where l.book_id = p_book and l.vch_date = p_day and l.state in ('held', 'fetching') and l.event in ('created', 'altered', 'imported')     -- 196
     and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why)
     and v.book_id = p_book and v.guid = l.object_guid and v.deleted_at is null
     and (coalesce(v.alter_id, 0) >= coalesce(l.alter_id, 0)
          or (c.done_at is not null and c.via = 'day' and c.listed_at > l.received_at
              and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.heads) = 'array' then c.heads else '[]'::jsonb end) h
                           where jsonb_typeof(h) = 'array' and h->>0 = l.object_guid and coalesce(h->>2, '') = coalesce(v.alter_id, 0)::text))
          or (t_ok and t.at > l.received_at and v.day = p_day));
  get diagnostics ne = row_count;
  -- the GUID-less deletes: two whole-day lists a minute or more apart, both after the line arrived, the day done since
  if r.second_at is not null and r.first_at is not null and c.done_at is not null and c.via = 'day' and c.listed_at >= r.second_at then
    update tally_recorder_lines l
       set state = 'applied', applied_at = now(),
           held_why = format('nothing left to do: checked against Tally on %s - Tally''s whole list of %s, read twice a minute or more apart, matches FinCom (the line named no entry)',
                             to_char(r.second_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'), to_char(p_day, 'DD-Mon-YYYY'))
     where l.book_id = p_book and l.vch_date = p_day and l.state in ('held', 'fetching') and l.event in ('deleted', 'cancelled')     -- 196
       and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why) and l.received_at < r.first_at;
    get diagnostics nd = row_count;
  end if;
  return jsonb_build_object('entries', ne, 'deletes', nd);
end $function$;

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
           where x.firm_id = f and x.book_id = l.book_id and x.state in ('held', 'fetching') and x.event in ('created', 'altered', 'imported')     -- 196
             and coalesce(x.line_id, '') <> '' and x.line_id not like '%:resolved'
             -- the serving bridge's own acceptance rules (bridge-go applyHeldLines): the line's company GUID, not empty, the
             -- link's; a MasterID or a type and number to ask Tally by; the company still this book; not waiting for a ledger
             and nullif(lower(btrim(coalesce(x.company_guid, ''))), '') = nullif(lower(btrim(coalesce(l.company_guid, ''))), '')
             and ((length(regexp_replace(coalesce(x.master_id::text, ''), '\D', '', 'g')) between 1 and 18 and regexp_replace(coalesce(x.master_id::text, ''), '\D', '', 'g') ~ '[1-9]') or (btrim(coalesce(x.vch_type, '')) <> '' and btrim(coalesce(x.vch_no, '')) <> ''))
             and exists (select 1 from tally_companies c where c.firm_id = f and c.company = x.company and c.book_id = l.book_id and c.client_id is not null)
             and coalesce(x.held_why, '') not like 'waiting for the ledger%'
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

create or replace function public.tally_recorder_lines_held_queue() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare x record;
begin
  for x in select n.book_id, array_agg(distinct n.vch_date) as days from new_lines n
            where n.state in ('held', 'fetching') and tally_held_line_ours(n.event, n.object_guid, n.vch_date, n.held_why) group by n.book_id loop     -- 196
    begin
      perform tally_held_queue_of(x.book_id, x.days);
    exception when others then
      raise log 'tally_recorder_lines_held_queue: book %: % %', x.book_id, sqlstate, sqlerrm;
    end;
  end loop;
  return null;
exception when query_canceled or others then
  raise log 'tally_recorder_lines_held_queue: stopped (the lines kept): % %', sqlstate, sqlerrm;
  return null;
end $function$;

create or replace function public.tally_recorder_release_day(p_book uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_recorder_lines%rowtype; one jsonb; prev text := coalesce(current_setting('fincom.recorder_release', true), ''); n int := 0; a int := 0; f uuid; st text;
  x record; redone int := 0;
begin
  if p_book is null or p_day is null then return jsonb_build_object('ok', true, 'ran', 0, 'applied', 0); end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return jsonb_build_object('ok', true, 'ran', 0, 'applied', 0); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  -- round 2 (N1): a Day Book read again (an older kept file) never brings back an entry that a delete (cancel) line applied at a
  -- higher AlterID than the day's version of it took away: deleted (cancelled) again at once, through tally_ingest_delete
  perform set_config('fincom.recorder_release', '0', true);
  for x in select v.guid, l.event, max(l.alter_id) as alt from tally_vouchers v
             join tally_recorder_lines l on l.book_id = p_book and l.object_guid = v.guid and l.state = 'applied' and l.event in ('deleted', 'cancelled')
            where v.book_id = p_book and v.day = p_day and v.deleted_at is null and coalesce(l.alter_id, 0) > coalesce(v.alter_id, 0)
              and (l.event = 'deleted' or not v.cancelled)
            group by v.guid, l.event order by v.guid, l.event
  loop
    begin
      perform tally_ingest_delete(p_book, x.guid, x.alt, x.event = 'cancelled', 'recorder: an older Day Book read again');
      redone := redone + 1;
    exception when others then
      raise log 'tally_recorder_release_day: entry % of book % not %: % %', x.guid, p_book, x.event, sqlstate, sqlerrm;
    end;
  end loop;
  for r in
    with dv as (select v.guid, v.vtype, v.vno, coalesce(v.alter_id, 0) as alter_id,
                       case when v.guid ~ '-[0-9A-Fa-f]{8}$' then (('x' || right(v.guid, 8))::bit(32)::bigint)::text end as mid
                  from tally_vouchers v where v.book_id = p_book and v.day = p_day),
    cand as (
      select l.id from dv join tally_recorder_lines l on l.book_id = p_book and l.object_guid = dv.guid and l.state in ('held', 'fetching')     -- 196
       -- an entry line without a body whose AlterID is above the day's version of it stays held whatever: not run
       where l.event in ('deleted', 'cancelled') or coalesce(l.body ? 'vouchers', false) or coalesce(l.alter_id, 0) <= dv.alter_id
      union
      select l.id from dv join tally_recorder_lines l on l.book_id = p_book and l.master_id = dv.mid and l.state in ('held', 'fetching')     -- 196
       where l.object_guid is null or l.object_guid ~ '-0{8}$'
      union
      select l.id from tally_recorder_lines l
       where l.book_id = p_book and l.state in ('held', 'fetching') and l.vch_date = p_day     -- 196
         and ((l.event in ('deleted', 'cancelled') and l.object_guid is not null)
              -- 53: the type in any case, the number trimmed and cut to 60, as tally_recorder_line compares them
              or ((l.object_guid is null or l.object_guid ~ '-0{8}$') and exists (select 1 from dv where lower(btrim(dv.vtype)) = lower(btrim(l.vch_type)) and left(btrim(dv.vno), 60) = left(btrim(l.vch_no), 60)))))
    select l.* from tally_recorder_lines l join cand c on c.id = l.id
     where l.event in ('created', 'altered', 'imported', 'deleted', 'cancelled')
       and coalesce(l.held_why, '') not like 'month locked%' and coalesce(l.held_why, '') not like 'FinCom id %'
     order by l.id
  loop
    begin
      select l.state into st from tally_recorder_lines l where l.id = r.id for update;
      if st not in ('held', 'fetching') then continue; end if;     -- 196
      -- as an owner's release runs it (tally_recorder_release_held): the stored line and its body, the row given
      perform set_config('fincom.recorder_release', r.id::text, true);
      one := tally_recorder_line(r.book_id, r.device_id, jsonb_build_object('line_id', r.line_id, 'event', r.event, 'object_guid', r.object_guid, 'alter_id', r.alter_id,
               'vch_date', r.vch_date, 'vch_no', r.vch_no, 'vch_type', r.vch_type, 'company_guid', r.company_guid, 'master_id', r.master_id, 'pc', r.pc, 'bridge', r.bridge) || coalesce(r.body, '{}'::jsonb), r.id);
      n := n + 1;
      if one->>'state' = 'failed' then
        update tally_recorder_lines set state = 'fetching',     -- 196
               held_why = regexp_replace(coalesce(r.held_why, ''), ' \(a try to apply it by itself met an error: .*\)$', '') || ' (a try to apply it by itself met an error: ' || coalesce(one->>'why', 'unknown') || ')'
         where id = r.id;
        raise log 'tally_recorder_release_day: line % of book % kept held: %', r.id, p_book, one->>'why';
      -- applied now: its AlterID counts for the gap check as any applied line's
      elsif one->>'state' = 'applied' then
        a := a + 1;
        if r.alter_id is not null and r.alter_id < 1000000000000000 and coalesce(r.object_guid, '') !~ '-0{8}$'
           and tally_recorder_ids_together(r.id) then     -- 53: only a line whose ids belong together
          insert into tally_sync_cursor (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
          update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), r.alter_id), recorder_last_at = now(), updated_at = now() where book_id = p_book;
        end if;
      end if;
    exception when others then
      raise log 'tally_recorder_release_day: line % of book % not run again: % %', r.id, p_book, sqlstate, sqlerrm;
    end;
  end loop;
  perform set_config('fincom.recorder_release', prev, true);
  return jsonb_build_object('ok', true, 'ran', n, 'applied', a, 'redone', redone);
end $function$;

create or replace function public.tally_recorder_release_held(p_line bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); r tally_recorder_lines%rowtype; one jsonb;
begin
  if f is null or not can_write()
    then raise exception 'only a member of the firm who may make changes can apply a held line' using errcode = '42501'; end if;
  select * into r from tally_recorder_lines where id = p_line and firm_id = f;
  if r.id is null then raise exception 'not a line of your firm'; end if;
  if r.state not in ('held', 'fetching') then raise exception 'line % is %, not held', p_line, r.state; end if;     -- 196
  if r.event in ('ledger_created', 'ledger_altered', 'ledger_renamed', 'ledger_deleted') then     -- every ledger line (review L4)
    return jsonb_build_object('ok', false, 'id', p_line, 'line_id', r.line_id, 'state', 'held', 'why', 'a ledger line is applied by the bridge''s next ledger list, not by a release');
  end if;
  perform pg_advisory_xact_lock(hashtext(r.book_id::text));
  perform set_config('fincom.recorder_release', p_line::text, true);
  one := tally_recorder_line(r.book_id, r.device_id, jsonb_build_object('line_id', r.line_id, 'event', r.event, 'object_guid', r.object_guid, 'alter_id', r.alter_id,
           'vch_date', r.vch_date, 'vch_no', r.vch_no, 'pc', r.pc, 'bridge', r.bridge) || coalesce(r.body, '{}'::jsonb), p_line);
  perform set_config('fincom.recorder_release', '', true);
  -- stamped released only when the release applied it; one that stays held (its month still locked) is not (review L3)
  if one->>'state' = 'applied' then
    update tally_recorder_lines set released_at = now(), released_by = auth.uid() where id = p_line;
    -- applied now: its AlterID counts for the gap check as any applied line's (review L2)
    if r.alter_id is not null and r.alter_id < 1000000000000000 and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported')
       and tally_recorder_ids_together(p_line) then     -- 53: only a line whose ids belong together
      insert into tally_sync_cursor (book_id, firm_id) values (r.book_id, f) on conflict (book_id) do nothing;
      update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), r.alter_id), recorder_last_at = now(), updated_at = now() where book_id = r.book_id;
    end if;
  end if;
  return jsonb_build_object('ok', true) || one;
end $function$;

create or replace function public.tally_recorder_settle_unnamed(p_book uuid, p_day date) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d_at timestamptz; d_n int; d_live int; k int := 0;
begin
  if p_book is null or p_day is null then return 0; end if;
  select d.at, d.n into d_at, d_n from tally_days d where d.book_id = p_book and d.day = p_day;
  if d_at is null or d_n is null then return 0; end if;
  -- complete: the count the bridge or the upload vouched for equals the entries the copy holds live for the day
  select count(*) into d_live from tally_vouchers v where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
  if d_n <> d_live then return 0; end if;
  update tally_recorder_lines l
     set state = 'applied', applied_at = now(),
         held_why = format('nothing left to do: the Day Book for %s, complete and stored after this change arrived, brought that day up to date in FinCom (the line named no entry)', to_char(p_day, 'DD-Mon-YYYY'))
   where l.book_id = p_book and l.vch_date = p_day and l.state in ('held', 'fetching') and l.event in ('deleted', 'cancelled')     -- 196
     and (l.object_guid is null or l.object_guid ~ '-0{8}$') and l.received_at < d_at;
  get diagnostics k = row_count;
  return k;
end $function$;

create or replace function public.tally_recorder_short_held(p_firm uuid, p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare j tally_post_jobs%rowtype; out_ jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = p_firm;
  if j.id is null then return jsonb_build_object('ok', true, 'lines', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('row', x.id, 'book', x.book_id, 'line', x.line) order by x.id), '[]'::jsonb) into out_
    from (select r.id, r.book_id,
                 coalesce(case when jsonb_typeof(r.payload) = 'object' and not (r.payload ? 'cut') then r.payload end, '{}'::jsonb)
                 || jsonb_strip_nulls(jsonb_build_object('line_id', r.line_id, 'event', r.event, 'object_guid', r.object_guid, 'alter_id', r.alter_id, 'master_id', r.master_id,
                                                         'vch_no', r.vch_no, 'vch_date', to_char(r.vch_date, 'YYYY-MM-DD'), 'fid', r.payload->>'fid', 'short', true)) as line
            from tally_recorder_lines r join tally_books b on b.book_id = r.book_id and b.firm_id = p_firm and b.company = j.company
           where r.firm_id = p_firm and r.state in ('held', 'fetching')     -- 196
             and r.event in ('created', 'imported') and coalesce(r.payload->>'fid', '') <> ''
             and exists (select 1 from tally_post_live_for(p_firm, r.book_id, r.payload->>'fid') m where m.post_job = p_job)
           order by r.id limit 1000) x;
  return jsonb_build_object('ok', true, 'lines', out_);
end $function$;

create or replace function public.tally_recorder_short_retry(p_firm uuid, p_book uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare x jsonb; r tally_recorder_lines%rowtype; res jsonb := '[]'::jsonb; one jsonb; mx bigint; rw bigint;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'the lines must be a list'; end if;
  if jsonb_array_length(p_lines) > 1000 then raise exception 'at most 1000 lines a call (% given)', jsonb_array_length(p_lines); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  for x in select e from jsonb_array_elements(p_lines) with ordinality as t(e, o) order by o loop
    rw := case when coalesce(x->>'row', '') ~ '^[0-9]{1,18}$' then (x->>'row')::bigint end;
    r := null;
    select * into r from tally_recorder_lines l where l.id = rw and l.book_id = p_book and l.firm_id = p_firm and l.state in ('held', 'fetching')     -- 196
       and coalesce(l.held_why, '') not like 'FinCom posting % matched%' and l.event in ('created', 'imported') and coalesce(l.payload->>'fid', '') <> '';     -- 196
    if r.id is null then
      res := res || jsonb_build_array(jsonb_build_object('row', rw, 'line_id', x->>'line_id', 'state', 'skipped', 'why', 'not a held short line of this book'));
      continue;
    end if;
    one := tally_recorder_line(p_book, r.device_id, jsonb_build_object('line_id', r.line_id, 'event', r.event, 'object_guid', r.object_guid, 'alter_id', r.alter_id,
             'master_id', r.master_id, 'vch_no', r.vch_no, 'vch_date', r.vch_date, 'pc', r.pc, 'bridge', r.bridge, 'fid', r.payload->>'fid', 'short', true,
             'vouchers', case when jsonb_typeof(x->'vouchers') = 'array' then x->'vouchers' else '[]'::jsonb end,
             'lines', case when jsonb_typeof(x->'lines') = 'array' then x->'lines' else '[]'::jsonb end), r.id);
    res := res || jsonb_build_array(jsonb_build_object('row', r.id) || (one - 'id'));
    if one->>'state' in ('applied', 'duplicate', 'stale') and r.alter_id is not null and r.alter_id < 1000000000000000 and coalesce(r.object_guid, '') <> ''
       and tally_recorder_ids_together(r.id) then     -- 53: only a line whose ids belong together
      mx := greatest(mx, r.alter_id);
    end if;
  end loop;
  if mx is not null then
    insert into tally_sync_cursor (book_id, firm_id) values (p_book, p_firm) on conflict (book_id) do nothing;
    update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), mx), recorder_last_at = now(), updated_at = now() where book_id = p_book;
  end if;
  return jsonb_build_object('ok', true, 'results', res,
    'applied', (select count(*) from jsonb_array_elements(res) e where e->>'state' = 'applied'),
    'held', (select count(*) from jsonb_array_elements(res) e where e->>'state' in ('held', 'fetching')),     -- 196
    'skipped', (select count(*) from jsonb_array_elements(res) e where e->>'state' = 'skipped'));
end $function$;

create or replace function public.tally_held_status(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); out jsonb := '[]'::jsonb; b record; h record; c record; run tally_check_runs%rowtype; rn jsonb; ren jsonb; a jsonb; rate numeric; eta int; st text; fo boolean; fany boolean;
  today date := (now() at time zone 'Asia/Kolkata')::date; ad date; ok boolean; fn int;     -- 196
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select exists (select 1 from tally_devices d where d.firm_id = f and not coalesce(d.revoked, false) and coalesce(d.period_fetch, false)) into fany;
  select exists (select 1 from tally_devices d where d.firm_id = f and not coalesce(d.revoked, false) and coalesce(d.period_fetch, false) and d.last_seen > now() - interval '10 minutes') into fo;
  for b in select k.book_id, k.client_id, k.company from tally_books k where k.firm_id = f and (p_client is null or k.client_id = p_client) order by k.company, k.book_id loop
    select count(*)::int as n, count(*) filter (where l.event in ('deleted', 'cancelled'))::int as dels, count(*) filter (where l.event not in ('deleted', 'cancelled'))::int as ents,
           min(l.vch_date) as d0, max(l.vch_date) as d1, coalesce(jsonb_agg(distinct to_char(l.vch_date, 'YYYYMMDD')), '[]'::jsonb) as days
      into h from tally_recorder_lines l
     where l.book_id = b.book_id and l.state = 'held' and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why); select count(*)::int into fn from tally_recorder_lines l where l.book_id = b.book_id and l.state = 'fetching' and (exists (select 1 from tally_check_days k where k.book_id = l.book_id and k.day = l.vch_date and k.done_at is null and k.upload_at is null) or exists (select 1 from tally_recorder_probes p where p.line_row = l.id and p.handed < p.round * 5) or (l.event like 'ledger\_%' and l.received_at > now() - interval '7 days') or (l.received_at > now() - interval '7 days' and (coalesce(l.master_id, '') ~ '^[1-9][0-9]{0,9}$' or (l.object_guid is not null and l.object_guid !~ '-0{8}$')) and exists (select 1 from tally_devices d where d.id = l.device_id and d.last_seen > now() - interval '10 minutes')));     -- 196
    select count(*)::int as total, count(*) filter (where d.done_at is not null and d.upload_at is null)::int as done_n,
           count(*) filter (where d.done_at is null and d.upload_at is null)::int as waiting, count(*) filter (where d.upload_at is not null)::int as upload,
           least(30, extract(epoch from now() - min(coalesce(d.first_asked_at, d.asked_at))) / 60) as mins
      into c from tally_check_days d where d.book_id = b.book_id and d.source = 'held' and d.queued_at > now() - interval '2 days';
    rn := tally_held_renumber_of(b.book_id);
    if h.n = 0 and c.total = 0 and jsonb_array_length(rn) = 0 and coalesce(fn, 0) = 0 then continue; end if;     -- 196
    select * into run from tally_check_runs where book_id = b.book_id;
    rate := case when c.mins >= 2 and c.done_n > 0 then c.done_n / c.mins end;
    eta := case when c.waiting > 0 and rate > 0 then greatest(1, round(c.waiting / rate))::int end;
    st := case when run.book_id is not null and run.state = 'stopped' and c.waiting > 0 then 'stopped' when not fo and c.waiting > 0 then 'off'
               when c.total = 0 then 'none' when c.waiting = 0 then 'done' when c.done_n + c.upload > 0 then 'checking' else 'queued' end;
    ren := '[]'::jsonb;
    for a in select jsonb_array_elements(rn) loop
      ad := least(today, ((a->>'at')::timestamptz at time zone 'Asia/Kolkata')::date);
      select not exists (select 1 from generate_series((a->>'from')::date, ad, interval '1 day') d
                          where not exists (select 1 from tally_check_days x where x.book_id = b.book_id and x.day = d::date and x.done_at is not null and x.via = 'day' and x.listed_at > (a->>'at')::timestamptz)
                            and not exists (select 1 from tally_days t where t.book_id = b.book_id and t.day = d::date and t.at > (a->>'at')::timestamptz)) into ok;
      ren := ren || jsonb_build_array(jsonb_build_object('from', to_char((a->>'from')::date, 'YYYYMMDD'), 'at', a->>'at', 'n', a->'n', 'more', a->'more', 'checked', ok));
    end loop;
    out := out || jsonb_build_array(jsonb_build_object('book', b.book_id, 'client', b.client_id, 'company', b.company,
      'held', h.n, 'deletes', h.dels, 'entries', h.ents, 'from', to_char(h.d0, 'YYYYMMDD'), 'to', to_char(h.d1, 'YYYYMMDD'), 'days', h.days,
      'check', jsonb_build_object('total', c.total, 'done', c.done_n, 'waiting', c.waiting, 'upload', c.upload, 'etaMin', eta, 'state', st,
                                  'words', case when st = 'stopped' then run.stop_words end,
                                  'why', case when st = 'off' then case when fany then 'offline' else 'switch' end end),
      'fetchOn', fo, 'renumber', ren, 'fetching', coalesce(fn, 0)));     -- 196
  end loop;
  return jsonb_build_object('ok', true, 'books', out);
end $function$;

create or replace function public.tally_held_line_ours(p_event text, p_guid text, p_day date, p_why text) returns boolean
language sql immutable set search_path = public, pg_temp as $function$
  select p_day is not null and coalesce(p_why, '') not like 'month locked%' and coalesce(p_why, '') not like 'FinCom id %'
     and ((p_event in ('deleted', 'cancelled') and (p_guid is null or p_guid ~ '-0{8}$'))
       or (p_event in ('created', 'altered', 'imported') and p_guid is not null and p_guid !~ '-0{8}$') or (p_event in ('created', 'altered', 'imported') and (p_guid is null or p_guid ~ '-0{8}$')))     -- 196
$function$;

create or replace function public.tally_recorder_line(p_book uuid, p_device uuid, p_line jsonb, p_row bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; rid bigint := p_row; ev text := left(btrim(coalesce(p_line->>'event', '')), 40);
  og text := nullif(left(btrim(coalesce(p_line->>'object_guid', '')), 100), '');
  alt bigint := case when coalesce(p_line->>'alter_id', '') ~ '^[0-9]{1,15}$' then (p_line->>'alter_id')::bigint end;     -- below 10^15 (review L9)
  vd date := tally_d8(replace(coalesce(p_line->>'vch_date', ''), '-', ''));
  sa timestamptz; pl jsonb; pltxt text; bd jsonb; stt text; wy text; t text; res jsonb; vs jsonb; lk date;
  c_found boolean := false; c_alter bigint; c_day date; c_del timestamptz; c_fid text;
  frm text; dst text; l_name text; l_del timestamptz; l_alt bigint;
  -- 45: the FinCom id of a short line (fid, else "TDSDesk:<id>" in the narration it carries) and its posting
  lf text := coalesce(case when coalesce(p_line->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then p_line->>'fid' end,
                      substring(coalesce(p_line->>'narration', '') from 'TDSDesk:([A-Za-z0-9._-]{1,80})'));
  is_short boolean; m_job uuid; m_fid text; m_guid text; m_done boolean := false; sh_changed boolean := false;
  vno text := nullif(left(btrim(coalesce(p_line->>'vch_no', '')), 60), ''); mid text := nullif(left(btrim(coalesce(p_line->>'master_id', '')), 40), '');
  -- 48: inside tally_recorder_apply (fincom.day_rebuild_once on) an entry's days are not rebuilt here but returned in 'touched'
  once boolean := coalesce(current_setting('fincom.day_rebuild_once', true), '') = 'on'; tch jsonb;
  -- 50: the add-on's placeholder GUID ("<company GUID>-00000000": written before Tally saved the entry) is no entry's GUID;
  -- the line's entry by its MasterID, or its type, number and date under its company; a held line run again: its row's time
  ph boolean := coalesce(og ~ '-0{8}$', false); lt text := nullif(left(btrim(coalesce(p_line->>'vch_type', '')), 60), ''); lno text := vno;
  lcg text := nullif(left(btrim(coalesce(p_line->>'company_guid', '')), 100), ''); r_at timestamptz := now(); dt text; d_hit text; d_alt bigint; d_day date;
  nfit int; pref text; dg text; del_alt bigint; del_ev text; hd record; res2 jsonb; d_at timestamptz; d_n int; d_live int; twin bigint;
  known constant text[] := array['created', 'altered', 'deleted', 'cancelled', 'imported', 'ledger_created', 'ledger_altered', 'ledger_renamed', 'ledger_deleted'];
  -- 51: FinCom Bridge 2.2.2's idsMismatch / lineGuid / heldWhy (the line's own fields; a held line run again: its stored payload's)
  rp jsonb; r_why text; mm boolean := false; hb boolean := false; hw text; lg text; mdv bigint;
  -- 52: the entry the line names (type, number, date) against the copy's entry at its GUID (cx_*) and the entry sent with it (b_*);
  -- the entry an applied line brought (a_*)
  lw text; cx_found boolean := false; cx_t text; cx_n text; cx_d date; bv jsonb; b_t text; b_n text; b_d date; dif_c boolean := false; dif_b boolean := false;
  a_t text; a_n text; a_d date; cx_a bigint; sh boolean := false;
  -- 53: the book's starting point; the one live entry of the line's type, number and date (s_*); a FinCom id on the line or its row
  sp bigint; s_n int; s_g text; s_a bigint; s_t text; s_no text; s_d date; fc boolean;
  -- 53 (review M1): an altered line: the highest AlterID of the book's lines settled before it came
  s_m bigint;
  -- 60 (migration-50 review R3-L2): a create late after a cancel applied above it: applied, then cancelled again
  then_cancel boolean := false; res3 jsonb;
  -- 63: a repeat of a line this computer sent before (the same line id, and the same "again" marker when the bridge sends one)
  lid text := nullif(left(coalesce(p_line->>'line_id', ''), 80), ''); ag text := case when p_line ? 'again' then left(coalesce(p_line->>'again', ''), 20) end;     -- 63
  rp_id bigint; rp_st text;     -- 63
  -- 67 (next-renumber): Tally renumbered the entry (an insert or delete before it, the voucher type renumbering): its body under
  -- the same AlterID with another number than the copy's
  renum boolean := false;     -- 67
  -- 196 (next-fix-no-held): the line named another entry than Tally's entry sent under its GUID (nb); the bridge proved the
  -- line's MasterID is not this entry's (pv: Tally's voucher with it was not saved after the line, or is an older entry)
  nb boolean := false; pv boolean := false;     -- 196
  -- 196: a candidate's answer ("<held line id>.p<round>c<k>:resolved", tally_recorder_probe_take): the held line it was asked for
  -- (o_*), and whether Tally's entry is that line's (type, number and date all the same, the GUID its company's with a MasterID 1 to 5
  -- above the held line's)
  cand boolean := false; cand_ok boolean := false; o_id bigint; o_t text; o_n text; o_d date; o_cg text; o_mid bigint;     -- 196
  -- 196: a filed (locked) month the entry is applied in anyway (filed); a FinCom id line taken as a plain Tally entry (plain)
  filed date; plain boolean := false;     -- 196
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then raise exception 'no such book'; end if;
  -- 63 (next-outbox): a line FinCom has already, sent again by the same computer (its answer lost, the bridge restarted): the
  -- same book, computer and line id, and the same "again" marker when the line carries one (a bridge after 2.3.1 marks its
  -- deliberate resends "items" / "ledger"; a line without the key is an older bridge's). Never stored or applied twice:
  -- answered 'duplicate' with already: true and the first arrival's state (was), so the bridge marks it sent. Not a repeat:
  -- a row ended 'failed' (sent again on purpose, e.g. after a failed queued send); and, for a bridge that does not mark (no
  -- "again" key), a ":resolved" line whose last row is 'held' (2.3.1 sends it once more on purpose: FinCom held it waiting
  -- for a ledger, or its body was incomplete). A held row run again (p_row) is never a repeat
  if rid is null and lid is not null then     -- 63
    select r.id, r.state into rp_id, rp_st from tally_recorder_lines r     -- 63
     where r.book_id = p_book and r.line_id = lid and r.device_id is not distinct from p_device and r.state <> 'failed'     -- 63
       and (ag is null or coalesce(left(r.payload->>'again', 20), '') = ag)     -- 63
     order by r.id desc limit 1;     -- 63
    if rp_id is not null and not (ag is null and lid like '%:resolved' and rp_st in ('held', 'fetching')) then     -- 63     -- 196
      return jsonb_build_object('id', rp_id, 'line_id', lid, 'state', 'duplicate', 'already', true, 'was', rp_st,     -- 63
        'why', format('already have this line (row %s, %s): the same line sent again, not stored or applied again', rp_id, rp_st));     -- 63
    end if;     -- 63
  end if;     -- 63
  -- 50: a held line run again (an owner's release, a Day Book day stored): its own type, company, MasterID and arrival time
  if rid is not null then
    select coalesce(lt, r.vch_type), coalesce(lcg, r.company_guid), r.received_at, coalesce(mid, nullif(r.master_id, '')), r.payload, r.held_why
      into lt, lcg, r_at, mid, rp, r_why from tally_recorder_lines r where r.id = rid;     -- 51: its payload and words too
  end if;
  -- 51: the bridge's plain reason for a line without the entry's body, and the add-on's GUID (words only, never looked up)
  hw := nullif(left(btrim(coalesce(p_line->>'heldWhy', p_line->'payload'->>'heldWhy', rp->>'heldWhy', '')), 300), '');
  lg := nullif(left(btrim(coalesce(p_line->>'lineGuid', p_line->'payload'->>'lineGuid', rp->>'lineGuid', '')), 100), '');
  pv := coalesce(hw, '') ~ '(was not saved after this line|an older entry, not this save)' or coalesce(r_why, '') ~ '(was not saved after this line|an older entry, not this save)';     -- 196
  -- 51: the line carries its entry (Tally's own, under the line's GUID)
  hb := og is not null and not ph and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where x->>'guid' = og);
  -- 51: the ids did not belong together: the bridge says so (idsMismatch), or a line without a body whose GUID is not the GUID its
  -- MasterID makes (its last 8 hex digits are not the MasterID in hex; an older bridge's line, or a row 51 held again). Review M:
  -- inferred only for a GUID under the line's own company GUID: an entry from Tally sync or an XML import keeps another
  -- company's prefix and that company's MasterID, a genuine Tally GUID
  mdv := case when coalesce(mid, '') ~ '^[0-9]{1,10}$' then mid::bigint else 0 end;
  mm := ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') and coalesce(
          'true' in (lower(coalesce(p_line->>'idsMismatch', '')), lower(coalesce(p_line->'payload'->>'idsMismatch', '')), lower(coalesce(rp->>'idsMismatch', '')))
          or (ev in ('created', 'altered', 'imported') and not hb and not ph and og ~ '-[0-9A-Fa-f]{8}$' and mdv between 1 and 4294967295
              and lcg is not null and lower(left(og, length(lcg) + 1)) = lower(lcg) || '-'
              and lower(right(og, 8)) <> lpad(to_hex(mdv), 8, '0')), false);
  -- 52: a line is never 'duplicate' of, applied as an alteration of, deleted / cancelled against, or replaced by an entry whose
  -- type, date or number (each only when both have one) differ from the line's: the add-on's pre line of an entry made by
  -- duplicating another carries the source's GUID, MasterID and AlterID, all consistent with each other
  lw := concat_ws(' ', lt, lno, 'of ' || to_char(vd, 'DD-Mon-YYYY'));
  if og is not null and not ph and ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') then
    select true, nullif(btrim(v.vtype), ''), nullif(left(btrim(v.vno), 60), ''), v.day, coalesce(v.alter_id, 0) into cx_found, cx_t, cx_n, cx_d, cx_a from tally_vouchers v where v.book_id = p_book and v.guid = og;
    cx_found := coalesce(cx_found, false);
    -- the decision on 52: a line WITH a body (Tally's entry under the line's own GUID, naming what the line names) is the
    -- alteration of that GUID, whatever date or number the copy had; only a line without one is checked against the copy.
    -- Review of 52 (M1, M2, M3): only when the copy is not newer than the line (a late old line is 'stale' as in 51; an
    -- intermediate change is replaced by the later one); a delete / cancel only when its AlterID is not above the copy's (one
    -- above carries the entry's newer number / date: applied as in 51). L1: types in any case; L2: numbers cut as stored (60)
    dif_c := cx_found and not hb
             and case when ev in ('deleted', 'cancelled') then alt is null or alt <= cx_a else alt is null or alt >= cx_a end
             and ((lt is not null and cx_t is not null and lower(lt) <> lower(cx_t)) or (vd is not null and cx_d is not null and vd <> cx_d) or (lno is not null and cx_n is not null and lno <> cx_n));
  end if;
  if hb then
    select x into bv from jsonb_array_elements(p_line->'vouchers') x where x->>'guid' = og limit 1;
    b_t := nullif(btrim(coalesce(bv->>'type', '')), ''); b_n := nullif(left(btrim(coalesce(bv->>'no', '')), 60), ''); b_d := tally_d8(replace(coalesce(bv->>'day', ''), '-', ''));
    -- review of 52 (H): a FinCom short line's body is built from the posting, with the POSTED number, while Tally numbers the
    -- entry itself: its number is not compared (type and date are)
    sh := coalesce(lf, nullif(rp->>'fid', '')) is not null and 'true' in (lower(coalesce(p_line->>'short', '')), lower(coalesce(rp->>'short', '')));
    dif_b := (lt is not null and b_t is not null and lower(lt) <> lower(b_t)) or (vd is not null and b_d is not null and vd <> b_d) or (not sh and lno is not null and b_n is not null and lno <> b_n);
    -- 196: Tally's own entry under the line's own GUID (the ids together, not built by FinCom from a posting) is the truth for
    -- that GUID, whatever the line names: applied by the rules below (not older than the copy's AlterID), never held
    if dif_b and not mm and not sh then nb := true; dif_b := false; end if;     -- 196
  end if;
  -- 67: an altered line WITH Tally's entry at the AlterID the copy holds, numbered otherwise than the copy: Tally renumbered it
  -- (no AlterID moves for that: tally-versions P9r, runs 37734533866 and 37754251128). Never 'duplicate': applied, the copy
  -- taking Tally's number
  renum := ev = 'altered' and hb and not mm and coalesce(cx_found, false) and alt is not null and alt = cx_a and b_n is not null and cx_n is not null and b_n <> cx_n;     -- 67
  -- 196: Tally's entry at the AlterID the copy holds that differs from the copy in number, date or type, for a created or
  -- imported line too: the copy takes Tally's entry (the same row, by its GUID)
  renum := renum or (ev in ('created', 'altered', 'imported') and hb and not mm and not sh and coalesce(cx_found, false) and alt is not null and alt = cx_a     -- 196
            and ((b_n is not null and cx_n is not null and b_n <> cx_n) or (b_d is not null and cx_d is not null and b_d <> cx_d) or (b_t is not null and cx_t is not null and lower(b_t) <> lower(cx_t))));     -- 196
  cand := coalesce(lid, '') ~ '\.p[1-3]c[1-5]:resolved$';     -- 196
  if cand then     -- 196
    select o.id, nullif(btrim(o.vch_type), ''), nullif(left(btrim(o.vch_no), 60), ''), o.vch_date, nullif(o.company_guid, ''),     -- 196
           case when coalesce(o.master_id, '') ~ '^[0-9]{1,10}$' then o.master_id::bigint end     -- 196
      into o_id, o_t, o_n, o_d, o_cg, o_mid from tally_recorder_lines o     -- 196
     where o.book_id = p_book and o.line_id = regexp_replace(lid, '\.p[1-3]c[1-5]:resolved$', '') and o.event in ('created', 'altered', 'imported') order by o.id desc limit 1;     -- 196
    cand_ok := hb and not mm and o_id is not null and o_t is not null and o_n is not null and o_d is not null and o_cg is not null and o_mid is not null     -- 196
               and b_t is not null and lower(btrim(b_t)) = lower(o_t) and b_n is not null and b_n = o_n and b_d is not null and b_d = o_d     -- 196
               and lower(left(og, length(o_cg) + 1)) = lower(o_cg) || '-' and right(og, 8) ~ '^[0-9A-Fa-f]{8}$'     -- 196
               and ('x' || lpad(right(og, 8), 16, '0'))::bit(64)::bigint - o_mid between 1 and 5;     -- 196
  end if;     -- 196
  -- 50 (review M1): the company's GUID prefix (the placeholder's, else the line's company GUID; never guessed) and, for a line
  -- without its entry's real GUID, the GUID its MasterID makes: "<company GUID>-<MasterID in 8 hex digits>"
  pref := coalesce(substring(og from '^(.+)-0{8}$'), nullif(lcg, ''));
  dg := case when (og is null or ph) and pref is not null and (case when coalesce(mid, '') ~ '^[0-9]{1,10}$' then mid::bigint else 0 end) between 1 and 4294967295
             then pref || '-' || lpad(to_hex(mid::bigint), 8, '0') end;
  -- a short line: FinCom's own entry, its FinCom id and no body of its own (tally-ingest marks it short when it built the body
  -- from the posting)
  is_short := lf is not null and (coalesce(p_line->>'short', '') = 'true' or jsonb_typeof(p_line->'vouchers') is distinct from 'array' or jsonb_array_length(p_line->'vouchers') = 0);
  if rid is null then
    begin sa := (p_line->>'saved_at')::timestamptz; exception when others then sa := null; end;
    pl := coalesce(p_line->'payload', p_line - 'vouchers' - 'lines'); pltxt := pl::text;
    if length(pltxt) > 8000 then pl := jsonb_build_object('cut', true, 'bytes', length(pltxt), 'head', left(pltxt, 8000), 'again', pl->'again'); end if;     -- 63: the marker kept on a cut payload
    -- the body: the line's own voucher (its GUID) and that voucher's lines alone, never the rest of the add-on's XML (review L1)
    bd := jsonb_strip_nulls(jsonb_build_object(
            'vouchers', (select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where og is not null and x->>'guid' = og),
            'lines', (select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(p_line->'lines') = 'array' then p_line->'lines' else '[]'::jsonb end) x where og is not null and x->>0 = og),
            'name', left(p_line->>'name', 300), 'from', left(p_line->>'from', 300), 'to', left(p_line->>'to', 300)));
    insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, tally_user, company_guid, company, line_id, event, object_guid, master_id, alter_id,
                                      vch_type, vch_no, vch_date, saved_at, state, ledgers, payload, body, save_ms)
    values (b.firm_id, b.client_id, p_book, p_device, left(p_line->>'bridge', 80), left(p_line->>'pc', 60), left(p_line->>'user', 60), left(p_line->>'company_guid', 100), left(p_line->>'company', 200),
            left(p_line->>'line_id', 80), ev, og, left(p_line->>'master_id', 40), alt, left(p_line->>'vch_type', 60), left(p_line->>'vch_no', 60), vd, sa, 'received',
            case when jsonb_typeof(p_line->'ledgers') = 'array' then (select jsonb_agg(e) from (select e from jsonb_array_elements(p_line->'ledgers') e limit 50) s) end,
            pl, bd, case when coalesce(p_line->>'save_ms', '') ~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then (p_line->>'save_ms')::numeric end)
    returning id into rid;
  end if;
  perform set_config('fincom.lock_pass', 'on', true);     -- 196: the owner's decision: a filed month never holds a line (an alert says so)
  begin
    if not (ev = any(known)) then
      stt := 'failed'; wy := 'unknown event: ' || ev;
    elsif cand and not cand_ok then     -- 196: never applied: Tally's answer for that MasterID is not the held line's entry (or came without it)
      stt := 'stale'; wy := format('a candidate asked for held line %s: %s; not applied (the held line stays as it is)', coalesce(o_id::text, 'unknown'),     -- 196
        case when not hb then coalesce('ended without Tally''s entry: ' || hw, 'came without Tally''s entry')     -- 196
             else format('Tally''s entry under GUID %s is %s, not %s', og, concat_ws(' ', b_t, b_n, 'of ' || to_char(b_d, 'DD-Mon-YYYY')), concat_ws(' ', o_t, o_n, 'of ' || to_char(o_d, 'DD-Mon-YYYY'))) end);     -- 196
    elsif mm and not hb then
      -- 51: the ids did not belong together and the line has no entry of Tally's: never looked up by its GUID, MasterID, or type,
      -- number and date (each could name another entry); held, in the bridge's words when it gave them. A row 51 held again
      -- keeps its own words
      stt := 'held'; wy := coalesce(case when r_why like 'marked duplicate on %' then r_why end, hw,
        format('the add-on''s ids did not belong together (GUID %s is another entry''s); held until FinCom Bridge 2.2.2 sends the entry as Tally gives it', coalesce(lg, og, 'unknown')));
    elsif ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') and (dif_c or dif_b) then
      -- 52: the GUID is another entry's (in the copy, or in the body sent): held, never looked up further; the bridge's words after
      stt := 'held';
      wy := format('the add-on named entry %s, but GUID %s is %s %s; held until FinCom Bridge sends this entry as Tally gives it', lw, og,
                   case when dif_c then concat_ws(' ', cx_t, cx_n, 'of ' || to_char(cx_d, 'DD-Mon-YYYY')) else concat_ws(' ', b_t, b_n, 'of ' || to_char(b_d, 'DD-Mon-YYYY')) end,
                   case when dif_c then 'in the copy' else 'in the entry sent with the line' end) || coalesce('; ' || hw, '');
    -- 196: a delete / cancel without the entry's GUID that NOTHING in FinCom's copy can be: the GUID its MasterID makes is not a live
    -- entry, and no live entry of its type on its date has its number (an unnumbered line: no live entry of its type that day at
    -- all). Nothing to delete: applied, no row changed. Anything that could be it keeps the line held (never deleted on a guess)
    elsif ev in ('deleted', 'cancelled') and (og is null or ph) and not mm and dg is not null and vd is not null and lt is not null     -- 196
          and not exists (select 1 from tally_vouchers v where v.book_id = p_book and lower(v.guid) = lower(dg) and v.deleted_at is null)     -- 196
          and not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.day = vd and lower(btrim(v.vtype)) = lower(lt) and v.deleted_at is null     -- 196
                           and (lno is null or left(btrim(v.vno), 60) = lno)) then     -- 196
      stt := 'applied'; wy := format('nothing to %s: FinCom''s copy holds no entry this line could be (no live GUID %s, no live %s on %s)', case when ev = 'deleted' then 'delete' else 'cancel' end,     -- 196
                                     dg, concat_ws(' ', lt, lno), to_char(vd, 'DD-Mon-YYYY'));     -- 196
    elsif ph and ev in ('deleted', 'cancelled') then
      -- 60 (migration-50 review R3-L1): a delete / cancel under the add-on's placeholder GUID names no entry: held as a GUID-less
      -- one is (before 60 it went on to tally_ingest_delete as an entry not in the copy - since 57 "nothing to remove", applied -
      -- and a second arrival, never the same change by the placeholder, broke the line's call on applied_once)
      stt := 'held'; wy := format('no entry GUID on the line (only the add-on''s placeholder): FinCom cannot tell which entry was %s, so this line is never applied by itself; %s', ev,
                                  case when vd is null then 'no date on the line either: it stays held, and nothing in FinCom''s books changes for it' else format('uploading the Day Book for %s brings that day up to date', to_char(vd, 'DD-Mon-YYYY')) end);
    -- 196: a ledger line without a GUID whose ledger the list holds (live, the same name): the copy has it, no row added
    elsif og is null and ev in ('ledger_created', 'ledger_altered') and nullif(left(btrim(coalesce(p_line->>'name', '')), 300), '') is not null     -- 196
          and exists (select 1 from tally_ledgers l where l.book_id = p_book and l.name = left(btrim(p_line->>'name'), 300) and l.deleted_at is null) then     -- 196
      stt := 'duplicate'; wy := format('the ledger list holds %s already (a ledger line without a GUID adds no row)', left(btrim(p_line->>'name'), 300));     -- 196
    elsif og is null and ev <> 'ledger_renamed' then
      -- 50: what releases it, in words (a later line with the entry's GUID replaces it; a Day Book holding it makes it a duplicate)
      stt := 'held'; wy := case when ev in ('created', 'altered', 'imported') then coalesce(hw, 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book')     -- 51: the bridge's words when given
                                when ev in ('deleted', 'cancelled') then format('no entry GUID on the line: FinCom cannot tell which entry was %s, so this line is never applied by itself; %s', ev, case when vd is null then 'no date on the line either: it stays held, and nothing in FinCom''s books changes for it' else format('uploading the Day Book for %s brings that day up to date', to_char(vd, 'DD-Mon-YYYY')) end)     -- 60 (R3-L3 i): no date, no Day Book promised
                                else 'no GUID on the line: held, never a new row' end;
    end if;
    -- the same change already here: another arrival applied or held (owner items 26, 102)
    if stt is null and og is not null and not ph and not mm then     -- 50: the placeholder GUID is no entry's: never the same change by it; 51: nor a line whose ids did not belong together
      select 'line ' || r.id || ' (' || r.state || coalesce(', from ' || nullif(r.pc, ''), '') || ')' into t from tally_recorder_lines r
       where r.book_id = p_book and r.object_guid = og and r.alter_id is not distinct from alt and r.event = ev and r.id <> rid
         -- a held arrival is the original only when a release can apply it (review M1): an entry line with its body, a
         -- delete / cancel held for a locked month; a held line without a body never swallows the same change sent with one
         and (r.state = 'applied' or (r.state in ('held', 'fetching') and case when ev in ('created', 'altered', 'imported') then coalesce(r.body ? 'vouchers', false)     -- 196
                                                                when ev in ('deleted', 'cancelled') then coalesce(r.held_why, '') like 'month locked%'
                                                                else true end))
       order by r.id limit 1;
      if t is not null and not renum then stt := 'duplicate'; wy := 'the same change already came as ' || t; end if;     -- 67: not a renumbering
    end if;
    if stt is null and ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') then
      select true, coalesce(v.alter_id, 0), v.day, v.deleted_at into c_found, c_alter, c_day, c_del from tally_vouchers v where v.book_id = p_book and v.guid = og;
      c_found := coalesce(c_found, false);
      if ev in ('deleted', 'cancelled') then
        res := tally_ingest_delete(p_book, og, alt, ev = 'cancelled', 'recorder ' || coalesce(left(p_line->>'pc', 60), ''));
        stt := res->>'state'; wy := res->>'why';
        -- 50: an entry not in the copy: what releases it, by the line's date. Review H1 and round 2 (N1): a COMPLETE Day Book of
        -- that day (tally_days.n, the count the bridge or the upload vouched for, equals the entries the copy holds live for the
        -- day: never a short, unconfirmed empty or capped read) stored AFTER this line came, not holding the entry, proves it gone
        -- from Tally: a delete or a cancel has nothing left to do. An older kept file read again later cannot bring the entry back:
        -- tally_recorder_release_day deletes (cancels) again an entry whose applied delete (cancel) is above its version
        if stt = 'held' and coalesce((res->>'unknown')::boolean, false) then
          dt := coalesce(to_char(vd, 'DD-Mon-YYYY'), 'its date');
          select d.at, d.n, (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = vd and v.deleted_at is null) into d_at, d_n, d_live
            from tally_days d where d.book_id = p_book and d.day = vd and d.at > r_at;
          if d_at is not null and d_n = d_live then
            stt := 'applied'; wy := format('nothing to %s: the Day Book for %s, complete and stored after this change arrived, does not hold the entry', case when ev = 'deleted' then 'delete' else 'cancel' end, dt);
          elsif d_at is not null then
            wy := format('the Day Book for %s stored after this change was not complete (%s of %s entries); the entry is not in FinCom''s copy, and this line is applied by itself once a complete Day Book for that day is uploaded', dt, d_live, d_n);
          else wy := format('the entry is not in FinCom''s copy yet; it is applied by itself once a complete Day Book for %s is uploaded', dt);
          end if;
        end if;
        -- 196: by its GUID: the copy does not hold it, so there is nothing to remove; applied (an entry body of this GUID that comes
        -- later, below this AlterID, is deleted / cancelled again: 57's rule in tally_ingest_entries)
        if stt = 'held' and coalesce((res->>'unknown')::boolean, false) then     -- 196
          stt := 'applied'; wy := format('nothing to %s: FinCom''s copy does not hold GUID %s (a later copy of it is %s again)', case when ev = 'deleted' then 'delete' else 'cancel' end, og,     -- 196
                                         case when ev = 'deleted' then 'deleted' else 'cancelled' end);     -- 196
        end if;     -- 196
      else
        -- the entry's body: the voucher of this GUID alone, dated by the line when it has no date of its own
        select coalesce(jsonb_agg(case when tally_d8(replace(coalesce(x->>'day', ''), '-', '')) is null then x || jsonb_build_object('day', vd) else x end), '[]'::jsonb) into vs
          from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where x->>'guid' = og;
        -- review H2: a short line builds the entry from FinCom's posted XML only when it is FinCom's creation: never for an
        -- 'altered' line, never for an entry the copy holds (a person changed it in Tally after the posting: the posted
        -- content is not Tally's now). Such a line is matched, held, and its AlterID is not received (the gap check shows it)
        -- 196: the FinCom id names no live posting of this firm, or one matched to another Tally entry: the line is a plain Tally
        -- entry, applied by its own GUID with Tally's body (never matched to a posting, never a second entry of one)
        if is_short then     -- 196
          select r.post_job, r.post_guid into m_job, m_guid from tally_post_live_for(b.firm_id, p_book, lf) r;     -- 196
          -- a posting of this firm with that id not accepted yet: the line waits for it (tally_recorder_short_held re-runs it on the
          -- acceptance); none at all, or one matched to another Tally entry: a plain entry. A body FinCom built from its posting's XML
          -- (short) is never taken as Tally's: Tally's own version is asked by the GUID first ('fetching')
          if (m_job is null and not exists (select 1 from tally_post_ids pi where pi.firm_id = b.firm_id and pi.live and pi.released_at is null and (pi.fincom_id = lf or pi.entry_id = lf)))     -- 196
             or (m_guid is not null and m_guid <> og) then     -- 196
            is_short := false; plain := true;     -- 196
            if coalesce(p_line->>'short', rp->>'short', '') = 'true' then vs := '[]'::jsonb; end if;     -- 196
          end if;     -- 196
          m_job := null; m_guid := null;     -- 196
        end if;     -- 196
        sh_changed := is_short and (ev = 'altered' or c_found);
        if sh_changed then vs := '[]'::jsonb; end if;
        if ph then vs := '[]'::jsonb; end if;     -- 50: never an entry under the placeholder GUID
        -- 45: a short line lands on FinCom's posting (the live, accepted one of this firm for this book) or is held
        if is_short then
          select r.post_job, r.post_fid, r.post_guid into m_job, m_fid, m_guid from tally_post_live_for(b.firm_id, p_book, lf) r;
          if m_job is null then
            stt := 'held'; wy := format('FinCom id %s matches no posting of this firm', lf);
          elsif m_guid is not null and m_guid <> og then
            stt := 'held'; wy := format('FinCom id %s is matched to another Tally entry (GUID %s) already: held, never a second entry', lf, m_guid);
          else
            update tally_post_ids p set matched_at = coalesce(p.matched_at, now()),
                   matched_vch = coalesce(vno, nullif(left(btrim(coalesce(vs->0->>'no', '')), 60), ''), p.matched_vch),
                   matched_guid = og, matched_mid = coalesce(mid, p.matched_mid),
                   matched_alter = case when alt is null then p.matched_alter else greatest(coalesce(p.matched_alter, alt), alt) end
             where p.job_id = m_job and p.fincom_id = m_fid;
            m_done := true;
          end if;
        end if;
        -- 50 (review H1; round 2: a cancel too, "nothing to cancel" leaves the entry out of the copy): the highest AlterID at which
        -- a delete or cancel of this GUID was applied
        select r.alter_id, r.event into del_alt, del_ev from tally_recorder_lines r where r.book_id = p_book and r.object_guid = og and r.event in ('deleted', 'cancelled') and r.state = 'applied'
         order by r.alter_id desc nulls last limit 1;
        then_cancel := alt is not null and del_alt > alt and del_ev = 'cancelled';     -- 60 (R3-L2)
        if stt is null then
          lk := tally_month_locked(p_book, array(select tally_d8(replace(coalesce(x->>'day', ''), '-', '')) from jsonb_array_elements(vs) x) || array[c_day, vd]);
          if lk is not null then
            stt := 'held'; wy := format('month locked: %s', to_char(lk, 'YYYY-MM'));
          elsif c_found and alt is not null and alt < c_alter then
            stt := 'stale'; wy := format('AlterID %s is older than the %s held', alt, c_alter);
          -- 50 (review H1): a delete of this entry applied at a higher AlterID (gone from Tally, perhaps never in the copy): an older
          -- line of it, late from another computer, never revives it
          elsif alt is not null and del_alt > alt and not then_cancel then     -- 60 (R3-L2): a delete only; below a cancel, see below
            stt := 'stale'; wy := format('AlterID %s is older than the %s applied at AlterID %s: an older change, not applied', alt, case when del_ev = 'deleted' then 'delete' else 'cancel' end, del_alt);
          elsif c_found and alt is not null and alt = c_alter and c_del is null and not mm and not renum then     -- 51: a line whose ids did not belong together is applied by Tally's entry, never 'duplicate'; 67: nor a renumbered one
            stt := 'duplicate'; wy := format('the copy holds this entry at AlterID %s already (from a Day Book or another line)', alt);
          elsif jsonb_array_length(vs) = 0 then
            stt := 'held'; wy := case when m_done and sh_changed then format('FinCom posting %s matched; changed in Tally after posting: the next full line or Day Book upload applies it', m_fid)
                                      when m_done then format('FinCom posting %s matched; no entry body (its posted XML could not be read): waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book', m_fid)
                                      else 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book' end;     -- 50: what releases it
            -- 51: the bridge's plain reason when it gave one (the release rules stay 50's); review L4: after 50's words of a matched
            -- short line, never instead of them
            if hw is not null then wy := case when m_done then wy || '; ' || hw else hw end; end if;
          else
            res := tally_ingest_entries(p_book, vs, p_line->'lines', not once, true);     -- 56: the recorder keeps what its request does not fetch
            if coalesce((res->>'locked')::boolean, false) then stt := 'held'; wy := res->>'refused';
            else
              stt := 'applied';
              if once then tch := res->'touched'; end if;
              if m_done then wy := format('FinCom posting %s matched', m_fid);
              else
                -- a FinCom posting coming back in a full line: matched by its FinCom id (43's columns, 45's GUID, MasterID, AlterID);
                -- review L4: only the firm's LIVE row of that id whose posting's company is this book's (never an old failed
                -- posting's or another company's row of the same id)
                select v.fincom_id into c_fid from tally_vouchers v where v.book_id = p_book and v.guid = og;
                if c_fid is not null then
                  update tally_post_ids p set matched_at = coalesce(p.matched_at, now()), matched_vch = coalesce(vno, p.matched_vch),
                         matched_guid = coalesce(p.matched_guid, og), matched_mid = coalesce(mid, p.matched_mid),
                         matched_alter = case when alt is null then p.matched_alter else greatest(coalesce(p.matched_alter, alt), alt) end
                   where p.firm_id = b.firm_id and p.fincom_id = c_fid and p.live
                     and exists (select 1 from tally_post_jobs j where j.id = p.job_id and j.firm_id = b.firm_id and j.company = b.company);
                  wy := format('FinCom posting %s matched', c_fid);
                end if;
              end if;
            end if;
          end if;
        end if;
      end if;
    elsif stt is null and ev = 'ledger_renamed' then
      frm := left(btrim(coalesce(p_line->>'from', '')), 300); dst := left(btrim(coalesce(p_line->>'to', '')), 300);
      if dst = '' then stt := 'failed'; wy := 'a rename without the new name';
      elsif coalesce(current_setting('fincom.recorder_release', true), '') ~ '^[0-9]+$' then stt := 'held'; wy := 'a rename is applied by the bridge (tally_ledger_rename), not by a release: the next ledger list makes it';
      else
        begin
          res := tally_ledger_rename(p_book, og, frm, dst);
          if coalesce((res->>'renamed')::boolean, false) or coalesce((res->>'merged')::boolean, false) then stt := 'applied'; wy := res->>'note';
          elsif res->>'note' = 'already named so' then stt := 'applied'; wy := 'already named so';
          else stt := 'held'; wy := coalesce(res->>'note', 'not renamed');
          end if;
          -- round 21 (review M8): the ledger's AlterID seen, so an older ledger_altered never undoes this rename
          if stt = 'applied' and alt is not null and og is not null then
            update tally_ledgers set alter_id = greatest(coalesce(alter_id, 0), alt) where book_id = p_book and tally_guid = og and deleted_at is null;
          end if;
        exception when others then stt := 'held'; wy := left('rename not made: ' || sqlerrm, 300);
        end;
      end if;
    elsif stt is null and ev = 'ledger_altered' and og is not null and left(btrim(coalesce(p_line->>'name', '')), 300) <> ''
          and exists (select 1 from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null and l.name <> left(btrim(p_line->>'name'), 300)) then
      -- 47: a ledger_altered line whose GUID the copy holds (live) under another name is a rename: tally_ledger_rename, as
      -- ledger_renamed. Round 21 (review M8): only with an AlterID above the last one seen for that ledger (an older line
      -- arriving late never undoes a newer rename: 'stale'), and never a merge (a name another ledger holds is left to the
      -- next ledger list); a line without an AlterID is held for the ledger list
      select l.name, l.alter_id into frm, l_alt from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null order by l.name limit 1;
      dst := left(btrim(p_line->>'name'), 300);
      if alt is null then stt := 'held'; wy := 'a ledger change without its AlterID: the next ledger list applies it';
      elsif l_alt is not null and alt <= l_alt then stt := 'stale'; wy := format('ledger AlterID %s is not above the %s seen: an older change, not applied', alt, l_alt);
      elsif exists (select 1 from tally_ledgers l where l.book_id = p_book and l.name = dst) then
        stt := 'held'; wy := format('a ledger named %s is in the copy already: a merge is left to the next ledger list', dst);
      elsif coalesce(current_setting('fincom.recorder_release', true), '') ~ '^[0-9]+$' then stt := 'held'; wy := 'a rename is applied by the bridge (tally_ledger_rename), not by a release: the next ledger list makes it';
      else
        begin
          res := tally_ledger_rename(p_book, og, frm, dst);
          if coalesce((res->>'renamed')::boolean, false) or coalesce((res->>'merged')::boolean, false) then stt := 'applied'; wy := res->>'note';
          elsif res->>'note' = 'already named so' then stt := 'applied'; wy := 'already named so';
          else stt := 'held'; wy := coalesce(res->>'note', 'not renamed');
          end if;
          if stt = 'applied' then
            update tally_ledgers set alter_id = greatest(coalesce(alter_id, 0), alt) where book_id = p_book and tally_guid = og and deleted_at is null;
          end if;
        exception when others then stt := 'held'; wy := left('rename not made: ' || sqlerrm, 300);
        end;
      end if;
    -- 196: the ledger list holds this ledger (its GUID, live) at the line's AlterID ('duplicate') or above it ('stale')
    elsif stt is null and ev in ('ledger_created', 'ledger_altered') and alt is not null     -- 196
          and exists (select 1 from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null and l.alter_id >= alt) then     -- 196
      select max(l.alter_id) into l_alt from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null;     -- 196
      stt := case when l_alt > alt then 'stale' else 'duplicate' end;     -- 196
      wy := format('the ledger list holds this ledger at AlterID %s already (the line''s %s)', l_alt, alt);     -- 196
    elsif stt is null and ev in ('ledger_created', 'ledger_altered') then
      stt := 'held'; wy := 'ledger lines applied by the next ledger list';
    elsif stt is null and ev = 'ledger_deleted' and rid is not null and b.ledgers_at > r_at then     -- 196
      stt := 'held'; wy := 'Tally''s ledger list, read after this line, decides';     -- 196
    elsif stt is null and ev = 'ledger_deleted' then
      select l.name, l.deleted_at into l_name, l_del from tally_ledgers l where l.book_id = p_book and l.tally_guid = og order by (l.deleted_at is null) desc limit 1;
      if l_name is null then stt := 'held'; wy := 'unknown ledger: not in the copy, so nothing to mark deleted; the next ledger list from FinCom Bridge brings the ledgers up to date';
        stt := 'applied'; wy := 'nothing to mark deleted: the ledger is not in FinCom''s ledger list';     -- 196
      elsif l_del is not null then stt := 'applied'; wy := 'already marked deleted';
      else
        perform set_config('fincom.ledger_list', jsonb_build_object('reason', format('deleted in Tally (recorder line %s)', rid),
          'list', jsonb_build_object('source', 'recorder', 'at', now(), 'device', p_device, 'bridge', left(p_line->>'bridge', 80), 'line', rid))::text, true);
        update tally_ledgers set deleted_at = now() where book_id = p_book and name = l_name;
        perform set_config('fincom.ledger_list', '', true);
        if exists (select 1 from tally_ledgers where book_id = p_book and name = l_name and deleted_at is null) then
          select 'kept by the guard: ' || coalesce(tally_ledger_hold_reason(l), 'unknown reason') into wy from tally_ledgers l where l.book_id = p_book and l.name = l_name;
          stt := 'held';
        else stt := 'applied'; end if;
      end if;
    end if;
    -- 50 (review M1): a line without its entry's real GUID whose entry the copy holds now: by the GUID its MasterID makes; with
    -- no MasterID, by type, number and date only when exactly ONE live entry of its company fits (the prefix known: never null =
    -- null). An 'altered' line only when the copy shows the change: an AlterID above the line's, a Day Book of that day stored
    -- after the line came, or a later line of that entry applied
    if stt = 'held' and ev in ('created', 'altered', 'imported') and (og is null or ph) and not mm then     -- 51: never for a line whose ids did not belong together
      if dg is not null then
        select v.guid, coalesce(v.alter_id, 0), v.day, nullif(btrim(v.vtype), ''), nullif(left(btrim(v.vno), 60), '') into d_hit, d_alt, d_day, cx_t, cx_n from tally_vouchers v where v.book_id = p_book and v.guid = dg and v.deleted_at is null;
        -- 52: the entry its MasterID makes is another entry (type, date or number differ): never a duplicate of it
        if d_hit is not null and ((lt is not null and cx_t is not null and lower(lt) <> lower(cx_t)) or (vd is not null and d_day is not null and vd <> d_day) or (lno is not null and cx_n is not null and lno <> cx_n)) then
          wy := format('the add-on named entry %s, but GUID %s is %s in the copy; held until FinCom Bridge sends this entry as Tally gives it', lw, d_hit,
                       concat_ws(' ', cx_t, cx_n, 'of ' || to_char(d_day, 'DD-Mon-YYYY'))) || coalesce('; ' || hw, '');
          d_hit := null;
        end if;
      elsif pref is not null and lt is not null and lno is not null and vd is not null then
        select count(*), min(v.guid) into nfit, d_hit from tally_vouchers v
         where v.book_id = p_book and v.day = vd and v.vtype = lt and v.vno = lno and v.deleted_at is null and v.guid like pref || '-%' and v.guid !~ '-0{8}$';
        if nfit = 1 then select coalesce(v.alter_id, 0), v.day into d_alt, d_day from tally_vouchers v where v.book_id = p_book and v.guid = d_hit;
        else d_hit := null; end if;
      end if;
      if d_hit is not null and (ev <> 'altered' or (coalesce(alt, 0) > 0 and d_alt > alt)
           or exists (select 1 from tally_days d where d.book_id = p_book and d.day = d_day and d.at > r_at and coalesce(d.alter_max, 0) > 0)
           or exists (select 1 from tally_recorder_lines a where a.book_id = p_book and a.object_guid = d_hit and a.state = 'applied' and a.received_at > r_at)) then
        stt := 'duplicate'; wy := format('the copy holds %s %s of %s already (GUID %s, AlterID %s: from a Day Book or a later line)', lt, lno, to_char(d_day, 'DD-Mon-YYYY'), d_hit, d_alt);
      end if;
    end if;
    -- 53: a held entry line WITHOUT a body whose GUID is the placeholder or none, with a type, a number and a date (the owner's
    -- finding of 05-Oct-2026, staging's line 1: an altered line, MasterID 0, AlterID 0, which 50's rule above never takes as the
    -- change): 'duplicate' when the copy holds EXACTLY ONE live entry of the book under its company with the same type (any case,
    -- trimmed), number (trimmed, cut to 60) and date, at an AlterID above the book's starting point (tally_sync_cursor's
    -- last_voucher_alterid, recorded at start_at: the entry was saved after the bridge started recording, so the copy holds that
    -- change). No starting point recorded: never. Never an unnumbered line, a line whose ids did not belong together, a line
    -- carrying a FinCom id (its posting's own rules, 45), or a line whose MasterID makes another GUID than that entry's
    if stt = 'held' and ev in ('created', 'altered', 'imported') and (og is null or ph) and not mm and not hb     -- 53
       and jsonb_array_length(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) = 0     -- 53: no body
       and pref is not null and lt is not null and lno is not null and vd is not null then     -- 53
      fc := coalesce(lf, case when coalesce(rp->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then rp->>'fid' end, substring(coalesce(rp->>'narration', '') from 'TDSDesk:([A-Za-z0-9._-]{1,80})')) is not null;     -- 53
      select c.last_voucher_alterid into sp from tally_sync_cursor c where c.book_id = p_book and c.start_at is not null;     -- 53
      if not fc and sp is not null then     -- 53
        select count(*), min(v.guid) into s_n, s_g from tally_vouchers v     -- 53
         where v.book_id = p_book and v.day = vd and lower(btrim(v.vtype)) = lower(lt) and left(btrim(v.vno), 60) = lno and v.deleted_at is null     -- 53
           and lower(v.guid) like lower(pref) || '-%' and v.guid !~ '-0{8}$';     -- 53
        if s_n = 1 then     -- 53
          select coalesce(v.alter_id, 0), btrim(v.vtype), left(btrim(v.vno), 60), v.day into s_a, s_t, s_no, s_d from tally_vouchers v where v.book_id = p_book and v.guid = s_g;     -- 53
          -- 53 (review M1): an 'altered' line only when the entry is ABOVE the highest AlterID of any line of the book that settled
          -- (applied / duplicate / stale) and came before this one: else the copy may hold an older version of the entry (an
          -- alteration applied with its body, then altered again with the add-on's placeholder line). None such: as for created
          if ev = 'altered' then     -- 53
            select max(z.alter_id) into s_m from tally_recorder_lines z     -- 53
             where z.book_id = p_book and z.state in ('applied', 'duplicate', 'stale') and z.received_at < r_at and z.id <> rid     -- 53
               and z.event in ('created', 'altered', 'deleted', 'cancelled', 'imported') and z.alter_id < 1000000000000000;     -- 53
          end if;     -- 53
          if s_a > sp and (dg is null or lower(dg) = lower(s_g)) and (ev <> 'altered' or s_m is null or s_a > s_m) then     -- 53
            stt := 'duplicate'; wy := format('the copy holds %s %s of %s already (GUID %s, AlterID %s, from a Day Book or another line)', s_t, s_no, to_char(s_d, 'DD-Mon-YYYY'), s_g, s_a);     -- 53
          end if;     -- 53
          -- 196: the bridge proved the line's MasterID is not this entry's (Tally's voucher with it was not saved after the line, or
          -- is an older entry): the add-on's line of a NEW entry carrying the entry before it's ids. Its MasterID's GUID no longer
          -- blocks the match: the ONE live entry of its company with its type, number and date, saved after the starting point, is
          -- that new entry (the copy holds it: no row added). An altered line is a creation here (the bridge's own rule)
          if stt = 'held' and pv and s_a > sp then     -- 196
            stt := 'duplicate'; wy := format('the copy holds %s %s of %s already (GUID %s, AlterID %s); the line carried the MasterID of another entry, which Tally did not save after it', s_t, s_no, to_char(s_d, 'DD-Mon-YYYY'), s_g, s_a);     -- 196
          end if;     -- 196
        end if;     -- 53
      end if;     -- 53
    end if;     -- 53
    if stt = 'applied' and ev in ('created', 'altered', 'imported') and og is not null and not ph then
      -- 52: the entry this line brought
      a_t := coalesce(nullif(btrim(coalesce(vs->0->>'type', '')), ''), lt); a_n := coalesce(nullif(left(btrim(coalesce(vs->0->>'no', '')), 60), ''), lno);
      a_d := coalesce(tally_d8(replace(coalesce(vs->0->>'day', ''), '-', '')), vd);
      -- 50: a line that entered its entry replaces the held lines it stands for: the same GUID at an AlterID not above its own;
      -- the placeholder / no GUID by the GUID its MasterID makes; with no MasterID, the same type, number and date under the same
      -- company GUID (known on both sides) when this entry is the ONE live entry of the company that fits (review M1)
      update tally_recorder_lines r set state = 'replaced', held_why = format('replaced by line %s (the entry''s details arrived)', rid)
       where r.book_id = p_book and r.state in ('held', 'fetching') and r.id <> rid and r.event in ('created', 'altered', 'imported')     -- 196
         -- 51: the line that carries the held line's entry (2.2.2: its line_id + ":resolved")
         and (r.line_id || ':resolved' = p_line->>'line_id'
         -- 51: a held line whose ids did not belong together (the bridge said so, or its stored GUID is not its MasterID's) is
         -- replaced by its ":resolved" line only, never by its GUID, MasterID, or type, number and date
         or (lower(coalesce(r.payload->>'idsMismatch', '')) <> 'true'     -- review L3: in any case
             and not coalesce(r.object_guid ~ '-[0-9A-Fa-f]{8}$' and r.object_guid !~ '-0{8}$'
                              and nullif(r.company_guid, '') is not null and lower(left(r.object_guid, length(r.company_guid) + 1)) = lower(r.company_guid) || '-'     -- review M
                              and (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
                              and lower(right(r.object_guid, 8)) <> lpad(to_hex(case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end), 8, '0'), false)
         -- 52: by GUID or MasterID only a held line naming this same entry (type, date, number where both have one)
         -- review of 52 (M1): except a held intermediate change of this entry (its AlterID above the copy's before this line and
         -- below this line's): the later version replaces it
         and ((not (((nullif(btrim(r.vch_type), '') is not null and a_t is not null and lower(btrim(r.vch_type)) <> lower(a_t)) or (r.vch_date is not null and a_d is not null and r.vch_date <> a_d) or (nullif(btrim(r.vch_no), '') is not null and a_n is not null and left(btrim(r.vch_no), 60) <> a_n)) and not (coalesce(r.alter_id, 0) > coalesce(c_alter, 0) and coalesce(r.alter_id, 0) < coalesce(alt, 0)))
               and ((r.object_guid = og and coalesce(r.alter_id, 0) <= coalesce(alt, 0))
           or ((r.object_guid is null or r.object_guid ~ '-0{8}$')
               and case when (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
                        then coalesce(substring(r.object_guid from '^(.+)-0{8}$'), nullif(r.company_guid, '')) || '-' || lpad(to_hex(r.master_id::bigint), 8, '0') = og
                        else coalesce(substring(r.object_guid from '^(.+)-0{8}$'), nullif(r.company_guid, '')) = substring(og from '^(.+)-[0-9A-Fa-f]{8}$')
                             and r.vch_type = coalesce(lt, vs->0->>'type') and r.vch_no = coalesce(lno, vs->0->>'no')
                             and r.vch_date = coalesce(vd, tally_d8(replace(coalesce(vs->0->>'day', ''), '-', '')))
                             and (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = r.vch_date and v.vtype = r.vch_type and v.vno = r.vch_no
                                    and v.deleted_at is null and v.guid like substring(og from '^(.+)-[0-9A-Fa-f]{8}$') || '-%' and v.guid !~ '-0{8}$') = 1 end)))
           -- 52: a numbered held line whose stored GUID is another entry in the copy (another type, date or number): by its own type,
           -- number and date under the same company, when this entry is the ONE live entry of the company that fits (50's rule)
           or (r.object_guid is not null and r.object_guid !~ '-0{8}$' and r.object_guid <> og and nullif(btrim(r.vch_no), '') is not null
               and lower(btrim(r.vch_type)) = lower(a_t) and left(btrim(r.vch_no), 60) = a_n and r.vch_date = a_d
               and exists (select 1 from tally_vouchers c where c.book_id = p_book and c.guid = r.object_guid
                            and ((nullif(btrim(c.vtype), '') is not null and lower(btrim(c.vtype)) <> lower(btrim(r.vch_type))) or (c.day is not null and c.day <> r.vch_date)
                                 or (nullif(btrim(c.vno), '') is not null and left(btrim(c.vno), 60) <> left(btrim(r.vch_no), 60))))
               and lower(coalesce(nullif(r.company_guid, ''), substring(r.object_guid from '^(.+)-[0-9A-Fa-f]{8}$'))) = lower(substring(og from '^(.+)-[0-9A-Fa-f]{8}$'))
               and (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = a_d and lower(btrim(v.vtype)) = lower(a_t) and left(btrim(v.vno), 60) = a_n
                      and v.deleted_at is null and v.guid like substring(og from '^(.+)-[0-9A-Fa-f]{8}$') || '-%' and v.guid !~ '-0{8}$') = 1)
           -- 52: an unnumbered one (no number to find it by): besides its ":resolved" line, only by the GUID its MasterID makes under its
           -- company, naming this same entry
           or (r.object_guid is not null and r.object_guid !~ '-0{8}$' and nullif(btrim(r.vch_no), '') is null and nullif(r.company_guid, '') is not null
               and (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
               and lower(r.company_guid) || '-' || lpad(to_hex(case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end), 8, '0') = lower(og)
               and not ((nullif(btrim(r.vch_type), '') is not null and a_t is not null and lower(btrim(r.vch_type)) <> lower(a_t)) or (r.vch_date is not null and a_d is not null and r.vch_date <> a_d) or (nullif(btrim(r.vch_no), '') is not null and a_n is not null and left(btrim(r.vch_no), 60) <> a_n))))));
      -- 50 (review H1): the entry is in the copy now: a delete or cancel of it held "not in FinCom's copy yet" at a higher AlterID
      -- (it came first, from another computer) is applied with it, so the entry is never live while Tally has it gone
      for hd in select r.id, r.event, r.alter_id, r.pc from tally_recorder_lines r
                 where r.book_id = p_book and r.state in ('held', 'fetching') and r.object_guid = og and r.event in ('deleted', 'cancelled')     -- 196
                   and r.alter_id > coalesce(alt, 0) and coalesce(r.held_why, '') not like 'month locked%' order by r.alter_id, r.id loop
        res2 := tally_ingest_delete(p_book, og, hd.alter_id, hd.event = 'cancelled', 'recorder ' || coalesce(hd.pc, ''));
        twin := null;
        select a.id into twin from tally_recorder_lines a where a.book_id = p_book and a.object_guid = og and a.alter_id = hd.alter_id and a.event = hd.event and a.state = 'applied' order by a.id limit 1;
        if res2->>'state' = 'applied' and twin is null then
          update tally_recorder_lines set state = 'applied', held_why = format('applied when line %s brought the entry', rid), applied_at = now() where id = hd.id;
          if tally_recorder_ids_together(hd.id) then     -- 53: only a line whose ids belong together raises the AlterID received
          insert into tally_sync_cursor (book_id, firm_id) values (p_book, b.firm_id) on conflict (book_id) do nothing;
          update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), hd.alter_id), recorder_last_at = now(), updated_at = now() where book_id = p_book;
          end if;     -- 53
        elsif res2->>'state' = 'applied' then     -- round 2 (L8): the same change from another computer, applied already
          update tally_recorder_lines set state = 'duplicate', held_why = format('the same change already came as line %s (applied)', twin), body = null where id = hd.id;
        end if;
      end loop;
    end if;
    -- 60 (migration-50 review R3-L2): a create (alter, import) late from another computer below a cancel applied for its GUID
    -- ("nothing to remove" when the cancel came first, 57): the entry is applied, then cancelled again at the cancel's AlterID, as
    -- Tally holds it (cancelled), instead of 'stale' and left out of the copy until its Day Book. 57's entry path re-applies
    -- the cancel itself when the body is stored; this call makes it sure whatever ran before (then "already cancelled")
    if stt = 'applied' and renum then     -- 67
      wy := concat_ws('; ', wy, format('renumbered in Tally: %s %s is %s %s now (the same AlterID %s)', coalesce(cx_t, lt, 'entry'), cx_n, coalesce(b_t, lt, 'entry'), b_n, alt));     -- 67
    end if;     -- 67
    if stt = 'applied' and renum and b_d is distinct from cx_d then     -- 196
      wy := concat_ws('; ', wy, format('dated %s in Tally (%s in the copy before)', to_char(b_d, 'DD-Mon-YYYY'), to_char(cx_d, 'DD-Mon-YYYY')));     -- 196
    end if;     -- 196
    if stt = 'applied' and nb then     -- 196
      wy := concat_ws('; ', wy, format('the add-on named entry %s; Tally''s entry under GUID %s is %s: Tally''s entry applied', lw, og, concat_ws(' ', b_t, b_n, 'of ' || to_char(b_d, 'DD-Mon-YYYY'))));     -- 196
    end if;     -- 196
    if stt = 'applied' and then_cancel then
      res3 := tally_ingest_delete(p_book, og, del_alt, true, 'recorder ' || coalesce(left(p_line->>'pc', 60), ''));
      wy := concat_ws('; ', wy, format('then cancelled, as the cancel applied at AlterID %s says (%s)', del_alt, coalesce(res3->>'state', 'not done')));
    end if;
    -- 51: the line carrying the held line's entry (its line_id + ":resolved") that ends 'duplicate' (the copy holds Tally's entry
    -- already) or, review L1, 'stale' (the copy holds a newer version): the entry is in, so the held line is replaced as by an
    -- applied one
    if stt in ('duplicate', 'stale') and ev in ('created', 'altered', 'imported') and og is not null and not ph and coalesce(p_line->>'line_id', '') like '%:resolved' then
      update tally_recorder_lines r set state = 'replaced', held_why = format('replaced by line %s (the entry''s details arrived)', rid)
       where r.book_id = p_book and r.state in ('held', 'fetching') and r.id <> rid and r.event in ('created', 'altered', 'imported') and r.line_id || ':resolved' = p_line->>'line_id';     -- 196
    end if;
    -- 51 (review L2): a held delete / cancel whose ids did not belong together (no GUID of its own) is never applied by a guess (no
    -- Day Book release: which entry it meant is not known for sure). It is replaced once the same change is applied under Tally's
    -- own GUID: its ":resolved" line, or a delete (cancel) of the GUID its MasterID makes under its company GUID; that line did
    -- the deletion (cancellation) itself
    if stt = 'applied' and ev in ('deleted', 'cancelled') and og is not null and not ph then
      update tally_recorder_lines r set state = 'replaced',
             held_why = format('replaced by line %s (the %s came with the entry''s own GUID)', rid, case when ev = 'deleted' then 'deletion' else 'cancellation' end)
       where r.book_id = p_book and r.state in ('held', 'fetching') and r.id <> rid and r.event = ev     -- 196
         and (r.line_id || ':resolved' = p_line->>'line_id'
              or (lower(coalesce(r.payload->>'idsMismatch', '')) = 'true' and r.object_guid is null and nullif(r.company_guid, '') is not null
                  and (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
                  and lower(r.company_guid) || '-' || lpad(to_hex(case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end), 8, '0') = lower(og)));
    end if;
  exception when others then
    stt := 'failed'; wy := left(sqlerrm, 300);
  end;
  perform set_config('fincom.lock_pass', '', true);     -- 196
  -- 196: Tally renumbered the entry again at the same AlterID: the earlier applied line of that same change (one applied row a
  -- GUID, AlterID and event: applied_once) is replaced by this one, which carries Tally's entry now
  -- 196: a candidate whose entry is now in the copy (applied, or there already) replaces the held line it was asked for
  if cand and cand_ok and stt in ('applied', 'duplicate', 'stale') then     -- 196
    update tally_recorder_lines set state = 'replaced', held_why = format('replaced by line %s (Tally''s entry found under GUID %s, MasterID %s above the line''s)', rid, og,     -- 196
           ('x' || lpad(right(og, 8), 16, '0'))::bit(64)::bigint - o_mid) where id = o_id and state in ('held', 'fetching');     -- 196
  end if;     -- 196
  -- 196: a held line being searched for: what the search did, in plain words (tally_recorder_probe_words)
  if stt = 'held' and rid is not null then wy := concat_ws('; ', wy, tally_recorder_probe_words(rid)); end if;     -- 196
  if stt = 'applied' and plain then wy := concat_ws('; ', wy, format('FinCom id %s names no posting of this firm (or another entry has it): applied as a plain Tally entry', lf)); end if;     -- 196
  if stt = 'applied' and ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') then     -- 196
    filed := tally_month_locked(p_book, array[vd, c_day, a_d]);     -- 196: the lock passed above is reset: the real lock
    if filed is not null then     -- 196
      wy := concat_ws('; ', wy, format('in a filed month (%s): applied, and an alert raised', to_char(filed, 'YYYY-MM')));     -- 196
      insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)     -- 196
      values (b.firm_id, b.client_id, p_book, md5('tally_filed_month:' || p_book || ':' || rid)::uuid, 'summary', (now() at time zone 'Asia/Kolkata')::date,     -- 196
              format('Entry changed in Tally in a filed month: %s %s %s', coalesce(a_t, lt, 'entry'), coalesce(a_n, lno, ''), to_char(coalesce(a_d, vd, c_day), 'DD-Mon-YYYY')),     -- 196
              jsonb_build_object('what', 'filed_month', 'line', rid, 'month', to_char(filed, 'YYYY-MM'), 'guid', og, 'event', ev))     -- 196
      on conflict do nothing;     -- 196
    end if;     -- 196
  end if;     -- 196
  -- 196: every line being fetched has an end. (1) Its date's day check done after the line came (133 / 136: Tally listed that day
  -- whole and FinCom took every entry it lacked, by GUID): FinCom holds that day as Tally has it, so the line is settled by the copy
  if stt = 'held' and rid is not null and vd is not null and ev in ('created', 'altered', 'imported') and not (lf is not null and not plain)     -- 196
     and exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = vd and k.done_at is not null and k.upload_at is null and k.via is not null and k.listed_at > r_at) then     -- 196
    select to_char(max(k.listed_at) at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') into dt from tally_check_days k where k.book_id = p_book and k.day = vd;     -- 196
    if og is not null and not ph then     -- 196
      if exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = og and v.deleted_at is null) then     -- 196
        stt := 'duplicate'; wy := format('FinCom holds this entry as Tally has it (checked %s)', dt);     -- 196
      else stt := 'stale'; wy := format('No such entry in Tally for %s (checked %s)', to_char(vd, 'DD-Mon-YYYY'), dt); end if;     -- 196
    elsif lt is null or lno is null then     -- 196
      stt := 'stale'; wy := format('FinCom holds %s as Tally has it (checked %s); this line named no %s to bring', to_char(vd, 'DD-Mon-YYYY'), dt, case when lt is null then 'voucher type' else 'voucher number' end);     -- 196
    elsif exists (select 1 from tally_vouchers v where v.book_id = p_book and v.day = vd and lower(btrim(v.vtype)) = lower(lt) and left(btrim(v.vno), 60) = lno and v.deleted_at is null) then     -- 196
      stt := 'duplicate'; wy := format('the copy holds %s already (checked against Tally %s)', lw, dt);     -- 196
    else stt := 'stale'; wy := format('No such entry in Tally for %s (checked %s)', to_char(vd, 'DD-Mon-YYYY'), dt);     -- 196
    end if;     -- 196
  end if;     -- 196
  -- (2) a ledger line once Tally's whole ledger list was stored after it (tally_books.ledgers_at): settled to the list's names
  if stt = 'held' and rid is not null and ev in ('ledger_created', 'ledger_altered', 'ledger_renamed', 'ledger_deleted') and b.ledgers_at > r_at then     -- 196
    dt := to_char(b.ledgers_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI');     -- 196
    l_name := null;     -- 196
    if og is not null then select l.name into l_name from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null order by l.name limit 1; end if;     -- 196
    if l_name is null then     -- 196
      select l.name into l_name from tally_ledgers l where l.book_id = p_book and l.deleted_at is null     -- 196
         and l.name in (left(btrim(coalesce(p_line->>'to', '')), 300), left(btrim(coalesce(p_line->>'name', '')), 300)) order by (l.name = left(btrim(coalesce(p_line->>'to', '')), 300)) desc limit 1;     -- 196
    end if;     -- 196
    if ev = 'ledger_deleted' then     -- 196
      if l_name is not null then stt := 'stale'; wy := format('Tally kept the ledger: its ledger list (read %s) still has %s', dt, l_name);     -- 196
      else stt := 'applied'; wy := format('the ledger is gone from Tally''s ledger list (read %s)', dt); end if;     -- 196
    elsif l_name is not null then stt := 'duplicate'; wy := format('settled to Tally''s ledger list (read %s): %s', dt, l_name);     -- 196
    else stt := 'stale'; wy := format('Tally''s ledger list (read %s) has no such ledger (%s)', dt, coalesce(nullif(btrim(coalesce(p_line->>'to', p_line->>'name', '')), ''), og, 'no name'));     -- 196
    end if;     -- 196
  end if;     -- 196
  -- (3) the ceiling: 7 days of tries (from its first re-run; the day check could not run: a date before the books, the company
  -- never opened...)
  if stt = 'held' and rid is not null and exists (select 1 from tally_recorder_tries t where t.line_row = rid and t.first_at < now() - interval '7 days') then     -- 196
    stt := 'stale'; wy := left(format('FinCom could not bring this from Tally in 7 days (%s); closed, nothing in the books changed for it', coalesce(nullif(wy, ''), 'no answer')), 600);     -- 196
  end if;     -- 196
  if stt = 'held' then stt := 'fetching'; end if;     -- 196: never 'held': being fetched, retried by the cloud and the bridge by themselves
  if stt = 'applied' and renum and og is not null then     -- 196
    update tally_recorder_lines r set state = 'replaced', held_why = format('replaced by line %s (Tally renumbered the entry at the same AlterID %s)', rid, alt)     -- 196
     where r.book_id = p_book and r.object_guid = og and r.alter_id is not distinct from alt and r.event = ev and r.state = 'applied' and r.id <> rid;     -- 196
  end if;     -- 196
  update tally_recorder_lines set state = stt, held_why = wy,
         applied_at = case when stt = 'applied' then now() else applied_at end,
         body = case when stt = 'duplicate' then null else body end
   where id = rid and (state is distinct from stt or held_why is distinct from wy);     -- 50 (review M2): a line whose state and words stay is not rewritten
  return jsonb_build_object('id', rid, 'line_id', p_line->>'line_id', 'state', stt, 'why', wy)
      || case when once and stt = 'applied' and jsonb_typeof(tch) = 'array' then jsonb_build_object('touched', tch) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- 196: the cloud's re-run of a book's held and fetching lines
-- Every line of the book still 'held' or 'fetching', the least recently tried first (tally_recorder_tries; never tried: first, then
-- the oldest), at most p_max (1..1000, 200 when null), run through the rules
-- above as an owner's release runs it (tally_recorder_release_held, 54: its stored fields and body), each in a sub-transaction of
-- its own: a run that would end 'failed' is rolled back and the line stays as it was. After it no line is 'held': each ends
-- applied, duplicate, stale, replaced, or 'fetching' (asked again by itself). An applied line whose ids belong together raises the
-- AlterID received for the gap check (as 54). Taken only when no other session holds the book (pg_try_advisory_xact_lock):
-- {busy: true} otherwise, nothing done. Answer: {ok, book, rerun, settled, states: {state: n}}
create or replace function public.tally_recorder_held_rerun(p_book uuid, p_max integer default 200)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_recorder_lines%rowtype; one jsonb; n int := 0; moved int := 0; st jsonb := '{}'::jsonb; k text;
  mx int := least(greatest(coalesce(p_max, 200), 1), 1000);
begin
  if p_book is null then raise exception 'a book is needed'; end if;
  if not pg_try_advisory_xact_lock(hashtext(p_book::text)) then
    return jsonb_build_object('ok', true, 'book', p_book, 'busy', true, 'rerun', 0, 'settled', 0);
  end if;
  for r in select * from tally_recorder_lines l
            where l.book_id = p_book and l.state in ('held', 'fetching')
            order by (select t.tried_at from tally_recorder_tries t where t.line_row = l.id) asc nulls first, l.id limit mx loop
    n := n + 1;
    insert into tally_recorder_tries (line_row, book_id, first_at, tried_at, n) values (r.id, p_book, clock_timestamp(), clock_timestamp(), 1)
    on conflict (line_row) do update set tried_at = clock_timestamp(), n = tally_recorder_tries.n + 1;
    begin
      perform set_config('fincom.recorder_release', r.id::text, true);
      one := tally_recorder_line(r.book_id, r.device_id, jsonb_build_object('line_id', r.line_id, 'event', r.event, 'object_guid', r.object_guid, 'alter_id', r.alter_id,
               'vch_date', r.vch_date, 'vch_no', r.vch_no, 'pc', r.pc, 'bridge', r.bridge, 'name', r.body->>'name', 'from', r.body->>'from', 'to', r.body->>'to') || coalesce(r.body, '{}'::jsonb), r.id);
      perform set_config('fincom.recorder_release', '', true);
      if one->>'state' = 'failed' then raise exception 'held line % would end failed: %', r.id, one->>'why'; end if;
    exception when others then
      perform set_config('fincom.recorder_release', '', true);
      one := jsonb_build_object('state', r.state, 'why', left(sqlerrm, 200));
    end;
    k := coalesce(one->>'state', r.state);
    -- 196: an error kept a line 'held': it is 'fetching' from now (the next re-run asks again), never left 'held'
    if k = 'held' then update tally_recorder_lines set state = 'fetching' where id = r.id and state = 'held'; k := 'fetching'; end if;
    st := st || jsonb_build_object(k, coalesce((st->>k)::int, 0) + 1);
    if k not in ('held', 'fetching') then moved := moved + 1; end if;
    if k = 'applied' and r.alter_id is not null and r.alter_id < 1000000000000000 and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported')
       and tally_recorder_ids_together(r.id) then
      insert into tally_sync_cursor (book_id, firm_id) values (p_book, r.firm_id) on conflict (book_id) do nothing;
      update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), r.alter_id), recorder_last_at = now(), updated_at = now() where book_id = p_book;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'book', p_book, 'rerun', n, 'settled', moved, 'states', st);
end $function$;
revoke all on function public.tally_recorder_held_rerun(uuid, integer) from public, anon, authenticated;
grant execute on function public.tally_recorder_held_rerun(uuid, integer) to service_role;

commit;
