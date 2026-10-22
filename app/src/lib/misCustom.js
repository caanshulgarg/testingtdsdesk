// "My MIS" (ROUND 105, B1): the engine that works out a report definition (server/_shared/misdef.js) from a client's books.
// Pure JavaScript: no DOM, no globals, no imports but the definition's own module. Every input is passed in (data, below),
// so the same file can run in the browser (data from app/src/lib/misData.js, the books in this browser) and later in the
// cloud (B6, data from the cloud copy). The AI never gives a figure: it writes a definition; every figure is worked out here.
//
// The figures are the existing MIS's and Financial statements' (tests/run_mis_custom.js checks them to the paisa):
//   - MIS heads and profit lines: MIS.plRule / MIS.pl (src/js/07-mis.js), ported as they are, with the expense set-off
//     rule (an expense head in credit shows nil, the rest in Other income; the set-off in the period's last month);
//   - customers and suppliers: MIS.sales / MIS.purchases (each entry's sale value and customer come in the data);
//   - ratios: MIS.ratios, the same formulas and words; the balance-sheet ratios from FS.place, as MIS places them;
//   - Financial-statement codes: FinSt's trial balance by code (P&L codes the year's movement, balance-sheet codes the
//     closing balance), in each note's sign;
//   - GST by month: MIS.compliance (the GST builders' working, passed in); ageing: MIS.ageing (passed in).
//
// data = {
//   booksFrom, booksTo,                                  YYYYMMDD: the entries held
//   vouchers: [{id, date, no, type, party, narr, ent: [{l, a}], sa, who, pa, pw}]   a: Tally's sign (a credit positive);
//              sa / who: the entry's sales and customer (MIS.sales); pa / pw: its purchases and supplier (MIS.purchases)
//   ledgers: {name: {g: [groups, nearest first], h, s, dc, rev, kind, place: {dr, cr}, code, gp}}
//              h / s: MIS head and P&L line (MIS.plHead); dc: -1 when a debit is its natural side; kind: r (customer),
//              p (supplier), bank, cash, pur (Purchase Accounts) or ""; place: FS.place for a debit / credit balance
//   open: {from, bal: {ledger: Tally's balance before `from`}} | null       the balances the closing figures start from
//   codes: {code: {label, note, side, sign}}                                FinSt.CODES
//   gst: {YYYYMM: {out, itc, rcm, carry, due, pay}} | null                  MIS.compliance(...).gst
//   ageing: {asOn, r: {sum: {nb, und, owe, advance}, rows: [{party, nb, und, owe}]}, p: {...}} | null   MIS.ageing
//   budget: {fy: {head: {YYYYMM: rupees}}}                                  MIS's budget by head (S.books.budget)
// }
import { AGE_BUCKETS, GST_LINES, HEADS, PL_LINES, RATIOS, headLabel, rowKey, UNIT_SHORT } from "../../../server/_shared/misdef.js";

// ---------------------------------------------------------------- numbers
export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const N = (v) => (typeof v === "number" ? (isFinite(v) ? v : 0) : (isFinite(parseFloat(v)) ? parseFloat(v) : 0));
// Excel's ROUND (as FinSt.RND): half away from zero, binary noise cleared first (0.035 -> 0.04, 2.675 -> 2.68)
export const RND = (v, d) => { v = +v || 0; const p = Math.pow(10, d), x = Number((Math.abs(v) * p).toPrecision(15)), r = Math.round(x) / p * Math.sign(v); return r === 0 ? 0 : r; };
export const scale = (v, u) => RND(N(v) / ((u && u.unit) || 1), u && u.dec === 0 ? 0 : 2);
const group3 = (s) => { const last = s.slice(-3), rest = s.slice(0, -3); return (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last; };
// a figure as shown: in the unit, with the decimals, Indian grouping; a ratio is never scaled (%, days, times)
export function fmt(v, u, kind) {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v;
  if (kind === "%") return (Math.round(v * 10) / 10) + "%";
  if (kind === "days") return String(Math.round(v));
  if (kind === "times") return (Math.round(v * 100) / 100).toFixed(2);
  const dec = u && u.dec === 0 ? 0 : 2, x = scale(v, u), [i, f] = Math.abs(x).toFixed(dec).split(".");
  return (x < 0 ? "-" : "") + group3(i) + (dec ? "." + f : "");
}
export const unitWord = (u) => UNIT_SHORT[(u && u.unit) || 1] || "₹";

// ---------------------------------------------------------------- dates (YYYYMMDD, no time zones)
const pad = (n) => String(n).padStart(2, "0");
const ymOf = (d) => String(d).slice(0, 6);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const fyStart = (d) => { const y = +String(d).slice(0, 4), m = +String(d).slice(4, 6); return String(m >= 4 ? y : y - 1) + "0401"; };
export function monthsOf(from, to) {
  const out = []; let y = +from.slice(0, 4), m = +from.slice(4, 6);
  while (String(y) + pad(m) <= to.slice(0, 6)) { out.push(String(y) + pad(m)); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const monthEnd = (ym) => ym + pad(lastDay(+ym.slice(0, 4), +ym.slice(4, 6)));
const addMonths = (ym, k) => { let y = +ym.slice(0, 4), m = +ym.slice(4, 6) + k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return String(y) + pad(m); };
export const shiftY = (d, k) => { const y = +d.slice(0, 4) + k, md = d.slice(4); return String(y) + (md === "0229" && lastDay(y, 2) === 28 ? "0228" : md); };
const days = (from, to) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6)) - Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6))) / 86400000);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym) => MON[+ym.slice(4, 6) - 1] + "-" + ym.slice(0, 4);
export const dateLabel = (d) => d ? d.slice(6) + "-" + MON[+d.slice(4, 6) - 1] + "-" + d.slice(0, 4) : "";
const fyLabel = (from) => from.slice(0, 4) + "-" + String(+from.slice(0, 4) + 1).slice(2);

