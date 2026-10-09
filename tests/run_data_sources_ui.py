"""python3 run_data_sources_ui.py - FinCom 2.4.1 (the owner's approval of 09-Oct-2026, item 4): one company open in two
places with different data, on the Tally page and in the bell. On the React test build (app/dist-test), the cloud
answered in the page (as run_tally_page_simple.py does).
  1. the one classifier (Rec.needKind): "saved in another data location ..." -> its own kind (othersrc, Needs you, the
     Tally page); 'baseline' ONLY for "starting point not recorded" (the 09-Oct words "Tally's voucher with that MasterID
     is not a change after the starting point" and 2.4.1's "an older entry" words are not 'baseline'); the bell agrees.
  2. Sync activity: the other location's lines are ONE Needs-you group with the cloud's words and ONE action, the Tally page.
  3. the Tally page, owner: one card per book with more than one location: "<company> is open in two places with different
     data: ① <computer> · <user> · <path> (last entry <time>) ② ... Which one is your books? FinCom reads only that one."
     with Use ①, Use ②, Decide later; Use ② calls tally_company_source_choose(book, ②'s data id); Decide later folds it;
     a book with one location: no card.
  4. after a person's choice: "FinCom now reads ②. Upload ②'s Day Book for the year (one month per file) so the history
     matches." with the upload page's link (the client's From Tally, the year so far), and who chose and when.
  5. staff: the same words, no button.
  6. the bell: the cloud's 'source' alert (migration 71) is listed, with the Tally page as its action.
RED: on 7c13c777's app the classifier says 'baseline' for the 09-Oct words, there is no card and no 'source' alert."""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_simple as T
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
OWNER = "55555555-5555-5555-5555-555555555555"
I1, I2 = "24c3a3215805c3d7", "f33b61ccffef3b87"
P1, P2 = "C:\\Users\\Public\\TallyPrime\\Data", "D:\\Copy of Tally\\DATA"
def src(i, did, p, pc, user, choice, first, last, by=None, at=None):
    return {"id": i, "book_id": "b1", "company_guid": "cg-1", "data_id": did, "path": p, "device_id": T.D1, "win_user": user, "computer": pc, "first_seen": first, "last_seen": last,
            "last_line_at": last, "choice": choice, "chosen_by": by, "chosen_at": at}
