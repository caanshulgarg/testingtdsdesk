"""python3 run_zoho_server.py - the zoho-books function (server/zoho-books/index.ts, under Deno) against a stand-in Zoho
(fake_zoho.py, the test organisation of tests/fixtures/zoho) and a throwaway PostgreSQL built with staging's migrations and
migration 75 (zoho_stand.py). TEST DATA ONLY. Nothing real is reached: Zoho, Supabase and the database are stand-ins.

  1. set-up: the client id and secret only as "configured" (never their values); a staff member cannot connect, the owner can;
     Zoho's approval page asked with the minimal ZohoBooks.* scopes on the India data centre; the redirect taken once only;
     the tokens in Vault and nowhere else (no table, no log line, no answer carries them)
  2. linking: a client of another PAN is refused; the organisation linked to its client: the first read stores every
     document in FinCom's cloud copy marked source 'zoho' (17 live, 1 cancelled, the draft and the bank line booked by its
     own payment left out)
  3. the books as the app reads them (TCloud.copyHeads / copyInto, BookSrc) through FinCom's own TDS and GST code
     (e2e_tdsgst_app.js): GSTR-1 and GSTR-3B for May 2026 and 26Q for Q1 2026-27 exactly as the answer key (expected.json,
     by hand), to the paisa; the bank's balance from the cloud's ready totals
  4. incremental: a second run fetches no document; one invoice changed in Zoho is fetched alone and the returns follow it
  5. deletions: a bill deleted in Zoho is marked deleted in FinCom at the daily id comparison (never removed); a list
     that suddenly lacks every invoice is not applied (held, said)
  6. limits: Zoho's 429 (a minute) is waited out and the run completes; the daily limit ends the run and moves the next one
     past midnight IST; the database's own count stops at 90 calls a minute
  7. tokens: an access token Zoho no longer takes (401) is renewed with the refresh token and the call goes on; a refresh
     Zoho refuses marks the organisation "sign in again"
  8. posting: a FinCom bill posted as a Zoho bill (reference FC:<id>, notes TDSDesk:<id>, TDS and GST as Zoho's own taxes);
     posted again: "already", nothing sent; one stuck half-way is found in Zoho by its reference, not sent twice; Errors rows
     carry Zoho's own words (a bill number Zoho already has) or FinCom's (GST not at the rate Zoho would apply, a ledger
     Zoho does not have); one posting at a time per organisation; a bank expense posted as a Zoho expense
  9. never a PUT or DELETE to Zoho; disconnect (owner only) revokes the token at Zoho and deletes nothing
 10. row-level security: another firm sees none of it; a member sees no secret, no hash; the webhook and the cron key
Needs Deno (DENO, else /opt/deno/deno) and the app's test build (site-test/: python3 build.py)."""
import os, sys, json, time, subprocess, threading, tempfile, shutil, urllib.request, urllib.error, hashlib, re
from urllib.parse import urlparse, parse_qs
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS, fake_zoho as FZ, zoho_stand
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
FX = os.path.join(HERE, "fixtures", "zoho"); EXP = json.load(open(os.path.join(FX, "expected.json"))); SETUP = json.load(open(os.path.join(FX, "setup.json")))
OUT = os.environ.get("TDSDESK_OUT") or os.path.join(HERE, "out"); os.makedirs(OUT, exist_ok=True)
PG_PORT, FS.PORT, FZ_PORT, FN_PORT = int(os.environ.get("PG75_PORT", "30751")), 30752, 30753, 30754
FIRM, OWNER, STAFF = "99999999-9999-9999-9999-999999999975", "55555555-5555-5555-5555-555555555575", "66666666-6666-6666-6666-666666666675"
FIRM2, OWNER2 = "88888888-8888-8888-8888-888888888875", "77777777-7777-7777-7777-777777777775"
CID, CID_OTHER = "zt", "zx"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def lit(v):
    if v is None: return "null"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return repr(v)
    if isinstance(v, (dict, list)): return q(json.dumps(v)) + "::jsonb"
    return q(v)

