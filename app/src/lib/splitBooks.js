// next-split-years (11-Nov-2026; the owner: a SPLIT Tally, the same business's books cut into two Tally companies by date,
// is ONE client whose books cover every year). Migration 161 links a client's earlier-years company beside its current one
// (tally_split_links: the earlier company's book and the day its years end). Loaded by TCloud.load (src/js/49) through
// window.loadSplit (main.jsx) only for a client that has one; nothing here runs for any other client.
// The join (one set of books, so Reports, GST, TDS and MIS need no change):
//   - entries: the earlier company's up to its end day, the current company's all; a day both companies hold entries on
//     (an overlap), and every day from the current company's start, is the current company's alone: no entry twice. An
//     earlier entry's id is "early:" + its GUID (the two companies share Tally's company GUID, so their entries' GUIDs may
//     meet); its ledgers named as the current company names them when the app's ledger key (ledKey) is the same;
//   - balances: the books start where the earlier company starts, on its openings (as one company holding every year);
//   - the check: the current company's openings against the earlier company's closing balances on the day before the
//     current company starts (income and expense ledgers carried to Profit & Loss A/c, as Tally carries them): "Matched",
//     or "Differs by Rs X in N ledgers" with each ledger. Never silently picked: where they differ, the current company's
//     openings stand from its first day (b.tb.step, read by Audit.balances), so its years show exactly what it holds;
//   - undone (unjoin) when the earlier company is unlinked: the client's books are the current company's alone again.
const G = globalThis;
const R2 = (x) => (typeof G.r2 === "function" ? G.r2(x) : Math.round((Number(x) || 0) * 100) / 100);
const N = (x) => (typeof G.num === "function" ? G.num(x) : Number(x) || 0);
const KEY = (n) => (typeof G.ledKey === "function" ? G.ledKey(n) : String(n || "").trim().toLowerCase());
const PL = "Profit & Loss A/c";
export const EARLY = "early:";
export const isEarly = (v) => !!(v && typeof v.id === "string" && v.id.startsWith(EARLY));
export const d8 = (x) => String(x || "").replace(/-/g, "").slice(0, 8);
export function dayBefore(d) {
  const s = d8(d); if (s.length !== 8) return "";
  const t = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) - 1));
  return t.toISOString().slice(0, 10).replace(/-/g, "");
}
// the last day the earlier company's entries are taken for: its end day, else the day before the current company starts
export function cutOf(ends, curFrom) {
  const e = d8(ends), c = curFrom ? dayBefore(curFrom) : "";
  return c && (!e || c < e) ? c : e;
}
// the earlier company's ledger names that the current company names otherwise (the same ledKey): early name -> current
export function renames(curNames, earlyNames) {
  const by = new Map(); [...curNames].forEach((n) => { const k = KEY(n); if (k && !by.has(k)) by.set(k, n); });
  const out = new Map();
  [...earlyNames].forEach((n) => { const c = by.get(KEY(n)); if (c && c !== n) out.set(n, c); });
  return out;
}
const nameOf = (m, n) => (m.has(n) ? m.get(n) : n);
// an earlier entry as the joined books keep it (a copy: the earlier books are never changed)
export function earlyEntry(v, m) {
  const id = String(v.id || "");
  return Object.assign({}, v, { id: id.startsWith(EARLY) ? id : EARLY + id, party: v.party ? nameOf(m, v.party) : v.party,
    ent: (v.ent || []).map((e) => (m.has(e.l) ? Object.assign({}, e, { l: m.get(e.l) }) : e)) });
}
// the earlier books as the joined books hold them: its entries (back to their own ids), its kept state
export function earlyBack(b) {
  const sp = (b.meta || {}).split || {}, kept = sp.eb || {};
  const vouchers = (b.vouchers || []).filter(isEarly).map((v) => Object.assign({}, v, { id: v.id.slice(EARLY.length) }));
  const meta = vouchers.length === (sp.n || 0) && kept.tb ? JSON.parse(JSON.stringify(kept.meta || {})) : {};   // (entries lost: read again in full)
  return { cid: b.cid, vouchers, meta, tb: kept.tb || null, under: Object.assign({}, kept.under || {}), groups: Object.assign({}, kept.groups || {}), map: {} };
}
// each ledger's balance at the end of day `cut` from the earlier books (its openings and entries), in the joined names
export function closingAt(eb, cut, m) {
  const bal = {};
  Object.entries((eb.tb && eb.tb.led) || {}).forEach(([n, x]) => { const k = nameOf(m, n); bal[k] = R2((bal[k] || 0) + N(x.open)); });
  (eb.vouchers || []).forEach((v) => { if (!v || v.opt || v.cancel || !(String(v.date) <= cut)) return; (v.ent || []).forEach((e) => { const k = nameOf(m, e.l); bal[k] = R2((bal[k] || 0) + N(e.a)); }); });
  return bal;
}
// at the start of a financial year income and expense ledgers open at nil, their total in Profit & Loss A/c (as Tally,
// and TallyRead.yearOpen); nominal(name): true for an income or expense ledger
export function carried(bal, nominal) {
  const out = Object.assign({}, bal); let moved = 0;
  Object.keys(out).forEach((n) => { if (n !== PL && nominal(n) && N(out[n])) { moved = R2(moved + N(out[n])); out[n] = 0; } });
  if (moved) out[PL] = R2(N(out[PL]) + moved);
  return out;
}
// the check: the current company's openings against what the earlier company carries to that day. {matched, n, total,
// net, list: [[ledger, current, carried, difference]] (largest first), on (the current company's first day)}
export function openingsCheck(curOpen, expected, on) {
  const names = new Set([...Object.keys(curOpen), ...Object.keys(expected)]), list = [];
  names.forEach((n) => { const c = R2(curOpen[n] || 0), e = R2(expected[n] || 0), d = R2(c - e); if (Math.abs(d) >= 0.01) list.push([n, c, e, d]); });
  list.sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]) || a[0].localeCompare(b[0]));
  const total = R2(list.reduce((s, x) => s + Math.abs(x[3]), 0)), net = R2(list.reduce((s, x) => s + x[3], 0));
  const all = {}; list.forEach(([n, , , d]) => { all[n] = d; });
  return { matched: !list.length, n: list.length, total, net, list: list.slice(0, 500), on, all };
}
const rupees = (x) => "₹" + Math.abs(R2(x)).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export function checkWords(ck) {
  if (!ck) return "";
  return ck.matched ? "Matched" : "Differs by " + rupees(ck.total) + " in " + ck.n + (ck.n === 1 ? " ledger" : " ledgers");
}
// the current company's books and the earlier company's joined into b (in place). cur: the current books' balances
// (b.tb as the current company's own: {from, to, led}); eb: the earlier books ({vouchers, tb, under, groups, meta});
// sp: {book, company, ends, curFrom, curCompany}; o.nominal(name, under, groups): an income or expense ledger
export function join(b, eb, sp, o) {
  o = o || {};
  const meta = b.meta = b.meta || {}, was = meta.split && meta.split.book === sp.book ? meta.split : null;
  const curTb = b.tb && !b.tb.split ? b.tb : was && was.curTb ? Object.assign({}, was.curTb, { to: [String(was.curTb.to || ""), String((b.tb || {}).to || "")].sort().pop() }) : b.tb;
  if (!curTb || !eb || !eb.tb) return null;
  const curFrom = d8(sp.curFrom || curTb.from), cut = cutOf(sp.ends, curFrom);
  // the current company's own entries (the earlier ones taken out, then put back from eb)
  const mine = (b.vouchers || []).filter((v) => !isEarly(v));
  const curDays = new Set(mine.map((v) => String(v.date)));
  const curNames = new Set([...Object.keys(curTb.led || {}), ...Object.keys(b.under || {})]);
  mine.forEach((v) => (v.ent || []).forEach((e) => curNames.add(e.l)));
  const earlyNames = new Set([...Object.keys(eb.tb.led || {}), ...Object.keys(eb.under || {})]);
  (eb.vouchers || []).forEach((v) => (v.ent || []).forEach((e) => earlyNames.add(e.l)));
  const m = renames(curNames, earlyNames);
  const early = (eb.vouchers || []).filter((v) => v && String(v.date) <= cut && !curDays.has(String(v.date))).map((v) => earlyEntry(v, m));
  // the groups: the current company's first, the earlier company's for its own ledgers (what was added is kept, to undo)
  const added = { under: [], groups: [] };
  b.under = b.under || {}; b.groups = b.groups || {};
  if (was && was.added) { (was.added.under || []).forEach((n) => { if (!curTb.led || !curTb.led[n]) delete b.under[n]; }); (was.added.groups || []).forEach((n) => delete b.groups[n]); }
  Object.entries(eb.under || {}).forEach(([n, p]) => { const k = nameOf(m, n); if (!b.under[k] && p) { b.under[k] = p; added.under.push(k); } });
  Object.entries(eb.groups || {}).forEach(([n, p]) => { if (!(n in b.groups)) { b.groups[n] = p; added.groups.push(n); } });
  // the check, on the day the current company starts
  const nominal = (n) => !!o.nominal && o.nominal(n);
  const expected = carried(closingAt(eb, cut, m), nominal);
  const curOpen = {}; Object.entries(curTb.led || {}).forEach(([n, x]) => { curOpen[n] = N(x.open); });
  const ck = openingsCheck(curOpen, expected, curFrom);
  // the joined balances: the earlier company's openings on its first day; every ledger of either
  const led = {};
  Object.entries(eb.tb.led || {}).forEach(([n, x]) => { const k = nameOf(m, n), had = led[k];
    led[k] = { open: R2((had ? had.open : 0) + N(x.open)), close: 0, parent: (curTb.led && curTb.led[k] && curTb.led[k].parent) || (had && had.parent) || x.parent || "" }; });
  Object.entries(curTb.led || {}).forEach(([n, x]) => { if (!led[n]) led[n] = { open: 0, close: 0, parent: x.parent || "" }; });
  Object.values(led).forEach((x) => { x.openSent = x.open; });
  const tb = { from: eb.tb.from, to: curTb.to, at: curTb.at || eb.tb.at, src: curTb.src || "copy", line: curTb.line, led, split: sp.book };
  // differs: the current company's openings stand from its first day (never the earlier company's, never silently)
  if (!ck.matched) tb.step = { from: curFrom, led: ck.all };
  b.vouchers = early.concat(mine).sort((a, c) => (String(a.date) < String(c.date) ? -1 : String(a.date) > String(c.date) ? 1 : 0));
  b.tb = tb;
  meta.split = { book: sp.book, company: sp.company || "", ends: d8(sp.ends), cut, curFrom, curCompany: sp.curCompany || "", n: early.length, at: new Date().toISOString(),
    curTb, eb: { meta: eb.meta || {}, tb: eb.tb, under: eb.under || {}, groups: eb.groups || {} }, added, check: Object.assign({}, ck, { all: undefined }),
    renamed: m.size, dropped: (eb.vouchers || []).length - early.length };
  return meta.split;
}
// the earlier company unlinked: the client's books are the current company's alone again
export function unjoin(b) {
  const sp = b && b.meta && b.meta.split;
  if (!sp) return false;
  b.vouchers = (b.vouchers || []).filter((v) => !isEarly(v));
  if (sp.curTb && b.tb && b.tb.split) b.tb = sp.curTb;
  else if (b.tb && b.tb.split) { delete b.tb.split; delete b.tb.step; }
  ((sp.added || {}).under || []).forEach((n) => { if (!(b.tb && b.tb.led && b.tb.led[n])) delete (b.under || {})[n]; });
  ((sp.added || {}).groups || []).forEach((n) => { delete (b.groups || {})[n]; });
  delete b.meta.split;
  return true;
}
// a balance from the joined books: the opening differences added from the current company's first day (as Audit.balances,
// src/js/06, adds them)
export function stepped(bal, step, start, d) {
  if (!step || !step.led || !(String(start) < String(step.from)) || !(String(d) >= String(step.from))) return bal;
  const out = Object.assign({}, bal);
  Object.entries(step.led).forEach(([n, x]) => { out[n] = R2((out[n] || 0) + N(x)); });
  return out;
}

