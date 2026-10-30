"""python3 run_migration131.py - migration-131-ledger-drop-guard (30-Oct-2026, next-fix-ledger-drop; NOT run on staging).
Staging 29-Oct, book 3d36a836 (IMPETUS INSURANCE BROKERS PRIVATE LIMITED): one bridge read 440 ledgers at 08:30 UTC;
another on the same computer read 404 at 13:42. The cloud held the 36 missing for "a second read", and the second read was
the same bridge 2 minutes later (round 13d701ce...): all 36 marked deleted, quietly. (The owner has since said they were
deleted in Tally; they stay marked.) The owner's rule: FinCom never quietly marks many ledgers gone; they wait "to
confirm" with the list. On a throwaway PostgreSQL (pg_stand) with the ledger-list functions as staging runs them
(32 -> 33 -> 35 -> staging's first 34 -> 36b -> 37 -> 36) and tally_alerts as migration 47 makes it:
  0. the file: one transaction, lock_timeout 10 s, add-only, explicit grants, names no real database; md5
  1. RED (36 alone): the staging case: the same bridge 2 minutes later marks all 36, no alert, no Confirm / Keep
  2. 131 runs twice; nothing deleted
  3. the staging case again: nothing marked; ONE alert row in the bell's table (kind summary, data.what ledger_drop,
     data.names the 36) in plain words, no computer's name; asked again: still nothing marked, still one alert
  4. a read that lists them all again: the hold cleared, the alert closed, nothing marked
  5. no read marks them: the same bridge 35 minutes later, another computer, the same 36 missing: still asked; other names
     missing: asked again (one alert); some listed again, a few still missing: still asked, not marked
  6. small numbers keep today's rule: up to greatest(10, 5% of the live ledgers) marked at once; 11 of 100 asked
  7. Confirm marks them (the guard still keeps a ledger with entries; the person on each mark); Keep keeps them and the
     same names missing again ask nothing more; a ledger seen again and then missing again is asked again
  9. an uploaded Master.xml declared complete (tally_ingest_ledgers_list): the same rule (34 marked them on a second list)
  8. who may: Confirm / Keep the firm's active owner or staff (as the ledger actions); not a viewer, another firm, one who
     left; the drops readable by the firm's members only; the ledger-list functions the service role only"""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M131 = os.path.join(SQLDIR, "migration-131-ledger-drop-guard.sql")
M = {n: os.path.join(SQLDIR, f) for n, f in [(32, "migration-32-sync-safety.sql"), (33, "migration-33-ledger-lists.sql"), (35, "migration-35-bridge-control.sql"),
                                              (36, "migration-36-ledger-rename.sql"), ("36b", "migration-36b-post-acceptance.sql"), (37, "migration-37-follow-ups.sql")]}
M[34] = os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
def sql_function(path, name):
    s = open(path).read(); i = s.index("create or replace function public." + name + "("); j = s.index("end $function$;", i) + len("end $function$;")
    return s[i:j]
SCHEMA33 = part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")
SCHEMA35 = part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")
SCHEMA37 = part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X")
EXTRA = """
create table if not exists tally_bills (book_id uuid not null references tally_books (book_id) on delete cascade, firm_id uuid not null, guid text not null, day date not null,
  ledger text not null, name text not null default '', type text not null default '', amount numeric not null, bill_date date, credit_days integer, due date);
""" + sql_function(os.path.join(SQLDIR, "migration-11-ref-cmp.sql"), "tally_d8") + """
alter table tally_ledgers add column if not exists raw_name text;
alter table tally_vouchers add column if not exists raw_party text; alter table tally_lines add column if not exists raw_ledger text;
alter table tally_bills add column if not exists raw_ledger text;
alter table tally_ledger_day add column if not exists raw_ledger text; alter table tally_ledger_day add column if not exists merged_into text;
alter table tally_ledger_day add column if not exists before_clean jsonb;
""" + sql_function(os.path.join(SQLDIR, "migration-23-clean-names.sql"), "tally_ingest_day")
# tally_alerts as migration 47 makes it (the table, its once-a-day index, row security: the firm reads, nobody writes)
m47 = open(os.path.join(SQLDIR, "migration-47-recorder-queue-alerts.sql")).read()
i47 = m47.index("create table if not exists public.tally_alerts ("); j47 = m47.index("create index if not exists tally_alerts_firm", i47)
ALERTS = m47[i47:j47] + """
alter table public.tally_alerts enable row level security;
create policy tally_alerts_read on public.tally_alerts for select to authenticated using (firm_id = my_firm());
revoke all on public.tally_alerts from anon, authenticated; grant select on public.tally_alerts to authenticated;
grant all on public.tally_alerts to service_role; grant usage on all sequences in schema public to service_role;
"""

