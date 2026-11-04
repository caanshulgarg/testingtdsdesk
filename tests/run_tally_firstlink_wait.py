"""python3 run_tally_firstlink_wait.py - next-tally-connectfix findings 6 and 7 (04-Nov-2026). On staging a company linked to a
computer whose FinCom Bridge was older than 2.5.3 (or skipped every Tally it saw) read "Coming in now" / "It is coming in by
itself" for 34 hours; a company of this login read "Tally of another user" when this login's own Tally's connection was
off. Signed in to a stand-in of FinCom's cloud with the made-up firm of tally_shapes.py (its company name with a trailing
CR/LF CR/LF too), on the Tally page; the computers' beats made up in the page:
  6. the linked computer's bridge 2.5.1, heard now, skipping every Tally it sees, no ledgers yet: the row says "Waiting for
     FinCom Bridge in the linked Windows login to update to 2.5.3" (not "Coming in now"; no login named on this page), its
     Bring ledgers button is not offered, what to do says the same; 2.5.1 with the company open: nothing said;
     2.5.3 skipping every Tally and the company not open there: "... can't see this Tally";
     2.5.3 seeing its Tally: nothing said (the bar as before); a computer not heard now: nothing said.
  6. the cloud (server/tally-cloud/linknow.js): a beat's company name trimmed of spaces and CR/LF (coTrim); a link's
     Windows user and Tally port from the device's beat (linkPlace).
  7. this login's own beat: tally.ini "cannot write", or its own Tally's ports closed (Tally running): "Your Tally's
     connection is off", not "another Windows login"; another user's ports only: "" (the other-login words stay).
RED on the build before this change: every 6 and 7 page check fails.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_firstlink_wait.py"""
import os, sys, json, threading, functools, http.server, subprocess
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tally_shapes as TS
from run_tally_connect_norekey import open_page, Q, ok, fails, errors
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TALLY_PORT", "9573"))
LINKNOW = os.path.join(HERE, "..", "server", "tally-cloud", "linknow.js")

# one made-up computer, heard now, with a bridge of version v whose beat has ports and open companies; the company linked
# to client cid on it; the client's first sync running with nothing read (S.tcoSync)
SCENE = """(o) => {
  const now = new Date(Date.now() - (o.ageMin || 0) * 60000).toISOString(), id = 'd0000000-0000-4000-8000-00000000c0de', bid = 'go-c0dec0dec0de';
  const beat = { at: now, open: o.open || [], ports: o.ports || [], version: o.v, windowsUser: 'PC-SHARED\\\\userfour', bridgePort: 9104, tallyState: (o.open || []).length ? 'open' : 'closed' };
  const d = { id, firm_id: S.firm.id || '', name: 'PC-SHARED · userfour', version: o.v, revoked: false, last_seen: now, main_bridge: bid,
    info: { beat, user: 'PC-SHARED\\\\userfour', computer: 'PC-SHARED', bridges: { [bid]: { at: now, open: o.open || [], user: 'PC-SHARED\\\\userfour', version: o.v, mode: 'main' } } } };
  TCloud.pane.devices = [].concat((TCloud.pane.devices || []).filter((x) => x.id !== id), [d]);
  if (typeof TLight === 'object' && TLight.st) TLight.st.devs = [].concat((TLight.st.devs || []).filter((x) => x.id !== id), [d]);
  const co = Object.values(S.companies).find((c) => c && !c.deleted && c.id === o.cid);
  const all = [{ company: o.company, device: id, client: o.cid, open: false, reported: true }];
  const w = FCTallySimple.firstLinkWait(o.company, all);
  S.tcoSync = S.tcoSync || {}; S.tcoSync[o.cid] = { cid: o.cid, company: o.company, at: Date.now(), via: 'cloud', err: '', end: 0, late: false, led: null, prog: null, samples: [] };
  return { w };
}"""

