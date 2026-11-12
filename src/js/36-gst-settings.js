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
// GSTSet: the whole object is in server/_shared/gst3b.js (the GSTR-3B engine, shared with the gst-run function)
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
// next-gst-isd (the owner, 12-Nov-2026): a ledger's switch "ISD (Input Service Distributor)" (b.map[name].isd, GSTR.isISD):
// the credit of every entry on it goes in 3B 4(A)(4). FinCom's own, saved with the books (synced), never written to Tally;
// kept over a refresh of the ledger list (Books.mapLedgers). A name not in the ledger list is refused
// (a switch that moves credit between 4(A)(4) and 4(A)(5) of a filed 3B: asked first, with a reason, GSTLock.isdMoves in
// src/js/47-gst-lock-checks.js; false while it is checked or asked, the switch made once that is done)
function gsetIsd(name, on, sure){
  const b = S.books; name = String(name || "").trim(); if (!b || !name) return false;
  if (on && !(b.map || {})[name]){ toast(name + " is not a ledger of these books: pick it from the list."); return false; }
  // (the check after the click is drawn, with a line saying so; refused, never made unchecked, when it cannot be worked out yet)
  if (!sure && typeof GSTLock === "object" && (GSTR.gstins(b) || []).some(g => GSTLock.any(g.slice(0, 2)))){
    toast("Checking filed 3Bs…");
    setTimeout(() => GSTLock.ready().then(y => {
      if (!y){ toast(GSTLock.NOT); return; }
      const x = GSTLock.isdMoves(name);
      if (!x) return gsetIsd(name, on, true);
      GSTLock.ask(x.reg, x.months, ["r3b"], "ISD switch for " + name, x.w).then(ok => { if (ok) gsetIsd(name, on, true); else render(); });
    }), 30);
    return false;
  }
  b.map = Object.assign({}, b.map || {});
  const m = b.map[name] = Object.assign({n: 0}, b.map[name] || {});
  if (on) m.isd = {by: typeof whoAmI === "function" ? whoAmI() : "", at: new Date().toISOString()}; else delete m.isd;
  b.mapV = (b.mapV || 0) + 1; GSTR._carry = null; saveBooks(); render(); return true;
}
// GSTR-1 table 14 (17-Oct-2026): the GSTIN of an e-commerce operator for a registration (its TCS registration in that
// state), typed beside 14(a) when a marketplace's report does not carry it; "" removes it
function ecoGstinSet(reg, eco, g){
  g = String(g || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (g && !gstinValid(g)){ toast(g + " is not a valid GSTIN: check it on the operator's TCS certificate or GSTR-2A/2B (TCS credit)."); return false; }
  if (g && reg && g.slice(0, 2) !== reg){ toast(g + " is registered in " + GSTRegs.state(g) + ": 14(a) takes the operator's GSTIN in " + GSTRegs.state(reg) + "."); return false; }
  const st = GSTSet.store(reg); st.ecoGstin = Object.assign({}, st.ecoGstin, {[eco]: g});
  if (!g) delete st.ecoGstin[eco];
  GSTR._carry = null; saveBooks(); render(); return true;
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
  // no question first (spec K9, round 2): nothing is lost, adding it again brings everything back
  GSTRegs.remove(g); saveBooks(); toast(g + " removed. Its settings, 2B and returns filed stay with the books and come back if it is added again."); render();
}
// a party's email or phone for GST letters
function gcontSet(gstin, key, val){ const b = S.books; b.gstContacts = Object.assign({}, b.gstContacts); b.gstContacts[gstin] = Object.assign({}, b.gstContacts[gstin], {[key]: String(val).trim()}); saveBooks(); }

// everything read from Tally and all GST work: what "Remove Tally data and all GST work" clears
const BOOKS_WIPE = ["vouchers", "meta", "map", "reco", "pans", "gstins", "under", "states", "groups", "groupInfo", "ledInfo", "ledInfoAt", "tb", "ledSnaps", "audit", "auditRel", "mis",
  "twoB", "twoBs", "reco2b", "filed", "filed1a", "amendFix", "advFix", "rev", "assets", "gst3b", "gst9", "gst9c", "gstOpen", "itcBasis", "itcTrack", "outRej", "gstFiled", "gstAato",
  "rule37On", "gstCashLedger", "gstSet", "gstContacts", "gstApi", "gstEst", "gstVault"];
function booksHasAny(b){ return !!b && BOOKS_WIPE.some(k => { const v = b[k]; return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : !!v; }); }
function booksWipe(b){ BOOKS_WIPE.forEach(k => { delete b[k]; }); b.vouchers = []; b.map = {}; b.meta = null; return b; }
