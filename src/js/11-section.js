/* ================================================================== */
/* ================================================================== */
/* GSTR-2B reconciliation: the purchase side of Tally against 2B      */
/* ================================================================== */
// GST2B's part the GSTR-3B engine runs is in server/_shared/gst3b.js (shared with the gst-run function); the rest is put on it here
Object.assign(GST2B, {
  dmy(s){ const p = String(s || "").split("-"); return p.length === 3 ? p[2] + p[1] + p[0] : String(s || "").replace(/\D/g, "").slice(0, 8); },
  RSN: {P: "place of supply rule: supplier and recipient in the same state, different place of supply", C: "filed after the time limit in section 16(4)"},
  IMS: {N: "no action", A: "accepted", R: "rejected", P: "pending"},
  // the portal's JSON: one row per document, every section 2B carries. The reading is server/_shared/match2b.js
  // (m2bFrom2bJson), so the gst-2b-match function reads a 2B fetched on the server row for row as the app does
  fromJson(j){ return m2bFrom2bJson(j); },
  // the part of the result that belongs to the months chosen
  scope(reg, months){
    const r = this.run(reg), inM = ym => !months || months.includes(ym);
    const pairs = r.pairs.filter(x => inM(x.p.ym) || x.books.some(d => inM(d.ym)));
    const lastLoaded = r.loaded[r.loaded.length - 1] || "";
    // (next-gst-isd; review of aba40df57, L3) a bill of a year with no 2B here that nothing matched (noYear): listed with
    // the books-only, "2B not brought in"; unmatched: both, in the books' order
    const noYear = (r.noYear || []).filter(d => inM(d.ym)), un = new Set(r.onlyBooks.concat(noYear));
    return {noYear, unmatched: noYear.length ? (r.books || []).filter(d => un.has(d) && inM(d.ym)) : r.onlyBooks.filter(d => inM(d.ym)),all: r, pairs, matched: pairs.filter(x => x.status === "matched"), diff: pairs.filter(x => x.status === "diff"), probable: pairs.filter(x => x.status === "probable"),
      timing: pairs.filter(x => x.timing), only2b: r.only2b.filter(p => inM(p.ym)), onlyBooks: r.onlyBooks.filter(d => inM(d.ym)),
      laterMissing: r.onlyBooks.filter(d => inM(d.ym) && d.ym >= lastLoaded).length, taxOf: r.taxOf, reversed: (r.reversed || []).filter(pr => pr.some(d => inM(d.ym))), rejected: (r.rejected || []).filter(x => inM(x.p.ym) || x.books.some(d => inM(d.ym)))};
  },
  // supplier by supplier, 2B against the books
  suppliers(sc){
    const m = {};
    const get = (g, name) => { const k = g || "no GSTIN: " + (name || ""); return m[k] = m[k] || {gstin: g, party: name || "", t2b: 0, tbk: 0, matched: 0, diff: 0, probable: 0, only2b: 0, onlyBooks: 0, pairs: [], p2b: [], pbk: []}; };
    const tx = o => (num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess)) * (o.dir || 1);
    sc.pairs.forEach(x => { const s = get(x.p.gstin, x.p.party); s.t2b = r2(s.t2b + tx(x.p)); s.tbk = r2(s.tbk + tx(Object.assign({dir: x.p.dir}, x.sum))); s[x.status]++; s.pairs.push(x); });
    sc.only2b.forEach(p => { const s = get(p.gstin, p.party); s.t2b = r2(s.t2b + tx(p)); s.only2b++; s.p2b.push(p); });
    sc.onlyBooks.forEach(d => { const s = get(d.gstin, d.party); if (!s.party) s.party = d.party; s.tbk = r2(s.tbk + tx(d)); s.onlyBooks++; s.pbk.push(d); });
    return Object.values(m).map(s => Object.assign(s, {gap: r2(s.t2b - s.tbk)})).sort((a, c) => Math.abs(c.gap) - Math.abs(a.gap));
  },
  // what to send a supplier whose invoices are not in 2B
  followUp(s){
    const co = CO();
    return "Dear " + (s.party || "Sir/Madam") + ",\n\nThe following invoices issued to " + co.name + (co.gstin ? " (GSTIN " + co.gstin + ")" : "") +
      " are in our books but do not appear in our GSTR-2B. Please report them in your GSTR-1 / IFF, or let us know if any detail differs:\n\n" +
      s.pbk.map((d, i) => (i + 1) + ". Invoice " + d.no + " dated " + GSTAmend.dmy(d.date) + ", taxable " + INR.format(d.taxable) + ", tax " + INR.format(r2(d.igst + d.cgst + d.sgst + d.cess))).join("\n") +
      "\n\nRegards";
  },
  async toExcel(sc, label){
    await ensureXlsx();
    const d = s => String(s).length === 8 ? String(s).slice(6, 8) + "-" + String(s).slice(4, 6) + "-" + String(s).slice(0, 4) : s;
    const rate = x => x.taxable ? Math.round((num(x.igst) + num(x.cgst) + num(x.sgst)) / num(x.taxable) * 100) : "";
    const head = ["AS PER GST-2B", "", "", "", "", "", "", "", "", "", "AS PER TALLY", "", "", "", "", "", "DIFFERENCE", "", "", "", "", ""];
    const cols = ["GSTIN NO.", "PARTY NAME", "INV. NO.", "INV DATE", "INV VALUE", "RATE", "TAXABLE", "IGST", "CGST", "SGST", "INV. NO.", "INV DATE", "TAXABLE", "IGST", "CGST", "SGST",
      "TAXABLE", "IGST", "CGST", "SGST", "Remarks", "2B month / Tally month"];
    const remark = x => x.status === "matched" ? (x.timing ? "Matched, different month" : "Matched") : x.status === "probable" ? "To confirm: " + x.issues.join("; ") : "Difference: " + x.issues.join("; ");
    const line = x => [x.p.gstin, x.p.party, x.p.no, d(x.p.date), x.p.val, rate(x.p), x.p.taxable, x.p.igst, x.p.cgst, x.p.sgst,
      x.books.map(b => b.no).join(", "), d(x.books[0].date), x.sum.taxable, x.sum.igst, x.sum.cgst, x.sum.sgst, x.diff.taxable, x.diff.igst, x.diff.cgst, x.diff.sgst, remark(x),
      GSTR.label(x.p.ym) + " / " + Array.from(new Set(x.books.map(b => GSTR.label(b.ym)))).join(", ")];
    const wb = XLSX.utils.book_new();
    const sheet = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
    const st = this.state(), noY = new Set(sc.noYear || []);
    sheet("B2B", [head, cols].concat(sc.pairs.filter(x => x.p.dir === 1 && !/^cdnr/.test(x.p.sec)).map(line)));
    sheet("CDNR", [head, cols].concat(sc.pairs.filter(x => /^cdnr/.test(x.p.sec)).map(line)));
    sheet("ITC Taken But Not Shown In 2B", [["GSTIN NO.", "PARTY NAME", "INV. NO.", "INV DATE", "VCH NO.", "VCH TYPE", "RATE", "TAXABLE", "IGST", "CGST", "SGST", "Remarks", "Note"]]
      .concat((sc.unmatched || sc.onlyBooks).map(x => [x.gstin || "not in Tally", x.party, x.no, d(x.date), x.voucher, x.type, rate(x), x.taxable, x.igst, x.cgst, x.sgst, noY.has(x) ? "2B NOT BROUGHT IN" : x.gstin ? "ITC BOOKED IN TALLY" : "ITC BOOKED, NO GSTIN IN TALLY", ((st.tag[x.id] || {}).tag || "")])));
    sheet("In 2B Not In Books", [["GSTIN NO.", "PARTY NAME", "INV. NO.", "INV DATE", "INV VALUE", "RATE", "TAXABLE", "IGST", "CGST", "SGST", "2B month", "Section", "ITC available", "Reason", "IMS", "Supplier filed", "Remarks"]]
      .concat(sc.only2b.map(x => [x.gstin, x.party, x.no, d(x.date), x.val, rate(x), x.taxable, x.igst, x.cgst, x.sgst, GSTR.label(x.ym), x.sec, x.itcavl, this.RSN[x.rsn] || x.rsn, this.IMS[x.ims] || x.ims, x.filedOn,
        ((st.tag[x.key] || {}).tag || "ITC NOT TAKEN")])));
    sheet("Suppliers", [["GSTIN", "Supplier", "Tax in 2B", "Tax in Tally", "Gap", "Matched", "Differences", "To confirm", "In 2B only", "In Tally only"]]
      .concat(this.suppliers(sc).map(s => [s.gstin || "", s.party, s.t2b, s.tbk, s.gap, s.matched, s.diff, s.probable, s.only2b, s.onlyBooks])));
    const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-2B-reco-" + String(label || "").replace(/[^A-Za-z0-9]+/g, "-") + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
});