db = zoho_stand.build(PG_PORT)
fn = None; log = []; TMP = tempfile.mkdtemp(prefix="fincom-zoho-")
try:
    db.sql("""insert into firms values (%(F)s, 'Zoho test firm'), (%(F2)s, 'Another firm') on conflict do nothing;
      insert into members (user_id, firm_id, name, role, active) values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(O2)s, %(F2)s, 'Other owner', 'owner', true);
      insert into clients (id, firm_id, name, gstin, pan) values (%(C)s, %(F)s, 'FinCom Zoho Test Pvt Ltd', '27AAACZ1234Z1ZG', 'AAACZ1234Z'), (%(CX)s, %(F)s, 'Someone else', '27AAACX9999X1ZA', 'AAACX9999X');"""
           % {"F": q(FIRM), "F2": q(FIRM2), "O": q(OWNER), "S": q(STAFF), "O2": q(OWNER2), "C": q(CID), "CX": q(CID_OTHER)})
    VOID = {r["proname"] for r in db.rows("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prorettype = 'void'::regtype")}
    HAVE = {r["proname"] for r in db.rows("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")}
    real = FS.rpc
    def rpc(name, a):
        if name in HAVE and (name.startswith("zoho_") or name.startswith("tally_")):
            args = ", ".join("%s => %s" % (k, lit(v)) for k, v in a.items())
            try:
                if name in VOID: db.sql("select public.%s(%s);" % (name, args)); return None
                return json.loads(db.one("select to_jsonb(public.%s(%s))::text" % (name, args)) or "null")
            except RuntimeError as e: raise RuntimeError(re.sub(r"^.*?ERROR:\s*", "", str(e).split("\n")[0])[:300])
        return real(name, a)
    FS.rpc = rpc
    FS.USERS.update({"tok-owner": {"id": OWNER, "email": "o@test.invalid"}, "tok-staff": {"id": STAFF, "email": "s@test.invalid"}, "tok-other": {"id": OWNER2, "email": "x@test.invalid"}})
    FS.start(); FZ.start(FZ_PORT)
    URL = "http://127.0.0.1:%d/" % FN_PORT
    wrap = os.path.join(TMP, "serve.ts")
    open(wrap, "w").write("const s = Deno.serve; (Deno as any).serve = (h: any) => s({ port: %d, hostname: \"127.0.0.1\" }, h);\nawait import(%s);\n"
                          % (FN_PORT, json.dumps("file://" + os.path.abspath(os.path.join(HERE, "..", "server", "zoho-books", "index.ts")))))
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key",
               ZOHO_ACCOUNTS_URL="http://127.0.0.1:%d" % FZ_PORT, ZOHO_API_URL="http://127.0.0.1:%d" % FZ_PORT, ZOHO_REDIRECT_URI=URL,
               ZOHO_CLIENT_ID=FZ.CLIENT_ID, ZOHO_CLIENT_SECRET=FZ.CLIENT_SECRET, ZOHO_MIN_GAP_MS="0", ZOHO_RUN_SECS="90", ALLOWED_ORIGINS="http://127.0.0.1:8000")
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", wrap], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    def call(body, tok="tok-owner", headers=None, path="", method="POST"):
        h = {"Content-Type": "application/json"}; h.update(headers or {})
        if tok: h["Authorization"] = "Bearer " + tok
        rq = urllib.request.Request(URL + path, data=json.dumps(body).encode() if method == "POST" else None, headers=h, method=method)
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k): return None
        try: r = urllib.request.build_opener(NoRedirect).open(rq, timeout=240); return r.status, json.loads(r.read() or b"{}"), r.headers
        except urllib.error.HTTPError as e:
            b = e.read()
            try: return e.code, json.loads(b or b"{}"), e.headers
            except ValueError: return e.code, {"_raw": b[:300].decode("utf-8", "replace")}, e.headers
    for i in range(480):
        try: urllib.request.urlopen(URL, timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    else: raise SystemExit("the function did not start: " + "".join(log)[-1500:])
    def zcalls(method=None, path_re=None):
        return [x for x in FZ.LOG if (method is None or x["method"] == method) and (path_re is None or re.search(path_re, x["path"]))]
    def conn_row(): return db.rows("select * from zoho_connections where firm_id = %s" % q(FIRM))[0]

    # ================================================================ 1. set-up and signing in
    print("== 1. set-up and signing in")
    c, r, _ = call({"kind": "config"}, tok="tok-staff")
    ok(c == 200 and r.get("configured") is True and r.get("redirectUri") == URL, "config: Zoho is set up, the redirect URI is the function's own (%s)" % r)
    ok(FZ.CLIENT_ID not in json.dumps(r) and FZ.CLIENT_SECRET not in json.dumps(r), "config never says the client id or the secret")
    ok(set(r.get("scopes", [])) == {"ZohoBooks.settings.READ", "ZohoBooks.accountants.READ", "ZohoBooks.accountants.CREATE", "ZohoBooks.contacts.READ", "ZohoBooks.contacts.CREATE",
        "ZohoBooks.invoices.READ", "ZohoBooks.creditnotes.READ", "ZohoBooks.customerpayments.READ", "ZohoBooks.bills.READ", "ZohoBooks.bills.CREATE", "ZohoBooks.debitnotes.READ",
        "ZohoBooks.vendorpayments.READ", "ZohoBooks.expenses.READ", "ZohoBooks.expenses.CREATE", "ZohoBooks.banking.READ"}, "the scopes: ZohoBooks.* READ, and CREATE only for bills, expenses, journals (accountants) and contacts; never UPDATE, DELETE or ALL")
    c, r, _ = call({"kind": "connect_start", "back": "http://127.0.0.1:8000/index.html"}, tok="tok-staff")
    ok(c == 403, "a staff member cannot connect Zoho (%s %s)" % (c, r.get("error")))
    c, r, _ = call({"kind": "connect_start", "back": "http://127.0.0.1:8000/index.html"})
    au = urlparse(r.get("url", "")); aq = {k: v[0] for k, v in parse_qs(au.query).items()}
    ok(c == 200 and au.path == "/oauth/v2/auth" and aq.get("access_type") == "offline" and aq.get("response_type") == "code" and aq.get("redirect_uri") == URL and aq.get("client_id") == FZ.CLIENT_ID,
       "the owner gets Zoho's own approval page (accounts server, offline access, the function as redirect URI)")
    state = aq.get("state", "")
    c, r, h = call(None, tok=None, path="?code=code-good&state=%s&location=in&accounts-server=x" % state, method="GET")
    loc = (h or {}).get("Location", "")
    grant = parse_qs(urlparse(loc.replace("#", "?", 1)).query.split("?")[-1]).get("grant", [""])[0] if "grant=" in loc else ""
    grant = re.search(r"grant=([0-9a-f-]{36})", loc).group(1) if re.search(r"grant=([0-9a-f-]{36})", loc) else ""
    ok(c == 302 and loc.startswith("http://127.0.0.1:8000/index.html#/integrations/zoho?grant=") and grant, "Zoho's redirect: the code taken, back to FinCom's Zoho page with the sign-in (%s)" % loc)
    FZ.CODES.add("code-good")
    c, r, h = call(None, tok=None, path="?code=code-good&state=%s&location=in" % state, method="GET")
    ok(c == 302 and "zoho=expired" in (h or {}).get("Location", ""), "the same state a second time: refused (once only)")
    vault = {x["name"]: x["secret"] for x in db.rows("select name, secret from vault.secrets where name like 'zoho:%'")}
    ok(set(vault) == {"zoho:%s:%s:refresh" % (FIRM, grant), "zoho:%s:%s:access" % (FIRM, grant)} and all(v.startswith("1000.") for v in vault.values()), "the refresh and access tokens are in Vault, by firm and sign-in")
    g = db.rows("select orgs::text as orgs from zoho_grants where id = %s" % q(grant))[0]
    ok("60012345678" in g["orgs"] and "27AAACZ1234Z1ZG" in g["orgs"] and "Another Org" in g["orgs"], "the organisations the sign-in reaches are listed (names and GSTINs only)")
    def no_tokens(where):
        toks = set(vault.values()) | set(FZ.ACCESS) | set(FZ.REFRESH)
        dump = db.one("select concat_ws('|', (select string_agg(to_jsonb(t)::text, ',') from zoho_grants t), (select string_agg(to_jsonb(t)::text, ',') from zoho_connections t), (select string_agg(to_jsonb(t)::text, ',') from zoho_log t), (select string_agg(to_jsonb(t)::text, ',') from zoho_posts t), (select string_agg(to_jsonb(t)::text, ',') from zoho_post_jobs t), (select string_agg(to_jsonb(t)::text, ',') from zoho_objects t))") or ""
        hit = [t for t in toks if t and (t in dump or t in "".join(log))]
        ok(not hit, "%s: no token in any table or the function's log" % where)
    no_tokens("after signing in")

    # ================================================================ 2. linking and the first read
    print("== 2. linking the organisation to its client; the first read")
    c, r, _ = call({"kind": "link", "grant": grant, "org": "60012345678", "client": CID_OTHER})
    ok(c != 200 or not r.get("ok"), "an organisation is never linked to a client of another PAN (%s)" % (r.get("error") or "")[:120])
    c, r, _ = call({"kind": "link", "grant": grant, "org": "60012345678", "client": CID}, tok="tok-staff")
    ok(c == 403, "a staff member cannot link")
    t0 = time.time()
    c, r, _ = call({"kind": "link", "grant": grant, "org": "60012345678", "client": CID, "from": "2026-04-01"})
    ok(c == 200 and r.get("ok") and not r["first"]["error"], "the owner links it; the first read runs (%.1f s, %s)" % (time.time() - t0, r.get("first")))
    BOOK = r.get("book")
    V = db.rows("select guid, vtype, vno, cancelled::text as c, deleted_at, source, origin from tally_vouchers where book_id = %s" % q(BOOK))
    live = [v for v in V if v["c"] == "false" and not v["deleted_at"]]
    ok(len(live) == EXP["entries"]["live"] and len([v for v in V if v["c"] == "true"]) == EXP["entries"]["cancelled"], "the cloud copy: %d live entries, %d cancelled (INV-008 void)" % (len(live), len([v for v in V if v["c"] == "true"])))
    ok(all(v["source"] == "zoho" for v in V), "every entry is marked source 'zoho'")
    ok(not any(v["vno"] == "INV-007" for v in V), "the draft INV-007 is not in the books")
    sk = db.rows("select entity, skipped from zoho_seen where skipped is not null")
    ok(any(x["entity"] == "invoices" and x["skipped"] == "draft" for x in sk) and any(x["entity"] == "banktransactions" and "own document" in x["skipped"] for x in sk), "held, not booked: the draft and the bank line booked by its own payment (%s)" % sk)
    bk = db.rows("select source, company, from_date::text as f, client_id from tally_books where book_id = %s" % q(BOOK))[0]
    ok(bk["source"] == "zoho" and bk["client_id"] == CID and bk["f"] == "2026-04-01", "the client's book: source zoho, from 1-Apr-2026 (%s)" % bk)
    L = {x["name"]: x for x in db.rows("select name, parent, pan, gstin, tds_nature, open::text as open, source from tally_ledgers where book_id = %s" % q(BOOK))}
    ok(L.get("Omicron Contractors", {}).get("pan") == "AAACO5555O" and L["Omicron Contractors"]["tds_nature"] == "194C" and L["Omicron Contractors"]["parent"] == "Sundry Creditors", "a vendor's ledger: PAN, TDS section and group from Zoho's contact")
    ok(L.get("Alpha Traders Mumbai", {}).get("gstin") == "27AAAFA1111A1ZM", "a customer's ledger carries its GSTIN")
    ok(L.get("Output CGST", {}).get("parent") == "Duties & Taxes" and L.get("TDS Payable 194J", {}).get("parent") == "Duties & Taxes", "the GST and TDS ledgers under Duties & Taxes")
    ok(float(L.get("HDFC Bank", {}).get("open") or 0) == -500000, "the opening balance from Zoho's opening balances (HDFC Bank 5,00,000 Dr)")
    G = {x["guid"]: x for x in db.rows("select guid, gst_nature, gst_country, gst_rcm::text as rcm, gst_reg_type from tally_vouchers where book_id = %s" % q(BOOK))}
    def gv(no): return next(G[v["guid"]] for v in V if v["vno"] == no)
    ok(gv("INV-003")["gst_nature"] == "Sales to SEZ - Taxable" and gv("INV-004")["gst_country"] == "Germany" and gv("MU/7")["rcm"] == "true", "Zoho's own GST treatment kept: SEZ with tax, export (country), reverse charge")
    no_tokens("after the first read")

    # ================================================================ 3. the returns, through FinCom's own code
    print("== 3. GSTR-1, GSTR-3B and 26Q from the cloud copy, through FinCom's own code")
    def snapshot():
        B = q(BOOK)
        tv = db.rows("select book_id::text as book_id, guid, day::text as day, alter_id::text as alter_id, vtype, vno, party, narration, cancelled::text as cancelled, optional::text as optional, deleted_at::text as deleted_at, gstin, pos, ref, ref_date::text as ref_date, cmp_gstin, irn, irn_ack_date::text as irn_ack_date, gst_reg_type, gst_country, gst_rcm::text as gst_rcm, gst_nature, gst_taxability, gst_supply, gst_ineligible::text as gst_ineligible, gst_mixed::text as gst_mixed, gst_alter_id::text as gst_alter_id, tds_tally, tds_tally_alter_id::text as tds_tally_alter_id from tally_vouchers where book_id = %s" % B)
        for x in tv:
            x["alter_id"] = int(x["alter_id"] or 0); x["cancelled"] = x["cancelled"] == "true"; x["optional"] = x["optional"] == "true"; x["deleted_at"] = x["deleted_at"] or None; x["ref_date"] = x["ref_date"] or None
            for k in ("gst_rcm", "gst_ineligible", "gst_mixed"): x[k] = None if x[k] in (None, "") else x[k] == "true"
            x["gst_alter_id"] = int(x["gst_alter_id"]) if x["gst_alter_id"] else None; x["tds_tally"] = None; x["tds_tally_alter_id"] = None; x["irn_ack_date"] = x["irn_ack_date"] or None
        tl = db.rows("select book_id::text as book_id, guid, ledger, amount::text as amount, hsn, rate::text as rate from tally_lines where book_id = %s" % B)
        for x in tl: x["amount"] = float(x["amount"]); x["rate"] = float(x["rate"]) if x["rate"] not in (None, "") else None
        tb = db.rows("select book_id::text as book_id, guid, ledger, name, type, amount::text as amount, credit_days::text as credit_days from tally_bills where book_id = %s" % B)
        for x in tb: x["amount"] = float(x["amount"]); x["credit_days"] = int(x["credit_days"]) if x["credit_days"] not in (None, "") else None
        led = db.rows("select name, parent, coalesce(pan, '') as pan, coalesce(gstin, '') as gstin from tally_ledgers where book_id = %s and deleted_at is null and merged_into is null" % B)
        gr = db.rows("select name, parent from tally_groups where book_id = %s" % B)
        return {"book": BOOK, "tables": {"tally_vouchers": tv, "tally_lines": tl, "tally_bills": tb, "tally_recorder_lines": []}, "ledgers": led, "groups": gr, "ledgersAt": "", "full": True}
    def run_app(name):
        inp, outp = os.path.join(TMP, "in-%s.json" % name), os.path.join(TMP, "out-%s.json" % name)
        json.dump({"setup": os.path.join(FX, "setup.json"), "phases": [{"name": "p1", "months": [], "masters": None, "gstr1": ["202605"], "threeB": ["202605"], "fileGstr1": [], "copy": snapshot()}]}, open(inp, "w"))
        rr = subprocess.run(["node", os.path.join(HERE, "e2e_tdsgst_app.js"), inp, outp], capture_output=True, text=True, cwd=HERE)
        if rr.returncode: raise SystemExit("e2e_tdsgst_app.js failed: " + (rr.stderr or rr.stdout)[-2000:])
        shutil.copy(outp, os.path.join(OUT, "zoho-fincom-%s.json" % name))
        return json.load(open(outp))["phases"]["p1"]
    def eq(a, b): return abs(float(a or 0) - float(b or 0)) < 0.005
    def check_returns(P, exp, tag):
        g1, g3 = P["gstr1"]["202605"], P["gstr3b"]["202605"]
        for w in exp["gstr1"]["b2b"]:
            inv = next((i for x in g1.get("b2b", []) if x["ctin"] == w["ctin"] for i in x["inv"] if i["inum"] == w["inum"]), None)
            d = (inv or {}).get("itms", [{}])[0].get("itm_det", {})
            ok(inv is not None and eq(inv["val"], w["val"]) and inv["pos"] == w["pos"] and inv["inv_typ"] == w["inv_typ"] and eq(d.get("rt"), w["rt"]) and all(eq(d.get(k), w[k]) for k in ("txval", "iamt", "camt", "samt")),
               "%sGSTR-1 B2B %s %s: %s %s, %s" % (tag, w["inum"], w["inv_typ"], w["txval"], {k: w[k] for k in ("iamt", "camt", "samt")}, "as expected" if inv else "missing"))
        for w in exp["gstr1"]["b2cl"]:
            inv = next((i for x in g1.get("b2cl", []) if x["pos"] == w["pos"] for i in x["inv"] if i["inum"] == w["inum"]), None)
            d = (inv or {}).get("itms", [{}])[0].get("itm_det", {})
            ok(inv is not None and eq(inv["val"], w["val"]) and eq(d.get("txval"), w["txval"]) and eq(d.get("iamt"), w["iamt"]), "%sGSTR-1 B2CL %s (pos %s): %s, IGST %s" % (tag, w["inum"], w["pos"], w["txval"], w["iamt"]))
        got = sorted([(x["sply_ty"], x["pos"], x["rt"], x["txval"], x.get("iamt", 0), x.get("camt", 0), x.get("samt", 0)) for x in g1.get("b2cs", [])])
        want = sorted([(x["sply_ty"], x["pos"], x["rt"], x["txval"], x["iamt"], x["camt"], x["samt"]) for x in exp["gstr1"]["b2cs"]])
        ok(got == want, "%sGSTR-1 B2CS: %s" % (tag, got))
        for w in exp["gstr1"]["cdnr"]:
            n = next((i for x in g1.get("cdnr", []) if x["ctin"] == w["ctin"] for i in x["nt"] if i["nt_num"] == w["nt_num"]), None)
            d = (n or {}).get("itms", [{}])[0].get("itm_det", {})
            ok(n is not None and n["ntty"] == w["ntty"] and eq(n["val"], w["val"]) and all(eq(d.get(k), w[k]) for k in ("txval", "camt", "samt")), "%sGSTR-1 CDNR %s: %s" % (tag, w["nt_num"], w["txval"]))
        for w in exp["gstr1"]["exp"]:
            e = next((i for x in g1.get("exp", []) if x["exp_typ"] == w["exp_typ"] for i in x["inv"] if i["inum"] == w["inum"]), None)
            ok(e is not None and eq(e["val"], w["val"]) and eq(e["itms"][0]["itm_det"]["txval"], w["txval"]), "%sGSTR-1 EXP %s %s: %s" % (tag, w["exp_typ"], w["inum"], w["txval"]))
        docs = [(d["doc_num"], x["from"], x["to"], x["totnum"], x["cancel"], x["net_issue"]) for d in g1.get("doc_issue", {}).get("doc_det", []) for x in d["docs"]]
        ok(sorted(docs) == sorted((w["doc_num"], w["from"], w["to"], w["totnum"], w["cancel"], w["net_issue"]) for w in exp["gstr1"]["doc_issue"]), "%sGSTR-1 documents issued: %s" % (tag, docs))
        s3 = g3["sup_details"]
        for k in ("osup_det", "osup_zero", "isup_rev"):
            ok(all(eq(s3[k].get(f), v) for f, v in exp["gstr3b"][k].items()), "%sGSTR-3B %s: %s" % (tag, k, {f: s3[k].get(f) for f in exp["gstr3b"][k]}))
        av = {x["ty"]: x for x in g3["itc_elg"]["itc_avl"]}
        for ty in ("ISRC", "OTH"):
            ok(all(eq(av[ty].get(f), v) for f, v in exp["gstr3b"]["itc_" + ty].items()), "%sGSTR-3B ITC %s: %s" % (tag, ty, {f: av[ty].get(f) for f in exp["gstr3b"]["itc_" + ty]}))
        ok([(x["pos"], x["txval"], x["iamt"]) for x in g3["inter_sup"]["unreg_details"]] == [(x["pos"], x["txval"], x["iamt"]) for x in exp["gstr3b"]["unreg_details"]], "%sGSTR-3B 3.2 unregistered inter-state" % tag)
    def check_tds(P, exp, tag):
        rows = P["tds"]["rows"]
        for w in exp["tds26q"]:
            g = [x for x in rows if x["party"] == w["party"]]
            ok(len(g) == 1 and all((eq(g[0][k], w[k]) if isinstance(w[k], (int, float)) else g[0][k] == w[k]) for k in ("pan", "section", "date", "paid", "tds", "rate")),
               "%s26Q %s: %s %s paid %s TDS %s at %s%% (%s)" % (tag, w["party"], w["pan"], w["section"], w["paid"], w["tds"], w["rate"], g[0] if g else "missing"))
        ok(len(rows) == len(exp["tds26q"]), "%s26Q: %d deductee rows, no other" % (tag, len(rows)))
        dd = P["tds"]["files"]["26Q"].get("dd") or []
        ok(sorted((d["pan"], d["paid"], d["tds"]) for d in dd) == sorted((w["pan"], "%.2f" % w["paid"], "%.2f" % w["tds"]) for w in exp["tds26q"]), "%sthe 26Q text file's deductee lines (%d)" % (tag, len(dd)))
    P = run_app("first")
    # the cloud copy as the app's REST reads answer it, kept for the page test (run_integrations_ui.py reads the committed
    # copy, tests/fixtures/zoho/copy-snapshot.json, made from this file)
    json.dump(snapshot(), open(os.path.join(OUT, "zoho-copy-snapshot.json"), "w"), indent=0)
    ok(P["sources"]["bridge"] == EXP["entries"]["live"] + EXP["entries"]["cancelled"], "the app brought in %s entries from the cloud copy (%s)" % (P["sources"]["bridge"], P["copyRead"]))
    for n, s in SETUP["ledgers"].items():
        p = P["proposals"].get(n, {})
        ok(p.get("what") == s["what"] and (not s.get("tax") or p.get("tax") == s["tax"]) and (not s.get("side") or p.get("side") == s["side"]) and (not s.get("section") or p.get("section") == s["section"]),
           "FinCom's own proposal for %s: %s %s %s %s (as the CA confirms it)" % (n, p.get("what"), p.get("tax"), p.get("side"), p.get("section")))
    check_returns(P, EXP, "")
    check_tds(P, EXP, "")
    bal = {r["ledger"]: float(r["s"]) for r in db.rows("select ledger, sum(amount)::text as s from tally_ledger_day where book_id = %s and day <= '2026-05-31' group by ledger" % q(BOOK))}
    for led, want in EXP["balances"].items():
        got = round(float(L.get(led, {}).get("open") or 0) + bal.get(led, 0), 2)
        ok(eq(got, want), "balance on 31-May-2026 from the cloud's ready totals: %s %s (expected %s)" % (led, got, want))

    # ================================================================ 4. incremental
    print("== 4. only the changes")
    n0 = len(FZ.LOG)
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]}, tok="tok-staff")
    det = [x for x in FZ.LOG[n0:] if re.search(r"/books/v3/(invoices|bills|creditnotes|vendorcredits|customerpayments|vendorpayments|expenses|journals|banktransactions|contacts)/\d+$", x["path"])]
    ok(c == 200 and r.get("ok") and r["counts"]["fetched"] == 0 and not det, "a second run (by a staff member) fetches no document: nothing changed (%d list calls, %s)" % (len(FZ.LOG) - n0, r.get("counts")))
    inv2 = FZ.find("invoices", invoice_number="INV-002")[0]
    FZ.touch("invoices", inv2["invoice_id"], line_items=[dict(inv2["line_items"][0], rate=210000, item_total=210000)], taxes=[dict(inv2["taxes"][0], tax_amount=37800)], sub_total=210000, tax_total=37800, total=247800)
    alter0 = db.one("select alter_id from tally_vouchers where book_id = %s and vno = 'INV-002'" % q(BOOK))
    n0 = len(FZ.LOG)
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    det = [x["path"] for x in FZ.LOG[n0:] if re.search(r"/books/v3/[a-z]+/\d+$", x["path"])]
    ok(r.get("ok") and det == ["/books/v3/invoices/%s" % inv2["invoice_id"]], "INV-002 changed in Zoho: fetched alone (%s)" % det)
    ok(int(db.one("select alter_id from tally_vouchers where book_id = %s and vno = 'INV-002'" % q(BOOK))) > int(alter0), "its entry is the later version (alter_id from last_modified_time)")
    P2 = run_app("changed")
    b2 = next((i for x in P2["gstr1"]["202605"]["b2b"] if x["ctin"] == "07AAACB2222B1ZL" for i in x["inv"]), {})
    ok(eq(b2.get("val"), 247800) and eq(b2["itms"][0]["itm_det"]["iamt"], 37800) and eq(P2["gstr3b"]["202605"]["sup_details"]["osup_det"]["txval"], 500000), "GSTR-1 and 3B follow the change (2,10,000, IGST 37,800; 3.1(a) 5,00,000)")

    # an account and a customer made in Zoho after the masters were read, used by a new invoice at once
    FZ.STORE["chartofaccounts"].append({"account_id": "470000000080001", "account_name": "Sales - Exports Desk", "account_type": "income", "is_active": True, "last_modified_time": FZ.now_mod()})
    FZ.STORE["contacts"].append({"contact_id": "470000000080002", "contact_name": "Zeta New Buyer", "contact_type": "customer", "gst_treatment": "business_gst", "gst_no": "27AAAFA1111A1ZM", "place_of_contact": "MH", "last_modified_time": FZ.now_mod()})
    FZ.STORE["invoices"].append(dict(FZ.find("invoices", invoice_number="INV-001")[0], invoice_id="470000000080003", invoice_number="INV-009", date="2026-05-30", customer_id="470000000080002", customer_name="Zeta New Buyer",
        line_items=[dict(FZ.find("invoices", invoice_number="INV-001")[0]["line_items"][0], account_id="470000000080001", account_name="Sales - Exports Desk")], last_modified_time=FZ.now_mod()))
    db.sql("update zoho_sync_state set cursor_sec = cursor_sec where false")
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    L9 = {x["ledger"] for x in db.rows("select l.ledger from tally_lines l join tally_vouchers v using (book_id, guid) where v.book_id = %s and v.vno = 'INV-009'" % q(BOOK))}
    led9 = {x["name"]: x["parent"] for x in db.rows("select name, parent from tally_ledgers where book_id = %s and name in ('Sales - Exports Desk', 'Zeta New Buyer')" % q(BOOK))}
    ok(r.get("ok") and L9 >= {"Sales - Exports Desk", "Zeta New Buyer"} and led9 == {"Sales - Exports Desk": "Sales Accounts", "Zeta New Buyer": "Sundry Debtors"},
       "an account and a customer made in Zoho since the masters were read: read at once, the invoice on their own ledgers (%s, %s)" % (sorted(L9), r.get("counts")))
    FZ.remove("invoices", "470000000080003")
    db.sql("update zoho_connections set full_check_at = now() - interval '25 hours'")
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    ok(db.one("select deleted_at is not null from tally_vouchers where book_id = %s and vno = 'INV-009'" % q(BOOK)) == "t", "(and removed again in Zoho: marked deleted, so the answer key's figures stand)")

    # a Zoho that wants the bank account for its bank transactions: listed account by account (a transfer is in two, read once)
    FZ.BANK_NEEDS_ACCOUNT[0] = True
    trf = FZ.find("banktransactions", transaction_type="transfer_fund")[0]
    FZ.touch("banktransactions", trf["transaction_id"], description="to ICICI, checked")
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    ok(r.get("ok") and r["counts"]["fetched"] == 1 and any(x["query"].get("account_id") for x in FZ.LOG if x["path"] == "/books/v3/banktransactions"), "bank transactions listed per bank account when Zoho asks for one; the transfer read once (%s)" % r.get("counts"))
    FZ.BANK_NEEDS_ACCOUNT[0] = False

    # ================================================================ 5. deletions
    print("== 5. deletions, by the daily id comparison")
    oc = FZ.find("bills", bill_number="PC/9")[0]
    FZ.remove("bills", oc["bill_id"])
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    ok(r.get("full") is False or (r.get("counts") or {}).get("gone", 0) == 0, "not before the daily comparison is due (%s)" % r.get("counts"))
    db.sql("update zoho_connections set full_check_at = now() - interval '25 hours'")
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    pc = db.rows("select deleted_at::text as d from tally_vouchers where book_id = %s and vno = 'PC/9'" % q(BOOK))
    ok(r.get("full") is True and r["counts"]["gone"] == 1 and pc and pc[0]["d"], "the bill deleted in Zoho is marked deleted in FinCom (kept, not removed) (%s)" % r.get("counts"))
    P3 = run_app("deleted")
    ok(not any(x["party"] == "Pi Consultants" for x in P3["tds"]["rows"]), "and is out of the 26Q")
    FZ.HIDE.update(str(x["invoice_id"]) for x in FZ.STORE["invoices"])
    db.sql("update zoho_connections set full_check_at = now() - interval '25 hours'")
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    nlive = int(db.one("select count(*) from tally_vouchers where book_id = %s and vtype = 'Sales' and deleted_at is null and not cancelled" % q(BOOK)))
    held = db.rows("select message from zoho_log where kind = 'error' and message like '%%no longer listed%%'")
    ok(nlive == 6 and held, "a list that suddenly lacks every invoice is NOT applied (held and said: %s)" % (held[0]["message"] if held else "none"))
    FZ.HIDE.clear()

    # ================================================================ 6. limits
    print("== 6. Zoho's limits")
    FZ.touch("invoices", inv2["invoice_id"], notes="touched for the 429 test")
    FZ.FAIL_429.update(n=2, daily=False, retry=1)
    t0 = time.time(); c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    ok(r.get("ok") and r["counts"]["fetched"] == 1 and FZ.FAIL_429["n"] == 0, "two 429s (a minute) waited out by Retry-After; the run completes (%.1f s, %s)" % (time.time() - t0, r.get("counts")))
    FZ.touch("invoices", inv2["invoice_id"], notes="touched for the daily test")
    FZ.FAIL_429.update(n=1, daily=True)
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    cr = conn_row()
    nxt = db.one("select extract(epoch from next_sync_at - now())::int from zoho_connections where firm_id = %s" % q(FIRM))
    ok(not r.get("ok") and "daily" in (r.get("error") or "") and int(nxt) >= 30 * 60 and cr["last_error"], "Zoho's daily limit: the run ends, said, the next run after midnight IST (in %s min)" % (int(nxt) // 60))
    FZ.FAIL_429["n"] = 0
    db.sql("delete from zoho_api_usage")   # (the test's own reset; the migration never removes rows)
    cnt = [db.one("select (public.zoho_api_take(id, 1, 90))->>'ok' from zoho_connections where firm_id = %s" % q(FIRM)) for _ in range(91)]
    ok(cnt[:90] == ["true"] * 90 and cnt[90] == "false", "the database's own count: 90 calls a minute, the 91st waits")
    db.sql("update zoho_api_usage set calls = 951, minute_calls = 0, minute = null")
    w = json.loads(db.one("select public.zoho_api_take(id, 1, 90)::text from zoho_connections where firm_id = %s" % q(FIRM)))
    ok(w["ok"] is False and w["daily"] is True, "and 95%% of the plan's daily cap (1,000): no more calls today (%s)" % w)
    db.sql("delete from zoho_api_usage; update zoho_connections set next_sync_at = now(), last_error = null")

    # ================================================================ 7. tokens
    print("== 7. the access token renewed; a refused refresh")
    FZ.EXPIRE_ALL()
    db.sql("update zoho_grants set token_expires_at = now() + interval '50 minutes'")   # FinCom still thinks the token is good
    nref = len([x for x in FZ.LOG if x["path"] == "/oauth/v2/token"])
    FZ.touch("invoices", inv2["invoice_id"], notes="touched for the token test")
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    nref2 = len([x for x in FZ.LOG if x["path"] == "/oauth/v2/token"])
    ok(r.get("ok") and nref2 == nref + 1 and r["counts"]["fetched"] == 1, "Zoho answered 401: the token renewed once with the refresh token, the run went on (%s)" % r.get("counts"))
    newacc = db.one("select secret from vault.secrets where name like 'zoho:%%:access'")
    ok(newacc in FZ.ACCESS and FZ.ACCESS[newacc]["until"] > time.time(), "the new access token is in Vault")
    vault = {x["name"]: x["secret"] for x in db.rows("select name, secret from vault.secrets where name like 'zoho:%'")}
    no_tokens("after the renewal")
    FZ.EXPIRE_ALL(); FZ.REFRESH_OK[0] = False
    db.sql("update zoho_grants set token_expires_at = now() - interval '1 minute'")
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    ok(not r.get("ok") and "Reconnect" in (r.get("error") or "") and conn_row()["status"] == "needs_sign_in", "a refresh Zoho refuses: 'sign in again', the organisation marked so (%s)" % r.get("error"))
    FZ.REFRESH_OK[0] = True; db.sql("update zoho_connections set status = 'connected', next_sync_at = now(), last_error = null")

    # ================================================================ 8. posting
    print("== 8. posting FinCom's entries to Zoho")
    def bill_entry(fid, ref, base, cgst, tds=0, vendor="Omicron Contractors", exp_led="Contract Charges", tds_led="TDS Payable 194C"):
        lines = [{"ledger": exp_led, "dr": True, "amount": base}, {"ledger": "Input CGST", "dr": True, "amount": cgst}, {"ledger": "Input SGST", "dr": True, "amount": cgst}]
        if tds: lines.append({"ledger": tds_led, "dr": False, "amount": tds})
        lines.append({"ledger": vendor, "dr": False, "amount": round(base + 2 * cgst - tds, 2)})
        return {"id": fid, "type": "Journal", "date": "2026-05-20", "no": "", "ref": ref, "party": vendor, "narration": "Contract work May TDSDesk:" + fid, "lines": lines}
    n0 = len(FZ.LOG)
    c, r, _ = call({"kind": "post", "client": CID, "entries": [bill_entry("e_b1", "OC/77", 40000, 3600, 800)]}, tok="tok-staff")
    res = (r.get("results") or [{}])[0]
    posted = [x for x in FZ.LOG[n0:] if x["method"] == "POST" and x["path"] == "/books/v3/bills"]
    body = posted[0]["body"] if posted else {}
    ok(c == 200 and res.get("ok") and res["zoho"]["kind"] == "bill" and len(posted) == 1, "a FinCom bill posted (by a staff member) as a Zoho bill (%s)" % res.get("message"))
    ok(body.get("reference_number") == "FC:e_b1" and "TDSDesk:e_b1" in body.get("notes", "") and body.get("bill_number") == "OC/77", "FinCom's id in the reference (FC:e_b1) and the notes; the supplier's bill number")
    tg = FZ.find("taxes", tax_name="GST18")[0]["tax_id"]; tt = FZ.find("tdstaxes", tax_name="Payment to Contractors (Others)")[0]["tax_id"]
    ok(body.get("line_items", [{}])[0].get("tax_id") == tg and body.get("tds_tax_id") == tt and body["line_items"][0]["rate"] == 40000, "GST as Zoho's own tax group (GST18) and TDS as its TDS tax (194C)")
    zb = FZ.find("bills", reference_number="FC:e_b1")[0]
    ok(zb["total"] == 46400 and zb["tds_amount"] == 800, "Zoho's own working of the bill agrees with FinCom's (40,000 + GST 7,200 - TDS 800 = 46,400 payable)")
    st = db.rows("select state, zoho_id, zoho_number from zoho_posts where fincom_id = 'e_b1'")[0]
    ok(st["state"] == "posted" and st["zoho_id"] == str(zb["bill_id"]), "Posted, with Zoho's id, in zoho_posts")
    n0 = len(FZ.LOG)
    c, r, _ = call({"kind": "post", "client": CID, "entries": [bill_entry("e_b1", "OC/77", 40000, 3600, 800)]})
    res = r["results"][0]
    ok(res.get("ok") and res.get("already") and not [x for x in FZ.LOG[n0:] if x["method"] == "POST"], "posted again: already in Zoho, nothing sent (%s)" % res.get("message"))
    # a posting that stopped after Zoho took it (state 'posting', its reply lost): found by its reference, not sent twice
    FZ.STORE["bills"].append(dict(zb, bill_id="470000000099999", bill_number="OC/78", reference_number="FC:e_b2"))
    db.sql("insert into zoho_posts (connection_id, fincom_id, firm_id, client_id, kind, state) select id, 'e_b2', firm_id, client_id, 'bill', 'posting' from zoho_connections where firm_id = %s" % q(FIRM))
    n0 = len(FZ.LOG)
    c, r, _ = call({"kind": "post", "client": CID, "entries": [bill_entry("e_b2", "OC/78", 40000, 3600, 800)]})
    res = r["results"][0]
    ok(res.get("ok") and res.get("already") and not [x for x in FZ.LOG[n0:] if x["method"] == "POST"] and db.one("select state from zoho_posts where fincom_id = 'e_b2'") == "posted",
       "one stuck half-way: Zoho asked by its reference first, found, marked Posted, not sent twice")
    # errors, with Zoho's words and FinCom's
    c, r, _ = call({"kind": "post", "client": CID, "entries": [bill_entry("e_b3", "OC/77", 10000, 900, 200)]})
    res = r["results"][0]
    ok(not res.get("ok") and "already used for this vendor" in res.get("message", "") and db.one("select message from zoho_posts where fincom_id = 'e_b3'").startswith("Zoho: This bill number"),
       "Zoho refuses a bill number it has: Errors, with Zoho's own words (%s)" % res.get("message"))
    c, r, _ = call({"kind": "post", "client": CID, "entries": [bill_entry("e_b4", "OC/80", 10000, 950)]})
    res = r["results"][0]
    ok(not res.get("ok") and "is not" in res.get("message", "") and not FZ.find("bills", reference_number="FC:e_b4"), "GST not at the rate Zoho would apply: Errors, nothing sent (%s)" % res.get("message"))
    c, r, _ = call({"kind": "post", "client": CID, "entries": [dict(bill_entry("e_b5", "OC/81", 10000, 900), lines=[{"ledger": "Travel Abroad", "dr": True, "amount": 11800}, {"ledger": "Omicron Contractors", "dr": False, "amount": 11800}])]})
    res = r["results"][0]
    ok(not res.get("ok") and "Not in Zoho Books: Travel Abroad" in res.get("message", ""), "a ledger Zoho does not have: Errors, says which (%s)" % res.get("message"))
    db.sql("update zoho_connections set post_lease_until = now() + interval '5 minutes' where firm_id = %s" % q(FIRM))
    c, r, _ = call({"kind": "post", "client": CID, "entries": [bill_entry("e_b6", "OC/82", 10000, 900)]})
    ok(not r.get("ok") and r.get("busy"), "one posting at a time per organisation: a second one waits (%s)" % r.get("error"))
    db.sql("update zoho_connections set post_lease_until = null where firm_id = %s" % q(FIRM))
    bank = {"id": "e_k1", "type": "Payment", "date": "2026-05-29", "narration": "Office tea", "lines": [{"ledger": "Office Expenses", "dr": True, "amount": 500}, {"ledger": "HDFC Bank", "dr": False, "amount": 500}]}
    c, r, _ = call({"kind": "post", "client": CID, "entries": [bank]})
    res = r["results"][0]; ex = FZ.find("expenses", reference_number="FC:e_k1")
    ok(res.get("ok") and res["zoho"]["kind"] == "expense" and ex and ex[0]["paid_through_account_id"] == FZ.find("chartofaccounts", account_name="HDFC Bank")[0]["account_id"], "a bank entry posted as a Zoho expense, paid through HDFC Bank")
    jv = {"id": "e_j1", "type": "Payment", "date": "2026-05-30", "narration": "Rent paid", "lines": [{"ledger": "Sigma Landlord", "dr": True, "amount": 75000}, {"ledger": "HDFC Bank", "dr": False, "amount": 75000}]}
    c, r, _ = call({"kind": "post", "client": CID, "entries": [jv], "masters": [{"id": "led:New Vendor LLP", "name": "New Vendor LLP", "group": "Sundry Creditors", "gstin": "27AAACZ1234Z1ZG"}, {"id": "led:Crypto Gains", "name": "Crypto Gains", "group": "Indirect Incomes"}]})
    rs = {x["id"]: x for x in r["results"]}
    ok(rs["e_j1"].get("ok") and rs["e_j1"]["zoho"]["kind"] == "journal" and FZ.find("journals", reference_number="FC:e_j1")[0]["line_items"][0].get("customer_id") == FZ.find("contacts", contact_name="Sigma Landlord")[0]["contact_id"],
       "a payment to a party posted as a journal, the party's line on its contact")
    ok(rs["led:New Vendor LLP"].get("ok") and FZ.find("contacts", contact_name="New Vendor LLP") and not rs["led:Crypto Gains"].get("ok") and "Create the account" in rs["led:Crypto Gains"]["message"],
       "a new party is made in Zoho as a contact; an account never (says so)")
    db.sql("update zoho_connections set next_sync_at = now()")
    c, r, _ = call({"kind": "sync_now", "connection": conn_row()["id"]})
    fb = db.rows("select origin, fincom_id from tally_vouchers where book_id = %s and ref = 'OC/77'" % q(BOOK))
    ok(fb and fb[0]["fincom_id"] == "e_b1" and fb[0]["origin"] == "fincom", "the posted bill comes back with the next read, as FinCom's own (fincom_id e_b1, origin fincom)")

    # the app's own way in: what Bridge.post would send to Tally (the purchase voucher's XML, as fixtures/post-shapes/purchase-bill.xml
    # is made), read by the app's voucherPreview into the entry ZohoB.post sends (src/js/74)
    XML = """<VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Accounting Voucher View">
<DATE>20260522</DATE><EFFECTIVEDATE>20260522</EFFECTIVEDATE><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME><VOUCHERNUMBER>OC/90</VOUCHERNUMBER><REFERENCE>OC/90</REFERENCE>
<REFERENCEDATE>20260522</REFERENCEDATE><PARTYLEDGERNAME>Omicron Contractors</PARTYLEDGERNAME><NARRATION>Bill OC/90 from Omicron Contractors | TDSDesk:pb90</NARRATION>
<ISINVOICE>No</ISINVOICE><ISOPTIONAL>No</ISOPTIONAL>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Contract Charges</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-20000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Input CGST</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1800.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Input SGST</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1800.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>TDS Payable 194C</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>400.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Omicron Contractors</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>23200.00</AMOUNT>
<BILLALLOCATIONS.LIST><NAME>OC/90</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>23200.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>
</VOUCHER>"""
    conv = subprocess.run(["node", "-e", """const {load, HTML} = require('./harness'); const {x} = load(HTML, ['r2', 'pvText', 'voucherPreview']);
      const v = {id: 'pb90', xml: process.argv[1]}, p = x.voucherPreview(v.xml);
      console.log(JSON.stringify({id: v.id, type: p.type, date: p.date, no: p.number, ref: p.ref, party: p.party, narration: p.narration, lines: p.lines.map(l => ({ledger: l.ledger, dr: !!l.dr, amount: l.amount}))}));""", XML],
      capture_output=True, text=True, cwd=HERE)
    ent = json.loads(conv.stdout.strip().splitlines()[-1]) if conv.returncode == 0 else {}
    ok(ent.get("date") == "2026-05-22" and len(ent.get("lines", [])) == 5, "the app's voucherPreview reads the purchase voucher FinCom would send to Tally (%s)" % (conv.stderr[-200:] if conv.returncode else ent.get("ref")))
    c, r, _ = call({"kind": "post", "client": CID, "entries": [ent]})
    zb = FZ.find("bills", reference_number="FC:pb90")
    ok(r.get("results", [{}])[0].get("ok") and zb and zb[0]["bill_number"] == "OC/90" and zb[0]["total"] == 23200 and zb[0]["tds_amount"] == 400, "that same voucher posted as a Zoho bill: OC/90, payable 23,200 after TDS 400, as FinCom worked it out")
    # ================================================================ the webhook and the scheduled run
    print("== 8b. the webhook and the scheduled run")
    c, r, _ = call({"kind": "hook_new", "connection": conn_row()["id"]}, tok="tok-staff")
    ok(c == 403, "a staff member cannot make the webhook address")
    c, r, _ = call({"kind": "hook_new", "connection": conn_row()["id"]})
    hk = r.get("url", "")
    ok(c == 200 and "?hook=" in hk and hashlib.sha256(hk.split("hook=")[1].encode()).hexdigest() == conn_row()["hook_hash"], "the webhook address shown once; only its SHA-256 kept")
    db.sql("update zoho_connections set next_sync_at = now() + interval '1 hour'")
    c, r, _ = call({}, tok=None, path="?hook=" + hk.split("hook=")[1])
    ok(c == 200 and int(db.one("select extract(epoch from next_sync_at - now())::int from zoho_connections where firm_id = %s" % q(FIRM))) <= 60, "a Zoho webhook brings the next read within a minute")
    c, r, _ = call({}, tok=None, path="?hook=nonsense")
    ok(c == 404, "an unknown webhook token: 404")
    c, r, _ = call({"kind": "sync"}, tok=None, headers={"x-fincom-zoho-cron": "wrong"})
    ok(c == 401, "the scheduled run with a wrong key: refused")
    key = db.one("select secret from vault.secrets where name = 'zoho_cron_key'")
    db.sql("update zoho_connections set next_sync_at = now() - interval '1 minute', sync_lease_until = null")
    c, r, _ = call({"kind": "sync"}, tok=None, headers={"x-fincom-zoho-cron": key})
    ok(c == 200 and r.get("ok") and len(r.get("done", [])) == 1 and not r["done"][0].get("error"), "the scheduled run with the key from Vault reads the organisation that is due (%s)" % r.get("done"))
    # ================================================================ 9. never an edit or a delete; disconnect
    print("== 9. never an edit or a delete in Zoho; disconnect")
    bad = [x for x in FZ.LOG if x["method"] in ("PUT", "DELETE", "PATCH") or (x["method"] == "POST" and x["path"].startswith("/books/") and x["path"] not in ("/books/v3/bills", "/books/v3/expenses", "/books/v3/journals", "/books/v3/contacts"))]
    ok(not bad, "no PUT, PATCH or DELETE and no other POST was ever sent to Zoho (%d calls in all)" % len(FZ.LOG))
    nv = int(db.one("select count(*) from tally_vouchers where book_id = %s" % q(BOOK)))
    c, r, _ = call({"kind": "disconnect", "connection": conn_row()["id"]}, tok="tok-staff")
    ok(c == 403, "a staff member cannot disconnect")
    refresh_tok = db.one("select secret from vault.secrets where name like 'zoho:%%:refresh'")
    c, r, _ = call({"kind": "disconnect", "connection": conn_row()["id"]})
    ok(c == 200 and r.get("revoked") and FZ.REFRESH[refresh_tok]["revoked"] and conn_row()["status"] == "disconnected", "the owner disconnects: the token revoked at Zoho, the organisation disconnected")
    ok(int(db.one("select count(*) from tally_vouchers where book_id = %s" % q(BOOK))) == nv and not [x for x in FZ.LOG if x["method"] == "DELETE"], "nothing deleted, in FinCom or in Zoho")

    # ================================================================ 10. who sees what
    print("== 10. row-level security and keys")
    def as_user(uid, sql):
        return db.rows("set role authenticated; set fincom.uid = %s; %s" % (q(uid), sql))
    try:
        mine = as_user(OWNER, "select count(*)::int as n from zoho_connections")[0]["n"]
        other = as_user(OWNER2, "select count(*)::int as n from zoho_connections")[0]["n"]
        ok(int(mine) == 1 and int(other) == 0, "a firm sees only its own connection (own %s, other firm %s)" % (mine, other))
        st2 = json.loads(as_user(OWNER2, "select public.zoho_status()::text as s")[0]["s"])
        st1 = as_user(STAFF, "select public.zoho_status()::text as s")[0]["s"]
        ok(st2["connections"] == [] and st2["grants"] == [], "zoho_status for another firm: nothing")
        ok('"60012345678"' in st1 and "callsToday" in st1 and "tokenUntil" in st1 and not any(t in st1 for t in list(FZ.ACCESS) + list(FZ.REFRESH)) and "hook_hash" not in st1, "zoho_status for the firm's staff: its organisation, calls today, token validity; never a token or hash")
        for sql in ("select public.zoho_secret_get('zoho:x') as s", "select hook_hash from zoho_connections", "select * from zoho_oauth_states", "select * from zoho_seen", "select * from vault.decrypted_secrets"):
            try: as_user(OWNER, sql); ok(False, "a member cannot run: " + sql)
            except RuntimeError as e: ok("permission denied" in str(e), "a member cannot run: %s" % sql)
        try: as_user(OWNER, "select public.zoho_link('%s', null, 'x', 'zt', null)" % OWNER); ok(False, "a member cannot call zoho_link directly")
        except RuntimeError as e: ok("permission denied" in str(e), "a member cannot call the service functions directly (zoho_link)")
    finally:
        db.sql("reset role")
    vault = {x["name"]: x["secret"] for x in db.rows("select name, secret from vault.secrets where name like 'zoho:%'")}
    no_tokens("at the end")
finally:
    if fn: fn.terminate()
    db.stop()
    shutil.rmtree(TMP, ignore_errors=True)
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
