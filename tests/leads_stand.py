"""leads_stand.py - a stand-in for FinCom's cloud holding a book shaped like the staging copy of Leads Insurance
(cmvclkrfeoj3h1; sizes read from staging on 24-Oct-2026 with SELECT count(*) only, names and amounts made up):
4,414 entries on 560 days (43 payroll entries), 749 ledgers, 2,806 items of TDS/GST work (ledInfo 776, under 776,
map 374, allocLog 270, gstins 157, alloc 148, pans 73, 16 challans, an audit of 148 KB), and a second, small client.
Used by run_books_speed.py. Every request is held as on an office line (RTT, then the body at the line's speed; the
line is one: answers fetched side by side share its 9 Mbit/s, so fetching many at once saves round trips, never bandwidth).
fast-firstopen (25-Oct-2026): each day file as heavy as Leads' on staging (560 files, 6,224,541 bytes packed, SELECT
sum(bytes) FROM tally_days): every entry carries the fields Tally exports and FinCom does not read (the empty tags of a real
Tally 7.1 export, tests/fixtures/tdsgst-e2e/real71, and user-defined fields), about 13 KB of text and 1.4 KB packed, as a
real export packs 8 to 1. LEADS_LIGHT=1: the light files of before (346 KB)."""
import json, gzip, asyncio, time, re, datetime, random, os
from urllib.parse import urlparse, parse_qs

STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"
CID, CID_B = "cmzzleads0001", "cmzzsmall0002"
BOOK, FIRM = "zzbook00-0000-4000-8000-000000000001", "f0000000-0000-0000-0000-00000000000f"
LINE = {"rtt": 0.15, "down": 9e6 / 8, "up": 3e6 / 8}      # "fast 4G" as an office line: 150 ms, 9 Mbit/s down, 3 up

random.seed(7)
esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
TDSL = ["TDS 94C", "TDS 94J 2%", "TDS 94J 10%", "TDS on Rent 94I", "TDS 192B"]
PAYH = ["Basic", "HRA", "Conveyance", "Special Allowance", "Bonus", "Medical", "PF Employee", "ESI Employee", "Professional Tax", "TDS 192B"]
PARTIES = ["ZZ Party %03d" % i for i in range(640)]
LEDGERS = [{"name": n, "parent": "Sundry Creditors", "open": 0} for n in PARTIES] + \
          [{"name": n, "parent": "Duties & Taxes", "open": 0} for n in TDSL] + \
          [{"name": "ZZ Expense %02d" % i, "parent": "Indirect Expenses", "open": 0} for i in range(60)] + \
          [{"name": h, "parent": "Indirect Expenses", "open": 0} for h in PAYH if h not in TDSL] + \
          [{"name": "ZZ Bank", "parent": "Bank Accounts", "open": 500000}, {"name": "Salary Payable", "parent": "Current Liabilities", "open": 0}]
