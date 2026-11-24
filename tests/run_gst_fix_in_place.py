"""python3 run_gst_fix_in_place.py - GST › What to fix: an entry corrected where it is shown (the owner, 23-Nov-2026: "any
error should be rectified there only.. option of open in entry should pop up a new window there only...and that change
should be made to tally and fincom books also"; the forms approved the same day, decisions 1, 2, 4-7).

FinCom Bridge is stood in at the network (window.fetch: its /ping proves itself with the key, /fix answers as
bridge-go/fixalter.go does), so the real Bridge.call is what FinCom's /fix goes through. Every answer kind is covered:
  1. "Open the entry" opens a window on the same page (not Look up), with only the box its kind of error needs;
  2. ok, with the entry read back: "Saved in Tally and FinCom Books.", Tally's entry replaces FinCom's, the row leaves;
     ok without a read back: "Saved in Tally." and FinCom Books update at the next read;
  3. refused (ok:false): Tally's own words, nothing changed, never sent again by itself;
  4. changed since: "Changed in Tally since you opened it", Tally's entry brought in, the next Save uses its AlterID;
  5. kept, unknown (Ask Tally again, by a person only), gone, a refusal before sending: said, never sent again by itself;
  6. held (Tally closed) and a network error: kept, Waiting for Tally, Save off; sent again when Tally is open;
  7. an older FinCom Bridge (404 Unknown address /fix): says it needs FinCom Bridge 2.5.21, never sent again by itself;
  8. another client opened while a change is with Tally, and during the sending of the held ones: the answer goes to the
     books of the client it was made for, never the one open now; the window closes when a client opens;
  9. Undo: one change for a double click, marked used only once Tally took it; a place of supply goes back to Tally's
     own value (the bridge's before); the ledger's AlterID is sent when FinCom Books have it.
 10. A GSTIN (the owner, 24-Nov-2026): after the ledger is saved, that party's invoices of the month on screen with
     another GSTIN or none are listed, all ticked; each is sent on its own (target voucher, fields {gstin}, the voucher
     type unescaped: "Sales & Services") and read back; the row leaves What to fix only when its invoice is corrected.
     The ledger already right: Save is offered and goes to the invoices only. A ledger with no change number in FinCom
     Books: the same Save reads it from Tally first (readFirst), then saves with Tally's change number; Tally closed:
     held; Tally's GSTIN another: changed since.
 11. Changed since: the window's title, place of supply and GSTIN rows and the unchanged test follow Tally's entry;
     FixQ.mine compares exactly; Tally holding the value though this computer did not send it: "Already in Tally", no
     Undo; only changes made on this computer are sent again by themselves (rec.dev); Changes made here (N) counts the
     ones Tally took; at most 200 kept, the oldest dropped; fixq is not a GST part (GSTR.NOT_GST); ledRead keeps alterId.
 12. The review of 24-Nov-2026: a change saved on a computer with no bridge waits ("It goes to Tally from the computer
     where Tally is open.") and is sent by another computer whose bridge is up (who saved it and who sent it both kept),
     and Save there is not locked; the bridge's alsoChanged said; the invoices step lists only invoices with no GSTIN,
     one not valid or the ledger's old one (a branch's and an old registration's never), keeps the GSTIN box (a wrong
     valid GSTIN on the ledger typed over: the ledger, then the invoices), retries only the one refused, a cash sale's
     buyer gets only its invoices fixed, and another client opened mid-loop stops it; FixQ.mine by state code.
 14. Ledger groups never read: Save reads them from Tally (the bridge's /ledgers), then goes on in the same press;
     Tally closed: only the invoice opened, as before.
 13. The review of 24-Nov-2026 (rev-fip4): the party is a ledger only under Sundry Debtors or Sundry Creditors (a
     sub-group too); Cash, a bank, or a group not known: only the invoice opened, no GSTIN written for that ledger; a
     waiting change with no Tally company is refused ("Open this entry again to save the change."); the ledger held
     queues its invoices after it (sent in order, not sent when the ledger is refused); one invoice held queues the
     rest; a new change is "sending" until its own send answers; the page drawn sends a colleague's waiting change and
     the history shows who sent it.
Made-up books only (tests/fixtures/books). Screenshots (deviceScaleFactor 2) go to FIX_SHOTS when set: classic light and
New look dark of refused, changed, needs the newer bridge and waiting, and (SHOT_PREFIX) the invoices step and the ledger
read from Tally first. Runs on the React build: app/dist-test."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("FIXIP_PORT") or 8341)
SHOTS = os.environ.get("FIX_SHOTS", "")
PFX = os.environ.get("SHOT_PREFIX", "")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=os.path.abspath(SITE))); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

SALE = "(a) => S.books.vouchers.find(v => (v.no || v.ref) === a)"
# an entry changed as a new read of the books changes it: a new object in its place
PLANT = "(a) => { const vs = S.books.vouchers, i = vs.findIndex(v => v.id === a[0]); vs[i] = Object.assign({}, vs[i], {no: a[1], alt: a[2]}); BOOKS_REV++; render(); }"
LONG, SHORT, BADG = "LFE/2025-26/000006", "LFE/25-26/006", "07AAJFQ3158R1ZJ"
BURL, BKEY, BID = "http://127.0.0.1:9177", "k-fix-test-0001", "bid-fix-test"
WAIT = "Waiting for Tally. It is saved there when Tally is open."
# FinCom Bridge stood in at the network: /ping proves itself with the key held; /fix is kept and answered by window.__fix,
# which gives {status, body}, "net" (no answer) or a promise of either (an answer still on its way)
STUB = """(c) => { window.__calls = []; window.__live = true; window.bridgeLive = () => window.__live;
  window.ensureTallyCompany = async (co) => 'Tally of ' + co.name; window.linkGuid = async (co) => ({guid: 'g-' + co.id});
  LinkRec.guidFor = async (co) => 'g-' + co.id;
  Bridge.setCfg({url: c.url, key: c.key, bridgeId: c.id}); Bridge.foundAt = Date.now();
  const real = window.fetch.bind(window), J = (o, s) => new Response(JSON.stringify(o), {status: s || 200, headers: {'Content-Type': 'application/json'}});
  window.fetch = async (u, o) => { u = String(u);
    if (!/^http:\\/\\/127\\.0\\.0\\.1:91\\d\\d/.test(u)) return real(u, o);
    if (!u.startsWith(c.url)) throw new TypeError('Failed to fetch');
    const path = u.slice(c.url.length);
    if (path.startsWith('/ping')) { const n = new URL(u).searchParams.get('n'); return J({ok: true, bridgeId: c.id, port: 9177, proof: await Bridge.hmac(c.key, n + c.id + 9177)}); }
    if (path.startsWith('/fix')) { const body = JSON.parse(o.body); window.__calls.push(['/fix', body, (o.headers || {})['X-Bridge-Key']]);
      const a = await window.__fix(body); if (a === 'net') throw new TypeError('Failed to fetch'); return J(a.body, a.status); }
    if (path.startsWith('/status')) return J({ok: true, linkGuid: true, sessions: []});
    if (path.startsWith('/ledgers')) { (window.__reads = window.__reads || []).push(path); return window.__ledgers ? J(window.__ledgers) : J({ok: false, error: 'Tally is not open.'}, 503); }
    return J({ok: false, error: 'Unknown address ' + path.split('?')[0]}, 404); }; }"""
# Tally's entry as the bridge reads it back: FinCom's own entry with the number and change number given
XML = """(a) => { const v = S.books.vouchers.find(x => x.id === a[0]), e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return '<VOUCHER VCHTYPE="' + e(v.type) + '"><GUID>' + e(v.id) + '</GUID><ALTERID>' + a[2] + '</ALTERID><DATE>' + v.date + '</DATE><VOUCHERTYPENAME>' + e(v.type) +
    '</VOUCHERTYPENAME><VOUCHERNUMBER>' + e(a[1]) + '</VOUCHERNUMBER><PARTYLEDGERNAME>' + e(v.party) + '</PARTYLEDGERNAME><PARTYGSTIN>' + e(v.gstin) +
    '</PARTYGSTIN><PLACEOFSUPPLY>' + e(v.pos) + '</PLACEOFSUPPLY>' + (v.ent || []).map(l => '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + e(l.l) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' +
    (l.a < 0 ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE><AMOUNT>' + l.a + '</AMOUNT></ALLLEDGERENTRIES.LIST>').join('') + '</VOUCHER>'; }"""
WHAT = "Invoice numbers longer than 16 characters"

def wait_idle(pg, ms=300):
    pg.wait_for_timeout(ms)
    try: pg.wait_for_function("() => !document.querySelector('#app .pg-skel, #app [data-page-skeleton], #app [data-loading], #app [data-rx-preparing]')", timeout=60000, polling=100)
    except Exception: pass

def month(pg, ym, ret="GSTR-1"):
    pg.evaluate("(m) => { S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = m; render(); }", ym); wait_idle(pg, 500)
    pg.click('#app [data-cell="%s|%s"]' % (ret, ym)); wait_idle(pg, 400)

def group(pg, what):
    pg.evaluate("(w) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === w); if (g && !g.querySelector('[data-fix-row]')) g.querySelector('[data-fix-toggle]').click(); }", what); wait_idle(pg, 150)
    return pg.evaluate("(w) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === w); return g ? Array.from(g.querySelectorAll('[data-fix-row]')).map(r => r.dataset.id) : null; }", what)

def open_entry(pg, what, vid):
    pg.evaluate("(a) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === a[0]); Array.from(g.querySelectorAll('[data-fix-row]')).find(r => r.dataset.id === a[1]).querySelector('[data-fix-open]').click(); }", [what, vid])
    pg.wait_for_selector("[data-fix-entry]", timeout=10000); pg.wait_for_timeout(250)
    return pg.evaluate("""() => { const w = document.querySelector('[data-fix-entry]'); const i = w.querySelector('[data-fix-input]');
      return {kind: w.dataset.fixKind, id: w.dataset.fixEntry, input: i ? [i.dataset.fixInput, i.value] : null, save: !!w.querySelector('[data-fix-save]'), lookup: !!w.querySelector('[data-fix-lookup]'),
        text: w.innerText.replace(/\\s+/g, ' '), tab: S.booksTab, warn: w.querySelectorAll('.warn, .bad, [role=alert]').length}; }""")

def typein(pg, v):
    pg.fill("[data-fix-entry] [data-fix-input]", v); pg.wait_for_timeout(150)

def state(pg):
    return pg.evaluate("() => { const s = document.querySelector('[data-fix-entry] [data-fix-state]'); return s ? [s.dataset.fixState, s.innerText] : null; }")

def save_off(pg):
    return pg.evaluate("() => { const b = document.querySelector('[data-fix-entry] [data-fix-save]'); return !b || b.disabled; }")

def calls(pg):
    return pg.evaluate("window.__calls")

def answer(pg, js):
    pg.evaluate("() => { window.__fix = " + js + "; }")

def cancel(pg):
    pg.evaluate("() => { const w = document.querySelector('[data-fix-entry] [data-fix-cancel]'); if (w) w.click(); }"); pg.wait_for_timeout(250)

def voucher(pg, vid):
    return pg.evaluate("(id) => { const v = S.books.vouchers.find(x => x.id === id); return v && {no: v.no, alt: v.alt}; }", vid)

# every change with Tally answered and drawn (no fixed wait): nothing in flight, no window still saying Saving or Reading
SETTLED = """() => window.FixQ && !FixQ.busy && !FixQ.flying.size && !Array.from(document.querySelectorAll('[data-fix-entry] [data-fix-state], [data-fix-entry] [data-fix-inv-state]'))
  .some(s => /^(Saving|Reading)/.test(s.dataset.fixState ? s.innerText : (s.lastElementChild || s).innerText))"""
def settle(pg, ms=0):
    try: pg.wait_for_function(SETTLED, timeout=15000, polling=50)
    except Exception: pass
    pg.wait_for_timeout(120 + ms)

# the held changes sent now, as a page drawn a minute later sends them (FixQ.pump)
def pump(pg, ms=0):
    pg.evaluate("() => { window.FixQ.last = 0; return window.FixQ.pump(true); }"); settle(pg, ms)

alt = [100]
def try_save(pg, vid, js, ms=0):
    """the entry with the long number again (as a new read brings it), opened, a good number typed, Save pressed, the
    bridge answering js"""
    alt[0] += 2
    pg.evaluate(PLANT, [vid, LONG, alt[0]])
    month(pg, "202507"); group(pg, WHAT); open_entry(pg, WHAT, vid); typein(pg, SHORT)
    answer(pg, js)
    pg.click("[data-fix-entry] [data-fix-save]"); settle(pg, ms)
    return state(pg)

def shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, PFX + name + ".png"))

REFUSED = "(b) => ({body: {ok: false, refused: true, message: \"Tally did not change it: Voucher Number 'LFE/25-26/006' already exists.\"}})"
CHANGED = "(b) => ({body: {ok: false, changed: true, now: {number: 'LFE/2025-26/000106', alterId: '61'}, alterNow: '61', xml: window.__xml, message: 'Changed in Tally since it was opened here. This is how it is now.'}})"
OLD = "(b) => ({status: 404, body: {ok: false, error: 'Unknown address /fix'}})"
HELD = "(b) => ({body: {ok: false, held: true, message: 'Tally is closed. The change is made when it opens.'}})"
DONE = "(b) => ({body: {ok: true, message: 'Saved in Tally.', before: {number: 'x', alterId: String(b.alterId)}, after: {number: b.fields.number, alterId: String(+b.alterId + 1)}, alterAfter: String(+b.alterId + 1), xml: window.__xmlOf(b)}})"
# Tally's entry read back after a Save: the number sent and the next change number
XMLOF = "() => { window.__xmlOf = (b) => (" + XML + ")([b.guid, b.fields.number, +b.alterId + 1]); }"

def dark_shots(pg, vid, tag):
    """the four answers drawn again in the look now on screen"""
    try_save(pg, vid, REFUSED); shot(pg, tag + "-refused"); cancel(pg)
    pg.evaluate("(a) => { window.__xml = (" + XML + ")(a); }", [vid, "LFE/2025-26/000106", 61])
    try_save(pg, vid, CHANGED); shot(pg, tag + "-changed"); cancel(pg)
    try_save(pg, vid, OLD); shot(pg, tag + "-needs-newer-bridge"); cancel(pg)
    try_save(pg, vid, HELD); shot(pg, tag + "-waiting"); cancel(pg)
    answer(pg, DONE); pump(pg)

# Tally's invoice as read back after its GSTIN fix: the voucher type as Tally gives it (escaped once, as FinCom keeps it)
XMLG = """(a) => { const v = S.books.vouchers.find(x => x.id === a[0]), e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return '<VOUCHER VCHTYPE="' + v.type + '"><GUID>' + e(v.id) + '</GUID><ALTERID>' + a[2] + '</ALTERID><DATE>' + v.date + '</DATE><VOUCHERTYPENAME>' + v.type +
    '</VOUCHERTYPENAME><VOUCHERNUMBER>' + e(v.no) + '</VOUCHERNUMBER><PARTYLEDGERNAME>' + e(v.party) + '</PARTYLEDGERNAME><PARTYGSTIN>' + e(a[1]) +
    '</PARTYGSTIN><PLACEOFSUPPLY>' + e(v.pos) + '</PLACEOFSUPPLY>' + (v.ent || []).map(l => '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + e(l.l) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' +
    (l.a < 0 ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE><AMOUNT>' + l.a + '</AMOUNT></ALLLEDGERENTRIES.LIST>').join('') + '</VOUCHER>'; }"""
# the bridge: a ledger read first, a ledger fix, an invoice's GSTIN fix (read back with the GSTIN sent)
GSTFIX = """(b) => b.readFirst ? {body: {ok: false, read: true, now: {gstin: window.__tallyG, pan: '', alterId: '40'}, alterNow: '40', message: 'Read from Tally.'}}
  : b.target === 'ledger' ? {body: {ok: true, after: {gstin: b.fields.gstin, pan: '', alterId: String(+b.alterId + 1)}, before: {gstin: b.was.gstin, alterId: b.alterId}}}
  : {body: {ok: true, message: 'Saved in Tally.', before: {gstin: 'x', alterId: b.alterId}, after: {gstin: b.fields.gstin, alterId: String(+b.alterId + 1)}, xml: (""" + XMLG + """)([b.guid, b.fields.gstin, +b.alterId + 1])}}"""
def inv_state(pg):
    return pg.evaluate("""() => { const w = document.querySelector('[data-fix-entry]'); if (!w) return null; const l = w.querySelector('[data-fix-invoices]');
      return {step: w.dataset.fixStep, rows: l ? Array.from(l.querySelectorAll('[data-fix-inv]')).map(r => [r.dataset.fixInv, r.querySelector('[data-fix-tick]').checked, r.dataset.fixInvState]) : null,
        save: (() => { const b = w.querySelector('[data-fix-save]'); return !!b && !b.disabled; })(), text: w.innerText.replace(/\\s+/g, ' '),
        led: (() => { const r = w.querySelector('[data-fix-led-row]'); return r ? [r.dataset.fixLedRow, r.dataset.fixLedState] : null; })(),
        box: (() => { const i = w.querySelector('[data-fix-input="gstin"]'); return i && !i.disabled && !i.readOnly ? i.value : null; })(),
        green: Array.from(w.querySelectorAll('[data-fix-state]')).filter(s => s.classList.contains('good')).length}; }""")
def bad_again(pg, gid, g):
    """the invoice with a GSTIN that is not valid again (as a new read brings it)"""
    pg.evaluate("(a) => { const vs = S.books.vouchers, i = vs.findIndex(v => v.id === a[0]); vs[i] = Object.assign({}, vs[i], {gstin: a[1], alt: (vs[i].alt || 70) + 5}); BOOKS_REV++; render(); }", [gid, g])

def invoice_steps(pg, what2, gid, led, good):
    # 10. the ledger saved: the party's invoices of the month with another GSTIN, all ticked
    pg.wait_for_timeout(300)
    s1 = inv_state(pg)
    ok(s1 and s1["step"] == "invoices" and s1["rows"] and [gid, True, ""] in s1["rows"] and s1["save"],
       "the ledger saved: the party's invoices of the month with another GSTIN listed, all ticked, Save offered (%s)" % (s1 and {k: s1[k] for k in ("step", "rows", "save")}))
    ok(gid in (group(pg, what2) or []), "the ledger saved but the invoice not yet: its row is still in What to fix")
    ok(s1 and s1["led"] == [led, "done"] and s1["green"] == 0 and s1["box"] == good,
       "invoices still to send: the ledger's line is done in the list, no green Saved above it, the GSTIN box still there (%s)" % (s1 and {k: s1[k] for k in ("led", "green", "box")}))
    shot(pg, "classic-light-invoices")
    # the voucher type as Tally gives it, escaped once in FinCom Books: sent as Tally's own name
    pg.evaluate("(g) => { const v = S.books.vouchers.find(x => x.id === g); v.type = 'Sales &amp; Services'; if (v.alt == null) v.alt = 70; }", gid)
    alt0 = pg.evaluate("(g) => S.books.vouchers.find(x => x.id === g).alt", gid)
    pg.evaluate("() => { window.__calls = []; window.__fix = " + GSTFIX + "; }")
    pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(1200)
    c = calls(pg); b = c[0][1] if c else {}
    ok(len(c) == 1 and b.get("target") == "voucher" and b.get("guid") == gid and b.get("fields") == {"gstin": good} and b.get("alterId") == str(alt0)
       and b.get("vchType") == "Sales & Services" and b.get("vchDate"), "each invoice sent on its own: its GSTIN only, its change number, the type as Tally's name 'Sales & Services' (%s)" % b)
    v = pg.evaluate("(g) => { const v = S.books.vouchers.find(x => x.id === g); return [v.gstin, v.alt, v.type]; }", gid)
    ok(v == [good, alt0 + 1, "Sales &amp; Services"], "the invoice read back is in FinCom Books (%s)" % v)
    pg.wait_for_timeout(1300)
    ok(not pg.evaluate("() => !!document.querySelector('[data-fix-entry]')"), "every ticked invoice saved: the window closes by itself")
    rows = group(pg, what2)
    ok(not rows or gid not in rows, "the invoice corrected: its row has left What to fix (%s)" % rows)

    # the ledger already right, the invoice not: the box pre-filled valid, Save offered for the invoices only
    bad_again(pg, gid, BADG); month(pg, "202504")
    rows = group(pg, what2)
    ok(rows and gid in rows, "the invoice with a bad GSTIN again: listed (%s)" % rows)
    w = open_entry(pg, what2, gid); s2 = inv_state(pg)
    ok(s2["step"] == "invoices" and [gid, True, ""] in (s2["rows"] or []) and s2["save"] and s2["led"] == [led, "has"],
       "the ledger already right: straight to its invoices, ticked, Save offered (%s)" % {k: s2[k] for k in ("step", "rows", "save")})
    # unticked: nothing to send, Save off; ticked again
    pg.click("[data-fix-entry] [data-fix-tick]"); pg.wait_for_timeout(150)
    ok(not inv_state(pg)["save"], "every invoice unticked: Save is off")
    pg.click("[data-fix-entry] [data-fix-tick]"); pg.wait_for_timeout(150)
    pg.evaluate("() => { window.__calls = []; }")
    pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(1500)
    c = calls(pg)
    ok(len(c) == 1 and c[0][1].get("target") == "voucher" and c[0][1].get("fields") == {"gstin": good}, "the ledger already right: only the invoice is sent (%s)" % [x[1].get("target") for x in c])
    rows = group(pg, what2)
    ok(not rows or gid not in rows, "the row leaves the list once its invoice is fixed (%s)" % rows)

    # a ledger FinCom Books hold no change number for: the same Save reads it from Tally first, then saves
    bad_again(pg, gid, BADG)
    pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; delete S.books.ledInfo[a[0]]; BOOKS_REV++; render(); }", [led, BADG]); month(pg, "202504")
    open_entry(pg, what2, gid); typein(pg, good)
    pg.evaluate("() => { window.__calls = []; window.__tallyG = '" + BADG + "'; const f = " + GSTFIX + "; window.__go = null; window.__fix = (b) => b.readFirst ? new Promise((r) => { window.__go = () => r(f(b)); }) : f(b); }")
    pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(500)
    st = state(pg)
    ok(st and st[0] == "waiting" and "Reading the party from Tally" in st[1] and save_off(pg), "no change number: Save reads the party from Tally first (%s)" % st)
    ok(not pg.evaluate("() => /Read the ledgers from Tally first/.test(document.body.innerText)"), "no step asked of the person: no 'Read the ledgers from Tally first'")
    shot(pg, "classic-light-ledger-read-first")
    pg.evaluate("() => window.__go && window.__go()"); pg.wait_for_timeout(1200)
    c = calls(pg)
    ok(len(c) == 2 and c[0][1].get("readFirst") is True and "alterId" not in c[0][1] and c[1][1].get("alterId") == "40" and "readFirst" not in c[1][1] and c[1][1].get("target") == "ledger",
       "one Save: the ledger read from Tally, then its fix with Tally's change number (%s)" % [(x[1].get("readFirst"), x[1].get("alterId")) for x in c])
    s3 = inv_state(pg)
    ok(s3 and s3["step"] == "invoices" and pg.evaluate("(l) => S.books.ledInfo[l] && S.books.ledInfo[l].alt", led) == 41, "then the invoices step; the ledger's change number kept even with no ledger details before (%s)" % (s3 and s3["step"]))
    cancel(pg)
    # Tally closed at the read: held as usual; Tally's GSTIN another: changed since, nothing sent
    pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; delete S.books.ledInfo[a[0]]; BOOKS_REV++; render(); }", [led, BADG]); month(pg, "202504")
    open_entry(pg, what2, gid); typein(pg, good)
    pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({body: {ok: false, held: true, message: 'Tally is closed. The change is made when it opens.'}}); }")
    pg.click("[data-fix-entry] [data-fix-save]"); settle(pg)
    st = state(pg)
    ok(st and st[0] == "waiting" and len(calls(pg)) == 1 and calls(pg)[0][1].get("readFirst") is True, "no change number, Tally closed: held, Waiting for Tally (%s)" % st)
    pg.evaluate("() => { window.__calls = []; window.__tallyG = '27AAPFU0939F1ZV'; window.__fix = " + GSTFIX + "; }")
    pump(pg, 1200)
    last = pg.evaluate("() => S.books.fixq.filter(x => x.ask.target === 'ledger').slice(-1)[0]")
    after = pg.evaluate("(i) => S.books.fixq.filter(x => x.after === i).map(x => x.state)", last["id"])
    ok(len(calls(pg)) == 1 and last["state"] == "changed" and after and all(x == "refused" for x in after),
       "sent when Tally opens: Tally's GSTIN is another, so changed since and nothing sent, its invoices neither (%s, %s, %d calls)" % (last["state"], after, len(calls(pg))))
    ok(pg.evaluate("(l) => S.books.gstins[l]", led) == "27AAPFU0939F1ZV", "changed since: FinCom Books take Tally's GSTIN of the ledger")
    cancel(pg)
    pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; S.books.ledInfo[a[0]] = {alt: 33}; BOOKS_REV++; render(); }", [led, good])

