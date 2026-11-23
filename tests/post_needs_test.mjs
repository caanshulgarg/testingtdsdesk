// node tests/post_needs_test.mjs - entries not in Tally that need a person (next-posting-never-stuck), on the program's own
// files under node: src/js/62-post-reasons.js (the Post page's words), src/js/51-tally-queue.js (CloudJobs) and
// app/src/lib/postNeeds.js (Home's Needs you, the client's header). Made-up clients, computers and Windows users.
//   A. a posting waiting while its bridge says Tally is closed: the Post page says "Open Tally and <company> on <computer>
//      (<Windows user>)", never the cloud's "restart FinCom Bridge"; the company not open; the bridge not heard from;
//   B. Needs you lines: only after 10 minutes of waiting; one line per client and reason with its count and kind; refused,
//      ledger missing, not confirmed, held, stopped after timeouts; the most urgent first, then the oldest;
//   C. a line clears by itself once its entries are in Tally; a dismissed or cancelled posting says nothing.
import fs from "fs"; import vm from "vm"; import path from "path"; import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), SRC = process.env.SRC || path.join(HERE, "..");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
globalThis.window = globalThis;
vm.runInThisContext(`
var S = {data: {}, companies: {c1: {id: "c1", name: "Demo Builders"}, c2: {id: "c2", name: "Demo Retail"}, c3: {id: "c3", name: "Demo Traders"}}, bank: null, account: null};
function num(v){ const n = parseFloat(v); return isFinite(n) ? n : 0; }
function fmtDate(d){ return String(d || ""); } function fmtIST(t){ return String(t || ""); }
function memberName(u){ return u ? "a member" : "—"; } function plainMsg(m){ return String(m || ""); } function auditEvent(){}
function perRender(o, k, fn){ return fn(); } function lsGet(){ return null; } function lsSet(){} function lsDel(){} function toast(){} function render(){}
var TCloud = {on(){ return false; }}, Cloud = {on(){ return false; }};
function setTimeout(){ return 0; } function clearTimeout(){}
`);
for (const f of ["src/js/03-transactions.js", "src/js/59-post-preview.js", "src/js/62-post-reasons.js", "src/js/98-post-register.js", "src/js/51-tally-queue.js"]) vm.runInThisContext(fs.readFileSync(path.join(SRC, f), "utf8"), { filename: f });
vm.runInThisContext("globalThis.CloudJobs = CloudJobs; globalThis.S = S;");
let L = null;
try { L = await import(path.join(SRC, "app/src/lib/postNeeds.js")); } catch (e) { console.log("  FAIL app/src/lib/postNeeds.js does not load: " + e.message); process.exit(1); }

const NOW = Date.now(), ago = (m) => new Date(NOW - m * 60000).toISOString();
const RESTART = "No word from the FinCom Bridge on this posting for 2 hours, though the bridge is running: put back for the same bridge (it is never posted from another computer). If it stays so, restart FinCom Bridge on that computer.";
const dev = (b) => ({ id: "d1", name: "PC-DEMO1 · DEMO\\asha", info: { computer: "PC-DEMO1", beat: { at: ago(0) }, bridges: { "go-aaa111": Object.assign({ at: ago(0.5), computer: "PC-DEMO1", user: "DEMO\\asha", tallyState: "closed", tally: false, open: [] }, b) } } });
const bankIds = (n) => Array.from({ length: n }, (_, i) => "stmdemo1-" + i);
const waitJob = (o) => Object.assign({ id: "j-wait", client_id: "c1", company: "Demo Builders Pvt Ltd", status: "waiting", n: 12, created_at: ago(30), updated_at: ago(2), target_bridge: "go-aaa111", taken_by: "go-aaa111", message: RESTART,
  entry_ids: bankIds(12), items: bankIds(12).map((id) => ({ id, kind: "voucher", state: "waiting" })), results: [] }, o);
const st = (job, id) => postStatus({ id }, job, null, [], { id, queue: 1 });