F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, OTHER, GONE = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333", "22222222-2222-2222-2222-222222222222"
VIEWER = "66666666-6666-6666-6666-666666666666"
# the two bridges on NWS144 (staging's ids), and a laptop
ANSHUL, RANJEET, LAPTOP = "3648622b-c39d-43ec-9cae-27a353e3dbb6", "1742f6fe-ef9b-45a3-add3-3932cb1946e8", "d3000000-0000-0000-0000-000000000003"
GO_A, GO_R, GO_L = "go-6b1ba45fbb1d", "go-1418f6cb202d", "go-777777777777"
CO = "IMPETUS INSURANCE BROKERS PRIVATE LIMITED"
# the 36 staging marked (29-Oct-2026), and 404 others
GONE36 = ["Advertisement and Promotion", "Battery", "CGST", "Deferred Tax Liability", "Difference of Bill No. UP/2025-26/066", "DIWALI GIFT EXP", "Educational support services",
          "EQUITY SHARE CAPITAL", "EVOLVE ADVISORY SERVICES", 'FD with AU Bank " 2506211998132071 "', "FIXED DEPOSIT WITH YES BANK-New", "Impetus Insurence Brokers Pvt Ltd",
          "INSURANCE ACADEMY FEES", "Invoice Issued But Book in Next Year", "KOTAK MAHINDRA BANK IBAI FEE", "Management Consulting and Services", "Modi Battery",
          "Other support services", "PURCHASE @18% IGST", "PURCHASE @18% LOCAL", "PURCHASE @3% IGST", "PURCHASE IGST @ 28%", "R  K Service Station Noida", "SGST",
          "Suspense A/c", "TDS DEPOSIT (F.Y.2024-25)", "TDS ON COMMISSION PAYABLE- Mismatch", "TDS ON COMMISSION PAYABLE- Not Deposited",
          "TDS ON COMMISSION PAYABLE- Not Show in TDS Return", "TDS ON PROFESSION- Not in Tds Return", "TDS ON SALARY DEPOSIT", "TDS on Salary F.Y. 23-24", "TDS PAYABLE",
          "TDS PAYABLE ON CONTRACT- Not in Tds Return", "TDS PAYABLE ON RENT (Machinery) TY 2026-27 1009", "Tds Receivable 2026-27"]
OTHERS = ["Party %03d" % i for i in range(404)]
ALL = OTHERS + GONE36
GUID = {n: "g-%04d" % i for i, n in enumerate(ALL)}

db = pg_stand.start(int(os.environ.get("PG131_PORT") or 31131))
def psql_text(text):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=text, capture_output=True, text=True)
one = lambda s: db.one(s)
j = lambda s: json.loads(db.one("select (" + s + ")::text"))
def as_role(role, uid, stmt):
    try: return True, db.one("set fincom.role = %s; set role %s; %s" % (q(role), role, stmt), uid)
    except RuntimeError as e: return False, str(e)
def rpc(uid, stmt, role="authenticated"):
    good, out = as_role(role, uid, stmt)
    if not good: return {"_error": out[-400:]}
    try: return json.loads(out) if out else {}
    except (TypeError, ValueError): return {"_out": out}
NB = [0]
def new_book(n_led=None, names=None, company=CO, client="cmvt6vru3cbitc"):
    NB[0] += 1; b = "b0000000-0000-0000-0000-%012d" % NB[0]
    names = names or ALL
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, %s, %s, '2026-04-01', '2026-03-31');" % (q(b), q(F), q(client), q(company)))
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open, chain, primary_group, open_sent, tally_guid) select %s, %s, x->>0, 'Sundry Creditors', 0, '{}', 'Current Liabilities', 0, x->>1 from jsonb_array_elements(%s) x;"
           % (q(b), q(F), js([[n, GUID.get(n, "g-" + n)] for n in names])))
    return b
