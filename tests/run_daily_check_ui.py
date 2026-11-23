"""python3 tests/run_daily_check_ui.py - the Daily Check page (app/src/screens/daily) in the built app, with a stand-in for
the cloud that answers migration 206's tables with made-up rows (tests/daily_fixture.mjs dbRows) and records every call.
  1. signed out: one calm line, no error; the address is #/daily
  2. the four tabs with their counts; it opens on the one with the most to do; one line a row, a status dot
  3. a question opened: its words and history; Edit / Close call their functions (owner and staff)
  4. Needs you: a choice calls finding_choose with that candidate; Done: Undo calls finding_undo
  5. Entries: the Checks chip; Reject calls entry_decide; Approve runs the EXISTING approval first (a bank line through
     bankSetLedger, a bill through approve()) and only then records the decision; refused there = nothing recorded
  6. Send: the owner only; "Test mode" line; its Settings (with the new look on: a link to Settings › Email and messages); the message holds only the client's questions still needed (never a
     resolved or closed one); Send email calls assistant-send with the ticked ids; staff see no Send
  7. contacts in Client setup: loaded from client_contacts; a new one saved with a POST
  8. a phone (390 px): the same tabs, no sideways scroll
SHOTS=<dir>: also saves the screenshots (deviceScaleFactor 2; the test site's strip hidden for them only). UI_PORT (8473)."""
import os, sys, json, subprocess, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("UI_PORT") or 8473)
SHOTS = os.environ.get("SHOTS", "")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
ROWS = json.loads(subprocess.run(["node", "-e", "import('./daily_fixture.mjs').then(m => process.stdout.write(JSON.stringify(m.dbRows())))"], cwd=HERE, capture_output=True, text=True, check=True).stdout)
# a question Asked before its finding moved to Needs you (207): shown there, never under From clients
_you = [f for f in ROWS["night_findings"] if f["state"] == "you"][0]
ROWS["client_asks"].append({"id": "00000000-0000-4000-8000-000000000999", "client_id": _you["client_id"], "finding_id": _you["id"], "week": "2026-11-16", "text": "A made-up question asked before.", "edited": None, "state": "asked", "answer": None, "closed_by": None,
  "history": [{"at": "2026-11-17T10:00:00+05:30", "what": "Emailed to accounts@sampletraders.example"}], "created_at": "2026-11-14T02:10:00+05:30"})
READY = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
SEED = """([rows, role]) => { S.firm.firmName = "Sample & Co";
  rows.clients.forEach((c) => { const co = newCompany({name: c.name}); co.id = c.id; co.stats = {}; S.companies[c.id] = co; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; });
  S.coId = "d1"; S.account = {me: {role, name: "Made-up Person"}};
  window.__dc = {calls: [], approveOk: true, bankOk: true};
  const R = rows;
  Cloud.on = () => true;
  Cloud.api = async (path, o) => { o = o || {}; window.__dc.calls.push([path, o.method || "GET", o.body || null]); const t = path.split("?")[0];
    if (t.startsWith("rpc/")) return {ok: true}; if (o.method && o.method !== "GET") return null;
    const m = path.match(/[?&]client_id=eq\.([^&]+)/), rows = JSON.parse(JSON.stringify(R[t] || []));
    return m ? rows.filter((x) => x.client_id === decodeURIComponent(m[1])) : rows; };
  Cloud.fn = async (name, body) => { window.__dc.calls.push(["fn:" + name, "POST", body]); return {ok: true, test: true, to: ["office@samplefirm.example"]}; };
  // the existing approvals, recorded (the real ones need a statement and a bill on this computer)
  window.openCompany = async (cid) => { window.__dc.calls.push(["openCompany", cid]); };
  window.loadBank = async () => {}; window.openStatement = async (sid) => { window.__dc.calls.push(["openStatement", sid]); };
  window.__row = {state: "attention", debit: 18450, credit: 0, date: "2026-11-07"}; window.bankRow = () => window.__row;
  window.bankSetLedger = (id, l) => { window.__dc.calls.push(["bankSetLedger", id, l]); if (window.__dc.bankOk) window.__row.state = "ready"; return window.__dc.bankOk; };
  S.view = "home"; navHome("daily"); return true; }"""
