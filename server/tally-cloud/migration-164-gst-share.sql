-- Migration 164 (11-Nov-2026, branch next-gst-share; written, NOT run: the owner reads it and runs it). GST part A, in
-- SHADOW mode: each entry's GST share kept in the cloud, so a month's GSTR-3B 3.1/3.2 (the books' part) and GSTR-1's
-- B2B, B2CL, B2CS, CDNR, EXP, NIL and HSN tables are SQL sums of month totals. Nothing reads them yet: today's engine
-- (server/_shared/gst3b.js, in the browser and in gst-run) stays in charge and nothing on screen changes. gst-run's new
-- actions fill the tables ("share_sweep") and compare them with today's engine month by month ("share_parity").
--
-- An entry's share is worked out by the engine's own text (entryShares in server/_shared/gst3b.js: the entry's row of
-- outward or inward, its registration, month, place of supply, B2C summary rule...), from the book's ledger list as the
-- engine makes it (the "context": FinCom's ledger list with its guesses, the groups, the ledgers' GSTINs, the place of
-- supply typed under GST > What to fix), kept here with the version of what it was made from.
--
--   tally_calc_dirty     one row per book and day an entry, line or bill allocation of was written: changed_at the last
--                        write. Filled by statement-level triggers (AFTER INSERT / UPDATE / DELETE, transition tables,
--                        one insert ... on conflict per statement, both the old and the new day of a row moved) on
--                        tally_vouchers, tally_lines and tally_bills, so every path that writes them marks it: the Day
--                        Book, the live recorder, deletes (158's fast one too), period pulls, day checks, the GST and TDS
--                        field passes and ledger renames (docs/calc-step0.md: only the Day Book moves tally_days, which
--                        is left alone here: 136's triggers and the recorder rely on it). A trigger that fails warns and
--                        never fails the write (as migration 64). RLS on; service role only.
--   calc_seen            what a calculation has seen of a book (calc 'gst-share'): kind 'entry' (key the GUID: the
--                        AlterID, GST AlterID, TDS AlterID, deleted, cancelled and optional it was worked out at; due
--                        when it is to be worked out again), 'day' (key yyyy-mm-dd: the tally_calc_dirty stamp last
--                        seen; a stamp that moved makes every entry of the day due, whatever its AlterID: a ledger
--                        rename keeps the AlterID), 'book' (key 'ctx': the context, its version and engine; 'lease':
--                        the run that holds the book; 'backoff:<what>': a run that could not finish within its time, and
--                        until when it is not tried again). An entry whose share could not be worked out is kept with
--                        status 'error' and its message, and is not picked again until it or its day changes (its month
--                        stays stale meanwhile). RLS on; service role only.
--   gst_share            one row per entry and section (and key): n, taxable, igst, cgst, sgst, cess, qty, with the
--                        entry's month and registration. RLS on; service role only.
--   gst_month            the month totals of gst_share, per registration, section and key, each row with the month's
--                        status: 'fresh' (every entry of the month worked out on what the copy holds now) or 'stale'
--                        (some entry of it changed and is not worked out yet). Section '*' (registration '') is the
--                        month itself: n the entries with a share, kept even when there is none. RLS on; members read
--                        their own firm's rows; written by the service role only.
--   calc_parity          one row per check of a month: today's engine against the sums, every difference to the paisa
--                        (ok null: not checked, notes.skipped says why: over the run's time). RLS on; members read their
--                        own firm's rows; written by the service role only.
--   gst_share_lease(book, run, seconds) / gst_share_unlease(book, run)   one run of share_sweep or share_parity on a book
--                        at a time: taken when free or run out, held for `seconds`; every write of a run (ctx_put, put)
--                        is refused once its lease is lost, so an old run never saves old shares over a newer one's. A
--                        row, not pg_try_advisory_lock: gst-run reaches the database through PostgREST, each call its own
--                        transaction on a pooled connection, so a session lock could neither be held across the run's
--                        calls nor be sure to be let go
--   gst_share_backoff(book, what, why) / gst_share_backoff_clear(book, what)   a run over its time: not tried again for
--                        10 minutes, doubling each time to a day; cleared when one finishes
--   gst_share_ctx_version(book)          the version of what the context is made from (the ledgers, groups and the
--                        work items the ledger list reads); gst-run makes the context again when it moves
--   gst_share_ctx_get(book) / gst_share_ctx_put(book, version, engine, ctx, ledgers, guids, all)   the context kept;
--                        put marks due the entries on the ledgers whose part of the context changed, the entries named
--                        (a place of supply typed) or, with all (a new engine), every entry
--   gst_share_pick(book, limit)          the sweep's pick, under the book's lock: days whose tally_calc_dirty stamp moved
--                        (their entries due), entries whose AlterIDs, deleted, cancelled or optional differ from what was
--                        seen, new entries, entries gone from the copy; their months marked stale; the first `limit` due
--                        GUIDs (at most 5000) with what the copy holds of them now (put keeps that as seen)
--   gst_share_rows(book, guids)          those entries in gst_calc_rows' compact form (migration 153), deleted ones too
--   gst_share_put(book, run, at, shares, seen, errors)   under the book's lock, while the run holds the lease: each
--                        entry's shares deleted and inserted again, what was seen kept (due cleared unless marked again
--                        after the pick at `at`), the entries that failed kept as errors, the months touched (those of
--                        the shares, and the day each entry had and has) summed again (gst_share_month_sum): a month
--                        whose entries have no share is fresh with no rows but its own
--   gst_share_month_sum(book, months)    internal: the months' totals made again from gst_share (no grant)
--   gst_month_get(book, ym)              a month's totals (gst-run's parity); gst_parity_put(...) keeps a check
--   gst_share_books_due(n) / gst_share_books_all(n)   the timer's books: with days written since seen, entries due, or no
--                        context yet (not leased, not backing off; at most n, oldest first) / every book with entries
--   the timer: pg_cron jobs gst-share-sweep (every minute: share_sweep for up to 3 books with something to do) and
--                        gst-share-parity (nightly, 02:47 India time: share_parity of every month for up to 200 books),
--                        calling gst-run with gst-taxpro's timer key (Vault gst_cron_key) at this project's address (Vault
--                        fincom_project_url), as migration 153's gst-run-warm. Made only where pg_cron, pg_net and both
--                        Vault secrets are there; otherwise nothing is scheduled and this says so.
-- The book's lock is the one every entry path takes (pg_advisory_xact_lock(hashtext(book)), migration 44's
-- tally_ingest_entries), so an entry is never summed half-stored. Add-only: five new tables, new functions and the
-- dirty-day triggers (new, on tally_vouchers, tally_lines, tally_bills); nothing of any other migration dropped, deleted
-- or altered; safe to run twice. Needs migration 153 (gst_calc_queue) and the GST and TDS columns of 72 and 73; stops and
-- says so otherwise. A book deleted takes every row of these tables with it (on delete cascade).
-- RUN IT WHILE TALLY SYNC IS QUIET: creating the triggers takes a lock on tally_vouchers, tally_lines and tally_bills
-- that waits for the writes going on; lock_timeout (10 s) rolls the whole file back rather than hold the sync up behind
-- it (then run it again).
-- Tested by tests/run_migration164.py (pg_stand), tests/run_gst_share.js (the parity on made-up books) and
-- tests/run_gst_share_deno.ts (gst-run's actions).

begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regclass('public.gst_calc_queue') is null or to_regclass('public.tally_bills') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_vouchers' and column_name = 'gst_alter_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_vouchers' and column_name = 'tds_tally_alter_id') then
    raise exception 'migration 164 needs migration 153 (gst_calc_queue), tally_bills and the entry columns of 72 and 73 (gst_alter_id, tds_tally_alter_id) first';
  end if;
end $$;

-- ---------------------------------------------------------------- the days written
create table if not exists public.tally_calc_dirty (
  book_id    uuid not null references public.tally_books (book_id) on delete cascade,
  day        date not null,
  changed_at timestamptz not null default now(),
  primary key (book_id, day)
);
create index if not exists tally_calc_dirty_at on public.tally_calc_dirty (changed_at);
alter table public.tally_calc_dirty enable row level security;
revoke all on public.tally_calc_dirty from public, anon, authenticated;
grant select, insert, update, delete on public.tally_calc_dirty to service_role;

-- one function per kind of statement (PL/pgSQL reads only the transition tables its trigger declares); each one insert
-- of the statement's distinct (book, day), the book still there, in (book, day) order (two writers never wait on each
-- other's rows the other way round); a failure warns and the write goes on
create or replace function public.tally_calc_dirty_ins() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  begin
    insert into tally_calc_dirty (book_id, day, changed_at)
    select y.book_id, y.day, clock_timestamp() from (select distinct x.book_id, x.day from new_rows x
     where x.day is not null and exists (select 1 from tally_books b where b.book_id = x.book_id)) y
     order by y.book_id, y.day
    on conflict (book_id, day) do update set changed_at = excluded.changed_at;
  exception when others then raise warning 'tally_calc_dirty (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $function$;
create or replace function public.tally_calc_dirty_del() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  begin
    insert into tally_calc_dirty (book_id, day, changed_at)
    select y.book_id, y.day, clock_timestamp() from (select distinct x.book_id, x.day from old_rows x
     where x.day is not null and exists (select 1 from tally_books b where b.book_id = x.book_id)) y
     order by y.book_id, y.day
    on conflict (book_id, day) do update set changed_at = excluded.changed_at;
  exception when others then raise warning 'tally_calc_dirty (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $function$;
create or replace function public.tally_calc_dirty_upd() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  begin
    insert into tally_calc_dirty (book_id, day, changed_at)
    select y.book_id, y.day, clock_timestamp() from (select distinct x.book_id, x.day from (select n.book_id, n.day from new_rows n union select o.book_id, o.day from old_rows o) x
     where x.day is not null and exists (select 1 from tally_books b where b.book_id = x.book_id)) y
     order by y.book_id, y.day
    on conflict (book_id, day) do update set changed_at = excluded.changed_at;
  exception when others then raise warning 'tally_calc_dirty (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $function$;
revoke all on function public.tally_calc_dirty_ins(), public.tally_calc_dirty_del(), public.tally_calc_dirty_upd() from public, anon, authenticated, service_role;
do $$
declare t text;
begin
  foreach t in array array['tally_vouchers', 'tally_lines', 'tally_bills'] loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = t || '_calc_dirty_ins' and not tgisinternal) then
      execute format('create trigger %I after insert on public.%I referencing new table as new_rows for each statement execute function public.tally_calc_dirty_ins()', t || '_calc_dirty_ins', t);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = t || '_calc_dirty_upd' and not tgisinternal) then
      execute format('create trigger %I after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function public.tally_calc_dirty_upd()', t || '_calc_dirty_upd', t);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = t || '_calc_dirty_del' and not tgisinternal) then
      execute format('create trigger %I after delete on public.%I referencing old table as old_rows for each statement execute function public.tally_calc_dirty_del()', t || '_calc_dirty_del', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- tables
create table if not exists public.calc_seen (
  book_id   uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id   uuid not null,
  calc      text not null,
  kind      text not null check (kind in ('entry', 'day', 'book')),
  key       text not null,
  alter_id  bigint,
  gst_alter_id bigint,
  tds_alter_id bigint,
  deleted   boolean not null default false,
  cancelled boolean not null default false,
  optional  boolean not null default false,
  day       date,
  status    text not null default 'ok' check (status in ('ok', 'error')),
  error     text,
  stamp     text,
  data      jsonb,
  due       boolean not null default false,
  due_at    timestamptz,
  at        timestamptz not null default now(),
  primary key (book_id, calc, kind, key)
);
create index if not exists calc_seen_due on public.calc_seen (book_id, calc, key) where due;

create table if not exists public.gst_share (
  book_id   uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id   uuid not null,
  guid      text not null,
  ym        text not null check (ym ~ '^\d{6}$'),
  reg       text not null default '',
  sec       text not null,
  k1        text not null default '',
  k2        text not null default '',
  k3        text not null default '',
  n         integer not null default 0,
  taxable   numeric(20, 2) not null default 0,
  igst      numeric(20, 2) not null default 0,
  cgst      numeric(20, 2) not null default 0,
  sgst      numeric(20, 2) not null default 0,
  cess      numeric(20, 2) not null default 0,
  qty       numeric(20, 2) not null default 0,
  primary key (book_id, guid, sec, k1, k2, k3)
);
create index if not exists gst_share_month on public.gst_share (book_id, ym);

create table if not exists public.gst_month (
  book_id   uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id   uuid not null,
  ym        text not null check (ym ~ '^\d{6}$'),
  reg       text not null default '',
  sec       text not null,
  k1        text not null default '',
  k2        text not null default '',
  k3        text not null default '',
  n         integer not null default 0,
  taxable   numeric(20, 2) not null default 0,
  igst      numeric(20, 2) not null default 0,
  cgst      numeric(20, 2) not null default 0,
  sgst      numeric(20, 2) not null default 0,
  cess      numeric(20, 2) not null default 0,
  qty       numeric(20, 2) not null default 0,
  status    text not null default 'stale' check (status in ('fresh', 'stale')),
  at        timestamptz not null default now(),
  primary key (book_id, ym, reg, sec, k1, k2, k3)
);

create table if not exists public.calc_parity (
  id        bigserial primary key,
  book_id   uuid not null references public.tally_books (book_id) on delete cascade,
  firm_id   uuid not null,
  calc      text not null,
  ym        text not null,
  reg       text not null default '',
  engine    text not null default '',
  ok        boolean,
  max_diff  numeric(20, 2) not null default 0,
  diffs     jsonb not null default '[]'::jsonb,
  notes     jsonb not null default '{}'::jsonb,
  at        timestamptz not null default now()
);
create index if not exists calc_parity_book on public.calc_parity (book_id, calc, ym, at desc);

alter table public.calc_seen enable row level security;
alter table public.gst_share enable row level security;
alter table public.gst_month enable row level security;
alter table public.calc_parity enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gst_month' and policyname = 'gst_month_read') then
    create policy gst_month_read on public.gst_month for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calc_parity' and policyname = 'calc_parity_read') then
    create policy calc_parity_read on public.calc_parity for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
end $$;
revoke all on public.calc_seen, public.gst_share, public.gst_month, public.calc_parity from public, anon, authenticated;
grant select on public.gst_month, public.calc_parity to authenticated;
grant select, insert, update, delete on public.calc_seen, public.gst_share, public.gst_month, public.calc_parity to service_role;
revoke all on sequence public.calc_parity_id_seq from public, anon, authenticated;
grant usage, select on sequence public.calc_parity_id_seq to service_role;

-- ---------------------------------------------------------------- the context's version
-- what the ledger list, groups and GSTINs the shares read are made from: the book's ledgers (every column, as the
-- cloud copy holds them) and groups, the ledgers' time, and the work items the ledger list and the place of supply read
create or replace function public.gst_share_ctx_version(p_book uuid)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select md5(array_to_string(array['GST_SHARE=164.1', coalesce(b.ledgers_at::text, '~'), coalesce(b.from_date::text, '~'),
           (select array_to_string(array[count(*), sum(hashtext(to_jsonb(l)::text)::bigint)]::text[], ':', '~') from tally_ledgers l where l.book_id = b.book_id),
           (select array_to_string(array[count(*), sum(hashtext(g.name || '~' || coalesce(g.parent, '^'))::bigint)]::text[], ':', '~') from tally_groups g where g.book_id = b.book_id),
           (select array_to_string(array[count(*)::text, max(i.seq)::text, max(i.updated_at)::text,
                     sum(hashtext(i.key || '~' || i.item || '~' || coalesce(i.data::text, '^') || '~' || i.deleted::text)::bigint)::text], ':', '~') from client_book_items i
             where i.firm_id = b.firm_id and i.client_id = b.client_id
               and i.key in ('map', 'gstPosFix', 'gstins', 'groups', 'under', 'ledInfo', 'ledInfoAt', 'gstRegs', 'pans', 'states'))], '|', '~'))
    from tally_books b where b.book_id = p_book;
