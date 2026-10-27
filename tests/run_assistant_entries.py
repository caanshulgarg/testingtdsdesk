"""python3 run_assistant_entries.py - Ask FinCom drafts entries; the person posts them with a click (the owner, 22-Oct-2026:
"make entries for Leads Insurance in their Tally, or prepare XML to upload" was refused). Checked on the React build
(app/dist-test) with FinCom's cloud stood in by the page (the client's ledger list, the posting queue, the books' items),
the assistant's answer fed as its stream (a result of kind "entries", as server/assistant/agent.ts sends it):
  1. the draft shows as a preview: each voucher's type, date and narration, its lines (ledger, Dr, Cr), the totals checked;
     it is saved with the client's books with a log line (who, when: "drafted by Ask FinCom");
  2. a ledger the client's Tally does not have is red, with the names to pick, and blocks Post and Download; picking one
     clears it;
  3. Dr not equal to Cr blocks both, with by how much; every change is logged (who and when);
  4. Tally not connected: "Post to Tally" greyed out with the reason; "Download XML" gives Tally's import file;
  5. nothing is posted without the click: no call to the posting queue while the draft is shown, edited or downloaded;
  6. Tally connected (the bridge online, the posting company confirmed): one press of Post IN THE CHAT CARD calls
     tally_post_enqueue ONCE with the vouchers' XML (FinCom's id TDSDesk:<id> in each narration, the ledgers, Dr/Cr, the
     date) - word for word the XML in the downloaded file; the same card shows it live (the owner, 22-Oct-2026: "post to
     Tally should happen in the chatbot only"): each voucher Sent, then Posted with Tally's voucher id, or the refusal in
     plain words with Retry; Retry sends only the refused voucher; all logged; the panel stays open, never the Post page;
  7. the postings are kept on the Post page as a record (In Tally), with no posting controls there;
  8. desktop and phone (390): the card fits, no sideways scrolling of the page; light and dark.
Screenshots in TDSDESK_SHOTS (default tests/out/assistant-entries).
Run on app/dist-test, under the lock: flock /tmp/fincom-app.lock python3 tests/run_assistant_entries.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = os.environ.get("TDSDESK_SHOTS", os.path.join(HERE, "out", "assistant-entries")); os.makedirs(OUT, exist_ok=True)
PORT = 8423
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

G = "LEADS INSURANCE BROKERS PVT LTD"
SETUP = """(G) => {
  Cloud.cfg = () => ({url: "http://fn.test", key: "anon-key", email: "anshul@firm.test"});
  Cloud.sess = () => ({access_token: "tok-x", refresh_token: "", user_id: "u-1", email: "anshul@firm.test", at: Date.now(), expires_in: 3600});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {}; Cloud.on = () => true;
  Cloud.st.firm = "f-1"; Cloud.st.role = "owner"; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: "u-1", name: "Anshul"}];
  S.account = Object.assign(S.account || {}, {me: {role: "owner", email: "anshul@firm.test", name: "Anshul", user_id: "u-1"}, firm: {name: "Test firm"}}); S.firm.firmName = "Test firm";
  try { Live.stop(); } catch (e) {}
  try { lsSet("tdsdesk:asst-notice", "1"); } catch (e) {}
  const c = newCompany({name: "Leads Insurance Private Limited", gstin: "09AANFG3202D1ZR"}); c.tallyName = G;
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  choiceConfirm(c, "postTo", G);
  window.__cid = c.id;
  // FinCom's cloud, stood in: the books (TCloud), the client's Tally ledgers (the cloud copy), the posting queue and its
  // postings, the books' items (save_book_items)
  TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "bk-leads", company: G, daysAt: new Date().toISOString(), state: {doneTo: "20261017", skipped: []}}]};
  window.__ledgers = [["RICHA KHANDELWAL", "Sundry Creditors"], ["HDFC BANK LTD", "Bank Accounts"], ["Office Rent", "Indirect Expenses"], ["Rent Payable", "Current Liabilities"],
    ["Cash", "Cash-in-Hand"], ["Electricity Charges", "Indirect Expenses"]].map(([name, parent]) => ({name, parent}));
  window.__jobs = []; window.__rpc = []; window.__api = []; window.__items = [];
  window.__mine = () => window.__items.filter(x => x.k === "asstEntries");   // the drafts (the books' other items saved by the page are not ours)
  TCloud.restAll = async (u) => { if (/^tally_ledgers/.test(u)) return JSON.parse(JSON.stringify(window.__ledgers));
    if (/^tally_post_jobs/.test(u)) return JSON.parse(JSON.stringify(window.__jobs)); return []; };
  TCloud.postTargetFor = () => "";
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === "tally_status") return TCloud.st[a.p_client] ? TCloud.st[a.p_client].books : [];
    if (fn === "tally_post_enqueue"){
      // queued: the Tally computer takes it when the test says (window.__finish: Tally's answer for each voucher)
      const ids = a.p_payload.vouchers.map(v => v.id), now = new Date().toISOString();
      window.__jobs.push({id: a.p_id, client_id: a.p_client, company: G, status: "waiting", done: 0, n: ids.length, message: "", created_at: now, updated_at: now,
        entry_ids: ids, results: [], items: [], payload: a.p_payload, attempts: 1});
      return {ok: true}; }
    return /^tally_(want_update|post_dismiss|post_record)$/.test(fn) ? {ok: true} : null; };
  Cloud.api = async (path, o) => { window.__api.push([path, o && o.body ? JSON.parse(JSON.stringify(o.body)) : null]);
    if (/^rpc\\/save_book_items/.test(path)){ (o.body.p_items || []).forEach(it => { window.__items = window.__items.filter(x => x.i !== it.i).concat([JSON.parse(JSON.stringify(it))]); }); return {ok: true}; }
    if (/^client_book_items/.test(path)) return window.__mine().map(it => ({item: it.i, data: it.d, updated_at: new Date().toISOString(), updated_by: "u-1", deleted: false}));
    if (/^tally_post_jobs/.test(path)){ const id = (path.match(/id=eq\\.([^&]+)/) || [])[1]; return window.__jobs.filter(j => j.id === id); }
    return []; };
  window.__finish = (rs) => { const j = window.__jobs[window.__jobs.length - 1], now = new Date().toISOString();
    const results = j.entry_ids.map((id, i) => Object.assign({id}, rs[i]));
    Object.assign(j, {status: "done", done: results.filter(r => r.ok).length, updated_at: now, message: results.filter(r => r.ok).length + " of " + results.length + " sent to Tally", results,
      items: results.map(r => r.ok ? {id: r.id, state: "in_tally", vchId: r.vchId} : {id: r.id, state: "failed", reason: r.message})}); };
  // Tally's computer: not connected at first (no bridge heard from); window.__online() brings it up
  TLight.refresh = function(){ return Promise.resolve(); };
  TLight.st = {at: Date.now(), busy: false, by: {}, devs: [], cos: []};
  window.__online = () => { const t = new Date().toISOString();
    TLight.st = {at: Date.now(), busy: false, by: {}, devs: [{id: "d-1", name: "NWS144", revoked: false, last_seen: t, info: {computer: "NWS144", beat: {at: t, every: 30, tally: true, tallyState: "open",
      paused: false, notAnsweringSince: "", updating: false, lastRead: t, open: [G], companies: [{name: G, open: true, at: t, lastRead: t}]}}}], cos: [{company: G, client_id: c.id, device_id: "d-1"}]}; };
  // the downloaded file, kept
  window.__saved = []; window.saveFile = async (name, blob) => { window.__saved.push({name, text: await blob.text()}); return true; };
  // the assistant's answer, fed as its stream
  window.__bodies = []; const real = window.fetch;
  window.fetch = (u, o) => { if (String(u) !== ASST.url()) return real(u, o);
    window.__bodies.push(JSON.parse(String(o.body))); let ctl; const st = new ReadableStream({start(cc){ ctl = cc; }}), en = new TextEncoder();
    window.__push = (x) => ctl.enqueue(en.encode('data: ' + JSON.stringify(x) + '\\n\\n')); window.__close = () => ctl.close();
    return Promise.resolve(new Response(st, {headers: {'content-type': 'text/event-stream'}})); };
  Cloud.rpc = async (fn) => fn === "asst_settings" ? {enabled: true, owner: true, default_on: true, consent: true} : {};
  S.coId = c.id; S.view = "company"; S.tab = "books"; render();
  return ASST.loadSettings(true).then(() => c.id);
}"""
# the answer: what server/assistant/agent.ts emits for draft_entries (the ledgers already checked by the server; one typed
# "Rent", not a ledger, with the closest names)
ANSWER = """(cid) => {
  const vouchers = [
    {n: 1, type: "Payment", date: "2026-10-22", narration: "Paid to Richa Khandelwal", dr: 100000, cr: 100000, problems: [],
     notes: ["The date 30-Oct-2026 was not in your request and is after today, so today's date (22-Oct-2026) is used. Change it if you meant another date."],
     lines: [{ledger: "RICHA KHANDELWAL", typed: "Richa Khandelwal", known: true, choices: [], dr: 100000, cr: 0}, {ledger: "HDFC BANK LTD", typed: "HDFC Bank", known: true, choices: [], dr: 0, cr: 100000}]},
    {n: 2, type: "Journal", date: "2026-09-30", narration: "Rent for September", dr: 50000, cr: 50000, problems: ["\\u201cRent\\u201d is not a ledger in the client's Tally (closest: Office Rent, Rent Payable)."],
     lines: [{ledger: "Rent", typed: "Rent", known: false, choices: ["Office Rent", "Rent Payable"], dr: 50000, cr: 0}, {ledger: "Rent Payable", typed: "Rent Payable", known: true, choices: [], dr: 0, cr: 50000}]}];
  __push({t: "tool", name: "draft_entries", label: "Drafting the entries"});
  __push({t: "result", id: 1, tool: "draft_entries", kind: "entries", title: "Entries drafted (not posted)", client: cid, clientName: "Leads Insurance Private Limited", params: {}, columns: [], rows: [],
    vouchers, period: {from: "2025-04-01", to: "2027-03-31"}, problems: [], ok: false, noBooks: false});
  __push({t: "text", d: "I have drafted a payment of ₹1,00,000.00 to Richa Khandelwal and the September rent. Rent is not a ledger: pick one."});
  __push({t: "done", text: "I have drafted a payment of ₹1,00,000.00 to Richa Khandelwal and the September rent. Rent is not a ledger: pick one.", labels: ["entries"], links: [], citations: {ok: [], dropped: []}, verdicts: [], unchecked: []});
  __close();
}"""
CARD = "[data-asst-panel] [data-asst-entries]"
enq = lambda pg: [x for x in pg.evaluate("window.__rpc") if x[0].startswith("tally_post_enqueue")]
def shot(pg, name, sel):
    p = os.path.join(OUT, name + ".png")
    try:
        loc = pg.locator(sel).first
        loc.screenshot(path=p) if loc.count() else pg.screenshot(path=p)
    except Exception:
        pg.screenshot(path=p)
    return p
def ask(pg, q):
    pg.fill("#asstQ", q); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    pg.evaluate(ANSWER, pg.evaluate("window.__cid"))
    for _ in range(40):
        if pg.locator(CARD).count(): break
        pg.wait_for_timeout(100)
    pg.wait_for_timeout(500)
def disabled(pg, sel):
    return pg.evaluate("(s) => { const b = document.querySelector(s); return !!b && (b.disabled || b.getAttribute('aria-disabled') === 'true'); }", sel)

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    cid = pg.evaluate(SETUP, G); pg.wait_for_timeout(400)
    pg.evaluate("ASST.open()"); pg.wait_for_timeout(900)
    ask(pg, "Leads Insurance: Richa Khandelwal ko ek lakh ki payment ki entry karni hai, aur September ka rent 50,000")
    # ---- 1. the draft shows
    ok(pg.locator(CARD).count() == 1, "1. the draft shows as a preview under the answer")
    v = pg.evaluate("""(s) => Array.from(document.querySelectorAll(s + ' [data-ent-v]')).map(v => ({type: v.querySelector('[data-ent-type]').value, date: v.querySelector('[data-ent-date]').value,
      narr: v.querySelector('[data-ent-narr]').value, lines: Array.from(v.querySelectorAll('[data-ent-line]')).map(r => [r.querySelector('[data-ent-ledger]').value, r.querySelector('[data-ent-dr]').value, r.querySelector('[data-ent-cr]').value]),
      totals: v.querySelector('[data-ent-totals]').getAttribute('data-ent-totals'), id: v.getAttribute('data-ent-id')}))""", CARD)
    ok(len(v) == 2 and v[0]["type"] == "Payment" and v[0]["date"] == "2026-10-22" and v[0]["narr"] == "Paid to Richa Khandelwal"
       and v[0]["lines"] == [["RICHA KHANDELWAL", "100000", ""], ["HDFC BANK LTD", "", "100000"]] and v[0]["totals"] == "even", "   type, date, narration, Dr/Cr ledgers and amounts, totals checked (%s)" % v[0])
    ok(all(re.match(r"^asst-[0-9a-z]{10}$", x["id"] or "") for x in v), "   each voucher has FinCom's id (%s)" % [x["id"] for x in v])
    items = pg.evaluate("window.__mine()")
    ok(len(items) == 1 and items[0]["k"] == "asstEntries" and items[0]["d"]["log"][0]["what"].startswith("drafted by Ask FinCom") and items[0]["d"]["log"][0]["by"] == "Anshul" and items[0]["d"]["log"][0]["at"],
       "   saved with the client's books, logged: who and when (%s)" % (items[0]["d"]["log"] if items else None))
    nt = pg.inner_text(CARD + " [data-ent-v='0'] [data-ent-note]") if pg.locator(CARD + " [data-ent-v='0'] [data-ent-note]").count() else ""
    ok("was not in your request" in nt and "today's date (22-Oct-2026) is used" in nt and pg.locator(CARD + " [data-ent-note]").count() == 1,
       "   a future date the person did not state was set to today: one line says so (%r)" % nt)
    # ---- 2. an unknown ledger blocks
    ok(pg.locator(CARD + " [data-ent-v='1'] tr.bad [data-ent-unknown]").count() == 1 and pg.get_attribute(CARD, "data-ready") == "no", "2. 'Rent' is not a ledger: red, with the names to pick")
    ok(disabled(pg, CARD + " [data-ent-post]") and disabled(pg, CARD + " [data-ent-xml]"), "   it blocks Post and Download")
    shot(pg, "entries-unknown-ledger", CARD)
    pg.click(CARD + " [data-ent-v='1'] [data-ent-choice='Office Rent']"); pg.wait_for_timeout(200)
    ok(pg.locator(CARD + " tr.bad").count() == 0 and pg.get_attribute(CARD, "data-ready") == "yes" and not disabled(pg, CARD + " [data-ent-xml]"), "   picking 'Office Rent' from the list clears it")
    # typing a name the list does not have: red again; a name typed in other case is put in Tally's spelling
    pg.fill(CARD + " [data-ent-v='0'] [data-ent-line='1'] [data-ent-ledger]", "Electricity"); pg.wait_for_timeout(150)
    ok(pg.locator(CARD + " [data-ent-v='0'] tr.bad").count() == 1 and disabled(pg, CARD + " [data-ent-xml]"), "   a ledger typed that the client's Tally lacks: red, blocked")
    pg.fill(CARD + " [data-ent-v='0'] [data-ent-line='1'] [data-ent-ledger]", "hdfc bank ltd"); pg.wait_for_timeout(150)
    ok(pg.input_value(CARD + " [data-ent-v='0'] [data-ent-line='1'] [data-ent-ledger]") == "HDFC BANK LTD" and pg.locator(CARD + " tr.bad").count() == 0, "   typed in another case: put in Tally's spelling")
    # ---- 3. Dr not equal to Cr blocks
    pg.fill(CARD + " [data-ent-v='0'] [data-ent-line='1'] [data-ent-cr]", "90000"); pg.wait_for_timeout(150)
    t = pg.inner_text(CARD + " [data-ent-v='0'] [data-ent-totals]")
    ok(pg.get_attribute(CARD + " [data-ent-v='0'] [data-ent-totals]", "data-ent-totals") == "uneven" and "10,000.00" in t and disabled(pg, CARD + " [data-ent-post]") and disabled(pg, CARD + " [data-ent-xml]"),
       "3. Dr ≠ Cr: said by how much, Post and Download blocked (%r)" % t)
    shot(pg, "entries-dr-not-cr", CARD)
    pg.fill(CARD + " [data-ent-v='0'] [data-ent-line='1'] [data-ent-cr]", "100000"); pg.wait_for_timeout(1300)
    log = pg.evaluate("window.__mine()[0].d.log.map(x => x.what + ' | ' + x.by)")
    ok(any("changed:" in x and "ledger" in x and "Office Rent" in x for x in log) and any('cr 100000 → "90000"' in x for x in log) and any('cr "90000" → "100000"' in x for x in log) and all(x.endswith("| Anshul") for x in log),
       "   every change is logged with who (%s)" % log[-1:])
    # ---- 4. Tally not connected: Post greyed out with the reason; Download XML
    why = pg.inner_text(CARD + " [data-ent-why-post]") if pg.locator(CARD + " [data-ent-why-post]").count() else ""
    ok(disabled(pg, CARD + " [data-ent-post]") and "not connected" in why and "Download XML" in why, "4. no bridge: Post greyed out, with why (%r)" % why)
    ok(not disabled(pg, CARD + " [data-ent-xml]"), "   Download XML is offered")
    pg.click(CARD + " [data-ent-xml]"); pg.wait_for_timeout(400)
    saved = pg.evaluate("window.__saved")
    ok(len(saved) == 1 and saved[0]["name"].endswith(".xml") and "<SVCURRENTCOMPANY>" + G + "</SVCURRENTCOMPANY>" in saved[0]["text"] and saved[0]["text"].count("<VOUCHER ") == 2,
       "   the Tally import file: both vouchers, naming the posting company (%s)" % (saved[0]["name"] if saved else None))
    # ---- 5. nothing posted without the click
    ok(len(enq(pg)) == 0 and not any("tally_post" in a[0] for a in pg.evaluate("window.__api")), "5. nothing went to the posting queue while it was shown, edited and downloaded")
    shot(pg, "entries-no-bridge-desktop", CARD)
    # ---- 6. Tally connected: Post in the chat card; progress and results live in the same card; Retry there
    pg.evaluate("window.__online()"); pg.evaluate("ASST.draw()"); pg.wait_for_timeout(400)
    ok(not disabled(pg, CARD + " [data-ent-post]") and pg.locator(CARD + " [data-ent-why-post]").count() == 0, "6. the bridge online, the company confirmed: Post to Tally can be pressed")
    ok(len(enq(pg)) == 0, "   still nothing posted before the click")
    shot(pg, "entries-preview-desktop", CARD)
    pg.click(CARD + " [data-ent-post]")
    for _ in range(40):
        if pg.locator(CARD + " [data-ent-status='sent']").count() == 2 and pg.locator(CARD + " [data-ent-busy]").count(): break
        pg.wait_for_timeout(100)
    pg.wait_for_timeout(1800)
    busy = pg.inner_text(CARD + " [data-ent-busy]") if pg.locator(CARD + " [data-ent-busy]").count() else ""
    ok(pg.locator(CARD + " [data-ent-status='sent']").count() == 2 and "Queued for the Tally computer" in busy, "   live in the card: each voucher 'Sent', the posting's progress (%r)" % busy)
    shot(pg, "entries-sending-desktop", CARD)
    e = enq(pg)
    ok(len(e) == 1 and e[0][0] == "tally_post_enqueue" and e[0][1]["p_client"] == cid and len(e[0][1]["p_payload"]["vouchers"]) == 2 and e[0][1]["p_payload"]["masters"] == [],
       "   one press: the existing queue (tally_post_enqueue) called ONCE, for this client, two vouchers, no ledger created (%d calls)" % len(e))
    x0 = e[0][1]["p_payload"]["vouchers"][0]["xml"] if e else ""
    ok(x0.startswith('<VOUCHER VCHTYPE="Payment" ACTION="Create"') and "<DATE>20261022</DATE>" in x0 and "<NARRATION>Paid to Richa Khandelwal | TDSDesk:" + v[0]["id"] + "</NARRATION>" in x0
       and re.search(r"<LEDGERNAME>RICHA KHANDELWAL</LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\s*<AMOUNT>-100000.00</AMOUNT>", x0)
       and re.search(r"<LEDGERNAME>HDFC BANK LTD</LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\s*<AMOUNT>100000.00</AMOUNT>\s*<BANKALLOCATIONS.LIST>", x0)
       and "<PARTYLEDGERNAME>RICHA KHANDELWAL</PARTYLEDGERNAME>" in x0, "   the right XML: type, date, FinCom's id in the narration, Dr/Cr ledgers and amounts, the bank allocation")
    x1 = e[0][1]["p_payload"]["vouchers"][1]["xml"] if e else ""
    ok("<LEDGERNAME>Office Rent</LEDGERNAME>" in x1 and "TDSDesk:" + v[1]["id"] in x1 and "<DATE>20260930</DATE>" in x1, "   the second voucher with the ledger picked")
    inner = re.findall(r'<TALLYMESSAGE xmlns:UDF="TallySchema">\n(.*?)</TALLYMESSAGE>', saved[0]["text"], re.S) if saved else []
    ok(inner == [x["xml"] for x in e[0][1]["p_payload"]["vouchers"]], "   Post sent word for word the XML of the downloaded file")
    # the Tally computer answers: the first in (Tally's voucher id 8123), the second refused
    pg.evaluate("window.__finish([{ok: true, verified: true, vchId: '8123'}, {ok: false, message: \"Ledger 'Rent Payable' does not exist\"}])")
    for _ in range(60):
        if pg.locator(CARD + " [data-ent-status='posted']").count() == 1 and pg.locator(CARD + " [data-ent-status='failed']").count() == 1: break
        pg.wait_for_timeout(200)
    st = pg.evaluate("(s) => Array.from(document.querySelectorAll(s + ' [data-ent-status]')).map(p => p.getAttribute('data-ent-status') + ': ' + p.innerText)", CARD)
    ok(len(st) == 2 and st[0] == "posted: Posted · Tally voucher id 8123", "   the result in the same card: Posted with Tally's voucher id (%s)" % st[:1])
    ok(len(st) == 2 and st[1].startswith("failed: Not posted: The ledger") and "Rent Payable" in st[1] and "is not in Tally" in st[1] and "bill" not in st[1], "   the refusal in plain words (%s)" % st[1:])
    ok(pg.locator(CARD + " [data-ent-retry]").count() == 1 and not disabled(pg, CARD + " [data-ent-retry]") and pg.locator(CARD + " [data-ent-busy]").count() == 0, "   Retry in the card")
    ok(pg.evaluate("window.__mine()[0].d.state") == "partly", "   the draft is 'partly in Tally'")
    lg = pg.evaluate("window.__mine()[0].d.log.map(x => x.what)")
    ok(any(x.startswith("pressed Post to Tally: 2 vouchers to " + G) for x in lg) and any(x.startswith("posted to " + G + ": 1 of 2 in Tally (Tally voucher id 8123)") for x in lg), "   the press and Tally's answer logged (%s)" % lg[-1])
    ok(pg.locator(CARD + " [data-ent-v='0'] [data-ent-ledger]:disabled").count() == 2 and pg.locator(CARD + " [data-ent-v='1'] [data-ent-ledger]:disabled").count() == 0,
       "   the voucher in Tally is locked; the refused one can be corrected")
    shot(pg, "entries-refused-retry-desktop", CARD)
    pg.wait_for_timeout(600); ok(len(enq(pg)) == 1, "   no second posting by itself")
    # Retry (after putting the ledger in Tally): only the refused voucher goes again, by the same route
    pg.click(CARD + " [data-ent-retry]"); pg.wait_for_timeout(1500)
    e = enq(pg)
    ok(len(e) == 2 and [x["id"] for x in e[1][1]["p_payload"]["vouchers"]] == [v[1]["id"]], "   Retry: one more call, with only the refused voucher (the one in Tally never sent twice)")
    pg.evaluate("window.__finish([{ok: true, verified: true, vchId: '8124'}])")
    for _ in range(60):
        if pg.locator(CARD + " [data-ent-status='posted']").count() == 2: break
        pg.wait_for_timeout(200)
    st = pg.evaluate("(s) => Array.from(document.querySelectorAll(s + ' [data-ent-status]')).map(p => p.innerText)", CARD)
    ok(st == ["Posted · Tally voucher id 8123", "Posted · Tally voucher id 8124"] and pg.locator(CARD + " [data-ent-retry]").count() == 0 and pg.get_attribute(CARD, "data-state") == "posted",
       "   after Retry both posted, each with its Tally voucher id; no Retry left (%s)" % st)
    ok(disabled(pg, CARD + " [data-ent-post]") and "In Tally" in pg.inner_text(CARD + " header"), "   the card says In Tally; nothing more to post")
    # all of it in the chat: the panel stayed open, never the Post page
    ok(pg.evaluate("!!ASST.st().open") and pg.locator("[data-post-page]").count() == 0, "   everything happened in the chat card: the panel open, the Post page never opened")
    shot(pg, "entries-posted-desktop", CARD)
    # light and dark; a phone
    pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(250); shot(pg, "entries-posted-desktop-dark", CARD); pg.emulate_media(color_scheme="light")
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(600)
    fit = pg.evaluate("""(s) => { const c = document.querySelector(s).getBoundingClientRect(), p = document.querySelector('.asst-panel').getBoundingClientRect();
      return {side: document.documentElement.scrollWidth - innerWidth, cardRight: c.right, panelRight: p.right, w: innerWidth,
        acts: Array.from(document.querySelectorAll(s + ' .asst-ent-acts button')).every(b => { const r = b.getBoundingClientRect(); return r.right <= c.right + 1 && r.left >= c.left - 1; })}; }""", CARD)
    ok(fit["side"] <= 1 and fit["cardRight"] <= fit["w"] + 1 and fit["acts"], "8. phone 390: the card and its buttons fit, no sideways scrolling (%s)" % fit)
    pg.evaluate("(s) => document.querySelector(s).scrollIntoView({block: 'start'})", CARD); pg.wait_for_timeout(200); shot(pg, "entries-posted-phone", CARD)
    # a fresh draft on the phone, as the preview looks before posting
    ask(pg, "Pass a journal entry for electricity 2,500 paid in cash today")
    last = "[data-asst-panel] [data-asst-entries]:last-of-type"
    pg.evaluate("() => { const l = document.querySelectorAll('[data-asst-panel] [data-asst-entries]'); l[l.length - 1].scrollIntoView({block: 'start'}); }"); pg.wait_for_timeout(300)
    pg.locator("[data-asst-panel] [data-asst-entries]").last.screenshot(path=os.path.join(OUT, "entries-preview-phone.png"))
    pg.set_viewport_size({"width": 1280, "height": 900}); pg.wait_for_timeout(300)
    pg.evaluate("ASST.close()"); pg.wait_for_timeout(300)
    # ---- 7. a record on the Post page (the person need not go there): the postings are listed as every posting is
    pg.evaluate("""async () => { PostCheck.due = () => false; TallyProof.check = async () => 0; window.autoPostTo = async () => {}; await openCompany(window.__cid); goStep("post", "bills");
      await new Promise(r => setTimeout(r, 500)); if (S.bank) S.bank.loading = false; CloudJobs.list = null; CloudJobs.at = 0; await CloudJobs.load(true); render(); }"""); pg.wait_for_timeout(1500)
    pg.click('#app [data-post-tabs] [data-post-tab="posted"]'); pg.wait_for_timeout(900)
    posted = pg.evaluate("Array.from(document.querySelectorAll('#app [data-post-panel=\"posted\"] [data-posted-entry]')).map(r => r.getAttribute('data-posted-entry'))")
    ok(v[0]["id"] in posted and v[1]["id"] in posted, "7. the Post page keeps them as a record under In Tally (%s)" % posted)
    ok(pg.locator("#app [data-post-asst-drafts], #app [data-asst-entries]").count() == 0, "   no posting controls for them there: posting is in the chat")
    shot(pg, "post-page-record", "#app [data-post-panel]")
    ok(len(enq(pg)) == 2, "nothing else was posted")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    ctx.close(); br.close()
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed") + " · screenshots in " + OUT)
sys.exit(1 if fails else 0)
