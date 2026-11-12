// node tests/run_gst_share.js - next-gst-share (GST part A, shadow; migration 164): each entry's GST share
// (entryShares, server/_shared/gst3b.js, through server/gst-run/engine.js's shares) summed month by month is today's engine,
// to the paisa, for every section and month: 3B 3.1 (sale, credit notes, zero rated, nil and exempt, non-GST, reverse
// charge) and 3.2 (to unregistered, by place of supply), GSTR-1 B2B, B2CL, B2C (and B2CS by rate), CDNR + DBNR, EXP, NIL,
// HSN (with its b2b / b2c halves). Made-up books only (tests/gst_cloud_world.js and entries added here; no real client):
//   1. the made-up client (and a larger made-up book, at most 100,000 entries), its shares worked out in batches of 3000
//      on the whole book's context (ctxOf), as share_sweep does: every month of registration 07 and of all registrations
//   2. changes, each followed as the sweep follows it (only the entries it marks are worked out again; the rest of the
//      shares stay as kept): an entry edited (a later AlterID), one deleted, one cancelled, a ledger's GST setting
//      changed in FinCom's ledger list (the context moves: the entries on that ledger), the B2C summary switch on a party
//      ledger, a place of supply typed under GST > What to fix (gstPosFix: that entry), a ledger renamed (its lines
//      rewritten, the AlterID the same: its days dirty)
//   3. the existing callers unchanged: GSTR.outward / inward give the same rows as the rows entryShares reads (outRow /
//      inRow), and threeBm's 3.1/3.2 are GSTR.sec31's
//   5. part B (migration 171): the input tax credit side on the made-up client with the inward cases of
//      tests/gst_itc_world.js (an import of goods and of services, reverse charge, ISD, 17(5), a GST-ineligible ledger,
//      suppliers' credit notes in and not in 2B, no-tax inward for table 5, a bill held and released by 2B), its 2Bs and
//      gst-2b-match's AI pair: each entry's part B sections, document and allocations; every month's 3B by the month step
//      (engine.js itcMonths, on the sums, documents, allocations, suppliers' movement and the credit carried, as
//      gst_itc_inputs gives them) against today's engine on the whole book (engineItc): every box of tables 4, 5 and 6
//      (and 3.1/3.2) to the paisa, month by month in order, from the credit kept, and from nothing kept; a difference left
//      in on purpose is seen; a decision on 2B taken (nothing swept again), an inward entry edited and one deleted; a
//      larger book with 2B (GST_ITC_SCALE, default 120: about 4,400 entries; never above 100,000). The existing callers'
//      outputs are byte for byte as before (the refactor of threeBm, bookDocs, GSTF.bills / owing, GSTRev).
// Writes tests/out/gst-share-parity.json (the shares and the month sums) for tests/run_migration164.py, which puts the
// same shares through migration 164's SQL and checks gst_month's sums against these, and tests/out/gst-share-rows.json
// (the made-up client's rows) for tests/run_gst_share_deno.ts; and for part B tests/out/gst-itc-inputs.json (the part B
// client's rows, documents and what gst_itc_inputs is to give) for tests/run_migration164.py (section 9) and
// tests/out/gst-itc-rows.json for tests/run_gst_share_deno.ts.
// GST_SHARE_SCALE: the larger book's scale (default 1110: about 40,000 entries; never above 100,000 entries).
"use strict";
const fs = require("fs"), path = require("path");
process.env.TZ = process.env.TZ || "Asia/Kolkata";
const {load, HTML} = require("./harness");
const {world} = require("./gst_cloud_world");
const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, {recursive: true});
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const CLIENT = "cli-syn-164";
const app = load(HTML, ["BookItems", "GST2B"]), {x} = app;
const {itc} = require("./gst_itc_world");
const items = (work) => [...x.BookItems.split(JSON.parse(JSON.stringify(work))).values()].map(r => ({key: r.k, item: r.i, ord: r.o == null ? null : r.o, data: r.d, deleted: false}));
const clone = (o) => JSON.parse(JSON.stringify(o));