$function$;

create or replace function public.gst_share_ctx_get(p_book uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  -- (the context kept, if any, and until when a rebuild backs off)
  select jsonb_build_object('stamp', c.stamp, 'engine', c.data->>'engine', 'ctx', c.data->'ctx', 'at', c.at,
           'backoff', (select k.data->>'until' from calc_seen k where k.book_id = p_book and k.calc = 'gst-share' and k.kind = 'book' and k.key = 'backoff:ctx'
                        and (k.data->>'until')::timestamptz > clock_timestamp()))
    from (select 1) one left join calc_seen c on c.book_id = p_book and c.calc = 'gst-share' and c.kind = 'book' and c.key = 'ctx';
$function$;

-- ---------------------------------------------------------------- the months
-- the months' totals made again from gst_share; each month's status fresh unless an entry of it is due (its day now, or
-- the month its shares are in) or failed (status 'error'). Internal: called by gst_share_pick and gst_share_put under the book's lock
create or replace function public.gst_share_month_sum(p_book uuid, p_yms text[])
returns integer language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid; n int;
begin
  select firm_id into f from tally_books where book_id = p_book;
  if f is null or p_yms is null or cardinality(p_yms) = 0 then return 0; end if;
  delete from gst_month m where m.book_id = p_book and m.ym = any(p_yms);
  with stale as (
    select distinct x.ym from (
      select to_char(v.day, 'YYYYMM') ym from calc_seen s join tally_vouchers v on v.book_id = s.book_id and v.guid = s.key
       where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and s.due
      union select g.ym from calc_seen s join gst_share g on g.book_id = s.book_id and g.guid = s.key
       where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and s.due
      union select to_char(s.day, 'YYYYMM') from calc_seen s
       where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and s.status = 'error' and s.day is not null) x where x.ym = any(p_yms)),
  tot as (
    select g.ym, g.reg, g.sec, g.k1, g.k2, g.k3, sum(g.n)::int n, sum(g.taxable) taxable, sum(g.igst) igst, sum(g.cgst) cgst, sum(g.sgst) sgst, sum(g.cess) cess, sum(g.qty) qty
      from gst_share g where g.book_id = p_book and g.ym = any(p_yms) group by g.ym, g.reg, g.sec, g.k1, g.k2, g.k3
    union all
    select y.ym, '', '*', '', '', '', (select count(distinct g.guid)::int from gst_share g where g.book_id = p_book and g.ym = y.ym), 0, 0, 0, 0, 0, 0
      from unnest(p_yms) y(ym) where y.ym ~ '^\d{6}$')
  insert into gst_month (book_id, firm_id, ym, reg, sec, k1, k2, k3, n, taxable, igst, cgst, sgst, cess, qty, status, at)
  select p_book, f, t.ym, t.reg, t.sec, t.k1, t.k2, t.k3, t.n, t.taxable, t.igst, t.cgst, t.sgst, t.cess, t.qty,
         case when t.ym in (select ym from stale) then 'stale' else 'fresh' end, now()
    from tot t;
  get diagnostics n = row_count;
  return n;
end $function$;

-- the months of these entries (their day now, and the months their shares are in) marked stale
create or replace function public.gst_share_stale(p_book uuid, p_guids text[])
returns integer language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid; yms text[]; n int;
begin
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return 0; end if;
  select coalesce(array_agg(distinct x.ym), '{}') into yms from (
    select to_char(v.day, 'YYYYMM') ym from tally_vouchers v where v.book_id = p_book and v.guid = any(p_guids) and v.day is not null
    union select g.ym from gst_share g where g.book_id = p_book and g.guid = any(p_guids)) x;
  update gst_month m set status = 'stale' where m.book_id = p_book and m.ym = any(yms) and m.status <> 'stale';
  insert into gst_month (book_id, firm_id, ym, reg, sec, status)
  select p_book, f, y, '', '*', 'stale' from unnest(yms) y
  on conflict (book_id, ym, reg, sec, k1, k2, k3) do update set status = 'stale';
  get diagnostics n = row_count;
  return n;
end $function$;

-- ---------------------------------------------------------------- one run a book at a time, and backing off
create or replace function public.gst_share_lease(p_book uuid, p_run text, p_secs integer default 120)
returns boolean language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid; got text;
begin
  select firm_id into f from tally_books where book_id = p_book;
  if f is null or coalesce(p_run, '') = '' then return false; end if;
  insert into calc_seen (book_id, firm_id, calc, kind, key, stamp, data, at)
  values (p_book, f, 'gst-share', 'book', 'lease', p_run, jsonb_build_object('until', clock_timestamp() + make_interval(secs => greatest(10, least(coalesce(p_secs, 120), 600)))), now())
  on conflict (book_id, calc, kind, key) do update set stamp = excluded.stamp, data = excluded.data, at = now()
   where calc_seen.stamp = excluded.stamp or (calc_seen.data->>'until')::timestamptz < clock_timestamp()
  returning stamp into got;
  return got is not null and got = p_run;
end $function$;
create or replace function public.gst_share_unlease(p_book uuid, p_run text)
returns boolean language sql volatile security definer set search_path to 'public', 'pg_temp' as $function$
  with d as (delete from calc_seen s where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'lease' and s.stamp = p_run returning 1)
  select exists (select 1 from d);
$function$;
-- internal: the run still holds the book
create or replace function public.gst_share_holds(p_book uuid, p_run text)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select exists (select 1 from calc_seen s where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'lease'
                  and s.stamp = p_run and (s.data->>'until')::timestamptz >= clock_timestamp());
$function$;
-- a run over its time: not tried again for 10 minutes, then 20, 40... at most a day; -> until when
create or replace function public.gst_share_backoff(p_book uuid, p_what text, p_why text)
returns timestamptz language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid; n int; u timestamptz;
begin
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return null; end if;
  select coalesce((s.data->>'n')::int, 0) into n from calc_seen s where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'backoff:' || p_what;
  n := coalesce(n, 0) + 1;
  u := clock_timestamp() + least(interval '1 day', interval '10 minutes' * power(2, least(n - 1, 10)));
  insert into calc_seen (book_id, firm_id, calc, kind, key, stamp, data, at)
  values (p_book, f, 'gst-share', 'book', 'backoff:' || p_what, u::text, jsonb_build_object('until', u, 'n', n, 'why', left(coalesce(p_why, ''), 500)), now())
  on conflict (book_id, calc, kind, key) do update set stamp = excluded.stamp, data = excluded.data, at = now();
  return u;
end $function$;
create or replace function public.gst_share_backoff_clear(p_book uuid, p_what text)
returns void language sql volatile security definer set search_path to 'public', 'pg_temp' as $function$
  delete from calc_seen s where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'backoff:' || p_what;
$function$;

-- ---------------------------------------------------------------- the context kept, and the entries it moves
create or replace function public.gst_share_ctx_put(p_book uuid, p_run text, p_stamp text, p_engine text, p_ctx jsonb, p_ledgers text[], p_guids text[], p_all boolean)
returns jsonb language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid; marked text[];
begin
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  if not gst_share_holds(p_book, p_run) then return jsonb_build_object('ok', false, 'error', 'lease lost'); end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null or coalesce(p_stamp, '') = '' or coalesce(p_engine, '') = '' or jsonb_typeof(p_ctx) is distinct from 'object' then return jsonb_build_object('ok', false); end if;
  insert into calc_seen (book_id, firm_id, calc, kind, key, stamp, data, at)
  values (p_book, f, 'gst-share', 'book', 'ctx', p_stamp, jsonb_build_object('engine', p_engine, 'ctx', p_ctx), now())
  on conflict (book_id, calc, kind, key) do update set firm_id = excluded.firm_id, stamp = excluded.stamp, data = excluded.data, at = now();
  -- the entries the change reaches: on a ledger whose part changed (a line on it, or its party), named, or every one
  with hit as (
    select s.key from calc_seen s where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and coalesce(p_all, false)
    union select l.guid from tally_lines l where l.book_id = p_book and l.ledger = any(coalesce(p_ledgers, '{}'))
    union select v.guid from tally_vouchers v where v.book_id = p_book and v.party = any(coalesce(p_ledgers, '{}'))
    union select g from unnest(coalesce(p_guids, '{}')) g)
  update calc_seen s set due = true, due_at = clock_timestamp()
    from hit where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and s.key = hit.key;
  select coalesce(array_agg(s.key), '{}') into marked from calc_seen s where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and s.due;
  perform gst_share_stale(p_book, marked);
  return jsonb_build_object('ok', true, 'due', cardinality(marked));
end $function$;

-- ---------------------------------------------------------------- the sweep's pick
create or replace function public.gst_share_pick(p_book uuid, p_limit integer default 3000)
returns jsonb language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid; lim int := greatest(1, least(coalesce(p_limit, 3000), 5000)); due_all text[]; pick text[]; nd int; snap jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return jsonb_build_object('ok', false, 'error', 'no such book'); end if;
  -- days written since they were last seen: every entry of them due (whatever its AlterID; one already due has its
  -- due_at moved on, so a put of an earlier pick does not clear it), the stamp kept
  with moved as (
    select d.day, d.changed_at from tally_calc_dirty d
      left join calc_seen s on s.book_id = d.book_id and s.calc = 'gst-share' and s.kind = 'day' and s.key = d.day::text
     where d.book_id = p_book and s.stamp is distinct from d.changed_at::text),
  mark as (
    update calc_seen s set due = true, due_at = clock_timestamp()
      from tally_vouchers v join moved m on m.day = v.day
     where v.book_id = p_book and s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and s.key = v.guid
    returning s.key)
  insert into calc_seen (book_id, firm_id, calc, kind, key, stamp, at)
  select p_book, f, 'gst-share', 'day', m.day::text, m.changed_at::text, now() from moved m
  on conflict (book_id, calc, kind, key) do update set stamp = excluded.stamp, at = now();
  -- new entries; entries whose AlterIDs, deleted, cancelled or optional moved; entries gone from the copy
  insert into calc_seen (book_id, firm_id, calc, kind, key, due, due_at)
  select p_book, f, 'gst-share', 'entry', v.guid, true, clock_timestamp() from tally_vouchers v
   where v.book_id = p_book and not exists (select 1 from calc_seen s where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and s.key = v.guid)
  on conflict (book_id, calc, kind, key) do nothing;
  update calc_seen s set due = true, due_at = clock_timestamp()
    from tally_vouchers v
   where v.book_id = p_book and s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and s.key = v.guid
     and (s.alter_id is distinct from v.alter_id or s.gst_alter_id is distinct from v.gst_alter_id or s.tds_alter_id is distinct from v.tds_tally_alter_id
          or s.deleted is distinct from (v.deleted_at is not null) or s.cancelled is distinct from coalesce(v.cancelled, false) or s.optional is distinct from coalesce(v.optional, false));
  update calc_seen s set due = true, due_at = clock_timestamp()
   where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and not s.due
     and not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = s.key);
  select coalesce(array_agg(s.key order by s.key), '{}') into due_all from calc_seen s where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and s.due;
  nd := cardinality(due_all);
  if nd > 0 then perform gst_share_stale(p_book, due_all); end if;
  pick := due_all[1:lim];
  -- what the copy holds of them now: kept as seen once they are worked out (an entry gone: gone)
  select coalesce(jsonb_agg(jsonb_build_object('guid', g, 'day', v.day, 'alter_id', v.alter_id, 'gst_alter_id', v.gst_alter_id, 'tds_alter_id', v.tds_tally_alter_id,
           'deleted', v.deleted_at is not null, 'cancelled', coalesce(v.cancelled, false), 'optional', coalesce(v.optional, false), 'gone', v.guid is null) order by g), '[]'::jsonb)
    into snap from unnest(pick) g left join tally_vouchers v on v.book_id = p_book and v.guid = g;
  -- at: the end of the pick (every mark it made is before it; a mark after it keeps its entry due through the put)
  return jsonb_build_object('ok', true, 'at', clock_timestamp(), 'guids', to_jsonb(pick), 'seen', snap, 'due', nd, 'more', nd > lim);
