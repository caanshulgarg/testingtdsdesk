"""python3 tests/run_migration164.py - server/tally-cloud/migration-164-gst-share.sql (next-gst-share, GST part A, shadow):
each entry's GST share kept (gst_share), month totals (gst_month), what the sweep saw (calc_seen), the days written
(tally_calc_dirty, by statement-level triggers) and the parity checks (calc_parity). On a throwaway PostgreSQL (pg_stand,
port 31864 unless PG164_PORT; never a real database), made-up rows only, after migrations 151, 153 and 159.
  0. the file: one transaction, lock_timeout 10 s; add-only (new tables with RLS on and explicit grants; new functions;
     the dirty-day triggers; deletes only of its own tables' rows); names no real database; md5
  1. run before 153 (or without 72/73's columns) it stops and says so; after them it runs (twice: one trigger each)
  2. the triggers: an insert, an update (a moved entry: both days), a delete, of entries, lines and bills, and a ledger
     rename (lines rewritten, AlterID the same) mark their days; one row per day however many rows
  3. the sweep: pick takes every new entry (months stale); put keeps the shares tests/run_gst_share.js worked out
     (tests/out/gst-share-parity.json) and gst_month gives exactly its month sums (fresh); then each change brings back
     exactly its entries: an edit (AlterID), the GST and TDS passes (their AlterIDs), cancelled, optional, deleted, an
     entry gone, a day written (a rename); an entry marked again after the pick stays due; a share of an entry not seen
     is refused
  4. the context: put keeps it; the entries on a ledger changed (a line or the party), named, or all are due
  5. members: anon and authenticated may not read calc_seen, gst_share, tally_calc_dirty nor call a function; a member
     reads gst_month and calc_parity of its own firm only; the service role's grants
  3b. (review) a month whose entries have no share (a receipt edited, an entry moved) ends fresh; an entry that fails is
     kept as an error and not picked again until it changes; two runs on one book: the second waits for the lease, a
     late put of the first is refused (lease lost); a day written again moves an already-due entry's due_at on; a share
     with no GUID is refused
  4b. backing off (10 minutes, doubling) and the timer's books (due: days written, entries due, no context; not leased,
     not backing off; nightly: books with sums); a parity not checked kept with ok null
  6. a book deleted takes every row of the new tables
  7. the triggers' cost: 100,000 entries (and 200,000 lines) inserted in one statement each, and 2,000 entries one
     statement each (as the recorder), with and without the triggers"""
