"""python3 run_gst_browser_helper.py - the GST browser helper (extension/gst-helper) driven in Chromium against the portal
look-alike (tests/fixtures/gst-portal-fake), with a stand-in for FinCom's tab sending the made-up client's figures
(fincom-data.json):
  GSTR-1 by the offline upload and by typing each table: every field on the portal holds FinCom's figure to the paisa,
  the summary read back agrees table by table; GSTR-3B: every box typed and read back, 4(C) compared, the portal's set-off
  compared (its different use of credit highlighted); the helper stops before File / Make payment, the person files with
  the OTP and the ARN goes back to FinCom; a field missing on the page stops the step with a plain message and nothing
  more typed; the login page gets the user id and password and waits on the captcha; 2B JSON, ledgers and return status.
Screenshots: tests/out/gst-helper-*.png."""
import json, os, sys, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
import gst_helper_stand as stand

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
FX = json.load(open(os.path.join(stand.FAKE, "fincom-data.json")))
GSTIN = FX["gstin"]
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

def two_b(period):
    return {"data": {"gstin": GSTIN, "rtnprd": period, "gendt": "14-12-2025", "docdata": {"b2b": [{"ctin": "27AAACM5678P1Z2", "trdnm": "MADE-UP SUPPLIER", "supfildt": "11-12-2025", "supprd": period,
            "inv": [{"inum": "S/1", "dt": "02-11-2025", "val": 1180, "txval": 1000, "igst": 180, "cgst": 0, "sgst": 0, "cess": 0, "rev": "N", "itcavl": "Y", "rsn": "", "typ": "R", "pos": "07"}]}]}}}

def job(form, fp, **kw):
    ym = fp[2:] + fp[:2]
    j = {"id": form + "-" + fp + "-" + kw.pop("tag", ""), "v": 1, "form": form, "client": FX["client"], "gstin": GSTIN, "ym": ym, "fp": fp, "label": fp[:2] + "-" + fp[2:]}
    if form in ("R1", "IFF"):
        r1 = copy.deepcopy(FX["r1json"]); r1["fp"] = fp; j["r1json"] = r1; j["r1mode"] = kw.pop("mode", "upload")
    if form == "3B":
        r3 = copy.deepcopy(FX["r3bjson"]); r3["ret_period"] = fp; j["r3bjson"] = r3; j["pay"] = dict(FX["pay"], due={"igst": 4000.25, "cgst": 1500.1, "sgst": 1500.1, "cess": 0}, rcmCash={"igst": 0, "cgst": 900, "sgst": 900, "cess": 0})
    j.update(kw)
    return j

# the records the portal look-alike keeps, against FinCom's own, field by field (money to the paisa)
CHECK = """([json, st]) => { const R = self.GSTH_RULES, SEL = self.GSTH_SEL, bad = []; let n = 0;
  const MONEY = new Set(['val', 'txval', 'iamt', 'camt', 'samt', 'csamt']);
  for (const [k] of R.R1) { const want = R.records1(json, k); if (!want.length) continue;
    if (k === 'nil') { want.forEach((w) => ['nil_amt', 'expt_amt', 'ngsup_amt'].forEach((c) => { n++; const g = ((st.nil || {})[w.sply_ty] || {})[c]; if (R.paise(g) !== R.paise(w[c])) bad.push(k + ' ' + w.sply_ty + ' ' + c + ': ' + g + ' vs ' + w[c]); })); continue; }
    const got = st[k] || []; if (got.length !== want.length) { bad.push(k + ': ' + got.length + ' records on the portal, FinCom ' + want.length); continue; }
    const typed = Object.keys(SEL.pages.gstr1.tables[k].form.fields);
    want.forEach((w, i) => { const g = got[i];
      typed.filter((f) => w[f] !== undefined).forEach((f) => { n++; const a = g[f], b = w[f];
        const same = MONEY.has(f) ? R.paise(a) === R.paise(b) : f === 'rchrg' ? String(a || 'N') === String(b) : String(a) === String(b);
        if (!same) bad.push(k + ' #' + (i + 1) + ' ' + f + ': portal ' + a + ', FinCom ' + b); });
      (w.itms || []).forEach((it) => { const gi = (g.itms || []).find((x) => +x.rt === +it.rt);
        ['txval', 'iamt', 'camt', 'samt', 'csamt'].forEach((c) => { n++; if (!gi || R.paise(gi[c]) !== R.paise(it[c])) bad.push(k + ' #' + (i + 1) + ' rate ' + it.rt + ' ' + c + ': portal ' + (gi ? gi[c] : 'none') + ', FinCom ' + it[c]); }); });
      if ((g.itms || []).length > (w.itms || []).length) bad.push(k + ' #' + (i + 1) + ': more rates on the portal'); });
  } return {bad, n}; }"""