// ---------- in the app: TCloud.load's step for a client with an earlier-years company (src/js/49)
// sp: tally_split_of's answer; bk: its book as tally_status lists it. Returns "joined" | "unjoined" | "" (nothing to do)
export const Split = {
  busy: {},
  async run(b, co, sp, bk) {
    const T = G.TCloud;
    if (!b || !co || !T) return "";
    if (!sp || !sp.live) { if (unjoin(b)) { await this.after(b, "unjoined"); return "unjoined"; } return ""; }
    if (!bk || !bk.from || this.busy[co.id]) return "";
    if (bk.entries > T.BIG) { b.meta = b.meta || {}; b.meta.splitNote = "big"; return ""; }
    this.busy[co.id] = true;
    try {
      const eb = earlyBack(b);
      const r = await T.loadNow(true, false, { b: eb, co, gate: () => null, bk, nosave: true, par: 8 });
      if (r === "big" || !eb.tb) return "";
      const nominal = (n) => { const TR = G.TallyRead; if (!TR) return false; const set = new Set(TR.NOMINAL.map((x) => x.toLowerCase()));
        const pb = { under: Object.assign({}, eb.under || {}, b.under || {}), groups: Object.assign({}, eb.groups || {}, b.groups || {}) };
        return set.has(String(TR.primaryOf(pb, n) || "").trim().toLowerCase()); };
      const was = b.meta && b.meta.split, sig = (x) => x && [x.book, x.ends, x.n, (x.check || {}).total, x.curTb && x.curTb.to].join("|");
      const before = sig(was), tbWas = b.tb && b.tb.split ? b.tb : null;
      const done = join(b, eb, { book: sp.book, company: sp.company, ends: sp.ends, curFrom: sp.curFrom, curCompany: sp.currentCompany }, { nominal });
      if (!done) return "";
      if (before === sig(done) && r === true && tbWas) return "";
      await this.after(b, "joined");
      return "joined";
    } finally { delete this.busy[co.id]; }
  },
  async after(b, why) {
    try { if (G.Books && G.Books.mapLedgers) b.map = G.Books.mapLedgers(b.vouchers || [], b.map); } catch (e) { /* as before */ }
    try { if (G.TallyRead) G.TallyRead.after(b, why === "joined" ? "after the earlier years came in" : "after the earlier years were unlinked"); } catch (e) { /* as before */ }
    if (G.LK) G.LK.cache = {};
    if (typeof G.saveBooks === "function") await G.saveBooks({ fromCloud: true }, b);
    if (typeof G.render === "function" && G.S && G.S.books === b) G.render();
  },
  words: checkWords,
};
if (typeof G === "object") G.SplitBooks = { Split, stepped, checkWords, isEarly };
