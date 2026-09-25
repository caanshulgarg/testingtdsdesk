// node run_custims.js - our invoices and credit notes rejected by customers in IMS; and what is saved with the books
const fs = require("fs"), {load, openBlob, HTML, DATA, CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "normName", "ITCT", "CustIMS", "Help", "CO"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  const {ctx, x} = load(HTML, NAMES);
  // everything typed on the GST screens goes with the books when they are saved
  const src = fs.readFileSync(HTML, "utf8"), sv = (src.match(/async function saveBooks\(\)\{[\s\S]*?\}\); \}/) || [""])[0];
  ["gst3b", "gst9", "gstOpen", "itcBasis", "itcTrack", "outRej"].forEach(k => ok(new RegExp("\\b" + k + ": b\\." + k + "\\b").test(sv), "saved with the books: " + k));
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, twoBs: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
  ctx.S.companies = {c: {id: "c", name: "VMS Events Pvt Ltd", gstin: "07AADCV3366N1ZU"}}; ctx.S.coId = "c";
  const docs = x.CustIMS.docs("07"), cn = docs.find(r => r.kind === "CDNR" && r.date >= "20251001" && r.date < "20260201"), inv = docs.find(r => r.kind === "B2B" && r.date >= "20260101");
  ok(docs.length > 100 && cn && inv, "invoices and notes to registered customers found in the books (" + docs.length + ")");
  ok(x.CustIMS.find("07", cn.no).some(r => r.id === cn.id), "found by its number: credit note " + cn.no + " to " + cn.party);
  const ym = x.GSTR.ym(cn.date), next = x.CustIMS.nextYm(ym), tax = r => Math.round((r.igst + r.cgst + r.sgst) * 100) / 100;
  const before = x.GSTR.threeB(next, "07").net, beforeCn = x.GSTR.threeB(ym, "07").net;
  const s = x.CustIMS.add("07", cn.id); s.rejYm = ym; s.addYm = next; x.GSTR._carry = null;
  const after = x.GSTR.threeB(next, "07"), afterCn = x.GSTR.threeB(ym, "07").net;
  ok(Math.abs((after.net.igst + after.net.cgst + after.net.sgst) - (before.igst + before.cgst + before.sgst) - tax(cn)) < 0.02, "a rejected credit note's tax is added back to 3.1(a) in the month after (" + x.GSTR.label(next) + ", \u20b9" + tax(cn) + ")");
  ok(Math.abs(afterCn.igst + afterCn.cgst + afterCn.sgst - (beforeCn.igst + beforeCn.cgst + beforeCn.sgst)) < 0.02, "the credit note's own month is not changed; it was filed as it was");
  ok(after.custRej.add.n === 1 && x.GSTR.threeBJson(next, "07").sup_details.osup_det.iamt === Math.round(after.net.igst * 100) / 100, "the 3B JSON carries the add-back");
  s.act = "accepted"; s.doneYm = x.CustIMS.nextYm(next); x.GSTR._carry = null;
  const later = x.GSTR.threeB(s.doneYm, "07");
  ok(later.custRej.back.n === 1 && Math.abs(later.custRej.back.igst + later.custRej.back.cgst + later.custRej.back.sgst - tax(cn)) < 0.02, "accepted later: taken out again in the month accepted");
  const si = x.CustIMS.add("07", inv.id); x.GSTR._carry = null;
  ok(si.kind === "inv" && si.act === "ask" && x.GSTR.threeB(x.GSTR.ym(inv.date), "07").custRej.add.n === 0, "a rejected invoice: our tax stays as reported; first step is to ask the customer");
  const c = x.CustIMS.customers("07").find(z => z.gstin === inv.gstin), L = x.CustIMS.letter("07", c.gstin, c.party, c.items);
  ok(/rejected in your Invoice Management System/.test(L) && L.includes(inv.no), "a letter to the customer asking them to accept it");
  // the guide has a page for every GST and TDS tab
  const need = ["gst:r1", "gst:r3b", "gst:inreg", "gst:r2b", "gst:follow", "gst:adv", "gst:rev", "gst:amend", "gst:g9", "gst:g9c", "tds:years", "tds:year", "tds:certs",
    "tds:26Q:challans", "tds:26Q:deductees", "tds:26Q:deductions", "tds:26Q:checks", "tds:24Q:employees", "tds:24Q:challans", "tds:24Q:annex2", "tds:24Q:checks"];
  ok(need.every(k => x.Help.T[k] && x.Help.T[k].what && x.Help.T[k].steps.length), "a guide for each of the " + need.length + " GST and TDS tabs");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
