/* ================================================================== */
/* Vendor ledger reconciliation: the vendor's ledger against the      */
/* party's ledger in Tally, for a period, with a downloadable report   */
/* ================================================================== */
// Everything is turned into one measure: the amount this client owes the vendor ("payable").
//   In Tally, a credit to the vendor's ledger (a bill) raises it; a debit (a payment, a debit note) lowers it.
//   In the vendor's own books it is the other way round: their debit (a bill to us) raises it.
// The vendor's file is read by the same reader as bank statements (Excel, CSV, PDF, scans), which gives each line
// a debit, a credit and a running balance; which side is which is found by matching amounts against Tally.
const VR = {
  def(){
    const co = CO(), today = new Date().toISOString().slice(0, 10);
    const y = +today.slice(0, 4), m = +today.slice(5, 7), fy = m >= 4 ? y : y - 1;
    return {open: true, cid: co.id, ledger: "", from: fy + "-04-01", to: today, file: null, fileName: "", res: null, busy: ""};
  },
  st(){ if (!S.vrec || S.vrec.cid !== S.coId) S.vrec = null; return S.vrec; },
  ledgers(){
    const list = typeof knownLedgers === "function" && B() ? Array.from(knownLedgers().values()) : [];
    const cred = l => /creditor|debtor|payable|supplier/i.test(l.group || "");
    return list.slice().sort((a, b) => (cred(b) - cred(a)) || a.name.localeCompare(b.name));
  },
  refs(s){
    // document numbers in a line: tokens with a digit, at least 3 long, without spaces or leading zeros
    return Array.from(new Set(String(s || "").toUpperCase().split(/[\s,;:()|]+/).map(t => t.replace(/[^A-Z0-9\/-]/g, "").replace(/^0+/, ""))
      .filter(t => t.length >= 3 && /\d/.test(t) && !/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(t))));
  }
};