// the report's period, from its definition and the day it is run (today; never later than the books' last entry for the
// "to date" kinds)
export function periodOf(def, data, today) {
  const p = (def && def.period) || { kind: "fy" };
  today = String(today || "").replace(/-/g, "").slice(0, 8) || (data && data.booksTo) || "";
  const asOf = data && data.booksTo && data.booksTo < today ? data.booksTo : today;
  if (p.kind === "range" && p.from && p.to) return { from: p.from, to: p.to };
  if (p.kind === "ytd") return { from: fyStart(asOf), to: asOf };
  if (p.kind === "mtd") return { from: asOf.slice(0, 6) + "01", to: asOf };
  const qStart = (d) => { const fy = fyStart(d), k = Math.floor(monthsOf(fy, d).length - 1) - ((monthsOf(fy, d).length - 1) % 3); return addMonths(fy.slice(0, 6), k) + "01"; };
  if (p.kind === "qtd") return { from: qStart(asOf), to: asOf };
  if (p.kind === "lastMonth") { const ym = addMonths(today.slice(0, 6), -1); return { from: ym + "01", to: monthEnd(ym) }; }
  if (p.kind === "lastQuarter") { const qs = qStart(today), f = addMonths(qs.slice(0, 6), -3); return { from: f + "01", to: monthEnd(addMonths(f, 2)) }; }
  const fy = p.fy && /^\d{4}$/.test(p.fy) ? p.fy : fyStart(asOf || "20250401").slice(0, 4);
  return { from: fy + "0401", to: String(+fy + 1) + "0331" };
}
export function periodLabel(pr) {
  if (!pr) return "";
  if (pr.from.slice(4) === "0401" && pr.to === String(+pr.from.slice(0, 4) + 1) + "0331") return "FY " + fyLabel(pr.from);
  return dateLabel(pr.from) + " to " + dateLabel(pr.to);
}

// ---------------------------------------------------------------- the entries
const lower = (s) => String(s || "").toLowerCase();
function passes(v, f) {
  if (!f) return true;
  if (f.vtype && f.vtype.length && !f.vtype.some((t) => lower(t) === lower(v.type))) return false;
  if (f.party && f.party.length && !f.party.some((p) => lower(p) === lower(v.party) || lower(p) === lower(v.who) || lower(p) === lower(v.pw) || v.ent.some((e) => lower(e.l) === lower(p)))) return false;
  if (f.ledger && f.ledger.length && !f.ledger.some((l) => v.ent.some((e) => lower(e.l) === lower(l)))) return false;
  return true;
}
const hasFilter = (f) => !!f && ((f.vtype || []).length + (f.party || []).length + (f.ledger || []).length) > 0;
// the entries of a period (and the filters), once per run
function makeCtx(data, def) {
  const memo = new Map(), f = def.filters;
  const vs = (from, to) => { const k = "v" + from + to; if (!memo.has(k)) memo.set(k, (data.vouchers || []).filter((v) => v.date >= from && v.date <= to && passes(v, f))); return memo.get(k); };
  // amounts by ledger and month (credit positive), as MIS.moves
  const moves = (from, to) => {
    const k = "m" + from + to; if (memo.has(k)) return memo.get(k);
    const out = {};
    vs(from, to).forEach((v) => { const ym = ymOf(v.date); v.ent.forEach((e) => { const x = out[e.l] = out[e.l] || {}; x[ym] = r2((x[ym] || 0) + e.a); x.t = r2((x.t || 0) + e.a); }); });
    memo.set(k, out); return out;
  };
  // Tally's balances at the end of a day (the filters never apply to a balance)
  const bal = (d) => {
    const k = "b" + d; if (memo.has(k)) return memo.get(k);
    const o = data.open; if (!o || !o.bal || d < shiftDay(o.from, -1)) { memo.set(k, null); return null; }
    const out = Object.assign({}, o.bal);
    (data.vouchers || []).forEach((v) => { if (v.date < o.from || v.date > d) return; v.ent.forEach((e) => { out[e.l] = r2((out[e.l] || 0) + e.a); }); });
    memo.set(k, out); return out;
  };
  return { vs, moves, bal, pl: (from, to) => { const k = "p" + from + to; if (!memo.has(k)) memo.set(k, plOf(data, moves(from, to), monthsOf(from, to))); return memo.get(k); } };
}
const shiftDay = (d, k) => { const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6) + k)); return t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()); };

