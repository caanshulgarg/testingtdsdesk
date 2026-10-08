"""python3 run_migration62.py - migration-62-tds-rate-worked-out (07-Oct-2026, the owner's decision, option A: "Work out the
rate as tax divided by assessable amount where Tally stores 0, and mark it as worked out"). On throwaway PostgreSQL
(pg_stand, port 30620 unless PG62_PORT; never a real database), built 32 -> ... -> 55 -> 56 -> 57 -> 58 -> 59 -> 60 in
staging's order (and 61, privileges, when that file is in the tree: it is on branch perms-61), then 62 (twice).
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from' anywhere, add-only (no
     drop, no truncate, no rename; one column added), no real database named; one function, tally_ingest_details: 57's text
     with only lines marked "62" changed; security definer, search_path public, pg_temp; granted to nobody as in 57.
  1. running it (twice) changes no row; tally_tds_lines.rate_worked_out is false on every row there was.
  2. the real S5 capture (run 37492981527, bridge-go/testdata/real-tally-7.1/231/s5-tds-on-screen.daybook.xml, Tally's own
     Day Book export) read by parse.js and stored through tally_ingest_day: the Contractor line's TDS row has nature
     S231 Contract Work, rate 2, assessable 100000, amount 2000, rate_worked_out true.
  3. a stored rate (the part A payment fixture, Tally's rate 2): rate_worked_out false.
RED: before the file exists it stops at the first check."""
import os, re, sys, json, subprocess, difflib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql",
                                           "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql")]
# 61 (privileges, run on staging 06-Oct-2026; branch perms-61): applied before 62 when it is in the tree
if os.path.exists(os.path.join(SQLDIR, "migration-61-privileges.sql")): FILES.append(os.path.join(SQLDIR, "migration-61-privileges.sql"))
M62 = os.environ.get("M62_FILE") or os.path.join(SQLDIR, "migration-62-tds-rate-worked-out.sql")
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
B, D1 = "f79e4bc3-871d-4482-874d-000000000062", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"

# ---- the entries as tally-ingest sends them (parse.js, mapped as index.ts dayVouchers / dayLines do)
NODE = r"""
import fs from "fs";
const { parseDay, cleanName } = await import(process.argv[1]);
const out = {};
for (const f of process.argv.slice(2)) {
  let t = fs.readFileSync(f, "utf8"); const k = t.indexOf("<!-- the voucher collection"); if (k >= 0) t = t.slice(0, k);
  const r = parseDay(t);
  const nm = (x) => ({ ...x, ledger: cleanName(String(x.ledger || "")) });
  out[f.split("/").pop()] = { vouchers: r.vouchers.map((v) => ({ guid: v.guid, alter: v.alter, type: v.type, no: v.no, party: cleanName(v.party), narr: v.narr, cancel: v.cancel, opt: v.opt,
    gstin: v.gstin, pos: v.pos, ref: v.ref, refDate: v.refDate, cmp: v.cmp, fid: v.fid ?? null, irn: v.irn, ackNo: v.ackNo, ackDate: v.ackDate, eway: v.eway,
    items: v.items.map((x) => ({ ...x, item: cleanName(x.item) })), costs: v.costs.map(nm), banks: v.banks.map(nm), tds: v.tds.map((x) => ({ ...nm(x), party: cleanName(x.party) })), dues: v.dues.map(nm), checks: v.checks })),
    lines: r.lines.map((l) => [l[0], cleanName(l[1]), ...l.slice(2)]) };
}
console.log(JSON.stringify(out));
"""
S5 = os.path.join(HERE, "..", "bridge-go", "testdata", "real-tally-7.1", "231", "s5-tds-on-screen.daybook.xml")
PAY = os.path.join(HERE, "..", "bridge-go", "testdata", "typed-like-7.1", "partA-payment-tds.xml")
pr = subprocess.run(["node", "--input-type=module", "-e", NODE, os.path.join(SQLDIR, "parse.js"), S5, PAY], capture_output=True, text=True)
if pr.returncode: print(pr.stderr); raise SystemExit("parse.js could not read the fixtures")
FX = json.loads(pr.stdout)
s5, pay = FX["s5-tds-on-screen.daybook.xml"], FX["partA-payment-tds.xml"]
ok(len(s5["vouchers"]) == 1 and s5["vouchers"][0]["tds"][0].get("rateWorkedOut") is True, "parse.js marks S5's rate worked out (%s)" % s5["vouchers"][0]["tds"])

text = open(M62).read() if os.path.exists(M62) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M62))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included): %d" % low.count("delete from"))
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\balter\s+table\s+\S+\s+(drop|rename)", low) and "create table" not in low,
   "0. add-only (no drop, no truncate, no rename, no new table)")
