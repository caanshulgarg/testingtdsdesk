// node tests/run_sync_echo_marks.js - next-db-load (23-Nov-2026): this computer's own save coming back from the server
// (Realtime, or the next pull) with its keys in the database's order (jsonb: by length, then by name) leaves the sync
// mark equal to this computer's own copy, so the record is NOT sent again at the next sync. Before: the mark was taken
// from the copy that came back, never equal to the copy here, so every such record was sent again every 45 s while a page
// was open (staging, 23-Nov-2026: 3,895 writes of 179 records in under 4 hours). Real code of src/js (cloudApplyNow,
// cloudChanges), made-up data. ECHO_SRC: another src/js folder (the code before the fix: the checks fail there).
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
process.env.TDSDESK_NO_FIXCACHE = process.env.TDSDESK_NO_FIXCACHE || "1";
const {load} = require("./harness");
const SRC = process.env.ECHO_SRC || path.join(__dirname, "..", "src", "js");
const FILES = ["00-core.js", "01-documents-in-the-firm-account.js", "26-sales-from-a-marketplace.js", "27-firm-account.js"];
const ALL = FILES.map(f => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n");
const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "echo-marks-")), "index.html");
fs.writeFileSync(html, '<script id="app-main">\n' + ALL + "\n</script>");
const has = n => new RegExp("\\n(?:async function|function|const|let|var) " + n + "\\b").test("\n" + ALL);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const jsonbOrder = v => Array.isArray(v) ? v.map(jsonbOrder) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map(k => [k, jsonbOrder(v[k])])) : v;
(async () => {
  const {ctx, x} = load(html, ["clone", "fpHash", "stableStr", "cloudKey", "NOBASE", "plainObj", "sameVal", "merge3", "CloudBase", "CLOUD_BASE_SEED", "cloudBaseSet",
    "SAFE_ID", "ID_KEYS", "cleanIds", "cloudRowOk", "cloudApplyNow", "cloudChanges"].filter(has));
  Object.assign(ctx, {setTimeout, clearTimeout, Promise, render(){}, soonRender(){}, toast(){}, console: {log(){}, warn(){}, error(){}}});
  const marks = {};
  ctx.Cloud = {marks: () => marks, setMarks(){}, dels: () => ({}), setDels(){}};
  const bill = {id: "e1", party: "MADE UP TRADERS", billNo: "7", amount: 1180, lines: [{ledger: "Made Up Purchase", amt: 1000, rate: 18}]};
  ctx.S = {companies: {}, data: {c1: {loaded: true, entries: {e1: JSON.parse(JSON.stringify(bill))}, parties: {}}}, inbox: {}, firm: {}, bank: null, sales: null};
  ctx.refreshStats = () => {}; ctx.Store = {saveEntry(){}, saveParty(){}, saveFirm(){}, saveCompany(){}, saveInbox(){}, put(){}, loadCompany: async () => {}};
  ctx.cloudSnapshot = () => [{kind: "entry", id: "e1", client_id: "c1", data: JSON.parse(JSON.stringify(ctx.S.data.c1.entries.e1))}];
  const k = "entry|c1|e1";
  marks[k] = x.fpHash(JSON.stringify(bill));                  // just sent from here (cloudPush)
  ok(x.cloudChanges().changes.length === 0, "sent: nothing to send");
  const back = jsonbOrder(bill);
  ok(JSON.stringify(back) !== JSON.stringify(bill), "the copy coming back has its keys in another order (as the database gives them)");
  const took = await x.cloudApplyNow([{kind: "entry", id: "e1", client_id: "c1", data: back, deleted: false, updated_at: "2026-11-23T10:00:00Z"}]);
  ok(took === 0, "this computer's own save coming back changes nothing here (" + took + ")");
  const left = x.cloudChanges().changes.map(r => r.kind + "|" + r.id);
  ok(left.length === 0, "...and it is not sent again at the next sync (" + (left.join(", ") || "nothing") + ")");
  // a colleague's real change still comes in and is not sent back
  const theirs = jsonbOrder(Object.assign({}, bill, {billNo: "8"}));
  await x.cloudApplyNow([{kind: "entry", id: "e1", client_id: "c1", data: theirs, deleted: false, updated_at: "2026-11-23T10:01:00Z"}]);
  ok(ctx.S.data.c1.entries.e1.billNo === "8", "a colleague's change comes in");
  ok(x.cloudChanges().changes.length === 0, "...and is not sent back");
  // a change made here after that is sent
  ctx.S.data.c1.entries.e1.amount = 2360;
  ok(x.cloudChanges().changes.length === 1, "a change made here is sent");
  try { fs.rmSync(path.dirname(html), {recursive: true, force: true}); } catch (e){}
  console.log(fails ? "FAILED: " + fails : "ALL OK");
  process.exit(fails ? 1 : 0);
})();