// ---------------------------------------------------------------- MIS.plRule and MIS.pl, as they are
const SETS_OFF = ["mat", "pur", "emp", "fin", "dep", "exp"];
const PL_LABEL = { mat: "Cost of materials consumed", pur: "Purchases", emp: "Employee benefits expense", fin: "Finance costs", dep: "Depreciation and amortisation expense", exp: "Other expenses",
  rev: "Revenue from operations", oth: "Other income", chg: "Changes in inventories", exc: "Exceptional items", tax: "Tax expense" };
const PL_FS = { mat: "Cost of materials consumed", pur: "Purchases of stock-in-trade", emp: "Employee benefits expense", fin: "Finance costs", dep: "Depreciation and amortisation expense", exp: "Other expenses" };
export const CREDIT_EXP = "expense ledger with a credit balance";
function plOf(data, mv, months) {
  const L = data.ledgers || {}, end = months[months.length - 1], rows = [];
  const lab = (s2) => PL_FS[s2] || PL_LABEL[s2] || s2;
  Object.keys(mv).sort().forEach((l) => {
    const k = L[l]; if (!k || !k.h) return;
    const x = mv[l], sign = k.h === "rev" || k.h === "oth" ? 1 : -1, row = { l, s: k.s, h: k.h, t: r2(N(x.t) * sign), m: {} };
    months.forEach((mm) => { row.m[mm] = r2(N(x[mm]) * sign); });
    if (sign < 0 && SETS_OFF.includes(k.s) && row.t < -0.004) row.flag = CREDIT_EXP;
    rows.push(row);
  });
  const set = [], moved = [], hOrder = HEADS.map((z) => z[0]);
  const line = (s2, h, t, l) => { if (Math.abs(t) >= 0.005) set.push({ s: s2, h, l, t: r2(t), m: end ? { [end]: r2(t) } : {}, so: true }); };
  SETS_OFF.forEach((s2) => {
    const R = rows.filter((r) => r.s === s2); if (!R.length) return;
    const dr = r2(R.filter((r) => r.t > 0).reduce((a, r) => a + r.t, 0)), cr = r2(-R.filter((r) => r.t < 0).reduce((a, r) => a + r.t, 0)), T = r2(dr - cr);
    const by = {}; R.forEach((r) => { by[r.h] = r2((by[r.h] || 0) + r.t); });
    const hs = Object.keys(by).sort((a, b2) => hOrder.indexOf(a) - hOrder.indexOf(b2));
    if (T < -0.004) {
      hs.forEach((h) => line(s2, h, -by[h], hs.length < 2 ? "Excess credit moved to Other income" : by[h] > 0 ? "Set off against the credits in " + lab(s2) : "Set off against the rest of " + lab(s2) + "; the excess credit moved to Other income"));
      moved.push({ s: s2, l: "Excess credit in " + lab(s2), t: r2(-T), m: end ? { [end]: r2(-T) } : {}, so: true, from: s2 });
    } else if (hs.length > 1) {
      let left = r2(-hs.filter((h) => by[h] < 0).reduce((a, h) => a + by[h], 0));
      hs.filter((h) => by[h] < 0).forEach((h) => line(s2, h, -by[h], "Set off against the rest of " + lab(s2)));
      hs.filter((h) => by[h] > 0).forEach((h) => { const take = r2(Math.min(by[h], left)); if (take > 0) { line(s2, h, -take, "Credits in " + lab(s2) + " set off here"); left = r2(left - take); } });
    }
  });
  const heads = {};
  const put = (h, row) => { const H = heads[h] = heads[h] || { t: 0, m: {}, led: [] }; months.forEach((m) => { row.m[m] = row.m[m] || 0; H.m[m] = r2((H.m[m] || 0) + row.m[m]); }); H.t = r2(H.t + row.t); H.led.push(row); };
  rows.forEach((r) => { const row = { l: r.l, t: r.t, m: Object.assign({}, r.m) }; if (r.flag) row.flag = r.flag; put(r.h, row); });
  set.forEach((z) => put(z.h, { l: z.l, t: z.t, m: Object.assign({}, z.m), so: true }));
  moved.forEach((z) => put("oth", { l: z.l, t: z.t, m: Object.assign({}, z.m), so: true, from: z.s }));
  const g = (k) => (heads[k] || { t: 0 }).t, gm = (k, m) => ((heads[k] || { m: {} }).m[m] || 0);
  const calc = (fn) => ({ t: r2(fn(g)), m: Object.fromEntries(months.map((m) => [m, r2(fn((k) => gm(k, m)))])) });
  return { months, heads,
    income: calc((x) => x("rev") + x("oth")),
    gross: calc((x) => x("rev") - x("pur") - x("dir")),
    ebitda: calc((x) => x("rev") + x("oth") - x("pur") - x("dir") - x("emp") - x("exp")),
    pbt: calc((x) => x("rev") + x("oth") - x("pur") - x("dir") - x("emp") - x("exp") - x("fin") - x("dep")),
    pat: calc((x) => x("rev") + x("oth") - x("pur") - x("dir") - x("emp") - x("exp") - x("fin") - x("dep") - x("tax")) };
}

