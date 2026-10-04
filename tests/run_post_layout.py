"""python3 run_post_layout.py - the Post to Tally page's one layout (the owner's spec of 04-Oct-2026, items A, B, C, E, G), on
the staging-shaped rows of run_post_rows_fix.py and a few more postings for the statuses those rows do not have (2 matched
with Tally, 4 waiting in the queue, 5 posting now, 7 Tally refused it, 8 stopped before sending) and a posted bank line.
  A. every entry, in every tab: line 1 status · bill no. · party · amount (Indian format, two decimals, right-aligned) ·
     bill date (dd-Mon-yyyy) · voucher type, in that order; line 2 "Posted to Tally on <dd-Mon-yyyy HH:MM IST> by <name> ·
     company <name> · Tally id <N> · voucher date in Tally <date>" (or "in batch ending Tally id <N>"); line 3 only when
     not posted: reason · what to do · the button; never FinCom's internal id in place of the bill no. and party;
  B. Tally's reply in one sentence on line 2, never the counts; Tally's words behind "Show Tally's reply";
  C. each of the ten statuses on the page with its words, in its tab (Posted 1,2,3,10; To post 4,5; Errors 6,7,8,9), and
     the tab counts are the rows each tab shows;
  E. "Mark posted" takes Tally's id: digits only (refused otherwise, the box says so); one the same as the bill number is
     warned about and asked again, not refused; the posted mark is undone only from a row's More menu, by an owner;
  G. search on Posted by bill no., party, amount and Tally id; each row links to its bill and its PDF; a bank line has the
     same layout.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_layout.py"""
import os, re, json, copy
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
os.environ["PORT"] = os.environ.get("LAYOUT_PORT", "8292")
from playwright.sync_api import sync_playwright
import run_post_rows_fix as rf
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FX = copy.deepcopy(rf.FX)
G = rf.G
def jb(id_, status, entry, results, items, message, extra=None):
    o = {"id": id_, "client_id": "cmufksrrqjub2g", "company": G, "status": status, "n": 1, "done": 0, "message": message, "created_at": "2026-10-04T17:00:00+00:00", "updated_at": "2026-10-04T17:00:05+00:00",
         "entry_ids": [entry], "results": results, "items": items, "created_by": rf.OWNER, "dismissed_at": None, "dismiss_auto": False}
    o.update(extra or {}); return o
U = lambda n: "%08d-1111-4111-8111-000000000000" % n
FX["jobs"] += [
    jb(U(4), "waiting", "lw1", [], [{"id": "lw1", "state": "waiting"}], "Waiting for Tally: TallyPrime is not open — open TallyPrime with GARG SHEKHAR & COMPANY; it will be posted automatically"),
    jb(U(5), "running", "lr1", [], [{"id": "lr1", "state": "sending"}], "Sending 1 of 1 to Tally"),
    jb(U(7), "done", "lf1", [{"id": "lf1", "ok": False, "message": "Ledger 'Professional Fees GST' does not exist"}], [{"id": "lf1", "state": "failed", "reason": "Ledger 'Professional Fees GST' does not exist"}], "Posted 0 of 1"),
    jb(U(8), "failed", "ls1", [{"id": "ls1", "ok": False, "message": "This computer posts only to ZZ TEST (PostOnly); posting to GARG SHEKHAR & COMPANY refused"}], [{"id": "ls1", "state": "failed"}], "Failed"),
    jb(U(2), "done", "lm1", [dict(rf.reply("lm1", "26309", "20261002"), sentAt="2026-10-04T22:00:00+05:30")], [{"id": "lm1", "state": "posted"}], "Posted 1 of 1 (Tally's reply)"),
    jb(U(11), "done", "st9-3", [dict(rf.reply("st9-3", "26310", "20261002"), vchType="Payment", sentAt="2026-10-04T22:05:00+05:30")], [{"id": "st9-3", "state": "posted"}], "Posted 1 of 1 (Tally's reply)")]
