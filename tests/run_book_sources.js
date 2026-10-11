// node run_book_sources.js - round 44 (the owner's decision of 11-Oct-2026): TDS, TCS, GSTR-1, GSTR-3B, the amendments and
// the challans read the entries from both the Day Book uploaded and the bridge (FinCom's cloud copy), one entry per Tally
// GUID, the later version by AlterID, never counted twice (BookSrc, src/js/67; TCloud.copyHeads / copyInto, src/js/49).
// Test data only.
//   1. the Day Book's AlterID is read with each entry
//   2. the cloud copy's rows become entries as the Day Book makes them (signs, amounts to the paisa, HSN, rate, bills,
//      cancelled kept for table 13, optional marked)
//   3. the same entry both ways, same AlterID: once, the Day Book's; GSTR-1 and TDS count it once
//   4. a later version from the bridge wins (its amounts), says "Bridge", keeps the Day Book's GST kind; TDS and GST follow
//   5. a later Day Book version wins over an older copy; a Day Book without AlterIDs stays until read again
//   6. an entry only the bridge sent is in the returns, said "Bridge"
//   7. deleted in Tally (the copy marks it): out of the books, kept as gone; a later version held stays
//   8. cancelled and optional entries from the bridge are left out of the returns as the Day Book's are
//   9. a month of the Day Book read again does not take the bridge's entries for deleted, and they stay
//  10. a filed TDS return whose entry the bridge altered after filing: the correction is seen (T-S2)
//  11. TCloud reads only the cloud copy's tables (no new database function): every head on opening, then only the
//      entries the bridge's lines brought since (applied_at), and lines and bills only for what changes the books
//  12. each ledger's PAN as the bridge sent it reaches the deductee rows when the books have none
const {load, HTML} = require("./harness");
const {restStub} = require("./copy_rest_stub");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR",
  "NORM_CACHE", "normName", "normNameRaw", "nameSim", "GSTSet", "GSTF", "GSTQ", "TallyRead", "BookSrc", "TCloud", "TDSDrift", "TDSFiled"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const avail = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