ok(re.findall(r"alter table [^;]*;", low) == ["alter table public.tally_tds_lines add column if not exists rate_worked_out boolean not null default false;"], "0. one column added: tally_tds_lines.rate_worked_out")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_ingest_details"], "0. one function replaced: tally_ingest_details (%s)" % FNS)
def block(t, start, end):
    i = t.index(start); j = t.index("\n", t.index(end, i)) + 1; return t[i:j]
m57 = open(os.path.join(SQLDIR, "migration-57-entry-details.sql")).read()
S_D = "create or replace function public.tally_ingest_details(p_book uuid, p_vouchers jsonb, p_keep boolean)"
E_D = "revoke all on function public.tally_ingest_details(uuid, jsonb, boolean) from public, anon, authenticated, service_role;"
D57, D62 = block(m57, S_D, E_D), block(text, S_D, E_D)
hunks, cur = [], None
for d in difflib.unified_diff(D57.split("\n"), D62.split("\n"), lineterm="", n=0):
    if d.startswith("@@"): cur = []; hunks.append(cur)
    elif cur is not None and d[:1] in "+-" and not d.startswith(("+++", "---")): cur.append(d)
unmarked = [h for h in hunks if not any(re.search(r"--.*\b62\b", x) for x in h if x.startswith("+"))]
ok(D57 != D62 and not unmarked, "0. tally_ingest_details is 57's text but %d changed places, each marked '62' (unmarked: %s)" % (len(hunks), unmarked[:1]))

db = pg_stand.start(int(os.environ.get("PG62_PORT") or 30620))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def day(book, d, vouchers, lines): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(book), q(d), js(vouchers), js(lines), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
def can(role, sig): return db.one("select has_function_privilege(%s, %s, 'execute')" % (q(role), q("public." + sig)))
def tds(guid): return [tuple(r.values()) for r in db.rows("select ledger, nature, rate::text, assessable::text, amount::text, party, rate_worked_out::text from tally_tds_lines where book_id = %s and guid = %s and gone_at is null order by line_no" % (q(B), q(guid)))]
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'FinCom Spike Co', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.3.1');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'FinCom Spike Co', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    # a TDS row stored before 62 (the part A payment, under 57)
    ok(day(B, "2026-10-02", pay["vouchers"], pay["lines"]).get("ok") is True, "before 62: the part A payment stored")
    before = db.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from tally_tds_lines x")

    print("== migration 62" + (" (after 61, privileges)" if FILES[-1].endswith("migration-61-privileges.sql") else ""))
    for n in (1, 2):
        rr = psql_text(text); ok(rr.returncode == 0, "migration-62 runs (%d) %s" % (n, rr.stderr.strip()[-600:] if rr.returncode else ""))
        if rr.returncode: raise SystemExit("cannot go on without the migration")
    after = db.one("select md5(coalesce(string_agg(row(id, book_id, firm_id, guid, alter_id, day, line_no, ledger, nature, section, rate, assessable, amount, party, deductee_type, at, gone_at, section_from)::text, '|' order by row(id, book_id, firm_id, guid, alter_id, day, line_no, ledger, nature, section, rate, assessable, amount, party, deductee_type, at, gone_at, section_from)::text), '')) from tally_tds_lines")
    ok(after == before and db.one("select count(*) from tally_tds_lines where rate_worked_out") == "0" and db.one("select count(*) from tally_tds_lines") == "1", "1. running it (twice) changes no row; the row there was: rate_worked_out false")
    r = db.rows("select prosecdef::text as d, coalesce(array_to_string(proconfig, ','), '') as c from pg_proc where proname = 'tally_ingest_details' and pronamespace = 'public'::regnamespace")
    ok(len(r) == 1 and r[0]["d"] == "true" and r[0]["c"].replace(" ", "") == "search_path=public,pg_temp", "0. tally_ingest_details: security definer, search_path public, pg_temp")
    ok(tuple(can(x, "tally_ingest_details(uuid, jsonb, boolean)") for x in ("anon", "authenticated", "service_role")) == ("f", "f", "f"), "0. tally_ingest_details: granted to nobody")

    print("== 2. the real S5 capture through the days path")
    v = s5["vouchers"][0]
    ok(day(B, "2027-01-01", s5["vouchers"], s5["lines"]).get("ok") is True, "the Day Book of 01-Jan-2027 (S5) stored")
    got = tds(v["guid"])
    ok(got == [("S231 Contractor", "S231 Contract Work", "2", "100000", "2000", "S231 Contractor", "true")], "S5: the Contractor line, rate 2 worked out (%s)" % got)
    print("== 3. a stored rate is not marked")
    pv = pay["vouchers"][0]
    ok(day(B, "2026-10-02", pay["vouchers"], pay["lines"]).get("ok") is True, "the part A payment stored again under 62")
    got = tds(pv["guid"])
    ok(got == [("TDS on Contract", "Payment to Contractors", "2", "100000", "2000", "Spike Contractor", "false")], "the payment: Tally's stored rate 2, not worked out (%s)" % got)
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL OK", len(fails)))
if fails: raise SystemExit(1)
