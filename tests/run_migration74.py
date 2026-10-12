"""python3 run_migration74.py - migration-74-payroll (12-Oct-2026, bridge 2.4.4; the owner's decisions of 12-Oct-2026: payroll
and salary TDS from Tally). On throwaway PostgreSQL (pg_stand, port 30740 unless PG74_PORT; never a real database), built with
staging's migrations in staging's order (32 .. 60, 68, 70, 61, 62 .. 67, 72, 73), then 74 (twice).
  0. the file: one transaction, no 'delete from', add-only (no drop, no truncate, no rename; four columns added to
     tally_ledgers, two tables tally_employees and tally_salary_pays with row level security read by a member of the firm);
     three functions: tally_ingest_salpay (new, granted to nobody), tally_ingest_employees (new, service_role only),
     tally_ingest_details (73's text with ONE line added, marked "74"); all security definer, search_path public, pg_temp.
  1. running it (twice) changes no row; the new columns are null on every row there was.
  2. the Day Book path: Tally's own full export of TallyPrime 7.1 (bridge-go/testdata/payroll244/7.1/full-*.xml.gz) read by
     parse.js: the payroll's per-employee amounts in tally_cost_allocs (not only totals); the salary payment's employees and
     amounts in tally_salary_pays, at the entry's AlterID.
  3. the recorder path: the bridge 2.4.4 body of the same entries stores the same; a later version replaces the rows (the
     earlier ones marked gone, never removed); a body without "salpay" (a bridge before 2.4.4) leaves them; only the version
     just stored; another book's call never writes this book.
  4. the employees: tally_ingest_employees stores and brings up to date by GUID; a complete list marks the employees it no
     longer names gone (never removed), and one named again comes back; bad rows skipped; only the eleven columns.
  5. a member reads the firm's employees and salary rows only; anon nothing; a member writes nothing.
RED: before the file exists it stops at the first check."""
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
M74 = os.environ.get("M74_FILE") or os.path.join(SQLDIR, "migration-74-payroll.sql")
TD = os.path.join(HERE, "..", "bridge-go", "testdata", "payroll244", "7.1")
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
B, D1 = "f79e4bc3-871d-4482-874d-000000000074", "58d73e82-57f3-4f72-9f3d-14cc93a5b274"

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

IDS = ["PR-NOV", "SAL-PAY-NOV"]
srcs = [os.path.join(TD, "full-%s.xml.gz" % i) for i in IDS] + [os.path.join(TD, "obj-%s-stripped.xml" % i) for i in IDS]
pr = subprocess.run(["node", "--input-type=module", "-e", NODE, os.path.join(SQLDIR, "parse.js")] + srcs, capture_output=True, text=True)
if pr.returncode: print(pr.stderr); raise SystemExit("parse.js could not read the fixtures")
FX = json.loads(pr.stdout)
FULL = {i: FX["full-%s.xml.gz" % i] for i in IDS}
BODY = {i: FX["obj-%s-stripped.xml" % i] for i in IDS}
GID = {i: BODY[i]["vouchers"][0]["guid"] for i in IDS}
for i in IDS: assert FULL[i]["vouchers"][0]["guid"] == GID[i], i

text = open(M74).read() if os.path.exists(M74) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M74))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\balter\s+table\s+\S+\s+(drop|rename)", low) and not re.search(r"alter\s+column", low),
   "0. add-only (no drop, no truncate, no rename, no column changed)")
cols = re.findall(r"alter table public\.(tally_vouchers|tally_ledgers) add column if not exists (\w+) (text|jsonb|bigint|boolean);", low)
ok([(t, c) for t, c, _ in cols] == [("tally_ledgers", "pay_type"), ("tally_ledgers", "pay_stat_type"), ("tally_ledgers", "it_component"), ("tally_ledgers", "for_payroll")]
   and len(re.findall(r"alter table public\.\w+ add column", low)) == 4, "0. four columns added (%s)" % cols)
