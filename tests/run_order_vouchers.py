"""python3 run_order_vouchers.py - round 64 (the owner's GB TEXCOAT, 16-Oct-2026: two "Job Work In Order" entries, 15-Oct-2025
no. 2 Rs 1,78,230 on 3 lines and 09-Sep-2025 no. 1 Rs 45,000 on 1 line, stored with ledger lines that do not balance:
sum -2,23,230 in the trial balance). An entry of a voucher type with no accounting effect in Tally (an order, a delivery or
receipt note, a rejection, material in/out, a memorandum, a reversing journal) is kept marked not in the books (opt, with
nonAcc saying why), by the cloud's reader (server/tally-cloud/parse.js) and the browser's (src/js/04, Books.takeVoucher /
Books.nonAccounting) alike; every figure leaves it out (the ledger-day cache, so the trial balance, ledgers, MIS; the GST
and TDS summaries already leave out an entry marked opt).
  A. parse.js: the two Job Work In Order entries, a balanced Purchase Order, a Delivery Note as TallyPrime 7.1 gives it
     (bridge-go/testdata/fast234kinds/7.1), a type of the firm's own name with order details whose lines do not total zero:
     opt, nonAcc; a Sales invoice against an order (balanced), a Journal, a Payment whose lines do not total zero without
     order details: in the books (no opt), the last with its "lines do not add up" note as before.
  B. the browser's rule (Books.nonAccounting, run under Deno with the shared names rule) decides each the same; the two
     lists of Tally's non-accounting types are the same.
  C. on a throwaway PostgreSQL (pg_stand, staging's order to 90): tally_ingest_day with the reader's answer: the order and
     note entries are stored (marked optional), the ledger-day cache and tally_balances hold none of their lines, and the
     books' lines total zero.
Needs Deno (DENO) and PostgreSQL 16 (pg_stand)."""
import os, sys, json, re, subprocess, shutil, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
ROOT = os.path.join(HERE, "..")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def led(name, amt, tag="ALLLEDGERENTRIES.LIST"):
    return "<%s><LEDGERNAME>%s</LEDGERNAME><AMOUNT>%.2f</AMOUNT></%s>" % (tag, name, amt, tag)
def vch(guid, typ, date, no, lines, extra="", orig=None):
    return ('<TALLYMESSAGE><VOUCHER VCHTYPE="%s" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME>%s<VOUCHERNUMBER>%s</VOUCHERNUMBER>'
            '<PARTYLEDGERNAME>Party</PARTYLEDGERNAME><ISOPTIONAL>No</ISOPTIONAL><ISCANCELLED>No</ISCANCELLED><ALTERID>%d</ALTERID>%s%s</VOUCHER></TALLYMESSAGE>'
            % (typ, date, guid, typ, "<VOUCHERTYPEORIGNAME>%s</VOUCHERTYPEORIGNAME>" % orig if orig else "", no, abs(hash(guid)) % 1000 + 1, extra, "".join(lines)))
ITEM_ORDER = ("<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Cloth</STOCKITEMNAME><AMOUNT>-45000.00</AMOUNT><BATCHALLOCATIONS.LIST><ORDERNO>1</ORDERNO>"
              "<ORDERDUEDATE P=\"9-Sep-2025\">20250909</ORDERDUEDATE></BATCHALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>")