end $function$;

-- those entries as gst_calc_rows gives them (heads with their lines and bills inside, the ledgers once); an entry
-- deleted in the copy comes with deleted_at; one gone from the copy is not there
create or replace function public.gst_share_rows(p_book uuid, p_guids text[])
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with vs as (select v.* from tally_vouchers v where v.book_id = p_book and v.guid = any(p_guids)),
  led as (select x.ledger, (row_number() over (order by x.ledger)) - 1 as i
            from (select l.ledger from tally_lines l where l.book_id = p_book and l.guid = any(p_guids)
                  union select b.ledger from tally_bills b where b.book_id = p_book and b.guid = any(p_guids)) x where x.ledger is not null),
  ln as (select l.guid, jsonb_agg(jsonb_build_array(d.i, l.amount, l.hsn, l.rate) order by l.id) a
           from tally_lines l join led d on d.ledger = l.ledger where l.book_id = p_book and l.guid = any(p_guids) group by l.guid),
  bl as (select b.guid, jsonb_agg(jsonb_build_array(d.i, b.name, b.type, b.amount, b.credit_days) order by b.id) a
           from tally_bills b join led d on d.ledger = b.ledger where b.book_id = p_book and b.guid = any(p_guids) group by b.guid)
  select jsonb_build_object(
    'ledgers', (select coalesce(jsonb_agg(led.ledger order by led.i), '[]'::jsonb) from led),
    'heads', (select coalesce(jsonb_agg(jsonb_build_array(v.guid, v.day, v.alter_id, v.vtype, v.vno, v.party, v.narration, v.cancelled, v.optional, v.deleted_at,
                v.gstin, v.pos, v.ref, v.ref_date, v.cmp_gstin, v.irn, v.irn_ack_date, v.gst_reg_type, v.gst_country, v.gst_rcm, v.gst_nature, v.gst_taxability,
                v.gst_supply, v.gst_ineligible, v.gst_mixed, v.gst_alter_id, coalesce(ln.a, '[]'::jsonb), coalesce(bl.a, '[]'::jsonb)) order by v.day, v.guid), '[]'::jsonb)
                from vs v left join ln on ln.guid = v.guid left join bl on bl.guid = v.guid));
