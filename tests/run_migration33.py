"""python3 run_migration33.py - migration-33-ledger-lists (02-Oct-2026, the owner's decisions on the ledgers). On a
throwaway PostgreSQL (pg_stand) with the cloud tables and functions as on staging (02-Oct-2026: tally_ingest_ledgers,
tally_ingest_ledgers_g and tally_year_openings as read from staging, which deleted and re-made every ledger on a full
list), then migration-32 and migration-33 (each twice), with made-up rows; never on staging.
Checks: the file runs twice and deletes nothing; tally_balances leaves out deleted ledgers; group names met whatever
their capitals (the chain of groups, the year's P&L groups); a full list is add-only: a ledger missing from it is marked
deleted with the reason and the list (source, when, who, computer), logged, its opening no longer counted, and un-marked
(logged) when listed again; the bulk safeguard (more than 25 or 5% missing, whichever is more: held, marked on the next
list that misses them too); an empty list marks nothing; entries never removed by a list; the calls of the tally-ingest
deployed now (no p_list) are add-only too; the bridge's own marks (migration-32 ledger_list) are logged; the log is
append-only; a member reads only their firm's marks and cannot call the functions; the owner's query runs."""
import os, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M32 = os.path.join(HERE, "..", "server", "tally-cloud", "migration-32-sync-safety.sql")
M33 = os.path.join(HERE, "..", "server", "tally-cloud", "migration-33-ledger-lists.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the tables as on staging (tally_ledgers before migration-32's columns), and the functions migration-33 replaces as
# they are on staging (read 02-Oct-2026)
SCHEMA = r"""
drop table if exists tally_books, tally_ledgers, tally_vouchers, tally_lines, tally_ledger_day, tally_days, tally_groups, tally_post_jobs, tally_post_ids, tally_company_lease,
  tally_sync_cursor, tally_sync_reads, tally_voucher_versions, tally_ledger_lists, tally_ledger_marks cascade;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('fincom.role', true), ''), 'service_role') $$;
create table tally_books (book_id uuid primary key, firm_id uuid not null references firms(id), client_id text not null, company text not null, from_date date, open_as_on date,
  ledgers_at timestamptz, days_at timestamptz, state jsonb not null default '{}', state_at timestamptz);
create table tally_ledgers (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, name text not null, parent text not null default '',
  open numeric not null default 0, chain text[] not null default '{}', primary_group text not null default '', open_sent numeric, merged_into text, gstin text, pan text,
  primary key (book_id, name));
create table tally_groups (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, name text not null, parent text not null default '', primary key (book_id, name));
create table tally_vouchers (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, guid text not null, day date not null, alter_id bigint not null default 0,
  vtype text not null default '', vno text not null default '', party text not null default '', narration text not null default '', cancelled boolean not null default false,
  optional boolean not null default false, gstin text not null default '', pos text not null default '', ref text not null default '', ref_date date, cmp_gstin text not null default '',
  primary key (book_id, guid));
create table tally_lines (book_id uuid, firm_id uuid, guid text, day date, ledger text, amount numeric, hsn text, rate numeric);
create table tally_ledger_day (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, ledger text not null, day date not null,
  amount numeric not null default 0, dr numeric not null default 0, cr numeric not null default 0, n integer not null default 0, primary key (book_id, ledger, day));
create table tally_days (book_id uuid not null, firm_id uuid not null, day date not null, n integer not null default 0, alter_max bigint not null default 0, bytes integer not null default 0,
  at timestamptz not null default now(), primary key (book_id, day));
create table tally_post_jobs (id uuid primary key, firm_id uuid not null references firms(id) on delete cascade, client_id text not null, company text not null, device_id uuid,
  payload jsonb not null, n integer not null, status text not null default 'waiting', done integer not null default 0, message text not null default '', results jsonb,
  checking boolean not null default false, created_by uuid, created_at timestamptz not null default now(), taken_at timestamptz, updated_at timestamptz not null default now(),
  attempts integer not null default 0, items jsonb);
create or replace function public.tally_nm(p text) returns text language sql immutable as $function$
  select btrim(regexp_replace(coalesce(p, ''), '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))
$function$;
create or replace function public.tally_ledger_key(p text) returns text language sql immutable set search_path to 'public' as $function$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '(&#13;|&#10;|\r|\n)+', ' ', 'g'), '\s+', ' ', 'g'))
$function$;
create or replace function public.tally_ingest_ledgers(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  update tally_books set from_date = p_from, open_as_on = p_open_as_on, ledgers_at = now() where book_id = p_book;
  delete from tally_lines where book_id = p_book and day < p_from;
  delete from tally_vouchers where book_id = p_book and day < p_from;
  delete from tally_ledger_day where book_id = p_book and day < p_from;
  delete from tally_days where book_id = p_book and day < p_from;
  delete from tally_ledgers where book_id = p_book;
  insert into tally_ledgers (book_id, firm_id, name, parent, open)
  select p_book, f, nm, coalesce((array_agg(par order by (raw = nm) desc, raw) filter (where par <> ''))[1], ''), sum(op)
    from (select distinct on (x->>0) x->>0 as raw, tally_nm(x->>0) as nm, tally_nm(x->>1) as par, coalesce(nullif(x->>2, '')::numeric, 0) as op
            from jsonb_array_elements(p_ledgers) x order by x->>0) s
   where nm <> '' group by nm;
  return jsonb_build_object('ok', true, 'ledgers', jsonb_array_length(p_ledgers));
end $function$;
create or replace function public.tally_year_openings(p_book uuid)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid; fd date; moved numeric := 0; n int := 0; twins int := 0;
  pl constant text[] := array['Sales Accounts', 'Purchase Accounts', 'Direct Incomes', 'Direct Expenses', 'Indirect Incomes', 'Indirect Expenses'];
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id, from_date into f, fd from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  update tally_ledgers set open_sent = open where book_id = p_book and open_sent is null;
  with k as (select name, parent, tally_ledger_key(name) as key,
           row_number() over (partition by tally_ledger_key(name) order by (parent <> '') desc, (name = tally_ledger_key(name)) desc, name) as rn,
           count(*) over (partition by tally_ledger_key(name)) as c from tally_ledgers where book_id = p_book), head as (select key, name from k where rn = 1 and c > 1)
  update tally_ledgers l set merged_into = case when l.name = h.name then null else h.name end
    from head h where l.book_id = p_book and tally_ledger_key(l.name) = h.key and l.merged_into is distinct from (case when l.name = h.name then null else h.name end);
  get diagnostics twins = row_count;
  update tally_ledgers l set open = case when l.merged_into is null then l.open_sent else 0 end where l.book_id = p_book;
  update tally_ledgers l set open = l.open + s.x from (select merged_into, sum(open_sent) x from tally_ledgers where book_id = p_book and merged_into is not null group by merged_into) s
   where l.book_id = p_book and l.name = s.merged_into;
  if fd is null or to_char(fd, 'MM-DD') <> '04-01' then return jsonb_build_object('ok', true, 'moved', 0, 'ledgers', 0, 'twins', twins); end if;
  select coalesce(sum(open), 0), count(*) into moved, n from tally_ledgers where book_id = p_book and merged_into is null and primary_group = any(pl) and open <> 0;
  if n = 0 then return jsonb_build_object('ok', true, 'moved', 0, 'ledgers', 0, 'twins', twins); end if;
  update tally_ledgers set open = 0 where book_id = p_book and merged_into is null and primary_group = any(pl) and open <> 0;
  insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent) values (p_book, f, 'Profit & Loss A/c', '', moved, 0)
  on conflict (book_id, name) do update set open = tally_ledgers.open + excluded.open;
  return jsonb_build_object('ok', true, 'moved', moved, 'ledgers', n, 'twins', twins);
end $function$;
create or replace function public.tally_ingest_ledgers_g(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_groups jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid; n_groups int := 0; yo jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  perform public.tally_ingest_ledgers(p_book, p_from, p_open_as_on, p_ledgers);
  if jsonb_array_length(coalesce(p_groups, '[]'::jsonb)) > 0 then
    delete from tally_groups where book_id = p_book;
    insert into tally_groups (book_id, firm_id, name, parent)
    select distinct on (tally_nm(x->>0)) p_book, f, tally_nm(x->>0), tally_nm(x->>1) from jsonb_array_elements(p_groups) x where tally_nm(x->>0) <> ''
     order by tally_nm(x->>0), (tally_nm(x->>1) <> '') desc, (x->>0 = tally_nm(x->>0)) desc
    on conflict (book_id, name) do update set parent = excluded.parent;
    get diagnostics n_groups = row_count;
  end if;
  with recursive up as (
    select l.name as ledger, l.parent as grp, 1 as depth, array[l.parent] as chain from tally_ledgers l where l.book_id = p_book and l.parent <> ''
    union all
    select u.ledger, g.parent, u.depth + 1, u.chain || g.parent from up u join tally_groups g on g.book_id = p_book and g.name = u.grp
     where g.parent <> '' and u.depth < 30 and not (g.parent = any(u.chain))
  ), best as (select distinct on (ledger) ledger, chain from up order by ledger, depth desc)
  update tally_ledgers l set chain = b.chain, primary_group = b.chain[array_length(b.chain, 1)] from best b where l.book_id = p_book and l.name = b.ledger;
  yo := public.tally_year_openings(p_book);
  return jsonb_build_object('ok', true, 'ledgers', jsonb_array_length(p_ledgers), 'groups', n_groups, 'yearOpenings', yo);
end $function$;
"""
F, F2, U, U2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888", "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444"
B, B2, BIG = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"
DEV = "77777777-7777-7777-7777-777777777777"
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
GROUPS = [["Current Assets", ""], ["Cash-in-hand", "Current Assets"], ["Petty Cash", "Cash-in-Hand"], ["Sundry Debtors", "current assets"],
          ["Sales Accounts", ""], ["Indirect Expenses", ""], ["Capital Account", ""]]
BASE = [["Cash", "Cash-in-Hand", "-1000"], ["Petty Box", "petty cash", "-50"], ["Alpha Traders", "Sundry Debtors", "-300"], ["Beta Traders", "SUNDRY DEBTORS", "-200"],
        ["Sales", "sales accounts", "700"], ["Rent", "Indirect Expenses", "-100"], ["Capital", "Capital Account", "950"]]

db = pg_stand.start(55444)
def psql_file(path):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
try:
    db.sql(SCHEMA)
    db.sql("insert into firms values (%s, 'Firm'), (%s, 'Other') on conflict do nothing; insert into members values (%s, %s, 'Me', 'owner', true), (%s, %s, 'Them', 'owner', true);" % (q(F), q(F2), q(U), q(F), q(U2), q(F2)))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31'), (%s, %s, 'c9', 'OTHER', '2026-04-01', '2026-03-31'), (%s, %s, 'c2', 'BIG CO', '2025-10-01', '2025-09-30');"
           % (q(B), q(F), q(B2), q(F2), q(BIG), q(F)))
    # the book as the staging functions leave it (a full list, delete-and-insert), with entries
    db.sql("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s);" % (q(B), js(BASE), js(GROUPS)))
    db.sql("""insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, narration) values (%(B)s, %(F)s, 'g-1', '2026-05-01', 7, 'cash sale');
      insert into tally_lines values (%(B)s, %(F)s, 'g-1', '2026-05-01', 'Cash', -250, '', null), (%(B)s, %(F)s, 'g-1', '2026-05-01', 'Sales', 250, '', null);
      insert into tally_ledger_day (book_id, firm_id, ledger, day, amount) values (%(B)s, %(F)s, 'Cash', '2026-05-01', -250), (%(B)s, %(F)s, 'Sales', '2026-05-01', 250), (%(B)s, %(F)s, 'Rent', '2026-05-02', -10);
      insert into tally_days (book_id, firm_id, day, n) values (%(B)s, %(F)s, '2026-05-01', 1);""" % {"B": q(B), "F": q(F)})
    before_open = {r["name"]: r["open"] for r in db.rows("select name, open from tally_ledgers where book_id = %s" % q(B))}
    ok(before_open.get("Sales") == "700" and before_open.get("Profit & Loss A/c") == "-100", "on staging's functions 'sales accounts' (small letters) is not seen as a P&L group: Sales keeps its opening, only Rent moves (%s)" % before_open)
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_vouchers", "tally_lines", "tally_ledgers", "tally_ledger_day", "tally_days", "tally_books", "tally_groups"]}
    before = counts()
    # 1. migration-32 (applied on staging), then migration-33 as the owner runs it (psql, stop at the first error), twice
    for path, name in [(M32, "32"), (M32, "32"), (M33, "33"), (M33, "33")]:
        r = psql_file(path)
        ok(r.returncode == 0, "migration-%s runs %s" % (name, (r.stderr or "").strip()[-400:] if r.returncode else ""))
    ok(counts() == before, "nothing deleted by the migrations (%s)" % counts())
    body = open(M33).read().lower()
    stmts = [l for l in body.split("\n") if not l.strip().startswith("--")]
    ok(not any(w in " ".join(stmts) for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "delete from", "truncate"]),
       "the file drops and deletes nothing")
    j = lambda s, uid=None: json.loads(db.one(s, uid))
    led = lambda book=B: {r["name"]: r for r in db.rows("select name, parent, open, open_sent, chain, primary_group, merged_into, deleted_at, deleted_reason, deleted_by_list::text as by_list from tally_ledgers where book_id = %s" % q(book))}
    full = lambda ledgers, src, book=B, frm="2026-04-01", groups=GROUPS: j("select tally_ingest_ledgers_g(%s, %s, '%s'::date - 1, %s, %s, %s)" % (q(book), q(frm), frm, js(ledgers), js(groups), js(src)))
    BRIDGE = {"source": "bridge ledgers", "device": DEV, "bridge": "go-abc123", "computer": "OFFICE-PC", "user": "accounts"}
    PERSON = {"source": "upload_ledgers", "by": U}

    # 2. group names whatever their capitals: chains, and the year's P&L groups
    r = full(BASE, BRIDGE)
    L = led()
    ok(L["Petty Box"]["chain"] == "{\"petty cash\",Cash-in-Hand,\"Current Assets\"}" and L["Petty Box"]["primary_group"] == "Current Assets",
       "a ledger's group 'petty cash' meets the group 'Petty Cash', whose parent 'Cash-in-Hand' meets 'Cash-in-hand' (%s / %s)" % (L["Petty Box"]["chain"], L["Petty Box"]["primary_group"]))
    ok(L["Beta Traders"]["primary_group"].lower() == "current assets" and L["Cash"]["primary_group"] == "Current Assets", "'SUNDRY DEBTORS' and 'Cash-in-Hand' reach their primary group (%s, %s)" % (L["Beta Traders"]["primary_group"], L["Cash"]["primary_group"]))
    ok(L["Sales"]["open"] == "0" and L["Rent"]["open"] == "0" and float(L["Profit & Loss A/c"]["open"]) == 600, "the year's openings: 'sales accounts' is a P&L group whatever its capitals: Sales 700 and Rent -100 go to Profit & Loss A/c (%s)" % L["Profit & Loss A/c"]["open"])
    ok(r["marked"] == 0 and r["unmarked"] == 0 and r["held"] == 0 and r["missing"] == 0, "the same list again: nothing marked (%s)" % r)

    # 3. add-only: a ledger missing from the list is marked, not removed; why and by which list
    r = full([x for x in BASE if x[0] != "Rent"] + [["Delta Traders", "Sundry Debtors", "-40"]], BRIDGE)
    L = led()
    ok(r["marked"] == 1 and "Rent" in L and L["Rent"]["deleted_at"] != "" and L["Rent"]["deleted_reason"] == "missing from full list", "Rent, missing from the list, is kept and marked deleted: 'missing from full list' (%s)" % r)
    by = json.loads(L["Rent"]["by_list"] or "{}")
    ok(by.get("source") == "bridge ledgers" and by.get("device") == DEV and by.get("bridge") == "go-abc123" and by.get("computer") == "OFFICE-PC" and by.get("list_id") == r["list"] and by.get("at"),
       "the list it was missing from kept on the row: source, when, computer, bridge, list (%s)" % by)
    m = db.rows("select ledger, action, reason, source, device_id, list_id from tally_ledger_marks where ledger = 'Rent'")
    ok(len(m) == 1 and m[0]["action"] == "marked" and m[0]["device_id"] == DEV and m[0]["list_id"] == r["list"], "the mark logged (%s)" % m)
    ok("Delta Traders" in L and L["Delta Traders"]["deleted_at"] == "", "a new ledger in the list is added")
    ok(float(L["Profit & Loss A/c"]["open"]) == 700, "a deleted ledger's opening no longer counts (as when it was removed): P&L 700 without Rent's -100 (%s)" % L["Profit & Loss A/c"]["open"])
    bal = {x["ledger"]: x for x in db.rows("select ledger, closing from tally_balances where book_id = %s" % q(B))}
    ok("Rent" not in bal and float(bal["Cash"]["closing"]) == -1250, "tally_balances leaves out the deleted ledger (%s)" % sorted(bal))
    lst = db.rows("select source, listed, live_before, missing, marked, held, device_id from tally_ledger_lists where list_id = %s" % q(r["list"]))[0]
    ok(lst["source"] == "bridge ledgers" and lst["missing"] == "1" and lst["marked"] == "1" and lst["device_id"] == DEV, "the list kept (%s)" % lst)
    # listed again by a person's file: un-marked and logged, its opening back
    r = full(BASE + [["Delta Traders", "Sundry Debtors", "-40"]], PERSON)
    L = led()
    ok(r["unmarked"] == 1 and L["Rent"]["deleted_at"] == "" and L["Rent"]["deleted_reason"] == "" and L["Rent"]["by_list"] == "", "Rent listed again: un-marked, its reason cleared from the row (%s)" % r)
    m = db.rows("select action, reason, was_reason, source, by_user from tally_ledger_marks where ledger = 'Rent' order by id")
    ok([x["action"] for x in m] == ["marked", "unmarked"] and m[1]["reason"] == "listed again in a full list" and m[1]["was_reason"] == "missing from full list" and m[1]["by_user"] == U and m[1]["source"] == "upload_ledgers",
       "the un-mark logged, with who uploaded the list and why it had been marked (%s)" % m[1])
    ok(float(L["Profit & Loss A/c"]["open"]) == 600, "its opening counts again (%s)" % L["Profit & Loss A/c"]["open"])
    ok(L["Profit & Loss A/c"]["deleted_at"] == "", "FinCom's own Profit & Loss A/c (not in Tally's list) is never marked")

    # 4. the bulk safeguard: 40 ledgers; a list missing 30 (more than 25, and than 5%): none marked, held
    many = [["Party %02d" % i, "Sundry Debtors", "-1"] for i in range(40)]
    full(many, BRIDGE, book=BIG, frm="2025-10-01")
    r = full(many[:10], BRIDGE, book=BIG, frm="2025-10-01")
    L = led(BIG)
    ok(r["marked"] == 0 and r["held"] == 30 and all(L["Party %02d" % i]["deleted_at"] == "" for i in range(40)), "30 of 40 missing at once: none marked, 30 held (%s)" % {k: r[k] for k in ("marked", "held", "note")})
    ok(db.one("select count(*) from tally_ledger_marks where book_id = %s and action = 'held' and list_id = %s" % (q(BIG), q(r["list"]))) == "30", "each held ledger logged")
    # the next list misses 28 of them again (two came back): those 28 marked, on the second read
    r = full(many[:12], PERSON, book=BIG, frm="2025-10-01")
    L = led(BIG)
    gone = [n for n, x in L.items() if x["deleted_at"]]
    ok(r["marked"] == 28 and len(gone) == 28 and L["Party 39"]["deleted_reason"] == "missing from full list (and from the list before, which held it)", "the second list missing them too: the 28 marked (%s)" % {k: r[k] for k in ("marked", "held", "note")})
    ok(L["Party 10"]["deleted_at"] == "" and L["Party 11"]["deleted_at"] == "", "the two listed again are not marked")
    # a small gap (10 of 12, within 25): marked at once
    r = full(many[:2], BRIDGE, book=BIG, frm="2025-10-01")
    ok(r["marked"] == 10 and r["held"] == 0, "a gap within the limit (10, the limit 25) is marked at once (%s)" % {k: r[k] for k in ("marked", "held", "missing")})
    # an empty list marks nothing, ever
    for i in (1, 2):
        r = full([], BRIDGE, book=BIG, frm="2025-10-01")
        ok(r["marked"] == 0 and "empty" in (r["note"] or ""), "an empty list marks nothing (run %d: %s)" % (i, r["note"]))
    # every ledger listed again: all un-marked
    r = full(many, BRIDGE, book=BIG, frm="2025-10-01")
    ok(r["unmarked"] == 38 and not any(x["deleted_at"] for x in led(BIG).values()), "all listed again: the 38 marked are un-marked (%s)" % r["unmarked"])
    # two big gaps that differ: only the ledgers missing from both are marked, the rest held again
    r1 = full(many[:10], BRIDGE, book=BIG, frm="2025-10-01")          # Party 10-39 held
    r2 = full(many[30:], PERSON, book=BIG, frm="2025-10-01")         # Party 00-29 missing: 10-29 were held -> marked, 00-09 held
    L = led(BIG)
    ok(r1["held"] == 30 and r2["marked"] == 20 and r2["held"] == 10 and all(L["Party %02d" % i]["deleted_at"] for i in range(10, 30)) and not any(L["Party %02d" % i]["deleted_at"] for i in list(range(10)) + list(range(30, 40))),
       "a second big gap marks only what the list before held too (%s, %s)" % ({k: r1[k] for k in ("marked", "held")}, {k: r2[k] for k in ("marked", "held")}))

    # 5. entries are never removed by a list
    n0 = counts()
    try:
        full(BASE, BRIDGE, frm="2026-06-01")
        ok(False, "a list starting after kept entries went through")
    except RuntimeError as e:
        ok("entries before it" in str(e), "a list starting after entries already kept is refused, nothing changed")
    ok(counts() == n0 and db.one("select from_date from tally_books where book_id = %s" % q(B)) == "2026-04-01", "nothing changed by the refused list")
    full(BASE, BRIDGE, frm="2025-04-01")
    ok(int(db.one("select count(*) from tally_vouchers where book_id = %s" % q(B))) == 1, "a list starting earlier keeps the entries")
    full(BASE, BRIDGE, frm="2026-04-01")

    # 6. the tally-ingest deployed now calls the old functions (no p_list): add-only too
    db.sql("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, '[]'::jsonb)" % (q(B), js([x for x in BASE if x[0] != "Alpha Traders"])))
    L = led()
    ok("Alpha Traders" in L and L["Alpha Traders"]["deleted_reason"] == "missing from full list" and json.loads(L["Alpha Traders"]["by_list"])["source"] == "full list (source not given)",
       "the 5-argument tally_ingest_ledgers_g (tally-ingest before its redeploy): marks, never deletes")
    db.sql("select tally_ingest_ledgers(%s, '2026-04-01', '2026-03-31', %s)" % (q(B), js(BASE)))
    ok(led()["Alpha Traders"]["deleted_at"] == "", "the 4-argument tally_ingest_ledgers: add-only, un-marks")
    ok(int(db.one("select count(*) from tally_groups where book_id = %s" % q(B))) == len(GROUPS), "groups are never removed (a list without groups keeps them)")

    # 7. the bridge's own ledger list (migration-32, tally-ingest updating deleted_at): logged too
    db.sql("update tally_ledgers set deleted_at = now() where book_id = %s and name = 'Beta Traders'" % q(B))
    x = led()["Beta Traders"]
    ok(x["deleted_reason"] == "deleted or renamed in Tally (FinCom Bridge ledger list)" and json.loads(x["by_list"])["source"] == "bridge ledger_list", "a mark by the bridge's ledger list is explained and logged (%s)" % x["deleted_reason"])
    db.sql("update tally_ledgers set deleted_at = null where book_id = %s and name = 'Beta Traders'" % q(B))
    ok(db.one("select action || ':' || reason from tally_ledger_marks where ledger = 'Beta Traders' order by id desc limit 1") == "unmarked:listed again by FinCom Bridge", "and its un-mark")
    try:
        db.sql("delete from tally_ledger_marks")
        ok(False, "the log was emptied")
    except RuntimeError as e:
        ok("append-only" in str(e), "the log is append-only")

    # 8. a member: reads only their firm's marks and lists; cannot call the functions
    db.sql("grant usage on schema public, auth to authenticated; grant select on members, tally_ledger_marks, tally_ledger_lists to authenticated;")
    mine = db.one("set role authenticated; select count(*) from tally_ledger_marks;", U)
    all_ = db.one("select count(*) from tally_ledger_marks")
    db.sql("insert into tally_ledger_marks (book_id, firm_id, ledger, action) values (%s, %s, 'X', 'held')" % (q(B2), q(F2)))
    ok(db.one("set role authenticated; select count(*) from tally_ledger_marks;", U) == mine == all_ and db.one("set role authenticated; select count(*) from tally_ledger_marks;", U2) == "1",
       "a member sees their firm's marks only")
    for fn in ["tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', '[]', '[]', '{}')" % q(B), "tally_ingest_ledgers_list(%s, '2026-04-01', '2026-03-31', '[]', '{}')" % q(B)]:
        try:
            db.sql("set fincom.role = 'authenticated'; select " + fn + ";")
            ok(False, "a member called " + fn)
        except RuntimeError as e:
            ok("not allowed" in str(e), "a member is refused " + fn.split("(")[0])

    # 9. the owner's query: what was marked and why
    rows = db.rows("""select m.at, b.company, m.ledger, m.action, m.reason, m.source, m.by_user, m.device_id, m.bridge, m.list_id
      from tally_ledger_marks m join tally_books b on b.book_id = m.book_id order by m.at desc, m.ledger""")
    ok(len(rows) > 30 and {"marked", "unmarked", "held"} <= {x["action"] for x in rows}, "the owner's query runs (%d rows)" % len(rows))
