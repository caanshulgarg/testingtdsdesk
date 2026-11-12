// node tests/run_gst_isd_2b.js - next-gst-isd (the owner, 12-Nov-2026): two changes to the GST on screen.
//   A. ISD credit in 3B 4(A)(4), not 4(A)(5). An entry is the ISD's when a ledger on it carries the switch "ISD (Input
//      Service Distributor)" (b.map[name].isd, GST settings) or when Tally's registration type on it says "Input Service
//      Distributor" (GSTR.isISD). On the made-up client of tests/gst_cloud_world.js with the inward cases of
//      tests/gst_itc_world.js (the head office's ISD journal of September, IGST 5,400):
//        1. today's engine: September's 4(A)(4) IGST 5,400 and 4(A)(5) 5,400 less than without the switch; 4(A) total,
//           4(C), table 6 and every other box of every month as without it (by the switch, and by the type in Tally)
//        2. the GSTR-3B JSON for the portal (the app's GSTR.threeBJson): itc_avl ty "ISD" 5,400, "OTH" 5,400 less, itc_net
//           the same; the ledger's switch kept over a refresh of the ledger list
//        3. the cloud: the ISD entry's share is 4.isd (not 4.other), the context carries the switch; part A's and B's
//           sums of the shares are today's engine (engineSums), and every month's 3B by the month step (itcMonths, as
//           gst_itc_inputs gives its inputs) is today's engine's to the paisa (gst-run's parity)
//   B. GSTR-2B matching only in the financial years whose 2B is here. Two years: bills of February and March 2025
//      (2024-25) added, the March one in April 2025's 2B:
//        4. 2B only for 2025-26: neither 2024-25 bill is matched or "in the books, not in 2B" (noYear); the April 2B row
//           is then only in 2B; 2024-25's 3B takes them as booked (no 2B); the 2B reconciliation's year 2024-25 says
//           "No 2B here"; the cloud's month step reads only 2025-26's documents (twoBYms) and is today's engine's
//        5. a 2B of March 2025 brought in too: the March bill matches the April row of the other year (held in March,
//           taken in April), the February bill is in the books and not in 2B; the month step reads both years and is
//           today's engine's
// Made-up names and figures only (no real client); about 400 entries.
"use strict";
const path = require("path");
process.env.TZ = process.env.TZ || "Asia/Kolkata";
const {load, HTML} = require("./harness");
const {world} = require("./gst_cloud_world");
const {itc} = require("./gst_itc_world");
const ROOT = path.join(__dirname, "..");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "BookItems", "LedMaster", "Audit", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "GST9", "INR",
  "normName", "nameSim", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ", "GSTV", "GSTX"];
const app = load(HTML, NAMES), {x} = app;
const items = (work) => [...x.BookItems.split(JSON.parse(JSON.stringify(work))).values()].map((r) => ({key: r.k, item: r.i, ord: r.o == null ? null : r.o, data: r.d, deleted: false}));
const clone = (o) => JSON.parse(JSON.stringify(o));
const H = ["igst", "cgst", "sgst", "cess"], ISD = "Kestrel Head Office ISD";

