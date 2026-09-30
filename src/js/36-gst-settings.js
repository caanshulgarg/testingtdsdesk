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
    if (GSTR.gstins(b).some(x => x.slice(0, 2) === g.slice(0, 2))) return "This client already has a GSTIN in " + this.state(g) + "; FinCom keeps one GSTIN for each state.";
    return ""; },
  add(g){ const b = S.books; g = String(g || "").toUpperCase().trim(); b.gstRegs = (b.gstRegs || []).concat([{gstin: g, at: new Date().toISOString()}]); GSTR._carry = null; },
  remove(g){ const b = S.books; b.gstRegs = (b.gstRegs || []).filter(r => r.gstin !== g); GSTR._carry = null; }
};
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
function goGstSettings(){ if (S.gstReg) S.gsetReg = S.gstReg; S.tab = "gstset"; render(); }
// the GST settings page: React (app/src/screens/gst/GstSettings.jsx). What it changes:
// a filing type from a quarter: chosen here, set with "Set" (asked for which GSTINs when there are more)
function gsetPick(reg, key, v){ const k = key === "from" ? "gsetFrom" : "gsetType"; S[k] = Object.assign({}, S[k], {[reg]: v}); }
function gsetFilingAdd(reg, shownType){
  const months = GSTR.months(), from = (S.gsetFrom || {})[reg] || GSTSet.qStart(months[0] || GSTF.today().slice(0, 7).replace("-", "")), type = (S.gsetType || {})[reg] || shownType || "monthly";
  gsetApply(reg, GSTSet.typeLabel(type) + " from " + GSTSet.qLabel(from), x => { const st = GSTSet.store(x); st.filing = (st.filing || []).filter(y => y.from !== from).concat([{type, from}]); })
    .then(done => { if (!done) return; GSTR._carry = null; saveBooks(); render(); toast(GSTSet.typeLabel(type) + " from " + GSTSet.qLabel(from) + "."); });
}
function gsetFilingDel(reg, from){ const st = GSTSet.store(reg); st.filing = (st.filing || []).filter(x => x.from !== from); saveBooks(); render(); }
// a setting that can be shared with the client's other GSTINs, if the user says so
function gsetShared(reg, key, val){
  const b = S.books, share = {basis: ["Credit in 3B table 4", x => { b.itcBasis = Object.assign({}, b.itcBasis, {[x]: val}); }],
    r37: ["Rule 37 " + (val ? "on" : "off"), x => { b.rule37On = Object.assign({}, b.rule37On, {[x]: !!val}); }],
    einv: ["E-invoicing", x => { GSTSet.store(x).einv = val; }],
    pmt: ["PMT-06 method", x => { GSTSet.store(x).pmt = val; }],
    comp: ["Composition rate", x => { GSTSet.store(x).comp = val; }]}[key];
  // cancelled: the control shows the saved value again (a new S.gsetNonce draws it afresh)
  gsetApply(reg, share[0], share[1]).then(done => { if (done){ GSTR._carry = null; saveBooks(); } else S.gsetNonce = (S.gsetNonce || 0) + 1; render(); });
}
// a setting of one GSTIN or of the client: open (with head), puser, api, est, cash, aato (with the year), d2
function gsetSet(key, val, reg, sub){
  const b = S.books;
  if (key === "open"){ b.gstOpen = Object.assign({}, b.gstOpen); b.gstOpen[reg] = Object.assign({}, b.gstOpen[reg], {[sub]: val === "" ? "" : num(val)}); }
  if (key === "puser") GSTSet.store(reg).portalUser = String(val).trim();
  if (key === "api") b.gstApi = val;
  if (key === "est") b.gstEst = !!val;
  if (key === "cash") b.gstCashLedger = Object.assign({}, b.gstCashLedger, {[reg]: val});
  if (key === "aato") b.gstAato = Object.assign({}, b.gstAato, {[sub]: num(val)});
  if (key === "d2") b.rev = Object.assign({}, b.rev, {d2: !!val});
  GSTR._carry = null; saveBooks(); render();
}
// "type it" beside a GSTIN: its settings shown, the cursor in the username box
function gsetUserFocus(reg){ S.gsetReg = reg; render(); const i = document.querySelector('input[data-fk="gset-puser-' + reg + '"]'); if (i){ i.scrollIntoView({block: "center", behavior: "smooth"}); i.focus(); } }
// a GSTIN added (it must carry the client's PAN) or removed
function gregAdd(g){
  g = String(g || "").toUpperCase().trim(); const why = GSTRegs.refuse(g, S.books);
  if (why){ toast(why); return false; }
  GSTRegs.add(g); S.gsetReg = g.slice(0, 2); S.gstReg = g.slice(0, 2); saveBooks(); render(); toast(g + " added (" + GSTRegs.state(g) + ")."); return true;
}
function gregRemove(g){
  askConfirm({title: "Remove " + g + "?", ok: "Remove", body: '<p class="note">It goes from this client\u2019s GSTINs. Its settings, 2B and returns filed stay with the books and come back if it is added again.</p>'})
    .then(r => { if (!r) return; GSTRegs.remove(g); saveBooks(); render(); });
}
// a party's email or phone for GST letters
function gcontSet(gstin, key, val){ const b = S.books; b.gstContacts = Object.assign({}, b.gstContacts); b.gstContacts[gstin] = Object.assign({}, b.gstContacts[gstin], {[key]: String(val).trim()}); saveBooks(); }

// everything read from Tally and all GST work: what "Remove Tally data and all GST work" clears
const BOOKS_WIPE = ["vouchers", "meta", "map", "reco", "pans", "gstins", "under", "states", "groups", "groupInfo", "ledInfo", "ledInfoAt", "tb", "ledSnaps", "audit", "auditRel", "mis",
  "twoB", "twoBs", "reco2b", "filed", "filed1a", "amendFix", "advFix", "rev", "assets", "gst3b", "gst9", "gst9c", "gstOpen", "itcBasis", "itcTrack", "outRej", "gstFiled", "gstAato",
  "rule37On", "gstCashLedger", "gstSet", "gstContacts", "gstApi", "gstEst", "gstVault"];
function booksHasAny(b){ return !!b && BOOKS_WIPE.some(k => { const v = b[k]; return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : !!v; }); }
function booksWipe(b){ BOOKS_WIPE.forEach(k => { delete b[k]; }); b.vouchers = []; b.map = {}; b.meta = null; return b; }