// ---------------------------------------------------------------- the columns
function columnsOf(block, pr) {
  const out = [], months = monthsOf(pr.from, pr.to), clip = (f, t) => ({ from: f < pr.from ? pr.from : f, to: t > pr.to ? pr.to : t });
  if (block.rows.by === "ageing") {
    AGE_BUCKETS.forEach((l, i) => out.push({ key: "b" + i, label: l + " days", kind: "bucket" }));
    out.push({ key: "und", label: "Not bill-wise", kind: "bucket" }, { key: "t", label: "Owed", kind: "total", from: pr.from, to: pr.to });
    return out;
  }
  if (block.cols.by === "month" && months.length > 1) months.forEach((m) => out.push(Object.assign({ key: m, label: monthLabel(m), kind: "period", months: [m] }, clip(m + "01", monthEnd(m)))));
  if (block.cols.by === "quarter" && months.length > 1) {
    const fy = fyStart(pr.from).slice(0, 6), seen = {};
    months.forEach((m) => { const k = Math.floor(monthsOf(fy + "01", m + "01").length - 1) / 3 | 0, q = addMonths(fy, k * 3), key = "q" + q;
      if (!seen[key]) { seen[key] = { key, label: "Q" + ((k % 4) + 1) + " " + fyLabel(fyStart(q + "01")), kind: "period", months: [], from: "", to: "" }; out.push(seen[key]); }
      seen[key].months.push(m); });
    out.forEach((c) => Object.assign(c, clip(c.months[0] + "01", monthEnd(c.months[c.months.length - 1]))));
  }
  out.push({ key: "t", label: out.length ? "Total" : periodLabel(pr), kind: "total", from: pr.from, to: pr.to, months });
  return out;
}

// ---------------------------------------------------------------- one block
const pc = (a, c) => (c ? Math.round(a / c * 1000) / 10 : null);
const NM = "not meaningful";
function ledgersUnder(data, groups) {
  const want = groups.map(lower);
  return Object.keys(data.ledgers || {}).filter((l) => (data.ledgers[l].g || []).some((g) => want.includes(lower(g)))).sort();
}

