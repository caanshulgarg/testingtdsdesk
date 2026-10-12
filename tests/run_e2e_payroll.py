"""python3 run_e2e_payroll.py - bridge 2.4.4 (the owner's decisions of 12-Oct-2026): every payroll figure of a test company with
known answers (tests/fixtures/payroll-e2e: setup.json; the answers worked out apart, by make_expected.py, never by FinCom's
code: expected.json) reaches FinCom's salary pages and 24Q, to the paisa:
  1. the company's entries as Tally gives them (make.mjs: Tally's own XML of each payroll in the PaySlip form, each salary
     payment with the employee paid, each salary TDS payment with its challan) read by the cloud's parse.js and stored by
     tally_ingest_day on throwaway PostgreSQL built with staging's migrations and 74 (pg_stand; never a real database); the
     employees and pay heads as bridge 2.4.4 sends them (tally_ingest_employees; the pay-head columns);
  2. FinCom's app code on what the cloud keeps (e2e_payroll_app.js: its REST reads answered from those rows): the employees,
     each month's pay register, 24Q Annexure I per quarter with the challan of each month, Annexure II / Form 16 Part B per
     employee, the 24Q text file; compared with expected.json figure by figure;
  3. nothing personal kept: no bank account, IFSC or Aadhaar-like number of the masters in any table; the cost centre that is
     not payroll's never an employee.
REAL=<dir> reads the bridge's own bodies of the real-Tally gate (tally-versions mode payg) instead of the made-up Day Book."""
import os, re, sys, json, gzip, subprocess, difflib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
TD = os.path.join(HERE, "..", "bridge-go", "testdata", "gsttype242", "7.1")
STAGING = ["migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql", "@34", "migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql",
           "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql", "migration-40-states-carried.sql", "migration-41-day-counts.sql",
           "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql", "migration-46-trial-tools.sql",
           "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
           "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql",
           "migration-68-alert-dismissals.sql", "migration-70-alert-dismissals-tighten.sql", "migration-61-privileges.sql",
           "migration-62-tds-rate-worked-out.sql", "migration-63-recorder-repeat.sql", "migration-64-pages-live.sql", "migration-65-selfchecks.sql", "migration-66-recorder-masters.sql",
           "migration-67-recorder-renumbered.sql"]
