// node tests/fbooks_fixture.mjs [n] [seed] > books.json - made-up books for FinCom Books' tests, in the shape of FinCom's
// cloud copy of Tally (tally_groups, tally_ledgers, tally_vouchers, tally_lines, tally_bills, tally_cost_allocs), with
// the copy's own sign: a CREDIT is positive, as Tally's XML writes it. Every name, GSTIN and figure is made up.
// The book starts on 01-Apr-2024; the entries run to 20-Nov-2026, so the older year (2024-25) is carried into FinCom
// Books' openings (D20) and 2025-26 and 2026-27 are mirrored voucher by voucher. What it holds:
//   sales with CGST + SGST (New Ref bills, due dates), interstate sales with IGST, receipts against the bills (partial
//   and full), an advance and an on-account receipt; purchases with input GST and New Ref bills, payments against them;
//   journals with cost-centre splits; contras; one optional entry, one cancelled, one whose Dr and Cr differ by a paisa
//   (the copy holds what Tally sent: FinCom Books must keep it out of the totals and say so), one with no lines.
export function makeBooks(n = 400, seed = 7) {
  let x = seed >>> 0 || 7;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const r2 = (v) => Math.round(v * 100) / 100;
  const groups = [
    { name: "Sundry Debtors", parent: "Current Assets" }, { name: "Sundry Creditors", parent: "Current Liabilities" },
    { name: "Current Assets", parent: "" }, { name: "Current Liabilities", parent: "" }, { name: "Bank Accounts", parent: "Current Assets" },
    { name: "Cash-in-Hand", parent: "Current Assets" }, { name: "Duties & Taxes", parent: "Current Liabilities" },
    { name: "Sales Accounts", parent: "" }, { name: "Purchase Accounts", parent: "" }, { name: "Indirect Expenses", parent: "" },
    { name: "Capital Account", parent: "" }, { name: "Fixed Assets", parent: "" },
    // the user's own sub-groups
    { name: "Debtors - North", parent: "Sundry Debtors" }, { name: "Office Expenses", parent: "Indirect Expenses" },
  ];
  const customers = ["Alpha Demo Stores", "Beta Sample Mart", "Gamma Test Retail", "Delta Made-up Co"];
  const far = ["Epsilon Example Traders"];   // another state: IGST
  const suppliers = ["Zeta Sample Supplies", "Eta Demo Wholesale", "Theta Test Mills"];
  const gst = (i, st) => st + "ZZZZZ" + String(1000 + i).slice(-4) + "Z1Z" + (i % 10);
  const ledgers = [
    ...customers.map((nm, i) => ({ name: nm, parent: i === 0 ? "Debtors - North" : "Sundry Debtors", open: i === 1 ? -15000 : 0, gstin: gst(i, "27"), state: "Maharashtra" })),
    ...far.map((nm, i) => ({ name: nm, parent: "Sundry Debtors", open: 0, gstin: gst(10 + i, "29"), state: "Karnataka" })),
    ...suppliers.map((nm, i) => ({ name: nm, parent: "Sundry Creditors", open: i === 0 ? 22000 : 0, gstin: gst(20 + i, "27"), state: "Maharashtra", pan: "ZZZPZ" + (1000 + i) + "Z" })),
    { name: "Demo Bank Current A/c", parent: "Bank Accounts", open: -250000 }, { name: "Cash", parent: "Cash-in-Hand", open: -12000 },
    { name: "Sales @ 18%", parent: "Sales Accounts", open: 0 }, { name: "Sales Interstate", parent: "Sales Accounts", open: 0 },
    { name: "Purchases @ 18%", parent: "Purchase Accounts", open: 0 },
    { name: "Output CGST", parent: "Duties & Taxes", open: 0 }, { name: "Output SGST", parent: "Duties & Taxes", open: 0 }, { name: "Output IGST", parent: "Duties & Taxes", open: 0 },
    { name: "Input CGST", parent: "Duties & Taxes", open: 0 }, { name: "Input SGST", parent: "Duties & Taxes", open: 0 },
    { name: "Office Rent", parent: "Office Expenses", open: 0 }, { name: "Staff Welfare", parent: "Indirect Expenses", open: 0 },
    { name: "Owner Capital", parent: "Capital Account", open: 255000 }, { name: "Furniture", parent: "Fixed Assets", open: -0 },
  ];
  const start = Date.UTC(2024, 3, 1), end = Date.UTC(2026, 10, 20), day = 86400000;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const vouchers = []; const open = {}; let alter = 1000;
  const nos = {};
  const nextNo = (t) => (nos[t] = (nos[t] || 0) + 1);
  const add = (o) => { alter += 1; const v = Object.assign({ guid: "g-" + seed + "-" + (vouchers.length + 1), alter_id: alter, party: "", narration: "", cancelled: false, optional: false, gstin: "", pos: "", bills: [], cc: [] }, o); vouchers.push(v); return v; };
  for (let i = 0; i < n; i++) {
    const t = start + Math.floor(rnd() * ((end - start) / day)) * day, d = iso(t), k = rnd();
    if (k < 0.3) {
      const c = pick(customers), taxable = r2(1000 + Math.floor(rnd() * 200000) / 100), g = r2(taxable * 0.18), cg = r2(Math.round(g / 2 * 100) / 100), sg = r2(g - cg), tot = r2(taxable + g);
      const no = "S/" + nextNo("Sales");
      const v = add({ day: d, vtype: "Sales", vno: no, party: c, gstin: ledgers.find((l) => l.name === c).gstin, pos: "27",
        lines: [{ ledger: c, amount: -tot }, { ledger: "Sales @ 18%", amount: taxable }, { ledger: "Output CGST", amount: cg }, { ledger: "Output SGST", amount: sg }] });
      v.bills.push({ ledger: c, name: no, type: "New Ref", amount: -tot, bill_date: d, credit_days: 30, due: iso(t + 30 * day) });
      (open[c] = open[c] || []).push({ name: no, left: tot });
    } else if (k < 0.36) {
      const c = far[0], taxable = r2(2000 + Math.floor(rnd() * 300000) / 100), ig = r2(taxable * 0.18), tot = r2(taxable + ig), no = "S/" + nextNo("Sales");
      const v = add({ day: d, vtype: "Sales", vno: no, party: c, gstin: ledgers.find((l) => l.name === c).gstin, pos: "29",
        lines: [{ ledger: c, amount: -tot }, { ledger: "Sales Interstate", amount: taxable }, { ledger: "Output IGST", amount: ig }] });
      v.bills.push({ ledger: c, name: no, type: "New Ref", amount: -tot, bill_date: d, credit_days: 45, due: iso(t + 45 * day) });
      (open[c] = open[c] || []).push({ name: no, left: tot });
    } else if (k < 0.52) {
      const c = pick(customers.concat(far)), ob = (open[c] || []).find((b) => b.left > 0);
      const bank = rnd() < 0.7 ? "Demo Bank Current A/c" : "Cash";
      if (ob) {
        const amt = rnd() < 0.5 ? ob.left : r2(ob.left / 2); ob.left = r2(ob.left - amt);
        const v = add({ day: d, vtype: "Receipt", vno: "R/" + nextNo("Receipt"), party: c, lines: [{ ledger: bank, amount: -amt }, { ledger: c, amount: amt }] });
        v.bills.push({ ledger: c, name: ob.name, type: "Agst Ref", amount: amt, bill_date: null, credit_days: null, due: null });
      } else {
        const amt = r2(500 + Math.floor(rnd() * 50000) / 100), kind = rnd() < 0.5 ? "Advance" : "On Account";
        const v = add({ day: d, vtype: "Receipt", vno: "R/" + nextNo("Receipt"), party: c, lines: [{ ledger: bank, amount: -amt }, { ledger: c, amount: amt }] });
        v.bills.push({ ledger: c, name: kind === "Advance" ? "ADV-" + vouchers.length : "", type: kind, amount: amt, bill_date: null, credit_days: null, due: null });
      }
    } else if (k < 0.72) {
      const s = pick(suppliers), taxable = r2(800 + Math.floor(rnd() * 150000) / 100), g = r2(taxable * 0.18), cg = r2(Math.round(g / 2 * 100) / 100), sg = r2(g - cg), tot = r2(taxable + g), no = "P-" + nextNo("Purchase");
      const v = add({ day: d, vtype: "Purchase", vno: no, party: s, gstin: ledgers.find((l) => l.name === s).gstin, pos: "27",
        lines: [{ ledger: "Purchases @ 18%", amount: -taxable }, { ledger: "Input CGST", amount: -cg }, { ledger: "Input SGST", amount: -sg }, { ledger: s, amount: tot }] });
      v.bills.push({ ledger: s, name: "INV-" + (5000 + i), type: "New Ref", amount: tot, bill_date: d, credit_days: 15, due: iso(t + 15 * day) });
      (open[s] = open[s] || []).push({ name: "INV-" + (5000 + i), left: tot });
    } else if (k < 0.84) {
      const s = pick(suppliers), ob = (open[s] || []).find((b) => b.left > 0);
      if (!ob) { i--; continue; }
      const amt = ob.left; ob.left = 0;
      const v = add({ day: d, vtype: "Payment", vno: "PY/" + nextNo("Payment"), party: s, lines: [{ ledger: s, amount: -amt }, { ledger: "Demo Bank Current A/c", amount: amt }] });
      v.bills.push({ ledger: s, name: ob.name, type: "Agst Ref", amount: -amt, bill_date: null, credit_days: null, due: null });
    } else if (k < 0.94) {
      const amt = r2(1000 + Math.floor(rnd() * 80000) / 100), a = r2(Math.round(amt * 0.6 * 100) / 100), b = r2(amt - a);
      const v = add({ day: d, vtype: "Journal", vno: "J/" + nextNo("Journal"), narration: "Rent for the month (made up)",
        lines: [{ ledger: "Office Rent", amount: -amt }, { ledger: "Demo Bank Current A/c", amount: amt }] });
      v.cc.push({ line_no: 1, ledger: "Office Rent", category: "Primary Cost Category", centre: "Head Office", amount: -a }, { line_no: 1, ledger: "Office Rent", category: "Primary Cost Category", centre: "Branch Pune", amount: -b });
    } else {
      const amt = r2(1000 + Math.floor(rnd() * 20000));
      add({ day: d, vtype: "Contra", vno: "C/" + nextNo("Contra"), lines: [{ ledger: "Cash", amount: -amt }, { ledger: "Demo Bank Current A/c", amount: amt }] });
    }
  }
  // the special ones, at fixed dates inside the mirrored years
  add({ day: "2026-05-10", vtype: "Journal", vno: "J/OPT-1", optional: true, narration: "an optional entry (made up)", lines: [{ ledger: "Staff Welfare", amount: -900 }, { ledger: "Cash", amount: 900 }] });
  add({ day: "2026-06-11", vtype: "Payment", vno: "PY/CAN-1", cancelled: true, narration: "a cancelled entry (made up)", lines: [] });
  add({ day: "2026-07-12", vtype: "Journal", vno: "J/ODD-1", narration: "Dr and Cr differ by a paisa in the copy (made up)", lines: [{ ledger: "Staff Welfare", amount: -100.01 }, { ledger: "Cash", amount: 100 }] });
  add({ day: "2026-08-13", vtype: "Delivery Note", vno: "DN-1", narration: "no accounting lines (made up)", lines: [] });
  vouchers.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.alter_id - b.alter_id));
  return { company: "Demo Books Pvt Ltd (made up)", from_date: "2024-04-01", groups, ledgers, vouchers };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const n = +(process.argv[2] || 400), seed = +(process.argv[3] || 7);
  process.stdout.write(JSON.stringify(makeBooks(n, seed)));
}