function blockRun(block, def, data, C, pr, ly) {
  const by = block.rows.by, cols = columnsOf(block, pr), notes = [], L = data.ledgers || {};
  const periodCols = cols.filter((c) => c.kind === "period" || c.kind === "total");
  const monthsIn = (c) => c.months || monthsOf(c.from, c.to);
  const lyRange = (c) => ({ from: shiftY(c.from, -1), to: shiftY(c.to, -1) });
  const lyOk = !!ly && !!data.booksFrom && data.booksFrom <= ly.from;
  // each row: a function of a range ({from, to, months, ly}) -> value, its drill (src) and its label
  let rows = [], additive = true, unitKind = "";
  const sumMonths = (m, c) => r2(monthsIn(c).reduce((s, x) => s + N(m[x]), 0));
  if (by === "head") {
    additive = false;
    const items = block.rows.items.length ? block.rows.items : HEADS.map((h) => h[0]).concat(PL_LINES.map((x) => x[0]));
    const PL_ALL = Object.keys(L).filter((l) => L[l].h);
    items.forEach((k) => {
      const isLine = PL_LINES.some((x) => x[0] === k);
      // the period's own MIS.pl (and last year's): a month is its month, a quarter its months, the total MIS's total
      const val = (c) => {
        const P = c.pfrom ? C.pl(ly.from, ly.to) : C.pl(pr.from, pr.to), X = isLine ? P[k] : P.heads[k] || { t: 0, m: {} };
        if (c.kind === "total") return X.t;
        const ms = c.pfrom ? monthsOf(c.pfrom, c.pto) : c.months;
        return ms.length === 1 ? N(X.m[ms[0]]) : sumMonths(X.m, { months: ms });
      };
      const led = isLine ? PL_ALL : (((C.pl(pr.from, pr.to).heads[k] || {}).led) || []).filter((x) => !x.so).map((x) => x.l);
      rows.push({ key: rowKey("head", k), label: headLabel(k), bold: isLine, val, src: { ledgers: led }, head: k });
    });
  } else if (by === "group" || by === "ledger") {
    let names = block.rows.items.slice();
    if (by === "ledger" && !names.length && block.rows.under.length) names = ledgersUnder(data, block.rows.under);
    if (by === "group" && !names.length) names = Array.from(new Set(Object.values(L).map((x) => (x.g || [])[x.g.length - 1]).filter(Boolean))).sort();
    names.forEach((nm) => {
      const led = by === "ledger" ? [nm] : ledgersUnder(data, [nm]);
      const dc = ((L[led[0]] || {}).dc) || 1;
      const val = (c) => {
        const f = c.pfrom || c.from, t = c.pto || c.to, m = block.measure;
        if (m === "close") { const B = C.bal(t); if (!B) return null; return r2(led.reduce((s, l) => s + N(B[l]), 0) * dc); }
        if (m === "count") return C.vs(f, t).filter((v) => v.ent.some((e) => led.includes(e.l))).length;
        const vs = C.vs(f, t); let s = 0;
        vs.forEach((v) => v.ent.forEach((e) => { if (!led.includes(e.l)) return; if (m === "dr") { if (e.a < 0) s -= e.a; } else if (m === "cr") { if (e.a > 0) s += e.a; } else s += e.a; }));
        return r2(m === "dr" || m === "cr" ? s : s * dc);
      };
      rows.push({ key: rowKey(by, nm), label: nm, val, src: { ledgers: led } });
    });
    if (block.measure === "close") notes.push("Closing balances: what each ledger shows in Tally at the end of each column; the filters apply only to entries.");
  } else if (by === "code") {
    const codes = block.rows.items.length ? block.rows.items : Object.keys(data.codes || {}).filter((c) => Object.values(L).some((x) => x.code === c));
    codes.forEach((code) => {
      const cd = (data.codes || {})[code] || { label: code, side: "PL", sign: 1 }, led = Object.keys(L).filter((l) => L[l].code === code);
      const val = (c) => {
        const f = c.pfrom || c.from, t = c.pto || c.to;
        if (cd.side === "BS") { const B = C.bal(t); if (!B) return null; return RND(cd.sign * -led.reduce((s, l) => s + N(B[l]), 0), 2); }
        const mv = C.moves(f, t); return RND(cd.sign * -led.reduce((s, l) => s + N((mv[l] || {}).t), 0), 2);
      };
      rows.push({ key: rowKey("code", code), label: code + " " + cd.label, val, src: { ledgers: led } });
    });
  } else if (by === "customer" || by === "supplier") {
    const sale = by === "customer", amtK = sale ? "sa" : "pa", whoK = sale ? "who" : "pw";
    const all = (f, t) => { const out = {}; C.vs(f, t).forEach((v) => { const a = N(v[amtK]); if (!a || !v[whoK]) return; const x = out[v[whoK]] = out[v[whoK]] || { t: 0, n: 0, m: {} }; x.t = r2(x.t + a); x.n++; x.m[ymOf(v.date)] = r2((x.m[ymOf(v.date)] || 0) + a); }); return out; };
    const base = all(pr.from, pr.to), under = block.rows.under.map(lower);
    let names = block.rows.items.length ? block.rows.items : Object.keys(base).sort((a, b) => base[b].t - base[a].t || a.localeCompare(b));
    if (under.length) names = names.filter((p) => ((L[p] || {}).g || []).some((g) => under.includes(lower(g))));
    names.forEach((p) => {
      const val = (c) => { const f = c.pfrom || c.from, t = c.pto || c.to, x = (f === pr.from && t === pr.to ? base : all(f, t))[p]; if (!x) return 0; return block.measure === "count" ? x.n : c.kind === "period" && !c.pfrom ? sumMonths(x.m, c) : x.t; };
      rows.push({ key: rowKey(by, p), label: p, val, src: { party: p, side: sale ? "r" : "p" } });
    });
  } else if (by === "gst") {
    additive = false;
    const items = block.rows.items.length ? block.rows.items : GST_LINES.map((x) => x[0]);
    if (!data.gst) notes.push("GST by month is worked out from the GST returns' working in the books; it is not available for these books.");
    items.forEach((k) => {
      const val = (c) => (c.pfrom ? null : data.gst ? r2(monthsIn(c).reduce((s, m) => s + N((data.gst[m] || {})[k]), 0)) : null);
      rows.push({ key: rowKey("gst", k), label: (GST_LINES.find((x) => x[0] === k) || [, k])[1], val, src: { gst: k } });
    });
  } else if (by === "ageing") {
    const A = data.ageing && data.ageing[block.rows.side];
    if (!A) notes.push("The ages are worked out from the bills in the books; they are not available here.");
    else {
      notes.push("As on " + dateLabel(data.ageing.asOn) + ": what each party owes on balance, aged by the bills (MIS's ageing); what no bill dates is not bill-wise.");
      A.rows.filter((x) => Math.abs(x.owe) >= 0.005).sort((a, b) => b.owe - a.owe || a.party.localeCompare(b.party)).forEach((x) => {
        rows.push({ key: rowKey("party", x.party), label: x.party, cellsOf: () => Object.assign({ t: x.owe, und: x.und }, Object.fromEntries(x.nb.map((v, i) => ["b" + i, v]))), src: { party: x.party, side: block.rows.side } });
      });
    }
  } else if (by === "ratio") {
    additive = false;
    const items = block.rows.items.length ? block.rows.items : RATIOS.map((x) => x[0]);
    items.forEach((k) => {
      const meta = RATIOS.find((x) => x[0] === k) || [k, k, ""];
      rows.push({ key: rowKey("ratio", k), label: meta[1], unit: meta[2], val: (c) => ratioOf(k, c.pfrom || c.from, c.pto || c.to, data, C), src: { ratio: k } });
    });
    unitKind = "ratio";
  }

  // the cells
  const out = rows.map((R) => {
    const cells = {};
    if (R.cellsOf) Object.assign(cells, R.cellsOf());
    else periodCols.forEach((c) => { cells[c.key] = R.val(c); });
    if (!R.cellsOf && block.cols.compare === "ly") cells.ly = lyOk ? R.val(Object.assign({}, cols.find((c) => c.kind === "total"), { pfrom: ly.from, pto: ly.to })) : null;
    if (!R.cellsOf && block.cols.compare === "ly" && lyOk && block.cols.by !== "year") periodCols.filter((c) => c.kind === "period").forEach((c) => { const q = lyRange(c); cells["ly:" + c.key] = R.val(Object.assign({}, c, { pfrom: q.from, pto: q.to })); });
    return { key: R.key, label: R.label, kind: "line", bold: !!R.bold, unit: R.unit || "", cells, src: R.src };
  });
  // the budget: typed against this row, else MIS's budget by head
  if (block.cols.compare === "budget") {
    const fy = fyStart(pr.from).slice(0, 4), months = monthsOf(pr.from, pr.to);
    out.forEach((row) => {
      const typed = (def.budget || {})[row.key], head = row.key.startsWith("head:") ? (((data.budget || {})[fy] || {})[row.key.slice(5)]) : null, B = typed || head;
      row.cells.bud = B ? r2(months.reduce((s, m) => s + N(B[m]), 0)) : null;
      if (B && block.cols.by !== "year") periodCols.filter((c) => c.kind === "period").forEach((c) => { row.cells["bud:" + c.key] = r2(c.months.reduce((s, m) => s + N(B[m]), 0)); });
    });
    if (!out.some((r) => r.cells.bud != null)) notes.push("No budget typed for these rows yet: type it under the block (rupees for each month).");
  }
  if (block.cols.compare === "ly" && !lyOk) notes.push("Last year is not in these books (they start on " + dateLabel(data.booksFrom) + "), so it is not shown.");
  // top N and Others, largest first by the period's figure (customers and suppliers keep MIS's order)
  let lines = out, others = null, total = null;
  if (additive && block.rows.top > 0 && !block.rows.items.length) {
    const sorted = lines.slice().sort((a, b) => Math.abs(N(b.cells.t)) - Math.abs(N(a.cells.t)) || a.label.localeCompare(b.label));
    lines = sorted.slice(0, block.rows.top);
    const rest = sorted.slice(block.rows.top);
    if (rest.length && block.rows.others) others = { key: "others", label: "Others (" + rest.length + ")", kind: "others", cells: sumCells(rest), src: mergeSrc(rest) };
  }
  if (additive) total = { key: "total", label: "Total", kind: "total", cells: sumCells(out), src: mergeSrc(out) };
  if (by === "ageing" && data.ageing && data.ageing[block.rows.side]) {
    const S = data.ageing[block.rows.side].sum;
    total.cells = Object.assign({ t: S.owe, und: S.und }, Object.fromEntries(S.nb.map((v, i) => ["b" + i, v])));
    if (S.advance >= 1) notes.push("Advances " + (block.rows.side === "r" ? "from customers" : "to suppliers") + " are not in the figure.");
  }
  // % change, % of total
  const all = lines.concat(others ? [others] : []).concat(total ? [total] : []);
  if (block.cols.pct.includes("change") && (block.cols.compare === "ly" || block.cols.compare === "budget")) all.forEach((r) => { const base = block.cols.compare === "ly" ? r.cells.ly : r.cells.bud; r.cells.chg = base ? Math.round((N(r.cells.t) - base) / Math.abs(base) * 1000) / 10 : null; });
  if (block.cols.pct.includes("share") && additive && total) all.forEach((r) => { r.cells.share = total.cells.t ? Math.round(N(r.cells.t) / total.cells.t * 1000) / 10 : null; });
  // the extra columns, in order
  const tail = [];
  if (block.cols.compare === "ly") tail.push({ key: "ly", label: lyOk ? "Last year (" + periodLabel(ly) + ")" : "Last year", kind: "ly" });
  if (block.cols.compare === "budget") tail.push({ key: "bud", label: "Budget", kind: "bud" });
  if (block.cols.pct.includes("change") && block.cols.compare !== "none") tail.push({ key: "chg", label: block.cols.compare === "ly" ? "% change" : "% against budget", kind: "pct" });
  if (block.cols.pct.includes("share") && additive) tail.push({ key: "share", label: "% of total", kind: "pct" });
  if (hasFilter(def.filters) && by !== "ageing" && by !== "gst") notes.push("Filtered: " + filterWords(def.filters) + ".");
  const shown = lines.concat(others ? [others] : []);
  return { id: block.id, type: block.type, title: block.title, by, measure: block.measure, unitKind, cols: cols.concat(tail), rows: shown, total, notes,
    chart: chartOf(block, cols, shown, total), kpi: block.type === "kpi" ? kpiOf(block, shown, total) : null };
}
const filterWords = (f) => [f.vtype.length ? "voucher type " + f.vtype.join(", ") : "", f.party.length ? "party " + f.party.join(", ") : "", f.ledger.length ? "entries with " + f.ledger.join(", ") : ""].filter(Boolean).join("; ");
function sumCells(rows) {
  const out = {};
  rows.forEach((r) => Object.entries(r.cells).forEach(([k, v]) => { if (typeof v === "number" && k !== "chg" && k !== "share") out[k] = r2((out[k] || 0) + v); else if (v == null && !(k in out)) out[k] = null; }));
  return out;
}
function mergeSrc(rows) {
  const led = new Set(), parties = []; let side = "";
  rows.forEach((r) => { ((r.src || {}).ledgers || []).forEach((l) => led.add(l)); if ((r.src || {}).party) { parties.push(r.src.party); side = r.src.side; } });
  return parties.length ? { parties, side } : { ledgers: Array.from(led) };
}