$function$;

-- ---------------------------------------------------------------- the sweep's write
-- p_shares [{guid, ym, reg, sec, k1, k2, k3, n, taxable, igst, cgst, sgst, cess, qty}]; p_seen: the pick's seen list
-- for every entry worked out, with or without a share ({guid, day, alter_id, gst_alter_id, tds_alter_id, deleted,
-- cancelled, optional, gone}: as the copy held it at the pick, so a change after it is picked again); p_errors
-- [{guid, error}]: entries of p_seen whose share could not be worked out; p_at: the pick's time (an entry marked due
-- after it stays due); p_run: the run, which must still hold the book's lease
create or replace function public.gst_share_put(p_book uuid, p_run text, p_at timestamptz, p_shares jsonb, p_seen jsonb, p_errors jsonb default '[]'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid; seen text[]; yms text[]; n_ins int; n_m int; errs jsonb := coalesce(p_errors, '[]'::jsonb);
begin
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  if not gst_share_holds(p_book, p_run) then return jsonb_build_object('ok', false, 'error', 'lease lost'); end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return jsonb_build_object('ok', false, 'error', 'no such book'); end if;
  if jsonb_typeof(p_shares) is distinct from 'array' or jsonb_typeof(p_seen) is distinct from 'array' or jsonb_typeof(errs) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'shares, seen and errors are lists');
  end if;
  select coalesce(array_agg(distinct x->>'guid'), '{}') into seen from jsonb_array_elements(p_seen) x where coalesce(x->>'guid', '') <> '';
  if exists (select 1 from jsonb_array_elements(p_shares) x where coalesce(x->>'guid', '') = '' or not coalesce((x->>'guid') = any(seen), false)
                or coalesce(x->>'ym', '') !~ '^\d{6}$' or coalesce(x->>'sec', '') = '')
     or exists (select 1 from jsonb_array_elements(errs) x where not coalesce((x->>'guid') = any(seen), false)) then
    return jsonb_build_object('ok', false, 'error', 'a share or error of an entry not seen (or with no GUID), or a share without its month or section');
  end if;
  -- the months touched: those its shares were and are in, and the day each entry had (as seen before) and has
  select coalesce(array_agg(distinct y), '{}') into yms from (
    select g.ym y from gst_share g where g.book_id = p_book and g.guid = any(seen)
    union select x->>'ym' from jsonb_array_elements(p_shares) x
    union select to_char(s.day, 'YYYYMM') from calc_seen s where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and s.key = any(seen) and s.day is not null
    union select to_char((x->>'day')::date, 'YYYYMM') from jsonb_array_elements(p_seen) x where coalesce(x->>'day', '') <> '') q where y is not null;
  delete from gst_share g where g.book_id = p_book and g.guid = any(seen);
  insert into gst_share (book_id, firm_id, guid, ym, reg, sec, k1, k2, k3, n, taxable, igst, cgst, sgst, cess, qty)
  select p_book, f, x->>'guid', x->>'ym', coalesce(x->>'reg', ''), x->>'sec', coalesce(x->>'k1', ''), coalesce(x->>'k2', ''), coalesce(x->>'k3', ''),
         coalesce((x->>'n')::int, 0), coalesce((x->>'taxable')::numeric, 0), coalesce((x->>'igst')::numeric, 0), coalesce((x->>'cgst')::numeric, 0),
         coalesce((x->>'sgst')::numeric, 0), coalesce((x->>'cess')::numeric, 0), coalesce((x->>'qty')::numeric, 0)
    from jsonb_array_elements(p_shares) x;
  get diagnostics n_ins = row_count;
  -- what was seen: an entry gone from the copy is forgotten; the rest kept as the copy held it at the pick (an entry that
  -- failed: status 'error' and its words, not due: picked again once it or its day changes)
  delete from calc_seen s using jsonb_array_elements(p_seen) x
   where s.book_id = p_book and s.calc = 'gst-share' and s.kind = 'entry' and s.key = x->>'guid' and coalesce((x->>'gone')::boolean, false)
     and (s.due_at is null or p_at is null or s.due_at <= p_at);
  insert into calc_seen (book_id, firm_id, calc, kind, key, day, alter_id, gst_alter_id, tds_alter_id, deleted, cancelled, optional, status, error, due, due_at, at)
  select p_book, f, 'gst-share', 'entry', x->>'guid', nullif(x->>'day', '')::date, nullif(x->>'alter_id', '')::bigint, nullif(x->>'gst_alter_id', '')::bigint, nullif(x->>'tds_alter_id', '')::bigint,
         coalesce((x->>'deleted')::boolean, false), coalesce((x->>'cancelled')::boolean, false), coalesce((x->>'optional')::boolean, false),
         case when e.err is not null then 'error' else 'ok' end, left(e.err, 500), false, null, now()
    from jsonb_array_elements(p_seen) x
    left join lateral (select coalesce(y->>'error', 'failed') err from jsonb_array_elements(errs) y where y->>'guid' = x->>'guid' limit 1) e on true
   where coalesce(x->>'guid', '') <> '' and not coalesce((x->>'gone')::boolean, false)
  on conflict (book_id, calc, kind, key) do update set day = excluded.day, alter_id = excluded.alter_id, gst_alter_id = excluded.gst_alter_id, tds_alter_id = excluded.tds_alter_id,
     deleted = excluded.deleted, cancelled = excluded.cancelled, optional = excluded.optional, status = excluded.status, error = excluded.error, at = now(),
     due = calc_seen.due and calc_seen.due_at > coalesce(p_at, '-infinity'::timestamptz),
     due_at = case when calc_seen.due and calc_seen.due_at > coalesce(p_at, '-infinity'::timestamptz) then calc_seen.due_at end;
  n_m := gst_share_month_sum(p_book, yms);
  return jsonb_build_object('ok', true, 'entries', cardinality(seen), 'shares', n_ins, 'errors', jsonb_array_length(errs), 'months', to_jsonb(yms), 'rows', n_m);