console.log("A. the Post page's words for a posting that waits");
CloudJobs.list = [waitJob()];
const devsClosed = [dev({})];
globalThis.TLight = { st: { devs: devsClosed } };
const a1 = st(CloudJobs.list[0], "stmdemo1-0");
ok(a1 && a1.code === 4 && a1.todo.includes("Open Tally and Demo Builders Pvt Ltd on PC-DEMO1 (asha)"), "Tally closed there: 'Open Tally and Demo Builders Pvt Ltd on PC-DEMO1 (asha)' (" + (a1 && a1.todo) + ")");
ok(a1 && !/restart FinCom Bridge/i.test(a1.todo), "never 'restart FinCom Bridge' while the bridge says Tally is closed");
ok(a1 && a1.action && a1.action.kind === "cancel", "the waiting posting can still be cancelled");
globalThis.TLight = { st: { devs: [dev({ tallyState: "open", tally: true, open: ["Another Demo Co"] })] } };
const a2 = st(CloudJobs.list[0], "stmdemo1-0");
ok(a2 && a2.todo.includes("Demo Builders Pvt Ltd is not open in Tally on PC-DEMO1 (asha)") && a2.todo.includes("Open Tally and Demo Builders Pvt Ltd on PC-DEMO1 (asha)"), "the company not open there: said so, and what to open (" + (a2 && a2.todo) + ")");
globalThis.TLight = { st: { devs: [dev({ tallyState: "open", tally: true, open: ["demo builders  pvt ltd"] })] } };
const a3 = st(CloudJobs.list[0], "stmdemo1-0");
ok(a3 && a3.todo.includes("restart FinCom Bridge"), "Tally and the company open there (any case, spaces): the posting's own words stand");
globalThis.TLight = { st: { devs: [dev({ at: ago(45) })] } };
const a4 = st(CloudJobs.list[0], "stmdemo1-0");
ok(a4 && a4.todo.includes("FinCom Bridge on PC-DEMO1 (asha) is not running") && a4.todo.includes("Turn on PC-DEMO1"), "the bridge not heard from for 45 minutes: turn the computer on (" + (a4 && a4.todo) + ")");
globalThis.TLight = { st: { devs: devsClosed } };
const tk = waitJob({ status: "taken", updated_at: ago(20), items: [] });
const a5 = st(tk, "stmdemo1-0");
ok(a5 && a5.code === 5 && a5.todo.includes("Open Tally and Demo Builders Pvt Ltd on PC-DEMO1 (asha)") && !/Nothing to do/.test(a5.todo), "taken, then Tally closed: not 'Tally is taking it now', the same words (" + (a5 && a5.todo) + ")");

console.log("B. Needs you lines");
CloudJobs.list = [waitJob({ created_at: ago(5) })];
ok(L.postNeedList(NOW, devsClosed).length === 0, "waiting 5 minutes: nothing on Home yet");
CloudJobs.list = [waitJob()];
let l = L.postNeedList(NOW, devsClosed);
ok(l.length === 1 && l[0].n === 12 && l[0].kind === "bank" && l[0].rank === 3 && l[0].cid === "c1", "waiting 30 minutes: one line, 12 bank entries of Demo Builders (" + JSON.stringify(l.map((x) => [x.n, x.kind, x.rank])) + ")");
ok(l.length && L.needSentence(l[0]) === "12 bank entries not in Tally: Tally is closed on PC-DEMO1 (asha). Open Tally and Demo Builders Pvt Ltd on PC-DEMO1 (asha); the posting carries on by itself.", "its words: " + (l.length && L.needSentence(l[0])));
ok(l.length && l[0].tab === "topost" && l[0].label === "See the waiting posting", "its button opens the waiting posting");
// 5 of the 12 posted already: 7 left
CloudJobs.list = [waitJob({ status: "taken", updated_at: ago(15), results: bankIds(5).map((id) => ({ id, ok: true, vchType: "Payment" })), items: bankIds(12).map((id, i) => ({ id, kind: "voucher", state: i < 5 ? "posted" : "waiting" })) })];
l = L.postNeedList(NOW, devsClosed);
ok(l.length === 1 && l[0].n === 7, "5 of 12 in Tally: 7 left in the line (" + (l[0] && l[0].n) + ")");
const ledger = { id: "j-led", client_id: "c2", company: "Demo Retail", status: "failed", n: 3, created_at: ago(300), updated_at: ago(290), entry_ids: ["s1", "s2", "s3"],
  results: ["s1", "s2", "s3"].map((id) => ({ id, ok: false, vchType: "Sales", message: "Ledger 'Demo Sales 18%' does not exist", sentAt: ago(290) })), items: ["s1", "s2", "s3"].map((id) => ({ id, state: "failed", reason: "Ledger 'Demo Sales 18%' does not exist" })) };
const review = { id: "j-rev", client_id: "c3", company: "Demo Traders", status: "done", n: 1, created_at: ago(100), updated_at: ago(99), entry_ids: ["b1"],
  results: [{ id: "b1", ok: false, accepted: true, lastVchId: "4400", vchType: "Purchase", message: "Tally replied 'created' (voucher id 4400) in job j-rev but the entry was not found yet in 'Demo Traders' on 18-11-2026", sentAt: ago(99) }],
  items: [{ id: "b1", state: "unknown", reason: "Tally accepted it (voucher id 4400); being checked, not sent again", outcomeUnknown: true }] };
const refused = { id: "j-ref", client_id: "c2", company: "Demo Retail", status: "failed", n: 2, created_at: ago(500), updated_at: ago(499), entry_ids: ["s7", "s8"],
  results: ["s7", "s8"].map((id) => ({ id, ok: false, vchType: "Sales", message: "Voucher date is outside the period of the company", sentAt: ago(499) })), items: [] };
