"""python3 run_migration204.py - server/tally-cloud/migration-204-db-speed.sql (21-Nov-2026, branch next-fix-dbspeed; the
owner: "make the database fast ... the effect should remain the same"). On a throwaway PostgreSQL (pg_stand, port 31274
unless PG204_PORT; never a real database), with staging's tables as they are (columns and indexes) and made-up books of
realistic size (74,250 lines, 16,500 entries, 16,500 bills, 16,698 seen rows), each statement 204 makes lighter is run
before and after the file and must give exactly the same answer (the md5 of its whole text), in every case below, and be
no slower; the timings are printed. Checks:
  0. the file: add-only (functions replaced with the same arguments, an index made CONCURRENTLY if not there, statistics if
     not there; nothing dropped, deleted, updated or truncated; no table), lock_timeout set, every function's grants
     explicit, names no real database, runs twice; the functions it replaces are staging's text (md5 of each body)
  1. gst_share_books_due (the gst-share-sweep job, every minute): as made, idle (every entry seen), a lease, a book with no
     context, an entry due, another engine, an entry unseen, p_n 1 / 5 / null
  2. tally_unknown_ledger_entries: one book, a tiny book, every book of a firm (an owner), another firm's book, service role
     with no book (refused: the same error)
  3. gst_calc_rows and gst_share_rows: big, tiny (quotes, a line break, non-Latin text, a NaN rate), a book that is not
     there; 3,000 GUIDs, all, none, null, unknown GUIDs
  4. the settle's look-up by the add-on's remote GUID (tally_post_register_settle_book's second look, per register row):
     the same lines found; the planner takes the new index
  5. grants as on staging
RED_WITHOUT_204=1: the same checks without the file (fails)."""
import os, re, sys, hashlib, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.dirname(HERE)
M204 = os.path.join(ROOT, "server", "tally-cloud", "migration-204-db-speed.sql")
RED = os.environ.get("RED_WITHOUT_204") == "1"
PORT = int(os.environ.get("PG204_PORT", "31274"))
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
def fdef(path, name):
    t = open(path).read()
    i = [m.start() for m in re.finditer(r"(?i)create or replace function public\.%s\(" % name, t)][-1]
    m = re.search(r"(?is)\bas\s+(\$\w*\$)", t[i:]); tag = m.group(1)
    a = i + m.end(); b = t.index(tag, a)
    return t[i:b + len(tag)] + ";", t[a:b]
# the text each replaced function has on staging now (md5 of pg_proc.prosrc, read 21-Nov-2026) and where it was last written
BEFORE = [("gst_share_books_due", "server/tally-cloud/migration-170-gst-share-engine.sql", "3810f2d43544297f3475f3eeecbdc2b0", "p_n integer"),
          ("tally_unknown_ledger_entries", "server/tally-cloud/migration-56-keep-fields.sql", "9f63a75a9990c8233d84a2c7bd0a9fdf", "p_book uuid"),
          ("gst_calc_rows", "server/gst-run/migration-153-gst-cloud.sql", "110d7e2afc752fe1a829f4e945391a97", "p_book uuid"),
          ("gst_share_rows", "server/tally-cloud/migration-166-gst-share-rows-index.sql", "43a69d75e82ac5fe492f9909b5421d74", "p_book uuid, p_guids text[]")]
GRANTS = {"gst_share_books_due": "{postgres=X/postgres,service_role=X/postgres}", "gst_calc_rows": "{postgres=X/postgres,service_role=X/postgres}",
          "gst_share_rows": "{postgres=X/postgres,service_role=X/postgres}",
          "tally_unknown_ledger_entries": "{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}"}