RN = [0]
def read(book, dev, bridge, seen, ago=0.0, complete=True, names=None):
    """one complete ledger-list round as tally-ingest makes it: the batch, the stamp after the upsert, mark_gone on the last
    batch; the round started `ago` minutes before now"""
    RN[0] += 1; rid = "r%04d" % RN[0]
    g = [GUID.get(n, "g-" + n) for n in seen]
    j("tally_ledger_round_batch(%s, %s, 0, %d, %s, %s, %s, %s)" % (q(book), q(rid), len(g), "true" if complete else "false", q(dev), q(bridge), js(g)))
    j("tally_ledger_round_seen(%s, %s, %s)" % (q(book), q(rid), js(g)))
    db.sql("update tally_ledger_rounds set started_at = now() - make_interval(secs => %f) where book_id = %s and round_id = %s" % (ago * 60, q(book), q(rid)))
    r = j("tally_ledgers_mark_gone(%s, %s)" % (q(book), q(rid))); r["round"] = rid
    return r
gone = lambda b: int(one("select count(*) from tally_ledgers where book_id = %s and deleted_at is not null" % q(b)))
alerts = lambda b: db.rows("select id, kind, client_id, device_id::text, words, data::text, read_at, read_by::text from tally_alerts where book_id = %s order by id" % q(b))
unread = lambda b: [a for a in alerts(b) if not a["read_at"]]
drops = lambda b: db.rows("select id::text, state, cardinality(names) n, round_id, alert_id::text from tally_ledger_drops where book_id = %s order by created_at, id" % q(b)) if one("select to_regclass('public.tally_ledger_drops')") else []
SEEN404 = OTHERS
WORDS = (CO + ": Tally lists 404 ledgers, 36 fewer than before (Advertisement and Promotion, Battery, CGST, …). "
         "If they were deleted in Tally, press Confirm; otherwise nothing changes.")
def staging_case(b):
    """29-Oct-2026: Ranjeet 08:30 (440), Anshul 13:42 (404), Anshul 13:44 (404): returns the last round's answer"""
    read(b, RANJEET, GO_R, ALL, ago=314)
    read(b, ANSHUL, GO_A, SEEN404, ago=2)
    return read(b, ANSHUL, GO_A, SEEN404, ago=0)
