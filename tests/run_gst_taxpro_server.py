"""python3 run_gst_taxpro_server.py - the gst-taxpro function (stage 5, tax-accuracy) under Deno, against stand-ins for
Supabase (fake_supabase.py, with Vault's gsp_secret_get / gsp_secret_put) and for TaxPro's GST and e-invoice APIs:
TaxPro's keys read from Vault; the portal session kept in Vault with the access period; 2B, filed GSTR-1 and 3B fetched
and kept (a return not filed yet is "none", a later failure never takes away one fetched); the API version that answers
is used; the daily run (2B from the 14th, last three months' returns) and the reminder 3 days before the access period
ends; renewal failing ends the session; IRN made, a second request gives the same IRN, e-way bill by IRN, cancellation.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, shutil, socket, threading, subprocess, http.server, urllib.request
from urllib.parse import urlparse, parse_qs
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# ---------- a stand-in for TaxPro ----------
TP = {"calls": [], "refresh_fails": False, "irn_made": {}}
def per(n):  # MMYYYY n months back, India time
    t = time.gmtime(time.time() + 5.5 * 3600); y, m = t.tm_year, t.tm_mon - n
    while m < 1: m += 12; y -= 1
    return "%02d%d" % (m, y)
FILED = {per(1), per(2)}          # GSTR-1 and 3B filed for the last two months, not the third
ist_now = lambda: time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(time.time() + 5.5 * 3600))   # the IRP's AckDt, India time (an IRN is cancellable 24 hours)
class TPH(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def out(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def handle_any(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}; p = u.path
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n)) if n else None
        if "drop" in (q.get("username"), q.get("user_name"), self.headers.get("username")):   # a network failure: the connection cut, no answer
            TP["dropped"] = TP.get("dropped", 0) + 1; self.close_connection = True
            try: self.connection.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            return
        TP["calls"].append((p, q.get("action", ""), self.headers.get("aspid"), self.headers.get("password") or q.get("password")))
        if (self.headers.get("aspid") or q.get("aspid")) != "ASP-FROM-VAULT": return self.out(200, {"status_cd": "0", "error": {"message": "Invalid ASP", "error_cd": "AUTH4033"}, "Status": 0})
        if p == "/taxpayerapi/dec/v1.0/authenticate":
            a = q["action"]
            if a == "OTPREQUEST": return self.out(200, {"status_cd": "1"})
            if a == "AUTHTOKEN": return self.out(200, {"status_cd": "1", "auth_token": "TOK1", "expiry": 360} if q.get("OTP") == "575757" else {"status_cd": "0", "error": {"message": "Invalid OTP"}})
            if a == "REFRESHTOKEN":
                if TP["refresh_fails"]: return self.out(200, {"status_cd": "0", "error": {"message": "API access period has ended", "error_cd": "AUTH4037"}})
                return self.out(200, {"status_cd": "1", "auth_token": "TOK2", "expiry": 360})
        if p == "/taxpayerapi/dec/v4.2/returns/gstr2b" and q["ret_period"] == per(5):
            return self.out(200, {"status_cd": "0", "error": {"message": "GSTR-2B is being generated and should be available by 14/02/2021.", "error_cd": "RET2B1023"}})
        if p == "/taxpayerapi/dec/v3.1/returns/gstr1" and q["ret_period"] == per(5):
            return self.out(200, {"status_cd": "0", "error": {"message": "Latest Summary is not available. Please generate summary and try again.", "error_cd": "RET09001"}})
        if p == "/taxpayerapi/dec/v4.2/returns/gstr2b":
            return self.out(200, {"chksum": "x", "data": {"gstin": q["gstin"], "rtnprd": q["ret_period"], "docdata": {"b2b": [{"ctin": "09AAACB1234C1Z5", "inv": [{"inum": "A1", "val": 118}]}]}}})
        if p == "/taxpayerapi/dec/v4.0/returns/gstr1": return self.out(404, {"message": "Resource not found"})      # the newest version is not there: the next is used
        if p == "/taxpayerapi/dec/v3.1/returns/gstr1":
            if q["ret_period"] not in FILED: return self.out(200, {"status_cd": "0", "error": {"message": "Return not filed for the period", "error_cd": "RET11402"}})
            if q["action"] == "RETSUM": return self.out(200, {"status_cd": "1", "data": {"ret_period": q["ret_period"], "sec_sum": [{"sec_nm": "B2B", "ttl_tax": 100, "ttl_igst": 18}]}})
            if q["action"] == "B2B": return self.out(200, {"status_cd": "1", "data": {"b2b": [{"ctin": "07AAACB1234C1Z5", "inv": [{"inum": "S1", "idt": "05-08-2026", "val": 118, "pos": "07", "itms": [{"num": 1, "itm_det": {"txval": 100, "rt": 18, "iamt": 18}}]}]}]}})
            return self.out(200, {"status_cd": "0", "error": {"message": "No invoices found for the provided inputs", "error_cd": "RET13509"}})
        if p == "/taxpayerapi/dec/v4.0/returns/gstr3b":
            if q["ret_period"] not in FILED: return self.out(200, {"status_cd": "0", "error": {"message": "Return not filed for the period", "error_cd": "RET11402"}})
            return self.out(200, {"status_cd": "1", "data": {"ret_period": q["ret_period"], "sup_details": {"osup_det": {"txval": 100, "iamt": 18, "camt": 0, "samt": 0, "csamt": 0}}}})
        if p == "/taxpayerapi/dec/v1.0/returns" and q.get("action") == "RETTRACK":
            TP["track"] = q.get("fy")
            return self.out(200, {"status_cd": "1", "data": {"EFiledlist": [{"valid": "Y", "mof": "ONLINE", "dof": "24-10-2025", "rtntype": "GSTR3B", "ret_prd": "062025", "arn": "AA0906250000001", "status": "Filed"},
                {"valid": "Y", "mof": "ONLINE", "dof": "13-05-2025", "rtntype": "GSTR1", "ret_prd": "042025", "arn": "AA0904250000002", "status": "Filed"}]}})
        if p == "/eivital/dec/v1.04/auth":
            return self.out(200, {"Status": 1, "Data": {"AuthToken": "EINV1", "TokenExpiry": "2099-01-01 10:00:00"}} if q.get("eInvPwd") == "irp-pass" else {"Status": 0, "ErrorDetails": [{"ErrorCode": "108", "ErrorMessage": "Invalid login credentials"}]})
        if p == "/eicore/dec/v1.03/Invoice":
            no = body["DocDtls"]["No"]
            if no in TP["irn_made"]: return self.out(200, {"Status": 0, "ErrorDetails": [{"ErrorCode": "2150", "ErrorMessage": "Duplicate IRN"}]})
            TP["irn_made"][no] = "IRN-" + no
            return self.out(200, {"Status": 1, "Data": json.dumps({"AckNo": 112010000000001, "AckDt": ist_now(), "Irn": "IRN-" + no, "SignedQRCode": "QR-" + no, "SignedInvoice": "SI"})})
        if p == "/eicore/dec/v1.03/Invoice/irnbydocdetails":
            irn = TP["irn_made"].get(q.get("docnum"))
            return self.out(200, {"Status": 1, "Data": {"AckNo": 112010000000001, "AckDt": ist_now(), "Irn": irn, "SignedQRCode": "QR-again"}} if irn else {"Status": 0, "ErrorDetails": [{"ErrorMessage": "not found"}]})
        if p == "/eicore/dec/v1.03/Invoice/Cancel": return self.out(200, {"Status": 1, "Data": {"Irn": body["Irn"], "CancelDate": "2026-10-01 13:00:00"}})
        if p == "/eiewb/dec/v1.03/ewaybill":
            return self.out(200, {"Status": 1, "Data": {"EwbNo": 331000000001, "EwbDt": "2026-10-01 12:30:00", "EwbValidTill": "2026-10-02 23:59:00"}} if body.get("Irn") and body.get("Distance") else {"Status": 0, "ErrorDetails": [{"ErrorMessage": "Distance is required"}]})
        self.out(404, {"message": "no such path " + p})
    def do_GET(self): self.handle_any()
    def do_POST(self): self.handle_any()
tps = http.server.ThreadingHTTPServer(("127.0.0.1", 9310), TPH); threading.Thread(target=tps.serve_forever, daemon=True).start()

# ---------- Supabase stand-in: a firm, a member, TaxPro's keys in Vault ----------
FIRM, USER, JWT = "f-1", "u-1", "user-jwt-1"
F.USERS[JWT] = {"id": USER, "email": "a@b.c"}
F.T["members"].append({"user_id": USER, "firm_id": FIRM, "active": True, "role": "owner"})
# the firm's clients (an OTP, a sign-in or an e-invoice action only for a GSTIN with one's PAN: security review H1 and its
# review): c-0 known by its GSTIN (its other registrations, G_MORE, carry the same PAN), c-p by its PAN only (in lower
# case), c-d deactivated, c-e deleted; G_OTHER is another firm's client
G_MORE = ["07AAACT1234A2Z5", "07AAACT1234A3Z5", "07AAACT1234A4Z5", "07AAACT1234A5Z5"]; G_OTHER = "27AAACX9999X1Z5"
F.T["clients"] += [{"id": "c-0", "firm_id": FIRM, "gstin": "07AAACT1234A1Z5", "pan": None, "deleted": False, "status": "active"},
                   {"id": "c-p", "firm_id": FIRM, "gstin": None, "pan": "aaacp5555p", "deleted": False, "status": None},
                   {"id": "c-d", "firm_id": FIRM, "gstin": "07AAACD1111D1Z5", "pan": "AAACD1111D", "deleted": False, "status": "deactivated"},
                   {"id": "c-e", "firm_id": FIRM, "gstin": "07AAACE2222E1Z5", "pan": "AAACE2222E", "deleted": True, "status": "active"},
                   {"id": "c-x", "firm_id": "f-2", "gstin": G_OTHER, "pan": "AAACX9999X", "deleted": False, "status": "active"}]
F.SECRETS["gsp:taxpro:aspid"] = "ASP-FROM-VAULT"; F.SECRETS["gsp:taxpro:password"] = "ASP-PASS-FROM-VAULT"
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key",
           TAXPRO_BASE_URL="http://127.0.0.1:9310", TAXPRO_EINV_URL="http://127.0.0.1:9310", TAXPRO_ASP_ID="", TAXPRO_ASP_PASSWORD="")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "gst-taxpro", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, cron=False):
    h = {"Content-Type": "application/json"}
    if cron: h["x-cron-key"] = F.CRON_KEY
    else: h["Authorization"] = "Bearer " + JWT
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=h)
    try: r = urllib.request.urlopen(rq, timeout=120); return json.loads(r.read())
    except urllib.error.HTTPError as e: return json.loads(e.read() or b"{}")
G = "07AAACT1234A1Z5"
row = lambda: next((r for r in F.T.get("gst_sessions", []) if r["gstin"] == G), {})
ret = lambda form, p: next((r for r in F.T.get("gst_returns", []) if r["gstin"] == G and r["form"] == form and r["period"] == p), None)
try:
    for i in range(60):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    # the session: OTP, sign-in with a 7-day access period; the token in Vault, never in the table
    r = call({"action": "otp", "gstin": G, "username": "user1"})
    ok(r.get("ok") and TP["calls"][-1][2] == "ASP-FROM-VAULT", "OTP asked with TaxPro's ASP id read from Vault")
    r = call({"action": "auth", "gstin": G, "username": "user1", "otp": "575757", "days": 7})
    s = row()
    ok(r.get("ok") and r.get("accessDays") == 7 and F.SECRETS.get("gsp:sess:%s:%s" % (FIRM, G)) == "TOK1" and s.get("token_secret") and not s.get("token_enc"), "signed in: the token is in Vault (gsp:sess:…), the table keeps only its id")
    au = s.get("access_until", ""); ok(au[:10] == time.strftime("%Y-%m-%d", time.gmtime(time.time() + 7 * 86400)), "the access period ends 7 days from now (%s)" % au[:10])
    st = call({"action": "status", "gstins": [G]})["sessions"][0]
    ok(st["accessDays"] == 7 and st["accessUntil"] and "token" not in json.dumps(st).lower().replace("token_", ""), "status: the access period, never the token")
    # security review H1: an OTP or a sign-in only for a GSTIN of one of the firm's clients, and OTPs not without limit
    n0 = len(TP["calls"]); otps = lambda: sum(1 for c in TP["calls"][n0:] if c[1] == "OTPREQUEST")
    r = call({"action": "otp", "gstin": G_OTHER, "username": "user9"})
    ok(not r.get("ok") and "not one of your firm's clients" in r.get("error", "") and otps() == 0, "an OTP for a GSTIN that is not the firm's client (another firm's): refused, nothing sent: %s" % r)
    r = call({"action": "auth", "gstin": G_OTHER, "username": "user9", "otp": "575757"})
    ok(not r.get("ok") and "not one of your firm's clients" in r.get("error", "") and not any(c[1] == "AUTHTOKEN" for c in TP["calls"][n0:])
       and not any(x["gstin"] == G_OTHER for x in F.T.get("gst_sessions", [])), "a sign-in for that GSTIN: refused, no session kept: %s" % r)
    rs = [call({"action": "otp", "gstin": G, "username": "user1"}) for _ in range(3)]
    ok(rs[0].get("ok") and rs[1].get("ok") and not rs[2].get("ok") and "Try again in 15 minutes" in rs[2].get("error", "") and otps() == 2,
       "one GSTIN: 3 OTPs in 15 minutes, the 4th refused with when to try again: %s" % rs[2])
    rs = [call({"action": "otp", "gstin": g, "username": "user1"}) for g in G_MORE for _ in range(2)]
    ok([x.get("ok") for x in rs] == [True] * 6 + [False] * 2 and "Try again in an hour" in rs[-1].get("error", "") and otps() == 8,
       "the firm: 10 OTPs an hour (any GSTINs; the one a GSTIN's limit refused counts too), then refused with when to try again: %s" % rs[-1])
    rs = [call({"action": "auth", "gstin": G_MORE[0], "username": "user1", "otp": "111111"}) for _ in range(6)]
    ok(all("Invalid OTP" in x.get("error", "") for x in rs[:5]) and "Try again in 15 minutes" in rs[5].get("error", "") and sum(1 for c in TP["calls"][n0:] if c[1] == "AUTHTOKEN") == 5,
       "sign-in with an OTP: 5 tries in 15 minutes per GSTIN, the 6th refused: %s" % rs[5])
    # security review M1: a network failure never puts the OTP, the ASP password or the e-invoice password in a log or a reply
    r1 = call({"action": "auth", "gstin": G_MORE[1], "username": "drop", "otp": "246810"})
    r2 = call({"action": "einv-login", "gstin": G_MORE[1], "username": "drop", "password": "irp-drop-secret"})
    time.sleep(0.5); said = json.dumps([r1, r2]) + "".join(log)
    ok(TP.get("dropped", 0) >= 2 and not r1.get("ok") and not r2.get("ok"), "the network failures happened, and are said as failures: %s %s" % (r1, r2))
    leaks = [w for w in ("246810", "irp-drop-secret", "ASP-PASS-FROM-VAULT", "ASP-FROM-VAULT") if w in said]
    if leaks: print("   leaked:", leaks, [l.strip()[:300] for l in log if any(w in l for w in leaks)][:3])
    ok(not leaks, "after a network failure: no OTP, ASP id or password, or e-invoice password in the function's log or the reply")
    ok(any("/eivital/dec/v1.04/auth" in l for l in log) and any("authenticate" in l and "AUTHTOKEN" in l for l in log), "each failure is still logged, cleaned (the path and the action)")
    # the review of c405f5104
    n1 = len(TP["calls"]); sent = lambda: sum(1 for c in TP["calls"][n1:] if c[1] == "OTPREQUEST")
    hits = lambda b: sum(1 for x in F.RATE if x[0] == b)
    F.RATE.clear()
    # M-a: the client's registration in another state (same PAN), and a client known by its PAN only: allowed
    rs = [call({"action": "otp", "gstin": g, "username": "user1"}) for g in ("09AAACT1234A1Z5", "29AAACP5555P1Z5")]
    ok(all(x.get("ok") for x in rs) and sent() == 2, "an OTP for the client's GSTIN in another state, and for a client known by its PAN only: sent: %s" % rs)
    # L-c: a deactivated or deleted client: refused, nothing sent
    rs = [call({"action": "otp", "gstin": g, "username": "user1"}) for g in ("07AAACD1111D1Z5", "07AAACE2222E1Z5")]
    ok(all("not one of your firm's clients" in x.get("error", "") for x in rs) and sent() == 2, "a deactivated or a deleted client's GSTIN: refused, nothing sent: %s" % rs)
    # L-b: the firm over its cap: refused before any GSTIN's count is used
    F.RATE.clear()
    for g, n in zip(G_MORE, (3, 3, 3, 1)):
        for _ in range(n): call({"action": "otp", "gstin": g, "username": "user1"})
    g0, d0 = hits("gst-otp-gstin"), hits("gst-otp-gstin-day")
    r = call({"action": "otp", "gstin": "09AAACT1234A1Z5", "username": "user1"})
    ok("Try again in an hour" in r.get("error", "") and hits("gst-otp-gstin") == g0 and hits("gst-otp-gstin-day") == d0 and sent() == 12,
       "the firm has had 10 OTPs this hour: refused, and the GSTIN's own counts are not used: %s" % r)
    # L-a: one GSTIN at most 10 OTPs in 24 hours, however they are spread over the hours
    F.RATE.clear(); s0 = sent(); last = {}
    for _ in range(30):
        last = call({"action": "otp", "gstin": G_MORE[3], "username": "user1"})
        if "24 hours" in last.get("error", ""): break
        if not last.get("ok"): F.RATE[:] = [(b, k, t - 3700) if b in ("gst-otp-gstin", "gst-otp-firm") else (b, k, t) for b, k, t in F.RATE]   # the 15 minutes and the hour pass
    ok(sent() - s0 == 10 and "Try again in 24 hours" in last.get("error", ""), "one GSTIN: 10 OTPs in 24 hours, then refused with when to try again (%d sent): %s" % (sent() - s0, last))
    # M-b: the limit cannot be checked (the database fails): refused, nothing sent; a database without auth_rate_hit: counted here, logged
    F.RATE.clear(); F.FAIL_RPC["auth_rate_hit"] = {"message": "terminating connection", "code": "57P01"}; s0 = len(TP["calls"])
    rs = [call({"action": "otp", "gstin": G, "username": "user1"}), call({"action": "auth", "gstin": G_MORE[2], "username": "user1", "otp": "575757"}),
          call({"action": "einv-login", "gstin": G_MORE[2], "username": "irpuser", "password": "irp-pass-2"})]
    del F.FAIL_RPC["auth_rate_hit"]
    ok(all("try again in a moment" in x.get("error", "") for x in rs) and len(TP["calls"]) == s0, "the limit cannot be checked: OTP, sign-in and e-invoice sign-in refused (try again in a moment), nothing sent: %s" % rs)
    F.NO_FN.add("auth_rate_hit"); s0 = sent()
    r = call({"action": "otp", "gstin": G_MORE[2], "username": "user1"})
    F.NO_FN.discard("auth_rate_hit"); time.sleep(0.3)
    ok(r.get("ok") and sent() == s0 + 1 and any("counted in this running copy only" in l for l in log), "a database without auth_rate_hit (PGRST202): counted in this copy, logged, sent: %s" % r)
    # L-d: the e-invoice actions only for the firm's clients
    rs = [call(dict(b, gstin=G_OTHER)) for b in ({"action": "einv-login", "username": "u", "password": "p-other"}, {"action": "irn", "docKey": "x", "inv": {"SellerDtls": {"Gstin": G_OTHER}}},
          {"action": "irn-cancel", "docKey": "x"}, {"action": "ewb", "docKey": "x", "trans": {}})]
    ok(all("not one of your firm's clients" in x.get("error", "") for x in rs) and not any(k.startswith("gsp:einv:%s:%s" % (FIRM, G_OTHER)) for k in F.SECRETS),
       "einv-login, irn, irn-cancel and ewb for another firm's GSTIN: refused, nothing kept: %s" % [x.get("error") for x in rs])
    F.RATE.clear()
    # Fetch now: 2B, GSTR-1 (the version that answers), 3B; a month not filed is "none"
    r = call({"action": "fetch", "gstin": G, "form": "2B", "period": per(1)})
    ok(r.get("ok") and ret("2B", per(1))["status"] == "ok" and ret("2B", per(1))["data"]["docdata"]["b2b"][0]["ctin"] == "09AAACB1234C1Z5", "2B fetched and kept on the server")
    # round 72b: a 2B fetched queues the 2B matching by itself (gst2b_enqueue, migration-95; server/gst-taxpro/automatch.ts)
    for i in range(20):
        if F.ARGS.get("gst2b_enqueue"): break
        time.sleep(0.1)
    ok([a.get("p_period") for a in F.ARGS.get("gst2b_enqueue", [])] == [per(1)] and F.ARGS["gst2b_enqueue"][0].get("p_why") == "fetched", "a 2B fetched queues the 2B matching for its period (gst2b_enqueue)")
    r = call({"action": "fetch", "gstin": G, "form": "R1", "period": per(1)})
    d = (ret("R1", per(1)) or {}).get("data") or {}
    ok(r.get("ok") and d.get("b2b", [{}])[0].get("ctin") == "07AAACB1234C1Z5" and d.get("summary", {}).get("sec_sum") and "partial" not in d, "filed GSTR-1: summary and B2B, as the portal's JSON; empty tables are not failures")
    ok(any(c[0] == "/taxpayerapi/dec/v3.1/returns/gstr1" for c in TP["calls"]), "GSTR-1: v4.0 not there, v3.1 used")
    r = call({"action": "fetch", "gstin": G, "form": "3B", "period": per(1)})
    ok(r.get("ok") and ret("3B", per(1))["data"]["sup_details"]["osup_det"]["iamt"] == 18, "filed 3B: its summary kept")
    r = call({"action": "fetch", "gstin": G, "form": "3B", "period": per(3)})
    ok(ret("3B", per(3))["status"] == "none" and "not filed" in ret("3B", per(3))["error"], "a month not filed: kept as none, not an error")
    r = call({"action": "fetch", "gstin": G, "form": "R1", "period": per(5)}); r2 = call({"action": "fetch", "gstin": G, "form": "2B", "period": per(5)})
    ok(ret("R1", per(5))["status"] == "none" and ret("2B", per(5))["status"] == "none", "GSTN's 'summary not available' and '2B being generated' are kept as not there yet, not as failures")
    F.T["gst_returns"] = [x for x in F.T["gst_returns"] if x["period"] != per(5)]
    lst = call({"action": "returns", "gstins": [G]})["returns"]
    ok(len(lst) == 4 and all("data" not in x for x in lst), "the list of kept returns (without their data)")
    one = call({"action": "return", "gstin": G, "form": "R1", "period": per(1)})["ret"]
    ok(one and one["data"]["b2b"], "one kept return, with its data")
    # the portal's return status list (RETTRACK): kept for the year, each return with its ARN and date
    r = call({"action": "fetch", "gstin": G, "form": "TRACK", "period": "2025-26"})
    tr = ret("TRACK", "2025-26")
    ok(r.get("ok") and TP.get("track") == "2025-26" and tr and tr["status"] == "ok" and tr["data"]["EFiledlist"][0]["arn"] == "AA0906250000001", "return status list (RETTRACK) fetched and kept, with ARN and date of filing")
    ok(not call({"action": "fetch", "gstin": G, "form": "TRACK", "period": "062025"}).get("ok"), "the status list is asked for a year (2025-26), not a month")
    F.T["gst_returns"] = [x for x in F.T["gst_returns"] if x["form"] != "TRACK"]
    # the daily run: what is not kept yet; a reminder 3 days before the access period ends
    F.T["gst_returns"] = [x for x in F.T["gst_returns"] if not (x["form"] == "3B" and x["period"] == per(2))]
    n0 = len(TP["calls"])
    r = call({"action": "daily"}, cron=True)
    ok(r.get("ok") and ret("3B", per(2)) and ret("3B", per(2))["status"] == "ok" and ret("R1", per(2))["status"] == "ok", "daily run: last months' GSTR-1 and 3B not kept yet are fetched (%s)" % {k: r.get(k) for k in ("fetched", "none", "failed")})
    ok(any(x["form"] == "TRACK" and x["status"] == "ok" for x in F.T["gst_returns"]), "daily run: the year's return status list is read too")
    ok(not any(c[1] == "RETSUM" and c[0].endswith("gstr3b") for c in TP["calls"][n0:] if False) and r.get("reminded") == 0, "no reminder while the access period has 7 days left")
    s = row(); s["access_until"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 2 * 86400))
    r = call({"action": "daily"}, cron=True)
    ok(r.get("reminded") == 1 and row().get("reminded_at"), "2 days left: reminded once")
    r = call({"action": "daily"}, cron=True)
    ok(r.get("reminded") == 0, "and not again")
    # renewal: GSTN refuses once the access period is over: the session ends, the kept returns stay
    s = row(); s["expires_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 10 * 60))
    r = call({"action": "refresh-all"}, cron=True)
    ok(r.get("renewed") == 1 and F.SECRETS["gsp:sess:%s:%s" % (FIRM, G)] == "TOK2", "renewed in the background: the new token in Vault")
    TP["refresh_fails"] = True; s = row(); s["expires_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 10 * 60))
    r = call({"action": "refresh-all"}, cron=True)
    ok(r.get("failed") == 1 and row().get("ended_at") and "access period" in (row().get("last_error") or ""), "access period over: the session is marked ended, with GSTN's reason")
    r = call({"action": "fetch", "gstin": G, "form": "2B", "period": per(1)})
    ok(not r.get("ok") and "OTP" in r.get("error", "") and ret("2B", per(1))["status"] == "ok", "a fetch then asks for an OTP; the 2B kept before stays")
    ok(call({"action": "daily"}, cron=False).get("ok") is False, "the daily run needs the timer's key")
    # e-invoice and e-way bill
    r = call({"action": "einv-login", "gstin": G, "username": "irpuser", "password": "wrong"})
    ok(not r.get("ok") and "refused" in r.get("error", ""), "e-invoice sign-in with a wrong password: refused, said so")
    r = call({"action": "einv-login", "gstin": G, "username": "irpuser", "password": "irp-pass"})
    ok(r.get("ok") and F.SECRETS.get("gsp:einv:%s:%s:pass" % (FIRM, G)) == "irp-pass" and F.SECRETS.get("gsp:einv:%s:%s:token" % (FIRM, G)) == "EINV1", "e-invoice user: password and token in Vault")
    inv = {"Version": "1.1", "TranDtls": {"TaxSch": "GST", "SupTyp": "B2B"}, "DocDtls": {"Typ": "INV", "No": "SI/26/001", "Dt": "01/10/2026"},
           "SellerDtls": {"Gstin": G}, "BuyerDtls": {"Gstin": "09AAACB1234C1Z5"}, "ItemList": [], "ValDtls": {}}
    r = call({"action": "irn", "gstin": G, "docKey": "sv-1", "inv": inv})
    e = next((x for x in F.T.get("gst_einvoices", []) if x["doc_key"] == "sv-1"), {})
    ok(r.get("ok") and r.get("irn") == "IRN-SI/26/001" and e.get("irn_status") == "active" and e.get("signed_qr") == "QR-SI/26/001", "IRN made and kept, with the signed QR")
    r = call({"action": "irn", "gstin": G, "docKey": "sv-1", "inv": inv})
    ok(r.get("ok") and r.get("irn") == "IRN-SI/26/001", "asked again: the IRP's duplicate answer is turned into the same IRN")
    r = call({"action": "irn", "gstin": G, "docKey": "sv-x", "inv": dict(inv, SellerDtls={"Gstin": "27AAACT1234A1Z5"})})
    ok(not r.get("ok") and "seller GSTIN" in r.get("error", ""), "an invoice of another GSTIN is refused")
    r = call({"action": "ewb", "gstin": G, "docKey": "sv-1", "trans": {"distance": 120, "vehicleNo": "DL 01 AB 1234", "mode": "1"}})
    e = next((x for x in F.T.get("gst_einvoices", []) if x["doc_key"] == "sv-1"), {})
    ok(r.get("ok") and r.get("ewbNo") == "331000000001" and e.get("ewb_status") == "active", "e-way bill made from the IRN and kept")
    r = call({"action": "ewb", "gstin": G, "docKey": "sv-1", "trans": {"distance": 120}})
    ok(not r.get("ok") and "already" in r.get("error", ""), "a second e-way bill for the same invoice is refused")
    r = call({"action": "irn-cancel", "gstin": G, "docKey": "sv-1", "reason": "2", "remark": "wrong rate"})
    e = next((x for x in F.T.get("gst_einvoices", []) if x["doc_key"] == "sv-1"), {})
    ok(r.get("ok") and e.get("irn_status") == "cancelled" and e.get("irn") == "IRN-SI/26/001", "IRN cancelled within 24 hours; the record stays, marked cancelled")
    lst = call({"action": "einvoices", "gstin": G})
    ok(lst.get("ok") and len(lst["einvoices"]) == 1 and lst["einvoices"][0]["irn_status"] == "cancelled" and "request" not in lst["einvoices"][0], "the firm's e-invoices listed")
    # L-d: the e-invoice sign-in at most 5 times in 15 minutes per GSTIN
    F.RATE.clear()
    rs = [call({"action": "einv-login", "gstin": G, "username": "irpuser", "password": "wrong"}) for _ in range(6)]
    ok(all("refused" in x.get("error", "") for x in rs[:5]) and "Try again in 15 minutes" in rs[5].get("error", ""), "e-invoice sign-in: 5 in 15 minutes, the 6th refused with when to try again: %s" % rs[5])
    # never the keys
    ok(not any("ASP-PASS-FROM-VAULT" in l or "TOK1" in l or "irp-pass" in l for l in log), "the function's log never has a key, token or password")
finally:
    fn.kill()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