// ---------------------------------------------------------------- ratios: MIS.ratios, the same formulas
function ratioOf(k, from, to, data, C) {
  const P = C.pl(from, to), rev = (P.heads.rev || { t: 0 }).t, d = days(from, to) + 1, L = data.ledgers || {};
  if (k === "gross") return pc(P.gross.t, rev);
  if (k === "op") return pc(P.ebitda.t, rev);
  if (k === "net") return pc(P.pbt.t, rev);
  if (k === "emp") return pc((P.heads.emp || { t: 0 }).t, rev);
  if (k === "exp") return pc((P.heads.exp || { t: 0 }).t, rev);
  const B = C.bal(to);
  if (k === "dso" || k === "dpo") {
    if (!B) return null;
    const side = k === "dso" ? "r" : "p";
    const owe = r2(Object.keys(B).filter((l) => (L[l] || {}).kind === side).reduce((s, l) => { const v = side === "r" ? -N(B[l]) : N(B[l]); return Math.abs(v) < 0.005 ? s : s + Math.max(0, v); }, 0));
    if (k === "dso") { const salesT = r2(C.vs(from, to).reduce((s, v) => s + N(v.sa), 0)), revOps = rev || salesT; return owe > 0 && revOps > 0 ? Math.round(owe / (revOps / d)) : null; }
    const mv = C.moves(from, to), goods = Object.keys(mv).some((l) => (L[l] || {}).pur && Math.abs(N(mv[l].t)) >= 1);
    const purT = r2(C.vs(from, to).reduce((s, v) => s + N(v.pa), 0));
    return goods && owe > 0 && purT > 0 ? Math.round(owe / (purT / d)) : null;
  }
  if (k === "icover") return (P.heads.fin || { t: 0 }).t ? Math.round(P.ebitda.t / P.heads.fin.t * 10) / 10 : null;
  if (!B) return null;
  const CA = { ci: 1, inv: 1, tr: 1, cash: 1, stla: 1, oca: 1 }, CL = { stb: 1, tp: 1, ocl: 1, stp: 1 }, at = { ca: 0, cl: 0, stock: 0, debt: 0, eq: 0 };
  Object.entries(B).forEach(([l, v]) => {
    v = N(v); if (Math.abs(v) < 0.005) return;
    const x = L[l]; if (!x || x.rev) return;
    const p = (x.place || {})[v < 0 ? "dr" : "cr"] || "";
    if (CA[p]) { at.ca += -v; if (p === "inv") at.stock += -v; } else if (CL[p]) at.cl += v;
    if (p === "ltb" || p === "stb") at.debt += v;
    if (p === "share" || p === "reserves" || p === "capital") at.eq += v;
  });
  const ca = r2(at.ca), cl = r2(at.cl), liquid = r2(at.ca - at.stock), debt = r2(at.debt), eq = r2(at.eq + P.pat.t);
  const times = (a, c) => (!(c > 0) || a < 0 ? NM : Math.round(a / c * 100) / 100);
  if (k === "current") return times(ca, cl);
  if (k === "quick") return times(liquid, cl);
  if (k === "debtEq") return !(eq > 0) || debt < 0 ? NM : Math.round(debt / eq * 100) / 100;
  if (k === "wc") return r2(ca - cl);
  return null;
}

