// Our invoices and credit notes rejected by customers in IMS: the letter to a customer and the customers with documents
// open (were CustIMS.letter and CustIMS.customers in server/_shared/gst3b.js; moved out of the engine and legacy.js's
// budget, next-fix-audit-gst: only the screen uses them). Put on CustIMS when CustIms.jsx loads (installCustIms), so
// src/js/33's custImsLetter keeps calling CustIMS.letter. Pure functions of the legacy globals (CO, GSTR, GSTAmend,
// GSTSet, CustIMS, INR, r2, S).
export function letter(reg, gstin, party, list) {
  const co = CO() || {}, g = (GSTR.gstins(S.books) || []).find((z) => z.slice(0, 2) === reg) || reg, m = (v) => "₹" + INR.format(r2(v));
  let t = "Dear Sir/Madam,\n\nThe following documents issued by " + (co.name || "us") + " (GSTIN " + g + ") to " + party + " (GSTIN " + gstin + ") are shown as rejected in your Invoice Management System:\n\n";
  t += list.map((x, i) => "   " + (i + 1) + ". " + (x.kind === "cn" ? "Credit note " : "Invoice ") + x.no + " dated " + GSTAmend.dmy(x.date) + ", taxable " + m(x.taxable) + ", tax " + m(x.tax) + (x.remark ? " (your remark: " + x.remark + ")" : "")).join("\n");
  t += "\n\nWe have checked them against our books and they are correct. Please accept them in IMS before you file GSTR-3B; if your return for that month is already filed, please let us know and we will report them again so that they come back to your IMS.\n\nRegards,\n" + (co.name || "");
  return t;
}
export function customers(reg) {
  const m = {};
  CustIMS.items(reg).filter((x) => x.open && ((x.kind === "inv" && x.act === "ask") || (x.kind === "cn" && x.act === "rejected"))).forEach((x) => { const k = x.gstin; (m[k] = m[k] || { gstin: x.gstin, party: x.party, items: [] }).items.push(x); });
  return Object.values(m).map((c) => { const k = GSTSet.contact(c.gstin, c.party); return Object.assign(c, { email: k.email, phone: k.phone, tax: r2(c.items.reduce((a, x) => a + x.tax, 0)) }); });
}
export function installCustIms() { if (typeof CustIMS === "object" && CustIMS && !CustIMS.letter) Object.assign(CustIMS, { letter, customers }); }