(async () => {
  const eng = await import(path.join(ROOT, "server", "gst-run", "engine.js"));
  const E = await import(path.join(ROOT, "server", "_shared", "gst3b.js"));
  // the books' rows (as gst-run's load gives them) of a made-up world, with entries added for the cases below
  function rowsOf(w, extra){
    const heads = w.heads.slice(), lines = w.lines.slice(), bills = w.bills.slice();
    let k = 0;
    const add = (day, vtype, party, ls, h) => { const guid = "add-164-" + (++k); heads.push(Object.assign({guid, day, alter_id: 900000 + k, vtype, vno: vtype.slice(0, 3).toUpperCase() + "/A" + k, party, narration: vtype, cancelled: false, optional: false,
      deleted_at: null, gstin: "", pos: "", ref: "", ref_date: null, cmp_gstin: w.OWN}, h || {})); ls.forEach(([l, a, m]) => lines.push({guid, ledger: l, amount: a, hsn: (m && m.hsn) || null, rate: m && m.rate != null ? m.rate : null})); return guid; };
    if (extra){
      // an inter-state sale to an unregistered buyer with no place of supply (3.2 "00" until one is typed), above B2C large's limit
      extra.noPos = add("2025-08-12", "Sales", "Walk-in Customers", [["Walk-in Customers", -141600], ["Sales - Goods", 120000, {hsn: "8471", rate: 18}], ["Output IGST", 21600]]);
      // a B2C summary numbered as a range (B2CS, not B2C large), inter-state to Uttar Pradesh
      extra.range = add("2025-09-03", "Sales", "Walk-in Customers", [["Walk-in Customers", -236000], ["Sales - Services", 200000, {hsn: "9983", rate: 18}], ["Output IGST", 36000]], {vno: "WEB/155 to WEB/182", pos: "Uttar Pradesh"});
      // a credit note to an unregistered inter-state buyer (3.2 taken off)
      extra.cnU = add("2025-09-20", "Credit Note", "Walk-in Customers", [["Walk-in Customers", 11800], ["Sales - Goods", -10000, {hsn: "8471", rate: 18}], ["Output IGST", -1800]], {pos: "Uttar Pradesh"});
      // a debit note raised on a customer (R1 DBNR)
      extra.dn = add("2025-10-07", "Debit Note", "Birchwood Retail", [["Birchwood Retail", -5900], ["Sales - Goods", 5000, {hsn: "8471", rate: 18}], ["Output CGST", 450], ["Output SGST", 450]], {gstin: "07AABCB7310K1Z2", pos: "Delhi"});
      // a non-GST sale and a nil-rated one
      // a party whose name came from Tally with its "&" escaped (the copy keeps it so: tally_nm takes out line breaks only)
      extra.amp = add("2025-11-09", "Sales", "Oak &amp; Fern Traders", [["Oak &amp; Fern Traders", -11800], ["Sales - Goods", 10000, {hsn: "8471", rate: 18}], ["Output CGST", 900], ["Output SGST", 900]], {pos: "Delhi"});
      extra.ng = add("2025-11-04", "Sales", "Birchwood Retail", [["Birchwood Retail", -8000], ["Sales - Exempt", 8000]], {gstin: "07AABCB7310K1Z2", pos: "Delhi", gst_taxability: "Non-GST", gst_alter_id: 900099});
      // next-fix-b2cs-gstin (added last, so the entries above keep their GUIDs, which tests/run_migration164.py picks by
      // place): a B2C summary numbered as a range with a (made-up) payment gateway's GSTIN on the voucher, IGST, Tally's place of
      // supply Karnataka: still B2CS under 29 (not B2B to the gateway, not the gateway's state 27), and in 3.2
      extra.rangeG = add("2025-09-05", "Sales", "PayGate Ltd", [["PayGate Ltd", -118000], ["Sales - Services", 100000, {hsn: "9983", rate: 18}], ["Output IGST", 18000]], {vno: "PG/301 to     PG/340", pos: "Karnataka", gstin: "27AAFCP4821K1Z8"});
    }
    const ledgers = extra ? w.ledgers.concat([{name: "Oak &amp; Fern Traders", parent: "Sundry Debtors", open: 0, gstin: "07AACCO1234F1Z5"}, {name: "PayGate Ltd", parent: "Sundry Debtors", open: 0, gstin: "27AAFCP4821K1Z8"}]) : w.ledgers;
    return {client: CLIENT, co: w.co, book: Object.assign({}, w.book, {book_id: "bbbbbbbb-0164-4000-8000-000000000001", client_id: CLIENT}), heads, lines, bills, ledgers, groups: w.groups,
      items: items(w.work), sales: [], runs: {}, work: w.work};
  }
  // the cloud's side, in memory as migration 164 keeps it: gst_share by entry, summed to a month (paise, as numeric adds)
  const store = () => ({share: new Map(), docs: new Map(), ctx: null});
  const sweep = (st, rows, guids) => {
    const want = new Set(guids), pick = (l) => l.filter((z) => want.has(String(z.guid)));
    const list = [...want];
    for (let i = 0; i < list.length; i += 3000){
      const g = new Set(list.slice(i, i + 3000)), sub = (l) => l.filter((z) => g.has(String(z.guid)));
      const r = eng.shares({client: rows.client, co: rows.co, heads: sub(rows.heads), lines: sub(rows.lines), bills: sub(rows.bills)}, st.ctx);
      if (r.unknown.length) throw new Error("ledgers not in the context: " + r.unknown.join(", "));
      g.forEach((id) => { st.share.delete(id); st.docs.delete(id); });
      r.shares.forEach((s) => { const a = st.share.get(s.guid) || []; a.push(s); st.share.set(s.guid, a); });
      r.docs.forEach((d) => st.docs.set(d.guid, d));
    }
    return pick(rows.heads).length;
  };
  const month = (st, ym) => {
    const m = new Map();
    st.share.forEach((list) => list.forEach((s) => { if (s.ym !== ym) return;
      const k = [s.reg, s.sec, s.k1, s.k2, s.k3].join("\u0001"), x = m.get(k) || {reg: s.reg, sec: s.sec, k1: s.k1, k2: s.k2, k3: s.k3, n: 0, p: {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0}};
      x.n += s.n; Object.keys(x.p).forEach((f) => { x.p[f] += Math.round(Number(s[f] || 0) * 100); }); m.set(k, x); }));
    return [...m.values()].map((x) => Object.assign({reg: x.reg, sec: x.sec, k1: x.k1, k2: x.k2, k3: x.k3, n: x.n}, Object.fromEntries(Object.entries(x.p).map(([f, v]) => [f, v / 100]))));
  };
  const monthsOf = (rows) => Array.from(new Set(rows.heads.map((h) => String(h.day).replace(/-/g, "").slice(0, 6)))).sort();
  // every month, registration 07 and all: the sums against today's engine on the whole book
  const parity = (st, rows, label) => {
    rows.made = null;
    const b = eng.engineMonth(rows, monthsOf(rows)[0], "07").books;
    let bad = 0, figs = 0, first = null;
    monthsOf(rows).forEach((ym) => ["07", ""].forEach((reg) => {
      const e = eng.engineMonth(rows, ym, reg, {books: b}), c = eng.compare(e.sums, eng.cloudSums(month(st, ym), reg));
      figs += e.sums.size;
      if (!c.ok){ bad++; if (!first) first = ym + "/" + (reg || "all") + " " + JSON.stringify(c.diffs.slice(0, 3)); }
    }));
    ok(!bad, label + ": every section of every month (" + monthsOf(rows).length + " months x 2, " + figs + " figure rows) the engine's to the paisa" + (first ? " - " + first : ""));
    return b;
  };
  const touching = (rows, ledgers) => { const L = new Set(ledgers); return Array.from(new Set(rows.lines.filter((l) => L.has(l.ledger)).map((l) => l.guid).concat(rows.heads.filter((h) => L.has(h.party)).map((h) => h.guid)))); };
  // a change to the context: made again from the whole book, the entries it moves worked out again (as share_sweep)
  // (books() keeps the entries it made on rows.made: a change to the rows makes them again, as a new load would)
  const reCtx = (st, rows) => { rows.made = null; const c = eng.contextOf(rows), d = eng.ctxDiff(st.ctx, c); st.ctx = c; return d; };

  console.log("== 1. the made-up client: its shares in batches, against the engine");
  const extra = {};
  let rows = rowsOf(world({seed: 164}), extra);
  const st = store(); st.ctx = eng.contextOf(rows);
  sweep(st, rows, rows.heads.map((h) => h.guid));
  ok(st.share.size > 50, "shares kept for " + st.share.size + " of " + rows.heads.length + " entries");
  const secs = new Set(); st.share.forEach((l) => l.forEach((s) => secs.add(s.sec)));
  ok(["3B.sale", "3B.cn", "3B.zero", "3B.nil", "3B.nongst", "3B.rcm", "3B.unreg", "3B.pos", "R1.B2B", "R1.B2CL", "R1.B2C", "R1.B2CS", "R1.CDNR", "R1.DBNR", "R1.EXP", "R1.NIL", "R1.HSN"].every((s) => secs.has(s)),
    "every section is reached by some entry: " + [...secs].sort().join(" "));
  const sh = (id) => st.share.get(id) || [];
  ok(sh(extra.noPos).some((s) => s.sec === "3B.pos" && s.k1 === "00") && sh(extra.noPos).some((s) => s.sec === "R1.B2CL"), "IGST to an unregistered buyer, no place of supply: 3.2 under 00, GSTR-1 B2C large");
  ok(sh(extra.range).some((s) => s.sec === "R1.B2C") && sh(extra.range).some((s) => s.sec === "R1.B2CS" && s.k1 === "18" && s.k2 === "09") && !sh(extra.range).some((s) => s.sec === "R1.B2CL"),
    "a B2C summary numbered as a range: B2CS (rate 18, place 09), never B2C large");
  ok(sh(extra.rangeG).some((s) => s.sec === "R1.B2CS" && s.k1 === "18" && s.k2 === "29") && !sh(extra.rangeG).some((s) => s.sec === "R1.B2B" || s.sec === "R1.B2CL") && sh(extra.rangeG).some((s) => s.sec === "3B.pos" && s.k1 === "29")
    && sh(extra.rangeG).some((s) => s.sec === "R1.HSN" && s.k3 === "b2c"), "a B2C summary with the gateway's GSTIN on it: B2CS (rate 18, place 29, not the GSTIN's 27), 3.2 under 29, HSN b2c; never B2B");
  ok(sh(extra.cnU).some((s) => s.sec === "3B.pos" && s.k1 === "09" && s.taxable === -10000), "a credit note to an unregistered inter-state buyer takes 3.2 off (-10,000 under 09)");
  const cancelled = rows.heads.filter((h) => h.cancelled || h.optional || h.deleted_at);
  ok(cancelled.length >= 2 && cancelled.every((h) => !st.share.has(h.guid)), "the cancelled, optional and deleted entries have no share (" + cancelled.length + ")");
  parity(st, rows, "the made-up client");

  console.log("== 2. changes, followed as the sweep follows them");
  const keep = clone([...st.share.entries()]);
  // an entry edited in Tally (a later AlterID): only it worked out again
  {
    const h = rows.heads.find((z) => z.vtype === "Sales" && z.gstin && !z.cancelled && !z.deleted_at && rows.lines.some((l) => l.guid === z.guid && l.ledger === "Output CGST"));
    h.alter_id += 1000;
    rows.lines.filter((l) => l.guid === h.guid).forEach((l) => { if (/^Sales/.test(l.ledger)) l.amount = Math.round((l.amount + 10000) * 100) / 100; if (l.ledger === "Output CGST" || l.ledger === "Output SGST") l.amount = Math.round((l.amount + 900) * 100) / 100; if (l.ledger === h.party) l.amount = Math.round((l.amount - 11800) * 100) / 100; });
    rows.bills.filter((z) => z.guid === h.guid).forEach((z) => { z.amount = Math.round((z.amount - 11800) * 100) / 100; });
    const d = reCtx(st, rows);
    sweep(st, rows, [h.guid].concat(touching(rows, d.ledgers), d.guids));
    parity(st, rows, "an entry edited (" + h.vno + ", 10,000 more)" + (d.ledgers.length ? "; its usage moved the guesses of " + d.ledgers.join(", ") : ""));
  }
  // one deleted, one cancelled
  {
    const del = rows.heads.find((z) => z.vtype === "Purchase" && !z.deleted_at && st.share.has(z.guid) && sh(z.guid).length === 0) || rows.heads.find((z) => z.vtype === "Sales" && !z.deleted_at && !z.cancelled && sh(z.guid).length);
    del.deleted_at = "2026-01-05T10:00:00Z";
    const can = rows.heads.find((z) => z.vtype === "Credit Note" && !z.deleted_at && !z.cancelled && sh(z.guid).length);
    can.cancelled = true; rows.lines = rows.lines.filter((l) => l.guid !== can.guid); rows.bills = rows.bills.filter((l) => l.guid !== can.guid);
    const d = reCtx(st, rows);
    sweep(st, rows, [del.guid, can.guid].concat(touching(rows, d.ledgers), d.guids));
    ok(!st.share.has(del.guid) && !st.share.has(can.guid), "the deleted and the cancelled entry: their shares gone");
    parity(st, rows, "an entry deleted (" + del.vno + ") and a credit note cancelled (" + can.vno + ")");
  }
  // a ledger's GST setting changed in FinCom's ledger list: Input IGST set as reverse-charge input (by hand)
  {
    rows.work.map["Input IGST"] = Object.assign({}, rows.work.map["Input IGST"], {what: "gst_rcm", kind: "gst", rcm: true});
    rows.items = items(rows.work);
    const before = clone([...st.share.entries()]);
    const d = reCtx(st, rows);
    ok(d.ledgers.includes("Input IGST") && !d.all, "the new context names the ledger changed (" + d.ledgers.join(", ") + ")");
    const n = sweep(st, rows, touching(rows, d.ledgers).concat(d.guids));
    ok(n > 0 && n < rows.heads.length, "only its entries worked out again: " + n + " of " + rows.heads.length);
    parity(st, rows, "a ledger's GST setting changed (Input IGST: reverse charge)");
    // and back
    rows.work.map["Input IGST"] = {kind: "gst", what: "gst", tax: "IGST", side: "input", reg: "07", ok: true, byHand: true}; rows.items = items(rows.work);
    const d2 = reCtx(st, rows); sweep(st, rows, touching(rows, d2.ledgers).concat(d2.guids));
    ok(JSON.stringify([...st.share.entries()].sort()) === JSON.stringify(before.sort()), "set back: every share as it was");
  }
  // the B2C summary switch on a party ledger: its sales move from B2C large to B2CS
  {
    rows.work.map["Walk-in Customers"] = Object.assign({}, rows.work.map["Walk-in Customers"] || {}, {b2cSum: true}); rows.items = items(rows.work);
    const d = reCtx(st, rows);
    sweep(st, rows, touching(rows, d.ledgers).concat(d.guids));
    ok(sh(extra.noPos).some((s) => s.sec === "R1.B2C") && !sh(extra.noPos).some((s) => s.sec === "R1.B2CL"), "Walk-in Customers marked a B2C summary: its sale above the limit is B2CS now");
    parity(st, rows, "the B2C summary switch on a party ledger");
  }
  // a place of supply typed under GST > What to fix: that entry alone
  {
    rows.work.gstPosFix = Object.assign({}, rows.work.gstPosFix || {}, {[extra.noPos]: {pos: "09", at: "2026-01-06"}}); rows.items = items(rows.work);
    const d = reCtx(st, rows);
    ok(d.guids.length === 1 && d.guids[0] === extra.noPos && !d.ledgers.length, "the new context names the entry fixed, no ledger");
    sweep(st, rows, d.guids);
    ok(sh(extra.noPos).some((s) => s.sec === "3B.pos" && s.k1 === "09") && !sh(extra.noPos).some((s) => s.sec === "3B.pos" && s.k1 === "00"), "its 3.2 moved from 00 to 09");
    parity(st, rows, "a place of supply typed (gstPosFix)");
  }
  // a ledger renamed in Tally: its lines rewritten, the AlterIDs the same (the dirty days bring the entries back)
  {
    const from = "Sales - Services", to = "Sales - Services (renamed)";
    const hit = Array.from(new Set(rows.lines.filter((l) => l.ledger === from).map((l) => l.guid)));
    rows.lines.forEach((l) => { if (l.ledger === from) l.ledger = to; });
    rows.ledgers = rows.ledgers.map((l) => l.name === from ? Object.assign({}, l, {name: to}) : l);
    const days = new Set(rows.heads.filter((h) => hit.includes(h.guid)).map((h) => h.day)), dirty = rows.heads.filter((h) => days.has(h.day)).map((h) => h.guid);
    const d = reCtx(st, rows);
    sweep(st, rows, dirty.concat(touching(rows, d.ledgers), d.guids));
    ok(hit.length > 0, "renamed: " + hit.length + " entries on " + days.size + " dirty days worked out again");
    parity(st, rows, "a ledger renamed (" + from + ")");
  }
  // a ledger named with an escaped "&": its GSTIN changed in the copy's ledger list (kept under the cleaned name, "Oak &
  // Fern Traders"): the context names the form the lines carry too, so the SQL finds its entries (tally_lines.ledger)
  {
    rows.ledgers = rows.ledgers.map((l) => l.name === "Oak &amp; Fern Traders" ? Object.assign({}, l, {gstin: "07AACCO1234F2Z4"}) : l);
    const d = reCtx(st, rows);
    ok(d.ledgers.includes("Oak &amp; Fern Traders") && d.ledgers.includes("Oak & Fern Traders"), "an '&' ledger changed: both its forms named (" + d.ledgers.join(", ") + ")");
    const hit = touching(rows, d.ledgers);
    ok(hit.includes(extra.amp), "so its entry is found by the name its lines carry");
    sweep(st, rows, hit.concat(d.guids));
    parity(st, rows, "an '&' ledger's GSTIN changed");
  }
  // one entry that fails: kept as an error, the rest of the batch worked out
  {
    const ctx2 = Object.assign({}, st.ctx, {map: Object.assign({}, st.ctx.map)});
    Object.defineProperty(ctx2.map, "Oak &amp; Fern Traders", {enumerable: true, get(){ return {get kind(){ throw new Error("made-up failure"); }}; }});
    const g = new Set(rows.heads.slice(60, 70).map((h) => h.guid).concat([extra.amp])), sub = (l) => l.filter((z) => g.has(String(z.guid)));
    const r = eng.shares({client: rows.client, co: rows.co, heads: sub(rows.heads), lines: sub(rows.lines), bills: sub(rows.bills)}, ctx2);
    ok(r.errors.length === 1 && r.errors[0].guid === extra.amp && /made-up failure/.test(r.errors[0].error) && !r.shares.some((x) => x.guid === extra.amp) && r.shares.length > 0,
      "an entry whose share fails: one error with its words, the other " + (g.size - 1) + " entries worked out");
  }
  const sharesFinal = [...st.share.values()].flat();

  console.log("== 3. the existing callers unchanged");
  {
    const b = eng.engineMonth(rows, "202508", "07").books, was = globalThis.S;
    globalThis.S = {books: b, coId: CLIENT, companies: {[CLIENT]: Object.assign({}, rows.co, {id: CLIENT})}, sales: {cid: CLIENT, list: []}, gstYm: "202508"}; globalThis.CO = (c) => globalThis.S.companies[c || CLIENT];
    try {
      const out = E.GSTR.outward("202508", "07"), inn = E.GSTR.inward("202508", "07");
      const viaRow = b.vouchers.filter((v) => !v.opt && !v.cancel).map((v) => E.GSTR.outRow(v, "202508", "07")).filter(Boolean);
      ok(JSON.stringify(out) === JSON.stringify(viaRow.sort((a, c) => String(a.date).localeCompare(String(c.date)))) && out.length > 3, "outward is its outRow of each entry (" + out.length + " rows)");
      const viaIn = b.vouchers.filter((v) => !v.opt && !v.cancel).map((v) => E.GSTR.inRow(v, "202508", "07")).filter(Boolean);
      ok(JSON.stringify(inn) === JSON.stringify(viaIn) && inn.length > 3, "inward is its inRow of each entry (" + inn.length + " rows)");
      const P = E.GSTR.sec31(out, inn.map((r) => E.GSTR.signedIn(r))), t = E.GSTR.threeBm("202508", "07");
      ok(JSON.stringify([P.taxableOut, P.cn, P.zero, P.nil, P.nongst, P.rcmOut, P.toUnreg, P.unregPos]) === JSON.stringify([t.sale, t.cn, t.zero, t.nil, t.nongst, t.rcmOut, t.toUnreg, t.unregPos]), "threeBm's 3.1 and 3.2 are sec31's");
    } finally { if (was === undefined) delete globalThis.S; else globalThis.S = was; delete globalThis.CO; }
  }

  console.log("== 4. a larger made-up book (at most 100,000 entries)");
  const scale = Math.max(1, Number(process.env.GST_SHARE_SCALE) || 1110);
  const big = rowsOf(world({seed: 1640, scale}), {});
  if (big.heads.length > 100000) throw new Error("the made-up book is over 100,000 entries");
  const sb = store(); const t0 = Date.now(); sb.ctx = eng.contextOf(big); const tCtx = Date.now() - t0;
  const t1 = Date.now(); sweep(sb, big, big.heads.map((h) => h.guid)); const tAll = Date.now() - t1;
  console.log("  (" + big.heads.length + " entries: context " + tCtx + " ms, shares " + tAll + " ms, " + Math.round(tAll / Math.ceil(big.heads.length / 3000)) + " ms a batch of 3000)");
  ok(Math.round(tAll / Math.ceil(big.heads.length / 3000)) < 1000, "a batch of 3000 entries well within an edge function's CPU (under 1 s here)");
  parity(sb, big, "the larger book (" + big.heads.length + " entries)");

  console.log("== 5. part B: the input tax credit side (3B tables 4, 5 and 6), the month step against today's engine");
  // the made-up client with the inward cases of tests/gst_itc_world.js, its 2Bs (read by the app's reader) and the AI's
  // pair gst-2b-match kept; the entries in the cloud's order (gst_calc_rows: by day, then GUID)
  function itcRows(seed, scale){
    const w = world({seed, scale}), g = itc(w), twoBs = {};
    w.portal.forEach((j) => { const t = x.GST2B.fromJson(j); twoBs[t.gstin + "|" + t.period] = Object.assign(t, {source: "upload"}); });
    const work = Object.assign({}, w.work, {twoBs});
    const nov = twoBs[w.OWN + "|112025"].rows.find((r) => r.no === "AS/1102/25-26");
    const runs = {[w.OWN + "|2025-26"]: {id: 41, status: "done", at: "2025-12-14T06:00:00Z", result: {rows: [{id: "ai1", st: "matched-ai", g: [nov.key], b: [w.aiBill.guid], why: ["the same bill: number written another way"]}]}, decisions: {}}};
    const heads = w.heads.slice().sort((a, c) => a.day < c.day ? -1 : a.day > c.day ? 1 : a.guid < c.guid ? -1 : a.guid > c.guid ? 1 : 0);
    return {g, w, rows: {client: "cli-syn-171", co: w.co, book: Object.assign({}, w.book, {book_id: "bbbbbbbb-0171-4000-8000-000000000001", client_id: "cli-syn-171"}), heads, lines: w.lines, bills: w.bills,
      ledgers: w.ledgers, groups: w.groups, items: items(work), sales: w.sales, runs, work}};
  }
  // what gst_itc_inputs (migration 171) gives for a registration, worked out here on the store and the rows the same way
  // (tests/run_migration164.py puts the same rows through the SQL and checks its answer against this)
  const itcInputs = (st, rows, reg, carry) => {
    const live = rows.heads.filter((h) => !h.deleted_at), withLines = new Set(rows.lines.filter((l) => l.ledger).map((l) => l.guid));
    const dated = live.filter((h) => withLines.has(h.guid) || (h.cancelled && h.vno)).map((h) => String(h.day).replace(/-/g, "").slice(0, 6)).sort();
    const months = {}, status = {};
    monthsOf(rows).forEach((ym) => { const m = month(st, ym).filter((r) => r.reg === reg && r.sec !== "*"); if (m.length) months[ym] = m; status[ym] = "fresh"; });
    const docs = [...st.docs.values()].filter((d) => d.doc && (d.doc_reg === reg || d.doc_reg === "")).map((d) => ({guid: d.guid, doc: d.doc}))
      .sort((a, c) => String(a.doc.bookDate).localeCompare(String(c.doc.bookDate)) || (a.guid < c.guid ? -1 : 1));
    const nb = new Set(); st.docs.forEach((d) => d.bills.forEach((b) => { if (b.nb && b.reg === reg) nb.add(b.l + "\u0001" + b.name); }));
    const bills = []; st.docs.forEach((d) => d.bills.forEach((b, i) => { if (nb.has(b.l + "\u0001" + b.name)) bills.push({guid: d.guid, seq: i, rec: b}); }));
    bills.sort((a, c) => String(a.rec.date).localeCompare(String(c.rec.date)) || (a.guid < c.guid ? -1 : a.guid > c.guid ? 1 : 0) || a.seq - c.seq);
    const parties = new Set([...nb].map((k) => k.split("\u0001")[0])), on = new Map(live.filter((h) => !h.cancelled && !h.optional).map((h) => [h.guid, h])), mv = {};
    rows.lines.forEach((l) => { const h = on.get(l.guid); if (!h || !parties.has(l.ledger)) return; const ym = String(h.day).replace(/-/g, "").slice(0, 6), m = mv[l.ledger] = mv[l.ledger] || {}; m[ym] = (m[ym] || 0) + Math.round(Number(l.amount) * 100); });
    const moves = {}; Object.keys(mv).sort().forEach((l) => { moves[l] = Object.keys(mv[l]).sort().map((m) => [m, mv[l][m] / 100]); });
    return {first: dated[0] || null, last: dated[dated.length - 1] || null, gstins: Array.from(new Set(live.filter((h) => h.cmp_gstin).map((h) => String(h.cmp_gstin).toUpperCase()))).sort(),
      months, status, docs, bills, moves, carry: carry || {}};
  };
  const stepIn = (rows, st, inp, out) => Object.assign({client: rows.client, co: rows.co, items: rows.items, ctx: st.ctx, sales: rows.sales, runs: rows.runs}, inp, {out});
  // every month: today's engine on the whole book against the month step on what the cloud keeps (every box of tables
  // 4, 5 and 6, and 3.1/3.2 too; the documents behind a box by their count)
  const itcParity = (st, rows, label, yms, carry) => {
    rows.made = null;
    yms = yms || monthsOf(rows);
    const ref = eng.engineItc(rows, "07", monthsOf(rows)), inp = itcInputs(st, rows, "07", carry);
    const t0 = Date.now(), cl = eng.itcMonths(stepIn(rows, st, inp, ref.out), "07", yms), ms = Date.now() - t0;
    let bad = 0, boxesN = 0, first = null; const tables = new Set();
    cl.months.forEach((m) => { const c = eng.itcCompare(ref.months[m.ym], m.result); boxesN++;
      Object.keys(m.result).forEach((k) => tables.add(k));
      if (!c.ok){ bad++; if (!first) first = m.ym + " " + JSON.stringify(c.diffs.slice(0, 4)); } });
    ok(!bad && cl.months.length === yms.length, label + ": " + yms.length + (yms.length === 1 ? " month" : " months") + ", every box of 3B (tables 4, 5, 6 and 3.1/3.2) the engine's to the paisa (" + ms + " ms the month step)" + (first ? " - " + first : ""));
    return {ref, cl, inp};
  };
  const I = itcRows(171, 0), R5 = I.rows, G5 = I.g, s5 = store(); s5.ctx = eng.contextOf(R5);
  sweep(s5, R5, R5.heads.map((h) => h.guid));
  const sh5 = (id) => s5.share.get(id) || [], has = (id, sec, f) => sh5(id).some((z) => z.sec === sec && (!f || f(z)));
  ok(has(G5.impG, "4.impG", (z) => z.igst === 90000) && !has(G5.impG, "4.other") && s5.docs.get(G5.impG).doc.imp === true, "an import of goods: 4(A)(1) IGST 90,000, not 4(A)(5); its document says import");
  ok(has(G5.impS, "4.impS", (z) => z.igst === 18000) && has(G5.impS, "4.rcm31", (z) => z.igst === 18000) && has(G5.impS, "3B.rcm"), "an import of services: 4(A)(2) and 3.1(d) IGST 18,000");
  ok(has(G5.isd, "4.other", (z) => z.igst === 5400) && s5.docs.get(G5.isd).doc.gstin === "06AAKCS4821Q1ZY", "ISD credit: 4(A)(5) as today (the engine has no 4(A)(4) box), its document the ISD's GSTIN for 2B's ISD part");
  ok(has(G5.blocked, "4.blocked", (z) => z.cgst === 63000 && z.sgst === 63000) && has(G5.blocked, "4.other") && s5.docs.get(G5.blocked).doc.blocked, "blocked by 17(5): 4.blocked (reversed in 4(B)(1)) and in 4(A)(5)");
  ok(has(G5.inel, "4.buy", (z) => z.qty === 3600) && has(G5.inel, "4.other", (z) => z.qty === 3600 && z.cgst === 0), "tax on a GST-ineligible ledger: 3,600 ineligible (qty), no credit");
  ok(has(G5.cnSup, "4.other", (z) => z.cgst === -900 && z.sgst === -900) && s5.docs.get(G5.cnSup).doc.dir === -1, "a supplier's credit note: 4(A)(5) less 900 + 900; its document a note (dir -1)");
  ok(has(G5.exempt, "5.inw", (z) => z.k1 === "" && z.k2 === "gst" && z.taxable === 12000) && has(G5.inter0, "5.inw", (z) => z.k1 === "06" && z.taxable === 7000) && has(G5.fuel, "5.inw", (z) => z.k2 === "ng" && z.taxable === 4000),
    "table 5: no tax from an unregistered dairy (no state), from Haryana (06) and non-GST fuel, each kept by part");
  ok(s5.docs.get(G5.late).bills.some((b) => b.nb && b.name === "DT-LATE-7") && [...s5.docs.values()].some((d) => d.bills.some((b) => !b.nb && b.amt < 0)), "bill-wise allocations kept by entry: a purchase bill's New Ref (rule 37 follows it), payments against bills");
  const secs5 = new Set(); s5.share.forEach((l) => l.forEach((z) => secs5.add(z.sec)));
  ok(["4.impG", "4.impS", "4.rcmIn", "4.other", "4.blocked", "4.buy", "4.rcm31", "5.inw", "42.common", "42.to"].every((z) => secs5.has(z)), "every part B section is reached by some entry");
  parity(s5, R5, "the part B client, part A's figures and part B's sums (by section)");
  const P5 = itcParity(s5, R5, "the part B client, its month step in order (each month from the one before, as worked out)");
  {
    const E5 = P5.ref.months, C5 = Object.fromEntries(P5.cl.months.map((m) => [m.ym, m.result]));
    const t = (ym, k) => E5[ym][k];
    ok(t("202507", "impGoods").igst >= 90000 && t("202508", "impServ").igst === 18000 && t("202508", "rcmOut").igst >= 18000 && t("202510", "blocked").cgst === 63000 && t("202510", "ineligible") === 3600,
      "today's engine reaches the cases: import of goods (July), of services and 3.1(d) (August), 17(5) (October), ineligible (October)");
    ok(t("202510", "held").n >= 1 && t("202511", "released").cgst >= 2700 && t("202509", "cn2b").n === 1 && t("202507", "held").list && t("202508", "inw5").gstInter === 7000 && t("202508", "inw5").ngIntra === 4000,
      "and the 2B basis: a bill held (October: not in 2B yet) and released (November: in its 2B), a supplier's credit note only in 2B (September), table 5 by state");
    ok(t("202511", "r37").rev.n >= 1 && t("202512", "r37").re.n >= 1 && t("202509", "rules").cgst > 0 && t("202508", "rev2").cgst === 750 && t("202511", "reclaim").igst === 1200,
      "rule 37 (reversed after 180 days, taken back when paid), rules 42 and 43, figures typed (4(B)(2) in August, 4(D)(1) in November)");
    const months5 = monthsOf(R5), carried = months5.slice(1).filter((m, i) => ["igst", "cgst", "sgst"].some((h) => E5[months5[i]].pay.carry[h] > 0));
    ok(carried.length >= 3 && carried.every((m) => JSON.stringify(C5[m].opening) === JSON.stringify(E5[m].opening)), "credit carried forward across " + carried.length + " months (" + carried.join(" ") + "): each month's opening the month before's carried credit, the same on both sides");
    ok(C5["202603"].quarter === true && C5["202603"].months.length === 3, "the QRMP quarter (January to March): its 3B, the three months together, set off once");
    // and a difference is seen: the late bill's document left out of the inputs, a supplier's movement left out
    const inp = itcInputs(s5, R5, "07", {}); inp.docs = inp.docs.filter((d) => d.guid !== G5.late);
    const c1 = eng.itcCompare(E5["202510"], eng.itcMonths(stepIn(R5, s5, inp, P5.ref.out), "07", ["202510"]).months[0].result);
    const inp2 = itcInputs(s5, R5, "07", {}); delete inp2.moves["Glenrock Tools"];
    const c2 = eng.itcCompare(E5["202511"], eng.itcMonths(stepIn(R5, s5, inp2, P5.ref.out), "07", ["202511"]).months[0].result);
    ok(!c1.ok && c1.diffs.some((d) => d.table === "4" && /^held\./.test(d.box)) && !c2.ok && c2.diffs.some((d) => /^r37\./.test(d.box)) && c2.diffs.some((d) => d.table === "6"),
      "a difference is seen and placed: a document left out moves October's held credit (table 4: " + c1.diffs.length + " boxes), a supplier's movement left out moves rule 37 and the payment (tables " + Object.keys(c2.tables).join(", ") + ")");
    // the month step from the credit kept for the months before (gst_itc_month), not working them out again
    const keep = {}; P5.cl.months.forEach((m) => { if (m.ym < "202601") keep[m.ym] = m.carry; });
    itcParity(s5, R5, "the quarter alone, from the credit kept for December", ["202601", "202602", "202603"], keep);
    itcParity(s5, R5, "a month alone, nothing kept (the months before worked out from the sums, no book)", ["202512"], {});
  }
  // a decision taken on 2B (the client's work, not an entry): nothing to sweep, the month step reads it
  {
    const t0 = P5.ref.months["202509"].cn2b.cgst;
    const sep = JSON.parse(JSON.stringify(R5.work.twoBs[I.w.OWN + "|092025"].rows.find((r) => r.no === "AS-CN-9")));
    R5.work.itcTrack = {"07": {dec: {["P|" + sep.gstin + "|" + sep.noN + "|" + sep.dir]: {act: "reject", at: "2026-01-10"}}, sent: {}, contact: {}}};
    R5.items = items(R5.work);
    const P = itcParity(s5, R5, "a decision on 2B (the supplier's credit note only in 2B rejected in IMS): no entry swept again");
    ok(t0 === 900 && P.ref.months["202509"].cn2b.cgst === 0, "and it moved September's credit (the note's 900 + 900 no longer taken off)");
  }
  // an inward entry edited, one deleted: only they are swept again
  {
    const h = R5.heads.find((z) => z.guid === G5.impG); h.alter_id += 10; h.gst_alter_id = h.alter_id;
    R5.lines.filter((l) => l.guid === h.guid).forEach((l) => { if (l.ledger === "Input IGST") l.amount = -99000; if (l.ledger === "Purchases") l.amount = -550000; if (l.ledger === h.party) l.amount = 649000; });
    const del = R5.heads.find((z) => z.guid === G5.blocked); del.deleted_at = "2026-01-20T10:00:00Z";
    const d = reCtx(s5, R5); sweep(s5, R5, [G5.impG, G5.blocked].concat(touching(R5, d.ledgers), d.guids));
    ok(!s5.docs.has(G5.blocked) && s5.docs.get(G5.impG).doc.igst === 99000, "the deleted entry's document gone, the edited one's kept again");
    const P = itcParity(s5, R5, "an import edited (IGST 99,000) and the car's bill deleted");
    ok(P.ref.months["202507"].impGoods.igst >= 99000 && P.ref.months["202510"].blocked.cgst === 0, "both moved today's engine too");
  }
  // a larger made-up book with 2B (at most 100,000 entries)
  {
    const scale = Math.max(1, Number(process.env.GST_ITC_SCALE) || 120), B = itcRows(1710, scale), sb2 = store();
    if (B.rows.heads.length > 100000) throw new Error("the made-up book is over 100,000 entries");
    sb2.ctx = eng.contextOf(B.rows); sweep(sb2, B.rows, B.rows.heads.map((h) => h.guid));
    const t0 = Date.now(), P = itcParity(sb2, B.rows, "the larger part B book (" + B.rows.heads.length + " entries, " + Object.keys(B.rows.work.twoBs).length + " 2Bs)"), tAll = Date.now() - t0;
    const inp = P.inp, size = JSON.stringify({docs: inp.docs, bills: inp.bills, moves: inp.moves, months: inp.months}).length;
    console.log("  (" + B.rows.heads.length + " entries: the month step read " + inp.docs.length + " documents, " + inp.bills.length + " allocations, " + Object.keys(inp.moves).length + " suppliers' movement, " + Math.round(size / 1024) + " KB; parity " + tAll + " ms)");
    const one = Date.now(); eng.itcMonths(stepIn(B.rows, sb2, itcInputs(sb2, B.rows, "07", Object.fromEntries(P.cl.months.filter((m) => m.ym < "202512").map((m) => [m.ym, m.carry]))), P.ref.out), "07", ["202512"]); const tOne = Date.now() - one;
    ok(tOne < 1000, "one month's step, from the credit kept for the month before, well within an edge function's CPU (" + tOne + " ms here)");
  }
  // for tests/run_migration164.py (section 9): the part B client's rows, docs and what gst_itc_inputs is to give
  fs.writeFileSync(path.join(OUT, "gst-itc-inputs.json"), JSON.stringify({book: R5.book.book_id, heads: R5.heads, lines: R5.lines, docs: [...s5.docs.values()], shares: [...s5.share.values()].flat(),
    months: Object.fromEntries(monthsOf(R5).map((ym) => [ym, month(s5, ym)])), inputs: itcInputs(s5, R5, "07", {})}));
  // for tests/run_gst_share_deno.ts (part B): the part B client's rows as they stand
  fs.writeFileSync(path.join(OUT, "gst-itc-rows.json"), JSON.stringify({book: R5.book, co: R5.co, heads: R5.heads, lines: R5.lines, bills: R5.bills, ledgers: R5.ledgers, groups: R5.groups, items: R5.items, sales: R5.sales, runs: R5.runs, months: monthsOf(R5)}));

  // for tests/run_migration164.py: the shares and the month sums they give
  const months = {};
  monthsOf(rows).forEach((ym) => { months[ym] = month(st, ym); });
  fs.writeFileSync(path.join(OUT, "gst-share-parity.json"), JSON.stringify({book: rows.book.book_id, shares: sharesFinal, months}));
  // for tests/run_gst_share_deno.ts: the made-up client's rows as they stand (gst-run's handler on a fake cloud)
  fs.writeFileSync(path.join(OUT, "gst-share-rows.json"), JSON.stringify({book: rows.book, co: rows.co, heads: rows.heads, lines: rows.lines, bills: rows.bills, ledgers: rows.ledgers, groups: rows.groups, items: rows.items, months: monthsOf(rows)}));
  console.log("  (wrote tests/out/gst-share-parity.json: " + sharesFinal.length + " shares)");
  console.log(fails ? fails + " FAILED" : "all ok");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
