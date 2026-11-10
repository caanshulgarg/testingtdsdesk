"""python3 tests/run_migration153.py - server/gst-run/migration-153-gst-cloud.sql (next-cloud-gst, 09-Nov-2026): the version a
cloud 3B is kept by, a member's read of the kept 3B, the background queue. On a throwaway PostgreSQL (pg_stand, port 31867
unless PG153_PORT;
never a real database), made-up rows only.
153 needs migration 151 (branch next-cloud-calc1: tally_calc_results, tally_calc_version). 151 is taken from
server/tally-cloud/migration-151-cloud-calc-1.sql when this branch has it, else from commit 37fcf2489 (git show).
  0. the file: one transaction, lock_timeout 10 s; add-only (one new table, the queue, RLS on; nothing dropped, deleted
     or altered); grants explicit (members: gst_calc_cached only; the rest service role only); names no real database
  1. run before 151 it stops and says so; after 151, it runs (twice)
  2. gst_calc_version moves on every input of a 3B: an entry, a line, a 2B month, an IMS decision, a figure typed into 3B,
     a return marked filed, a GST setting, the ledger list, the client's record, a marketplace sale, a 2B matching run and
     a decision on it; it stays the same when nothing changed and when another client's or another firm's rows change
  3. gst_calc_cached: a member reads the kept 3B while it is current, nothing after a change; another firm's member reads
     nothing; anon and authenticated may not call gst_calc_version; the month's book is tally_pick's (gst_calc_book)
  4. the queue: no trigger on any table; gst_calc_want (true only when a run may start), _want_book (tally-ingest), _poke
     (a member, its own firm's client); gst_calc_take (one client at a time, never one taken in the last 2 minutes, not
     again within 20 seconds of a run, marked too big after 3 runs taken and never finished); gst_calc_done keeps a client
     wanted again during its run, drops it otherwise; too big shown by gst_calc_cached
  5. the timer: no pg_cron here, so none is made (the migration says so and runs)
  The version counts exactly the work keys of server/_shared/gst3bprint.js's GST3B_KEYS: each one moves it, another does not"""