# staging's tables these read (columns, defaults and indexes as pg_catalog gives them, 21-Nov-2026)
DDL = r"""create sequence if not exists public.tally_recorder_lines_id_seq;
create table public.calc_seen (book_id uuid not null, firm_id uuid not null, calc text not null, kind text not null, key text not null, alter_id bigint, gst_alter_id bigint, tds_alter_id bigint, deleted boolean not null default false, cancelled boolean not null default false, optional boolean not null default false, day date, status text not null default 'ok'::text, error text, stamp text, data jsonb, due boolean not null default false, due_at timestamp with time zone, at timestamp with time zone not null default now());
create unique index calc_seen_pkey ON public.calc_seen USING btree (book_id, calc, kind, key);
create index calc_seen_due ON public.calc_seen USING btree (book_id, calc, key) WHERE due;
create table public.gst_share_engine (one boolean not null default true, engine text not null, rev text, at timestamp with time zone not null default now());
create unique index gst_share_engine_pkey ON public.gst_share_engine USING btree (one);
create table public.tally_bills (book_id uuid not null, firm_id uuid not null, guid text not null, day date not null, ledger text not null, name text not null default ''::text, type text not null default ''::text, amount numeric not null, bill_date date, credit_days integer, due date, id bigint not null);
create index tally_bills_book_party ON public.tally_bills USING btree (book_id, ledger, name);
create index tally_bills_book_guid ON public.tally_bills USING btree (book_id, guid);
create index tally_bills_book_day ON public.tally_bills USING btree (book_id, day);
create unique index tally_bills_pkey ON public.tally_bills USING btree (id);
create table public.tally_books (book_id uuid not null, firm_id uuid not null, client_id text not null, company text not null, from_date date, open_as_on date, ledgers_at timestamp with time zone, days_at timestamp with time zone, state jsonb not null default '{}'::jsonb, state_at timestamp with time zone, source text not null default 'tally'::text);
create unique index tally_books_pkey ON public.tally_books USING btree (book_id);
create index tally_books_client ON public.tally_books USING btree (firm_id, client_id);
create table public.tally_calc_dirty (book_id uuid not null, day date not null, changed_at timestamp with time zone not null default now());
create unique index tally_calc_dirty_pkey ON public.tally_calc_dirty USING btree (book_id, day);
create index tally_calc_dirty_at ON public.tally_calc_dirty USING btree (changed_at);
create table public.tally_ledgers (book_id uuid not null, firm_id uuid not null, name text not null, parent text not null default ''::text, open numeric(18,2) not null default 0, chain text[] not null default '{}'::text[], primary_group text not null default ''::text, open_sent numeric(18,2), merged_into text, gstin text, pan text, tally_guid text, alter_id bigint, deleted_at timestamp with time zone, origin text not null default 'tally'::text, deleted_reason text, deleted_by_list jsonb, renamed_at timestamp with time zone, seen_round text, seen_at timestamp with time zone, before_clean jsonb, needs_confirm boolean not null default false, state text, tds_deductee_type text not null default ''::text, tds_nature text, tds_special_rate text, tds_ldc jsonb, pay_type text, pay_stat_type text, it_component text, for_payroll boolean, source text not null default 'tally'::text);
create unique index tally_ledgers_pkey ON public.tally_ledgers USING btree (book_id, name);
create index tally_ledgers_gstin ON public.tally_ledgers USING btree (book_id, gstin) WHERE ((gstin IS NOT NULL) AND (gstin <> ''::text));
create unique index tally_ledgers_tally_guid ON public.tally_ledgers USING btree (book_id, tally_guid) WHERE (tally_guid IS NOT NULL);
create index tally_ledgers_live_nm ON public.tally_ledgers USING btree (book_id, tally_nm(name)) WHERE (deleted_at IS NULL);
create table public.tally_lines (book_id uuid not null, firm_id uuid not null, guid text not null, day date not null, ledger text not null, amount numeric(18,2) not null, hsn text not null default ''::text, rate numeric, id bigint not null);
create index tally_lines_ledger ON public.tally_lines USING btree (book_id, ledger, day);
create index tally_lines_guid ON public.tally_lines USING btree (book_id, guid);
create index tally_lines_book_day ON public.tally_lines USING btree (book_id, day);
create unique index tally_lines_pkey ON public.tally_lines USING btree (id);
create table public.tally_post_register (id bigint not null, firm_id uuid not null, client_id text not null, fincom_id text not null, entry_id text, kind text, company text, book_id uuid, state text not null, master_id text, id_inferred boolean not null default false, vch_type text, vch_no text, vch_date date, amount numeric, tally_words text, job_id uuid, source text not null default 'queue'::text, changed_by uuid, changed_at timestamp with time zone not null default now(), queued_by uuid, queued_at timestamp with time zone not null default now(), sent_at timestamp with time zone, settled_at timestamp with time zone, created_at timestamp with time zone not null default now());
create unique index tally_post_register_pkey ON public.tally_post_register USING btree (id);
create unique index tally_post_register_fid ON public.tally_post_register USING btree (firm_id, fincom_id);
create index tally_post_register_client ON public.tally_post_register USING btree (firm_id, client_id, changed_at DESC);
create index tally_post_register_job ON public.tally_post_register USING btree (job_id);
create index tally_post_register_open ON public.tally_post_register USING btree (book_id, state) WHERE ((state = ANY (ARRAY['sent'::text, 'needs_review'::text, 'refused'::text])) OR id_inferred);
create index tally_post_register_review ON public.tally_post_register USING btree (changed_at) WHERE (state = 'needs_review'::text);
create table public.tally_recorder_lines (id bigint not null default nextval('public.tally_recorder_lines_id_seq'), firm_id uuid not null, client_id text, book_id uuid not null, device_id uuid, bridge text, pc text, tally_user text, company_guid text, company text, line_id text, event text not null, object_guid text, master_id text, alter_id bigint, vch_type text, vch_no text, vch_date date, saved_at timestamp with time zone, received_at timestamp with time zone not null default now(), applied_at timestamp with time zone, state text not null default 'received'::text, held_why text, ledgers jsonb, payload jsonb, body jsonb, save_ms numeric, released_at timestamp with time zone, released_by uuid);
create unique index tally_recorder_lines_pkey ON public.tally_recorder_lines USING btree (id);
create unique index tally_recorder_lines_applied_once ON public.tally_recorder_lines USING btree (book_id, object_guid, alter_id, event) WHERE ((state = 'applied'::text) AND (object_guid IS NOT NULL));
create index tally_recorder_lines_firm ON public.tally_recorder_lines USING btree (firm_id, received_at DESC);
create index tally_recorder_lines_state ON public.tally_recorder_lines USING btree (book_id, state);
create index tally_recorder_lines_guid ON public.tally_recorder_lines USING btree (book_id, object_guid);
create index tally_recorder_lines_held_day ON public.tally_recorder_lines USING btree (book_id, vch_date) WHERE (state = 'held'::text);
create index tally_recorder_lines_held_master ON public.tally_recorder_lines USING btree (book_id, master_id) WHERE (state = 'held'::text);
create index tally_recorder_lines_line ON public.tally_recorder_lines USING btree (book_id, line_id);
create index tally_recorder_lines_fid ON public.tally_recorder_lines USING btree (book_id, ((payload ->> 'fid'::text))) WHERE (payload ? 'fid'::text);
create index tally_recorder_lines_applied_at ON public.tally_recorder_lines USING btree (book_id, COALESCE(applied_at, received_at) DESC) WHERE (state = 'applied'::text);
create table public.tally_vouchers (book_id uuid not null, firm_id uuid not null, guid text not null, day date not null, alter_id bigint not null default 0, vtype text not null default ''::text, vno text not null default ''::text, party text not null default ''::text, narration text not null default ''::text, cancelled boolean not null default false, optional boolean not null default false, gstin text not null default ''::text, pos text not null default ''::text, ref text not null default ''::text, ref_date date, cmp_gstin text not null default ''::text, deleted_at timestamp with time zone, origin text not null default 'tally'::text, fincom_id text, irn text not null default ''::text, irn_ack_no text not null default ''::text, irn_ack_date date, eway_no text not null default ''::text, check_notes jsonb not null default '[]'::jsonb, gst_reg_type text, gst_country text, gst_rcm boolean, gst_nature text, gst_taxability text, gst_supply text, gst_ineligible boolean, gst_mixed boolean, gst_alter_id bigint, tds_tally jsonb, tds_tally_alter_id bigint, source text not null default 'tally'::text);
create unique index tally_vouchers_pkey ON public.tally_vouchers USING btree (book_id, guid);
create index tally_vouchers_day ON public.tally_vouchers USING btree (book_id, day);
create index tally_vouchers_fincom ON public.tally_vouchers USING btree (book_id, fincom_id) WHERE (fincom_id IS NOT NULL);
create index tally_vouchers_isd_typed ON public.tally_vouchers USING btree (book_id) WHERE ((deleted_at IS NULL) AND (gst_reg_type ~* '(input[ \t\n\r_-]*service[ \t\n\r_-]*distributor|^[ \t\n\r]*isd([^A-Za-z0-9_]|$))'::text));
"""
# made-up books: nothing of a real firm
GEN = r"""-- made-up books: A big, B medium, C small, D/E tiny, F with no client rows
insert into tally_books (book_id, firm_id, client_id, company) values
 ('a0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000204', 'c-a', 'Made-up Alpha Co'),
 ('b0000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-000000000204', 'c-b', 'Made-up Beta Co'),
 ('c0000000-0000-0000-0000-00000000000c', 'f0000000-0000-0000-0000-000000000204', 'c-c', 'Made-up Gamma Co'),
 ('d0000000-0000-0000-0000-00000000000d', 'f0000000-0000-0000-0000-000000000205', 'c-d', 'Made-up Delta Co'),
 ('e0000000-0000-0000-0000-00000000000e', 'f0000000-0000-0000-0000-000000000205', 'c-e', 'Made-up Epsilon Co');
create temp table gb (book_id uuid, nv int, nl int) on commit drop;
insert into gb values ('a0000000-0000-0000-0000-00000000000a', 9400, 800), ('b0000000-0000-0000-0000-00000000000b', 5000, 500),
  ('c0000000-0000-0000-0000-00000000000c', 2000, 200), ('d0000000-0000-0000-0000-00000000000d', 60, 20), ('e0000000-0000-0000-0000-00000000000e', 40, 15);
insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, deleted_at, fincom_id, gst_alter_id)
select g.book_id, b.firm_id, 'guid-' || substr(md5(g.book_id::text || i), 1, 12) || '-' || i, date '2025-04-01' + (i * 7919 % 365), i, (array['Sales','Purchase','Payment','Receipt','Journal'])[1 + i % 5],
       'V' || (i % 997), 'Party ' || (i % g.nl), 'made-up narration ' || i, i % 53 = 0, i % 61 = 0, case when i % 3 = 0 then '' else 'GSTIN' || (i % 40) end,
       case when i % 47 = 0 then now() end, case when i % 9 = 0 then 'fid-' || i end, case when i % 2 = 0 then i end
  from gb g join tally_books b using (book_id), generate_series(1, g.nv) i;
insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, hsn, rate, id)
select v.book_id, v.firm_id, v.guid, v.day,
       case when (v.alter_id * 31 + k) % 97 = 0 then 'Missing Ledger ' || (v.alter_id % 7) when (v.alter_id + k) % 89 = 0 then '' else 'Ledger ' || ((v.alter_id * 13 + k * 7) % g.nl) end,
       round(((v.alter_id * 37 + k * 11) % 100000) / 7.0, 2), case when k = 2 then 'H' || (v.alter_id % 30) else '' end, case when k = 2 then 18 end,
       row_number() over ()
  from tally_vouchers v join gb g using (book_id), generate_series(1, 4 + (v.alter_id % 2)::int) k;
insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount, credit_days, id)
select v.book_id, v.firm_id, v.guid, v.day, 'Ledger ' || (v.alter_id % g.nl), 'Bill ' || v.alter_id || '-' || k, (array['New Ref','Agst Ref','Advance'])[1 + (v.alter_id + k) % 3],
       v.alter_id * 3.5 + k, case when k = 1 then 30 end, row_number() over ()
  from tally_vouchers v join gb g using (book_id), generate_series(1, 1 + (v.alter_id % 3 = 0)::int) k where v.alter_id % 4 <> 1;
-- the ledgers: most names, some deleted, some with a line break Tally sends (tally_nm makes it plain)
insert into tally_ledgers (book_id, firm_id, name, deleted_at)
select g.book_id, b.firm_id, case when j % 50 = 7 then 'Ledger ' || j || E'&#13;&#10;' when j % 50 = 8 then E' Ledger ' || j || E'\n' else 'Ledger ' || j end, case when j % 71 = 5 then now() end
  from gb g join tally_books b using (book_id), generate_series(0, g.nl - 1) j;
-- what gst-share has seen: every entry but a few in book C; days stamped; a few dirty days moved
insert into calc_seen (book_id, firm_id, calc, kind, key, alter_id, gst_alter_id, day, deleted, cancelled, optional)
select v.book_id, v.firm_id, 'gst-share', 'entry', v.guid, v.alter_id, v.gst_alter_id, v.day, v.deleted_at is not null, v.cancelled, v.optional from tally_vouchers v
 where not (v.book_id = 'c0000000-0000-0000-0000-00000000000c' and v.alter_id % 400 = 3);
insert into calc_seen (book_id, firm_id, calc, kind, key, stamp, data) select b.book_id, b.firm_id, 'gst-share', 'book', 'ctx', 's1', jsonb_build_object('engine', 'e1') from tally_books b;
insert into tally_calc_dirty (book_id, day, changed_at) select distinct v.book_id, v.day, timestamptz '2026-11-01 10:00' from tally_vouchers v where v.alter_id % 40 = 0;
insert into calc_seen (book_id, firm_id, calc, kind, key, stamp) select d.book_id, b.firm_id, 'gst-share', 'day', d.day::text, d.changed_at::text from tally_calc_dirty d join tally_books b using (book_id);
insert into gst_share_engine (one, engine) values (true, 'e1');
-- the recorder's lines and the register (for the settle's look-ups)
insert into tally_recorder_lines (firm_id, book_id, event, state, object_guid, master_id, vch_no, payload)
select v.firm_id, v.book_id, (array['created','altered','imported','deleted'])[1 + v.alter_id % 4], case when v.alter_id % 13 = 0 then 'failed' else 'applied' end, v.guid, 'M' || v.alter_id, v.vno,
       case when v.alter_id % 5 = 0 then jsonb_build_object('fid', 'fid-' || v.alter_id, 'x', repeat('z', 200)) when v.alter_id % 997 = 1 then jsonb_build_object('remoteGuid', 'fid-' || v.alter_id)
            when v.alter_id % 991 = 2 then jsonb_build_object('remote_guid', 'fid-' || (v.alter_id + 7)) else jsonb_build_object('x', repeat('y', 200)) end
  from tally_vouchers v where v.alter_id % 3 = 0 and v.book_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');
insert into tally_post_register (id, firm_id, client_id, fincom_id, entry_id, company, book_id, state, id_inferred)
select i + case when b.client_id = 'c-a' then 0 else 1000 end, b.firm_id, b.client_id, 'fid-' || (i * 3 + case when b.client_id = 'c-a' then 0 else 1 end), case when i % 4 = 0 then 'fid-' || (i * 3 + 7) end, b.company, case when i % 10 <> 0 then b.book_id end,
       (array['sent','needs_review','refused','in_tally'])[1 + i % 4], i % 8 = 3
  from tally_books b, generate_series(1, 600) i where b.book_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');
analyze;
-- awkward values: quotes, a backslash, a line break, non-Latin text, a NaN rate, trailing zeros, nulls
update tally_vouchers set narration = E'He said "made-up" \\ a\nline ₹ नमस्ते \U0001F600', party = E'Party \'q\'', ref_date = '2025-05-05', irn_ack_date = '2025-05-06', gst_rcm = true, deleted_at = timestamptz '2026-01-02 03:04:05.678+05:30'
 where book_id = 'd0000000-0000-0000-0000-00000000000d' and alter_id = 5;
update tally_lines set rate = 'NaN', amount = 10.50 where book_id = 'd0000000-0000-0000-0000-00000000000d' and guid = (select guid from tally_vouchers where book_id = 'd0000000-0000-0000-0000-00000000000d' and alter_id = 5);
update tally_bills set credit_days = null, name = E'Bill "x"\t1' where book_id = 'd0000000-0000-0000-0000-00000000000d';
analyze;
"""
STUBS = r"""
drop table if exists tally_books, tally_ledgers, tally_lines, tally_vouchers cascade;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('fincom.role', true), '') $$;
create or replace function public.tally_service_or_owner() returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
  as $$ select coalesce(auth.role() = 'service_role', session_user in ('postgres', 'supabase_admin')) $$;
create or replace function public.tally_nm(p text) returns text language sql immutable as $$ select btrim(regexp_replace(coalesce(p, ''), '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g')) $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
insert into members values ('11111111-0000-0000-0000-000000000204', 'f0000000-0000-0000-0000-000000000204', 'Owner', 'owner', true);
alter system set work_mem = '3500kB';
select pg_reload_conf();
create schema if not exists stand;
-- the median of n runs (ms) and the md5 of the whole answer as text; an error: its words
create or replace function stand.bench(q text, n int default 5) returns table(ms numeric, h text) language plpgsql as $$
declare t0 timestamptz; ts numeric[] := '{}'; r text;
begin
  for i in 1..n loop
    t0 := clock_timestamp();
    begin
      execute 'select md5(coalesce(string_agg(x::text, ''|''), '''')) from (' || q || ') x' into r;
    exception when others then r := 'ERROR: ' || sqlerrm;
    end;
    ts := ts || extract(epoch from clock_timestamp() - t0) * 1000;
  end loop;
  return query select round((select percentile_cont(0.5) within group (order by u) from unnest(ts) u)::numeric, 1), r;
end $$;
"""
A, B, C, D = ("a0000000-0000-0000-0000-00000000000a", "b0000000-0000-0000-0000-00000000000b", "c0000000-0000-0000-0000-00000000000c", "d0000000-0000-0000-0000-00000000000d")
OWNER = "11111111-0000-0000-0000-000000000204"
def lit(s): return "'" + s.replace("'", "''") + "'"
G3000 = "array(select guid from tally_vouchers where book_id = '%s' order by guid limit 3000)" % A
SETTLE = """select g.id, b.book_id, (select ln.id from tally_recorder_lines ln
       where ln.book_id = b.book_id and ln.event in ('created', 'altered', 'imported') and ln.state <> 'failed'
         and coalesce(ln.payload->>'remoteGuid', ln.payload->>'remote_guid', '') <> ''
         and coalesce(ln.payload->>'remoteGuid', ln.payload->>'remote_guid') in (g.fincom_id, coalesce(g.entry_id, g.fincom_id))
       order by ln.id desc limit 1) l2
  from tally_books b join tally_post_register g on g.firm_id = b.firm_id and (g.book_id = b.book_id or (g.book_id is null and lower(coalesce(g.company, '')) = lower(coalesce(b.company, ''))))
   and (g.state in ('sent', 'needs_review', 'refused') or (g.state = 'in_tally' and g.id_inferred))
 order by g.id, b.book_id"""
