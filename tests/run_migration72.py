"""python3 run_migration72.py - migration-72-gst-type (11-Oct-2026, bridge 2.4.2; the owner's approval of 11-Oct-2026: "the
bridge sends each entry's GST type"). On throwaway PostgreSQL (pg_stand, port 30720 unless PG72_PORT; never a real database),
built with staging's migrations in staging's order (as tests/run_e2e_tdsgst.py: 32 .. 60, 68, 70, 61, 62 .. 67), then 72 (twice).
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from', add-only (no drop, no
     truncate, no rename, no new table; seven columns added to tally_vouchers), names no real database; two functions:
     tally_ingest_gsttype (new) and tally_ingest_details (62's text with ONE line added, marked "72"); both security
     definer, search_path public, pg_temp, granted to nobody.
  1. running it (twice) changes no row; the new columns are null on every row there was.
  2. the Day Book path (tally_ingest_day): Tally's own stored entries of TallyPrime 7.1 (bridge-go/testdata/gsttype242/7.1/
     coll-all.xml.gz, the Day Book's form) read by parse.js: each entry's GST type stored (SEZ, export, nil-rated, exempt,
     reverse charge, the blocked credit).
  3. the recorder path (tally_ingest_entries, keep): the bridge 2.4.2 body of the same entry (obj-<id>-stripped.xml) stores
     the same; a body from a bridge before 2.4.2 (no "gst") leaves the stored values as they are; an older body (lower
     AlterID) never overwrites a newer entry's type.
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
M72 = os.environ.get("M72_FILE") or os.path.join(SQLDIR, "migration-72-gst-type.sql")
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
B, D1 = "f79e4bc3-871d-4482-874d-000000000072", "58d73e82-57f3-4f72-9f3d-14cc93a5b272"

# ---- the entries as tally-ingest sends them (parse.js, mapped as index.ts dayVouchers / dayLines do, the "gst" key included)
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
    ...(v.gst ? { gst: v.gst } : {}), date: v.date })),
    lines: r.lines.map((l) => [l[0], cleanName(l[1]), ...l.slice(2)]) };
}
console.log(JSON.stringify(out));
"""
IDS = ["S03", "S05", "S06", "S10", "P03", "P04", "P04L"]
srcs = [os.path.join(TD, "coll-all.xml.gz")] + [os.path.join(TD, "obj-%s-stripped.xml" % i) for i in IDS]
pr = subprocess.run(["node", "--input-type=module", "-e", NODE, os.path.join(SQLDIR, "parse.js")] + srcs, capture_output=True, text=True)
if pr.returncode: print(pr.stderr); raise SystemExit("parse.js could not read the fixtures")
FX = json.loads(pr.stdout)
COLL = FX["coll-all.xml.gz"]
BODY = {i: FX["obj-%s-stripped.xml" % i] for i in IDS}
GID = {i: BODY[i]["vouchers"][0]["guid"] for i in IDS}
WANT = {"S03": ("Regular", "India", "false", "Sales to SEZ - Taxable", "Taxable", "Goods", "false"),
        "S05": ("Unregistered", "Germany", "false", "Exports - Taxable", "Taxable", "Goods", "false"),
        "S06": ("Unregistered", "Germany", "false", "Exports - LUT/Bond", "Exempt", "Goods", "false"),
        "S10": ("Regular", "India", "false", "Sales Nil Rated", "Nil Rated", "Goods", "false"),
        "P03": ("Unregistered/Consumer", "India", "true", "Purchase From Unregistered Dealer - Taxable", "Exempt", "Services", "false"),
        "P04": ("Regular", "India", "false", "Purchase Taxable", "Taxable", "Goods", "false"),
        "P04L": ("Regular", "India", "false", "Purchase Taxable", "Taxable", "Goods", "true")}
COLS = "gst_reg_type, gst_country, gst_rcm::text, gst_nature, gst_taxability, gst_supply, gst_ineligible::text"

text = open(M72).read() if os.path.exists(M72) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M72))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\balter\s+table\s+\S+\s+(drop|rename)", low) and "create table" not in low,
   "0. add-only (no drop, no truncate, no rename, no new table)")
cols = re.findall(r"alter table public\.tally_vouchers add column if not exists (\w+) (text|boolean);", low)
ok([c for c, _ in cols] == ["gst_reg_type", "gst_country", "gst_rcm", "gst_nature", "gst_taxability", "gst_supply", "gst_ineligible"] and len(re.findall(r"alter table", low)) == 7,
   "0. seven columns added to tally_vouchers, nothing else altered (%s)" % cols)
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_ingest_details", "tally_ingest_gsttype"], "0. two functions: tally_ingest_gsttype new, tally_ingest_details replaced (%s)" % FNS)
def block(t, start, end):
    i = t.index(start); j = t.index("\n", t.index(end, i)) + 1; return t[i:j]
m62 = open(os.path.join(SQLDIR, "migration-62-tds-rate-worked-out.sql")).read()
S_D = "create or replace function public.tally_ingest_details(p_book uuid, p_vouchers jsonb, p_keep boolean)"
E_D = "revoke all on function public.tally_ingest_details(uuid, jsonb, boolean) from public, anon, authenticated, service_role;"
D62, D72 = block(m62, S_D, E_D), block(text, S_D, E_D)
diff = [d for d in difflib.unified_diff(D62.split("\n"), D72.split("\n"), lineterm="", n=0) if d[:1] in "+-" and not d.startswith(("+++", "---"))]
ok(len(diff) == 1 and diff[0].startswith("+") and "perform tally_ingest_gsttype(p_book, p_vouchers);" in diff[0] and re.search(r"--.*\b72\b", diff[0]),
   "0. tally_ingest_details is 62's text with ONE line added, marked '72' (%s)" % diff)

