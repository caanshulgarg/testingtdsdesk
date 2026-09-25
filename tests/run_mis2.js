// node run_mis2.js - MIS phase 2 on the VMS books
const fs = require("fs"), {load, openBlob} = require("./harness"), {HTML, DATA, CACHE, OUT} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const M = v => x.INR.format(Math.round(v || 0));
(async () => {
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.CO = () => ({name: "VMS EVENTS PRIVATE LIMITED"}); ctx.S.coId = "t";
  x.LedMaster.refresh(b);
  const r = x.MIS.run("20250401", "20260331", "test"), p = r.p2;
  // cash flow: the net equals every movement of cash and bank, contra left out
  let direct = 0;
  b.vouchers.forEach(v => { const cb = v.ent.filter(e => x.Audit.isCash(e.l) || x.Audit.isBankL(e.l)); if (!cb.length || cb.length === v.ent.length) return; const net = cb.reduce((s, e) => s + e.a, 0); if (v.ent.some(e => !(x.Audit.isCash(e.l) || x.Audit.isBankL(e.l)) && (e.a > 0) === (net < 0))) direct -= net; });
  console.log("cash flow: operations " + M(p.cash.op.t) + ", investing " + M(p.cash.inv.t) + ", financing " + M(p.cash.fin.t) + ", net " + M(p.cash.net));
  p.cash.rows.forEach(z => console.log("   " + z.sec + " " + z.lab.padEnd(30) + M(z.t).padStart(16)));
  ok(Math.abs(p.cash.net - direct) < 5, "net change equals every cash and bank movement: " + M(direct));
  ok(Math.abs(p.cash.net - (r.cash.rec - r.cash.pay)) < Math.abs(r.cash.rec) * 0.05, "and is close to received less paid in the summary");
  // forecast
  const F = p.fc;
  console.log("13 weeks from " + F.start + ": customers usually pay in " + F.rd + " days, you pay suppliers in " + F.pd);
  F.weeks.forEach(w => console.log("   " + w.from + "  in " + M(w.inn).padStart(14) + "  out " + M(w.out).padStart(14) + "  items " + w.items.length));
  ok(F.weeks.length === 13 && F.weeks.every((w, i) => i === 0 || w.from > F.weeks[i - 1].from), "13 weeks in order");
  const monthly = [].concat(...F.weeks.map(w => w.items.filter(z => z.what === "Monthly payments")));
  console.log("   monthly payments found: " + Array.from(new Set(monthly.map(z => z.who))).join(", "));
  ok(F.weeks[0].items.some(z => z.what === "Collections"), "open customer bills expected");
  ok(F.weeks.some(w => w.items.some(z => z.what === "GST" && z.d.slice(6) === "20")) && F.weeks.some(w => w.items.some(z => z.what === "TDS" && z.d.slice(6) === "07")), "GST on the 20th, TDS on the 7th");
  // ratios
  p.ratios.list.forEach(([l, v, u]) => console.log("   " + l.padEnd(52) + (v == null ? "-" : v + " " + u)));
  ok(p.ratios.list[0][1] != null && !p.ratios.bs, "flow ratios always; balance-sheet ratios wait for Tally's balances");
  // registrations
  console.log("registrations: " + p.regs.map(g => g.gstin + " sales " + M(g.sales) + " purchases " + M(g.purch)).join(" | "));
  ok(p.regs.length === 2 && Math.abs(p.regs.reduce((s, g) => s + g.sales, 0) - r.sales.total) < 1, "sales of the two registrations add up to the total");
  // cost centres
  const C = p.cc;
  console.log("cost centres: " + C.rows.length + ", income allocated " + C.cover.inc + "%, expenses " + C.cover.exp + "%");
  C.rows.slice(0, 8).forEach(z => console.log("   " + z.name.padEnd(28) + " income " + M(z.inc).padStart(14) + " costs " + M(z.exp).padStart(14) + " profit " + M(z.profit).padStart(14) + "  " + z.margin + "%"));
  const inc = C.rows.reduce((s, z) => s + z.inc, 0) + C.un.inc, exp = C.rows.reduce((s, z) => s + z.exp, 0) + C.un.exp;
  const plInc = r.pl.heads.rev.t + (r.pl.heads.oth || {t: 0}).t, plExp = ["pur", "dir", "emp", "exp", "fin", "dep", "tax"].reduce((s, k) => s + (r.pl.heads[k] || {t: 0}).t, 0);
  ok(Math.abs(inc - plInc) < 2 && Math.abs(exp - plExp) < 2, "cost centres plus what is not allocated equal the profit and loss: income " + M(inc) + " / " + M(plInc));
  // budget
  b.budget = {"2025": {rev: {}, dir: {}}}; x.GSTRev.fyMonths("202504").forEach(mm => { b.budget["2025"].rev[mm] = 50000000; b.budget["2025"].dir[mm] = 38000000; });
  const V = x.MIS.budgetVs(r);
  ok(V.has && V.rows.find(z => z.k === "rev").budget === 600000000 && V.pbt.budget === 600000000 - 456000000, "budget against actual: revenue budget 60 crore, profit budget " + M(V.pbt.budget));
  const r2b = x.MIS.run("20250401", "20260331", "test");
  ok(r2b.code === r.code, "run again: the same result code");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
