"""python3 run_post_retry_words.py - a Retry (or a posting) FinCom's cloud refuses is said in plain words, never a
computer or a Windows user named (review of b3a99b3a8, next-posting-never-stuck). The cloud's refusals of
tally_post_enqueue and tally_post_enqueue_to (migrations 54, 174, 185: "Not queued again for X: <the words of
tally_post_reroute>", "Not posted into X: ...", tally_post_nobody_words, tally_post_own_words) name the computer and the
Windows user ("PC · DOMAIN\\user"). CloudJobs.retry kept them in CloudJobs.refused (the row's data-retry-why) and toasted
them as they came. Now:
  1. each refusal of a Retry, given back or thrown: the toast and the row's data-retry-why carry the plain reason (another
     Tally computer, started on another, the link, nobody may post), never a name;
  2. a refusal with no name in it (another posting holds an entry): as it came;
  3. a new posting the cloud refuses (CloudPost.run): its error carries no name;
  4. Cancel and Dismiss refused: the toast carries no name.
Offline, made-up company, computers and Windows users. Run on the React build:
TDSDESK_SITE=../app/dist-test python3 run_post_retry_words.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
PORT = int(os.environ.get("PW_PORT") or 8951)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test")))
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
CO = "Demo Builders Pvt Ltd"
NAMES = ["PC-DEMO1", "PC-DEMO2", "asha", "ravi", "DEMO\\", "TallyData"]
SETUP = """(co) => {
  const a = newCompany({name: co, gstin: "07AAACD1234E1Z5"}); S.companies[a.id] = a;
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString(), ids = Array.from({length: 3}, (_, i) => "stmdemo1-" + i);
  TLight.st.devs = [{id: "dev-demo", name: "PC-DEMO1 · DEMO\\\\asha", info: {computer: "PC-DEMO1", beat: {at: ago(0.2)}, bridges: {"go-demo11": {at: ago(0.2), computer: "PC-DEMO1", user: "DEMO\\\\asha", tallyState: "open", tally: true, open: [co], version: "2.5.19"}}}}];
  TLight.st.at = Date.now();
  CloudJobs.list = [{id: "11111111-1111-4111-8111-111111111111", client_id: a.id, company: co, status: "failed", n: 3, done: 0, created_at: ago(45), updated_at: ago(3), target_bridge: "go-demo11", taken_by: null,
    message: "Not posted into " + co + ": the FinCom Bridge it was for (PC-DEMO1 · DEMO\\\\asha) is set to Changes only, and no other bridge of the same Windows user on that computer may post.",
    entry_ids: ids, items: ids.map((id) => ({id, kind: "voucher", state: "failed"})), results: []}];
  CloudJobs.at = Date.now(); CloudJobs.load = async () => {};
  TCloud.on = () => true; window.canPostTally = () => true;
  window.__t = []; const t0 = window.toast; window.toast = (m) => { window.__t.push(String(m)); return t0 && t0(m); };
  return openCompany(a.id).then(() => { S.postTabs = {[a.id]: "errors"}; goStep("post", "bills"); render(); return a.id; }); }"""
TXT = "() => document.querySelector('#app').innerText"
W = "PC-DEMO1 \u00b7 DEMO\\asha"
STR54 = lambda tail: "the FinCom Bridge it was for (" + W + ") " + tail + ", and no other bridge of the same Windows user on that computer may post. Ask the firm's owner to switch Changes only off for that bridge (Tally page), then Retry; or post these entries again so FinCom chooses a bridge that may post."
STARTED = "Started on " + W + ", and that FinCom Bridge can no longer post; it is never moved to another bridge (part of it may be in Tally). Make that bridge able to post again (the main bridge again, or Changes only off), or check in Tally by hand: Mark posted what is there, then post the rest again."
NOLINK = "the link of this client no longer says where " + CO + " is kept in Tally (its Tally identity and data folder, read by a FinCom Bridge 2.x), or posting into it is not allowed. Open " + CO + " in Tally on a computer with FinCom Bridge and check the client's link on the Tally page, then Retry."
ELSE, START, LINK, NOBODY = "meant for another Tally computer", "started on another Tally computer", "no longer knows where this company is kept", "Nobody can post into " + CO
CASES = [
    ("54 stranded, Changes only", "Not queued again for " + CO + ": " + STR54("is set to Changes only"), ELSE),
    ("54 stranded, not heard from", "Not queued again for " + CO + ": " + STR54("has not been heard from on its computer for a long time"), ELSE),
    ("54 stranded, only reads Tally", "Not queued again for " + CO + ": " + STR54("only reads Tally now: another bridge of the same Windows user is the main one on its computer"), ELSE),
    ("54 stranded, test mode", "Not queued again for " + CO + ": " + STR54("is in test mode"), ELSE),
    ("54 stranded, no bridge named", "Not queued again for " + CO + ": the computer it was for (PC-DEMO1) has no FinCom Bridge that may post just now (each is set to Changes only or only reads Tally). Ask the firm's owner to make one of its bridges the main one or switch Changes only off for it (Tally page), then Retry; or post these entries again so FinCom chooses a bridge that may post.", ELSE),
    ("174/185 started elsewhere", "Not queued again for " + CO + ": " + STARTED, START),
    ("185 the link", "Not queued again for " + CO + ": " + NOLINK, LINK),
    ("54/185 enqueue with entries, started elsewhere", "Not posted into " + CO + ": " + STARTED, START),
    ("54/185 enqueue with entries, stranded", "Not posted into " + CO + ": " + STR54("is set to Changes only"), ELSE),
    ("54 nobody, Changes only", "Nobody can post into " + CO + " just now: the only computer that has it open (" + W + ") is set to Changes only. Open the company in Tally on a computer that may post (PC-DEMO2 \u00b7 DEMO\\ravi), or ask the owner to switch Changes only off for that bridge.", NOBODY),
    ("54 nobody, two Changes only", "Nobody can post into " + CO + " just now: the only computers that have it open (" + W + ", PC-DEMO2 \u00b7 DEMO\\ravi) are set to Changes only. Open the company in Tally on a computer whose FinCom Bridge may post, or ask the owner to switch Changes only off for that bridge.", NOBODY),
    ("54 nobody, none open", "Nobody can post into " + CO + " just now: no computer has it open in Tally. Open the company in Tally on a computer that may post (PC-DEMO2 \u00b7 DEMO\\ravi), then post again.", NOBODY),
    ("54 own words, not open", "Nobody can post into " + CO + " from your sign-in just now: your FinCom Bridge (" + W + ") does not have " + CO + " open in Tally. Open " + CO + " in Tally there, then post again.", NOBODY),
    ("54 own words, Changes only", "Nobody can post into " + CO + " from your sign-in just now: your FinCom Bridge (" + W + ") has it open but is set to Changes only or only reads Tally. Ask the firm's owner to switch Changes only off for it (Tally page), then post again.", NOBODY),
    ("185 queued for no computer (a data folder)", "Queued: posts by itself when " + CO + " is opened in Tally on PC-DEMO1 (D:\\TallyData\\10001) with FinCom Bridge", ELSE),
]
PLAIN = "Not queued again: the entry B-7 is being posted in another posting; wait for that one to finish (or cancel it)."
named = lambda t: [n for n in NAMES if n in t]

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1366, "height": 768}, device_scale_factor=2)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    pg.evaluate(SETUP, CO); pg.wait_for_timeout(2000); pg.evaluate("render()"); pg.wait_for_timeout(600)
    n = pg.locator("#app [data-retry]").count()
    ok(n >= 1, "the failed posting has Retry (%d)" % n)

    def retry(err, thrown):
        pg.evaluate("([m, thrown]) => { window.__t = []; delete CloudJobs.refused[CloudJobs.list[0].id]; TCloud.rpc = async () => { if (thrown) throw new Error(m); return {ok: false, error: m}; }; render(); }", [err, thrown])
        pg.wait_for_timeout(300)
        pg.locator("#app [data-retry]").first.click(); pg.wait_for_timeout(700); pg.evaluate("render()"); pg.wait_for_timeout(300)
        why = pg.evaluate("() => [...document.querySelectorAll('[data-retry-why]')].map(e => e.innerText).join(' | ')")
        return " | ".join(pg.evaluate("() => window.__t")), why, pg.evaluate("() => CloudJobs.refused[CloudJobs.list[0].id] || ''")

    print("1. a Retry refused by the cloud: plain words, no computer or Windows user")
    for k, (label, err, want) in enumerate(CASES):
        t, why, kept = retry(err, k % 2 == 1)
        ok(want in t and not named(t), label + ": the toast (%s)" % t)
        ok(want in why and not named(why) and not named(kept), label + ": the row's data-retry-why (%s)" % why)
    ok(not named(pg.evaluate(TXT)), "no name anywhere on the page (%s)" % named(pg.evaluate(TXT)))
    pg.screenshot(path=os.environ["TDSDESK_SHOTS"] + "/retry-refused-plain.png") if os.environ.get("TDSDESK_SHOTS") else None

    print("2. a refusal with no name in it: as it came")
    t, why, kept = retry(PLAIN, False)
    ok("the entry B-7 is being posted in another posting" in t and "B-7" in why, "another posting holds an entry: said as it came (%s | %s)" % (t, why))

    print("3. a new posting the cloud refuses: its error names no computer or Windows user")
    for label, err, want in CASES[9:14]:
        e = pg.evaluate("""async (m) => { TCloud.rpc = async () => ({ok: false, error: m}); TCloud.postTargetFor = () => "";
          try { await CloudPost.run(S.coId, {vouchers: [{id: "v-1"}], masters: [], company: "x"}); return "queued?"; } catch (e){ return String((e && e.message) || e); } }""", err)
        ok(want in e and not named(e), label + ": %s" % e)

    print("3b. a posting the cloud fails in those words: each entry's result names no computer, and is read again as the same reason")
    for label, err, want in [CASES[0], CASES[5], CASES[6]]:
        r = pg.evaluate("""async (m) => { TCloud.rpc = async () => ({ok: true}); TCloud.postTargetFor = () => ""; const row0 = CloudPost.row;
          CloudPost.row = async (id) => ({id, status: "failed", done: 0, n: 1, message: m.replace(/^Not queued again for/, "Not posted into"), results: []});
          try { const o = await CloudPost.run(S.coId, {vouchers: [{id: "v-2"}], masters: [], company: "x"}); const w = o.results[0].message; return [w, postReasonFor(w).id]; }
          catch (e){ return [String((e && e.message) || e), ""]; } finally { CloudPost.row = row0; } }""", err)
        ok(want in r[0] and not named(r[0]) and r[1] in ("elsewhere", "startedelsewhere", "nolink"), label + ": %s (%s)" % tuple(r))

    print("4. Cancel and Dismiss refused: no names in the toast")
    for label, js in [("Dismiss", "() => { window.__t = []; TCloud.rpc = async () => ({ok: false, error: %r}); return CloudJobs.dismiss(CloudJobs.list[0], false); }"),
                      ("Dismiss thrown", "() => { window.__t = []; TCloud.rpc = async () => { throw new Error(%r); }; return CloudJobs.dismiss(CloudJobs.list[0], false); }")]:
        pg.evaluate(js % ("Not queued again for " + CO + ": " + STARTED)); pg.wait_for_timeout(300)
        t = " | ".join(pg.evaluate("() => window.__t"))
        ok(t and not named(t), label + ": %s" % t)
    print("5. the Sales page: an invoice whose posting the cloud failed (reroute 174/185) names no computer or Windows user")
    BK = "Builders"   # a computer key named like a word of the client's name
    pg.evaluate("""(bk) => { TLight.st.devs = TLight.st.devs.concat([{id: "dev-bk", name: bk, info: {computer: bk, beat: {at: new Date().toISOString()}, bridges: {}}}]); }""", BK)
    SALES = """async ([n, m]) => { const cid = S.coId; S.tab = "sales"; S.step = null; await loadSales(cid);
      const v = newInvoice({number: n, date: "2026-11-02", customerName: "Kappa Retail", customerGstin: "", pos: "07", taxable: 1000, cgst: 90, sgst: 90, igst: 0, cess: 0, total: 1180, items: []}, "upload");
      SL().list.push(v); mapInvoice(v); v.status = "ready"; v.postJob = "22222222-2222-4222-8222-22222222222" + n.slice(-1);
      const row0 = CloudPost.row; CloudPost.row = async (id) => ({id, status: "failed", done: 0, n: 1, message: m, results: []});
      try { await salesQueuedSync(); } finally { CloudPost.row = row0; }
      SL().filter = "all"; SL().openId = v.id; render(); await new Promise(r => setTimeout(r, 600));
      return [v.postError || "", [...document.querySelectorAll("[data-sales-posterr]")].map(e => e.innerText + " " + (e.title || "")).join(" | "), document.querySelector("#app").innerText]; }"""
    for k, (label, m, want) in enumerate([
        ("185 the link", "Not posted into " + CO + ": " + NOLINK, LINK),
        ("54/185 stranded", "Not posted into " + CO + ": " + STR54("is set to Changes only"), ELSE),
        ("174 held", "Held: " + W + " was posting this and can no longer post (not the main bridge any more, or Changes only); how far it got is not known.", START),
        ("other words naming the computer", "Waiting at PC-DEMO1 for DEMO\\asha to open Tally; then post again.", "then post again"),
        ("a computer key named like the client", "Ledger “" + CO + "” is not in Tally — create it, then post again.", "Ledger “" + CO + "” is not in Tally — create it, then post again.")]):
        pe, shown, page = pg.evaluate(SALES, ["SQ/%d" % k, m])
        ok(want in pe and not named(pe), label + ": the invoice's error (%s)" % pe)
        ok(shown and want in shown and not named(shown) and not named(page), label + ": on the page (%s)" % shown[:300])
    s1 = pg.evaluate("(m) => postCloudSay(m)", "Ask " + BK + " to open " + CO + " in Tally (PC-DEMO1 · DEMO\\asha), then post again.")
    ok(CO in s1 and "then post again" in s1 and not named(s1), "postCloudSay keeps the advice and the client's name, the names left out (%s)" % s1)
    s2 = pg.evaluate("(m) => postWaitMsg({company: %r, status: 'waiting', message: m})" % CO, "Ledger \u201c" + CO + "\u201d is not in Tally \u2014 create it, then post again.")
    ok(s2.startswith("Ledger") and CO in s2, "a posting's own words with a computer key named like the client: kept, not left blank (%r)" % s2)
    if os.environ.get("TDSDESK_SHOTS"): pg.screenshot(path=os.environ["TDSDESK_SHOTS"] + "/sales-posterror-plain.png")
    print("6. computers and Windows users named like accounting words, or like a quoted ledger: Tally's words kept (next-posting-followups)")
    DEVS = """(names) => names.map((n, i) => ({id: "dev-w" + i, name: n + " \u00b7 DEMO\\\\" + n, info: {computer: n, user: "DEMO\\\\" + n.toLowerCase(), bridges: {}}}))"""
    WORDS = ["Sales", "Purchase", "GST", "TDS", "Audit", "Billing", "Accounts", "Output", "Rent", "Kappa"]
    devs = pg.evaluate(DEVS, WORDS)
    for m in ["Voucher type Sales does not exist", "Voucher type Purchase does not exist", "GST ledger not set", "TDS Payable is not a ledger", "Audit trail is on",
              "Billing failed", "Accounts are closed", "Ledger 'Output GST 18%' does not exist", "Ledger \u201cRent Paid\u201d is not in Tally",
              "Ledger \u2018Kappa Retail\u2019 does not exist", "Ledger \"Output IGST\" does not exist"]:
        got = pg.evaluate("([m, d]) => postNameScrub(m, [], d)", [m, devs])
        ok(got == m, "kept as Tally said it: %r (%r)" % (m, got))
    got = pg.evaluate("([m, d]) => postNameScrub(m, [], d)", ["Waiting at Rent for DEMO\\rent; the firm's owner can open Output's Tally", devs])
    ok("Rent" not in got and "Output" not in got and "the Tally computer" in got, "a name not quoted is still left out, an apostrophe is no quote (%r)" % got)
    got = pg.evaluate("([m, d]) => postNameScrub(m, [], d)", ["Ledger 'Output GST 18%' is not in Tally (PC-DEMO1 \u00b7 DEMO\\asha)", devs])
    ok(got == "Ledger 'Output GST 18%' is not in Tally", "the quoted ledger kept, the computer's bracket left out (%r)" % got)
    ok(not errors, "no page errors (%s)" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
