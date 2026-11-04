"""tally_shapes.py - a made-up firm in the shapes of the staging firm on 04-Nov-2026, for the Tally page tests that sign in
to a stand-in of FinCom's cloud (PostgREST, auth, the Tally page's functions) and find made-up FinCom Bridges on
127.0.0.1. Every name, id, computer and Windows user here is made up; only the shapes and the sizes are staging's:
  12 clients (2 removed), 20 Tally companies (7 linked), 5,272 ledgers (one company 2,455), 8 books (2 with a first day),
  8 computers (5 bridges 2.4.7 to 2.5.3 on one shared server, each Windows login its own port 9100-9105; 3 old keys),
  684 lines from Tally (164 held on two books), the member's bridge link, and the answers of tally_fetch_summary,
  tally_check_ask_status, tally_held_status and tally_openings_decide as staging gave them (a book 299 ledgers' opening
  balances held, one that does not balance, the day checks queued).
FakeCloud(fx).route is a Playwright route handler for https://<project>.supabase.co/**; bridges(scene) a handler for
http://127.0.0.1:*/** (scenes: own253, none, ownhang, old, allhang)."""
import json, random, uuid, datetime, urllib.parse, collections, hmac, hashlib

FIRM = "f1a00000-0000-4000-8000-000000000001"
UID = "a1b00000-0000-4000-8000-000000000001"
PC = "PC-SHARED"
USERS = ["userone", "usertwo", "userthree", "userfour", "userfive"]   # the shared server's Windows logins (made up)