async function runVendorRecon(){
  const V0 = VR.st();
  if (!V0) return;
  const co = CO();
  const ledger = exactLedger(V0.ledger);
  if (!ledger){ toast("Choose the vendor's ledger as it is in Tally (start typing its name)."); return; }
  if (!V0.file){ toast("Choose the vendor's ledger file (Excel, CSV or PDF)."); return; }
  if (!V0.from || !V0.to || V0.from > V0.to){ toast("Choose the dates: from, and up to."); return; }
  const tname = await ensureTallyCompany(co);
  if (!tname) return;
  const setBusy = t => { V0.busy = t; render(); };
  try {
    setBusy("Reading the vendor's ledger…");
    const parsed = await readStatement(V0.file, p => setBusy("Reading the vendor's ledger… " + (p && p.page ? "page " + p.page + (p.pages ? " of " + p.pages : "") : "")));
    const vrows = [].concat(parsed.rows || []).filter(r => r.date && (num(r.debit) || num(r.credit)));
    if (!vrows.length) throw {message: "No entries could be read from " + V0.fileName + "."};
    setBusy("Reading " + ledger + " from Tally…");
    const tb = await tallyBankBalance(tname, ledger, V0.to);                 // -(Tally's figure): a credit balance comes out negative
    const jl = await Bridge.call(ledgerLinesUrl(tname, ledger, V0.from, V0.to), null, 600000);
    if (!Array.isArray(jl.vouchers)) throw {message: "Tally did not return the entries of " + ledger + "."};
    setBusy("Matching the entries…");
    const T = [];
    jl.vouchers.filter(v => !/^yes$/i.test(v.cancelled || "")).forEach(v => {
      const be = [].concat(v.entries || []).find(e => norm(e.ledger) === norm(ledger));
      if (!be) return;
      const date = tallyToIso(v.date);
      if (date < V0.from || date > V0.to) return;
      const other = [].concat(v.entries || []).find(e => norm(e.ledger) !== norm(ledger));
      const bills = [].concat(be.bills || []).map(x => typeof x === "string" ? x : (x && x.name) || "").filter(Boolean);
      T.push({i: T.length, date, type: v.type || "", number: v.number || "", ref: v.reference || "", bills, other: (other && other.ledger) || "",
        narr: String(v.narration || ""), eff: r2(parseFloat(String(be.amount).replace(/,/g, "")) || 0)});
    });
    T.forEach(t => { t.refs = VR.refs([t.ref, t.number, t.bills.join(" "), t.narr].join(" ")); });
    const tClose = r2(-tb.close), tOpen = r2(tClose - T.reduce((a, t) => a + t.eff, 0));
    // which side of the vendor's file is a bill to us: the reading that matches more of Tally's amounts
    const inPeriod = vrows.filter(r => r.date >= V0.from && r.date <= V0.to);
    const bag = new Map(); T.forEach(t => { const k = t.eff.toFixed(2); bag.set(k, (bag.get(k) || 0) + 1); });
    const score = s => { const b2 = new Map(bag); let n = 0; inPeriod.forEach(r => { const k = r2(s * (num(r.debit) - num(r.credit))).toFixed(2); if (b2.get(k)){ n++; b2.set(k, b2.get(k) - 1); } }); return n; };
    const sA = score(1), sB = score(-1), s = sB > sA ? -1 : 1;
    const V = inPeriod.map((r, i) => ({i, date: r.date, narr: String(r.narr || ""), eff: r2(s * (num(r.debit) - num(r.credit))), refs: VR.refs(r.narr), bal: r.balance == null ? null : r2(-s * num(r.balance))}));
    // the vendor's opening and closing, in the same measure
    const meta = parsed.meta || {};
    const firstIdx = vrows.findIndex(r => r.date >= V0.from);
    let vOpen = null;
    if (firstIdx > 0 && vrows[firstIdx - 1].balance != null) vOpen = r2(-s * num(vrows[firstIdx - 1].balance));
    else if (firstIdx === 0 && meta.opening !== undefined && meta.opening !== null && vrows[0].date >= V0.from) vOpen = r2(-s * num(meta.opening));
    else if (V.length && V[0].bal !== null) vOpen = r2(V[0].bal - V[0].eff);
    const lastIn = V.length ? V[V.length - 1] : null;
    let vClose = lastIn && lastIn.bal !== null ? lastIn.bal : null;
    if (vClose === null && vOpen !== null) vClose = r2(vOpen + V.reduce((a, x) => a + x.eff, 0));
    if (vOpen === null && vClose !== null) vOpen = r2(vClose - V.reduce((a, x) => a + x.eff, 0));
    // pair them: same amount with a shared document number; then same amount within a week; then within 60 days
    const pairs = [], usedT = new Set(), usedV = new Set();
    const days = (a1, b1) => Math.abs((new Date(a1) - new Date(b1)) / 864e5);
    const pass = test => V.forEach(v => {
      if (usedV.has(v.i)) return;
      let best = null;
      T.forEach(t => { if (usedT.has(t.i) || Math.abs(t.eff - v.eff) >= 0.01 || !test(v, t)) return; const d = days(v.date, t.date); if (!best || d < best.d) best = {t, d}; });
      if (best){ usedV.add(v.i); usedT.add(best.t.i); pairs.push({v: v.i, t: best.t.i}); }
    });
    const shared = (v, t) => v.refs.some(x => t.refs.includes(x));
    pass((v, t) => shared(v, t));
    pass((v, t) => days(v.date, t.date) <= 7);
    pass((v, t) => days(v.date, t.date) <= 60);
    // the same document on both sides with another amount
    const differ = [];
    V.forEach(v => { if (usedV.has(v.i) || !v.refs.length) return; const t = T.find(t2 => !usedT.has(t2.i) && Math.sign(t2.eff) === Math.sign(v.eff) && shared(v, t2)); if (t){ usedV.add(v.i); usedT.add(t.i); differ.push({v: v.i, t: t.i}); } });
    // no shared number: the same kind of entry within 3 days, with an amount within 10%, is taken as the same document
    V.forEach(v => { if (usedV.has(v.i)) return; const t = T.find(t2 => !usedT.has(t2.i) && Math.sign(t2.eff) === Math.sign(v.eff) && days(v.date, t2.date) <= 3 && Math.abs(t2.eff - v.eff) <= 0.1 * Math.abs(v.eff)); if (t){ usedV.add(v.i); usedT.add(t.i); differ.push({v: v.i, t: t.i}); } });
    const onlyV = V.filter(v => !usedV.has(v.i)), onlyT = T.filter(t => !usedT.has(t.i));
    const sum = (list, f) => r2(list.reduce((a, x) => a + f(x), 0));
    const openDiff = vOpen === null ? null : r2(vOpen - tOpen);
    const vEff = sum(onlyV, x => x.eff), tEff = sum(onlyT, x => x.eff), dEff = sum(differ, d => V[d.v].eff - T[d.t].eff);
    const unexplained = vClose === null ? null : r2(vClose - (tClose + (openDiff || 0) + vEff - tEff + dEff));
    // where the running balances move apart: every date on which the difference changes, and what caused it
    const timeline = [];
    if (vOpen !== null){
      const dates = Array.from(new Set(V.map(x => x.date).concat(T.map(x => x.date)))).sort();
      let tb2 = tOpen, vb = vOpen, prev = r2(vOpen - tOpen);
      if (Math.abs(prev) >= 0.01) timeline.push({date: V0.from, diff: prev, change: prev, why: ["opening balances differ"]});
      dates.forEach(d => {
        V.filter(x => x.date === d).forEach(x => { vb += x.eff; });
        T.filter(x => x.date === d).forEach(x => { tb2 += x.eff; });
        const diff = r2(vb - tb2);
        if (Math.abs(diff - prev) >= 0.01){
          const why = onlyV.filter(x => x.date === d).map(x => "vendor only: " + INR.format(x.eff) + " " + x.narr.slice(0, 40))
            .concat(onlyT.filter(x => x.date === d).map(x => "Tally only: " + INR.format(x.eff) + " " + [x.type, x.number].filter(Boolean).join(" ")))
            .concat(differ.filter(p => V[p.v].date === d || T[p.t].date === d).map(p => "amount differs: vendor " + INR.format(Math.abs(V[p.v].eff)) + ", Tally " + INR.format(Math.abs(T[p.t].eff)) + " (" + [T[p.t].type, T[p.t].number].filter(Boolean).join(" ") + ")"))
            .concat(pairs.concat(differ).filter(p => (V[p.v].date === d) !== (T[p.t].date === d) && (V[p.v].date === d || T[p.t].date === d)).map(p => "same entry on another date: " + fmtDate(V[p.v].date) + " (vendor) / " + fmtDate(T[p.t].date) + " (Tally)"));
          timeline.push({date: d, diff, change: r2(diff - prev), why});
          prev = diff;
        }
      });
    }
    V0.res = {at: Date.now(), company: tname, ledger, from: V0.from, to: V0.to, file: V0.fileName, method: parsed.method || "", sides: s === 1 ? "vendor's books (their debit is a bill to us)" : "our account copy (credit is a bill)",
      V, T, pairs, differ, onlyV: onlyV.map(x => x.i), onlyT: onlyT.map(x => x.i), tOpen, tClose, vOpen, vClose, openDiff, vEff, tEff, dEff, unexplained, timeline, how: tb.how};
    V0.busy = "";
    render();
  } catch (e){ V0.busy = ""; toast("Could not reconcile: " + (e.message || e.code || e)); render(); }
}