DN = open(os.path.join(ROOT, "bridge-go", "testdata", "fast234kinds", "7.1", "delivery-note-object-stripped.xml")).read()
DN = DN[DN.index("<VOUCHER "):DN.index("</VOUCHER>") + 10].replace("<DATE>20270131</DATE>", "<DATE>20251015</DATE>")
D1 = "20250909"; D2 = "20251015"
DAY = {
  D1: [vch("jw-1", "Job Work In Order", D1, "1", [led("GB Party", -45000)], ITEM_ORDER),
       vch("pay-1", "Payment", D1, "7", [led("Cash", 1000), led("Rent", -900)])],
  D2: [vch("jw-2", "Job Work In Order", D2, "2", [led("GB Party", -178230), led("Job Work Charges", -10000), led("Freight", 10000)]),
       vch("po-1", "Purchase Order", D2, "3", [led("Supplier", 5000), led("Purchase", -5000)], ITEM_ORDER),
       vch("own-1", "GB PO", D2, "4", [led("Supplier", 7000)], ITEM_ORDER),
       vch("sal-1", "Sales", D2, "9", [led("Buyer", -1180), led("Sales", 1000), led("Output IGST", 180)], ITEM_ORDER),
       vch("jv-1", "Journal", D2, "5", [led("Rent", -500), led("Cash", 500)]),
       "<TALLYMESSAGE>" + DN + "</TALLYMESSAGE>"],
}
NONACC = {"jw-1": "Job Work In Order", "jw-2": "Job Work In Order", "po-1": "Purchase Order", "731803af-a55f-4dda-87cd-d1677a1f2cf0-00000009": "Delivery Note", "own-1": "GB PO"}
INBOOKS = ["pay-1", "sal-1", "jv-1"]
TMP = tempfile.mkdtemp(prefix="orders-")
for d, vs in DAY.items(): open(os.path.join(TMP, d + ".xml"), "w").write("<ENVELOPE><BODY><DATA>" + "".join(vs) + "</DATA></BODY></ENVELOPE>")
# ---------------------------------------------------------------- A. the cloud's reader
js = os.path.join(TMP, "parse.mjs")
open(js, "w").write("""
import { parseDay, NON_ACC_TYPES } from %s;
const out = {types: NON_ACC_TYPES, days: {}};
for (const d of Deno.args) out.days[d.split("/").pop().slice(0, 8)] = parseDay(Deno.readTextFileSync(d));
console.log(JSON.stringify(out));
""" % json.dumps("file://" + os.path.abspath(os.path.join(ROOT, "server", "tally-cloud", "parse.js"))))
r = subprocess.run([DENO, "run", "--allow-read", js] + [os.path.join(TMP, d + ".xml") for d in sorted(DAY)], capture_output=True, text=True)
if r.returncode: print(r.stderr[-1500:]); raise SystemExit("parse.js under Deno failed")
P = json.loads(r.stdout)
V = {v["guid"]: v for d in P["days"].values() for v in d["vouchers"]}
for g, t in NONACC.items():
    v = V.get(g) or {}
    ok(v.get("opt") is True and str(v.get("nonAcc", "")).startswith(t), "A. %s (%s): kept, marked not in the books (opt, nonAcc %r)" % (g[:12], t, v.get("nonAcc")))
ok(not [c for c in (V.get("jw-2") or {}).get("checks", []) if "do not add up" in c], "A. no 'lines do not add up' note on an order (%s)" % (V.get("jw-2") or {}).get("checks"))
for g in INBOOKS:
    v = V.get(g) or {}
    ok(v and not v.get("opt") and not v.get("nonAcc"), "A. %s (%s): in the books" % (g, v.get("type")))
