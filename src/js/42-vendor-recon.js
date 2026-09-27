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

function viewVendorRecon(){
  const V0 = VR.st(), R = V0.res;
  const m = v => v === null || v === undefined ? "—" : (v < 0 ? "−" : "") + INR.format(Math.abs(v));
  const side = v => v === null ? "" : v > 0.004 ? " payable" : v < -0.004 ? " advance" : "";
  const live = Bridge.on() && Bridge.up();
  const leds = VR.ledgers();
  let h = '<section class="recon vrec"><div class="recon-head"><div><h3>Vendor ledger reconciliation</h3><div class="note">The vendor’s ledger (the account they sent) against the party’s ledger in Tally, for the dates you choose.</div></div>' +
    '<div class="row" style="gap:8px">' + (R ? '<button class="btn small" data-act="vrExcel">Download Excel</button>' : "") + '<button class="btn small" data-act="vrClose">Close</button></div></div>';
  h += '<div class="vr-form">' +
    '<label><span>Vendor ledger in Tally</span><input type="text" list="vrLedgers" data-vr="ledger" data-fk="vr:ledger" data-keeptyped autocomplete="off" placeholder="Start typing the name" value="' + esc(V0.ledger) + '">' +
      '<datalist id="vrLedgers">' + leds.slice(0, 3000).map(l => '<option value="' + esc(l.name) + '">' + esc(l.group || "") + "</option>").join("") + "</datalist>" +
      (V0.ledger && !exactLedger(V0.ledger) ? '<small class="bad">Not a Tally ledger yet — choose one from the list</small>' : "") + "</label>" +
    '<label><span>From</span><input type="date" data-vr="from" value="' + esc(V0.from) + '"></label>' +
    '<label><span>Up to</span><input type="date" data-vr="to" value="' + esc(V0.to) + '"></label>' +
    '<label><span>Vendor’s ledger file</span><button class="btn small" data-act="vrPick">' + (V0.fileName ? esc(V0.fileName) : "Choose Excel, CSV or PDF") + '</button><input type="file" id="vrFile" hidden accept=".xlsx,.xls,.xlsm,.csv,.txt,.pdf,image/*"></label>' +
    '<div style="align-self:end"><button class="btn primary" data-act="vrRun"' + (live && !V0.busy ? "" : " disabled") + ">Reconcile</button></div></div>" +
    (!live ? '<p class="note">Connect the Tally Bridge and open the company in Tally to reconcile.</p>' : "");
  if (V0.busy) h += '<div class="busy-float">' + busyCard("Reconciling the vendor’s ledger…", V0.busy, 0, 0) + "</div>";
  if (!R) return h + "</section>";
  const V = R.V, T = R.T;
  const agreed = R.unexplained !== null && Math.abs(R.vClose - R.tClose) < 0.01 && !R.onlyV.length && !R.onlyT.length && !R.differ.length && !(R.openDiff && Math.abs(R.openDiff) >= 0.01);
  h += '<div class="note" style="margin:6px 0 10px">' + esc(R.ledger) + " in " + esc(R.company) + " · " + fmtDate(R.from) + " to " + fmtDate(R.to) + " · " + esc(R.file) + " read as " + esc(R.sides) + " · " + R.pairs.length + " entries matched</div>";
  if (agreed) return h + '<div class="bk-bal ok"><div>✔ <b>The ledgers agree.</b> Every entry is on both sides, and the balance on ' + fmtDate(R.to) + " is " + m(R.tClose) + side(R.tClose) + " in both.</div></div></section>";
  // what to look at first
  const firstMid = R.timeline.find(x => x.date > R.from || !(R.openDiff && Math.abs(R.openDiff) >= 0.01));
  const notes = [];
  if (R.openDiff !== null && Math.abs(R.openDiff) >= 0.01) notes.push("<b>The opening balances differ</b> by " + m(Math.abs(R.openDiff)) + ": the vendor opens at " + m(R.vOpen) + side(R.vOpen) + ", Tally at " + m(R.tOpen) + side(R.tOpen) + " on " + fmtDate(addDays(R.from, -1)) + ". Entries before " + fmtDate(R.from) + " differ — reconcile the earlier period too.");
  else if (R.openDiff !== null) notes.push("The opening balances agree (" + m(R.tOpen) + side(R.tOpen) + ").");
  if (firstMid) notes.push("<b>The balances first move apart on " + fmtDate(firstMid.date) + "</b> (by " + m(Math.abs(firstMid.change)) + ")" + (firstMid.why.length ? ": " + esc(firstMid.why.slice(0, 3).join("; ")) : "") + ".");
  h += '<div class="bk-alert bad" style="margin-bottom:10px">' + notes.map(x => "<div>" + x + "</div>").join("") + "</div>";
  const line = (label, v, sign) => "<tr><td>" + label + '</td><td class="n">' + (v ? sign + m(Math.abs(v)) : "—") + "</td></tr>";
  h += '<table class="data recon-stmt"><tbody>' +
    "<tr><td><b>Balance in Tally on " + fmtDate(R.to) + '</b></td><td class="n"><b>' + m(R.tClose) + side(R.tClose) + "</b></td></tr>" +
    (R.openDiff && Math.abs(R.openDiff) >= 0.01 ? line("Opening balance difference (vendor less Tally)", R.openDiff, R.openDiff > 0 ? "+ " : "− ") : "") +
    line("Add: bills in the vendor’s ledger, not in Tally", sum0(R.onlyV.map(i => V[i]).filter(x => x.eff > 0)), "+ ") +
    line("Less: payments and credit notes in the vendor’s ledger, not in Tally", sum0(R.onlyV.map(i => V[i]).filter(x => x.eff < 0)), "− ") +
    line("Less: bills in Tally, not in the vendor’s ledger", sum0(R.onlyT.map(i => T[i]).filter(x => x.eff > 0)), "− ") +
    line("Add: payments and debit notes in Tally, not in the vendor’s ledger", sum0(R.onlyT.map(i => T[i]).filter(x => x.eff < 0)), "+ ") +
    (R.differ.length ? line("Amounts that differ (vendor less Tally)", R.dEff, R.dEff >= 0 ? "+ " : "− ") : "") +
    (R.unexplained !== null && Math.abs(R.unexplained) >= 0.01 ? line("Not explained by the entries below", R.unexplained, R.unexplained >= 0 ? "+ " : "− ") : "") +
    '<tr class="tot"><td><b>Balance in the vendor’s ledger on ' + fmtDate(R.to) + '</b></td><td class="n"><b>' + m(R.vClose) + side(R.vClose) + "</b></td></tr></tbody></table>";
  const tbl = (title, rows, cols) => rows.length ? '<div class="recon-sec"><h4>' + title + ' <span class="cnt">' + rows.length + '</span></h4><div class="tblwrap"><table class="data"><thead><tr>' + cols.map(c => "<th" + (c[2] ? ' class="n"' : "") + ">" + c[0] + "</th>").join("") + "</tr></thead><tbody>" +
    rows.slice(0, 500).map(r => "<tr>" + cols.map(c => "<td" + (c[2] ? ' class="n"' : "") + ">" + c[1](r) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div></div>" : "";
  const amt = x => m(Math.abs(x.eff)), kind = x => x.eff > 0 ? "bill" : "payment / note";
  h += tbl("In the vendor’s ledger, not in Tally", R.onlyV.map(i => V[i]), [["Date", x => fmtDate(x.date)], ["Particulars", x => esc(x.narr.slice(0, 90))], ["Kind", kind], ["Amount", amt, 1]]);
  h += tbl("In Tally, not in the vendor’s ledger", R.onlyT.map(i => T[i]), [["Date", x => fmtDate(x.date)], ["Voucher", x => esc([x.type, x.number].filter(Boolean).join(" "))], ["Reference", x => esc(x.ref || x.bills.join(", "))], ["Kind", kind], ["Amount", amt, 1]]);
  h += tbl("Same document, different amount", R.differ, [["Date", d => fmtDate(V[d.v].date)], ["Vendor’s particulars", d => esc(V[d.v].narr.slice(0, 60))], ["Tally voucher", d => esc([T[d.t].type, T[d.t].number].filter(Boolean).join(" "))], ["Vendor", d => m(V[d.v].eff), 1], ["Tally", d => m(T[d.t].eff), 1], ["Difference", d => m(V[d.v].eff - T[d.t].eff), 1]]);
  h += tbl("Where the balances move apart", R.timeline, [["Date", x => fmtDate(x.date)], ["Difference after this date", x => m(x.diff), 1], ["Change", x => m(x.change), 1], ["Why", x => esc(x.why.join("; ") || "entries on this date differ")]]);
  return h + "</section>";
}
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

// the form's inputs and buttons
document.addEventListener("input", ev => {
  const t = ev.target;
  if (!t || !t.dataset || !t.dataset.vr || !VR.st()) return;
  S.vrec[t.dataset.vr] = t.value;
  if (t.dataset.vr === "ledger" && exactLedger(t.value)) { S.vrec.ledger = exactLedger(t.value); softRender(); }
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t && t.id === "vrFile" && t.files && t.files[0] && VR.st()){ S.vrec.file = t.files[0]; S.vrec.fileName = t.files[0].name; S.vrec.res = null; render(); }
  else if (t && t.dataset && t.dataset.vr && VR.st()){ S.vrec[t.dataset.vr] = t.value; render(); }
});
document.addEventListener("click", ev => {
  const t = ev.target.closest && ev.target.closest("[data-act]");
  if (!t) return;
  const a = t.dataset.act;
  if (a === "vrOpen"){ S.vrec = VR.def(); render(); window.scrollTo(0, 0); }
  else if (a === "vrClose"){ S.vrec = null; render(); }
  else if (a === "vrPick"){ const f = document.getElementById("vrFile"); if (f) f.click(); }
  else if (a === "vrRun") runVendorRecon();
  else if (a === "vrExcel") vendorReconExcel().catch(e => toast("Could not make the file: " + (e.message || e)));
  else if (a === "reconExcel") bankReconExcel().catch(e => toast("Could not make the file: " + (e.message || e)));
});
