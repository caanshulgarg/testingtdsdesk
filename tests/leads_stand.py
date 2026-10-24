"""leads_stand.py - a stand-in for FinCom's cloud holding a book shaped like the staging copy of Leads Insurance
(cmvclkrfeoj3h1; sizes read from staging on 24-Oct-2026 with SELECT count(*) only, names and amounts made up):
4,414 entries on 560 days (43 payroll entries), 749 ledgers, 2,806 items of TDS/GST work (ledInfo 776, under 776,
map 374, allocLog 270, gstins 157, alloc 148, pans 73, 16 challans, an audit of 148 KB), and a second, small client.
Used by run_books_speed.py. Every request is held as on an office line (RTT, then the body at the line's speed)."""
import json, gzip, asyncio, time, re, datetime, random
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
def vxml(v):
    ent = "".join("<ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><AMOUNT>%.2f</AMOUNT></ALLLEDGERENTRIES.LIST>"
                  % (esc(l), "Yes" if a < 0 else "No", a) for l, a in v["lines"])
    return ('<TALLYMESSAGE><VOUCHER VCHTYPE="%s" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><ALTERID>%d</ALTERID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME>'
            "<VOUCHERNUMBER>%s</VOUCHERNUMBER><PARTYLEDGERNAME>%s</PARTYLEDGERNAME><NARRATION>zz narration of the entry %s</NARRATION><ISCANCELLED>No</ISCANCELLED><ISOPTIONAL>No</ISOPTIONAL>%s</VOUCHER></TALLYMESSAGE>"
            % (esc(v["type"]), v["day"], v["guid"], v["alt"], esc(v["type"]), v["no"], esc(v["party"]), v["no"], ent))
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
T = {"tally_ledgers": [dict(l, book_id=BOOK, pan=None, gstin=None, tds_nature=None, tds_special_rate=None, tds_ldc=None, merged_into=None, deleted_at=None,
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

async def hold(sent, got):
    await asyncio.sleep(LINE["rtt"] + sent / LINE["up"] + got / LINE["down"])

async def route(r):
    u = urlparse(r.request.url); path = u.path; q = parse_qs(u.query); body = r.request.post_data or ""
    async def j(o, name=None, detail=""):
        b = json.dumps(o); await hold(len(body), len(b))
        LOG.append((time.time(), name or path.split("/")[-1], detail, len(b), r.request.method))
        return await r.fulfill(status=200, content_type="application/json", body=b)
    if path.endswith("/rpc/tally_status"):
        cid = (json.loads(body or "{}") or {}).get("p_client")
        if cid != CID: return await j([])
        return await j([dict({"book": BOOK, "company": "ZZ LEADS-LIKE BROKERS PVT LTD", "from": "2025-04-01", "openAsOn": "2025-03-31", "state": {"phase": "live"},
                              "days": len(DAYS), "entries": len(VOUCHERS), "to": iso(DAYS[-1])}, **STATUS_AT)])
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
            "items_from0": len(f(lambda x: x[1] == "client_book_items" and x[2].startswith("FROM0"))),
            "items_calls": len(f(lambda x: x[1] == "client_book_items")),
            "heads_kb": sum(x[3] for x in f(lambda x: x[1] == "tally_vouchers")) // 1024,
            "ledgers_full": len(f(lambda x: x[1] == "tally_ledgers" and "parent" in x[2])),
            "save": len(f(lambda x: x[1] == "save_book_items"))}