ok(re.findall(r"create table if not exists public\.(\w+)", low) == ["tally_employees", "tally_salary_pays"], "0. two tables added: tally_employees, tally_salary_pays")
ok(not re.search(r"birth|aadha|account_?n|ifsc|favour", re.sub(r"--[^\n]*", "", low)), "0. no date of birth, Aadhaar, account number, IFSC or the name in favour in any table or function")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_ingest_details", "tally_ingest_employees", "tally_ingest_salpay"], "0. three functions (%s)" % FNS)
def block(t, start, end):
    i = t.index(start); j2 = t.index("\n", t.index(end, i)) + 1; return t[i:j2]
m73 = open(os.path.join(SQLDIR, "migration-73-tds-fields.sql")).read()
S_D = "create or replace function public.tally_ingest_details(p_book uuid, p_vouchers jsonb, p_keep boolean)"
E_D = "revoke all on function public.tally_ingest_details(uuid, jsonb, boolean) from public, anon, authenticated, service_role;"
D73, D74 = block(m73, S_D, E_D), block(text, S_D, E_D)
diff = [d for d in difflib.unified_diff(D73.split("\n"), D74.split("\n"), lineterm="", n=0) if d[:1] in "+-" and not d.startswith(("+++", "---"))]
ok(len(diff) == 1 and diff[0].startswith("+") and "perform tally_ingest_salpay(p_book, p_vouchers);" in diff[0] and re.search(r"--.*\b74\b", diff[0]),
   "0. tally_ingest_details is 73's text with ONE line added, marked '74' (%s)" % diff)

