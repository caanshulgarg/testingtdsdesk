"""python3 run_tally_split_choice.py - a split Tally company and the client of its name (31-Oct-2026; the owner: "this is
different tally and splitted.. and I need to connect to April 2018 tally only.. I should have option to choose").
A client was in FinCom, not linked, with GSTIN; Tally had a split of its company, "<the same name> 01 Apr 2018",
open. Nothing found the client (the date at the end of the Tally name), and a client
of the same name was made in one click. Made-up firm (run_tally_page_clean.py's stand-in cloud; nothing real is changed):
the client POST (not linked), the split "<POST> 01 Apr 2018" open in Tally, another split "<POST>" seen earlier, OTHER CO.
  1. the Tally page, the split's row: the client picker has POST chosen first (data-tco-pre), Link links THAT split in full
     (one link call); "+ New client with this name" asks first (a separate client), No makes nothing and links nothing
  2. Client setup › Tally, POST not linked: "Choose Tally company…" opens the picker right there; its first group "Named
     like POST" holds both splits, each by its full Tally name; choosing "<POST> 01 Apr 2018" links that one (one call)
  3. POST linked to "<POST> 01 Apr 2018": "Change Tally company…" opens the picker there, the other split offered (not
     the one it has); choosing it links it in one call and lets the first go
  4. the top bar's Tally popover on POST's page (not linked): its company list starts with POST's splits
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_split_choice.py"""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8473 + 1000
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
POST = "Kestrel Advisory Private Limited"
SPLIT, OTHER = POST + " 01 Apr 2018", "OTHER CO"
CLIENTS = [POST, "GB TEXCOAT"]

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    d = T.dev(7, "NWS144", "anshul", tally="open", opened=(SPLIT, "GB TEXCOAT"), version="2.4.7", rec=(SPLIT,))
    def cos(linked_split=False):
        return [{"company": "GB TEXCOAT", "client_id": "NAME:GB TEXCOAT", "device_id": d["id"], "gstin": "", "last_seen": "ago:1"},
                {"company": SPLIT, "client_id": ("NAME:" + POST) if linked_split else None, "device_id": d["id"], "gstin": "", "last_seen": "ago:1"},
                {"company": POST, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:9000"},
                {"company": OTHER, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:600"}]
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(5000)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        links = lambda: [c[1] for c in E("window.__calls") if c[0] == "tally_company_link"]
        nclients = lambda: E("() => Object.values(S.companies).filter(c => c && !c.deleted).length")
        def scene(linked_split=False):
            ids = E(T.SETUP, [[d], cos(linked_split), [], "owner", CLIENTS, True, {}])
            E("""() => { const rpc = TCloud.rpc; TCloud.rpc = async (fn, a) => { const r = await rpc(fn, a);
              if (fn === 'tally_company_link') window.__companies.forEach(c => { if (c.company === a.p_company) c.client_id = a.p_client; }); return r; }; }""")
            E("(id) => { S.companies[id].gstin = '09AAKCP1234F1Z5'; }", ids[POST])   # (the owner's client has a GSTIN; Tally's split shows none)
            pg.wait_for_timeout(1800); return ids
        def setup_page(cid):
            E("(id) => { Promise.resolve((S.coId = id, S.view = 'company')).then(() => { S.step = null; S.tab = 'cotally'; render(); }); }", cid); pg.wait_for_timeout(1500)
        def confirm(yes):
            sel = '#confirmBox [data-cbx="%s"]' % ("yes" if yes else "no")
            pg.wait_for_selector(sel, state="visible", timeout=10000); body = txt("#confirmBox"); pg.click(sel)
            pg.wait_for_selector(sel, state="hidden", timeout=10000); pg.wait_for_timeout(500); return body
        try:
            print("== 1. the Tally page: the split's row offers the client of its name first")
            ids = scene(); cid = ids[POST]
            R = '#app [data-tco-list=firm] [data-tco-row="%s"]' % SPLIT
            ok(n(R) == 1, "the split company is listed by its full name (%s)" % txt("#app [data-tco-list=firm]")[:200])
            pk = R + " select[data-tco-act=pick]"
            ok(n(pk) == 1 and pg.get_attribute(pk, "data-tco-pre") == cid and pg.input_value(pk) == cid, "its picker has %s chosen first (pre %s)" % (POST, pg.get_attribute(pk, "data-tco-pre") if n(pk) else None))
            ok(n(R + " .btn.primary") == 0 or "New client" not in txt(R + " .btn.primary"), "no primary button makes a client")
            n0 = nclients(); E("() => { window.__calls = []; }")
            pg.click(R + " [data-tco-add-new]"); body = confirm(False)
            ok("separate client" in body and POST in body and SPLIT in body, "+ New client with this name asks first, naming the client of that name (%s)" % body[:220])
            ok(nclients() == n0 and links() == [], "No: no client made, nothing linked (%d clients, %s)" % (nclients(), links()))
            pg.click(R + " [data-tco-relink]"); pg.wait_for_timeout(1500)
            ok([x for x in links() if x.get("p_client")] == [{"p_company": SPLIT, "p_client": cid}], "Link: ONE link call, the split by its full name to %s (%s)" % (POST, links()))
            ok(nclients() == n0, "no client made by linking")

            print("== 2. Client setup › Tally, not linked: Choose Tally company… right there")
            ids = scene(); cid = ids[POST]; setup_page(cid)
            one = "#app [data-tally-one]"
            ok(n(one + " [data-tally-one-pick]") == 1 and "Choose Tally company" in txt(one + " [data-tally-one-pick]"), "the line has Choose Tally company… (%s)" % txt(one))
            pg.click(one + " [data-tally-one-pick]"); pg.wait_for_timeout(1500)
            box = '#app [data-tlk-pick-box="%s"]' % cid
            ok(n(box + " [data-tlk-pick]") == 1, "the picker opens on Client setup")
            groups = E("(s) => [...document.querySelectorAll(s + ' optgroup')].map(g => ({l: g.label, v: [...g.querySelectorAll('option')].map(o => o.value)}))", box)
            ok(groups and groups[0]["l"] == "Named like " + POST and sorted(groups[0]["v"]) == sorted([SPLIT, POST]), "first group: both splits of %s, each by its full name (%s)" % (POST, groups))
            ok(any(OTHER in g["v"] for g in groups[1:]), "the other companies after them (%s)" % groups)
            E("() => { window.__calls = []; }")
            pg.select_option(box + " [data-tlk-pick]", SPLIT); pg.click(box + " [data-tlk-go]"); pg.wait_for_timeout(1800)
            ok([x for x in links() if x.get("p_client")] == [{"p_company": SPLIT, "p_client": cid}] and n("#confirmBox [data-cbx=yes]:visible") == 0, "chosen: ONE link call for %s, nothing asked (%s)" % (SPLIT, links()))

            print("== 3. linked: Change Tally company… there, the other split offered")
            ids = scene(linked_split=True); cid = ids[POST]; setup_page(cid)
            ok(SPLIT in txt(one + " [data-tally-one-company]") and n(one + " [data-tally-one-change]") == 1, "the line names the split it has and Change Tally company… (%s)" % txt(one))
            pg.click(one + " [data-tally-one-change]"); pg.wait_for_timeout(1500)
            ok(E("S.view + '|' + S.tab") == "company|cotally" and n(box + " [data-tlk-pick]") == 1, "the picker opens there (not the Tally page)")
            groups = E("(s) => [...document.querySelectorAll(s + ' optgroup')].map(g => ({l: g.label, v: [...g.querySelectorAll('option')].map(o => o.value)}))", box)
            ok(groups and groups[0]["v"] == [POST], "the other split first, not the one it has (%s)" % groups)
            E("() => { window.__calls = []; }")
            pg.select_option(box + " [data-tlk-pick]", POST); pg.click(box + " [data-tlk-go]"); pg.wait_for_timeout(1800)
            lk = links()
            ok([x for x in lk if x.get("p_client")] == [{"p_company": POST, "p_client": cid}] and {"p_company": SPLIT, "p_client": None} in lk, "ONE link call for the other split, the first let go (%s)" % lk)

            print("== 4. the Tally popover on the client's page: its splits first")
            ids = scene(); cid = ids[POST]
            E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", cid); pg.wait_for_timeout(1500)
            if n("[data-tally-icon]"):
                pg.click("[data-tally-icon]"); pg.wait_for_timeout(1500)
                opts = E("() => { const e = document.querySelector('[data-tally-pop-pick]'); return e ? [...e.options].map(o => o.value) : null; }")
                ok(opts and opts[0] in (SPLIT, POST) and opts.index(OTHER) > max(opts.index(SPLIT), opts.index(POST)), "the popover lists %s's splits first (%s)" % (POST, opts))
                pg.keyboard.press("Escape")
            else:
                ok(False, "the top bar's Tally icon is there")
        except Exception as e:
            ok(False, "the steps ran through (%s)" % str(e).split("\n")[0])
        ok(not errors, "no page errors %s" % errors[:2])
        br.close()
    srv.shutdown()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