finally:
    db.stop()

# 10. tally-ingest (server/tally-cloud/index.ts under Deno, against fake_supabase.py): a full list from the bridge goes
# with who sent it (p_list), and to a cloud without migration-33 without it
import shutil, hashlib, time, threading, urllib.request
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  (tally-ingest part skipped: no deno)")
else:
    import fake_supabase as FS
    KEY = "fcd_" + "a" * 48
    FS.T["clients"].append({"id": "c-1", "firm_id": "f-1", "name": "ZZ", "tally_name": "ZZ CO", "gstin": "", "deleted": False})
    FS.T["tally_companies"].append({"firm_id": "f-1", "company": "ZZ CO", "client_id": "c-1", "book_id": "b-1", "last_seen": "2026-10-01T00:00:00Z"})
    FS.T["tally_books"].append({"book_id": "b-1", "firm_id": "f-1", "client_id": "c-1", "company": "ZZ CO", "from_date": None})
    FS.T["tally_devices"].append({"id": DEV, "firm_id": "f-1", "name": "OFFICE-PC", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "wake_token": "w" * 64,
                                  "version": "2.1.4", "want_update_at": None, "want_sent_at": None})
    old33 = {"on": False}
    real = FS.rpc
    def rpc(fn, a):
        if old33["on"] and fn == "tally_ingest_ledgers_g" and "p_list" in a:
            FS.ARGS.setdefault("refused", []).append(a)
            raise RuntimeError("Could not find the function public.tally_ingest_ledgers_g(p_book, p_from, p_groups, p_ledgers, p_list, p_open_as_on) in the schema cache")
        return real(fn, a)
    FS.rpc = rpc
    FS.start()
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log = []
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    def call(body):
        rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
        try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    try:
        for i in range(60):
            try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
            except urllib.error.HTTPError: break
            except Exception: time.sleep(0.5)
        body = {"kind": "ledgers", "company": "ZZ CO", "from": "20260401", "openAsOn": "20260331", "ledgers": [["Cash", "Cash-in-Hand", "-10"]], "groups": [["Cash-in-hand", "Current Assets"]],
                "bridge": {"id": "go-abc123", "computer": "OFFICE-PC", "user": "accounts", "version": "2.1.4"}}
        c, r = call(body)
        a = (FS.ARGS.get("tally_ingest_ledgers_g") or [{}])[-1]
        ok(c == 200 and a.get("p_list") == {"source": "bridge ledgers", "device": DEV, "bridge": "go-abc123", "computer": "OFFICE-PC", "user": "accounts"},
           "tally-ingest sends the bridge's full list with who sent it (%s %s)" % (c, a.get("p_list")))
        old33["on"] = True
        n = len(FS.ARGS.get("tally_ingest_ledgers_g") or [])
        c, r = call(body)
        a = (FS.ARGS.get("tally_ingest_ledgers_g") or [{}])[-1]
        ok(c == 200 and len(FS.ARGS.get("refused") or []) == 1 and len(FS.ARGS["tally_ingest_ledgers_g"]) == n + 1 and "p_list" not in a and a.get("p_ledgers") == [["Cash", "Cash-in-Hand", "-10"]],
           "a cloud without migration-33: the call made again without p_list (%s)" % c)
    finally:
        fn.terminate()
        try: fn.wait(timeout=5)
        except Exception: fn.kill()
    if fails: print("".join(log[-30:]))
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