end $function$;

-- ---------------------------------------------------------------- reading and checking
create or replace function public.gst_month_get(p_book uuid, p_ym text)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('reg', m.reg, 'sec', m.sec, 'k1', m.k1, 'k2', m.k2, 'k3', m.k3, 'n', m.n, 'taxable', m.taxable, 'igst', m.igst,
           'cgst', m.cgst, 'sgst', m.sgst, 'cess', m.cess, 'qty', m.qty, 'status', m.status) order by m.reg, m.sec, m.k1, m.k2, m.k3), '[]'::jsonb)
    from gst_month m where m.book_id = p_book and m.ym = p_ym;
$function$;

create or replace function public.gst_parity_put(p_book uuid, p_ym text, p_reg text, p_engine text, p_ok boolean, p_max numeric, p_diffs jsonb, p_notes jsonb)
returns bigint language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid; i bigint;
begin
  select firm_id into f from tally_books where book_id = p_book;
  if f is null or coalesce(p_ym, '') !~ '^\d{6}$' then return null; end if;
  insert into calc_parity (book_id, firm_id, calc, ym, reg, engine, ok, max_diff, diffs, notes)
  values (p_book, f, 'gst-share', p_ym, coalesce(p_reg, ''), coalesce(p_engine, ''), p_ok, coalesce(p_max, 0),
          coalesce(p_diffs, '[]'::jsonb), coalesce(p_notes, '{}'::jsonb))
  returning id into i;
  return i;
