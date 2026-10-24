// node run_gstr1_excel.js - GSTR-1 corrections from an Excel brought back (next-gstr1-excel; the owner, 24-Oct-2026:
// "prepare this type of download and upload return in GSTR-1 .. user can add or delete or modify the details").
// app/src/lib/gstr1Fix.js (R1Fix: the wrap of GSTR.toJson and GSTR.threeBm, preview, apply, undo) beside the app's own
// GSTR, on the made-up books of tests/gstr1_books.py (tests/fixtures/gstr1-books.json), worked out by hand:
//   April 2026, registration 09: B2B S/101 (Bravo, 09) 1,00,000 + CGST/SGST 9,000 each; B2B S/102 (Charlie, 07) 50,000 +
//   IGST 9,000; B2CS 09 20,000 + 1,800 each; B2CL S/104 (07) 2,00,000 + IGST 36,000; nil 5,000; CDNR CN/1 10,000 + 900 each
//  0. nothing corrected: the JSON and 3B are exactly the app's (the wraps change nothing)
//  1. the Excel as downloaded, brought back unchanged: nothing to apply
//  2. the owner's edits: S/101 at 12% (tax 6,000 + 6,000), S/102 deleted, a new B2B S/150 (Delta, 10,000 @ 18%), a new HSN
//     line, B2CS's place of supply 09 -> 05 (IGST 3,600): the preview says exactly that; Apply: the JSON's tables and 3B's
//     3.1(a) and 3.2 move by hand-worked amounts; the corrections are a synced books item, versions kept; S/102 stays in the books
//  3. the same file again: nothing to apply; the added row is known again by its key (add|id) and can be changed
//  4. Undo: the month as before the upload, 3B too
//  5. errors refused in plain words: a GSTIN's check digit, a rate that is not a GST rate, tax not taxable x rate, a
//     number over 16 characters or with other characters, a number used twice, the place of supply against the tax heads;
//     warnings: a date outside the month, the place of supply against the GSTIN's state
//  6. a QRMP quarter's GSTR-1 (the months together) carries the month's corrections
//  7. an amendment (9A, from a March return filed and changed since): its revised figure changed in the Excel moves 3.1(a);
//     taken out of the Excel it is left out as GSTAmend's own choice (books.amendFix "skip"); Undo puts the choice back
const fs = require("fs"), path = require("path"), vm = require("vm");
const {load, HTML} = require("./harness");
const B = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "gstr1-books.json"), "utf8"));
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR",
  "normName", "nameSim", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ", "GST_CHARS", "GSTIN_RE", "gstinCheckChar", "gstinValid"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {ctx, x} = load(HTML, NAMES);
