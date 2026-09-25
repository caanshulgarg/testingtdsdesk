// node run_gst9.js - GSTR-9 and 9C on VMS 2025-26
const fs = require("fs"), {load, openBlob} = require("./harness"), {HTML, DATA, CACHE, OUT} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "GST9", "GST9C", "INR"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const M = v => x.INR.format(Math.round(v || 0));
(async () => {
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
  const d = x.GST9.build("2025", "07"), T = d.T;
  ["4A", "4B", "4C", "4F", "4G", "4H", "4I", "4N", "5A", "5D", "5N", "6A", "6B-in", "6B-cg", "6B-is", "6C", "6D", "6I", "6J", "7C", "7E", "7J", "8A", "8B", "8C", "8D"].forEach(k => console.log("  " + k.padEnd(6) + " taxable " + M(T[k].taxable).padStart(16) + "  igst " + M(T[k].igst).padStart(13) + "  cgst " + M(T[k].cgst).padStart(12) + "  sgst " + M(T[k].sgst).padStart(12)));
  console.log("  9 tax: " + JSON.stringify(d.pay));
  // agree with the months
  let out = 0, tax = 0; d.inBooks.forEach(m => { x.GSTR.outward(m, "07").forEach(r => { out += (r.kind === "CDNR" ? -1 : 1) * r.taxable; }); });
  ok(Math.abs(T["5N"].taxable - T["4G"].taxable - T["4F"].taxable - out) < 2, "4N + 5M (without advances and inward reverse charge) equals the months' outward supplies: " + M(out));
  const itc = d.inBooks.reduce((s, m) => { const t = x.GSTR.threeB(m, "07").itc; return s + t.igst + t.cgst + t.sgst + t.cess; }, 0);
  ok(Math.abs(T["6A"].igst + T["6A"].cgst + T["6A"].sgst + T["6A"].cess - itc) < 2, "6A equals the credit in the twelve 3Bs: " + M(itc));
  const dn = d.inBooks.reduce((s, m) => s + x.GSTR.inward(m, "07").filter(r => r.note === "debit" && !r.rcm && !r.import).reduce((a, r) => a + r.igst + r.cgst + r.sgst + r.cess, 0), 0), bl = d.inBooks.reduce((s, m) => s + x.GSTR.inward(m, "07").filter(r => r.blocked && r.note !== "debit").reduce((a, r) => a + r.igst + r.cgst + r.sgst + r.cess, 0), 0);
  ok(Math.abs(T["6J"].igst + T["6J"].cgst + T["6J"].sgst + T["6J"].cess - bl) < 2, "6J is now only the bills marked ITC not available (" + M(bl) + "): the suppliers' credit notes (" + M(dn) + " of tax) reduce credit in 3B as in 6B");
  const t3 = d.inBooks.reduce((s, m) => { const t = x.GSTR.threeB(m, "07"); return s + t.itc.igst + t.itc.cgst + t.itc.sgst; }, 0);
  console.log("  ITC in the twelve 3Bs now " + M(t3) + "; the suppliers' credit notes took " + M(dn) + " off it");
  ok(d.missing.length === 0 && d.inBooks.length === 12, "all twelve months are in the books");
  const c = x.GST9C.build("2025", "07");
  console.log("  9C: 5A " + M(c.a5) + "  5O " + M(c.o5) + "  5P " + M(c.p5) + "  5Q " + M(c.q5) + " | 7E " + M(c.e7) + " 7F " + M(c.f7) + " 7G " + M(c.g7) + " | 12A " + M(c.itcBooks) + " 12E " + M(c.e12) + " 12F " + M(c.f12));
  ok(Math.abs(c.q5) < 2 && Math.abs(c.g7) < 2, "with no adjustments, turnover and taxable turnover reconcile to nil");
  const st = x.GST9C.st("2025", "07"); st.adj["5B"] = 100000; st.adj["5H"] = 250000;
  const c2 = x.GST9C.build("2025", "07");
  ok(Math.abs(c2.o5 - (c.o5 + 100000 - 250000)) < 1 && Math.abs(c2.q5 - (c.q5 - 150000)) < 1, "unbilled revenue at the start (+) and end (-) move 5O and 5Q: " + M(c2.q5));
  ok(x.GST9.html(d).includes("4N") && x.GST9.html(d).includes("Part IV"), "the return renders, table by table");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
