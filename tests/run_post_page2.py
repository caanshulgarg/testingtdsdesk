"""python3 run_post_page2.py - Post to Tally, second pass of the review of 02-Oct-2026 (Testing AAD, screen of 17:43):
the page shows only what needs a decision.
  1. one status line, "Posting into GARG SHEKHAR & COMPANY · Tally open on NWS144 · read 15:34 · Update now"; it says
     "Reading now…" while the Tally computer reads, and the new time as soon as its heartbeat is passed on (Realtime);
  2. "Ready to post": approved bills only, the ledgers on one line (a Round Off of nothing left out), one button
     "Post N to Tally"; "Nothing waiting to post" with no table and no button when there are none;
  3. "Needs your attention": each bill once; FA/ELEC/013 (not found in the cloud copy) is read afresh before it is called
     missing: "Not checked yet" (no Post again) when the read fails or is older than the posting; "Not found in Tally at
     the HH:MM read" after a fresh read; Post again reads Tally live first and refuses "Already in Tally (voucher no. …)";
  4. one count: the tab badge, the header chip, the dashboard tile and the Post button agree; a second badge for what
     needs attention;
  5. History hidden behind "History (N)": a failed posting finished by a later one is one line "Posted … (second try)";
     no Dismiss on a posting that worked; a posting still failed needs attention (Retry, Dismiss);
  6. FinCom Bridge 2.1.4 answers per bill: already in Tally (a second tab with stale data cannot post a duplicate: the
     bill is marked in Tally) or could not check Tally (nothing posted, the bill waits with that line and Retry).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_page2.py"""
