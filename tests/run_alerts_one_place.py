"""python3 run_alerts_one_place.py - the owner's round 3 of the UI pass (05-Oct-2026), part 1: every alert in ONE place.
The fault of 05-Oct: the same warning three times on every page ("Tally changes are not being recorded on NWS144";
"Changes not received: GARG SHEKHAR & COMPANY: up to 1 changes not received since …  Mark read"; "up to 1 changes not
received since … (Tally's change number 54396, received up to 54395) Upload the Day Book for these days").
Checked here, offline with FinCom's cloud made up in the page (Cloud.api / TCloud.rpc answered by the test):
  - one problem -> one alert: the cursor's gap, the tally_alerts gap rows (two days of them) and the computer that is not
    recording are ONE alert for the book, in the bell in the top bar (with its count);
  - nowhere else: no alert text on a client's pages; the only exceptions are the Tally page and that client's Books page,
    with ONE slim line (one row, never wrapping) and its button;
  - plain words (what, why, what to do); the change numbers, the computer and the ids only behind "details";
  - the advice matches the cause: lines held by FinCom's own fault (no entry body, the placeholder GUID) say FinCom is
    fetching the entry's details, nothing to do; a real gap says to upload the Day Book for those days;
  - it clears itself when the cause is gone (the cursor's gap null, the held lines applied, the recorder recording), no
    Mark read; Mark read only for an alert that cannot clear itself (the daily summary);
  - a second scan, and a new day's tally_alerts row for the same gap, do not add an alert;
  - severity: red (the books may be wrong, action needed), amber (attention), grey (information, the bell only).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_alerts_one_place.py"""
import json, os, re, threading, functools, http.server, datetime
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
import sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

from alerts_seed import D1, dev, GAP, al, ALERTS, HELD_OURS, SETUP

# the alerts in the bell: open it, read every item
BELL = """() => { const b = document.querySelector('#cobar [data-bell]'); if (!b) return null;
  if (!document.querySelector('[data-alerts-panel]')) b.click();
  const items = [...document.querySelectorAll('[data-alerts-panel] [data-alert-key]')].map(e => ({key: e.getAttribute('data-alert-key'), sev: e.getAttribute('data-sev'),
    text: (e.querySelector('[data-alert-text]') || {innerText: ''}).innerText.trim(), fix: (e.querySelector('[data-alert-fix]') || {innerText: ''}).innerText.trim(),
    act: (e.querySelector('[data-alert-act]') || {innerText: ''}).innerText.trim(), read: !!e.querySelector('[data-alert-read]'),
    details: (e.querySelector('[data-alert-details]') || {textContent: ''}).textContent.trim(),
    dot: getComputedStyle(e.querySelector('.al-dot') || e).backgroundColor}));
  const count = (b.querySelector('[data-bell-count]') || {innerText: '0'}).innerText.trim();
  return {count, items}; }"""
CLOSE = "() => { S.alertsOpen = false; render(); }"
PHRASES = re.compile(r"not being recorded|changes not received|Changes not received|Upload the Day Book for these days|change number|not yet in FinCom|Mark read", re.I)
TOK = """() => { const s = getComputedStyle(document.documentElement); const rgb = (v) => { const d = document.createElement('i'); d.style.color = v; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
  return {bad: rgb('var(--st-failed)'), warn: rgb('var(--st-attention)'), info: rgb('var(--st-waiting)')}; }"""
