// node run_client_merge.js - a browser's save of Client setup is merged into the server's copy, never replaces newer
// values with an older copy (review of 02-Oct-2026: Testing AAD's "posting allowed to company", set at about 05:30 UTC,
// was wiped at 06:02 by a browser that sent its whole older copy of the client).
// Runs the real code of src/js/27-firm-account.js against a stand-in server (PostgREST-like: GET, conditional PATCH).
const fs = require("fs"), path = require("path"), os = require("os");
const {load} = require("./harness");
const src = f => fs.readFileSync(path.join(__dirname, "..", "src", "js", f), "utf8");
const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cm-")), "index.html");
fs.writeFileSync(html, '<script id="app-main">\n' + src("01-documents-in-the-firm-account.js") + "\n" + src("26-sales-from-a-marketplace.js") + "\n" + src("27-firm-account.js") + "\n</script>");
const {ctx, x} = load(html, ["clone", "fpHash", "stableStr", "cloudKey", "NOBASE", "plainObj", "sameVal", "merge3", "ClientBase", "takeClientHere",
  "cloudPushClient", "SAFE_ID", "ID_KEYS", "cleanIds", "cloudRowOk", "cloudApply", "cloudApplyNow", "cloudSnapshot"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const clone = o => JSON.parse(JSON.stringify(o));

// ---- a stand-in server and this browser's storage
let server, tick = 0, beforePatch = null;
const stamp = () => "2026-10-02T06:" + String(10 + (++tick)).padStart(2, "0") + ":00.000000+00:00";
const kv = {};
ctx.BankDB = {get: async k => kv[k] === undefined ? undefined : clone(kv[k]), set: async (k, v) => { kv[k] = clone(v); }};
ctx.Live = {applying: false};
ctx.Store = {saveCompany(){}, put(){}, saveFirm(){}};
ctx.fixCompany = c => c;
ctx.refreshStats = () => {};
ctx.Cloud = {
  st: {firm: "F1"},
  marks: () => ({}), setMarks(){},
  async api(p, o){
    o = o || {};
    const id = decodeURIComponent((p.match(/&id=eq\.([^&]+)/) || [])[1] || "");
    const row = server[id];
    if (!o.method || o.method === "GET") return row ? [{data: clone(row.data), updated_at: row.updated_at, deleted: !!row.deleted}] : [];
    if (o.method === "PATCH"){
      if (beforePatch){ const f = beforePatch; beforePatch = null; f(); }   // another computer saves in between
      const want = decodeURIComponent((p.match(/&updated_at=eq\.([^&]+)/) || [])[1] || "");
      if (!row || row.updated_at !== want) return [];
      Object.assign(row, clone(o.body), {updated_at: stamp()});
      return [{data: clone(row.data), updated_at: row.updated_at}];
    }
    if (o.method === "POST"){ [].concat(o.body).forEach(b => { server[b.id] = Object.assign(clone(b), {updated_at: stamp()}); }); return null; }
    throw new Error("unexpected " + o.method);
  }
};
ctx.S = {companies: {}};
const sendBatch = (table, rows) => ctx.Cloud.api(table, {method: "POST", body: rows});
const push = async id => x.cloudPushClient({kind: "client", id, data: clone(ctx.S.companies[id]), hash: x.fpHash(JSON.stringify(ctx.S.companies[id]))}, sendBatch);

(async () => {
  // 1. 02-Oct: the server has postTo (set at 05:30 on another computer); this browser holds the copy from before it
  const old = {id: "c1", name: "Testing AAD", gst: {cgst: "09 CGST INPUT", sgst: "09 SGST INPUT", igst: "07 IGST INPUT"}, stats: {records: 5}};
  server = {c1: {data: Object.assign(clone(old), {postTo: "GARG SHEKHAR & COMPANY", postToBy: "test@test.com"}), updated_at: stamp()}};
  await ctx.BankDB.set("cbase:c1", old);
  ctx.S.companies.c1 = Object.assign(clone(old), {stats: {records: 12}});          // only the counts changed here
  await push("c1");
  ok(server.c1.data.postTo === "GARG SHEKHAR & COMPANY", "the older copy's save keeps postTo set on another computer: " + server.c1.data.postTo);
  ok(server.c1.data.stats.records === 12, "and takes this browser's own change (stats 12)");
  ok(ctx.S.companies.c1.postTo === "GARG SHEKHAR & COMPANY", "this browser now has postTo too");
  ok((await ctx.BankDB.get("cbase:c1")).postTo === "GARG SHEKHAR & COMPANY", "and keeps the server's copy as its base");

  // 2. both computers change different settings: both kept
  server.c1.data.tdsLedgers = {rent_building: "TDS ON RENT 94I"}; server.c1.updated_at = stamp();
  ctx.S.companies.c1.gst = Object.assign({}, ctx.S.companies.c1.gst, {sgst: "09 SGST INPUT", cgst: "09 CGST INPUT (new)"});
  await push("c1");
  ok(server.c1.data.tdsLedgers && server.c1.data.tdsLedgers.rent_building === "TDS ON RENT 94I", "another computer's TDS ledger kept");
  ok(server.c1.data.gst.cgst === "09 CGST INPUT (new)", "this browser's GST change saved");

  // 3. the same nested setting changed in two places, different keys inside it: setting by setting
  server.c1.data.gst = Object.assign({}, server.c1.data.gst, {igst: "07 IGST INPUT (other)"}); server.c1.updated_at = stamp();
  ctx.S.companies.c1.gst = Object.assign({}, ctx.S.companies.c1.gst, {sgst: "09 SGST INPUT (mine)"});
  await push("c1");
  ok(server.c1.data.gst.igst === "07 IGST INPUT (other)" && server.c1.data.gst.sgst === "09 SGST INPUT (mine)", "GST: igst from there, sgst from here: " + JSON.stringify(server.c1.data.gst));

  // 4. a deliberate change here wins over the base (stop posting)
  ctx.S.companies.c1.postTo = "";
  await push("c1");
  ok(server.c1.data.postTo === "", "stopping posting here is saved (postTo emptied on purpose)");
  ctx.S.companies.c1.postTo = "GARG SHEKHAR & COMPANY"; await push("c1");

  // 5. the server changes between the read and the write: read again, merge again, nothing lost
  ctx.S.companies.c1.roundOff = "Round Off A/c";
  beforePatch = () => { server.c1.data.voucherType = "Purchase"; server.c1.updated_at = stamp(); };
  await push("c1");
  ok(server.c1.data.roundOff === "Round Off A/c" && server.c1.data.voucherType === "Purchase", "a write in between: both kept after a second try");

  // 6. no base kept yet (the first save after this change): the server's values stand, this browser only adds
  delete kv["cbase:c1"];
  ctx.S.companies.c1 = {id: "c1", name: "Testing AAD", gst: {cgst: "INPUT CGST", sgst: "INPUT IGST"}, onbHide: true};
  await push("c1");
  ok(server.c1.data.gst.cgst === "09 CGST INPUT (new)" && server.c1.data.postTo === "GARG SHEKHAR & COMPANY", "no base: the server's GST and postTo stand");
  ok(server.c1.data.onbHide === true, "no base: what the server lacks is added");

  // 7. removed on another computer: a save here does not bring it back
  server.c2 = {data: {id: "c2", name: "Gone"}, updated_at: stamp(), deleted: true};
  ctx.S.companies.c2 = {id: "c2", name: "Gone", stats: {records: 1}};
  const m = await push("c2");
  ok(server.c2.deleted === true && m === "gone" && !ctx.S.companies.c2, "a client removed elsewhere stays removed");

  // 8. a pull while this browser has an unsent change: the change is kept and still to be sent
  const marks = {};
  ctx.Cloud.marks = () => marks; ctx.Cloud.setMarks = m2 => Object.assign(marks, m2);
  ctx.S.companies.c1 = clone(server.c1.data); await ctx.BankDB.set("cbase:c1", server.c1.data);
  marks["client|c1|c1"] = x.fpHash(JSON.stringify(ctx.S.companies.c1));
  ctx.S.companies.c1.expenseLedgers = {rent_building: "Rent"};                     // edited here, not sent yet
  const incoming = Object.assign(clone(server.c1.data), {postTo: "GARG SHEKHAR & COMPANY", voucherType: "Journal"});
  await x.cloudApply([{kind: "client", id: "c1", client_id: "c1", data: incoming, deleted: false}]);
  ok(ctx.S.companies.c1.expenseLedgers && ctx.S.companies.c1.expenseLedgers.rent_building === "Rent", "the unsent change survives a pull");
  ok(ctx.S.companies.c1.voucherType === "Journal", "and the pulled change is taken");
  ok(marks["client|c1|c1"] !== x.fpHash(JSON.stringify(ctx.S.companies.c1)), "and it is still marked to be sent");

  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
