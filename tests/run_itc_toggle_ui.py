"""python3 run_itc_toggle_ui.py - Eligible / Ineligible ITC set by hand is what every screen shows, and stays (next-fix-toggles,
27-Oct-2026; the owner: "when I click ineligible ITC to eligible ITC, it did not convert into that").
The made-up books of itc_books.py (registration 09, April 2026): Kappa K/1 (tax 360) is marked ineligible, section 17(5),
in Tally; Beta B/7 (tax 3,600) is eligible.
  1. Input register, Kappa: Ineligible 17(5) -> Eligible. The bill's Eligible column says Eligible (Tally's 17(5) kept as a
     note, the automatic suggestion); its kind chip counts it as Eligible, not "Not to be taken"; GSTR-3B 4(B)(1) is 360 less
     and 4(C) 360 more, on the GSTR-3B screen itself; the register's tie-out reads the same 3B figure; the 2B line says
     Eligible; the month's reversal (what GSTR-9 7E and the 3B workbook read) is 360 less.
  2. After a reload: all of it still so.
  3. Back to Ineligible 17(5): as at the start.
  4. The other way, Beta: Eligible -> Ineligible 17(5) on the 2B reconciliation: the input register says Not to be taken,
     4(B)(1) is 3,600 more and 4(C) 3,600 less; after a reload the same; back to Eligible: as at the start.
Screenshots of Kappa's row before and after the change to TOGGLE_SHOTS (default tests/out/toggle-shots), named with
SHOT_TAG (default "run")."""
import os, sys, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import itc_books as IB
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("ITC_TOGGLE_PORT") or 8463)
SHOTS = os.environ.get("TOGGLE_SHOTS") or os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "toggle-shots")
TAG = os.environ.get("SHOT_TAG", "run")
os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
H = ["igst", "cgst", "sgst", "cess"]
def W(pg, ms=500): pg.wait_for_timeout(ms)
money = lambda s: float(re.sub(r"[₹,\s]", "", s) or 0)

def screen3b(pg):
    """4(B)(1) and 4(C) as the GSTR-3B screen shows them (CGST + SGST), and the month's reversal as worked out"""
    IB.open_part(pg, "r3b"); pg.evaluate("() => { S.gstSub = 'details'; render(); }"); W(pg, 700)
    rows = pg.evaluate("""() => Object.fromEntries([...document.querySelectorAll('#app table[data-statement] tr')].map(tr => [...tr.cells].map(c => c.innerText.trim()))
      .filter(c => /^\\((B)\\)\\(1\\)|^\\(C\\) Net ITC/.test(c[0] || '')).map(c => [c[0].startsWith('(B)') ? '4B1' : '4C', c.slice(1)]))""")
    tot = lambda k: round(sum(money(x) for x in (rows.get(k) or [])[-3:]), 2)   # IGST, CGST, SGST
    rev = pg.evaluate("() => { const t = GSTR.threeB('202604', '09'); return ['igst', 'cgst', 'sgst', 'cess'].reduce((a, k) => a + num(t.reversal[k]), 0); }")
    return {"4B1": tot("4B1"), "4C": tot("4C"), "reversal": round(rev, 2)}

def register(pg, bill):
    """the input register: the bill's Eligible? choice, its Eligible column's words, the kind chips, the tie-out's 3B figure"""
    IB.open_part(pg, "inreg"); W(pg, 400)
    return pg.evaluate("""(id) => {
      const s = document.querySelector('select[data-ir-elig="' + id + '"]'), td = s ? s.closest('td') : null;
      const note = td ? [...td.querySelectorAll('.nr')].map(n => n.innerText.trim()).join(' ') : '';
      const chips = Object.fromEntries([...document.querySelectorAll('#app .gf-chips .gf-chip')].map(b => { const m = b.innerText.match(/^(.*?)\\s+(\\d+)\\s+·/); return m ? [m[1], +m[2]] : [b.innerText, 0]; }));
      const tie = ([...document.querySelectorAll('#app p.note')].find(p => /3B table 4/.test(p.innerText)) || {}).innerText || '';
      const m = tie.match(/3B table 4 ₹([\\d,.]+)/);
      return {el: s ? s.value : null, note, chips, tie3b: m ? Number(m[1].replace(/,/g, '')) : null}; }""", bill)

def reco_el(pg, no):
    IB.open_part(pg, "r2b"); W(pg, 400)
    return pg.evaluate("(no) => { const r = [...document.querySelectorAll('tr[data-ic-row]')].find(tr => [...tr.querySelectorAll('.code')].some(c => c.textContent.trim() === no)); const s = r && r.querySelector('select[data-ic-elig]'); return s ? s.value : null; }", no)

def reload(pg):
    pg.reload(); W(pg, 2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); W(pg, 1000)
    if pg.locator("button:has-text('Later')").count(): pg.click("button:has-text('Later')"); W(pg, 300)

