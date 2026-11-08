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
//   - the same UTR / reference / cheque number and amount, or the same date, amount and running balance after it: held
//     aside (st.held, "Repeat of <date> entry"), not in the books and never posted until "Keep it" or "It's a repeat";
//   - the same amount within a day, with no reference and no balance to compare: added, marked "Possible repeat — check"
//     (r.rep), and not posted to Tally until confirmed (bankGoneAsk, app/src/parts/bank/goneSent.js; the Tally file,
//     bankExportProblems below; automatic posting, src/js/90);
// a line marked "It's a repeat" is kept aside (st.repeats), never deleted, and can be brought back.
// The join check: a statement's opening against the closing of the same account's statement before it, and missing days.
// Each earlier line is matched once (occurrence by occurrence). Kept with the statement record (bank_stmt) and its rows
// (bank_rows), as before: new fields only.
const BankOverlap = (() => {
  const MN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const refOf = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
  const refsOf = r => [...new Set([(r.dec || {}).utr, (r.dec || {}).chq, r.ref].map(refOf).filter(x => x.length >= 6))];
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
  function nearOf(r, pool, used){
    const rr = refsOf(r);
    let weak = null, gap = 9;
    for (const e of pool){
      if (used.has(e) || !sameAmt(r, e)) continue;
      const er = refsOf(e), d = days(r.date, e.date);
      if (rr.length && er.length && rr.some(x => er.includes(x))) return {e, kind: "strong", why: "same reference " + rr.find(x => er.includes(x)) + " and amount"};
      if (r.date === e.date && hasBal(r) && hasBal(e) && Math.abs(num(r.balance) - num(e.balance)) <= 0.01) return {e, kind: "strong", why: "same date, amount and balance after it"};
      if (d <= 1 && !(rr.length && er.length) && !(hasBal(r) && hasBal(e)) && d < gap){ weak = {e, kind: "weak", why: "same amount " + (d ? "a day apart" : "on the same date") + "; no reference or balance to compare"}; gap = d; }
    }
    return weak;
  }
  const lineOf = r => ({id: r.id, date: r.date, narr: r.narr, debit: r.debit, credit: r.credit, balance: r.balance});
  // an upload: the lines to add, the record of the statement and what to say. ctx: {cid, keys, stmts}
  async function take(parsed, acc, ctx, sid, name, chk, file, hash){
    const all = parsed.rows, meta = parsed.meta || {};
    const x = bankNewRows(all, acc, ctx.keys, ctx.stmts, sid, name), skipped = all.filter(r => !r.id);
    const dates = all.map(r => r.date).filter(Boolean).sort(), lo = dates[0], hi = dates[dates.length - 1];
    // the earlier lines: the statements holding the skipped lines, and the same account's statements whose dates overlap
    const want = new Set(skipped.map(r => ctx.keys[r.fp]).filter(Boolean));
    ctx.stmts.forEach(s => { if (s.acctId === acc.id && s.from && s.to && !(s.to < lo && days(s.to, lo) > 1) && !(s.from > hi && days(s.from, hi) > 1)) want.add(s.id); });
    const earlier = [], pool = [], near = e => e && e.id && e.date && !(e.date < lo && days(e.date, lo) > 1) && !(e.date > hi && days(e.date, hi) > 1);
    for (const s of ctx.stmts) if (want.has(s.id)) (await rowsOf(ctx.cid, s.id)).forEach(e => { earlier.push(e); if (s.acctId === acc.id && near(e)) pool.push(e); });
    const byFp = new Map(), used = new Set(), dupIds = [];
    earlier.forEach(e => { if (e && e.fp && !byFp.has(e.fp)) byFp.set(e.fp, e); });
    skipped.forEach(r => { const e = byFp.get(r.fp); if (e && !used.has(e)){ used.add(e); dupIds.push(e.id); } });
    // near-matches only among the same account's lines (pool): an earlier statement of another account is never compared
    const held = [], rows = [];
    let weak = 0;
    x.rows.forEach(r => {
      const m = nearOf(r, pool, used);
      if (m) used.add(m.e);
      if (m && m.kind === "strong"){ delete x.nk[r.fp]; held.push(Object.assign(r, {rep: {kind: "strong", of: m.e.date, ofId: m.e.id, why: m.why}})); return; }
      if (m){ r.rep = {kind: "weak", of: m.e.date, ofId: m.e.id, why: m.why}; weak++; }
      rows.push(r);
    });
    const cut = rows.length !== all.length, f = figures(rows.length ? rows : held, all, meta);
    const st = {id: sid, fileName: file.name, hash, bank: acc.bank, acctId: acc.id, acct: meta.acct || "", ifsc: meta.ifsc || "",
      from: f.from || meta.from, to: f.to || meta.to, fileFrom: meta.from || lo, fileTo: meta.to || hi, n: rows.length, dupRows: x.dupRows,
      badRows: chk.bad, fixedRows: chk.fixed, source: parsed.source, method: parsed.method || "", uploadedAt: new Date().toISOString()};
    Object.assign(st, cut ? {opening: rows.length ? f.opening : undefined, closing: rows.length ? f.closing : undefined, totDr: rows.length ? f.totDr : 0, totCr: rows.length ? f.totCr : 0, summaryOk: rows.length ? f.summaryOk : null}
      : {opening: meta.opening, closing: meta.closing, totDr: chk.totDr, totCr: chk.totCr, summaryOk: chk.summaryOk});
    if (dupIds.length) st.dupIds = dupIds;
    if (held.length) st.held = held;
    let say;
    if (x.dupRows){
      const w = periodWords(skipped.map(r => r.date), rows.map(r => r.date));
      st.dupSay = w[0];
      say = w[0] + " already uploaded (" + entries(x.dupRows) + (x.dupRows === 1 ? " kept as it is). " : " kept as they are). ") + (rows.length ? "Only " + w[1] + " added (" + entries(rows.length) + ")." : "Nothing new added.");
    } else say = rows.length + " transactions" + (chk.bad ? ", " + chk.bad + " failing the balance check" : "") + ".";
    if (held.length) say += " " + (held.length === 1 ? "1 entry is" : held.length + " entries are") + " held aside as a repeat of an earlier entry: choose Keep it or It’s a repeat.";
    if (weak) say += " " + (weak === 1 ? "1 entry is" : weak + " entries are") + " marked Possible repeat — check: not posted until you confirm.";
    if (x.dupRows && chk.bad) say += " " + chk.bad + " failing the balance check.";
    return {rows, nk: x.nk, top: x.top, st, say};
  }
  /* ---------- after the upload ---------- */
  const isOpen = r => !!(r && r.rep && r.rep.kind === "weak" && !r.rep.ok);
  const stOf = () => curStmt();
  // a statement's dates and figures again from its lines (kept, or a repeat put aside)
  function refigure(st, rows){
    const f = figures(rows, null, null);
    Object.assign(st, {n: rows.length, totDr: f.totDr, totCr: f.totCr});
    if (rows.length){ st.from = f.from; st.to = f.to; if (f.opening !== undefined) st.opening = f.opening; if (f.closing !== undefined) st.closing = f.closing; }
    st.summaryOk = st.opening !== undefined && st.closing !== undefined ? Math.abs(r2(st.opening - st.totDr + st.totCr) - st.closing) <= 0.011 : null;
  }
  function done(st, b, why){ refigure(st, b.rows); st.counts = countStates(b.rows); saveBank({rows: true, stmts: true, keys: true}); toast(why); render(); }
  // "Keep it": a held line goes into the books (its place by date), or a marked line is confirmed
  function keep(id){
    const b = B(), st = stOf(); if (!b || !st) return;
    const r = b.rows.find(x => x.id === id);
    if (r && r.rep){ r.rep.ok = true; r.rep.at = new Date().toISOString(); return done(st, b, "Kept: this entry is not a repeat, and can be posted."); }
    const i = (st.held || []).findIndex(x => x.id === id); if (i < 0) return;
    const h = st.held.splice(i, 1)[0];
    h.rep = Object.assign({}, h.rep, {ok: true, at: new Date().toISOString()});
    Object.assign(h, {state: "attention", ledger: "", userSet: false});
    let k = b.rows.findIndex(x => x.date > h.date); if (k < 0) k = b.rows.length;
    b.rows.splice(k, 0, h);
    if (h.fp) b.keys[h.fp] = st.id;
    suggestAll([h]);
    const acc = (CO(b.cid).bankAccounts || []).find(a => a.id === st.acctId);
    if (acc) matchTallyBook(acc, b.rows);
    if (!st.held.length) delete st.held;
    done(st, b, "Kept: the entry of " + fmtDate(h.date) + " is added to this statement.");
  }
  // "It's a repeat": kept aside (never deleted), out of the books
  function repeat(id){
    const b = B(), st = stOf(); if (!b || !st) return;
    let h, i = (st.held || []).findIndex(x => x.id === id);
    if (i >= 0){ h = st.held.splice(i, 1)[0]; if (!st.held.length) delete st.held; }
    else {
      i = b.rows.findIndex(x => x.id === id); if (i < 0 || b.rows[i].state === "sent") return;
      h = b.rows.splice(i, 1)[0]; b.sel.delete(id);
      if (h.fp && b.keys[h.fp] === st.id) delete b.keys[h.fp];
    }
    h.rep = Object.assign({}, h.rep, {gone: new Date().toISOString()});
    (st.repeats = st.repeats || []).push(h);
    done(st, b, "Kept aside as a repeat of the entry of " + fmtDate(h.rep.of) + ". Bring it back from the list of repeats at any time.");
  }
  // "Bring back": a repeat put aside is held again, to choose
  function back(id){
    const b = B(), st = stOf(); if (!b || !st) return;
    const i = (st.repeats || []).findIndex(x => x.id === id); if (i < 0) return;
    const h = st.repeats.splice(i, 1)[0]; if (!st.repeats.length) delete st.repeats;
    h.rep = {kind: "strong", of: h.rep.of, ofId: h.rep.ofId, why: h.rep.why};
    (st.held = st.held || []).push(h);
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
  return {take, figures, keep, repeat, back, skipped, join, isOpen, nearOf, refsOf, periodWords};
})();
// the Tally file (src/js/22 exportBankXml): a line marked "Possible repeat — check" waits until it is confirmed
if (typeof bankExportProblems === "function" && !bankExportProblems.bo){
  const bankExportProblems0 = bankExportProblems;
  const bep = function (rows){ const n = (rows || []).filter(BankOverlap.isOpen).length; return (n ? [(n === 1 ? "1 entry is" : n + " entries are") + " marked Possible repeat — check: Keep it or It’s a repeat first"] : []).concat(bankExportProblems0(rows)); };
  bep.bo = 1; globalThis.bankExportProblems = bep;
}
if (typeof globalThis === "object") Object.assign(globalThis, {BankOverlap});
/* @react-lazy: end */