["BookSrc", "TCloud", "TallyRead", "Books", "TDS", "GSTR", "TDSDrift"].forEach(n => { if (!avail.includes(n)) { console.log("FAIL not in the program: " + n); process.exit(1); } });
const {ctx, x} = load(HTML, avail);
const CMP = "07AAACF1234A1ZH", reg = "07";
ctx.S.companies = {t: {id: "t", name: "Test", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t; ctx.whoAmI = () => "tester";
const G = {h: "8471", gr: 18};
// a Day Book entry (as Books.importDayBook makes it): [ledger, amount (debit negative), {h, gr}]
const V = (id, type, date, no, party, ent, extra) => Object.assign({id, type, date, no, party, gstin: "", pos: "", cmp: CMP, narr: "", ent: ent.map(([l, a, o]) => Object.assign({l, a}, o || {})), hsn: [], alt: 1}, extra || {});
// the cloud copy's rows, as the REST reads return them
const H = (guid, day, alt, vtype, vno, party, o) => Object.assign({book_id: "B1", guid, day, alter_id: alt, vtype, vno, party, narration: "", cancelled: false, optional: false, deleted_at: null, gstin: "", pos: "", ref: "", ref_date: null, cmp_gstin: CMP, irn: "", irn_ack_date: null}, o || {});
const Ln = (guid, ledger, amount, o) => Object.assign({book_id: "B1", guid, ledger, amount, hsn: "", rate: null}, o || {});
function books(vs){
  const b = {cid: "t", vouchers: vs, meta: {from: "20260401", to: "20260731", gstins: [CMP], bills: 1},
    under: {"Sales": "Sales Accounts", "Purchases": "Purchase Accounts", "Rent": "Indirect Expenses", "Alpha": "Sundry Debtors", "Beta": "Sundry Debtors", "Gamma": "Sundry Debtors", "Lessor": "Sundry Creditors", "Bank": "Bank Accounts"},
    groups: {"Sales Accounts": "Primary", "Purchase Accounts": "Primary", "Sundry Debtors": "Primary", "Sundry Creditors": "Primary", "Indirect Expenses": "Primary", "Bank Accounts": "Primary"}, gstins: {}, pans: {}, states: {}, challans: [], alloc: {}, certs: []};
  b.map = x.Books.mapLedgers(vs, {});
  const set = (n, o) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, {ok: true, byHand: true}); };
  set("Output IGST", {what: "gst", kind: "gst", tax: "IGST", side: "output", reg}); set("Output CGST", {what: "gst", kind: "gst", tax: "CGST", side: "output", reg}); set("Output SGST", {what: "gst", kind: "gst", tax: "SGST", side: "output", reg});
  set("TDS Payable 194I", {what: "tds_payable", kind: "tds_payable", section: "194I"});
  ctx.S.books = b; return b;
}
const sales = (ym) => x.GSTR.outward(ym, reg);
const taxable = (ym) => Math.round(sales(ym).reduce((a, r) => a + r.taxable, 0) * 100) / 100;
(async () => {
  // ---- 1. the Day Book's AlterID
  const xml = '<ENVELOPE><VOUCHER REMOTEID="g-1" VCHTYPE="Sales"><DATE>20260502</DATE><GUID>g-1</GUID><ALTERID> 28</ALTERID><VOUCHERNUMBER>S/1</VOUCHERNUMBER><PARTYLEDGERNAME>Alpha</PARTYLEDGERNAME>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Alpha</LEDGERNAME><AMOUNT>-118.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>100.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>' +
    '<VOUCHER REMOTEID="g-2" VCHTYPE="Sales"><DATE>20260502</DATE><GUID>g-2</GUID><VOUCHERNUMBER>S/2</VOUCHERNUMBER><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>1.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></ENVELOPE>';
  const db = await x.Books.importDayBook(new Blob([xml], {type: "text/xml"}));
  ok(db.vouchers[0].alt === 28 && db.vouchers[1].alt === null, "1. the Day Book's AlterID read with each entry (28; none given: not known) " + JSON.stringify(db.vouchers.map(v => v.alt)));
  ok(!db.vouchers[0].src && x.BookSrc.words(db.vouchers[0]) === "Day Book", "1. an entry from the Day Book says \"Day Book\"");

  // ---- 2. the cloud copy's rows as entries
  const heads2 = [H("c-1", "2026-05-03", "41", "Sales", "S/9", "Beta", {gstin: "07aabcb2222b1zi", pos: "Delhi", ref: "PO-7", ref_date: "2026-05-01", irn: "IRN1", irn_ack_date: "2026-05-03", cancelled: "false", optional: "false"}),
    H("c-2", "2026-05-04", 42, "Sales", "S/10", "", {cancelled: true}), H("c-3", "2026-05-04", 43, "Sales", "OPT/1", "Beta", {optional: true}), H("c-4", "2026-05-05", 44, "Sales", "S/11", "Beta", {deleted_at: "2026-10-10T00:00:00Z"})];
  const lines2 = [Ln("c-1", "Beta", "-11800.57"), Ln("c-1", "Sales", 10000.48, {hsn: "8471", rate: "18"}), Ln("c-1", "Output CGST", 900.05), Ln("c-1", "Output SGST", 900.04), Ln("c-3", "Beta", -118), Ln("c-3", "Sales", 100), Ln("c-3", "Output IGST", 18)];
  const bills2 = [{book_id: "B1", guid: "c-1", ledger: "Beta", name: "S/9", type: "New Ref", amount: "-11800.57", credit_days: 30}];
  const cv = x.BookSrc.fromCopy(heads2, lines2, bills2), c1 = cv.find(v => v.id === "c-1");
  ok(cv.length === 3 && !cv.find(v => v.id === "c-4"), "2. every live entry of the copy made (the deleted one is not): " + cv.map(v => v.id).join(","));
  ok(c1.date === "20260503" && c1.type === "Sales" && c1.no === "S/9" && c1.party === "Beta" && c1.gstin === "07AABCB2222B1ZI" && c1.pos === "Delhi" && c1.ref === "PO-7" && c1.refDate === "20260501" && c1.irn === "IRN1" && c1.cmp === CMP,
    "2. the entry's date, type, number, party, GSTIN, place of supply, reference and IRN as the Day Book has them");
  ok(JSON.stringify(c1.ent.map(e => [e.l, e.a])) === JSON.stringify([["Beta", -11800.57], ["Sales", 10000.48], ["Output CGST", 900.05], ["Output SGST", 900.04]]), "2. every line's amount to the paisa, Tally's sign (debit negative)");
  ok(c1.ent[1].h === "8471" && c1.ent[1].gr === 18 && c1.hsn.join() === "8471", "2. the line's HSN and GST rate");
  ok(JSON.stringify(c1.ent[0].b) === JSON.stringify([["S/9", "New Ref", -11800.57, 30]]), "2. the bill-wise details on the party's line " + JSON.stringify(c1.ent[0].b));
  ok(c1.alt === 41 && c1.src === "bridge" && x.BookSrc.words(c1) === "Bridge", "2. its AlterID kept and it says \"Bridge\"");
  ok(cv.find(v => v.id === "c-2").cancel === true && cv.find(v => v.id === "c-3").opt === true, "2. a cancelled entry kept (for table 13), an optional one marked");

  // ---- 3. the same entry both ways, the same AlterID: once, the Day Book's
  const s1 = () => V("g-s1", "Sales", "20260510", "S/1", "Alpha", [["Alpha", -118000], ["Sales", 100000, G], ["Output CGST", 9000], ["Output SGST", 9000]], {gstin: "07AABCA1111A1ZT", pos: "Delhi", alt: 5, regType: "Regular"});
  let b = books([s1()]);
  const before3 = taxable("202605");
  let n = x.BookSrc.apply(b, [H("g-s1", "2026-05-10", 5, "Sales", "S/1", "Alpha", {gstin: "07AABCA1111A1ZT", pos: "Delhi"})], [Ln("g-s1", "Alpha", -118000), Ln("g-s1", "Sales", 100000), Ln("g-s1", "Output CGST", 9000), Ln("g-s1", "Output SGST", 9000)], []);
  ok(n === 0 && b.vouchers.length === 1 && !b.vouchers[0].src && b.vouchers[0].regType === "Regular", "3. the same version both ways is one entry, the Day Book's (" + b.vouchers.length + ")");
  ok(before3 === 100000 && taxable("202605") === 100000 && sales("202605").length === 1, "3. GSTR-1 counts it once: taxable " + taxable("202605"));
  ok(JSON.stringify(x.BookSrc.counts(b)) === JSON.stringify({bridge: 0, daybook: 1}), "3. counted: 1 from the Day Book, 0 from the bridge");

  // ---- 4. a later version from the bridge wins, says "Bridge", keeps the Day Book's GST kind
  b = books([s1()]);
  n = x.BookSrc.apply(b, [H("g-s1", "2026-05-10", 9, "Sales", "S/1", "Alpha", {gstin: "07AABCA1111A1ZT", pos: "Delhi"})], [Ln("g-s1", "Alpha", -129800), Ln("g-s1", "Sales", 110000, {hsn: "8471", rate: 18}), Ln("g-s1", "Output CGST", 9900), Ln("g-s1", "Output SGST", 9900)], []);
  const v4 = b.vouchers[0];
  ok(n === 1 && b.vouchers.length === 1 && v4.src === "bridge" && v4.alt === 9, "4. the later version (AlterID 9 over 5) replaces the Day Book's, one entry, says Bridge");
  ok(taxable("202605") === 110000 && sales("202605")[0].cgst === 9900 && sales("202605")[0].src === "bridge", "4. GSTR-1 has the altered figures (110000, CGST 9900) and the row says where it came from");
  ok(v4.regType === "Regular" && JSON.stringify(v4.carried) === JSON.stringify(["regType"]), "4. the Day Book's GST kind (not in the bridge's entry yet) is kept: " + JSON.stringify(v4.carried));
  x.BookSrc.apply(b, [H("g-s1", "2026-05-10", 11, "Sales", "S/1", "Alpha", {gstin: "07AABCA1111A1ZT", pos: "Delhi"})], [Ln("g-s1", "Alpha", -118000), Ln("g-s1", "Sales", 100000), Ln("g-s1", "Output CGST", 9000), Ln("g-s1", "Output SGST", 9000)], []);
  ok(b.vouchers.length === 1 && b.vouchers[0].alt === 11 && b.vouchers[0].regType === "Regular" && taxable("202605") === 100000, "4. altered again through the bridge (AlterID 11): still one entry, the GST kind still kept");

  // ---- 5. a later Day Book version wins; a Day Book without AlterIDs stays
  b = books([Object.assign(s1(), {alt: 12})]);
  n = x.BookSrc.apply(b, [H("g-s1", "2026-05-10", 9, "Sales", "S/1", "Alpha")], [Ln("g-s1", "Alpha", -1), Ln("g-s1", "Sales", 1)], []);
  ok(n === 0 && !b.vouchers[0].src && taxable("202605") === 100000, "5. the Day Book's later version (12 over 9) stays");
  b = books([Object.assign(s1(), {alt: null})]);
  n = x.BookSrc.apply(b, [H("g-s1", "2026-05-10", 9, "Sales", "S/1", "Alpha")], [Ln("g-s1", "Alpha", -1), Ln("g-s1", "Sales", 1)], []);
  ok(n === 0 && !b.vouchers[0].src && taxable("202605") === 100000, "5. a Day Book kept from before AlterIDs were read stays until it is read again");

  // ---- 6. an entry only the bridge sent: in the returns, said Bridge; TDS too
  b = books([s1()]);
  n = x.BookSrc.apply(b, [H("g-r1", "2026-05-12", 30, "Journal", "JV/1", "Lessor")], [Ln("g-r1", "Rent", -60000), Ln("g-r1", "TDS Payable 194I", 6000), Ln("g-r1", "Lessor", 54000)], []);
  const tr = x.TDS.rows().filter(r => r.party === "Lessor");
  ok(n === 1 && tr.length === 1 && tr[0].tds === 6000 && tr[0].paid === 60000 && tr[0].src === "bridge", "6. a TDS entry only the bridge sent is a deductee row (paid 60000, TDS 6000), said Bridge: " + JSON.stringify(tr.map(r => [r.paid, r.tds, r.src])));
  ok(x.TDS.rows().length === 1 && sales("202605").length === 1 && sales("202605")[0].src === "daybook", "6. the Day Book's sale stays, said Day Book");

  // ---- 7. deleted in Tally
  b = books([s1(), V("g-s2", "Sales", "20260511", "S/2", "Gamma", [["Gamma", -11800], ["Sales", 10000, G], ["Output CGST", 900], ["Output SGST", 900]], {alt: 6})]);
  n = x.BookSrc.apply(b, [H("g-s2", "2026-05-11", 6, "Sales", "S/2", "Gamma", {deleted_at: "2026-10-10T10:00:00Z"}), H("g-s1", "2026-05-10", 4, "Sales", "S/1", "Alpha", {deleted_at: "2026-10-10T10:00:00Z"})], [], []);
  ok(n === 1 && b.vouchers.map(v => v.id).join() === "g-s1" && b.gone && b.gone["g-s2"] && b.gone["g-s2"].v.no === "S/2", "7. the entry deleted in Tally leaves the books, kept as gone; the one held at a later version (5 over 4) stays");
  ok(taxable("202605") === 100000, "7. GSTR-1 without the deleted invoice: " + taxable("202605"));

  // ---- 8. cancelled and optional from the bridge: out of the returns
  b = books([s1()]);
  x.BookSrc.apply(b, heads2.concat([H("g-x", "2026-05-13", 50, "Sales", "S/12", "", {cancelled: true})]), lines2, bills2);
  const nos = sales("202605").map(r => r.no);
  ok(!nos.includes("OPT/1") && !nos.includes("S/10") && !nos.includes("S/12") && nos.includes("S/9") && nos.includes("S/1"), "8. the optional and cancelled entries the bridge sent are in no table: " + nos.join(","));
  const j8 = x.GSTR.toJson("202605", reg), docs = JSON.stringify(j8.doc_issue || {});
  ok(/S\/10|S\/12/.test(docs) || /"cancel":[1-9]/.test(docs), "8. a cancelled number still counts in table 13 (documents issued)");

  // ---- 9. a month of the Day Book read again: the bridge's entries are not taken for deleted
  b = books([s1()]);
  x.BookSrc.apply(b, [H("g-b1", "2026-05-20", 31, "Sales", "S/3", "Gamma")], [Ln("g-b1", "Gamma", -1180), Ln("g-b1", "Sales", 1000, G), Ln("g-b1", "Output CGST", 90), Ln("g-b1", "Output SGST", 90)], []);
  const keep = x.BookSrc.stash(b);
  x.TallyRead.merge(b, {vouchers: [s1()], meta: {gstins: [CMP]}}, "20260501", "20260531");
  x.BookSrc.restore(b, keep);
  ok(b.vouchers.length === 2 && !(b.gone || {})["g-b1"] && b.vouchers.find(v => v.id === "g-b1").src === "bridge" && taxable("202605") === 101000, "9. after May of the Day Book is read again the bridge's S/3 is still there, not gone: " + taxable("202605"));
  // the Day Book read again now has it too (a later upload): one entry, the Day Book's
  const keep2 = x.BookSrc.stash(b);
  x.TallyRead.merge(b, {vouchers: [s1(), V("g-b1", "Sales", "20260520", "S/3", "Gamma", [["Gamma", -1180], ["Sales", 1000, G], ["Output CGST", 90], ["Output SGST", 90]], {alt: 31})], meta: {gstins: [CMP]}}, "20260501", "20260531");
  x.BookSrc.restore(b, keep2);
  ok(b.vouchers.length === 2 && !b.vouchers.find(v => v.id === "g-b1").src && taxable("202605") === 101000, "9. uploaded later in a Day Book too: one entry (the Day Book's), not two");

  // ---- 10. a filed TDS return, then the bridge alters an entry in it (T-S2)
  b = books([V("g-t1", "Journal", "20260512", "JV/1", "Lessor", [["Rent", -60000], ["TDS Payable 194I", 6000], ["Lessor", 54000]], {alt: 30})]);
  if (x.TDSDrift && x.TDSFiled && x.TDS.formRows){
    x.TDSDrift.keep("2026-27", "Q1", "26Q");
    x.BookSrc.apply(b, [H("g-t1", "2026-05-12", 33, "Journal", "JV/1", "Lessor")], [Ln("g-t1", "Rent", -70000), Ln("g-t1", "TDS Payable 194I", 7000), Ln("g-t1", "Lessor", 63000)], []);
    const d = x.TDSDrift.check("2026-27", "Q1", "26Q");
    ok(d && d.rows.length === 1 && d.rows[0].what === "changed" && /amount/.test(d.rows[0].words) && /TDS/.test(d.rows[0].words), "10. the filed Q1's entry altered through the bridge is seen for a correction: " + JSON.stringify(d && d.rows));
  } else ok(false, "10. TDSDrift / TDSFiled / TDS.formRows not in the program");

  // ---- 11. TCloud reads the cloud copy's own tables: every head on opening, then only what the bridge's lines brought
  b = books([s1()]);
  const T = {tally_vouchers: [H("g-s1", "2026-05-10", 5, "Sales", "S/1", "Alpha"), H("g-n1", "2026-05-14", 40, "Sales", "S/4", "Beta")],
    tally_lines: [Ln("g-s1", "Alpha", -118000), Ln("g-s1", "Sales", 100000), Ln("g-s1", "Output CGST", 9000), Ln("g-s1", "Output SGST", 9000), Ln("g-n1", "Beta", -2360), Ln("g-n1", "Sales", 2000, G), Ln("g-n1", "Output CGST", 180), Ln("g-n1", "Output SGST", 180)],
    tally_bills: [], tally_recorder_lines: [{id: 1, book_id: "B1", object_guid: "g-n1", state: "applied", applied_at: "2026-10-11T05:00:00+00:00"}]};
  const st = restStub(T); ctx.Cloud = {api: st.api};
  const bk = {book: "B1"};
  let c = await x.TCloud.copyHeads(b, bk, true);
  ok(c.changes && c.heads.length === 2 && c.seen === "2026-10-11T05:00:00+00:00", "11. opening the client: every head read, a change found (S/4 not in the books)");
  await x.TCloud.copyInto(b, bk, c);
  const linesAsked = st.asked.filter(q => /^tally_lines/.test(q));
  ok(linesAsked.length === 1 && /g-n1/.test(linesAsked[0]) && !/g-s1/.test(linesAsked[0]), "11. lines read only for the entry that changes the books (S/4), not for S/1 held at the same version");
  ok(b.vouchers.length === 2 && taxable("202605") === 102000 && b.meta.copy.seen === c.seen, "11. S/4 in the books; GSTR-1 taxable " + taxable("202605"));
  ok(st.asked.every(q => /^(tally_vouchers|tally_lines|tally_bills|tally_recorder_lines)\?/.test(q)), "11. only the cloud copy's tables are read (no new database function): " + Array.from(new Set(st.asked.map(q => q.split("?")[0]))).join(", "));
  // nothing new since: no head read at all
  st.asked.length = 0;
  c = await x.TCloud.copyHeads(b, bk, false);
  ok(!c.changes && c.heads.length === 0 && !st.asked.some(q => /^tally_vouchers/.test(q)), "11. nothing new since the last look: no entry read (" + st.asked.length + " small read)");
  // the bridge alters S/1 (AlterID 7): only it is read
  T.tally_vouchers[0] = H("g-s1", "2026-05-10", 7, "Sales", "S/1", "Alpha");
  T.tally_lines = T.tally_lines.filter(l => l.guid !== "g-s1").concat([Ln("g-s1", "Alpha", -59000), Ln("g-s1", "Sales", 50000), Ln("g-s1", "Output CGST", 4500), Ln("g-s1", "Output SGST", 4500)]);
  T.tally_recorder_lines.push({id: 2, book_id: "B1", object_guid: "g-s1", state: "applied", applied_at: "2026-10-11T06:00:00+00:00"});
  st.asked.length = 0;
  c = await x.TCloud.copyHeads(b, bk, false);
  ok(c.changes && c.heads.length === 1 && c.heads[0].guid === "g-s1", "11. the bridge's line since: only that entry's head read");
  await x.TCloud.copyInto(b, bk, c);
  ok(taxable("202605") === 52000 && b.vouchers.find(v => v.id === "g-s1").src === "bridge", "11. the altered S/1 (50000) replaces the Day Book's: taxable " + taxable("202605"));
  // a cloud without the IRN columns (before migration 57) is read as before
  const T2 = {tally_vouchers: [{book_id: "B1", guid: "g-o1", day: "2026-05-15", alter_id: 2, vtype: "Sales", vno: "S/5", party: "Beta", narration: "", cancelled: false, optional: false, deleted_at: null, gstin: "", pos: "", ref: "", ref_date: null, cmp_gstin: CMP}],
    tally_lines: [Ln("g-o1", "Beta", -118), Ln("g-o1", "Sales", 100, G), Ln("g-o1", "Output IGST", 18)], tally_bills: [], tally_recorder_lines: []};
  b = books([]); ctx.Cloud = {api: restStub(T2).api};
  c = await x.TCloud.copyHeads(b, bk, true); await x.TCloud.copyInto(b, bk, c);
  ok(b.vouchers.length === 1 && b.vouchers[0].no === "S/5", "11. a cloud copy without the IRN columns is read as before");

  // ---- 12. each ledger's PAN as the bridge sent it
  b = books([V("g-t2", "Journal", "20260512", "JV/2", "Lessor", [["Rent", -60000], ["TDS Payable 194I", 6000], ["Lessor", 54000]], {alt: 3})]);
  x.BookSrc.ledgersInto(b, [{name: "Lessor", parent: "Sundry Creditors", pan: "abcps1234f", gstin: ""}, {name: "Bad", pan: "NOTAPAN"}], "2026-10-11T00:00:00Z");
  ok(x.TDS.rows()[0].pan === "ABCPS1234F" && !b.pans.Bad, "12. the ledger's PAN from the bridge reaches the deductee row: " + x.TDS.rows()[0].pan);
  b.ledInfoAt = "2026-10-10T00:00:00Z";
  x.BookSrc.ledgersInto(b, [{name: "Lessor", pan: "ABCPS9999F"}], "2026-10-11T00:00:00Z");
  ok(x.TDS.rows()[0].pan === "ABCPS9999F", "12. a PAN corrected in Tally (the list newer than the masters read) is taken");
  x.BookSrc.ledgersInto(b, [{name: "Lessor", pan: "ABCPS1111F"}], "2026-10-09T00:00:00Z");
  ok(x.TDS.rows()[0].pan === "ABCPS9999F", "12. an older list does not undo the masters' PAN");

  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