end $function$;

-- ---------------------------------------------------------------- the timer's books
-- books with something to do: a day written since it was seen, an entry due, or entries and no context yet; none
-- leased by a run going, none backing off; at most p_n (5 at most), the longest waiting first
create or replace function public.gst_share_books_due(p_n integer default 3)
returns table (book_id uuid) language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select b.book_id from tally_books b
   cross join lateral (select min(d.changed_at) w from tally_calc_dirty d
                         left join calc_seen s on s.book_id = d.book_id and s.calc = 'gst-share' and s.kind = 'day' and s.key = d.day::text
                        where d.book_id = b.book_id and s.stamp is distinct from d.changed_at::text) dd
   where b.client_id is not null
     and (dd.w is not null
          or exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.due)
          or (not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'ctx')
              and exists (select 1 from tally_vouchers v where v.book_id = b.book_id)))
     and not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book'
                      and s.key in ('lease', 'backoff:ctx') and (s.data->>'until')::timestamptz > clock_timestamp())
   order by dd.w nulls last, b.book_id
   limit greatest(1, least(coalesce(p_n, 3), 5));
$function$;
-- every book with shares, the one checked longest ago first (at most p_n, 500 at most)
create or replace function public.gst_share_books_all(p_n integer default 200)
returns table (book_id uuid) language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select b.book_id from tally_books b
   where b.client_id is not null and exists (select 1 from gst_month m where m.book_id = b.book_id)
   order by (select max(p.at) from calc_parity p where p.book_id = b.book_id) nulls first, b.book_id
   limit greatest(1, least(coalesce(p_n, 200), 500));
