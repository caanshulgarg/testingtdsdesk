/* @react-lazy: begin 96-bank-overlap.js (the React app loads this file with the Bank screen, and an upload loads it first: app/src/screens/Bank.jsx, app/src/lib/bankOverlap.js through window.loadBankOverlap, app/src/main.jsx; build.py react_parts) */
/* ================================================================== */
/* A statement that overlaps one already here (owner-approved design,  */
/* next-bank-overlap, 08-Nov-2026)                                     */
/* ================================================================== */
// April uploaded, then a file of April and May: the April lines are already here, so only May is added, and that is said
// plainly ("April already uploaded (31 entries kept as they are). Only May added (28 entries)."). The new statement is
// labelled with the dates it really holds, and its opening, closing and totals are those of its own lines.
// A line whose fingerprint is here (src/js/22 bankNewRows) is skipped, as before, and listed (st.dupIds) so it can be
// checked. Against the lines of the same bank account's earlier statements still in the list whose dates overlap, a new
// line that is not exactly the same can still be the same entry (another download of the statement: the narration wrapped
// differently, Excel against PDF):
//   - the same UTR / reference / cheque number and amount within 2 days, or the same date, amount and running balance
//     after it: held aside ("Repeat of <date> entry"), not in the books and never posted until "Keep it" or "It's a repeat";
//   - the same amount within a day, with no reference and no balance to compare: added, marked "Possible repeat — check"
//     (r.rep), and not posted to Tally until confirmed (bankGoneAsk, app/src/parts/bank/goneSent.js; the Tally file,
//     bankExportProblems below; automatic posting, src/js/90);
// a line marked "It's a repeat" is kept aside, never deleted, and can be brought back.
// Review of 08-Nov-2026: held lines and repeats stay among the statement's lines, in their place (b.rows is synced to the
// firm account in parts by position: a line taken out or put in would shift the parts other computers hold), state
// "ignored" with the mark r.rep (bankAside, src/js/22): the line itself says what it is, and older versions of the app
// see an ignored line (never posted, not in To do). Out of the tabs, the totals, the suggestions and Tally matching.
// A reference counts only when it can name one entry: a UTR (four letters and digits) or a 12-digit UPI / IMPS number, a
// cheque number (compared as a number, 4 digits or more); never words ("TRANSFER TO 1234…"), never a number shaped like an
// account number, never one that is on two lines of the same file or of the earlier statements (a beneficiary's account,
// a loan number, a fixed column text). The nearest date wins.
// The join check: a statement's opening against the closing of the same account's statement before it, and missing days.
// Each earlier line is matched once (occurrence by occurrence). Kept with the statement record (bank_stmt) and its rows
// (bank_rows), as before: new fields only.
const BankOverlap = (() => {
  const MN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // a value that can name one entry: "U:<UTR>" or "C:<cheque number>", or "" (see above)
  function refKey(v, chq){
    const t = String(v || "").trim().toUpperCase();
    if (!t || /\s/.test(t)) return "";
    const c = t.replace(/[^A-Z0-9]/g, "");
    if (/^\d+$/.test(c)){
      if (chq || c.length <= 8) return c.length >= 4 && c.length <= 8 && +c > 0 ? "C:" + +c : "";
      return c.length === 12 ? "U:" + c : "";
    }
    return /^[A-Z]{4}[RNH0-9][0-9A-Z]{9,17}$/.test(c) && (c.match(/\d/g) || []).length >= 4 ? "U:" + c : "";
  }
  const refsAll = r => [...new Set([refKey((r.dec || {}).utr), refKey((r.dec || {}).chq, true), refKey(r.ref)].filter(Boolean))];
  // the references of a line that can name it: not the account's own number, not on two lines of one file / statement
  let many = new Set(), own = "";
  const refsOf = r => refsAll(r).filter(x => !many.has(x) && !(own && x.slice(2) && (own.endsWith(x.slice(2)) || x.slice(2).endsWith(own))));
  function manyOf(lists){
    const out = new Set();
    lists.forEach(list => { const n = {}; list.forEach(r => refsAll(r).forEach(x => { n[x] = (n[x] || 0) + 1; })); Object.keys(n).forEach(x => { if (n[x] > 1) out.add(x); }); });
    return out;
  }
  const refWords = x => (x[0] === "C" ? "cheque " : "reference ") + x.slice(2);
  const hasBal = r => r.balance !== null && r.balance !== undefined && r.balance !== "";
  const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 864e5);
  const amtOf = r => r2(num(r.debit) || num(r.credit));
  const sameAmt = (a, b) => !!a.debit === !!b.debit && Math.abs(amtOf(a) - amtOf(b)) <= 0.005;
  const andList = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  // "April", "April and May 2026", "March to June 2026", "December 2025 and January 2026"
  function monthsWords(ms){
    const ys = new Set(ms.map(m => m.slice(0, 4))), nm = m => MN[+m.slice(5, 7) - 1] + (ys.size > 1 ? " " + m.slice(0, 4) : "");
    const seq = ms.length > 2 && ms.every((m, i) => !i || (+m.slice(0, 4) * 12 + +m.slice(5, 7)) - (+ms[i - 1].slice(0, 4) * 12 + +ms[i - 1].slice(5, 7)) === 1);
    return (seq ? nm(ms[0]) + " to " + nm(ms[ms.length - 1]) : andList(ms.map(nm))) + (ys.size === 1 ? " " + [...ys][0] : "");
  }
  const monthsOf = dates => [...new Set(dates.map(d => String(d).slice(0, 7)))].sort();
  const span = dates => { const s = dates.slice().sort(); return s[0] === s[s.length - 1] ? fmtDate(s[0]) : fmtDate(s[0]) + " to " + fmtDate(s[s.length - 1]); };
  // the words for the two sets of dates: months when no month is in both, else the dates
  function periodWords(a, b){
    const ma = monthsOf(a), mb = monthsOf(b);
    return ma.some(m => mb.includes(m)) ? [span(a), span(b)] : [monthsWords(ma), monthsWords(mb)];
  }
  // a statement's own figures, from the lines it holds (all: the file's lines in order, when known)
  function figures(rows, all, meta){
    const s = rows.slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    const f = s[0], l = s[s.length - 1], out = {n: rows.length, from: f && f.date, to: l && l.date};
    out.totDr = r2(rows.reduce((a, r) => a + num(r.debit), 0)); out.totCr = r2(rows.reduce((a, r) => a + num(r.credit), 0));
    if (f){
      const j = all ? all.indexOf(f) : -1, p = j > 0 ? all[j - 1] : null;
      out.opening = hasBal(f) ? r2(num(f.balance) + num(f.debit) - num(f.credit)) : p && hasBal(p) ? num(p.balance) : j === 0 && meta ? meta.opening : undefined;
      out.closing = hasBal(l) ? num(l.balance) : all && all[all.length - 1] === l && meta ? meta.closing : undefined;
    }
    out.summaryOk = out.opening !== undefined && out.closing !== undefined ? Math.abs(r2(out.opening - out.totDr + out.totCr) - out.closing) <= 0.011 : null;
    return out;
  }
  async function rowsOf(cid, sid){
    const b = B();
    if (b && b.cid === cid && b.cur === sid) return b.rows;
    return (await BankDB.get("stmt:" + cid + ":" + sid)) || [];
  }
  // the near-match of a new line among earlier lines not yet matched: {e, kind, why} or null
  // strong: the same reference and amount within 2 days (the nearest date), or the same date, amount and balance after it
  function nearOf(r, pool, used){
    const rr = refsOf(r);
    let strong = null, sGap = 9, weak = null, gap = 9;
    for (const e of pool){
      if (used.has(e) || !sameAmt(r, e)) continue;
      const er = refsOf(e), d = days(r.date, e.date), x = rr.find(y => er.includes(y));
      if (x && d <= 2 && d < sGap){ strong = {e, kind: "strong", why: "same " + refWords(x) + " and amount" + (d ? ", " + (d === 1 ? "a day" : d + " days") + " apart" : "")}; sGap = d; continue; }
      if (r.date === e.date && hasBal(r) && hasBal(e) && Math.abs(num(r.balance) - num(e.balance)) <= 0.01 && d < sGap){ strong = {e, kind: "strong", why: "same date, amount and balance after it"}; sGap = d; continue; }
      if (d <= 1 && !(rr.length && er.length) && !(hasBal(r) && hasBal(e)) && d < gap){ weak = {e, kind: "weak", why: "same amount " + (d ? "a day apart" : "on the same date") + "; no reference or balance to compare"}; gap = d; }
    }
    return strong || weak;
  }
  const lineOf = r => ({id: r.id, date: r.date, narr: r.narr, debit: r.debit, credit: r.credit, balance: r.balance});
  // an upload: the lines to add, the record of the statement and what to say. ctx: {cid, keys, stmts}
  async function take(parsed, acc, ctx, sid, name, chk, file, hash){
    const all = parsed.rows, meta = parsed.meta || {};
    const x = bankNewRows(all, acc, ctx.keys, ctx.stmts, sid, name), skipped = all.filter(r => !r.id);
    const dates = all.map(r => r.date).filter(Boolean).sort(), lo = dates[0], hi = dates[dates.length - 1];
    // the earlier lines: the statements holding the skipped lines, and the same account's statements whose dates overlap
    const want = new Set(skipped.map(r => ctx.keys[r.fp]).filter(Boolean));
    ctx.stmts.forEach(s => { if (s.acctId === acc.id && s.from && s.to && !(s.to < lo && days(s.to, lo) > 2) && !(s.from > hi && days(s.from, hi) > 2)) want.add(s.id); });
    const earlier = [], pool = [], lists = [all], near = e => e && e.id && e.date && !bankAside(e) && !(e.date < lo && days(e.date, lo) > 2) && !(e.date > hi && days(e.date, hi) > 2);
    for (const s of ctx.stmts) if (want.has(s.id)){ const l = await rowsOf(ctx.cid, s.id); lists.push(l); l.forEach(e => { earlier.push(e); if (s.acctId === acc.id && near(e)) pool.push(e); }); }
    many = manyOf(lists); own = String(acc.acct || "").replace(/\D/g, "").replace(/^0+/, "");
    const byFp = new Map(), used = new Set(), dupIds = [];
    earlier.forEach(e => { if (e && e.fp && !byFp.has(e.fp)) byFp.set(e.fp, e); });
    skipped.forEach(r => { const e = byFp.get(r.fp); if (e && !used.has(e)){ used.add(e); dupIds.push(e.id); } });
    // near-matches only among the same account's lines (pool): an earlier statement of another account is never compared
    // a held line stays among the lines (in its place, ignored, marked): its own state says it is held (bankAside)
    const held = [], rows = [];
    let weak = 0;
    x.rows.forEach(r => {
      const m = nearOf(r, pool, used);
      if (m) used.add(m.e);
      if (m && m.kind === "strong"){ held.push(Object.assign(r, {state: "ignored", rep: {kind: "strong", of: m.e.date, ofId: m.e.id, why: m.why}})); return; }
      if (m){ r.rep = {kind: "weak", of: m.e.date, ofId: m.e.id, why: m.why}; weak++; }
      rows.push(r);
    });
    many = new Set(); own = "";
    const cut = rows.length !== all.length, f = figures(rows.length ? rows : held, all, meta);
    const st = {id: sid, fileName: file.name, hash, bank: acc.bank, acctId: acc.id, acct: meta.acct || "", ifsc: meta.ifsc || "",
      from: f.from || meta.from, to: f.to || meta.to, fileFrom: meta.from || lo, fileTo: meta.to || hi, n: rows.length, dupRows: x.dupRows,
      badRows: chk.bad, fixedRows: chk.fixed, source: parsed.source, method: parsed.method || "", uploadedAt: new Date().toISOString()};
    Object.assign(st, cut ? {opening: rows.length ? f.opening : undefined, closing: rows.length ? f.closing : undefined, totDr: rows.length ? f.totDr : 0, totCr: rows.length ? f.totCr : 0, summaryOk: rows.length ? f.summaryOk : null}
      : {opening: meta.opening, closing: meta.closing, totDr: chk.totDr, totCr: chk.totCr, summaryOk: chk.summaryOk});
    if (dupIds.length) st.dupIds = dupIds;
    let say;
    if (x.dupRows){
      const w = periodWords(skipped.map(r => r.date), rows.map(r => r.date));
      st.dupSay = w[0];
      say = w[0] + " already uploaded (" + entries(x.dupRows) + (x.dupRows === 1 ? " kept as it is). " : " kept as they are). ") + (rows.length ? "Only " + w[1] + " added (" + entries(rows.length) + ")." : "Nothing new added.");
    } else say = rows.length + " transactions" + (chk.bad ? ", " + chk.bad + " failing the balance check" : "") + ".";
    if (held.length) say += " " + (held.length === 1 ? "1 entry is" : held.length + " entries are") + " held aside as a repeat of an earlier entry: choose Keep it or It’s a repeat.";
    if (weak) say += " " + (weak === 1 ? "1 entry is" : weak + " entries are") + " marked Possible repeat — check: not posted until you confirm.";
    if (x.dupRows && chk.bad) say += " " + chk.bad + " failing the balance check.";
    // rows: every line of the statement, held ones too (in the file's order); held: how many are held
    return {rows: x.rows, held: held.length, nk: x.nk, top: x.top, st, say};
  }
  /* ---------- after the upload ---------- */
  // the line's own state is what counts (a statement record cannot bring a line back or lose one): bankAside, src/js/22
  const isOpen = r => !!(r && r.rep && r.rep.kind === "weak" && !r.rep.ok && !r.rep.gone && r.state !== "ignored");
  const isHeld = r => bankAside(r) && !r.rep.gone;
  const isRepeat = r => bankAside(r) && !!r.rep.gone;
  const stOf = () => curStmt();
  // a statement's dates and figures again from its lines in the books (not those held or kept aside)
  function refigure(st, all){
    const rows = all.filter(r => !bankAside(r)), f = figures(rows, null, null);
    Object.assign(st, {n: rows.length, totDr: f.totDr, totCr: f.totCr});
    if (rows.length){ st.from = f.from; st.to = f.to; if (f.opening !== undefined) st.opening = f.opening; if (f.closing !== undefined) st.closing = f.closing; }
    st.summaryOk = st.opening !== undefined && st.closing !== undefined ? Math.abs(r2(st.opening - st.totDr + st.totCr) - st.closing) <= 0.011 : null;
    delete st.held; delete st.repeats;
  }
  function done(st, b, why){ refigure(st, b.rows); st.counts = countStates(b.rows); saveBank({rows: true, stmts: true}); toast(why); render(); }
  const now = () => new Date().toISOString();
  // "Keep it": a held line goes into the books, or a marked line is confirmed
  function keep(id){
    const b = B(), st = stOf(); if (!b || !st) return;
    const r = b.rows.find(x => x.id === id);
    if (!r || !r.rep) return;
    if (isOpen(r)){ Object.assign(r.rep, {ok: true, at: now()}); return done(st, b, "Kept: this entry is not a repeat, and can be posted."); }
    if (!isHeld(r)) return;
    r.rep = Object.assign({}, r.rep, {ok: true, at: now()});
    Object.assign(r, {state: "attention", ledger: "", userSet: false}); delete r.prevState;
    suggestAll([r]);
    const acc = (CO(b.cid).bankAccounts || []).find(a => a.id === st.acctId);
    if (acc) matchTallyBook(acc, b.rows);
    done(st, b, "Kept: the entry of " + fmtDate(r.date) + " is added to this statement.");
  }
  // "It's a repeat": kept aside (never deleted, never taken out of the lines), out of the books
  function repeat(id){
    const b = B(), st = stOf(); if (!b || !st) return;
    const r = b.rows.find(x => x.id === id);
    if (!r || !r.rep || !(isHeld(r) || isOpen(r))) return;
    if (!isHeld(r)) r.prevState = r.state;
    r.rep = Object.assign({}, r.rep, {gone: now()}); delete r.rep.ok;
    r.state = "ignored"; b.sel.delete(id); if (b.drawer === id) b.drawer = null;
    done(st, b, "Kept aside as a repeat of the entry of " + fmtDate(r.rep.of) + ". Bring it back from the list of repeats at any time.");
  }
  // "Bring back": a repeat kept aside is held again, to choose
  function back(id){
    const b = B(), st = stOf(); if (!b || !st) return;
    const r = b.rows.find(x => x.id === id);
    if (!isRepeat(r)) return;
    r.rep = {kind: "strong", of: r.rep.of, ofId: r.rep.ofId, why: r.rep.why};
    done(st, b, "Brought back: choose Keep it or It’s a repeat.");
  }
  // the lines skipped as already uploaded, from the statements still holding them
  async function skipped(st){
    const b = B(), out = [], by = {};
    (st.dupIds || []).forEach(id => { const s = String(id).split("-")[0]; (by[s] = by[s] || []).push(id); });
    for (const s of Object.keys(by)){
      const there = b.stmts.find(x => x.id === s);
      if (!there) continue;
      const rows = await rowsOf(b.cid, s), want = new Set(by[s]);
      rows.forEach(r => { if (want.has(r.id)) out.push(Object.assign(lineOf(r), {state: r.state, ledger: r.ledger, sid: s, stmt: there})); });
    }
    return out;
  }
  // the same account's statement before this one (by date), and how the two join
  function join(stmts, st){
    if (!st || !st.from) return null;
    const prev = stmts.filter(x => x !== st && x.id !== st.id && x.acctId === st.acctId && x.to && x.to <= st.from && x.from < st.from)
      .sort((a, b) => (a.to !== b.to ? (a.to < b.to ? 1 : -1) : String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || ""))))[0];
    if (!prev) return null;
    const out = {prev};
    if (prev.closing !== undefined && prev.closing !== null && st.opening !== undefined && st.opening !== null){
      const d = r2(num(st.opening) - num(prev.closing));
      if (Math.abs(d) > 0.01) out.diff = {amt: Math.abs(d), from: prev.to, to: st.from, words: money(Math.abs(d)) + " difference between " + fmtDate(prev.to) + " and " + fmtDate(st.from)};
    }
    const end = prev.fileTo || prev.to, start = st.fileFrom || st.from, sure = !!(prev.fileTo && st.fileFrom);
    const add = (iso, n) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    if (start > end && days(start, end) > 1 && (sure || out.diff)){ const a = add(end, 1), z = add(start, -1); out.gap = {from: a, to: z, words: "No statement for " + (a === z ? fmtDate(a) : fmtDate(a) + " to " + fmtDate(z))}; }
    return out.diff || out.gap ? out : null;
  }
  return {take, figures, keep, repeat, back, skipped, join, isOpen, isHeld, isRepeat, nearOf, refKey, periodWords};
})();
// the Tally file (src/js/22 exportBankXml): a line marked "Possible repeat — check" waits until it is confirmed
if (typeof bankExportProblems === "function" && !bankExportProblems.bo){
  const bankExportProblems0 = bankExportProblems;
  const bep = function (rows){ const n = (rows || []).filter(BankOverlap.isOpen).length; return (n ? [(n === 1 ? "1 entry is" : n + " entries are") + " marked Possible repeat — check: Keep it or It’s a repeat first"] : []).concat(bankExportProblems0(rows)); };
  bep.bo = 1; globalThis.bankExportProblems = bep;
}
if (typeof globalThis === "object") Object.assign(globalThis, {BankOverlap});
/* @react-lazy: end */