db = pg_stand.start(int(os.environ.get("PG74_PORT") or 30740))
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
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'FinCom Spike Co', '2026-04-01', '2026-03-31');
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B2)s, %(F2)s, 'c2', 'Other Co', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'RUNNER', 'h', '2.4.4');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'FinCom Spike Co', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1), "F2": q(F2), "B2": q(B2), "OT": q(OTHER)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    ok(True, "the database built with staging's %d migrations in staging's order (73 last)" % len(FILES))
    lbefore = db.one("select md5(coalesce(string_agg(row(book_id, name, parent)::text, '|' order by name), '')) from tally_ledgers")
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent) values (%s, %s, 'FC Basic', 'Indirect Expenses')" % (q(B), q(F)))
    lbefore = db.one("select md5(coalesce(string_agg(row(book_id, name, parent)::text, '|' order by name), '')) from tally_ledgers")
    print("== migration 74")
    for n in (1, 2):
        rr = psql_text(text); ok(rr.returncode == 0, "migration-74 runs (%d) %s" % (n, rr.stderr.strip()[-600:] if rr.returncode else ""))
        if rr.returncode: raise SystemExit("cannot go on without the migration")
    lafter = db.one("select md5(coalesce(string_agg(row(book_id, name, parent)::text, '|' order by name), '')) from tally_ledgers")
    ok(lafter == lbefore and db.one("select count(*) from tally_ledgers where pay_type is not null or pay_stat_type is not null or it_component is not null or for_payroll is not null") == "0",
       "1. running it (twice) changes no row; the new columns null on the rows there were")
    for fn, sig, want in (("tally_ingest_details", "tally_ingest_details(uuid, jsonb, boolean)", ("f", "f", "f")), ("tally_ingest_salpay", "tally_ingest_salpay(uuid, jsonb)", ("f", "f", "f")),
                          ("tally_ingest_employees", "tally_ingest_employees(uuid, jsonb, boolean)", ("f", "f", "t"))):
        r = db.rows("select prosecdef::text as d, coalesce(array_to_string(proconfig, ','), '') as c from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn))
        ok(len(r) == 1 and r[0]["d"] == "true" and r[0]["c"].replace(" ", "") == "search_path=public,pg_temp", "0. %s: security definer, search_path public, pg_temp" % fn)
        ok(tuple(can(x, sig) for x in ("anon", "authenticated", "service_role")) == want, "0. %s: anon / authenticated / service_role execute %s" % (fn, want))
    def costs(guid): return db.rows("select centre, ledger, amount::text as a from tally_cost_allocs where book_id = %s and guid = %s and gone_at is null order by centre, ledger" % (q(B), q(guid)))
    def sal(guid): return db.rows("select employee, amount::text as a, paid_on::text as d, ledger, alter_id::text as al from tally_salary_pays where book_id = %s and guid = %s and gone_at is null order by employee" % (q(B), q(guid)))

    print("== 2. the Day Book path: Tally's full export (TallyPrime 7.1)")
    for i in IDS:
        vs = FULL[i]["vouchers"]
        r = day(B, iso(vs[0]["date"]), vs, [l for l in FULL[i]["lines"] if l[0] == GID[i]]); ok(r.get("ok") is True, "%s's day stored %s" % (i, "" if r.get("ok") else r))
    c = costs(GID["PR-NOV"])
    ok(len(c) == 17 and {"centre": "FC Emp One", "ledger": "FC Basic", "a": "-50000"} in c and {"centre": "FC Emp Three", "ledger": "FC ESI Employee", "a": "141"} in c,
       "2. the payroll's per-employee amounts kept from the Day Book (%d rows: %s)" % (len(c), c[:3]))
    s1 = sal(GID["SAL-PAY-NOV"])
    ok([(x["employee"], x["a"], x["d"]) for x in s1] == [("FC Emp One", "75000.00", "2026-12-02"), ("FC Emp Three", "17219.00", "2026-12-02"), ("FC Emp Two", "45500.00", "2026-12-02")]
       and all(x["ledger"] == "FC Salary Bank" for x in s1), "2. the salary paid to each employee (%s)" % s1)

    print("== 3. the recorder path: the bridge's bodies")
    db.sql("update tally_salary_pays set gone_at = now() where book_id = %s; update tally_cost_allocs set gone_at = now() where book_id = %s" % (q(B), q(B)))
    for i in IDS:
        r = entries(BODY[i]["vouchers"], BODY[i]["lines"]); ok(r.get("ok") is True, "3. %s from bridge 2.4.4's body %s" % (i, "" if r.get("ok") else r))
    ok(costs(GID["PR-NOV"]) == c, "3. the payroll's per-employee amounts: the same as the Day Book's")
    ok(sal(GID["SAL-PAY-NOV"]) == s1, "3. the salary paid: the same as the Day Book's")
    sv = BODY["SAL-PAY-NOV"]["vouchers"][0]
    v2 = dict(sv, alter=sv["alter"] + 5, salpay=[dict(sv["salpay"][0], amt=76000)])
    r = entries([v2], BODY["SAL-PAY-NOV"]["lines"]); s2 = sal(GID["SAL-PAY-NOV"])
    ok(r.get("ok") is True and [(x["employee"], x["a"]) for x in s2] == [("FC Emp One", "76000.00")] and db.one("select count(*) from tally_salary_pays where book_id = %s and guid = %s and gone_at is not null" % (q(B), q(GID["SAL-PAY-NOV"]))) != "0",
       "3. a later version replaces the rows; the earlier ones marked gone, never removed (%s)" % s2)
    v3 = {k: v for k, v in sv.items() if k != "salpay"}; v3["alter"] = sv["alter"] + 6
    r = entries([v3], BODY["SAL-PAY-NOV"]["lines"])
    ok(r.get("ok") is True and sal(GID["SAL-PAY-NOV"]) == s2, "3. a body without salpay (a bridge before 2.4.4) leaves the rows")
    db.one("select tally_ingest_salpay(%s, %s)::text" % (q(B), js([dict(sv, alter=sv["alter"] + 99, salpay=[{"employee": "X", "amt": 1}])])))
    ok([(x["employee"], x["a"]) for x in sal(GID["SAL-PAY-NOV"])] == [("FC Emp One", "76000.00")], "3. salpay for another AlterID than the row's is not written")
    db.one("select tally_ingest_salpay(%s, %s)::text" % (q(B2), js([dict(sv, alter=sv["alter"] + 6, salpay=[{"employee": "X", "amt": 1}])])))
    ok([(x["employee"], x["a"]) for x in sal(GID["SAL-PAY-NOV"])] == [("FC Emp One", "76000.00")], "3. another book's call never writes this book's entry")
    db.one("select tally_ingest_salpay(%s, %s)::text" % (q(B), js([dict(sv, alter=sv["alter"] + 6, salpay=[{"employee": "Y", "amt": "1e9; drop"}, {"employee": "", "amt": 5}, "x"])])))
    ok([(x["employee"], x["a"]) for x in sal(GID["SAL-PAY-NOV"])] == [("Y", "0.00")], "3. a bad amount kept as 0, a row without an employee skipped")

    print("== 4. the employees")
    E = [["g-1", 229, 339, "Asha Rao", "Office Staff", "Primary Cost Category", 0, "abcpr1234k", "20250401", "", "Accountant"],
         ["g-grp", 228, 338, "Office Staff", "", "Primary Cost Category", 1, "", "", "", ""],
         ["g-2", 230, 340, "Ravi Kumar", "Office Staff", "Primary Cost Category", 0, "ABCPK4321L", "20260601", "20261031", "Manager", "extra", "AADHAR 999900001001"],
         ["", 1, 1, "no guid"], ["g-x", 1, 1, ""], "not a row", ["g-bad", "x", "y", "Bad Ids", "", "", 0, "TOO-LONG-PAN-123", "2026-13-45", "x", "d"]]
    ok(db.one("select tally_ingest_employees(%s, %s, true)" % (q(B), js(E))) == "4", "4. four employees stored, the rows without a GUID or a name skipped")
    rows = db.rows("select guid, name, parent, is_group::text as g, pan, joined::text as j, left_on::text as l, designation as d, master_id::text as m, gone_at is null as live from tally_employees where book_id = %s order by guid" % q(B))
    ok([r["guid"] for r in rows] == ["g-1", "g-2", "g-bad", "g-grp"] and rows[0]["pan"] == "ABCPR1234K" and rows[0]["j"] == "2026-04-01".replace("2026-04-01", "2025-04-01") and rows[1]["l"] == "2026-10-31"
       and rows[3]["g"] == "true" and rows[2]["pan"] == "" and rows[2]["m"] in (None, "") and rows[2]["j"] in (None, ""), "4. stored as sent; a bad PAN or date left empty (%s)" % rows)
    ok(db.one("select count(*) from information_schema.columns where table_name = 'tally_employees' and column_name ~ 'birth|aadha|bank|account|ifsc|uan|gender|mobile|email'") == "0" and "999900001001" not in json.dumps(rows),
       "4. only the eleven columns: nothing else of a row is kept")
    ok(db.one("select tally_ingest_employees(%s, %s, true)" % (q(B), js([E[0], E[1]]))) == "2" and db.one("select string_agg(guid, ',' order by guid) from tally_employees where book_id = %s and gone_at is not null" % q(B)) == "g-2,g-bad"
       and db.one("select count(*) from tally_employees where book_id = %s" % q(B)) == "4", "4. a complete list marks the ones it no longer names gone, none removed")
    ok(db.one("select tally_ingest_employees(%s, %s, false)" % (q(B), js([E[2]]))) == "1" and db.one("select gone_at is null from tally_employees where book_id = %s and guid = 'g-2'" % q(B)) == "t"
       and db.one("select gone_at is null from tally_employees where book_id = %s and guid = 'g-1'" % q(B)) == "t", "4. named again: back; a list that is not complete marks nothing")
    ok(db.one("select tally_ingest_employees(%s, %s, true)" % (q("00000000-0000-0000-0000-000000000000"), js(E))) == "0", "4. a book that is not there: nothing")

    print("== 5. who reads them")
    db.sql("select tally_ingest_employees(%s, %s, true)" % (q(B2), js([["g-other", 1, 1, "Other Emp", "", "", 0, "", "", "", ""]])))
    mine = db.rows("set role authenticated; select guid from tally_employees order by guid;", OWNER)
    ok(sorted(r["guid"] for r in mine) == ["g-1", "g-2", "g-bad", "g-grp"], "5. a member reads the firm's employees only (%s)" % mine)
    mine = db.rows("set role authenticated; select distinct book_id::text as b from tally_salary_pays;", OWNER)
    ok([r["b"] for r in mine] == [B], "5. a member reads the firm's salary rows only")
    for t in ("tally_employees", "tally_salary_pays"):
        ok(db.one("select has_table_privilege('anon', 'public.%s', 'select')" % t) == "f" and db.one("select has_table_privilege('authenticated', 'public.%s', 'insert')" % t) == "f"
           and db.one("select has_table_privilege('authenticated', 'public.%s', 'update')" % t) == "f", "5. %s: anon reads nothing; a member writes nothing" % t)
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL OK", len(fails)))
if fails: raise SystemExit(1)