import os, re, sys, json, subprocess, time
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand
M153 = os.path.join(ROOT, "server", "gst-run", "migration-153-gst-cloud.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

text = open(M153).read(); code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(re.findall(r"create table if not exists public\.(\w+)", code) == ["gst_calc_queue"] and "alter table public.gst_calc_queue enable row level security" in code and "revoke all on public.gst_calc_queue from public, anon, authenticated;" in text, "one new table (the queue), RLS on, no member grant")
drops = re.findall(r"\bdrop\s+(trigger|function)\s+if\s+exists\s+(?:(\w+)\s+on\s+public\.\w+|public\.(\w+)\()", code)
ok(all((d[1] or d[2]).startswith("gst_calc_") for d in drops) and len(re.findall(r"\bdrop\s", code)) == len(drops) and not re.search(r"\btruncate\s", code)
   and "delete from gst_calc_queue" in code and code.count("delete from") == 1 and not re.search(r"\balter\s+table\s+(?!public\.gst_calc_queue\s)", code),
   "add-only: the only drops are this migration's own earlier drafts (gst_calc_* triggers and functions, if there: %d), the one delete the queue's own row, no other table altered" % len(drops))
SVC = {"gst_calc_rows": "(uuid)", "gst_calc_book": "(uuid, text, text)", "gst_calc_book_months": "(uuid, text, text)", "gst_calc_gstins": "(uuid, text)", "gst_calc_version": "(uuid, text)",
       "gst_calc_held": "(bigint)", "gst_calc_want": "(uuid, text, text, text, bigint)", "gst_calc_want_book": "(uuid, text, bigint)", "gst_calc_take": "(integer)", "gst_calc_done": "(uuid, text, boolean, boolean, boolean, text)"}
for fn, sig in SVC.items():
    ok(("revoke all on function public.%s%s from public, anon, authenticated;" % (fn, sig)) in text and ("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, fn + ": service role only")
ok("revoke all on function public.gst_calc_cached(text, text, text) from public, anon;" in text and "grant execute on function public.gst_calc_cached(text, text, text) to authenticated, service_role;" in text, "gst_calc_cached: members (the month's book worked out from the month, not given by the caller)")
ok("revoke all on function public.gst_calc_poke(text) from public, anon;" in text and "grant execute on function public.gst_calc_poke(text) to authenticated, service_role;" in text, "gst_calc_poke: members")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == sorted(list(SVC) + ["gst_calc_cached", "gst_calc_poke"]), "adds only its own functions")
ok("create trigger" not in code and "trigger" not in re.sub(r"drop trigger if exists gst_calc_\w+ on public\.\w+;|no trigger", "", code), "no trigger made on any table (the queue is filled explicitly; an earlier draft's are dropped)")
ok("perform cron.schedule('gst-run-warm'" in code and "to_regprocedure('cron.schedule(text,text,text)') is null" in code and "gst_cron_key" in code and "fincom_project_url" in code, "the timer: pg_cron gst-run-warm, made only where pg_cron, pg_net and both Vault secrets are")
KEYS = json.loads("[" + re.search(r"const GST3B_KEYS = \[([^\]]*)\]", open(os.path.join(ROOT, "server", "_shared", "gst3bprint.js")).read()).group(1) + "]")
ok(re.search(r"i\.key = any \(array\[([^\]]*)\]", text).group(1).replace("'", '"').replace(" ", "") == json.dumps(KEYS).strip("[]").replace(" ", ""), "the version's keys are GST3B_KEYS (%d)" % len(KEYS))
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczucr", text.lower()), "names no real database")

m151 = os.path.join(ROOT, "server", "tally-cloud", "migration-151-cloud-calc-1.sql")
t151 = open(m151).read() if os.path.exists(m151) else subprocess.run(["git", "-C", ROOT, "show", "37fcf2489:server/tally-cloud/migration-151-cloud-calc-1.sql"], capture_output=True, text=True).stdout
if not t151.strip():
    print("  SKIP: migration 151 is not in this checkout (commit 37fcf2489 not fetched): sections 1 to 3 need it"); sys.exit(1 if fails else 0)

db = pg_stand.start(int(os.environ.get("PG153_PORT") or 31867))
try:
    F, F2, U, U2 = "99999999-9999-4999-8999-999999999153", "88888888-8888-4888-8888-888888888153", "55555555-5555-4555-8555-555555555153", "66666666-6666-4666-8666-666666666153"
    BK, BK2 = "bbbbbbbb-0153-4000-8000-000000000001", "bbbbbbbb-0153-4000-8000-000000000002"
    db.sql("""
    do $x$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $x$;
    alter table tally_ledgers add column if not exists deleted_at timestamptz;
    alter table tally_ledger_day add column if not exists merged_into text;
    alter table tally_vouchers add column if not exists deleted_at timestamptz;
    -- the entry's columns gst-run reads, as on staging (migrations 57 and 72)
    alter table tally_vouchers add column if not exists irn text, add column if not exists irn_ack_date date, add column if not exists gst_reg_type text, add column if not exists gst_country text,
      add column if not exists gst_rcm boolean, add column if not exists gst_nature text, add column if not exists gst_taxability text, add column if not exists gst_supply text,
      add column if not exists gst_ineligible boolean, add column if not exists gst_mixed boolean, add column if not exists gst_alter_id bigint;
    alter table tally_lines add column if not exists id bigint;
    create table if not exists tally_bills (book_id uuid, firm_id uuid, guid text, day date, ledger text, name text, type text, amount numeric, bill_date date, credit_days integer, due date, id bigint primary key);
    create table if not exists clients (firm_id uuid, id text, data jsonb, deleted boolean default false, updated_at timestamptz default now(), primary key (firm_id, id));
    create table if not exists records (firm_id uuid, kind text, id text, client_id text, data jsonb, deleted boolean default false, updated_at timestamptz default now(), primary key (firm_id, kind, id));
    create table if not exists gst_2b_runs (id bigint generated always as identity primary key, firm_id uuid, client_id text, gstin text, fy text, status text, done_at timestamptz, result jsonb);
    create table if not exists gst_2b_decisions (firm_id uuid, gstin text, fy text, pair_id text, decision text, at timestamptz default now(), primary key (firm_id, gstin, fy, pair_id));
    insert into firms values ('%(F)s', 'Made-up Firm A'), ('%(F2)s', 'Made-up Firm B');
    insert into members values ('%(U)s', '%(F)s', 'A', 'viewer', true), ('%(U2)s', '%(F2)s', 'B', 'owner', true);
    insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('%(BK)s', '%(F)s', 'c1', 'Synthetic Traders', '2025-04-01', '2025-04-01'), ('%(BK2)s', '%(F2)s', 'c1', 'Other', '2025-04-01', '2025-04-01');
    insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional, cmp_gstin) values ('%(BK)s', '%(F)s', 'g1', '2025-04-05', 1, 'Sales', '1', 'Birchwood Retail', false, false, '07AAKCS4821Q1ZW');
    insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, id) values ('%(BK)s', '%(F)s', 'g1', '2025-04-05', 'Sales - Goods', 1000, 1);
    insert into clients (firm_id, id, data) values ('%(F)s', 'c1', '{"name": "Synthetic Traders"}'), ('%(F)s', 'c2', '{"name": "Second"}');
    insert into client_book_items (firm_id, client_id, key, item, data, seq) values ('%(F)s', 'c1', 'map', '.Output CGST', '{"kind": "gst"}', 1), ('%(F)s', 'c1', 'twoBs', '', '{"$t": "obj"}', 2);
    """ % dict(F=F, F2=F2, U=U, U2=U2, BK=BK, BK2=BK2))
    print("== 1. 151 first")
    try: db.sql(text); ok(False, "153 before 151 should stop")
    except RuntimeError as e: ok("needs migration 151" in str(e), "run before 151: stops and says 151 comes first")
    db.sql(t151)
    draft = subprocess.run(["git", "-C", ROOT, "show", "6ad23becc:server/gst-run/migration-153-gst-cloud.sql"], capture_output=True, text=True).stdout
    if draft.strip():
        db.sql(draft)
        ok(db.one("select count(*) from pg_trigger where tgname like 'gst_calc_%'") == "6", "an earlier draft (6ad23becc, with its triggers) run first")
    prev = subprocess.run(["git", "-C", ROOT, "show", "0dea4d712:server/gst-run/migration-153-gst-cloud.sql"], capture_output=True, text=True).stdout
    if prev.strip(): db.sql(prev)     # and the one reviewed before this (want's delay in seconds, an integer)
    db.sql(text); db.sql(text)
    ok(not draft.strip() or (db.one("select count(*) from pg_trigger where tgname like 'gst_calc_%'") == "0" and db.one("select count(*) from pg_proc where proname in ('gst_calc_items_changed', 'gst_calc_vouchers_changed')") == "0"
       and db.one("select count(*) from information_schema.columns where table_name = 'gst_calc_queue' and column_name in ('attempts', 'too_big', 'big_n', 'rev', 'first_wanted', 'asked_at', 'after_msg')") == "7"
       and db.one("select count(*) from pg_proc where proname in ('gst_calc_want', 'gst_calc_want_book')") == "2"), "run over earlier drafts: their triggers and functions gone, the queue's new columns there, one gst_calc_want and one _want_book")
    ok(db.one("select count(*) from pg_proc where proname in ('gst_calc_version', 'gst_calc_cached')") == "2", "after 151: runs, twice")
    V = lambda: db.one("select gst_calc_version('%s', 'c1')" % BK)
    print("== 2. the version moves on every input")
    seq = [3]
    def nseq(): seq[0] += 1; return seq[0]
    def item(key, i, data): return "insert into client_book_items (firm_id, client_id, key, item, data, seq, updated_at) values ('%s', 'c1', '%s', '%s', '%s', %d, now()) on conflict (firm_id, client_id, key, item) do update set data = excluded.data, seq = excluded.seq, updated_at = now()" % (F, key, i, json.dumps(data).replace("'", "''"), nseq())
    steps = [
        ("an entry added", "insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional) values ('%s', '%s', 'g2', '2025-04-06', 2, 'Purchase', '2', 'Alder Supply Co', false, false)" % (BK, F)),
        ("an entry altered in Tally (AlterID)", "update tally_vouchers set alter_id = 9 where guid = 'g2'"),
        ("an entry deleted in Tally", "update tally_vouchers set deleted_at = now() where guid = 'g2'"),
        ("a 2B month brought in", item("twoBs", ".07AAKCS4821Q1ZW|052025", {"rows": []})),
        ("an IMS decision", item("itcTrack", ".07", {"dec": {"R|x": {"act": "accept"}}})),
        ("a figure typed into 3B", item("gst3b", ".07|202505", {"rev2": {"igst": 100}})),
        ("a return marked filed", item("gstFiled", ".07", {"202505": {"r3b": "2025-06-20"}})),
        ("a GST setting (QRMP)", item("gstSet", ".07", {"filing": [{"type": "qrmp", "from": "202601"}]})),
        ("the ledger list", item("map", ".Output CGST", {"kind": "gst", "ok": True})),
        ("an item deleted", "update client_book_items set deleted = true, seq = %d where key = 'gst3b'" % nseq()),
        ("the client's record", "update clients set data = '{\"name\": \"Synthetic Traders\", \"choices\": {\"advGst\": {\"value\": \"on\"}}}', updated_at = now() where id = 'c1'"),
        ("a marketplace sale", "insert into records (firm_id, kind, id, client_id, data) values ('%s', 'sales', 'c1:mk1', 'c1', '{\"source\": \"market\"}')" % F),
        ("a marketplace sale deleted", "update records set deleted = true where id = 'c1:mk1'"),
        ("a 2B matching run kept (made for any client of the GSTIN, as gst-2b-match reads it)", "insert into gst_2b_runs (firm_id, client_id, gstin, fy, status, done_at, result) values ('%s', 'other-id', '07AAKCS4821Q1ZW', '2025-26', 'done', now(), '{}')" % F),
        ("a decision on its pairs", "insert into gst_2b_decisions (firm_id, gstin, fy, pair_id, decision) values ('%s', '07AAKCS4821Q1ZW', '2025-26', 'k>g1', 'accept')" % F),
        ("the decision changed", "update gst_2b_decisions set decision = 'reject'"),
    ]
    v = V(); ok(v and V() == v, "nothing changed: the same version")
    for what, q in steps:
        db.sql(q); w = V(); ok(w != v, "moves on " + what); v = w
    for k in KEYS:
        db.sql(item(k, ".probe", {"x": nseq()})); w = V()
        if w == v: ok(False, "moves on an item of " + k)
        v = w
    ok(True, "moves on an item of each of the %d keys" % len(KEYS))
    db.sql(item("tdsFiled", ".probe", {"x": 1})); db.sql(item("misCfg", "", {"x": 1}))
    ok(V() == v, "stays on items the 3B does not read (tdsFiled, misCfg)")
    for what, q in [("another client's item", "insert into client_book_items (firm_id, client_id, key, item, data, seq) values ('%s', 'c2', 'gst3b', '', '{}', 999)" % F),
                    ("another firm's book", "insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, cancelled, optional) values ('%s', '%s', 'x1', '2025-04-05', 1, 'Sales', false, false)" % (BK2, F2)),
                    ("another client's sale", "insert into records (firm_id, kind, id, client_id, data) values ('%s', 'sales', 'c2:mk1', 'c2', '{}')" % F),
                    ("a 2B run of another GSTIN", "insert into gst_2b_runs (firm_id, client_id, gstin, fy, status, done_at, result) values ('%s', 'c1', '09AAKCS4821Q1ZW', '2025-26', 'done', now(), '{}')" % F),
                    ("a 2B run not done", "insert into gst_2b_runs (firm_id, client_id, gstin, fy, status, done_at, result) values ('%s', 'c1', '07AAKCS4821Q1ZW', '2025-26', 'queued', null, null)" % F)]:
        db.sql(q); ok(V() == v, "stays on " + what)
    print("== 3. a member reads what is kept, while it is current")
    db.sql("insert into tally_calc_results (book_id, firm_id, kind, args, version, result, ms) values ('%s', '%s', 'gst-3b', '07|202505', '%s', '{\"payable\": 1234.5, \"engine\": \"e1\"}', 40)" % (BK, F, v))
    r = json.loads(db.one("select gst_calc_cached('c1', '07', '202505')", uid=U))
    ok(r.get("result", {}) and r["result"]["payable"] == 1234.5 and r["version"] == v, "a member of the firm: the kept 3B")
    r2 = json.loads(db.one("select gst_calc_cached('c1', '07', '202505')", uid=U2))
    ok(not r2.get("result") and r2.get("book") == BK2, "another firm's member: its own book only, no 3B of this firm")
    db.sql(item("gstOpen", ".07", {"igst": 1}))
    r = json.loads(db.one("select gst_calc_cached('c1', '07', '202505')", uid=U))
    ok(r.get("result") is None, "after a change (the opening credit typed): nothing current")
    for role in ("anon", "authenticated"):
        try: db.sql("set role %s; select gst_calc_version('%s', 'c1');" % (role, BK)); ok(False, role + " may not call gst_calc_version")
        except RuntimeError as e: ok("permission denied" in str(e), role + " may not call gst_calc_version")
    ok(db.one("select gst_calc_book('%s', 'c1', '202505')" % F) == db.one("select tally_pick('c1', '2025-05-31')", uid=U) == BK, "the month's book: gst_calc_book is tally_pick's for the month's last day")
    ok(db.one("select gst_calc_book('%s', 'c1', '202503')" % F) in (None, ""), "no book started by the month: none")
    db.sql("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, hsn, rate, id) values ('%s', '%s', 'g1', '2025-04-05', 'Birchwood Retail', -1180, null, null, 2), ('%s', '%s', 'g1', '2025-04-05', 'Output CGST', 90, null, null, 3)" % (BK, F, BK, F))
    db.sql("insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount, credit_days, id) values ('%s', '%s', 'g1', '2025-04-05', 'Birchwood Retail', 'INV-1', 'New Ref', -1180, 30, 1)" % (BK, F))
    pk = json.loads(db.one("select gst_calc_rows('%s')" % BK)); hd = {h[0]: h for h in pk["heads"]}; g1 = hd.get("g1")
    L = pk["ledgers"]
    ok(g1 and len(g1) == 28 and g1[1] == "2025-04-05" and g1[14] == "07AAKCS4821Q1ZW" and [[L[x[0]], float(x[1])] for x in g1[26]] == [["Sales - Goods", 1000.0], ["Birchwood Retail", -1180.0], ["Output CGST", 90.0]]
       and [[L[x[0]], x[1], x[2], float(x[3]), x[4]] for x in g1[27]] == [["Birchwood Retail", "INV-1", "New Ref", -1180.0, 30]] and set(hd) == {"g1", "g2"},
       "gst_calc_rows: every entry (deleted ones too) with its 26 columns, its lines in order and its bills, each ledger named once")
    print("== 4. the queue")
    db.sql("delete from gst_calc_queue")
    db.sql("insert into client_book_items (firm_id, client_id, key, item, data, seq) select '%s', 'c1', 'gst3b', 'n' || g, '{}', 5000 + g from generate_series(1, 50) g" % F)
    db.sql("update tally_vouchers set alter_id = alter_id + 1 where book_id = '%s'" % BK)
    ok(db.one("select count(*) from gst_calc_queue") == "0", "items saved and entries changed: nothing queued by the database itself (no trigger)")
    ok(db.one("select gst_calc_want_book('%s', 'books')" % BK) == "t" and db.one("select string_agg(client_id || ':' || why, ',') from gst_calc_queue") == "c1:books", "gst_calc_want_book: the book's client queued, a run may start")
    db.sql("delete from gst_calc_queue")
    ok(db.one("select gst_calc_poke('c1')", uid=U) == "t" and db.one("select gst_calc_poke('c1')", uid=U2) == "f" and db.one("select count(*) from gst_calc_queue") == "1", "gst_calc_poke: a member queues its own firm's client; another firm's member queues nothing")
    t1 = db.rows("select * from gst_calc_take(1)")
    ok(len(t1) == 1 and t1[0]["client_id"] == "c1" and not db.rows("select * from gst_calc_take(1)"), "gst_calc_take: the client once; not again while its run holds it")
    ok(db.one("select gst_calc_want('%s', 'c1', 'work')" % F) == "f", "a change while a run holds it: no run started (false)")
    db.sql("select gst_calc_done('%s', 'c1', false, true, false, null)" % F)
    ok(db.one("select count(*) from gst_calc_queue where client_id = 'c1'") == "1", "that run done, nothing more: the client stays, wanted again during it")
    db.sql("update gst_calc_queue set ran_at = now() - interval '21 seconds'")
    ok(len(db.rows("select * from gst_calc_take(1)")) == 1, "taken again after its 20 seconds")
    db.sql("select gst_calc_done('%s', 'c1', false, true, false, null)" % F)
    ok(db.one("select count(*) from gst_calc_queue where client_id = 'c1'") == "0", "done with nothing new: the client leaves the queue")
    db.sql("select gst_calc_want('%s', 'c2', 'asked')" % F)
    for i in range(3):
        db.rows("select * from gst_calc_take(1)"); db.sql("update gst_calc_queue set taken_at = now() - interval '3 minutes' where client_id = 'c2'")
    ok(not db.rows("select * from gst_calc_take(1)") and db.one("select too_big from gst_calc_queue where client_id = 'c2'") == "t", "three runs taken and never finished: not taken again, marked too big")
    ok(db.one("select gst_calc_want('%s', 'c2', 'asked')" % F) == "f", "a too-big client: no run started for it")
    db.sql("insert into clients (firm_id, id, data) values ('%s', 'c3', '{}') on conflict do nothing" % F)
    db.sql("select gst_calc_want('%s', 'c3', 'asked')" % F); db.rows("select * from gst_calc_take(1)")
    db.sql("select gst_calc_done('%s', 'c3', false, false, false, null)" % F)
    ok(db.one("select attempts || ':' || (taken_at is null) || ':' || (ran_at is not null) from gst_calc_queue where client_id = 'c3'") == "1:true:true", "a failed run: its attempt counted, waits its 20 seconds")
    db.sql("select gst_calc_want('%s', 'c1', 'asked')" % F); db.sql("select gst_calc_done('%s', 'c1', false, true, true, null)" % F); db.sql("select gst_calc_done('%s', 'c1', false, true, true, null)" % F)
    ok(json.loads(db.one("select gst_calc_cached('c1', '07', '202505')", uid=U)).get("too_big") is True, "too big (the run's budget): gst_calc_cached says so, the app works it out")
    db.sql("delete from gst_calc_queue")
    for c in ("q1", "q2", "q3", "q4"): db.sql("select gst_calc_want('%s', '%s', 'asked', null, null)" % (F, c))
    t = db.rows("select * from gst_calc_take(5)")
    ok([x["client_id"] for x in t] == ["q1", "q2", "q3"] and not db.rows("select * from gst_calc_take(5)"), "at most 3 runs at once, in the order first wanted; none while 3 are going")
    db.sql("update gst_calc_queue set taken_at = now() - interval '3 minutes', ran_at = now() - interval '3 minutes'")
    ok([x["client_id"] for x in db.rows("select * from gst_calc_take(1)")] == ["q1"], "runs over 2 minutes old no longer count: taken again, first wanted first")
    db.sql("delete from gst_calc_queue")
    ok(db.one("select gst_calc_held(77)") == "f", "no recorder queue here (migration 47): nothing held")
    db.sql("create schema if not exists pgmq; create table if not exists pgmq.q_tally_recorder (msg_id bigint primary key, enqueued_at timestamptz not null default now(), message jsonb); insert into pgmq.q_tally_recorder (msg_id, message) values (77, '{}')")
    ok(db.one("select gst_calc_want_book('%s', 'queued', 77)" % BK) == "f" and db.one("select after_msg from gst_calc_queue where client_id = 'c1'") == "77" and not db.rows("select * from gst_calc_take(1)"),
       "lines queued for the drain (message 77 waiting): no run started, not taken while it waits")
    ok(db.one("select gst_calc_want('%s', 'c1', 'asked')" % F) == "f" and not db.rows("select * from gst_calc_take(1)"), "a member's miss meanwhile: still waits for the drain")
    db.sql("delete from pgmq.q_tally_recorder where msg_id = 77")     # the drain applied it (archived)
    ok([x["client_id"] for x in db.rows("select * from gst_calc_take(1)")] == ["c1"], "the drain has applied them: taken")
    db.sql("delete from gst_calc_queue"); db.sql("insert into pgmq.q_tally_recorder (msg_id, enqueued_at, message) values (78, now() - interval '16 minutes', '{}')")
    db.sql("select gst_calc_want_book('%s', 'queued', 78)" % BK)
    ok(db.one("select gst_calc_held(78)") == "f" and [x["client_id"] for x in db.rows("select * from gst_calc_take(1)")] == ["c1"], "a message waiting over 15 minutes (the drain stopped): never held longer, taken")
    db.sql("delete from gst_calc_queue"); db.sql("insert into pgmq.q_tally_recorder (msg_id, message) values (79, '{}'), (80, '{}')")
    # two first wants at once, in two sessions: the first's new row not committed yet, the second finds none, inserts,
    # waits on the first, then meets its row (on conflict): its message kept, not lost
    import threading
    a = threading.Thread(target=lambda: db.sql("begin; select gst_calc_want('%s', 'r1', 'queued', null, 79); select pg_sleep(1.5); commit;" % F)); a.start(); time.sleep(0.5)
    w2 = db.one("select gst_calc_want('%s', 'r1', 'queued', null, 80)" % F); a.join()
    ok(w2 == "f" and db.one("select after_msg || ':' || (asked_at >= first_wanted) || ':' || (wanted_at <= now()) from gst_calc_queue where client_id = 'r1'") == "80:true:true",
       "two first wants at once (two sessions): the later message kept (%s), asked again, due no later" % db.one("select after_msg from gst_calc_queue where client_id = 'r1'"))
    db.sql("delete from gst_calc_queue"); db.sql("select gst_calc_want('%s', 'e1', 'asked')" % F); db.sql("update gst_calc_queue set wanted_at = now() - interval '5 minutes'")
    db.sql("select gst_calc_want('%s', 'e1', 'asked')" % F)
    ok(db.one("select wanted_at < now() - interval '4 minutes' from gst_calc_queue where client_id = 'e1'") == "t", "a want never puts off a client already due")
    db.rows("select * from gst_calc_take(1)")
    ok(db.one("select gst_calc_want('%s', 'e1', 'asked')" % F) == "f", "a run going (taken under 2 minutes ago): a miss starts none")
    db.sql("update gst_calc_queue set taken_at = now() - interval '3 minutes', ran_at = now() - interval '3 minutes' where client_id = 'e1'")
    ok(db.one("select gst_calc_want('%s', 'e1', 'asked')" % F) == "t", "a run taken 3 minutes ago and never done (dead): a miss starts one again")
    db.sql("select gst_calc_done('%s', 'e1', false, true, false, null)" % F)
    ok(db.one("select count(*) from gst_calc_queue where client_id = 'e1'") == "1", "wanted after the dead run was taken: kept when it is done")
    db.sql("delete from gst_calc_queue"); db.sql("select gst_calc_want('%s', 'b1', 'asked', null, null)" % F)
    db.rows("select * from gst_calc_take(1)"); db.sql("select gst_calc_done('%s', 'b1', true, true, true, '153.4')" % F)
    one = db.one("select too_big || ':' || big_n from gst_calc_queue where client_id = 'b1'")
    db.sql("update gst_calc_queue set ran_at = now() - interval '21 seconds'"); db.rows("select * from gst_calc_take(1)"); db.sql("select gst_calc_done('%s', 'b1', true, true, true, '153.4')" % F)
    ok(one == "false:1" and db.one("select too_big || ':' || big_n from gst_calc_queue where client_id = 'b1'") == "true:2", "over its budget once: counted; twice: too big")
    ok(db.one("select gst_calc_want('%s', 'b1', 'asked', '153.4', null)" % F) == "f", "too big, the same engine, within a day: stays with the app")
    ok(db.one("select gst_calc_want('%s', 'b1', 'asked', '153.5', null)" % F) == "t" and db.one("select too_big from gst_calc_queue where client_id = 'b1'") == "f", "a new engine: taken back")
    db.sql("update gst_calc_queue set too_big = true, ran_at = now() - interval '25 hours' where client_id = 'b1'")
    ok(db.one("select gst_calc_want('%s', 'b1', 'asked', null, null)" % F) == "t", "a day after its last run: taken back")
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('bbbbbbbb-0153-4000-8000-000000000003', '%s', 'c1', 'Older', '2024-04-01', '2024-04-01')" % F)
    bm = {r["book_id"]: r["months"] for r in db.rows("select book_id, months::text from gst_calc_book_months('%s', 'c1', '202506')" % F)}
    ok(bm.get("bbbbbbbb-0153-4000-8000-000000000003", "").startswith("{202404,") and bm.get("bbbbbbbb-0153-4000-8000-000000000003", "").endswith("202503}") and bm.get(BK) == "{202504,202505,202506}",
       "gst_calc_book_months: one call, each book with the months gst_calc_book gives it (%s)" % bm)
    print("== 5. the timer")
    ok(db.one("select count(*) from pg_proc where proname = 'schedule'") == "0", "no pg_cron on this stand: the migration ran and made no timer")
finally:
    db.stop()
print("%d FAILED" % len(fails) if fails else "all ok")
sys.exit(1 if fails else 0)
