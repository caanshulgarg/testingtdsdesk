-- Migration 153 (09-Nov-2026, branch next-cloud-gst; written, NOT run: the owner reads it and runs it).
-- A month's GSTR-3B worked out in the cloud (the gst-run function) by the browser's own engine (server/_shared/gst3b.js,
-- the same file the app is built from), kept until something it is worked out from changes. The page never waits on it:
-- it reads what is kept (gst_calc_cached) and, when nothing current is kept, works the month out itself as today. The
-- store is filled in the background, a month or two per run of gst-run, each run starting from the credit carried in
-- that the month before left (kept).
--
-- Needs migration 151 (branch next-cloud-calc1) first: it reuses 151's table and functions, as they are:
--   tally_calc_results   one row per book, kind and arguments: here kind 'gst-3b', args '<state code>|<YYYYMM>' (e.g.
--                        '07|202510'), the result (every 3B box, the credit carried in and out, and the fingerprint of
--                        the inputs it was worked out from), the version, and how long it took. RLS on, members read
--                        their own firm's rows, written by the service role only (all in 151).
--   tally_calc_version   the book's own version (its days and ledgers times, entries, deletions, FinCom's ledger list).
-- What this adds (nothing of any other migration dropped, deleted or altered; no trigger on any table; safe to run twice,
-- and over an earlier draft of itself):
--   gst_calc_queue                    one row per client whose 3B store is to be filled, queued explicitly: by tally-ingest
--                                     after a book's entries are stored (gst_calc_want_book), by the app after a GST item of
--                                     the work is saved (gst_calc_poke), and by a member's miss (gst-run). Taken by gst-run's
--                                     "warm" runs (gst_calc_take), one client a run; attempts counts runs taken and not
--                                     finished: at 3 the client is marked too_big and left to the app, which works its 3B
--                                     out itself as today. RLS on; service role only.
--   gst_calc_book(firm, client, ym)   the book a month is worked out on: tally_pick's rule (the latest book whose copy
--                                     starts by the month's last day), for a firm given. gst-run and gst_calc_cached both
--                                     use it, so they pick the same book.
--   gst_calc_rows(book)               the book's entries, lines and bill allocations in one compact answer (for gst-run's
--                                     reading: a third of the bytes, no ledger name repeated on every line)
--   gst_calc_gstins(book, client)     the client's GSTINs: its entries' own GSTINs and the client's record. The 2B runs and
--                                     decisions gst-run reads and the version counts are those of these GSTINs.
--   gst_calc_version(book, client)    the version of everything a 3B is worked out from: the book's (tally_calc_version),
--                                     the items of the client's work the 3B engine reads (client_book_items, the keys in
--                                     GST3B_KEYS of server/_shared/gst3bprint.js, listed below: 2B and its matching, IMS,
--                                     typed and filed returns, GST settings, rules, advances, the masters, the ledger
--                                     list), the client's record (clients), its marketplace sales (records, kind 'sales',
--                                     not deleted), and the 2B matching gst-2b-match kept for its GSTINs (gst_2b_runs
--                                     done, gst_2b_decisions). Service role only.
--   gst_calc_cached(client, reg, ym)  for a member of the client's firm: the 3B kept for that month on the month's book,
--                                     only while the version is the same ({book, version, result: null when not, at,
--                                     too_big: the cloud leaves this client to the app}).
--   gst_calc_want / _want_book / _poke / _take / _done   the queue (want, want_book, take, done: service role only;
--                                     poke: a member, for a client of its firm). At most 3 runs at once; a client is taken
--                                     in the order it was first wanted; too big after 3 unfinished runs or 2 over budget,
--                                     taken back a day later or when the engine changes
--   gst_calc_book_months(firm, client, to)   each book of the client with the months gst_calc_book gives it
--   the timer: a pg_cron job, gst-run-warm, every minute, waking gst-run ({action: "warm"}) up to three times while
--                                     clients wait, with gst-taxpro's timer key (Vault gst_cron_key) at this project's own
--                                     address (Vault fincom_project_url). Made only where pg_cron, pg_net and both Vault
--                                     secrets are there; otherwise nothing is scheduled and this says so.
-- The result's own "engine" says which engine worked it out; gst-run works a month out again when it differs.

begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regclass('public.tally_calc_results') is null or to_regprocedure('public.tally_calc_version(uuid)') is null then
    raise exception 'migration 153 needs migration 151 (tally_calc_results, tally_calc_version) to be run first';
  end if;
end $$;

create table if not exists public.gst_calc_queue (
  firm_id   uuid not null,
  client_id text not null,
  why       text not null default 'asked',
  wanted_at timestamptz not null default now(),
  taken_at  timestamptz,
  ran_at    timestamptz,
  primary key (firm_id, client_id)
);
-- a run of an earlier draft of this migration (never released) converges: its columns added, its triggers and the
-- functions whose arguments or answer changed since dropped (only gst_calc_* objects of its own; nothing else is dropped)
alter table public.gst_calc_queue add column if not exists attempts integer not null default 0;
alter table public.gst_calc_queue add column if not exists too_big boolean not null default false;
alter table public.gst_calc_queue add column if not exists big_n integer not null default 0;
alter table public.gst_calc_queue add column if not exists rev text;
alter table public.gst_calc_queue add column if not exists first_wanted timestamptz not null default now();
alter table public.gst_calc_queue add column if not exists asked_at timestamptz not null default now();
alter table public.gst_calc_queue add column if not exists after_msg bigint;
do $draft$ begin
  drop trigger if exists gst_calc_items_ins on public.client_book_items; drop trigger if exists gst_calc_items_upd on public.client_book_items;
  drop trigger if exists gst_calc_items_del on public.client_book_items; drop trigger if exists gst_calc_vouchers_ins on public.tally_vouchers;
  drop trigger if exists gst_calc_vouchers_upd on public.tally_vouchers; drop trigger if exists gst_calc_vouchers_del on public.tally_vouchers;
  drop function if exists public.gst_calc_items_changed(); drop function if exists public.gst_calc_vouchers_changed();
  drop function if exists public.gst_calc_want(uuid, text, text); drop function if exists public.gst_calc_want_book(uuid, text);
  drop function if exists public.gst_calc_want(uuid, text, text, text, integer); drop function if exists public.gst_calc_want_book(uuid, text, integer);
  drop function if exists public.gst_calc_take(); drop function if exists public.gst_calc_take(integer);
  drop function if exists public.gst_calc_done(uuid, text, boolean); drop function if exists public.gst_calc_done(uuid, text, boolean, boolean, boolean);
  drop function if exists public.gst_calc_cached(text, date, text, text);
end $draft$;
alter table public.gst_calc_queue enable row level security;
revoke all on public.gst_calc_queue from public, anon, authenticated;
grant all on public.gst_calc_queue to service_role;

-- the book a month is worked out on (tally_pick's rule, for a firm given)
create or replace function public.gst_calc_book(p_firm uuid, p_client text, p_ym text)
returns uuid language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with d as (select (to_date(p_ym || '01', 'YYYYMMDD') + interval '1 month' - interval '1 day')::date as on_day)
  select b.book_id from tally_books b, d
   where b.client_id = p_client and b.firm_id = p_firm and b.from_date is not null and b.open_as_on <= d.on_day
   order by (b.from_date <= d.on_day) desc, b.from_date desc limit 1;
$function$;

-- every month from the client's first book to p_to, by the book gst_calc_book gives it (one call for gst-run's runs)
create or replace function public.gst_calc_book_months(p_firm uuid, p_client text, p_to text)
returns table (book_id uuid, months text[]) language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with f as (select min(b.from_date) d from tally_books b where b.firm_id = p_firm and b.client_id = p_client and b.from_date is not null and b.open_as_on is not null),
  m as (select to_char(g, 'YYYYMM') ym from f, generate_series(date_trunc('month', f.d), to_date(p_to || '01', 'YYYYMMDD'), interval '1 month') g where f.d is not null),
  x as (select m.ym, gst_calc_book(p_firm, p_client, m.ym) bk from m)
  select x.bk, array_agg(x.ym order by x.ym) from x where x.bk is not null group by x.bk;