def make(seed=11):
    R = random.Random(seed)
    now = datetime.datetime.utcnow()
    iso = lambda dt: dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    ago = lambda m: iso(now - datetime.timedelta(minutes=m))
    uid = lambda: str(uuid.UUID(int=R.getrandbits(128)))
    dev_ids = [uid() for _ in range(8)]
    names = ["ALDER TRADING PRIVATE LIMITED", "BIRCH MARKETING SOLUTIONS PVT LTD", "CEDAR INSURANCE BROKERS PRIVATE LIMITED", "DOGWOOD CONSULTING PRIVATE LIMITED 01 Apr 2018",
             "ELM DESIGNS PRIVATE LIMITED", "FIR ADVISORS LLP 2024-25", "GINKGO ADVISORY SERVICES PRIVATE LIMITED", "BIRCH MARKETING SOLUTIONS", "HAZEL TRADERS", "IRONWOOD TRADERS",
             "JUNIPER BRAND CONNECT PRIVATE LIMITED", "KAPOK EVENTS"]
    cids = ["c%09d" % (100000 + i * 7919) for i in range(12)]
    gone = {8, 9}
    clients = [{"id": cids[i], "firm_id": FIRM, "name": n, "gstin": "", "pan": "", "tally_name": n, "deleted": i in gone, "status": "active", "updated_at": ago(3000),
                "data": {"id": cids[i], "name": n, "gstin": "", "pan": "", "tallyName": n, "createdAt": ago(40000), "stats": {}, "choices": {}, "billwise": True, "roundOff": "Round Off",
                         "tdsLedgers": {}, "voucherType": {}, "expenseLedgers": {}, "keys": {}, "hashes": {}, "gst": {}, "gstPin": {}}} for i, n in enumerate(names)]
    C = lambda i: cids[i]
    # (company, client index or None, computer index, minutes since seen, ledgers)
    CO = [("Dogwood Consulting Private Limited 01 Apr 2018", 3, 1, 3, 2455), ("Birch Marketing Solutions Pvt Ltd", 7, 4, 5770, 974),
          ("Birch Marketing Solutions Pvt Ltd 2025", 1, 2, 730, 865), ("CEDAR INSURANCE BROKERS PRIVATE LIMITED", 2, 1, 3, 440),
          ("GINKGO ADVISORY SERVICES PRIVATE LIMITED - (from 1-Apr-24)", 6, 1, 3, 360), ("LARCH STRATEGIES PRIVATE LIMITED", None, 4, 5770, 160),
          ("ELM DESIGNS PRIVATE LIMITED - (from 1-Apr-25)", 4, 0, 1100, 18), ("JUNIPER BRAND CONNECT PRIVATE LIMITED\r\n\r\n", 10, 3, 880, 0),
          ("JUNIPER INSURANCE", None, 4, 5770, 0), ("MAPLEPAY SOLUTION PRIVATE LIMITED", None, 0, 1, 0), ("MAPLEMADHU TECHNOLOGY PRIVATE LIMITED", None, 0, 1, 0),
          ("NUTMEG SOLUTIONS PRIVATE LIMITED", None, 0, 1, 0), ("Nutmeg Solutions Pvt Ltd", None, 0, 1, 0), ("Oak Services", None, 2, 730, 0), ("PALM DWIVEDI", None, 4, 8000, 0),
          ("QUINCE SHEKHAR & COMPANY", None, 4, 5770, 0), ("ROWAN TEXCOAT SOLUTIONS", None, 4, 5770, 0), ("SPRUCE EVENTS PRIVATE LIMITED", None, 4, 5770, 0),
          ("TEAK LAUNDRY RETAIL", None, 1, 5000, 0), ("Umbrella Enterprises", None, 1, 3, 0)]
    books, companies, ledgers, links = {}, [], [], []
    bk = lambda n: books.setdefault(n, uid())
    WORDS = "SUNDRY CREDITORS DEBTORS BANK RENT SALARY TDS GST CGST SGST IGST INPUT OUTPUT PAYABLE RECEIVABLE TRADERS ENTERPRISES SERVICES SOLUTIONS AGENCY CONSULTANTS MOTORS STEEL TEXTILES".split()
    PAR = ["Sundry Creditors", "Sundry Debtors", "Bank Accounts", "Duties & Taxes", "Indirect Expenses", "Direct Expenses", "Sales Accounts", "Purchase Accounts", "Current Liabilities", "Fixed Assets"]
    for name, ci, d, m, nl in CO:
        b = bk(name); cid = C(ci) if ci is not None else None
        companies.append({"book_id": b, "company": name, "client_id": cid, "device_id": dev_ids[d], "firm_id": FIRM, "gstin": "", "first_seen": ago(20000), "last_seen": ago(m),
                          "linked_at": ago(9000) if cid else None, "linked_by": UID if cid else None})
        for i in range(nl):
            ledgers.append({"book_id": b, "firm_id": FIRM, "name": " ".join(R.choice(WORDS) for _ in range(R.randint(2, 3))) + " %d" % i, "parent": R.choice(PAR), "open": 0,
                            "gstin": None, "merged_into": None, "deleted_at": None, "renamed_at": None, "state": "live", "seen_at": ago(600)})
        if cid or nl:
            links.append({"book_id": b, "client_id": cid, "firm_id": FIRM, "company_name": name, "state": "linked" if cid else "unlinked", "device_id": dev_ids[d], "computer": PC,
                          "linked_at": ago(9000), "linked_by": UID, "how": "picked", "posting_allowed": True, "updated_at": ago(9000), "version": 1})
    FROM = {C(2): "2025-04-01", C(7): "2025-04-02"}
    tb = [{"book_id": bk(n), "client_id": (C(ci) if ci is not None else ""), "company": n, "firm_id": FIRM, "from_date": FROM.get(C(ci)) if ci is not None else None, "open_as_on": "2026-03-31",
           "source": "tally", "state": {"to": "20261031", "from": "20260401", "phase": "live"} if nl else {}, "days_at": ago(4000) if nl else None, "ledgers_at": ago(4000) if nl else None, "state_at": ago(4000)}
          for n, ci, d, m, nl in CO if ci is not None or nl][:8]
    bookOf = {b["client_id"]: b for b in tb}
    # 684 lines from Tally, 164 of them held on two books (staging's counts)
    lines, k = [], 0
    for ci, st, n in [(2, "duplicate", 43), (1, "replaced", 8), (2, "held", 60), (1, "held", 19), (2, "applied", 1), (1, "duplicate", 4), (6, "held", 104), (1, "applied", 445)]:
        name = [c for c in CO if c[1] == ci][0][0]
        for i in range(n):
            k += 1
            lines.append({"id": k, "firm_id": FIRM, "client_id": C(ci), "book_id": bk(name), "device_id": dev_ids[1], "pc": PC, "company": name, "line_id": "L%d" % k, "event": "created",
                          "object_guid": "g-%d" % k, "alter_id": 900 + k, "vch_type": R.choice(["Sales", "Purchase", "Payment", "Receipt", "Journal"]), "vch_no": str(k), "vch_date": "2026-10-%02d" % (1 + k % 28),
                          "saved_at": ago(600 + k), "received_at": ago(600 + k), "applied_at": ago(590 + k) if st == "applied" else None, "state": st,
                          "held_why": "Tally did not give this entry when asked again; upload that day's Day Book to settle it" if st == "held" else None,
                          "ledgers": [{"ledger": R.choice(WORDS) + " %d" % j, "amount": 100.0 * j} for j in range(3)], "body": None, "tally_user": "", "save_ms": 30})
    # the computers: one shared server, a bridge a Windows login, each its own port; the newest (2.5.3) has a company open
    # that no client has, and Tally of other logins on its ports
    OPENP = [{"n": 1, "ok": True, "port": 1318, "error": "", "reason": "open", "skipped": False}] + \
            [{"n": 0, "ok": False, "port": p, "error": "Tally of " + u, "reason": "another user", "skipped": True} for p, u in [(9000, "usersix"), (601, "userseven"), (1950, "usereight"), (2710, "usernine")]] + \
            [{"n": 0, "ok": False, "port": p, "error": "Tally is not open (nothing listens on this port)", "owner": "unknown", "reason": "closed", "skipped": False} for p in (9114, 9249, 7845)]
    def dev(i, user, ver, port, m, open_, ports, cos, extra=None):
        at = ago(m)
        beat = {"at": at, "open": open_, "every": 30, "ports": ports, "tally": bool(open_), "events": True, "paused": False, "dailyAt": "19:00", "version": ver, "companies": [{"name": c, "open": c in open_, "phase": "live", "waiting": 0, "at": at} for c in cos],
                "tallyPort": ports[0]["port"] if open_ else 0, "bridgePort": port, "tallyState": "open" if open_ else "closed", "readStopped": None, "windowsUser": PC + "\\" + user, "busySince": "", "reqs": {"n": 9}}
        beat.update(extra or {})
        bid = "go-" + dev_ids[i][:12]
        br = {"at": at, "mode": "main", "open": open_, "port": port, "user": PC + "\\" + user, "tally": bool(open_), "version": ver, "computer": PC, "tallyState": beat["tallyState"]}
        return {"id": dev_ids[i], "firm_id": FIRM, "name": PC + " · " + user, "version": ver, "last_seen": at, "revoked": False, "main_bridge": bid, "created_at": ago(40000), "created_by": UID,
                "info": {"beat": beat, "user": PC + "\\" + user, "bridges": {bid: br}, "computer": PC, "history": []}, "post_only": [], "post_batch_bills": 10, "post_batch_bank": 50, "trial_tools": False, "recorder_source": "addon", "_age": m}
    skipped = lambda ps: [{"n": 0, "ok": False, "port": p, "error": "Tally of Windows session 0", "skipped": True} for p in ps]
    devices = [dev(0, USERS[0], "2.5.3", 9100, 0.4, ["MAPLEPAY SOLUTION PRIVATE LIMITED"], OPENP, ["MAPLEPAY SOLUTION PRIVATE LIMITED", "NUTMEG SOLUTIONS PRIVATE LIMITED"],
                   {"tallyWhy": "another user", "tallyConnectSay": "FinCom switched on Tally's connection. Close and reopen Tally once."}),
               dev(1, USERS[1], "2.5.1", 9101, 0.5, [], skipped([601, 1318, 1554, 1950, 2710, 9000, 9035, 9070, 9898]), ["Umbrella Enterprises", "CEDAR INSURANCE BROKERS PRIVATE LIMITED"]),
               dev(2, USERS[2], "2.4.7", 9102, 730, ["Birch Marketing Solutions Pvt Ltd 2025"], [{"n": 1, "ok": True, "port": 9035, "error": "", "skipped": False}], ["Birch Marketing Solutions Pvt Ltd 2025"]),
               dev(3, USERS[3], "2.5.2", 9103, 880, ["JUNIPER BRAND CONNECT PRIVATE LIMITED\r\n\r\n"], skipped([601, 1554]) + [{"n": 1, "ok": True, "port": 9898, "error": "", "skipped": False}], ["JUNIPER BRAND CONNECT PRIVATE LIMITED\r\n\r\n"]),
               dev(4, USERS[4], "2.5.1", 9105, 6000, ["ROWAN TEXCOAT SOLUTIONS"], [{"n": 1, "ok": True, "port": 9070, "error": "", "skipped": False}], ["ROWAN TEXCOAT SOLUTIONS"])] + \
              [{"id": dev_ids[i], "firm_id": FIRM, "name": PC + " · old key", "version": None, "last_seen": None, "revoked": i < 7, "main_bridge": None, "info": {}, "created_at": ago(40000)} for i in (5, 6, 7)]
    # the Tally page's functions, as staging answered them (numbers kept, names the fixture's)
    run = lambda: {"at": None, "day": None, "why": None, "state": "going", "words": None, "chosenAt": ago(200)}
    chk = lambda n: {"run": run(), "same": 0, "fixed": 0, "total": n, "upload": 0, "waiting": n}
    today = {"last": None, "added": 0, "older": 0, "changed": 0, "deleted": 0, "corrected": 0}
    summary = [{"book": b["book_id"], "client": b["client_id"], "company": b["company"], "from": b["from_date"], "today": dict(today), "check": chk(35 if b["client_id"] == C(1) else 218) if b["client_id"] else None,
                "pull": {"x": 646, "y": 646, "fy": "20260401", "to": "20270331", "done": False, "from": "20260401", "part": "year", "state": "going", "etaMin": None, "upload": [], "counting": True, "partDays": 218, "yearDays": 218, "countedDays": 214, "yearVouchers": 646} if b["client_id"] == C(2) else None,
                "devices": [{"id": dev_ids[1], "fetchOn": False}]} for b in tb]
    ask = lambda ci, days, fr: {"at": ago(220), "to": "20261104", "run": {"at": None, "why": None, "state": "going", "words": None}, "book": bookOf[C(ci)]["book_id"], "days": days, "from": fr, "same": 0, "added": 0,
                                 "after": False, "fixed": 0, "state": "queued", "total": days, "client": C(ci), "etaMin": None, "paused": False, "upload": 0, "changed": 0, "checked": 0, "company": bookOf[C(ci)]["company"], "deleted": 0, "waiting": days, "uploadDays": []}
    days = lambda a, n: ["2026%04d" % x for x in range(a, a + n)]
    nochk = {"why": None, "done": 0, "state": "none", "total": 0, "words": None, "etaMin": None, "upload": 0, "waiting": 0}
    held = [{"to": "20261025", "book": bookOf[C(6)]["book_id"], "days": ["202608%02d" % d for d in range(4, 30)] + ["202610%02d" % d for d in range(1, 14)], "from": "20260804", "held": 104, "check": dict(nochk), "client": C(6), "company": bookOf[C(6)]["company"], "deletes": 104, "entries": 0, "fetchOn": False, "renumber": []},
            {"to": "20261101", "book": bookOf[C(2)]["book_id"], "days": ["202610%02d" % d for d in range(1, 21)], "from": "20261001", "held": 60, "check": dict(nochk), "client": C(2), "company": bookOf[C(2)]["company"], "deletes": 60, "entries": 0, "fetchOn": False,
             "renumber": [{"n": 19, "at": ago(7000), "from": "20261009", "more": False, "checked": False}]}]
    z = lambda b, **kw: dict({"n": 0, "pl": 0, "book": b["book_id"], "from": b["from_date"], "held": None, "ties": True, "dated": False, "stage": None, "total": 0, "heldAt": None, "source": None, "stored": 0.0, "missing": 0, "nonzero": 0, "candidate": 0.0, "openingsAt": None}, **kw)
    opens = []
    for b in tb:
        if b["client_id"] == C(1): opens.append(z(b, n=299, held=7, dated=None, stage="held", total=342025445.31, heldAt=ago(5000), source="the bridge's ledger read", candidate=11094478.25, openingsAt="2026-04-01"))
        elif b["client_id"] == C(7): opens.append(z(b, ties=False, stored=19192374.38, nonzero=475, candidate=19192374.38))
        else: opens.append(z(b, nonzero=R.choice([0, 26, 32, 65, 119])))
    rpc = {"tally_fetch_summary": {"ok": True, "books": summary}, "tally_check_ask_status": {"ok": True, "asks": [ask(1, 35, "20261001"), ask(7, 218, "20260401"), ask(3, 218, "20260401"), ask(10, 218, "20260401")], "books": []},
           "tally_held_status": {"ok": True, "books": held}, "tally_openings_decide": {"ok": True, "books": opens}}
    # the bank statements FinCom holds (records), as staging's per client (rows a statement), made-up lines: every drawing's
    # top bar (the alerts) goes through them
    records = []
    PARTIES = ["PAYMENTS SERVICES LIMITED PA", "AMB CHARGES", "IGST ON CHARGE", "SALARY", "RENT", "GST PAYMENT", "TDS PAYMENT", "VENDOR ONE", "VENDOR TWO", "CUSTOMER ALPHA"]
    for ci, stmts in {1: [87, 90, 56, 54, 89, 88, 48], 10: [316, 316], 3: [37], 6: [15, 88, 88], 2: [37], 7: [350]}.items():
        cid = C(ci); acct = "ba" + cid[-6:]; hist, keys = {}, {}
        clients[ci]["data"]["bankAccounts"] = [{"id": acct, "bank": "MADEUP BANK", "acct": "XXXX1234", "last4": "1234", "ledger": ""}]
        for si, nrows in enumerate(stmts):
            sid = "st" + cid[-6:] + "%04d" % si; rows = []
            for i in range(nrows):
                pty = R.choice(PARTIES); d = "2026-%02d-%02d" % (4 + (i % 7), 1 + i % 28); dr = round(R.uniform(1, 90000), 2) if i % 3 else 0; cr = 0 if dr else round(R.uniform(1, 90000), 2)
                st = R.choice(["sent", "sent", "sent", "ready", "attention", "suggested"])
                rows.append({"fp": "%s|%s|%s|%s" % (acct, d, dr, cr), "id": "r%s%04d%04d" % (cid[-4:], si, i), "dec": {"key": "name:" + pty.lower().replace(" ", ""), "mode": "NEFT", "name": pty},
                             "date": d, "narr": "NEFT/%d/%s/BANK" % (100000 + i, pty), "debit": dr, "credit": cr, "level": "auto", "state": st, "vtype": "Payment" if dr else "Receipt",
                             "ledger": R.choice(WORDS) + " %d" % i, "source": "you", "balance": 100000.0 - i, "sentAt": ago(3000) if st == "sent" else "", "postedVia": "cloud", "postVerified": st == "sent",
                             "tally": {"at": ago(3000), "by": "Support", "job": uid(), "company": "Made-up Co", "vchDate": d.replace("-", ""), "vchType": "Receipt"} if st == "sent" else None})
                hk = "%s|%s|%s|%s|0|%s" % (acct, d, dr or cr, i, pty.lower())
                if len(hist) < 512: hist[hk] = {"a": dr or cr, "d": "out" if dr else "in", "k": "name:" + pty.lower(), "n": pty, "s": st, "dt": d, "vt": "Payment"}; keys[hk] = sid
            for k0 in range(0, nrows, 300):
                records.append({"firm_id": FIRM, "client_id": cid, "kind": "bank_rows", "id": cid + ":" + sid + (":%d" % (k0 // 300) if k0 else ""), "data": {"rows": rows[k0:k0 + 300]}, "deleted": False, "updated_at": ago(3000)})
            records.append({"firm_id": FIRM, "client_id": cid, "kind": "bank_stmt", "id": cid + ":" + sid, "data": {"n": nrows, "id": sid, "to": "2026-10-31", "acct": "XXXX1234", "bank": "MADEUP BANK", "from": "2026-04-01",
                            "acctId": acct, "method": "pdf", "source": "you", "fileName": "statement.pdf", "uploadedAt": ago(5000), "summaryOk": True}, "deleted": False, "updated_at": ago(3000)})
        records.append({"firm_id": FIRM, "client_id": cid, "kind": "bank_meta", "id": cid, "data": {"hist": {"rows": hist}, "keys": keys, "rules": [], "newLed": []}, "deleted": False, "updated_at": ago(3000)})
    return {"firm": FIRM, "uid": UID, "members": [{"user_id": UID, "firm_id": FIRM, "name": "Support", "email": "support@example.com", "role": "owner", "active": True}],
            "firms": [{"id": FIRM, "name": "Made-up Firm", "data": {}}], "clients": clients, "tally_companies": companies, "tally_ledgers": ledgers, "tally_links": links, "tally_books": tb,
            "tally_recorder_lines": lines, "records": records, "tally_devices": devices, "tally_member_bridges": [{"firm_id": FIRM, "user_id": UID, "device_id": dev_ids[4], "bridge_id": "go-" + dev_ids[4][:12], "set_at": ago(9000), "set_by": UID}],
            "tally_bridge_releases": [{"firm_id": FIRM, "version": "2.5.3", "approved_at": ago(1500), "pilot_started_at": ago(2000), "held_at": None, "withdrawn_at": None}], "_rpc": rpc, "_dev": dev_ids}


class FakeCloud:
    """PostgREST, auth and the Tally page's functions over the made-up firm, for Playwright's route (delay: seconds each answer waits)"""
    def __init__(self, fx, slow=None):
        self.fx = fx; self.log = collections.Counter(); self.slow = slow or {}
    def rows(self, table):
        if table == "tally_devices":
            import copy
            out = []
            for d in self.fx["tally_devices"]:
                d = copy.deepcopy(d); age = d.pop("_age", None)
                if age is not None:
                    at = (datetime.datetime.utcnow() - datetime.timedelta(minutes=age)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
                    d["last_seen"] = at; d["info"]["beat"]["at"] = at
                    for b in d["info"]["bridges"].values(): b["at"] = at
                out.append(d)
            return out
        return self.fx.get(table)
    @staticmethod
    def match(r, col, op):
        v = r.get(col); neg = op.startswith("not.")
        if neg: op = op[4:]
        if op.startswith("eq."): ok = str(v if not isinstance(v, bool) else str(v).lower()) == urllib.parse.unquote(op[3:])
        elif op.startswith("neq."): ok = str(v) != urllib.parse.unquote(op[4:])
        elif op.startswith("is."): w = op[3:]; ok = (v is None) if w == "null" else (v is True) if w == "true" else (v is False) if w == "false" else True
        elif op.startswith("in.("): ok = str(v) in [x.strip('"') for x in urllib.parse.unquote(op[4:-1]).split(",")]
        elif op.startswith(("gte.", "lte.", "gt.", "lt.")):
            o, w = op.split(".", 1); w = urllib.parse.unquote(w)
            ok = False if v is None else {"gte": str(v) >= w, "lte": str(v) <= w, "gt": str(v) > w, "lt": str(v) < w}[o]
        else: ok = True
        return (not ok) if neg else ok
    def handle(self, method, url, body):
        u = urllib.parse.urlparse(url); path = u.path
        if "/auth/v1/" in path:
            return 200, {"access_token": "made-up-token", "refresh_token": "made-up-refresh", "expires_in": 360000, "user": {"id": self.fx["uid"], "email": "support@example.com"}}, {}
        if "/functions/v1/" in path or "/storage/" in path: return 200, {"ok": True}, {}
        if "/rest/v1/rpc/" in path:
            fn = path.split("/rpc/")[1]; self.log["rpc/" + fn] += 1
            try: a = json.loads(body or "{}")
            except Exception: a = {}
            if fn in self.fx["_rpc"]:
                if fn == "tally_openings_decide" and a.get("p_action") != "status": return 200, {"ok": True, "book": {"rows": [], "n": 0}}, {}
                return 200, self.fx["_rpc"][fn], {}
            if fn == "tally_status":
                out = []
                for b in self.fx["tally_books"]:
                    if b["client_id"] == a.get("p_client"):
                        out.append({"book": b["book_id"], "company": b["company"], "from": b["from_date"], "openAsOn": b["open_as_on"], "ledgersAt": b["ledgers_at"], "daysAt": b["days_at"],
                                    "days": 190 if b["from_date"] else 0, "entries": 4000 if b["from_date"] else 0, "to": "2026-10-31" if b["from_date"] else None, "state": b["state"]})
                return 200, out, {}
            return 200, [], {}
        if "/rest/v1/" not in path: return 404, {}, {}
        table = path.split("/rest/v1/")[1]; self.log[table] += 1
        if method in ("POST", "PATCH", "DELETE"): return (201 if method == "POST" else 200), [], {}
        rows = self.rows(table)
        if rows is None: return 200, [], {"Content-Range": "*/0"}
        sel, order, limit, offset, filt = None, None, None, 0, []
        for k, v in urllib.parse.parse_qsl(u.query, keep_blank_values=True):
            if k == "select": sel = v
            elif k == "order": order = v
            elif k == "limit": limit = int(v)
            elif k == "offset": offset = int(v)
            elif k in ("or", "and"): pass
            else: filt.append((k, v))
        out = [r for r in rows if all(self.match(r, k, v) for k, v in filt)]; total = len(out)
        if order: col = order.split(".")[0]; out = sorted(out, key=lambda r: str(r.get(col) or ""), reverse=".desc" in order)
        out = out[offset: offset + limit] if limit is not None else out[offset:]
        if sel and sel != "*" and "(" not in sel:
            cols = [c.split(":")[0].strip() for c in sel.split(",")]; out = [{c: r.get(c) for c in cols} for r in out]
        return 200, out, {"Content-Range": "%d-%d/%d" % (offset, offset + max(0, len(out) - 1), total)}
    def route(self, route):
        req = route.request
        try: st, j, hd = self.handle(req.method, req.url, req.post_data)
        except Exception as e: st, j, hd = 500, {"message": str(e)}, {}
        h = {"Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range", "Access-Control-Allow-Headers": "*"}; h.update(hd)
        if req.method == "OPTIONS": return route.fulfill(status=204, headers=h)
        route.fulfill(status=st, content_type="application/json", body=json.dumps(j), headers=h)


# the session the test build keeps for a signed-in member (tdsdesk-test:), set before the app starts
def signin_script(fx, extra=""):
    return """(() => { if (!localStorage.getItem('tdsdesk-test:cloudsess')) { localStorage.setItem('tdsdesk-test:cloudsess', JSON.stringify({access_token: 'made-up-token', refresh_token: 'made-up-refresh', at: Date.now(), expires_in: 360000, email: 'support@example.com', user_id: '%s'})); %s } })()""" % (fx["uid"], extra)


# made-up FinCom Bridges on 127.0.0.1 as one Windows login of the shared server sees them: each port's kind
#   own253 this login's 2.5.3 (sameSession true), others' 2.5.3 (false) and older ones; none: only others' bridges
#   ownhang this login's port accepts and never answers; old: only bridges older than 2.5.3; allhang: every port hangs
SCENES = {
    "own253": {9100: ("own", "2.5.3", USERS[0], True), 9101: ("other", "2.5.1", USERS[1], None), 9103: ("other", "2.5.2", USERS[3], None), 9102: ("hang",), 9105: ("hang",)},
    "none": {9100: ("other", "2.5.3", USERS[0], False), 9101: ("other", "2.5.1", USERS[1], None), 9103: ("other", "2.5.2", USERS[3], None)},
    "ownhang": {9100: ("hang",), 9101: ("other", "2.5.1", USERS[1], None), 9103: ("other", "2.5.2", USERS[3], None)},
    "old": {9100: ("other", "2.5.1", USERS[0], None), 9101: ("own", "2.5.1", USERS[1], None), 9103: ("other", "2.5.2", USERS[3], None)},
    "allhang": {p: ("hang",) for p in range(9100, 9111)},
    "nothing": {},
}


HOLD = {"port": 0}
def holder():
    """one local port that accepts and never answers (a bridge's port that hangs); started once"""
    import socket, threading
    if HOLD["port"]: return HOLD["port"]
    s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1", 0)); s.listen(512); held = []
    def run():
        while True:
            c, _ = s.accept(); held.append(c)
    threading.Thread(target=run, daemon=True).start(); HOLD["port"] = s.getsockname()[1]
    return HOLD["port"]


def bridges(scene, log=None, key="made-up-key"):
    P = SCENES[scene]; hp = holder()
    def handler(route):
        req = route.request; u = urllib.parse.urlparse(req.url); port = u.port or 80
        if log is not None: log.append((port, u.path))
        kind = P.get(port)
        if not kind: return route.abort("connectionrefused")
        if kind[0] == "hang": return route.continue_(url=req.url.replace("127.0.0.1:%d" % port, "127.0.0.1:%d" % hp))   # accepted, never answered
        _, ver, user, same = kind
        h = {"Access-Control-Allow-Origin": req.headers.get("origin") or "*", "Access-Control-Allow-Private-Network": "true", "Access-Control-Allow-Headers": "*"}
        if req.method == "OPTIONS": return route.fulfill(status=204, headers=h)
        mine = kind[0] == "own"
        if u.path == "/ping":
            j = {"ok": True, "bridge": "FinCom Tally Bridge", "version": ver, "impl": "go", "yours": mine}
            if ver >= "2.5.3": j.update({"windowsUser": PC + "\\" + user, "sameSession": same, "bridgePort": port, "tallyPorts": [1318] if mine else []})
            if mine: j.update({"bridgeId": "go-%dabcd" % port, "port": port})
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(j), headers=h)
        if not mine: return route.fulfill(status=403, content_type="application/json", body=json.dumps({"ok": False, "notYours": True}), headers=h)
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "version": ver, "sessions": [], "computer": PC, "user": PC + "\\" + user}), headers=h)
    return handler
