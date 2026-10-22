/* @react-lazy: begin 90-autopost.js (the React app loads this file when a client's automatic posting is on, or a page shows it: app/src/lib/autopost.js; build.py react_parts) */
/* ================================================================== */
/* Post automatically what a person approved before (the owner's      */
/* request of 22-Oct-2026, approved 23-Oct-2026; design: autopost plan) */
/* ================================================================== */
// A new bank line or purchase bill is posted to Tally by itself only when it copies an earlier entry of the same client
// that a PERSON approved (same party and direction, or the same supplier GSTIN; the same ledgers and tax shape), and it
// passes every "never automatic" stop. Everything else waits, as today, under "Waiting for me". No AI: fixed rules.
//
//   Setting   co.choices.autopost = {value: {on, bank, bills, billsNoGstin, bankAmounts, perEntry, perDay, holdMin,
//             whoOn, whoUndo}, state: "confirmed", by, at, prev}; off unless a person switches it on. Only the firm's owner
//             switches it on or loosens it; staff may always switch it off or tighten it (here, and on the server:
//             migration 101's guard on clients). Every change is logged (co.autopostLog, and autopost_log on the server).
//   Learning  only from a person's own approvals: a bank line set by hand ("hand"), a suggestion a person confirmed
//             ("confirm"), a rule a person made ("rule-written"); a bill approved by a person ("hand" / "bulk"). Lines
//             posted on FinCom's guess ("guess-posted"), AI values and automatic entries ("auto") never teach.
//             A person who changes or undoes an automatic entry pauses that party's rule (co.autopostPause) until a
//             later approval by hand.
//   Rules     bank B1 same line again (exact amount, High), B2 recurring amount varies (Medium, only when the owner chose
//             "any amount within the limit"), B3 bank charges (any amount up to ₹5,000, High), B4 GST / TDS challan
//             (High, with a precedent), B5 monthly rent / salary / EMI / ACH (B1 or B2 a month apart), B6 pays a bill a
//             person approved (High); bills P1 same supplier GSTIN and bill shape (High), P2 the same by PAN (Medium,
//             only when "Also suppliers without a GSTIN" is ticked), P3 the TDS worked out afresh, never copied.
//   Posting   the usual route only (postBankToTally / postBillsToTally → Bridge.post → the cloud queue or the bridge
//             here), each entry with FinCom's id and the bridge's duplicate check; each entry is first CLAIMED on the
//             server (autopost_claim, migration 101), so two browsers never post the same entry and the daily total
//             holds across browsers.
// The rules take every outside fact through `env` (AutoPost.env(): the app's own functions), so the tests give their own.
const AutoPost = {
  DEF: {on: false, bank: true, bills: true, billsNoGstin: false, bankAmounts: "exact", perEntry: 50000, perDay: null, holdMin: 0, whoOn: "owner", whoUndo: "owner+staff"},
  // person approvals that teach (bank: hist.h / the row; bills: approvedHow)
  BANK_TEACH: ["hand", "confirm", "rule-written"],
  BILL_TEACH: ["hand", "bulk", "before"],
  MONTH_TOK: /^(?:JAN|FEB|MAR|APR|MAY|JUNE?|JULY?|AUG|SEPT?|OCT|NOV|DEC)+(?:\d{0,4})$/,
  MONTH_WORD: /^(?:jan|feb|mar|apr|may|june?|july?|aug|sept?|oct|nov|dec)+(?:\d{0,4})$/,
  PARK: /suspense|^branch|divisions|capital\s*account/i,
  EXP_GRP: /expenses|purchase accounts/i,
  INC_GRP: /incomes?|sales accounts/i,
  EXP_NAME: /\b(exp(enses?|s)?\.?|charges?|fees?|rent|salar(y|ies)|wages|printing|stationery|repairs?)\b/i,
  INC_NAME: /\b(income|sales|interest received|commission received|discount received)\b/i,
  CHG_RE: /\b(CHRG|CHG|CHGS|CHARGES?|SMS\s*ALERT|INSTAALERTCHG)\b|IMPS\s+P2P\b.*EPR/i,
  GST_RE: /\b(GST\s*(PMT|PAYMENT|CHALLAN)|CPIN|GSTN|CBIC)\b|^GIB\/.*\/GST\b/i,
  TDS_RE: /\b(ITNS\s*281|TDS\s*PAYMENT|281\b.*TDS)\b/i,
  MONTHLY_RE: /\b(RENT|SALARY|SAL\s*FOR|PAYROLL|EMI|LOAN|ACH|NACH|ECS)\b/i,
  // reverse charge services (SAC) a registered person pays tax on; rent only from an unregistered supplier
  RCM_SAC: /^(9982|9965|998525|996601|996791)/, RCM_SAC_UNREG: /^(997211|997212)/,
  CAPITAL_HSN: /^(84|85|87|90|94)/, CAPITAL_AT: 10000,

  /* ---------- the setting ---------- */
  rec(co){ return (co && co.choices && co.choices.autopost) || null; },
  cfg(co){
    const r = this.rec(co), v = Object.assign({}, this.DEF, (r && r.value) || {});
    v.perEntry = num(v.perEntry) > 0 ? num(v.perEntry) : this.DEF.perEntry;
    v.perDay = v.perDay === "" || v.perDay == null || !(num(v.perDay) > 0) ? null : num(v.perDay);
    v.holdMin = Math.max(0, Math.round(num(v.holdMin)));
    return v;
  },
  isOn(co, kind){ const c = this.cfg(co); return !!c.on && (!kind || !!c[kind]); },
  // a change loosens the setting (switched on, a kind added, a limit raised or removed, a shorter hold, the amounts
  // widened, the rights changed): only the owner may make it. The same test runs on the server (migration 101)
  loosens(a, b){
    a = Object.assign({}, this.DEF, a || {}); b = Object.assign({}, this.DEF, b || {});
    const lim = v => (v === "" || v == null || !(num(v) > 0)) ? Infinity : num(v);
    const out = [];
    if (!a.on && b.on) out.push("switch it on");
    if (b.on){
      if (!a.bank && b.bank) out.push("add bank lines");
      if (!a.bills && b.bills) out.push("add purchase bills");
      if (!a.billsNoGstin && b.billsNoGstin) out.push("add suppliers without a GSTIN");
      if (a.bankAmounts !== "within" && b.bankAmounts === "within") out.push("allow any amount within the limit");
      if (lim(b.perEntry) > lim(a.perEntry)) out.push("raise the limit per entry");
      if (lim(b.perDay) > lim(a.perDay)) out.push("raise the daily limit");
      if (num(b.holdMin) < num(a.holdMin)) out.push("shorten the hold");
    }
    if (a.whoOn !== b.whoOn || a.whoUndo !== b.whoUndo) out.push("change who may change it");
    return out;
  },
  role(){ const a = typeof S === "object" && S.account; return a && a.me ? a.me.role || "staff" : "owner"; },
  // what this person may do: switch on / loosen (owner), switch off / tighten (anyone), undo (as the setting says)
  may(co, what){
    const r = this.role(), c = this.cfg(co);
    if (what === "loosen") return r === "owner" || c.whoOn === "anyone";
    if (what === "undo") return r === "owner" || c.whoUndo !== "owner";
    return r === "owner" || r === "staff";
  },
  // the words of a change for the log: "Switched on for X: bank lines, purchase bills; limit ₹50,000 an entry"
  changeWords(a, b, coName){
    a = Object.assign({}, this.DEF, a || {}); b = Object.assign({}, this.DEF, b || {});
    const amt = v => v == null || v === "" ? "none" : money0(v).replace(/\.00$/, "");
    if (!a.on && b.on) return "Switched on for " + coName + ": " + [b.bank && "bank lines", b.bills && "purchase bills"].filter(Boolean).join(", ") + "; limit " + amt(b.perEntry) + " an entry" + (b.perDay ? ", " + amt(b.perDay) + " a day" : "") + "; hold " + b.holdMin + " min";
    if (a.on && !b.on) return "Switched off for " + coName;
    const w = [];
    if (a.bank !== b.bank) w.push("bank lines " + (b.bank ? "on" : "off"));
    if (a.bills !== b.bills) w.push("purchase bills " + (b.bills ? "on" : "off"));
    if (a.billsNoGstin !== b.billsNoGstin) w.push("suppliers without a GSTIN " + (b.billsNoGstin ? "on" : "off"));
    if (a.bankAmounts !== b.bankAmounts) w.push("amounts: " + (b.bankAmounts === "within" ? "any amount within the limit, after two agreeing approvals" : "the same amount only"));
    if (num(a.perEntry) !== num(b.perEntry)) w.push("limit per entry " + amt(a.perEntry) + " → " + amt(b.perEntry));
    if (String(a.perDay || "") !== String(b.perDay || "")) w.push("daily limit " + amt(a.perDay) + " → " + amt(b.perDay));
    if (num(a.holdMin) !== num(b.holdMin)) w.push("hold before posting " + a.holdMin + " → " + b.holdMin + " minutes");
    if (a.whoOn !== b.whoOn) w.push("who may switch it on: " + (b.whoOn === "owner" ? "the owner only" : "anyone"));
    if (a.whoUndo !== b.whoUndo) w.push("who may undo: " + (b.whoUndo === "owner" ? "the owner only" : "owner and staff"));
    return w.length ? coName + ": " + w.join("; ") : "";
  },
  // save a new setting for a client (refused here when it loosens and this person is not the owner; the server refuses too)
  save(co, value){
    const was = this.cfg(co), next = Object.assign({}, this.DEF, was, value || {}), loose = this.loosens(was, next);
    if (loose.length && !this.may(co, "loosen")) return {ok: false, why: "Only the firm’s owner can " + loose.join(", ") + ". You can switch it off or tighten it."};
    const words = this.changeWords(was, next, co.name || "");
    if (!words) return {ok: true, same: true};
    const who = typeof whoAmI === "function" ? whoAmI() : "", at = new Date().toISOString();
    const r = this.rec(co);
    Drafts.direct(() => {
      co.choices = co.choices || {};
      co.choices.autopost = {value: next, state: "confirmed", by: who, at, role: this.role(), prev: r ? {value: r.value, by: r.by, at: r.at} : null};
      co.autopostLog = (co.autopostLog || []).concat([{at, by: who, role: this.role(), what: words}]).slice(-200);
      Store.saveCompany(co);
    }, {bypass: true});
    return {ok: true, words};
  },

  /* ---------- who decided a bank line ---------- */
  // "hand" set by a person, "confirm" a suggestion a person accepted, "rule-written" a rule a person made, "auto" posted
  // by itself, "guess-posted" FinCom's guess posted without a person looking (never a precedent)
  rowHow(r){
    if (!r) return "";
    if (r.auto || r.source === "auto") return "auto";
    if (r.userSet && (r.source === "you" || !r.source)) return "hand";
    if (r.userSet) return "confirm";
    if (r.source === "rule") return "rule-written";
    return "guess-posted";
  },
  /* ---------- the key of a bank line: the UPI handle / account, else the party, else the steady wording ---------- */
  bankKey(r, env){
    const d = (r && r.dec) || {}, k = String(d.key || "");
    if (k && !/^(name|narr):/.test(k)) return k;                     // upi:…, acct:…: a stable id
    if (/^name:/.test(k)){
      const toks = String(d.name || "").toUpperCase().split(/[^A-Z0-9&]+/).filter(Boolean);
      const keep = toks.filter(t => !this.MONTH_TOK.test(t) && !/^\d+$/.test(t));
      if (keep.length === toks.length) return k;
      const pk = (env && env.partyKey || partyKey)({name: keep.join(" ")});
      return pk || "";
    }
    if (/^narr:/.test(k)){
      const w = k.slice(5).split(" ").filter(x => x && !this.MONTH_WORD.test(x) && !/^\d+$/.test(x));
      return w.length ? "narr:" + w.join(" ") : "";
    }
    const pk = (env && env.partyKey || partyKey)(d);
    if (pk) return pk;
    const s = String(r.narr || "").toUpperCase().replace(/\b\d{5,}\b/g, " ").replace(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, " ").replace(/[^A-Z& ]+/g, " ")
      .split(/\s+/).filter(w => w.length >= 3 && !this.MONTH_TOK.test(w) && !/^(UPI|NEFT|RTGS|IMPS|ACH|MMT|CMS|INF|DR|CR|TO|FROM|THE|AND)$/.test(w)).slice(0, 3);
    return s.length ? "narr:" + s.join(" ").toLowerCase() : "";
  },
  dir(r){ return num(r.debit) ? "out" : "in"; },
  amt(r){ return r2(num(r.debit) || num(r.credit)); },

  /* ---------- precedents: the bank lines a person approved, in Tally ---------- */
  // rows: every statement's lines of the client; hist: b.hist.rows (fp → {k, l, d, h, by, at}). Returns
  // Map(key|dir → [{id, fp, ledger, vtype, shape, amt, date, at, by, how}]), oldest first
  // teach (tests only): which decisions count; by default a person's (BANK_TEACH)
  bankIndex(rows, hist, env, teach){
    const idx = new Map(), seen = new Set();
    const add = (key, dir, p) => { if (!key) return; const k = key + "|" + dir; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(p); };
    (rows || []).forEach(r => {
      // a line taken back teaches only once a person decided it again afterwards
      if (!r || !["sent", "intally"].includes(r.state) || !r.ledger || r.goneFromTally || (r.autoUndone && !(r.decidedAt && r.decidedAt > r.autoUndone.at))) return;
      const how = this.rowHow(r);
      if (!(teach ? teach(how) : this.BANK_TEACH.includes(how))) return;
      seen.add(r.fp || r.id);
      add(this.bankKey(r, env), this.dir(r), {id: r.id, fp: r.fp, ledger: r.ledger, vtype: r.vtype || "", shape: this.rowShape(r), amt: this.amt(r), date: r.date || "",
        at: r.decidedAt || r.sentAt || r.date || "", by: r.decidedBy || (r.tally && r.tally.by) || "", how, narr: String(r.narr || "").slice(0, 60)});
    });
    Object.entries(hist || {}).forEach(([fp, h]) => {
      // only what reached Tally (p: recorded when it was posted or found there), as the rows' own record says
      if (!h || seen.has(fp) || !this.BANK_TEACH.includes(h.h) || !h.l || !h.p) return;
      const r = {dec: {key: h.k, name: h.n}, narr: h.n};
      add(this.bankKey(r, env), h.d || "out", {id: fp, fp, ledger: h.l, vtype: h.vt || "", shape: h.sh || "|", amt: num(h.a), date: h.dt || "", at: h.at || h.dt || "", by: h.by || "", how: h.h, narr: h.n || ""});
    });
    idx.forEach(list => list.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.at).localeCompare(String(b.at))));
    return idx;
  },
  // what must be the same every time besides the ledger: splits and TDS at payment
  rowShape(r){ return [(r.splits || []).map(s => s.ledger).sort().join("+"), num(r.tdsAtPay) > 0 ? "tds" : ""].join("|"); },
  ledWords(list){ const c = {}; list.forEach(p => { c[p.ledger] = (c[p.ledger] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([l, n]) => l + " " + n + "×").join(", "); },
  // money in to an expense ledger, or out to an income ledger (the AKJ audit fee booked to Bank Charges)
  wrongWay(dir, ledger, env){
    const info = env.ledgerInfo ? env.ledgerInfo(ledger) : null, g = String((info && (info.group || info.parent)) || "");
    if (dir === "in") return g ? this.EXP_GRP.test(g) : this.EXP_NAME.test(ledger) && !this.INC_NAME.test(ledger);
    return g ? this.INC_GRP.test(g) : this.INC_NAME.test(ledger);
  },
  parking(ledger, env){
    if (this.PARK.test(ledger)) return true;
    const info = env.ledgerInfo ? env.ledgerInfo(ledger) : null, g = String((info && (info.group || info.parent)) || "");
    return !!g && (this.PARK.test(g) || /^cash-in-hand$/i.test(g));
  },
  // one bank line through the rules: {ok, conf, rule, label, ledger, vtype, prec, stops: [why…], why (first stop)}
  bankCheck(r, ctx){
    const env = ctx.env || {}, cfg = ctx.cfg, out = {kind: "bank", id: r.id, amt: this.amt(r), stops: []};
    const stop = w => { out.stops.push(w); };
    const dir = this.dir(r), key = this.bankKey(r, env), a = out.amt;
    out.key = key; out.dir = dir;
    // a person's own decision or change is never overwritten
    if (r.userSet || r.prevState || r.autoUndone) stop(r.autoUndone ? "a person took the automatic entry back" : "a person set or changed this line");
    if (r.repaired || r.balOk === false || r.notRead) stop(r.balOk === false ? "the line does not agree with the running balance" : "the amount was read from the balance change");
    if (/^(ai|claude)$/i.test(String(r.source || ""))) stop("the ledger is an AI suggestion");
    const P = (key && ctx.idx.get(key + "|" + dir)) || [];
    const charges = dir === "out" && (r.dec && r.dec.mode === "CHARGES" || this.CHG_RE.test(r.narr || ""));
    const challan = dir === "out" && (this.GST_RE.test(r.narr || "") || this.TDS_RE.test(r.narr || ""));
    // B6: a payment that pays a bill a person approved (matchBill, strong)
    let bill = null;
    if (dir === "out" && ctx.billFor) bill = ctx.billFor(r);
    if (!P.length && !bill){ stop("first time for this party"); out.why = out.stops[0]; return out; }
    let ledger, vtype = "", rule, conf, prec = P[P.length - 1];
    if (bill && !P.length){
      ledger = bill.ledger; rule = "B6"; conf = "High"; prec = {id: bill.id, ledger, amt: bill.amt, date: bill.date, by: bill.by, at: bill.at, how: "hand", bill: true, narr: bill.ref};
      out.billId = bill.id; out.billRef = bill.ref; out.tdsAtPay = bill.tdsAtPay || 0; out.tdsLedger = bill.tdsLedger || "";
      if (this.parking(ledger, env)) stop("“" + ledger + "” is a parking or clearing ledger");
      if (env.exactLedger && !env.exactLedger(ledger)) stop("“" + ledger + "” is not a ledger in Tally");
    } else {
      const paused = env.pausedAt ? env.pausedAt(key + "|" + dir) : null;
      if (paused && !P.some(p => String(p.at || "") > String(paused.at || ""))) stop("paused after a change by " + (paused.by || "a person") + ": approve one by hand to resume");
      const leds = new Set(P.map(p => p.ledger)), shapes = new Set(P.map(p => p.shape || "")), vts = new Set(P.map(p => p.vtype || "").filter(Boolean));
      if (leds.size > 1) stop("earlier approvals disagree (" + this.ledWords(P) + ")");
      else if (shapes.size > 1 || vts.size > 1) stop("earlier approvals were posted in different ways");
      ledger = P[0].ledger; vtype = P[0].vtype || "";
      if (ledger && this.parking(ledger, env)) stop(/suspense/i.test(ledger) ? "Suspense is never posted by itself" : "“" + ledger + "” is a parking or clearing ledger");
      if (ledger && this.wrongWay(dir, ledger, env)) stop(dir === "in" ? "money in to an expense ledger (" + ledger + ")" : "money out to an income ledger (" + ledger + ")");
      if (ledger && env.exactLedger && !env.exactLedger(ledger)) stop("“" + ledger + "” is not a ledger in Tally");
      if (ledger && env.isFixed && env.isFixed(ledger)) stop("capital goods (" + ledger + " is a fixed asset)");
      const same = P.filter(p => Math.abs(p.amt - a) <= 1);
      if (same.length){ rule = "B1"; conf = "High"; prec = same[same.length - 1]; }
      else if (charges && a <= 5000){ rule = "B3"; conf = "High"; }
      else if (P.length >= 2 && a <= 1.5 * Math.max(...P.map(p => p.amt))){ rule = "B2"; conf = "Medium"; }
      else stop(P.length < 2 ? "the amount differs from the one earlier approval" : "the amount is more than 1.5 times the earlier ones");
      if (rule === "B1" || rule === "B2"){
        if (this.MONTHLY_RE.test(r.narr || "") && prec.date){ const gap = (Date.parse(r.date) - Date.parse(prec.date)) / 86400000; if (gap >= 25 && gap <= 35) rule = "B5"; }
        if (challan) rule = "B4";
      }
      if (challan && this.PARK.test(ledger)) stop("the earlier challan went to Suspense");
    }
    if (a > cfg.perEntry) stop("over the " + money0(cfg.perEntry).replace(/\.00$/, "") + " limit");
    if (conf === "Medium" && cfg.bankAmounts !== "within") stop("the amount differs from earlier approvals (only the same amount posts by itself)");
    if (env.closedWhy){ const w = env.closedWhy(r.date, num(r.tdsAtPay) > 0); if (w && w.length) stop("closed or filed period: " + w[0]); }
    if (env.dupOf){ const d = env.dupOf(r); if (d) stop("possible duplicate: " + d); }
    if (env.postWhy){ const w = env.postWhy(); if (w) stop(w); }
    Object.assign(out, {ledger, vtype, rule, conf, prec, label: (r.dec && (r.dec.name || r.dec.upi)) || key.replace(/^\w+:/, "")});
    out.ok = !out.stops.length && (conf === "High" || (conf === "Medium" && cfg.bankAmounts === "within"));
    out.why = out.stops[0] || "";
    return out;
  },

  /* ---------- bills ---------- */
  billHow(e){ return e.approvedHow || (e.auto ? "auto" : e.approvedAt ? "before" : ""); },
  supplierKey(x, env){
    const g = String(x.vendorGstin || "").toUpperCase().trim();
    if (g && (env.gstinValid ? env.gstinValid(g) : true)) return "gstin:" + g;
    const p = env.panOf ? env.panOf(x) : String(x.vendorPan || "").toUpperCase();
    return p ? "pan:" + p : "";
  },
  hsnSet(x){ return [...new Set([].concat((x && x.items) || []).map(i => String(i.hsn || "").replace(/\D/g, "").slice(0, 4)).filter(Boolean))].sort().join(","); },
  gstShape(x){ return num(x.igst) > 0 ? "IGST" : (num(x.cgst) > 0 || num(x.sgst) > 0) ? "CGST+SGST" : "none"; },
  rates(x){ return [...new Set([].concat((x && x.items) || []).map(i => i.gstRate).filter(v => v != null && v !== "").map(v => String(num(v))))].sort().join(","); },
  expLeds(s){ return [...new Set(((s && s.lines) || []).filter(l => l.role === "expense").map(l => l.ledger))].sort().join(" + "); },
  tdsKind(s, natureId){ if (!s) return ""; return (num(s.tds) > 0 ? "TDS " : s.skip ? "no TDS (" + (s.skip.reason || "skip") + ") " : "no TDS ") + (natureId || ""); },
  billShape(e, s){
    s = s || e.snapshot || {};
    return {exp: this.expLeds(s), hsn: this.hsnSet(e.x), gst: this.gstShape(e.x), rates: this.rates(e.x), rcm: !!(s.rcm || e.rcm), blocked: !!s.blocked, tds: this.tdsKind(s, e.natureId), party: e.partyLedger || ""};
  },
  shapeDiff(a, b){
    const names = {exp: "expense ledger", hsn: "HSN/SAC", gst: "IGST or CGST+SGST", rates: "GST rate", rcm: "reverse charge", blocked: "blocked credit", tds: "TDS", party: "party ledger"};
    return Object.keys(names).filter(k => String(a[k]) !== String(b[k])).map(k => names[k]);
  },
  fileBase(h){ return String(h || "").replace(/p\d+$/i, ""); },
  // a bill through the rules. ctx: {cfg, entries (all of the client), env: {compute, findDuplicate, gstinValid, panOf,
  // partyConfirmed, ledgerInfo, exactLedger, closedWhy, notFiling, postWhy, guessedWhy, isFixed, nameSim}}
  billCheck(e, ctx){
    const env = ctx.env || {}, cfg = ctx.cfg, x = e.x || {}, out = {kind: "bill", id: e.id, amt: r2(num(x.total)), stops: []};
    const stop = w => { out.stops.push(w); };
    if (e.touchedBy || e.autoUndone) stop(e.autoUndone ? "a person took the automatic entry back" : "a person changed this bill");
    const key = this.supplierKey(x, env); out.key = key;
    const all = Object.values(ctx.entries || {});
    const P = all.filter(o => o.id !== e.id && o.status === "approved" && this.BILL_TEACH.includes(this.billHow(o)) && (o.exportedAt || o.tally) && !o.goneFromTally && o.snapshot
      && key && this.supplierKey(o.x || {}, env) === key).sort((a, b) => String(b.approvedAt || "").localeCompare(String(a.approvedAt || "")));
    const byPan = key.startsWith("pan:");
    if (!key) stop("first bill of this supplier (no GSTIN or PAN to know it by)");
    else if (byPan && !cfg.billsNoGstin) stop("the supplier has no GSTIN (suppliers without one are not switched on)");
    else if (!P.length) stop("first bill of this supplier");
    else if (byPan && P.length < 2) stop("only one earlier bill of this supplier without a GSTIN (two agreeing are needed)");
    const prec = P[0];
    // the same file read twice (Prince PC/26-27/0679 and 0691, Jitin 4861 and 5000), the same bill number, or the same
    // supplier and total within 45 days with the same HSN set
    const dup = env.findDuplicate ? env.findDuplicate(e) : null;
    const fb = this.fileBase(e.fileHash);
    const sameFile = fb && all.find(o => o.id !== e.id && o.status !== "deleted" && o.status !== "duplicate" && this.fileBase(o.fileHash) === fb);
    const near = all.find(o => o.id !== e.id && ["approved", "draft"].includes(o.status) && key && this.supplierKey(o.x || {}, env) === key && Math.abs(num((o.x || {}).total) - num(x.total)) < 1
      && Math.abs((Date.parse((o.x || {}).invoiceDate) - Date.parse(x.invoiceDate)) / 86400000) <= 45 && this.hsnSet(o.x) === this.hsnSet(x) && (o.status === "approved" || String(o.createdAt || "") < String(e.createdAt || "")));
    if (dup || sameFile || near) stop("possible duplicate (" + (dup ? dup.msg || "same bill" : sameFile ? "same file as " + ((sameFile.x || {}).invoiceNo || sameFile.fileName) : "same supplier and amount as " + ((near.x || {}).invoiceNo || "") + " within 45 days") + ")");
    if (env.closedWhy){ const w = env.closedWhy(x.invoiceDate, true); if (w && w.length) stop("closed or filed period: " + w[0]); }
    // the bill worked out afresh, as approving it would: TDS recomputed (yearly limit, the year's total so far, 206AB)
    const c = env.compute ? env.compute(e) : null;
    if (c && (c.missing || []).length) stop("something is missing: " + c.missing.join(", "));
    const now = c ? {lines: c.lines, tds: c.tds, skip: c.skip, rcm: c.rcmTax, blocked: c.gd && c.gd.block ? c.gd.block.cat : null} : e.snapshot || null;
    if (key.startsWith("gstin:")){
      const g = key.slice(6);
      if (prec && String(((prec.x || {}).vendorGstin) || "").toUpperCase() !== g) stop("GSTIN differs from the earlier bill");
      const info = env.ledgerInfo ? env.ledgerInfo(e.partyLedger) : null;
      if (info && info.gstin && String(info.gstin).toUpperCase() !== g) stop("GSTIN mismatch: the Tally ledger " + e.partyLedger + " has " + info.gstin);
      if (env.notFiling && env.notFiling(g)) stop("the supplier is “Not filing” in the client’s 2B");
      if (env.nameSim && (!info || !info.gstin) && env.nameSim(x.vendorName, e.partyLedger) < 0.5) stop("the supplier’s name and the party ledger “" + e.partyLedger + "” differ");
    } else if (x.vendorGstin && env.gstinValid && !env.gstinValid(x.vendorGstin)) stop("the GSTIN fails its check digit");
    if (prec && now){
      const mine = this.billShape(e, now), two = P.slice(0, 2).map(o => this.billShape(o));
      if (two.length === 2 && this.shapeDiff(two[0], two[1]).length) stop("earlier bills disagree (" + this.shapeDiff(two[0], two[1]).join(", ") + ")");
      const diff = this.shapeDiff(two[0], mine).filter(d => d !== "TDS");
      if (diff.length) stop((diff.includes("HSN/SAC") ? "HSN/SAC " + (mine.hsn || "none") + " not on earlier approved bills" : "not the same as the earlier bill: " + diff.join(", ")));
      // P3: TDS worked out afresh must agree in kind with the earlier bill (due / not due)
      if (two[0].tds.split(" ")[0] !== mine.tds.split(" ")[0] || (num(now.tds) > 0) !== (num((prec.snapshot || {}).tds) > 0)) stop("TDS now differs in kind from the earlier bill");
    }
    if (env.partyConfirmed && !env.partyConfirmed(e)) stop("the supplier’s Tally ledger is not confirmed");
    const lines = (now && now.lines) || [];
    if (now && (now.rcm || e.rcm) || this.hsnList(x).some(h => this.RCM_SAC.test(h) || (!x.vendorGstin && this.RCM_SAC_UNREG.test(h)))) stop("reverse charge");
    const exp = lines.filter(l => l.role === "expense").map(l => l.ledger);
    if (exp.some(l => env.isFixed && env.isFixed(l)) || [].concat(x.items || []).some(i => this.CAPITAL_HSN.test(String(i.hsn || "")) && num(i.taxable) >= this.CAPITAL_AT)) stop("capital goods");
    if (e.notRead || e.readError) stop("not read yet");
    else if (/image|photo|ocr|scan/i.test(String(e.readMode || "")) && ((e.uncertain || []).length || e.legibility === "low" || e.handwritten)) stop("read from an image with fields to check");
    if (e.ai && e.ai.suggested && e.ai.suggested === e.natureId && prec && prec.natureId !== e.natureId) stop("the kind of bill is an AI suggestion");
    if (lines.some(l => l.ledger && this.parking(l.ledger, env))) stop("a parking ledger (Suspense) is on the bill");
    if (lines.some(l => l.ledger && env.exactLedger && !env.exactLedger(l.ledger)) || lines.some(l => !l.ledger)) stop("a ledger the bill needs is not in Tally");
    if (env.guessedWhy){ const w = env.guessedWhy(e); if (w) stop(w.replace(/^Posting waits: /, "")); }
    const lineSum = r2(num(x.taxable) + num(x.cgst) + num(x.sgst) + num(x.igst) + num(x.cess));
    if (num(x.taxable) > 0 && Math.abs(lineSum - num(x.total)) > 1 && !num(x.roundOff)) stop("the total is not the sum of the lines");
    if (out.amt > cfg.perEntry) stop("over the " + money0(cfg.perEntry).replace(/\.00$/, "") + " limit");
    if (env.postWhy){ const w = env.postWhy(); if (w) stop(w); }
    out.conf = byPan ? "Medium" : "High"; out.rule = byPan ? "P2" : "P1";
    out.prec = prec ? {id: prec.id, ref: (prec.x || {}).invoiceNo || "", date: (prec.x || {}).invoiceDate || "", at: prec.approvedAt || "", by: prec.approvedBy || "", how: this.billHow(prec)} : null;
    out.label = (x.vendorName || "") + (key.startsWith("gstin:") ? " " + key.slice(6) : "");
    out.ledger = this.expLeds(now || {});
    out.ok = !out.stops.length && (out.conf === "High" || cfg.billsNoGstin);
    out.why = out.stops[0] || "";
    return out;
  },
  hsnList(x){ return [].concat((x && x.items) || []).map(i => String(i.hsn || "").replace(/\D/g, "")).filter(Boolean); },
  // the chip's words: "Auto · rule: BHARATKOSH → MCA EXPENSE"
  chipWords(m){ return "Auto · rule: " + (m.kind === "bill" ? m.label : (m.label || "").toUpperCase() + " → " + (m.ledger || "")); },
  // the hover's words: why, and the approval it copied
  tipWords(m){
    const p = m.prec || {};
    const amt = money0(m.amt).replace(/\.00$/, "");
    if (m.kind === "bill") return "Rule " + m.rule + " (" + m.conf + "): same supplier as your bill " + (p.ref || "") + (p.date ? " of " + fmtDate(p.date) : "") + (p.by ? ", approved by " + p.by : "") + (p.at ? " on " + fmtDate(String(p.at).slice(0, 10)) : "") + ". " + amt + " within the limit; not a duplicate; period open; TDS worked out afresh.";
    return "Rule " + m.rule + " (" + m.conf + "): " + (m.dir === "out" ? "money out" : "money in") + " to " + m.ledger + ". Copied from " + (p.bill ? "the bill " + (p.narr || "") + " a person approved" : "your approval of " + (p.date ? fmtDate(p.date) : "an earlier line") + " " + money0(p.amt || 0).replace(/\.00$/, "") + (p.by ? " by " + p.by : "") + " (" + (p.how === "rule-written" ? "a rule a person made" : p.how === "confirm" ? "confirmed by a person" : "set by hand") + ")") + ". " + amt + " within the limit.";
  },

  /* ---------- the outside facts, from the app ---------- */
  env(cid){
    const co = CO(cid), b = typeof B === "function" ? B() : null, books = typeof S === "object" && S.books && S.books.cid === cid ? S.books : (this.books && this.books.cid === cid ? this.books.b : null);
    const pauses = co.autopostPause || {};
    return {
      partyKey, gstinValid, nameSim,
      panOf: x => typeof effectivePan === "function" ? effectivePan(x) : String(x.vendorPan || ""),
      // a ledger FinCom would create first (b.newLed, "pending") is not in Tally: never automatic
      exactLedger: n => { if (typeof exactLedger !== "function") return n; const i = typeof ledgerInfo === "function" ? ledgerInfo(n) : null; return i && i.pending ? null : exactLedger(n); },
      ledgerInfo: n => typeof ledgerInfo === "function" ? ledgerInfo(n) : null,
      isFixed: n => { const i = typeof ledgerInfo === "function" ? ledgerInfo(n) : null; return !!(i && /fixed assets/i.test(String(i.group || i.parent || ""))); },
      closedWhy: (d, tds) => typeof ClosedP === "object" && d ? ClosedP.why(co, books, String(d).replace(/-/g, ""), tds) : [],
      pausedAt: k => pauses[k] || null,
      compute: e => { try { return compute(e, cid); } catch (x){ return null; } },
      findDuplicate: e => { try { const d = findDuplicate(e, cid); return d && d.strong ? d : null; } catch (x){ return null; } },
      partyConfirmed: e => { try { const c = compute(e, cid), p = c && c.party, ch = p && partyChoice(p); return !!(ch && ch.state === "confirmed" && (exactLedger(ch.value) || ch.value) === (exactLedger(e.partyLedger) || e.partyLedger)); } catch (x){ return false; } },
      guessedWhy: e => typeof billGuessedWhy === "function" ? billGuessedWhy(e, co) : "",
      notFiling: g => { try { return typeof SupHealth === "object" && SupHealth.state ? SupHealth.state(cid, g) === "notfiling" : false; } catch (x){ return false; } },
      postWhy: () => { const p = typeof postToProblem === "function" ? postToProblem(co, "") : ""; return p ? "the Tally company to post to is not confirmed" : typeof remoteIdTrial === "function" && remoteIdTrial(co) ? "the REMOTEID test is on (each posting is asked first)" : ""; },
      dupOf: r => {
        const tags = b && b.postedTags; if (tags && tags[fpHash(r.fp || r.id)]) return "FinCom posted this line before";
        const k = this.bankKey(r, null), same = b && (b.rows || []).find(o => o !== r && ["sent", "intally"].includes(o.state) && o.date === r.date && this.amt(o) === this.amt(r) && this.bankKey(o, null) === k);
        return same ? "the same amount, date and party is already in Tally" : "";
      },
      billFor: null
    };
  },

  /* ---------- the run: match, hold, claim, post through the usual route ---------- */
  st: {busy: {}, last: {}, msg: {}},
  log(){ try { return JSON.parse(lsGet("tdsdesk:autopost:log") || "[]"); } catch (e){ return []; } },
  logAdd(items){ const l = this.log().concat(items).slice(-2000); lsSet("tdsdesk:autopost:log", JSON.stringify(l)); },
  logSet(id, patch){ const l = this.log(); l.forEach(x => { if (x.id === id || x.run === id) Object.assign(x, patch); }); lsSet("tdsdesk:autopost:log", JSON.stringify(l)); },
  holder(){ let h = ""; try { h = sessionStorage.getItem("fincom:ap:holder") || ""; if (!h){ h = uid("tab"); sessionStorage.setItem("fincom:ap:holder", h); } } catch (e){ h = h || uid("tab"); } return h; },
  // the server's claim: each entry once, the daily total for the client (IST day) across browsers. Signed out (this
  // browser only): the same on this browser's own record, under the browser's lock so two tabs never both post
  async claim(cid, run, items){
    if (typeof Cloud === "object" && Cloud.on() && Cloud.st && Cloud.st.firm){
      try {
        const r = await Cloud.rpc("autopost_claim", {p_client: cid, p_run: run, p_items: items.map(i => ({id: i.cid, kind: i.kind, amount: i.amt, rule: i.rule}))});
        if (r && r.ok) return {ok: true, taken: new Set([].concat(r.taken || [])), refused: r.refused || [], dayUsed: num(r.day_used), perDay: r.per_day};
        return {ok: false, why: (r && r.error) || "FinCom’s cloud did not take the claim."};
      } catch (e){
        return {ok: false, why: /autopost_claim|PGRST202|404|does not exist/i.test(String(e && e.message)) ? "FinCom’s cloud is not ready for automatic posting yet (migration 101)." : "FinCom’s cloud could not be reached: " + ((e && e.message) || e)};
      }
    }
    const take = () => {
      const cfg = this.cfg(CO(cid)), day = istDay(Date.now()), l = this.log(), have = new Set(l.filter(x => x.cid === cid && x.status !== "released").map(x => x.id));
      let used = l.filter(x => x.cid === cid && x.day === day && !["released", "undone"].includes(x.status)).reduce((a, x) => a + num(x.amt), 0);
      const taken = new Set(), refused = [];
      items.forEach(i => {
        if (have.has(i.cid)){ refused.push({id: i.cid, why: "already taken"}); return; }
        if (cfg.perDay && used + i.amt > cfg.perDay){ refused.push({id: i.cid, why: "daily limit"}); return; }
        used += i.amt; taken.add(i.cid);
      });
      this.logAdd(items.filter(i => taken.has(i.cid)).map(i => ({id: i.cid, cid, run, kind: i.kind, amt: i.amt, rule: i.rule, label: i.label, day, at: new Date().toISOString(), status: "claimed"})));
      return {ok: true, taken, refused, dayUsed: used, perDay: cfg.perDay};
    };
    if (typeof navigator === "object" && navigator.locks && navigator.locks.request) return navigator.locks.request("fincom-autopost-" + cid, take);
    return take();
  },
  async mark(cid, run, ids, status, job){
    if (!ids.length) return;
    ids.forEach(id => this.logSet(id, {status, job: job || undefined}));
    if (typeof Cloud === "object" && Cloud.on() && Cloud.st && Cloud.st.firm){ try { await Cloud.rpc("autopost_mark", {p_client: cid, p_run: run, p_ids: ids, p_status: status, p_job: job || null}); } catch (e){ /* the claim's lease runs out by itself */ } }
  },
  // the bank lines of the client that may go, worked out now (marks each open line with why it waits)
  async bankPlan(cid){
    const b = B(), co = CO(cid);
    if (!b || b.cid !== cid || b.loading || !curStmt()) return [];
    const cfg = this.cfg(co), env = this.env(cid);
    const all = [];
    for (const s of b.stmts){ const rows = s.id === b.cur ? b.rows : ((await BankDB.get("stmt:" + cid + ":" + s.id)) || []); rows.forEach(r => all.push(r)); }
    const idx = this.bankIndex(all, (b.hist || {}).rows, env);
    const bills = typeof openBills === "function" ? openBills(cid).filter(x => x.e && this.BILL_TEACH.includes(this.billHow(x.e))) : [];
    const taken = new Set();
    env.billFor = r => { if (!bills.length || typeof matchBill !== "function") return null; const m = matchBill(r, bills, taken); if (!m || !m.strong) return null; taken.add(m.bill.e.id);
      return {id: m.bill.e.id, ledger: m.bill.ledger, amt: m.bill.amounts[0].v, date: m.bill.date, ref: m.bill.ref, by: m.bill.e.approvedBy || "", at: m.bill.e.approvedAt || "", tdsAtPay: m.tdsAtPay, tdsLedger: m.tdsLedger}; };
    const acc = typeof accountFor === "function" ? accountFor(curStmt()) : null;
    const accWhy = acc && typeof bankLedgerReady === "function" && !bankLedgerReady(co, acc) ? "the bank account’s Tally ledger is not confirmed" : "";
    const out = [];
    b.rows.forEach(r => {
      if (!["attention", "suggested", "ready"].includes(r.state) || r.auto) return;
      const m = this.bankCheck(r, {cfg, idx, env});
      if (accWhy && m.ok){ m.ok = false; m.stops.push(accWhy); m.why = accWhy; }
      r.autoWhy = m.ok ? "" : m.why;
      if (m.ok) out.push({m, r});
    });
    return out;
  },
  billPlan(cid){
    const d = D(cid), co = CO(cid), cfg = this.cfg(co), env = this.env(cid), out = [];
    Object.values(d.entries || {}).forEach(e => {
      if (e.status !== "draft" || e.auto || S.reading && S.reading[e.id]) return;
      const m = this.billCheck(e, {cfg, entries: d.entries, env});
      e.autoWhy = m.ok ? "" : m.why;
      if (m.ok) out.push({m, e});
    });
    return out;
  },
  // can this browser reach the client's Tally without asking anything (the cloud queue, or the bridge with the company open)
  reach(co){
    if (typeof tallyVia !== "function") return "";
    const v = tallyVia(co);
    if (v === "cloud") return "cloud";
    if (v === "bridge" && Bridge.openFor(co) && Bridge.st.allowImport !== false) return "bridge";
    return "";
  },
  // one run for the open client: called on open, after an upload or a read, and every 15 minutes while it is open
  async tick(cid, why){
    const co = CO(cid);
    if (!co || !this.isOn(co) || this.st.busy[cid] || cid !== S.coId) return {skipped: "off or busy"};
    this.st.busy[cid] = true;
    try {
      // the client's books, for the closed and filed periods (ClosedP), read before any rule runs
      if (typeof ClosedP === "object" && ClosedP.booksOf){ try { this.books = {cid, b: await ClosedP.booksOf(co)}; } catch (e){ this.books = null; } }
      const cfg = this.cfg(co), now = Date.now(), res = {bank: 0, bills: 0, held: 0, waiting: 0, refused: []};
      const via = this.reach(co);
      await this.settle(cid);
      if (cfg.bank && S.bank && S.bank.cid === cid){
        const plan = await this.bankPlan(cid), b = B();
        plan.forEach(({m, r}) => {
          r.autoPrev = {state: r.state, ledger: r.ledger, source: r.source, why: r.why, level: r.level, srcLabel: r.srcLabel, vtype: r.vtype, billId: r.billId || null, billRef: r.billRef || "", tdsAtPay: r.tdsAtPay || 0, tdsLedger: r.tdsLedger || ""};
          r.autoHold = {until: new Date(now + cfg.holdMin * 60000).toISOString(), rule: m.rule, conf: m.conf, ledger: m.ledger, vtype: m.vtype || vtypeFor(r, m.ledger), prec: m.prec, label: m.label, key: m.key, dir: m.dir, amt: m.amt,
            billId: m.billId || null, billRef: m.billRef || "", tdsAtPay: m.tdsAtPay || 0, tdsLedger: m.tdsLedger || "", chip: this.chipWords(m), tip: this.tipWords(m), why: why || ""};
        });
        res.waiting += b.rows.filter(r => ["attention", "suggested", "ready"].includes(r.state) && !r.autoHold && !r.auto).length;
        const due = b.rows.filter(r => r.autoHold && !r.auto && ["attention", "suggested", "ready"].includes(r.state) && Date.parse(r.autoHold.until) <= Date.now());
        res.held += b.rows.filter(r => r.autoHold && !r.auto && Date.parse(r.autoHold.until) > Date.now()).length;
        saveBank({rows: true});
        if (due.length && via) res.bank = await this.postBank(cid, due, res);
        else if (due.length) res.refused.push({why: "Tally cannot be reached from this computer"});
      }
      if (cfg.bills){
        const plan = this.billPlan(cid), d = D(cid);
        plan.forEach(({m, e}) => { e.autoHold = {until: new Date(now + cfg.holdMin * 60000).toISOString(), rule: m.rule, conf: m.conf, prec: m.prec, label: m.label, key: m.key, amt: m.amt, ledger: m.ledger, chip: this.chipWords(m), tip: this.tipWords(m)}; Store.saveEntry(cid, e); });
        res.waiting += Object.values(d.entries).filter(e => e.status === "draft" && !e.autoHold).length;
        const due = Object.values(d.entries).filter(e => e.autoHold && e.status === "draft" && !e.auto && Date.parse(e.autoHold.until) <= Date.now());
        res.held += Object.values(d.entries).filter(e => e.autoHold && e.status === "draft" && Date.parse(e.autoHold.until) > Date.now()).length;
        if (due.length && via) res.bills = await this.postBills(cid, due, res);
        else if (due.length) res.refused.push({why: "Tally cannot be reached from this computer"});
      }
      this.st.last[cid] = Object.assign({at: new Date().toISOString(), why}, res);
      return res;
    } finally { this.st.busy[cid] = false; if (typeof render === "function") render(); }
  },
  // still queued for the Tally computer (Tally closed there): the cloud keeps it and posts it when Tally opens
  QUEUED: /stays queued|queued for the Tally computer|Still waiting for the Tally computer/i,
  // the run's posting, through the usual route; when a person undid one of its entries while it was queued (the posting
  // cancelled: tally_post_cancel), the rest goes again under a new posting
  async through(run, post, again){
    this.requeueRun = this.requeueRun || {};
    for (let i = 0; i < 4; i++){
      this.requeueRun[run] = false; this.inRun = run;
      // the cloud posting's id, kept for the run as soon as it is made (Undo cancels it while it waits)
      const mk = CloudPost.uuid; this.runJob = this.runJob || {};
      CloudPost.uuid = function(){ const id = mk.call(this); AutoPost.runJob[run] = id; return id; };
      try { await post(); } finally { this.inRun = null; CloudPost.uuid = mk; }
      if (!this.requeueRun[run] || !again()) break;
    }
    delete this.requeueRun[run];
  },
  async postBank(cid, rows, res){
    const run = CloudPost.uuid(), items = rows.map(r => ({cid: "bank:" + (r.fp || r.id), kind: "bank", amt: this.amt(r), rule: r.autoHold.rule, label: r.autoHold.chip, r}));
    const c = await this.claim(cid, run, items);
    if (!c.ok){ res.refused.push({why: c.why}); this.st.msg[cid] = c.why; return 0; }
    this.st.msg[cid] = "";
    (c.refused || []).forEach(x => { const it = items.find(i => i.cid === x.id); if (it && /daily/.test(x.why)){ it.r.autoWhy = "over the daily limit for today"; delete it.r.autoHold; } });
    if ((c.refused || []).some(x => /daily/.test(x.why))) res.dayFull = true;
    const go = items.filter(i => c.taken.has(i.cid)).map(i => i.r);
    if (!go.length) return 0;
    const at = new Date().toISOString(), who = this.ownerWords(cid);
    go.forEach(r => {
      const h = r.autoHold;
      Object.assign(r, {ledger: h.ledger, vtype: h.vtype, state: "ready", source: "auto", userSet: false, level: "auto", srcLabel: h.chip, why: [h.tip], billId: h.billId, billRef: h.billRef, tdsAtPay: h.tdsAtPay, tdsLedger: h.tdsLedger});
      r.auto = {run, rule: h.rule, conf: h.conf, prec: h.prec, at, by: who, chip: h.chip, tip: h.tip, key: h.key, dir: h.dir, amt: h.amt, label: h.label, cid: "bank:" + (r.fp || r.id)};
      delete r.autoHold;
    });
    saveBank({rows: true});
    const live = () => go.filter(r => r.auto && r.state === "ready");
    this.posting = {run, by: "auto (rule)", owner: who};
    try { await this.through(run, () => postBankToTally(live().map(r => { r.postError = ""; return r.id; })), () => live().length > 0); } finally { this.posting = null; }
    go.filter(r => r.autoUndone && !r.auto).forEach(r => { r.postError = ""; });
    const mine = go.filter(r => r.auto && r.auto.run === run);
    const sent = mine.filter(r => r.state === "sent" || r.state === "intally"), left = mine.filter(r => !sent.includes(r));
    const job = this.jobOf(cid, mine.map(r => r.id), run);
    sent.forEach(r => { r.auto.done = true; });
    await this.mark(cid, run, sent.map(r => r.auto.cid), "posted", job);
    const queued = left.filter(r => job && (!r.postError || this.QUEUED.test(r.postError)));
    queued.forEach(r => { r.auto.job = job; });
    await this.mark(cid, run, queued.map(r => r.auto.cid), "queued", job);
    const failed = left.filter(r => !queued.includes(r));
    failed.forEach(r => { r.auto.failed = r.postError || "not posted"; });
    await this.mark(cid, run, failed.map(r => r.auto.cid), "failed", job);
    saveBank({rows: true});
    return sent.length;
  },
  async postBills(cid, list, res){
    const run = CloudPost.uuid(), items = list.map(e => ({cid: "bill:" + e.id, kind: "bill", amt: r2(num(e.x.total)), rule: e.autoHold.rule, label: e.autoHold.chip, e}));
    const c = await this.claim(cid, run, items);
    if (!c.ok){ res.refused.push({why: c.why}); this.st.msg[cid] = c.why; return 0; }
    this.st.msg[cid] = "";
    if ((c.refused || []).some(x => /daily/.test(x.why))) res.dayFull = true;
    (c.refused || []).forEach(x => { const it = items.find(i => i.cid === x.id); if (it && /daily/.test(x.why)){ it.e.autoWhy = "over the daily limit for today"; delete it.e.autoHold; Store.saveEntry(cid, it.e); } });
    const go = items.filter(i => c.taken.has(i.cid)).map(i => i.e);
    if (!go.length) return 0;
    const at = new Date().toISOString(), who = this.ownerWords(cid);
    // approved as a person would (the TDS worked out afresh, never copied), marked automatic
    const approveAll = list => list.forEach(e => {
      const h = e.autoHold || (e.auto && Object.assign({}, e.auto));
      this.approving = {how: "auto", from: h.prec && h.prec.id, run};
      try { approve(e, {bulk: true}); } finally { this.approving = null; }
      if (e.status !== "approved"){ e.autoWhy = "it could not be approved: something is missing"; delete e.autoHold; delete e.auto; Store.saveEntry(cid, e); return; }
      e.auto = {run, rule: h.rule, conf: h.conf, prec: h.prec, at, by: who, chip: h.chip, tip: h.tip, key: h.key, amt: h.amt, label: h.label, cid: "bill:" + e.id};
      delete e.autoHold; Store.saveEntry(cid, e);
    });
    approveAll(go);
    const live = () => go.filter(e => e.auto && e.auto.run === run && !e.exportedAt);
    this.posting = {run, by: "auto (rule)", owner: who};
    try {
      await this.through(run, () => postBillsToTally({ids: live().filter(e => e.status === "approved").map(e => e.id), auto: true}),
        // a cancelled posting sends its bills back to review: those still automatic are approved again and go under a new posting
        () => { const back = live().filter(e => e.status === "draft"); approveAll(back); return live().length > 0; });
    } finally { this.posting = null; }
    const mine = go.filter(e => e.auto && e.auto.run === run);
    const sent = mine.filter(e => e.exportedAt), left = mine.filter(e => !e.exportedAt);
    const job = this.jobOf(cid, mine.map(e => e.id), run);
    sent.forEach(e => { e.auto.done = true; Store.saveEntry(cid, e); });
    await this.mark(cid, run, sent.map(e => e.auto.cid), "posted", job);
    const queued = left.filter(e => e.status === "approved" && job && (!e.postError || this.QUEUED.test(e.postError)));
    queued.forEach(e => { e.auto.job = job; Store.saveEntry(cid, e); });
    await this.mark(cid, run, queued.map(e => e.auto.cid), "queued", job);
    const failed = left.filter(e => !queued.includes(e));
    failed.forEach(e => { e.auto.failed = e.postError || "not posted"; Store.saveEntry(cid, e); });
    await this.mark(cid, run, failed.map(e => e.auto.cid), "failed", job);
    return sent.length;
  },
  // entries queued earlier that the Tally computer has since posted (postReconcile marks them): counted as posted
  async settle(cid){
    const b = typeof B === "function" ? B() : null;
    const rows = b && b.cid === cid ? b.rows.filter(r => r.auto && !r.auto.done && (r.state === "sent" || r.state === "intally")) : [];
    const bills = Object.values((D(cid) || {}).entries || {}).filter(e => e.auto && !e.auto.done && e.exportedAt);
    const by = new Map();
    rows.concat(bills).forEach(x => { x.auto.done = true; delete x.auto.failed; if (!by.has(x.auto.run)) by.set(x.auto.run, []); by.get(x.auto.run).push(x.auto.cid); if (!x.state) Store.saveEntry(cid, x); });
    if (rows.length) saveBank({rows: true});
    for (const [run, ids] of by) await this.mark(cid, run, ids, "posted", null);
  },
  ownerWords(cid){ const r = this.rec(CO(cid)); return "auto (rule; set by " + ((r && r.by) || "the owner") + ")"; },
  // the cloud posting a run went in (its entries' ids), when it went through the queue
  jobOf(cid, ids, run){
    if (run && this.runJob && this.runJob[run]) return this.runJob[run];
    try { const m = JSON.parse(lsGet("tdsdesk:cloudpost") || "null"); if (m && m.cid === cid) return m.id; } catch (e){}
    const j = typeof CloudJobs === "object" ? (CloudJobs.list || []).find(j => j.client_id === cid && (CloudJobs.idsOf(j) || []).some(x => ids.includes(x))) : null;
    return j ? j.id : null;
  },

  /* ---------- undo ---------- */
  // pause the rule of a party (bank key|dir, or a supplier key) until a later approval by hand
  pause(co, key, why){
    if (!co || !key) return;
    const who = typeof whoAmI === "function" ? whoAmI() : "";
    Drafts.direct(() => { co.autopostPause = Object.assign({}, co.autopostPause || {}, {[key]: {at: new Date().toISOString(), by: who, why: why || ""}}); Store.saveCompany(co); }, {bypass: true});
  },
  // where an automatic entry is: "hold" (not yet sent), "queued" (in the cloud queue), "tally" (in Tally), "failed"
  where(x){
    if (!x) return "";
    if (x.autoHold && !x.auto) return "hold";
    if (x.state ? (x.state === "sent" || x.state === "intally") : (x.exportedAt || x.tally && x.tally.guid)) return "tally";
    if (x.auto && x.auto.job) return "queued";
    if (x.auto && x.auto.failed) return "failed";
    return "queued";
  },
  undoWords(x){
    const w = this.where(x);
    if (w === "hold") return "Takes it out of the hold: nothing was sent.";
    if (w === "queued") return "Removes it from the queue (nothing reached Tally).";
    if (w === "failed") return "Puts it back as waiting for you.";
    const t = x.tally || {};
    return "Deletes " + (t.vchType || "the voucher") + " " + (x.tallyVchNo || t.number || t.masterId || "") + " from Tally (this computer’s bridge)" + (x.state ? "" : "; the bill goes back to To review");
  },
  // undo one entry: x a bank row or a bill. Returns {ok, why}
  async undo(cid, x, opts){
    opts = opts || {};
    const co = CO(cid);
    if (!this.may(co, "undo")) return {ok: false, why: "Only the firm’s owner may undo an automatic entry here (Settings → Post automatically)."};
    const bank = !!x.state, a = x.auto || x.autoHold || {}, w = this.where(x);
    const key = bank ? a.key + "|" + a.dir : a.key;
    if (w === "tally"){
      if (bank ? false : x.paidBy) return {ok: false, why: "A later bank line pays this bill; take that back first."};
      if (!(x.tally && x.tally.guid)) return {ok: false, why: "This entry was posted without Tally’s identity, so it has to be deleted in Tally by hand."};
      if (!(typeof bridgeLive === "function" && bridgeLive(co))){
        x.auto = Object.assign({}, x.auto, {undoWanted: {by: whoAmI(), at: new Date().toISOString()}});
        if (bank) saveBank({rows: true}); else Store.saveEntry(cid, x);
        return {ok: false, marked: true, why: "It is in Tally. It can be taken back only on the Tally computer (" + ((typeof tallyPcLabel === "function" && x.tally && x.tally.pc) || "where FinCom Bridge runs") + "), or deleted in Tally by hand. Marked for undo there."};
      }
      const done = opts.noAsk ? await this.unpostQuiet(bank ? "bank" : "bill", x, cid) : await unpostFromTally(bank ? "bank" : "bill", x, cid);
      if (!done) return {ok: false, why: "Tally did not remove it."};
    }
    const job = w === "queued" ? (x.auto && x.auto.job) || this.jobOf(cid, [x.id], a.run) : null;
    if (job && typeof TCloud === "object"){
      try { await TCloud.rpc("tally_post_cancel", {p_id: job}); } catch (e){ /* finished meanwhile: then it is in Tally */ }
    }
    const at = new Date().toISOString(), who = typeof whoAmI === "function" ? whoAmI() : "";
    if (bank){
      const p = x.autoPrev || {};
      Object.assign(x, {state: ["attention", "suggested"].includes(p.state) ? p.state : (x.ledger ? "suggested" : "attention"), ledger: p.ledger != null ? p.ledger : x.ledger, source: p.source || "", why: p.why || "", level: p.level || "", srcLabel: p.srcLabel || "",
        vtype: p.vtype || x.vtype, billId: p.billId || null, billRef: p.billRef || "", tdsAtPay: p.tdsAtPay || 0, tdsLedger: p.tdsLedger || "", userSet: false, sentAt: "", postVerified: false, postByReply: false, tally: null, postError: ""});
      if (S.bank && S.bank.postedTags) delete S.bank.postedTags[fpHash(x.fp || x.id)];
      x.autoUndone = {at, by: who, was: x.auto || x.autoHold || null};
      delete x.auto; delete x.autoHold; delete x.autoPrev;
      saveBank({rows: true, posted: true});
    } else {
      if (x.status === "approved"){ x.exportedAt = null; x.postVerified = false; x.tally = null; x.tallyVchNo = ""; x.postNote = ""; unapply(x, cid); }
      x.autoUndone = {at, by: who, was: x.auto || x.autoHold || null};
      delete x.auto; delete x.autoHold; Store.saveEntry(cid, x);
      if (typeof refreshStats === "function") refreshStats(cid);
    }
    if (a.cid) await this.mark(cid, a.run, [a.cid], "undone", null);
    this.pause(co, key, "undone");
    if (typeof logPosting === "function" && w !== "hold") logPosting({what: bank ? "bank" : "bill", id: x.id, action: "auto undone", co: cid, ref: a.label || "", amount: a.amt || 0, by: who});
    // the rest of a cancelled queued posting goes again under a new posting: by the run itself while it still waits on
    // the posting, else here
    if (job && !opts.whole){ if (this.inRun === a.run){ this.requeueRun = this.requeueRun || {}; this.requeueRun[a.run] = true; } else await this.requeue(cid, a.run, x.id); }
    return {ok: true, words: "Undone: " + (a.label || "the entry") + " " + money0(a.amt || 0).replace(/\.00$/, "") + (w === "tally" ? " deleted from Tally" : w === "queued" ? " taken off the queue" : "") + " · back in “Waiting for me” · rule paused"};
  },
  async unpostQuiet(what, obj, cid){
    const co = CO(cid), t = obj.tally || {};
    try {
      const tname = typeof tallyCoName === "function" ? tallyCoName(co) : co.tallyName;
      const j = await Bridge.call("/unpost", {company: t.company || tname, guid: t.guid, vchType: t.vchType, vchDate: t.vchDate}, 120000);
      if (!j || j.ok === false) return false;
      logPosting({what, id: obj.id, action: "removed", co: cid, tally: t, by: whoAmI()});
      return true;
    } catch (e){ return false; }
  },
  async requeue(cid, run, exceptId){
    const b = B(), rows = b && b.cid === cid ? b.rows.filter(r => r.auto && r.auto.run === run && r.id !== exceptId && r.state === "ready") : [];
    if (rows.length){ rows.forEach(r => { delete r.auto.job; }); await postBankToTally(rows.map(r => r.id)); rows.forEach(r => { if (r.state !== "sent") r.auto.job = this.jobOf(cid, [r.id]); }); saveBank({rows: true}); }
    const bills = Object.values(D(cid).entries).filter(e => e.auto && e.auto.run === run && e.id !== exceptId && e.status === "approved" && !e.exportedAt);
    if (bills.length) await postBillsToTally({ids: bills.map(e => e.id)});
  },
  // the whole run: every entry of it, the queued first (one cancel), then those in Tally
  async undoRun(cid, run){
    const xs = this.runEntries(cid, run).filter(x => x.auto || x.autoHold);
    if (!xs.length) return {ok: false, why: "Nothing of this run is left to undo."};
    const out = {ok: true, n: 0, refused: []};
    const order = xs.sort((a, b) => (this.where(a) === "tally") - (this.where(b) === "tally"));
    for (const x of order){ const r = await this.undo(cid, x, {whole: true, noAsk: true}); if (r.ok) out.n++; else out.refused.push(r.why); }
    out.words = out.n + " undone" + (out.refused.length ? ", " + out.refused.length + " not: " + out.refused[0] : "");
    return out;
  },
  runEntries(cid, run){
    const b = typeof B === "function" ? B() : null;
    const rows = b && b.cid === cid ? b.rows.filter(r => (r.auto && r.auto.run === run)) : [];
    const bills = Object.values((D(cid) || {}).entries || {}).filter(e => e.auto && e.auto.run === run);
    return rows.concat(bills);
  },
  // the runs of a client, newest first: [{run, at, entries, bank, bills, inTally, queued, held, total}]
  runs(cid){
    const b = typeof B === "function" ? B() : null, by = new Map();
    const add = (x, kind) => { const a = x.auto; if (!a || !a.run) return; if (!by.has(a.run)) by.set(a.run, {run: a.run, at: a.at, entries: [], bank: 0, bills: 0, inTally: 0, queued: 0, failed: 0, total: 0});
      const g = by.get(a.run); g.entries.push(x); g[kind]++; g.total += num(a.amt); const w = this.where(x); if (w === "tally") g.inTally++; else if (w === "failed") g.failed++; else g.queued++; if (a.at < g.at) g.at = a.at; };
    if (b && b.cid === cid) b.rows.forEach(r => add(r, "bank"));
    Object.values((D(cid) || {}).entries || {}).forEach(e => add(e, "bills"));
    return [...by.values()].sort((a, c) => String(c.at).localeCompare(String(a.at)));
  },
  // today's figures for Today and the bell (this browser's record, and the cloud's for the firm when signed in)
  today(cids){
    const day = istDay(Date.now()), want = cids ? new Set(cids) : null;
    const l = (this.cloudToday && this.cloudToday.day === day ? this.cloudToday.rows : this.log()).filter(x => x.day === day && (!want || want.has(x.cid)) && ["posted", "queued", "claimed"].includes(x.status));
    const by = {};
    l.forEach(x => { const c = by[x.cid] = by[x.cid] || {n: 0, bank: 0, bills: 0, amt: 0, queued: 0}; c.n++; c[x.kind === "bill" ? "bills" : "bank"]++; c.amt += num(x.amt); if (x.status !== "posted") c.queued++; });
    return {day, by, n: l.length, amt: l.reduce((a, x) => a + num(x.amt), 0), queued: l.filter(x => x.status !== "posted").length};
  },
  async loadCloudToday(){
    if (!(typeof Cloud === "object" && Cloud.on() && Cloud.st && Cloud.st.firm)) return;
    const day = istDay(Date.now());
    if (this.cloudToday && this.cloudToday.day === day && Date.now() - this.cloudToday.at < 60000) return;
    try {
      const rows = await Cloud.api("autopost_claims?select=entry_id,client_id,run_id,kind,amount,rule,status,day,claimed_at&day=eq." + day + "&firm_id=eq." + Cloud.st.firm);
      this.cloudToday = {day, at: Date.now(), rows: [].concat(rows || []).map(r => ({id: r.entry_id, cid: r.client_id, run: r.run_id, kind: r.kind, amt: num(r.amount), rule: r.rule, status: r.status, day: r.day, at: r.claimed_at}))};
    } catch (e){ this.cloudToday = {day, at: Date.now(), rows: this.log()}; }
  }
};
if (typeof globalThis === "object") Object.assign(globalThis, {AutoPost});
/* @react-lazy: end */