try:
    text = open(M131).read() if os.path.exists(M131) else ""
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M131), hashlib.md5(text.encode()).hexdigest() if text else "-", len(text.encode())))
    print("== 0. the file")
    code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
    ok(bool(text) and re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
    ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\s+(table|view|function|policy|column|index|schema|trigger|constraint)\b", code) and not re.search(r"\btruncate\b", code), "add-only (no drop, delete or truncate)")
    ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
    ok(bool(text) and sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == ["tally_ingest_ledgers_list", "tally_ledger_drop_confirm", "tally_ledger_drop_decide", "tally_ledger_drop_keep", "tally_ledger_drop_words", "tally_ledgers_mark_gone"],
       "functions: tally_ledgers_mark_gone, tally_ingest_ledgers_list (replaced, the same arguments); tally_ledger_drop_decide, _words, _confirm, _keep (new)")
    ok(bool(text) and re.search(r"grant execute on function public\.tally_ledger_drop_confirm\(uuid\), public\.tally_ledger_drop_keep\(uuid\) to authenticated, service_role", text) is not None
       and re.search(r"grant execute on function public\.tally_ledgers_mark_gone\(uuid, text\)[^;]* to service_role;", text) is not None, "explicit grants in the file")
    ok(bool(text) and "grant select on public.tally_ledger_drops to authenticated;" in text and "grant select, insert, update on public.tally_ledger_drops to service_role;" in text, "the new table's grants explicit")

    # the stand: the cloud as staging has it (run_migration36's order)
    db.sql(SCHEMA33); db.sql(EXTRA)
    db.sql("insert into firms values (%s, 'Firm'), (%s, 'Other firm') on conflict do nothing;" % (q(F), q(F2)))
    for n in (32, 33):
        r = psql_text(open(M[n]).read()); ok(r.returncode == 0, "migration-%d runs %s" % (n, (r.stderr or "").strip()[-300:] if r.returncode else ""))
    db.sql(SCHEMA35)
    db.sql(SCHEMA37)
    for n in (35, 34, "36b", 37, 36):
        r = psql_text(open(M[n]).read()); ok(r.returncode == 0, "migration-%s runs %s" % (n, (r.stderr or "").strip()[-300:] if r.returncode else ""))
    db.sql(ALERTS)
    db.sql("insert into members (user_id, firm_id, name, role, active) values (%s, %s, 'Anshul', 'owner', true), (%s, %s, 'Ranjeet', 'staff', true), (%s, %s, 'Else', 'owner', true), (%s, %s, 'Left', 'owner', false), (%s, %s, 'Looks', 'viewer', true);"
           % (q(OWNER), q(F), q(STAFF), q(F), q(OTHER), q(F2), q(GONE), q(F), q(VIEWER), q(F)))
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, version, info) values (%s, %s, 'NWS144 · NW144\\anshul', 'h1', '2.4.8', %s), (%s, %s, 'NWS144 · NW144\\Ranjeet', 'h2', '2.4.7', %s), (%s, %s, 'LAPTOP', 'h3', '2.4.8', '{}');"
           % (q(ANSHUL), q(F), js({"computer": "NWS144", "user": "NW144\\anshul"}), q(RANJEET), q(F), js({"computer": "NWS144", "user": "NW144\\Ranjeet"}), q(LAPTOP), q(F)))
    db.sql("grant usage on schema public, auth to authenticated, anon, service_role;")

    print("== 1. RED: 36's rule, the staging case")
    b0 = new_book()
    r = staging_case(b0)
    ok(gone(b0) == 36 and r.get("marked") == 36, "RED: the second read 2 minutes later from the same bridge marks all 36 (%s)" % r.get("note"))
    ok(not one("select to_regclass('public.tally_alerts')") or not alerts(b0), "RED: and no alert says so")
    ok(int(one("select count(*) from pg_proc where proname = 'tally_ledger_drop_confirm'")) == 0, "RED: no way for the owner to confirm or keep")
    if not text: raise SystemExit("migration-131 is not written yet")

    print("== 2. runs twice")
    TABLES = ["tally_ledgers", "tally_ledger_marks", "tally_ledger_rounds", "tally_alerts", "tally_books"]
    counts = lambda: {t: int(one("select count(*) from %s" % t)) for t in TABLES}
    before = counts()
    for n in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-600:] if r.returncode else ""))
        ok(counts() == before, "run %d: nothing deleted or added (%s)" % (n, counts()))
    if r.returncode: raise SystemExit("cannot go on without the migration")
    ok(gone(b0) == 36, "what was marked before stays as it is (the restore is a separate file)")

    print("== 3. the staging case: nothing marked, one alert")
    b1 = new_book()
    r = read(b1, RANJEET, GO_R, ALL, ago=314)
    ok(r.get("marked") == 0 and r.get("note") == "nothing to mark: the round saw every live ledger with a GUID", "08:30, Ranjeet's 440: nothing to mark (%s)" % r.get("note"))
    r = read(b1, ANSHUL, GO_A, SEEN404, ago=2)
    ok(r.get("marked") == 0 and len(unread(b1)) == 1 and "asked" in str(r.get("note")), "13:42, Anshul's 404: nothing marked, the owner asked at once (%s)" % r.get("note"))
    r = read(b1, ANSHUL, GO_A, SEEN404, ago=0)
    ok(gone(b1) == 0 and r.get("marked") == 0, "the same bridge 2 minutes later: nothing marked (%s)" % r.get("note"))
    a = unread(b1)
    ok(len(alerts(b1)) == 1 and len(a) == 1, "ONE alert row (%d)" % len(alerts(b1)))
    a = a[0] if a else {}; ad = json.loads(a.get("data") or "{}")
    ok(a.get("kind") == "summary" and ad.get("what") == "ledger_drop" and a.get("client_id") == "cmvt6vru3cbitc", "in the bell's table: kind summary, data.what ledger_drop, the client (%s %s)" % (a.get("kind"), ad.get("what")))
    ok(a.get("words") == WORDS and not re.search(r"NWS144|anshul|Ranjeet|LAPTOP|computer|bridge", a.get("words") or "", re.I), "plain words, no computer's name:\n         %s\n    want %s" % (a.get("words"), WORDS))
    ok(sorted(ad.get("names") or []) == sorted(GONE36) and ad.get("count") == 36 and ad.get("listed") == 404 and ad.get("state") == "pending", "data: the 36 names, count 36, listed 404, pending")
    d = drops(b1)
    ok(len(d) == 1 and d[0]["state"] == "pending" and d[0]["n"] == "36" and d[0]["alert_id"] == a.get("id") and ad.get("drop") == d[0]["id"], "one pending drop, tied to the alert (%s)" % d)
    ok("asked" in str(r.get("note")).lower() and r.get("pending") == d[0]["id"] if d else False, "the round's note says the owner is asked (%s)" % r.get("note"))
    held_n = int(one("select count(*) from tally_ledger_marks where book_id = %s and action = 'held'" % q(b1)))
    r = read(b1, ANSHUL, GO_A, SEEN404, ago=-1)
    ok(gone(b1) == 0 and len(alerts(b1)) == 1 and len(unread(b1)) == 1 and drops(b1)[0]["state"] == "pending", "asked again by the same bridge a minute later: nothing marked, still one alert (%s)" % r.get("note"))
    ok(int(one("select count(*) from tally_ledger_marks where book_id = %s and action = 'held'" % q(b1))) == held_n, "and no new burst of 'held' rows (%d)" % held_n)

    print("== 4. another computer sees them all: cleared")
    r = read(b1, RANJEET, GO_R, ALL, ago=-3)
    ok(gone(b1) == 0 and drops(b1)[0]["state"] == "cleared" and not unread(b1), "Ranjeet's bridge reads 440: the hold cleared, the alert closed, nothing marked (%s)" % r.get("note"))
    ok(json.loads(alerts(b1)[0]["data"]).get("state") == "cleared", "the alert row says cleared")

    print("== 5. no read marks them: only Confirm")
    b2 = new_book()
    read(b2, RANJEET, GO_R, ALL, ago=314); read(b2, ANSHUL, GO_A, SEEN404, ago=40)
    r = read(b2, ANSHUL, GO_A, SEEN404, ago=5)
    ok(gone(b2) == 0 and r.get("marked") == 0 and drops(b2)[0]["state"] == "pending" and len(unread(b2)) == 1, "35 minutes later, the same bridge, the same 36 missing: still nothing marked, still asked (%s)" % r.get("note"))
    r = read(b2, LAPTOP, GO_L, SEEN404, ago=1)
    ok(gone(b2) == 0 and len(drops(b2)) == 1 and len(alerts(b2)) == 1 and len(unread(b2)) == 1, "another computer, the same 36 missing: still nothing marked, one alert (%s)" % r.get("note"))
    b3 = new_book()
    read(b3, ANSHUL, GO_A, SEEN404, ago=3)
    r = read(b3, LAPTOP, GO_L, ALL[:-5], ago=1)
    ok(gone(b3) == 0 and [x["state"] for x in drops(b3)] == ["superseded", "pending"] and len(unread(b3)) == 1 and json.loads(unread(b3)[0]["data"]).get("count") == 5,
       "31 listed again, 5 still missing: not marked though few, still asked (5) (%s)" % r.get("note"))
    b4 = new_book()
    read(b4, ANSHUL, GO_A, SEEN404, ago=3)
    r = read(b4, LAPTOP, GO_L, SEEN404 + GONE36[:6], ago=1)
    ok(gone(b4) == 0 and [x["state"] for x in drops(b4)] == ["superseded", "pending"] and len(alerts(b4)) == 1 and len(unread(b4)) == 1, "another computer, other names missing (30): nothing marked, the hold renewed, still one alert (%s)" % r.get("note"))
    ok(json.loads(unread(b4)[0]["data"]).get("count") == 30 and "30 fewer" in unread(b4)[0]["words"] and "LAPTOP" not in unread(b4)[0]["words"], "the alert now says 30, no computer's name (%s)" % unread(b4)[0]["words"][:120])
    b4b = new_book()
    read(b4b, ANSHUL, GO_A, SEEN404, ago=3)
    r = read(b4b, ANSHUL, GO_A, SEEN404, ago=1, complete=False)
    ok(gone(b4b) == 0 and drops(b4b)[0]["state"] == "pending", "an incomplete round decides nothing (%s)" % r.get("note"))

    print("== 6. small numbers: today's rule")
    b5 = new_book()
    r = read(b5, ANSHUL, GO_A, ALL[:-22], ago=1)
    ok(gone(b5) == 22 and not alerts(b5) and not drops(b5), "22 of 440 (5%% = 22): marked at once, no alert (%s)" % r.get("note"))
    small = ["Small %03d" % i for i in range(100)]
    b6 = new_book(names=small)
    r = read(b6, ANSHUL, GO_A, small[:-10], ago=1)
    ok(gone(b6) == 10 and not alerts(b6), "10 of 100 (the floor 10): marked at once (%s)" % r.get("note"))
    b7 = new_book(names=small)
    r = read(b7, ANSHUL, GO_A, small[:-11], ago=1)
    ok(gone(b7) == 0 and len(unread(b7)) == 1, "11 of 100: nothing marked, the owner asked (the old floor was 25) (%s)" % r.get("note"))

    print("== 7. Confirm and Keep")
    d1 = new_book()
    read(d1, ANSHUL, GO_A, SEEN404, ago=1)
    db.sql("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) values (%s, %s, 'SGST', '2026-10-01', 100, 100, 0, 1)" % (q(d1), q(F)))
    did = drops(d1)[0]["id"]
    r = rpc(VIEWER, "select tally_ledger_drop_confirm(%s)::text" % q(did))
    ok("_error" in r and "owner or staff" in r["_error"] and gone(d1) == 0, "a viewer cannot confirm (%s)" % r.get("_error", "")[-80:])
    r = rpc(OTHER, "select tally_ledger_drop_confirm(%s)::text" % q(did))
    ok("_error" in r and gone(d1) == 0, "another firm's owner cannot (%s)" % r.get("_error", "")[-80:])
    r = rpc(GONE, "select tally_ledger_drop_confirm(%s)::text" % q(did))
    ok("_error" in r and gone(d1) == 0, "one who left the firm cannot")
    r = rpc(STAFF, "select tally_ledger_drop_confirm(%s)::text" % q(did))
    ok(r.get("ok") and r.get("marked") == 35 and r.get("kept") == 1 and gone(d1) == 35, "staff confirms: 35 marked, SGST (has entries) kept by the guard (%s)" % r)
    a = alerts(d1)[0]
    ok(a["read_at"] and a["read_by"] == STAFF and json.loads(a["data"]).get("state") == "confirmed" and drops(d1)[0]["state"] == "confirmed" and "as confirmed" in a["words"], "the alert read by him, the drop confirmed (%s)" % a["words"])
    ok(int(one("select count(*) from tally_ledger_marks where book_id = %s and action = 'marked' and by_user = %s and reason like '%%confirmed in FinCom%%'" % (q(d1), q(STAFF)))) == 35, "each mark names him")
    r = rpc(OWNER, "select tally_ledger_drop_confirm(%s)::text" % q(did))
    ok(r.get("ok") and r.get("already") == "confirmed" and gone(d1) == 35, "asked twice: nothing more (%s)" % r)
    k1 = new_book()
    read(k1, ANSHUL, GO_A, SEEN404, ago=6)
    kid = drops(k1)[0]["id"]
    r = rpc(OWNER, "select tally_ledger_drop_keep(%s)::text" % q(kid))
    ok(r.get("ok") and gone(k1) == 0 and drops(k1)[0]["state"] == "kept" and alerts(k1)[0]["read_by"] == OWNER, "Keep: nothing marked, the drop kept, the alert read (%s)" % r)
    r = rpc(OWNER, "select tally_ledger_drop_confirm(%s)::text" % q(kid))
    ok(r.get("already") == "kept" and gone(k1) == 0, "a kept drop is not confirmed afterwards")
    r = read(k1, ANSHUL, GO_A, SEEN404, ago=-40)
    ok(gone(k1) == 0 and len(drops(k1)) == 1 and not unread(k1), "the same 36 missing 40 minutes later: nothing marked, nothing asked again (%s)" % r.get("note"))
    read(k1, RANJEET, GO_R, ALL, ago=-41)
    r = read(k1, ANSHUL, GO_A, SEEN404, ago=-42)
    ok(gone(k1) == 0 and len(unread(k1)) == 1 and drops(k1)[-1]["state"] == "pending", "seen again, then missing again: asked again (%s)" % r.get("note"))
    r = rpc(VIEWER, "select tally_ledger_drop_keep(%s)::text" % q(drops(k1)[-1]["id"]))
    ok("_error" in r and drops(k1)[-1]["state"] == "pending", "a viewer cannot Keep either")
    r = rpc(STAFF, "select tally_ledger_drop_keep(%s)::text" % q(drops(k1)[-1]["id"]))
    ok(r.get("ok") and drops(k1)[-1]["state"] == "kept" and gone(k1) == 0, "staff can Keep (%s)" % r)

    print("== 9. an uploaded list (Master.xml, declared complete): the same rule")
    def upload(book, names, complete=True):
        leds = [[n, "Sundry Creditors", "0"] for n in names]
        return j("tally_ingest_ledgers_list(%s, '2026-04-01', '2026-03-31', %s, %s, %s, %d)" % (q(book), js(leds), js({"source": "upload_ledgers", "by": OWNER, "file": "Master.xml"}),
                 "true" if complete else "false", len(leds)))
    u1 = new_book()
    r = upload(u1, SEEN404)
    ok(gone(u1) == 0 and len(unread(u1)) == 1 and r.get("pending") and r.get("held") == 36, "an upload missing 36 of 440: nothing marked, asked (%s)" % r.get("note"))
    ok(unread(u1)[0]["words"] == WORDS, "the same plain words (%s)" % unread(u1)[0]["words"][:100])
    r = upload(u1, SEEN404)
    ok(gone(u1) == 0 and len(alerts(u1)) == 1 and len(unread(u1)) == 1, "the same upload again (34's 'second read'): still nothing marked, one alert (%s)" % r.get("note"))
    r = rpc(OWNER, "select tally_ledger_drop_confirm(%s)::text" % q(drops(u1)[0]["id"]))
    ok(r.get("marked") == 36 and gone(u1) == 36, "Confirm marks them (%s)" % r)
    u2 = new_book()
    r = upload(u2, ALL[:-20])
    ok(gone(u2) == 20 and not alerts(u2), "an upload missing 20 of 440 (within 5%%): marked at once, as before (%s)" % r.get("note"))
    u3 = new_book()
    r = upload(u3, SEEN404, complete=False)
    ok(gone(u3) == 0 and not alerts(u3), "an upload not declared complete: nothing marked, nothing asked, as before (%s)" % r.get("note"))

    print("== 8. who may")
    good, n_ = as_role("authenticated", STAFF, "select count(*) from tally_ledger_drops")
    ok(good and int(n_) >= 5, "a member reads the firm's drops (%s)" % n_)
    good, n_ = as_role("authenticated", OTHER, "select count(*) from tally_ledger_drops")
    ok(good and n_ == "0", "another firm's member none (%s)" % n_)
    good, out = as_role("authenticated", OWNER, "update tally_ledger_drops set state = 'kept'")
    ok(not good and "permission denied" in out, "no direct write")
    good, out = as_role("service_role", None, "delete from tally_ledger_drops")
    ok(not good, "the drops are kept, never deleted (%s)" % out.strip()[-80:])
    priv = lambda role, fn: one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(fn)))
    for fn in ("public.tally_ledger_drop_confirm(uuid)", "public.tally_ledger_drop_keep(uuid)"):
        ok(priv("authenticated", fn) == "true" and priv("anon", fn) == "false" and priv("service_role", fn) == "true", fn + ": members (an owner-or-staff check inside) and the service role; not anon")
    for fn in ("public.tally_ledgers_mark_gone(uuid,text)", "public.tally_ledger_drop_words(uuid)", "public.tally_ledger_drop_decide(uuid,text[],integer,integer,text,uuid,text,timestamptz)",
               "public.tally_ingest_ledgers_list(uuid,date,date,jsonb,jsonb,boolean,integer)"):
        ok(priv("authenticated", fn) == "false" and priv("anon", fn) == "false" and priv("service_role", fn) == "true", fn + ": the service role only")
    r = rpc(OWNER, "select tally_ledgers_mark_gone(%s, 'x')::text" % q(d1))
    ok("_error" in r, "a member cannot call tally_ledgers_mark_gone")
    for fn in ("tally_ledgers_mark_gone", "tally_ledger_drop_words", "tally_ledger_drop_confirm", "tally_ledger_drop_keep", "tally_ledger_drop_decide"):
        row = db.rows("select prosecdef::text s, coalesce(array_to_string(proconfig, ','), '') c from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn))
        ok(row and all(x["s"] == "true" and x["c"].replace(" ", "") == "search_path=public,pg_temp" for x in row), "%s: security definer, search_path public, pg_temp" % fn)
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall ok")
sys.exit(1 if fails else 0)