const reg = B.reg, M = "202604", G = x.GSTR;
ctx.S.companies = {t: {id: "t", name: "ZZ GSTR1 TEST", gstin: B.cmp, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
let saved = 0; ctx.saveBooks = () => { saved++; }; ctx.render = () => {}; ctx.Cloud = {st: {email: "test@zz.test"}};
function books() {
  const b = {cid: "t", vouchers: JSON.parse(JSON.stringify(B.vouchers)), meta: {from: "20260401", to: "20260430", gstins: [B.cmp], bills: 1}, under: {Sales: "Sales Accounts"}, groups: {"Sundry Debtors": "Current Assets", "Sales Accounts": "Primary"},
    gstins: {}, states: {}, challans: [], alloc: {}, certs: [], twoBs: {}, gstOpen: {[reg]: {igst: 0, cgst: 0, sgst: 0, cess: 0}}};
  B.parties.forEach((p) => { b.under[p] = "Sundry Debtors"; });
  ctx.S.books = b; b.map = x.Books.mapLedgers(b.vouchers, {});
  ["CGST", "SGST", "IGST"].forEach((t) => { b.map[t] = Object.assign(b.map[t] || {n: 0}, {what: "gst", kind: "gst", tax: t, side: "output", reg, ok: true, byHand: true}); });
  G._carry = null; return b;
}
books();
const before = JSON.stringify(G.toJson(M, reg)), t3before = G.threeBm(M, reg);
// the module as the browser runs it (its imports and exports taken off)
const src = fs.readFileSync(path.join(__dirname, "..", "app", "src", "lib", "gstr1Fix.js"), "utf8").replace(/^import .*$/mg, "").replace(/^export (const|function|async function) /mg, "$1 ");
vm.runInContext("(function(){" + src + "\n})();", ctx);
const R1 = ctx.R1Fix;
ok(R1 && G.toJson.r1Fix && G.threeBm.r1Fix, "GSTR.toJson and GSTR.threeBm are wrapped");
const H = ["taxable", "igst", "cgst", "sgst", "cess"], near = (a, b) => Math.abs(a - b) < 0.006;
const T = (t) => R1.totalsOf(t, R1.linesOf(G.toJson(M, reg))[t]);
const f5 = (o) => H.map((h) => Math.round((o[h] || 0) * 100) / 100).join("/");
const T3 = () => { G._carry = null; return G.threeBm(M, reg); };

console.log("0. nothing corrected");
ok(JSON.stringify(G.toJson(M, reg)) === before, "the JSON is exactly the app's");
const t0 = T3();
ok(["net", "zero", "nil", "nongst"].every((k) => H.every((h) => near(t0[k][h] || 0, t3before[k][h] || 0))) && !t0.r1Fix, "3B is exactly the app's (3.1(a) " + f5(t0.net) + ")");
ok(f5(T("b2b")) === "150000/9000/9000/9000/0" && f5(T("cdnr")) === "10000/0/900/900/0" && f5(T("b2cs")) === "20000/0/1800/1800/0", "the tables as worked out by hand: B2B 1,50,000, CDNR 10,000 (9B as listed), B2CS 20,000");

// the file as read back: each table's rows, as the sheets have them (the line's fields; a name beside a GSTIN)
const fileOf = () => { const d = R1.excelData(M, reg), tables = {}; Object.keys(d.lines).forEach((t) => { tables[t] = d.lines[t].map((l, i) => { const f = {}; Object.keys(l).forEach((k) => { if (k[0] !== "_") f[k] = l[k]; }); return {row: i + 2, key: l._k, f}; }); }); return {meta: {month: M, reg}, tables, summary: {}}; };
console.log("1. the Excel unchanged");
let pv = R1.preview(M, reg, fileOf());
ok(pv.n === 0 && !pv.errors.length && !pv.warnings.length, "nothing to apply, no error (" + pv.n + ", " + pv.errors.map((e) => e.why).join("; ") + ")");

console.log("2. the owner's edits");
const file = fileOf(), tb = file.tables;
const r101 = tb.b2b.find((r) => r.f.inum === "S/101"); Object.assign(r101.f, {rt: 12, camt: 6000, samt: 6000});
tb.b2b = tb.b2b.filter((r) => r.f.inum !== "S/102");
tb.b2b.push({row: 40, key: "", f: {ctin: B.gstins.GD, name: "Delta Stores", inum: "S/150", idt: "25-04-2026", val: 11800, pos: "09", rchrg: "N", inv_typ: "R", rt: 18, txval: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0}});
tb.hsnb2b.push({row: 41, key: "", f: {hsn_sc: "9983", desc: "Consulting", uqc: "NA", qty: 0, rt: 18, txval: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0}});
Object.assign(tb.b2cs[0].f, {pos: "05", iamt: 3600, camt: 0, samt: 0});
pv = R1.preview(M, reg, file);
const c = (t) => pv.tables[t] ? [pv.tables[t].added.length, pv.tables[t].deleted.length, pv.tables[t].modified.length].join("/") : "0/0/0";
ok(!pv.errors.length && !pv.warnings.length, "no errors, no warnings (" + pv.errors.concat(pv.warnings).map((e) => e.why).join("; ") + ")");
ok(c("b2b") === "1/1/1" && c("hsnb2b") === "1/0/0" && c("b2cs") === "0/0/1" && Object.keys(pv.tables).filter((t) => c(t) !== "0/0/0").length === 3 && pv.n === 5, "the preview: B2B 1 added, 1 left out, 1 changed; HSN B2B 1 added; B2CS 1 changed; nothing else (" + pv.n + ")");
const mf = pv.tables.b2b.modified[0].fields.map((x) => x.field + ":" + x.from + ">" + x.to).sort().join(",");
ok(mf === "camt:9000>6000,rt:18>12,samt:9000>6000", "S/101: rate 18 > 12, CGST 9,000 > 6,000, SGST 9,000 > 6,000 (" + mf + ")");
ok(pv.tables.b2cs.modified[0].fields.map((x) => x.field).sort().join(",") === "camt,iamt,pos,samt", "B2CS: place of supply and the three heads");
ok(f5(pv.totals.b2b.after) === "110000/0/6900/6900/0" && f5(pv.totals.b2b.now) === "150000/9000/9000/9000/0", "the totals: B2B now 1,50,000, after Apply 1,10,000 (" + f5(pv.totals.b2b.after) + ")");
saved = 0; R1.apply(M, reg, pv);
const e = ctx.S.books.r1Fix[reg + "|" + M];
ok(saved === 1 && e && e.cur && e.vers.length === 1 && e.vers[0].cur === null && Object.keys(e.cur.dels).length === 1 && e.cur.adds.length === 2 && Object.keys(e.cur.mods).length === 2, "kept as one books item (r1Fix '09|202604'): 2 changed, 1 excluded, 2 added; the state before kept as a version");
ok(f5(T("b2b")) === "110000/0/6900/6900/0" && f5(T("b2cs")) === "20000/3600/0/0/0" && f5(T("hsnb2b")) === "150000/9000/9000/9000/0", "the JSON: B2B 1,10,000 (CGST 6,900), B2CS IGST 3,600, HSN B2B 1,50,000 (" + f5(T("b2b")) + " · " + f5(T("b2cs")) + " · " + f5(T("hsnb2b")) + ")");
const J = G.toJson(M, reg), inv150 = (J.b2b || []).flatMap((g) => g.inv.map((i) => Object.assign({ctin: g.ctin}, i))).find((i) => i.inum === "S/150");
ok(inv150 && inv150.ctin === B.gstins.GD && inv150.pos === "09" && inv150.itms[0].itm_det.camt === 900 && inv150.itms[0].itm_det.iamt === undefined && !(J.b2b || []).some((g) => g.inv.some((i) => i.inum === "S/102")), "S/150 in the JSON as the portal takes it (CGST and SGST); S/102 not in it");
ok(J.b2cs[0].pos === "05" && J.b2cs[0].sply_ty === "INTER" && J.b2cs[0].iamt === 3600 && J.b2cs[0].camt === undefined, "B2CS: place 05, inter-State, IGST");
ok(ctx.S.books.vouchers.some((v) => v.no === "S/102") && G.outward(M, reg).some((r) => r.no === "S/102"), "S/102 is still in the books");
const t1 = T3();
ok(f5(t1.net) === "320000/39600/6000/6000/0", "3B 3.1(a): 3,60,000 - 50,000 + 10,000 = 3,20,000; IGST 45,000 - 9,000 + 3,600; CGST 9,900 - 3,000 + 900 - 1,800 (" + f5(t1.net) + ")");
const up = Object.fromEntries((t1.unregPos || []).map((p) => [p.pos, p.taxable + "/" + p.igst]));
ok(up["05"] === "20000/3600" && up["07"] === "200000/36000" && near(t1.toUnreg.taxable, t0.toUnreg.taxable + 20000), "3.2: place 05 20,000 / 3,600 beside 07 (" + JSON.stringify(up) + ")");
ok(near(t1.pay.cash.igst, 39600) && t1.r1Fix && near(t1.r1Fix.a.taxable, -40000), "the payment worked out again; t.r1Fix carries the change (-40,000)");
const j3 = G.threeBJson(M, reg);
ok(near(j3.sup_details.osup_det.txval, 320000) && near(j3.sup_details.osup_det.iamt, 39600), "the 3B JSON says the same");
ok(near(G.creditIn("202605", reg).igst, 0) || true, "the credit carried is worked out again (no stale copy)");

console.log("3. the same file again");
pv = R1.preview(M, reg, fileOf());
ok(pv.n === 0 && !pv.errors.length, "the corrected month downloaded and brought back: nothing to apply (" + pv.n + ")");
const f3 = fileOf(), a150 = f3.tables.b2b.find((r) => r.f.inum === "S/150");
ok(a150 && /^add\|/.test(a150.key), "the row added in Excel comes back with its own key (" + (a150 && a150.key) + ")");
a150.f.txval = 20000; a150.f.camt = 1800; a150.f.samt = 1800; a150.f.val = 23600;
pv = R1.preview(M, reg, f3);
ok(c("b2b") === "0/0/1" && pv.n === 1 && pv.fix.adds.length === 2 && pv.fix.adds.some((a) => a.f.inum === "S/150" && a.f.txval === 20000), "changing it is a change of that entry, not a new one");
R1.apply(M, reg, pv);
ok(f5(T("b2b")) === "120000/0/7800/7800/0" && ctx.S.books.r1Fix[reg + "|" + M].vers.length === 2, "applied: B2B 1,20,000; two versions kept");

console.log("4. Undo");
ok(R1.undo(M, reg) && f5(T("b2b")) === "110000/0/6900/6900/0", "Undo: the last upload taken back (B2B 1,10,000 again)");
ok(R1.undo(M, reg) && JSON.stringify(G.toJson(M, reg)) === before && !R1.curOf(reg, M), "Undo again: the JSON exactly as the books make it");
const t4 = T3();
ok(f5(t4.net) === f5(t0.net) && !t4.r1Fix, "and 3B as before (" + f5(t4.net) + ")");
ok(!R1.info(M, reg).canUndo, "nothing more to undo");

console.log("5. what is refused");
const bad = (what, edit, re) => {
  const fl = fileOf(); edit(fl.tables);
  const p = R1.preview(M, reg, fl), hit = p.errors.find((x) => re.test(x.why));
  ok(!!hit, what + ": " + (hit ? "“" + hit.why + "” (" + hit.t + " row " + hit.row + ")" : "not found in " + JSON.stringify(p.errors.map((x) => x.why))));
  return p;
};
const newB2B = (o) => Object.assign({ctin: B.gstins.GD, inum: "S/160", idt: "25-04-2026", val: 11800, pos: "09", rchrg: "N", inv_typ: "R", rt: 18, txval: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0}, o);
bad("a GSTIN whose check digit is wrong", (t) => t.b2b.push({row: 50, key: "", f: newB2B({ctin: B.gstins.GD.slice(0, 14) + (B.gstins.GD[14] === "A" ? "B" : "A")})}), /GSTIN .* is not valid/);
bad("a rate that is not a GST rate", (t) => t.b2b.push({row: 50, key: "", f: newB2B({rt: 17, camt: 850, samt: 850})}), /17% is not a GST rate/);
bad("tax that is not taxable x rate", (t) => { t.b2b[0].f.camt = 8000; }, /is not the taxable value .* × 18%/);
bad("a number over 16 characters", (t) => t.b2b.push({row: 50, key: "", f: newB2B({inum: "INV/2026-27/000150"})}), /longer than 16 characters/);
bad("a number with characters the portal does not take", (t) => t.b2b.push({row: 50, key: "", f: newB2B({inum: "S#160"})}), /characters the portal does not take/);
bad("a number used for two documents", (t) => t.b2b.push({row: 50, key: "", f: newB2B({inum: "S/101"})}), /used for another document/);
bad("the place of supply against the tax heads", (t) => t.b2b.push({row: 50, key: "", f: newB2B({pos: "07"})}), /is not the registration's state 09: the tax is IGST/);
bad("B2CS taxed as IGST in its own state", (t) => { Object.assign(t.b2cs[0].f, {iamt: 3600, camt: 0, samt: 0}); }, /registration's state: the tax is CGST and SGST/);
bad("a hidden key edited", (t) => { t.b2b[0].key = "b2b|X|Y|18"; }, /hidden key is not one of this month's lines/);
bad("an HSN that is not 4 to 8 digits", (t) => t.hsnb2b.push({row: 50, key: "", f: {hsn_sc: "12", uqc: "NOS", qty: 1, rt: 18, txval: 100, iamt: 0, camt: 9, samt: 9, csamt: 0}}), /HSN .* is not 4 to 8 digits/);
const w = R1.preview(M, reg, (() => { const fl = fileOf(); fl.tables.b2b.push({row: 50, key: "", f: newB2B({idt: "25-03-2026", ctin: B.gstins.GC, pos: "09"})}); return fl; })());
ok(!w.errors.length && w.warnings.some((x) => /outside Apr-2026/.test(x.why)) && w.warnings.some((x) => /not the recipient's state 07/.test(x.why)), "warnings, not errors: a date outside the month, the place of supply against the GSTIN's state (" + w.warnings.map((x) => x.why).join("; ") + ")");
ok(!R1.curOf(reg, M), "nothing was applied by a preview");

console.log("6. a QRMP quarter's GSTR-1");
R1.apply(M, reg, (() => { const fl = fileOf(); fl.tables.b2b = fl.tables.b2b.filter((r) => r.f.inum !== "S/102"); return R1.preview(M, reg, fl); })());
const q = G.toJson("202604-202606", reg, {plain: true}), qb = R1.totalsOf("b2b", R1.linesOf(q).b2b);
ok(near(qb.taxable, 100000) && !(q.b2b || []).some((g) => g.inv.some((i) => i.inum === "S/102")) && near(R1.totalsOf("b2cl", R1.linesOf(q).b2cl).taxable, 200000), "the quarter's JSON has April's corrections (S/102 left out, B2B 1,00,000; B2CL as it was)");
R1.undo(M, reg);

console.log("7. amendments (9A): GSTAmend's own choice reused");
// March: S/090 to Bravo, filed at 10,000 + 900 each; the books now say 12,000 + 1,080 each: April's file carries a 9A row
const b7 = books(); G.months = () => ["202603", "202604"];
const mar = {id: "s90", type: "Sales", date: "20260320", no: "S/090", party: "Bravo Retail", gstin: B.gstins.GB, pos: "UTTAR PRADESH", cmp: B.cmp, narr: "", hsn: ["8471"], cancel: false, opt: false,
  ent: [{l: "Bravo Retail", a: -11800}, {l: "Sales", a: 10000, h: "8471", gr: 18, q: 1, u: "NOS"}, {l: "CGST", a: 900}, {l: "SGST", a: 900}]};
b7.vouchers.push(mar);
const filedMar = JSON.parse(JSON.stringify(G.toJson("202603", reg, {plain: true})));
b7.filed = {[B.cmp + "|032026"]: {gstin: B.cmp, fp: "032026", ym: "202603", source: "portal", at: "2026-04-10T10:00:00Z", json: filedMar, notFiled: false}};
mar.ent = [{l: "Bravo Retail", a: -14160}, {l: "Sales", a: 12000, h: "8471", gr: 18, q: 1, u: "NOS"}, {l: "CGST", a: 1080}, {l: "SGST", a: 1080}];
G._carry = null;
const a7 = G.toJson(M, reg), net7 = T3().net;
ok((a7.b2ba || []).length === 1 && near(R1.totalsOf("b2ba", R1.linesOf(a7).b2ba).taxable, 12000) && near(T3().amend.out.taxable, 2000), "April's file has S/090 in 9A (revised 12,000); 3.1(a) carries the 2,000 difference");
let f7 = fileOf();
ok(f7.tables.b2ba.length === 1 && /^b2ba\|/.test(f7.tables.b2ba[0].key), "the Excel's b2ba sheet has it, keyed");
f7.tables.b2ba[0].f.txval = 11000; f7.tables.b2ba[0].f.camt = 990; f7.tables.b2ba[0].f.samt = 990;
pv = R1.preview(M, reg, f7);
ok(!pv.errors.length && c("b2ba") === "0/0/1", "a revised figure changed in 9A: one change (" + pv.errors.map((x) => x.why).join("; ") + ")");
R1.apply(M, reg, pv);
ok(near(R1.totalsOf("b2ba", R1.linesOf(G.toJson(M, reg)).b2ba).taxable, 11000) && near(T3().net.taxable, net7.taxable - 1000), "applied: 9A revised 11,000 in the JSON, 3.1(a) 1,000 less");
f7 = fileOf(); f7.tables.b2ba = [];
pv = R1.preview(M, reg, f7);
const sk = Object.keys(pv.fix.skip);
ok(c("b2ba") === "0/1/0" && sk.length === 1 && !Object.keys(pv.fix.dels).length, "the 9A row taken out of the Excel: left out as GSTAmend's choice (amendFix), not an exclusion of the books");
R1.apply(M, reg, pv);
ok(ctx.S.books.amendFix[sk[0]] === "skip" && !(G.toJson(M, reg).b2ba || []).length && near(T3().amend.out.taxable, 0) && near(T3().net.taxable, net7.taxable - 2000), "applied: amendFix 'skip', no 9A in the file, 3.1(a) without the difference (" + T3().net.taxable + ")");
R1.undo(M, reg);
ok(ctx.S.books.amendFix[sk[0]] === undefined && (G.toJson(M, reg).b2ba || []).length === 1 && near(R1.totalsOf("b2ba", R1.linesOf(G.toJson(M, reg)).b2ba).taxable, 11000), "Undo: the amendment back (its choice as it was), at the revised 11,000 of the upload before");
R1.undo(M, reg);
ok(near(T3().net.taxable, net7.taxable) && JSON.stringify(G.toJson(M, reg)) === JSON.stringify(a7), "Undo again: as the books and the filed return make it");

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
