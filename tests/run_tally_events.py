"""python3 run_tally_events.py - FinCom Bridge 2.1.3 reads Tally only after an event, so FinCom says how a client's Tally
stands in one line, from the bridge's heartbeat, with one button, Update now:
  - "Tally open on NWS144 · last read 15:34", "Tally is closed on NWS144", "NWS144 is offline",
    "Tally is not answering on NWS144 since 12:28", "Background reading paused on NWS144";
  - on the Post page's status line ("Posting into ZZ TEST · Tally open on NWS144 · read 15:34 IST · Update now", what is
    wrong on a second line: second pass of 02-Oct-2026), in the Tally panel of the top bar, and on the Tally page;
  - Update now sends the event (tally_want_update for the client); opening the client wakes its Tally computer once
    (tally-ingest, kind "wake", what "open"), and not again within five minutes;
  - "Books as of 15:34 · Update now" where the client's books figures are shown (MIS).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_events.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8241), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = """async () => {
  const c = newCompany({name: "ZZ Test Client", gstin: ""}); c.tallyName = "ZZ TEST"; choiceConfirm(c, "postTo", "ZZ TEST");
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  const o = newCompany({name: "Other Client", gstin: ""}); o.tallyName = "OTHER CO";
  S.companies[o.id] = o; S.data[o.id] = {parties: {}, entries: {}, loaded: true}; o.stats = {};
  const t = new Date(); t.setHours(15, 34, 0, 0);
  const pad = n => String(n).padStart(2, "0"), local = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":00";
  window.__read = local(t);
  window.__rpc = []; window.__wake = [];
  Cloud.on = () => true; Cloud.st.firm = {id: "f-1"}; Cloud.st.members = [];
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); return fn === "tally_want_update" ? {ok: true} : null; };
  TCloud.restAll = async () => []; Cloud.api = async () => [];
  TCloudUp.post = async (body) => { window.__wake.push(JSON.parse(JSON.stringify(body))); return {ok: true, woken: 1}; };
  window.__beat = () => ({at: new Date().toISOString(), every: 30, tally: true, tallyState: "open", events: true, nightlyAt: "02:00", paused: false, notAnsweringSince: "",
    lastRead: window.__read, companies: [{name: "ZZ TEST", open: true, at: window.__read, phase: "live", waiting: 0, lastRead: window.__read},
      {name: "OTHER CO", open: true, at: window.__read, phase: "live", waiting: 0, lastRead: window.__read}], open: ["ZZ TEST", "OTHER CO"]});
  window.__dev = {id: "d-1", name: "Office computer", revoked: false, last_seen: new Date().toISOString(), info: {computer: "NWS144", user: "anshul", beat: window.__beat()}};
  // the heartbeat as FinCom reads it (tally_devices, tally_companies): no database here
  TLight.refresh = function(){};
  TLight.st = {at: Date.now(), busy: false, by: {}, devs: [window.__dev],
    cos: [{company: "ZZ TEST", client_id: c.id, device_id: "d-1"}, {company: "OTHER CO", client_id: o.id, device_id: "d-1"}]};
  TCloud.pane = Object.assign(TCloud.pane, {devices: [window.__dev], companies: TLight.st.cos, busy: "", err: "", at: Date.now()});
  document.body.classList.add("is-test");
  await openCompany(c.id);
  goStep("post", "bills");
  return [c.id, o.id];
}"""
STATE = """(x) => { const b = window.__dev.info.beat; Object.assign(b, {tallyState: "open", tally: true, paused: false, notAnsweringSince: ""}, x.beat || {});
  window.__dev.info.beat.at = new Date(Date.now() - (x.ageMin || 0) * 60000).toISOString(); BeatSeen[window.__dev.id] = null; render(); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}, timezone_id="Asia/Kolkata"); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8241/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    cid, oid = E(SETUP); pg.wait_for_timeout(900)
    # opening the client wakes its Tally computer once
    w = E("window.__wake")
    ok(len(w) == 1 and w[0].get("kind") == "wake" and w[0].get("what") == "open" and w[0].get("client") == cid,
       "opening the client wakes its Tally computer for one light update (%s)" % w)
    E("async (id) => { await openCompany(id); goStep('post', 'bills'); }", cid); pg.wait_for_timeout(500)
    ok(len(E("window.__wake")) == 1, "opened again within five minutes: no second wake")
    # 1. Tally open, with the last read
    line = lambda sel="#app [data-post-problem]": pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    pline = lambda: line("#app [data-post-line]")
    ok(pline() == "Posting into ZZ TEST · Tally open on NWS144 · read 15:34 IST · Update now" and line() == "", "Post page: one line: %r" % pline())
    ok(pg.locator("#app [data-post-line] [data-update-now]").count() == 1, "Post page: in it, one button: Update now")
    pg.click("#app [data-post-line] [data-update-now]"); pg.wait_for_timeout(400)
    ok(["tally_want_update", {"p_client": cid}] in E("window.__rpc"), "Update now sends the event (tally_want_update for the client)")
    # 2. Tally closed
    E(STATE, {"beat": {"tallyState": "closed", "tally": False}}); pg.wait_for_timeout(300)
    ok(line().startswith("Tally is closed on NWS144: open TallyPrime there"), "Tally closed: %r" % line())
    # 3. the computer offline (three heartbeats missed)
    E(STATE, {"ageMin": 10}); pg.wait_for_timeout(300)
    ok(line().startswith("NWS144 is offline: start that computer"), "the computer offline: %r" % line())
    # 4. Tally not answering (requirement 12)
    E(STATE, {"beat": {"tallyState": "busy", "notAnsweringSince": "2026-10-02T12:28:00"}}); pg.wait_for_timeout(300)
    l4 = line()
    ok(l4.startswith("Tally is not answering on NWS144 since ") and "12:28" in l4, "Tally not answering: %r" % l4)
    # 5. background reading paused in the tray
    E(STATE, {"beat": {"paused": True}}); pg.wait_for_timeout(300)
    ok(line().startswith("Background reading paused on NWS144: resume it") and pg.locator("#app [data-post-problem] [data-post-action]").inner_text() == "Update now", "paused: %r" % line())
    E(STATE, {}); pg.wait_for_timeout(300)
    # the Tally panel of the top bar says the same line
    E("() => doAct('tallyPanel')"); pg.wait_for_timeout(400)
    pl = line("[data-panel-tally-line] [data-tally-line-text]")
    ok(pl == "Tally open on NWS144 · last read 15:34 IST", "the Tally panel: %r" % pl)
    E("() => doAct('tallyPanelClose')"); pg.wait_for_timeout(300)
    # the Tally page: one line a client, each with Update now
    E("() => navHome('tally')"); pg.wait_for_timeout(800)
    rows = pg.locator("#app [data-client-lines] [data-client-line]")
    first = pg.inner_text("#app [data-client-lines] [data-client-line]") if rows.count() else ""
    ok(rows.count() == 2 and "ZZ Test Client" in first and "Tally open on NWS144" in first, "the Tally page: one line a client, the open client first (%s)" % first.replace("\n", " "))
    E("() => { window.__rpc = []; }")
    pg.click('#app [data-client-line="%s"] [data-update-now]' % oid); pg.wait_for_timeout(400)
    ok(["tally_want_update", {"p_client": oid}] in E("window.__rpc"), "Update now on another client's line asks for that client")
    # Books as of 15:34 · Update now (MIS)
    E("(id) => { S.books = {cid: id, vouchers: [], meta: {}, busy: ''}; goClient('books:mis'); }", cid); pg.wait_for_timeout(800)
    ao = pg.inner_text("#app [data-books-asof]") if pg.locator("#app [data-books-asof]").count() else ""
    ok(ao.startswith("Books as of 15:34") and "Update now" in ao, "MIS: %r" % ao)
    tip = pg.get_attribute("#app [data-books-asof]", "title") if pg.locator("#app [data-books-asof]").count() else ""
    ok("Tally cannot send its changes by itself" in (tip or ""), "it says why: entries made in Tally come in at the next update")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
