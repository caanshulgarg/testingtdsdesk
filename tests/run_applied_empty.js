// node run_applied_empty.js - the cloud copy's "last seen" (meta.copy.seen) empty or not a time (Sentry, staging, Nov 2026:
// one browser asked for tally_recorder_lines with "applied_at=gt." and nothing after it, about once a minute for three
// hours; the cloud refuses that, so the bridge's changes in that time did not come in). How it becomes empty: the books
// were opened (TCloud.copyHeads in full, or FirstOpen) while the bridge had applied no line yet for the book, so the newest
// line was "" and "" was kept. TCloud.copyHeads must then never send "gt." with nothing after it: it checks the book from
// the start (as on opening) so nothing is missed, and keeps a proper time. Test data only.
const {load, HTML} = require("./harness");
const {restStub} = require("./copy_rest_stub");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "GSTR", "INR",
  "NORM_CACHE", "normName", "normNameRaw", "nameSim", "GSTSet", "GSTF", "GSTQ", "TallyRead", "BookSrc", "TCloud"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const avail = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
["BookSrc", "TCloud", "Books"].forEach(n => { if (!avail.includes(n)) { console.log("FAIL not in the program: " + n); process.exit(1); } });
const {ctx, x} = load(HTML, avail);
const CMP = "07AAACF1234A1ZH";
ctx.S.companies = {t: {id: "t", name: "Test", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t; ctx.whoAmI = () => "tester";
const H = (guid, day, alt, vno) => ({book_id: "B9", guid, day, alter_id: alt, vtype: "Sales", vno, party: "Alpha", narration: "", cancelled: false, optional: false, deleted_at: null, gstin: "", pos: "", ref: "", ref_date: null, cmp_gstin: CMP, irn: "", irn_ack_date: null});
const Ln = (guid, ledger, amount) => ({book_id: "B9", guid, ledger, amount, hsn: "", rate: null});
const books = () => { const b = {cid: "t", vouchers: [], meta: {from: "20260401", to: "20260731", gstins: [CMP]}, under: {}, groups: {}, gstins: {}, pans: {}, states: {}, challans: [], alloc: {}, certs: []}; ctx.S.books = b; return b; };
// the cloud, as PostgREST: a "gt." with no value (or not a time) on applied_at is refused (22007), as staging did
const cloud = (T) => {
  const st = restStub(T), bad = [];
  const api = async (path) => {
    const m = /[?&]applied_at=gt\.([^&]*)/.exec(path);
    if (m && !Date.parse(decodeURIComponent(m[1]))){ bad.push(path); st.asked.push(path); const e = new Error('invalid input syntax for type timestamp with time zone: "' + decodeURIComponent(m[1]) + '" (22007)'); e.code = "22007"; throw e; }
    return st.api(path);
  };
  return {api, asked: st.asked, bad};
};
(async () => {
  const bk = {book: "B9"};
  // ---- 1. opened while the bridge had applied no line: "" kept
  const T = {tally_vouchers: [H("e-1", "2026-05-10", 3, "S/1")], tally_lines: [Ln("e-1", "Alpha", -118), Ln("e-1", "Sales", 100), Ln("e-1", "Output IGST", 18)], tally_bills: [], tally_recorder_lines: []};
  let cl = cloud(T); ctx.Cloud = {api: cl.api};
  const b = books();
  let c = await x.TCloud.copyHeads(b, bk, true); await x.TCloud.copyInto(b, bk, c);
  ok(b.vouchers.length === 1 && b.meta.copy.book === "B9" && b.meta.copy.seen === "", "1. opened with no bridge line yet: the books in, last seen kept empty (" + JSON.stringify(b.meta.copy.seen) + ")");
  // ---- 2. the bridge then sends a new entry and an altered one; the next look (not in full) must not send "gt." empty
  T.tally_vouchers = [H("e-1", "2026-05-10", 4, "S/1"), H("e-2", "2026-05-11", 5, "S/2")];
  T.tally_lines = [Ln("e-1", "Alpha", -236), Ln("e-1", "Sales", 200), Ln("e-1", "Output IGST", 36), Ln("e-2", "Alpha", -59), Ln("e-2", "Sales", 50), Ln("e-2", "Output IGST", 9)];
  T.tally_recorder_lines = [{id: 1, book_id: "B9", object_guid: "e-1", state: "applied", applied_at: "2026-11-23T05:50:00+00:00"}, {id: 2, book_id: "B9", object_guid: "e-2", state: "applied", applied_at: "2026-11-23T05:54:00+00:00"}];
  cl.asked.length = 0;
  let err = "";
  try { c = await x.TCloud.copyHeads(b, bk, false); await x.TCloud.copyInto(b, bk, c); } catch (e){ err = String(e.message || e); }
  ok(!err && !cl.bad.length, "2. last seen empty: no \"applied_at=gt.\" with nothing after it" + (err ? " (" + err + ")" : "") + (cl.bad.length ? " asked: " + cl.bad[0] : ""));
  ok(!cl.asked.some(q => /applied_at=gt\.(&|$)/.test(q)), "2. no query has an empty applied_at filter");
  ok(b.vouchers.length === 2 && (b.vouchers.find(v => v.id === "e-1") || {}).alt == 4, "2. both the bridge's changes came in (from the start of the book): " + b.vouchers.map(v => v.no + "@" + v.alt).join(", "));
  ok(b.meta.copy.seen === "2026-11-23T05:54:00+00:00", "2. a proper last seen kept: " + JSON.stringify(b.meta.copy.seen));
  // ---- 3. with a proper value kept, the next look is the small one again (only lines since)
  T.tally_vouchers.push(H("e-3", "2026-05-12", 6, "S/3")); T.tally_lines.push(Ln("e-3", "Alpha", -118), Ln("e-3", "Sales", 100), Ln("e-3", "Output IGST", 18));
  T.tally_recorder_lines.push({id: 3, book_id: "B9", object_guid: "e-3", state: "applied", applied_at: "2026-11-23T06:10:00+00:00"});
  cl.asked.length = 0;
  c = await x.TCloud.copyHeads(b, bk, false); await x.TCloud.copyInto(b, bk, c);
  ok(cl.asked.some(q => /applied_at=gt\.2026-11-23T05%3A54%3A00%2B00%3A00/.test(q)) && c.heads.length === 1 && b.vouchers.length === 3 && b.meta.copy.seen === "2026-11-23T06:10:00+00:00", "3. then only the lines since: " + c.heads.length + " head, " + b.vouchers.length + " entries");
  // ---- 4. a last seen that is not a time (a damaged copy): the same, from the start, no "gt.garbage"
  b.meta.copy.seen = "not a time";
  T.tally_vouchers[2] = H("e-3", "2026-05-12", 7, "S/3");
  cl.asked.length = 0; err = "";
  try { c = await x.TCloud.copyHeads(b, bk, false); await x.TCloud.copyInto(b, bk, c); } catch (e){ err = String(e.message || e); }
  ok(!err && !cl.bad.length && (b.vouchers.find(v => v.id === "e-3") || {}).alt == 7 && b.meta.copy.seen === "2026-11-23T06:10:00+00:00", "4. last seen not a time: read from the start, the change in, a proper value kept" + (err ? " (" + err + ")" : ""));
  // ---- 5. still no line from the bridge at all: nothing read, nothing refused (no full read every minute)
  const T5 = {tally_vouchers: [H("e-9", "2026-05-10", 1, "S/9")], tally_lines: [Ln("e-9", "Alpha", -118), Ln("e-9", "Sales", 100), Ln("e-9", "Output IGST", 18)], tally_bills: [], tally_recorder_lines: []};
  cl = cloud(T5); ctx.Cloud = {api: cl.api};
  const b5 = books();
  c = await x.TCloud.copyHeads(b5, bk, true); await x.TCloud.copyInto(b5, bk, c);
  cl.asked.length = 0;
  c = await x.TCloud.copyHeads(b5, bk, false);
  ok(!c.changes && !cl.bad.length && !cl.asked.some(q => /^tally_vouchers/.test(q)), "5. no bridge line yet and nothing new: no entry read, nothing refused");
  console.log(fails ? "FAILED " + fails : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("FAIL " + (e && e.stack || e)); process.exit(1); });
