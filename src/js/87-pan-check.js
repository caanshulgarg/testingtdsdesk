/* @react-lazy: begin 87-pan-check.js (the React app loads this file with its TDS screens: app/src/lib/tdsGlobals.js; build.py react_parts) */
/* ================================================================== */
/* Deductees and their PANs (the Deductees (PAN) tab of every TDS     */
/* return, next-challan-match, the owner's direction of 18-Oct-2026)  */
/* ================================================================== */
// One row per deductee of a return: name, PAN, PAN status, sections, count and total of deductions, TDS; those with no PAN
// or an invalid or inoperative one first. A person corrects a PAN (and the name written in the file) once, for the
// deductee: S.books.panFix[party] = {pan, name, by, at, was}, FinCom's own correction (Tally is not changed, and a fresh
// read from Tally does not undo it). TDS.panOf (src/js/09), Tally's payroll rows (src/js/73) and the salary sheet's rows
// (src/js/17) read it first, so every deduction of that deductee, the 206AA / inoperative remark (C) and the rate checks
// follow at once.
//
// PANCheck: the hook for the PAN verification on TRACES that another piece of work is building (free, by the deductor's
// TRACES login). Until it is connected the screen says "Not checked yet · Check on TRACES". Its results are kept per firm
// (S.firm.panCheck[PAN] = {state, name, at, source}); a PAN the books mark inoperative (Certs.inoperative) is
// "inoperative" from the books.
//   PANCheck.status(pan)  -> {state: "unknown" | "valid" | "inoperative" | "invalid", name, at, source}
//   PANCheck.request(pans) -> Promise<{ok, why, n}>: asks the verification for these PANs (PANCheck.provider, set by the
//                             TRACES helper when it is connected; until then refused in words)
//   PANCheck.set(pan, rec)  : where the helper keeps a result (saved with the firm)
const PANCheck = {
  provider: null,                               // async (pans) => [{pan, state, name}]: the TRACES helper sets it
  store(){ return ((S.firm || {}).panCheck) || {}; },
  status(pan){
    const P = String(pan || "").toUpperCase().trim();
    if (!P) return {state: "invalid", name: "", at: "", source: "none", words: "No PAN"};
    if (!Certs.validPan(P)) return {state: "invalid", name: "", at: "", source: "format", words: "Invalid (not 5 letters, 4 digits, a letter)"};
    const x = this.store()[P];
    if (x && x.state) return Object.assign({name: "", at: "", source: "traces"}, x, {words: this.words(x)});
    if (Certs.inoperative(P)) return {state: "inoperative", name: "", at: "", source: "books", words: "Inoperative (marked in the books)"};
    return {state: "unknown", name: "", at: "", source: "", words: "Not checked yet"};
  },
  words(x){ return ({valid: "Operative", inoperative: "Inoperative", invalid: "Invalid", unknown: "Not checked yet"}[x.state] || "Not checked yet") + (x.name ? " · " + x.name + " as per ITD" : ""); },
  set(pan, rec){
    const P = String(pan || "").toUpperCase().trim();
    if (!Certs.validPan(P) || !rec || !["valid", "inoperative", "invalid", "unknown"].includes(rec.state)) return false;
    S.firm = S.firm || {};
    S.firm.panCheck = Object.assign({}, S.firm.panCheck || {}, {[P]: {state: rec.state, name: String(rec.name || "").slice(0, 120), at: rec.at || new Date().toISOString(), source: rec.source || "traces"}});
    try { Store.saveFirm(); } catch (e){}
    return true;
  },
  async request(pans){
    const list = Array.from(new Set((pans || []).map(p => String(p || "").toUpperCase().trim()).filter(p => Certs.validPan(p))));
    if (!list.length) return {ok: false, n: 0, why: "No valid PAN to check."};
    S.firm = S.firm || {};
    S.firm.panCheckAsked = Object.assign({}, S.firm.panCheckAsked || {}, Object.fromEntries(list.map(p => [p, new Date().toISOString()])));
    if (typeof this.provider !== "function") return {ok: false, n: 0, why: "Checking PANs on TRACES is not connected yet: the PAN's format and type are checked here; its status comes once it is."};
    try {
      const got = await this.provider(list);
      (got || []).forEach(x => this.set(x.pan, x));
      return {ok: true, n: (got || []).length};
    } catch (e){ return {ok: false, n: 0, why: "TRACES could not be asked just now (" + String((e && e.message) || e).slice(0, 120) + ")."}; }
  },
  // the PAN's own checks, offline: its form; its 4th letter against what the name says the deductee is; the same PAN on
  // another deductee, or another PAN on the same name. [{k, words, bad}]
  TYPE: {C: "a company", P: "an individual", H: "an HUF", F: "a firm or LLP", A: "an AOP", T: "a trust", B: "a BOI", L: "a local authority", J: "an artificial juridical person", G: "a government"},
  offline(pan, party, all){
    const P = String(pan || "").toUpperCase().trim(), out = [], nm = String(party || "").toUpperCase();
    if (!P){ out.push({k: "none", bad: true, words: "No PAN: tax at 20% (206AA) and remark C in the file. Type the PAN to correct it."}); return out; }
    if (!Certs.validPan(P)){ out.push({k: "form", bad: true, words: "“" + P + "” is not a PAN: five letters, four digits, a letter."}); return out; }
    const want = /\b(LTD|LIMITED|PVT|PRIVATE|CORPORATION|INC)\b/.test(nm) ? "C" : /\bLLP\b|\bFIRM\b|&\s*(CO|SONS|ASSOCIATES)\b|\bASSOCIATES\b|\bPARTNERS\b/.test(nm) ? "F" : /\bHUF\b/.test(nm) ? "H" : /\bTRUST\b/.test(nm) ? "T" : "";
    if (want && P[3] !== want) out.push({k: "type", bad: false, words: "The PAN's 4th letter " + P[3] + " says " + (this.TYPE[P[3]] || "another kind of holder") + "; the name looks like " + this.TYPE[want] + " (" + want + "). Check the PAN."});
    const same = (all || []).filter(x => x.pan === P && normName(x.party) !== normName(party)).map(x => x.party);
    if (same.length) out.push({k: "dup", bad: false, words: "The same PAN is on " + same.slice(0, 3).join(", ") + (same.length > 3 ? " and " + (same.length - 3) + " more" : "") + ": one deductee under two names, or a PAN typed on the wrong one."});
    const other = (all || []).filter(x => x.pan && x.pan !== P && normName(x.party) === normName(party)).map(x => x.pan);
    if (other.length) out.push({k: "dup2", bad: false, words: "The same name has another PAN too (" + other.slice(0, 2).join(", ") + ")."});
    return out;
  }
};