IDLE = "insert into calc_seen (book_id, firm_id, calc, kind, key) select book_id, firm_id, 'gst-share', 'entry', guid from tally_vouchers on conflict do nothing; delete from tally_calc_dirty;"
# (case, setup run first in its own transaction and rolled back after, the statement, who calls)
CASES = [
  ("due: as made", "", "select * from gst_share_books_due(3)", None),
  ("due: idle, every entry seen (the usual minute)", IDLE, "select * from gst_share_books_due(3)", None),
  ("due: idle, p_n 5", IDLE, "select * from gst_share_books_due(5)", None),
  ("due: p_n 1", "", "select * from gst_share_books_due(1)", None),
  ("due: p_n null", "", "select * from gst_share_books_due(null)", None),
  ("due: a lease on C", "insert into calc_seen (book_id, firm_id, calc, kind, key, data) select book_id, firm_id, 'gst-share', 'book', 'lease', jsonb_build_object('until', now() + interval '1 hour') from tally_books where book_id = '%s';" % C, "select * from gst_share_books_due(5)", None),
  ("due: idle, B has no context", IDLE + "delete from calc_seen where book_id = '%s' and kind = 'book';" % B, "select * from gst_share_books_due(5)", None),
  ("due: idle, an entry due in D", IDLE + "update calc_seen set due = true where book_id = '%s' and kind = 'entry' and key = (select min(key) from calc_seen where book_id = '%s' and kind = 'entry');" % (D, D), "select * from gst_share_books_due(5)", None),
  ("due: idle, another engine", IDLE + "update gst_share_engine set engine = 'e2';", "select * from gst_share_books_due(5)", None),
  ("due: idle, one entry of A unseen", IDLE + "delete from calc_seen where book_id = '%s' and kind = 'entry' and key = (select max(key) from calc_seen where book_id = '%s' and kind = 'entry');" % (A, A), "select * from gst_share_books_due(5)", None),
  ("unknown: book A (service)", "", "select * from tally_unknown_ledger_entries('%s')" % A, None),
  ("unknown: book D (service)", "", "select * from tally_unknown_ledger_entries('%s')" % D, None),
  ("unknown: book A, no missing names left", "delete from tally_lines where ledger like 'Missing%';", "select * from tally_unknown_ledger_entries('" + A + "')", None),
  ("unknown: every book of the owner's firm", "", "select * from tally_unknown_ledger_entries(null)", OWNER),
  ("unknown: the owner, another firm's book", "", "select * from tally_unknown_ledger_entries('%s')" % D, OWNER),
  ("unknown: the owner, own book B", "", "select * from tally_unknown_ledger_entries('%s')" % B, OWNER),
  ("unknown: service, no book (refused)", "", "select * from tally_unknown_ledger_entries(null)", None),
  ("calc rows: book A", "", "select gst_calc_rows('%s')" % A, None),
  ("calc rows: book B", "", "select gst_calc_rows('%s')" % B, None),
  ("calc rows: book D (awkward values)", "", "select gst_calc_rows('%s')" % D, None),
  ("calc rows: no such book", "", "select gst_calc_rows('99999999-0000-0000-0000-000000000000')", None),
  ("share rows: 3,000 GUIDs of A", "", "select gst_share_rows('%s', %s)" % (A, G3000), None),
  ("share rows: every GUID of D", "", "select gst_share_rows('%s', array(select guid from tally_vouchers where book_id = '%s'))" % (D, D), None),
  ("share rows: none", "", "select gst_share_rows('%s', '{}')" % A, None),
  ("share rows: null", "", "select gst_share_rows('%s', null)" % A, None),
  ("share rows: unknown GUIDs", "", "select gst_share_rows('%s', array['nope-1', 'nope-2'])" % A, None),
  ("settle: look-up by the remote GUID", "", SETTLE, None),
]
# the main cases: at least this many times faster
MAIN = {"due: idle, every entry seen (the usual minute)": 3, "settle: look-up by the remote GUID": 10, "unknown: every book of the owner's firm": 1.5}
def run_cases(db):
    out = {}
    for name, setup, stmt, uid in CASES:
        pre = ("set fincom.uid = '%s';\n" % uid) if uid else ""
        rows = db.rows("begin;\n" + setup + "\n" + pre + "select ms, h from stand.bench(%s, 5);\nrollback;" % lit(stmt))
        out[name] = (float(rows[0]["ms"]), rows[0]["h"])
    return out