NOBR = "It goes to Tally from the computer where Tally is open."
# a copy of an invoice of the month, as another read of the books brings it: its own id, number and GSTIN
CLONE = """(a) => { const vs = S.books.vouchers, v = vs.find(x => x.id === a[0]), n = Object.assign({}, v, {id: a[1], no: a[2], gstin: a[3], alt: 500, type: 'Sales'});
  if (a[4]) { n.party = a[4]; n.ent = (v.ent || []).map(e => e.l === v.party ? Object.assign({}, e, {l: 'Cash'}) : e); }
  const i = vs.findIndex(x => x.id === a[1]); if (i >= 0) vs[i] = n; else vs.push(n); BOOKS_REV++; render(); }"""
def gst_of(pg, ids):
    return pg.evaluate("(l) => l.map(i => (S.books.vouchers.find(v => v.id === i) || {}).gstin)", ids)
def valid_for(pg, head):
    return pg.evaluate("(h) => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid(h + c)) return h + c; }", head)

def review4(pg, A, vid, gid, led, good):
    """12. the review of 24-Nov-2026 (rev-fip3): a change waiting where there is no bridge, and the invoices step"""
    # --- a change saved on computer A (no bridge) is sent by computer B (bridge up); Save on B is not locked
    pg.evaluate("() => { window.__dev0 = FixQ.dev; window.__who0 = FixQ.who; FixQ.dev = () => 'dev-computer-a'; FixQ.who = () => 'a@example.com'; window.__live = false; window.__calls = []; }")
    st = try_save(pg, vid, DONE)
    ok(st and st[0] == "waiting" and NOBR in st[1] and len(calls(pg)) == 0, "computer A, no bridge: Save keeps it waiting, nothing sent, and says where it goes from (%s)" % st)
    shot(pg, "waiting-no-bridge")
    rid = pg.evaluate("() => S.books.fixq[S.books.fixq.length - 1].id")
    cancel(pg)
    pg.evaluate("() => { FixQ.dev = () => 'dev-computer-b'; FixQ.who = () => 'b@example.com'; window.__live = true; window.__calls = []; window.__fix = " + DONE + "; }")
    open_entry(pg, WHAT, vid); settle(pg, 300)
    r = pg.evaluate("(i) => { const x = S.books.fixq.find(y => y.id === i); return [x.state, x.by, x.dev, x.sentBy, x.sentDev]; }", rid)
    ok(len(calls(pg)) == 1 and r == ["done", "a@example.com", "dev-computer-a", "b@example.com", "dev-computer-b"],
       "computer B, bridge up: the entry opened, A's waiting change is sent from here; who saved it and who sent it both kept (%d calls, %s)" % (len(calls(pg)), r))
    cancel(pg)
    h = pg.evaluate("() => { const h = document.querySelector('#app [data-fix-history]'); h.open = true; return h.textContent.replace(/\\s+/g, ' '); }")
    ok("a@example.com" in h and "b@example.com" in h, "Changes made here shows who saved it and who sent it (%r)" % h[:200])
    alt[0] += 2; pg.evaluate(PLANT, [vid, LONG, alt[0]])
    month(pg, "202507"); group(pg, WHAT); open_entry(pg, WHAT, vid); typein(pg, SHORT)
    ok(not save_off(pg), "computer B: Save on the entry is not locked after A's change went")
    cancel(pg)
    pg.evaluate("() => { FixQ.dev = window.__dev0; FixQ.who = window.__who0; }")
    answer(pg, DONE); pump(pg)

    # --- Tally also changed something not asked: said to the person
    pg.evaluate("() => { window.__calls = []; }")
    st = try_save(pg, vid, "(b) => { const a = (" + DONE + ")(b); a.body.alsoChanged = ['date']; return a; }")
    ok(st and st[0] == "done" and "Tally also changed the date" in st[1], "the bridge's alsoChanged said in plain words (%s)" % st)
    cancel(pg)

    # --- the invoices step: only invoices with no GSTIN, one not valid, or the ledger's old wrong one
    month(pg, "202504"); what2 = "Buyer GSTINs that are not valid"
    branch, oldreg = valid_for(pg, "27AAJFQ3158R1Z"), valid_for(pg, "07AAKFQ3158R1Z")
    base = gid[:-3]
    ids = {k: base + n for k, n in (("branch", "801"), ("oldreg", "802"), ("miss", "803"), ("bad", "804"), ("same", "805"))}
    for k, g in (("branch", branch), ("oldreg", oldreg), ("miss", ""), ("bad", BADG), ("same", good)):
        pg.evaluate(CLONE, [gid, ids[k], "LFE/25-26/8" + ids[k][-2:], g, ""])
    bad_again(pg, gid, BADG)
    pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; S.books.ledInfo[a[0]] = {alt: 33}; BOOKS_REV++; render(); }", [led, good]); month(pg, "202504")
    group(pg, what2); open_entry(pg, what2, gid); s = inv_state(pg)
    listed = [x[0] for x in (s["rows"] or [])]
    ok(s["step"] == "invoices" and sorted(listed) == sorted([gid, ids["miss"], ids["bad"]]),
       "a ledger with more than one GSTIN in use: only the invoices with no GSTIN or one not valid are listed, never a branch's or an old registration's (%s)" % listed)
    ok(s["box"] == good and s["led"] == [led, "has"], "the invoices step: the GSTIN box is there and can be typed in (%s)" % {k: s[k] for k in ("box", "led")})
    shot(pg, "invoice-step-editable-box")
    # the ledger's GSTIN is itself wrong: typed in the invoices step; the ledger's old one is listed too
    good2 = valid_for(pg, "07AAJFQ3159R1Z")
    typein(pg, good2); s = inv_state(pg)
    listed = [x[0] for x in (s["rows"] or [])]
    ok(ids["same"] in listed and gid in listed and ids["branch"] not in listed and ids["oldreg"] not in listed and s["led"] == [led, "change"] and s["save"],
       "a wrong valid GSTIN on the ledger, the right one typed: the invoices with the ledger's old one listed too, the ledger's line to change (%s)" % {"rows": listed, "led": s["led"]})
    shot(pg, "invoice-step-ledger-to-change")
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(400)
    fit = pg.evaluate("() => { const w = document.querySelector('[data-fix-entry] .fx-inv'); return [document.documentElement.scrollWidth <= window.innerWidth + 1, !!w && w.scrollWidth <= w.clientWidth + 1]; }")
    ok(fit == [True, True], "phone width, the invoices step: no sideways scroll (%s)" % fit)
    shot(pg, "phone-invoice-step")
    pg.set_viewport_size({"width": 1280, "height": 900}); pg.wait_for_timeout(400)
    # Save: the ledger, then each ticked invoice; the second one refused by Tally
    n = len(listed); second = s["rows"][1][0]
    pg.evaluate("(g2) => { window.__calls = []; window.__no = g2; const f = " + GSTFIX + "; window.__fix = (b) => b.guid === window.__no ? (window.__no = null, {body: {ok: false, refused: true, message: 'Tally did not change it: test.'}}) : f(b); }", second)
    pg.click("[data-fix-entry] [data-fix-save]"); settle(pg, 300)
    c = calls(pg)
    ok(len(c) == 1 + n and c[0][1].get("target") == "ledger" and c[0][1].get("was") == {"gstin": good} and c[0][1].get("fields") == {"gstin": good2}
       and all(x[1].get("target") == "voucher" and x[1].get("fields") == {"gstin": good2} for x in c[1:]),
       "one Save: the ledger fixed first, then the invoices (%s)" % [(x[1].get("target"), x[1].get("guid", "")[-3:]) for x in c])
    s = inv_state(pg) or {}
    states = dict((x[0], x[2]) for x in (s.get("rows") or []))
    ok(s.get("step") == "invoices" and states.get(second) == "refused" and all(v == "done" for k, v in states.items() if k != second) and s.get("save") and s.get("led") == [led, "done"],
       "one invoice refused mid-list: the others saved, the window stays, Save offered again (%s)" % states)
    pg.evaluate("() => { window.__calls = []; }")
    pg.click("[data-fix-entry] [data-fix-save]"); settle(pg)
    c = calls(pg)
    ok(len(c) == 1 and c[0][1].get("guid") == second, "Save again: only the one refused is sent (%s)" % [x[1].get("guid", "")[-3:] for x in c])
    pg.wait_for_timeout(1400)
    ok(not pg.evaluate("() => !!document.querySelector('[data-fix-entry]')"), "then every one saved: the window closes by itself")
    g = gst_of(pg, [ids["branch"], ids["oldreg"], ids["same"], ids["miss"]])
    ok(g == [branch, oldreg, good2, good2] and pg.evaluate("(l) => S.books.gstins[l]", led) == good2,
       "the ledger and its wrong invoices hold the right GSTIN; a branch's and an old registration's untouched (%s)" % g)

    # --- a cash sale with the buyer's details: the party is not a ledger, only the invoices are fixed
    cash1, cash2 = base + "811", base + "812"
    pg.evaluate(CLONE, [gid, cash1, "LFE/25-26/811", BADG, "Zeta Walk-in Buyer"]); pg.evaluate(CLONE, [gid, cash2, "LFE/25-26/812", "", "Zeta Walk-in Buyer"])
    month(pg, "202504"); rows = group(pg, what2)
    ok(rows and cash1 in rows, "the cash sale's invoice is in What to fix (%s)" % (rows and len(rows)))
    open_entry(pg, what2, cash1); s = inv_state(pg)
    ok(s["step"] == "invoices" and s["led"] is None and [x[0] for x in s["rows"] or []] == [cash1] and not s["save"],
       "a cash sale's buyer: no ledger step, only the invoice opened listed, Save waits for a valid GSTIN (%s)" % {k: s[k] for k in ("step", "led", "rows", "save")})
    good3 = valid_for(pg, "07AAZFZ1234R1Z")
    typein(pg, good3)
    pg.evaluate("() => { window.__calls = []; window.__fix = " + GSTFIX + "; }")
    pg.click("[data-fix-entry] [data-fix-save]"); settle(pg)
    c = calls(pg)
    ok(len(c) == 1 and c[0][1].get("guid") == cash1 and c[0][1].get("target") == "voucher" and c[0][1].get("fields") == {"gstin": good3} and "Zeta Walk-in Buyer" not in pg.evaluate("() => JSON.stringify(Object.keys(S.books.gstins))"),
       "the cash sale: only the invoice opened sent, no ledger touched (%s)" % [x[1].get("target") for x in c])
    pg.wait_for_timeout(1400)

    # --- another client opened mid-loop: the loop stops; the rest stay for their own client
    bad_again(pg, gid, BADG); pg.evaluate(CLONE, [gid, ids["miss"], "LFE/25-26/803", "", ""]); month(pg, "202504")
    group(pg, what2); open_entry(pg, what2, gid); s = inv_state(pg)
    ok(s["step"] == "invoices" and len(s["rows"] or []) == 2, "two invoices to fix (%s)" % s["rows"])
    q0 = pg.evaluate("() => S.books.fixq.length")
    pg.evaluate("() => { window.__calls = []; window.__go = null; const f = " + GSTFIX + "; window.__fix = (b) => { const a = f(b); return new Promise((r) => { window.__go = () => r(a); }); }; }")
    pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_function("() => window.__calls.length === 1", timeout=10000)
    B = pg.evaluate("() => Object.values(S.companies).find(c => c.name === 'ZZ Other Client').id")
    vm = pg.evaluate("(i) => JSON.parse(JSON.stringify(S.books.vouchers.find(v => v.id === i)))", ids["miss"])
    pg.evaluate("(b) => { S.coId = b; return openBooksNow(b); }", B); pg.wait_for_timeout(800)
    # the client open now even holds an entry of the same Tally id: still nothing is sent or kept for it
    pg.evaluate("(v) => { S.books.vouchers = S.books.vouchers || []; S.books.vouchers.push(v); }", vm)
    pg.evaluate("() => window.__go && window.__go()"); settle(pg, 800)
    pg.evaluate("() => window.__go && window.__go()"); settle(pg, 300)
    other = pg.evaluate("() => ({cid: S.books.cid, fixq: (S.books.fixq || []).length})")
    ok(len(calls(pg)) == 1 and other == {"cid": B, "fixq": 0}, "another client opened mid-loop: the loop stops, nothing goes to the client open now (%d calls, %s)" % (len(calls(pg)), other))
    kept = pg.evaluate("(a) => Books.load(a[0]).then(b => [b.fixq.length - a[1], b.fixq[b.fixq.length - 1].state, a[2].map(i => (b.vouchers.find(v => v.id === i) || {}).gstin)])", [A, q0, [gid, ids["miss"]]])
    ok(kept[0] == 1 and kept[1] == "done" and kept[2].count(good2) == 1 and kept[2].count(good2) + kept[2].count("") + kept[2].count(BADG) == 2,
       "the first invoice saved for its own client; the rest stay there to fix (%s)" % kept)
    pg.evaluate("(a) => { S.coId = a; return openBooksNow(a); }", A); pg.wait_for_timeout(1500)
    pg.evaluate("() => { window.__fix = " + GSTFIX + "; }")
    # the clones go, the books as they were
    pg.evaluate("(b) => { S.books.vouchers = S.books.vouchers.filter(v => !(v.id.startsWith(b) && /^8\\d\\d$/.test(v.id.slice(-3)))); BOOKS_REV++; render(); }", base)
    return good2

