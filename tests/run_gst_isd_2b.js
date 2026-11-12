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
//   B. a year with no 2B (review of e9ebac1c7): the matching is the base's (every document against every 2B row); only
//      the report changes. 2024-25 entries added (tests/gst_itc_world.js fy24): a March bill in April 2025's 2B (M3), a
//      supplier's credit note of March in April's CDNR (H1), a March bill rejected in IMS in April's 2B (H2), a February
//      bill in no 2B:
//        4. 2B only for 2025-26: every box of every month is the base engine's; the three match as in the base; the
//           February bill is not "in the books, not in 2B" (noYear) and the year says "No 2B here"; gst-run's parity
//        5. a 2B of March 2025 too: the base's figures; the February bill is then in the books and not in 2B
//   C. M4: an ISD's documents on the 2B basis go to 4(A)(4): a branch with only the ISD's credit, booked in March, in
//      April's 2B: neither box negative, March 0/0, April 4(A)(4) 5,400; the JSON; the cloud's parity; the Final credit
//      for 3B (app/src/lib/itcFinal.js): the same, a decision on the ISD's line, an adjustment on the new 4(A)(4) line
//   D. M5: GSTX.unclaimed counts 4(A)(4) (and a filed 3B's ISD entry) as claimed
//   E. Tally's registration type "Input-Service-Distributor" (hyphens)
//   F. review of aba40df57 (B1): a credit note in 2B's ISD part (IGST 8,000, April 2025), not in Tally, and an April bill
//      (CGST and SGST 900): a 2B row is the ISD's only when the books say so (the supplier's ledger switched, or Tally's
//      type), as a booked document. No switch: every box of every month the base's (4(A)(4) 0, 4(A)(5) takes it off).
//      Switched: April's 4(A)(4) does not go below nothing (no ISD credit that month): the 8,000 stays in 4(A)(5), as
//      the base has it; the engine, the Final credit for 3B and gst-run's parity alike
//   G. third review of fe63bac61: the ISD by Tally's type only (no switch), a credit note of 3,000 in September's 2B ISD
//      part not in Tally: the engine and the cloud's month step both 4(A)(4) 2,400 (the context carries the GSTINs Tally
//      types ISD, isdTyped; ctxDiff moves the supplier's ledger when it changes); any typed entry makes the supplier's
//      other entries the ISD's too; no ISD: no isdTyped in the context
//   H. review of ee1fe32c5: the context kept, the first entry Tally types ISD comes in (a batch reports it: isdNew; the new
//      context moves the supplier's ledger, its entries of every month re-shared), then is deleted (and back); a GSTIN
//      changed in place in the app (the ledger read) followed
// Made-up names and figures only (no real client); about 400 entries.
"use strict";
const path = require("path");
process.env.TZ = process.env.TZ || "Asia/Kolkata";
const {load, HTML} = require("./harness");
const {world} = require("./gst_cloud_world");
const {itc, fy24, isdCn} = require("./gst_itc_world");
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
    if (o.fy24) Object.assign(g, fy24(w));
    if (o.cn) Object.assign(g, isdCn(w));
    if (o.isd2){   // a second distribution of the head office's, November, its entry with no type in Tally
      const h0 = w.heads.find((z) => z.guid === g.isd), h = Object.assign({}, h0, {guid: "isd-nov-1", day: "2025-11-28", ref: "ISD/25/071", ref_date: "2025-11-28", alter_id: 990101, vno: "JOU/N1", gst_reg_type: null, gst_alter_id: null});
      w.heads.push(h); w.lines.push({guid: h.guid, ledger: ISD, amount: 2000, hsn: null, rate: null}, {guid: h.guid, ledger: "Input IGST", amount: -2000, hsn: null, rate: null}); g.isd2 = h.guid; }
    if (o.delTyped){ const h = w.heads.find((z) => z.guid === g.isd); h.deleted_at = "2026-11-12T00:00:00Z"; }
    if (o.cnSep){ const dd = w.portal.find((j) => j.data.rtnprd === "092025").data.docdata, s0 = (dd.isd || []).find((z) => z.ctin === w.ledgers.find((l) => l.name === ISD).gstin);
      s0.doclist.push({doctyp: "C", docnum: "ISD/CN/25/009", docdt: "30-09-2025", igst: 3000, cgst: 0, sgst: 0, cess: 0, itcelg: "Y"}); }
    if (o.mar25){
      const P = (n) => w.ledgers.find((l) => l.name === n);
      w.portal.push({data: {gstin: w.OWN, rtnprd: "032025", gendt: "14-04-2025", docdata: {b2b: [{ctin: P("Elmstead Paper").gstin, trdnm: "ELMSTEAD PAPER", supfildt: "11-04-2025",
        inv: [{inum: "EP-MAR-1", dt: "28-03-2025", val: 1180, txval: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0, pos: "07", rev: "N", itcavl: "Y"}]}]}, docRejdata: {b2b: []}}});
    }
    if (o.only){   // a branch with only the ISD's credit: its journal booked in March 2025, 2B's ISD part in April's 2B
      const h = w.heads.find((z) => z.guid === g.isd), ls = w.lines.filter((l) => l.guid === g.isd);
      Object.assign(h, {day: "2025-03-28", ref_date: "2025-03-28"});
      // (and April's payment to the head office, so the books run to April)
      const pay = Object.assign({}, h, {guid: "isd-pay-1", day: "2025-04-15", alter_id: 990001, vtype: "Payment", vno: "PAY/1", ref: "", ref_date: null, narration: "Paid to the head office"});
      w.heads = [h, pay]; w.lines = ls.concat([{guid: pay.guid, ledger: ISD, amount: -5400, hsn: null, rate: null}, {guid: pay.guid, ledger: "Kestrel Bank", amount: 5400, hsn: null, rate: null}]); w.bills = [];
      const isdP = w.ledgers.find((l) => l.name === ISD);
      w.portal = [{data: {gstin: w.OWN, rtnprd: "032025", gendt: "14-04-2025", docdata: {b2b: []}, docRejdata: {b2b: []}}},
        {data: {gstin: w.OWN, rtnprd: "042025", gendt: "14-05-2025", docdata: {isd: [{ctin: isdP.gstin, trdnm: ISD.toUpperCase(), supfildt: "11-05-2025", doclist: [{doctyp: "I", docnum: "ISD/25/044", docdt: "28-03-2025", igst: 5400, cgst: 0, sgst: 0, cess: 0, itcelg: "Y"}]}]}, docRejdata: {b2b: []}}}];
      w.sales = [];
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
  { json(B1.rows); const d9 = x.GST9.build("2025", "07"), T9 = d9.T; x.GST9.typed("2025", "07")["6G"] = {igst: 100}; const T9b = x.GST9.build("2025", "07").T;
    json(B0.rows); const T90 = x.GST9.build("2025", "07").T;
    ok(T9["6G"].igst === 5400 && Math.round((T90["6B-is"].igst + T90["6B-in"].igst - T9["6B-is"].igst - T9["6B-in"].igst) * 100) / 100 === 5400 && JSON.stringify(sumOf(T9["6I"])) === JSON.stringify(sumOf(T90["6I"])),
      "2. GSTR-9: the ISD's 5,400 in 6G, out of 6B; 6I the same");
    ok(T9b["6G"].igst === 100 && T9b["6Gbooks"].igst === 5400, "2. GSTR-9: 6G typed (100) is kept as typed, the books' 5,400 its hint (not added)"); }
  json(B1.rows);
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

  console.log("== B. a year with no 2B: matched as before, not reported as not in 2B");
  // the base's engine (git, as tests/run_gst_share_same.js takes it) on the same rows: the figures must be its own
  const fsx = require("fs"), cpx = require("child_process"), BASE = process.env.GST_SAME_BASE || "origin/staging-next", BD = path.join(__dirname, "out", "isd-base");
  ["server/_shared/gst3b.js", "server/_shared/names.js", "server/_shared/gst3bprint.js", "server/gst-run/engine.js"].forEach((f) => { const o2 = path.join(BD, f); fsx.mkdirSync(path.dirname(o2), {recursive: true});
    fsx.writeFileSync(o2, cpx.execFileSync("git", ["show", BASE + ":" + f], {cwd: ROOT, maxBuffer: 64 << 20})); });
  fsx.writeFileSync(path.join(BD, "package.json"), JSON.stringify({type: "module"}));
  const engB = await import(path.join(BD, "server", "gst-run", "engine.js"));
  const noIsd = (o) => JSON.stringify(o, (k, v) => (k === "isd" || k === "engine" || k === "src") ? undefined : v);
  const F1 = rowsOf({fy24: true}), F2 = rowsOf({fy24: true, mar25: true});
  const allF = monthsOf(F1.rows), h1 = eng.engineItc(F1.rows, "07", allF).months, b1 = engB.engineItc(F1.rows, "07", allF).months;
  ok(allF.length === 14 && allF.every((m) => noIsd(h1[m]) === noIsd(b1[m])), "4. every box of all " + allF.length + " months (February 2025 to March 2026) is the base engine's: the matching is unchanged");
  const run1 = inBooks(F1.rows, () => { const r = E.GST2B.run("07"); return {r, t4: E.GSTR.threeBm("202504", "07")}; }), r1 = run1.r, ids = (l) => new Set(l.map((d) => d.id));
  const pairOf = (r, g) => r.pairs.find((x) => x.books.some((d) => d.id === g));
  ok(pairOf(r1, F1.g.mar) && pairOf(r1, F1.g.mar).p.no === "AS/MAR/9" && !r1.only2b.some((p) => p.no === "AS/MAR/9"), "M3. the March 2025 bill matches April's 2B row (not \"in 2B, not in the books\")");
  ok(pairOf(r1, F1.g.cnMar) && pairOf(r1, F1.g.cnMar).p.dir === -1 && !r1.only2b.some((p) => p.no === "GT-CN-MAR") && run1.t4.cn2b.list.every((p) => p.no !== "GT-CN-MAR") && run1.t4.cn2b.igst + run1.t4.cn2b.cgst === b1["202504"].cn2b.igst + b1["202504"].cn2b.cgst,
    "H1. the supplier's credit note booked in March 2025 matches April's CDNR: April takes nothing off for it (cn2b as the base: " + run1.t4.cn2b.n + ")");
  const rj = (r1.rejected || []).find((x) => x.p.no === "HS-REJ-3");
  ok(rj && rj.books.some((d) => d.id === F1.g.rejMar) && JSON.stringify(h1["202504"].held) === JSON.stringify(b1["202504"].held), "H2. the March 2025 bill rejected in IMS in April's 2B is found: its credit is held back in April, as the base does");
  ok(ids(r1.noYear).has(F1.g.feb) && r1.noYear.length === 1 && !ids(r1.onlyBooks).has(F1.g.feb), "4. the February 2025 bill, in no 2B and of a year with none: not \"in the books, not in 2B\" (kept apart, noYear)");
  const rec = (rows) => { const b = inBooks(rows, (bk) => clone(bk)); app.ctx.S.books = b; x.GST2B._memo = null; const r = x.GST2B.run("07");
    return {noYear: r.noYear.map((d) => d.id), onlyBooks: r.onlyBooks.map((d) => d.id), y24: x.GSTX.twoBYear("07", "2024-25"), y25: x.GSTX.twoBYear("07", "2025-26"), close: x.GSTX.yearEnd ? null : null}; };
  const a1 = rec(F1.rows);
  ok(a1.noYear.join() === F1.g.feb && !a1.onlyBooks.includes(F1.g.feb), "4. the app's own GST2B.run: the same");
  ok(a1.y24.loaded === null && !a1.y24.onlyBooks.length && a1.y25.loaded.length === 10 && !a1.y25.only2b.some((p) => p.no === "AS/MAR/9"),
    "4. the 2B reconciliation: 2024-25 \"No 2B here\", no bill of it listed as not in 2B; 2025-26 does not list April's row of the March bill as \"book this bill\"");
  parity(F1.rows, cloud(F1.rows), "4. gst-run's parity (every document read, as the matching needs)");
  const allF2 = monthsOf(F2.rows), h2 = eng.engineItc(F2.rows, "07", allF2).months, b2 = engB.engineItc(F2.rows, "07", allF2).months;
  const r2 = inBooks(F2.rows, () => E.GST2B.run("07"));
  ok(allF2.every((m) => noIsd(h2[m]) === noIsd(b2[m])) && ids(r2.onlyBooks).has(F2.g.feb) && !r2.noYear.length, "5. a 2B of March 2025 here too: every box the base's; the February bill is now in the books, not in 2B");
  const a2 = rec(F2.rows);
  ok(a2.y24.loaded.join() === "202503" && a2.y24.onlyBooks.map((d) => d.id).join() === F2.g.feb, "5. the 2B reconciliation's year 2024-25: March's 2B here, the February bill listed as not in 2B");
  parity(F2.rows, cloud(F2.rows), "5. gst-run's parity");

  console.log("== C. ISD documents on the 2B basis: in 4(A)(4)");
  const O0 = rowsOf({only: true}), O1 = rowsOf({only: true, sw: true}), allO = monthsOf(O1.rows);
  const o0 = eng.engineItc(O0.rows, "07", allO).months, o1 = eng.engineItc(O1.rows, "07", allO).months, mar = o1["202503"], apr = o1["202504"];
  ok(mar.basis === "2b" && mar.held.n === 1 && JSON.stringify(sumOf(mar.isd)) === "[0,0,0,0]" && JSON.stringify(sumOf(mar.other)) === "[0,0,0,0]",
    "M4. a branch with only the ISD's credit, booked in March, in April's 2B: March 4(A)(4) 0 (5,400 held back) and 4(A)(5) 0, neither negative (" + sumOf(mar.isd).join("/") + ", " + sumOf(mar.other).join("/") + ")");
  ok(JSON.stringify(sumOf(apr.isd)) === "[5400,0,0,0]" && JSON.stringify(sumOf(apr.other)) === "[0,0,0,0]" && apr.released.n === 1, "M4. April: 4(A)(4) 5,400 taken now, 4(A)(5) 0");
  ok(allO.every((m) => same(o1[m].itc, o0[m].itc) && same(o1[m].netItc, o0[m].netItc) && JSON.stringify(o1[m].pay) === JSON.stringify(o0[m].pay)) && JSON.stringify(sumOf(o0["202503"].other)) === "[0,0,0,0]",
    "M4. 4(A) total, 4(C) and table 6 as without the switch, every month");
  const jO = json(O1.rows), jM = (() => { const b = inBooks(O1.rows, (bk) => clone(bk)); app.ctx.S.books = b; x.GSTR._carry = null; x.GST2B._memo = null; return x.GSTR.threeBJson("202503", "07"); })();
  ok(av(jM, "OTH").iamt === 0 && av(jM, "ISD").iamt === 0, "M4. March's JSON: OTH 0 and ISD 0, not negative");
  parity(O1.rows, cloud(O1.rows), "M4. gst-run's parity of the branch (the document kept by its entry says ISD)");
  // the Final credit for 3B (app/src/lib/itcFinal.js, the wrap of threeBm) on the app's own engine in its own context
  const fin = load(HTML, NAMES), fx = fin.x, fc = fin.ctx, fsr = require("fs"), vmr = require("vm"), APP = path.join(ROOT, "app", "src", "lib");
  const strp = (f) => fsr.readFileSync(path.join(APP, f), "utf8").replace(/^import .*$/mg, "").replace(/^export (const|function|async function) /mg, "$1 ");
  fc.saveBooks = () => {}; fc.render = () => {}; fc.Cloud = {st: {email: "made-up@zz.test"}};
  vmr.runInContext("globalThis.__sync = (function(){" + strp("itcSync.js") + "\n; return {DECS, DEC_LABEL}; })();\n(function(){ const {DECS, DEC_LABEL} = globalThis.__sync;\n" + strp("itcFinal.js") + "\n})();", fc);
  const ITCF = fc.ITCF, Adj = fc.ITCAdj;
  { const b = inBooks(O1.rows, (bk) => clone(bk)); fc.S.books = b; fc.S.coId = O1.rows.client; fc.S.companies = {[O1.rows.client]: Object.assign({}, O1.rows.co, {id: O1.rows.client})}; fc.CO = () => fc.S.companies[O1.rows.client]; }
  const TF = (ym) => { fx.GSTR._carry = null; fx.GST2B._memo = null; return fx.GSTR.threeBm(ym, "07"); };
  let fm = TF("202503"), fa = TF("202504");
  ok(JSON.stringify(sumOf(fm.isd)) === "[0,0,0,0]" && JSON.stringify(sumOf(fm.other)) === "[0,0,0,0]" && JSON.stringify(sumOf(fa.isd)) === "[5400,0,0,0]" && JSON.stringify(sumOf(fa.other)) === "[0,0,0,0]",
    "M4. Final credit for 3B, nothing decided: March 4(A)(4) 0 and 4(A)(5) 0, April 4(A)(4) 5,400 (" + sumOf(fm.isd).join("/") + " " + sumOf(fm.other).join("/") + " | " + sumOf(fa.isd).join("/") + ")");
  const ln = ITCF.rows("07").find((r) => (r.docs || []).some((d) => d.id === O1.g.isd));
  ITCF.decide("07", [ln], "booksnow", "202503", "202503");
  fm = TF("202503"); fa = TF("202504");
  ok(JSON.stringify(sumOf(fm.isd)) === "[5400,0,0,0]" && JSON.stringify(sumOf(fm.other)) === "[0,0,0,0]" && JSON.stringify(sumOf(fa.isd)) === "[0,0,0,0]" && JSON.stringify(sumOf(fa.other)) === "[0,0,0,0]",
    "M4. the ISD's line taken in March as booked (a decision): March 4(A)(4) 5,400, April nothing; 4(A)(5) 0 both months");
  const sv = Adj.save("07", "202504", {line: "4A4", head: "igst", amt: "100", reason: "made-up ISD adjustment"});
  fa = TF("202504");
  ok(sv.ok && sumOf(fa.isd)[0] === 100 && sumOf(fa.itc)[0] === 100 && fx.GSTR && ITCF.LINES.some(([k]) => k === "4A4") && ITCF.table4("07", "202504").lines.find(([k]) => k === "4A4")[1].igst === 100,
    "M4. an adjustment on 4(A)(4) (the new line): April 4(A)(4) 100, in 4(A) and table 4");
  console.log("== D. credit available in 2B and not claimed (GSTX.unclaimed)");
  const unc = (rows, filed) => { const b = inBooks(rows, (bk) => clone(bk)); if (filed) b.filed3b = {[rows.w.OWN + "|202504"]: {json: {itc_elg: {itc_avl: [{ty: "OTH", iamt: 0, camt: 0, samt: 0, csamt: 0}, {ty: "ISD", iamt: 5400, camt: 0, samt: 0, csamt: 0}]}}}};
    app.ctx.S.books = b; x.GSTR._carry = null; x.GST2B._memo = null; return x.GSTX.unclaimed("07", "202504"); };
  O1.rows.w = O1.w;
  const u1 = unc(O1.rows, false), u2 = unc(O1.rows, true);
  ok(u1 && u1.total === 0 && u2 && u2.total === 0 && u2.source === "3B from the portal", "M5. the ISD's 5,400 in April's 2B: not \"unclaimed\", from FinCom's working (4(A)(4)) and from a filed 3B's ISD entry (" + (u1 && u1.total) + ", " + (u2 && u2.total) + ")");
  console.log("== F. a credit note in 2B's ISD part, not in Tally");
  { const N0 = rowsOf({cn: true}), N1 = rowsOf({cn: true, sw: true}), N2 = rowsOf({cn: true, type: true}), allN = monthsOf(N0.rows);
    const n0 = eng.engineItc(N0.rows, "07", allN).months, nb = engB.engineItc(N0.rows, "07", allN).months, n1 = eng.engineItc(N1.rows, "07", allN).months, n2 = eng.engineItc(N2.rows, "07", allN).months;
    const A0 = n0["202504"], AB = nb["202504"];
    ok(AB.cn2b.igst === 8000 && allN.every((m) => noIsd(n0[m]) === noIsd(nb[m]) && n0[m].isdAdj === undefined && sumOf(n0[m].isd).every((v) => v === 0)),
      "F. no switch: every box of all " + allN.length + " months is the base engine's; 4(A)(4) 0 every month; April's 4(A)(5) " + sumOf(A0.other).join("/") + " as the base's " + sumOf(AB.other).join("/"));
    for (const [lab, e] of [["switched", n1], ["Tally's type", n2]]){
      const a = e["202504"];
      ok(sumOf(a.isd).every((v) => v >= 0) && JSON.stringify(sumOf(a.isd)) === "[0,0,0,0]" && same(a.other, AB.other) && same(a.itc, AB.itc) && JSON.stringify(a.pay) === JSON.stringify(AB.pay),
        "F. " + lab + ": April 4(A)(4) never below nothing (" + sumOf(a.isd).join("/") + "), the 8,000 stays in 4(A)(5) (" + sumOf(a.other).join("/") + "), as the base");
      ok(allN.every((m) => same(e[m].itc, nb[m].itc) && same(e[m].netItc, nb[m].netItc)) && sumOf(e["202509"].isd)[0] === 5400, "F. " + lab + ": 4(A) total and 4(C) the base's every month; September's ISD 5,400 still in 4(A)(4)");
    }
    parity(N0.rows, cloud(N0.rows), "F. (no switch) gst-run's parity");
    parity(N1.rows, cloud(N1.rows), "F. (switched) gst-run's parity");
    const FF = load(HTML, NAMES), ffx = FF.x, ffc = FF.ctx;
    ffc.saveBooks = () => {}; ffc.render = () => {}; ffc.Cloud = {st: {email: "made-up@zz.test"}};
    vmr.runInContext("globalThis.__sync = (function(){" + strp("itcSync.js") + "\n; return {DECS, DEC_LABEL}; })();\n(function(){ const {DECS, DEC_LABEL} = globalThis.__sync;\n" + strp("itcFinal.js") + "\n})();", ffc);
    for (const [lab, R0, e] of [["no switch", N0, n0], ["switched", N1, n1]]){
      const b = inBooks(R0.rows, (bk) => clone(bk)); ffc.S.books = b; ffc.S.coId = R0.rows.client; ffc.S.companies = {[R0.rows.client]: Object.assign({}, R0.rows.co, {id: R0.rows.client})}; ffc.CO = () => ffc.S.companies[R0.rows.client];
      ffx.GSTR._carry = null; ffx.GST2B._memo = null; const t = ffx.GSTR.threeBm("202504", "07");
      ok(JSON.stringify(sumOf(t.isd)) === "[0,0,0,0]" && same(t.other, e["202504"].other) && same(t.itc, e["202504"].itc), "F. Final credit for 3B (" + lab + "): April 4(A)(4) " + sumOf(t.isd).join("/") + ", 4(A)(5) " + sumOf(t.other).join("/") + " as the engine");
    }
    const ln = (() => { const b = inBooks(N0.rows, (bk) => clone(bk)); ffc.S.books = b; ffx.GST2B._memo = null; return ffc.ITCF.excelData("07", "202504").rows.find((r) => r.no === "ISD/CN/25/007"); })();
    ok(ln && ln.line === "4A5", "F. the Excel's line of the credit note with no switch: 4(A)(5) (" + (ln && ln.line) + ")");
  }
  console.log("== G. the ISD by Tally's type only, a 2B credit note in a month with ISD credit");
  { const T1 = rowsOf({type: true, cnSep: true}), allT = monthsOf(T1.rows), t1 = eng.engineItc(T1.rows, "07", allT).months, CT = cloud(T1.rows);
    ok(JSON.stringify(sumOf(t1["202509"].isd)) === "[2400,0,0,0]", "G. the engine: September 4(A)(4) 5,400 less the 3,000 credit note: " + sumOf(t1["202509"].isd).join("/"));
    ok(JSON.stringify(CT.ctx.isdTyped) === JSON.stringify([T1.w.ledgers.find((l) => l.name === ISD).gstin]) && !("isdTyped" in C0.ctx) && !("isdTyped" in C1.ctx), "G. the context carries the GSTIN Tally types ISD (isdTyped); none without the type");
    ok(eng.ctxDiff(C0.ctx, CT.ctx).ledgers.includes(ISD) && !eng.ctxDiff(C0.ctx, C0.ctx).ledgers.length, "G. Tally's type coming in moves the supplier's ledger (ctxDiff)");
    const PT = parity(T1.rows, CT, "G. gst-run's parity (Tally's type only)");
    ok(PT.cl.months.find((m) => m.ym === "202509").result.isd.igst === 2400, "G. the month step's September 4(A)(4): 2,400, as the engine");
    ok(inBooks(T1.rows, () => E.GSTR.isISD({party: ISD, regType: "", ent: []})) && !inBooks(B0.rows, () => E.GSTR.isISD({party: ISD, regType: "", ent: []})), "G. an entry of a supplier Tally types ISD elsewhere is the ISD's too; with no type, not");
  }
  console.log("== H. the context kept: the first entry Tally types ISD comes in, then is deleted");
  { const K0 = rowsOf({isd2: true}), K1 = rowsOf({isd2: true, type: true}), K2 = rowsOf({isd2: true, type: true, delTyped: true});
    const c0 = eng.contextOf(K0.rows), c1 = eng.contextOf(K1.rows), c2 = eng.contextOf(K2.rows), gst = K1.w.ledgers.find((l) => l.name === ISD).gstin;
    const batch = (R, guids) => { const S0 = new Set(guids); return {client: R.rows.client, co: R.rows.co, heads: R.rows.heads.filter((h) => S0.has(h.guid)), lines: R.rows.lines.filter((l) => S0.has(l.guid)), bills: R.rows.bills.filter((x) => S0.has(x.guid))}; };
    const moved = (R, d) => { const L = new Set(d.ledgers); return [...new Set(R.rows.heads.filter((h) => L.has(h.party)).map((h) => h.guid).concat(R.rows.lines.filter((l) => L.has(l.ledger)).map((l) => l.guid)))].sort(); };
    const secOf = (sh, guid) => sh.shares.filter((x) => x.guid === guid && /^4\.(isd|other)$/.test(x.sec)).map((x) => x.sec + ":" + x.igst).join(",");
    const rIn = eng.shares(batch(K1, [K1.g.isd]), c0);
    ok(JSON.stringify(rIn.isdNew) === JSON.stringify([gst]) && !eng.shares(batch(K0, [K0.g.isd]), c0).isdNew.length, "H. the typed entry in a batch on the kept context: reported (isdNew " + rIn.isdNew.join() + "), so the context is made again; untyped: not");
    const d1 = eng.ctxDiff(c0, c1), m1 = moved(K1, d1);
    ok(d1.ledgers.includes(ISD) && m1.includes(K1.g.isd) && m1.includes(K1.g.isd2), "H. the new context moves the supplier's ledger: both its entries (September and November) are due (" + m1.length + ")");
    const s1 = eng.shares(batch(K1, m1), c1), full1 = eng.shares(batch(K1, K1.rows.heads.map((h) => h.guid)), c1);
    ok(secOf(s1, K1.g.isd2) === "4.isd:2000" && secOf(s1, K1.g.isd) === "4.isd:5400" && m1.every((gd) => secOf(s1, gd) === secOf(full1, gd)), "H. re-shared: November's untyped entry of that supplier now 4.isd (" + secOf(s1, K1.g.isd2) + "), as the whole book's");
    ok(JSON.stringify(c2.isdTyped || null) === "null", "H. the typed entry deleted: the context lists no ISD GSTIN");
    const d2 = eng.ctxDiff(c1, c2), m2 = moved(K2, d2), s2 = eng.shares(batch(K2, m2), c2), s0 = eng.shares(batch(K0, [K0.g.isd2]), c0);
    ok(d2.ledgers.includes(ISD) && m2.includes(K2.g.isd2) && secOf(s2, K2.g.isd2) === "4.other:2000" && secOf(s2, K2.g.isd2) === secOf(s0, K0.g.isd2), "H. and back: the ledger moves again, November's entry 4.other (" + secOf(s2, K2.g.isd2) + "), as before the type");
    parity(K1.rows, cloud(K1.rows), "H. gst-run's parity, the type in");
    parity(K2.rows, cloud(K2.rows), "H. gst-run's parity, the typed entry deleted");
    // the app: the ledger read (ledRead) changes the GSTINs in place; the typed suppliers' GSTINs follow
    const bk = inBooks(K1.rows, (b) => { const was = E.GSTR.isdTypedList(b).join(); const keep = b.gstins[ISD]; b.gstins[ISD] = "06AAKCS4821Q2ZX"; const now = E.GSTR.isdTypedList(b).join(); b.gstins[ISD] = keep; return [was, now]; });
    ok(bk[0] === gst && bk[1] === "06AAKCS4821Q2ZX", "H. a GSTIN changed in place (the ledger read): the typed list follows (" + bk.join(" -> ") + ")");
  }
  console.log("== E. Tally's registration type, written with hyphens");
  ok(inBooks(O0.rows, () => E.GSTR.isISD({regType: "Input-Service-Distributor", ent: []}) && E.GSTR.isISD({regType: "input service distributor", ent: []}) && !E.GSTR.isISD({regType: "Regular", ent: []})), "\"Input-Service-Distributor\" is an ISD's too; \"Regular\" is not");
  console.log(fails ? fails + " FAILED" : "all ok");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