ok([c for c in (V.get("pay-1") or {}).get("checks", []) if "do not add up" in c], "A. a Payment whose lines do not total zero (no order details): in the books, its note as before")
# ---------------------------------------------------------------- B. the browser's rule
src = open(os.path.join(ROOT, "src", "js", "04-the-client-s-books-read-from-tally.js")).read()
m = re.search(r"\n  NON_ACC_TYPES: \[[\s\S]*?\],\n  nonAccounting\(s, amts\)\{\n[\s\S]*?\n  \},\n", src)
ok(bool(m), "B. the browser's rule is there (Books.NON_ACC_TYPES, Books.nonAccounting)")
if m:
    names = open(os.path.join(ROOT, "server", "_shared", "names.js")).read()
    names = re.sub(r"^export .*$", "", names, flags=re.M)
    bj = os.path.join(TMP, "books.mjs")
    open(bj, "w").write(names + "\nconst Books = {" + m.group(0) + "};\n" + """
const out = {types: Books.NON_ACC_TYPES, d: {}};
for (const f of Deno.args){
  const t = Deno.readTextFileSync(f);
  for (const v of t.match(/<VOUCHER\\b[\\s\\S]*?<\\/VOUCHER>/g)){
    const g = (v.match(/<GUID>([^<]*)<\\/GUID>/) || [])[1], amts = [...v.matchAll(/<AMOUNT>([^<]*)<\\/AMOUNT>/g)].map(x => x[1]);
    // the ledger lines' amounts only (as Books.takeVoucher's v.ent): the inventory line's own AMOUNT left out
    const led = [...v.matchAll(/<(ALLLEDGERENTRIES|LEDGERENTRIES|ACCOUNTINGALLOCATIONS)\\.LIST>[\\s\\S]*?<AMOUNT>([^<]*)<\\/AMOUNT>/g)].map(x => Number(x[2]));
    out.d[g] = Books.nonAccounting(v, led);
  }
}
console.log(JSON.stringify(out));
""")
    r = subprocess.run([DENO, "run", "--allow-read", bj] + [os.path.join(TMP, d + ".xml") for d in sorted(DAY)], capture_output=True, text=True)
    if r.returncode: ok(False, "B. the browser's rule runs: " + r.stderr[-600:])
    else:
        Bx = json.loads(r.stdout)
        ok(Bx["types"] == P["types"], "B. the same list of Tally's non-accounting types in the browser and the cloud")
        same = {g: (bool(Bx["d"].get(g)), bool(V[g].get("nonAcc"))) for g in V}
        ok(all(a == b for a, b in same.values()) and len(same) == 8, "B. the browser decides each entry as the cloud does (%s)" % same)
# ---------------------------------------------------------------- C. the database leaves them out
import pg_stand
SQLDIR = os.path.join(ROOT, "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
                                           "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-89-ledger-fetch.sql", "migration-90-ledger-fetch-speed.sql")]
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
FIRM, B = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111111"
db = pg_stand.start(30964)
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("insert into firms values (%s, 'Firm') on conflict do nothing; insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'GB TEXCOAT', '2025-04-01', '2025-03-31');" % (q(FIRM), q(B), q(FIRM)))
    for path in FILES:
        rr = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                            input=open(path).read(), capture_output=True, text=True)
        if rr.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), rr.stderr[-300:])); raise SystemExit("cannot go on")
    for d, res in sorted(P["days"].items()):
        vs = [{k: v.get(k) for k in ("guid", "alter", "type", "no", "party", "narr", "cancel", "opt", "gstin", "pos", "ref", "refDate", "cmp")} for v in res["vouchers"]]
        db.sql("select public.tally_ingest_day(%s, %s, %s::jsonb, %s::jsonb, %d, %d, 100)" % (q(B), q(d[:4] + "-" + d[4:6] + "-" + d[6:]), q(json.dumps(vs)), q(json.dumps(res["lines"])), res["n"], res["alterMax"]))
    stored = {r["guid"]: r["optional"] in (True, "t", "true") for r in db.rows("select guid, optional from tally_vouchers where book_id = %s" % q(B))}
    ok(all(stored.get(g) is True for g in NONACC) and all(stored.get(g) is False for g in INBOOKS), "C. every entry stored; the order and note entries marked optional (%s)" % stored)
    cache = {r["ledger"]: float(r["s"]) for r in db.rows("select ledger, sum(amount) as s from tally_ledger_day where book_id = %s group by ledger" % q(B))}
    ok(not [l for l in ("GB Party", "Job Work Charges", "Freight", "Supplier", "Purchase", "Template Party") if l in cache] and abs(cache.get("Sales", 0) - 1000) < 0.01,
       "C. the ledger-day cache (trial balance, ledgers, MIS) holds none of their lines; Sales only the invoice's 1,000 (%s)" % cache)
    ok(abs(sum(v for k, v in cache.items() if k not in ("Cash", "Rent"))) < 0.01, "C. the books' lines total zero but for the Payment that does not balance in itself (%s)" % round(sum(cache.values()), 2))
finally:
    db.stop()
    subprocess.run(["rm", "-rf", db.data, TMP])
if fails: print("FAILED %d" % len(fails)); raise SystemExit(1)
print("ALL PASSED")