TWO = [src(1, I1, P1, "NWS144", "anshul", "chosen", "ago:3000", "ago:5", at="ago:3000"), src(2, I2, P2, "PC-2", "anshul", "pending", "ago:60", "ago:30")]
CHOSEN = [src(1, I1, P1, "NWS144", "anshul", "other", "ago:3000", "ago:5", at="ago:3000"), src(2, I2, P2, "PC-2", "anshul", "chosen", "ago:60", "ago:30", by=OWNER, at="ago:2")]
ONE = [src(1, I1, P1, "NWS144", "anshul", "chosen", "ago:3000", "ago:5", at="ago:3000")]
BOOKS = [{"book_id": "b1", "client_id": "CID", "company": "GARG SHEKHAR"}]
SOURCES = """([rows, books, alerts]) => { const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = o => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  let c = Object.values(S.companies).find(x => x.name === "ZZ Test Client");
  if (!c){ c = newCompany({name: "ZZ Test Client", gstin: ""}); c.tallyName = "GARG SHEKHAR"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  window.__sources = fix(rows); window.__books = fix(books).map(b => Object.assign(b, {client_id: c.id})); window.__alerts = fix(alerts || []).map(a => Object.assign(a, {client_id: c.id}));
  Cloud.st.members = [{user_id: '%s', name: 'Anshul'}];
  const api0 = Cloud.api;
  Cloud.api = async (path) => {
    if (/^tally_company_sources/.test(path)) return JSON.parse(JSON.stringify(window.__sources));
    if (/^tally_books/.test(path)) return JSON.parse(JSON.stringify(window.__books));
    if (/^tally_alerts/.test(path)) return JSON.parse(JSON.stringify(window.__alerts));
    return api0(path);
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  S.srcLater = {}; TCloud.pane.devices = null; TCloud.pane.at = 0; S.tallyTab = "computers"; navHome("tally"); return c.id; }""" % OWNER
OTHER_WHY = "saved in another data location of GARG SHEKHAR (\u2461, PC-2); FinCom reads \u2460. Choose on the Tally page."
KINDS = [
    ("held", OTHER_WHY, "othersrc"),
    ("held", "Tally's voucher with that MasterID is not a change after the starting point", "other"),
    # review L2 of next-241: the "older entry" words are Needs you, the Day Book (not Apply now)
    ("held", "the voucher with that MasterID in this Tally is an older entry, not this save; asked by its type and number: 2 entries with that type and number on that date", "daybook"),
    # review H2 of next-241: a line without its data location on a computer FinCom does not read the company from
    ("held", "saved in Tally on PC-2 by an add-on that does not say its data location; FinCom reads \u2460 of GARG SHEKHAR. Restart Tally so the 2.4.1 add-on loads.", "othersrc"),
    ("held", "the company's starting point is not recorded yet, so its entries are not taken from Tally", "baseline"),
    ("held", "this computer's Tally could not be asked whether it was deleted here (no starting point recorded for this company); not sent as a deletion: held", "baseline"),
]
def main():
    srv = http.server.ThreadingHTTPServer(("localhost", 8392), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
            body=json.dumps({"setup": {"version": "2.4.1", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.1.exe", "sha256": "ab" * 32}})))
        pg.goto("http://localhost:8392/"); pg.wait_for_timeout(2500)
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        txt = lambda sel: pg.inner_text(sel).strip() if pg.locator(sel).count() else ""
        def scene(rows, role="owner", alerts=None):
            E(T.SETUP, [[T.OK_DEV], [], T.LINKED, role]); pg.wait_for_timeout(600)
            cid = E(SOURCES, [rows, BOOKS, alerts or []]); pg.wait_for_timeout(1800); return cid
        print("== 1. the one classifier")
        scene(TWO)
        got = E("(rows) => rows.map(([st, why]) => { const l = {state: st, held_why: why, object_guid: '', event: 'other_source'}; return [Rec.needKind(l), AlertHub.oursHeld(l)]; })", [[k[0], k[1]] for k in KINDS])
        bad = [(k[1][:50], k[2], g[0]) for k, g in zip(KINDS, got) if g[0] != k[2]]
        ok(not bad, "each reason -> its kind (wrong: %s)" % bad)
        ok(all(g[1] is False for g in got), "the bell agrees: none of them is 'being fetched' (%s)" % got)
        print("== 2. Sync activity: one Needs-you group, the Tally page")
        E(T.SYNC, [T.rline(41, "GARG SHEKHAR", "2026-10-09", why=OTHER_WHY), T.rline(42, "GARG SHEKHAR", "2026-10-09", why=OTHER_WHY)]); pg.wait_for_timeout(1800)
        grp = E("() => [...document.querySelectorAll('#app [data-sync-needs] [data-needs-group]')].map(g => [g.getAttribute('data-needs-group').split('|')[0], g.querySelector('[data-needs-text]').innerText.trim(), [...g.querySelectorAll('button:not([data-alert-clear])')].map(b => b.getAttribute('data-needs-act') + ':' + b.innerText.trim())])")
        ok(len(grp) == 1 and grp[0][0] == "othersrc" and grp[0][2] == ["tally:Open the Tally page"], "one group, ONE action: the Tally page (%s)" % grp)
        ok(grp and grp[0][1] == "GARG SHEKHAR: 2 entries saved in another data location of GARG SHEKHAR (\u2461, PC-2); FinCom reads \u2460. Choose on the Tally page.", "the words (%s)" % (grp and grp[0][1]))
        print("== 3. the Tally page: the card, owner")
        scene(TWO)
        card = '#app [data-sources-card="b1"]'
        t = txt(card)
        ok(pg.locator(card).count() == 1, "one card for the book with two locations")
        ok(t.startswith("GARG SHEKHAR is open in two places with different data:") and "Which one is your books? FinCom reads only that one." in t, "the words (%s)" % t[:400])
        ok(re.search(r"\u2460 NWS144 \u00b7 anshul \u00b7 C:\\Users\\Public\\TallyPrime\\Data \(last entry [^)]+\)", t) is not None and re.search(r"\u2461 PC-2 \u00b7 anshul \u00b7 D:\\Copy of Tally\\DATA \(last entry [^)]+\)", t) is not None, "\u2460 and \u2461: computer, user, folder, last entry (%s)" % t)
        btn = E("(c) => [...document.querySelectorAll(c + ' button')].map(b => b.innerText.trim())", card)
        ok(btn == ["Use \u2460", "Use \u2461", "These are the same data (both computers read it)", "Decide later"], "Use \u2460, Use \u2461, the same data, Decide later (%s)" % btn)
        # review M3 of next-241: the location FinCom reads already: its Use is disabled
        ok(E("(c) => document.querySelector(c + ' [data-source-use=\"%s\"]').disabled" % I1, card) is True and E("(c) => document.querySelector(c + ' [data-source-use=\"%s\"]').disabled" % I2, card) is False,
           "M3: Use \u2460 disabled (FinCom reads it already)")
        # review H5 of next-241: "These are the same data" asks once, then tally_company_source_same(book)
        E("() => { window.__calls = []; }")
        pg.click(card + " [data-source-same]"); pg.wait_for_timeout(500)
        qs = pg.inner_text("#confirmBox .cbx .note").strip() if pg.locator("#confirmBox .cbx").count() else ""
        ok("the same data" in qs and "\u2460" in qs and "\u2461" in qs and not [c for c in E("window.__calls") if c[0] == "tally_company_source_same"], "H5: the same data asks first (%r)" % qs)
        if pg.locator("#confirmBox .cbx").count(): pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(800)
        ok([c for c in E("window.__calls") if c[0] == "tally_company_source_same"] == [["tally_company_source_same", {"p_book": "b1"}]], "H5: tally_company_source_same(book) (%s)" % E("window.__calls"))
        scene(TWO)
        # the coordinator, 09-Oct-2026: Use ② asks once before anything is sent
        E("() => { window.__calls = []; }")
        pg.click(card + ' [data-source-use="%s"]' % I2); pg.wait_for_timeout(600)
        q_ = pg.inner_text("#confirmBox .cbx .note").strip() if pg.locator("#confirmBox .cbx").count() else ""
        want_q = "FinCom will read GARG SHEKHAR from ② (PC-2 · D:\\Copy of Tally\\DATA) from now on. Entries from ① will be held, not used. You'll need to upload ②'s Day Book for the year. Continue?"
        ok(q_ == want_q and not [c for c in E("window.__calls") if c[0] == "tally_company_source_choose"], "Use ②: the question first, nothing sent (%r)" % q_)
        pg.click('#confirmBox [data-cbx="no"]'); pg.wait_for_timeout(500)
        ok(not [c for c in E("window.__calls") if c[0] == "tally_company_source_choose"], "Cancel: nothing sent")
        pg.click(card + ' [data-source-use="%s"]' % I2); pg.wait_for_timeout(500); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(1000)
        calls = [c for c in E("window.__calls") if c[0] == "tally_company_source_choose"]
        ok(calls == [["tally_company_source_choose", {"p_book": "b1", "p_data_id": I2}]], "Use \u2461 asks tally_company_source_choose(book, \u2461) (%s)" % E("window.__calls"))
        scene(TWO)
        pg.click(card + " [data-source-later]"); pg.wait_for_timeout(600)
        ok(pg.locator(card + " [data-source-use]").count() == 0 and "later" in txt(card).lower(), "Decide later: folded (%s)" % txt(card))
        scene(ONE)
        ok(pg.locator("#app [data-sources-card]").count() == 0, "one location: no card")
        print("== 4. after the choice")
        cid = scene(CHOSEN)
        t = txt(card)
        ok("FinCom now reads \u2461. Upload \u2461's Day Book for the year (one month per file) so the history matches." in t, "the words after a choice (%s)" % t)
        ok(re.search(r"Chosen by Anshul at .*IST", t) is not None, "who and when (%s)" % t)
        pg.click(card + " [data-source-upload]"); pg.wait_for_timeout(1500)
        st = E("[S.view, S.coId, S.dbFrom, S.dbTo, S.clientTab || '']")
        ok(st[0] == "company" and st[1] == cid and re.match(r"^\d{4}-04-01$", st[2] or "") and st[3], "the upload page of the client, the year so far (%s)" % st)
        print("== 5. staff")
        scene(TWO, role="member")
        ok(pg.locator(card).count() == 1 and "Which one is your books?" in txt(card) and pg.locator(card + " button").count() == 0, "staff: the words, no button (%s)" % txt(card)[:200])
        print("== 6. the bell")
        scene(TWO, alerts=[{"id": 71, "kind": "summary", "book_id": "b1", "device_id": T.D1, "day": "2026-10-09", "at": "ago:30", "read_at": None,
                            "words": "GARG SHEKHAR is open in two places with different data: choose on the Tally page which one is your books (FinCom reads only that one)",
                            "data": {"reason": "source", "dataId": I2, "path": P2, "computer": "PC-2", "user": "anshul"}}])
        E("() => { Rec.alerts.at = 0; Rec.alerts.none = false; return Rec.alertsLoad && Rec.alertsLoad(); }"); pg.wait_for_timeout(1500)
        items = E("() => AlertHub.list().map(x => [x.key, x.text, x.act ? x.act.label : ''])")
        it = [x for x in items if "open in two places" in (x[1] or "")]
        # review L8 of next-241: the bell's line for the held lines of another location: no "..", its action the Tally page
        bk = [x for x in items if "another data location" in (x[1] or "")]
        ok(bk and all(".." not in x[1] for x in bk) and all(x[2] == "Open the Tally page" for x in bk), "L8: the held lines' bell line (%s)" % bk)
        ok(len(it) == 1 and it[0][2] == "Open the Tally page", "the bell lists the alert ONCE (not also as the day's summary), its action the Tally page (%s)" % items)
        ok(not errors, "no page errors " + str(errors[:2]))
        br.close()
    srv.shutdown()
main()
print("\nFAILED: %d" % len(fails) if fails else "\nall ok")
sys.exit(1 if fails else 0)