FX["ids"] += [{"job_id": U(2), "fincom_id": "lm1", "entry_id": "lm1", "live": True, "accepted_at": "2026-10-04 17:00:05", "accepted_vch": "26309", "reply_vch": "26309", "batch_end": "26309", "batch_n": 1,
               "matched_at": "2026-10-04T17:30:00Z", "matched_vch": "26309", "released_at": None},
              {"job_id": U(7), "fincom_id": "lf1", "entry_id": "lf1", "live": False, "released_at": "2026-10-04 17:00:06", "released_why": "refused"},
              {"job_id": U(8), "fincom_id": "ls1", "entry_id": "ls1", "live": False, "released_at": "2026-10-04 17:00:06", "released_why": "failed"}]
FX["bills"] += [rf.bill("lw1", "AB/101", "ALPHA TRADERS", "2026-09-10", 125000), rf.bill("lr1", "AB/102", "ALPHA TRADERS", "2026-09-11", 2500.5),
                rf.bill("lf1", "BX-7", "BETA SERVICES", "2026-09-12", 11800), rf.bill("ls1", "CX-9", "GAMMA LLP", "2026-09-13", 5900),
                rf.bill("lm1", "DX-1", "DELTA & SONS", "2026-10-02", 7080, "2026-10-04T22:00:00+05:30", {"at": "2026-10-04T22:00:00+05:30", "by": "Anshul garg", "vch": "26309", "company": G, "vchDate": "20261002"}, None, rf.P + "lm1.pdf", "DX-1.pdf", {"postByReply": True})]