def row_shot(pg, bill, name):
    IB.open_part(pg, "inreg"); W(pg, 400)
    loc = pg.locator('#app tr:has(select[data-ir-elig="%s"])' % bill)
    if loc.count(): loc.first.screenshot(path=os.path.join(SHOTS, "%s-%s.png" % (TAG, name)))
    pg.screenshot(path=os.path.join(SHOTS, "%s-%s-page.png" % (TAG, name)), full_page=True)

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_context(viewport={"width": 1440, "height": 950}).new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    IB.setup(pg, PORT)

    print("0. as the books have it")
    t0, r0 = screen3b(pg), register(pg, "k1")
    print("   3B %s, register %s" % (t0, r0))
    ok(r0["el"] == "ineligible" and "Not to be taken" in r0["note"], "Kappa K/1 (17(5) in Tally): Ineligible 17(5), Not to be taken (%s)" % r0["note"])
    ok(abs(t0["4B1"] - 360) < 0.01 and abs(t0["reversal"] - 360) < 0.01, "GSTR-3B 4(B)(1) 360: Kappa's tax reversed (%s)" % t0)
    ok(r0["tie3b"] is not None and abs(r0["tie3b"] - t0["4C"]) < 0.01, "the register's tie-out reads GSTR-3B's net ITC (%s, 3B %s)" % (r0["tie3b"], t0["4C"]))
    row_shot(pg, "k1", "1-kappa-ineligible")

    print("1. Kappa: Ineligible -> Eligible, on the input register")
    pg.select_option('select[data-ir-elig="k1"]', "eligible"); W(pg, 600)
    row_shot(pg, "k1", "2-kappa-eligible")
    def eligible_now(when):
        t, r = screen3b(pg), register(pg, "k1")
        ok(r["el"] == "eligible", "%s: the choice shows Eligible (%s)" % (when, r["el"]))
        ok("Not to be taken" not in r["note"] and "Eligible" in r["note"], "%s: the bill says Eligible, not Not to be taken (%r)" % (when, r["note"]))
        ok("17(5)" in r["note"], "%s: Tally's 17(5) kept beside it as a note (%r)" % (when, r["note"]))
        ok(r["chips"].get("Eligible", 0) == r0["chips"].get("Eligible", 0) + 1 and r["chips"].get("Not to be taken", 0) == r0["chips"].get("Not to be taken", 0) - 1,
           "%s: the kind chips count it as Eligible (%s, was %s)" % (when, r["chips"], r0["chips"]))
        ok(abs(t["4B1"] - (t0["4B1"] - 360)) < 0.01 and abs(t["4C"] - (t0["4C"] + 360)) < 0.01, "%s: GSTR-3B screen 4(B)(1) - 360, 4(C) + 360 (%s, was %s)" % (when, t, t0))
        ok(abs(t["reversal"] - (t0["reversal"] - 360)) < 0.01, "%s: the month's reversal (GSTR-9 7E, the 3B workbook) - 360 (%s)" % (when, t["reversal"]))
        ok(r["tie3b"] is not None and abs(r["tie3b"] - t["4C"]) < 0.01, "%s: the register's tie-out reads the same 3B (%s, 3B %s)" % (when, r["tie3b"], t["4C"]))
        ok(reco_el(pg, "K/1") == "eligible", "%s: the 2B reconciliation line says Eligible" % when)
    eligible_now("after the change")

    print("2. after a reload")
    reload(pg)
    eligible_now("after a reload")

    print("3. back to Ineligible 17(5)")
    IB.open_part(pg, "inreg"); pg.select_option('select[data-ir-elig="k1"]', "ineligible"); W(pg, 600)
    t3, r3 = screen3b(pg), register(pg, "k1")
    ok(r3["el"] == "ineligible" and "Not to be taken" in r3["note"] and r3["chips"] == r0["chips"], "Kappa back to Ineligible 17(5), Not to be taken (%s)" % r3["note"])
    ok(t3 == t0, "GSTR-3B as at the start (%s)" % t3)
    reload(pg)
    ok(register(pg, "k1")["el"] == "ineligible" and screen3b(pg) == t0, "after a reload: still as the books have it")

    print("4. Beta: Eligible -> Ineligible 17(5), on the 2B reconciliation")
    IB.open_part(pg, "r2b")
    pg.select_option('tr[data-ic-row]:has(.code:text-is("B/7")) select[data-ic-elig]', "ineligible"); W(pg, 600)
    def beta_ineligible(when):
        t, r = screen3b(pg), register(pg, "b1")
        ok(r["el"] == "ineligible" and "Not to be taken" in r["note"], "%s: the input register says Ineligible, Not to be taken (%r)" % (when, r["note"]))
        ok(abs(t["4B1"] - (t0["4B1"] + 3600)) < 0.01 and abs(t["4C"] - (t0["4C"] - 3600)) < 0.01, "%s: GSTR-3B screen 4(B)(1) + 3,600, 4(C) - 3,600 (%s)" % (when, t))
        ok(r["tie3b"] is not None and abs(r["tie3b"] - t["4C"]) < 0.01, "%s: the register's tie-out reads the same 3B (%s)" % (when, r["tie3b"]))
        ok(reco_el(pg, "B/7") == "ineligible", "%s: the 2B line says Ineligible 17(5)" % when)
    beta_ineligible("after the change")
    reload(pg)
    beta_ineligible("after a reload")
    IB.open_part(pg, "r2b")
    pg.select_option('tr[data-ic-row]:has(.code:text-is("B/7")) select[data-ic-elig]', "eligible"); W(pg, 600)
    ok(screen3b(pg) == t0 and register(pg, "b1")["el"] == "eligible", "Beta back to Eligible: GSTR-3B as at the start")
    br.close()
srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
