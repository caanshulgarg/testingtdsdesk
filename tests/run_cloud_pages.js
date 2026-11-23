// node run_cloud_pages.js - next-speed-2 (the speed plan of 22-Nov-2026, #11): how a client's entries come from FinCom's cloud
// copy of Tally (TCloud, src/js/49-tally-cloud.js), on a made-up book of 2,500 entries answered in this script.
//   1. a book's entries in GUID order are read page after page from the last GUID (guid=gt.), never by an offset; the same
//      rows in the same order as the whole list; an entry without its GUID stops the read (never a page skipped);
//      a server that does not take the filter: the rest by offset, nothing read twice;
//   2. any other list (no GUID order, or not one book's entries) by offset, as before;
//   3. GUIDs asked 40 to a request (the gateway's address limit), 4 requests at a time (one after another before); the
//      answers in the chunks' order.
const {load, HTML} = require("./harness");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {ctx, x} = load(HTML, ["TCloud"]);
const T = x.TCloud;
const ROWS = Array.from({length: 2500}, (_, i) => ({guid: "zz-" + String(i * 7919 % 100003).padStart(6, "0") + "-0001", alter_id: i + 1})).sort((a, b) => a.guid < b.guid ? -1 : 1);
let asked = [], live = 0, most = 0;
ctx.Cloud = {api: async (path) => {
  asked.push(path); live++; most = Math.max(most, live);
  await new Promise(r => setTimeout(r, 15));
  live--;
  const q = new URLSearchParams(path.slice(path.indexOf("?") + 1));
  let rows = ROWS.slice();
  const gin = q.getAll("guid").find(v => v.startsWith("in.")), ggt = q.getAll("guid").find(v => v.startsWith("gt."));
  if (gin) { const s = new Set(gin.slice(4, -1).split(",").map(v => v.replace(/^"|"$/g, ""))); rows = rows.filter(r => s.has(r.guid)); }
  if (ggt) rows = rows.filter(r => r.guid > ggt.slice(3));
  const off = +(q.get("offset") || 0), lim = +(q.get("limit") || 1e9);
  return rows.slice(off, off + lim);
}};
(async () => {
  console.log("== 1. one book's entries in GUID order: keyset");
  const thin = await T.restPages("tally_vouchers?select=guid,alter_id&book_id=eq.b-1&order=guid.asc");
  ok(thin.length === 2500 && thin.every((r, i) => r.guid === ROWS[i].guid), "1. the same 2,500 entries in the same order (" + thin.length + ")");
  ok(asked.length === 3 && !asked.some(a => /offset=/.test(a)) && asked.slice(1).every(a => /&guid=gt\./.test(a)), "1. pages from the last GUID, no offset (" + asked.map(a => a.replace(/^.*?&book_id=eq\.b-1/, "")).join(" | ") + ")");
  let err = null;
  const keep = ctx.Cloud.api; ctx.Cloud.api = async (p) => { const r = await keep(p); return r.map((z, i) => i === r.length - 1 ? {alter_id: z.alter_id} : z); };
  try { await T.restPages("tally_vouchers?select=guid,alter_id&book_id=eq.b-1&order=guid.asc"); } catch (e) { err = e; }
  ctx.Cloud.api = keep;
  ok(!!err, "1. an entry without its GUID stops the read (" + (err && err.message) + ")");
  ctx.Cloud.api = async (p) => keep(p.replace(/&guid=gt\.[^&]*/, ""));       // a server that does not take the GUID filter
  const all = await T.restPages("tally_vouchers?select=guid,alter_id&book_id=eq.b-1&order=guid.asc");
  ctx.Cloud.api = keep;
  ok(all.length === 2500 && new Set(all.map(r => r.guid)).size === 2500, "1. a server without the GUID filter: the rest by offset, nothing twice (" + all.length + ")");
  console.log("== 2. other lists: by offset");
  asked = [];
  await T.restPages("tally_lines?select=guid,ledger&book_id=eq.b-1&order=guid.asc");
  ok(asked.length === 3 && asked.every(a => /offset=/.test(a)), "2. lines by offset as before (" + asked.length + ")");
  asked = [];
  await T.restPages("tally_vouchers?select=guid&book_id=eq.b-1&order=day.asc,guid.asc");
  ok(asked.every(a => /offset=/.test(a)), "2. entries in another order: by offset");
  console.log("== 3. GUIDs 40 a request, 4 at a time");
  ok(typeof T.byChunks === "function", "3. TCloud.byChunks");
  if (typeof T.byChunks === "function") {
    asked = []; most = 0;
    const want = ROWS.slice(0, 300).map(r => r.guid);
    const t0 = Date.now();
    const got = [].concat(...await T.byChunks(want, c => ctx.Cloud.api("tally_vouchers?select=guid&book_id=eq.b-1&guid=in.(" + c.map(g => '"' + g + '"').join(",") + ")&order=guid.asc&limit=1000&offset=0")));
    ok(asked.length === 8 && asked.every(a => (a.match(/"zz-/g) || []).length <= 40), "3. 300 GUIDs: 8 requests of 40 at most (" + asked.length + ")");
    ok(most === 4, "3. 4 at a time (" + most + ")");
    ok(got.length === 300 && got.every((r, i) => r.guid === want[i]), "3. the answers in the chunks' order");
    console.log("  info 8 requests of 15 ms: " + (Date.now() - t0) + " ms (one after another: about 120 ms)");
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("ERROR " + (e && e.stack || e)); process.exit(1); });