(async () => {
  const eng = await import(path.join(ROOT, "server", "gst-run", "engine.js"));
  const E = await import(path.join(ROOT, "server", "_shared", "gst3b.js"));
  // the rows gst-run reads, of the made-up client (o.sw: the ISD ledger switched on; o.type: Tally's registration type on
  // the ISD's entry; o.fy24: bills of 2024-25 added; o.mar25: a 2B of March 2025 brought in too)
  function rowsOf(o){
    const w = world({seed: 171}), g = itc(w);
    if (o.sw) w.work.map[ISD] = Object.assign({}, w.work.map[ISD] || {}, {isd: {by: "made-up", at: "2026-11-12T00:00:00.000Z"}});
    if (o.type){ const h = w.heads.find((z) => z.guid === g.isd); Object.assign(h, {gst_reg_type: "Input Service Distributor", gst_alter_id: h.alter_id}); }
    const P = (n) => w.ledgers.find((l) => l.name === n), portalOf = (rp) => w.portal.find((j) => j.data.rtnprd === rp);
    const inv = (rp, P0, doc) => { const dd = portalOf(rp).data.docdata, l = dd.b2b = dd.b2b || []; let s = l.find((z) => z.ctin === P0.gstin); if (!s){ s = {ctin: P0.gstin, trdnm: P0.name.toUpperCase(), supfildt: "11-05-2025", inv: []}; l.push(s); } s.inv.push(doc); };
    let k = 0;
    const add = (day, party, ref, val, tax) => { const guid = "fy24-" + (++k), p = P(party);
      w.heads.push({guid, day, alter_id: 950000 + k, vtype: "Purchase", vno: "PUR/F" + k, party, narration: "Purchase (2024-25)", cancelled: false, optional: false, deleted_at: null, gstin: p.gstin, pos: "Delhi", ref, ref_date: day, cmp_gstin: w.OWN});
      [[party, val + 2 * tax], ["Purchases", -val, {hsn: "4802", rate: 18}], ["Input CGST", -tax], ["Input SGST", -tax]].forEach(([l, a, m]) => w.lines.push({guid, ledger: l, amount: a, hsn: (m && m.hsn) || null, rate: m && m.rate != null ? m.rate : null}));
      return guid; };
    if (o.fy24){
      g.mar = add("2025-03-20", "Alder Supply Co", "AS/MAR/9", 10000, 900);
      g.feb = add("2025-02-10", "Dunmore Traders", "DT-FEB-2", 5000, 450);
      inv("042025", P("Alder Supply Co"), {inum: "AS/MAR/9", dt: "20-03-2025", val: 11800, txval: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0, pos: "07", rev: "N", itcavl: "Y"});
    }
    if (o.mar25){
      w.portal.push({data: {gstin: w.OWN, rtnprd: "032025", gendt: "14-04-2025", docdata: {b2b: []}, docRejdata: {b2b: []}}});
      inv("032025", P("Elmstead Paper"), {inum: "EP-MAR-1", dt: "28-03-2025", val: 1180, txval: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0, pos: "07", rev: "N", itcavl: "Y"});
    }
    const twoBs = {};
    w.portal.forEach((j) => { const t = x.GST2B.fromJson(j); twoBs[t.gstin + "|" + t.period] = Object.assign(t, {source: "upload"}); });
    const work = Object.assign({}, w.work, {twoBs});
    const heads = w.heads.slice().sort((a, c) => a.day < c.day ? -1 : a.day > c.day ? 1 : a.guid < c.guid ? -1 : a.guid > c.guid ? 1 : 0);
    return {g, w, rows: {client: "cli-isd-172", co: w.co, book: Object.assign({}, w.book, {book_id: "bbbbbbbb-0172-4000-8000-000000000001", client_id: "cli-isd-172"}), heads, lines: w.lines, bills: w.bills,
      ledgers: w.ledgers, groups: w.groups, items: items(work), sales: w.sales, runs: {}, work}};
  }
  // the engine's calls on the books gst-run makes (S set as step sets it, nothing kept between calls)
  const inBooks = (rows, fn) => {
    const G = globalThis, was = {S: G.S, CO: G.CO};
    try {
      const S = {books: null, coId: rows.client, companies: {[rows.client]: Object.assign({}, rows.co, {id: rows.client})}, sales: {cid: rows.client, list: rows.sales}, gstYm: ""};
      G.S = S; G.CO = (c) => S.companies[c || S.coId];
      rows.made = null; S.books = eng.books(rows);
      E.GSTR._carry = null; E.GST2B._memo = null; E.GSTAdv._memo = null; E.GSTF._bills = null; E.GSTF._owe = null; E.M2B.st = {};
      return fn(S.books);
    } finally { Object.assign(G, was); Object.keys(was).forEach((k) => { if (was[k] === undefined) delete G[k]; }); }
  };
  const monthsOf = (rows) => inBooks(rows, () => E.GSTR.months());
  // the cloud's side in memory, as migrations 164 and 171 keep it: every entry's shares and document (engine.js shares on
  // the whole book's context), summed to months; what gst_itc_inputs gives (docs of yms only, when given: migration 172)
  const cloud = (rows) => {
    const ctx = eng.contextOf(rows), sh = eng.shares({client: rows.client, co: rows.co, heads: rows.heads, lines: rows.lines, bills: rows.bills}, ctx);
    const months = {};
    sh.shares.forEach((s) => { const l = months[s.ym] = months[s.ym] || [], key = [s.reg, s.sec, s.k1, s.k2, s.k3].join("\u0001"); let r = l.find((z) => z._k === key);
      if (!r){ r = {_k: key, reg: s.reg, sec: s.sec, k1: s.k1, k2: s.k2, k3: s.k3, n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0}; l.push(r); }
      r.n += s.n; ["taxable", "igst", "cgst", "sgst", "cess", "qty"].forEach((f) => { r[f] = Math.round(r[f] * 100 + Number(s[f] || 0) * 100) / 100; }); });
    return {ctx, sh, months};
  };
  const itcInputs = (C, rows, reg, yms) => {
    const live = rows.heads.filter((h) => !h.deleted_at), withL = new Set(rows.lines.filter((l) => l.ledger).map((l) => l.guid));
    const dated = live.filter((h) => withL.has(h.guid) || (h.cancelled && h.vno)).map((h) => String(h.day).replace(/-/g, "").slice(0, 6)).sort();
    const months = {}; Object.keys(C.months).forEach((ym) => { const m = C.months[ym].filter((r) => r.reg === reg); if (m.length) months[ym] = m; });
    const docs = C.sh.docs.filter((d) => d.doc && (d.doc_reg === reg || d.doc_reg === "") && (!yms || yms.includes(d.ym))).map((d) => ({guid: d.guid, doc: d.doc}))
      .sort((a, c) => String(a.doc.bookDate).localeCompare(String(c.doc.bookDate)) || (a.guid < c.guid ? -1 : 1));
    const nb = new Set(); C.sh.docs.forEach((d) => d.bills.forEach((b) => { if (b.nb && b.reg === reg) nb.add(b.l + "\u0001" + b.name); }));
    const bills = []; C.sh.docs.forEach((d) => d.bills.forEach((b, i) => { if (nb.has(b.l + "\u0001" + b.name)) bills.push({guid: d.guid, seq: i, rec: b}); }));
    bills.sort((a, c) => String(a.rec.date).localeCompare(String(c.rec.date)) || (a.guid < c.guid ? -1 : a.guid > c.guid ? 1 : 0) || a.seq - c.seq);
    const parties = new Set([...nb].map((k) => k.split("\u0001")[0])), on = new Map(live.filter((h) => !h.cancelled && !h.optional).map((h) => [h.guid, h])), mv = {};
    rows.lines.forEach((l) => { const h = on.get(l.guid); if (!h || !parties.has(l.ledger)) return; const ym = String(h.day).replace(/-/g, "").slice(0, 6), m = mv[l.ledger] = mv[l.ledger] || {}; m[ym] = (m[ym] || 0) + Math.round(Number(l.amount) * 100); });
    const moves = {}; Object.keys(mv).sort().forEach((l) => { moves[l] = Object.keys(mv[l]).sort().map((m) => [m, mv[l][m] / 100]); });
    return {first: dated[0] || null, last: dated[dated.length - 1] || null, gstins: Array.from(new Set(live.filter((h) => h.cmp_gstin).map((h) => String(h.cmp_gstin).toUpperCase()))).sort(),
      months, docs, bills, moves, carry: {}};
  };
  // every month: today's engine on the whole book against the month step on what the cloud keeps (gst-run's parity)
  const parity = (rows, C, label, yms) => {
    const all = monthsOf(rows), ref = eng.engineItc(rows, "07", all), inp = itcInputs(C, rows, "07", yms);
    const cl = eng.itcMonths(Object.assign({client: rows.client, co: rows.co, items: rows.items, ctx: C.ctx, sales: rows.sales, runs: rows.runs}, inp, {out: ref.out}), "07", all);
    let bad = 0, first = "";
    cl.months.forEach((m) => { const c = eng.itcCompare(ref.months[m.ym], m.result); if (!c.ok){ bad++; if (!first) first = m.ym + " " + JSON.stringify(c.diffs.slice(0, 3)); } });
    ok(!bad && cl.months.length === all.length, label + ": every box of " + all.length + " months' 3B by the month step (" + inp.docs.length + " documents read) is today's engine's" + (first ? " - " + first : ""));
    return {ref, cl, inp};
  };
  const sumOf = (o) => H.map((h) => Math.round(Number((o || {})[h] || 0) * 100) / 100);
  const same = (a, c) => JSON.stringify(sumOf(a)) === JSON.stringify(sumOf(c));
  const minus = (a, c) => H.map((h, i) => Math.round((sumOf(a)[i] - sumOf(c)[i]) * 100) / 100);

  console.log("== A. ISD credit in 4(A)(4)");
  const B0 = rowsOf({}), B1 = rowsOf({sw: true}), B2 = rowsOf({type: true});
  const all = monthsOf(B0.rows), e0 = eng.engineItc(B0.rows, "07", all).months, e1 = eng.engineItc(B1.rows, "07", all).months, e2 = eng.engineItc(B2.rows, "07", all).months;
  ok(sumOf(e0["202509"].isd).every((v) => v === 0) && all.every((m) => sumOf(e0[m].isd).every((v) => v === 0)), "1. without the switch: no ISD credit in any month (4(A)(4) zero; September's 5,400 in 4(A)(5), as before)");
  for (const [lab, e] of [["by the ledger's switch", e1], ["by Tally's registration type", e2]]){
    const s = e["202509"], z = e0["202509"];
    ok(JSON.stringify(sumOf(s.isd)) === JSON.stringify([5400, 0, 0, 0]) && s.isd.n === 1, "1. " + lab + ": September 4(A)(4) IGST 5,400 (" + sumOf(s.isd).join("/") + ")");
    ok(JSON.stringify(minus(z.other, s.other)) === JSON.stringify([5400, 0, 0, 0]), "1. " + lab + ": September 4(A)(5) 5,400 less (" + sumOf(z.other).join("/") + " -> " + sumOf(s.other).join("/") + ")");
    ok(same(s.itc, z.itc) && same(s.netItc, z.netItc) && JSON.stringify(s.pay) === JSON.stringify(z.pay), "1. " + lab + ": 4(A) total, 4(C) and table 6 as without it");
    const rest = (t) => JSON.stringify(t, (k, v) => (k === "isd" || k === "other") ? undefined : v);
    ok(all.every((m) => rest(e[m]) === rest(e0[m])) && all.every((m) => m === "202509" || m === "202603" || (same(e[m].other, e0[m].other) && same(e[m].isd, {}))),
      "1. " + lab + ": every other box of every month (" + all.length + ") as without it");
  }
  ok(sumOf(e1["202603"].isd).every((v) => v === 0) && e1["202603"].quarter, "1. the QRMP quarter (January to March 2026) adds its months' 4(A)(4): none");
  // 2. the JSON for the portal: the app's own GSTR.threeBJson on the same books (the app's copy of the engine)
  const json = (rows) => { const b = inBooks(rows, (bk) => clone(bk)); const S = app.ctx.S; S.books = b; S.coId = rows.client; S.companies = {[rows.client]: Object.assign({}, rows.co, {id: rows.client})}; app.ctx.CO = () => S.companies[rows.client];
    x.GSTR._carry = null; x.GST2B._memo = null; x.GSTAdv._memo = null; x.GSTF._bills = null; x.GSTF._owe = null; return x.GSTR.threeBJson("202509", "07"); };
  const j0 = json(B0.rows), j1 = json(B1.rows), av = (j, ty) => j.itc_elg.itc_avl.find((r) => r.ty === ty);
  ok(av(j0, "ISD").iamt === 0 && av(j1, "ISD").iamt === 5400 && av(j1, "ISD").camt === 0 && j1.itc_elg.itc_avl.map((r) => r.ty).join(",") === "IMPG,IMPS,ISRC,ISD,OTH", "2. the GSTR-3B JSON: itc_avl ty ISD IGST 5,400 (none without the switch), in the portal's order (" + j1.itc_elg.itc_avl.map((r) => r.ty).join(",") + ")");
  ok(Math.round((av(j0, "OTH").iamt - av(j1, "OTH").iamt) * 100) / 100 === 5400 && JSON.stringify(j0.itc_elg.itc_net) === JSON.stringify(j1.itc_elg.itc_net) && JSON.stringify(j0.sup_details) === JSON.stringify(j1.sup_details),
    "2. ty OTH 5,400 less (" + av(j0, "OTH").iamt + " -> " + av(j1, "OTH").iamt + "); itc_net and 3.1 the same");
  const t9 = x.GSTR.threeBm("202509", "07");
  ok(t9.isd && t9.isd.igst === 5400, "2. the app's own threeBm (its copy of the engine): 4(A)(4) 5,400");
  const kept = inBooks(B1.rows, (b) => { const m = E.Books.mapLedgers(b.vouchers, b.map); return !!(m[ISD] || {}).isd; });
  ok(kept && inBooks(B1.rows, () => E.GSTR.isdLedgers().join(",")) === ISD, "2. the switch is kept over a refresh of the ledger list (Books.mapLedgers), and GST settings lists it");
  // 3. the cloud
  const C0 = cloud(B0.rows), C1 = cloud(B1.rows), C2 = cloud(B2.rows);
  const of = (C, guid) => C.sh.shares.filter((s) => s.guid === guid);
  ok(of(C1, B1.g.isd).some((s) => s.sec === "4.isd" && s.igst === 5400) && !of(C1, B1.g.isd).some((s) => s.sec === "4.other") && of(C0, B0.g.isd).some((s) => s.sec === "4.other" && s.igst === 5400),
    "3. the ISD's entry: its share 4.isd IGST 5,400, not 4.other (4.other without the switch)");
  ok(!!(C1.ctx.map[ISD] || {}).isd && eng.ctxDiff(C0.ctx, C1.ctx).ledgers.includes(ISD), "3. the context carries the switch; switching it moves that ledger's entries (ctxDiff)");
  ok(of(C2, B2.g.isd).some((s) => s.sec === "4.isd" && s.igst === 5400), "3. by Tally's registration type too");
  for (const [lab, B, C] of [["switch", B1, C1], ["Tally's type", B2, C2], ["no ISD", B0, C0]]){
    const em = eng.engineMonth(B.rows, "202509", "07"), cs = eng.cloudSums(C.months["202509"], "07"), c = eng.compare(em.sums, cs);
    ok(c.ok && (lab === "no ISD" ? !em.sums.has(["07", "4.isd", "", "", ""].join("\u0001")) : em.sums.get(["07", "4.isd", "", "", ""].join("\u0001")).igst === 5400), "3. (" + lab + ") September's sums of the shares are today's engine's (engineSums), 4.isd among them" + (c.ok ? "" : ": " + JSON.stringify(c.diffs.slice(0, 3))));
  }
  const P1 = parity(B1.rows, C1, "3. (switch) gst-run's parity");
  ok(P1.cl.months.find((m) => m.ym === "202509").result.isd.igst === 5400, "3. the month step's September 4(A)(4): 5,400");
  parity(B2.rows, C2, "3. (Tally's type) gst-run's parity");

  console.log("== B. 2B matching only in the years whose 2B is here");
  const F1 = rowsOf({fy24: true}), F2 = rowsOf({fy24: true, mar25: true});
  const run1 = inBooks(F1.rows, () => { const r = E.GST2B.run("07"); return {r, t3: E.GSTR.threeBm("202503", "07"), t2: E.GSTR.threeBm("202502", "07"), t4: E.GSTR.threeBm("202504", "07")}; });
  const ids = (l) => new Set(l.map((d) => d.id)), r1 = run1.r, fy24 = [F1.g.mar, F1.g.feb];
  ok(fy24.every((g) => !ids(r1.books).has(g) && !ids(r1.onlyBooks).has(g) && !r1.pairs.some((x) => x.books.some((d) => d.id === g))) && fy24.every((g) => ids(r1.noYear).has(g)) && r1.noYear.length === 2,
    "4. 2B only for 2025-26: the February and March 2025 bills are neither matched nor in the books not in 2B (" + r1.noYear.length + " kept apart, noYear)");
  ok(r1.only2b.some((p) => p.no === "AS/MAR/9" && p.ym === "202504"), "4. so April 2025's row of the March bill is only in 2B");
  ok(run1.t3.basis === "no 2B" && run1.t3.held.n === 0 && run1.t3.other.cgst >= 900 && run1.t2.other.cgst >= 450 && run1.t4.released.n === 0, "4. 2024-25's 3Bs take the bills as booked (no 2B); April takes nothing of them");
  const rec = (rows) => { const b = inBooks(rows, (bk) => clone(bk)); app.ctx.S.books = b; x.GST2B._memo = null; const r = x.GST2B.run("07");
    return {noYear: r.noYear.map((d) => d.id), onlyBooks: r.onlyBooks.map((d) => d.id), y24: x.GSTX.twoBYear("07", "2024-25"), y25: x.GSTX.twoBYear("07", "2025-26")}; };
  const a1 = rec(F1.rows);
  ok(a1.noYear.length === 2 && !a1.onlyBooks.some((g) => fy24.includes(g)), "4. the app's own GST2B.run: the same");
  ok(a1.y24.loaded === null && !a1.y24.onlyBooks.length && a1.y25.loaded.length === 10, "4. the 2B reconciliation's year 2024-25: no 2B here (its screen says so), no bill listed as not in 2B; 2025-26 has its 2Bs (10: the QRMP quarter's)");
  const y1 = eng.twoBYms(F1.rows.items, "07");
  ok(y1.length === 12 && y1[0] === "202504" && y1[11] === "202603" && eng.twoBYms(F1.rows.items, "09").length === 0, "4. the cloud reads only 2025-26's documents (twoBYms: " + y1[0] + " to " + y1[y1.length - 1] + "; none for a registration with no 2B)");
  const CF1 = cloud(F1.rows);
  const pf = parity(F1.rows, CF1, "4. gst-run's parity, 2025-26's documents only", y1);
  ok(!pf.inp.docs.some((d) => fy24.includes(d.guid)) && CF1.sh.docs.some((d) => d.guid === F1.g.mar), "4. (the 2024-25 documents are kept by entry, and not read)");
  parity(F1.rows, CF1, "4. and with every document read (before migration 172): the same");
  const run2 = inBooks(F2.rows, () => { const r = E.GST2B.run("07"); return {r, t3: E.GSTR.threeBm("202503", "07"), t4: E.GSTR.threeBm("202504", "07")}; }), r2 = run2.r;
  const pm = r2.pairs.find((p) => p.books.some((d) => d.id === F2.g.mar));
  ok(pm && pm.p.no === "AS/MAR/9" && pm.p.ym === "202504" && pm.timing && pm.status === "matched" && !r2.noYear.length, "5. a 2B of March 2025 here too: the March bill matches April's row (the other year's), " + (pm ? pm.status + ", timing" : "none"));
  ok(ids(r2.onlyBooks).has(F2.g.feb), "5. the February bill is in the books, not in 2B");
  const a2 = rec(F2.rows);
  ok(a2.y24.loaded.join() === "202503" && a2.y24.onlyBooks.map((d) => d.id).join() === F2.g.feb, "5. the 2B reconciliation's year 2024-25: March's 2B here, the February bill listed as not in 2B");
  ok(run2.t3.basis === "2b" && run2.t3.held.list.some((d) => d.id === F2.g.mar) && run2.t4.released.list.some((d) => d.id === F2.g.mar), "5. March 2025's 3B holds the March bill back, April takes it (as before)");
  const y2 = eng.twoBYms(F2.rows.items, "07");
  ok(y2.length === 24 && y2[0] === "202404", "5. the cloud reads both years' documents (" + y2.length + " months)");
  parity(F2.rows, cloud(F2.rows), "5. gst-run's parity", y2);
  console.log(fails ? fails + " FAILED" : "all ok");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