import os, re, sys, json, time, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(ROOT, "server", "tally-cloud", "migration-164-gst-share.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read(); code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
NEW = ["tally_calc_dirty", "calc_seen", "gst_share", "gst_month", "calc_parity"]
ok(re.findall(r"create table if not exists public\.(\w+)", code) == NEW, "five new tables: " + ", ".join(NEW))
ok(all(("alter table public.%s enable row level security" % t) in code for t in NEW), "RLS on every one")
ok(all(re.search(r"create table if not exists public\.%s \([^;]*references public\.tally_books \(book_id\) on delete cascade" % t, code, re.S) for t in NEW), "every one goes with its book (on delete cascade)")
ok(not re.search(r"\b(drop|truncate)\b", code) and not re.search(r"alter\s+table\s+(?!public\.(%s)\s)" % "|".join(NEW), code), "add-only: nothing dropped or truncated; only its own tables altered")
dels = re.findall(r"delete from (\w+)", code)
ok(dels and all(d in ("gst_month", "gst_share", "calc_seen") for d in dels), "deletes only rows of its own tables (%s)" % sorted(set(dels)))
ok(sorted(re.findall(r"create trigger %i after (insert|update|delete)", code)) == ["delete", "insert", "update"] and "array['tally_vouchers', 'tally_lines', 'tally_bills']" in code
   and code.count("for each statement") == 3 and "referencing" in code and "tally_days" not in re.sub(r"--.*", "", text.lower()), "statement triggers on entries, lines and bills; tally_days never written")
FNS = {"gst_share_ctx_version": "(uuid)", "gst_share_ctx_get": "(uuid)", "gst_share_ctx_put": "(uuid, text, text, text, jsonb, text[], text[], boolean)", "gst_share_pick": "(uuid, integer)",
       "gst_share_rows": "(uuid, text[])", "gst_share_put": "(uuid, text, timestamptz, jsonb, jsonb, jsonb)", "gst_month_get": "(uuid, text)", "gst_parity_put": "(uuid, text, text, text, boolean, numeric, jsonb, jsonb)",
       "gst_share_lease": "(uuid, text, integer)", "gst_share_unlease": "(uuid, text)", "gst_share_backoff": "(uuid, text, text)", "gst_share_backoff_clear": "(uuid, text)",
       "gst_share_books_due": "(integer)", "gst_share_books_all": "(integer)"}
for fn, sig in FNS.items():
    ok(("revoke all on function public.%s%s from public, anon, authenticated;" % (fn, sig)) in text and ("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, fn + ": service role only")
INTERNAL = ["gst_share_month_sum", "gst_share_stale", "gst_share_holds", "tally_calc_dirty_ins", "tally_calc_dirty_del", "tally_calc_dirty_upd"]
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == sorted(list(FNS) + INTERNAL), "adds only its own functions")
ok(all(re.search(r"revoke all on function [^;]*public\.%s\([^;]*from public, anon, authenticated, service_role;" % f, text) for f in INTERNAL), "the internal ones granted to nobody")
ok("grant select on public.gst_month, public.calc_parity to authenticated;" in text and "grant select, insert, update, delete on public.calc_seen, public.gst_share, public.gst_month, public.calc_parity to service_role;" in text
   and "revoke all on public.tally_calc_dirty from public, anon, authenticated;" in text, "explicit grants on the tables")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczu", text.lower()), "names no real database")
ok(code.count("order by y.book_id, y.day") == 3, "the triggers' upserts in (book, day) order")
ok(code.count("(select public.my_firm())") == 2 and "= public.my_firm()" not in code, "the read policies use (select my_firm())")
ok("run it while tally sync is quiet" in text.lower() and "lock_timeout" in text.lower(), "the header says to run it while Tally sync is quiet (lock_timeout)")
ok("cron.schedule('gst-share-sweep', '* * * * *'" in text and "cron.schedule('gst-share-parity', '17 21 * * *'" in text and code.count("'x-cron-key'") == 2
   and "gst_share_books_due(3)" in text and "gst_share_books_all(200)" in text, "the timer: share_sweep every minute (3 books), share_parity nightly at 21:17 UTC, gst-taxpro's cron key")
T151 = open(os.path.join(ROOT, "server", "tally-cloud", "migration-151-cloud-calc-1.sql")).read()
T153 = open(os.path.join(ROOT, "server", "gst-run", "migration-153-gst-cloud.sql")).read(); T159 = open(os.path.join(ROOT, "server", "gst-run", "migration-159-gst-posfix.sql")).read()
PAR = os.path.join(HERE, "out", "gst-share-parity.json")
if not os.path.exists(PAR):
    subprocess.run(["node", os.path.join(HERE, "run_gst_share.js")], check=True, env=dict(os.environ, GST_SHARE_SCALE="1"))
P = json.load(open(PAR))
db = pg_stand.start(int(os.environ.get("PG164_PORT") or 31864))
q = lambda s: "'" + str(s).replace("'", "''") + "'"
J = lambda o: q(json.dumps(o))
try:
    F, F2, U, U2 = "99999999-9999-4999-8999-999999999164", "88888888-8888-4888-8888-888888888164", "55555555-5555-4555-8555-555555555164", "66666666-6666-4666-8666-666666666164"
    BK, BK2, BKM, BKN = P["book"], "bbbbbbbb-0164-4000-8000-000000000002", "bbbbbbbb-0164-4000-8000-0000000000aa", "bbbbbbbb-0164-4000-8000-0000000000bb"
    db.sql("""
    do $x$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $x$;
    alter table tally_ledgers add column if not exists deleted_at timestamptz;
    alter table tally_ledger_day add column if not exists merged_into text;
    alter table tally_vouchers add column if not exists deleted_at timestamptz;
    alter table tally_vouchers add column if not exists irn text, add column if not exists irn_ack_date date, add column if not exists gst_reg_type text, add column if not exists gst_country text,
      add column if not exists gst_rcm boolean, add column if not exists gst_nature text, add column if not exists gst_taxability text, add column if not exists gst_supply text,
      add column if not exists gst_ineligible boolean, add column if not exists gst_mixed boolean, add column if not exists gst_alter_id bigint;
    create sequence if not exists tl_id; alter table tally_lines add column if not exists id bigint default nextval('tl_id');
    create table if not exists tally_bills (book_id uuid, firm_id uuid, guid text, day date, ledger text, name text, type text, amount numeric, bill_date date, credit_days integer, due date, id bigserial primary key);
    create table if not exists tally_groups (book_id uuid, firm_id uuid, name text, parent text, primary key (book_id, name));
    create table if not exists clients (firm_id uuid, id text, data jsonb, deleted boolean default false, updated_at timestamptz default now(), primary key (firm_id, id));
    create table if not exists records (firm_id uuid, kind text, id text, client_id text, data jsonb, deleted boolean default false, updated_at timestamptz default now(), primary key (firm_id, kind, id));
    create table if not exists gst_2b_runs (id bigint generated always as identity primary key, firm_id uuid, client_id text, gstin text, fy text, status text, done_at timestamptz, result jsonb);
    create table if not exists gst_2b_decisions (firm_id uuid, gstin text, fy text, pair_id text, decision text, at timestamptz default now(), primary key (firm_id, gstin, fy, pair_id));
    insert into firms values ('%(F)s', 'Made-up Firm A'), ('%(F2)s', 'Made-up Firm B');
    insert into members values ('%(U)s', '%(F)s', 'A', 'viewer', true), ('%(U2)s', '%(F2)s', 'B', 'owner', true);
    insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('%(BK)s', '%(F)s', 'c1', 'Synthetic Traders', '2025-04-01', '2025-04-01'),
      ('%(BK2)s', '%(F2)s', 'c9', 'Other Made-up', '2025-04-01', '2025-04-01'), ('%(BKM)s', '%(F)s', 'cm', 'Measure One', '2025-04-01', '2025-04-01'), ('%(BKN)s', '%(F)s', 'cn', 'Measure Two', '2025-04-01', '2025-04-01');
    """ % dict(F=F, F2=F2, U=U, U2=U2, BK=BK, BK2=BK2, BKM=BKM, BKN=BKN))
    db.sql("grant usage on schema auth to anon, authenticated, service_role; grant select on members, firms to authenticated;")
    db.sql(T151); db.sql(T153); db.sql(T159)

    # 7 (first half): the cost without the triggers
    def bulk(book, n, tag):
        t0 = time.time()
        db.sql("""insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional)
                  select '%s', '%s', '%s-' || g, date '2025-04-01' + (g %% 365), g, 'Sales', 'S/' || g, 'Made-up Party ' || (g %% 500), false, false from generate_series(1, %d) g;""" % (book, F, tag, n))
        db.sql("""insert into tally_lines (book_id, firm_id, guid, day, ledger, amount)
                  select '%s', '%s', '%s-' || g, date '2025-04-01' + (g %% 365), case when k = 1 then 'Made-up Party ' || (g %% 500) else 'Sales - Goods' end, case when k = 1 then -1180 else 1180 end
                    from generate_series(1, %d) g, generate_series(1, 2) k;""" % (book, F, tag, n))
        t1 = time.time()
        db.sql("""do $m$ begin for i in 1..2000 loop
                    insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional) values ('%s', '%s', '%s-r' || i, date '2025-04-01' + (i %% 365), i, 'Sales', 'R/' || i, 'Made-up Party 1', false, false);
                    insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values ('%s', '%s', '%s-r' || i, date '2025-04-01' + (i %% 365), 'Sales - Goods', 100), ('%s', '%s', '%s-r' || i, date '2025-04-01' + (i %% 365), 'Made-up Party 1', -100);
                  end loop; end $m$;""" % (book, F, tag, book, F, tag, book, F, tag))
        return t1 - t0, time.time() - t1
    a_bulk, a_one = bulk(BKM, 100000, "m")

    print("== 1. order and reruns")
    try: db.sql(text); ok(False, "164 without 72/73's columns should stop")
    except RuntimeError as e: ok("needs migration 153" in str(e), "without the entry columns of 72 and 73: stops and says so")
    db.sql("alter table tally_vouchers add column if not exists tds_tally jsonb, add column if not exists tds_tally_alter_id bigint;")
    db.sql(text); db.sql(text)
    M165 = os.path.join(ROOT, "server", "tally-cloud", "migration-165-gst-share-rows-speed.sql")
    if os.path.exists(M165): db.sql(open(M165).read()); db.sql(open(M165).read())   # migration 165: gst_share_rows made fast, same answer
    M166 = os.path.join(ROOT, "server", "tally-cloud", "migration-166-gst-share-rows-index.sql")
    if os.path.exists(M166): db.sql(open(M166).read()); db.sql(open(M166).read())   # migration 166: gst_share_rows by index per entry, same answer
    M167 = os.path.join(ROOT, "server", "tally-cloud", "migration-167-gst-share-books-due.sql")
    if os.path.exists(M167): db.sql(open(M167).read()); db.sql(open(M167).read())   # migration 167: a book with an entry never worked out is due
    ok(db.one("select count(*) from pg_trigger where tgname like '%_calc_dirty_%' and not tgisinternal") == "9", "after them: runs, twice; nine triggers (three tables x insert, update, delete), none twice")

    b_bulk, b_one = bulk(BKN, 100000, "n")
    print("== 7. the triggers' cost")
    print("  (100,000 entries + 200,000 lines, one statement each: %.2f s without, %.2f s with (+%.0f%%); 2,000 entries one by one: %.2f s without, %.2f s with (+%.0f%%))"
          % (a_bulk, b_bulk, (b_bulk / a_bulk - 1) * 100, a_one, b_one, (b_one / a_one - 1) * 100))
    ok(db.one("select count(*) from tally_calc_dirty where book_id = '%s'" % BKN) == "365" and db.one("select count(*) from tally_calc_dirty where book_id = '%s'" % BKM) == "0",
       "one dirty row per day written (365), none for the book written before")
    per = (b_one - a_one) / 6000 * 1000
    print("  (one by one: about %.3f ms more a statement; 6,000 statements)" % per)
    ok(b_bulk - a_bulk < 1.5 and per < 0.5, "the triggers cost little (under 1.5 s more for 300,000 rows in two statements, under 0.5 ms a statement one by one)")
    db.sql("delete from tally_books where book_id in ('%s', '%s')" % (BKM, BKN))

    print("== 2. the triggers")
    dirty = lambda: dict((r["day"], r["changed_at"]) for r in db.rows("select day::text, changed_at::text from tally_calc_dirty where book_id = '%s'" % BK))
    # the made-up book: one entry per GUID of the parity file, on the day of its month
    guids = sorted(set(s["guid"] for s in P["shares"]))
    ymOf = {s["guid"]: s["ym"] for s in P["shares"]}
    day = lambda g: ymOf[g][:4] + "-" + ymOf[g][4:] + "-%02d" % (1 + guids.index(g) % 27)
    vals = ",".join("('%s', '%s', %s, %s, %d, 'Sales', 'S/%d', 'Made-up Buyer', false, false, %d)" % (BK, F, q(g), q(day(g)), i + 1, i + 1, i + 1) for i, g in enumerate(guids))
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional, gst_alter_id) values %s;" % vals)
    db.sql("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) select book_id, firm_id, guid, day, 'Sales - Goods', 100 from tally_vouchers where book_id = '%s';" % BK)
    db.sql("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) select book_id, firm_id, guid, day, 'Made-up Buyer', -100 from tally_vouchers where book_id = '%s';" % BK)
    d0 = dirty(); ndays = len(set(day(g) for g in guids))
    ok(len(d0) == ndays, "inserts: each day of the entries marked once (%d days, %d entries, 2 statements of lines)" % (ndays, len(guids)))
    g0, g1 = guids[0], guids[1]
    db.sql("update tally_vouchers set day = '2025-12-28' where book_id = '%s' and guid = %s" % (BK, q(g0)))
    d1 = dirty()
    ok(d1.get(day(g0)) != d0.get(day(g0)) and "2025-12-28" in d1, "an entry moved: its old and its new day marked")
    db.sql("update tally_vouchers set day = %s where book_id = '%s' and guid = %s" % (q(day(g0)), BK, q(g0)))
    db.sql("insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount) values ('%s', '%s', %s, %s, 'Made-up Buyer', 'B1', 'New Ref', -100)" % (BK, F, q(g1), q(day(g1))))
    d2 = dirty(); ok(d2[day(g1)] != d1[day(g1)], "a bill allocation written: its day marked")
    db.sql("delete from tally_bills where book_id = '%s'" % BK)
    d3 = dirty(); ok(d3[day(g1)] != d2[day(g1)], "a bill allocation deleted: its day marked")

    print("== 3. the sweep")
    RUN = "run-a"
    ok(db.one("select gst_share_lease('%s', 'run-a', 600)" % BK) == "t", "the run takes the book's lease")
    pick = lambda n=3000: json.loads(db.one("select gst_share_pick('%s', %d)::text" % (BK, n)))
    def put(p, shares, errors=None, run=None):
        return json.loads(db.one("select gst_share_put('%s', %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)::text" % (BK, q(run or RUN), q(p["at"]), J(shares), J(p["seen"]), J(errors or []))))
    month = lambda ym: json.loads(db.one("select gst_month_get('%s', %s)::text" % (BK, q(ym))))
    p = pick(50)
    ok(p["ok"] and p["due"] == len(guids) and len(p["guids"]) == 50 and p["more"], "the first pick: every entry new (%d due), 50 taken, more" % p["due"])
    ok(db.one("select count(*) from gst_month where book_id = '%s' and sec = '*' and status = 'stale'" % BK) == str(len(P["months"])), "their months marked stale (%d)" % len(P["months"]))
    ok(all(set(x) >= {"guid", "day", "alter_id", "gst_alter_id", "tds_alter_id", "deleted", "cancelled", "optional", "gone"} for x in p["seen"]), "the pick says what the copy holds of each (AlterIDs, deleted, cancelled, optional)")
    while True:
        took = set(p["guids"]); r = put(p, [s for s in P["shares"] if s["guid"] in took])
        if not r["ok"]: ok(False, "put: " + json.dumps(r)); break
        if not p["more"]: break
        p = pick(50)
    ok(pick()["due"] == 0, "after the batches nothing is due")
    def same(ym):
        want = sorted(json.dumps([r["reg"], r["sec"], r["k1"], r["k2"], r["k3"], r["n"]] + ["%.2f" % float(r[f]) for f in ("taxable", "igst", "cgst", "sgst", "cess", "qty")]) for r in P["months"][ym])
        got = sorted(json.dumps([r["reg"], r["sec"], r["k1"], r["k2"], r["k3"], r["n"]] + ["%.2f" % float(r[f]) for f in ("taxable", "igst", "cgst", "sgst", "cess", "qty")]) for r in month(ym) if r["sec"] != "*")
        return want == got
    ok(all(same(ym) for ym in P["months"]), "gst_month: every month's sums exactly those run_gst_share.js checked against the engine (%d months, %d rows)" % (len(P["months"]), sum(len(v) for v in P["months"].values())))
    ok(db.one("select count(*) from gst_month where book_id = '%s' and status <> 'fresh'" % BK) == "0", "every month fresh")
    ym1 = ymOf[g1]
    head = lambda ym: [r for r in month(ym) if r["sec"] == "*"][0]
    ok(head(ym1)["n"] == len(set(s["guid"] for s in P["shares"] if s["ym"] == ym1)), "the month's own row counts its entries")
    def due_after(sql_):
        db.sql(sql_); p = pick(); return p, sorted(p["guids"])
    keep = lambda g: [s for s in P["shares"] if s["guid"] == g]
    # an edit (a later AlterID): that entry alone; its month stale until put
    p, gs = due_after("update tally_vouchers set alter_id = alter_id + 1000 where book_id = '%s' and guid = %s" % (BK, q(g1)))
    same_day = sorted(x for x in guids if day(x) == day(g1))
    ok(gs == same_day, "an edit: the entry due, with the entries of the day it was written on (%d)" % len(gs))
    ok(head(ym1)["status"] == "stale", "its month stale")
    put(p, [s for s in P["shares"] if s["guid"] in set(gs)])
    ok(head(ym1)["status"] == "fresh" and same(ym1), "worked out again: fresh, the same sums")
    # the GST and TDS passes write the columns alone (no day of line written)
    for col, w in (("gst_alter_id", "the GST pass (gst_alter_id)"), ("tds_tally_alter_id", "the TDS pass (tds_tally_alter_id)"), ("cancelled", "cancelled"), ("optional", "optional")):
        expr = "not coalesce(%s, false)" % col if col in ("cancelled", "optional") else "coalesce(%s, 0) + 7" % col
        db.sql("update tally_vouchers set %s = %s where book_id = '%s' and guid = %s" % (col, expr, BK, q(g1)))
        db.sql("delete from tally_calc_dirty where book_id = '%s'" % BK)    # (the day's mark aside: the column alone brings it back)
        p = pick(); ok(p["guids"] == [g1], w + ": the entry due")
        put(p, keep(g1) if col not in ("cancelled", "optional") else [])
        if col in ("cancelled", "optional"):
            ok(db.one("select count(*) from gst_share where book_id = '%s' and guid = %s" % (BK, q(g1))) == "0" and not same(ym1), w + ": its share gone, the month's sums without it")
            db.sql("update tally_vouchers set %s = false where book_id = '%s' and guid = %s" % (col, BK, q(g1))); db.sql("delete from tally_calc_dirty where book_id = '%s'" % BK)
            p = pick(); put(p, keep(g1))
    ok(same(ym1), "back: the same sums")
    # deleted, and gone from the copy
    db.sql("update tally_vouchers set deleted_at = now() where book_id = '%s' and guid = %s" % (BK, q(g1))); db.sql("delete from tally_calc_dirty where book_id = '%s'" % BK)
    p = pick(); ok(p["guids"] == [g1] and p["seen"][0]["deleted"], "deleted: the entry due, seen as deleted")
    put(p, [])
    db.sql("delete from tally_lines where book_id = '%s' and guid = %s; delete from tally_vouchers where book_id = '%s' and guid = %s" % (BK, q(g1), BK, q(g1)))
    p = pick(); ok(g1 in p["guids"] and [x for x in p["seen"] if x["guid"] == g1][0]["gone"], "gone from the copy: due, seen as gone")
    put(p, []); ok(db.one("select count(*) from calc_seen where book_id = '%s' and key = %s" % (BK, q(g1))) == "0" and pick()["due"] == 0, "and forgotten once put")
    # a rename: lines rewritten, the AlterIDs the same
    p, gs = due_after("update tally_lines set ledger = 'Sales - Goods (renamed)' where book_id = '%s' and guid = %s and ledger = 'Sales - Goods'" % (BK, q(g0)))
    ok(g0 in gs and gs == sorted(x for x in guids if day(x) == day(g0)), "a ledger renamed (AlterID the same): the entries of its days due")
    # marked again after the pick: stays due
    db.sql("update calc_seen set due = true, due_at = clock_timestamp() where book_id = '%s' and key = %s" % (BK, q(g0)))
    put(p, [s for s in P["shares"] if s["guid"] in set(gs)])
    ok(db.one("select due from calc_seen where book_id = '%s' and key = %s" % (BK, q(g0))) == "t", "an entry marked again after the pick stays due after the put")
    p = pick(); put(p, [s for s in P["shares"] if s["guid"] in set(p["guids"])])
    bad = put(pick(), [{"guid": "not-seen", "ym": "202504", "sec": "3B.sale"}])
    ok(not bad["ok"] and "not seen" in bad["error"], "a share of an entry not seen: refused")
    pn = pick(); bad = put(pn, [{"guid": None, "ym": "202504", "sec": "3B.sale"}])
    ok(not bad["ok"] and db.one("select count(*) from gst_share where guid is null or guid = ''") == "0", "a share with no GUID: refused, nothing kept")
    # M1: an entry with no GST (a receipt) in a month with no share: the month ends fresh, with no rows but its own
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional) values ('%s', '%s', 'rcpt-1', '2026-06-10', 5001, 'Receipt', 'R/1', 'Made-up Buyer', false, false)" % (BK, F))
    p = pick()
    ok(p["guids"] == ["rcpt-1"] and head("202606")["status"] == "stale", "a receipt in a month with no GST: due, its month stale")
    put(p, []); ok(head("202606")["status"] == "fresh" and len(month("202606")) == 1, "worked out (no share): the month fresh, with no rows but its own")
    db.sql("update tally_vouchers set alter_id = 5002, narration = 'edited' where book_id = '%s' and guid = 'rcpt-1'" % BK)
    p = pick(); ok(p["guids"] == ["rcpt-1"] and head("202606")["status"] == "stale", "the receipt edited: due, the month stale")
    put(p, []); ok(head("202606")["status"] == "fresh", "worked out again: the month fresh (not stuck stale)")
    db.sql("update tally_vouchers set day = '2026-07-02', alter_id = 5003 where book_id = '%s' and guid = 'rcpt-1'" % BK)
    p = pick(); put(p, [])
    ok(head("202606")["status"] == "fresh" and head("202607")["status"] == "fresh", "moved to another month: both months summed again, fresh")
    # L4: an entry whose share failed: kept as an error, its month stale, not picked again until it changes
    p, gs = due_after("update tally_vouchers set alter_id = alter_id + 1 where book_id = '%s' and guid = %s" % (BK, q(guids[3])))
    put(p, [s_ for s_ in P["shares"] if s_["guid"] in set(gs) and s_["guid"] != guids[3]], [{"guid": guids[3], "error": "made-up failure"}])
    ok(db.one("select status || ':' || error from calc_seen where book_id = '%s' and key = %s" % (BK, q(guids[3]))) == "error:made-up failure", "an entry that failed: status error, with its words")
    ok(head(ymOf[guids[3]])["status"] == "stale" and pick()["due"] == 0, "its month stale; not picked again while it is unchanged")
    p, gs = due_after("update tally_vouchers set alter_id = alter_id + 1 where book_id = '%s' and guid = %s" % (BK, q(guids[3])))
    ok(guids[3] in gs, "changed: picked again")
    put(p, [s_ for s_ in P["shares"] if s_["guid"] in set(gs)])
    ok(db.one("select status from calc_seen where book_id = '%s' and key = %s" % (BK, q(guids[3]))) == "ok" and head(ymOf[guids[3]])["status"] == "fresh" and same(ymOf[guids[3]]), "worked out: ok, the month fresh and its sums as before")
    # M2: two runs on one book
    ok(db.one("select gst_share_lease('%s', 'run-b', 60)" % BK) == "f", "a second run while the first holds the book: no lease (the book skipped)")
    pa, gs = due_after("update tally_vouchers set alter_id = alter_id + 1 where book_id = '%s' and guid = %s" % (BK, q(guids[4])))
    db.sql("update calc_seen set data = jsonb_build_object('until', clock_timestamp() - interval '1 second') where book_id = '%s' and kind = 'book' and key = 'lease'" % BK)
    ok(db.one("select gst_share_lease('%s', 'run-b', 60)" % BK) == "t", "the first run's lease run out: the second takes the book")
    db.sql("update tally_lines set amount = amount + 1 where book_id = '%s' and guid = %s and ledger = 'Sales - Goods'" % (BK, q(guids[4])))
    pb = pick()
    r = put(pa, [s_ for s_ in P["shares"] if s_["guid"] in set(gs)])
    ok(not r["ok"] and r["error"] == "lease lost", "the first run's late put: refused (lease lost), nothing saved over the second's")
    ok(db.one("select due from calc_seen where book_id = '%s' and key = %s" % (BK, q(guids[4]))) == "t", "the entry still due")
    put(pb, [s_ for s_ in P["shares"] if s_["guid"] in set(pb["guids"])], run="run-b")
    ok(db.one("select due from calc_seen where book_id = '%s' and key = %s" % (BK, q(guids[4]))) == "f", "the second run's put saves it")
    ok(db.one("select gst_share_unlease('%s', 'run-a')" % BK) == "f" and db.one("select gst_share_unlease('%s', 'run-b')" % BK) == "t" and db.one("select gst_share_lease('%s', 'run-a', 600)" % BK) == "t", "only the holder lets the lease go")
    # a day written again while an entry is already due: due_at moves on, so the earlier pick's put leaves it due
    p1, gs = due_after("update tally_vouchers set alter_id = alter_id + 1 where book_id = '%s' and guid = %s" % (BK, q(guids[5])))
    db.sql("update tally_lines set amount = amount + 1 where book_id = '%s' and guid = %s and ledger = 'Sales - Goods'" % (BK, q(guids[5])))
    p2 = pick()
    put(p1, [s_ for s_ in P["shares"] if s_["guid"] in set(gs)])
    ok(db.one("select due from calc_seen where book_id = '%s' and key = %s" % (BK, q(guids[5]))) == "t", "an entry already due whose day is written again: an earlier pick's put leaves it due")
    p = pick(); put(p, [s_ for s_ in P["shares"] if s_["guid"] in set(p["guids"])])
    _p = pick()
    ok(_p["due"] == 0 and all(same(ym) for ym in P["months"] if ym != ymOf[g1]), "and the next sweep: nothing due, every month as before (but the one whose entry was deleted above)")
    rows = json.loads(db.one("select gst_share_rows('%s', array[%s, 'nope'])::text" % (BK, q(g0))))
    ok(len(rows["heads"]) == 1 and rows["heads"][0][0] == g0 and len(rows["heads"][0]) == 28 and set(rows["ledgers"]) == {"Made-up Buyer", "Sales - Goods (renamed)"}, "gst_share_rows: the entries asked for, in gst_calc_rows' form")

    print("== 4. the context")
    v = db.one("select gst_share_ctx_version('%s')" % BK)
    r = json.loads(db.one("select gst_share_ctx_put('%s', 'run-a', %s, 'e1', '{\"map\": {}}'::jsonb, array['Made-up Buyer'], '{}', false)::text" % (BK, q(v))))
    live = int(db.one("select count(*) from tally_vouchers where book_id = '%s'" % BK))
    ok(r["ok"] and r["due"] == live, "a ledger changed (the party of every entry): every entry on it due (%s)" % r["due"])
    ok(json.loads(db.one("select gst_share_ctx_get('%s')::text" % BK))["stamp"] == v, "kept with its version")
    p = pick(); put(p, [s for s in P["shares"] if s["guid"] in set(p["guids"])])
    r = json.loads(db.one("select gst_share_ctx_put('%s', 'run-a', %s, 'e1', '{}'::jsonb, '{}', array[%s], false)::text" % (BK, q(v), q(guids[2]))))
    ok(r["due"] == 1, "an entry named (a place of supply typed): it alone")
    p = pick(); put(p, keep(guids[2]))
    r = json.loads(db.one("select gst_share_ctx_put('%s', 'run-a', %s, 'e2', '{}'::jsonb, '{}', '{}', true)::text" % (BK, q(v))))
    ok(r["due"] == live, "all (a new engine): every entry")
    p = pick(); put(p, [s for s in P["shares"] if s["guid"] in set(p["guids"])])
    db.sql("insert into client_book_items (firm_id, client_id, key, item, data, seq) values ('%s', 'c1', 'map', 'Sales - Goods', '{\"kind\": \"\"}', 9)" % F)
    ok(db.one("select gst_share_ctx_version('%s')" % BK) != v, "the version moves with the ledger list")
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent) values ('%s', '%s', 'Made-up Buyer', 'Sundry Debtors')" % (BK, F))
    v2 = db.one("select gst_share_ctx_version('%s')" % BK); db.sql("update tally_ledgers set parent = 'Sundry Creditors' where book_id = '%s'" % BK)
    ok(db.one("select gst_share_ctx_version('%s')" % BK) != v2, "and with a ledger's group")
    ok(db.one("select gst_parity_put('%s', '202504', '07', 'e2', true, 0, '[]', '{\"status\": \"fresh\"}')" % BK) is not None, "a parity check kept")
    ok(db.one("select gst_parity_put('%s', '202505', '', 'e2', null, 0, '[]', '{\"skipped\": \"over the run''s time\"}')" % BK) is not None
       and db.one("select ok is null from calc_parity where ym = '202505'") == "t", "a parity not checked: kept with ok null and the reason")
    ok(db.one("select gst_share_ctx_put('%s', 'run-x', %s, 'e1', '{}'::jsonb, '{}', '{}', false)::text" % (BK, q(v))) == '{"ok": false, "error": "lease lost"}', "the context's put: refused without the lease")
    print("== 4b. backing off, and the timer's books")
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('%s', '%s', 'c3', 'Third Made-up', '2025-04-01', '2025-04-01')" % ("bbbbbbbb-0164-4000-8000-000000000003", F))
    B3 = "bbbbbbbb-0164-4000-8000-000000000003"
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional) values ('%s', '%s', 'b3-1', '2025-05-05', 1, 'Sales', 'S/1', 'Made-up Buyer', false, false)" % (B3, F))
    due = lambda: [r["book_id"] for r in db.rows("select book_id from gst_share_books_due(5)")]
    ok(B3 in due() and BK not in due(), "books due: one with days written and no context; not the one leased by a run going (%s)" % due())
    u1 = db.one("select gst_share_backoff('%s', 'ctx', 'too big')" % B3); u2 = db.one("select gst_share_backoff('%s', 'ctx', 'too big')" % B3)
    ok(B3 not in due() and db.one("select (data->>'n')::int from calc_seen where book_id = '%s' and key = 'backoff:ctx'" % B3) == "2"
       and db.one("select %s::timestamptz - now() > interval '19 minutes'" % q(u2)) == "t", "backing off: left out of the books due; 10 minutes, then 20")
    ok(json.loads(db.one("select gst_share_ctx_get('%s')::text" % B3))["backoff"] is not None, "ctx_get says until when")
    db.sql("select gst_share_backoff_clear('%s', 'ctx')" % B3)
    ok(B3 in due(), "cleared: due again")
    db.sql("select gst_share_unlease('%s', 'run-a')" % BK)
    ok(BK in [r["book_id"] for r in db.rows("select book_id from gst_share_books_all(10)")] and B3 not in [r["book_id"] for r in db.rows("select book_id from gst_share_books_all(10)")], "the nightly parity's books: those with sums")

    print("== 5. members")
    for role in ("anon", "authenticated"):
        for s in ("select count(*) from calc_seen", "select count(*) from gst_share", "select count(*) from tally_calc_dirty", "select gst_share_pick('%s', 1)" % BK,
                  "select gst_month_get('%s', '202504')" % BK, "select gst_share_put('%s', 'r', now(), '[]', '[]', '[]')" % BK, "select gst_share_lease('%s', 'r', 60)" % BK, "select * from gst_share_books_due(1)"):
            try: db.sql("set role %s; %s;" % (role, s)); ok(False, role + " may not: " + s)
            except RuntimeError as e: ok("permission denied" in str(e), role + " may not: " + s.split("(")[0][:40])
    try: db.sql("set role anon; select count(*) from gst_month;"); ok(False, "anon may not read gst_month")
    except RuntimeError as e: ok("permission denied" in str(e), "anon may not read gst_month")
    db.sql("insert into gst_month (book_id, firm_id, ym, sec, status) values ('%s', '%s', '202504', '*', 'fresh')" % (BK2, F2))
    mine = db.one("set role authenticated; select count(*) from gst_month;", U); theirs = db.one("set role authenticated; select count(*) from gst_month;", U2)
    ok(int(mine) > 1 and theirs == "1", "a member reads gst_month of its own firm only (%s / %s)" % (mine, theirs))
    ok(db.one("set role authenticated; select count(*) from calc_parity;", U) == "2" and db.one("set role authenticated; select count(*) from calc_parity;", U2) == "0", "and calc_parity")
    try: db.sql("set role authenticated; delete from gst_month;", U); ok(False, "a member may not write")
    except RuntimeError as e: ok("permission denied" in str(e), "a member may not write gst_month")

    print("== 6. a book deleted")
    db.sql("delete from tally_vouchers where book_id = '%s'; delete from tally_lines where book_id = '%s'; delete from tally_books where book_id = '%s'" % (BK, BK, BK))
    db.sql("delete from tally_vouchers where book_id = '%s'; delete from tally_books where book_id = '%s'" % (B3, B3))
    ok(all(db.one("select count(*) from %s where book_id = '%s'" % (t, BK)) == "0" for t in NEW), "takes every row of the new tables with it")
finally:
    db.stop()
print("all ok" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
