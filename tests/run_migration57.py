"""python3 run_migration57.py - migration-57-entry-details (06-Oct-2026, FinCom Bridge 2.3.1 part A: "item invoices enter
complete"). On throwaway PostgreSQL (pg_stand, port 30570; never a real database), built 32 -> ... -> 55 -> 56 in staging's
order, then 57 (twice). The entries are the part A fixtures (bridge-go/testdata/typed-like-7.1/partA-*.xml) read by the
cloud's own reader (server/tally-cloud/parse.js) into the shape tally-ingest sends (index.ts dayVouchers / dayLines).
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from' anywhere, add-only (no
     drop, no truncate, no rename), no real database named; every function security definer, search_path public, pg_temp;
     the carried texts are 56's tally_ingest_entries (5 arguments), 44's tally_ingest_day and 50's tally_ingest_delete with
     only the changes said; the grants; RLS on the four new tables; it runs twice; running it changes no row.
  1. the days path (a Day Book of the seven scenarios): every detail stored (items with HSN, quantity, unit, rate, taxable,
     GST rate and CGST / SGST / IGST per line; cost centres; bank details; TDS; IRN, acknowledgement, e-way bill; a due date
     given as a date on the bill); lines, bills and the day cache exactly as under 56 (a second book loaded before 57).
  2. the recorder path never blanks: a body before part A (no details) leaves them; blanks and empty lists keep the stored
     ones; a new value or new rows replace them (the old rows marked gone, kept).
  3. the Day Book is authoritative: an empty list there marks the rows gone; a Day Book entry failing the accuracy checks is
     stored (never refused) with the plain words in check_notes.
  4. a delete or cancel of an entry never in the copy settles by itself ("nothing to remove: ..."), kept; a later Day Book
     bringing the entry cannot undo the delete; a cancelled one comes in cancelled.
  5. RLS: the firm's member reads the details; another firm's member reads none.
Prints md5(pg_get_functiondef) and md5(prosrc) of every function of the file, the file's md5 and its 'delete from' count.
RED: before the file exists it stops at the first check."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
                                           "migration-56-keep-fields.sql")]
M57 = os.environ.get("M57_FILE") or os.path.join(SQLDIR, "migration-57-entry-details.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2, OWNER, OTHER = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888", "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444"
B, B0, D1 = "f79e4bc3-871d-4482-874d-000000000057", "f79e4bc3-871d-4482-874d-000000000056", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"
CG = "226fb516-9d2d-45ad-ad78-304d86b64500"
G = lambda mid: CG + "-%08x" % mid
D2 = "2026-10-02"

# ---- the entries as tally-ingest sends them: parse.js over the fixtures, mapped as index.ts dayVouchers / dayLines do
NODE = r"""
import fs from "fs";
const { parseDay, cleanName } = await import(process.argv[1]);
const out = {};
for (const f of process.argv.slice(2)) {
  const r = parseDay(fs.readFileSync(f, "utf8"));
  const nm = (x) => ({ ...x, ledger: cleanName(String(x.ledger || "")) });
  out[f.split("/").pop()] = { vouchers: r.vouchers.map((v) => ({ guid: v.guid, alter: v.alter, type: v.type, no: v.no, party: cleanName(v.party), narr: v.narr, cancel: v.cancel, opt: v.opt,
    gstin: v.gstin, pos: v.pos, ref: v.ref, refDate: v.refDate, cmp: v.cmp, fid: v.fid ?? null, irn: v.irn, ackNo: v.ackNo, ackDate: v.ackDate, eway: v.eway,
    items: v.items.map((x) => ({ ...x, item: cleanName(x.item) })), costs: v.costs.map(nm), banks: v.banks.map(nm), tds: v.tds.map((x) => ({ ...nm(x), party: cleanName(x.party) })), dues: v.dues.map(nm), checks: v.checks })),
    lines: r.lines.map((l) => [l[0], cleanName(l[1]), ...l.slice(2)]) };
}
console.log(JSON.stringify(out));
"""
FIXDIR = os.path.join(HERE, "..", "bridge-go", "testdata", "typed-like-7.1")
FIXN = ["partA-sales-two-rates.xml", "partA-purchase-igst.xml", "partA-credit-note-items.xml", "partA-receipt-against-bill.xml", "partA-payment-tds.xml", "partA-journal-cost-centres.xml", "partA-bank-payment-utr.xml"]
pr = subprocess.run(["node", "--input-type=module", "-e", NODE, os.path.join(HERE, "..", "server", "tally-cloud", "parse.js")] + [os.path.join(FIXDIR, f) for f in FIXN], capture_output=True, text=True)
if pr.returncode: print(pr.stderr); raise SystemExit("parse.js could not read the fixtures")
FX = json.loads(pr.stdout)
ALLV = [v for f in FIXN for v in FX[f]["vouchers"]]
ALLL = [l for f in FIXN for l in FX[f]["lines"]]

text = open(M57).read() if os.path.exists(M57) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M57))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included): %d" % low.count("delete from"))
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\balter\s+table\s+\S+\s+(drop|rename)", low), "0. add-only (no drop, no truncate, no rename)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == sorted(["tally_ingest_details", "tally_ingest_entries", "tally_ingest_day", "tally_ingest_delete"]), "0. the functions of the file (%s)" % FNS)
def block(t, start, end):
    i = t.index(start); j = t.index("\n", t.index(end, i)) + 1; return t[i:j]
m44, m50, m56 = (open(os.path.join(SQLDIR, f)).read() for f in ("migration-44-recorder.sql", "migration-50-recorder-held.sql", "migration-56-keep-fields.sql"))
S_DAY = "create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer, p_empty boolean)"
E_DAY = "grant execute on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean) to service_role;"
d44, d57 = block(m44, S_DAY, E_DAY), block(text, S_DAY, E_DAY)
ok(d57 == d44.replace("from jsonb_array_elements(p_vouchers) with ordinality as t(x, o)), p_lines);", "from jsonb_array_elements(p_vouchers) with ordinality as t(x, o)), p_lines, true, false);     -- 57: the entry path with the entry's details (the Day Book: authoritative, p_keep false)") and d57 != d44,
   "0. tally_ingest_day is 44's text but its one call (the 5-argument form, p_keep false)")
S_DEL = "create or replace function public.tally_ingest_delete(p_book uuid, p_guid text, p_alter bigint, p_cancel boolean, p_source text)"
E_DEL = "grant execute on function public.tally_ingest_delete(uuid, text, bigint, boolean, text) to service_role;"
x50, x57 = block(m50, S_DEL, E_DEL), block(text, S_DEL, E_DEL)
cut = lambda t: re.sub(r"  if not found then\n[\s\S]*?\n  end if;\n  lk :=", "", t, count=1)
ok(x57.count("nothing to remove: the entry is not in FinCom''s copy and no longer counts in Tally") == 1 and cut(x57) == cut(x50) and x57 != x50,
   "0. tally_ingest_delete is 50's text but the branch for an entry not in the copy")
S_ENT = "create or replace function public.tally_ingest_entries(p_book uuid, p_vouchers jsonb, p_lines jsonb, p_rebuild boolean, p_keep boolean)"
E_ENT = "revoke all on function public.tally_ingest_entries(uuid, jsonb, jsonb, boolean, boolean) from public, anon, authenticated, service_role;"
e56, e57 = block(m56, S_ENT, E_ENT), block(text, S_ENT, E_ENT)
keep56 = e56.split("declare vs jsonb := p_vouchers; ls jsonb := p_lines;")[1].split("  return tally_ingest_entries(p_book, vs, ls, p_rebuild);")[0]
ok(keep56 in e57 and e57.count("res := tally_ingest_entries(p_book, vs, ls, p_rebuild);") == 1 and "perform tally_ingest_details(p_book, vs, coalesce(p_keep, false));" in e57,
   "0. tally_ingest_entries (5 arguments) is 56's text, its keep unchanged, with the details after 48's 4-argument form")

db = pg_stand.start(30570)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def apply(lines): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(lines)))
def states(r): return [x.get("state") for x in r.get("results", [])] if isinstance(r, dict) and "results" in r else r
def day(book, d, vouchers, lines): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(book), q(d), js(vouchers), js(lines), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
def rline(lid, v, lines, ev="altered", alter=None):
    return {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-2.3.1", "vch_no": v["no"], "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": v["alter"] if alter is None else alter,
            "saved_at": "2026-10-06T05:00:00.000Z", "vch_date": D2, "vch_type": v["type"], "master_id": str(int(v["guid"][-8:], 16)), "object_guid": v["guid"], "company_guid": CG,
            "company": "FinCom Spike Co", "vouchers": [dict(v, day=D2)], "lines": lines}
def gone_line(lid, guid, ev, alter):
    return {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-2.3.1", "vch_no": "", "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alter, "saved_at": "2026-10-06T05:00:00.000Z",
            "vch_date": D2, "vch_type": "Sales", "master_id": str(int(guid[-8:], 16)), "object_guid": guid, "company_guid": CG, "company": "FinCom Spike Co"}
def rows(sql, uid=None): return db.rows(sql, uid)
def items(guid, book=B): return [(r["line_no"], r["item"], r["qty"], r["unit"], r["rate"], r["taxable"], r["hsn"], r["gst_rate"], r["cgst"], r["sgst"], r["igst"], r["cess"]) for r in rows(
    "select line_no::text, item, qty::text, unit, rate::text, taxable::text, hsn, gst_rate::text, cgst::text, sgst::text, igst::text, cess::text from tally_item_lines where book_id = %s and guid = %s and gone_at is null order by line_no" % (q(book), q(guid)))]
def vx(guid, book=B): return (rows("select irn, irn_ack_no, coalesce(irn_ack_date::text, '') as ack_date, eway_no, check_notes::text as checks, coalesce(deleted_at::text, '') as del, cancelled::text as can from tally_vouchers where book_id = %s and guid = %s" % (q(book), q(guid))) or [{}])[0]
def snapcore(book):
    return {t: db.one("select md5(coalesce(string_agg(x, '|' order by x), '')) from (select concat_ws(',', %s) as x from %s where book_id = %s) y" % (cols, t, q(book)))
            for t, cols in (("tally_lines", "guid, day, ledger, amount, hsn, rate"), ("tally_bills", "guid, day, ledger, name, type, amount, bill_date, credit_days, due"),
                            ("tally_ledger_day", "ledger, day, amount, dr, cr, n"), ("tally_vouchers", "guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos, ref, ref_date, cmp_gstin, fincom_id, deleted_at is null"))}
def fdef(sig): return db.one("select pg_get_functiondef(%s::regprocedure)" % q("public." + sig)) or ""
def can(role, sig): return db.one("select has_function_privilege(%s, %s, 'execute')" % (q(role), q("public." + sig)))
ROLES = ("anon", "authenticated", "service_role")
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company'), (%(F2)s, 'Another Firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'FinCom Spike Co', '2025-04-01', '2025-03-31'), (%(B0)s, %(F)s, 'c0', 'FinCom Spike Co (56)', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.3.1');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'FinCom Spike Co', '{"choices": {}}');""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "X": q(OTHER), "B": q(B), "B0": q(B0), "D": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, 1, '2026-10-01 10:00+05:30', %s)" % (q(B), q(F), q(CG)))
    md5s = {}
    for fn in FNS:
        for oid in [r["o"] for r in rows("select oid::regprocedure::text as o from pg_proc where proname = %s and pronamespace = 'public'::regnamespace order by 1" % q(fn))]:
            md5s[oid.replace("public.", "")] = hashlib.md5(fdef(oid.replace("public.", "")).encode()).hexdigest()

    print("== under 56: the same Day Book on a second book (the reference for the days path)")
    ok(day(B0, D2, ALLV, ALLL).get("ok") is True, "56: the Day Book of 02-Oct-2026 (7 entries) stored on the reference book")
    ref56 = snapcore(B0)

    print("== migration 57")
    before = {t: db.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from %s x" % t) for t in ("tally_vouchers", "tally_lines", "tally_bills", "tally_ledger_day", "tally_days", "tally_voucher_versions", "tally_recorder_lines")}
    rr = psql_text(text); ok(rr.returncode == 0, "migration-57 runs (1) %s" % (rr.stderr.strip()[-600:] if rr.returncode else ""))
    if rr.returncode: raise SystemExit("cannot go on without the migration")
    rr = psql_text(text); ok(rr.returncode == 0, "migration-57 runs (2) %s" % (rr.stderr.strip()[-600:] if rr.returncode else ""))
    after = {t: db.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from %s x" % t) for t in before if t != "tally_vouchers"}
    ok(after == {t: before[t] for t in after} and db.one("select count(*) from tally_vouchers where irn <> '' or eway_no <> '' or check_notes <> '[]'::jsonb") == "0",
       "running it (twice) changes no row (the new columns at their defaults)")
    for fn in FNS:
        for r in rows("select prosecdef::text as d, coalesce(array_to_string(proconfig, ','), '') as c, oid::regprocedure::text as o from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn)):
            ok(r["d"] == "true" and r["c"].replace(" ", "") == "search_path=public,pg_temp", "%s: security definer, search_path public, pg_temp" % r["o"])
    for sig in ("tally_ingest_details(uuid, jsonb, boolean)", "tally_ingest_entries(uuid, jsonb, jsonb, boolean, boolean)"):
        ok(tuple(can(r, sig) for r in ROLES) == ("f", "f", "f"), "%s: granted to nobody" % sig)
    for sig in ("tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean)", "tally_ingest_delete(uuid, text, bigint, boolean, text)"):
        ok(tuple(can(r, sig) for r in ROLES) == ("f", "f", "t"), "%s: the service role's only" % sig)
    for t in ("tally_item_lines", "tally_cost_allocs", "tally_bank_allocs", "tally_tds_lines"):
        ok(db.one("select relrowsecurity::text from pg_class where relname = %s" % q(t)) == "true" and db.one("select count(*) from pg_policies where tablename = %s" % q(t)) == "1", "%s: row level security on, one read policy" % t)

    print("== 1. the days path: the Day Book of the seven scenarios")
    ok(day(B, D2, ALLV, ALLL).get("ok") is True, "the Day Book of 02-Oct-2026 stored")
    s57 = snapcore(B)
    ok({k: s57[k] for k in ("tally_lines", "tally_ledger_day", "tally_vouchers")} == {k: ref56[k] for k in ("tally_lines", "tally_ledger_day", "tally_vouchers")},
       "lines, the day cache and the entries' fields of before: exactly as under 56 (%s)" % ("same" if s57 == ref56 else "bills differ: see below"))
    bills_diff = rows("select a.guid, a.name, coalesce(a.due::text, '') as due57, coalesce(b.due::text, '') as due56 from tally_bills a join tally_bills b on b.book_id = %s and b.guid = a.guid and b.name = a.name and b.ledger = a.ledger and b.amount = a.amount where a.book_id = %s and a.due is distinct from b.due" % (q(B0), q(B)))
    ok([(r["name"], r["due57"], r["due56"]) for r in bills_diff] == [("INV-77", "2026-11-15", "")] and db.one("select count(*) from tally_bills where book_id = %s" % q(B)) == db.one("select count(*) from tally_bills where book_id = %s" % q(B0)),
       "the bills as under 56, but the supplier's due date Tally keeps as a date (15-Nov-2026) now on INV-77 (%s)" % bills_diff)
    S, P, C, R, T, JN, U = (G(m) for m in (0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b))
    ok(items(S) == [("0", "Widget A", "10", "Nos", "200", "2000", "8471", "18", "180", "180", "0", "0"), ("1", "Rice B", "20", "Kg", "50", "1000", "1006", "5", "25", "25", "0", "0")],
       "sales: two items, each its HSN, quantity, unit, rate, taxable value, GST rate (18 / 5) and CGST + SGST (%s)" % items(S))
    ok(items(P) == [("0", "Widget A", "5", "Nos", "1000", "-5000", "8471", "18", "0", "0", "-900", "0")], "purchase: the item with IGST (%s)" % items(P))
    ok(items(C) == [("0", "Widget A", "1", "Nos", "200", "-200", "8471", "18", "-18", "-18", "0", "0")], "credit note: the item returned (%s)" % items(C))
    ok(db.one("select string_agg(distinct tax_basis, '|') from tally_item_lines") == "worked out from the line's GST rate and taxable value, as Tally does (Tally 7.1 writes no tax amount per item line)", "each item line says how its tax was had")
    vs = vx(S)
    ok((vs["irn"], vs["irn_ack_no"], vs["ack_date"], vs["eway_no"], vs["checks"]) == ("a5c12dca80e743321740b001fd70953e8738d109865d28ba4013750f2046f229", "112610020345678", "2026-10-02", "381001234567", "[]"),
       "sales: the IRN, the acknowledgement number and date, the e-way bill number; no check failed (%s)" % vs)
    cc = rows("select guid, line_no::text as n, ledger, category, centre, amount::text as amount from tally_cost_allocs where book_id = %s and gone_at is null order by guid, line_no, centre" % q(B))
    ok([(r["guid"][-2:], r["n"], r["ledger"], r["centre"], r["amount"]) for r in cc] == [("15", "3", "Sales GST 18%", "Retail", "2000"), ("19", "0", "Contract Expenses", "Head Office", "-100000"), ("1a", "0", "Rent", "Branch", "-10000"), ("1a", "0", "Rent", "Head Office", "-20000")],
       "cost centres: on the ledger line under an item (sales), on the expense (payment), two on the journal's rent (%s)" % [(r["guid"][-2:], r["centre"]) for r in cc])
    bk = rows("select guid, ledger, txn_type, instrument_no, coalesce(instrument_date::text, '') as idate, coalesce(bank_date::text, '') as bdate from tally_bank_allocs where book_id = %s and gone_at is null order by guid" % q(B))
    ok([(r["guid"][-2:], r["txn_type"], r["instrument_no"], r["idate"], r["bdate"]) for r in bk] == [("18", "Cheque", "000451", "2026-10-02", "2026-10-03"), ("19", "e-Fund Transfer", "UTR26100200991", "2026-10-02", ""), ("1b", "e-Fund Transfer", "SBIN526275123456", "2026-10-02", "2026-10-02")],
       "bank details: the receipt's cheque with its bank date, the TDS payment's and the supplier payment's UTRs (%s)" % bk)
    td = rows("select ledger, nature, section, rate::text, assessable::text, amount::text, party, deductee_type from tally_tds_lines where book_id = %s and gone_at is null" % q(B))
    ok([tuple(r.values()) for r in td] == [("TDS on Contract", "Payment to Contractors", "", "2", "100000", "2000", "Spike Contractor", "")], "TDS: nature, rate, assessable value, amount, the deductee; section and deductee type blank (not in Tally's voucher) (%s)" % td)

    print("== 2. the recorder never blanks; new values replace")
    sv = [v for v in ALLV if v["guid"] == S][0]; sl = [l for l in ALLL if l[0] == S]
    old_body = {k: sv[k] for k in sv if k not in ("irn", "ackNo", "ackDate", "eway", "items", "costs", "banks", "tds", "dues", "checks")}
    got = states(apply([rline("r-1", dict(old_body, alter=sv["alter"] + 1), sl)]))
    ok(got == ["applied"] and items(S)[0][1] == "Widget A" and vx(S)["irn"].startswith("a5c1") and len(cc) == int(db.one("select count(*) from tally_cost_allocs where book_id = %s and gone_at is null" % q(B))),
       "a body read before part A (no details): applied, the stored details kept (%s)" % got)
    blank = dict(sv, alter=sv["alter"] + 2, irn="", ackNo="", ackDate="", eway="", items=[], costs=[])
    got = states(apply([rline("r-2", blank, sl)]))
    ok(got == ["applied"] and vx(S)["irn"].startswith("a5c1") and vx(S)["eway_no"] == "381001234567" and len(items(S)) == 2 and db.one("select count(*) from tally_cost_allocs where guid = %s and gone_at is null" % q(S)) == "1",
       "blanks and empty lists from the recorder: the IRN, e-way bill, items and cost centres kept (%s)" % got)
    new = dict(sv, alter=sv["alter"] + 3, irn="b" * 64, items=[dict(sv["items"][0], qty=12, taxable=2400, alloc=2400, cgst=216, sgst=216)])
    got = states(apply([rline("r-3", new, [[S, "Spike Customer", -3882, "", None, [["201", "New Ref", -3882, 30]]], [S, "CGST Output", 241, "", None, []], [S, "SGST Output", 241, "", None, []], [S, "Sales GST 18%", 2400, "8471", 18, []], [S, "Sales GST 5%", 1000, "1006", 5, []]])]))
    ok(got == ["applied"] and vx(S)["irn"] == "b" * 64 and items(S) == [("0", "Widget A", "12", "Nos", "200", "2400", "8471", "18", "216", "216", "0", "0")],
       "a new IRN and new item rows from the recorder replace the stored ones (%s)" % items(S))
    ok(db.one("select count(*) from tally_item_lines where guid = %s and gone_at is not null" % q(S)) == "2" and db.one("select count(*) from tally_item_lines where guid = %s" % q(S)) == "3",
       "the earlier item rows kept, marked gone (none removed)")

    print("== 3. the Day Book is authoritative; checks flagged, never refused")
    bad = dict(sv, alter=sv["alter"] + 4, items=[], irn="", checks=["the bill-wise details of Spike Customer come to Rs 3400.00, not the line's Rs 3410.00"])
    ok(day(B, D2, [v for v in ALLV if v["guid"] != S] + [bad], ALLL).get("ok") is True, "a Day Book whose sales entry fails a check: stored (never refused)")
    ok(items(S) == [] and vx(S)["irn"] == "" and json.loads(vx(S)["checks"]) == bad["checks"], "the Day Book's empty items and blank IRN replace the stored ones; the plain words in check_notes (%s)" % vx(S))

    print("== 4. a delete or cancel of an entry never in the copy")
    NG, NC = G(0x2001), G(0x2002)
    got = states(apply([gone_line("x-del", NG, "deleted", 900), gone_line("x-can", NC, "cancelled", 901)]))
    w = {r["line_id"]: (r["state"], r["held_why"]) for r in rows("select line_id, state, coalesce(held_why, '') as held_why from tally_recorder_lines where line_id in ('x-del', 'x-can')")}
    ok(got == ["applied", "applied"] and w == {"x-del": ("applied", "nothing to remove: the entry is not in FinCom's copy and no longer counts in Tally"), "x-can": ("applied", "nothing to remove: the entry is not in FinCom's copy and no longer counts in Tally")},
       "both settle by themselves with the words, the lines kept (%s)" % w)
    nv = dict(sv, guid=NG, no="301", alter=800, items=[], costs=[], checks=[]); ncv = dict(sv, guid=NC, no="302", alter=801, items=[], costs=[], checks=[])
    nl = [[g, a, b, c, d, []] for g in (NG,) for (a, b, c, d) in (("Spike Customer", -100, "", None), ("Sales GST 18%", 100, "", None))] + [[NC, "Spike Customer", -100, "", None, []], [NC, "Sales GST 18%", 100, "", None, []]]
    ok(day(B, D2, ALLV + [nv, ncv], ALLL + nl).get("ok") is True, "a later Day Book (an older read) brings both entries, not deleted, not cancelled")
    ok(vx(NG)["del"] != "" and vx(NC)["can"] == "true" and vx(NC)["del"] == "", "the delete is not undone (deleted again); the cancelled one comes in cancelled (%s %s)" % (vx(NG), vx(NC)))
    got = states(apply([rline("x-cr", dict(nv, alter=850), nl[:2], ev="created")]))
    ok(vx(NG)["del"] != "", "another computer's line bringing the deleted entry (AlterID 850 < 900): still deleted (%s)" % got)

    print("== 5. RLS: the firm's member reads its details, another firm's none")
    ok(int(db.one("set role authenticated; select count(*) from tally_item_lines", OWNER)) > 0 and int(db.one("set role authenticated; select count(*) from tally_bank_allocs where gone_at is null", OWNER)) == 3,
       "the firm's owner reads the item lines and bank details")
    ok(all(db.one("set role authenticated; select count(*) from %s" % t, OTHER) == "0" for t in ("tally_item_lines", "tally_cost_allocs", "tally_bank_allocs", "tally_tds_lines")), "another firm's member reads none")
    good = True
    try: db.one("set role authenticated; insert into tally_item_lines (book_id, firm_id, guid, day, line_no) values (%s, %s, 'x', '2026-10-02', 0) returning 1" % (q(B), q(F)), OWNER)
    except RuntimeError: good = False
    ok(not good, "an authenticated member cannot write the details")

    print("== md5(pg_get_functiondef) after 32 .. 56, 57 (pg_stand)")
    for fn in FNS:
        for oid in [r["o"] for r in rows("select oid::regprocedure::text as o from pg_proc where proname = %s and pronamespace = 'public'::regnamespace order by 1" % q(fn))]:
            s = oid.replace("public.", "")
            src = db.one("select md5(prosrc) from pg_proc where oid = %s::regprocedure" % q("public." + s))
            print("  %-80s 56: %s  57: %s  prosrc md5: %s" % (s, md5s.get(s, "-" * 32), hashlib.md5(fdef(s).encode()).hexdigest(), src))
    print("  file md5: %s; 'delete from': %d" % (hashlib.md5(open(M57, "rb").read()).hexdigest(), low.count("delete from")))
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL OK", len(fails)))
if fails: raise SystemExit(1)