const held = waitJob({ id: "j-held", client_id: "c3", company: "Demo Traders", status: "taken", created_at: ago(60), updated_at: ago(40), stop_reason: "The client's Tally link changed after this posting was queued: an owner checks it on the Post page.", entry_ids: ["t1", "t2"], items: [], results: [] });
const tout = waitJob({ id: "j-tout", client_id: "c1", status: "taken", created_at: ago(200), updated_at: ago(120), message: "FinCom's cloud kept timing out; posting waits - tell FinCom support", entry_ids: ["stmdemo2-0"], items: [], results: [] });
CloudJobs.list = [waitJob(), ledger, review, refused, held, tout];
l = L.postNeedList(NOW, devsClosed);
const by = (k) => l.find((x) => x.key.startsWith(k));
ok(by("ledger") && by("ledger").n === 3 && by("ledger").kind === "sale" && by("ledger").rank === 2 && L.needSentence(by("ledger")).startsWith("3 sales invoices not in Tally: the ledger “Demo Sales 18%” is not in Tally. Create the ledger"), "a ledger Tally lacks: " + (by("ledger") && L.needSentence(by("ledger"))));
ok(by("ledger") && by("ledger").label === "Choose the Tally ledger" && by("ledger").tab === "errors", "... its button: Choose the Tally ledger (the Errors tab)");
ok(by("review") && by("review").rank === 1 && L.needSentence(by("review")).startsWith("1 entry not confirmed in Tally. Look in Tally's Day Book"), "not confirmed: " + (by("review") && L.needSentence(by("review"))));
ok(by("refused") && by("refused").n === 2 && L.needSentence(by("refused")).startsWith("2 sales invoices not in Tally: refused by Tally (the bill's date is outside the financial year"), "refused by Tally (a date outside the period): " + (by("refused") && L.needSentence(by("refused"))));
ok(by("held") && by("held").rank === 1 && by("held").n === 2 && by("held").todo.includes("Tally link changed"), "held for a person (174): rank 1, its reason");
ok(by("timeouts") && by("timeouts").rank === 1 && /FinCom support/.test(by("timeouts").todo), "stopped after timeouts in a row: rank 1, tell FinCom support");
const ranks = l.map((x) => x.rank);
ok(ranks.join() === ranks.slice().sort().join(), "the most urgent first (" + ranks.join() + ")");
const r1 = l.filter((x) => x.rank === 1).map((x) => x.since);
ok(r1.join() === r1.slice().sort().join(), "then the oldest first");
const cs = L.postNeedClients(NOW, devsClosed);
ok(cs.length === 3 && cs.find((c) => c.cid === "c2").n === 5, "per client: 3 clients, Demo Retail 5 entries (" + cs.map((c) => c.client + " " + c.n).join(", ") + ")");

const late = { id: "j-late", client_id: "c3", company: "Demo Traders", status: "cancelled", n: 1, created_at: ago(80), updated_at: ago(70), entry_ids: ["q1"], results: [], items: [],
  message: "Cancelled after the Tally computer had started it: part of it may be in Tally. Check Tally first; Mark posted what is there before posting it again." };
CloudJobs.list = [late];
l = L.postNeedList(NOW, devsClosed);
ok(l.length === 1 && l[0].rank === 1 && /may have reached Tally/.test(l[0].what) && /Check Tally first/.test(l[0].todo), "cancelled after the Tally computer started it: rank 1, check Tally first (" + (l[0] && L.needSentence(l[0])) + ")");
const oldDev = [dev({ tallyState: "open", tally: true, open: ["Demo Builders Pvt Ltd"], version: "2.5.1" })];
CloudJobs.list = [waitJob({ message: "Waiting for the Tally computer" })];
l = L.postNeedList(NOW, oldDev);
ok(l.length === 1 && /old version \(2\.5\.1\)/.test(l[0].what) && /Update FinCom Bridge on PC-DEMO1 \(asha\)/.test(l[0].todo), "an old bridge (2.5.1) the posting waits for: update it there (" + (l[0] && L.needSentence(l[0])) + ")");
l = L.postNeedList(NOW, [dev({ tallyState: "open", tally: true, open: ["Demo Builders Pvt Ltd"], version: "2.5.19" })]);
ok(l.length === 1 && !/old version/.test(l[0].what), "2.5.19: not called old (" + (l[0] && l[0].what) + ")");

console.log("C. clears by itself");
CloudJobs.list = [waitJob({ status: "done", results: bankIds(12).map((id) => ({ id, ok: true, vchType: "Payment" })), items: bankIds(12).map((id) => ({ id, state: "posted" })) })];
ok(L.postNeedList(NOW, devsClosed).length === 0, "the posting done, every entry in Tally: no line");
CloudJobs.list = [Object.assign({}, ledger, { dismissed_at: ago(1) }), Object.assign({}, refused, { status: "cancelled", message: "Cancelled before the Tally computer took it" })];
ok(L.postNeedList(NOW, devsClosed).length === 0, "dismissed, or cancelled before it was taken: no line");
const later = { id: "j-later", client_id: "c2", company: "Demo Retail", status: "done", n: 3, created_at: ago(10), updated_at: ago(9), entry_ids: ["s1", "s2", "s3"], results: ["s1", "s2", "s3"].map((id) => ({ id, ok: true, vchType: "Sales" })), items: [] };
CloudJobs.list = [ledger, later];
ok(L.postNeedList(NOW, devsClosed).length === 0, "a later posting put them in Tally: no line");

console.log(fails ? "\nFAILED: " + fails : "\nall passed"); process.exit(fails ? 1 : 0);
