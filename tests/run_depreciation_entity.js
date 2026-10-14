// node run_depreciation_entity.js - depreciation by entity type and the fixed asset register (src/js/80-assets.js, FAR), after
// the owner's question of 14-Oct-2026: "If the organisation is a firm or proprietor, why is the system calculating
// depreciation as per the Companies Act, and why deferred tax?" Every figure against an answer worked by hand here, on
// the register of tests/dep_fixtures.js (handRegister, FY 2025-26). Test data only.
//   1. a proprietor: the books at the Income-tax rates (the block schedule), each block's charge shared among its assets;
//      no Companies Act, no Schedule II, no deferred tax anywhere (screen tables, print, Excel, Word)
//   2. a firm with its own straight-line policy: deferred tax at ICAI Level II, none at Level IV
//   3. a company: unchanged
//   4. switching the entity changes the defaults only: the register (typed lives, overrides) is untouched
//   5. the entity and the level as the statements keep them (FAR.optsFor), and the statements' fixed-asset note by basis
//   6. the register as auditors read it: rows by class, subtotals, grand total; tied to the books (trial balance); each
//      asset ledger's entries with the running balance; carried forward to the next year
//   7. the exports: register, books, IT blocks, deferred tax (only where it applies), everything; formulas recalculated
//      apart from FinCom equal the screen's figures
const fs = require("fs"), path = require("path");
const {load, HTML, OUT} = require("./harness");
const F = require("./dep_fixtures"), RF = require("./reports_fixtures");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {ctx, x} = load(HTML, ["FAR"]);
const FAR = x.FAR, FSX = RF.loadFSX();
const eq = (a, b) => Math.round(a * 100) === Math.round(b * 100);
const H = () => F.handRegister();
const text = res => JSON.stringify(FAR.tables(res)) + JSON.stringify(res.confirm || []);
const unzip = buf => { const out = {}; let i = 0; const b = Buffer.from(buf); while (b.readUInt32LE(i) === 0x04034b50){ const n = b.readUInt16LE(i + 26), e = b.readUInt16LE(i + 28), sz = b.readUInt32LE(i + 18), name = b.slice(i + 30, i + 30 + n).toString(); out[name] = b.slice(i + 30 + n + e, i + 30 + n + e + sz).toString(); i += 30 + n + e + sz; } return out; };
const recalc = file => { let rc = ""; try { rc = require("child_process").execFileSync("python3", ["-W", "ignore", path.join(__dirname, "reports_recalc.py"), file], {encoding: "utf8", timeout: 300000}); } catch (e){ rc = String(e.stdout || e.message); }
  return [...rc.matchAll(/(LibreOffice|Python evaluator) (\d+) formulas, (\d+) differ/g)].map(m => [m[1], Number(m[2]), Number(m[3])]); };

console.log("== 1. a proprietor: the books at the Income-tax rates");
// the blocks (as in run_depreciation.js part 3): 15% (the machine and the AC): 2,10,000 x 15% + 1,50,000 (132 days) x 7.5% = 42,750;
// 40%: the laptop, its only asset, sold: emptied, nothing. The books' charge is the same 42,750, shared within the 15% block by
// what the rate works on: the machine 2,40,000 carried + half of 1,50,000 = 3,15,000; the AC 2,250; of 3,17,250:
//   the AC 42,750 x 2,250 / 3,17,250 = 303.19; the machine takes the rest, 42,446.81
const RP = FAR.compute(H(), null, {kind: "proprietor"}), a = l => RP.assets.find(z => z.ledger === l);
ok(RP.basis === "it" && !RP.co && RP.dt === null && RP.dtApplies === false && /no deferred tax/.test(RP.dtWhy), "1. a proprietor: books at the Income-tax rates, no deferred tax (" + RP.dtWhy.slice(0, 60) + "…)");
ok(eq(RP.totals.dep, 42750) && eq(RP.totals.dep, RP.totals.itDep + RP.totals.itAddl), "1. the books' depreciation is the blocks' 42,750: one schedule");
ok(eq(a("AC - Hitachi").dep, 303.19) && eq(a("Edge Binding Machine").dep, 42446.81) && a("HP Laptop").dep === 0, "1. shared within the block: AC 303.19, machine 42,446.81, the laptop sold none (" + [a("AC - Hitachi").dep, a("Edge Binding Machine").dep] + ")");
const hp = a("HP Laptop");
ok(hp.gDel === 52000 && hp.dDel === 20000 && hp.nClose === 0 && eq(hp.sales[0].carrying - hp.sales[0].value, 14000), "1. the laptop leaves the register at cost and its depreciation; 14,000 of its carrying amount stays in the block (block method)");
const tp = text(RP);
const NOT = /Companies Act|(?<!no )Schedule II|(?<!no )deferred tax/i;
ok(!NOT.test(tp) && !FAR.tables(RP).some(t => t.id === "dt" || t.id === "classes"), "1. no Companies Act, Schedule II or deferred tax in the schedules or the Confirm list");
const hP = FAR.html(RP, {name: "Pal Traders"});
ok(!/Companies Act|Schedule II|Deferred tax working/.test(hP) && /one schedule for the books and for tax/.test(hP) && /no deferred tax/.test(hP), "1. the print view says so, without the Companies Act");
const xP = FSX.xlsx(FAR.sheets(RP, {name: "Pal Traders"}, "all"), {}), zP = unzip(xP);
ok(!NOT.test(zP["xl/workbook.xml"] + zP["xl/sharedStrings.xml"]) && /Register/.test(zP["xl/workbook.xml"]) && /Income-tax blocks/.test(zP["xl/workbook.xml"]), "1. the Excel: register and blocks, no deferred tax or Schedule II");
ok(!NOT.test(unzip(FSX.docx(FAR.docxBlocks(RP, {name: "Pal Traders"}, "all")))["word/document.xml"]), "1. the Word likewise");
ok(!RP.confirm.some(c => /^(cls|rem|noacc|need:life|need:cls|dt)/.test(c.key)), "1. the Confirm list asks no Schedule II class, life or deferred tax rate");

