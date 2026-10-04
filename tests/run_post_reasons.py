"""python3 run_post_reasons.py - the Post to Tally page's reasons table and statuses (the owner's spec of 04-Oct-2026, items B,
C and D), on the program's own files (src/js/62-post-reasons.js with 59 and 03), under node: no build, no browser.
  D. one test per reason: a real message of FinCom Bridge (bridge-go/post.go, jobs.go, posting_status.go, config.go,
     allowlist.go, dupcheck.go), tally-ingest (server/tally-cloud/index.ts) or the cloud (migrations 24, 36b) -> the plain
     reason, how to fix it, and whether Post again is safe; a message nobody knows -> "Tally said: <message>", logged once
     (console and the activity log);
     and docs/post-reasons-table.md lists every reason of the table (the owner reviews it there);
  B. Tally's reply in one sentence, never "created 1 · altered 0" and never zeros;
  C. one test per status of postStatus(entry, job, ids, marks): 1 Posted to Tally ... 10 Bill deleted in FinCom but entry
     is in Tally, each with its words, what to do, its button and its tab; every status in exactly one tab.
SRC (default: the repository) is where src/js is read from, so the red run reads the program before the change."""
import os, sys, json, subprocess, shutil, tempfile, re
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("SRC") or os.path.join(HERE, "..")
NODE = shutil.which("node")
if not NODE: print("skipped: no node"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SHIM = r"""
var S = {data: {}, companies: {}, account: null}, logged = [], audited = [];
function num(v){ if (typeof v === "number") return isFinite(v) ? v : 0; const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
function r2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }
const MONTHS3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(d){ const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + "-" + MONTHS3[+m[2] - 1] + "-" + m[1] : String(d || ""); }
function fmtDateTime(d){ return String(d); }
function memberName(u){ return {"u-1": "Anshul garg", "u-2": "Priya"}[u] || (u ? "a member of the firm" : "—"); }
function plainMsg(m){ return String(m || ""); }
function auditEvent(what, detail){ audited.push([what, detail]); }
console.warn = (...a) => logged.push(a.join(" "));
"""
def load(path): return open(os.path.join(SRC, path), encoding="utf-8").read()
TESTS = r"""
const out = {};
const R = (m) => { const r = postReasonFor(m); return r ? {id: r.id, kind: r.kind, again: r.again, reason: r.reason, fix: r.fix} : null; };
// ---- D: real messages, one a reason
out.reasons = {
  ledger: [R("Ledger 'Professional Fees' does not exist"), R("Failed: ledger 'INPUT CGST' is not in Tally — create it, then press Retry in FinCom")],
  vchtype: [R("Voucher type 'Purchase GST' does not exist"), R("Failed: voucher type 'Purchase GST' is not in Tally — create it, then press Retry in FinCom")],
  period: [R("Voucher date is outside the period of the company"), R("Failed: the entry's date is not within the company's books in Tally — correct the date, then press Retry in FinCom")],
  notopen: [R("Waiting for Tally: GARG SHEKHAR & COMPANY is not open — open it in TallyPrime; it will be posted automatically"), R("Tally did not show GARG SHEKHAR & COMPANY for two minutes. Open it in TallyPrime and post again.")],
  wrongco: [R("Testing AAD may post only to GARG SHEKHAR & COMPANY, but its books in FinCom's cloud come from ZZ TEST. Nothing was posted."), R("Tally created it in ZZ TEST instead; an owner marks it posted or releases it")],
  tallydown: [R("Waiting for Tally: TallyPrime is not open — open TallyPrime with GARG SHEKHAR & COMPANY; it will be posted automatically"), R("Tally is not answering on its port: is TallyPrime open, with the company loaded?")],
  busy: [R("Waiting for Tally: another posting to this Tally is going on — this one follows by itself"), R("Some of these entries are already waiting to be posted; wait for that posting to finish.")],
  duplicate: [R("This bill is already being posted to Tally in another posting (its FinCom id is taken); wait for that posting to finish."), R("already sent from this computer on 03-10-2026 (Tally id 1230), job jPV"), R("Already in Tally (voucher no. 61, 01-10-2026)")],
  notapproved: [R("Choose a bill that is ready to post."), R("The entry has no valid date, so it was not sent to Tally."), R("Nothing to post.")],
  postonly: [R("This computer posts only to ZZ TEST (PostOnly); posting to GARG SHEKHAR & COMPANY refused"), R("The request FinComVoucher is not on the bridge's allow-list of requests to Tally (unknown); nothing was sent to Tally"), R("Posting to Tally is switched off in tds-bridge.config.json (AllowImport).")],
  noanswer: [R("Sent to Tally, but no answer came; not sent again by this bridge. Check Tally in FinCom (or the next comparison of the books) settles whether it is there"), R("Failed: not known whether Tally got it — look for it in Tally before posting it again"), R("Checking whether it reached Tally")],
  incomplete: [R("Tally replied 'created', but the entry cannot be found in 'GARG SHEKHAR & COMPANY' or in any other company open in this Tally. It was not marked as posted."), R("Tally replied 'created' (voucher id 26300) in job 38857f25-0150-4f34-941b-0ee6e787db89 but the entry was not found yet in 'GARG SHEKHAR & COMPANY' on 18-01-2026")],
  checkfailed: [R("Could not check Tally, not posted. Try again.")],
  exception: [R("Tally reported an exception. Check the ledger names and the voucher type."), R("Voucher Number 'N/2' already exists!")],
  ignored: [R("Tally ignored it (it may already exist).")],
  restarted: [R("The posting stopped part-way (the computer or the bridge was restarted). Resume to finish it; nothing already in Tally is sent again.")],
  cancelled: [R("Cancelled before the Tally computer took it")],
  notcreated: [R("Tally did not create it.")],
  many: [R("Waiting for Tally: GARG SHEKHAR & COMPANY is open in more than one Tally — close it in all but one, or choose your Tally in FinCom > Settings > Tally Bridge; it will be posted automatically")]
};
const un = R("Kuch aur hua: 0x80004005"); const un2 = R("Kuch aur hua: 0x80004005");
out.unmapped = {r: un, logged: logged.length, audited: audited.length};
out.table = POST_REASONS.map(r => r.id);
// ---- B: Tally's reply in one sentence
out.reply = {
  created: postReplySentence({ok: true, created: 1, altered: 0, ignored: 0, exceptions: 0}, "2026-10-04T15:44:00Z"),
  altered: postReplySentence({ok: true, created: 0, altered: 1, ignored: 0, exceptions: 0}, "2026-10-04T15:44:00Z"),
  ignored: postReplySentence({ok: false, created: 0, altered: 0, ignored: 1, exceptions: 0}, "2026-10-04T15:44:00Z"),
  exceptions: postReplySentence({ok: false, created: 1, exceptions: 1, lineError: "Voucher Number 'N/2' already exists!"}, "2026-10-04T15:44:00Z"),
  old: postReplySentence({ok: true, verified: true, masterId: "26296"}, "2026-10-02T03:54:20Z"),
  oldzeros: postReplySentence({ok: true, verified: true, created: 0, altered: 0, masterId: "26302"}, "2026-10-03T16:59:26Z")
};
// ---- C: the ten statuses
const bill = (id, extra) => Object.assign({id, status: "approved", x: {invoiceNo: "B/" + id, vendorName: "Party " + id, invoiceDate: "2026-07-01", total: 1000}}, extra || {});
const job = (id, status, results, items, extra) => Object.assign({id, client_id: "c1", company: "GARG SHEKHAR & COMPANY", status, created_at: "2026-10-04T10:00:00Z", updated_at: "2026-10-04T10:00:06Z", created_by: "u-1", results, items}, extra || {});
const P = (st) => st ? {code: st.code, words: st.words, todo: st.todo, action: st.action && st.action.kind, label: st.action && st.action.label, tab: st.tab, id: st.id && (st.id.vch || (st.id.batchEnd ? "batch " + st.id.batchEnd : "")), ids: st.id && st.id.ids} : null;
out.status = {
  1: P(postStatus(bill("a"), job("j1", "done", [{id: "a", ok: true, byReply: true, vchId: "26307", created: 1}], [{id: "a", state: "posted"}]), {live: true, accepted_at: "x", reply_vch: "26307"}, [])),
  2: P(postStatus(bill("b"), job("j2", "done", [{id: "b", ok: true, byReply: true, vchId: "26310", created: 1}], [{id: "b", state: "posted"}]), {live: true, matched_at: "2026-10-04T11:00:00Z", matched_vch: "26310"}, [])),
  3: P(postStatus(bill("c"), job("j3", "done", [{id: "c", ok: true, byOwner: true, byOwnerAt: "2026-10-03T16:41:53Z", vchNumber: "26305", lastVchId: "26305"}], [{id: "c", state: "in_tally", byOwner: true}]), {live: true}, [{action: "posted", vch: "26305", by_user: "u-2", at: "2026-10-03T16:41:53Z"}], {me: "u-1"})),
  "3you": P(postStatus(bill("c"), job("j3", "done", [{id: "c", ok: true, byOwner: true}], [{id: "c", state: "in_tally", byOwner: true}]), {live: true}, [{action: "posted", vch: "26305", by_user: "u-1", at: "2026-10-03T16:41:53Z"}], {me: "u-1"})),
  4: P(postStatus(bill("d"), job("j4", "waiting", [], [{id: "d", state: "waiting"}], {message: "Waiting for Tally: TallyPrime is not open — open TallyPrime with GARG SHEKHAR & COMPANY; it will be posted automatically"}), {live: true}, [], {queue: 2})),
  5: P(postStatus(bill("e"), job("j5", "running", [], [{id: "e", state: "sending"}], {message: "Sending 1 of 2 to Tally"}), {live: true}, [])),
  6: P(postStatus(bill("f"), job("j6", "done", [{id: "f", ok: false, accepted: true, lastVchId: "26300", message: "Tally replied 'created' (voucher id 26300) in job j6 but the entry was not found yet in 'GARG SHEKHAR & COMPANY' on 18-01-2026"}], [{id: "f", state: "unknown", reason: "Tally accepted it (voucher id 26300); being checked, not sent again", outcomeUnknown: true}]), {live: true, accepted_at: "x", accepted_vch: "26300"}, [])),
  7: P(postStatus(bill("g"), job("j7", "done", [{id: "g", ok: false, message: "Ledger 'Professional Fees' does not exist"}], [{id: "g", state: "failed", reason: "Ledger 'Professional Fees' does not exist"}]), {live: false, released_at: "x"}, [])),
  "7nosafe": P(postStatus(bill("g2"), job("j7b", "done", [{id: "g2", ok: false, ignored: 1, message: "Tally ignored it (it may already exist)."}], [{id: "g2", state: "failed"}]), {live: false, released_at: "x"}, [])),
  8: P(postStatus(bill("h"), job("j8", "failed", [{id: "h", ok: false, checkFailed: true, message: "Could not check Tally, not posted. Try again."}], [{id: "h", state: "failed"}]), {live: false, released_at: "x"}, [])),
  "8postonly": P(postStatus(bill("h2"), job("j8b", "failed", [{id: "h2", ok: false, message: "This computer posts only to ZZ TEST (PostOnly); posting to GARG SHEKHAR & COMPANY refused"}], []), null, [])),
  9: P(postStatus(bill("i"), job("j9", "cancelled", null, null, {message: "Cancelled before the Tally computer took it", updated_at: "2026-09-30T16:52:46Z"}), null, [])),
  10: P(postStatus(bill("k", {status: "deleted", deleted: {at: "2026-10-03T10:00:00Z", reason: "duplicate"}}), job("j10", "done", [{id: "k", ok: true, verified: true, masterId: "26294"}], null), {live: true}, [])),
  "10missing": P(postStatus({id: "emupeho9q2sijk"}, job("j10b", "done", [{id: "emupeho9q2sijk", ok: true, verified: true, masterId: "26294", vchNumber: "FA/ELEC/013"}], null), {live: true}, [], {id: "emupeho9q2sijk", missing: true})),
  ready: P(postStatus(bill("r"), null, null, [])),
  review: P(postStatus(bill("rv", {status: "draft"}), job("jr", "failed", [{id: "rv", ok: false, message: "Ledger 'X' does not exist"}], []), null, []))
};
// every status in exactly one tab, the tabs of the spec
out.tabs = Object.fromEntries(Object.entries(POST_STATUS).map(([k, v]) => [k, v.tab]));
// the Tally id is Tally's own number, never the bill number (Jitin & Co. 4861: typed 4861, Tally's reply 26301)
const jitin = bill("emuslylailsdrr", {x: {invoiceNo: "4861", vendorName: "JITIN & CO.", invoiceDate: "2026-01-30", total: 30000}});
const jj = job("6b904d32", "done", [{id: "emuslylailsdrr", ok: true, byOwner: true, vchNumber: "4861", lastVchId: "26301", created: 0, altered: 0, message: "Marked posted by the owner on 03-Oct-2026: in Tally as voucher 4861"}], [{id: "emuslylailsdrr", state: "in_tally", byOwner: true}]);
out.jitin = P(postStatus(jitin, jj, {live: true, accepted_vch: "4861"}, [{action: "posted", vch: "4861", by_user: "u-1", at: "2026-10-03T16:41:53Z"}], {me: "u-1"}));
out.jitinFixed = P(postStatus(jitin, jj, {live: true, accepted_vch: "26301"}, [{action: "posted", vch: "4861", by_user: "u-1", at: "2026-10-03T16:41:53Z"}, {action: "posted", vch: "26301", by_user: "u-1", at: "2026-10-04T18:00:00Z", note: "Correction: the Tally id is 26301, not 4861"}], {me: "u-1"}));
out.fy = {old: postFyOf("2023-10-02"), now: postFyNow(Date.parse("2026-10-04T12:00:00Z")), apr: postFyOf("2026-04-01"), mar: postFyOf("2027-03-31")};
console.log(JSON.stringify(out));
"""
d = tempfile.mkdtemp(prefix="p23r-")
try:
    try:
        src = SHIM + "\n" + load("src/js/03-transactions.js") + "\n" + load("src/js/59-post-preview.js") + "\n" + load("src/js/62-post-reasons.js") + "\n" + TESTS
    except FileNotFoundError as e:
        ok(False, "the program has the reasons table and postStatus (src/js/62-post-reasons.js): %s" % e); raise SystemExit(1)
    path = os.path.join(d, "t.js"); open(path, "w").write(src)
    r = subprocess.run([NODE, path], capture_output=True, text=True)
    if r.returncode: ok(False, "the program loads and runs under node: " + r.stderr[-600:]); raise SystemExit(1)
    o = json.loads(r.stdout.strip().splitlines()[-1])
finally:
    shutil.rmtree(d, ignore_errors=True)
# ---- D
WANT = {"ledger": ("refused", True, "ledger", "Create the ledger"), "vchtype": ("refused", True, "voucher type", "Create the voucher type"),
        "period": ("refused", True, "outside the financial year or the period allowed", "open the year"), "notopen": ("stopped", True, "company is not open in Tally", "Open the company"),
        "wrongco": ("stopped", True, "not the one this client posts to", "Client setup"), "tallydown": ("stopped", True, "Tally is not running", "Start TallyPrime"),
        "busy": ("stopped", True, "Another posting is going on", "Wait for that posting"), "duplicate": ("stopped", False, "already posted", "Nothing to post again"),
        "notapproved": ("stopped", False, "not approved, or its details are incomplete", "approve it"), "postonly": ("stopped", True, "This computer may not post to that company", "allows posting"),
        "noanswer": ("review", False, "No answer from Tally", "Day Book"), "incomplete": ("review", False, "reply was incomplete", "Day Book"),
        "checkfailed": ("stopped", True, "could not be checked", "post again"), "exception": ("refused", True, "exception", "Check the ledger names"),
        "ignored": ("refused", False, "same details already exists", "Look for the entry"), "restarted": ("stopped", True, "stopped part-way", "Post again"),
        "cancelled": ("stopped", True, "cancelled", "Post again"), "notcreated": ("refused", True, "did not create", "post again"), "many": ("stopped", True, "more than one Tally", "Close it")}
for k, (kind, again, reason, fix) in WANT.items():
    got = o["reasons"].get(k) or []
    good = got and all(g and g["id"] == k and g["kind"] == kind and g["again"] is again and reason.lower() in g["reason"].lower() and fix.lower() in g["fix"].lower() for g in got)
    ok(good, "D. %-11s %d real message(s) -> '%s' / fix '%s' / post again %s (%s)" % (k, len(got), reason, fix, again, [(g or {}).get("id") for g in got] if not good else (got[0] or {}).get("reason")))
ok(o["reasons"]["ledger"][0]["reason"] == "The ledger “Professional Fees” is not in Tally", "D. the ledger is named in the reason (%s)" % o["reasons"]["ledger"][0]["reason"])
u = o["unmapped"]
ok(u["r"]["id"] == "unmapped" and u["r"]["reason"] == "Tally said: Kuch aur hua: 0x80004005" and u["r"]["again"] is False, "D. unmapped: 'Tally said: <message>', not posted again until read (%s)" % u["r"]["reason"])
ok(u["logged"] == 1 and u["audited"] == 1, "D. unmapped: logged once to the console and once to the activity log, not twice (%s, %s)" % (u["logged"], u["audited"]))
must = {"ledger", "vchtype", "period", "notopen", "wrongco", "tallydown", "busy", "duplicate", "notapproved", "postonly", "noanswer", "incomplete"}
ok(must <= set(o["table"]), "D. the table covers the owner's twelve (%s)" % sorted(must - set(o["table"])))
doc = os.path.join(SRC, "docs", "post-reasons-table.md")
dt = open(doc, encoding="utf-8").read() if os.path.exists(doc) else ""
ok(dt and "| Message seen |" in dt and all(("`" + k + "`") in dt for k in o["table"]), "D. docs/post-reasons-table.md lists every reason of the table (%s)" % [k for k in o["table"] if ("`" + k + "`") not in dt])
# ---- B
rp = o["reply"]
ok(rp["created"] == "Tally accepted it.", "B. created, no errors: 'Tally accepted it.' (%s)" % rp["created"])
ok(rp["altered"] == "Tally updated an existing entry instead of adding a new one.", "B. altered: '%s'" % rp["altered"])
ok(rp["ignored"] == "Tally ignored it: an entry with the same details already exists.", "B. ignored: '%s'" % rp["ignored"])
ok(rp["exceptions"].startswith("Tally refused it: ") and "exception" in rp["exceptions"], "B. exceptions: 'Tally refused it: <reason>.' (%s)" % rp["exceptions"])
ok(rp["old"] == "Posted before 04-Oct; Tally's reply was not kept." and rp["oldzeros"] == rp["old"], "B. no counts kept (before 2.1.8), or only zeros: 'Posted before 04-Oct; Tally's reply was not kept.' (%s | %s)" % (rp["old"], rp["oldzeros"]))
ok(not any(re.search(r"created \d|altered \d|\b0\b", v) for v in rp.values()), "B. never 'created 1 · altered 0', never zeros (%s)" % rp)
# ---- C
S_ = o["status"]
def st(k, code, words, tab, todo_has=(), action=None, tid=None):
    x = S_.get(k)
    good = x and x["code"] == code and x["words"] == words and x["tab"] == tab and all(t in x["todo"] for t in todo_has) and x["action"] == action and (tid is None or x["id"] == tid)
    ok(good, "C. %-9s %d %s -> %s, todo %s, button %s%s (%s)" % (k, code, words, tab, list(todo_has), action, (", Tally id " + tid) if tid else "", x))
st("1", 1, "Posted to Tally", "posted", ("Tally id 26307", "Nothing to do"), None, "26307")
st("2", 2, "Posted, matched with Tally", "posted", ("found it in Tally",), None, "26310")
st("3", 3, "Posted, marked by Priya", "posted", ("Marked posted by Priya", "Tally id typed: 26305"), None, "26305")
st("3you", 3, "Posted, marked by you", "posted", ("Marked posted by you",))
st("4", 4, "Waiting to post", "topost", ("Number 2 in the queue", "TallyPrime is not open"), "cancel")
st("5", 5, "Posting now", "topost", ("Tally is taking it now",))
st("6", 6, "Needs review", "errors", ("Tally id 26300", "Day Book"), "settle")
st("7", 7, "Not posted: Tally refused it", "errors", ("Professional Fees", "Create the ledger"), "postAgain")
st("7nosafe", 7, "Not posted: Tally refused it", "errors", ("same details already exists",), None)
st("8", 8, "Not posted: stopped before sending", "errors", ("could not be checked",), "postAgain")
st("8postonly", 8, "Not posted: stopped before sending", "errors", ("may not post to that company",), "postAgain")
st("9", 9, "Cancelled", "errors", ("Cancelled on", "Cancelled before the Tally computer took it", "posted by Anshul garg"), "postAgain")
st("10", 10, "Bill deleted in FinCom but entry is in Tally", "posted", ("Tally id 26294", "Restore the bill"), "restore", "26294")
st("10missing", 10, "Bill deleted in FinCom but entry is in Tally", "posted", ("no longer in FinCom",), None, "26294")
ok(S_["ready"] is None and S_["review"] is None, "C. a bill ready to post, or sent back to review, has no status on this page (it is To post's Ready table / the review list)")
ok(o["tabs"] == {"1": "posted", "2": "posted", "3": "posted", "10": "posted", "4": "topost", "5": "topost", "6": "errors", "7": "errors", "8": "errors", "9": "errors"}, "C. each status in exactly one tab: Posted 1,2,3,10; To post 4,5; Errors 6,7,8,9 (%s)" % o["tabs"])
j = o["jitin"]
ok(j["code"] == 3 and j["id"] == "26301" and j["action"] == "correctId" and "bill number" in j["todo"], "F. Jitin & Co. 4861: Tally id 26301 (not the bill number 4861), with 'Correct the Tally id' (%s)" % j)
jf = o["jitinFixed"]
ok(jf["code"] == 3 and jf["id"] == "26301" and jf["action"] is None, "F. once the correction is recorded (a mark with 26301): 26301, nothing more to correct (%s)" % jf)
ok(o["fy"] == {"old": "2023-24", "now": "2026-27", "apr": "2026-27", "mar": "2026-27"}, "A. the financial year April to March (%s)" % o["fy"])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
