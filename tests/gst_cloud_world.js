// A made-up client for tests/run_gst_cloud.js, written as FinCom's cloud holds it (never a real client: every name, GSTIN
// and figure is invented here from a fixed seed). world({scale}) gives the rows gst-run reads:
//   book, heads (tally_vouchers), lines (tally_lines), bills (tally_bills), ledgers (tally_ledgers), groups (tally_groups),
//   work (the client's work as the app keeps it: split into client_book_items by the test with the app's BookItems.split),
//   co (clients.data), sales (records kind 'sales': marketplace invoices), runs (gst-2b-match's kept matching)
// for April 2025 to March 2026, Delhi (07), with: sales to registered and unregistered buyers, inter-state, exempt and an
// export; credit notes (one rejected by the customer in IMS); bills matched in 2B, one late in 2B (held, then released),
// one never in 2B, one rejected in IMS, one more in Tally than in 2B, a supplier's credit note only in 2B, credit 2B says
// is not available; reverse charge; common credit (rule 42) and a capital good in common use (rule 43); an unpaid bill
// (rule 37, reversed after 180 days and taken back when paid); an advance received before its invoice; a large machine
// bought in June whose credit is carried for months; a QRMP quarter (January to March 2026); figures typed into 3B; an AI
// pair kept by gst-2b-match; a deleted, a cancelled and an optional entry. scale > 1 adds that many times more ordinary
// entries (the 40,000-entry book for the timing).
"use strict";
function rng(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const MONTHS = ["202504", "202505", "202506", "202507", "202508", "202509", "202510", "202511", "202512", "202601", "202602", "202603"];
const OWN = "07AAKCS4821Q1ZW";
const P0 = {   // parties: [name, group, GSTIN, state]
  birch: ["Birchwood Retail", "Sundry Debtors", "07AABCB7310K1Z2", "Delhi"],
  copper: ["Copperleaf Hotels", "Sundry Debtors", "09AACCC5521M1Z8", "Uttar Pradesh"],
  walkin: ["Walk-in Customers", "Sundry Debtors", "", "Delhi"],
  fern: ["Fernhill Imports Ltd", "Sundry Debtors", "", ""],
  alder: ["Alder Supply Co", "Sundry Creditors", "07AAFCA1144P1Z3", "Delhi"],
  blue: ["Bluepine Logistics", "Sundry Creditors", "06AAGCB9902L1Z1", "Haryana"],
  cedar: ["Cedar Office Rentals", "Sundry Creditors", "", "Delhi"],
  dun: ["Dunmore Traders", "Sundry Creditors", "07AAHCD3387F1Z6", "Delhi"],
  elm: ["Elmstead Paper", "Sundry Creditors", "07AAJCE6612G1Z9", "Delhi"],
  glen: ["Glenrock Tools", "Sundry Creditors", "07AAKCG2290H1Z4", "Delhi"],
  holly: ["Hollyford Stationers", "Sundry Creditors", "07AALCH7784J1Z5", "Delhi"],
};
const TAX = [["Output CGST", "CGST", "output"], ["Output SGST", "SGST", "output"], ["Output IGST", "IGST", "output"], ["Input CGST", "CGST", "input"], ["Input SGST", "SGST", "input"],
  ["Input IGST", "IGST", "input"]];
function world(o){
  const P = Object.assign({}, P0);
  o = o || {}; const scale = o.scale || 0, R = rng(o.seed || 153);
  const heads = [], lines = [], bills = [];
  let n = 0;
  const day = (ym, d) => ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-" + String(d).padStart(2, "0");
  // one entry: lines [ledger, amount (credit positive), {hsn, rate, bills}]
  const v = (ym, d, vtype, party, ls, extra) => {
    const guid = "syn-" + String(++n).padStart(6, "0"), x = Object.assign({guid, day: day(ym, d), alter_id: n, vtype, vno: vtype.slice(0, 3).toUpperCase() + "/" + n, party: party || "",
      narration: vtype + " " + n, cancelled: false, optional: false, deleted_at: null, gstin: "", pos: "", ref: "", ref_date: null, cmp_gstin: OWN}, extra || {});
    heads.push(x);
    ls.forEach(([l, a, m]) => { lines.push({guid, ledger: l, amount: Math.round(a * 100) / 100, hsn: (m && m.hsn) || null, rate: m && m.rate != null ? m.rate : null});
      ((m && m.bills) || []).forEach(b => bills.push({guid, ledger: l, name: b[0], type: b[1], amount: b[2], credit_days: b[3] == null ? null : b[3]})); });
    return x;
  };
  const r2 = x => Math.round(x * 100) / 100, amt = (lo, hi) => r2(lo + R() * (hi - lo));
  // the large book's parties: "Customer 0042", "Supplier 0042", made-up GSTINs (Delhi, some Haryana)
  const party = (kind, i, inter) => { const k = kind + i; if (!P[k]) { const g = (inter ? "06" : "07") + (kind === "c" ? "AABCM" : "AACCN") + String(i).padStart(4, "0") + "K1Z" + (i % 10);
    P[k] = [(kind === "c" ? "Customer " : "Supplier ") + String(i).padStart(4, "0"), kind === "c" ? "Sundry Debtors" : "Sundry Creditors", g, inter ? "Haryana" : "Delhi"]; } return k; };
  const sale = (ym, d, p, taxable, o2) => {   // intra (CGST/SGST) or inter (IGST) by the buyer's state; services 9983, goods 8471
    o2 = o2 || {}; const pp = P[p], inter = pp[2] ? pp[2].slice(0, 2) !== "07" : pp[3] && pp[3] !== "Delhi", t = r2(taxable * 0.18), hsn = o2.hsn || "8471";
    const ls = [[pp[0], -r2(taxable + t), {bills: o2.bills || [["INV-" + (n + 1), "New Ref", -r2(taxable + t), 30]]}], [o2.ledger || "Sales - Goods", taxable, {hsn, rate: 18}]];
    if (inter) ls.push(["Output IGST", t]); else ls.push(["Output CGST", r2(t / 2)], ["Output SGST", r2(t - r2(t / 2))]);
    return v(ym, d, "Sales", pp[0], ls, {gstin: pp[2], pos: pp[3], ...(o2.extra || {})});
  };
  const cnote = (ym, d, p, taxable) => { const pp = P[p], t = r2(taxable * 0.18);
    return v(ym, d, "Credit Note", pp[0], [[pp[0], r2(taxable + t)], ["Sales - Goods", -taxable, {hsn: "8471", rate: 18}], ["Output CGST", -r2(t / 2)], ["Output SGST", -r2(t - r2(t / 2))]], {gstin: pp[2], pos: pp[3]}); };
  const bill = (ym, d, p, taxable, o2) => {   // a purchase: intra or inter by the supplier's GSTIN
    o2 = o2 || {}; const pp = P[p], inter = pp[2].slice(0, 2) !== "07", rate = o2.rate || 18, t = r2(taxable * rate / 100), led = o2.ledger || "Purchases";
    const ls = [[pp[0], r2(taxable + t), {bills: o2.bills || [[o2.ref || ("B-" + (n + 1)), "New Ref", r2(taxable + t), 45]]}], [led, -taxable, {hsn: o2.hsn || "4802", rate}]];
    if (inter) ls.push([o2.common ? "Input IGST" : "Input IGST", -t]);
    else ls.push([o2.common ? "Input CGST Common" : "Input CGST", -r2(t / 2)], [o2.common ? "Input SGST Common" : "Input SGST", -r2(t - r2(t / 2))]);
    return v(ym, d, "Purchase", pp[0], ls, {gstin: pp[2], ref: o2.ref || ("B-" + n), ref_date: day(ym, d), pos: "Delhi"});
  };
  const twob = {}, add2b = (ym, sec, pp, doc) => { const k = ym; const t = twob[k] = twob[k] || {b2b: {}, cdnr: {}, rej: {}};
    const g = t[sec][pp[2]] = t[sec][pp[2]] || {ctin: pp[2], trdnm: pp[0].toUpperCase(), supfildt: "11-" + ym.slice(4, 6) + "-" + ym.slice(0, 4), inv: []}; g.inv.push(doc); };
  const dmy = d8 => d8.slice(8, 10) + "-" + d8.slice(5, 7) + "-" + d8.slice(0, 4);
  const doc2b = (h, f) => { const L = lines.filter(l => l.guid === h.guid), tx = k => r2(-L.filter(l => l.ledger === k).reduce((a, l) => a + l.amount, 0));
    const taxable = r2(-L.filter(l => /Purchases|Rent|Office|Machinery|Freight/.test(l.ledger)).reduce((a, l) => a + l.amount, 0));
    return Object.assign({inum: h.ref, dt: dmy(h.day), val: r2(L.find(l => l.ledger === h.party).amount), txval: taxable, igst: tx("Input IGST"), cgst: r2(tx("Input CGST") + tx("Input CGST Common")), sgst: r2(tx("Input SGST") + tx("Input SGST Common")), cess: 0, pos: "07", rev: "N", itcavl: "Y"}, f || {}); };
  let firstAlder = null, juneInv = null, cnRej = null, aiBill = null;
  MONTHS.forEach((ym, mi) => {
    const nx = MONTHS[mi + 1];
    // sales: registered intra, inter-state services, B2C, exempt (rule 42's turnover)
    const s1 = sale(ym, 4, "birch", amt(200000, 400000)); if (ym === "202506") juneInv = s1;
    sale(ym, 9, "copper", amt(80000, 160000), {ledger: "Sales - Services", hsn: "9983"});
    sale(ym, 14, "walkin", amt(20000, 60000));
    v(ym, 16, "Sales", P.walkin[0], [[P.walkin[0], -amt(30000, 50000)], ["Sales - Exempt", 0]], {pos: "Delhi", gst_taxability: "Exempt", gst_supply: "Goods", gst_alter_id: n + 1});
    { const L = lines[lines.length - 2]; lines[lines.length - 1].amount = -L.amount; lines[lines.length - 1].hsn = "0401"; lines[lines.length - 1].rate = 0; }
    // bills: Alder matched in the same month's 2B; Bluepine (IGST) in the next month's 2B; Hollyford with common credit
    const a = bill(ym, 6, "alder", amt(100000, 200000), {ref: "AS/" + ym + "/1"}); add2b(ym, "b2b", P.alder, doc2b(a)); if (!firstAlder) firstAlder = a;
    const b = bill(ym, 20, "blue", amt(40000, 90000), {ref: "BPL-" + ym, ledger: "Freight", hsn: "9965"});
    if (nx) add2b(nx, "b2b", P.blue, doc2b(b)); else add2b(ym, "b2b", P.blue, doc2b(b));
    const c = bill(ym, 12, "holly", amt(10000, 30000), {ref: "HS-" + ym, ledger: "Office Expenses", common: true}); add2b(ym, "b2b", P.holly, doc2b(c));
    // reverse charge: rent from an unregistered landlord, tax paid by us and its credit taken
    const rent = 50000, rt = 9000;
    v(ym, 1, "Journal", P.cedar[0], [["Rent", -rent], [P.cedar[0], rent], ["Input CGST RCM", -rt / 2], ["Input SGST RCM", -rt / 2], ["RCM CGST Payable", rt / 2], ["RCM SGST Payable", rt / 2]]);
    // the bank: customers pay, suppliers are paid (Alder's April bill stays unpaid until December: rule 37)
    v(ym, 25, "Receipt", P.birch[0], [["Kestrel Bank", -r2(300000)], [P.birch[0], 300000, {bills: [["ON-" + ym, "On Account", 300000]]}]]);
    if (ym !== "202504") v(ym, 26, "Payment", P.alder[0], [[P.alder[0], -150000, {bills: [["AS/" + MONTHS[mi - 1] + "/1", "Agst Ref", -150000]]}], ["Kestrel Bank", 150000]]);
    // more of the same for the large book
    for (let k = 0; k < scale; k++){
      // as a real book: many customers and suppliers (each with its own GSTIN), so 2B is matched supplier by supplier
      const p = party("c", k % 600, k % 5 === 0), q = party("s", (k * 7 + mi) % 900, false);
      sale(ym, 1 + (k % 27), p, amt(1000, 50000), {ledger: k % 3 ? "Sales - Goods" : "Sales - Services", hsn: k % 3 ? "8471" : "9983"});
      const x = bill(ym, 1 + (k % 27), q, amt(500, 30000), {ref: q.toUpperCase().slice(0, 3) + "-" + ym + "-" + k});
      if (k % 4) add2b(ym, "b2b", P[q], doc2b(x));
      v(ym, 1 + (k % 27), "Payment", P[q][0], [[P[q][0], -amt(100, 5000)], ["Kestrel Bank", 0]]); { const L = lines[lines.length - 2]; lines[lines.length - 1].amount = -L.amount; }
    }
  });
  // Dunmore: never in 2B (held for good); Elmstead: rejected in IMS (in 2B's rejected documents)
  const d1 = bill("202505", 18, "dun", 60000, {ref: "DT-55"});
  const e1 = bill("202507", 8, "elm", 25000, {ref: "EP-781"}); add2b("202507", "rej", P.elm, doc2b(e1));
  // more tax in Tally than in 2B: Glenrock's bill shows 2,000 less IGST... (intra: CGST/SGST 1,000 less each)
  const g1 = bill("202508", 11, "glen", 90000, {ref: "GT-0908"}); add2b("202508", "b2b", P.glen, doc2b(g1, {cgst: r2(8100 - 1000), sgst: r2(8100 - 1000)}));
  // a supplier's credit note only in 2B (reduces credit in September); and credit 2B says is not available (itcavl N)
  add2b("202509", "cdnr", P.alder, {ntnum: "AS-CN-9", typ: "C", dt: "15-09-2025", val: 11800, txval: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0, pos: "07", rev: "N", itcavl: "Y"});
  add2b("202510", "b2b", P.holly, {inum: "HS-NA-1", dt: "03-10-2025", val: 5900, txval: 5000, igst: 0, cgst: 450, sgst: 450, cess: 0, pos: "07", rev: "N", itcavl: "N", rsn: "C"});
  // a bill whose number in Tally differs from 2B's, paired by the AI and kept by gst-2b-match
  aiBill = bill("202511", 21, "alder", 45000, {ref: "ASC 1102"}); add2b("202511", "b2b", P.alder, doc2b(aiBill, {inum: "AS/1102/25-26"}));
  // a machine bought in June (large credit, carried for months) and the capital good in common use (rule 43)
  const mach = bill("202506", 3, "glen", 2500000, {ref: "GT-MACH-1", ledger: "Machinery", hsn: "8462"}); add2b("202506", "b2b", P.glen, doc2b(mach));
  // an advance from Copperleaf in August, invoiced in October (11A in August, 11B in October)
  v("202508", 22, "Receipt", P.copper[0], [["Kestrel Bank", -118000], [P.copper[0], 118000, {bills: [["CL-ADV-1", "Advance", 118000]]}]]);
  sale("202510", 5, "copper", 100000, {ledger: "Sales - Services", hsn: "9983", bills: [["CL-ADV-1", "Agst Ref", -118000]]});
  // an export (zero rated, 3.1(b))
  v("202509", 19, "Sales Export", P.fern[0], [[P.fern[0], -400000], ["Sales - Goods", 400000, {hsn: "8471", rate: 0}]], {pos: "", gstin: ""});
  // our credit note to Birchwood in September, rejected by the customer in IMS
  cnRej = cnote("202509", 27, "birch", 20000);
  // rule 37: Alder's first bill paid only in December (180 days fall in October)
  v("202512", 10, "Payment", P.alder[0], [[P.alder[0], -r2(lines.filter(l => l.guid === firstAlder.guid && l.ledger === P.alder[0])[0].amount), {bills: [[firstAlder.ref, "Agst Ref", -r2(lines.filter(l => l.guid === firstAlder.guid && l.ledger === P.alder[0])[0].amount)]]}], ["Kestrel Bank", r2(lines.filter(l => l.guid === firstAlder.guid && l.ledger === P.alder[0])[0].amount)]]);
  // a deleted, a cancelled and an optional entry: none counts
  sale("202507", 28, "birch", 77777).deleted_at = "2025-08-02T10:00:00Z";
  sale("202508", 28, "birch", 55555).cancelled = true;
  sale("202508", 29, "birch", 44444).optional = true;
  // the 2Bs as the app keeps them (twoBs: the portal's JSON read by m2bFrom2bJson; the test reads it with the app's reader)
  const portal = Object.keys(twob).sort().map(ym => { const t = twob[ym], rp = ym.slice(4, 6) + ym.slice(0, 4);
    return {data: {gstin: OWN, rtnprd: rp, gendt: "14-" + rp.slice(0, 2) + "-" + rp.slice(2), docdata: {b2b: Object.values(t.b2b), cdnr: Object.values(t.cdnr).map(g => ({ctin: g.ctin, trdnm: g.trdnm, supfildt: g.supfildt, nt: g.inv}))},
      docRejdata: {b2b: Object.values(t.rej)}}}; });
  const ledgers = [], led = (name, parent, x) => ledgers.push(Object.assign({name, parent, open: 0, pan: "", gstin: ""}, x || {}));
  Object.values(P).forEach(p => led(p[0], p[1], {gstin: p[2], pan: p[2] ? p[2].slice(2, 12) : ""}));
  ["Sales - Goods", "Sales - Services", "Sales - Exempt"].forEach(l => led(l, "Sales Accounts"));
  led("Purchases", "Purchase Accounts"); ["Rent", "Freight", "Office Expenses"].forEach(l => led(l, "Indirect Expenses")); led("Machinery", "Fixed Assets");
  TAX.map(t => t[0]).concat(["Input CGST Common", "Input SGST Common", "RCM CGST Payable", "RCM SGST Payable", "Input CGST RCM", "Input SGST RCM"]).forEach(l => led(l, "Duties & Taxes"));
  led("Kestrel Bank", "Bank Accounts", {open: -2500000});
  const groups = [["Sundry Debtors", "Current Assets"], ["Sundry Creditors", "Current Liabilities"], ["Bank Accounts", "Current Assets"], ["Duties & Taxes", "Current Liabilities"],
    ["Sales Accounts", ""], ["Purchase Accounts", ""], ["Indirect Expenses", ""], ["Fixed Assets", ""], ["Current Assets", ""], ["Current Liabilities", ""]].map(([name, parent]) => ({name, parent}));
  // FinCom's ledger list as set in the app (Settings > ledgers, by hand): the tax ledgers and the bank
  const map = {};
  TAX.forEach(([l, tax, side]) => { map[l] = {kind: "gst", what: "gst", tax, side, reg: "07", ok: true, byHand: true}; });
  map["Input CGST Common"] = {kind: "gst_common", what: "gst_common", tax: "CGST", side: "input", reg: "07", ok: true, byHand: true};
  map["Input SGST Common"] = {kind: "gst_common", what: "gst_common", tax: "SGST", side: "input", reg: "07", ok: true, byHand: true};
  map["RCM CGST Payable"] = {kind: "gst", what: "gst_rcm", tax: "CGST", side: "output", rcm: true, reg: "07", ok: true, byHand: true};
  map["RCM SGST Payable"] = {kind: "gst", what: "gst_rcm", tax: "SGST", side: "output", rcm: true, reg: "07", ok: true, byHand: true};
  map["Input CGST RCM"] = {kind: "gst", what: "gst_rcm", tax: "CGST", side: "input", rcm: true, reg: "07", ok: true, byHand: true};
  map["Input SGST RCM"] = {kind: "gst", what: "gst_rcm", tax: "SGST", side: "input", rcm: true, reg: "07", ok: true, byHand: true};
  map["Kestrel Bank"] = {kind: "bank", what: "bank", ok: true, byHand: true};
  const work = {
    map, gstOpen: {"07": {igst: 12000, cgst: 4000, sgst: 4000, cess: 0}},
    gstSet: {"07": {filing: [{type: "qrmp", from: "202601"}]}},
    rule37On: {"07": true}, rev: {d2: true},
    assets: [{id: "as1", name: "Packing line", date: "2025-05-10", use: "common", reg: "07", igst: 0, cgst: 54000, sgst: 54000, cess: 0}],
    gst3b: {"07|202508": {rev2: {cgst: 750, sgst: 750}}, "07|202511": {reclaim: {igst: 1200}}},
    outRej: {"07": {[cnRej.guid]: {kind: "cn", act: "rejected", addYm: "202510", date: "20251012"}}},
    itcTrack: {"07": {dec: {}, sent: {}, contact: {}}},
    reco2b: {confirm: {}, link: {}, tag: {}},
    gstFiled: {"07": {"202508": {pmt06: {}}, "202601": {pmt06: {cgst: 20000, sgst: 20000}}}},
    states: Object.fromEntries(Object.values(P).filter(p => p[3]).map(p => [p[0], p[3]])),
  };
  const co = {name: "Synthetic Traders Pvt Ltd", gstin: OWN, supInvFrom: "ref", choices: {advGst: {value: "on", state: "confirmed", by: "test", at: "2025-04-01T00:00:00Z"}}};
  const sales = [{id: "mk1", source: "market", status: "ok", x: {date: "2025-08-12", number: "AMZ-0812", taxable: 1000, igst: 180, cgst: 0, sgst: 0, cess: 0, total: 1180, rate: 18,
    customerGstin: "", placeOfSupply: "Haryana", ecommerce: "amazon", tcs: 10}}];
  return {OWN, heads, lines, bills, ledgers, groups, work, co, sales, portal, aiBill, juneInv, d1, e1, months: MONTHS,
    book: {book_id: "bbbbbbbb-0153-4000-8000-000000000001", firm_id: "", client_id: "", company: "Synthetic Traders Pvt Ltd", from_date: "2025-04-01", open_as_on: null, ledgers_at: "2026-04-01T00:00:00Z"}};
}
module.exports = {world, MONTHS};
