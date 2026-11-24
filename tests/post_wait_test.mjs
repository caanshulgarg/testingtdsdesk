// node tests/post_wait_test.mjs - the Post page's words for a posting that waits (next-posting-never-stuck; the owner,
// 23-Nov-2026: "warnings say just 'Tally is closed'", no computer or Windows user named anywhere in posting messages), on
// the program's own files under node: src/js/62-post-reasons.js (postStatus, with 03, 59, 98, 51) and app/src/lib/postWait.js
// (postWaitWhy: what the posting's bridge said in its last beat). Made-up companies, computers and Windows users.
//   1. Tally closed there: "Tally is closed. Open Tally and <company>." (plain and short); never the cloud's "restart FinCom Bridge";
//   2. the company not open there: "<company> is not open in Tally. Open Tally and <company>"; open (any case): its own words;
//   3. the bridge not heard from: "The Tally computer is off";
//   4. taken, then Tally closed: "Stopped part-way: Tally is closed. …", never "Tally is taking it now. Nothing to do.";
//   5. an old bridge: nothing new said (the owner: no warnings in posting; old bridges allowed);
//   6. none of these words names the computer or the Windows user.
import fs from "fs"; import vm from "vm"; import path from "path"; import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), SRC = process.env.SRC || path.join(HERE, "..");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
globalThis.window = globalThis;
vm.runInThisContext(`
var S = {data: {}, companies: {}, bank: null, account: null};
function num(v){ const n = parseFloat(v); return isFinite(n) ? n : 0; }
function fmtDate(d){ return String(d || ""); } function fmtIST(t){ return String(t || ""); }
function memberName(u){ return u ? "a member" : "—"; } function plainMsg(m){ return String(m || ""); } function auditEvent(){}
function perRender(o, k, fn){ return fn(); } function lsGet(){ return null; } function lsSet(){} function lsDel(){} function toast(){} function render(){}
var TCloud = {on(){ return false; }}, Cloud = {on(){ return false; }};
function setTimeout(){ return 0; } function clearTimeout(){}
`);
for (const f of ["src/js/03-transactions.js", "src/js/59-post-preview.js", "src/js/62-post-reasons.js", "src/js/98-post-register.js", "src/js/51-tally-queue.js"]) vm.runInThisContext(fs.readFileSync(path.join(SRC, f), "utf8"), { filename: f });
try { await import(path.join(SRC, "app/src/lib/postWait.js")); } catch (e) { console.log("  FAIL app/src/lib/postWait.js does not load: " + e.message); }

const NOW = Date.now(), ago = (m) => new Date(NOW - m * 60000).toISOString();
const RESTART = "No word from the FinCom Bridge on this posting for 2 hours, though the bridge is running: put back for the same bridge (it is never posted from another computer). If it stays so, restart FinCom Bridge on that computer.";
const dev = (b) => ({ id: "d1", name: "PC-DEMO1 · DEMO\\asha", info: { computer: "PC-DEMO1", beat: { at: ago(0) }, bridges: { "go-aaa111": Object.assign({ at: ago(0.5), computer: "PC-DEMO1", user: "DEMO\\asha", tallyState: "closed", tally: false, open: [], version: "2.5.19" }, b) } } });
const job = (o) => Object.assign({ id: "j-wait", client_id: "c1", company: "Demo Builders Pvt Ltd", status: "waiting", n: 2, created_at: ago(30), updated_at: ago(2), target_bridge: "go-aaa111", taken_by: "go-aaa111", message: RESTART,
  entry_ids: ["stmdemo1-0", "stmdemo1-1"], items: [{ id: "stmdemo1-0", state: "waiting" }, { id: "stmdemo1-1", state: "waiting" }], results: [] }, o);
const st = (j) => postStatus({ id: "stmdemo1-0" }, j, null, [], { id: "stmdemo1-0", queue: 1 });
const said = [];
const at = (devs, j) => { globalThis.TLight = { st: { devs } }; const x = st(j || job()); said.push(x ? x.todo : ""); return x || { todo: "" }; };

