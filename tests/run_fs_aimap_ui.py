"""python3 run_fs_aimap_ui.py - the one-time AI mapping of the Financial statements page (the owner, 29-Oct-2026: "run one
time ai here to match uploaded balance sheet and fincom generated balance sheet.. so that you will map the ledger heads
accordingly.. and for next year it would be 1 click job for anyone"). On the React build (app/dist-test, or TDSDESK_SITE),
the made-up books of tests/fixtures/fin-statements and a made-up audited balance sheet as at 31-Mar-2026 that differs from
FinCom's only in the mapping (fixtures/fin-statements/aimap-bs-2026.json: Willow Labs shown as a loan to a related party).
The AI is stubbed in the page (FinAiMap.post): it answers each ledger with its code, Willow Labs with the loan's code,
Advance to Staff with another code than the one chosen by hand, and Juniper Travels with a WRONG code (micro enterprise).
  - Checks tab, "Map ledgers with AI (one time)": the request carries only the allowed fields; the review shows, per
    ledger, the code now, the AI's code, its reason and whether its head ties; the wrong code's two heads show the gap;
    the hand choice is marked; the run's cost is shown;
  - Accept tied heads only: Willow Labs accepted (a hand choice, "<user>, AI-assisted"), the gap's heads and the hand
    choice left; Reject the wrong one, accept the rest one by one: every head agrees (the matching table too);
  - 2026-27: "Use last year's mapping": N ledgers mapped as last year; 1 new ledger to map (1 kept on the rules' codes);
    "Map the 1 new ledger with AI" sends that ledger only; accepted, nothing is left to map;
  - AI off (the firm's setting, or no firm account): the button says how to switch it on and sends nothing; the rules'
    and last year's balance sheet's codes still stand;
  - a phone (390 wide): no sideways scroll.
Screenshots go to TDSDESK_SHOTS (default tests/out/fs-aimap-shots)."""
import os, sys, json, subprocess, threading, functools, http.server, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = os.environ.get("TDSDESK_SHOTS", os.path.join(HERE, "out", "fs-aimap-shots")); os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 0), functools.partial(Q, directory=SITE)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
AUD = json.load(open(os.path.join(HERE, "fixtures", "fin-statements", "aimap-bs-2026.json")))
AUD_ROWS = [[AUD["title"]], [AUD["what"]], [AUD["unit"]], AUD["head"]] + AUD["rows"]
BOOKS = json.loads(subprocess.check_output(["node", "-e", r"""
const F = require('./fixtures/fin-statements/company.json'), from = '20240401', r2 = v => Math.round(v * 100) / 100;
const under = Object.assign({}, F.groups), led = {};
Object.entries(F.o).forEach(([n, v]) => { led[n] = {open: -v, close: 0, parent: under[n]}; });
const vouchers = [], bank = 'Northbank Current A/c', shift = e => String(Number(e.slice(0, 4)) - 1) + e.slice(4);
F.additions.forEach(([l, d, a], i) => vouchers.push({id: 'a' + i, date: d, no: 'A' + i, type: 'Journal', narr: 'Purchase of ' + l, ent: [{l, a: -a}, {l: bank, a}]}));
[['20250331', F.p, F.plp, F.o], ['20260331', F.c, F.plc, F.p]].forEach(([end, bs, pl, prev]) => { const ent = [];
  Object.keys(bs).forEach(n => { if (n === bank) return; const added = F.additions.filter(([l, d]) => l === n && d <= end && d > shift(end)).reduce((s, z) => s + z[2], 0);
    const mv = r2((bs[n] || 0) - (prev[n] || 0) - added); if (mv) ent.push({l: n, a: -mv}); });
  Object.entries(pl).forEach(([n, v]) => { if (v) ent.push({l: n, a: -v}); });
  ent.push({l: bank, a: r2(-ent.reduce((s, e) => s + e.a, 0))}); vouchers.push({id: 'm' + end, date: end, no: 'M' + end, type: 'Journal', narr: 'Movements (fixture)', ent}); });
vouchers.push({id: 'n1', date: '20260630', no: 'S1', type: 'Sales', narr: 'Services, April-June 2026', ent: [{l: 'Software Services - Export', a: 500000}, {l: bank, a: -500000}]});
// a ledger first used in 2026-27: next year's one new ledger
under['Cloud Hosting Charges'] = 'Indirect Expenses';
vouchers.push({id: 'n2', date: '20260715', no: 'P1', type: 'Payment', narr: 'Hosting, July 2026', ent: [{l: 'Cloud Hosting Charges', a: -12000}, {l: bank, a: 12000}]});
process.stdout.write(JSON.stringify({under, groups: {}, vouchers, meta: {from, to: '20270331'}, tb: {from, to: '20270331', at: '2027-04-30T10:00:00Z', src: 'copy', led}}));
"""], cwd=HERE))
SETUP = """(bk) => {
  S.firm = Object.assign({}, S.firm, {firmName: "Made-up & Associates", frn: "000000S", partner: "A. Sample", mno: "000001", place: "Bengaluru"});
  const c = newCompany({name: "Larkspur Analytics Private Limited (made-up)", gstin: "29AABCL1234F1Z5"}); c.pan = "AABCL1234F"; c.cin = "U72900KA2015PTC000001";
  S.companies[c.id] = c; Store.saveCompany(c); S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const b = Object.assign({loading: false, cid: c.id, challans: [], alloc: {}, ledInfo: {}, gstins: {}, pans: {}, states: {}, misCfg: {freq: "off"}, auditCfg: {freq: "off"},
    msme: {"Bluebell Print Works": "Micro"}, fs: {taxDep: {"2024": {c40: 220000, pm15: 140000, f10: 80000}}, inputs: {unit: 1, dec: 2}}}, bk);
  b.map = Books.mapLedgers(b.vouchers, {});
  S.books = b; window.__bk = b; S.fsFy = "2025"; S.fin = null; saveBooks(); goClient('books:fs'); return c.id; }"""
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
# the audited balance sheet as at 31-Mar-2026, kept as 2026-27's last year's balance sheet (one store with the matching)
KEEP = "(r) => { const v = FinPyBs.prepare(FinPyBs.fromRows([{name: 'Balance Sheet', rows: r}]), 'co'); FinPyBs.save('2026', Object.assign(v, {file: 'Larkspur audited BS 2025-26.xlsx'}), {by: 'test'}); render(); }"
# the AI, stubbed: each ledger with the code FinCom has for it now, except three; what was sent is kept in window.__sent
STUB = """() => { window.__sent = [];
  FinAiMap.aiOn = () => true;
  FinAiMap.post = async (body) => { window.__sent.push(JSON.parse(JSON.stringify(body)));
    const now = {}; FinSt.tb(S.fsFy).rows.forEach(r => { now[r.ledger] = r.code; });
    const AI = {"Willow Labs": ["12H", "the audited note 13 shows a loan to a related party of the same amount"], "Advance to Staff": ["12G", "an advance to employees"],
      "Juniper Travels": ["6A", "a travel agent, taken as a micro enterprise"], "Cloud Hosting Charges": ["17W", "hosting is a software subscription"]};
    const proposals = body.ledgers.map(l => AI[l.name] ? {name: l.name, code: AI[l.name][0], reason: AI[l.name][1]} : {name: l.name, code: now[l.name] || "17J", reason: "as its name and group say"});
    return {ok: true, proposals, asked: body.ledgers.length, notSent: 0, bad: 0, cost: {usd: 0.0412, inr: 3.62}}; };
  render(); }"""

