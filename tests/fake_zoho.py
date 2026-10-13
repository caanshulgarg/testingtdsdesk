"""A stand-in for Zoho (accounts.zoho.in and www.zohoapis.in/books/v3) on a local port, answering the way Zoho's published API
does, from the test organisation in tests/fixtures/zoho/org (make_org.py), for running the zoho-books function under Deno in
the tests (as fake_tally.py stands in for TallyPrime). In memory; every request is kept (LOG).
  Accounts: POST /oauth/v2/token (authorization_code, refresh_token), POST /oauth/v2/token/revoke
  Books:    GET  /books/v3/organizations
            GET  /books/v3/<list>?organization_id=&page=&per_page=&sort_column=last_modified_time&sort_order=D[&reference_number=]
            GET  /books/v3/<list>/<id>
            GET  /books/v3/chartofaccounts, settings/taxes[?is_tds_request=true], settings/openingbalances
            POST /books/v3/bills | expenses | journals | contacts   (created, read back by later syncs)
            anything else (PUT, DELETE, another POST): 405, kept in LOG (the tests require none)
Hooks for the tests: CODES (authorization codes that work), EXPIRE_ALL() (every access token refused from now: 401),
REFRESH_OK (False: a refresh is refused, invalid_code), FAIL_429 = {"n": k, "daily": bool, "retry": seconds} (the next k
calls answered 429), HIDE (ids a list leaves out: a deletion), touch(kind, id, **changes) (a document changed now),
remove(kind, id) (deleted in Zoho)."""
import json, os, threading, http.server, time, re, copy, secrets, itertools
from urllib.parse import urlparse, parse_qs
HERE = os.path.dirname(os.path.abspath(__file__))
ORGDIR = os.path.join(HERE, "fixtures", "zoho", "org")
PORT = 30790
CLIENT_ID, CLIENT_SECRET = "stand-in-client-id", "stand-in-client-secret"     # the stand-in's own; never a real Zoho client
CODES = {"code-good"}
LOG = []
ACCESS, REFRESH = {}, {}            # token -> {until}; refresh token -> {revoked}
REFRESH_OK = [True]
FAIL_429 = {"n": 0, "daily": False, "retry": 1}
HIDE = set()
EXPIRES_IN = [3600]
STORE = {}
ids = itertools.count(470000000090001)
LISTS = {"invoices": ("invoices", "invoice", "invoice_id"), "creditnotes": ("creditnotes", "creditnote", "creditnote_id"), "bills": ("bills", "bill", "bill_id"),
         "vendorcredits": ("vendor_credits", "vendor_credit", "vendor_credit_id"), "customerpayments": ("customerpayments", "payment", "payment_id"),
         "vendorpayments": ("vendorpayments", "vendorpayment", "payment_id"), "expenses": ("expenses", "expense", "expense_id"), "journals": ("journals", "journal", "journal_id"),
         "banktransactions": ("banktransactions", "banktransaction", "transaction_id"), "contacts": ("contacts", "contact", "contact_id"),
         "chartofaccounts": ("chartofaccounts", "account", "account_id")}
def load():
    STORE.clear(); HIDE.clear(); LOG.clear()
    for k in list(LISTS) + ["organizations", "taxes", "tdstaxes", "openingbalances"]:
        STORE[k] = json.load(open(os.path.join(ORGDIR, k + ".json")))
    STORE["organizations"] = STORE["organizations"]
def org_id(): return STORE["organizations"][0]["organization_id"]
def now_mod(): return time.strftime("%Y-%m-%dT%H:%M:%S+0530", time.gmtime(time.time() + 5.5 * 3600))
def touch(kind, zid, **changes):
    _, _, idf = LISTS[kind]
    for d in STORE[kind]:
        if str(d[idf]) == str(zid): d.update(changes); d["last_modified_time"] = now_mod(); return d
    raise KeyError(zid)
def remove(kind, zid):
    _, _, idf = LISTS[kind]
    STORE[kind] = [d for d in STORE[kind] if str(d[idf]) != str(zid)]
def find(kind, **kv):
    return [d for d in STORE[kind] if all(str(d.get(k)) == str(v) for k, v in kv.items())]
def tok(): return "1000." + secrets.token_hex(16) + "." + secrets.token_hex(16)
def EXPIRE_ALL():
    for t in ACCESS: ACCESS[t]["until"] = 0