while len(LEDGERS) < 749: LEDGERS.append({"name": "ZZ Misc %03d" % len(LEDGERS), "parent": "Indirect Expenses", "open": 0})
D0 = datetime.date(2025, 4, 1); DAYS = [(D0 + datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(560)]
iso = lambda d8: d8[:4] + "-" + d8[4:6] + "-" + d8[6:8]
VOUCHERS = []
for i in range(4414):
    d = DAYS[i * len(DAYS) // 4414]; p = PARTIES[i % len(PARTIES)]; amt = 1000 + (i * 37) % 90000
    if i % 7 == 0:
        t = TDSL[i % 4]; tds = round(amt * 0.02, 2)
        lines = [("ZZ Expense %02d" % (i % 60), -amt), (t, tds), (p, round(amt - tds, 2))]
    else:
        lines = [("ZZ Expense %02d" % (i % 60), -amt), (p, amt)]
    VOUCHERS.append({"guid": "zzguid-%05d" % i, "day": d, "alt": 1000 + i, "type": "Journal", "no": str(i + 1), "party": p, "lines": lines})
PAYV = []
for k in range(43):
    v = VOUCHERS[100 * k + 50]; v["type"] = "Payroll"; v["party"] = ""; v["lines"] = [("Basic", -500000), ("HRA", -100000), ("TDS 192B", 50000), ("Salary Payable", 550000)]; PAYV.append(v)
# the fields a real Tally export carries that FinCom does not read (empty tags as Tally 7.1 writes them, then user-defined
# fields with values of their own), so the files weigh what Leads' weigh: download, unpacking, reading and keeping
HEAVY = os.environ.get("LEADS_LIGHT") != "1"
EMPTY_TAGS = """VATREGISTRATIONDATE CSTREGISTRATIONDATE FROMDATE TODATE ACTIVETO ALTEREDON LUTDATEOFISSUE LUTEXPIRYDATE BONDDATEOFISSUE
BONDEXPIRYDATE TAXCHEQUEDATE TAXCHALLANDATE SHIPPINGBILLDATE BILLOFENTRYDATE VATPARTYTRANSRETURNDATE ORIGINALVCHDATE ISDDOCUMENTDATE
IRNCANCELDATE UAEEINVBILLDATE RECONCILATIONDATE FORM16ISSUEDATE CSTFORMISSUEDATE CSTFORMRECVDATE CERTIFICATEDATE TRADERMFGRINVOICEDT
FBTFROMDATE FBTTODATE RETURNINVOICEDATE AGGREMENTORDERDATE GOODSRCPTDATE LORRYRECPTDATE TRANSSALELANDINGDATE TRANSBUYERLANDINGDATE
CREDITLETTERDATE AIRWAYBILLDATE VATORDERDATE INVDELIVERYDATE BILLOFLADINGDATE VATDEPOSITDATE VATDOCUMENTDATE VATCHALLANDATE ECDATE
VATTDSDATE ADJFROMDATE ADJTODATE VATDDCHEQUEDATE VATDUEDATE VATINTDATE VATDELAY VATGRNDATE REFUNDORDERDT VATFORMSUBMISSIONDATE
VATCANCSALESINVOICEDATE VATFORMTWELVEDATE UTKAGREEORDDATE UTKGOODSDELDATE VATBILTYDATE EIDESPDATE VATCSTE1SERIESDATE VCHVATDEPOSITDATE
VCHREFERENCEDATE TAXPAYPERIODFROMDATE TAXPAYPERIODTODATE STTAXCHALLANDATE GSTCHALLANDATE GSTCHALLANEXPIRYDATE ADJPARTYINVOICEDATE
ADJPARTYPAYMENTDATE PARTYORDERDATE ADVANCERECEIPTDATE REFUNDVOUCHERDATE PAYMENTLINKEXPIRYDATE VATSUBMISSIONDATE PARTYINVDATE INSPDOCDATE
VATCANCINVDATE VATGOODSRECEIPTDATE VATCSTE1DATE DISPATCHDATE AUDITEDON VATDISTRICTNAME VATDEALERTYPE STATENAME DISCOUNTFORMAT PRICELEVEL
AUTOCOSTLEVEL PURPOSETYPE REMOTEGUID REMOTEALTGUID ENTEREDBY ALTEREDBY TYPEOFUPDATEACTIVITY OBJECTUPDATEACTION REQUESTORRULE
IMPORTEREXPORTERCODE VATDEALERNATURE""".split()
def pad(i):
    if not HEAVY: return ""
    r = random.Random(i)
    tags = "".join("\r\n     <%s/>" % n for n in EMPTY_TAGS) * 3
    udf = "".join('\r\n     <UDF:ZZNOTE%d.LIST DESC="`ZzNote`" ISLIST="YES" TYPE="String" INDEX="%d"><UDF:ZZNOTE%d DESC="`ZzNote`">%x</UDF:ZZNOTE%d></UDF:ZZNOTE%d.LIST>'
                  % (k, k, k, r.getrandbits(320), k, k) for k in range(21))
    return tags + udf
def vxml(v):
    ent = "".join("<ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><AMOUNT>%.2f</AMOUNT></ALLLEDGERENTRIES.LIST>"
                  % (esc(l), "Yes" if a < 0 else "No", a) for l, a in v["lines"])
    return ('<TALLYMESSAGE><VOUCHER VCHTYPE="%s" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><ALTERID>%d</ALTERID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME>'
            "<VOUCHERNUMBER>%s</VOUCHERNUMBER><PARTYLEDGERNAME>%s</PARTYLEDGERNAME><NARRATION>zz narration of the entry %s</NARRATION><ISCANCELLED>No</ISCANCELLED><ISOPTIONAL>No</ISOPTIONAL>%s%s</VOUCHER></TALLYMESSAGE>"
            % (esc(v["type"]), v["day"], v["guid"], v["alt"], esc(v["type"]), v["no"], esc(v["party"]), v["no"], pad(v["alt"]), ent))
def head(v):
    return {"guid": v["guid"], "day": iso(v["day"]), "alter_id": v["alt"], "vtype": v["type"], "vno": v["no"], "party": v["party"], "narration": "zz " * 20,
            "cancelled": False, "optional": False, "deleted_at": None, "gstin": None, "pos": None, "ref": "ZZ/REF/%s" % v["no"], "ref_date": iso(v["day"]), "cmp_gstin": "09ZZZZZ0000Z1Z0",
            "irn": None, "irn_ack_date": None, "gst_reg_type": "Regular", "gst_country": "India", "gst_rcm": False, "gst_nature": None, "gst_taxability": None, "gst_supply": None,
            "gst_ineligible": False, "gst_mixed": False, "gst_alter_id": v["alt"], "tds_tally": None, "tds_tally_alter_id": None, "book_id": BOOK}
GZ = {}
DAY_AT = {d: "2026-10-20T07:46:51+00:00" for d in DAYS}
def build_days():
    by = {}
    for v in VOUCHERS: by.setdefault(v["day"], []).append(vxml(v))
    for d in DAYS: GZ[d] = gzip.compress(("<ENVELOPE><BODY><DATA>" + "".join(by.get(d, [])) + "</DATA></BODY></ENVELOPE>").encode("utf-8"))
build_days()
GPARENT = {"Sundry Creditors": "Current Liabilities", "Duties & Taxes": "Current Liabilities", "Bank Accounts": "Current Assets"}
# each ledger's group chain, as the cloud keeps it (tally_ledgers.chain, migration 33: 748 of Leads' 749 ledgers have one)
chain_of = lambda g: [g] + ([GPARENT[g]] if g in GPARENT else [])
T = {"tally_ledgers": [dict(l, book_id=BOOK, chain=chain_of(l["parent"]), pan=None, gstin=None, tds_nature=None, tds_special_rate=None, tds_ldc=None, merged_into=None, deleted_at=None,
                            for_payroll=l["name"] in PAYH, pay_type=None, pay_stat_type=None, it_component=None) for l in LEDGERS],
     "tally_groups": [dict(name=n, parent=pa, book_id=BOOK) for n, pa in [("Sundry Creditors", "Current Liabilities"), ("Duties & Taxes", "Current Liabilities"),
                      ("Indirect Expenses", "Primary"), ("Bank Accounts", "Current Assets"), ("Current Liabilities", "Primary"), ("Current Assets", "Primary")]
                      + [("ZZ Group %02d" % i, "Primary") for i in range(78)]], "tally_tds_natures": [], "tally_recorder_lines": [], "tally_salary_pays": [], "tally_employees": [], "tally_cost_allocs": [],
     "tally_vouchers": [head(v) for v in VOUCHERS], "tally_lines": [], "tally_bills": []}
# ---------- the TDS/GST work as items (client_book_items), counts as Leads' on staging
AT = "2026-10-20T07:45:00+00:00"; ITEMS = []
def item(cid, k, i, d, o=None, deleted=False):
    ITEMS.append({"cid": cid, "key": k, "item": i, "ord": o, "data": None if deleted else d, "deleted": deleted, "seq": len(ITEMS) + 1, "updated_at": AT, "updated_by": "u-other"})
for k in ("ledInfo", "under", "map", "gstins", "alloc", "pans", "allocLog"): item(CID, k, "", {"$t": "obj"})
for n in [l["name"] for l in LEDGERS] + ["ZZ Gone %02d" % i for i in range(26)]: item(CID, "ledInfo", "." + n, {"pan": "", "gstin": "", "addr": "zz street, zz town " * 3})
for l in LEDGERS + [{"name": "ZZ Gone %02d" % i, "parent": "Sundry Creditors"} for i in range(27)]: item(CID, "under", "." + l["name"], l["parent"])
for n in [l["name"] for l in LEDGERS][:370] + TDSL[:4]: item(CID, "map", "." + n, {"kind": "tds" if n in TDSL else "other", "ok": n in TDSL, "what": "tds_payable" if n in TDSL else "", "note": "zz " * 60})
for n in PARTIES[:157]: item(CID, "gstins", "." + n, "09ZZZZZ%04dZ1Z5" % PARTIES.index(n))
for n in PARTIES[:73]: item(CID, "pans", "." + n, "ZZZPZ%04dZ" % PARTIES.index(n))
CH = [{"id": "chzz%02d" % i, "bsr": "1234567", "tax": 10000 + i, "date": "2026%02d07" % (4 + i % 6), "serial": "%05d" % (i + 1), "section": "194C", "interest": 0, "from": "books"} for i in range(16)]
item(CID, "challans", "", {"$t": "arr"})
for i, c in enumerate(CH): item(CID, "challans", "#" + c["id"], c, i)
tds_v = [v for v in VOUCHERS if any(l in TDSL[:4] for l, _ in v["lines"])]
for j, v in enumerate(tds_v[:148]): item(CID, "alloc", "." + v["guid"] + "|" + next(l for l, _ in v["lines"] if l in TDSL), CH[j % 16]["id"])
for j in range(270): item(CID, "allocLog", ".zzlog%03d" % j, {"at": AT, "by": "zz", "what": "allocated " * 30})
item(CID, "audit", "", {"runs": [{"at": AT, "findings": [{"id": "f%04d" % k, "words": "zz finding words " * 4} for k in range(1100)]}]})
for k in ("ledInfo", "map"): item(CID_B, k, "", {"$t": "obj"})
for n in ["ZZ Small %02d" % i for i in range(30)]: item(CID_B, "ledInfo", "." + n, {"pan": "", "gstin": ""})
STATUS_AT = {"ledgersAt": "2026-10-17T16:18:53Z", "daysAt": "2026-10-20T07:46:51Z"}
LOG = []           # (t, name, detail, bytes, method)
SEQ = [len(ITEMS)]

def proj(rows, q):
    sel = (q.get("select") or [None])[0]
    for key, vals in q.items():
        if key in ("select", "order", "limit", "offset"): continue
        v = vals[0]
        if v.startswith("eq."): rows = [r for r in rows if str(r.get(key)).lower() == v[3:].lower() or (r.get(key) is True and v[3:] == "true")]
        elif v.startswith("in.("):
            s = set(x.strip('"') for x in re.findall(r'"(?:[^"\\]|\\.)*"|[^,]+', v[4:-1])); rows = [r for r in rows if str(r.get(key)) in s]
        elif v == "is.null": rows = [r for r in rows if r.get(key) is None]
        elif v == "not.is.null": rows = [r for r in rows if r.get(key) is not None]
        elif v.startswith("gt."): rows = [r for r in rows if str(r.get(key) or "") > v[3:]]
    off = int((q.get("offset") or ["0"])[0]); lim = int((q.get("limit") or ["1000"])[0]); rows = rows[off:off + lim]
    if sel: cols = sel.split(","); rows = [{c: r.get(c) for c in cols} for r in rows]
    return rows

PACK = [os.environ.get("LEADS_NO_PACK") != "1"]
def pack_month(days):
    """the month's day files as tally-ingest's month_days answers (server/tally-cloud/monthpack.js): a JSON list's length
    (4 bytes, big-endian), the list [{day, at, n}], then each day's gzip bytes"""
    head = json.dumps([{"day": d, "at": at, "n": len(gz or b"")} for d, at, gz in days]).encode("utf-8")
    return len(head).to_bytes(4, "big") + head + b"".join(gz or b"" for _, _, gz in days)
# one office line: an answer's bytes come down after its round trip, behind the bytes of the answers already coming
WIRE = [0.0]
async def hold(sent, got):
    now = time.time(); start = max(now + LINE["rtt"] + sent / LINE["up"], WIRE[0])
    WIRE[0] = start + got / LINE["down"]
    await asyncio.sleep(max(0, WIRE[0] - now))

async def route(r):
    u = urlparse(r.request.url); path = u.path; q = parse_qs(u.query); body = r.request.post_data or ""
    async def j(o, name=None, detail=""):
        b = json.dumps(o); await hold(len(body), len(b))
        LOG.append((time.time(), name or path.split("/")[-1], detail, len(b), r.request.method))
        return await r.fulfill(status=200, content_type="application/json", body=b)
    # fast-firstopen: tally-ingest's month_days (server/tally-cloud/monthpack.js), a month's day files in one answer;
    # PACK[0] False: a server without it (as staging before the deploy: "No such client in this firm.")
    if path.endswith("/functions/v1/tally-ingest"):
        b = json.loads(body or "{}")
        if b.get("kind") == "month_days":
            if not PACK[0]:
                await hold(len(body), 60); LOG.append((time.time(), "month_days", "404", 60, "POST"))
                return await r.fulfill(status=404, content_type="application/json", body=json.dumps({"ok": False, "error": "No such client in this firm."}))
            ym = str(b.get("month") or ""); days = [d for d in DAYS if d[:6] == ym]
            out = pack_month([(d, DAY_AT[d], GZ.get(d)) for d in days])
            await hold(len(body), len(out)); LOG.append((time.time(), "month_days", ym, len(out), "POST"))
            return await r.fulfill(status=200, content_type="application/octet-stream", body=out)
        return await j({"ok": True})
    if path.endswith("/rpc/tally_status"):
        cid = (json.loads(body or "{}") or {}).get("p_client")
        if cid != CID: return await j([])
        return await j([dict({"book": BOOK, "company": "ZZ LEADS-LIKE BROKERS PVT LTD", "from": "2025-04-01", "openAsOn": "2025-03-31", "state": {"phase": "live"},
                              "days": len(DAYS), "entries": len(VOUCHERS), "to": iso(DAYS[-1])}, **STATUS_AT)])
    # the server's own figures (migration 14), shown while the books are not in on the computer yet
    if path.endswith("/rpc/tally_tds_summary"):
        a = json.loads(body or "{}")
        return await j({"from": a.get("p_from"), "to": a.get("p_to"), "mapped": True, "deducted": 125000, "paid": 98000, "receivable": 0,
                        "ledgers": [{"l": t, "open": 0, "deducted": 25000, "paid": 19600, "close": 5400} for t in TDSL]})
    if path.endswith("/rpc/tally_mis"):
        a = json.loads(body or "{}"); return await j({"from": a.get("p_from"), "to": a.get("p_to"), "heads": {"exp": 9000000}, "months": []})
    if path.endswith("/rpc/tally_gst_summary"):
        a = json.loads(body or "{}"); return await j({"from": a.get("p_from"), "to": a.get("p_to"), "mapped": False, "months": []})
    if path.endswith("/rpc/tally_days_list"):
        off = int((q.get("offset") or ["0"])[0]); return await j([{"day": d, "n": 1, "at": DAY_AT[d]} for d in DAYS][off:off + 1000])
    if "/tally-days/" in path:
        b = GZ.get(path.rsplit("/", 1)[1][:8], b""); await hold(0, len(b)); LOG.append((time.time(), "DAYFILE", "", len(b), "GET"))
        return await r.fulfill(status=200, content_type="application/gzip", body=b)
    name = path.split("/rest/v1/")[-1] if "/rest/v1/" in path else ""
    if name == "client_book_items":
        after = int(q.get("seq", ["gt.0"])[0][3:]); key = (q.get("key") or [""])[0][3:]; cid = (q.get("client_id") or ["eq."])[0][3:]
        rows = [{k: x[k] for k in ("key", "item", "ord", "data", "deleted", "seq", "updated_at", "updated_by")} for x in ITEMS if x["cid"] == cid and x["seq"] > after and (not key or x["key"] == key)][:1000]
        return await j(rows, "client_book_items", ("FROM0 " if after == 0 else "since ") + cid + (" key=" + key if key else ""))
    if name == "rpc/save_book_items":
        b = json.loads(body or "{}"); out = []
        for x in b.get("p_items", []):
            SEQ[0] += 1
            ITEMS.append({"cid": b.get("p_client"), "key": x["k"], "item": x.get("i", ""), "ord": x.get("o"), "data": None if x.get("del") else x.get("d"), "deleted": bool(x.get("del")), "seq": SEQ[0], "updated_at": AT, "updated_by": "u1"})
            out.append({"k": x["k"], "i": x.get("i", ""), "seq": SEQ[0]})
        return await j({"ok": True, "items": out, "at": AT}, "save_book_items", "%d items" % len(out))
    if name == "members": return await j([{"user_id": "u1", "firm_id": FIRM, "name": "ZZ", "role": "owner", "active": True}])
    if name in T:
        detail = (q.get("select") or [""])[0] + ("&guid" if "guid" in q else "")
        return await j(proj(T[name], q), name, detail)
    return await j([])

def cat(since, until=None):
    rs = [x for x in LOG if x[0] >= since and (until is None or x[0] <= until)]
    f = lambda p: [x for x in rs if p(x)]
    return {"calls": len(rs), "kb": sum(x[3] for x in rs) // 1024, "dayfiles": len(f(lambda x: x[1] == "DAYFILE")),
            "months": len(f(lambda x: x[1] == "month_days")),
            "items_from0": len(f(lambda x: x[1] == "client_book_items" and x[2].startswith("FROM0"))),
            "items_calls": len(f(lambda x: x[1] == "client_book_items")),
            "heads_kb": sum(x[3] for x in f(lambda x: x[1] == "tally_vouchers")) // 1024,
            "ledgers_full": len(f(lambda x: x[1] == "tally_ledgers" and "parent" in x[2])),
            "save": len(f(lambda x: x[1] == "save_book_items"))}
