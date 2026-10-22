// What each party owes, by age (ROUND 105 B6): MIS.bills, MIS.ageing and MIS.netOpen (src/js/07-mis.js) ported as they
// are, pure JavaScript with every input passed in, so the cloud's scheduled MIS (server/mis-run) ages receivables and
// payables exactly as the app's MIS does (tests/run_mis_custom.js checks it against MIS.ageing on the fixture books).
//   vouchers: [{date, no, ent: [{l, a, b: [[name, type, amount, credit days], ...]}]}]   a in Tally's sign (credit positive)
//   kindOf(l): "r" a customer (Sundry Debtors), "p" a supplier (Sundry Creditors), else anything
//   bal: {ledger: Tally's balance on the day} or null; msme: {ledger: "Micro" | "Small" | ...}
export const BUCKETS = [[30, "0–30"], [60, "31–60"], [90, "61–90"], [180, "91–180"], [1e9, "over 180"]];
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v) => (typeof v === "number" ? (isFinite(v) ? v : 0) : (isFinite(parseFloat(v)) ? parseFloat(v) : 0));
const ms = (d) => Date.UTC(+String(d).slice(0, 4), +String(d).slice(4, 6) - 1, +String(d).slice(6, 8));
const days = (a, c) => Math.round((ms(c) - ms(a)) / 86400000);
const shift = (d, n) => { const t = new Date(ms(d) + n * 86400000); return t.getUTCFullYear() + String(t.getUTCMonth() + 1).padStart(2, "0") + String(t.getUTCDate()).padStart(2, "0"); };

export function bills(vouchers, kindOf, asOn, side) {
  const ref = {};
  (vouchers || []).forEach((v) => {
    if (v.date > asOn || v.opt || v.cancel) return;
    v.ent.forEach((e) => {
      if (kindOf(e.l) !== side) return;
      const alloc = e.b && e.b.length ? e.b : [["", "On Account", e.a]];
      alloc.forEach(([name, type, amt, dd]) => {
        const k = e.l + "|" + (type === "On Account" || !name ? "\u0000" : name);
        const x = ref[k] = ref[k] || { party: e.l, ref: type === "On Account" || !name ? "" : name, date: "", amt: 0, first: v.date, no: "" };
        const signed = side === "r" ? -amt : amt;
        if ((type === "New Ref" || type === "Advance") && !x.date) { x.date = v.date; x.no = v.no; x.hasNew = true; if (type === "New Ref" && dd > 0) x.days = dd; }
        x.amt = r2(x.amt + signed);
      });
    });
  });
  return Object.values(ref).filter((x) => Math.abs(x.amt) >= 0.5).map((x) => {
    const date = x.date || x.first, due = x.days ? shift(date, x.days) : "", age = days(date, asOn);
    return Object.assign(x, { date, due, age, od: due ? Math.max(0, days(due, asOn)) : age });
  });
}
export function netOpen(p) {
  const net = r2(p.tally != null ? p.tally : p.total), owe = Math.max(0, net);
  const bs = (p.bills || []).filter((x) => x.ref && x.hasNew && x.amt > 0).sort((a, c) => String(a.date).localeCompare(String(c.date)) || String(a.ref).localeCompare(String(c.ref)));
  let less = r2(bs.reduce((a, x) => a + x.amt, 0) - owe);
  const open = [];
  bs.forEach((x) => { const t = Math.max(0, Math.min(x.amt, less)); less = r2(less - t); const left = r2(x.amt - t); if (left >= 0.005) open.push(Object.assign({}, x, { left })); });
  const und = r2(owe - open.reduce((a, x) => a + x.left, 0));
  return { net, owe: r2(owe), open, und: und >= 0.005 ? und : 0, advance: net < 0 ? r2(-net) : 0 };
}
export function ageing(vouchers, kindOf, asOn, side, bal, msme = {}) {
  const list = bills(vouchers, kindOf, asOn, side), by = {};
  list.forEach((x) => {
    const p = by[x.party] = by[x.party] || { party: x.party, total: 0, b: [0, 0, 0, 0, 0], adv: 0, unalloc: 0, pre: 0, oldest: 0, bills: [], msme: msme[x.party] || "" };
    if (!x.ref) p.unalloc = r2(p.unalloc + x.amt);
    else if (!x.hasNew) p.pre = r2(p.pre + x.amt);
    else if (x.amt < 0) p.adv = r2(p.adv + x.amt);
    else { const a = x.od != null ? x.od : x.age, i = BUCKETS.findIndex(([d]) => a <= d); p.b[i] = r2(p.b[i] + x.amt); p.oldest = Math.max(p.oldest, a); }
    p.total = r2(p.total + x.amt); p.bills.push(x);
  });
  if (bal) Object.keys(bal).forEach((l) => { if (by[l] || Math.abs(num(bal[l])) < 0.005 || kindOf(l) !== side) return;
    by[l] = { party: l, total: 0, b: [0, 0, 0, 0, 0], adv: 0, unalloc: 0, pre: 0, oldest: 0, bills: [], msme: msme[l] || "", noBills: true }; });
  const rows = Object.values(by);
  if (bal) rows.forEach((p) => { const tb = bal[p.party]; if (tb != null) { p.tally = r2(side === "r" ? -tb : tb); p.diff = r2(p.tally - p.total); } });
  rows.forEach((p) => { p.bills.sort((a, c) => String(a.date).localeCompare(String(c.date)) || String(a.ref).localeCompare(String(c.ref))); });
  rows.sort((a, c) => c.total - a.total || a.party.localeCompare(c.party));
  rows.forEach((p) => {
    const o = netOpen(p), nb = BUCKETS.map(() => 0);
    o.open.forEach((x) => { const a = x.od != null ? x.od : x.age, i = BUCKETS.findIndex(([d]) => a <= d); nb[i] = r2(nb[i] + x.left); });
    p.net = o.net; p.open = o.open; p.nb = nb; p.und = o.und; p.advance = o.advance; p.owe = o.owe;
  });
  const sum = { owe: r2(rows.reduce((a, p) => a + Math.max(0, p.net), 0)), advance: r2(rows.reduce((a, p) => a + p.advance, 0)),
    nb: BUCKETS.map((_, i) => r2(rows.reduce((a, p) => a + p.nb[i], 0))), und: r2(rows.reduce((a, p) => a + p.und, 0)) };
  return { rows, sum };
}
// the engine's input (data.ageing[side]): the parties with what each owes, by age
export const forEngine = (A) => ({ sum: { nb: A.sum.nb, und: A.sum.und, owe: A.sum.owe, advance: A.sum.advance }, rows: A.rows.map((p) => ({ party: p.party, nb: p.nb, und: p.und, owe: r2(Math.max(0, num(p.net))) })) });