// a deductee's PAN and file name, as corrected in FinCom (S.books.panFix): null when not corrected
const TDSPanFix = {
  of(party){ const f = ((S.books || {}).panFix || {})[party]; return f || null; },
  pan(party){ const f = this.of(party); return f && f.pan ? f.pan : ""; },
  name(party){ const f = this.of(party); return f && f.name ? f.name : ""; },
  // the deductees of a return: [{key, party, name, pan, status, problems, secs, n, paid, tds, rows, bad}]
  list(form, fy, q){
    const rows = TDS.formRows(form || "26Q").filter(r => r.fy === fy && r.q === q), by = {};
    rows.forEach(r => {
      const k = normName(r.party || r.employee || ""), p = by[k] = by[k] || {key: k, party: r.party || r.employee || "", pan: String(r.pan || "").toUpperCase(), secs: new Set(), n: 0, paid: 0, tds: 0, rows: []};
      p.secs.add(TDS.sec(r.section) || r.section || ""); p.n++; p.paid = r2(p.paid + num(r.paid)); p.tds = r2(p.tds + num(r.tds)); p.rows.push(r);
      if (!p.pan && r.pan) p.pan = String(r.pan).toUpperCase();
    });
    const all = Object.values(by);
    return all.map(p => {
      const st = PANCheck.status(p.pan), probs = PANCheck.offline(p.pan, p.party, all);
      return Object.assign(p, {secs: Array.from(p.secs).filter(Boolean).sort(), status: st, problems: probs, name: this.name(p.party) || p.party, fixed: !!this.of(p.party),
        bad: !p.pan || st.state === "invalid" || st.state === "inoperative"});
    }).sort((a, b) => (b.bad - a.bad) || b.tds - a.tds || a.party.localeCompare(b.party));
  },
  // correct a deductee's PAN (and the name written in the file): refused when not a PAN, or when a filed return holds one
  // of its deductions (open a correction first). {ok, why, n (deductions it changes)}
  set(party, x, form, fy, q){
    const b = S.books; if (!b || !party) return {ok: false, why: "No such deductee."};
    const pan = String((x && x.pan) || "").toUpperCase().replace(/\s/g, ""), name = String((x && x.name) || "").trim();
    if (pan && !Certs.validPan(pan)) return {ok: false, why: "“" + pan + "” is not a PAN: five letters, four digits, a letter."};
    const mine = TDSReg.FORMS.map(f => TDS.formRows(f).filter(r => normName(r.party || r.employee || "") === normName(party)).map(r => ({r, f}))).reduce((a, l) => a.concat(l), []);
    const lock = mine.find(({r, f}) => TDSReg.locked(r.fy, r.q, f));
    if (lock) return {ok: false, why: TDSReg.lockWords(lock.r.fy, lock.r.q, lock.f)};
    const was = this.of(party) || {}, wasPan = was.pan || (mine[0] ? String(mine[0].r.pan || "") : "");
    b.panFix = Object.assign({}, b.panFix || {});
    if (!pan && !name) delete b.panFix[party];
    else b.panFix[party] = {pan, name: name && name !== party ? name.slice(0, 75) : "", by: TDSReg.who(), at: new Date().toISOString(), was: wasPan};
    TDSReg.log({act: "pan", form: form || "", fy: fy || "", q: q || "", note: party + ": PAN " + (wasPan || "none") + " → " + (pan || "none") + (name && name !== party ? "; name in the file " + name : "")});
    if (b.panIndex) b.panIndex = null;
    TDSReg.forget(); TDSReg.done(); saveBooks();
    return {ok: true, n: mine.length};
  }
};

/* ---------- the actions of the Deductees (PAN) tab (app/src/screens/tds/Deductees.jsx) ---------- */
function tdsDeducteeOpen(key){ S.tdsDee = key; render(); }
function tdsDeducteeSet(party, x){
  const t = {form: S.tdsForm || "26Q", fy: S.tdsFy, q: S.tdsQ}, r = TDSPanFix.set(party, x, t.form, t.fy, t.q);
  if (!r.ok){ toast(r.why); return r; }
  toast("Saved for " + party + ": " + r.n + " deduction" + (r.n === 1 ? "" : "s") + " now carry " + (x.pan ? "PAN " + String(x.pan).toUpperCase() : "no PAN") + "; the rate and the remark are checked again.");
  render(); return r;
}
async function tdsPanCheck(pans){ const r = await PANCheck.request(pans); toast(r.ok ? r.n + " PAN" + (r.n === 1 ? "" : "s") + " checked on TRACES." : r.why); render(); return r; }
if (typeof globalThis === "object") Object.assign(globalThis, {PANCheck, TDSPanFix, tdsDeducteeOpen, tdsDeducteeSet, tdsPanCheck});
/* @react-lazy: end */