$function$;

do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'migration 164: pg_cron, pg_net or Vault is not here: no timer for share_sweep / share_parity (gst-run takes them when called)';
  elsif not exists (select 1 from vault.decrypted_secrets where name = 'gst_cron_key') or not exists (select 1 from vault.decrypted_secrets where name = 'fincom_project_url') then
    raise notice 'migration 164: Vault has no gst_cron_key or fincom_project_url: no timer for share_sweep / share_parity';
  else
    -- every minute: up to 3 books with something to do, one call each
    perform cron.schedule('gst-share-sweep', '* * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/gst-run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
        body := jsonb_build_object('action', 'share_sweep', 'book_id', d.book_id))
      from public.gst_share_books_due(3) d
    $job$);
    -- nightly, 21:17 UTC (02:47 India time, away from the hour): every month of up to 200 books against today's engine
    perform cron.schedule('gst-share-parity', '17 21 * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/gst-run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
        body := jsonb_build_object('action', 'share_parity', 'book_id', d.book_id))
      from public.gst_share_books_all(200) d
    $job$);
  end if;
end $cron$;

revoke all on function public.gst_share_ctx_version(uuid) from public, anon, authenticated;
grant execute on function public.gst_share_ctx_version(uuid) to service_role;
revoke all on function public.gst_share_ctx_get(uuid) from public, anon, authenticated;
grant execute on function public.gst_share_ctx_get(uuid) to service_role;
revoke all on function public.gst_share_ctx_put(uuid, text, text, text, jsonb, text[], text[], boolean) from public, anon, authenticated;
grant execute on function public.gst_share_ctx_put(uuid, text, text, text, jsonb, text[], text[], boolean) to service_role;
revoke all on function public.gst_share_pick(uuid, integer) from public, anon, authenticated;
grant execute on function public.gst_share_pick(uuid, integer) to service_role;
revoke all on function public.gst_share_rows(uuid, text[]) from public, anon, authenticated;
grant execute on function public.gst_share_rows(uuid, text[]) to service_role;
revoke all on function public.gst_share_put(uuid, text, timestamptz, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.gst_share_put(uuid, text, timestamptz, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.gst_share_lease(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.gst_share_lease(uuid, text, integer) to service_role;
revoke all on function public.gst_share_unlease(uuid, text) from public, anon, authenticated;
grant execute on function public.gst_share_unlease(uuid, text) to service_role;
revoke all on function public.gst_share_backoff(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gst_share_backoff(uuid, text, text) to service_role;
revoke all on function public.gst_share_backoff_clear(uuid, text) from public, anon, authenticated;
grant execute on function public.gst_share_backoff_clear(uuid, text) to service_role;
revoke all on function public.gst_share_books_due(integer) from public, anon, authenticated;
grant execute on function public.gst_share_books_due(integer) to service_role;
revoke all on function public.gst_share_books_all(integer) from public, anon, authenticated;
grant execute on function public.gst_share_books_all(integer) to service_role;
revoke all on function public.gst_month_get(uuid, text) from public, anon, authenticated;
grant execute on function public.gst_month_get(uuid, text) to service_role;
revoke all on function public.gst_parity_put(uuid, text, text, text, boolean, numeric, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.gst_parity_put(uuid, text, text, text, boolean, numeric, jsonb, jsonb) to service_role;
-- internal: only the functions above call them
revoke all on function public.gst_share_month_sum(uuid, text[]) from public, anon, authenticated, service_role;
revoke all on function public.gst_share_stale(uuid, text[]) from public, anon, authenticated, service_role;
revoke all on function public.gst_share_holds(uuid, text) from public, anon, authenticated, service_role;

commit;