// ---------------------------------------------------------------- charts and KPI tiles (data only; parts/MisChart.jsx draws)
// series follow the rows (their colour by the row's place in the block, never its rank after a filter); at most 8 series,
// the rest folded into Others; a pie or donut at most 6 slices and Others
function chartOf(block, cols, rows, total) {
  const type = block.chart.type, pcols = cols.filter((c) => c.kind === "period"), lines = rows.filter((r) => r.kind !== "total" && !(typeof r.cells.t === "string"));
  if (block.rows.by === "ageing") {
    const bucketCols = cols.filter((c) => c.kind === "bucket");
    return { type: type === "pie" || type === "donut" ? type : "stacked", x: bucketCols.map((c) => c.label), series: [{ key: "t", name: total ? "All parties" : "Owed", values: bucketCols.map((c) => N((total || rows[0] || { cells: {} }).cells[c.key])) }] };
  }
  if (type === "pie" || type === "donut" || !pcols.length) {
    const cap = type === "pie" || type === "donut" ? 6 : 12, keep = lines.slice(0, cap), rest = lines.slice(cap);
    const pts = keep.map((r) => ({ key: r.key, name: r.label, value: N(r.cells.t) }));
    if (rest.length) pts.push({ key: "others", name: "Others", value: r2(rest.reduce((s, r) => s + N(r.cells.t), 0)) });
    const lyS = block.cols.compare === "ly" && keep.some((r) => r.cells.ly != null) ? [{ key: "ly", name: "Last year", values: keep.map((r) => N(r.cells.ly)) }] : [];
    return { type: type === "line" || type === "stacked" ? "bar" : type, x: pts.map((p) => p.name), series: [{ key: "t", name: block.title, values: pts.map((p) => p.value) }].concat(type === "pie" || type === "donut" ? [] : lyS), pts };
  }
  const keep = lines.slice(0, 8), rest = lines.slice(8);
  const series = keep.map((r) => ({ key: r.key, name: r.label, values: pcols.map((c) => N(r.cells[c.key])) }));
  if (rest.length) series.push({ key: "others", name: "Others", values: pcols.map((c) => r2(rest.reduce((s, r) => s + N(r.cells[c.key]), 0))) });
  if (block.cols.compare === "ly" && keep.length === 1 && pcols.every((c) => keep[0].cells["ly:" + c.key] != null)) series.push({ key: "ly", name: keep[0].label + ", last year", values: pcols.map((c) => N(keep[0].cells["ly:" + c.key])), ghost: true });
  return { type, x: pcols.map((c) => c.label), series };
}
function kpiOf(block, rows, total) {
  const r = total && rows.length > 1 ? total : rows[0] || total; if (!r) return null;
  const v = r.cells.t, base = block.cols.compare === "ly" ? r.cells.ly : block.cols.compare === "budget" ? r.cells.bud : null;
  return { label: block.title || r.label, value: v, unit: r.unit || "", base, baseLabel: block.cols.compare === "ly" ? "last year" : block.cols.compare === "budget" ? "budget" : "", chg: base ? Math.round((N(v) - base) / Math.abs(base) * 1000) / 10 : null, src: r.src };
}

