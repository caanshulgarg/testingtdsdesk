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
  add(g){ const b = S.books; g = String(g || "").toUpperCase().trim(); b.gstRegs = (b.gstRegs || []).concat([{gstin: g, at: new Date().toISOString()}]); GSTR._carry = null; },
};
function goGstSettings(){ if (S.gstReg) S.gsetReg = S.gstReg; S.tab = "gstset"; render(); }
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
// everything read from Tally and all GST work: what "Remove Tally data and all GST work" clears
const BOOKS_WIPE = ["vouchers", "meta", "map", "reco", "pans", "gstins", "under", "states", "groups", "groupInfo", "ledInfo", "ledInfoAt", "tb", "ledSnaps", "audit", "auditRel", "mis",
  "twoB", "twoBs", "reco2b", "filed", "filed1a", "amendFix", "advFix", "rev", "assets", "gst3b", "gst9", "gst9c", "gstOpen", "itcBasis", "itcTrack", "outRej", "gstFiled", "gstAato",
  "rule37On", "gstCashLedger", "gstSet", "gstContacts", "gstApi", "gstEst", "gstVault"];
function booksWipe(b){ BOOKS_WIPE.forEach(k => { delete b[k]; }); b.vouchers = []; b.map = {}; b.meta = null; return b; }
