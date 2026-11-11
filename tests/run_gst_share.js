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
// Writes tests/out/gst-share-parity.json (the shares and the month sums) for tests/run_migration164.py, which puts the
// same shares through migration 164's SQL and checks gst_month's sums against these, and tests/out/gst-share-rows.json
// (the made-up client's rows) for tests/run_gst_share_deno.ts.
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
const app = load(HTML, ["BookItems"]), {x} = app;
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
      extra.ng = add("2025-11-04", "Sales", "Birchwood Retail", [["Birchwood Retail", -8000], ["Sales - Exempt", 8000]], {gstin: "07AABCB7310K1Z2", pos: "Delhi", gst_taxability: "Non-GST", gst_alter_id: 900099});
    }
    return {client: CLIENT, co: w.co, book: Object.assign({}, w.book, {book_id: "bbbbbbbb-0164-4000-8000-000000000001", client_id: CLIENT}), heads, lines, bills, ledgers: w.ledgers, groups: w.groups,
      items: items(w.work), sales: [], runs: {}, work: w.work};
  }
  // the cloud's side, in memory as migration 164 keeps it: gst_share by entry, summed to a month (paise, as numeric adds)
  const store = () => ({share: new Map(), ctx: null});
  const sweep = (st, rows, guids) => {
    const want = new Set(guids), pick = (l) => l.filter((z) => want.has(String(z.guid)));
    const list = [...want];
    for (let i = 0; i < list.length; i += 3000){
      const g = new Set(list.slice(i, i + 3000)), sub = (l) => l.filter((z) => g.has(String(z.guid)));
      const r = eng.shares({client: rows.client, co: rows.co, heads: sub(rows.heads), lines: sub(rows.lines), bills: sub(rows.bills)}, st.ctx);
      if (r.unknown.length) throw new Error("ledgers not in the context: " + r.unknown.join(", "));
      g.forEach((id) => st.share.delete(id));
      r.shares.forEach((s) => { const a = st.share.get(s.guid) || []; a.push(s); st.share.set(s.guid, a); });
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