FILES = [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql") if f == "@34" else os.path.join(SQLDIR, f) for f in STAGING]
FILES = [f for f in FILES if os.path.exists(f)]
FILES.append(os.path.join(SQLDIR, "migration-72-gst-type.sql"))
FILES.append(os.path.join(SQLDIR, "migration-73-tds-fields.sql"))
FILES.append(os.path.join(SQLDIR, "migration-74-payroll.sql"))
FX = os.path.join(HERE, "fixtures", "payroll-e2e")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, OWNER = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555"
B, D1 = "f79e4bc3-871d-4482-874d-0000000e2e44", "58d73e82-57f3-4f72-9f3d-14cc93a5be44"
SET = json.load(open(os.path.join(FX, "setup.json")))
EXP = json.load(open(os.path.join(FX, "expected.json")))
import tempfile
TMP = tempfile.mkdtemp(prefix="e2epay-")
r = subprocess.run(["node", os.path.join(FX, "make.mjs"), TMP], capture_output=True, text=True)
if r.returncode: print(r.stderr); raise SystemExit("make.mjs failed")
SRC = os.environ.get("REAL") and os.path.join(os.environ["REAL"], "bodies.xml") or os.path.join(TMP, "daybook.xml")
NODE = r"""
import fs from "fs";
import zlib from "zlib";
const { parseDay, cleanName } = await import(process.argv[1]);
const out = {};
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f); const t = f.endsWith(".gz") ? zlib.gunzipSync(b).toString("utf8") : b.toString("utf8");
  const r = parseDay(t);
  const nm = (x) => ({ ...x, ledger: cleanName(String(x.ledger || "")) });
  out[f.split("/").pop()] = { vouchers: r.vouchers.map((v) => ({ guid: v.guid, alter: v.alter, type: v.type, no: v.no, party: cleanName(v.party), narr: v.narr, cancel: v.cancel, opt: v.opt,
    gstin: v.gstin, pos: v.pos, ref: v.ref, refDate: v.refDate, cmp: v.cmp, fid: v.fid ?? null, irn: v.irn, ackNo: v.ackNo, ackDate: v.ackDate, eway: v.eway,
    items: v.items.map((x) => ({ ...x, item: cleanName(x.item) })), costs: v.costs.map(nm), banks: v.banks.map(nm), tds: v.tds.map((x) => ({ ...nm(x), party: cleanName(x.party) })), dues: v.dues.map(nm), checks: v.checks,
    ...(v.gst ? { gst: v.gst } : {}), ...(v.tdsx ? { tdsx: v.tdsx } : {}), ...(v.salpay ? { salpay: v.salpay.map(nm) } : {}), date: v.date })),
    lines: r.lines.map((l) => [l[0], cleanName(l[1]), ...l.slice(2)]) };
}
console.log(JSON.stringify(out));
"""

pr = subprocess.run(["node", "--input-type=module", "-e", NODE, os.path.join(SQLDIR, "parse.js"), SRC], capture_output=True, text=True)
if pr.returncode: print(pr.stderr); raise SystemExit("parse.js could not read the entries")
DAYS = json.loads(pr.stdout)[os.path.basename(SRC)]
db = pg_stand.start(int(os.environ.get("PGE2EPAY_PORT") or 30745))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def iso(d): return "%s-%s-%s" % (d[:4], d[4:6], d[6:8])
def day(book, d, vouchers, lines): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(book), q(d), js(vouchers), js(lines), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
def entries(vouchers, lines, keep=True):
    vs = [dict(v, day=iso(v["date"])) for v in vouchers]
    return j("select tally_ingest_entries(%s, %s, %s, true, %s)::text" % (q(B), js(vs), js(lines), "true" if keep else "false"))
def can(role, sig): return db.one("select has_function_privilege(%s, %s, 'execute')" % (q(role), q("public." + sig)))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    F2 = "88888888-8888-8888-8888-888888888888"; B2 = "f79e4bc3-871d-4482-874d-000000000274"; OTHER = "44444444-4444-4444-4444-444444444444"
    db.sql("""insert into firms values (%(F)s, 'Test firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into firms values (%(F2)s, 'Other firm') on conflict do nothing; insert into members values (%(OT)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'PE Payroll Test Co', '2026-04-01', '2026-03-31');
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B2)s, %(F2)s, 'c2', 'Other Co', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'RUNNER', 'h', '2.4.4');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'PE Payroll Test Co', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1), "F2": q(F2), "B2": q(B2), "OT": q(OTHER)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    ok(True, "the database built with staging's %d migrations in staging's order (74 last)" % len(FILES))
    def iso(d): return "%s-%s-%s" % (d[:4], d[4:6], d[6:8])
    print("== 1. the cloud keeps the company's payroll")
    rr = psql_text(open(os.path.join(SQLDIR, "migration-74-payroll.sql")).read()); ok(rr.returncode == 0, "migration 74 runs " + rr.stderr[-300:])
    # the pay heads as the bridge's ledger list brings them (the 15th to 18th columns: tally-ingest writes them so)
    for h in SET["payHeads"]:
        db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, pay_type, pay_stat_type, it_component, for_payroll) values (%s, %s, %s, %s, %s, %s, %s, true)" % (q(B), q(F), q(h[0]), q(h[1]), q(h[2]), q(h[3]), q(h[4])))
    for n, p in ((SET["payable"], "Current Liabilities"), (SET["bank"], "Bank Accounts")):
        db.sql("insert into tally_ledgers (book_id, firm_id, name, parent) values (%s, %s, %s, %s)" % (q(B), q(F), q(n), q(p)))
    # the employees as bridge 2.4.4 sends them (payroll rows only: the cost centre not for payroll is dropped by the bridge)
    rows = [["pe-grp", 1, 1, SET["group"], "", SET["category"], 1, "", "", "", ""]] + \
           [["pe-emp-%d" % i, 10 + i, 10 + i, e[0], SET["group"], SET["category"], 0, e[1], e[2], e[3], e[4]] for i, e in enumerate(SET["employees"])]
    ok(db.one("select tally_ingest_employees(%s, %s, true)" % (q(B), js(rows))) == str(len(rows)), "the employees stored (%d)" % len(rows))
    by = {}
    for v in DAYS["vouchers"]: by.setdefault(v["date"], []).append(v)
    for d, vs in sorted(by.items()):
        gids = set(v["guid"] for v in vs)
        a = db.one("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(B), q(iso(d)), js(vs), js([l for l in DAYS["lines"] if l[0] in gids]), len(vs), max(v["alter"] for v in vs)))
        if '"ok": true' not in a.replace('"ok":true', '"ok": true'): ok(False, "day %s stored: %s" % (d, a[:300]))
    ok(db.one("select count(*) from tally_vouchers where book_id = %s" % q(B)) == str(len(DAYS["vouchers"])), "every entry stored (%d)" % len(DAYS["vouchers"]))
    ok(db.one("select count(*) from tally_cost_allocs where book_id = %s and gone_at is null" % q(B)) == str(sum(len(p["rows"]) * 6 for p in SET["payrolls"]) - sum(1 for p in SET["payrolls"] for r in p["rows"] if not r["heads"]["PE Income Tax"] or not r["heads"]["PE HRA"])),
       "each employee's amount per pay head kept (tally_cost_allocs)")
    ok(db.one("select count(*) from tally_salary_pays where book_id = %s and gone_at is null" % q(B)) == str(sum(len(s["rows"]) for s in SET["salaryPayments"])), "the salary paid to each employee kept")
    leak = db.one("select count(*) from (select row_to_json(t)::text as x from tally_employees t union all select row_to_json(t)::text from tally_salary_pays t union all select row_to_json(t)::text from tally_cost_allocs t union all select coalesce(tds_tally::text, '') from tally_vouchers) z where x ~ '5099000000|HDFC00099|9999888877'")
    ok(leak == "0", "3. no bank account, IFSC or Aadhaar-like number in any table")
    ok(db.one("select count(*) from tally_employees where name = 'PE Delhi Branch'") == "0", "3. the cost centre not for payroll is no employee")
    T = {}
    T["tally_employees"] = db.rows("select guid, name, parent, category, is_group, pan, joined::text as joined, left_on::text as left_on, designation, gone_at::text as gone_at, book_id::text as book_id from tally_employees where book_id = %s" % q(B))
    for r0 in T["tally_employees"]: r0["is_group"] = r0["is_group"] in ("t", "true", True)
    T["tally_ledgers"] = db.rows("select name, pay_type, pay_stat_type, it_component, (for_payroll)::text as for_payroll, book_id::text as book_id from tally_ledgers where book_id = %s" % q(B))
    T["tally_cost_allocs"] = db.rows("select guid, alter_id::text as alter_id, day::text as day, ledger, centre, amount::text as amount, gone_at::text as gone_at, book_id::text as book_id from tally_cost_allocs where book_id = %s" % q(B))
    T["tally_salary_pays"] = db.rows("select guid, alter_id::text as alter_id, day::text as day, ledger, employee, amount::text as amount, paid_on::text as paid_on, gone_at::text as gone_at, book_id::text as book_id from tally_salary_pays where book_id = %s" % q(B))
    T["tally_vouchers"] = [dict(v, tds_tally=json.loads(v["tds_tally"]) if v["tds_tally"] else None) for v in db.rows("select guid, day::text as day, alter_id::text as alter_id, vtype, vno, party, narration, cancelled::text as cancelled, optional::text as optional, deleted_at::text as deleted_at, gstin, pos, ref, ref_date::text as ref_date, cmp_gstin, tds_tally::text as tds_tally, tds_tally_alter_id::text as tds_tally_alter_id, book_id::text as book_id from tally_vouchers where book_id = %s" % q(B))]
    for v in T["tally_vouchers"]:
        v["cancelled"] = v["cancelled"] == "true"; v["optional"] = v["optional"] == "true"; v["alter_id"] = int(v["alter_id"] or 0)
        if v["tds_tally_alter_id"]: v["tds_tally_alter_id"] = int(v["tds_tally_alter_id"])
    T["tally_lines"] = db.rows("select guid, ledger, amount::text as amount, hsn, rate::text as rate, book_id::text as book_id from tally_lines where book_id = %s" % q(B))
    for t0 in T.values():
        for r0 in t0:
            for k, v in list(r0.items()):
                if v == "": r0[k] = None if k in ("gone_at", "deleted_at", "joined", "left_on", "paid_on") else v
    for r0 in T["tally_ledgers"]: r0["for_payroll"] = r0["for_payroll"] == "true"
finally:
    db.stop()

print("== 2. FinCom's salary pages and 24Q on what the cloud keeps")
inp, outp = os.path.join(TMP, "in.json"), os.path.join(TMP, "out.json")
json.dump({"setup": os.path.join(FX, "setup.json"), "book": B, "tables": T}, open(inp, "w"))
if os.environ.get("PAY_WRITE_TABLES"):   # the cloud copy's rows for the screen test (run_payroll_ui.py), written when asked
    json.dump({"book": B, "tables": T}, open(os.path.join(FX, "tables.json"), "w"), indent=0, sort_keys=True)
r = subprocess.run(["node", os.path.join(HERE, "e2e_payroll_app.js"), inp, outp], capture_output=True, text=True, cwd=HERE)
if r.returncode: print(r.stderr[-3000:]); raise SystemExit("the app could not run")
O = json.load(open(outp))
ok(not O.get("syncError"), "TDSTally.sync ran %s" % (O.get("syncError") or "")[:300])
P = lambda v: "%.2f" % round(float(v or 0) + 0.0, 2)
ok([e["name"] for e in O["employees"]] == sorted(e[0] for e in SET["employees"]) and O["groups"] == [SET["group"]], "the employees (and the group) as Tally keeps them")
ok(all(e["pan"] == next(x[1] for x in SET["employees"] if x[0] == e["name"]) for e in O["employees"]), "each employee's PAN")
ok(O["months"] == sorted(EXP["registers"].keys()), "the months paid (%s)" % O["months"])
bad = []
for ym, rows in EXP["registers"].items():
    got = {r["employee"]: r for r in O["registers"].get(ym, [])}
    for w in rows:
        g = got.get(w["employee"])
        if not g or any(P(g[k]) != w[k] for k in ("gross", "ded", "net", "tds")): bad.append((ym, w["employee"], g and {k: g[k] for k in ("gross", "ded", "net", "tds")}, w))
    if len(got) != len(rows): bad.append((ym, "count", len(got), len(rows)))
ok(not bad, "every month's pay register to the paisa (%d months, %d rows) %s" % (len(EXP["registers"]), sum(len(v) for v in EXP["registers"].values()), bad[:3]))
ch = O["challans"]
ok(len(ch) == sum(1 for c in SET["tdsPayments"] if c["tax"]) and all(c["section"] == "192" and c["from"] == "tally" for c in ch), "a challan From Tally for each month's salary TDS (%d)" % len(ch))
bad = []
for qq in ("Q1", "Q2", "Q3", "Q4"):
    want = EXP["annex1"].get(qq, []); got = O["annex1"][qq]
    key = lambda r: (r["date"], r["employee"])
    gw = sorted(got, key=key)
    if len(gw) != len(want): bad.append((qq, "count", len(gw), len(want))); continue
    for g, w in zip(gw, sorted(want, key=key)):
        if g["employee"] != w["employee"] or g["date"] != w["date"] or P(g["paid"]) != w["paid"] or P(g["tds"]) != w["tds"] or (g["challan"] or None) != (w["challan"] or None):
            bad.append((qq, g, w))
ok(not bad, "24Q Annexure I, every employee every month: the date paid, the amount, the TDS and its challan, to the paisa %s" % bad[:3])
bad = []
for name, w in EXP["annex2"].items():
    g = O["annex2"].get(name)
    if not g: bad.append((name, "missing")); continue
    for k, v in w.items():
        gv = g.get(k)
        if k == "regime":
            if gv != v: bad.append((name, k, gv, v))
        elif P(gv) != v: bad.append((name, k, gv, v))
ok(not bad, "24Q Annexure II and Form 16 Part B, every employee, every figure to the paisa (%d employees) %s" % (len(EXP["annex2"]), bad[:4]))
ok("Employees without a valid PAN" in " ".join(O["checks"]["Q3"]) and not any("not tagged" in c for c in " ".join(O["checks"]["Q1"])), "before filing: the employee without a PAN said; every month's TDS tagged")
f4 = O["fvu"]["Q4"]
ok(not f4.get("error") and f4.get("draft") and "_DRAFT" in f4.get("name", "") and f4["text"].count("^SD^") == len(EXP["annex2"]) and f4["text"].count("^DD^") == sum(1 for w in EXP["annex1"]["Q4"] if w["tds"] != "0.00"),
   "the Q4 text file: a challan record for each month, a deductee record for each payment with TDS, a salary record for each employee, marked a draft (%s)" % ({k: f4.get(k) for k in ("rows", "challans", "salaryRecords", "name", "error")}))
ok(O["fvu"]["Q1"].get("text", "").count("^CD^") == 3, "the Q1 text file: three challans")
print("\n%s: %d" % ("FAILED" if fails else "ALL OK", len(fails)))
if fails: raise SystemExit(1)