db = pg_stand.start(int(os.environ.get("PG72_PORT") or 30720))
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
def gst(guid):
    r = db.rows("select %s from tally_vouchers where book_id = %s and guid = %s" % (COLS, q(B), q(guid)))
    return tuple(r[0].values()) if r else None
def can(role, sig): return db.one("select has_function_privilege(%s, %s, 'execute')" % (q(role), q("public." + sig)))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Test firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'FinCom Spike Co', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'RUNNER', 'h', '2.4.2');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'FinCom Spike Co', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    ok(True, "the database built with staging's %d migrations in staging's order" % len(FILES))
    # one entry stored before 72 (S01 of the Day Book's form)
    s01 = [v for v in COLL["vouchers"] if v["narr"].startswith("S01 ")]
    ok(day(B, iso(s01[0]["date"]), s01, [l for l in COLL["lines"] if l[0] == s01[0]["guid"]]).get("ok") is True, "before 72: S01 stored through the Day Book path")
    before = db.one("select md5(coalesce(string_agg(row(book_id, guid, day, alter_id, vtype, vno, party, gstin, pos)::text, '|' order by guid), '')) from tally_vouchers")
    print("== migration 72")
    for n in (1, 2):
        rr = psql_text(text); ok(rr.returncode == 0, "migration-72 runs (%d) %s" % (n, rr.stderr.strip()[-600:] if rr.returncode else ""))
        if rr.returncode: raise SystemExit("cannot go on without the migration")
    after = db.one("select md5(coalesce(string_agg(row(book_id, guid, day, alter_id, vtype, vno, party, gstin, pos)::text, '|' order by guid), '')) from tally_vouchers")
    ok(after == before and db.one("select count(*) from tally_vouchers where gst_reg_type is not null or gst_rcm is not null or gst_ineligible is not null or gst_nature is not null") == "0",
       "1. running it (twice) changes no row; the new columns null on the row there was")
    for fn, sig in (("tally_ingest_details", "tally_ingest_details(uuid, jsonb, boolean)"), ("tally_ingest_gsttype", "tally_ingest_gsttype(uuid, jsonb)")):
        r = db.rows("select prosecdef::text as d, coalesce(array_to_string(proconfig, ','), '') as c from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn))
        ok(len(r) == 1 and r[0]["d"] == "true" and r[0]["c"].replace(" ", "") == "search_path=public,pg_temp", "0. %s: security definer, search_path public, pg_temp" % fn)
        ok(tuple(can(x, sig) for x in ("anon", "authenticated", "service_role")) == ("f", "f", "f"), "0. %s: granted to nobody" % fn)

    print("== 2. the Day Book path: Tally's stored entries (TallyPrime 7.1)")
    by = {}
    for v in COLL["vouchers"]: by.setdefault(v["date"], []).append(v)
    for d, vs in sorted(by.items()):
        gs = {v["guid"] for v in vs}
        r = day(B, iso(d), vs, [l for l in COLL["lines"] if l[0] in gs]); ok(r.get("ok") is True, "the day %s stored (%d entries) %s" % (d, len(vs), "" if r.get("ok") else r))
    for i in IDS:
        ok(gst(GID[i]) == WANT[i], "2. %s: %s" % (i, gst(GID[i])))
    ok(gst(s01[0]["guid"]) == ("Regular", "India", "false", "Sales Taxable", "Taxable", "Goods", "false"), "2. S01 (stored before 72) has its type once read again: %s" % (gst(s01[0]["guid"]),))

    print("== 3. the recorder path: the bridge's bodies")
    db.sql("update tally_vouchers set gst_reg_type = null, gst_country = null, gst_rcm = null, gst_nature = null, gst_taxability = null, gst_supply = null, gst_ineligible = null where book_id = %s" % q(B))
    for i in IDS:
        r = entries(BODY[i]["vouchers"], BODY[i]["lines"]); ok(r.get("ok") is True and gst(GID[i]) == WANT[i], "3. %s from bridge 2.4.2's body: %s %s" % (i, gst(GID[i]), "" if r.get("ok") else r))
    # a body from a bridge before 2.4.2: no gst key: the stored type kept
    oldv = [{k: v for k, v in BODY["S03"]["vouchers"][0].items() if k != "gst"}]
    r = entries(oldv, BODY["S03"]["lines"]); ok(r.get("ok") is True and gst(GID["S03"]) == WANT["S03"], "3. S03 again from a bridge before 2.4.2 (no gst): the stored type kept %s" % (gst(GID["S03"]),))
    # an older body (lower AlterID) never overwrites a newer entry's type
    db.sql("update tally_vouchers set alter_id = alter_id + 100 where book_id = %s and guid = %s" % (q(B), q(GID["P04L"])))
    stale = [dict(BODY["P04"]["vouchers"][0], guid=GID["P04L"])]
    db.one("select tally_ingest_gsttype(%s, %s)::text" % (q(B), js(stale)))
    ok(gst(GID["P04L"]) == WANT["P04L"], "3. an older body of P04L (lower AlterID, not blocked) does not overwrite its type %s" % (gst(GID["P04L"]),))
    # bad values are not written
    db.one("select tally_ingest_gsttype(%s, %s)::text" % (q(B), js([{"guid": GID["S05"], "alter": 10 ** 9, "gst": {"rcm": "maybe", "ineligible": False}}])))
    ok(gst(GID["S05"]) == WANT["S05"], "3. a gst object with a value not true/false is not written %s" % (gst(GID["S05"]),))
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL OK", len(fails)))
if fails: raise SystemExit(1)