console.log("== 2. a firm with its own straight-line policy");
// the same register, the firm's own policy (straight line, residual 5%): the books' 36,616.75 as worked in run_depreciation.js;
// deferred tax at 31.2% (30% with cess): (3,68,359.83 - 3,17,250 = 51,109.83) x 31.2% = 15,946.27; at the start
// (2,74,250 - 2,35,000 = 39,250) x 31.2% = 12,246.00; the year's charge 3,700.27
const own = () => { const r = H(); r.kind = "firm"; r.settings = Object.assign({}, r.settings, {bookBasis: "own", dtRate: null}); return r; };
const R2 = FAR.compute(own(), null, {kind: "firm", levelIV: false});
ok(R2.basis === "own" && eq(R2.totals.dep, 36616.75) && R2.dt && eq(R2.dt.close, 15946.27) && eq(R2.dt.open, 12246) && eq(R2.dt.move, 3700.27), "2. Level II: the firm's policy 36,616.75; deferred tax 15,946.27, charge 3,700.27 (" + (R2.dt && [R2.dt.close, R2.dt.move]) + ")");
ok(!/Companies Act|Schedule II/.test(text(R2)) && FAR.tables(R2).some(t => t.id === "dt") && /the firm's policy/.test(FAR.words(R2).books), "2. the headings say the firm's policy, not the Companies Act");
const R4 = FAR.compute(own(), null, {kind: "firm", levelIV: true});
ok(R4.dt === null && /Level IV/.test(R4.dtWhy) && !FAR.tables(R4).some(t => t.id === "dt") && eq(R4.totals.dep, 36616.75) && !FAR.exportsFor(R4).some(([k]) => k === "dt"), "2. Level IV: the same books, no deferred tax (and no deferred tax export)");

console.log("== 3. a company: unchanged");
const RC = FAR.compute(H(), null, {kind: "company"});
ok(RC.basis === "sch2" && eq(RC.totals.dep, 36616.75) && eq(RC.dt.close, 12863.32) && eq(RC.dt.move, 2984.88) && /Companies Act/.test(FAR.words(RC).books), "3. company: Schedule II 36,616.75, deferred tax 12,863.32 (AS 22), as before");
ok(JSON.stringify(FAR.compute(H()).totals) === JSON.stringify(RC.totals), "3. a register with no entity given is a company's");

console.log("== 4. switching the entity changes the defaults only");
const reg = H(); reg.assets.find(z => z.ledger === "AC - Hitachi").override = {dep: 500, reason: "damaged"}; reg.assets[0].life = 12; reg.assets[0].lifeWhy = "technical estimate";
const before = JSON.stringify(reg);
const c1 = FAR.compute(reg, null, {kind: "company"}), f1 = FAR.compute(reg, null, {kind: "firm"}), c2 = FAR.compute(reg, null, {kind: "company"});
ok(JSON.stringify(reg) === before, "4. the register is not changed by computing it as a firm and as a company");
ok(f1.basis === "it" && !f1.assets.some(z => z.override) && c1.assets.find(z => z.ledger === "AC - Hitachi").dep === 500 && JSON.stringify(c1.totals) === JSON.stringify(c2.totals), "4. as a firm the typed override and life rest unused; back to a company they apply again, the same figures");

console.log("== 5. the entity and the level from the client; the statements' note");
const b = {cid: "c9", fs: {rx: {kind: "firm", det: {"2025": {policies: {switches: {levelIV: true}}}}}}, fixedAssets: {"2025": own()}};
const o5 = FAR.optsFor(b, "2025");
ok(o5.kind === "firm" && o5.levelIV === true && FAR.forYear(b, "2025").dt === null, "5. the statements' layout (firm) and Level IV switch: no deferred tax");
ctx.S.companies = {c8: {id: "c8", pan: "AAAPL1234C"}}; ctx.FS = {entityOf: co => ({code: String((co || {}).pan || "")[3] || ""})};
ok(FAR.entityOf({cid: "c8"}) === "proprietor" && FAR.entityOf({cid: "zz"}) === "company", "5. otherwise the entity from Client setup / the PAN (P: proprietor)");
const firm = RF.firm(), stf = RF.confirmed(FSX, firm);
const nIt = FSX.run(Object.assign({}, firm, {mapStore: stf, det: FAR.feedDet(firm.det, FAR.compute(H(), null, {kind: "firm"}))})).model.notes.find(n => n.key === "ppe");
const b15 = nIt.cyBlocks.find(z => z.b === FAR.block("pm15").name).cells.map(c => c.v);
ok(nIt.itBlock && b15[6] === 4275000 && b15[9] === 31725000, "5. books at the Income-tax rates: the statements' fixed-asset note is the block schedule (42,750; closing 3,17,250)");
const nOwn = FSX.run(Object.assign({}, firm, {mapStore: stf, det: FAR.feedDet(firm.det, R2)})).model.notes.find(n => n.key === "ppe");
const pmRow = nOwn.tables.find(z => z.far === "cy").rows.find(r => r.t === FAR.cls("pm_general").name);
ok(!nOwn.itBlock && pmRow && pmRow.c[5].v === 2389017, "5. the firm's own policy: the gross-block schedule from the register (23,890.17 for plant and machinery)");

console.log("== 6. the register, the books, the ledger, the next year");
const G = RC.register, grp = k => G.groups.find(g => g.key === k);
ok(G.by === "class" && G.groups.map(g => g.key).join() === "pm_general,office,computer_eud" && G.groups.reduce((s, g) => s + g.rows.length, 0) === 3, "6. one row per asset, grouped by class in Schedule II's order");
ok(eq(grp("pm_general").sub.dep, 23890.17) && eq(G.total.dep, 36616.75) && eq(G.total.gClose, 495000) && eq(G.total.nClose, 368359.83) && FAR.REG_COLS.every(k => eq(G.total[k], G.groups.reduce((s, g) => s + g.sub[k], 0))), "6. subtotals and the grand total (cost 4,95,000; depreciation 36,616.75; net 3,68,359.83)");
const rEdge = grp("pm_general").rows[0];
ok(rEdge.purchased === "2025-11-20" && rEdge.block === FAR.block("pm15").name && rEdge.rate === 15, "6. a row: date of purchase, income-tax block and rate");
ok(RP.register.by === "block" && RP.register.groups.map(g => g.key).join() === "pm15,pm40", "6. a proprietor's register is grouped by block");
// the books: book A proposed (FY 2025-26): asset ledgers at the end 45,000 + (3,00,000 + 1,50,000) + (52,000 - 18,000) = 5,29,000;
// accumulated depreciation 1,10,000 + 20,000 = 1,30,000 (nothing posted in the year)
const PA = FAR.propose(F.books.A), RA = FAR.compute(PA);
const tbGross = F.books.A.ledgers.filter(l => !FAR.isAccDep(l.l)).reduce((s, l) => s + l.open, 0) + 150000 - 18000;
const tbAcc = -F.books.A.ledgers.filter(l => FAR.isAccDep(l.l)).reduce((s, l) => s + l.open, 0);
ok(eq(RA.tie.books.gross, tbGross) && tbGross === 529000 && eq(RA.tie.books.acc, tbAcc) && tbAcc === 130000, "6. the books at the end: asset ledgers 5,29,000, accumulated depreciation 1,30,000");
ok(eq(RA.tie.register.gross, RA.register.total.gClose) && eq(RA.tie.diff.net, RA.register.total.nClose - (tbGross - tbAcc)) && !RA.tie.ok, "6. the register against them: the difference shown (" + RA.tie.diff.net + ")");
// a register whose books carry the year's depreciation ties: a lathe 1,00,000, 40,000 depreciated, 10 years left (SLM, 5%):
// (60,000 - 5,000) / 10 = 5,500 posted to its accumulated-depreciation ledger
const tied = {fy: "2025", kind: "company", settings: {method: "SLM", residualPct: 5}, ok: {}, blocks: {pm15: {open: 50000}},
  assets: [{id: "L:Lathe", ledger: "Lathe", group: "", cls: "pm_general", clsSure: true, block: "pm15", blockSure: true, remLife: 10, bookOpen: 100000, bookDr: 0, bookCr: 0, adds: [], moves: []}],
  accDep: [{ledger: "Acc Dep Lathe", open: 40000, match: {kind: "asset", id: "L:Lathe"}, booked: 5500, dr: 0, cr: 5500, byHand: true}]};
const RT = FAR.compute(tied);
ok(eq(RT.assets[0].dep, 5500) && RT.tie.ok && RT.tie.diff.net === 0 && RT.je.lines.length === 0, "6. depreciation posted in the books: the register ties to the trial balance, no journal suggested");
const le = FAR.ledgerEntries(PA.assets.find(z => z.ledger === "Edge Binding Machine")), lh = FAR.ledgerEntries(PA.assets.find(z => z.ledger === "HP Laptop"));
ok(le.length === 2 && le[0].bal === 300000 && le[1].dr === 150000 && le[1].bal === 450000 && le[1].vno === "A1" && /Sharma Machines/.test(le[1].particulars), "6. the machine's ledger: opening 3,00,000, the purchase from Sharma Machines, 4,50,000");
ok(lh[1].cr === 18000 && lh[1].bal === 34000 && lh[1].taken === "sold", "6. the laptop's ledger: the receipt of 18,000, 34,000 left");
const nx = FAR.carryForward(H());
const RN = FAR.compute(nx, H());
ok(nx.fy === "2026" && nx.assets.length === 2 && eq(RN.blocks.find(z => z.k === "pm15").open, 317250) && eq(RN.assets.find(z => z.ledger === "Edge Binding Machine").gOpen, 450000) && eq(RN.assets.find(z => z.ledger === "Edge Binding Machine").dOpen, 83890.17),
  "6. carried to 2026-27: the laptop gone, the machine at 4,50,000 less 83,890.17, the block at 3,17,250");

console.log("== 7. the exports");
const res7 = [["company", RC], ["proprietor", RP], ["firm-own", R2]];
res7.forEach(([nm, r]) => {
  const which = FAR.exportsFor(r).map(z => z[0]);
  which.forEach(w => {
    const sh = FAR.sheets(r, {name: "Kestrel " + nm}, w), file = path.join(OUT, "dep-export-" + nm + "-" + w + ".xlsx");
    fs.writeFileSync(file, Buffer.from(FSX.xlsx(sh, {})));
    const z = unzip(fs.readFileSync(file)), formulas = Object.keys(z).filter(k => /worksheets\/sheet/.test(k)).reduce((s, k) => s + (z[k].match(/<f>/g) || []).length, 0);
    ok(sh.length && formulas > 0 && /KESTREL/.test(z["xl/sharedStrings.xml"]) && /2025-26|March 31, 2026/.test(z["xl/sharedStrings.xml"]), "7. " + nm + ", " + w + ": opens, " + sh.map(s => s.name).join(" + ") + ", " + formulas + " formulas, the client and the year in the header");
  });
  const all = path.join(OUT, "dep-export-" + nm + "-all.xlsx"), rc = recalc(all);
  ok(rc.length >= 1 && rc.every(([, n, d]) => n > 30 && d === 0), "7. " + nm + ", everything: recalculated apart from FinCom equals the screen's figures (" + rc.map(z => z.join(" ")).join("; ") + ")");
  const regSh = FAR.sheets(r, {name: "x"}, "register")[0], gt = regSh.rows.find(row => row[0] && row[0].v === "Grand total");
  ok(gt && FAR.REG_COLS.every((k, j) => eq(gt[5 + j].v, r.register.total[k])), "7. " + nm + ": the register's grand total in the Excel is the screen's");
});
ok(!FAR.exportsFor(RP).some(([k]) => k === "dt") && FAR.exportsFor(RC).some(([k]) => k === "dt"), "7. the deferred tax export only where it applies");
const wd = unzip(FSX.docx(FAR.docxBlocks(RC, {name: "Kestrel"}, "register")))["word/document.xml"], hr = FAR.html(RC, {name: "Kestrel"}, "register");
ok(/Edge Binding Machine/.test(wd) && /Grand total/.test(wd) && /Grand total/.test(hr) && /4,95,000\.00/.test(hr), "7. the register as Word and as the print view (PDF)");
console.log("\n" + (fails ? fails + " FAILED" : "all passed"));
process.exit(fails ? 1 : 0);