# a copy of an entry whose party is a ledger of another group (PARTYNAME empty: the party is that ledger, a line of it)
CLONEL = """(a) => { const vs = S.books.vouchers, v = vs.find(x => x.id === a[0]), n = Object.assign({}, v, {id: a[1], no: a[2], gstin: a[3], alt: 600, party: a[4]});
  n.ent = (v.ent || []).map(e => e.l === v.party ? Object.assign({}, e, {l: a[4]}) : e);
  const i = vs.findIndex(x => x.id === a[1]); if (i >= 0) vs[i] = n; else vs.push(n); BOOKS_REV++; render(); }"""
def last_recs(pg, n):
    return pg.evaluate("(n) => S.books.fixq.slice(-n).map(x => ({id: x.id, state: x.state, target: x.ask.target, guid: x.ask.guid || '', after: x.after || '', words: x.words}))", n)

def review5(pg, A, vid, gid, led):
    """13. the review of 24-Nov-2026 (rev-fip4)"""
    what2, sup = "Buyer GSTINs that are not valid", "Supplier GSTINs that are not valid"
    base, goodN = gid[:-3], valid_for(pg, "07AAJFQ3157R1Z")
    # --- a party that is not under Sundry Debtors or Sundry Creditors: no ledger step, only the invoice opened
    pid = pg.evaluate("() => (GSTR.inward('202507', '07') || [])[0].id")
    pbase = pid[:-3]
    for title, src, ym, ret, what, party, ids in (
            ("a petty cash purchase against Cash", pid, "202507", "GSTR-3B", sup, "Cash", (pbase + "901", pbase + "902")),
            ("a sale against a bank ledger", gid, "202504", "GSTR-1", what2, "Tamarind Urban Bank - CA 0042", (base + "911", base + "912")),
            ("a party of a group not known", gid, "202504", "GSTR-1", what2, "Orchid Unlisted Traders", (base + "921", base + "922"))):
        for i in ids: pg.evaluate(CLONEL, [src, i, "PC/" + i[-3:], BADG, party])
        month(pg, ym, ret); rows = group(pg, what)
        if not rows or ids[0] not in rows:
            ok(False, "%s: its invoice is in What to fix (%s)" % (title, rows)); continue
        open_entry(pg, what, ids[0]); s = inv_state(pg)
        ok(s["step"] == "invoices" and s["led"] is None and [x[0] for x in s["rows"] or []] == [ids[0]],
           "%s: no ledger step, only the invoice opened listed, never every invoice of %s (%s)" % (title, party, {k: s[k] for k in ("step", "led", "rows")}))
        typein(pg, goodN)
        pg.evaluate("() => { window.__calls = []; window.__fix = " + GSTFIX + "; }")
        pg.click("[data-fix-entry] [data-fix-save]"); settle(pg)
        c = calls(pg)
        ok(len(c) == 1 and c[0][1].get("target") == "voucher" and c[0][1].get("guid") == ids[0] and not pg.evaluate("(p) => (S.books.gstins || {})[p] != null", party),
           "%s: only that invoice sent, no GSTIN written for the ledger %s (%s)" % (title, party, [(x[1].get("target"), x[1].get("guid", "")[-3:]) for x in c]))
        pg.wait_for_timeout(1400); cancel(pg)
        pg.evaluate("(l) => { S.books.vouchers = S.books.vouchers.filter(v => !l.includes(v.id)); BOOKS_REV++; render(); }", list(ids))

    # --- a waiting change with no Tally company of its own: refused, said plainly, never sent
    pg.evaluate("""() => { const b = S.books, x = JSON.parse(JSON.stringify(b.fixq.filter(y => y.ask && y.ask.target === 'voucher').slice(-1)[0]));
      x.id = 'fx-nocoguid'; x.state = 'waiting'; x.coGuid = ''; b.fixq.push(x); window.__calls = []; render(); }""")
    pump(pg)
    r = pg.evaluate("() => { const x = S.books.fixq.find(y => y.id === 'fx-nocoguid'); return [x.state, x.words]; }")
    ok(len(calls(pg)) == 0 and r == ["refused", "Open this entry again to save the change."], "a waiting change with no Tally company kept: not sent, 'Open this entry again to save the change.' (%d calls, %s)" % (len(calls(pg)), r))

    # --- the ledger's change held (Tally closed): the listed invoices queued after it, sent in order when Tally opens
    miss = base + "931"
    pg.evaluate(CLONE, [gid, miss, "LFE/25-26/931", "", ""]); bad_again(pg, gid, BADG)
    pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; S.books.ledInfo[a[0]] = {alt: 33}; BOOKS_REV++; render(); }", [led, BADG]); month(pg, "202504")
    group(pg, what2); open_entry(pg, what2, gid); typein(pg, goodN)
    pg.evaluate("() => { window.__calls = []; window.__fix = " + HELD + "; }")
    pg.click("[data-fix-entry] [data-fix-save]"); settle(pg, 300)
    q = last_recs(pg, 3)
    ok(len(calls(pg)) == 1 and [x["target"] for x in q] == ["ledger", "voucher", "voucher"] and all(x["state"] == "waiting" for x in q)
       and sorted(x["guid"] for x in q[1:]) == sorted([gid, miss]) and all(x["after"] == q[0]["id"] for x in q[1:]),
       "the ledger held: its invoices queued as waiting, each after the ledger; only the ledger tried (%d calls, %s)" % (len(calls(pg)), [(x["target"], x["state"], x["guid"][-3:]) for x in q]))
    s = inv_state(pg) or {}
    ok(s.get("rows") and all(x[2] == "waiting" for x in s["rows"]) and not s.get("save"), "the window shows the invoices waiting too, Save off (%s)" % s.get("rows"))
    cancel(pg)
    pg.evaluate("() => { window.__calls = []; window.__fix = " + GSTFIX + "; }"); pump(pg)
    c = calls(pg); q2 = pg.evaluate("(l) => l.map(i => S.books.fixq.find(x => x.id === i).state)", [x["id"] for x in q])
    ok([x[1].get("target") for x in c] == ["ledger", "voucher", "voucher"] and q2 == ["done", "done", "done"], "Tally open: the ledger, then its invoices, in order (%s, %s)" % ([x[1].get("target") for x in c], q2))
    # the ledger refused when it goes: its invoices are not sent
    bad_again(pg, gid, BADG); pg.evaluate(CLONE, [gid, miss, "LFE/25-26/931", "", ""])
    pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; S.books.ledInfo[a[0]] = {alt: 33}; BOOKS_REV++; render(); }", [led, BADG]); month(pg, "202504")
    group(pg, what2); open_entry(pg, what2, gid); typein(pg, goodN)
    pg.evaluate("() => { window.__calls = []; window.__fix = " + HELD + "; }")
    pg.click("[data-fix-entry] [data-fix-save]"); settle(pg, 300); cancel(pg)
    q = last_recs(pg, 3)
    pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({body: {ok: false, refused: true, message: 'Tally did not change it: test.'}}); }"); pump(pg)
    q2 = pg.evaluate("(l) => l.map(i => S.books.fixq.find(x => x.id === i).state)", [x["id"] for x in q])
    ok(len(calls(pg)) == 1 and q2 == ["refused", "refused", "refused"], "the ledger refused when Tally opens: its invoices are not sent (%d calls, %s)" % (len(calls(pg)), q2))

    # --- one invoice held: the rest queued after it
    pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; S.books.ledInfo[a[0]] = {alt: 33}; BOOKS_REV++; render(); }", [led, goodN])
    bad_again(pg, gid, BADG); pg.evaluate(CLONE, [gid, miss, "LFE/25-26/931", "", ""]); month(pg, "202504")
    group(pg, what2); open_entry(pg, what2, gid); s = inv_state(pg)
    pg.evaluate("() => { window.__calls = []; window.__fix = " + HELD + "; }")
    pg.click("[data-fix-entry] [data-fix-save]"); settle(pg, 300)
    q = last_recs(pg, 2)
    ok(len(calls(pg)) == 1 and [x["state"] for x in q] == ["waiting", "waiting"] and sorted(x["guid"] for x in q) == sorted([gid, miss]),
       "one invoice held: the rest queued as waiting, not tried now (%d calls, %s)" % (len(calls(pg)), [(x["state"], x["guid"][-3:]) for x in q]))
    cancel(pg)
    pg.evaluate("() => { window.__calls = []; window.__fix = " + GSTFIX + "; }"); pump(pg)
    q2 = pg.evaluate("(l) => l.map(i => S.books.fixq.find(x => x.id === i).state)", [x["id"] for x in q])
    ok([x[1].get("guid") for x in calls(pg)] == [x["guid"] for x in q] and q2 == ["done", "done"], "Tally open: sent in the order queued (%s)" % q2)

    # --- a new change is 'sending' while its own send is on its way: the background sending skips it
    alt[0] += 2; pg.evaluate(PLANT, [vid, LONG, alt[0]])
    month(pg, "202507"); group(pg, WHAT); open_entry(pg, WHAT, vid); typein(pg, SHORT)
    pg.evaluate("() => { window.__calls = []; window.__go = null; window.__ans = " + DONE + "; window.__fix = (b) => { const a = window.__ans(b); return new Promise((r) => { window.__go = () => r(a); }); }; }")
    pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_function("() => window.__calls.length === 1", timeout=10000)
    st0 = pg.evaluate("() => S.books.fixq[S.books.fixq.length - 1].state")
    pg.evaluate("() => { FixQ.last = 0; FixQ.pump(true); }"); pg.wait_for_timeout(400)
    ok(st0 == "sending" and len(calls(pg)) == 1, "a new change is 'sending' until its own send answers; the background sending leaves it (%s, %d calls)" % (st0, len(calls(pg))))
    pg.evaluate("() => window.__go && window.__go()"); settle(pg, 300)
    ok(pg.evaluate("() => S.books.fixq[S.books.fixq.length - 1].state") == "done", "then saved")
    pg.wait_for_timeout(1300); cancel(pg)
    # left 'sending' by a page closed mid-send: taken as waiting after two minutes and sent
    pg.evaluate("""() => { const b = S.books, x = JSON.parse(JSON.stringify(b.fixq.filter(y => y.ask && y.ask.target === 'voucher').slice(-1)[0]));
      x.id = 'fx-stale'; x.state = 'sending'; x.at = new Date(Date.now() - 600000).toISOString(); b.fixq.push(x); window.__calls = []; window.__fix = (q) => ({body: {ok: true, after: {}}}); }""")
    pump(pg)
    ok(len(calls(pg)) == 1 and pg.evaluate("() => S.books.fixq.find(x => x.id === 'fx-stale').state") == "done", "a change left 'sending' by a closed page: sent later as a waiting one (%d calls)" % len(calls(pg)))

    # --- the once-a-minute draw sends a colleague's waiting change; the history says who sent it
    pg.evaluate("""() => { const b = S.books, x = JSON.parse(JSON.stringify(b.fixq.filter(y => y.ask && y.ask.target === 'voucher').slice(-1)[0]));
      x.id = 'fx-draw'; x.state = 'waiting'; x.dev = 'dev-colleague-2'; x.by = 'colleague2@example.com'; delete x.sentDev; delete x.sentBy; b.fixq.push(x);
      window.__calls = []; FixQ.last = 0; FixQ.who = () => 'me@example.com'; }""")
    month(pg, "202507"); settle(pg, 500)
    h = pg.evaluate("() => { const h = document.querySelector('#app [data-fix-history]'); h.open = true; return h.textContent.replace(/\\s+/g, ' '); }")
    ok(len(calls(pg)) == 1 and pg.evaluate("() => S.books.fixq.find(x => x.id === 'fx-draw').state") == "done" and "saved by colleague2@example.com · sent from another computer by me@example.com" in h,
       "the page drawn (once a minute) sends a colleague's waiting change; the history shows who saved it and who sent it (%d calls)" % len(calls(pg)))
    pg.evaluate("() => { FixQ.who = window.__who0; S.books.vouchers = S.books.vouchers.filter(v => !/9\\d\\d$/.test(v.id.slice(-3)) || !v.id.startsWith('" + base + "')); BOOKS_REV++; render(); }")

