// node run_ims.js - documents rejected in IMS: read from 2B's rejected section, found in Tally, kept out of credit
const fs = require("fs"), {load, openBlob} = require("./harness"), {HTML, DATA, CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "gramsOf", "normNameRaw", "nameSim", "ITCT", "CO"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const clone = o => JSON.parse(JSON.stringify(o));
(async () => {
  const f3 = DATA + "/returns_R2B_07AADCV3366N1ZU_032026.json";
  if (!fs.existsSync(f3)){ console.log("  (VMS 2B files not here; skipped)\n\nall passed"); return; }
  const {ctx, x} = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, twoBs: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
  ctx.S.companies = {c: {id: "c", name: "VMS Events Pvt Ltd", gstin: "07AADCV3366N1ZU"}}; ctx.S.coId = "c";
  const J = JSON.parse(fs.readFileSync(f3, "utf8"));
  // the real file: its rejected section is read
  const t0 = x.GST2B.fromJson(clone(J)), rj0 = t0.rows.filter(r => r.rej);
  ok(rj0.length === 5 && rj0.some(r => r.sec === "cdnr" && r.no === "41" && /NO ANY INVOICE/.test(r.remarks)), "March 2026: the 5 documents VMS rejected in IMS are read, with the remark (TBI Consulting credit note 41)");
  ok(rj0.every(r => r.itcavl === "N"), "rejected documents give no credit");
  b.twoBs = {[t0.gstin + "|" + t0.period]: t0};
  const r0 = x.GST2B.run("07");
  ok(r0.rejected.length === 5 && !r0.only2b.some(p => p.rej), "they are kept apart from the bills in 2B, not shown as 'in 2B, not in Tally'");
  const it0 = x.ITCT.items("07").items.filter(i => /^rej/.test(i.cat));
  ok(it0.length === 5 && it0.every(i => !i.open), "none is booked in Tally, so nothing is left to do: settled");
  // plant: reject one March bill that is booked in Tally and matched, and one supplier credit note that is booked
  const pr = r0.pairs.find(p => p.status === "matched" && p.p.sec === "b2b" && p.p.ym === "202603" && p.books.length === 1 && p.books[0].ym === "202603");
  const J2 = clone(J), dd = J2.data.docdata, rj = J2.data.docRejdata = J2.data.docRejdata || {};
  const sup = dd.b2b.find(s => String(s.ctin).toUpperCase() === pr.p.gstin), inv = sup.inv.find(i => x.GST2B.normNo(i.inum) === pr.p.noN);
  sup.inv = sup.inv.filter(i => i !== inv);
  (rj.b2b = rj.b2b || []).push({ctin: sup.ctin, trdnm: sup.trdnm, inv: [Object.assign({}, inv, {remarks: "goods not received"})]});
  // a debit note in Tally for a supplier's credit note, and that credit note rejected
  const dd0 = x.GST2B.bookDocs().filter(d => d.dir < 0 && d.gstin && d.reg === "07" && (d.ym === "202603" || d.ym === "202602") && !r0.pairs.some(p => p.books.some(z => z.id === d.id)) && (d.igst + d.cgst + d.sgst) > 0);
  const dnd = dd0.find(d => d.ym === "202603") || dd0[0], dn = b.vouchers.find(v => v.id === dnd.id), L = {total: dnd.taxable + dnd.igst + dnd.cgst + dnd.sgst, taxable: dnd.taxable, tax: {IGST: dnd.igst, CGST: dnd.cgst, SGST: dnd.sgst}};
  (rj.cdnr = rj.cdnr || []).push({ctin: dnd.gstin, trdnm: dnd.party, nt: [{ntnum: dnd.no, dt: String(dnd.date).slice(6, 8) + "-" + String(dnd.date).slice(4, 6) + "-" + String(dnd.date).slice(0, 4), val: L.total, txval: L.taxable, igst: L.tax.IGST, cgst: L.tax.CGST, sgst: L.tax.SGST, cess: 0, typ: "C", remarks: "rate disputed"}]});
  const dnYm = dnd.ym;
  b.itcBasis = {"07": "books"}; const booksB = x.GSTR.threeB("202603", "07"); b.itcBasis = {};
  const t2 = x.GST2B.fromJson(J2); b.twoBs = {[t2.gstin + "|" + t2.period]: t2}; x.GST2B._memo = null;
  const mar = x.GSTR.threeB("202603", "07"), mdn = x.GSTR.threeB(dnYm, "07"), r2 = x.GST2B.run("07");
  const ri = r2.rejected.find(z => z.p.noN === pr.p.noN), rc = r2.rejected.find(z => z.p.dir < 0 && z.books.length);
  ok(ri && ri.books.length === 1 && ri.books[0].id === pr.books[0].id, "a rejected invoice is found in Tally (" + pr.p.party + " " + pr.p.no + ")");
  ok(mar.held.list.some(d => d.rejected && d.id === pr.books[0].id), "3B: its credit is held back; a rejected invoice gives no credit");
  ok(rc && mar.rejBack.n === 1 && Math.abs(mar.rejBack.igst + mar.rejBack.cgst + mar.rejBack.sgst - (L.tax.IGST + L.tax.CGST + L.tax.SGST)) < 1, "3B: the debit note in Tally for a rejected credit note does not reduce credit while it stays rejected");
  const its = x.ITCT.items("07").items, ii = its.find(i => i.cat === "rejinv" && i.no === pr.p.no), ic = its.find(i => i.cat === "rejcn" && i.open);
  ok(ii && ii.open && ii.act === "keep" && ic, "follow-up: the rejected invoice and credit note that are in Tally are open, to reverse in Tally or accept in IMS");
  const sp = x.ITCT.suppliers("07", its).find(s => s.items.includes(ii)), letter = x.ITCT.letter("07", sp.gstin, sp.party, sp.items).text;
  ok(/rejected in the Invoice Management System/.test(letter) && /goods not received/.test(letter), "the supplier's letter asks them to amend or cancel what was rejected, with the reason");
  // change to accept in IMS: the bill's credit comes back, the note reduces credit again
  const st = x.ITCT.store("07"); st.dec[ii.key] = {act: "accept"}; st.dec[ic.key] = {act: "accept"}; x.GSTR._carry = null;
  const mar2 = x.GSTR.threeB("202603", "07"), mdn2 = x.GSTR.threeB(dnYm, "07");
  ok(!mar2.held.list.some(d => d.rejected) && mar2.rejBack.n === 0, "marked 'change to accept': the credit is taken and the note reduces it");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