text = open(M204).read() if os.path.exists(M204) and not RED else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M204), hashlib.md5(text.encode()).hexdigest() if text else "-", len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(bool(text) and not re.search(r"\b(drop|truncate)\s", code) and "delete from" not in code and not re.search(r"\bupdate\s+\w", code) and "create table" not in code
   and "insert into" not in code, "add-only: nothing dropped, deleted, updated, inserted or truncated; no table")
ok("set local lock_timeout = '3s';" in code and "\nset lock_timeout = '3s';" in code, "lock_timeout 3 s (the transaction, and the index made after it)")
idx = re.findall(r"create index concurrently if not exists (\w+)", code)
ok(idx == ["tally_recorder_lines_remote_guid"] and code.rfind("create index concurrently") > code.rfind("commit;"), "one index, CONCURRENTLY, if not there, outside the transaction: %s" % idx)
ok("create statistics if not exists public.tally_recorder_lines_remote_guid_stats" in code, "statistics on the remote-GUID test, if not there")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(made == sorted(b[0] for b in BEFORE), "replaces exactly: %s" % made)
for name, path, md5, args in BEFORE:
    sig = "public.%s(%s)" % (name, ", ".join(a.split()[-1] for a in args.split(",")))
    ok(("revoke all on function %s from public, anon, authenticated" % sig) in code and ("grant execute on function %s to " % sig) in code, "%s: grants explicit" % sig)
    ok(("create or replace function public.%s(%s" % (name, args)) in code, "%s: the same arguments" % name)
    ok(hashlib.md5(fdef(os.path.join(ROOT, path), name)[1].encode()).hexdigest() == md5, "%s: replaced from staging's text (%s)" % (name, os.path.basename(path)))