def review6(pg, gid, led):
    """14. the ledger groups never read: Save reads them from Tally (the bridge's /ledgers, as Read ledgers from Tally
    does), then goes on in the same press; Tally closed: only the invoice opened, as before"""
    what2, goodN = "Buyer GSTINs that are not valid", valid_for(pg, "07AAJFQ3156R1Z")
    saved = pg.evaluate("() => JSON.stringify([S.books.under, S.books.groups])")
    def fresh():
        bad_again(pg, gid, BADG)
        pg.evaluate("(a) => { S.books.under = {}; S.books.groups = {}; S.books.gstins[a[0]] = a[1]; S.books.ledInfo[a[0]] = {alt: 33}; BOOKS_REV++; render(); }", [led, BADG])
        month(pg, "202504"); group(pg, what2); open_entry(pg, what2, gid); typein(pg, goodN)
    # Tally closed: the read fails, only the invoice opened is fixed
    fresh(); s = inv_state(pg)
    ok(s["step"] == "invoices" and s["led"] is None, "groups never read: the window starts with the invoice only (%s)" % {k: s[k] for k in ("step", "led")})
    pg.evaluate("() => { window.__calls = []; window.__reads = []; window.__ledgers = null; window.__fix = " + GSTFIX + "; }")
    pg.click("[data-fix-entry] [data-fix-save]"); settle(pg, 400)
    c = calls(pg); r = pg.evaluate("() => window.__reads")
    ok(len(r) == 1 and r[0].startswith("/ledgers?company=") and len(c) == 1 and c[0][1].get("target") == "voucher" and c[0][1].get("guid") == gid
       and not pg.evaluate("() => /Tally is not open/.test(document.body.innerText)"),
       "groups never read, Tally closed: Save tried the read once, then fixed only the invoice opened, nothing more said (%s, %s)" % (r, [x[1].get("target") for x in c]))
    pg.wait_for_timeout(1400); cancel(pg)
    # Tally open: Save reads the groups, sees the party under Sundry Debtors, and fixes the ledger then its invoices
    fresh()
    pg.evaluate("""(l) => { window.__calls = []; window.__reads = []; window.__ledgers = {ok: true, ledgers: [{name: l, group: 'Debtors - Delhi', gstin: '', pan: ''}, {name: 'Cash', group: 'Cash-in-Hand'}],
      groups: [{name: 'Debtors - Delhi', parent: 'Sundry Debtors'}, {name: 'Sundry Debtors', parent: 'Current Assets'}, {name: 'Cash-in-Hand', parent: 'Current Assets'}, {name: 'Current Assets', parent: ''}]}; }""", led)
    pg.click("[data-fix-entry] [data-fix-save]"); settle(pg, 600); settle(pg, 300)
    c = calls(pg); r = pg.evaluate("() => window.__reads")
    g = pg.evaluate("(l) => [S.books.groups['Debtors - Delhi'], S.books.under[l], S.books.under['Cash'], S.books.gstins[l]]", led)
    ok(len(r) == 1 and [x[1].get("target") for x in c][:2] == ["ledger", "voucher"] and c[0][1].get("fields") == {"gstin": goodN} and any(x[1].get("guid") == gid for x in c[1:]),
       "groups never read, Tally open: one Save reads them, then fixes the ledger and its invoices (%s, %s)" % (r, [(x[1].get("target"), x[1].get("guid", "")[-3:]) for x in c]))
    ok(g == ["Sundry Debtors", "Debtors - Delhi", "Cash-in-Hand", goodN], "the groups read are kept in FinCom Books (b.groups, b.under) as Read ledgers from Tally keeps them (%s)" % g)
    pg.wait_for_timeout(1400); cancel(pg)
    pg.evaluate("(j) => { const a = JSON.parse(j); S.books.under = Object.assign(S.books.under || {}, a[0]); S.books.groups = Object.assign(S.books.groups || {}, a[1]); window.__ledgers = null; BOOKS_REV++; render(); }", saved)