// the vendor reconciliation page: React (app/src/screens/VendorRecon.jsx), shown on the purchase bills tab
function sum0(list){ return r2(list.reduce((a, x) => a + Math.abs(x.eff), 0)); }

async function vendorReconExcel(){
  const V0 = VR.st(), R = V0 && V0.res;
  if (!R) return;
  await ensureXlsx();
  const V = R.V, T = R.T, d = s => fmtDate(s);
  const wb = XLSX.utils.book_new(), add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
  const sumSide = (list, f) => r2(list.filter(f).reduce((a, x) => a + Math.abs(x.eff), 0));
  add("Reconciliation", [
    ["Vendor ledger reconciliation"], [CO().name + " · " + R.ledger + " · " + d(R.from) + " to " + d(R.to)], ["Vendor's file: " + R.file + " (read as " + R.sides + ")"], [],
    ["Balance in Tally on " + d(R.to) + " (payable +, advance −)", R.tClose],
    ["Opening balance difference (vendor less Tally)", R.openDiff || 0],
    ["Add: bills in the vendor's ledger, not in Tally", sumSide(R.onlyV.map(i => V[i]), x => x.eff > 0)],
    ["Less: payments and credit notes in the vendor's ledger, not in Tally", -sumSide(R.onlyV.map(i => V[i]), x => x.eff < 0)],
    ["Less: bills in Tally, not in the vendor's ledger", -sumSide(R.onlyT.map(i => T[i]), x => x.eff > 0)],
    ["Add: payments and debit notes in Tally, not in the vendor's ledger", sumSide(R.onlyT.map(i => T[i]), x => x.eff < 0)],
    ["Amounts that differ (vendor less Tally)", R.dEff],
    ["Not explained", R.unexplained || 0],
    ["Balance in the vendor's ledger on " + d(R.to), R.vClose], [],
    ["Opening balance in Tally", R.tOpen], ["Opening balance in the vendor's ledger", R.vOpen], ["Entries matched", R.pairs.length]]);
  add("Vendor only", [["Date", "Particulars", "Kind", "Amount (payable +)"]].concat(R.onlyV.map(i => V[i]).map(x => [d(x.date), x.narr, x.eff > 0 ? "bill" : "payment / note", x.eff])));
  add("Tally only", [["Date", "Voucher type", "Voucher no.", "Reference", "Other ledger", "Narration", "Kind", "Amount (payable +)"]].concat(R.onlyT.map(i => T[i]).map(x => [d(x.date), x.type, x.number, x.ref || x.bills.join(", "), x.other, x.narr, x.eff > 0 ? "bill" : "payment / note", x.eff])));
  add("Amount differs", [["Vendor date", "Vendor particulars", "Tally date", "Tally voucher", "Vendor amount", "Tally amount", "Difference"]].concat(R.differ.map(p => [d(V[p.v].date), V[p.v].narr, d(T[p.t].date), [T[p.t].type, T[p.t].number].join(" "), V[p.v].eff, T[p.t].eff, r2(V[p.v].eff - T[p.t].eff)])));
  add("Where they move apart", [["Date", "Difference after this date", "Change", "Why"]].concat(R.timeline.map(x => [d(x.date), x.diff, x.change, x.why.join("; ")])));
  add("Matched", [["Vendor date", "Vendor particulars", "Tally date", "Tally voucher", "Amount"]].concat(R.pairs.map(p => [d(V[p.v].date), V[p.v].narr, d(T[p.t].date), [T[p.t].type, T[p.t].number].join(" "), V[p.v].eff])));
  const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
  saveFile((R.ledger + "-reconciliation-" + R.from + "-to-" + R.to).replace(/[^A-Za-z0-9.-]+/g, "-") + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
}

/* ---------- the bank reconciliation, as an Excel file ---------- */
async function bankReconExcel(){
  const R = S.recon, b = B();
  if (!R) return;
  await ensureXlsx();
  const rowById = new Map(b.rows.map(r => [r.id, r])), d = s => fmtDate(s), eff = r => r2(num(r.credit) - num(r.debit));
  const wb = XLSX.utils.book_new(), add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
  const miss = R.missing.map(id => rowById.get(id)).filter(Boolean), extra = R.extra.map(i => R.T[i]);
  add("Reconciliation", [
    ["Bank reconciliation"], [CO().name + " · " + R.ledger + " · " + d(R.from) + " to " + d(R.to)], [],
    ["Balance in Tally on " + d(R.to), R.tClose],
    ["Add: deposits on the statement, not in Tally", r2(miss.reduce((a, r) => a + num(r.credit), 0))],
    ["Less: withdrawals on the statement, not in Tally", -r2(miss.reduce((a, r) => a + num(r.debit), 0))],
    ["Less: receipts in Tally, not on the statement", -r2(extra.reduce((a, t) => a + Math.max(0, t.eff), 0))],
    ["Add: payments in Tally, not on the statement", r2(extra.reduce((a, t) => a + Math.max(0, -t.eff), 0))],
    ["Amounts that differ (statement less Tally)", R.dEff],
    ["Opening balance difference", R.openDiff],
    ["Not explained", R.unexplained || 0],
    ["Balance as per the bank statement on " + d(R.to), R.sClose], [],
    ["Opening balance in Tally", R.tOpen], ["Opening balance on the statement", R.sOpen], ["Lines matched", R.pairs]]);
  add("On statement, not in Tally", [["Date", "Particulars", "Withdrawal", "Deposit", "Ledger", "Status"]].concat(miss.map(r => [d(r.date), r.narr, num(r.debit) || "", num(r.credit) || "", r.ledger || "", r.state])));
  add("In Tally, not on statement", [["Date", "Voucher type", "Voucher no.", "Party / ledger", "In", "Out", "Narration"]].concat(extra.map(t => [d(t.date), t.type, t.number, t.party, t.eff > 0 ? t.eff : "", t.eff < 0 ? -t.eff : "", t.narr])));
  add("Amount differs", [["Date", "Particulars", "Statement", "Tally", "Tally voucher"]].concat(R.differ.map(x => { const r = rowById.get(x.rowId), t = R.T[x.ti]; return [d(r.date), r.narr, eff(r), t.eff, [t.type, t.number].join(" ")]; })));
  add("Statement lines", [["Date", "Particulars", "Withdrawal", "Deposit", "Balance", "Ledger", "Status"]].concat(b.rows.filter(r => r.date >= R.from && r.date <= R.to).map(r => [d(r.date), r.narr, num(r.debit) || "", num(r.credit) || "", r.balance == null ? "" : r.balance, r.ledger || "", r.state])));
  const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
  saveFile((R.ledger + "-bank-reconciliation-" + R.from + "-to-" + R.to).replace(/[^A-Za-z0-9.-]+/g, "-") + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
}

// what the vendor reconciliation page does
function vrOpen(){ S.vrec = VR.def(); render(); window.scrollTo(0, 0); }
function vrClose(){ S.vrec = null; render(); }
// the ledger, from and to; a ledger typed that is a Tally ledger takes Tally's spelling
function vrSet(key, val){
  if (!VR.st()) return;
  S.vrec[key] = val;
  if (key === "ledger"){ const x = exactLedger(val); if (x) S.vrec.ledger = x; FinComReact.redraw(); return; }
  render();
}
function vrFile(file){ if (!file || !VR.st()) return; S.vrec.file = file; S.vrec.fileName = file.name; S.vrec.res = null; render(); }
function vrExcel(){ vendorReconExcel().catch(e => toast("Could not make the file: " + (e.message || e))); }
// the bank reconciliation's Excel (app/src/parts/BankChecks.jsx)
function reconExcelGo(){ bankReconExcel().catch(e => toast("Could not make the file: " + (e.message || e))); }