print("== 1-4. the stand")
db = pg_stand.start(PORT)
try:
    db.sql(STUBS); db.sql(DDL); db.sql("begin;\n" + GEN + "\ncommit;")
    for name, path, md5, args in BEFORE: db.sql(fdef(os.path.join(ROOT, path), name)[0])
    db.sql("revoke all on function public.gst_share_books_due(integer), public.gst_calc_rows(uuid), public.gst_share_rows(uuid, text[]), public.tally_unknown_ledger_entries(uuid) from public;"
           " grant execute on function public.gst_share_books_due(integer), public.gst_calc_rows(uuid), public.gst_share_rows(uuid, text[]), public.tally_unknown_ledger_entries(uuid) to service_role;"
           " grant execute on function public.tally_unknown_ledger_entries(uuid) to authenticated;")
    print("   ", db.rows("select (select count(*) from tally_lines) lines, (select count(*) from tally_vouchers) entries, (select count(*) from tally_bills) bills, (select count(*) from calc_seen) seen, (select count(*) from tally_recorder_lines) recorder, (select count(*) from tally_post_register) register")[0])
    before = run_cases(db)
    if text:
        for i in (1, 2):
            r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-X", "-f", "-"],
                               input=text, capture_output=True, text=True)
            ok(r.returncode == 0, "the file runs (time %d)%s" % (i, "" if r.returncode == 0 else ": " + r.stderr[-400:]))
    after = run_cases(db)
    print("    %-52s %10s %10s  %s" % ("case", "before ms", "after ms", "x"))
    for name, _, _, _ in CASES:
        (b_ms, b_h), (a_ms, a_h) = before[name], after[name]
        print("    %-52s %10.1f %10.1f  %5.1f" % (name, b_ms, a_ms, b_ms / max(a_ms, 0.05)))
    for name, _, _, _ in CASES:
        (b_ms, b_h), (a_ms, a_h) = before[name], after[name]
        ok(a_h == b_h, "%s: the same answer (%s)" % (name, a_h[:40]))
        ok(a_ms <= b_ms * 1.3 + 3, "%s: no slower (within the stand's noise)" % name)
        if name in MAIN: ok(b_ms >= a_ms * MAIN[name], "%s: at least %sx faster" % (name, MAIN[name]))
    ok(after["unknown: service, no book (refused)"][1].startswith("ERROR: which book?"), "unknown: service with no book still refused")
    plan = "\n".join(r["QUERY PLAN"] for r in db.rows("explain " + SETTLE))
    ok("tally_recorder_lines_remote_guid" in plan, "settle: the planner takes the remote-GUID index")
    print("== 5. grants")
    for name, want in GRANTS.items():
        got = db.one("select proacl::text from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % lit(name))
        ok(got == want, "%s: %s" % (name, got))
finally:
    db.stop(); shutil.rmtree(db.data, ignore_errors=True)
print("\n%d failed" % len(fails) if fails else "\nall ok"); sys.exit(1 if fails else 0)