console.log("1. Tally closed");
let x = at([dev({})]);
ok(x.code === 4 && x.todo === "Number 1 in the queue: Tally is closed. Open Tally and Demo Builders Pvt Ltd.", "Tally closed: " + x.todo);
ok(!/restart FinCom Bridge/i.test(x.todo) && x.action && x.action.kind === "cancel", "never 'restart FinCom Bridge'; still Cancel");
console.log("2. the company not open");
x = at([dev({ tallyState: "open", tally: true, open: ["Another Demo Co"] })]);
ok(x.todo === "Number 1 in the queue: Demo Builders Pvt Ltd is not open in Tally. Open Tally and Demo Builders Pvt Ltd.", "not open: " + x.todo);
x = at([dev({ tallyState: "open", tally: true, open: ["demo builders  pvt ltd"] })]);
ok(x.todo.includes("restart FinCom Bridge"), "open there (any case, spaces): the posting's own words stand");
console.log("3. the Tally computer off");
x = at([dev({ at: ago(45) })]);
ok(x.todo === "Number 1 in the queue: The Tally computer is off. Turn it on, then open Tally and Demo Builders Pvt Ltd.", "off: " + x.todo);
console.log("4. taken, then Tally closed");
x = at([dev({})], job({ status: "taken", items: [] }));
ok(x.code === 5 && x.todo === "Stopped part-way: Tally is closed. Open Tally and Demo Builders Pvt Ltd.", "taken: " + x.todo);
console.log("4b. running, Tally busy or open there: Tally is taking it now (Stopped part-way only when closed, not open or off)");
x = at([dev({ tallyState: "busy", tally: true, open: ["Demo Builders Pvt Ltd"] })], job({ status: "running", items: [], message: "Posting" }));
ok(x.code === 5 && x.todo.startsWith("Tally is taking it now") && !/Stopped part-way/.test(x.todo), "running, busy: " + x.todo);
x = at([dev({ tallyState: "open", tally: true, open: ["Demo Builders Pvt Ltd"] })], job({ status: "running", items: [], message: "Posting" }));
ok(x.code === 5 && x.todo === "Tally is taking it now. Nothing to do.", "running, open there: " + x.todo);
x = at([dev({ tallyState: "open", tally: true, open: ["Another Demo Co"] })], job({ status: "running", items: [] }));
ok(x.todo === "Stopped part-way: Demo Builders Pvt Ltd is not open in Tally. Open Tally and Demo Builders Pvt Ltd.", "running, not open there: " + x.todo);
x = at([dev({ at: ago(45) })], job({ status: "running", items: [] }));
ok(x.todo.startsWith("Stopped part-way: The Tally computer is off."), "running, off: " + x.todo);
console.log("4c. the beat explains nothing: the posting's own words, never a computer or Windows user named in them");
const W4A = "Still waiting after 6 hours (since 23-Nov-2026 10:00 IST) for PC-DEMO1 · DEMO\\asha, which started it (it is never posted from another computer). Open Demo Builders Pvt Ltd in Tally there.";
const OPEN = { tallyState: "open", tally: true, open: ["Demo Builders Pvt Ltd"] };
for (const [label, devs] of [["open there", [dev(OPEN)]], ["no beat known", []]]) {
  x = at(devs, job({ message: W4A }));
  ok(x.code === 4 && /Still waiting after 6 hours/.test(x.todo) && /Open Demo Builders Pvt Ltd in Tally/.test(x.todo) && !/PC-DEMO1|asha|DEMO\\/.test(x.todo), "4a words, " + label + ": no names (" + x.todo + ")");
}
x = at([dev(OPEN)], job({ status: "running", items: [], message: "Started on PC-DEMO1 · DEMO\\asha, and that FinCom Bridge can no longer post; it is never moved to another bridge (part of it may be in Tally)." }));
ok(x.todo.startsWith("Tally is taking it now") && !/PC-DEMO1|asha/.test(x.todo), "running, 'Started on <computer>': no names (" + x.todo + ")");
x = at([dev(OPEN)], job({ message: "Waiting at PC-DEMO1 for Tally" }));
ok(!/PC-DEMO1/.test(x.todo), "any words naming its computer: not shown (" + x.todo + ")");
x = at([dev(OPEN)], job({ target_bridge: null, taken_by: null, message: "Queued: posts by itself when Demo Builders Pvt Ltd is opened in Tally on DESK-OTHER7 (D:\\TallyData) with FinCom Bridge" }));
ok(/posts by itself when Demo Builders Pvt Ltd is opened in Tally/.test(x.todo) && !/DESK-OTHER7|TallyData/.test(x.todo), "queued for no computer (migration 185): no computer or folder named (" + x.todo + ")");
console.log("5. an old bridge: no new warning (the owner: no warnings in posting)");
x = at([dev({ tallyState: "open", tally: true, open: ["Demo Builders Pvt Ltd"], version: "2.5.1" })], job({ message: "Waiting for the Tally computer" }));
ok(!/old version|Update FinCom Bridge/.test(x.todo), "an old bridge after 30 minutes: the posting's own words (" + x.todo + ")");
console.log("6. no computer or Windows user named");
ok(said.every((t) => !/PC-DEMO1|asha|DEMO\\/.test(t)), "none of the words names PC-DEMO1 or asha");
console.log("6b. a posting failed or cancelled in the cloud's words for another Tally computer (migration 54 and after): plain, no names");
const M54 = "Not posted into Demo Builders Pvt Ltd: the FinCom Bridge it was for (PC-DEMO1 · DEMO\\asha) is set to Changes only, and no other bridge of the same Windows user on that computer may post. Ask the firm's owner to switch Changes only off for that bridge (Tally page), then Retry; or post these entries again so FinCom chooses a bridge that may post.";
for (const s of ["failed", "cancelled"]) {
  x = at([], job({ status: s, message: M54, items: [{ id: "stmdemo1-0", state: s }] }));
  ok(/meant for another Tally computer/.test(x.todo) && /where this company is open/.test(x.todo) && !/PC-DEMO1|asha|Tally said|Changes only/.test(x.todo), s + ": " + x.todo);
}
console.log("7. names are matched as whole words, and common words are never taken for a name");
const devN = (o) => ({ id: "d2", name: o.name, info: { computer: o.computer, user: o.user, beat: { at: ago(0) }, bridges: { "go-aaa111": { at: ago(0.5), computer: o.computer, user: o.user, tallyState: "open", tally: true, open: ["Demo Builders Pvt Ltd"] } } } });
for (const [label, d, m, keep] of [
  ["a user 'Ram' and the word Programme", { name: "RAMPC", computer: "RAMPC", user: "Ram" }, "Posting into Programme Demo Ltd: waiting for the Tally computer", true],
  ["a computer named Admin", { name: "Admin", computer: "Admin", user: "Administrator" }, "Waiting for the admin to open Tally on the Tally computer", true],
  ["a user named Tally, a computer named PC", { name: "PC", computer: "PC", user: "Tally" }, "Waiting for the Tally computer to answer", true],
  ["a user named Owner", { name: "OWNER-PC", computer: "OWNER-PC", user: "Owner" }, "Waiting until the owner allows posting", true],
  ["the computer named as a word", { name: "RAMPC", computer: "RAMPC", user: "DEMO\\ram" }, "Waiting at RAMPC for Tally", false],
  ["the Windows user named alone", { name: "RAMPC", computer: "RAMPC", user: "DEMO\\ram" }, "Waiting for ram to open Tally", false]]) {
  x = at([devN(d)], job({ message: m }));
  ok(keep ? x.todo.includes(m) : !x.todo.includes(m), label + ": " + (keep ? "kept" : "left out") + " (" + x.todo + ")");
}
console.log("8. the Tally computer off: by the bridge's own beat interval and this computer's clock");
const devB = (b, every) => ({ id: "d3", name: "PC-DEMO3", info: { computer: "PC-DEMO3", beat: { at: ago(0), every }, bridges: { "go-aaa111": Object.assign({ at: ago(4), computer: "PC-DEMO3", user: "DEMO\\asha", tallyState: "closed", tally: false, open: [] }, b) } } });
x = at([devB({}, 300)]);
ok(!/is off/.test(x.todo) && /Tally is closed/.test(x.todo), "a beat every 5 minutes, last 4 minutes ago: not off (" + x.todo + ")");
x = at([devB({ at: ago(20) }, 300)]);
ok(/The Tally computer is off/.test(x.todo), "a beat every 5 minutes, last 20 minutes ago: off (" + x.todo + ")");
x = at([devB({}, 60)]);
ok(/The Tally computer is off/.test(x.todo), "a beat every minute, last 4 minutes ago: off (" + x.todo + ")");
globalThis.TallyClock = { skew: () => 10 * 60000 };
x = at([devB({ at: ago(11) }, 60)]);
ok(!/is off/.test(x.todo), "this computer's clock 10 minutes ahead, a beat a minute ago by the cloud's clock: not off (" + x.todo + ")");
delete globalThis.TallyClock;
console.log(fails ? "\nFAILED: " + fails : "\nall passed"); process.exit(fails ? 1 : 0);