def should_fix(pg, vid):
    """11. the review's should-fix items"""
    b0 = pg.evaluate("() => S.books.fixq.length")
    # a colleague's waiting change (made on a computer with no bridge) is sent from here, the bridge up; and one with no dev
    pg.evaluate("""() => { const b = S.books, x = JSON.parse(JSON.stringify(b.fixq.filter(y => y.ask && y.ask.target === 'voucher').slice(-1)[0]));
      x.id = 'fx-colleague'; x.state = 'waiting'; x.dev = 'dev-colleague'; x.by = 'colleague@example.com'; x.words = 'Waiting'; b.fixq.push(x);
      const y = JSON.parse(JSON.stringify(x)); y.id = 'fx-nodev'; delete y.dev; delete y.by; b.fixq.push(y); render(); }""")
    pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({body: {ok: true, after: {}}}); }")
    pump(pg)
    r = pg.evaluate("() => ['fx-colleague', 'fx-nodev'].map(i => { const x = S.books.fixq.find(y => y.id === i); return [x.state, x.by || '', x.dev || '', x.sentDev === FixQ.dev()]; })")
    ok(len(calls(pg)) == 2 and r == [["done", "colleague@example.com", "dev-colleague", True], ["done", "", "", True]],
       "a colleague's waiting change and one with no computer's id: sent from here, the bridge up; who saved it kept, this computer as the sender (%d calls, %s)" % (len(calls(pg)), r))
    h = pg.evaluate("() => { const h = document.querySelector('#app [data-fix-history]'); h.open = true; return h.textContent.replace(/\\s+/g, ' '); }")
    ok("colleague@example.com" in h and "sent from the computer it was made on" not in h, "a colleague's change is shown, with who saved it (%r)" % h[-200:])
    pg.evaluate("() => { S.books.fixq = S.books.fixq.filter(x => x.id !== 'fx-colleague' && x.id !== 'fx-nodev'); render(); }")
    ok(pg.evaluate("() => S.books.fixq.every(x => !x.ask || x.id.startsWith('fx-') && !x.dev || x.dev === FixQ.dev())"), "each change made here carries this computer's id")
    # FixQ.mine: exact
    m = pg.evaluate("""() => [FixQ.mine({ask: {fields: {number: 'Lfe/1'}}}, {number: 'LFE/1'}), FixQ.mine({ask: {fields: {number: 'LFE/1'}}}, {number: 'LFE/1'}),
      FixQ.mine({ask: {fields: {pos: '27'}}}, {pos: 'Maharashtra'}), FixQ.mine({ask: {fields: {gstin: '07AAJFQ3158R1ZJ'}}}, {gstin: '07aajfq3158r1zj'})]""")
    ok(m == [False, True, True, False], "FixQ.mine compares exactly (letter case too), a state by code or Tally's name (%s)" % m)
    # a place of supply by its state code, whatever the name's spelling ("&" or "and")
    m = pg.evaluate("""() => [['01', 'Jammu & Kashmir'], ['01', 'Jammu and Kashmir'], ['26', 'Dadra & Nagar Haveli & Daman & Diu'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
      ['35', 'Andaman & Nicobar Islands'], ['Jammu and Kashmir', 'Jammu & Kashmir'], ['01', 'Himachal Pradesh'], ['35', 'Andhra Pradesh']].map(([w, g]) => FixQ.mine({ask: {fields: {pos: w}}}, {pos: g}))""")
    ok(m == [True, True, True, True, True, True, False, False], "FixQ.mine: a place of supply by state code, 'Jammu & Kashmir' is 'Jammu and Kashmir', codes 26 and 35 too (%s)" % m)
    # Tally holds the value, not sent from here: already in Tally, no Undo
    alt[0] += 2; pg.evaluate(PLANT, [vid, LONG, alt[0]])
    month(pg, "202507"); group(pg, WHAT); open_entry(pg, WHAT, vid); typein(pg, SHORT)
    answer(pg, "(b) => ({body: {ok: false, changed: true, now: {number: b.fields.number, alterId: '777'}, alterNow: '777', xml: window.__xmlOf(Object.assign({}, b, {alterId: 776}))}})")
    pg.click("[data-fix-entry] [data-fix-save]"); settle(pg)
    st = state(pg)
    last = pg.evaluate("() => S.books.fixq[S.books.fixq.length - 1]")
    ok(st and st[0] == "already" and "Already in Tally" in st[1] and last["state"] == "already", "Tally already holds it, not sent from here: Already in Tally (%s)" % st)
    pg.wait_for_timeout(1300)
    ok(not pg.evaluate("(i) => Array.from(document.querySelectorAll('#app [data-fix-undo]')).some(u => u.dataset.fixUndo === i)", last["id"]), "already in Tally: no Undo")
    # Changes made here (N): only the ones Tally took
    n = pg.evaluate("() => [S.books.fixq.filter(x => x.state === 'done').length, (document.querySelector('#app [data-fix-history] summary') || {}).textContent]")
    ok(n[1] == "Changes made here (%d)" % n[0] and n[0] < pg.evaluate("() => S.books.fixq.length"), "Changes made here counts the changes Tally took (%s)" % n)
    # at most 200 kept, the oldest dropped
    pg.evaluate("""() => { const b = S.books; for (let i = 0; i < 210; i++) b.fixq.push({id: 'fx-old' + i, cid: b.cid, at: '2026-01-01', state: 'refused', label: 'old ' + i, ask: {target: 'voucher', fields: {number: 'X'}}, dev: FixQ.dev()}); window.__live = false; }""")
    pg.evaluate("(v) => FixQ.add({target: 'voucher', guid: v, alterId: '1', vchType: 'Sales', vchDate: '20250701', fields: {number: 'CAP-1'}}, 'cap', {kind: 'number', vid: v, was: 'x', to: 'CAP-1'})", vid); pg.wait_for_timeout(300)
    q = pg.evaluate("() => [S.books.fixq.length, S.books.fixq[S.books.fixq.length - 1].label, S.books.fixq.some(x => x.id === 'fx-old0'), S.books.fixq.some(x => x.id === 'fx-old209')]")
    ok(q == [200, "cap", False, True], "at most 200 changes kept, the oldest dropped (%s)" % q)
    pg.evaluate("() => { S.books.fixq = S.books.fixq.filter(x => !String(x.id).startsWith('fx-old') && x.label !== 'cap'); window.__live = true; render(); }")
    ok(pg.evaluate("() => GSTR.NOT_GST.has('fixq')"), "fixq is not a part GST reads (GSTR.NOT_GST)")

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=4096"])
        ctx = br.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        pg.evaluate("(a) => { const v = (" + SALE + ")(a[0]); v.no = a[1]; if (v.alt == null) v.alt = 57; }", [SHORT, LONG])
        pg.evaluate("(a) => { const v = (" + SALE + ")(a[0]); v.gstin = a[1]; S.books.gstins = S.books.gstins || {}; S.books.gstins[v.party] = a[1]; }", ["LFE/25-26/001", BADG])
        # Tally's groups: the party under a sub-group of Sundry Debtors; Cash and a bank under their own groups
        pg.evaluate("(a) => { const v = (" + SALE + ")(a); " + """S.books.under = Object.assign(S.books.under || {}, {[v.party]: 'Debtors - Delhi', 'Cash': 'Cash-in-Hand', 'Tamarind Urban Bank - CA 0042': 'Bank Accounts'});
          S.books.groups = Object.assign(S.books.groups || {}, {'Debtors - Delhi': 'Sundry Debtors', 'Sundry Debtors': 'Current Assets', 'Cash-in-Hand': 'Current Assets', 'Bank Accounts': 'Current Assets', 'Current Assets': 'Primary'}); }""", "LFE/25-26/001")
        vid = pg.evaluate("(a) => (" + SALE + ")(a).id", LONG)
        A = pg.evaluate("S.books.cid"); ALT0 = voucher(pg, vid)["alt"]
        pg.evaluate(STUB, {"url": BURL, "key": BKEY, "id": BID}); pg.evaluate(XMLOF)

        # 1. the window on the page, the number's box only
        month(pg, "202507")
        rows = group(pg, WHAT)
        ok(rows and vid in rows, "Jul-2025: the long number's row in What to fix (%s)" % rows)
        w = open_entry(pg, WHAT, vid)
        ok(w["kind"] == "number" and w["input"] == ["number", LONG] and w["save"] and w["lookup"] and w["tab"] == "gst",
           "Open the entry: a window on the same page, the invoice number in its box, Save in Tally, Open in Look up (%s)" % {k: w[k] for k in ("kind", "input", "save", "tab")})
        ok("The portal takes at most 16 characters in an invoice number." in w["text"] and w["warn"] == 0, "the reason in plain words, nothing shown as a warning (%r)" % w["text"][:200])
        ok(save_off(pg), "Save waits until the number fits")
        typein(pg, "LFE/25-26/0006 X")
        ok(save_off(pg), "a space is not taken (the portal's characters only)")
        typein(pg, SHORT)
        ok(not save_off(pg) and "13 of 16" in pg.evaluate("() => document.querySelector('[data-fix-count]').innerText"), "13 of 16: Save is offered")

        # 3. refused, with the answer still on its way first: Save is off while it is with Tally
        pg.evaluate("() => { window.__go = null; window.__fix = (b) => new Promise((r) => { window.__go = r; }); }")
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(500)
        ok(save_off(pg) and (state(pg) or [""])[0] == "waiting", "while the change is with Tally: Saving, Save is off (%s)" % state(pg))
        pg.evaluate("() => window.__go({body: {ok: false, refused: true, message: \"Tally did not change it: Voucher Number 'LFE/25-26/006' already exists.\"}})"); pg.wait_for_timeout(700)
        c = calls(pg); body = c[-1][1] if c else {}
        ok(len(c) == 1 and c[0][0] == "/fix" and c[0][2] == BKEY and body.get("target") == "voucher" and body.get("guid") == vid and body.get("fields") == {"number": SHORT}
           and body.get("companyGuid") == "g-" + A and body.get("company", "").startswith("Tally of ") and body.get("alterId") == str(ALT0) and body.get("vchDate") and body.get("vchType"),
           "Save goes through Bridge.call to /fix with the key: the entry's Tally id, change number, type, date and the new number only (%s)" % body)
        st = state(pg)
        ok(st and st[0] == "refused" and "already exists" in st[1], "refused: Tally's own words in the window (%s)" % st)
        ok(voucher(pg, vid) == {"no": LONG, "alt": ALT0}, "refused: nothing changed in FinCom Books (%s)" % voucher(pg, vid))
        ok(not save_off(pg), "refused: the typed number stays and Save can be pressed again")
        shot(pg, "classic-light-refused")
        pump(pg); ok(len(calls(pg)) == 1, "refused: never sent again by itself (%d calls)" % len(calls(pg)))
        cancel(pg)

        # 4. changed since: said, Tally's entry brought in, the next Save uses Tally's change number
        pg.evaluate("(a) => { window.__xml = (" + XML + ")(a); }", [vid, "LFE/2025-26/000106", 61])
        pg.evaluate("() => { window.__calls = []; }")
        month(pg, "202507"); group(pg, WHAT); open_entry(pg, WHAT, vid); typein(pg, SHORT); answer(pg, CHANGED)
        pg.click("[data-fix-entry] [data-fix-save]"); settle(pg)
        st = state(pg)
        ok(st and st[0] == "changed" and st[1].startswith("Changed in Tally since you opened it"), "changed since: said plainly, nothing saved (%s)" % st)
        ok(voucher(pg, vid) == {"no": "LFE/2025-26/000106", "alt": 61}, "changed since: FinCom takes the entry as Tally has it now (%s)" % voucher(pg, vid))
        tt = pg.evaluate("() => document.querySelector('[data-fix-entry]').innerText")
        ok("LFE/2025-26/000106" in tt.split("\n")[0] and LONG not in tt.split("\n")[0], "changed since: the window's title is Tally's number now (%r)" % tt[:80])
        typein(pg, "LFE/2025-26/000106"); pg.wait_for_timeout(150)
        ok(save_off(pg), "changed since: the unchanged test is against Tally's number now (Save off for it)")
        typein(pg, SHORT)
        shot(pg, "classic-light-changed")
        pump(pg); ok(len(calls(pg)) == 1, "changed since: never sent again by itself (%d calls)" % len(calls(pg)))

        # 2. saved, from the same window: the next Save carries Tally's change number; the entry read back replaces FinCom's
        answer(pg, DONE)
        pg.click("[data-fix-entry] [data-fix-save]"); settle(pg)
        c = calls(pg)
        ok(len(c) == 2 and c[-1][1].get("alterId") == "61", "Save again: sent with Tally's change number now (%s)" % (c[-1][1].get("alterId") if c else None))
        st = state(pg)
        ok(st and st[0] == "done" and st[1] == "Saved in Tally and FinCom Books.", "saved with the entry read back: Saved in Tally and FinCom Books. (%s)" % st)
        pg.wait_for_timeout(1500)
        ok(voucher(pg, vid) == {"no": SHORT, "alt": 62}, "FinCom Books hold Tally's entry read back (%s)" % voucher(pg, vid))
        ok(not pg.evaluate("() => !!document.querySelector('[data-fix-entry]')"), "the window closes by itself")
        rows = group(pg, WHAT)
        ok(not rows or vid not in rows, "the row has left What to fix (%s)" % rows)
        h = pg.evaluate("() => { const h = document.querySelector('#app [data-fix-history]'); return h ? h.textContent.replace(/\\s+/g, ' ') : ''; }")
        ok(LONG in h and SHORT in h and "already exists" in h, "Changes made here: the refused one with Tally's words and the saved one (%s)" % h[:300])
        ok(pg.evaluate("(a) => (S.books.fixq || []).every(x => x.cid === a)", A), "each change is kept with the client it was made for (cid)")
        ok(not pg.evaluate("() => !!document.querySelector('#app [data-fix-undo]')"), "no Undo back to a number the portal refuses")

        # ok without a read back: saved in Tally, FinCom Books at the next read
        st = try_save(pg, vid, "(b) => ({body: {ok: true, message: 'Saved in Tally.', after: {number: b.fields.number, alterId: '999'}}})")
        ok(st and st[0] == "done" and "Saved in Tally" in st[1] and "FinCom Books" in st[1] and st[1] != "Saved in Tally and FinCom Books.", "saved without the entry read back: not said to be in FinCom Books yet (%s)" % st)
        cancel(pg)

        # 5. kept, unknown, gone, refused before sending: said, and never sent again by itself
        pg.evaluate("(a) => { window.__xml = (" + XML + ")(a); }", [vid, LONG, 300])
        st = try_save(pg, vid, "(b) => ({body: {ok: false, kept: true, message: 'Tally kept its own value. This is how the entry is now.', after: {number: 'x', alterId: '300'}, xml: window.__xml}})")
        ok(st and st[0] == "kept" and "Tally kept its own value" in st[1] and voucher(pg, vid)["alt"] == 300, "kept: said, and Tally's entry brought in (%s, %s)" % (st, voucher(pg, vid)))
        cancel(pg)
        pg.evaluate("() => { window.__calls = []; }")
        st = try_save(pg, vid, "(b) => ({body: {ok: false, unknown: true, message: 'Tally did not answer. Ask Tally again to see whether it changed.'}})")
        ok(st and st[0] == "unknown" and "Ask Tally again" in st[1], "unknown: said (%s)" % st)
        pump(pg); ok(len(calls(pg)) == 1, "unknown: never sent again by itself (%d calls)" % len(calls(pg)))
        again = pg.evaluate("() => !!document.querySelector('[data-fix-entry] [data-fix-again]')")
        ok(again, "unknown: Ask Tally again is offered")
        answer(pg, DONE)
        if again: pg.click("[data-fix-entry] [data-fix-again]"); settle(pg)
        st = state(pg)
        ok(len(calls(pg)) == 2 and st and st[0] == "done", "Ask Tally again (a person's press): sent once more, saved (%s)" % st)
        cancel(pg)
        for js, kind, words in (("(b) => ({body: {ok: false, gone: true, message: 'Tally no longer has this entry.'}})", "gone", "Tally no longer has this entry."),
                                ("(b) => ({body: {ok: false, message: 'Open the entry again: FinCom needs its change number from Tally first.'}})", "refused", "Open the entry again")):
            pg.evaluate("() => { window.__calls = []; }")
            st = try_save(pg, vid, js)
            ok(st and st[0] == kind and words in st[1], "%s: said (%s)" % (kind, st))
            pump(pg); ok(len(calls(pg)) == 1, "%s: never sent again by itself (%d calls)" % (kind, len(calls(pg))))
            cancel(pg)

        # 7. an older FinCom Bridge: says which one is needed, never sent again by itself
        pg.evaluate("() => { window.__calls = []; }")
        st = try_save(pg, vid, OLD)
        ok(st and st[0] == "old" and "FinCom Bridge 2.5.21" in st[1], "404 Unknown address /fix: needs FinCom Bridge 2.5.21 (%s)" % st)
        shot(pg, "classic-light-needs-newer-bridge")
        pump(pg); pg.evaluate("() => render()"); pg.wait_for_timeout(300)
        ok(len(calls(pg)) == 1, "an older bridge: never sent again by itself (%d calls)" % len(calls(pg)))
        cancel(pg)

        # 6. held (Tally closed) and no answer: kept, Waiting for Tally, Save off; sent when Tally is open
        pg.evaluate("() => { window.__calls = []; }")
        st = try_save(pg, vid, HELD)
        ok(st and st[0] == "waiting" and st[1] == WAIT, "held, Tally closed: Waiting for Tally (%s)" % st)
        ok(save_off(pg), "held: Save is off while the change waits")
        shot(pg, "classic-light-waiting")
        cancel(pg); open_entry(pg, WHAT, vid); typein(pg, SHORT)
        ok(save_off(pg), "held: opened again, Save is still off while the change waits")
        cancel(pg)
        answer(pg, DONE); pump(pg)
        c = calls(pg)
        ok(len(c) >= 2 and all(x[1] == c[0][1] for x in c) and pg.evaluate("() => S.books.fixq[S.books.fixq.length - 1].state") == "done", "held: sent again when Tally is open (the same change), and saved (%d calls)" % len(c))
        pg.evaluate("() => { window.__calls = []; }")
        st = try_save(pg, vid, "(b) => 'net'", 1500)
        ok(st and st[0] == "waiting", "no answer from FinCom Bridge: kept, Waiting for Tally (%s)" % st)
        cancel(pg); answer(pg, DONE); pump(pg, 1500)
        ok(len(calls(pg)) == 2 and pg.evaluate("() => S.books.fixq[S.books.fixq.length - 1].state") == "done", "no answer: sent again when the bridge answers (%d calls)" % len(calls(pg)))
        # Tally closed here (no bridge live): kept, nothing sent
        pg.evaluate("() => { window.__live = false; window.__calls = []; }")
        st = try_save(pg, vid, DONE, 500)
        ok(st and st[0] == "waiting" and len(calls(pg)) == 0, "Tally not open here: kept, nothing sent (%s)" % st)
        cancel(pg); pg.evaluate("() => { window.__live = true; }"); pump(pg)
        ok(len(calls(pg)) == 1, "Tally open again: the kept change is sent")

        # 8. another client opened while the change is with Tally: the answer goes to the client it was made for
        B = pg.evaluate("() => { const c = newCompany({name: 'ZZ Other Client', gstin: '27AAGCL4827M1Z1'}); S.companies[c.id] = c; return c.id; }")
        pg.evaluate("() => { window.__calls = []; window.__go = null; }")
        alt[0] += 2; pg.evaluate(PLANT, [vid, LONG, alt[0]])
        month(pg, "202507"); group(pg, WHAT); open_entry(pg, WHAT, vid); typein(pg, SHORT)
        pg.evaluate("() => { window.__ans = " + DONE + "; window.__fix = (b) => { const a = window.__ans(b); return new Promise((r) => { window.__go = () => r(a); }); }; }")
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(500)
        pg.evaluate("(b) => { S.coId = b; return openBooksNow(b); }", B); pg.wait_for_timeout(800)
        ok(pg.evaluate("() => !(S.gstFix || {}).pop && !document.querySelector('[data-fix-entry]')"), "another client opened: the window is closed")
        pg.evaluate("() => window.__go && window.__go()"); pg.wait_for_timeout(1500)
        c = calls(pg)
        ok(len(c) == 1 and c[0][1].get("companyGuid") == "g-" + A and "ZZ Other" not in c[0][1].get("company", ""), "the change went to the client it was made for (%s)" % (c[0][1] if c else None))
        other = pg.evaluate("(a) => ({cid: S.books.cid, fixq: (S.books.fixq || []).length, has: (S.books.vouchers || []).some(v => v.id === a)})", vid)
        ok(other == {"cid": B, "fixq": 0, "has": False}, "the client open now is untouched (%s)" % other)
        kept = pg.evaluate("(a) => Books.load(a[0]).then(b => { const r = (b.fixq || [])[b.fixq.length - 1], v = b.vouchers.find(x => x.id === a[1]); return [r && r.state, r && r.cid, v && v.no, v && v.alt]; })", [A, vid])
        ok(kept == ["done", A, SHORT, alt[0] + 1], "the answer is in the books of the client it was made for (%s)" % kept)

        # ... and during the sending of the held ones
        pg.evaluate("(a) => { S.coId = a; return openBooksNow(a); }", A); pg.wait_for_timeout(1500)
        pg.evaluate("() => { window.__live = false; window.__calls = []; }")
        try_save(pg, vid, DONE, 500); cancel(pg)
        pg.evaluate("() => { const b = S.books, x = JSON.parse(JSON.stringify(b.fixq[b.fixq.length - 1])); x.id = 'fx-second'; b.fixq.push(x); return saveBooks(); }")
        pg.evaluate("() => { window.__live = true; window.__fix = (b) => { const a = window.__ans(b); return new Promise((r) => { window.__go = () => r(a); }); }; }")
        pg.evaluate("() => { window.FixQ.last = 0; window.FixQ.pump(true); }"); pg.wait_for_timeout(500)
        pg.evaluate("(b) => { S.coId = b; return openBooksNow(b); }", B); pg.wait_for_timeout(800)
        pg.evaluate("() => window.__go && window.__go()"); pg.wait_for_timeout(1500)
        c = calls(pg)
        ok(len(c) == 1 and c[0][1].get("companyGuid") == "g-" + A, "another client opened during the sending: the one with Tally finishes for its own client, the rest wait (%d calls)" % len(c))
        other = pg.evaluate("() => ({cid: S.books.cid, fixq: (S.books.fixq || []).length})")
        ok(other == {"cid": B, "fixq": 0}, "the client open now is untouched (%s)" % other)
        kept = pg.evaluate("(a) => Books.load(a).then(b => b.fixq.slice(-2).map(x => x.state))", A)
        ok(kept == ["done", "waiting"], "the client the changes were made for: the first saved, the second still waiting (%s)" % kept)
        pg.evaluate("(a) => { S.coId = a; return openBooksNow(a); }", A); pg.wait_for_timeout(1500)
        answer(pg, DONE); pump(pg)

        # 9. GSTIN on the ledger: its AlterID sent when FinCom Books have it; Undo once, marked used once Tally took it
        month(pg, "202504")
        what2 = "Buyer GSTINs that are not valid"
        rows = group(pg, what2)
        gid = rows[0] if rows else ""
        w = open_entry(pg, what2, gid)
        ok(w["kind"] == "gstin" and w["input"] == ["gstin", BADG] and "Changed on the party ledger in Tally, then on this party's invoices of the month." in w["text"], "GSTIN not valid: the party ledger's GSTIN in its box (%s)" % {k: w[k] for k in ("kind", "input")})
        led = pg.evaluate("(g) => S.books.vouchers.find(v => v.id === g).party", gid)
        pg.evaluate("(l) => { S.books.ledInfo = S.books.ledInfo || {}; S.books.ledInfo[l] = Object.assign({}, S.books.ledInfo[l], {alt: 33}); }", led)
        good = pg.evaluate("() => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid('07AAJFQ3158R1Z' + c)) return '07AAJFQ3158R1Z' + c; }")
        typein(pg, good)
        pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({body: {ok: true, after: {gstin: b.fields.gstin, pan: '', alterId: '34'}, before: {gstin: b.was.gstin, alterId: '33'}}}); }")
        pg.click("[data-fix-entry] [data-fix-save]"); settle(pg)
        c = calls(pg); b = c[0][1] if c else {}
        ok(b.get("target") == "ledger" and b.get("fields") == {"gstin": good} and b.get("was") == {"gstin": BADG} and b.get("ledger") == led and b.get("alterId") == "33",
           "the ledger's GSTIN is sent, with the one FinCom showed and the ledger's AlterID (%s)" % b)
        ok(pg.evaluate("(l) => S.books.gstins[l]", led) == good and pg.evaluate("(l) => S.books.ledInfo[l].alt", led) in (34, "34"), "FinCom Books take the ledger read back, with its AlterID")
        invoice_steps(pg, what2, gid, led, good)
        cancel(pg); month(pg, "202504")
        # a GSTIN changed from one valid GSTIN to another: Undo offered
        good2 = pg.evaluate("() => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid('07AAJFQ3159R1Z' + c)) return '07AAJFQ3159R1Z' + c; }")
        pg.evaluate("""(a) => { S.books.fixq.push({id: 'fx-led', cid: a[0], at: '2026-11-20T10:00:00Z', by: '', kind: 'gstin', vid: '', state: 'done', was: a[2], to: a[3],
          label: 'GSTIN of ' + a[1] + ': ' + a[2] + ' → ' + a[3], before: {gstin: a[2], alterId: '33'}, after: {gstin: a[3], pan: '', alterId: '34'},
          ask: {target: 'ledger', ledger: a[1], was: {gstin: a[2]}, fields: {gstin: a[3]}, alterId: '33'}}); render(); }""", [A, led, good, good2])
        pg.wait_for_timeout(300)
        pg.evaluate("() => { window.__calls = []; window.__go = null; window.__fix = (b) => new Promise((r) => { window.__go = () => r({body: {ok: false, refused: true, message: 'Tally did not change it: no.'}}); }); }")
        pg.evaluate("() => { document.querySelector('#app [data-fix-history]').open = true; }"); pg.wait_for_timeout(200)
        pg.evaluate("() => { const u = document.querySelector('#app [data-fix-undo=\"fx-led\"]'); u.click(); u.click(); }"); pg.wait_for_timeout(600)
        pg.evaluate("() => { const u = document.querySelector('#app [data-fix-undo=\"fx-led\"]'); if (u) u.click(); }"); pg.wait_for_timeout(300)
        ok(len(calls(pg)) == 1, "Undo pressed twice: one change sent (%d)" % len(calls(pg)))
        pg.evaluate("() => window.__go && window.__go()"); settle(pg)
        UND = "() => { const r = S.books.fixq.find(x => x.id === 'fx-led'); return [!!r.undone, !!document.querySelector('#app [data-fix-undo=\"fx-led\"]')]; }"
        und = pg.evaluate(UND)
        ok(und == [False, True], "Undo refused by Tally: not marked used, Undo still offered (%s)" % und)
        pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({body: {ok: true, after: {gstin: b.fields.gstin, pan: '', alterId: '35'}, before: {gstin: b.was.gstin}}}); }")
        pg.evaluate("() => document.querySelector('#app [data-fix-undo=\"fx-led\"]').click()"); settle(pg)
        c = calls(pg); b = c[0][1] if c else {}
        und = pg.evaluate(UND)
        ok(b.get("fields") == {"gstin": good} and b.get("was") == {"gstin": good2} and b.get("alterId") == "34" and und == [True, False],
           "Undo taken by Tally: the earlier GSTIN sent with the ledger's AlterID now, then marked used (%s, %s)" % (b, und))

        # Undo of a place of supply: back to Tally's own value (the bridge's before), not FinCom's
        pg.evaluate("""(a) => { S.books.fixq.push({id: 'fx-pos', cid: a[0], at: '2026-11-20T10:00:00Z', by: '', kind: 'pos', vid: a[1], state: 'done', was: '07', to: '27',
          label: 'Place of supply of X: Delhi → Maharashtra', before: {pos: 'Haryana', alterId: '40'}, after: {pos: 'Maharashtra', alterId: '41'},
          ask: {target: 'voucher', guid: a[1], alterId: '40', vchType: 'Sales', vchDate: '20250701', fields: {pos: '27'}}}); render(); }""", [A, vid])
        pg.wait_for_timeout(300)
        pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({body: {ok: false, refused: true, message: 'Tally did not change it: test.'}}); document.querySelector('#app [data-fix-history]').open = true; }"); pg.wait_for_timeout(200)
        pg.evaluate("() => { const u = document.querySelector('#app [data-fix-undo=\"fx-pos\"]'); if (u) u.click(); }"); pg.wait_for_timeout(800)
        c = calls(pg); b = c[0][1] if c else {}
        ok(b.get("fields") == {"pos": "Haryana"} and b.get("alterId") == "41", "Undo of a place of supply: Tally's own earlier value, with the change number after (%s)" % b)

        should_fix(pg, vid)
        review4(pg, A, vid, gid, led, good)
        review5(pg, A, vid, gid, led)
        review6(pg, gid, led)

        # the invoices step and the ledger read first, in New look, dark
        pg.evaluate("() => { window.FCNewLook.set(true); }"); pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(800)
        month(pg, "202504"); what2 = "Buyer GSTINs that are not valid"
        bad_again(pg, gid, BADG); pg.evaluate("(a) => { S.books.gstins[a[0]] = a[1]; delete S.books.ledInfo[a[0]]; BOOKS_REV++; render(); }", [led, BADG]); month(pg, "202504")
        open_entry(pg, what2, gid); typein(pg, good)
        pg.evaluate("() => { window.__tallyG = '" + BADG + "'; const f = " + GSTFIX + "; window.__go = null; window.__fix = (b) => b.readFirst ? new Promise((r) => { window.__go = () => r(f(b)); }) : f(b); }")
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(500); shot(pg, "newlook-dark-ledger-read-first")
        pg.evaluate("() => window.__go && window.__go()"); pg.wait_for_timeout(1200); shot(pg, "newlook-dark-invoices")
        ok((inv_state(pg) or {}).get("step") == "invoices", "New look dark: the invoices step after the ledger read first and saved")
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(1500)
        pg.evaluate("() => { window.FCNewLook.set(false); }"); pg.emulate_media(color_scheme="light")

        # the four answers in New look, dark
        pg.evaluate("() => { window.FCNewLook.set(true); }"); pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(800)
        dark_shots(pg, vid, "newlook-dark")
        pg.evaluate("() => { window.FCNewLook.set(false); }"); pg.emulate_media(color_scheme="light")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(400)
        try_save(pg, vid, REFUSED)
        ok(pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "phone width: no sideways scroll")
        shot(pg, "phone-refused")
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("exception: %s" % e)
finally:
    srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("FAILED: %d" % len(fails) if fails else "ALL PASSED")
sys.exit(1 if fails else 0)
