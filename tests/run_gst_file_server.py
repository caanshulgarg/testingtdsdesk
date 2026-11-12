"""python3 run_gst_file_server.py - filing GSTR-1, IFF and GSTR-3B through the GST API (17-Oct-2026, branch next-gst-file;
docs/gst-filing-api.md): the gst-taxpro function under Deno, against a stand-in Supabase (fake_supabase.py) and a stand-in
TaxPro that answers as the sandbox does. Never TaxPro itself. Also runs the pure tests (deno test tests/gst_file_unit.ts).
  - save (RETSAVE, then RETSTATUS until processed), the portal's summary beside FinCom's, the differences listed;
  - nothing goes on until a person confirms: each difference accepted, with a reason;
  - the portal's summary read again before proceeding and before filing: changed -> nothing sent, compare again;
  - EVC OTP for the signatory's PAN; File with the OTP: the ARN kept; the OTP kept nowhere (tables, log, function log);
  - 3B: the set-off from the portal's liability and the ledgers (rule 88A); cash short -> refused; RETOFFSET as shown;
  - owner and staff may file, a viewer may not; every call logged with who, GSTIN, period, form, result and ARN;
  - track (RETTRACK): a return filed on the portal marked filed with its ARN.
  - sent once (item 1 of the state-machine review, 12-Nov-2026; migration-173): once proceeded, a save, summary or proceed
    is refused and never moves the return back; two proceeds or two Files at once send RETOFFSET / RETFILE once; a save
    the portal is still processing is kept as saved (state IP), not failed, and polled again; a File without an ARN is
    followed by RETTRACK before RETFILE is sent again; an EVC OTP older than 10 minutes is refused.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, shutil, threading, subprocess, http.server, urllib.request
from urllib.parse import urlparse, parse_qs
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

u = subprocess.run([DENO, "test", "--allow-read", os.path.join(HERE, "gst_file_unit.ts")], capture_output=True, text=True)
ok(u.returncode == 0, "the pure parts (deno test tests/gst_file_unit.ts)" + ("" if u.returncode == 0 else ": " + (u.stdout + u.stderr)[-800:]))

G, PANS = "09AANFG3202D1ZR", "ABCPG1234K"
OTP_OK, OTP_BAD = "246810", "111111"
TP = {"calls": [], "saved": {}, "status_n": {}, "tamper": {}, "ip": set(), "delay": {}, "noarn": [False], "moves": [False], "spent": {}, "drop_status": set(), "offset_answer": [None], "file504": [False], "cash": {"igst": {"tx": 0}, "cgst": {"tx": 0}, "sgst": {"tx": 0}, "cess": {"tx": 0}}, "offset": None, "filebody": None, "filed": []}
def sec_sum(p):   # the portal's GSTR-1 summary of what was saved (as the portal adds it up)
    out = []
    def fig(name, docs, sign=lambda d: 1):
        t = {"sec_nm": name, "ttl_rec": 0, "ttl_tax": 0.0, "ttl_igst": 0.0, "ttl_cgst": 0.0, "ttl_sgst": 0.0, "ttl_cess": 0.0}
        for d in docs:
            t["ttl_rec"] += 1
            for it in d.get("itms", [d]):
                x = it.get("itm_det", it); s = sign(d)
                t["ttl_tax"] += s * x.get("txval", 0); t["ttl_igst"] += s * x.get("iamt", 0); t["ttl_cgst"] += s * x.get("camt", 0); t["ttl_sgst"] += s * x.get("samt", 0)
        return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in t.items()}
    if p.get("b2b"): out.append(fig("B2B", [i for c in p["b2b"] for i in c["inv"]]))
    if p.get("b2cs"): out.append(fig("B2CS", p["b2cs"]))
    if p.get("cdnr"): out.append(fig("CDNR", [n for c in p["cdnr"] for n in c["nt"]], lambda d: 1 if d.get("ntty") == "D" else -1))
    return out
class TPH(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def out(self, obj, code=200):
        b = json.dumps(obj).encode()
        try: self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
        except (BrokenPipeError, ConnectionResetError): pass      # the function stopped waiting (a write's answer lost)
    def handle_any(self):
        uu = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(uu.query).items()}; p = uu.path; a = q.get("action", "")
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n)) if n else None
        TP["calls"].append({"m": self.command, "p": p, "a": a, "q": q, "body": body, "tok": self.headers.get("auth-token")})
        if TP["delay"].get(a): time.sleep(TP["delay"][a])          # a slow portal: two calls at once overlap
        if self.headers.get("aspid") != "ASP-FROM-VAULT": return self.out({"status_cd": "0", "error": {"message": "Invalid ASP"}})
        if p == "/taxpayerapi/dec/v1.0/authenticate":
            if a == "OTPREQUEST": return self.out({"status_cd": "1"})
            if a == "AUTHTOKEN": return self.out({"status_cd": "1", "auth_token": "TOK1", "expiry": 360})
            if a == "EVCOTP": return self.out({"status_cd": "1"} if q.get("pan") == PANS else {"status_cd": "0", "error": {"message": "No authorised signatory for the given PAN", "error_cd": "OTP0010"}})
        if self.headers.get("auth-token") != "TOK1": return self.out({"status_cd": "0", "error": {"message": "Invalid session", "error_cd": "AUTH4033"}})
        kind = "R1" if p.endswith("/gstr1") else "3B" if p.endswith("/gstr3b") else ""
        key = (kind, q.get("ret_period"))
        if kind and a == "RETSAVE" and self.command == "PUT":
            TP["saved"][key] = body; TP["status_n"]["REF-" + kind + q["ret_period"]] = 0
            return self.out({"status_cd": "1", "data": {"reference_id": "REF-" + kind + q["ret_period"]}})
        if p == "/taxpayerapi/dec/v1.0/returns" and a == "RETSTATUS" and q.get("ref_id") in TP["drop_status"]:
            self.close_connection = True; return                                 # the connection dropped, no answer
        if p == "/taxpayerapi/dec/v1.0/returns" and a == "RETSTATUS":
            r = q.get("ref_id"); TP["status_n"][r] = TP["status_n"].get(r, 0) + 1
            return self.out({"status_cd": "IP"} if TP["status_n"][r] < 2 or r in TP["ip"] else {"status_cd": "P"})
        if kind == "R1" and a == "RETSUM":
            p1 = TP["saved"].get(key)
            if not p1: return self.out({"status_cd": "0", "error": {"message": "Latest Summary is not available.", "error_cd": "RET09001"}})
            s = sec_sum(p1)
            for t in s:
                for k, v in TP["tamper"].get(key, {}).get(t["sec_nm"], {}).items(): t[k] = v
            return self.out({"status_cd": "1", "data": {"ret_period": q["ret_period"], "chksum": "c" + str(time.time()), "sec_sum": s}})
        if kind == "3B" and a == "RETSUM":
            p3 = TP["saved"].get(key)
            if not p3: return self.out({"status_cd": "0", "error": {"message": "not saved"}})
            return self.out({"status_cd": "1", "data": dict(p3, tx_pmt={"tx_py": [
                {"liab_ldg_id": 501, "trans_typ": 30002, "igst": {"tx": p3["sup_details"]["osup_det"]["iamt"]}, "cgst": {"tx": p3["sup_details"]["osup_det"]["camt"]}, "sgst": {"tx": p3["sup_details"]["osup_det"]["samt"]}, "cess": {"tx": 0}},
                {"liab_ldg_id": 502, "trans_typ": 30003, "igst": {"tx": 0}, "cgst": {"tx": p3["sup_details"]["isup_rev"]["camt"]}, "sgst": {"tx": p3["sup_details"]["isup_rev"]["samt"]}, "cess": {"tx": 0}}]})})
        if p == "/taxpayerapi/dec/v1.0/ledgers" and a == "BAL":
            sp = TP["spent"]; g = lambda k: sp.get(k, 0)
            return self.out({"status_cd": "1", "data": {"itc_blnc": {"igst_bal": 100 - g("i"), "cgst_bal": 20 - g("c"), "sgst_bal": 20 - g("s"), "cess_bal": 0 - g("cs")},
                "cash_bal": {h: {"tx": round(TP["cash"][h]["tx"] - g("cash_" + h), 2)} for h in TP["cash"]}}})
        if kind == "3B" and a == "RETOFFSET" and TP["offset_answer"][0]:
            return self.out(*TP["offset_answer"][0])                        # an answer of the GSP's own (refused, or GSTN timed out)
        if kind == "3B" and a == "RETOFFSET":
            TP["offset"] = body
            if TP["moves"][0]:      # the ledgers move as the portal's do after a set-off
                it = body["pditc"]; sp = TP["spent"]
                for k, v in (("i", it["i_pdi"] + it["i_pdc"] + it["i_pds"]), ("c", it["c_pdc"] + it["c_pdi"]), ("s", it["s_pds"] + it["s_pdi"]), ("cs", it["cs_pdcs"])): sp[k] = sp.get(k, 0) + v
                for l in body["pdcash"]:
                    for h, ks in (("igst", ("ipd", "i_intrpd")), ("cgst", ("cpd", "c_intrpd", "c_lfeepd")), ("sgst", ("spd", "s_intrpd", "s_lfeepd")), ("cess", ("cspd", "cs_intrpd"))):
                        sp["cash_" + h] = sp.get("cash_" + h, 0) + sum(l.get(k, 0) for k in ks)
            return self.out({"status_cd": "1"})
        if kind == "R1" and a == "RETNEWPTF": return self.out({"status_cd": "1", "data": {"reference_id": "PTF1"}})
        if kind and a == "RETFILE" and TP["file504"][0]:
            return self.out({"message": "upstream timed out"}, 504)          # not filed, the answer lost
        if kind and a == "RETFILE":
            TP["filebody"] = body; sid = (body or {}).get("sid", "")
            if sid == PANS + "|" + OTP_OK:
                arn = "AA09" + q["ret_period"] + ("1" if kind == "R1" else "3") + "00042X"; TP["filed"].append((kind, q["ret_period"], arn))
                if TP["noarn"][0]: return self.out({"message": "upstream timed out"}, 504)    # filed on the portal, the answer lost
                return self.out({"status_cd": "1", "data": {"ack_num": arn}})
            return self.out({"status_cd": "0", "error": {"message": "Invalid OTP " + sid.split("|")[-1] + " for " + sid, "error_cd": "OTP0012"}})
        if p == "/taxpayerapi/dec/v1.0/returns" and a == "RETTRACK":
            return self.out({"status_cd": "1", "data": {"EFiledlist": [{"valid": "Y", "mof": "ONLINE", "dof": "11-07-2026", "rtntype": "GSTR1", "ret_prd": "062026", "arn": "AA0906260000777", "status": "Filed"}] +
                [{"valid": "Y", "mof": "ONLINE", "dof": "12-11-2026", "rtntype": "GSTR1" if k == "R1" else "GSTR3B", "ret_prd": per, "arn": arn, "status": "Filed"} for k, per, arn in TP["filed"]]}})
        self.out({"message": "no such path " + p}, 404)
    def do_GET(self): self.handle_any()
    def do_PUT(self): self.handle_any()
    def do_POST(self): self.handle_any()
tps = http.server.ThreadingHTTPServer(("127.0.0.1", 9311), TPH); threading.Thread(target=tps.serve_forever, daemon=True).start()

FIRM = "f-1"; USERS = {"owner": ("u-1", "jwt-owner"), "staff": ("u-2", "jwt-staff"), "viewer": ("u-3", "jwt-viewer")}
for role, (uid, jwt) in USERS.items():
    F.USERS[jwt] = {"id": uid, "email": role + "@b.c"}; F.T["members"].append({"user_id": uid, "firm_id": FIRM, "active": True, "role": role})
F.SECRETS["gsp:taxpro:aspid"] = "ASP-FROM-VAULT"; F.SECRETS["gsp:taxpro:password"] = "ASP-PASS"
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key",
           TAXPRO_BASE_URL="http://127.0.0.1:9311", TAXPRO_EINV_URL="http://127.0.0.1:9311", TAXPRO_ASP_ID="", TAXPRO_ASP_PASSWORD="",
           TAXPRO_STATUS_WAIT_MS="20", TAXPRO_WRITE_WAIT_MS="4000", TAXPRO_R1_PATH="/taxpayerapi/dec/v4.0/returns/gstr1", TAXPRO_R3B_PATH="/taxpayerapi/dec/v4.0/returns/gstr3b")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "gst-taxpro", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, who="owner"):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + USERS[who][1]})
    try: return json.loads(urllib.request.urlopen(rq, timeout=120).read())
    except urllib.error.HTTPError as e: return json.loads(e.read() or b"{}")
row = lambda form, per: next((r for r in F.T.get("gst_filings", []) if r["gstin"] == G and r["form"] == form and r["period"] == per), {})
logs = lambda form=None, per=None: [l for l in F.T.get("gst_filing_log", []) if (form is None or l["form"] == form) and (per is None or l["period"] == per)]
R1 = {"gstin": G, "fp": "082026", "version": "GST3.2.1", "hash": "hash",
      "b2b": [{"ctin": "07AAACB1234C1Z5", "inv": [{"inum": "S1", "val": 1180, "itms": [{"num": 1, "itm_det": {"txval": 1000, "rt": 18, "iamt": 180}}]}]}],
      "b2cs": [{"sply_ty": "INTRA", "pos": "09", "rt": 18, "txval": 300.5, "camt": 27.05, "samt": 27.05}],
      "cdnr": [{"ctin": "07AAACB1234C1Z5", "nt": [{"ntty": "C", "nt_num": "CN1", "itms": [{"itm_det": {"txval": 100, "iamt": 18}}]}]}]}
R3B = {"gstin": G, "ret_period": "082026", "sup_details": {"osup_det": {"txval": 1000, "iamt": 180, "camt": 50, "samt": 50, "csamt": 0}, "osup_zero": {"txval": 0, "iamt": 0, "csamt": 0},
       "osup_nil_exmp": {"txval": 0}, "isup_rev": {"txval": 200, "iamt": 0, "camt": 18, "samt": 18, "csamt": 0}, "osup_nongst": {"txval": 0}},
       "itc_elg": {"itc_avl": [{"ty": "OTH", "iamt": 100, "camt": 20, "samt": 20, "csamt": 0}], "itc_net": {"iamt": 100, "camt": 20, "samt": 20, "csamt": 0}}}
try:
    for i in range(60):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    call({"action": "otp", "gstin": G, "username": "u09"}); r = call({"action": "auth", "gstin": G, "username": "u09", "otp": "575757", "days": 30})
    ok(r.get("ok"), "the client's API session (the existing per-client OTP login)")
    base = {"gstin": G, "form": "R1", "period": "082026"}
    # order: nothing before save; a viewer never
    ok(not call(dict(base, action="proceed")).get("ok") and "Save" in call(dict(base, action="proceed"))["error"], "proceed before anything is saved: refused")
    r = call(dict(base, action="save", payload=R1), "viewer")
    ok(not r.get("ok") and "owner or staff" in r["error"] and not any(c["a"] == "RETSAVE" for c in TP["calls"]), "a viewer may not save (nothing sent)")
    r = call(dict(base, action="save", payload=dict(R1, fp="092026")))
    ok(not r.get("ok") and "period" in r["error"], "a return of another period is refused")
    # save: RETSAVE then RETSTATUS until processed; the offline tool's fields not sent
    r = call(dict(base, action="save", payload=R1), "staff")
    sv = next(c for c in TP["calls"] if c["a"] == "RETSAVE")
    ok(r.get("ok") and r.get("saveState") == "P" and sv["m"] == "PUT" and sv["p"].endswith("/gstr1") and "version" not in sv["body"] and sv["body"]["b2b"] == R1["b2b"], "staff saves: RETSAVE (PUT) with the return, without the offline tool's version and hash")
    ok(sum(1 for c in TP["calls"] if c["a"] == "RETSTATUS") == 2 and row("R1", "082026")["status"] == "saved", "RETSTATUS asked until processed (in progress, then P)")
    # the portal's summary beside FinCom's: one difference (IGST of B2B on the portal 1 less)
    TP["tamper"][("R1", "082026")] = {"B2B": {"ttl_igst": 179}}
    r = call(dict(base, action="summary"))
    b2b = next((x for x in r.get("rows", []) if x["key"] == "B2B"), {})
    ok(r.get("ok") and r["differs"] == ["B2B.iamt"] and b2b.get("fincom", {}).get("iamt") == 180 and b2b.get("portal", {}).get("iamt") == 179, "summary: FinCom 180 against the portal 179 on B2B IGST, listed")
    cd = next((x for x in r.get("rows", []) if x["key"] == "CDNR"), {})
    ok(cd.get("fincom", {}).get("txval") == -100 and not cd.get("differs"), "credit notes compared net (FinCom -100, the portal -100)")
    ok("Accept" in call(dict(base, action="confirm")).get("error", ""), "confirm without accepting the difference: refused")
    ok("why" in call(dict(base, action="confirm", accept=["B2B.iamt"])).get("error", ""), "accepting a difference needs a reason")
    ok(not call(dict(base, action="proceed")).get("ok") and not any(c["a"] == "RETNEWPTF" for c in TP["calls"]), "proceed before a person confirms: refused, nothing sent")
    r = call(dict(base, action="confirm", accept=["B2B.iamt"], note="portal rounds the invoice of S1"))
    ok(r.get("ok") and row("R1", "082026")["confirmed_by"] == "u-1" and row("R1", "082026")["accepted"] == ["B2B.iamt"], "the owner accepts the listed difference with a reason: kept with name and time")
    ok("Proceed" in call(dict(base, action="evc_otp", pan=PANS)).get("error", ""), "OTP before proceeding: refused")
    r = call(dict(base, action="proceed"))
    ptf = next((c for c in TP["calls"] if c["a"] == "RETNEWPTF"), None)
    ok(r.get("ok") and ptf and ptf["m"] == "POST" and row("R1", "082026")["status"] == "proceeded", "proceed to file (RETNEWPTF, POST)")
    ok("PAN" in call(dict(base, action="evc_otp", pan="ABC")).get("error", ""), "the signatory's PAN is checked")
    r = call(dict(base, action="evc_otp", pan="ZZZPZ9999Z"))
    ok(not r.get("ok") and "OTP0010" in r["error"], "a PAN that is not a signatory: the portal's reason said")
    ok("Send the OTP" in call(dict(base, action="file", pan=PANS, otp=OTP_OK)).get("error", ""), "File before the OTP is sent: refused")
    r = call(dict(base, action="evc_otp", pan=PANS))
    ev = [c for c in TP["calls"] if c["a"] == "EVCOTP"][-1]
    ok(r.get("ok") and ev["q"].get("form_type") == "R1" and ev["q"].get("pan") == PANS and row("R1", "082026")["otp_sent_at"], "EVC OTP asked for the signatory's PAN, form R1")
    # File: wrong OTP, then the right one; the OTP kept nowhere
    r = call(dict(base, action="file", pan=PANS, otp=OTP_BAD))
    ok(not r.get("ok") and OTP_BAD not in r["error"] and "OTP0012" in r["error"] and row("R1", "082026")["status"] == "proceeded", "a wrong OTP: not filed, the portal's reason said with the OTP masked")
    r = call(dict(base, action="file", pan=PANS, otp=OTP_OK))
    fb = TP["filebody"]; fc = [c for c in TP["calls"] if c["a"] == "RETFILE"][-1]
    ok(r.get("ok") and r.get("arn") == "AA09082026100042X" and row("R1", "082026")["status"] == "filed" and row("R1", "082026")["arn"] == "AA09082026100042X" and row("R1", "082026")["filed_by"] == "u-1", "filed: the ARN kept, who filed")
    ok(fb["st"] == "EVC" and fb["sid"] == PANS + "|" + OTP_OK and fb["data"]["sec_sum"] and OTP_OK not in json.dumps(fc["q"]), "RETFILE: the summary read again, st EVC, sid PAN|OTP in the body (never in the address)")
    r = call(dict(base, action="file", pan=PANS, otp=OTP_OK)); r2 = call(dict(base, action="save", payload=R1))
    ok(not r.get("ok") and "already filed" in r["error"] and not r2.get("ok") and len(TP["filed"]) == 1, "filed: a second File or a new save is refused")
    # IFF: the summary changes between confirming and proceeding
    TP["tamper"] = {}
    iff = {"gstin": G, "form": "IFF", "period": "072026"}
    call(dict(iff, action="save", payload=dict(R1, fp="072026"))); r = call(dict(iff, action="summary"))
    ok(r.get("ok") and r["differs"] == [] and call(dict(iff, action="confirm")).get("ok"), "IFF: saved, the summary matches FinCom, confirmed without accepting anything")
    TP["tamper"][("R1", "072026")] = {"B2CS": {"ttl_cgst": 99}}
    n0 = sum(1 for c in TP["calls"] if c["a"] == "RETNEWPTF")
    r = call(dict(iff, action="proceed"))
    ok(not r.get("ok") and r.get("changed") and row("IFF", "072026")["status"] == "summary" and not row("IFF", "072026")["confirmed_by"] and sum(1 for c in TP["calls"] if c["a"] == "RETNEWPTF") == n0, "IFF: the portal's summary changed after confirming: nothing sent, compare again")
    # the owner's ₹1 rounding (17-Oct-2026): ₹0.99 off needs no reason; ₹1.00 off does
    for per, cg, rounding in (("052026", 26.06, True), ("042026", 26.05, False)):
        x = {"gstin": G, "form": "R1", "period": per}
        call(dict(x, action="save", payload=dict(R1, fp=per))); TP["tamper"][("R1", per)] = {"B2CS": {"ttl_cgst": cg}}
        r = call(dict(x, action="summary")); c = call(dict(x, action="confirm"))
        if rounding: ok(r.get("differs") == [] and r.get("rounding") == ["B2CS.camt"] and c.get("ok"), "₹0.99 off (27.05 against 26.06): rounding, confirmed without a reason")
        else: ok(r.get("differs") == ["B2CS.camt"] and r.get("rounding") == [] and not c.get("ok") and "B2CS.camt" in c.get("error", ""), "₹1.00 off (27.05 against 26.05): a difference, to accept with a reason")
    # 3B: the set-off; cash short; then enough cash
    b3 = {"gstin": G, "form": "3B", "period": "082026"}
    r = call(dict(b3, action="save", payload=R3B)); r = call(dict(b3, action="summary"))
    pl = r.get("plan") or {}
    ok(r.get("ok") and r["differs"] == [] and pl.get("pditc", {}).get("i_pdi") == 100 and pl.get("pditc", {}).get("c_pdc") == 20 and pl.get("pditc", {}).get("s_pds") == 20, "3B summary: the set-off from the credit ledger (IGST 100, CGST 20, SGST 20)")
    ok(pl.get("cashNeeded") == {"igst": 80, "cgst": 48, "sgst": 48, "cess": 0} and pl.get("short") == {"igst": 80, "cgst": 48, "sgst": 48}, "cash needed (tax after credit, and reverse charge 18 + 18) and short with an empty cash ledger")
    call(dict(b3, action="confirm"))
    r = call(dict(b3, action="proceed"))
    ok(not r.get("ok") and "cash ledger" in r["error"] and TP["offset"] is None, "cash short: the offset is refused, nothing sent")
    TP["cash"] = {"igst": {"tx": 100}, "cgst": {"tx": 50}, "sgst": {"tx": 50}, "cess": {"tx": 0}}
    # the liability moved since the summary (another save on the portal): the set-off is shown again, nothing sent
    TP["saved"][("3B", "082026")]["sup_details"]["osup_det"]["camt"] = 60; TP["saved"][("3B", "082026")]["sup_details"]["osup_det"]["samt"] = 60
    r = call(dict(b3, action="proceed"))
    ok(not r.get("ok") and r.get("changed") and TP["offset"] is None and row("3B", "082026")["status"] == "summary", "the portal's 3B changed since it was confirmed: nothing sent, compare again")
    TP["saved"][("3B", "082026")]["sup_details"]["osup_det"]["camt"] = 50; TP["saved"][("3B", "082026")]["sup_details"]["osup_det"]["samt"] = 50
    call(dict(b3, action="summary")); call(dict(b3, action="confirm")); r = call(dict(b3, action="proceed"))
    off = TP["offset"] or {}
    ok(r.get("ok") and off.get("pditc", {}).get("liab_ldg_id") == 501 and [x["cpd"] for x in off.get("pdcash", [])] == [30, 18] and row("3B", "082026")["status"] == "proceeded", "RETOFFSET sent as shown: credit, then cash (CGST 30; reverse charge 18 in cash)")
    call(dict(b3, action="evc_otp", pan=PANS)); r = call(dict(b3, action="file", pan=PANS, otp=OTP_OK), "staff")
    ev = [c for c in TP["calls"] if c["a"] == "EVCOTP"][-1]
    ok(ev["q"]["form_type"] == "R3B" and r.get("ok") and row("3B", "082026")["arn"] == "AA09082026300042X" and row("3B", "082026")["filed_by"] == "u-2", "3B: OTP for R3B, filed by staff, ARN kept")
    # track: a return filed on the portal itself
    t = {"gstin": G, "form": "R1", "period": "062026"}
    call(dict(t, action="save", payload=dict(R1, fp="062026")))
    r = call(dict(t, action="track"))
    ok(r.get("ok") and r.get("filed") and row("R1", "062026")["status"] == "filed" and row("R1", "062026")["arn"] == "AA0906260000777" and row("R1", "062026")["filed_at"].startswith("2026-07-10T18:30"), "track: filed on the portal (RETTRACK): marked filed with its ARN and date")
    # ---- sent once (item 1 of the state-machine review; migration-173) ----
    n_of = lambda a, per: sum(1 for c in TP["calls"] if c["a"] == a and c["q"].get("ret_period") == per)
    def both(b1, b2):   # two calls at the same time
        out = [None, None]
        th = [threading.Thread(target=lambda i=i, b=b: out.__setitem__(i, call(b))) for i, b in ((0, b1), (1, b2))]
        for t1 in th: t1.start()
        for t1 in th: t1.join()
        return out
    # 3B for 072026: two proceeds at once send RETOFFSET once
    c3 = {"gstin": G, "form": "3B", "period": "072026"}
    call(dict(c3, action="save", payload=dict(R3B, ret_period="072026"))); call(dict(c3, action="summary")); call(dict(c3, action="confirm"))
    TP["delay"]["RETOFFSET"] = 1.5
    r = both(dict(c3, action="proceed"), dict(c3, action="proceed"))
    TP["delay"] = {}
    ok(n_of("RETOFFSET", "072026") == 1 and sum(1 for x in r if x.get("ok")) == 1 and any("already in progress" in (x.get("error") or "") for x in r) and row("3B", "072026")["status"] == "proceeded",
       "two proceeds at once: RETOFFSET sent once, the other told it is already in progress: %s" % [x.get("error") for x in r])
    # once proceeded, nothing goes back before it
    sv = call(dict(c3, action="save", payload=dict(R3B, ret_period="072026"))); sm = call(dict(c3, action="summary")); pr = call(dict(c3, action="proceed"))
    ok(all(not x.get("ok") and "already been set off" in (x.get("error") or "") for x in (sv, sm, pr)) and row("3B", "072026")["status"] == "proceeded" and n_of("RETOFFSET", "072026") == 1
       and sum(1 for c in TP["calls"] if c["a"] == "RETSAVE" and c["p"].endswith("/gstr3b") and c["q"].get("ret_period") == "072026") == 1, "set off, then save, summary or proceed: refused, the return stays proceeded, nothing sent: %s" % [x.get("error") for x in (sv, sm, pr)])
    # the portal's figures differ after the set-off: said, nothing filed, not moved back
    call(dict(c3, action="evc_otp", pan=PANS))
    TP["saved"][("3B", "072026")]["sup_details"]["osup_det"]["txval"] = 1500
    r = call(dict(c3, action="file", pan=PANS, otp=OTP_OK))
    ok(not r.get("ok") and r.get("changed") and "3.1(a)" in r.get("error", "") and row("3B", "072026")["status"] == "proceeded" and row("3B", "072026")["confirmed_by"] and n_of("RETFILE", "072026") == 0,
       "the portal's 3B differs after the set-off: the difference said, nothing filed, still proceeded: " + str(r.get("error")))
    TP["saved"][("3B", "072026")]["sup_details"]["osup_det"]["txval"] = 1000
    # an OTP older than the portal's 10 minutes: refused, nothing sent
    for x in F.T["gst_filings"]:
        if x["form"] == "3B" and x["period"] == "072026": x["otp_sent_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 11 * 60))
    r = call(dict(c3, action="file", pan=PANS, otp=OTP_OK))
    ok(not r.get("ok") and "10 minutes" in r.get("error", "") and n_of("RETFILE", "072026") == 0, "an EVC OTP sent 11 minutes ago: refused, send a new one: " + str(r.get("error")))
    call(dict(c3, action="evc_otp", pan=PANS)); r = call(dict(c3, action="file", pan=PANS, otp=OTP_OK))
    ok(r.get("ok") and r.get("arn") and n_of("RETFILE", "072026") == 1, "a new OTP: filed")
    # 3B for 062026: the set-off's answer never comes (the portal took longer than FinCom waits) and the ledgers did not move:
    # never sent again; the next proceed asks the ledgers and says what to check on the portal
    c4 = {"gstin": G, "form": "3B", "period": "062026"}
    call(dict(c4, action="save", payload=dict(R3B, ret_period="062026"))); call(dict(c4, action="summary")); call(dict(c4, action="confirm"))
    TP["delay"]["RETOFFSET"] = 5
    r = call(dict(c4, action="proceed"))
    TP["delay"] = {}
    r2 = call(dict(c4, action="proceed")); r3 = call(dict(c4, action="summary"))
    ok(not r.get("ok") and r.get("unclear") and row("3B", "062026")["status"] == "confirmed" and row("3B", "062026").get("offset_tried_at") and "Offset liability" in r.get("error", "")
       and not r2.get("ok") and "Offset liability" in r2.get("error", "") and not r3.get("ok") and "set off" in r3.get("error", "") and n_of("RETOFFSET", "062026") == 1,
       "the set-off's answer lost, the ledgers unmoved: not sent again, what to check on the portal said, summary refused: %s | %s" % (r.get("error"), r2.get("error")))
    back = lambda form, per, col: [x.__setitem__(col, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 11 * 60))) for x in F.T["gst_filings"] if x["form"] == form and x["period"] == per]
    # 10 minutes on and the ledgers still unmoved: sent once more (only once)
    back("3B", "062026", "offset_tried_at"); r = call(dict(c4, action="proceed"))
    ok(r.get("ok") and n_of("RETOFFSET", "062026") == 2 and row("3B", "062026")["status"] == "proceeded", "10 minutes after a lost set-off, the ledgers unmoved: sent once more, proceeded: " + str(r.get("error")))
    c8 = {"gstin": G, "form": "3B", "period": "042026"}
    call(dict(c8, action="save", payload=dict(R3B, ret_period="042026"))); call(dict(c8, action="summary")); call(dict(c8, action="confirm"))
    TP["delay"]["RETOFFSET"] = 5
    call(dict(c8, action="proceed")); back("3B", "042026", "offset_tried_at"); r = call(dict(c8, action="proceed"))
    TP["delay"] = {}
    back("3B", "042026", "offset_tried_at"); r2 = call(dict(c8, action="proceed"))
    ok(r.get("unclear") and not r2.get("ok") and "Offset liability" in r2.get("error", "") and n_of("RETOFFSET", "042026") == 2, "a second lost set-off: not sent a third time, what to check said: " + str(r2.get("error")))
    # a GSP's own JSON error (GSTN timed out behind it): unclear, the mark kept; a refusal FinCom knows (RT-3BAS1070): cleared
    c9 = {"gstin": G, "form": "3B", "period": "032026"}
    call(dict(c9, action="save", payload=dict(R3B, ret_period="032026"))); call(dict(c9, action="summary")); call(dict(c9, action="confirm"))
    TP["offset_answer"][0] = ({"status_cd": "0", "error": {"message": "Request timed out at GSTN", "error_cd": "GSP999"}}, 200)
    r = call(dict(c9, action="proceed")); TP["offset_answer"][0] = None
    ok(not r.get("ok") and r.get("unclear") and row("3B", "032026").get("offset_tried_at") and row("3B", "032026")["status"] == "confirmed", "a 200 JSON error FinCom does not know: unclear, offset_tried_at kept: " + str(r.get("error")))
    c10 = {"gstin": G, "form": "3B", "period": "022026"}
    call(dict(c10, action="save", payload=dict(R3B, ret_period="022026"))); call(dict(c10, action="summary")); call(dict(c10, action="confirm"))
    TP["offset_answer"][0] = ({"status_cd": "0", "error": {"message": "Partial/excess payment of liability", "error_cd": "RT-3BAS1070"}}, 200)
    r = call(dict(c10, action="proceed")); TP["offset_answer"][0] = None
    ok(not r.get("ok") and not r.get("unclear") and "RT-3BAS1070" in r.get("error", "") and not row("3B", "022026").get("offset_tried_at"), "RT-3BAS1070 (refused before anything was paid): the mark cleared: " + str(r.get("error")))
    r = call(dict(c10, action="proceed"))
    ok(r.get("ok") and n_of("RETOFFSET", "022026") == 2, "then proceed again: sent")
    # 3B for 052026: the set-off reaches the portal but the database write after it fails (or the worker dies): the next
    # proceed finds the ledgers moved by the set-off and marks it proceeded, without sending it again
    c5 = {"gstin": G, "form": "3B", "period": "052026"}
    call(dict(c5, action="save", payload=dict(R3B, ret_period="052026"))); call(dict(c5, action="summary")); call(dict(c5, action="confirm"))
    TP["moves"][0] = True; F.FAIL_PATCH["gst_filings"] = "proceeded_at"
    r = call(dict(c5, action="proceed"))
    F.FAIL_PATCH.clear()
    ok(not r.get("ok") and row("3B", "052026")["status"] == "confirmed" and row("3B", "052026").get("offset_tried_at") and n_of("RETOFFSET", "052026") == 1,
       "the write after the set-off fails: offset_tried_at kept (written before the set-off): " + str(r.get("error")))
    sv = call(dict(c5, action="save", payload=dict(R3B, ret_period="052026")))
    ok(not sv.get("ok") and "set off" in sv.get("error", "") and n_of("RETSAVE", "052026") == sum(1 for c in TP["calls"] if c["a"] == "RETSAVE" and c["q"].get("ret_period") == "052026" and c["p"].endswith("/gstr1")) + 1,
       "a set-off tried: a new save refused: " + str(sv.get("error")))
    r = call(dict(c5, action="proceed"))
    ok(r.get("ok") and row("3B", "052026")["status"] == "proceeded" and n_of("RETOFFSET", "052026") == 1, "the next proceed: the ledgers moved, so proceeded, RETOFFSET not sent again: " + str(r))
    TP["moves"][0] = False; TP["spent"] = {}
    # a database that cannot be read: nothing is sent and nothing is overwritten (no save without the lease)
    n0 = sum(1 for c in TP["calls"] if c["a"] == "RETSAVE")
    F.FAIL_SELECT["gst_filings"] = {"message": "canceling statement due to statement timeout (test)", "code": "57014"}
    sv = call(dict(c5, action="save", payload=dict(R3B, ret_period="052026")))
    del F.FAIL_SELECT["gst_filings"]
    ok(not sv.get("ok") and sum(1 for c in TP["calls"] if c["a"] == "RETSAVE") == n0 and row("3B", "052026")["status"] == "proceeded", "gst_filings cannot be read: the save refused, nothing sent, the row not overwritten")
    # GSTR-1: proceed to file moves no money, so it may go back (the old way): RETNEWPTF's answer lost -> still confirmed,
    # proceed again; a save after proceeding is taken; the summary changed at File -> back to the summary
    c6 = {"gstin": G, "form": "R1", "period": "032026"}
    call(dict(c6, action="save", payload=dict(R1, fp="032026"))); call(dict(c6, action="summary")); call(dict(c6, action="confirm"))
    TP["delay"]["RETNEWPTF"] = 5
    r = call(dict(c6, action="proceed"))
    TP["delay"] = {}
    ok(not r.get("ok") and row("R1", "032026")["status"] == "confirmed", "GSTR-1: RETNEWPTF's answer lost: an error said, still confirmed: " + str(r.get("error")))
    r = call(dict(c6, action="proceed"))
    ok(r.get("ok") and row("R1", "032026")["status"] == "proceeded", "GSTR-1: proceed again (safe to repeat)")
    r = call(dict(c6, action="save", payload=dict(R1, fp="032026")))
    ok(r.get("ok") and row("R1", "032026")["status"] == "saved", "GSTR-1 proceeded: a new save is taken (back to saved): " + str(r.get("error")))
    c7 = {"gstin": G, "form": "R1", "period": "102025"}
    call(dict(c7, action="save", payload=dict(R1, fp="102025"))); call(dict(c7, action="summary")); call(dict(c7, action="confirm")); call(dict(c7, action="proceed")); call(dict(c7, action="evc_otp", pan=PANS))
    TP["tamper"][("R1", "102025")] = {"B2CS": {"ttl_cgst": 99}}
    r = call(dict(c7, action="file", pan=PANS, otp=OTP_OK))
    TP["tamper"].pop(("R1", "102025"))
    ok(not r.get("ok") and r.get("changed") and row("R1", "102025")["status"] == "summary" and n_of("RETFILE", "102025") == 0, "GSTR-1 proceeded, the summary changed at File: nothing filed, back to the summary")
    # track: a poll of a save in progress that fails does not stop RETTRACK
    TP["ip"].add("REF-R1092025"); call({"gstin": G, "form": "R1", "period": "092025", "action": "save", "payload": dict(R1, fp="092025")})
    TP["drop_status"].add("REF-R1092025"); nt = sum(1 for c in TP["calls"] if c["a"] == "RETTRACK")
    r = call({"gstin": G, "form": "R1", "period": "092025", "action": "track"})
    TP["drop_status"].clear(); TP["ip"].clear()
    ok(r.get("ok") and sum(1 for c in TP["calls"] if c["a"] == "RETTRACK") == nt + 1, "track: the save's status could not be read, RETTRACK asked all the same: " + str(r.get("error")))
    # R1 for 022026: two Files at once send RETFILE once
    c1 = {"gstin": G, "form": "R1", "period": "022026"}
    call(dict(c1, action="save", payload=dict(R1, fp="022026"))); call(dict(c1, action="summary")); call(dict(c1, action="confirm")); call(dict(c1, action="proceed")); call(dict(c1, action="evc_otp", pan=PANS))
    TP["delay"]["RETFILE"] = 1.5
    r = both(dict(c1, action="file", pan=PANS, otp=OTP_OK), dict(c1, action="file", pan=PANS, otp=OTP_OK))
    TP["delay"] = {}
    ok(n_of("RETFILE", "022026") == 1 and sum(1 for x in r if x.get("ok")) == 1 and any("already in progress" in (x.get("error") or "") for x in r) and row("R1", "022026")["status"] == "filed",
       "two Files at once: RETFILE sent once, the other told it is already in progress: %s" % [x.get("error") for x in r])
    # R1 for 122025: RETFILE's answer lost (filed on the portal, no ARN back); the next File asks RETTRACK first
    c2 = {"gstin": G, "form": "R1", "period": "122025"}
    call(dict(c2, action="save", payload=dict(R1, fp="122025"))); call(dict(c2, action="summary")); call(dict(c2, action="confirm")); call(dict(c2, action="proceed")); call(dict(c2, action="evc_otp", pan=PANS))
    TP["noarn"][0] = True; r = call(dict(c2, action="file", pan=PANS, otp=OTP_OK)); TP["noarn"][0] = False
    ok(not r.get("ok") and row("R1", "122025")["status"] == "proceeded", "RETFILE answered without an ARN: not marked filed")
    nt = sum(1 for c in TP["calls"] if c["a"] == "RETTRACK")
    r = call(dict(c2, action="file", pan=PANS, otp=OTP_OK))
    ok(r.get("ok") and r.get("arn") == "AA09122025100042X" and n_of("RETFILE", "122025") == 1 and sum(1 for c in TP["calls"] if c["a"] == "RETTRACK") == nt + 1 and row("R1", "122025")["status"] == "filed",
       "the next File asks the portal first (RETTRACK): it was filed, so marked filed with its ARN and RETFILE not sent again: " + str(r))
    # RETFILE's answer lost and the portal does not list it: File waits a few minutes before sending again
    c11 = {"gstin": G, "form": "R1", "period": "082025"}
    call(dict(c11, action="save", payload=dict(R1, fp="082025"))); call(dict(c11, action="summary")); call(dict(c11, action="confirm")); call(dict(c11, action="proceed")); call(dict(c11, action="evc_otp", pan=PANS))
    TP["file504"][0] = True; call(dict(c11, action="file", pan=PANS, otp=OTP_OK)); TP["file504"][0] = False
    r = call(dict(c11, action="file", pan=PANS, otp=OTP_OK))
    ok(not r.get("ok") and "wait a few minutes" in r.get("error", "") and n_of("RETFILE", "082025") == 1, "File again within minutes of a lost answer, not listed yet: wait, not sent: " + str(r.get("error")))
    back("R1", "082025", "file_tried_at"); r = call(dict(c11, action="file", pan=PANS, otp=OTP_OK))
    ok(r.get("ok") and n_of("RETFILE", "082025") == 2, "10 minutes on, still not listed: sent again, filed")
    # a save the portal is still processing: kept as saved (state IP), never failed; polled again by summary and by track
    for per in ("012026", "112025"):
        TP["ip"].add("REF-R1" + per)
        r = call({"gstin": G, "form": "R1", "period": per, "action": "save", "payload": dict(R1, fp=per)})
        ok(r.get("ok") and r.get("saveState") == "IP" and row("R1", per)["status"] == "saved" and row("R1", per)["save_state"] == "IP" and not row("R1", per).get("error"),
           "a save still processing on the portal (%s): ok, and kept as saved (state IP), not failed: %s" % (per, row("R1", per).get("status")))
        TP["ip"].discard("REF-R1" + per)
    r = call({"gstin": G, "form": "R1", "period": "012026", "action": "summary"})
    ok(r.get("ok") and row("R1", "012026")["save_state"] == "P" and row("R1", "012026")["status"] == "summary", "the summary polls it again: processed, the summary read")
    r = call({"gstin": G, "form": "R1", "period": "112025", "action": "track"})
    ok(r.get("ok") and row("R1", "112025")["save_state"] == "P" and row("R1", "112025")["status"] == "saved", "track polls it again too: processed")
    # where a return stands, for the screen
    r = call(dict(base, action="filing"), "viewer")
    ok(r.get("ok") and r["filing"]["arn"] == "AA09082026100042X" and "payload" not in r["filing"] and r.get("host") == "test" and len(r["log"]) >= 8, "a viewer may see where a return stands and its log (not the payload)")
    # the log: every call, with who, form, period, result and ARN; never the OTP
    L = logs("R1", "082026"); acts = [l["action"] for l in L]
    ok(all(a in acts for a in ["save", "summary", "confirm", "proceed", "evc_otp", "file"]) and all(l["by_user"] for l in L) and any(l["action"] == "file" and l["ok"] and l["arn"] == "AA09082026100042X" for l in L), "every call logged: action, who, result, ARN")
    ok(any(l["action"] == "file" and not l["ok"] and "******" in (l["result"] or "") for l in L), "the failed File logged with the OTP masked")
    everything = json.dumps(F.T) + "".join(log); i = everything.find(OTP_BAD)
    if i >= 0: print("   found at:", everything[max(0, i - 200):i + 50])
    ok(OTP_OK not in everything and OTP_BAD not in everything, "no EVC OTP in any table, the log, or the function's own log")
finally:
    fn.kill()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
