"""python3 run_migration73.py - migration-73-tds-fields (11-Oct-2026, bridge 2.4.3; the owner's approval of 11-Oct-2026: TDS
challan details and TDS master settings from Tally). On throwaway PostgreSQL (pg_stand, port 30730 unless PG73_PORT; never a
real database), built with staging's migrations in staging's order (32 .. 60, 68, 70, 61, 62 .. 67, 72), then 73 (twice).
  0. the file: one transaction, no 'delete from', add-only (no drop, no truncate, no rename; two columns added to
     tally_vouchers, three to tally_ledgers, one table tally_tds_natures with row level security read by a member of the
     firm); three functions: tally_ingest_tdstally (new, granted to nobody), tally_ingest_natures (new, service_role only),
     tally_ingest_details (72's text with ONE line added, marked "73"); all security definer, search_path public, pg_temp.
  1. running it (twice) changes no row; the new columns are null on every row there was.
  2. the Day Book path: Tally's own full export of TallyPrime 7.1 (bridge-go/testdata/tdsfields243/7.1/full-*.xml.gz) read
     by parse.js: the payment's challan, its tax / interest / late fee, the references, stored with the entry's AlterID.
  3. the recorder path: the bridge 2.4.3 body of the same entries stores the same; a later body without "tdsx" (a bridge
     before 2.4.3) leaves the values, tds_tally_alter_id below the entry's AlterID; written only onto the version just stored.
  4. the natures: tally_ingest_natures stores and brings up to date by GUID, none removed; bad rows skipped.
  5. a member reads tally_tds_natures of the firm only; anon nothing.
RED: before the file exists it stops at the first check.
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from', add-only (no drop, no
     truncate, no rename, no new table; seven columns added to tally_vouchers), names no real database; two functions:
     tally_ingest_gsttype (new) and tally_ingest_details (62's text with ONE line added, marked "72"); both security
     definer, search_path public, pg_temp, granted to nobody.
  1. running it (twice) changes no row; the new columns are null on every row there was.
  2. the Day Book path (tally_ingest_day): Tally's own stored entries of TallyPrime 7.1 (bridge-go/testdata/gsttype242/7.1/
     coll-all.xml.gz, the Day Book's form) read by parse.js: each entry's GST type stored (SEZ, export, nil-rated, exempt,
     reverse charge, the blocked credit).
  3. the recorder path (tally_ingest_entries, keep): the bridge 2.4.2 body of the same entry (obj-<id>-stripped.xml) stores
     the same, with gst_alter_id the entry's AlterID; a later body from a bridge before 2.4.2 (no "gst": also 2.4.2's
     FinComVoucherByNumber answer, whose FETCH has none of the fields) leaves the values as they are but gst_alter_id below
     the entry's AlterID (review H1: the app then knows they belong to an older version); an older body (lower AlterID)
     never writes; the type is written only onto the version just stored (review L1: AlterID equal); gst_mixed when the
     entry's GST lines disagree (review M2).
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
M73 = os.environ.get("M73_FILE") or os.path.join(SQLDIR, "migration-73-tds-fields.sql")
TD = os.path.join(HERE, "..", "bridge-go", "testdata", "tdsfields243", "7.1")
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
B, D1 = "f79e4bc3-871d-4482-874d-000000000073", "58d73e82-57f3-4f72-9f3d-14cc93a5b273"

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
    ...(v.gst ? { gst: v.gst } : {}), ...(v.tdsx ? { tdsx: v.tdsx } : {}), date: v.date })),
    lines: r.lines.map((l) => [l[0], cleanName(l[1]), ...l.slice(2)]) };
}
console.log(JSON.stringify(out));
"""

