"""python3 run_bankdate_cloud.py - next-bankdate (FinCom Bridge 2.4.0): FinCom's cloud applies a bank date set in Tally.
Setting a bank date in Tally's Bank Reconciliation fires no add-on event; the voucher's AlterID jumps to the company's next
ALTVCHID and the bank date is stored (BANKALLOCATIONS.BANKERSDATE; probe runs 37763910797, 37766812255, 37770857500 and
37776378311, TallyPrime 3.0 .. 7.1). The bridge's bank route (bridge-go/bankdate.go) re-reads such an entry with
FinComVoucherObject and sends it as an altered line WITH Tally's entry (source "bankdate", "full": true), whose only change
is the bank date. On throwaway PostgreSQL (pg_stand, port 30680 unless PGBANK_PORT; never a real database), built
32 -> ... -> 58 -> 60 -> 67 as run_migration67.py builds it; the line's vouchers made as tally-ingest makes them (parse.js on
the bridge's stripped voucher XML, then index.ts's dayVouchers / partA shape and "full": true).
  0. parse.js reads the bank date from the bridge's stripped entry (BANKALLOCATIONS.LIST under ALLLEDGERENTRIES.LIST).
  1. the entry made (no bank date): applied; its bank line stored without a bank date.
  2. the bank date set (AlterID 60100 -> 60101, nothing else changed): the altered line is APPLIED, the copy at 60101, the
     bank line's bank date 07-Oct-2026 (the earlier row kept as history, gone_at set); the entry's ledger lines unchanged.
  3. the same line again (another line id, another computer): 'duplicate', nothing changes.
  4. the bank date changed again (60102): applied, 08-Oct-2026 now; cleared (60103, no BANKERSDATE): applied, no bank date.
  5. an older line arriving late (60101's bank date after 60103): 'stale', the copy keeps no bank date.
  6. the copy holding the entry at the AlterID of the line WITHOUT its bank date (a body read before the bank fields were
     fetched): the same-AlterID line is reported (the case migration 67's same-AlterID rule would decide)."""
import os, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql",
                                           "migration-60-recorder-lows.sql")]
FILES.append(os.environ.get("MBANK_FILE") or os.path.join(SQLDIR, "migration-67-recorder-renumbered.sql"))
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
B, D1 = "f79e4bc3-871d-4482-874d-000000000068", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
MID = 920
GUID = CG + "-%08x" % MID
START = 50000

# the bridge's entry as FinComVoucherObject's answer is stripped (bridge-go/fastvch.go): a receipt, its bank line with
# Tally's bank allocation; bdate "" : no bank date set
def vxml(alter, bdate):
    bank = "<BANKALLOCATIONS.LIST><DATE>20261003</DATE><TRANSACTIONTYPE>Cheque</TRANSACTIONTYPE><INSTRUMENTNUMBER>000451</INSTRUMENTNUMBER><INSTRUMENTDATE>20261003</INSTRUMENTDATE>" + \
           ("<BANKERSDATE>%s</BANKERSDATE>" % bdate if bdate else "") + "</BANKALLOCATIONS.LIST>"
    return ('<VOUCHER REMOTEID="%s" VCHTYPE="Receipt"><DATE>20261003</DATE><GUID>%s</GUID><MASTERID>%d</MASTERID><ALTERID> %d</ALTERID><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>'
            '<VOUCHERNUMBER>191</VOUCHERNUMBER><PARTYLEDGERNAME>Spike Customer</PARTYLEDGERNAME><NARRATION>Received</NARRATION><ISOPTIONAL>No</ISOPTIONAL><ISCANCELLED>No</ISCANCELLED>'
            '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Customer</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>500.00</AMOUNT></ALLLEDGERENTRIES.LIST>'
            '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Bank</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-500.00</AMOUNT>%s</ALLLEDGERENTRIES.LIST></VOUCHER>') % (GUID, GUID, MID, alter, bank)

# tally-ingest's reading of the line's XML (index.ts: parseDay, the line's own voucher, dayVouchers with partA, "full": true)
NODE = r"""
import { parseDay } from %s;
const xs = JSON.parse(process.argv[1]);
const out = xs.map((x) => {
  const r = parseDay("<ENVELOPE><BODY><DATA><COLLECTION>" + x + "</COLLECTION></DATA></BODY></ENVELOPE>");
  const v = r.vouchers[0];
  const pa = Array.isArray(v.items) ? {irn: v.irn || "", ackNo: v.ackNo || "", ackDate: v.ackDate || "", eway: v.eway || "", items: v.items, costs: v.costs || [], banks: v.banks || [], tds: v.tds || [], dues: v.dues || [], checks: v.checks || []} : {};
  return {voucher: {guid: v.guid, alter: v.alter, type: v.type, no: v.no, party: v.party, narr: v.narr, cancel: v.cancel, opt: v.opt, gstin: v.gstin, pos: v.pos, ref: v.ref, refDate: v.refDate, cmp: v.cmp, fid: v.fid ?? null, ...pa, day: "2026-10-03", full: true},
          lines: r.lines.filter((l) => l[0] === v.guid)};
});
console.log(JSON.stringify(out));
""" % json.dumps("file://" + os.path.abspath(os.path.join(SQLDIR, "parse.js")))
def ingest(xmls):
    r = subprocess.run(["node", "--input-type=module", "-e", NODE, json.dumps(xmls)], capture_output=True, text=True)
    if r.returncode: raise SystemExit("node: " + r.stderr[-500:])
    return json.loads(r.stdout)
