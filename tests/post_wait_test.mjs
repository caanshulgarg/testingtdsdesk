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
console.log("5. an old bridge: no new warning (the owner: no warnings in posting)");
x = at([dev({ tallyState: "open", tally: true, open: ["Demo Builders Pvt Ltd"], version: "2.5.1" })], job({ message: "Waiting for the Tally computer" }));
ok(!/old version|Update FinCom Bridge/.test(x.todo), "an old bridge after 30 minutes: the posting's own words (" + x.todo + ")");
console.log("6. no computer or Windows user named");
ok(said.every((t) => !/PC-DEMO1|asha|DEMO\\/.test(t)), "none of the words names PC-DEMO1 or asha");
console.log(fails ? "\nFAILED: " + fails : "\nall passed"); process.exit(fails ? 1 : 0);
