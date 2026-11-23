// node run_client_merge.js - a browser's save of Client setup is merged into the server's copy, never replaces newer
// values with an older copy (review of 02-Oct-2026: Testing AAD's "posting allowed to company", set at about 05:30 UTC,
// was wiped at 06:02 by a browser that sent its whole older copy of the client).
// Runs the real code of src/js/27-firm-account.js against a stand-in server (PostgREST-like: GET, conditional PATCH).
const fs = require("fs"), path = require("path"), os = require("os");
const {load} = require("./harness");
const src = f => fs.readFileSync(path.join(__dirname, "..", "src", "js", f), "utf8");
const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cm-")), "index.html");
fs.writeFileSync(html, '<script id="app-main">\n' + src("01-documents-in-the-firm-account.js") + "\n" + src("26-sales-from-a-marketplace.js") + "\n" + src("27-firm-account.js") + "\n</script>");
const {ctx, x} = load(html, ["clone", "fpHash", "stableStr", "cloudKey", "NOBASE", "plainObj", "sameVal", "merge3", "clientKeepChoices", "clientOptKeep", "ClientBase", "takeClientHere",
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
ctx.setTimeout = setTimeout;   // the retry's wait (cloudPushClient, speed round 2)
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

  // 9. owner, 23-Nov-2026: Optional vouchers off in every client (migration 213 sets createOptional false on the server,
  // stamped createOptionalAt). A copy here that still says on, unchanged since, never turns it on again: not when a save
  // goes from a tab whose base is already the server's new copy, not when a pull meets an unsent change here
  const MIG = "2026-11-23T10:00:00.000Z";
  server.o1 = {data: {id: "o1", name: "ZZ Optional Traders", createOptional: false, createOptionalAt: MIG, roundOff: "Round Off"}, updated_at: stamp()};
  await ctx.BankDB.set("cbase:o1", server.o1.data);                                   // another tab took the server's copy as the base
  ctx.S.companies.o1 = {id: "o1", name: "ZZ Optional Traders", createOptional: true, roundOff: "Round Off (mine)"};   // this tab's old copy
  await push("o1");
  ok(server.o1.data.createOptional === false, "a stale copy's Optional = on is not written back over the server's off: " + server.o1.data.createOptional);
  ok(server.o1.data.roundOff === "Round Off (mine)", "and the tab's own change still goes");
  ok(ctx.S.companies.o1.createOptional === false, "and this tab now has it off too");
  // no base, an old copy on: the server's off stands
  delete kv["cbase:o1"]; ctx.S.companies.o1 = Object.assign(clone(server.o1.data), {createOptional: true}); delete ctx.S.companies.o1.createOptionalAt;
  await push("o1");
  ok(server.o1.data.createOptional === false, "no base: an old copy's on does not win either");
  // ticked on deliberately here after the change (a newer stamp): saved
  ctx.S.companies.o1 = Object.assign(clone(server.o1.data), {createOptional: true, createOptionalAt: "2026-11-24T09:00:00.000Z"});
  await push("o1");
  ok(server.o1.data.createOptional === true && server.o1.data.createOptionalAt === "2026-11-24T09:00:00.000Z", "ticked on deliberately in Client setup (newer stamp): saved as on");
  // a pull meeting an unsent change here that still holds the old on: the server's off is taken
  server.o1.data = Object.assign(clone(server.o1.data), {createOptional: false, createOptionalAt: "2026-11-25T09:00:00.000Z"}); server.o1.updated_at = stamp();
  ctx.S.companies.o1 = Object.assign(clone(server.o1.data), {createOptional: true, createOptionalAt: "2026-11-24T09:00:00.000Z"});
  // the copy both had: off, stamped by the migration; since then ticked on here (24) and off again there (25): both changed, the newer stamp decides
  await ctx.BankDB.set("cbase:o1", Object.assign(clone(server.o1.data), {createOptional: false, createOptionalAt: "2026-11-23T10:00:00.000Z"}));
  marks["client|o1|o1"] = "an older mark";
  await x.cloudApply([{kind: "client", id: "o1", client_id: "o1", data: clone(server.o1.data), deleted: false}]);
  ok(ctx.S.companies.o1.createOptional === false, "a pull: the server's newer off is taken over an older on held here");

  // 10. review of 23-Nov-2026: the rule both ways. Tab A ticks it on (stamped T); tab B still holds an old OFF copy with
  // no stamp and the shared base is already the server's on/T: tab B's save keeps on/T (a side with no stamp never beats
  // a stamped side); the newer stamp decides when both have one; the same for bank entries (bankOptional/bankOptionalAt)
  const T = "2026-11-24T09:00:00.000Z";
  server.o2 = {data: {id: "o2", name: "ZZ Two Tabs", createOptional: true, createOptionalAt: T, roundOff: "Round Off"}, updated_at: stamp()};
  await ctx.BankDB.set("cbase:o2", server.o2.data);
  ctx.S.companies.o2 = {id: "o2", name: "ZZ Two Tabs", createOptional: false, roundOff: "Round Off B"};          // tab B: old off, no stamp
  await push("o2");
  ok(server.o2.data.createOptional === true && server.o2.data.createOptionalAt === T, "an old OFF copy (no stamp) does not wipe a deliberate ON (stamped): " + JSON.stringify([server.o2.data.createOptional, server.o2.data.createOptionalAt]));
  ok(server.o2.data.roundOff === "Round Off B", "and tab B's own change still goes");
  ok(ctx.S.companies.o2.createOptional === true && ctx.S.companies.o2.createOptionalAt === T, "and tab B now holds on/T");
  // the newer stamp decides: unticked here later
  ctx.S.companies.o2 = Object.assign(clone(server.o2.data), {createOptional: false, createOptionalAt: "2026-11-25T09:00:00.000Z"});
  await push("o2");
  ok(server.o2.data.createOptional === false && server.o2.data.createOptionalAt === "2026-11-25T09:00:00.000Z", "unticked later (newer stamp): saved as off");
  // an older stamp here does not beat a newer one there
  server.o2.data = Object.assign(clone(server.o2.data), {createOptional: true, createOptionalAt: "2026-11-26T09:00:00.000Z"}); server.o2.updated_at = stamp();
  ctx.S.companies.o2 = Object.assign(clone(server.o2.data), {createOptional: false, createOptionalAt: "2026-11-25T09:00:00.000Z"});
  await ctx.BankDB.set("cbase:o2", Object.assign(clone(server.o2.data), {createOptional: true, createOptionalAt: "2026-11-24T09:00:00.000Z"}));
  await push("o2");
  ok(server.o2.data.createOptional === true && server.o2.data.createOptionalAt === "2026-11-26T09:00:00.000Z", "an older stamp here loses to a newer one there");
  // the pull path: an unsent change here holding an old OFF with no stamp; the server's on/T comes in and stays
  server.o2.data = Object.assign(clone(server.o2.data), {createOptional: true, createOptionalAt: T}); server.o2.updated_at = stamp();
  ctx.S.companies.o2 = {id: "o2", name: "ZZ Two Tabs", createOptional: false, roundOff: "Round Off C"};
  await ctx.BankDB.set("cbase:o2", clone(server.o2.data));
  marks["client|o2|o2"] = "an older mark";
  await x.cloudApply([{kind: "client", id: "o2", client_id: "o2", data: clone(server.o2.data), deleted: false}]);
  ok(ctx.S.companies.o2.createOptional === true && ctx.S.companies.o2.createOptionalAt === T && ctx.S.companies.o2.roundOff === "Round Off C", "a pull: on/T kept over an unsent old OFF here, the unsent change kept");
  // bank entries: the same rule on bankOptional / bankOptionalAt
  const MB = "2026-11-23T10:00:00.000Z";
  server.b1 = {data: {id: "b1", name: "ZZ Bank Traders", bankOptional: false, bankOptionalAt: MB}, updated_at: stamp()};
  await ctx.BankDB.set("cbase:b1", server.b1.data);
  ctx.S.companies.b1 = {id: "b1", name: "ZZ Bank Traders", bankOptional: true, bankAuto: false};                 // an old copy, on, no stamp
  await push("b1");
  ok(server.b1.data.bankOptional === false && server.b1.data.bankOptionalAt === MB && server.b1.data.bankAuto === false, "bank: an old ON copy does not undo the off (migration 213), its other change goes");
  ctx.S.companies.b1 = Object.assign(clone(server.b1.data), {bankOptional: true, bankOptionalAt: "2026-11-24T10:00:00.000Z"});
  await push("b1");
  ok(server.b1.data.bankOptional === true, "bank: ticked on later (newer stamp): saved");
  ctx.S.companies.b1 = Object.assign(clone(server.b1.data), {bankOptional: false}); delete ctx.S.companies.b1.bankOptionalAt;
  await ctx.BankDB.set("cbase:b1", clone(server.b1.data));                                // the base is already the server's on
  await push("b1");
  ok(server.b1.data.bankOptional === true && server.b1.data.bankOptionalAt === "2026-11-24T10:00:00.000Z", "bank: an old OFF copy (no stamp) does not wipe a deliberate ON");

  // 11. re-review of 23-Nov-2026 (probe A): a slow clock. The server's copy has not changed since this tab's base (the
  // migration's off, stamped 10:00 by the server's clock); the person ticks it on here on a PC 15 minutes slow (stamp
  // 09:50). Only this side changed: the tick is saved, whatever the clocks say
  const MIG2 = "2026-11-23T10:00:00.000Z";
  server.k1 = {data: {id: "k1", name: "ZZ Skew", createOptional: false, createOptionalAt: MIG2}, updated_at: stamp()};
  await ctx.BankDB.set("cbase:k1", server.k1.data);
  ctx.S.companies.k1 = Object.assign(clone(server.k1.data), {createOptional: true, createOptionalAt: "2026-11-23T09:50:00.000Z"});
  await push("k1");
  ok(server.k1.data.createOptional === true && server.k1.data.createOptionalAt === "2026-11-23T09:50:00.000Z", "A: a deliberate tick on a slow clock, the server unchanged since the base: saved " + JSON.stringify([server.k1.data.createOptional, server.k1.data.createOptionalAt]));
  // the same on the pull path: the server unchanged since the base, a tick here not sent yet
  marks["client|k1|k1"] = "an older mark";
  ctx.S.companies.k1 = Object.assign(clone(server.k1.data), {createOptional: false, createOptionalAt: "2026-11-23T09:40:00.000Z"});
  await ctx.BankDB.set("cbase:k1", clone(server.k1.data));
  await x.cloudApply([{kind: "client", id: "k1", client_id: "k1", data: clone(server.k1.data), deleted: false}]);
  ok(ctx.S.companies.k1.createOptional === false && ctx.S.companies.k1.createOptionalAt === "2026-11-23T09:40:00.000Z", "A (pull): an unsent untick on a slow clock is kept when the server has not changed it");
  // 12. probe B: the undo (server back to on) meets a tab that still holds the migrated off/stamp, unchanged here, with
  // another change to send: the undo stays (this side did not change the setting)
  server.u1 = {data: {id: "u1", name: "ZZ Undo", createOptional: false, createOptionalAt: MIG2, roundOff: "R"}, updated_at: stamp()};
  await ctx.BankDB.set("cbase:u1", clone(server.u1.data));
  server.u1.data = Object.assign(clone(server.u1.data), {createOptional: true, createOptionalAt: null}); server.u1.updated_at = stamp();   // an undo of old
  ctx.S.companies.u1 = {id: "u1", name: "ZZ Undo", createOptional: false, createOptionalAt: MIG2, roundOff: "R2"};
  await push("u1");
  ok(server.u1.data.createOptional === true && server.u1.data.roundOff === "R2", "B: the undo survives a save from a tab holding the migrated copy, whose own change goes " + JSON.stringify(server.u1.data));
  server.u2 = {data: {id: "u2", name: "ZZ Undo 2", createOptional: false, createOptionalAt: MIG2}, updated_at: stamp()};
  await ctx.BankDB.set("cbase:u2", clone(server.u2.data));
  server.u2.data = Object.assign(clone(server.u2.data), {createOptional: true, createOptionalAt: "2026-11-23T12:00:00.000Z"}); server.u2.updated_at = stamp();   // migration 213's undo (stamped)
  ctx.S.companies.u2 = {id: "u2", name: "ZZ Undo 2", createOptional: false, createOptionalAt: MIG2, roundOff: "R3"};
  await push("u2");
  ok(server.u2.data.createOptional === true && server.u2.data.createOptionalAt === "2026-11-23T12:00:00.000Z", "B: migration 213's stamped undo survives too");

  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