def boot(pg):
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(1000)
    pg.evaluate(SETUP, BOOKS); pg.wait_for_timeout(2500)
def tab(pg, k): pg.click('#app nav.fin-tabs [data-fin-tab="%s"]' % k); pg.wait_for_timeout(800)
def loaded(pg): pg.wait_for_function("() => typeof FinAiMap === 'object' && document.querySelector('#app [data-fin-aimap]')", timeout=20000)

A = "#app [data-fin-aimap]"
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light"); pg = ctx.new_page(); boot(pg)
    # a code chosen by hand before the run (same head as the AI's, another line)
    pg.evaluate("() => { FinSt.mapSet('Advance to Staff', '12H'); render(); }")
    pg.evaluate(KEEP, AUD_ROWS); pg.wait_for_timeout(800)
    tab(pg, "checks")
    print("The button, on the matching screen (Checks)")
    loaded(pg); pg.evaluate(STUB); pg.wait_for_timeout(500)
    btn = pg.locator(A + " [data-fin-airun]")
    ok(btn.count() == 1 and btn.inner_text().strip() == "Map ledgers with AI (one time)", "the button: %s" % (btn.inner_text() if btn.count() else "none"))
    ok("Larkspur" not in pg.inner_text(A) and "nothing else" in pg.inner_text(A), "it says what goes and that nothing else does")
    btn.click(); pg.wait_for_selector(A + " [data-fin-aireview]", timeout=20000); pg.wait_for_timeout(800)
    sent = pg.evaluate("window.__sent")
    ok(len(sent) == 1, "one request")
    s0 = sent[0] if sent else {}
    ok(sorted(s0.keys()) == ["action", "client_id", "codes", "ledgers", "lines", "mode"] and s0.get("action") == "fs_aimap" and s0.get("mode") == "close", "the request's fields: %s" % sorted(s0.keys()))
    ok(all(sorted(l.keys()) == ["bal", "group", "name"] for l in s0.get("ledgers", [])), "a ledger: name, Tally group, balance only")
    ok(all(sorted(z.keys()) == ["amt", "code", "head", "line"] for z in s0.get("lines", [])) and all(sorted(c.keys()) == ["code", "label"] for c in s0.get("codes", [])), "lines: head, line, amount, code; codes: code, label")
    wl = [l for l in s0.get("ledgers", []) if l["name"] == "Willow Labs"]
    ok(wl and wl[0]["bal"] == 90000 and wl[0]["group"] == "Sundry Debtors", "Willow Labs: its group and its balance as at 31-Mar-2026: %s" % wl)
    ok(any(z["line"] == "Loans and advances to related parties" and z["amt"] == 90000 for z in s0.get("lines", [])), "the audited balance sheet's note lines with their amounts")
    blob = json.dumps(s0)
    ok(not any(x in blob for x in ["Larkspur", "AABCL1234F", "29AABCL1234F1Z5", "Made-up & Associates", "Purchase of", "Movements (fixture)", "Bengaluru"]), "nothing else about the client (name, PAN, GSTIN, entries, the firm)")
    ok(not any(l["name"].startswith("Profit and loss: balance brought forward") or l["name"].startswith("Closing stock") for l in s0.get("ledgers", [])), "FinCom's own lines are not sent as ledgers")
    n_sent = len(s0.get("ledgers", []))

    print("\nThe review")
    R = A + " [data-fin-aireview]"
    row = lambda l: pg.locator(R + ' tr[data-fin-airow="%s"]' % l)
    cell = lambda l, k: row(l).locator('[data-c="%s"]' % k).inner_text().strip()
    ok(row("Willow Labs").count() == 1 and cell("Willow Labs", "now").startswith("10A") and cell("Willow Labs", "ai").startswith("12H") and "related party" in cell("Willow Labs", "why") and cell("Willow Labs", "tie").split("\n")[0] == "Ties" and "Short-term loans and advances" in cell("Willow Labs", "tie"),
       "Willow Labs: 10A now, AI 12H with its reason, its head ties (%s | %s | %s)" % tuple(cell("Willow Labs", k).replace("\n", " / ") for k in ("now", "ai", "tie")))
    ok("Gap" in cell("Juniper Travels", "tie") and "(12,000.00)" in cell("Juniper Travels", "tie"), "the wrong code: its head shows the gap (%s)" % cell("Juniper Travels", "tie"))
    hd = lambda i: pg.locator(R + ' tr[data-fin-aihead="%s"]' % i)
    ok(hd("tpm").get_attribute("data-v") == "-12000" and hd("tpo").get_attribute("data-v") == "12000" and hd("tr").get_attribute("data-v") == "0" and hd("stla").get_attribute("data-v") == "0",
       "heads: micro enterprises (12,000), others 12,000, receivables and loans tie (%s)" % [hd(i).get_attribute("data-v") for i in ("tpm", "tpo", "tr", "stla")])
    ok("by hand" in cell("Advance to Staff", "now") and row("Advance to Staff").get_attribute("data-hand") == "1", "the hand choice is shown as one the AI would change: " + cell("Advance to Staff", "now"))
    summ = pg.inner_text(R + " [data-fin-aisum]")
    ok("₹3.62" in summ and ("%d ledgers" % n_sent) in summ and "2 heads show a gap" in summ, "the summary with the run's cost: " + summ)
    ok("no figure" in pg.inner_text(R).lower(), "says the AI set no figure")
    pg.screenshot(path=os.path.join(SHOTS, "aimap-review-light.png"), full_page=True)

    print("\nAccept tied heads only")
    pg.click(R + " [data-fin-aiaccept-tied]"); pg.wait_for_timeout(1500)
    m = pg.evaluate("() => { const f = S.books.fs; return {w: f.map['Willow Labs'], a: f.map['Advance to Staff'], j: f.map['Juniper Travels'] || '', b: f.map['Bluebell Print Works'] || '', by: (f.mapBy || {})['Willow Labs'] || null, n: Object.keys(f.map).length}; }")
    ok(m["w"] == "12H" and m["by"] and m["by"]["by"].endswith(", AI-assisted") and m["by"]["at"], "Willow Labs: 12H, a hand choice by \"%s\" on %s" % (m["by"] and m["by"]["by"], m["by"] and m["by"]["at"][:10]))
    ok(m["a"] == "12H" and m["j"] == "" and m["b"] == "", "left: the hand choice (12H), and the ledgers of the heads with a gap")
    ok(row("Willow Labs").get_attribute("data-state") == "accepted" and row("Juniper Travels").get_attribute("data-state") == "open" and row("Advance to Staff").get_attribute("data-state") == "open", "the rows' states")
    pg.click(R + ' tr[data-fin-airow="Juniper Travels"] [data-fin-aireject]'); pg.wait_for_timeout(900)
    for l in ("Bluebell Print Works", "Cedar Cloud Hosting LLP", "Advance to Staff"):
        pg.click(R + ' tr[data-fin-airow="%s"] [data-fin-aiaccept]' % l); pg.wait_for_timeout(900)
    m = pg.evaluate("() => { const f = S.books.fs; return [f.map['Advance to Staff'], f.map['Juniper Travels'] || '', f.map['Bluebell Print Works']]; }")
    ok(m == ["12G", "", "6A"], "one by one: the hand choice changed only when accepted, the wrong one rejected (%s)" % m)
    ok(pg.locator(R + " tr[data-fin-aihead]").evaluate_all("xs => xs.every(x => x.dataset.v === '0')"), "every head of the AI's check ties")
    st = pg.inner_text("#app [data-fin-recon-state]")
    ok("Every head agrees" in st, "the matching table: " + st)
    ok(pg.locator("#app [data-fin-prop]").count() == 0, "no mapping change left to propose")
    pg.evaluate("() => document.querySelector('#app [data-fin-aimap]').scrollIntoView()"); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTS, "aimap-accepted-light.png"))
    tab(pg, "tb")
    tr = pg.locator('#app table[data-fin-table="tb"] tr[data-key="Willow Labs"]')
    ok(tr.get_attribute("data-src") == "hand" and "AI-assisted" in tr.inner_text(), "the trial balance: Willow Labs by hand, AI-assisted: " + tr.inner_text().replace("\n", " ")[-80:])

    print("\nNext year: 2026-27")
    pg.evaluate("() => { S.fsFy = '2026'; render(); }"); pg.wait_for_timeout(1500); tab(pg, "tb")
    pg.wait_for_selector("#app [data-fin-ainext]", timeout=20000); pg.wait_for_timeout(500)
    exp = pg.evaluate("() => { const m = S.books.fs.map; const rows = FinSt.tb('2026').rows.filter(r => !r.synthetic); return {n: rows.filter(r => m[r.ledger]).length, all: rows.length}; }")
    bt = pg.inner_text("#app [data-fin-ainext]")
    ok(("%d ledgers mapped as last year; 1 new ledger to map" % exp["n"]) in bt and exp["n"] >= 50, "the banner: " + bt.replace("\n", " "))
    ok("1 kept on the rules" in bt, "the one rejected stays on the rules' codes, said")
    ok(pg.locator("#app [data-fin-airun]").count() == 0, "no second one-time button: the banner instead")
    pg.screenshot(path=os.path.join(SHOTS, "aimap-next-year-banner.png"))
    pg.evaluate(STUB); pg.wait_for_timeout(500)
    pg.click("#app [data-fin-ainext] [data-fin-ainew]"); pg.wait_for_selector("#app [data-fin-ainext] [data-fin-aireview]", timeout=20000); pg.wait_for_timeout(600)
    sent = pg.evaluate("window.__sent")
    ok(len(sent) == 1 and [l["name"] for l in sent[0]["ledgers"]] == ["Cloud Hosting Charges"] and sent[0]["ledgers"][0]["bal"] == 12000 and sent[0]["mode"] == "new", "only the new ledger sent: %s" % (sent and sent[0]["ledgers"]))
    pg.click("#app [data-fin-ainext] [data-fin-aiaccept-all]"); pg.wait_for_timeout(1200)
    bt = pg.inner_text("#app [data-fin-ainext]")
    ok(pg.evaluate("S.books.fs.map['Cloud Hosting Charges']") == "17W" and ("%d ledgers mapped as last year; no new ledger to map" % (exp["n"] + 1)) in bt, "accepted: " + bt.replace("\n", " ")[:160])
    pg.screenshot(path=os.path.join(SHOTS, "aimap-next-year-done.png"), full_page=True)
    ctx.close()

    print("\nDark")
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, color_scheme="dark"); pg = ctx.new_page(); boot(pg)
    pg.evaluate(KEEP, AUD_ROWS); pg.wait_for_timeout(800); tab(pg, "checks"); loaded(pg); pg.evaluate(STUB); pg.wait_for_timeout(400)
    pg.click(A + " [data-fin-airun]"); pg.wait_for_selector(A + " [data-fin-aireview]", timeout=20000); pg.wait_for_timeout(800)
    pg.evaluate("() => document.querySelector('#app [data-fin-aimap]').scrollIntoView()"); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTS, "aimap-review-dark.png"))
    ctx.close()

    print("\nAI off")
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light"); pg = ctx.new_page(); boot(pg)
    pg.evaluate(KEEP, AUD_ROWS); pg.wait_for_timeout(800); tab(pg, "checks"); loaded(pg)
    pg.evaluate("() => { window.__sent = []; FinAiMap.post = async (b) => { window.__sent.push(b); return {ok: true, proposals: []}; }; render(); }"); pg.wait_for_timeout(400)
    off = pg.locator(A + " [data-fin-airun]")
    ok(off.is_disabled() and "Settings › AI help" in pg.inner_text(A + " [data-fin-aioff]"), "AI off: the button says how to switch it on: " + pg.inner_text(A + " [data-fin-aioff]"))
    off.click(force=True); pg.wait_for_timeout(500)
    ok(pg.evaluate("window.__sent.length") == 0 and pg.locator(A + " [data-fin-aireview]").count() == 0, "nothing sent")
    pg.screenshot(path=os.path.join(SHOTS, "aimap-ai-off.png"))
    pg.evaluate("() => { S.fsFy = '2026'; render(); }"); pg.wait_for_timeout(1500); tab(pg, "tb"); pg.wait_for_selector("#app [data-fin-pybs] [data-fin-aimap]", timeout=20000)
    ok("Settings › AI help" in pg.inner_text("#app [data-fin-pybs] [data-fin-aimap]"), "the trial balance tab (last year's balance sheet uploaded): the same words")
    whys = pg.locator("#app [data-fin-why]").evaluate_all("xs => xs.map(x => x.textContent)")
    ok(any("from last year's balance sheet" in w for w in whys) and pg.locator('#app tr[data-src="suggested"]').count() > 30, "the rules' and last year's codes still stand (%d suggested)" % pg.locator('#app tr[data-src="suggested"]').count())
    ctx.close()

    print("\nPhone")
    ph = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True); pp = ph.new_page(); boot(pp)
    pp.evaluate(KEEP, AUD_ROWS); pp.wait_for_timeout(800); pp.evaluate("() => { S.fin.tab = 'checks'; render(); }"); pp.wait_for_timeout(1200); loaded(pp); pp.evaluate(STUB); pp.wait_for_timeout(400)
    pp.click(A + " [data-fin-airun]"); pp.wait_for_selector(A + " [data-fin-aireview]", timeout=20000); pp.wait_for_timeout(800)
    w = pp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    ok(w <= 1, "a phone: no sideways scroll (%d)" % w)
    pp.evaluate("() => document.querySelector('#app [data-fin-aireview]').scrollIntoView()"); pp.wait_for_timeout(300)
    pp.screenshot(path=os.path.join(SHOTS, "aimap-phone.png"))
    ph.close(); br.close()
errs = [e for e in errors if "supabase" not in e.lower() and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
