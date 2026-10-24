/* @react-lazy: begin 89-tds-adjust.js (the React app loads this file with its TDS screens: app/src/lib/tdsGlobals.js; build.py react_parts) */
/* ================================================================== */
/* A TDS ledger adjusted without a deductee (the owner, 22-Oct-2026:  */
/* "Why there is any blank entry? When tally has every ledger")       */
/* ================================================================== */
// Leads Insurance's 26Q Q1 2025-26 showed a row with no name and no PAN: 194J, 01-Apr-2025, paid ₹35.50, TDS ₹0.71 at 2%.
// In Tally it is a Journal with no number, party or narration: "TDS 94J 2%" Cr 0.71, Round Off Dr 0.71, a rounding of the
// TDS ledger. Such an entry is no deduction (TDS.adjOnly, src/js/09, keeps it out of every return); it is said here, once
// per entry, on the return's Validate as a note: "TDS ledger adjusted without a deductee: Journal 01-Apr-2025, Round Off
// ₹0.71 — not in the return", with the entry opened in Look up.
const TDSAdj = {
  // the return an adjusted TDS ledger's section belongs to (as TDS.rows / nrRows / salaryRows split them)
  formOf(section){
    const s = TDS.sec(section);
    if (/^(192|392)/.test(String(section || ""))) return "24Q";
    if (TDS.NR.test(s)) return "27Q";
    return TDS.portalForm(section) ? "" : "26Q";
  },
  // the adjustments of a quarter (fy "2025-26", q "Q1"), for a return (26Q, 27Q, 24Q; none for 27EQ): one item per entry
  list(fy, q, form){
    const b = S.books;
    if (!b || !b.vouchers || form === "27EQ") return [];
    const out = [];
    b.vouchers.forEach(v => {
      if (TDS.fyOf(v.date) !== fy || TDS.qOf(v.date) !== q) return;
      const L = Books.lines(v);
      if (!L.tds.length || !TDS.adjOnly(v)) return;
      if (form && !L.tds.some(t => this.formOf(t.section || (TDS.salaryLedger(t.ledger) ? "192" : "")) === form)) return;
      const tdsL = new Set(L.tds.map(t => t.ledger)), other = v.ent.filter(e => !tdsL.has(e.l) && Math.abs(e.a) >= 0.005);
      const amount = r2(L.tds.reduce((a, t) => a + t.amount, 0)), money = (n) => "₹" + INR.format(r2(n));
      const what = other.length ? other.map(e => e.l + " " + money(Math.abs(e.a))).join(", ") : L.tds.map(t => t.ledger + " " + money(t.amount)).join(", ");
      out.push({vid: v.id, date: v.date, type: v.type || "Entry", no: v.no || v.ref || "", ledgers: L.tds.map(t => t.ledger), other: other.map(e => e.l), amount,
        words: "TDS ledger adjusted without a deductee: " + (v.type || "Entry") + (v.no ? " " + v.no : "") + " " + fmtDate(tallyDate(v.date)) + ", " + what + " — not in the return"});
    });
    return out.sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // the entry in Look up: its day, and its number or else the TDS ledger
  open(x){
    const d8 = String(x.date || "").slice(0, 8), lk = LK.st();
    Object.assign(lk, {kind: "find", q: String(x.no || x.ledgers[0] || ""), typ: "", from: d8 || lk.from, to: d8 || lk.to, heard: "", led: ""});
    FC.go("lookup"); LK.run("auto");
  },
};
if (typeof globalThis === "object") Object.assign(globalThis, {TDSAdj});
/* @react-lazy: end */