$function$;

-- the client's GSTINs: its entries' own (cmp_gstin) and its record's
create or replace function public.gst_calc_gstins(p_book uuid, p_client text)
returns text[] language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select coalesce(array_agg(distinct g order by g), '{}'::text[]) from (
    select upper(v.cmp_gstin) g from tally_vouchers v where v.book_id = p_book and coalesce(v.cmp_gstin, '') <> ''
    union select upper(c.data->>'gstin') from tally_books b join clients c on c.firm_id = b.firm_id and c.id = p_client
     where b.book_id = p_book and coalesce(c.data->>'gstin', '') <> '') x
   where g ~ '^\d{2}[A-Z0-9]{13}$';
$function$;

-- the book's entries for gst-run in one answer, compact: each ledger's name once (ledgers), each entry as a list of its
-- columns (data.ts HEADS, in that order) with its lines [ledger, amount, hsn, rate] and bill allocations [ledger, name,
-- type, amount, credit days] inside it; in the order the app reads them (entries by day and GUID, lines and bills as
-- kept). About a third of the bytes of the same rows read page by page, and no name repeated on every line.
create or replace function public.gst_calc_rows(p_book uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with led as (select x.ledger, (row_number() over (order by x.ledger)) - 1 as i
                 from (select l.ledger from tally_lines l where l.book_id = p_book union select b.ledger from tally_bills b where b.book_id = p_book) x where x.ledger is not null),
  ln as (select l.guid, jsonb_agg(jsonb_build_array(d.i, l.amount, l.hsn, l.rate) order by l.id) a
           from tally_lines l join led d on d.ledger = l.ledger where l.book_id = p_book group by l.guid),
  bl as (select b.guid, jsonb_agg(jsonb_build_array(d.i, b.name, b.type, b.amount, b.credit_days) order by b.id) a
           from tally_bills b join led d on d.ledger = b.ledger where b.book_id = p_book group by b.guid)
  select jsonb_build_object(
    'ledgers', (select coalesce(jsonb_agg(led.ledger order by led.i), '[]'::jsonb) from led),
    'heads', (select coalesce(jsonb_agg(jsonb_build_array(v.guid, v.day, v.alter_id, v.vtype, v.vno, v.party, v.narration, v.cancelled, v.optional, v.deleted_at,
                v.gstin, v.pos, v.ref, v.ref_date, v.cmp_gstin, v.irn, v.irn_ack_date, v.gst_reg_type, v.gst_country, v.gst_rcm, v.gst_nature, v.gst_taxability,
                v.gst_supply, v.gst_ineligible, v.gst_mixed, v.gst_alter_id, coalesce(ln.a, '[]'::jsonb), coalesce(bl.a, '[]'::jsonb)) order by v.day, v.guid), '[]'::jsonb)
                from tally_vouchers v left join ln on ln.guid = v.guid left join bl on bl.guid = v.guid where v.book_id = p_book));
$function$;

-- the version of everything a client's 3B reads (see above); the book's firm decides whose rows count
create or replace function public.gst_calc_version(p_book uuid, p_client text)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with g as (select unnest(gst_calc_gstins(p_book, p_client)) as gstin)
  select md5(concat_ws('|', 'gst-3b',
           tally_calc_version(b.book_id),
           (select concat_ws(':', count(*), max(i.seq), max(i.updated_at), count(*) filter (where i.deleted))
              from client_book_items i where i.firm_id = b.firm_id and i.client_id = p_client
               and i.key = any (array['advFix', 'amendFix', 'assets', 'filed', 'filed1a', 'gone', 'groups', 'gst3b', 'gstAato', 'gstApi', 'gstCashLedger', 'gstContacts', 'gstFiled', 'gstOpen', 'gstRegs', 'gstSet', 'gstVault', 'gstins', 'itcBasis', 'itcDec', 'itcTrack', 'ledCheck', 'ledInfo', 'ledInfoAt', 'map', 'outRej', 'pans', 'reco2b', 'rev', 'rule37On', 'states', 'twoBs', 'under']::text[])),
           (select concat_ws(':', count(*), max(c.updated_at), md5(coalesce(max(c.data::text), '')), bool_or(c.deleted))
              from clients c where c.firm_id = b.firm_id and c.id = p_client),
           (select concat_ws(':', count(*), max(r.updated_at))
              from records r where r.firm_id = b.firm_id and r.client_id = p_client and r.kind = 'sales' and r.deleted is not true),
           (select concat_ws(':', count(*), max(r.id)) from gst_2b_runs r
             where r.firm_id = b.firm_id and r.status = 'done' and r.gstin in (select gstin from g)),
           (select concat_ws(':', count(*), max(d.at), md5(coalesce(string_agg(d.pair_id || '=' || d.decision, ',' order by d.gstin, d.fy, d.pair_id), '')))
              from gst_2b_decisions d where d.firm_id = b.firm_id and d.gstin in (select gstin from g))))
    from tally_books b where b.book_id = p_book and b.client_id = p_client;
$function$;

-- a member: the 3B kept for its client's month (on the month's book), only while it is current
create or replace function public.gst_calc_cached(p_client text, p_reg text, p_ym text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); bk uuid; v text; r tally_calc_results%rowtype;
begin
  if f is null or coalesce(p_ym, '') !~ '^20\d{2}(0[1-9]|1[0-2])$' or coalesce(p_reg, '') !~ '^\d{2}$' then return jsonb_build_object('none', true); end if;
  bk := gst_calc_book(f, p_client, p_ym);
  if bk is null then return jsonb_build_object('none', true); end if;
  v := gst_calc_version(bk, p_client);
  select * into r from tally_calc_results x where x.book_id = bk and x.kind = 'gst-3b' and x.args = p_reg || '|' || p_ym and x.firm_id = f;
  return jsonb_build_object('book', bk, 'version', v, 'result', case when r.version = v then r.result end, 'at', case when r.version = v then r.at end,
    'too_big', exists (select 1 from gst_calc_queue q where q.firm_id = f and q.client_id = p_client and q.too_big));