def main():
    # the cloud's own rules (plain JS): no browser needed
    js = """import(%s).then((m) => console.log(JSON.stringify({ t: m.coTrim("  MADE-UP BRAND CONNECT PRIVATE LIMITED\\r\\n\\r\\n"), n: m.coTrim(7), long: m.coTrim("x".repeat(300)).length,
      p1: m.linkPlace({ info: { beat: { windowsUser: "PC-X\\\\usera", tallyPort: 9000 }, bridges: { "go-aaaa1111bbbb": { user: "PC-X\\\\userb", tallyPort: 9035, open: ["Made-up Co"] } } } }, "", "made-up  co"),
      p2: m.linkPlace({ info: { beat: { windowsUser: "PC-X\\\\usera", tallyPort: 9000 }, bridges: {} } }, "", "Other"), p3: m.linkPlace(null, "", "x") })))""" % json.dumps(os.path.abspath(LINKNOW))
    out = json.loads(subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, timeout=60).stdout.strip().splitlines()[-1])
    print("== 6. the cloud's rules")
    ok(out["t"] == "MADE-UP BRAND CONNECT PRIVATE LIMITED", "6. a beat's company name trimmed of CR/LF CR/LF (%r)" % out["t"])
    ok(out["n"] == "" and out["long"] == 200, "6. not a string: empty; at most 200 characters")
    ok(out["p1"] == {"user": "PC-X\\userb", "port": 9035}, "6. the link's place: the bridge with the company open (%s)" % out["p1"])
    ok(out["p2"] == {"user": "PC-X\\usera", "port": 9000}, "6. else the device's own beat (%s)" % out["p2"])
    ok(out["p3"] == {"user": "", "port": 0}, "6. nothing known: nothing said (%s)" % out["p3"])

    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])
        ctx, pg = open_page(br, "http://localhost:%d/" % PORT)
        E = lambda js, *a: pg.evaluate(js, *a)
        pg.wait_for_function("() => !!window.FCTallySimple && typeof FCTallySimple.firstLinkWait === 'function'", timeout=60000)
        cid = E("() => Object.values(S.companies).filter((c) => c && !c.deleted)[0].id")
        co = "MADE-UP FIRST LINK PRIVATE LIMITED"
        print("== 6. the first link's ledgers: the true reason")
        SKIP = [{"port": 601, "ok": False, "skipped": True, "error": "Tally of Windows session 0"}, {"port": 9000, "ok": False, "skipped": True, "owner": "unknown"}]
        r = E(SCENE, {"cid": cid, "company": co, "v": "2.5.1", "open": [], "ports": SKIP})
        ok(r["w"] == "Waiting for FinCom Bridge in the linked Windows login to update to 2.5.3", "6. bridge 2.5.1 skipping every Tally: waiting for it to update (%r)" % r["w"])
        r = E(SCENE, {"cid": cid, "company": co, "v": "2.5.1", "open": [co], "ports": [{"port": 9000, "ok": True, "n": 1}]})
        ok(r["w"] == "", "6. bridge 2.5.1 that has the company open: nothing said (it brings ledgers) (%r)" % r["w"])
        r = E(SCENE, {"cid": cid, "company": co, "v": "2.5.3", "open": [], "ports": [{"port": 601, "ok": False, "skipped": True, "error": "Tally of Windows session 0"}, {"port": 9000, "ok": False, "skipped": True}]})
        ok(r["w"] == "FinCom Bridge in the linked Windows login can’t see this Tally", "6. 2.5.3 skipping every Tally: can't see this Tally (%r)" % r["w"])
        r = E(SCENE, {"cid": cid, "company": co, "v": "2.5.3", "open": [co], "ports": [{"port": 9000, "ok": True, "n": 1}]})
        ok(r["w"] == "", "6. 2.5.3 seeing its Tally: nothing said (%r)" % r["w"])
        r = E(SCENE, {"cid": cid, "company": co, "v": "2.5.1", "open": [co], "ports": [], "ageMin": 600})
        ok(r["w"] == "", "6. a computer not heard now: nothing said (%r)" % r["w"])
        # the row on the page: a linked client of the made-up firm, its linked computer's bridge 2.5.1
        row = E("""(o) => { const rows = FCTallySimple.tableRows({}); const r = rows.find((x) => x.kind === 'client' && x.company && x.l && x.l.w !== 'Yes');
          if (!r) return null; return { cid: r.cid, company: r.company }; }""", {})
        if row:
            E(SCENE, {"cid": row["cid"], "company": row["company"], "v": "2.5.1", "open": [], "ports": SKIP})
            E("""(o) => { const k = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
                         [].concat(TCloud.pane.companies || [], (typeof TLight === 'object' && TLight.st && TLight.st.cos) || []).forEach((x) => { if (k(x.company) === k(o.company)) x.device_id = 'd0000000-0000-4000-8000-00000000c0de'; }); }""", row)
            got = E("""(o) => { if (FCTallySimple.forget) FCTallySimple.forget(); const r = FCTallySimple.tableRows({}).find((x) => x.kind === 'client' && x.cid === o.cid); return r ? { n: r.l.note, w: r.l.w, can: r.l.can, todo: r.todo, held: r.l.w === 'Yes' } : null; }""", row)
            if got and got["held"]: ok(True, "6. (the first linked client already has its ledgers: the row check is not asked)")
            else:
                ok(got and "Waiting for FinCom Bridge in the linked Windows login to update to 2.5.3" in (got["n"] + got["todo"]) and "userfour" not in (got["n"] + got["todo"]) and "Coming in now" not in got["n"], "6. the row says the true reason, not Coming in now (%s)" % got)
                ok(got and got["can"] is not True, "6. no Bring ledgers button that cannot work (%s)" % (got and got["can"]))
                ok(got and "coming in by itself" not in got["todo"], "6. what to do is not 'It is coming in by itself' (%s)" % (got and got["todo"]))
        else: ok(False, "6. a linked client's row is on the page")

        print("== 7. this login's Tally's connection is off")
        off = "(beat) => FCTallySimple.ownConnOff({ own: { beat } })"
        ok("connection is off" in E(off, {"tallyIni": [{"path": "C:\\TallyPrime\\tally.ini", "state": "added", "connect": "cannot write"}], "ports": []}), "7. tally.ini cannot write: Your Tally's connection is off")
        ok("connection is off" in E(off, {"tallyWhy": "not answering", "ports": [{"port": 9000, "ok": False, "reason": "closed"}, {"port": 9001, "ok": False, "reason": "another user", "skipped": True}]}),
           "7. its own Tally's ports closed: Your Tally's connection is off")
        ok(E(off, {"tallyWhy": "another user", "ports": [{"port": 9000, "ok": False, "reason": "another user", "skipped": True}]}) == "", "7. another user's ports only: not said (the other-login words stay)")
        ok(E(off, {"tallyWhy": "no Tally running in this login", "ports": [{"port": 9000, "ok": False, "reason": "closed"}]}) == "", "7. no Tally running in this login: not said")
        ok(E(off, {"ports": [{"port": 9000, "ok": True, "reason": "open"}]}) == "", "7. its own Tally answers: not said")
        ok(not errors, "no page errors (%s)" % errors[:3])
        ctx.close(); br.close()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