HIDE = "body.is-test::after{display:none!important}.is-test header.top{box-shadow:none!important}.is-test .side-brand::after{display:none!important}"
def settle(pg, ms=500):
    pg.wait_for_timeout(ms)
    try: pg.wait_for_function("() => !document.querySelector('[data-loading-page]')", timeout=8000)
    except Exception: pass
    pg.wait_for_timeout(150)
def start(br, w=1440, h=900, role="owner", seed=True, scheme="light"):
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if SHOTS else 1, color_scheme=scheme)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text[:300]) if m.type == "error" and ("could not be drawn" in m.text or "Uncaught" in m.text) else None)
    pg.goto(URL); pg.wait_for_timeout(1500); pg.evaluate(READY); pg.wait_for_timeout(500)
    if SHOTS: pg.add_style_tag(content=HIDE)
    if seed: pg.evaluate(SEED, [ROWS, role]); pg.wait_for_selector("[data-daily]", timeout=15000); settle(pg)
    return ctx, pg
def shot(pg, name, full=True):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)
calls = lambda pg: pg.evaluate("() => window.__dc.calls")
rpcs = lambda pg, fn: [c for c in calls(pg) if c[0] == "rpc/" + fn]

with sync_playwright() as p:
    br = p.chromium.launch()
    # 1. signed out
    ctx, pg = start(br, seed=False)
    pg.evaluate("() => { S.view = 'home'; navHome('daily'); }"); pg.wait_for_selector("[data-daily]", timeout=15000); settle(pg)
    ok(pg.locator("[data-none=cloud]").count() == 1 and not pg.locator("[data-guard]").count(), "1. signed out: one calm line, no error box")
    ok(pg.evaluate("() => location.hash") == "#/daily", "1. the address is #/daily")
    pg.evaluate("() => { location.hash = '#/clients'; }"); settle(pg, 300); pg.evaluate("() => { location.hash = '#/daily'; }"); settle(pg, 600)
    ok(pg.evaluate("() => S.homeTab") == "daily", "1. #/daily opens Daily Check")
    ctx.close()
    for dev, w, h in [("desktop", 1440, 900), ("phone", 390, 844)]:
        ctx, pg = start(br, w, h)
        tabs = pg.evaluate("() => [...document.querySelectorAll('[data-tab]')].map((t) => [t.dataset.tab, t.textContent.replace(/\\s+/g, ' ').trim(), t.getAttribute('aria-selected')])")
        if dev == "desktop":
            ok([t[0] for t in tabs] == ["clients", "you", "entries", "done"], "2. four tabs")
            ok(tabs[0][2] == "true" and tabs[0][1].endswith("7") and tabs[1][1].endswith("3") and tabs[2][1].endswith("3") and tabs[3][1].endswith("7"), "2. counts 7 · 3 · 3 · 7; opens on From clients (the most to do) %s" % tabs)
            ok(pg.locator(".dc-row .dc-dot").count() == 8 and pg.locator(".dc-hist").count() == 0, "2. one line a question with a status dot; no history until opened")
            ok(pg.evaluate("() => document.querySelector('.dc-run').textContent") == "Last night · 5 clients", "2. one line on top")
        shot(pg, "1-from-clients-" + dev)
        pg.click("[data-row='%s'] .dc-open" % ROWS["night_findings"][10]["id"]); settle(pg, 200)   # the cash question, asked by email
        ok(pg.locator(".dc-hist li").count() == 2 and "Emailed to" in pg.locator(".dc-hist").inner_text(), "3. a question opened: its history")
        shot(pg, "2-question-open-" + dev)
        if dev == "desktop":
            pg.click(".dc-acts button:has-text('Close')"); settle(pg, 300)
            ok(len(rpcs(pg, "ask_close")) == 1, "3. Close calls ask_close")
        if dev == "desktop": ok("A made-up question asked before." not in pg.locator("[data-daily]").inner_text(), "2. a question whose finding needs you is not under From clients")
        pg.click("[data-tab=you]"); settle(pg, 250); shot(pg, "3-needs-you-" + dev)
        if dev == "desktop": ok(pg.locator("[data-row='%s'] .dc-you-q" % _you["id"]).inner_text() == "Asked", "4. it is shown under Needs you, marked Asked")
        if dev == "desktop":
            pg.click(".dc-choice:has-text('Sales 1211')"); settle(pg, 300)
            c = rpcs(pg, "finding_choose")
            ok(len(c) == 1 and c[0][2]["p_ref"].endswith(":1"), "4. a choice calls finding_choose with that candidate")
        pg.click("[data-tab=entries]"); settle(pg, 250); shot(pg, "4-entries-" + dev)
        ok(pg.locator(".dc-ok").count() == 3 and pg.locator(".dc-lines").count() == 0, "5. entries: a Checks chip each; Dr/Cr only when opened")
        pg.click("[data-row='%s'] .dc-open" % ROWS["night_entries"][0]["id"]); settle(pg, 200); shot(pg, "5-entry-open-" + dev)
        ok(pg.locator(".dc-lines .dc-lr").count() == 5, "5. an entry opened: its Dr/Cr lines and total")
        if dev == "desktop":
            pg.click("[data-row='%s'] .dc-icon.no" % ROWS["night_entries"][2]["id"]); settle(pg, 300)
            c = rpcs(pg, "entry_decide")
            ok(len(c) == 1 and c[0][2]["p_decision"] == "rejected", "5. Reject calls entry_decide (rejected)")
            # M3: the line changed since last night (another amount): refused before the bank's own approval is asked
            pg.evaluate("() => { window.__row.debit = 18500; }")
            pg.click("[data-row='%s'] .dc-icon.ok" % ROWS["night_entries"][1]["id"]); settle(pg, 600)
            ok(not any(x[0] == "bankSetLedger" for x in calls(pg)) and len(rpcs(pg, "entry_decide")) == 1, "5. M3: the line changed since last night: refused, nothing set or recorded")
            pg.evaluate("() => { window.__row.debit = 18450; navHome('daily'); }"); settle(pg, 400); pg.click("[data-tab=entries]"); settle(pg, 200)
            pg.evaluate("() => { window.__dc.bankOk = false; }")
            pg.click("[data-row='%s'] .dc-icon.ok" % ROWS["night_entries"][1]["id"]); settle(pg, 600)
            ok(any(x[0] == "bankSetLedger" for x in calls(pg)) and len(rpcs(pg, "entry_decide")) == 1, "5. Approve: the bank line's own approval refused it: nothing recorded")
            pg.evaluate("() => { window.__dc.bankOk = true; window.__row.state = 'attention'; }"); pg.evaluate("() => navHome('daily')"); settle(pg, 400); pg.click("[data-tab=entries]"); settle(pg, 200)
            pg.click("[data-row='%s'] .dc-icon.ok" % ROWS["night_entries"][1]["id"]); settle(pg, 600)
            c = rpcs(pg, "entry_decide"); b = [x for x in calls(pg) if x[0] == "bankSetLedger"]
            ok(len(c) == 2 and c[1][2]["p_decision"] == "approved" and b[-1][2] == "GST Cash Ledger", "5. Approve: bankSetLedger with the entry's ledger first, then the decision recorded")
            ok(pg.evaluate("() => S.homeTab") == "daily", "5. back on Daily Check after approving")
        pg.click("[data-tab=done]"); settle(pg, 250); shot(pg, "6-done-by-fincom-" + dev)
        pg.click("[data-row='%s'] .dc-open" % ROWS["night_findings"][3]["id"]); settle(pg, 200); shot(pg, "7-done-open-" + dev)
        if dev == "desktop":
            pg.click(".dc-undo"); settle(pg, 300)
            ok(len(rpcs(pg, "finding_undo")) == 1, "4. Undo calls finding_undo")
        pg.click("[data-tab=clients]"); settle(pg, 200)
        pg.click("[data-client=d1] .btn.primary"); pg.wait_for_selector("[data-send]"); settle(pg, 300)
        msg = pg.locator("[data-msg]").inner_text()
        if dev == "desktop":
            ok(pg.locator("[data-test-mode]").inner_text() == "Test mode: emails go to your firm only", "6. send: the short test-mode line")
            ok(msg.count("\n1. ") == 1 and "\n4. " in msg and "\n5. " not in msg, "6. the message: the client's 4 questions still needed (3 Draft, 1 Asked)")
            words = [f["facts"]["short"] for f in ROWS["night_findings"] if f["state"] == "resolved" and f["client_id"] == "d1"] + ["XYZ Logistics", "Sample Properties", "Challan"]
            ok(not any(w and w in msg for w in words), "6. nothing resolved is in the message")
        shot(pg, "8-send-" + dev)
        if dev == "desktop":
            pg.click("button:has-text('Send email')"); settle(pg, 500)
            f = [x for x in calls(pg) if x[0] == "fn:assistant-send"]
            ok(len(f) == 1 and f[0][2]["client_id"] == "d1" and len(f[0][2]["ask_ids"]) == 4, "6. Send email calls assistant-send with the 4 ticked questions")
            pg.evaluate("() => navHome('daily')"); settle(pg, 400); pg.click("[data-tab=clients]"); settle(pg, 200)
            pg.click("[data-client=d1] .btn.primary"); pg.wait_for_selector("[data-send]"); settle(pg, 300)
            ok(pg.locator("[data-send-settings]").count() == 1 and pg.locator("[data-send-settings-moved]").count() == 0, "6. new look off: Send keeps its Settings")
            pg.evaluate("() => FCNewLook.set(true)"); settle(pg, 400)
            ok(pg.locator("[data-send-settings]").count() == 0 and pg.locator("[data-send-settings-moved]").count() == 1, "6. new look on: sending's settings are in Settings › Email and messages (a link here)")
            pg.evaluate("() => FCNewLook.set(false)"); settle(pg, 400)
            ok(pg.locator("[data-send-settings]").count() == 1, "6. new look off again: Settings back on Send")
        # 7. contacts
        pg.evaluate("() => { S.view = 'company'; S.coId = 'd1'; S.tab = 'settings'; S.loadingCo = false; delete S.setupList; render(); }")
        pg.wait_for_selector("[data-client-contacts] table", timeout=15000); settle(pg, 400)
        ok(pg.locator("[data-contact]").count() == 2, "7. contacts loaded from client_contacts (2)")
        pg.evaluate("() => document.querySelector('[data-client-contacts]').scrollIntoView({block: 'end'})"); pg.wait_for_timeout(200)
        shot(pg, "9-contacts-" + dev, full=False)
        if dev == "desktop":
            pg.click("[data-contact-add]"); pg.locator("[data-contact] input[aria-label=Name]").last.fill("Ravi"); pg.locator("[data-contact] input[aria-label=Email]").last.fill("ravi@sampletraders.example")
            pg.click("[data-contact-save]"); settle(pg, 400)
            post = [x for x in calls(pg) if x[0] == "client_contacts" and x[1] == "POST"]
            ok(len(post) == 1 and post[0][2]["client_id"] == "d1" and post[0][2]["email"] == "ravi@sampletraders.example", "7. a new contact saved with a POST")
        else:
            pg.evaluate("() => navHome('daily')"); settle(pg, 400)
            ok(pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "8. phone: no sideways scroll")
            ok(pg.locator("[data-tab]").count() == 4 and pg.evaluate("() => { const t = [...document.querySelectorAll('[data-tab]')]; return t.every((x) => x.getBoundingClientRect().top === t[0].getBoundingClientRect().top); }"), "8. phone: the four tabs on one line")
        ctx.close()
    # staff: no Send
    ctx, pg = start(br, role="staff")
    ok(pg.locator("[data-client] .btn.primary").count() == 0, "6. staff: no Send button")
    ctx.close()
    if SHOTS:
        ctx, pg = start(br, scheme="dark"); shot(pg, "10-from-clients-dark-desktop"); ctx.close()
    br.close()
srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("%d failed" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
