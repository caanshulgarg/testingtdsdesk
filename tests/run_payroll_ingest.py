"""python3 run_payroll_ingest.py - bridge 2.4.4 (the owner's decisions of 12-Oct-2026; migration 74): tally-ingest
(server/tally-cloud/index.ts under Deno, against the stand-in for Supabase, fake_supabase.py) takes what bridge 2.4.4 sends:
  1. kind "employees": the bridge's whole payroll list goes to tally_ingest_employees as eleven columns per row (anything
     more in a row never passed: a personal field cannot reach the database through it), complete as the bridge says; an
     unlinked company refused (409); a database without migration 74: {ok: false} (the bridge sends it again later), nothing
     fails;
  2. kind "ledger_changes" (and "ledger_list"): the 15th to 18th columns (PAYTYPE, PAYSTATTYPE, ITCOMPONENT, FORPAYROLL)
     stored on tally_ledgers ("Not Applicable" blank, FORPAYROLL a yes / no); a 14-column row (a bridge before 2.4.4) leaves
     them; a database without 74's columns: the ledger kept current without them;
  3. kind "days" (the Day Book path): Tally's full export of a salary payment and a payroll (TallyPrime 7.1, run 38253610530)
     reaches tally_ingest_day with each employee's salary paid ("salpay": employee, amount, date; never the account, IFSC
     or the name in favour) and each employee's amount per pay head ("costs").
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, gzip, base64, hashlib, subprocess, threading, urllib.request, urllib.error, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
TD = os.path.join(HERE, "..", "bridge-go", "testdata", "payroll244", "7.1")
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111144"
DA, KA = "d1000000-0000-0000-0000-000000000044", "fcd_" + "a" * 48
GA = {"id": "go-aaaaaa444444", "computer": "PC-A", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.4.4"}
EMP_ARGS = []
real = FS.rpc
def rpc(name, a):
    if name == "tally_ingest_employees":
        if "tally_ingest_employees" in FS.NO_FN: raise LookupError("PGRST202")
        EMP_ARGS.append(a); return len(a.get("p_rows") or [])
    return real(name, a)
FS.rpc = rpc
FS.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ PAY", "client_id": "c1", "book_id": BOOK})
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-A", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.4.4"})
FS.T["tally_books"].append({"book_id": BOOK, "firm_id": FIRM, "client_id": "c1", "company": "ZZ PAY", "from_date": "2026-04-01", "open_as_on": "2026-03-31"})
FS.T["tally_groups"] = [{"book_id": BOOK, "firm_id": FIRM, "name": "Indirect Expenses", "parent": ""}, {"book_id": BOOK, "firm_id": FIRM, "name": "Current Liabilities", "parent": ""}]
FS.T["tally_ledgers"] = []
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KA):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    base = {"version": "2.4.4", "bridge": GA}
    print("== 1. employees")
    E = [["g-1", 229, 339, "Asha Rao", "Office Staff", "Primary Cost Category", 0, "ABCPR1234K", "20250401", "", "Accountant", "999900001001", "50100123456781"],
         ["g-grp", 228, 338, "Office Staff", "", "Primary Cost Category", 1, "", "", "", ""]]
    c, r = call(dict(base, kind="employees", company="NOT LINKED", company_guid="cg", employees=E, complete=True))
    ok(c == 409 and r.get("notLinked") is True and not EMP_ARGS, "an unlinked company: refused (409), nothing stored")
    c, r = call(dict(base, kind="employees", company="ZZ PAY", company_guid="cg", employees=E, complete=True, upto=900))
    a = EMP_ARGS[-1] if EMP_ARGS else {}
    ok(c == 200 and r.get("ok") is True and r.get("employees") == 2, "the payroll list taken (%s %s)" % (c, r))
    ok(a.get("p_book") == BOOK and a.get("p_complete") is True and [len(x) for x in a.get("p_rows", [])] == [11, 11], "eleven columns a row, complete (%s)" % a.get("p_rows"))
    ok("999900001001" not in json.dumps(a) and "50100123456781" not in json.dumps(a), "a column past the eleventh (a personal field) never passed on")
    ok(a.get("p_rows", [[]])[0] == ["g-1", 229, 339, "Asha Rao", "Office Staff", "Primary Cost Category", 0, "ABCPR1234K", "20250401", "", "Accountant"], "the row as sent (%s)" % a.get("p_rows", [[]])[0])
    c, r = call(dict(base, kind="employees", company="ZZ PAY", company_guid="cg", employees=E[:1], complete=False))
    ok(c == 200 and EMP_ARGS[-1].get("p_complete") is False, "not complete: said so")
    FS.NO_FN.add("tally_ingest_employees")
    c, r = call(dict(base, kind="employees", company="ZZ PAY", company_guid="cg", employees=E, complete=True))
    ok(c == 200 and r.get("ok") is False and "migration 74" in str(r.get("error")), "a database without migration 74: ok false, said (%s %s)" % (c, r))
    FS.NO_FN.discard("tally_ingest_employees")

    print("== 2. the pay-head fields")
    lch = lambda rows: call(dict(base, kind="ledger_changes", company="ZZ PAY", company_guid="cg", ledgers=rows, why="counter", after=1, upto=9))
    led = lambda name: next((x for x in FS.T["tally_ledgers"] if x.get("book_id") == BOOK and x.get("name") == name), None) or {}
    row = ["lg-basic", 501, 5, "FC Basic", "Indirect Expenses", "0", "", "", 0, "", "", "", "", [], "Earnings for Employees", "Not Applicable", "Basic Salary", "Yes"]
    c, r = lch([row]); d = led("FC Basic")
    ok(c == 200 and d.get("pay_type") == "Earnings for Employees" and d.get("pay_stat_type") == "" and d.get("it_component") == "Basic Salary" and d.get("for_payroll") is True,
       "the pay head stored with its type, statutory type and component (%s)" % d)
    c, r = lch([row[:14][:2] + [6] + row[3:14]]); d = led("FC Basic")
    ok(c == 200 and d.get("pay_type") == "Earnings for Employees" and d.get("it_component") == "Basic Salary" and d.get("alter_id") == 6, "a 14-column row (a bridge before 2.4.4) leaves them (%s)" % d)
    it = ["lg-it", 502, 7, "FC Income Tax", "Current Liabilities", "0", "", "", 0, "", "", "", "", [], "Employees' Statutory Deductions", "Income Tax", "", "Yes"]
    c, r = lch([it]); d = led("FC Income Tax")
    ok(c == 200 and d.get("pay_stat_type") == "Income Tax" and d.get("for_payroll") is True, "the income-tax pay head (%s)" % d)
    cash = ["lg-cash", 503, 8, "Cash", "Current Liabilities", "0", "", "", 0, "", "", "", "", [], "", "", "", ""]
    c, r = lch([cash]); d = led("Cash")
    ok(c == 200 and d.get("pay_type") == "" and d.get("for_payroll") is False, "a ledger that is not a pay head: blank, not for payroll (%s)" % d)
    FS.NO_COL["tally_ledgers"] = {"pay_type", "pay_stat_type", "it_component", "for_payroll"}
    c, r = lch([["lg-new", 504, 9, "FC HRA", "Indirect Expenses", "0", "", "", 0, "", "", "", "", [], "Earnings for Employees", "", "House Rent Allowance", "Yes"]]); d = led("FC HRA")
    ok(c == 200 and r.get("ok") is True and d.get("alter_id") == 9 and "pay_type" not in d, "a database without 74's columns: the ledger kept current without them (%s %s)" % (r, d))
    FS.NO_COL.clear()

    print("== 3. the Day Book path: Tally's full export of the salary payment and the payroll")
    days = []
    for f, day in (("full-SAL-PAY-NOV.xml.gz", "20261202"), ("full-PR-NOV.xml.gz", "20261101")):
        x = gzip.open(os.path.join(TD, f)).read().decode("utf8")
        n0 = len(FS.ARGS.get("tally_ingest_day", []))
        c, r = call(dict(base, kind="days", company="ZZ PAY", days=[{"day": day, "b64": base64.b64encode(x.encode("utf8")).decode()}]))
        got = FS.ARGS.get("tally_ingest_day", [])[n0:]
        days.append((c, r, got))
    (c1, r1, g1), (c2, r2, g2) = days
    v1 = (g1[0]["p_vouchers"] if g1 else [{}])[0]
    sp = [(x.get("employee"), x.get("amt"), x.get("date")) for x in v1.get("salpay", [])]
    ok(c1 == 200 and sp == [("FC Emp One", 75000, "20261202"), ("FC Emp Two", 45500, "20261202"), ("FC Emp Three", 17219, "20261202")], "the salary paid to each employee reaches the database (%s %s)" % (c1, sp))
    ok(not any(k in json.dumps(v1.get("salpay")) for k in ("50100123456781", "HDFC0001001", "ACCOUNT", "IFSC", "FAVOURING")), "never the account, IFSC or the name in favour")
    v2 = (g2[0]["p_vouchers"] if g2 else [{}])[0]
    cs = sorted((x.get("centre"), x.get("ledger"), x.get("amt")) for x in v2.get("costs", []))
    ok(c2 == 200 and len(cs) == 17 and ("FC Emp One", "FC Basic", -50000) in cs and ("FC Emp Two", "FC Income Tax", 2500) in cs, "each employee's amount per pay head reaches the database from the Day Book (%d)" % len(cs))
finally:
    fn.kill()
    FS.stop() if hasattr(FS, "stop") else None
if fails: print("".join(log[-40:]))
print("\n%s: %d" % ("FAILED" if fails else "ALL OK", len(fails)))
if fails: raise SystemExit(1)