IDS = ["PX1", "SP1", "K1"]
srcs = [os.path.join(TD, "full-%s.xml.gz" % i) for i in IDS] + [os.path.join(TD, "obj-%s-stripped.xml" % i) for i in IDS]
pr = subprocess.run(["node", "--input-type=module", "-e", NODE, os.path.join(SQLDIR, "parse.js")] + srcs, capture_output=True, text=True)
if pr.returncode: print(pr.stderr); raise SystemExit("parse.js could not read the fixtures")
FX = json.loads(pr.stdout)
FULL = {i: FX["full-%s.xml.gz" % i] for i in IDS}
BODY = {i: FX["obj-%s-stripped.xml" % i] for i in IDS}
GID = {i: BODY[i]["vouchers"][0]["guid"] for i in IDS}
for i in IDS: assert FULL[i]["vouchers"][0]["guid"] == GID[i], i
def tt(guid): return j("select coalesce(tds_tally, 'null'::jsonb)::text from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(guid)))
def ta(guid): return db.one("select coalesce((tds_tally_alter_id = alter_id)::text, 'null') from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(guid)))

text = open(M73).read() if os.path.exists(M73) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M73))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\balter\s+table\s+\S+\s+(drop|rename)", low) and not re.search(r"alter\s+column", low),
   "0. add-only (no drop, no truncate, no rename, no column changed)")
cols = re.findall(r"alter table public\.(tally_vouchers|tally_ledgers) add column if not exists (\w+) (text|jsonb|bigint);", low)
ok([(t, c) for t, c, _ in cols] == [("tally_vouchers", "tds_tally"), ("tally_vouchers", "tds_tally_alter_id"), ("tally_ledgers", "tds_nature"), ("tally_ledgers", "tds_special_rate"), ("tally_ledgers", "tds_ldc")]
   and len(re.findall(r"alter table public\.\w+ add column", low)) == 5, "0. five columns added (%s)" % cols)
ok(re.findall(r"create table if not exists public\.(\w+)", low) == ["tally_tds_natures"], "0. one table added: tally_tds_natures")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_ingest_details", "tally_ingest_natures", "tally_ingest_tdstally"], "0. three functions (%s)" % FNS)
def block(t, start, end):
    i = t.index(start); j2 = t.index("\n", t.index(end, i)) + 1; return t[i:j2]
m72 = open(os.path.join(SQLDIR, "migration-72-gst-type.sql")).read()
S_D = "create or replace function public.tally_ingest_details(p_book uuid, p_vouchers jsonb, p_keep boolean)"
E_D = "revoke all on function public.tally_ingest_details(uuid, jsonb, boolean) from public, anon, authenticated, service_role;"
D72, D73 = block(m72, S_D, E_D), block(text, S_D, E_D)
diff = [d for d in difflib.unified_diff(D72.split("\n"), D73.split("\n"), lineterm="", n=0) if d[:1] in "+-" and not d.startswith(("+++", "---"))]
ok(len(diff) == 1 and diff[0].startswith("+") and "perform tally_ingest_tdstally(p_book, p_vouchers);" in diff[0] and re.search(r"--.*\b73\b", diff[0]),
   "0. tally_ingest_details is 72's text with ONE line added, marked '73' (%s)" % diff)

