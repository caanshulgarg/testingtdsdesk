/* @react-lazy: begin 71-supplier-health.js (the React app loads this file with its GST Supplier health screen: build.py react_parts) */
/* ================================================================== */
/* Supplier health for GST (TDS/GST round 2, item 4, G-S3): who is    */
/* not filing, who files late, and GSTINs that cannot be right        */
/* ================================================================== */
// What FinCom can know. The firm's GST API (TaxPro, server/gst-taxpro and src/js/39-gst-api.js) has no "search
// taxpayer" or "return status of another GSTIN" call: its calls are the client's own OTP sign-in, 2B, the filed GSTR-1
// and 3B, the client's own return status list (RETTRACK) and e-invoice / e-way bill. So a supplier's registration status
// (active, cancelled, suspended) cannot be seen here, and the page says so. What the client's 2B shows is used instead:
//   - not filing: the supplier's bills are in the books for a month, and nothing of the supplier is in that month's 2B or
//     the next one, nor matched in any 2B brought in; the latest N such months in a row (N chosen, 2 by default) make
//     the supplier "Not filing"; earlier gaps are "Bills missing from 2B";
//   - files late: 2B gives the date the supplier filed (supfildt) for its return period (supprd); after the 13th of the
//     month after that period it was late (the 11th for a monthly filer, the 13th for a quarterly one: the later date
//     is used, as 2B does not say which the supplier is);
//   - a GSTIN in the books that fails the check digit (gstinValid).
// The credit at risk is the tax on the supplier's bills in the books that no 2B brought in has (GST2B.run's onlyBooks).
// Only the months whose 2B has been brought in or fetched are looked at. Nothing here changes a figure.
const SupHealth = {
  N: 2,
  ddmmyyyy(s){ const m = String(s || "").match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? m[3] + m[2] + m[1] : ""; },
  // the last day to file GSTR-1 (or IFF) for a supplier's return period mmyyyy, as yyyymmdd (the 13th: see above)
  dueOf(supPrd){ const p = String(supPrd || ""); if (!/^\d{6}$/.test(p)) return ""; const n = GSTR.nextYm(p.slice(2) + p.slice(0, 2)); return n + "13"; },
  days(a, b){ const f = s => Date.parse(s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8)); return Math.round((f(b) - f(a)) / 86400000); },
  run(reg, fy, n){
    n = n || this.N;
    const all = GST2B.all2b(reg), months = all.map(t => t.ym).filter(m => !fy || GSTF.fyOf(m) === fy);
    if (!months.length) return {months: [], list: [], n};
    const R = GST2B.run(reg), first = months[0], last = months[months.length - 1], loaded = new Set(all.map(t => t.ym));
    const by = {};
    const sup = g => by[g] = by[g] || {gstin: g, party: "", billed: {}, rows2b: [], matched: new Set(), missing: [], late: []};
    // the supplier's bills in the books, in the months looked at (a bill's month: its date in the books)
    R.books.forEach(d => {
      if (!d.gstin || d.rcm || d.dir < 0 || d.ym < first || d.ym > last) return;
      const s = sup(d.gstin); s.party = s.party || d.party; s.billed[d.ym] = (s.billed[d.ym] || 0) + 1;
    });
    R.pairs.forEach(x => x.books.forEach(d => { if (by[d.gstin]) by[d.gstin].matched.add(d.ym); }));
    R.portal.forEach(p => { if (p.gstin && by[p.gstin]) by[p.gstin].rows2b.push(p); });
    R.onlyBooks.forEach(d => { if (by[d.gstin] && !d.rcm && d.dir > 0 && d.ym >= first && d.ym <= last) by[d.gstin].missing.push(d); });
    const tax = d => r2(num(d.igst) + num(d.cgst) + num(d.sgst) + num(d.cess));
    const list = Object.values(by).map(s => {
      const seen2b = new Set(s.rows2b.map(p => p.ym));
      const billedMonths = Object.keys(s.billed).sort();
      const absent = billedMonths.filter(m => !s.matched.has(m) && !seen2b.has(m) && !(loaded.has(GSTR.nextYm(m)) && seen2b.has(GSTR.nextYm(m))));
      // the latest billed months in a row with nothing in 2B
      let run = 0; for (let i = billedMonths.length - 1; i >= 0 && absent.indexOf(billedMonths[i]) >= 0; i--) run++;
      // late filings, by the supplier's return period
      const per = {};
      s.rows2b.forEach(p => { const on = this.ddmmyyyy(p.filedOn), due = this.dueOf(p.supPrd); if (on && due && on > due){ const k = p.supPrd; per[k] = per[k] || {supPrd: k, on, due, days: this.days(due, on), docs: 0}; per[k].docs++; } });
      const late = Object.values(per).sort((a, b) => a.supPrd.slice(2) + a.supPrd.slice(0, 2) < b.supPrd.slice(2) + b.supPrd.slice(0, 2) ? -1 : 1);
      const lastSeen = Array.from(seen2b).sort().pop() || "";
      const flags = [];
      if (!gstinValid(s.gstin)) flags.push("bad");
      if (run >= n) flags.push("notfiling"); else if (absent.length) flags.push("missing");
      if (late.length) flags.push("late");
      return {gstin: s.gstin, party: s.party, billed: billedMonths, absent, run, late, lastSeen, missing: s.missing.length, atRisk: r2(s.missing.reduce((a, d) => a + tax(d), 0)),
        docs2b: s.rows2b.length, flags, status: flags.includes("notfiling") ? "notfiling" : flags.includes("bad") ? "bad" : flags.includes("missing") ? "missing" : flags.includes("late") ? "late" : "ok"};
    });
    const rank = {notfiling: 0, bad: 1, missing: 2, late: 3, ok: 4};
    list.sort((a, b) => rank[a.status] - rank[b.status] || b.atRisk - a.atRisk || a.party.localeCompare(b.party));
    return {months, list, n};
  },
  words(x){
    const out = [], m = ym => GSTR.label(ym);
    if (x.flags.includes("bad")) out.push("the GSTIN fails its check digit: check it in Tally");
    if (x.flags.includes("notfiling")) out.push("nothing in 2B for its bills of the last " + x.run + " month" + (x.run === 1 ? "" : "s") + " (" + x.absent.slice(-x.run).map(m).join(", ") + ")" + (x.lastSeen ? "; last in 2B " + m(x.lastSeen) : "; in no 2B brought in"));
    else if (x.flags.includes("missing")) out.push("bills of " + x.absent.map(m).join(", ") + " not in 2B");
    x.late.forEach(l => out.push("filed " + GSTR.label(l.supPrd.slice(2) + l.supPrd.slice(0, 2)) + " on " + fmtDate(tallyDate(l.on)) + ", " + l.days + " day" + (l.days === 1 ? "" : "s") + " late"));
    return out;
  }
};
if (typeof globalThis === "object") globalThis.SupHealth = SupHealth;
/* @react-lazy: end */