def L(lid, ev, alter, bdate, source="bankdate"):
    b = ingest([vxml(alter, bdate)])[0]
    return {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-2.4.0", "vch_no": "191", "ledgers": ["Spike Customer", "Spike Bank"], "line_id": lid, "save_ms": 0, "alter_id": alter,
            "saved_at": "2026-10-08T05:00:00.000Z", "vch_date": "20261003", "vch_type": "Receipt", "master_id": str(MID), "object_guid": GUID, "company_guid": CG, "company": "GARG SHEKHAR & COMPANY",
            "source": source, "full": True, "vouchers": [b["voucher"]], "lines": b["lines"]}

print("== 0. parse.js reads the bank date from the bridge's entry")
p = ingest([vxml(60101, "20261007"), vxml(60100, "")])
ok([x.get("bdate") for x in p[0]["voucher"].get("banks", [])] == ["20261007"], "0. BANKERSDATE read as the bank line's bank date (%s)" % p[0]["voucher"].get("banks"))
ok([x.get("bdate") for x in p[1]["voucher"].get("banks", [])] == [""] or [x.get("bdate") for x in p[1]["voucher"].get("banks", [])] == [None], "0. none set: none read (%s)" % p[1]["voucher"].get("banks"))

os.environ.setdefault("TMPDIR", "/tmp")
db = pg_stand.start(int(os.environ.get("PGBANK_PORT") or 30680))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s):
    try: x = db.one(s)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def apply(lines): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(lines)))
def res(r): return [(x.get("state"), x.get("why") or "") for x in r.get("results", [])] if isinstance(r, dict) and "results" in r else [("error", json.dumps(r)[:400])]
def vrow(): return (db.rows("select alter_id::text as alter_id, vno, party from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(GUID))) or [None])[0]
def banks(): return db.rows("select ledger, txn_type, instrument_no, coalesce(to_char(bank_date, 'YYYY-MM-DD'), '') as bank_date, alter_id::text as alter_id from tally_bank_allocs where book_id = %s and guid = %s and gone_at is null order by line_no" % (q(B), q(GUID)))
def gone(): return int(db.one("select count(*) from tally_bank_allocs where book_id = %s and guid = %s and gone_at is not null" % (q(B), q(GUID))))
def lines(): return db.rows("select ledger, amount::text as amount from tally_lines where book_id = %s and guid = %s order by ledger" % (q(B), q(GUID)))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.4.0');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GARG SHEKHAR & COMPANY', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, %d, '2026-10-04 10:00+05:30', %s)" % (q(B), q(F), START, q(CG)))

    print("== 1. the entry made, no bank date")
    r = res(apply([L("b-cre", "created", 60100, "", source="addon")]))
    ok(r[0][0] == "applied" and (vrow() or {}).get("alter_id") == "60100", "1. applied at 60100 (%s %s)" % (r, vrow()))
    ok([b["bank_date"] for b in banks()] == [""] and banks()[0]["instrument_no"] == "000451", "1. its bank line, no bank date (%s)" % banks())
    l0 = lines()

    print("== 2. the bank date set in Tally (AlterID 60101, nothing else changed)")
    r = res(apply([L("b-bd1", "altered", 60101, "20261007")]))
    ok(r[0][0] == "applied", "2. the bank-date-only altered line is applied (%s)" % r)
    ok((vrow() or {}).get("alter_id") == "60101", "2. the copy at 60101 (%s)" % vrow())
    ok([b["bank_date"] for b in banks()] == ["2026-10-07"] and banks()[0]["alter_id"] == "60101", "2. the bank line's bank date 2026-10-07 (%s)" % banks())
    ok(gone() == 1, "2. the earlier row kept as history (gone_at): %d" % gone())
    ok(lines() == l0, "2. the entry's ledger lines unchanged (%s)" % lines())

    print("== 3. the same change again")
    r = res(apply([L("b-bd1-again", "altered", 60101, "20261007")]))
    ok(r[0][0] == "duplicate" and [b["bank_date"] for b in banks()] == ["2026-10-07"] and gone() == 1, "3. 'duplicate', nothing changes (%s %s)" % (r, banks()))

    print("== 4. changed again, then cleared")
    r = res(apply([L("b-bd2", "altered", 60102, "20261008")]))
    ok(r[0][0] == "applied" and [b["bank_date"] for b in banks()] == ["2026-10-08"], "4. 08-Oct-2026 now (%s %s)" % (r, banks()))
    r = res(apply([L("b-bd3", "altered", 60103, "")]))
    ok(r[0][0] == "applied" and [b["bank_date"] for b in banks()] == [""] and (vrow() or {}).get("alter_id") == "60103", "4. cleared in Tally: no bank date (%s %s)" % (r, banks()))

    print("== 5. an older line late")
    r = res(apply([L("b-late", "altered", 60101, "20261007")]))
    ok(r[0][0] in ("stale", "duplicate") and [b["bank_date"] for b in banks()] == [""], "5. not applied, no bank date kept (%s %s)" % (r, banks()))

    print("== 6. the copy at the line's AlterID without its bank date")
    r = res(apply([L("b-old-reader", "altered", 60104, "", source="addon")]))
    ok(r[0][0] == "applied", "6. the copy at 60104, no bank date (%s)" % r)
    r = res(apply([L("b-same", "altered", 60104, "20261009")]))
    print("  note same-AlterID bank-date line: %s; bank lines %s" % (r, banks()))
    SAME = r[0][0]
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