import os, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8263), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
GARG = "GARG SHEKHAR & COMPANY"
SETUP = """async () => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tallyName = "GARG SHEKHAR & COMPANY";
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  choiceConfirm(c, "tds:professional", "TDS Payable - Professional"); choiceConfirm(c, "postTo", "GARG SHEKHAR & COMPANY");
  const pad = n => String(n).padStart(2, "0"), local = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":00";
  const ago = m => new Date(Date.now() - m * 60000);
  window.__local = local; window.__ago = (m) => local(ago(m));
  window.__read0 = local(ago(90));                                   // the last read: an hour and a half ago
  window.__rpc = []; window.__posted = []; window.__calls = [];
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-1", name: "Anshul"}];
  TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "bk1", company: "GARG SHEKHAR & COMPANY", daysAt: new Date().toISOString(), state: {doneTo: "20261001", skipped: []}}]};
  const t = (m) => ago(m).toISOString();
  // the postings in FinCom's cloud: jA failed, its entry put in later by jB (second try); jC done; jD still failed
  window.__jobs = [
    {id: "jB", client_id: c.id, company: "GARG SHEKHAR & COMPANY", status: "done", done: 1, n: 1, message: "1 of 1 sent to Tally", created_at: t(50), updated_at: t(49), entry_ids: ["old1"], results: [{id: "old1", ok: true, verified: true}], created_by: "u-1"},
    {id: "jA", client_id: c.id, company: "GARG SHEKHAR & COMPANY", status: "failed", done: 0, n: 1, message: "Tally did not answer: timed out (2.1.1)", created_at: t(80), updated_at: t(79), entry_ids: ["old1"], results: []},
    {id: "jC", client_id: c.id, company: "GARG SHEKHAR & COMPANY", status: "done", done: 1, n: 1, message: "1 of 1 sent to Tally", created_at: t(300), updated_at: t(299), entry_ids: ["old2"], results: [{id: "old2", ok: true, verified: true}]},
    {id: "jD", client_id: c.id, company: "GARG SHEKHAR & COMPANY", status: "failed", done: 0, n: 1, message: "Ledger 'Professional Fees' does not exist", created_at: t(120), updated_at: t(119), entry_ids: ["old3"], results: []}];
  TCloud.restAll = async (u) => /tally_post_jobs/.test(u) ? JSON.parse(JSON.stringify(window.__jobs)) : [];
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); if (fn === "tally_status") return TCloud.st[a.p_client].books;
    return /^tally_(want_update|post_enqueue|post_dismiss|post_undismiss|post_record)$/.test(fn) ? {ok: true} : null; };
  Cloud.api = async (path) => { window.__calls.push(path); if (/tally_vouchers\\?/.test(path)) return []; return []; };
  CloudJobs.list = null; CloudJobs.at = 0; CloudJobs.tried = {};
  // the Tally computer, as FinCom keeps its heartbeat (tally_devices / tally_companies): no database here
  window.__dev = {id: "d-1", name: "NWS144", revoked: false, last_seen: new Date().toISOString(), info: {computer: "NWS144", beat: {at: new Date().toISOString(), every: 30, tally: true, tallyState: "open",
    events: true, paused: false, notAnsweringSince: "", updating: false, lastRead: window.__read0, open: ["GARG SHEKHAR & COMPANY"],
    companies: [{name: "GARG SHEKHAR & COMPANY", open: true, at: window.__read0, phase: "live", waiting: 0, lastRead: window.__read0}]}}};
  TLight.refresh = function(){ return Promise.resolve(); };
  TLight.st = {at: Date.now(), busy: false, by: {}, devs: [window.__dev], cos: [{company: "GARG SHEKHAR & COMPANY", client_id: c.id, device_id: "d-1"}]};
  TCloud.pane = Object.assign(TCloud.pane, {devices: [Object.assign({main_bridge: "go-1"}, window.__dev, {info: Object.assign({}, window.__dev.info, {bridges: {"go-1": {computer: "NWS144", version: "2.1.3", mode: "main", at: new Date().toISOString(), tallyState: "open"}}})})],
    companies: TLight.st.cos, busy: "", err: "", at: Date.now()});
  TCloudUp.post = async () => ({ok: true});
  PostCheck.WAIT = 2500; PostCheck.POLL = 300;
  await openCompany(c.id);
  const mk = (id, n, no, amt, extra) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; approve(e); Object.assign(e, extra || {}); return e; };
  const r1 = mk("r1", "Alpha Consultants", "A/1", 100000), r2 = mk("r2", "Kashi IT Solutions", "K/7", 20000);
  // a Round Off of nothing on A/1 (left out), and of 0.40 on K/7 (shown)
  r1.snapshot.lines.push({side: "Dr", ledger: "Round Off", amt: 0, role: "roundoff"}); r2.snapshot.lines.push({side: "Dr", ledger: "Round Off", amt: 0.4, role: "roundoff"});
  refreshStats(c.id); goStep("post", "bills");
  await new Promise(r => setTimeout(r, 500));
  S.bank.loading = false;
  window.ensureTallyCompany = async () => "GARG SHEKHAR & COMPANY"; window.syncLedgersFromTally = async () => true; window.tallyCall = async () => ({vouchers: []});
  render();
  return c.id;
}"""
# the bills sent and not confirmed: FA/ELEC/013 (posted 29-Sep, not found in the cloud copy since), a Tally file (T/1),
# and FA/ELEC/020 posted ten minutes ago, also not found
GONE = """() => { const c = CO(), mk = (id, n, no, amt, extra) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; approve(e); Object.assign(e, extra || {}); Store.saveEntry(c.id, e); return e; };
  mk("fa", "FINGATE ADVISORY SERVICES PRIVATE LIMITED", "FA/ELEC/013", 25535, {exportedAt: "2026-09-29T03:58:55Z", postVerified: true, postedVia: "bridge", goneFromTally: "2026-10-02T10:04:00Z",
    tally: {at: "2026-09-29T03:58:55Z", guid: "g-66b4", vchDate: "20260701", vchType: "Journal", company: "GARG SHEKHAR & COMPANY"}});
  const p10 = new Date(Date.now() - 10 * 60000).toISOString();
  mk("fb", "FINGATE ADVISORY SERVICES PRIVATE LIMITED", "FA/ELEC/020", 11800, {exportedAt: p10, postVerified: true, postedVia: "bridge", goneFromTally: new Date().toISOString(),
    tally: {at: p10, guid: "g-66c0", vchDate: "20260701", vchType: "Journal", company: "GARG SHEKHAR & COMPANY"}});
  mk("tf", "Tally File Co", "T/1", 5000, {exportedAt: new Date(Date.now() - 3600000).toISOString()});
  mk("in1", "Done Co", "D/1", 7000, {exportedAt: "2026-09-20T03:00:00Z", postVerified: true, postedVia: "bridge", tally: {at: "2026-09-20T03:00:00Z", guid: "g-1", vchDate: "20260701"}});
  TallyProof.at[c.id] = Date.now(); refreshStats(c.id); render(); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8263/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    cid = E(SETUP); pg.wait_for_timeout(1200)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    hm = lambda iso: E("(x) => tallyHm(x)", iso)
    # the page in three tabs (plan item 1b): To post / Posted / Errors
    def go_tab(name):
        pg.click('#app [data-post-tabs] [data-post-tab="%s"]' % name); pg.wait_for_timeout(250)
    on = lambda: pg.get_attribute('#app [data-post-tab][aria-selected="true"]', "data-post-tab")
    # ---- 1. the status line, and the read time after an event-driven read
    line = txt("#app [data-post-line]")
    ok(line == "Posting into GARG SHEKHAR & COMPANY · Tally open on NWS144 · read %s · Update now" % hm(E("window.__read0")) and pg.locator("#app [data-post-problem]").count() == 0,
       "1. one status line, nothing else: %r" % line)
    E("() => { Live.tallyTopic = 'realtime:fincom-tally-f-1'; Live.got({topic: Live.tallyTopic, event: 'broadcast', payload: {type: 'broadcast', event: 'beat', payload: {device: 'd-1', beat: {updating: true}}}}); }")
    pg.wait_for_timeout(300)
    ok("· Reading now…" in txt("#app [data-post-line]") and "read " + hm(E("window.__read0")) not in txt("#app [data-post-line]"), "7. a read going on (the heartbeat passed on at once): 'Reading now…' (%s)" % txt("#app [data-post-line]"))
    E("""() => { window.__read1 = window.__ago(1); Live.got({topic: Live.tallyTopic, event: 'broadcast', payload: {type: 'broadcast', event: 'beat', payload: {device: 'd-1',
      beat: {updating: false, lastRead: window.__read1, companies: [{name: 'GARG SHEKHAR & COMPANY', open: true, at: window.__read1, lastRead: window.__read1}]}}}}); }""")
    pg.wait_for_timeout(300)
    r1 = hm(E("window.__read1"))
    ok(txt("#app [data-post-line]") == "Posting into GARG SHEKHAR & COMPANY · Tally open on NWS144 · read %s · Update now" % r1, "7. right after the read: 'read %s' (%s)" % (r1, txt("#app [data-post-line]")))
    pg.click("#app [data-post-line] [data-update-now]"); pg.wait_for_timeout(300)
    ok("· Reading now…" in txt("#app [data-post-line]") and any(r[0] == "tally_want_update" for r in E("window.__rpc")), "7. Update now: asked, and 'Reading now…' until a newer read comes in")
    E("""() => { window.__read2 = window.__ago(0); Live.got({topic: Live.tallyTopic, event: 'broadcast', payload: {type: 'broadcast', event: 'beat', payload: {device: 'd-1',
      beat: {updating: false, lastRead: window.__read2, companies: [{name: 'GARG SHEKHAR & COMPANY', open: true, lastRead: window.__read2}]}}}}); }""")
    pg.wait_for_timeout(300)
    ok(("read " + hm(E("window.__read2"))) in txt("#app [data-post-line]") and "Reading now" not in txt("#app [data-post-line]"), "7. and the new read time as soon as it is passed on (%s)" % txt("#app [data-post-line]"))
    ok(on() == "errors", "1b. a posting still failed (jD): the Errors tab opens by itself (%s)" % on())
    go_tab("topost")
    E("document.querySelector(\"#app details[data-more='post']\").open = true")
    ok(txt("#app [data-post-bridge]") == "FinCom Bridge 2.1.3 · Ready", "1. the bridge's version and Ready are under More (%s)" % txt("#app [data-post-bridge]"))
    E("document.querySelector(\"#app details[data-more='post']\").open = false")
    # ---- 2. Ready to post, the ledgers on one line, Round Off only when not nothing
    led = lambda i: txt('#app [data-post-ready] [data-post-row="%s"] [data-ledgers]' % i)
    ok(led("r1") == "Alpha Consultants · Professional Charges · TDS Payable - Professional" and "Round Off" in led("r2"), "6. Round Off left out when nothing (%r), shown when 0.40 (%r)" % (led("r1"), led("r2")))
    # ---- the bills sent and not confirmed come in
    E(GONE); pg.wait_for_timeout(3800)
    # ---- 4. one count
    num = lambda t: int((re.findall(r"\d+", t or "") or ["-1"])[0])
    def counts():
        chip = E("tallyStatus(CO()).short"); tab = E("(document.querySelector('nav.sbar [data-step=post] [data-step-n]') || {}).textContent || ''")
        attn = E("(document.querySelector('nav.sbar [data-step=post] [data-attn-n]') || {}).textContent || ''")
        btn = txt("#app [data-post-main]")
        E("() => { S.tab = 'dash'; render(); }"); pg.wait_for_timeout(300)
        dash = E("(() => { const t = Array.from(document.querySelectorAll('#app .dtile')).find(x => /Post to Tally/.test(x.textContent)); return t ? t.querySelector('b').textContent : ''; })()")
        E("() => { goStep('post', 'bills'); }"); pg.wait_for_timeout(400)
        return chip, tab, attn, btn, dash
    chip, tab, attn, btn, dash = counts()
    ok([num(chip), num(tab), num(btn), num(dash)] == [2, 2, 2, 2] and chip == "2 entries for Tally" and btn == "Post 2 to Tally",
       "4. one count in the four places: chip %r, tab %r, button %r, dashboard %r" % (chip, tab, btn, dash))
    ok(attn == "4" and E("postAttentionFor(S.coId)") == 4 and E("getComputedStyle(document.querySelector('nav.sbar [data-attn-n]')).backgroundColor") != E("getComputedStyle(document.querySelector('nav.sbar [data-step=post] [data-step-n]')).backgroundColor"),
       "4. what needs attention is a second badge of its own colour: %r (FA/ELEC/013, FA/ELEC/020, T/1, the failed posting)" % attn)
    # ---- 3. each bill once
    rows_of = lambda: E("Array.from(document.querySelectorAll('#app [data-post-page] [data-bill-row]')).map(r => r.getAttribute('data-bill-row'))")
    ids = []
    for t in ("topost", "posted", "errors"):
        go_tab(t); ids += rows_of()
    ok(sorted(ids) == ["fa", "fb", "r1", "r2", "tf"] and len(ids) == len(set(ids)), "3. each bill in exactly one tab and section, once (%s); the one in Tally not at all" % ids)
    go_tab("topost")
    ok(E("Array.from(document.querySelectorAll('#app [data-post-ready] [data-bill-row]')).map(r => r.getAttribute('data-bill-row')).sort().join()") == "r1,r2", "2. Ready to post: approved bills never sent only")
    go_tab("errors")
    ok(pg.locator("#app [data-post-attention] li").evaluate_all("ls => ls.every(l => l.querySelectorAll('button').length <= 2)"), "3. at most two buttons a row")
    for gone in ("Check them in Tally", "Post the ones no longer in Tally again", "deleted there?"):
        ok(gone not in pg.inner_text("#app [data-post-page]"), "6. no %r on the page" % gone)
    # FA/ELEC/013: the fresh read did not come (the Tally computer did not read): Not checked yet, no Post again
    fa = txt('#app [data-post-attention] [data-bill-row="fa"]')
    ok("Not checked yet: the Tally computer has not read Tally since" in fa and pg.locator('#app [data-bill-row="fa"] [data-post-again]').count() == 0 and pg.locator('#app [data-bill-row="fa"] [data-check-now]').count() == 1,
       "3. the fresh read failed: 'Not checked yet' (why), Check now, no Post again (%s)" % fa[:200])
    ok(any(r[0] == "tally_want_update" and r[1].get("p_client") == cid for r in E("window.__rpc")), "3. the Tally computer was asked to read afresh first")
    # FA/ELEC/020 posted ten minutes ago; the Tally computer reads, but its read is from before the posting
    E("""() => { delete PostCheck.fresh[S.coId]; const b = window.__dev.info.beat, r30 = window.__ago(30); window.__readOld = window.__ago(20);
      b.lastRead = r30; b.companies[0].lastRead = r30;
      setTimeout(() => { b.lastRead = window.__readOld; b.companies[0].lastRead = window.__readOld; }, 600);
      PostCheck.run(CO(), D().entries.fb, true); }""")
    pg.wait_for_timeout(2000)
    fb = txt('#app [data-post-attention] [data-bill-row="fb"]')
    ok("Not checked yet: the last read (%s) is older than the posting" % hm(E("window.__readOld")) in fb and pg.locator('#app [data-bill-row="fb"] [data-post-again]').count() == 0,
       "3. a read older than the posting: 'Not checked yet', no Post again (%s)" % fb[:200])
    # the bridge here, with the company open: a live read. Not found: "Not found in Tally at the HH:MM read", Post again
    E("""() => { window.__vs = []; window.__bridgeCalls = []; Bridge.on = () => true; Bridge.up = () => true; Bridge.openFor = () => ({name: "GARG SHEKHAR & COMPANY", port: 9000});
      Bridge.st = Object.assign({}, Bridge.st, {state: "ok", version: "2.1.4", tallyUp: true, computer: "NWS144", open: [{name: "GARG SHEKHAR & COMPANY", port: 9000}]});
      Bridge.call = async (u) => { window.__bridgeCalls.push(u); if (window.__bridgeDown) throw new Error("timed out after 120 s"); return {vouchers: window.__vs}; };
      window.__bp = []; Bridge.post = async (pl) => { window.__bp.push(JSON.parse(JSON.stringify(pl))); return window.__answer ? window.__answer(pl) : {ok: true, company: pl.company, results: pl.vouchers.map(v => ({id: v.id, ok: true, verified: true}))}; };
      render(); }""")
    pg.click('#app [data-bill-row="fa"] [data-check-now]'); pg.wait_for_timeout(800)
    fa = txt('#app [data-post-attention] [data-bill-row="fa"]'); now = E("tallyHm(Date.now())")
    ok(("Not found in Tally at the %s read" % now) in fa and pg.locator('#app [data-bill-row="fa"] [data-post-again]').count() == 1 and "/vouchers?company=GARG" in (E("window.__bridgeCalls") or [""])[-1],
       "3. a live read through the bridge: 'Not found in Tally at the %s read', Post again offered (%s)" % (now, fa[:160]))
    # Post again, the live check failing: refused with the reason, nothing posted
    E("() => { window.__bridgeDown = true; }")
    pg.click('#app [data-bill-row="fa"] [data-post-again]'); pg.wait_for_timeout(800)
    note = txt("#app [data-post-note]")
    ok(note.startswith("Not posted again: Tally could not be checked (FinCom Bridge did not answer") and E("window.__bp.length") == 0 and not E("billInTally(D().entries.fa)") and E("!!D().entries.fa.exportedAt"),
       "3. Post again with the live check failing: refused with the reason, nothing posted (%s)" % note)
    # Post again, the live check finding the same party, bill no., date and amount: "Already in Tally", nothing posted
    E("""() => { window.__bridgeDown = false; window.__vs = [{date: "20260701", type: "Journal", number: "FA/ELEC/013", reference: "FA/ELEC/013", party: "FINGATE ADVISORY SERVICES PRIVATE LIMITED",
      narration: "Professional fees", guid: "g-new-66d1", cancelled: "No", entries: [{ledger: "FINGATE ADVISORY SERVICES PRIVATE LIMITED", amount: "25535.00"}, {ledger: "Professional Charges", amount: "-25535.00"}]}];
      PostCheck.st.fa = {busy: false, at: Date.now(), ok: true, found: null, readAt: new Date().toISOString()}; render(); }""")
    pg.wait_for_timeout(300)
    pg.click('#app [data-bill-row="fa"] [data-post-again]'); pg.wait_for_timeout(800)
    note = txt("#app [data-post-note]"); fa = E("(() => { const e = D().entries.fa; return [billInTally(e), e.tally.guid, e.tallyVchNo || '', !!e.goneFromTally]; })()")
    ok(note.startswith("Already in Tally (voucher no. FA/ELEC/013, 01-Jul-2026)") and E("window.__bp.length") == 0 and not any(r[0] == "tally_post_enqueue" for r in E("window.__rpc")),
       "3. Post again: the live check found it: 'Already in Tally (voucher no. …, date)', nothing posted (%s)" % note)
    ok(fa == [True, "g-new-66d1", "FA/ELEC/013", False] and pg.locator('#app [data-bill-row="fa"]').count() == 0, "3. and the bill counts as in Tally, with that voucher; off the page (%s)" % fa)
    # ---- 5. History: the Posted tab (plan item 1b: shown, not folded away)
    go_tab("posted")
    hs = pg.locator("#app [data-post-history]")
    ok(hs.count() == 1 and txt('#app [data-post-tab="posted"] [data-tab-n]') == "2" and pg.locator("#app [data-post-history] [data-job]").count() == 2 and pg.locator("#app [data-post-panel='posted'] details").count() == 0,
       "5. Posted (2): both postings listed, not folded away")
    jb = txt('#app [data-post-history] [data-job="jB"]'); at = E("tallyHm(window.__jobs[0].updated_at)")
    ok(jb.startswith("Posted %s (second try)" % at) and "timed out" not in txt("#app [data-post-history]") and pg.locator('#app [data-job="jA"]').count() == 0,
       "5. failed then succeeded: one line 'Posted %s (second try)', without the old error (%s)" % (at, jb))
    ok(pg.locator("#app [data-post-history] [data-dismiss]").count() == 0 and pg.locator('#app [data-job="jC"] [data-dismiss]').count() == 0, "5. a posting that worked never has Dismiss")
    go_tab("errors")
    jd = pg.locator('#app [data-post-attention] [data-job="jD"]')
    ok(jd.count() == 1 and jd.locator("[data-retry]").count() == 1 and jd.locator("[data-dismiss]").count() == 1 and "does not exist" in jd.inner_text(), "5. the posting still failed needs attention: Retry and Dismiss")
    # ---- 6. FinCom Bridge 2.1.4: already in Tally (a second tab with stale data), and a check that could not be made
    E("""() => { S.bank.ledgers = Object.assign({}, S.bank.ledgers, {importedAt: new Date().toISOString(), live: true, list: ["Alpha Consultants", "Kashi IT Solutions", "Professional Charges",
      "TDS Payable - Professional", "Round Off"].map(n => ({name: n, group: ""}))}); render(); }""")
    pg.wait_for_timeout(300)
    E("""() => { window.__answer = (pl) => ({ok: true, company: pl.company, results: pl.vouchers.map(v => v.id === "r2"
        ? {id: v.id, ok: false, already: true, guid: "g-k7", vchNo: "K/7", vchNumber: "K/7", vchType: "Journal", vchDate: "20260701", message: "Already in Tally (voucher no. K/7, 01-07-2026)"}
        : {id: v.id, ok: false, checkFailed: true, message: "Could not check Tally, not posted. Try again."})}); }""")
    go_tab("topost")
    pg.click("#app [data-post-main]"); pg.wait_for_timeout(600)
    ok(pg.locator("#confirmBox [data-post-preview]").count() == 1, "6. Post 2 to Tally: each bill shown first")
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(1500)
    k7 = E("(() => { const e = D().entries.r2; return [e.status, billInTally(e), e.tally && e.tally.guid, e.tallyVchNo, e.postNote]; })()")
    sent = E("window.__bp.map(p => p.vouchers.map(v => v.id).join(','))")
    ok(k7 == ["approved", True, "g-k7", "K/7", "Already in Tally"] and sent == ["r1,r2"], "6. a stale tab cannot post a duplicate: K/7 already in Tally is marked in Tally with its voucher, not failed (%s; sent %s)" % (k7, sent))
    a1 = E("(() => { const e = D().entries.r1; return [e.status, !!e.exportedAt, billInTally(e), !!e.postCheckFailed, e.postError || '']; })()")
    in_ready = pg.locator('#app [data-post-ready] [data-bill-row="r1"]').count()
    go_tab("errors")
    row = txt('#app [data-post-attention] [data-bill-row="r1"]')
    ok(a1 == ["approved", False, False, True, ""] and "Could not check Tally, not posted. Try again." in row and pg.locator('#app [data-bill-row="r1"] [data-retry-bill]').count() == 1
       and in_ready == 0, "6. Tally could not be checked: nothing posted, A/1 waits with that one line and Retry (%s | %s)" % (a1, row[:120]))
    ok("1 already in Tally (not posted again)" in txt("#app [data-post-result]") and "1 not posted: Tally could not be checked first" in txt("#app [data-post-result]"), "6. the run says so in one line (%s)" % txt("#app [data-post-result]"))
    # the cloud's results, from an older tally-ingest that drops the flags: read from the message
    ok(E("[postAlready({ok: false, message: 'Already in Tally (voucher no. X/1, 01-07-2026)'}), postCheckFail({ok: false, message: 'Could not check Tally, not posted. Try again.'}), postCheckFail({ok: false, message: 'Waiting for Tally: Tally is busy'}), postAlready({ok: true, alreadyThere: true}), postAlready({ok: false, message: 'Ledger X does not exist'})]") == [True, True, True, True, False],
       "6. the bridge's answers are read from their words too (an older cloud), 'Waiting for Tally' is not posted")
    # Retry: posted now
    E("() => { window.__answer = null; }")
    pg.click('#app [data-bill-row="r1"] [data-retry-bill]'); pg.wait_for_timeout(500); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(1200)
    ok(E("billInTally(D().entries.r1)") and not E("!!D().entries.r1.postCheckFailed"), "6. Retry: posted, in Tally")
    # ---- 2. nothing waiting
    go_tab("topost")
    ok(pg.locator("#app [data-post-table]").count() == 0 and pg.locator("#app [data-post-main]").count() == 0 and txt("#app [data-post-empty]") == "Nothing waiting to post" and "Post 0" not in pg.inner_text("#app"),
       "2. nothing ready: 'Nothing waiting to post', no table, no 'Post 0 to Tally'")
    chip, tab, attn, btn, dash = counts()
    ok("for Tally" not in chip and num(tab) == 0 and num(dash) == 0 and btn == "" and chip == attn + " to check in Tally", "4. and every count of what is ready says 0; the chip says what needs attention instead of 'in sync' (%r, %r, %r)" % (chip, tab, dash))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