end $function$;

-- recorder lines on tally_recorder's queue (migration 47) not applied yet: the message p_msg is still there (the drain
-- archives it once applied, or once it stops trying). False where there is no such queue
create or replace function public.gst_calc_held(p_msg bigint)
returns boolean language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if p_msg is null or to_regclass('pgmq.q_tally_recorder') is null then return false; end if;
  return exists (select 1 from pgmq.q_tally_recorder m where m.msg_id = p_msg);
end $function$;

-- the queue: a client wanted. wanted_at is when it is due: now, never later than it was (a want never puts off one
-- waiting); asked_at the last want (a want while a run is going keeps the client queued after it); after_msg: lines
-- queued for the drain (p_after, tally_recorder's message): the client is not taken while that message waits, so its run
-- starts once the drain has applied them. taken_at and first_wanted are left as they are. A client left to the app (too
-- big) is taken back when it last ran over a day ago or the engine changed (p_rev). True when a run may start for it now
-- (not too big, not waiting on the drain, and no run going: none taken, or the one taken 2 minutes ago or more, dead):
-- only then is one started
create or replace function public.gst_calc_want(p_firm uuid, p_client text, p_why text default 'asked', p_rev text default null, p_after bigint default null)
returns boolean language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare q gst_calc_queue%rowtype;
begin
  if p_firm is null or coalesce(p_client, '') = '' then return false; end if;
  select * into q from gst_calc_queue where firm_id = p_firm and client_id = p_client for update;
  if not found then
    insert into gst_calc_queue (firm_id, client_id, why, wanted_at, first_wanted, asked_at, after_msg)
    values (p_firm, p_client, coalesce(p_why, 'asked'), now(), now(), now(), p_after) on conflict do nothing;
    return p_after is null;
  end if;
  if q.too_big and (q.ran_at is null or q.ran_at < now() - interval '1 day' or (p_rev is not null and p_rev is distinct from q.rev)) then
    update gst_calc_queue set too_big = false, attempts = 0, big_n = 0 where firm_id = p_firm and client_id = p_client;
    q.too_big := false;
  end if;
  update gst_calc_queue set wanted_at = least(wanted_at, now()), asked_at = now(), why = coalesce(p_why, why),
         after_msg = case when p_after is null then after_msg else greatest(coalesce(after_msg, 0), p_after) end
   where firm_id = p_firm and client_id = p_client;
  return not q.too_big and p_after is null and not gst_calc_held(q.after_msg)
     and (q.taken_at is null or q.taken_at < now() - interval '2 minutes');
end $function$;
-- tally-ingest, after a book's entries are stored: the book's client (p_after: lines queued for the drain, its message)
create or replace function public.gst_calc_want_book(p_book uuid, p_why text default 'books', p_after bigint default null)
returns boolean language sql volatile security definer set search_path to 'public', 'pg_temp' as $function$
  select coalesce((select gst_calc_want(b.firm_id, b.client_id, p_why, null, p_after) from tally_books b where b.book_id = p_book and b.client_id is not null), false);
$function$;
-- a member (the app, after a GST item of the work is saved): a client of its own firm
create or replace function public.gst_calc_poke(p_client text)
returns boolean language sql volatile security definer set search_path to 'public', 'pg_temp' as $function$
  select coalesce((select gst_calc_want(c.firm_id, c.id, 'work', null, null) from clients c where c.firm_id = my_firm() and c.id = p_client and c.deleted is not true), false);
$function$;
-- the next clients to work on (p_n, at most 5, in the order first wanted): waiting (wanted by now, its queued lines applied), never one taken in
-- the last 2 minutes, nor one run in the last 20 seconds, nor one too big; and none while 3 runs are going (taken in the
-- last 2 minutes): at most 3 runs at once, however they were started. A client whose runs were taken 3 times and never
-- finished is marked too big here (the app works its 3B out itself)
create or replace function public.gst_calc_take(p_n integer default 1)
returns table (firm_id uuid, client_id text, why text) language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare going integer;
begin
  perform pg_advisory_xact_lock(hashtext('gst_calc_take'));
  update gst_calc_queue x set too_big = true, taken_at = null, ran_at = now()
   where not x.too_big and x.attempts >= 3 and (x.taken_at is null or x.taken_at < now() - interval '2 minutes');
  select count(*) into going from gst_calc_queue g where g.taken_at >= now() - interval '2 minutes';
  if going >= 3 then return; end if;
  return query
  update gst_calc_queue q set taken_at = now(), attempts = q.attempts + 1
   where (q.firm_id, q.client_id) in (select y.firm_id, y.client_id from gst_calc_queue y
                                      where not y.too_big and y.attempts < 3 and y.wanted_at <= now() and not gst_calc_held(y.after_msg)
                                        and (y.taken_at is null or y.taken_at < now() - interval '2 minutes')
                                        and (y.ran_at is null or y.ran_at < now() - interval '20 seconds')
                                      order by y.first_wanted, y.wanted_at limit greatest(1, least(coalesce(p_n, 1), 5, 3 - going)) for update skip locked)
  returning q.firm_id, q.client_id, q.why;
end $function$;
-- a run over: done (p_ok) and nothing more to do and not wanted again while it ran: the client leaves the queue; more to
-- do, or wanted again: it waits its 20 seconds; failed: its attempt stays counted; over its budget (p_big): counted, and
-- at the second such run left to the app (too big, with the engine's revision p_rev)
create or replace function public.gst_calc_done(p_firm uuid, p_client text, p_more boolean, p_ok boolean default true, p_big boolean default false, p_rev text default null)
returns void language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if p_big then
    update gst_calc_queue set big_n = big_n + 1, too_big = (big_n + 1 >= 2), rev = p_rev, taken_at = null, ran_at = now() where firm_id = p_firm and client_id = p_client;
  elsif not coalesce(p_ok, false) then
    update gst_calc_queue set taken_at = null, ran_at = now(), rev = p_rev where firm_id = p_firm and client_id = p_client;
  else
    delete from gst_calc_queue where firm_id = p_firm and client_id = p_client and not p_more and taken_at is not null and asked_at <= taken_at;
    update gst_calc_queue set taken_at = null, ran_at = now(), attempts = 0, rev = p_rev where firm_id = p_firm and client_id = p_client;
  end if;
end $function$;

-- the timer (every minute, only while a client waits; up to 3 runs at once, each takes one client)
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'migration 153: pg_cron, pg_net or Vault is not here: no timer for gst-run (members'' misses and the app still queue; runs start on a miss)';
  elsif not exists (select 1 from vault.decrypted_secrets where name = 'gst_cron_key') or not exists (select 1 from vault.decrypted_secrets where name = 'fincom_project_url') then
    raise notice 'migration 153: Vault has no gst_cron_key or fincom_project_url: no timer for gst-run';
  else
    perform cron.schedule('gst-run-warm', '* * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/gst-run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
        body := '{"action":"warm"}'::jsonb)
      from generate_series(1, greatest(0, least(3 - (select count(*)::int from public.gst_calc_queue g where g.taken_at >= now() - interval '2 minutes'),
              (select count(*)::int from public.gst_calc_queue q where not q.too_big and q.attempts < 3 and q.wanted_at <= now() and not public.gst_calc_held(q.after_msg)
              and (q.taken_at is null or q.taken_at < now() - interval '2 minutes') and (q.ran_at is null or q.ran_at < now() - interval '20 seconds')))))
    $job$);
  end if;
end $cron$;

revoke all on function public.gst_calc_book(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gst_calc_book(uuid, text, text) to service_role;
revoke all on function public.gst_calc_rows(uuid) from public, anon, authenticated;
grant execute on function public.gst_calc_rows(uuid) to service_role;
revoke all on function public.gst_calc_gstins(uuid, text) from public, anon, authenticated;
grant execute on function public.gst_calc_gstins(uuid, text) to service_role;
revoke all on function public.gst_calc_version(uuid, text) from public, anon, authenticated;
grant execute on function public.gst_calc_version(uuid, text) to service_role;
revoke all on function public.gst_calc_book_months(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gst_calc_book_months(uuid, text, text) to service_role;
revoke all on function public.gst_calc_held(bigint) from public, anon, authenticated;
grant execute on function public.gst_calc_held(bigint) to service_role;
revoke all on function public.gst_calc_want(uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.gst_calc_want(uuid, text, text, text, bigint) to service_role;
revoke all on function public.gst_calc_want_book(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.gst_calc_want_book(uuid, text, bigint) to service_role;
revoke all on function public.gst_calc_take(integer) from public, anon, authenticated;
grant execute on function public.gst_calc_take(integer) to service_role;
revoke all on function public.gst_calc_done(uuid, text, boolean, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.gst_calc_done(uuid, text, boolean, boolean, boolean, text) to service_role;
revoke all on function public.gst_calc_poke(text) from public, anon;
grant execute on function public.gst_calc_poke(text) to authenticated, service_role;
revoke all on function public.gst_calc_cached(text, text, text) from public, anon;
grant execute on function public.gst_calc_cached(text, text, text) to authenticated, service_role;

commit;