SUMMARY = ("invoice_id", "invoice_number", "creditnote_id", "creditnote_number", "bill_id", "bill_number", "vendor_credit_id", "vendor_credit_number", "payment_id", "payment_number",
           "expense_id", "journal_id", "entry_number", "transaction_id", "transaction_type", "contact_id", "contact_name", "contact_type", "date", "journal_date", "status",
           "last_modified_time", "reference_number", "customer_name", "vendor_name", "total", "amount", "account_id", "account_name", "account_type", "is_active")

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj, headers=None):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b)))
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) if n else b""
        return raw
    def any(self, method):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        raw = self.body()
        entry = {"method": method, "path": u.path, "query": q, "at": time.time()}
        if raw and u.path.startswith("/books/"):
            try: entry["body"] = json.loads(raw)
            except ValueError: entry["body"] = raw.decode("utf-8", "replace")
        LOG.append(entry)
        # ---- accounts
        if u.path == "/oauth/v2/token" and method == "POST":
            f = {k: v[0] for k, v in parse_qs(raw.decode()).items()}; f.update(q)
            if f.get("client_id") != CLIENT_ID or f.get("client_secret") != CLIENT_SECRET: return self.send(200, {"error": "invalid_client"})
            if f.get("grant_type") == "authorization_code":
                if f.get("code") not in CODES: return self.send(200, {"error": "invalid_code"})
                CODES.discard(f["code"])
                a, r = tok(), tok(); ACCESS[a] = {"until": time.time() + EXPIRES_IN[0]}; REFRESH[r] = {"revoked": False}
                return self.send(200, {"access_token": a, "refresh_token": r, "api_domain": "https://www.zohoapis.in", "token_type": "Bearer", "expires_in": EXPIRES_IN[0], "scope": f.get("scope", "")})
            if f.get("grant_type") == "refresh_token":
                r = REFRESH.get(f.get("refresh_token"))
                if not r or r["revoked"] or not REFRESH_OK[0]: return self.send(200, {"error": "invalid_code"})
                a = tok(); ACCESS[a] = {"until": time.time() + EXPIRES_IN[0]}
                return self.send(200, {"access_token": a, "api_domain": "https://www.zohoapis.in", "token_type": "Bearer", "expires_in": EXPIRES_IN[0]})
            return self.send(200, {"error": "unsupported_grant_type"})
        if u.path == "/oauth/v2/token/revoke" and method == "POST":
            f = {k: v[0] for k, v in parse_qs(raw.decode()).items()}; f.update(q)
            t = f.get("token")
            if t in REFRESH: REFRESH[t]["revoked"] = True
            return self.send(200, {"status": "success"})
        # ---- books
        if not u.path.startswith("/books/v3/"): return self.send(404, {"code": 5, "message": "Invalid URL Passed"})
        auth = self.headers.get("Authorization") or ""
        t = auth[len("Zoho-oauthtoken "):] if auth.startswith("Zoho-oauthtoken ") else ""
        if not t or t not in ACCESS or ACCESS[t]["until"] < time.time(): return self.send(401, {"code": 57, "message": "You are not authorized to perform this operation"})
        p = u.path[len("/books/v3/"):].strip("/")
        if p == "organizations" and method == "GET": return self.send(200, {"code": 0, "message": "success", "organizations": STORE["organizations"]})
        if q.get("organization_id") != org_id(): return self.send(400, {"code": 6041, "message": "This user is not associated with the organization."})
        if FAIL_429["n"] > 0:
            FAIL_429["n"] -= 1
            if FAIL_429["daily"]: return self.send(429, {"code": 45, "message": "You have reached the maximum number of API calls per day for your organization."})
            return self.send(429, {"code": 44, "message": "You have made too many requests continuously. Please try again after some time."}, {"Retry-After": str(FAIL_429["retry"])})
        if method == "GET":
            if p == "settings/taxes":
                return self.send(200, {"code": 0, "message": "success", "taxes": STORE["tdstaxes"] if q.get("is_tds_request") == "true" else STORE["taxes"]})
            if p == "settings/openingbalances": return self.send(200, {"code": 0, "message": "success", "opening_balance": STORE["openingbalances"]["opening_balance"]})
            parts = p.split("/")
            if parts[0] in LISTS:
                lk, one, idf = LISTS[parts[0]]
                if len(parts) == 2:
                    d = next((x for x in STORE[parts[0]] if str(x[idf]) == parts[1]), None)
                    if not d: return self.send(404, {"code": 1002, "message": "The record does not exist."})
                    return self.send(200, {"code": 0, "message": "success", one: copy.deepcopy(d)})
                rows = [x for x in STORE[parts[0]] if str(x[idf]) not in HIDE]
                if q.get("reference_number") is not None: rows = [x for x in rows if str(x.get("reference_number") or "") == q["reference_number"]]
                if q.get("sort_column") == "last_modified_time": rows = sorted(rows, key=lambda x: x.get("last_modified_time") or "", reverse=q.get("sort_order", "A") == "D")
                page, per = int(q.get("page", 1)), int(q.get("per_page", 200))
                chunk = rows[(page - 1) * per: page * per]
                return self.send(200, {"code": 0, "message": "success", lk: [{k: v for k, v in x.items() if k in SUMMARY} for x in chunk],
                                       "page_context": {"page": page, "per_page": per, "has_more_page": page * per < len(rows)}})
            return self.send(404, {"code": 5, "message": "Invalid URL Passed"})
        if method == "POST" and p in ("bills", "expenses", "journals", "contacts"):
            try: b = json.loads(raw or b"{}")
            except ValueError: return self.send(400, {"code": 4, "message": "Invalid value passed for JSONString"})
            return self.create(p, b)
        return self.send(405, {"code": 37, "message": "The HTTP method " + method + " is not allowed for the requested resource"})
    def create(self, p, b):
        zid = str(next(ids)); m = now_mod()
        if p == "contacts":
            if not b.get("contact_name"): return self.send(400, {"code": 4, "message": "Contact name is required"})
            if find("contacts", contact_name=b["contact_name"]): return self.send(400, {"code": 3062, "message": "The contact \"%s\" already exists." % b["contact_name"]})
            d = dict(b, contact_id=zid, status="active", last_modified_time=m); STORE["contacts"].append(d)
            return self.send(201, {"code": 0, "message": "The contact has been added.", "contact": d})
        if p == "bills":
            v = find("contacts", contact_id=b.get("vendor_id"))
            if not v: return self.send(400, {"code": 4, "message": "Invalid value passed for vendor_id"})
            if find("bills", vendor_id=b.get("vendor_id"), bill_number=b.get("bill_number")): return self.send(400, {"code": 13011, "message": "This bill number has been already used for this vendor."})
            lines = [dict(li, line_item_id=str(next(ids)), item_total=float(li.get("rate", 0)) * float(li.get("quantity", 1)), account_name=next((a["account_name"] for a in STORE["chartofaccounts"] if a["account_id"] == li.get("account_id")), "")) for li in b.get("line_items") or []]
            sub = round(sum(x["item_total"] for x in lines), 2)
            taxes, tax = self.tax_of(lines)
            tds = 0
            if b.get("tds_tax_id"):
                t = next((x for x in STORE["tdstaxes"] if x["tax_id"] == b["tds_tax_id"]), None)
                if not t: return self.send(400, {"code": 4, "message": "Invalid value passed for tds_tax_id"})
                tds = round(sub * t["tax_percentage"] / 100, 2)
            total = round(sub + (0 if b.get("is_reverse_charge_applied") else tax) - tds + float(b.get("adjustment") or 0), 2)
            d = dict(b, bill_id=zid, status="open", vendor_name=v[0]["contact_name"], line_items=lines, taxes=taxes, sub_total=sub, tax_total=tax, tds_amount=tds, total=total, last_modified_time=m)
            STORE["bills"].append(d)
            return self.send(201, {"code": 0, "message": "The bill has been created.", "bill": d})
        if p == "expenses":
            if not b.get("paid_through_account_id"): return self.send(400, {"code": 4, "message": "Paid through account is required"})
            amt = float(b.get("amount") or sum(float(x.get("amount", 0)) for x in b.get("line_items") or []))
            t = next((x for x in STORE["taxes"] if x["tax_id"] == b.get("tax_id")), None)
            tax = round(amt * t["tax_percentage"] / 100, 2) if t else 0
            d = dict(b, expense_id=zid, status="nonbillable", sub_total=amt, tax_amount=tax, total=round(amt + tax, 2), last_modified_time=m,
                     account_name=next((a["account_name"] for a in STORE["chartofaccounts"] if a["account_id"] == b.get("account_id")), ""))
            STORE["expenses"].append(d)
            return self.send(201, {"code": 0, "message": "The expense has been recorded.", "expense": d})
        if p == "journals":
            dr = round(sum(float(x["amount"]) for x in b.get("line_items") or [] if x.get("debit_or_credit") == "debit"), 2)
            cr = round(sum(float(x["amount"]) for x in b.get("line_items") or [] if x.get("debit_or_credit") == "credit"), 2)
            if dr != cr or not dr: return self.send(400, {"code": 4, "message": "Debits and credits do not match."})
            d = dict(b, journal_id=zid, entry_number="JV-%d" % (len(STORE["journals"]) + 1), status="published", total=dr, last_modified_time=m)
            STORE["journals"].append(d)
            return self.send(201, {"code": 0, "message": "The journal entry has been created.", "journal": d})
    def tax_of(self, lines):
        tx = {}
        for li in lines:
            t = next((x for x in STORE["taxes"] if x["tax_id"] == li.get("tax_id")), None)
            if not t: continue
            kids = [next(y for y in STORE["taxes"] if y["tax_id"] == k["tax_id"]) for k in t.get("taxes", [])] or [t]
            for k in kids: tx[k["tax_id"]] = round(tx.get(k["tax_id"], 0) + li["item_total"] * k["tax_percentage"] / 100, 2)
        taxes = [{"tax_id": k, "tax_name": next(y["tax_name"] for y in STORE["taxes"] if y["tax_id"] == k), "tax_amount": v} for k, v in tx.items()]
        return taxes, round(sum(tx.values()), 2)
    def do_GET(self): self.any("GET")
    def do_POST(self): self.any("POST")
    def do_PUT(self): self.any("PUT")
    def do_DELETE(self): self.any("DELETE")
    def do_PATCH(self): self.any("PATCH")
def start(port=None):
    global PORT
    if port: PORT = port
    load()
    s = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s