rf.serve(int(os.environ["PORT"]))
L2 = re.compile(r"^(Posted|Sent) to Tally on \d\d-[A-Z][a-z]{2}-\d{4} \d\d:\d\d IST by [^·]+ · company [^·]+( · (Tally id \d+|in batch ending Tally id \d+))?( · voucher date in Tally \d\d-[A-Z][a-z]{2}-\d{4})?$")
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%s/" % os.environ["PORT"]); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    E(rf.FIXTURE, FX); pg.wait_for_timeout(1500)
    # a statement open here with the line the posting U(11) put in Tally
    E("""() => { const b = S.bank; if (b){ b.cid = S.coId; b.loading = false; b.rows = (b.rows || []).concat([{id: "st9-3", date: "2026-10-02", narr: "NEFT TO ZETA SUPPLIES LTD / UTR N12345", debit: 18500, credit: 0, state: "sent", ledger: "Zeta Supplies Ltd", dec: {name: "ZETA SUPPLIES LTD", utr: "N12345"}}]); }
      CloudJobs.load(true); }"""); pg.wait_for_timeout(1500)
    E("() => { render(); }"); pg.wait_for_timeout(800)
    txt = lambda sel: " ".join(pg.inner_text(sel).split()) if pg.locator(sel).count() else ""
    def tab(name): pg.click('#app [data-post-tabs] [data-post-tab="%s"]' % name); pg.wait_for_timeout(400)
    def rows(t):
        tab(t)
        return E("""(t) => Array.from(document.querySelectorAll('#app [data-post-panel="' + t + '"] [data-entry-row]')).map(r => ({key: r.getAttribute('data-row-key'), code: +r.getAttribute('data-status'),
          l1: Array.from(r.querySelectorAll('[data-pe-line1] > span')).map(s => [Object.keys(s.dataset).find(k => k.startsWith('pe')) || '', s.textContent.trim()]),
          l2: (r.querySelector('[data-pe-when]') || {}).textContent || '', l3: !!r.querySelector('[data-pe-line3]'), text: r.innerText.replace(/\\s+/g, ' ')}))""", t)
    R = {t: rows(t) for t in ("topost", "posted", "errors")}
    codes = {t: sorted(set(x["code"] for x in R[t])) for t in R}
    print("  rows: " + json.dumps({t: [(x["key"].split(":")[-1], x["code"]) for x in R[t]] for t in R}))
    # ---- C: every status on the page, in its tab
    ok(codes["posted"] == [1, 2, 3, 10] and codes["topost"] == [4, 5] and codes["errors"] == [6, 7, 8, 9], "C. statuses by tab: Posted %s, To post %s, Errors %s" % (codes["posted"], codes["topost"], codes["errors"]))
    WORDS = {1: "Posted to Tally", 2: "Posted, matched with Tally", 3: "Posted, marked by you", 4: "Waiting to post", 5: "Posting now", 6: "Needs review", 7: "Not posted: Tally refused it",
             8: "Not posted: stopped before sending", 9: "Cancelled", 10: "Bill deleted in FinCom but entry is in Tally"}
    allr = [x for t in R for x in R[t]]
    for c, w in WORDS.items():
        xs = [x for x in allr if x["code"] == c]
        ok(xs and all(x["l1"][0] == ["peStatus", w] for x in xs), "C. status %d says '%s' first on line 1 (%d rows)" % (c, w, len(xs)))
    keys = [x["key"] for x in allr]
    ok(len(keys) == len(set(keys)) and len(set(k.split(":")[-1] for k in keys)) == len(keys), "C. each entry in exactly one status and one tab (%d rows)" % len(keys))
    # ---- A: line 1, in order, the formats
    order = ["peStatus", "peNo", "peParty", "peAmount", "peDate", "peVtype"]
    full = [x for x in allr if [k for k, _ in x["l1"]] == order]
    miss = [x for x in allr if [k for k, _ in x["l1"]] == ["peStatus", "peMissing"]]
    ok(len(full) + len(miss) == len(allr) and len(miss) == 1 and "zz-test-1" in miss[0]["l1"][1][1] and miss[0]["l1"][1][1].startswith("bill details not found"),
       "A. line 1 is status · bill no. · party · amount · bill date · voucher type on every row; the one without details says 'bill details not found' with its id (%s)" % [x["l1"] for x in allr if x not in full][:2])
    amt_ok = all(re.match(r"^₹(\d{1,2},)*\d{1,3}\.\d\d$", dict(x["l1"])["peAmount"]) for x in full)
    ok(amt_ok and dict(next(x for x in full if x["key"].endswith(":lw1"))["l1"])["peAmount"] == "₹1,25,000.00" and dict(next(x for x in full if x["key"].endswith(":lr1"))["l1"])["peAmount"] == "₹2,500.50",
       "A. amounts in the Indian format with two decimals (₹1,25,000.00, ₹2,500.50)")
    ok(all(re.match(r"^\d\d-[A-Z][a-z]{2}-\d{4}$", dict(x["l1"])["peDate"]) for x in full), "A. bill dates dd-Mon-yyyy")
    al = E("Array.from(document.querySelectorAll('#app [data-pe-amount]')).map(x => getComputedStyle(x).textAlign)")
    ok(al and set(al) == {"right"}, "A. amounts right-aligned (%s)" % set(al))
    ok(not [x for x in full if x["key"].split(":")[-1] in dict(x["l1"])["peNo"] + dict(x["l1"])["peParty"]], "A. never FinCom's internal id in place of the bill no. and party")
    # line 2 and line 3
    posted = [x for x in allr if x["code"] in (1, 2, 3, 10)]
    bad2 = [x["l2"] for x in posted if not (L2.match(x["l2"].strip()) and x["l2"].startswith("Posted to Tally on "))]
    ok(posted and not bad2, "A. line 2 of every posted row: 'Posted to Tally on dd-Mon-yyyy HH:MM IST by <name> · company <name> · Tally id <N> · voucher date in Tally <date>' (%s)" % bad2[:2])
    ok(all(not x["l3"] for x in posted) and all(x["l3"] for x in allr if x["code"] not in (1, 2, 3, 10)), "A. line 3 only when not posted")
    x3829 = next(x for x in posted if x["key"].endswith(":emutzp8x6z64zl"))
    ok("This entry is in FY 2023-24 in Tally; change the period in Tally to see it." in x3829["text"], "A. the FY sentence when the voucher date is outside this year")
    # ---- B: Tally's reply, one sentence
    sent = E("Array.from(document.querySelectorAll('#app [data-post-reply]')).map(x => x.textContent.trim())")
    tab("posted"); sent = E("Array.from(document.querySelectorAll('#app [data-post-panel=\"posted\"] [data-post-reply]')).map(x => x.textContent.trim())")
    okw = {"Tally accepted it.", "Tally updated an existing entry instead of adding a new one.", "Tally ignored it: an entry with the same details already exists.", "Posted before 04-Oct; Tally's reply was not kept.", "Tally's reply was not kept."}
    ok(sent and all(s in okw or s.startswith("Tally refused it: ") for s in sent) and not any(re.search(r"created \d|altered \d|exceptions \d|ignored \d", t) for t in [txt('#app [data-post-panel="posted"]')]),
       "B. Tally's reply in one sentence on every posted row, no counts on the page (%s)" % sorted(set(sent)))
    R3829 = '#app [data-post-panel="posted"] [data-row-key$=":emutzp8x6z64zl"]'
    pg.click(R3829 + " [data-show-reply]"); pg.wait_for_timeout(300)
    ok("CREATED 1" in txt(R3829 + " [data-reply-raw]") and "LASTVCHID 26307" in txt(R3829 + " [data-reply-raw]"), "B. 'Show Tally's reply' opens Tally's own counts (%s)" % txt(R3829 + " [data-reply-raw]"))
    # ---- C on screen, the buttons: 4 Cancel, 7 Post again, 8 Post again, 6 the owner's two
    tab("topost"); W = '#app [data-post-panel="topost"] [data-row-key$=":lw1"]'
    ok("Number 1 in the queue" in txt(W) and "TallyPrime is not open" in txt(W) and pg.locator(W + " [data-cancel-post]").count() == 1, "C4. waiting: its place in the queue, why, and Cancel (%s)" % txt(W)[:200])
    E("() => { window.__rpc = []; }"); pg.click(W + " [data-cancel-post]"); pg.wait_for_timeout(600)
    ok([c for c in E("window.__rpc") if c[0] == "tally_post_cancel"] == [["tally_post_cancel", {"p_id": U(4)}]], "C4. Cancel -> tally_post_cancel(the posting)")
    ok("Tally is taking it now" in txt('#app [data-post-panel="topost"] [data-row-key$=":lr1"]'), "C5. posting now: 'Tally is taking it now'")
    tab("errors")
    F7, F8 = '#app [data-post-panel="errors"] [data-row-key$=":lf1"]', '#app [data-post-panel="errors"] [data-row-key$=":ls1"]'
    ok("The ledger “Professional Fees GST” is not in Tally" in txt(F7) and "Create the ledger" in txt(F7) and pg.locator(F7 + " [data-post-again]").count() == 1, "C7. Tally refused it: the reason, the fix, Post again (%s)" % txt(F7)[:220])
    ok("This computer may not post to that company" in txt(F8) and pg.locator(F8 + " [data-retry]").count() == 1, "C8. stopped before sending: the reason (PostOnly) and Post again (%s)" % txt(F8)[:220])
    # ---- E: Mark posted takes Tally's id
    B62 = '#app [data-post-panel="errors"] [data-bill-row="emusi5455der9b"]'
    E("() => { window.__rpc = []; }"); pg.click(B62 + " [data-mark-posted]"); pg.wait_for_timeout(400)
    pg.fill("#confirmBox input#markVch", "V-26300"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok("digits only" in txt("#confirmBox .cbx-err") and not [c for c in E("window.__rpc") if c[0] == "tally_post_job_mark_posted"], "E. Tally id not digits: refused, the box says 'digits only' (%s)" % txt("#confirmBox .cbx-err"))
    pg.fill("#confirmBox input#markVch", "2024-25/165"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox .cbx-err").count() == 1, "E. the bill number (not digits) is refused the same way")
    pg.click('#confirmBox [data-cbx="no"]'); pg.wait_for_timeout(300)
    F4861 = '#app [data-post-panel="posted"] [data-row-key$=":emuslylailsdrr"]'
    tab("posted"); pg.click(F4861 + " .acts [data-correct-id]"); pg.wait_for_timeout(400)
    pg.fill("#confirmBox input#markVch", "4861"); pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(600)
    warn = txt("#confirmBox")
    ok("The Tally id is the same as the bill number" in warn and "You typed 4861, which is the bill number" in warn and not [c for c in E("window.__rpc") if c[0] == "tally_post_job_mark_posted"],
       "E. the same as the bill number: warned and asked again, nothing sent yet (%s)" % warn[:200])
    pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(700)
    ok([c[1]["p_vch"] for c in E("window.__rpc") if c[0] == "tally_post_job_mark_posted"] == ["4861"], "E. a warning, not a block: 'Use 4861 anyway' sends it")
    # More menu: owner only
    ok(pg.locator('#app [data-post-panel="posted"] [data-row-more] [data-release-owner]').count() >= 1 and pg.locator('#app [data-post-panel="posted"] .acts [data-release-owner]').count() == 0, "E. the undo of the posted mark is under More, not a row button")
    E("() => { S.account = {me: {role: 'staff', user_id: '871ad9b4-dec0-47ab-a22f-9184aa7e5694'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(400); tab("posted")
    ok(pg.locator('#app [data-post-panel="posted"] [data-row-more]').count() == 0 and pg.locator('#app [data-post-panel="posted"] [data-correct-id]').count() == 0, "E. a staff member: no More menu, no correction")
    E("() => { S.account = {me: {role: 'owner', user_id: window.__fx.OWNER, name: 'Anshul garg'}, firm: {name: 'Firm'}}; render(); }"); pg.wait_for_timeout(400)
    # ---- G: search on Posted, links, a bank line
    tab("posted"); SB = '#app [data-post-panel="posted"] [data-posted-search]'
    shown = lambda: E("Array.from(document.querySelectorAll('#app [data-post-panel=\"posted\"] [data-entry-row]')).map(r => r.getAttribute('data-row-key').split(':').pop())")
    for q, want in (("3829", ["emutzp8x6z64zl"]), ("jitin", None), ("26307", ["emutzp8x6z64zl"]), ("7,080", ["lm1"]), ("7080", ["lm1"]), ("zeta", ["st9-3"])):
        pg.fill(SB, q); pg.wait_for_timeout(300); got = shown()
        ok((got == want) if want else (got and all("JITIN" in txt('#app [data-post-panel="posted"] [data-row-key$=":%s"]' % k) for k in got) and len(got) >= 4), "G. search '%s' -> %s" % (q, got))
    pg.fill(SB, ""); pg.wait_for_timeout(300)
    BK = '#app [data-post-panel="posted"] [data-row-key$=":st9-3"]'
    l1 = E("Array.from(document.querySelectorAll('%s [data-pe-line1] > span')).map(s => s.textContent.trim())" % BK.replace("'", "\\'"))
    ok(l1 == ["Posted to Tally", "N12345", "ZETA SUPPLIES LTD", "₹18,500.00", "02-Oct-2026", "Payment"] and pg.locator(BK + " [data-open-bill]").count() == 1, "G. a bank line in the same layout (%s)" % l1)
    RLM = '#app [data-post-panel="posted"] [data-row-key$=":lm1"]'
    E("() => { window.__docs = []; window.txnOpenDoc = (k, p, n) => window.__docs.push([k, p, n]); }")
    pg.click(RLM + " [data-open-pdf]"); pg.wait_for_timeout(200)
    ok(E("window.__docs") == [["lm1", rf.P + "lm1.pdf", "DX-1.pdf"]], "G. each row links to its PDF (%s)" % E("window.__docs"))
    pg.click(RLM + " [data-open-bill]"); pg.wait_for_timeout(500)
    ok(E("S.selected") == "lm1" and E("S.tab") == "invoices", "G. and to its bill (%s, %s)" % (E("S.selected"), E("S.tab")))
    E("() => { goStep('post', 'bills'); }"); pg.wait_for_timeout(500)
    # ---- the tab counts are the rows each tab shows
    cnt = lambda t: int(re.findall(r"\d+", txt('#app [data-post-tabs] [data-post-tab="%s"] [data-tab-n]' % t))[0])
    ok(cnt("posted") == len(rows("posted")) and cnt("errors") == len(rows("errors")), "C. the tab counts are the rows shown (Posted %d, Errors %d)" % (cnt("posted"), cnt("errors")))
    # ---- phone width: no sideways scroll
    pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(400); tab("posted")
    ok(E("document.documentElement.scrollWidth <= window.innerWidth + 1"), "A. at phone width the page does not scroll sideways (%s > %s)" % (E("document.documentElement.scrollWidth"), E("window.innerWidth")))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