srv = http.server.ThreadingHTTPServer(("localhost", 8352), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 800}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8352/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    def scene(s, where="dash"):
        cid = E(SETUP, [s, "owner"])
        E("async ([cid, w]) => { if (w === 'tally') { navHome('tally'); return; } S.view = 'company'; S.coId = cid; S.loadingCo = false; goClient(w); }", [cid, where]); pg.wait_for_timeout(1800)
        E("() => { if (typeof AlertHub === 'object') AlertHub.refresh(true); }"); pg.wait_for_timeout(1200)
        return cid
    tok = E(TOK)
    ok(E("typeof AlertHub") == "object", "one module gathers every alert (AlertHub)")
    # ---- 1. the 05-Oct fault: one problem, one alert, in the bell
    cid = scene({"devs": [dev(recording=False)], "alerts": ALERTS, "gap": GAP})
    b = E(BELL) or {"count": "", "items": []}
    garg = [x for x in b["items"] if "GARG" in x["text"]]
    ok(len(garg) == 1, "the cursor's gap, two days of gap alerts and the computer not recording: ONE alert for the book (%s)" % [x["text"] for x in b["items"]])
    g = garg[0] if garg else {"text": "", "fix": "", "act": "", "details": "", "sev": "", "dot": "", "read": True}
    ok(re.search(r"GARG SHEKHAR & COMPANY: 1 entry made in Tally since 08:00 IST today is not yet in FinCom\.", g["text"]), "in plain words: what (%s)" % g["text"])
    ok(re.search(r"Upload the Day Book for \d{2}-[A-Z][a-z]{2}", g["fix"]) and g["act"].startswith("Upload"), "what to do, with its button (%s | %s)" % (g["fix"], g["act"]))
    ok(not re.search(r"NWS144|54396|54395|change number|AlterID", g["text"] + " " + g["fix"]) and "54396" in g["details"] and "NWS144" in g["details"], "the change numbers and the computer only behind details (%s)" % g["details"][:160])
    ok(g["sev"] == "bad" and g["dot"] == tok["bad"], "a real gap: red, the books may be wrong and something is to be done (%s %s)" % (g["sev"], g["dot"]))
    ok(not g["read"], "it clears itself, so no Mark read")
    ok(b["count"] == str(len(b["items"])) and len(b["items"]) == 2, "the bell counts them: the book's alert and the daily summary (%s, %s)" % (b["count"], [x["text"][:40] for x in b["items"]]))
    summ = [x for x in b["items"] if x is not g]
    ok(summ and summ[0]["sev"] == "info" and summ[0]["dot"] == tok["info"] and summ[0]["read"], "the daily summary: grey information, with Mark read (it cannot clear itself) (%s)" % summ[:1])
    E(CLOSE)
    # ---- 2. nowhere else on a client's pages
    for w in ["dash", "bills", "bank", "sales", "txn"]:
        E("([cid, w]) => { goClient(w); }", [cid, w]); pg.wait_for_timeout(700)
        t = pg.inner_text("#app")
        ok(not PHRASES.search(t) and pg.locator("#app [data-alert-line]").count() == 0, "%s: no alert text on the page (%s)" % (w, (PHRASES.search(t) or [""])[0]))
    # ---- 3. the client's Books page and the Tally page: ONE slim line
    for w, sel in [("books:reports", "#app [data-alert-line]"), ("tally", "#app [data-alert-line]")]:
        if w == "tally": E("() => navHome('tally')")
        else: E("([cid, w]) => { S.view = 'company'; S.coId = cid; goClient(w); }", [cid, w])
        pg.wait_for_timeout(1200)
        n = pg.locator(sel).count()
        h = E("(s) => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e); return {h: e.getBoundingClientRect().height, ws: cs.whiteSpace, lh: parseFloat(cs.lineHeight) || 20, text: e.innerText, btn: !!e.querySelector('button')}; }", sel)
        ok(n == 1 and h and h["ws"] == "nowrap" and h["h"] <= 36 and h["btn"], "%s: one slim line, one row, never wrapping, with its button (%s)" % (w, h))
        t = pg.inner_text("#app")
        ok(len(re.findall(r"not yet in FinCom", t)) == 1 and not re.search(r"not being recorded|Changes not received|Upload the Day Book for these days", t), "%s: the alert once, and nothing of the old three (%s)" % (w, t[:0]))
    # ---- 4. a second scan, and a new day's row for the same gap: still one
    E("() => { window.__w.alerts.push({id: 9, firm_id: 'f-1', client_id: window.__w.alerts[0].client_id, book_id: 'b1', kind: 'gap', day: new Date(Date.now() + 86400000).toISOString().slice(0, 10), words: 'GARG SHEKHAR & COMPANY: up to 1 changes not received', data: {}, at: new Date().toISOString(), read_at: null}); Rec.alerts.at = 0; Rec.gaps.at = 0; AlertHub.refresh(true); }")
    pg.wait_for_timeout(1500)
    b = E(BELL)
    ok(len([x for x in b["items"] if "GARG" in x["text"]]) == 1, "a second scan and another day's row: still one alert (%d)" % len([x for x in b["items"] if "GARG" in x["text"]]))
    E(CLOSE)
    # ---- 5. it clears itself: the gap gone, the recorder recording again; no Mark read
    E("() => { window.__w.cursor = []; window.__w.devs = window.__w.devs.map(d => { const b = d.info.bridges['go-1']; b.recorder['GARG SHEKHAR & COMPANY'].seen = true; return d; }); TLight.st.devs = JSON.parse(JSON.stringify(window.__w.devs)); Rec.gaps.at = 0; Rec.alerts.at = 0; AlertHub.refresh(true); }")
    pg.wait_for_timeout(1500)
    b = E(BELL)
    ok(not [x for x in b["items"] if "GARG" in x["text"]] and not [c for c in E("window.__w.calls") if c[0] == "tally_alert_read"], "the cause gone: the alert is gone by itself, nothing marked read (%s)" % [x["text"][:50] for x in b["items"]])
    E(CLOSE)
    # ---- 6. the advice matches the cause: held by FinCom's own fault
    cid = scene({"devs": [dev(recording=True)], "alerts": [ALERTS[1]], "gap": GAP, "lines": [HELD_OURS]})
    b = E(BELL); garg = [x for x in b["items"] if "GARG" in x["text"]]
    g = garg[0] if garg else {"text": "", "fix": "", "act": "", "sev": ""}
    ok(len(garg) == 1 and "fetching the entry" in g["fix"] and "nothing to do" in g["fix"].lower() and "Day Book" not in g["fix"] + g["act"], "a line held by FinCom's own fault (the placeholder GUID, no body): FinCom is fetching it, nothing to do, never upload a Day Book (%s | %s)" % (g["fix"], g["act"]))
    ok(g["sev"] == "warn", "and amber, not red (%s)" % g["sev"])
    E(CLOSE)
    E("() => { window.__w.lines = window.__w.lines.map(l => Object.assign(l, {state: 'applied', held_why: null})); window.__w.cursor = []; AlertHub.refresh(true); Rec.gaps.at = 0; }"); pg.wait_for_timeout(1500)
    b = E(BELL)
    ok(not [x for x in b["items"] if "GARG" in x["text"]], "the held line applied: the alert is gone by itself")
    E(CLOSE)
    # ---- 7. not recording alone: amber, plain words, the computer behind details
    cid = scene({"devs": [dev(recording=False)], "alerts": [], "gap": None})
    b = E(BELL); garg = [x for x in b["items"] if "GARG" in x["text"]]
    g = garg[0] if garg else {"text": "", "fix": "", "details": "", "sev": ""}
    ok(len(garg) == 1 and g["sev"] == "warn" and "recorder" in (g["text"] + g["fix"]).lower() and "NWS144" not in g["text"] + g["fix"] and "NWS144" in g["details"], "Tally not recording, no gap yet: one amber alert, the computer behind details (%s | %s | %s)" % (g["text"], g["fix"], g["details"][:60]))
    E(CLOSE)
    # ---- 8. the app's own warnings are in the bell too, not on the pages
    E("() => { S.storeKind = 'local'; window.__con = Cloud.on; Cloud.on = () => false; render(); }"); pg.wait_for_timeout(500)
    E("([cid]) => { S.view = 'company'; S.coId = cid; goClient('dash'); }", [cid]); pg.wait_for_timeout(600)
    ok("saved in this browser only" not in pg.inner_text("#app"), "the 'saved in this browser only' note is not on every page")
    b = E(BELL)
    st = [x for x in b["items"] if "browser" in x["text"].lower()]
    ok(len(st) == 1 and st[0]["sev"] == "info", "it is information in the bell (%s)" % st[:1])
    E(CLOSE)
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