with sync_playwright() as p:
    ctx, ext = stand.start(p, two_b=two_b)
    ok(ext == stand.EXT_ID, "the helper loads unpacked with its fixed id (" + ext + "), so FinCom always finds it")
    for pg in ctx.pages: pg.on("pageerror", lambda e: errors.append(str(e)))
    ctx.on("page", lambda pg: pg.on("pageerror", lambda e: errors.append(pg.url.split("?")[0] + ": " + str(e))))
    fc = ctx.new_page(); fc.goto("https://staging.fincom.live/stub.html"); fc.evaluate("(id) => fc.connect(id)", ext)
    stand.wait(fc, lambda: any(m.get("type") == "hello" for m in fc.evaluate("__msgs")), 10000)
    hello = [m for m in fc.evaluate("__msgs") if m.get("type") == "hello"][0]
    ok(hello.get("selectors") and hello.get("verified") is False, "FinCom's tab is answered: helper " + str(hello.get("version")) + ", portal map " + str(hello.get("selectors")) + " (said plainly: not yet checked on the live portal)")
    panel = ctx.new_page(); panel.goto("chrome-extension://%s/panel.html" % ext)
    msgs = lambda t: [m for m in fc.evaluate("__msgs") if m.get("type") == t]
    status = lambda sid: panel.get_attribute('[data-step="%s"]' % sid, "data-status") if panel.query_selector('[data-step="%s"]' % sid) else None
    def send(j, open_="dashboard"):
        fc.evaluate("(m) => fc.send(m)", {"type": "job", "job": j, "open": open_})
        stand.wait(panel, lambda: panel.query_selector("#steps:not([hidden]) [data-step]") and j["id"] in json.dumps(panel.evaluate("chrome.storage.session.get('job')")), 15000)
    def run_all(last, ms=120000, click=True):
        if click: panel.click("#runAll")
        stand.wait(panel, lambda: status(last) in ("done", "stopped") or any(status(s) == "stopped" for s in panel.eval_on_selector_all("[data-step]", "els => els.map(e => e.dataset.step)")), ms)
    def fake_state(key):
        pt = stand.portal_tab(ctx); return pt.evaluate("(k) => JSON.parse(localStorage.getItem('fake:' + k) || 'null')", key)
    def portal_eval(origin_url, js):
        pt = stand.portal_tab(ctx); return pt.evaluate(js)

    # ---------- 1. GSTR-1 by the portal's offline upload (FinCom's own JSON) ----------
    j1 = job("R1", "112025", tag="up")
    send(j1)
    pt = stand.wait(fc, lambda: stand.portal_tab(ctx), 10000)
    ok(pt is not None and "/services/login" in pt.url, "no portal tab yet: “Open the portal” opens the portal's login page (the only address the helper ever opens)")
    fig = panel.inner_text("#figures")
    ok("4A, 4B, 6B, 6C - B2B" in fig and "₹17,000.42" in fig and "13 - Documents issued" in fig, "the panel shows FinCom's figures for the client and period, table by table")
    panel.click("#runAll"); panel.wait_for_timeout(3000)
    ok(status("login") == "running" and "/services/login" in pt.url and pt.input_value("#username") == "" and pt.input_value("#captcha") == "",
       "while the login page is open the helper waits and does not touch the tab (%s)" % panel.inner_text('[data-step="login"] .msg'))
    # the person logs in; the portal shows its home page, and the helper goes on through RETURN DASHBOARD
    pt.fill("#username", "fx_user"); pt.fill("#user_pass", "typed-by-the-person"); pt.fill("#captcha", "ABC123"); pt.click("#login")
    run_all("file", click=False)
    st = {s: status(s) for s in ["login", "period", "upload", "process", "open", "summary", "file", "you"]}
    ok(all(v == "done" for k, v in st.items() if k != "you") and st["you"] == "you", "upload way: log in, period, upload, processed, open, summary, File page all done; the last step is the person's (%s)" % st)
    r1st = fake_state("r1:112025") or {}
    chk = panel.evaluate(CHECK, [j1["r1json"], r1st])
    ok(not chk["bad"] and chk["n"] > 100, "every field of every table on the portal holds FinCom's figure to the paisa (%d fields)%s" % (chk["n"], "" if not chk["bad"] else ": " + "; ".join(chk["bad"][:5])))
    ok(panel.get_attribute('[data-compare="r1"]', "class") == "agree" and "agree to the paisa" in panel.inner_text("#compare"), "the portal's summary read back agrees with FinCom table by table: " + panel.inner_text('[data-compare="r1"]'))
    filed = fake_state("filed") or []
    pt = stand.portal_tab(ctx)
    ok(not filed and pt.is_visible("#filemodal #fdsc") and pt.inner_text("#otpbox") == "" and not pt.is_checked("#decl"),
       "the helper opened the portal's File page and stopped: FILE WITH DSC is there for the person; nothing ticked, signed or filed")
    ok("FILE WITH DSC" in panel.inner_text('[data-step="you"]'), "the person's step says it plainly: sign with FILE WITH DSC (companies and LLPs) on the page that is open")
    runs = msgs("run")
    ok(runs and runs[-1]["final"] and runs[-1]["agree"].get("r1", {}).get("agree") is True and runs[-1]["form"] == "R1" and runs[-1]["gstin"] == GSTIN, "each step's result went back to FinCom (steps, agreement, no differences)")
    stand.portal_tab(ctx).screenshot(path=OUT + "/gst-helper-r1-summary.png", full_page=True)
    panel.screenshot(path=OUT + "/gst-helper-panel-r1.png", full_page=True)
    # the person files: ticks, EVC, types the OTP; the helper reads the ARN and sends it to FinCom
    pt = stand.portal_tab(ctx)
    pt.check("#decl"); pt.click("#fevc"); pt.fill("#otp", "123456"); pt.click("#verify")
    stand.wait(fc, lambda: msgs("arn"), 10000)
    a = msgs("arn")
    ok(a and a[-1]["arn"] == "AA0711250000001" and a[-1]["gstin"] == GSTIN and a[-1]["ym"] == "202511", "after the person files, the ARN the portal shows goes back to FinCom (%s)" % (a[-1]["arn"] if a else "none"))
    stand.wait(panel, lambda: panel.query_selector("[data-arn]"), 5000)
    ok(panel.query_selector("[data-arn]") is not None, "the panel shows the return filed with its ARN")

    # ---------- 2. GSTR-1 typed table by table ----------
    j2 = job("R1", "122025", tag="type", mode="type")
    send(j2)
    run_all("file", 240000)
    steps = panel.eval_on_selector_all("[data-step]", "els => els.map(e => [e.dataset.step, e.dataset.status])")
    tsteps = [s for s in steps if s[0].startswith("t_")]
    ok(len(tsteps) == 12 and all(s[1] == "done" for s in tsteps), "typing way: a step per table FinCom has (%d), each done" % len(tsteps))
    chk = panel.evaluate(CHECK, [j2["r1json"], fake_state("r1:122025") or {}])
    ok(not chk["bad"] and chk["n"] > 100, "typed into the portal's own forms: every field FinCom's to the paisa (%d fields)%s" % (chk["n"], "" if not chk["bad"] else ": " + "; ".join(chk["bad"][:5])))
    ok(panel.get_attribute('[data-compare="r1"]', "class") == "agree", "summary read back agrees after typing")
    # the person changes a figure on the portal; the helper's summary shows the difference, highlighted
    pt = stand.portal_tab(ctx)
    pt.evaluate("() => { const s = JSON.parse(localStorage.getItem('fake:r1:122025')); s.b2cs[0].itms[0].txval = 8475.58; s.at[0].itms[0].txval = 20000.40; localStorage.setItem('fake:r1:122025', JSON.stringify(s)); }")
    panel.click('[data-run="summary"]'); stand.wait(panel, lambda: status("summary") == "done" and panel.query_selector('#compare tr.diff'), 30000)
    diff = panel.eval_on_selector_all("#compare tr.diff", "els => els.map(e => e.dataset.key + ' ' + e.innerText.replace(/\\s+/g, ' '))")
    rnd = panel.eval_on_selector_all("#compare tr.round", "els => els.map(e => e.dataset.key)")
    ok(any(d.startswith("b2cs.txval") and "1.00" in d for d in diff) and len(diff) == 1, "a rupee changed on the portal in B2C (Others) is the one difference, highlighted (%s)" % diff)
    ok(rnd == ["at.txval"] and "less than ₹1.00 (rounding" in panel.inner_text('[data-compare="r1"]'), "40 paise in table 11A is rounding: grey, not highlighted (%s)" % rnd)
    panel.screenshot(path=OUT + "/gst-helper-panel-r1-difference.png", full_page=True)

    # ---------- 3. GSTR-3B ----------
    j3 = job("3B", "112025", tag="3b")
    send(j3)
    run_all("pay", 180000)
    st = {s: status(s) for s in ["period", "t31", "t32", "t4", "t5", "read", "save", "pay", "you"]}
    ok(all(v == "done" for k, v in st.items() if k != "you") and st["you"] == "you", "3B: period, 3.1, 3.2, 4, 5, read, save, payment done; filing is the person's (%s)" % st)
    saved = (fake_state("3b:112025") or {}).get("m", {})
    want = {}
    for f in panel.evaluate("(j) => self.GSTH_RULES.fields3b(j)", j3["r3bjson"]):
        css = panel.evaluate("(k) => self.GSTH_SEL.pages.gstr3b.fields['box:' + k].css", f["key"]); want[css.split("#")[1]] = f["value"]
    badb = [k + " " + str(saved.get(k)) + " vs " + str(v) for k, v in want.items() if round(float(str(saved.get(k, "x")).replace(",", "") if saved.get(k) not in (None, "") else "nan") * 100) != round(v * 100)]
    ok(len(want) == 51 and not badb, "every 3B box on the portal holds FinCom's figure to the paisa (%d boxes)%s" % (len(want), "" if not badb else ": " + "; ".join(badb[:5])))
    r32 = (fake_state("3b:112025") or {}).get("r32", {}).get("unreg_details", [])
    ok([(r["pos"], r["txval"], r["iamt"]) for r in r32] == [("09", "1000.00", "50.00"), ("29", "254237.29", "45762.71")], "3.2: a row per place of supply, typed (%s)" % r32)
    ok(panel.get_attribute('[data-compare="r3b4c"]', "class") == "agree", "4(C) net ITC as the portal works it out agrees with FinCom")
    pay = panel.eval_on_selector_all('#compare tr[data-key^="pay."]', "els => els.map(e => [e.dataset.key, e.className])")
    ok(all(c != "diff" for k, c in pay if k.startswith("pay.cash") or k.startswith("pay.liab")) and any(c == "diff" for k, c in pay if k.startswith("pay.itc")),
       "payment: tax payable and cash agree; the portal's different use of IGST credit is highlighted, not changed")
    ok("uses credit differently" in panel.inner_text('[data-step="pay"]'), "said plainly: " + panel.inner_text('[data-step="pay"] .msg'))
    ok(not fake_state("posted:112025") and not [f for f in (fake_state("filed") or []) if f["form"] == "GSTR3B"], "stopped before Make payment / Post credit and before File")
    r = msgs("run")[-1]
    ok(r["form"] == "3B" and r["portal51"] and r["portal51"]["interest"] == 0 and any(d["part"] == "pay" for d in r["differences"]), "FinCom gets the 3B run: the portal's 5.1 figures and the set-off differences")
    pt = stand.portal_tab(ctx); pt.click('.tile[data-m="t4"]'); pt.wait_for_timeout(300)
    pt.screenshot(path=OUT + "/gst-helper-3b-filled.png", full_page=False); pt.click("#m_t4 .confirm")
    panel.screenshot(path=OUT + "/gst-helper-panel-3b.png", full_page=True)
    pt.click("#mkpay"); pt.click("#f3evc"); pt.check("#decl"); pt.click("#fevc"); pt.fill("#otp", "123456"); pt.click("#verify")
    stand.wait(fc, lambda: [m for m in msgs("arn") if m["form"] == "3B"], 10000)
    ok([m for m in msgs("arn") if m["form"] == "3B" and m["arn"] == "AA0711250000002"], "3B filed by the person: its ARN goes back to FinCom")

    # ---------- 4. a field the helper does not find: it stops and says which ----------
    pt.evaluate("() => localStorage.setItem('fake:drop', '#idt')")
    j4 = job("R1", "012026", tag="drop", mode="type")
    send(j4)
    run_all("summary", 60000)
    m = panel.inner_text('[data-step="t_b2b"] .msg')
    ok(status("t_b2b") == "stopped" and "“idt”" in m and "typed nothing more" in m and "never guesses" in m, "B2B's invoice date box missing: the step stops and says which step and field (%s)" % m[:160])
    ok(status("summary") not in ("done", "running") and not (fake_state("r1:012026") or {}).get("b2b"), "nothing else typed or saved after the stop")
    ok(msgs("run")[-1]["final"] and any(s["status"] == "stopped" for s in msgs("run")[-1]["steps"]), "the stop goes back to FinCom with its words")
    pt = stand.portal_tab(ctx); pt.evaluate("() => localStorage.setItem('fake:drop', '#itc_avl_OTH_camt')")
    j5 = job("3B", "012026", tag="drop3b")
    send(j5)
    run_all("pay", 60000)
    m = panel.inner_text('[data-step="t4"] .msg')
    ok(status("t4") == "stopped" and "4(A)(5) All other ITC · Central tax" in m, "3B: a missing box stops table 4 with the box's name (%s)" % m[:140])
    pt.evaluate("() => localStorage.removeItem('fake:drop')")
    panel.screenshot(path=OUT + "/gst-helper-panel-stopped.png", full_page=True)

    # ---------- 4b. a typed address: the portal refuses it; the helper stops with plain words and never types one ----------
    pt = stand.portal_tab(ctx)
    pt.goto("https://return.gst.gov.in/returns/auth/dashboard")
    ok("Access Denied" in pt.inner_text("body"), "the look-alike refuses a typed address with “Access Denied”, as the real portal did on 17-Oct-2026")
    send(job("R1", "022026", tag="denied"))
    pt.wait_for_timeout(1000)
    ok("/returns/auth/dashboard" in pt.url and "Access Denied" in pt.inner_text("body"), "a new return reuses the portal tab and does not move it")
    run_all("summary", 30000)
    m = panel.inner_text('[data-step="login"] .msg')
    ok(status("login") == "stopped" and "opened from its own menu" in m and "RETURN DASHBOARD" in m, "on the refusal page the helper stops and says what to do: " + m[:150])
    ok(panel.query_selector("[data-relogin]") is not None, "it offers to open the portal's login page")
    panel.click("[data-relogin]"); stand.wait(pt, lambda: "/services/login" in pt.url, 10000)
    ok("/services/login" in pt.url and pt.input_value("#username") == "", "… which opens the login page only, in the same tab, nothing typed")

    # ---------- 5. login: user id and password typed, the captcha left to the person ----------
    secret = "Fx#S3cret-pass-0101"
    fc.evaluate("(m) => fc.send(m)", {"type": "login", "gstin": GSTIN, "username": "fx_user", "password": secret})
    stand.wait(fc, lambda: msgs("login"), 20000)
    lg = msgs("login")
    pt = stand.portal_tab(ctx)
    ok(lg and lg[-1]["ok"] and "captcha" in lg[-1]["message"].lower(), "the login page was filled: " + (lg[-1]["message"] if lg else "no answer"))
    ok(pt.input_value("#username") == "fx_user" and pt.input_value("#user_pass") == secret and pt.input_value("#captcha") == "" and pt.evaluate("document.activeElement.id") == "captcha" and "/services/login" in pt.url,
       "user id and password in their boxes; the captcha box empty with the cursor in it; nothing pressed")
    kept = panel.evaluate("async () => JSON.stringify([await chrome.storage.session.get(null), await chrome.storage.local.get(null)])")
    ok(secret not in kept and secret not in json.dumps(fc.evaluate("__msgs")) and not any(secret in u for u in ctx.portal_seen), "the password is kept nowhere: not in the helper's storage, not in what it sends back, not in any address")
    pt.fill("#captcha", "ABC123"); pt.click("#login"); pt.wait_for_url("**/services/auth/fowelcome", timeout=10000)
    ok("/services/auth/fowelcome" in pt.url, "the person types the captcha, presses LOGIN, and is on the portal's home page")
    fc.evaluate("(m) => fc.send(m)", {"type": "login", "gstin": GSTIN, "username": "fx_user", "password": secret})
    stand.wait(fc, lambda: len(msgs("login")) > 1, 20000); pt.wait_for_timeout(500)
    ok("already" in msgs("login")[-1]["message"].lower() and "/services/auth/fowelcome" in pt.url, "asked to log in again while logged in: the tab is reused, not moved, nothing typed (%s)" % msgs("login")[-1]["message"])
    panel.click('[data-run="login"]'); stand.wait(panel, lambda: status("login") == "done", 20000)
    panel.click('[data-run="period"]'); stand.wait(panel, lambda: status("period") in ("done", "stopped"), 30000)
    ok(status("period") == "done" and "/returns/auth/gstr/offlineupload" in pt.url, "after the person logs in, Run goes on through the portal's own RETURN DASHBOARD (%s)" % panel.inner_text('[data-step="period"] .msg')[:100])

    # ---------- 6. 2B, ledgers, return status ----------
    send(job("2B", "112025", tag="2b"))
    run_all("download", 60000)
    tb = msgs("twoB")
    ok(status("download") == "done" and tb and tb[-1]["json"]["data"]["gstin"] == GSTIN and tb[-1]["json"]["data"]["rtnprd"] == "112025", "2B: the portal's JSON fetched in the person's tab and handed to FinCom's 2B import")
    send(job("LEDGER", "112025", tag="led"))
    run_all("credit", 60000)
    led = {m["which"]: m["got"] for m in msgs("ledger")}
    ok(led.get("cashLedger", {}).get("cgst") == "250.50" and led.get("creditLedger", {}).get("igst") == "380.50", "cash and credit ledger balances read and sent to FinCom (%s)" % led)
    send(job("STATUS", "112025", tag="st", of="R1"))
    run_all("status", 60000)
    ok(status("status") == "done" and [m for m in msgs("arn") if m.get("page") == "status" and m["arn"] == "AA0711250000001"], "return status: GSTR-1's ARN read from the portal's list and sent to FinCom")
    ctx.close()

errs = [e for e in errors if "favicon" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