// ---------------------------------------------------------------- the report
export function run(def, data, o = {}) {
  const pr = periodOf(def, data, o.today), ly = { from: shiftY(pr.from, -1), to: shiftY(pr.to, -1) }, C = makeCtx(data, def);
  const blocks = def.blocks.map((b) => { try { return blockRun(b, def, data, C, pr, ly); } catch (e) { return { id: b.id, type: b.type, title: b.title, error: String((e && e.message) || e), cols: [], rows: [], notes: [] }; } });
  return { name: def.name, period: pr, periodLabel: periodLabel(pr), units: def.units, unitWord: unitWord(def.units), blocks, data };
}

// a figure's ledger rows: the entries of the period (and the filters) that make it up
export function entries(data, q) {
  const led = new Set(q.ledgers || []), parties = q.parties || (q.party ? [q.party] : null), f = q.filters;
  const out = [];
  (data.vouchers || []).forEach((v) => {
    if (v.date < q.from || v.date > q.to || !passes(v, f)) return;
    if (parties) {
      const k = q.side === "p" ? "pw" : "who", a = N(v[q.side === "p" ? "pa" : "sa"]);
      if (!parties.includes(v[k]) || !a) return;
      out.push({ id: v.id, date: v.date, no: v.no, type: v.type, party: v.party || v[k], narr: v.narr || "", amt: a, ledgers: v.ent.map((e) => e.l) });
      return;
    }
    const hit = v.ent.filter((e) => led.has(e.l)); if (!hit.length) return;
    out.push({ id: v.id, date: v.date, no: v.no, type: v.type, party: v.party || "", narr: v.narr || "", amt: r2(hit.reduce((s, e) => s + e.a, 0)), ledgers: Array.from(new Set(hit.map((e) => e.l))) });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.no).localeCompare(String(b.no)));
}

// ---------------------------------------------------------------- names against the books (for checkNames)
const key = (s) => lower(s).replace(/[^a-z0-9]+/g, "");
const grams = (s) => { const k = key(s), g = new Set(); for (let i = 0; i < k.length - 1; i++) g.add(k.slice(i, i + 2)); return g; };
const sim = (a, b) => { const A = grams(a), B = grams(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach((x) => { if (B.has(x)) n++; }); return 2 * n / (A.size + B.size); };
export function namesOf(data) {
  const L = data.ledgers || {}, ledgers = Object.keys(L), groups = new Set(), parties = new Set();
  ledgers.forEach((l) => { (L[l].g || []).forEach((g) => groups.add(g)); if (L[l].kind === "r" || L[l].kind === "p") parties.add(l); });
  (data.vouchers || []).forEach((v) => { if (v.party) parties.add(v.party); });
  return { ledger: ledgers, group: Array.from(groups), party: Array.from(parties) };
}
export function lookIn(data) {
  const all = namesOf(data);
  return async (kind, name) => {
    const list = all[kind] || [], k = key(name);
    const same = list.filter((x) => key(x) === k);
    if (same.length === 1) return { name: same[0] };
    const choices = list.map((x) => [x, sim(x, name) + (key(x).includes(k) && k ? 0.5 : 0)]).filter((z) => z[1] >= 0.3).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).slice(0, 5).map((z) => z[0]);
    return { choices };
  };
}
export const MIS_ENGINE_V = 1;
