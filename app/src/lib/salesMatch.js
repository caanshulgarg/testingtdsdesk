// next-fix-bankswitch (21-Nov-2026; FINCOM-APP-STAGING-Y: Bank on a client switch blocked the page 2.3 s): a receipt's
// sales invoice (matchSalesInvoice, src/js/21, for suggestAll) went through every open invoice for each receipt, and with
// no one invoice of its amount tried every two invoices of each customer (a customer of 1,200 invoices: 720,000 sums for
// each receipt). The same search, lighter, put in its place here (in the first file: legacy.js is at its size budget;
// the one-file site keeps the plain one):
//   - the invoices are put by amount once a run (each suggestAll makes its own list, so a list is never changed after);
//   - one invoice of the amount: only those of about that amount are tried;
//   - two invoices of one customer: the smaller of the two (at most about half the receipt) and, for each, only the
//     customer's invoices of about what is left;
//   - each tried with the same tests as before (still open: not taken, not dated after the receipt; within a rupee), and
//     put in the same order (by their places in the list; pairs by customer, in the order of the customer's first invoice
//     still open), so the same one is chosen. "About": within 3 rupees, and a little more for amounts too large to be
//     exact to the rupee in a double.
// tests/run_page_speed.py part I holds it to the plain search, receipt by receipt.
const byList = new WeakMap();
function index(invs) {
  let X = byList.get(invs);
  if (X) return X;
  const t = invs.map((v) => num(v.x.total)), by = (a, b) => t[a] - t[b], cs = new Map();
  invs.forEach((v, i) => { const k = v.customerLedger; (cs.get(k) || cs.set(k, []).get(k)).push(i); });
  X = { t, all: invs.map((v, i) => i).sort(by), cust: [...cs.values()].filter((l) => l.length > 1).map((l) => ({ l, s: l.slice().sort(by) })) };
  byList.set(invs, X);
  return X;
}
export function matchSalesInvoice(row, invs, taken) {
  const amt = row.credit, X = index(invs), t = X.t, d = 3 + Math.abs(amt) * 1e-12;
  // the invoices of s (places in the list, by amount) from its k-th on, of about amount w
  const near = (s, k, w) => {
    const e = d + Math.abs(w) * 1e-12, out = [];
    let hi = s.length;
    while (k < hi) { const m = (k + hi) >> 1; if (t[s[m]] < w - e) k = m + 1; else hi = m; }
    while (k < s.length && t[s[k]] <= w + e) out.push(s[k++]);
    return out;
  };
  const open = (i) => !taken.has(invs[i].id) && (!invs[i].x.date || invs[i].x.date <= row.date);
  const score = (v) => Math.max(nameSim(row.dec.name, v.x.customerName), nameSim(row.dec.name, v.customerLedger));
  const hits = near(X.all, 0, amt).filter((i) => Math.abs(t[i] - amt) <= 1 && open(i)).sort((a, b) => a - b).map((i) => ({ inv: [invs[i]], sim: score(invs[i]) }));
  if (!hits.length) {
    // two invoices of one customer paid together
    const got = [], first = new Map();
    X.cust.forEach((c) => {
      const s = c.s, top = t[s[s.length - 1]];
      for (let k = 0; k < s.length - 1 && t[s[k]] * 2 <= amt + d; k++) {
        if (t[s[k]] + top < amt - d) continue;
        near(s, k + 1, amt - t[s[k]]).forEach((j) => {
          const a = Math.min(s[k], j), b = Math.max(s[k], j);
          if (open(a) && open(b) && Math.abs(t[a] + t[b] - amt) <= 1) got.push([c, a, b]);
        });
      }
    });
    const f = (c) => { if (!first.has(c)) first.set(c, c.l.find(open)); return first.get(c); };
    got.sort((p, q) => f(p[0]) - f(q[0]) || p[1] - q[1] || p[2] - q[2]).forEach(([, a, b]) => hits.push({ inv: [invs[a], invs[b]], sim: score(invs[a]) }));
  }
  if (!hits.length) return null;
  hits.sort((a, b2) => b2.sim - a.sim);
  const h = hits[0];
  if (h.sim < 0.45 && hits.length > 1) return null;
  if (h.sim < 0.3 && row.dec.name) return null;
  return { inv: h.inv, strong: h.sim >= 0.6 };
}
matchSalesInvoice.light = true;
if (typeof window === "object" && typeof window.matchSalesInvoice === "function" && !window.matchSalesInvoice.light) window.matchSalesInvoice = matchSalesInvoice;
