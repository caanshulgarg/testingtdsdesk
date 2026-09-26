/* ================================================================== */
/* GST settings: per GSTIN (filing type, credit basis, opening credit, */
/* rule 37, e-invoicing, Tally cash ledger) and for the client (year  */
/* turnover, rule 42 non-business use, party contacts)                */
/* ================================================================== */
// The client's PAN: as typed in its settings, else the middle ten characters of its GSTIN
function clientPan(co){ const c = co || (typeof CO === "function" ? CO() : null) || {}, p = String(c.pan || "").toUpperCase().trim(), g = String(c.gstin || "").toUpperCase().trim();
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(p) ? p : /^\d{2}[A-Z]{5}\d{4}[A-Z]/.test(g) ? g.slice(2, 12) : ""; }
// GSTINs that are not the client's: their PAN differs from the client's PAN (nothing is refused while the client has no PAN)
function notThisClient(gstins, co){ const pan = clientPan(co); if (!pan) return []; return Array.from(new Set((gstins || []).map(g => String(g || "").toUpperCase()).filter(g => /^\d{2}[A-Z0-9]{13}$/.test(g) && g.slice(2, 12) !== pan))); }
function panRefusal(what, bad, co){ const c = co || CO() || {}; return what + " is for " + bad.join(", ") + " (PAN " + bad[0].slice(2, 12) + "), not " + (c.name || "this client") + " (PAN " + clientPan(c) + "). Nothing was brought in."; }
const GSTSet = {
  TYPES: [["monthly", "Monthly"], ["qrmp", "Quarterly (QRMP)"], ["comp", "Composition"]],
  // QRMP 3B falls due on the 22nd in these states and union territories, on the 24th elsewhere
  Q22: new Set(["22", "23", "24", "25", "26", "27", "29", "30", "31", "32", "33", "34", "35", "36", "37"]),
  store(reg){ const b = S.books; b.gstSet = b.gstSet || {}; return b.gstSet[reg || ""] = b.gstSet[reg || ""] || {}; },
  peek(reg){ return (((S.books || {}).gstSet) || {})[reg || ""] || {}; },
  qStart(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6), s = m >= 4 ? m - ((m - 4) % 3) : 1; return y + String(s).padStart(2, "0"); },
  qEnd(ym){ const s = this.qStart(ym), y = +s.slice(0, 4), m = +s.slice(4, 6) + 2; return y + String(m).padStart(2, "0"); },
  isQEnd(ym){ return this.qEnd(ym) === ym; },
  qLabel(ym){ const m = +this.qStart(ym).slice(4, 6), y = +ym.slice(0, 4), fy = m >= 4 ? y : y - 1; return ({4: "Q1", 7: "Q2", 10: "Q3", 1: "Q4"})[m] + " " + fy + "-" + String(fy + 1).slice(2); },
  // filing type in force for a month: the latest choice whose quarter has begun
  history(reg){ return (this.peek(reg).filing || []).slice().sort((a, c) => a.from.localeCompare(c.from)); },
  typeOf(ym, reg){ let t = "monthly"; this.history(reg).forEach(x => { if (x.from <= this.qStart(ym)) t = x.type; }); return t; },
  typeLabel(t){ return (this.TYPES.find(x => x[0] === t) || [, t])[1]; },
  // the window the portal allows to change between QRMP and monthly for a quarter:
  // from the 1st of the second month of the quarter before, to the last day of the quarter's first month
  window(q){ const s = this.qStart(q), p = GSTR.nextYm ? null : null, y = +s.slice(0, 4), m = +s.slice(4, 6);
    const back = n => { let yy = y, mm = m - n; while (mm < 1){ mm += 12; yy--; } return yy + "-" + String(mm).padStart(2, "0"); };
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return {from: back(2) + "-01", to: last}; },
  einvMode(reg){ return this.peek(reg).einv || "auto"; },
  // a party's email and phone: typed in settings, else kept from earlier letters, else Tally's masters
  contact(gstin, party, legacy){
    const c = (((S.books || {}).gstContacts) || {})[String(gstin || "").toUpperCase()] || {}, l = legacy || {}, i = (((S.books || {}).ledInfo) || {})[party] || {};
    return {email: c.email || l.email || i.email || "", phone: c.phone || l.phone || i.phone || i.mobile || ""};
  },
  // parties with a GSTIN in the GST working, suppliers and customers
  parties(){
    const b = S.books, key = (b.vouchers || []).length + "|" + (b.mapV || 0);
    if (this._p && this._p.key === key && this._p.v === b.vouchers) return this._p.list;
    const m = new Map();
    (b.vouchers || []).forEach(v => { const g = String(v.gstin || "").toUpperCase(); if (!/^\d{2}[A-Z0-9]{13}$/.test(g) || !v.party) return;
      const side = Books.isSale(v) ? "customer" : Books.isPurchase(v) ? "supplier" : ""; if (!side) return;
      const x = m.get(g) || {gstin: g, party: v.party, sides: new Set(), n: 0}; x.sides.add(side); x.n++; m.set(g, x); });
    const list = Array.from(m.values()).map(x => Object.assign(x, {sides: Array.from(x.sides).sort().join(" and ")})).sort((a, c) => c.n - a.n);
    this._p = {key, v: b.vouchers, list}; return list;
  }
};
// The client's GSTINs: read from Tally, added in GST settings, or the one in Client setup. All must carry the client's PAN.
const GSTRegs = {
  STATES: {"01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory"},
  state(g){ return this.STATES[String(g || "").slice(0, 2)] || "State " + String(g || "").slice(0, 2); },
  source(g, b){ b = b || S.books || {}; const co = CO() || {};
    const t = [];
    if (((b.meta || {}).gstins || []).map(x => String(x).toUpperCase()).includes(g)) t.push("from Tally");
    if ((b.gstRegs || []).some(r => r.gstin === g)) t.push("added here");
    if (String(co.gstin || "").toUpperCase().trim() === g) t.push("Client setup");
    return t; },
  // why a GSTIN cannot be added, or "" when it can
  refuse(g, b){ g = String(g || "").toUpperCase().trim(); b = b || S.books || {};
    if (!/^\d{2}[A-Z0-9]{13}$/.test(g)) return "A GSTIN has 15 characters: 2-digit state code, PAN, entity number, Z and a check character.";
    if (!gstinValid(g)) return g + " is not a valid GSTIN: its last character (the check character) does not agree with the rest.";
    if (!this.STATES[g.slice(0, 2)]) return g + " starts with " + g.slice(0, 2) + ", which is not a state code.";
    const pan = clientPan();
    if (!pan) return "Type the client’s PAN in Client setup first; every GSTIN added must carry it.";
    if (g.slice(2, 12) !== pan) return g + " is for PAN " + g.slice(2, 12) + ", not this client’s PAN " + pan + ".";
    if (GSTR.gstins(b).includes(g)) return g + " is already here.";
    if (GSTR.gstins(b).some(x => x.slice(0, 2) === g.slice(0, 2))) return "This client already has a GSTIN in " + this.state(g) + "; TDS Desk keeps one GSTIN for each state.";
    return ""; },
  add(g){ const b = S.books; g = String(g || "").toUpperCase().trim(); b.gstRegs = (b.gstRegs || []).concat([{gstin: g, at: new Date().toISOString()}]); GSTR._carry = null; },
  remove(g){ const b = S.books; b.gstRegs = (b.gstRegs || []).filter(r => r.gstin !== g); GSTR._carry = null; }
};
function viewGstRegs(b, regs){
  let h = '<section class="dash-card" style="margin-bottom:12px"><h3>GST registrations</h3>' +
    '<p class="note" style="margin:0 0 8px">The GSTINs of ' + esc((CO() || {}).name || "this client") + " (PAN " + esc(clientPan() || "not set") + "). The GST tab works for these even before any Tally day book is brought in: 2B from the portal or its JSON, and the returns filed.</p>";
  if (regs.length) h += '<div class="bk-tablewrap"><table class="bk-table compact"><thead><tr><th>GSTIN</th><th>State</th><th>Filing type now</th><th>Portal username</th><th>Taken from</th><th></th></tr></thead><tbody>' +
    regs.map(g => { const reg = g.slice(0, 2), src = GSTRegs.source(g, b), only = src.length === 1 && src[0] === "added here", months = GSTR.months();
      return '<tr><td><b>' + esc(g) + "</b></td><td>" + esc(GSTRegs.state(g)) + "</td><td>" + esc(GSTSet.typeLabel(GSTSet.typeOf(months[months.length - 1] || GSTF.today().slice(0, 7).replace("-", ""), reg))) + "</td><td>" + esc(GSTSet.peek(reg).portalUser || "—") +
        "</td><td>" + esc(src.join(", ")) + "</td><td>" + (S.gsetReg === reg ? '<span class="note">settings below</span>' : '<button class="linkbtn" data-gsetpick="' + reg + '">settings</button>') +
        (only ? ' · <button class="linkbtn" data-gregdel="' + esc(g) + '">remove</button>' : "") + "</td></tr>"; }).join("") + "</tbody></table></div>";
  else h += '<p class="note" style="color:#B9541B">No GSTIN yet. Add the client’s GSTIN below to use the GST tab.</p>';
  h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px"><input type="text" data-gregnew data-fk="gregnew" data-keeptyped maxlength="15" placeholder="15-character GSTIN" style="width:240px;text-transform:uppercase" autocomplete="off"><button class="btn small primary" data-gregadd>Add GSTIN</button>' +
    '<span class="note">Its PAN must be the client’s PAN.</span></div>' +
    (regs.length > 1 ? '<div style="margin-top:10px"><label class="note">Settings shown for <select data-gsetreg style="width:auto">' + regs.map(g => '<option value="' + g.slice(0, 2) + '"' + (S.gsetReg === g.slice(0, 2) ? " selected" : "") + ">" + esc(g) + " · " + esc(GSTRegs.state(g)) + "</option>").join("") + "</select></label></div>" : "") +
    "</section>";
  return h;
}
// a setting changed for one GSTIN: with more than one, ask whether it is for this GSTIN only (the default), all of them, or those ticked
async function gsetApply(reg, what, fn){
  const regs = GSTR.gstins(S.books), others = regs.filter(g => g.slice(0, 2) !== reg), me = regs.find(g => g.slice(0, 2) === reg) || reg;
  if (!others.length || typeof document === "undefined"){ fn(reg); return true; }
  const r = await askConfirm({title: "Apply to which GSTINs?", ok: "Save",
    body: "<p>" + esc(what) + " for " + esc(me) + ".</p>" +
      '<label class="chk" style="display:block"><input type="radio" name="gapto" value="one" checked> Only ' + esc(me) + "</label>" +
      '<label class="chk" style="display:block"><input type="radio" name="gapto" value="all"> All ' + regs.length + " GSTINs of the client</label>" +
      '<label class="chk" style="display:block"><input type="radio" name="gapto" value="some"> ' + esc(me) + " and the GSTINs ticked:</label>" +
      '<div style="margin-left:24px">' + others.map(g => '<label class="chk" style="display:block"><input type="checkbox" data-gapto="' + g.slice(0, 2) + '"> ' + esc(g) + " · " + esc(GSTRegs.state(g)) + "</label>").join("") + "</div>",
    onReady: box => box.querySelectorAll("[data-gapto]").forEach(c => c.addEventListener("change", () => { if (c.checked){ const s = box.querySelector('input[name="gapto"][value="some"]'); if (s) s.checked = true; } })),
    read: () => { const box = document.getElementById("confirmBox"), mode = (box.querySelector('input[name="gapto"]:checked') || {}).value || "one";
      return {mode, ticked: Array.from(box.querySelectorAll("[data-gapto]:checked")).map(c => c.dataset.gapto)}; },
    validate: d => d.mode === "some" && !d.ticked.length ? "Tick the other GSTINs, or choose “Only " + me + "”." : ""});
  if (!r){ render(); return false; }
  const to = r.data.mode === "all" ? regs.map(g => g.slice(0, 2)) : r.data.mode === "some" ? [reg].concat(r.data.ticked) : [reg];
  Array.from(new Set(to)).forEach(x => fn(x));
  if (to.length > 1) toast(what + ": saved for " + to.length + " GSTINs.");
  return true;
}
function gstSetLink(label){ return '<button class="linkbtn" data-gotogstset>' + esc(label || "change in GST settings") + "</button>"; }
function viewGstSettings(){
  const co = CO();
  if (!S.books || S.books.cid !== co.id || S.books.loading){ if (!S.books || S.books.cid !== co.id) openBooks(co.id); return '<p class="note">Opening the books\u2026</p>'; }
  const b = S.books, regs = (GSTR.gstins(b) || []), money = v => INR.format(r2(v || 0));
  const months = GSTR.months(), first = months[0] || "";
  if (!regs.some(g => g.slice(0, 2) === S.gsetReg)){ const own = String(co.gstin || "").toUpperCase().slice(0, 2); S.gsetReg = ((regs.find(g => g.slice(0, 2) === own) || regs[0] || "")).slice(0, 2); }
  const quarters = Array.from(new Set(months.map(m => GSTSet.qStart(m))));
  let h = '<div class="stack"><div class="pane" style="margin-top:0"><h2>GST settings</h2><p class="note" style="margin:0 0 12px">Settings that stay the same month after month, for each GSTIN and for the client. What changes each month \u2014 filing dates, portal figures, IMS and follow-up decisions \u2014 stays on the GST tab.</p>';
  h += viewGstRegs(b, regs);
  regs.filter(g => g.slice(0, 2) === S.gsetReg).forEach(g => {
    const reg = g.slice(0, 2), st = GSTSet.peek(reg), hist = GSTSet.history(reg), open = (b.gstOpen || {})[reg] || {}, basis = ((b.itcBasis || {})[reg]) || "2b";
    const cur = GSTSet.typeOf(months[months.length - 1] || first, reg);
    const next = GSTSet.qStart(GSTR.nextYm(GSTSet.qEnd(GSTF.today().slice(0, 7).replace("-", "")))), win = GSTSet.window(next);
    h += '<section class="dash-card" style="margin-bottom:12px"><h3>Settings of ' + esc(g) + " \u00b7 " + esc(GSTRegs.state(g)) + "</h3>" +
      (regs.length > 1 ? '<p class="note" style="margin:0 0 6px">Each GSTIN keeps its own settings. When one is changed here, TDS Desk asks whether it is for this GSTIN only or for the others too.</p>' : "") +
      '<h4 style="margin:8px 0 4px">Filing type</h4>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><select data-gset="type" data-greg="' + reg + '" style="width:auto">' + GSTSet.TYPES.map(([v, l]) => '<option value="' + v + '"' + (cur === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
      '<span class="note">from</span><select data-gset="from" data-greg="' + reg + '" style="width:auto">' + quarters.map(q => '<option value="' + q + '"' + ((S.gsetFrom || {})[reg] === q ? " selected" : "") + ">" + GSTSet.qLabel(q) + "</option>").join("") + "</select>" +
      '<button class="btn small" data-gsetadd="' + reg + '">Set</button></div>' +
      (hist.length ? '<p class="note">' + hist.map(x => GSTSet.typeLabel(x.type) + " from " + GSTSet.qLabel(x.from) + ' <button class="linkbtn" data-gsetdel="' + reg + "|" + x.from + '">remove</button>').join("; ") + ". Before the first of these: monthly.</p>" : '<p class="note">Monthly for every month in the books.</p>') +
      '<p class="note">Changing between QRMP and monthly on the portal: ' + "<b>through the GST API: not built yet</b> (the portal\u2019s own preference call); until then change it on the portal and set it here." +
      " For " + GSTSet.qLabel(next) + " the portal accepts the change from " + GSTAmend.dmy(win.from.replace(/-/g, "")) + " to " + GSTAmend.dmy(win.to.replace(/-/g, "")) + ". QRMP needs turnover of \u20b95 crore or less in the year before. Composition is chosen on the portal (CMP-02, CMP-04) and cannot be changed through the API.</p>" +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px"><label class="note">If QRMP, PMT-06 by <select data-gset="pmt" data-greg="' + reg + '" style="width:auto"><option value="fixed"' + ((st.pmt || "fixed") === "fixed" ? " selected" : "") + '>fixed sum (35% method)</option><option value="self"' + (st.pmt === "self" ? " selected" : "") + ">self-assessment</option></select></label>" +
      '<label class="note">If composition, rate <select data-gset="comp" data-greg="' + reg + '" style="width:auto">' + Object.entries(GSTQ.RATES).map(([k, x]) => '<option value="' + k + '"' + ((st.comp || "trader") === k ? " selected" : "") + ">" + esc(x.l) + "</option>").join("") + "</select></label></div>" +
      '<h4 style="margin:12px 0 4px">GST portal username</h4><input type="text" data-gset="puser" data-greg="' + reg + '" data-fk="gset-puser-' + reg + '" data-keeptyped value="' + esc(st.portalUser || "") + '" placeholder="as used to sign in on gst.gov.in" style="width:260px" autocomplete="off"> <span class="note">for the GST API (OTP sign-in). The password is never asked for or kept.</span>' +
      '<h4 style="margin:12px 0 4px">Credit in 3B table 4</h4><select data-gset="basis" data-greg="' + reg + '" style="width:auto"><option value="2b"' + (basis === "2b" ? " selected" : "") + '>As far as 2B shows it (section 16(2)(aa)) \u2014 the law</option><option value="books"' + (basis === "books" ? " selected" : "") + ">As booked in Tally \u2014 for comparison only</option></select>" +
      '<h4 style="margin:12px 0 4px">Electronic credit ledger at the start' + (first ? " (" + esc(GSTR.label(first)) + ")" : "") + "</h4>" +
      '<div style="display:flex;gap:12px;flex-wrap:wrap">' + [["igst", "IGST"], ["cgst", "CGST"], ["sgst", "SGST"], ["cess", "Cess"]].map(([k, l]) => '<label class="note">' + l + ' <input type="number" step="0.01" data-gset="open" data-ghead="' + k + '" data-greg="' + reg + '" data-fk="gset-open-' + reg + k + '" data-keeptyped value="' + (open[k] === undefined || open[k] === "" ? "" : esc(String(open[k]))) + '" style="width:130px"></label>').join("") + "</div>" +
      '<p class="note">The balance on the portal\u2019s credit ledger before the first month here; later months carry it forward.</p>' +
      '<h4 style="margin:12px 0 4px">Rule 37</h4><label class="note"><input type="checkbox" data-gset="r37" data-greg="' + reg + '"' + (((b.rule37On || {})[reg]) ? " checked" : "") + "> Reverse credit on bills unpaid 180 days after their date, and reclaim it when paid (off unless switched on)</label>" +
      '<h4 style="margin:12px 0 4px">E-invoicing</h4><select data-gset="einv" data-greg="' + reg + '" style="width:auto">' + [["auto", "Found from Tally: checked when the books carry IRNs"], ["outside", "Applies, e-invoices made outside Tally"], ["no", "Does not apply"]].map(([v, l]) => '<option value="' + v + '"' + (GSTSet.einvMode(reg) === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
      '<h4 style="margin:12px 0 4px">Tally ledger for GST paid in cash</h4><input type="text" data-gset="cash" data-greg="' + reg + '" data-fk="gset-cash-' + reg + '" data-keeptyped value="' + esc(((b.gstCashLedger || {})[reg]) || (reg + " GST ELECTRONIC CASH LEDGER")) + '" style="width:320px"> <span class="note">used in the set-off journal</span>' +
      "</section>";
  });
  // the client as a whole
  const fys = Array.from(new Set(months.map(m => GSTF.fyOf(m))));
  const prevFys = Array.from(new Set(fys.map(f => (+f.slice(0, 4) - 1) + "-" + f.slice(2, 4)).concat(fys))).sort();
  const api = GSTQ.apiMode();
  h += '<section class="dash-card" style="margin-bottom:12px"><h3>For the client (all GSTINs)</h3>' +
    '<h4 style="margin:8px 0 4px">Returns sent through the GST API</h4>' +
    '<label class="note" style="display:block"><input type="radio" name="gstapi" data-gset="api" value="save"' + (api === "save" ? " checked" : "") + "> <b>Save only</b> \u2014 the return is saved on the portal; you check it there and file it yourself (recommended)</label>" +
    '<label class="note" style="display:block"><input type="radio" name="gstapi" data-gset="api" value="file"' + (api === "file" ? " checked" : "") + "> <b>Save and file</b> \u2014 after the figures agree with the portal and the return is approved, it is filed with the signatory\u2019s EVC OTP or DSC</label>" +
    '<p class="note">Applies once the GST API is connected; until then returns are downloaded as JSON.</p>' +
    '<h4 style="margin:12px 0 4px">Interest and late fee</h4><label class="note"><input type="checkbox" data-gset="est"' + (b.gstEst ? " checked" : "") + "> Also show TDS Desk\u2019s own estimate beside the portal\u2019s figures (off: only the portal\u2019s figures are shown)</label>" +
    '<h4 style="margin:8px 0 4px">Aggregate turnover of the year</h4><div style="display:flex;gap:12px;flex-wrap:wrap">' +
    prevFys.map(f => { const a = GSTF.aato(GSTF.fyOf((+f.slice(0, 4) + 1) + "04")); return '<label class="note">' + esc(f) + ' <input type="number" data-gset="aato" data-gfy="' + esc((+f.slice(0, 4) + 1) + "-" + String(+f.slice(0, 4) + 2).slice(2)) + '" value="' + (((b.gstAato || {})[(+f.slice(0, 4) + 1) + "-" + String(+f.slice(0, 4) + 2).slice(2)]) || "") + '" placeholder="' + (a.v ? money(a.v) + " from the books" : "type it") + '" style="width:170px"></label>'; }).join("") +
    '</div><p class="note">Used for the late fee caps, QRMP (\u20b95 crore or less), e-invoicing and the 30-day IRN limit (\u20b910 crore and above).</p>' +
    '<h4 style="margin:12px 0 4px">Rule 42</h4><label class="note"><input type="checkbox" data-gset="d2"' + (GSTRev.settings().d2 ? " checked" : "") + "> Some of the common credit is used for non-business purposes, so D2 (5%) applies</label>" +
    '<p class="note">Ledgers carrying common credit are marked \u201cGST, common credit\u201d on the Tally ledgers tab.</p>' +
    '<h4 style="margin:12px 0 4px">Blocked credit, section 17(5)</h4><p class="note">Reported in 3B table 4(B)(1), with rules 38, 42 and 43.</p></section>';
  // contacts
  const q = String(S.gcontQ || "").toLowerCase(), all = GSTSet.parties(), shown = all.filter(p => !q || (p.party + " " + p.gstin).toLowerCase().includes(q)), c = b.gstContacts || {};
  h += '<section class="dash-card"><h3>Contacts for GST letters</h3><p class="note">Email and phone for the letters to suppliers (ITC follow-up) and customers (IMS rejections). Taken from Tally where it has them; type or correct them here.</p>' +
    '<input type="search" data-gcontq data-fk="gcontq" data-keeptyped value="' + esc(S.gcontQ || "") + '" placeholder="Party or GSTIN" style="width:260px"> <span class="note">' + shown.length + " of " + all.length + " parties with a GSTIN</span>" +
    '<div class="bk-tablewrap"><table class="bk-table compact"><thead><tr><th>Party</th><th>GSTIN</th><th>In the books as</th><th>Email</th><th>Phone</th></tr></thead><tbody>' +
    shown.slice(0, q ? 200 : 40).map(p => { const k = GSTSet.contact(p.gstin, p.party); return "<tr><td>" + esc(p.party) + "</td><td>" + esc(p.gstin) + "</td><td>" + esc(p.sides) + '</td><td><input type="email" data-gcont="' + esc(p.gstin) + '" data-cf="email" value="' + esc((c[p.gstin] || {}).email || k.email) + '" style="width:100%"></td><td><input type="tel" data-gcont="' + esc(p.gstin) + '" data-cf="phone" value="' + esc((c[p.gstin] || {}).phone || k.phone) + '" style="width:100%"></td></tr>'; }).join("") +
    "</tbody></table></div>" + (!q && shown.length > 40 ? '<p class="note">The 40 parties with the most documents are shown; search for others.</p>' : "") + "</section></div></div>";
  return h;
}
if (typeof document !== "undefined"){
  document.addEventListener("change", e => {
    const t = e.target; if (!t.dataset || !S.books) return;
    const b = S.books, d = t.dataset, reg = d.greg || "";
    if (d.gset !== undefined){
      if (d.gset === "from"){ S.gsetFrom = Object.assign({}, S.gsetFrom, {[reg]: t.value}); return; }
      if (d.gset === "type"){ S.gsetType = Object.assign({}, S.gsetType, {[reg]: t.value}); return; }
      // shared with the client's other GSTINs if the user says so
      const share = {basis: ["Credit in 3B table 4", x => { b.itcBasis = Object.assign({}, b.itcBasis, {[x]: t.value}); }],
        r37: ["Rule 37 " + (t.checked ? "on" : "off"), x => { b.rule37On = Object.assign({}, b.rule37On, {[x]: t.checked}); }],
        einv: ["E-invoicing", x => { GSTSet.store(x).einv = t.value; }],
        pmt: ["PMT-06 method", x => { GSTSet.store(x).pmt = t.value; }],
        comp: ["Composition rate", x => { GSTSet.store(x).comp = t.value; }]}[d.gset];
      if (share){ gsetApply(reg, share[0], share[1]).then(done => { if (done){ GSTR._carry = null; saveBooks(); render(); } }); return; }
      if (d.gset === "open"){ b.gstOpen = Object.assign({}, b.gstOpen); b.gstOpen[reg] = Object.assign({}, b.gstOpen[reg], {[d.ghead]: t.value === "" ? "" : num(t.value)}); }
      if (d.gset === "puser") GSTSet.store(reg).portalUser = t.value.trim();
      if (d.gset === "api"){ if (!t.checked) return; b.gstApi = t.value; }
      if (d.gset === "est") b.gstEst = !!t.checked;
      if (d.gset === "cash") b.gstCashLedger = Object.assign({}, b.gstCashLedger, {[reg]: t.value});
      if (d.gset === "aato") b.gstAato = Object.assign({}, b.gstAato, {[d.gfy]: num(t.value)});
      if (d.gset === "d2") b.rev = Object.assign({}, b.rev, {d2: !!t.checked});
      GSTR._carry = null; saveBooks(); render(); return;
    }
    if (d.gsetreg !== undefined){ S.gsetReg = t.value; render(); return; }
    if (d.gcont !== undefined){ b.gstContacts = Object.assign({}, b.gstContacts); b.gstContacts[d.gcont] = Object.assign({}, b.gstContacts[d.gcont], {[d.cf]: t.value.trim()}); saveBooks(); }
  });
  document.addEventListener("input", e => { const t = e.target; if (t.matches && t.matches("[data-gcontq]")){ S.gcontQ = t.value; render(); } });
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-gsetadd],[data-gsetdel],[data-gotogstset],[data-gregadd],[data-gregdel],[data-gsetpick]"); if (!t) return;
    if (t.dataset.gotogstset !== undefined){ if (S.gstReg) S.gsetReg = S.gstReg; S.tab = "gstset"; render(); return; }
    if (!S.books) return;
    if (t.dataset.gsetpick){ S.gsetReg = t.dataset.gsetpick; render(); return; }
    if (t.dataset.gregadd !== undefined){ const i = document.querySelector("[data-gregnew]"), g = String(i ? i.value : "").toUpperCase().trim(), why = GSTRegs.refuse(g, S.books);
      if (why){ toast(why); return; }
      GSTRegs.add(g); S.gsetReg = g.slice(0, 2); S.gstReg = g.slice(0, 2); if (i) i.value = ""; saveBooks(); render(); toast(g + " added (" + GSTRegs.state(g) + ")."); return; }
    if (t.dataset.gregdel){ const g = t.dataset.gregdel;
      askConfirm({title: "Remove " + g + "?", ok: "Remove", body: '<p class="note">It goes from this client\u2019s GSTINs. Its settings, 2B and returns filed stay with the books and come back if it is added again.</p>'})
        .then(r => { if (!r) return; GSTRegs.remove(g); saveBooks(); render(); }); return; }
    if (t.dataset.gsetadd){ const reg = t.dataset.gsetadd, months = GSTR.months(), from = (S.gsetFrom || {})[reg] || GSTSet.qStart(months[0] || GSTF.today().slice(0, 7).replace("-", "")),
        sel = document.querySelector('select[data-gset="type"][data-greg="' + reg + '"]'), type = (S.gsetType || {})[reg] || (sel ? sel.value : "monthly");
      gsetApply(reg, GSTSet.typeLabel(type) + " from " + GSTSet.qLabel(from), x => { const st = GSTSet.store(x); st.filing = (st.filing || []).filter(y => y.from !== from).concat([{type, from}]); })
        .then(done => { if (!done) return; GSTR._carry = null; saveBooks(); render(); toast(GSTSet.typeLabel(type) + " from " + GSTSet.qLabel(from) + "."); }); return; }
    if (t.dataset.gsetdel){ const [reg, from] = t.dataset.gsetdel.split("|"), st = GSTSet.store(reg); st.filing = (st.filing || []).filter(x => x.from !== from); saveBooks(); render(); }
  });
}

// everything read from Tally and all GST work: what "Remove Tally data and all GST work" clears
const BOOKS_WIPE = ["vouchers", "meta", "map", "reco", "pans", "gstins", "under", "states", "groups", "groupInfo", "ledInfo", "ledInfoAt", "tb", "ledSnaps", "audit", "auditRel", "mis",
  "twoB", "twoBs", "reco2b", "filed", "filed1a", "amendFix", "advFix", "rev", "assets", "gst3b", "gst9", "gst9c", "gstOpen", "itcBasis", "itcTrack", "outRej", "gstFiled", "gstAato",
  "rule37On", "gstCashLedger", "gstSet", "gstContacts", "gstApi", "gstEst", "gstVault"];
function booksHasAny(b){ return !!b && BOOKS_WIPE.some(k => { const v = b[k]; return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : !!v; }); }
function booksWipe(b){ BOOKS_WIPE.forEach(k => { delete b[k]; }); b.vouchers = []; b.map = {}; b.meta = null; return b; }