db = pg_stand.start(int(os.environ.get("PG73_PORT") or 30730))
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
    F2 = "88888888-8888-8888-8888-888888888888"; B2 = "f79e4bc3-871d-4482-874d-000000000273"; OTHER = "44444444-4444-4444-4444-444444444444"
    db.sql("""insert into firms values (%(F)s, 'Test firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into firms values (%(F2)s, 'Other firm') on conflict do nothing; insert into members values (%(OT)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'FinCom Spike Co', '2026-04-01', '2026-03-31');
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B2)s, %(F2)s, 'c2', 'Other Co', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'RUNNER', 'h', '2.4.3');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'FinCom Spike Co', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1), "F2": q(F2), "B2": q(B2), "OT": q(OTHER)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    ok(True, "the database built with staging's %d migrations in staging's order (72 last)" % len(FILES))
    k1 = FULL["K1"]["vouchers"]
    ok(day(B, iso(k1[0]["date"]), [{kk: vv for kk, vv in k1[0].items() if kk != "tdsx"}], [l for l in FULL["K1"]["lines"] if l[0] == GID["K1"]]).get("ok") is True, "before 73: K1 stored through the Day Book path")
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent) values (%s, %s, 'FC LDC Party', 'Sundry Creditors')" % (q(B), q(F)))
    before = db.one("select md5(coalesce(string_agg(row(book_id, guid, day, alter_id, vtype, vno, party, gstin, pos)::text, '|' order by guid), '')) from tally_vouchers")
    lbefore = db.one("select md5(coalesce(string_agg(row(book_id, name, parent)::text, '|' order by name), '')) from tally_ledgers")
    print("== migration 73")
    for n in (1, 2):
        rr = psql_text(text); ok(rr.returncode == 0, "migration-73 runs (%d) %s" % (n, rr.stderr.strip()[-600:] if rr.returncode else ""))
        if rr.returncode: raise SystemExit("cannot go on without the migration")
    after = db.one("select md5(coalesce(string_agg(row(book_id, guid, day, alter_id, vtype, vno, party, gstin, pos)::text, '|' order by guid), '')) from tally_vouchers")
    lafter = db.one("select md5(coalesce(string_agg(row(book_id, name, parent)::text, '|' order by name), '')) from tally_ledgers")
    ok(after == before and lafter == lbefore and db.one("select count(*) from tally_vouchers where tds_tally is not null or tds_tally_alter_id is not null") == "0"
       and db.one("select count(*) from tally_ledgers where tds_nature is not null or tds_ldc is not null or tds_special_rate is not null") == "0",
       "1. running it (twice) changes no row; the new columns null on the rows there were")
    for fn, sig, want in (("tally_ingest_details", "tally_ingest_details(uuid, jsonb, boolean)", ("f", "f", "f")), ("tally_ingest_tdstally", "tally_ingest_tdstally(uuid, jsonb)", ("f", "f", "f")),
                          ("tally_ingest_natures", "tally_ingest_natures(uuid, jsonb)", ("f", "f", "t"))):
        r = db.rows("select prosecdef::text as d, coalesce(array_to_string(proconfig, ','), '') as c from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn))
        ok(len(r) == 1 and r[0]["d"] == "true" and r[0]["c"].replace(" ", "") == "search_path=public,pg_temp", "0. %s: security definer, search_path public, pg_temp" % fn)
        ok(tuple(can(x, sig) for x in ("anon", "authenticated", "service_role")) == want, "0. %s: anon / authenticated / service_role execute %s" % (fn, want))

    print("== 2. the Day Book path: Tally's full export (TallyPrime 7.1)")
    for i in IDS:
        vs = FULL[i]["vouchers"]
        r = day(B, iso(vs[0]["date"]), vs, [l for l in FULL[i]["lines"] if l[0] == GID[i]]); ok(r.get("ok") is True, "%s's day stored %s" % (i, "" if r.get("ok") else r))
    px = tt(GID["PX1"])
    ok(isinstance(px, dict) and px.get("challan", {}).get("bsr") == "0510308" and px["challan"]["no"] == "54321" and px["challan"]["date"] == "20261231"
       and [k["kind"] for k in px.get("kinds", [])] == ["Tax", "Interest", "Late Fee"] and ta(GID["PX1"]) == "true", "2. PX1: the challan and the tax / interest / late fee, at its AlterID (%s)" % ta(GID["PX1"]))
    sp, kk = tt(GID["SP1"]), tt(GID["K1"])
    ok(sp.get("refs", [{}])[0].get("type") == "Agst Ref" and kk.get("refs", [{}])[0].get("type") == "New Ref" and sp["refs"][0]["ref"] == kk["refs"][0]["ref"],
       "2. SP1 pays K1: the same TDS reference, Agst Ref and New Ref")
    ok(sp.get("periods", [{}])[0].get("section") == "194C" and sp["periods"][0]["form"] == "26Q", "2. SP1's nature detail stored")

    print("== 3. the recorder path: the bridge's bodies")
    db.sql("update tally_vouchers set tds_tally = null, tds_tally_alter_id = null where book_id = %s" % q(B))
    for i in IDS:
        r = entries(BODY[i]["vouchers"], BODY[i]["lines"]); ok(r.get("ok") is True and tt(GID[i]) == FULL[i]["vouchers"][0]["tdsx"] and ta(GID[i]) == "true",
            "3. %s from bridge 2.4.3's body: the same as the full export's, at its AlterID %s" % (i, "" if r.get("ok") else r))
    pv = BODY["PX1"]["vouchers"][0]
    oldv = [dict({k: v for k, v in pv.items() if k != "tdsx"}, alter=pv["alter"] + 5)]
    r = entries(oldv, BODY["PX1"]["lines"]); ok(r.get("ok") is True and tt(GID["PX1"]).get("challan", {}).get("bsr") == "0510308" and ta(GID["PX1"]) == "false",
       "3. PX1 altered, sent by a bridge before 2.4.3 (no tdsx): the challan kept, marked an older version's (%s)" % ta(GID["PX1"]))
    r = entries([dict(pv, alter=pv["alter"] + 6)], BODY["PX1"]["lines"]); ok(r.get("ok") is True and ta(GID["PX1"]) == "true", "3. the next version from 2.4.3: at its AlterID")
    db.one("select tally_ingest_tdstally(%s, %s)::text" % (q(B), js([dict(pv, alter=pv["alter"] + 99, tdsx=dict(pv["tdsx"], stat="XX"))])))
    ok(tt(GID["PX1"]).get("stat") == "TDS", "3. a tdsx for another AlterID than the row's is not written")
    db.one("select tally_ingest_tdstally(%s, %s)::text" % (q(B), js([{"guid": GID["PX1"], "alter": "x1", "tdsx": {"stat": "XX"}}, {"guid": GID["PX1"], "alter": pv["alter"] + 6, "tdsx": "text"}])))
    ok(tt(GID["PX1"]).get("stat") == "TDS", "3. a bad AlterID or a tdsx that is not an object is not written")
    db.one("select tally_ingest_tdstally(%s, %s)::text" % (q(B2), js([dict(pv, alter=pv["alter"] + 6, tdsx=dict(pv["tdsx"], stat="XX"))])))
    ok(tt(GID["PX1"]).get("stat") == "TDS", "3. another book's call never writes this book's entry")

    print("== 4. the natures")
    NAT = [["g-194c", 270, 275, "FC Contract 194C", [["20260401", "194C", "1", "2", "20", "20", "30000.00", ""]]],
           ["g-194j", 271, 276, "FC Prof Fees 194J", [["20260401", "194J", "10", "10", "20", "20", "30000.00", ""]]],
           ["", 1, 1, "no guid", []], ["g-x", 1, 1, "", []], "not a row", ["g-bad", "x", "y", "Bad ids", "not a list"]]
    ok(db.one("select tally_ingest_natures(%s, %s)" % (q(B), js(NAT))) == "3", "4. three natures stored, the rows without a GUID or a name skipped")
    rows = db.rows("select guid, name, master_id::text as m, alter_id::text as a, categories::text as c from tally_tds_natures where book_id = %s order by guid" % q(B))
    ok([r["guid"] for r in rows] == ["g-194c", "g-194j", "g-bad"] and rows[0]["c"] == '[["20260401", "194C", "1", "2", "20", "20", "30000.00", ""]]' and rows[2]["m"] in (None, "") and rows[2]["c"] == "[]",
       "4. stored as sent; ids not numbers left empty, categories not a list empty (%s)" % rows)
    NAT2 = [["g-194c", 270, 280, "FC Contract 194C", [["20260401", "194C", "1", "2", "20", "20", "100000.00", "30000.00"]]]]
    ok(db.one("select tally_ingest_natures(%s, %s)" % (q(B), js(NAT2))) == "1" and db.one("select count(*) from tally_tds_natures where book_id = %s" % q(B)) == "3"
       and db.one("select categories->0->>6 from tally_tds_natures where book_id = %s and guid = 'g-194c'" % q(B)) == "100000.00", "4. brought up to date by GUID, none removed")
    ok(db.one("select tally_ingest_natures(%s, %s)" % (q("00000000-0000-0000-0000-000000000000"), js(NAT))) == "0", "4. a book that is not there: nothing")

    print("== 5. who reads the natures")
    db.sql("select tally_ingest_natures(%s, %s)" % (q(B2), js([["g-other", 1, 1, "Other nature", []]])))
    mine = db.rows("set role authenticated; select guid from tally_tds_natures order by guid;", OWNER)
    ok(sorted(r["guid"] for r in mine) == ["g-194c", "g-194j", "g-bad"], "5. a member reads the firm's natures only (%s)" % mine)
    ok(db.one("select has_table_privilege('anon', 'public.tally_tds_natures', 'select')") == "f" and db.one("select has_table_privilege('authenticated', 'public.tally_tds_natures', 'insert')") == "f",
       "5. anon reads nothing; a member writes nothing")
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL OK", len(fails)))
if fails: raise SystemExit(1)
