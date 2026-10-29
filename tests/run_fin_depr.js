// node run_fin_depr.js - depreciation under the Companies Act (Schedule II) and the Income-tax Act (section 32), last
// year's ITR read, and deferred tax (FinDepr, src/js/88-fin-depr.js; owner, 29-Oct-2026). Every expected figure is worked
// out by hand below (the working in the comments), to the rupee or the paisa, on made-up books (tests/fixtures/fin-depr):
//   Computers  WDV, 3 years, 5% residual: opening gross 5,00,000, depreciation 3,00,000; laptops 1,20,000 put to use
//              15-Jun-2025 (290 days in the year: 180 or more) and 90,000 on 10-Jan-2026 (81 days: under 180);
//   Furniture  SLM, 10 years, 5%: opening 3,00,000 / 1,20,000; 50,000 on 01-Oct-2025 (182 days);
//   Motor car  WDV, 8 years, 5%: opening 8,00,000 / 3,50,000, sold on 15-Nov-2025 for 3,80,000: its block (15%) ceases.
// ITR-6 and ITR-3 JSON in the shape the e-filing portal gives (made-up figures), an ITR PDF's text, and a part of the
// year (H1). Then the same books in FinSt: the trial balance's FinCom rows, the PPE note, the P&L, the computation's
// Annexure 1 and the deferred tax line, every check 0.
const {load, HTML} = require("./harness"), fs = require("fs"), path = require("path");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "FS", "FinDepr", "FinSt", "FinPyBs", "INR"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const eq = (a, b, w) => ok(Math.abs((a == null ? NaN : a) - b) < 0.005, w + ": " + a + (Math.abs((a == null ? NaN : a) - b) < 0.005 ? "" : " (expected " + b + ")"));
const FIX = path.join(__dirname, "fixtures", "fin-depr"), read = f => fs.readFileSync(path.join(FIX, f), "utf8");
const FD = x.FinDepr, FinSt = x.FinSt;

// rates: WDV rate for a life of n years and 5% residual = 1 - 0.05^(1/n): 3 years 63.1597%, 8 years 31.2344%
const r3 = 1 - Math.pow(0.05, 1 / 3), r8 = 1 - Math.pow(0.05, 1 / 8);
const CFG = {comp: {method: "WDV", life: 3, res: 5}, furn: {method: "SLM", life: 10, res: 5}, veh: {method: "WDV", life: 8, res: 5}};
const ITEMS = [
  {id: "o:comp", cls: "comp", name: "Computers (opening)", put: null, sale: null, cost: 500000, acc: 300000, value: 0},
  {id: "a:l1", cls: "comp", name: "Laptop 1", put: "20250615", sale: null, cost: 120000, acc: 0, value: 0},
  {id: "a:l2", cls: "comp", name: "Laptop 2", put: "20260110", sale: null, cost: 90000, acc: 0, value: 0},
  {id: "o:furn", cls: "furn", name: "Furniture (opening)", put: null, sale: null, cost: 300000, acc: 120000, value: 0},
  {id: "a:f1", cls: "furn", name: "Workstations", put: "20251001", sale: null, cost: 50000, acc: 0, value: 0},
  {id: "o:veh", cls: "veh", name: "Motor car (opening)", put: null, sale: "20251115", cost: 800000, acc: 350000, value: 380000}];

try {
  ok(FD && typeof FD.caItems === "function" && FinSt, "FinDepr is in the program (src/js/88-fin-depr.js)");
  ok(Math.abs(r3 - 0.6315968) < 1e-6 && Math.abs(r8 - 0.3123440) < 1e-6, "WDV rates: 3 years 63.1597%, 8 years 31.2344% (1 - 0.05^(1/n))");

  console.log("\nCompanies Act, the full year 2025-26 (365 days)");
  const FYo = {y0: "20250401", from: "20250401", to: "20260331", diy: 365};
  let r = FD.caItems(ITEMS, c => CFG[c], FYo), it = id => r.items.find(z => z.id === id), C = r.classes;
  // computers' opening: WDV 2,00,000 x 63.1597% x 365/365 = 1,26,319.37 (within the room 5,00,000 - 25,000 - 3,00,000)
  eq(it("o:comp").dep, 126319.37, "computers held all year: 2,00,000 x 63.1597% = 1,26,319.37");
  // laptop 1: 1,20,000 x 63.1597% x 290 / 365 = 60,218.00
  eq(it("a:l1").dep, 60218.00, "laptop put to use 15-Jun-2025: 1,20,000 x 63.1597% x 290/365 = 60,218.00");
  // laptop 2: 90,000 x 63.1597% x 81 / 365 = 12,614.63
  eq(it("a:l2").dep, 12614.63, "laptop put to use 10-Jan-2026: 90,000 x 63.1597% x 81/365 = 12,614.63");
  eq(C.comp.dep, 199152.00, "computers for the year 1,99,152.00");
  eq(C.comp.gC, 710000, "computers gross block: 5,00,000 + 1,20,000 + 90,000");
  eq(C.comp.dC, 499152.00, "... depreciation to date 3,00,000 + 1,99,152");
  eq(C.comp.nC, 210848.00, "... net block 2,10,848.00");
  // furniture SLM: (3,00,000 x 95%) / 10 = 28,500 a year; the addition (50,000 x 95% / 10) x 182/365 = 2,368.49
  eq(it("o:furn").dep, 28500, "furniture SLM on cost: 3,00,000 x 95% / 10 = 28,500");
  eq(it("a:f1").dep, 2368.49, "workstations from 01-Oct-2025: 4,750 x 182/365 = 2,368.49");
  eq(C.furn.nC, 199131.51, "furniture net block 3,50,000 - (1,20,000 + 30,868.49) = 1,99,131.51");
  // motor car: WDV 4,50,000 x 31.2344% x 228/365 (01-Apr to 14-Nov, the day before the sale) = 87,798.61;
  // carrying amount at the sale 3,62,201.39; sold for 3,80,000: profit 17,798.61
  eq(it("o:veh").dep, 87798.61, "motor car to the day before the sale: 4,50,000 x 31.2344% x 228/365 = 87,798.61");
  eq(it("o:veh").gain, 17798.61, "profit on sale: 3,80,000 - (8,00,000 - 3,50,000 - 87,798.61) = 17,798.61");
  eq(C.veh.gD, 800000, "the car's cost leaves the gross block");
  eq(C.veh.dD, 437798.61, "... and its depreciation, 3,50,000 + 87,798.61");
  eq(C.veh.gC + C.veh.dC, 0, "... nothing of the car is left");
  eq(r.total.dep, 317819.10, "the year's depreciation: 1,99,152.00 + 30,868.49 + 87,798.61 = 3,17,819.10");
  // straight line never goes below the residual: an old asset with 2,000 of room left takes 2,000
  const cap = FD.caItems([{id: "x", cls: "furn", put: null, sale: null, cost: 100000, acc: 93000, value: 0}], c => CFG[c], FYo);
  eq(cap.items[0].dep, 2000, "SLM stops at the residual value: 1,00,000 - 5,000 - 93,000 = 2,000 (not 9,500)");

  console.log("\nCompanies Act, a part of the year: H1 (01-Apr to 30-Sep-2025, 183 days) and H2");
  const H1 = FD.caItems(ITEMS, c => CFG[c], {y0: "20250401", from: "20250401", to: "20250930", diy: 365}), H2 = FD.caItems(ITEMS, c => CFG[c], {y0: "20250401", from: "20251001", to: "20260331", diy: 365});
  // 2,00,000 x 63.1597% x 183/365 = 63,332.73; laptop 1 for 108 days (15-Jun to 30-Sep): 22,426.01; laptop 2 not yet
  eq(H1.classes.comp.dep, 85758.74, "H1 computers: 63,332.73 + 22,426.01 = 85,758.74");
  eq(H1.classes.furn.dep, 14289.04, "H1 furniture: 28,500 x 183/365 = 14,289.04 (the addition of 01-Oct is H2's)");
  eq(H1.classes.veh.dep, 70469.94, "H1 motor car: 4,50,000 x 31.2344% x 183/365 = 70,469.94 (held all of H1)");
  eq(H1.classes.veh.gD, 0, "... not sold in H1");
  eq(H2.classes.comp.gO, 620000, "H2 starts with the H1 laptop in the opening gross block (6,20,000)");
  eq(H2.classes.comp.dO, 385758.74, "... and H1's depreciation in the opening depreciation (3,00,000 + 85,758.74)");
  eq(H2.classes.veh.dep, 17328.67, "H2 motor car 01-Oct to 14-Nov: 87,798.61 - 70,469.94 = 17,328.67");
  eq(H1.total.dep + H2.total.dep, r.total.dep, "H1 + H2 = the year (" + r.total.dep + ")");
  eq(H2.total.gain, 17798.61, "the profit on sale is H2's");

  console.log("\nIncome-tax Act, section 32 (previous year 2025-26)");
  const adds = [{block: "c40", put: "20250615", amt: 120000}, {block: "c40", put: "20260110", amt: 90000}, {block: "f10", put: "20251001", amt: 50000}];
  const sales = [{block: "pm15", date: "20251115", value: 380000}];
  const op = {c40: {open: 180000}, f10: {open: 240000}, pm15: {open: 400000}};
  let B = FD.itBlocks({fy: "2025", blocks: op, adds, sales, ceased: {pm15: true}}), bk = k => B.find(z => z.key === k) || {};
  // computers 40%: (1,80,000 + 1,20,000) x 40% + 90,000 x 20% (under 180 days) = 1,20,000 + 18,000 = 1,38,000
  eq(bk("c40").addA, 120000, "computers: 1,20,000 used 180 days or more");
  eq(bk("c40").addB, 90000, "... 90,000 under 180 days (81 days)");
  eq(bk("c40").dep, 138000, "... depreciation 3,00,000 x 40% + 90,000 x 20% = 1,38,000");
  eq(bk("c40").close, 252000, "... closing WDV 3,90,000 - 1,38,000 = 2,52,000");
  // furniture 10%: 01-Oct is 182 days to 31-Mar: the full rate: 2,90,000 x 10% = 29,000
  eq(bk("f10").addA, 50000, "furniture added 01-Oct-2025: 182 days, the full rate");
  eq(bk("f10").dep, 29000, "... depreciation 2,90,000 x 10% = 29,000; closing 2,61,000");
  // the block of the car ceases (every asset sold): no depreciation; 4,00,000 - 3,80,000 = 20,000 short-term capital loss
  ok(bk("pm15").ceased && bk("pm15").dep === 0 && bk("pm15").close === 0, "the 15% block ceases: no depreciation, closing nil");
  eq(bk("pm15").stcg, -20000, "... short-term capital loss 20,000 (section 50(2)), shown as (20,000)");
  B = FD.itBlocks({fy: "2025", blocks: {pm15: {open: 400000}}, sales: [{block: "pm15", date: "20251115", value: 420000}]});
  ok(B[0].dep === 0 && B[0].close === 0 && B[0].stcg === 20000, "a block that goes negative (sold for 4,20,000): short-term capital gain 20,000 (section 50(1)), no depreciation");
  B = FD.itBlocks({fy: "2025", blocks: {pm15: {open: 400000}}, sales: [{block: "pm15", date: "20251115", value: 100000}], adds: [{block: "pm15", put: "20260201", amt: 50000}]});
  eq(B[0].dep, 48750, "a block that goes on after a sale: (4,00,000 - 1,00,000) x 15% + 50,000 x 7.5% = 48,750");
  ok(FD.BLOCKS.length >= 9 && FD.BK.b5.rate === 0.05 && FD.BK.b10.rate === 0.1 && FD.BK.b40.rate === 0.4 && FD.BK.f10.rate === 0.1 && FD.BK.pm15.rate === 0.15 && FD.BK.pm30.rate === 0.3 && FD.BK.c40.rate === 0.4 && FD.BK.i25.rate === 0.25 && FD.BK.s20.rate === 0.2,
    "the blocks and rates of Appendix I (5, 10, 40 buildings; 10 furniture; 15, 30, 40 plant and machinery; 25 intangibles; 20 ships)");
  // H1 (an estimate: what is added and sold to 30-Sep, the depreciation for 183 of 365 days)
  const BH = FD.itBlocks({fy: "2025", to: "20250930", blocks: op, adds, sales, ceased: {}}), bh = k => BH.find(z => z.key === k) || {};
  eq(bh("c40").dep, 60164, "H1 estimate, computers: 3,00,000 x 40% x 183/365 = 60,164");
  eq(bh("pm15").dep, 30082, "H1 estimate, the car's block (not yet sold): 4,00,000 x 15% x 183/365 = 30,082");

  console.log("\nLast year's ITR");
  let R = FD.readItrJson(JSON.parse(read("itr6-ay2025.json")), "2025");
  ok(R.form === "ITR-6" && R.ay === "2025" && R.pan === "AABCW1234F" && !R.why, "ITR-6 JSON: the form, AY 2025-26 and the PAN read");
  ok(R.blocks.pm15 === 400000 && R.blocks.c40 === 180000 && R.blocks.f10 === 240000 && R.blocks.pm30 === 0 && R.blocks.b10 === 0, "... closing WDV (WDVLastDay) of each block: 15% 4,00,000; 40% 1,80,000; furniture 2,40,000");
  ok(R.found.some(f => /ScheduleDPM › PlantMachinery › Rate15/.test(f.path)) && R.found.some(f => /ScheduleDOA › FurnitureFittings › Rate10/.test(f.path)), "... read from Schedule DPM and Schedule DOA, each figure with its place in the file");
  R = FD.readItrJson(JSON.parse(read("itr6-ay2025.json")), "2024");
  ok(R.blocks.pm15 === 470588 && R.field === "WDVFirstDay", "the same return for the year before it: its first-day WDV (the opening of 2024-25)");
  R = FD.readItrJson(JSON.parse(read("itr3-ay2025.json")), "2025");
  ok(R.form === "ITR-3" && R.pan === "ABCPS1234K" && R.blocks.pm15 === 127500 && R.blocks.pm30 === 140000 && R.blocks.c40 === 30000 && R.blocks.b10 === 900000 && R.blocks.f10 === 18000, "ITR-3 JSON (PersonalInfo, other blocks): 15% 1,27,500; 30% 1,40,000; 40% 30,000; buildings 9,00,000; furniture 18,000");
  R = FD.readItrJson(JSON.parse(read("itr4-ay2025.json")), "2025");
  ok(/ITR-4 has no depreciation schedules/.test(R.why), "ITR-4: said plainly that it has no depreciation schedules");
  R = FD.readItrJson(JSON.parse(read("itr6-ay2025.json")), "2027");
  ok(/assessment year 2025-26/.test(R.warn || ""), "a return for another year: said so");
  R = FD.readItrText(read("itr6-ay2025.txt"), "2025");
  ok(R.src === "pdf" && R.form === "ITR-6" && R.pan === "AABCW1234F" && R.blocks.pm15 === 400000 && R.blocks.c40 === 180000 && R.blocks.f10 === 240000 && !R.why, "the ITR's PDF text: Schedule DPM and DOA's last-day WDV read (4,00,000; 1,80,000; 2,40,000)");
  R = FD.readItrText("   \n  \n", "2025");
  ok(/no text to read/.test(R.why), "a PDF with no text (a scan): said plainly, not guessed");
  R = FD.readItrText("FORM ITR-6\nAssessment Year 2025-26\nPart A-BS balance sheet as on 31st March 2025 lots of other words here to read", "2025");
  ok(/could not find the closing written down value/.test(R.why), "a PDF without Schedule DPM / DOA: said so");

  console.log("\nDeferred tax (115BAA, 25.168%)");
  const rt = FD.rateFor("115BAA");
  ok(rt.rate === 25.168, "115BAA: 22% x 1.10 x 1.04 = 25.168%");
  ok(/115JB\(5A\)/.test(FD.MAT("115BAA")) && /115JB/.test(FD.MAT("normal")), "MAT: not relevant under 115BAA (section 115JB(5A)); a note for the normal rates");
  // book WDV 2,10,848.00 + 1,99,131.51 = 4,09,979.51; tax WDV 2,52,000 + 2,61,000 = 5,13,000: difference (1,03,020.49);
  // gratuity provision 75,000 and leave 20,000 (allowed when paid): (95,000); total (1,98,020.49) x 25.168% = (49,838)
  const DT = FD.dtCalc([{key: "dep", diff: 409979.51 - 513000}, {key: "grat", diff: -75000}, {key: "leave", diff: -20000}], 25.168, 12000);
  eq(DT.closing, -49838, "closing deferred tax asset 49,838 (1,98,020.49 x 25.168%, to the rupee)");
  eq(DT.move, -61838, "movement: (49,838) - last year's liability 12,000 = a credit of 61,838 to the P&L");

  console.log("\nThe books in FinSt: register, Annexure 1, deferred tax, every check 0");
  const F = JSON.parse(read("books.json"));
  const mk = () => {
    const under = Object.assign({}, F.groups), led = {};
    Object.entries(F.open).forEach(([n, v]) => { led[n] = {open: -v, close: 0, parent: under[n]}; });
    const vouchers = F.vouchers.map((v, i) => ({id: "v" + i, date: v[0], no: String(i + 1), type: v[1], narr: v[2], ent: v[3].map(([l, a]) => ({l, a: -a}))}));
    return {under, groups: {}, ledInfo: {}, vouchers, meta: {from: "20250401"}, tb: {from: "20250401", to: "20260331", at: "2026-04-30T10:00:00Z", src: "copy", led}, msme: {}, fs: JSON.parse(JSON.stringify(F.fs))};
  };
  ctx.CO = () => ({name: "Wren Systems Private Limited (made-up)", pan: "AABCW1234F", cin: "U72900KA2015PTC000002"});
  let b = mk(); ctx.S.books = b;
  let d0 = FinSt.build("2025", {unit: 1, dec: 2});
  ok(!d0.error, "built without FinDepr in use" + (d0.error ? ": " + d0.error : ""));
  ok(!d0.depr && !d0.tb.rows.some(r => r.depr), "until the tab is used, the statements are as before (no FinCom rows, no d.depr)");
  eq(d0.pl.dep.cy, 100000, "... the books' depreciation 1,00,000");
  FD.start(); FD.itrSave("2025", Object.assign(FD.readItrJson(JSON.parse(read("itr6-ay2025.json")), "2025"), {file: "itr6-ay2025.json"}));
  FD.cfgSet("furn", {method: "SLM"}); FD.cfgSet("comp", {method: "WDV", life: 3}); FD.cfgSet("veh", {method: "WDV", life: 8});
  let d1 = FinSt.build("2025", {unit: 1, dec: 2});
  ok(d1.depr && d1.depr.ca, "the tab in use: d.depr has the register");
  const cc = d1.depr.ca.classes;
  ok(!cc.pm && d1.pyCheck && d1.pyCheck.bad === 0, "the balance sheet's face line \"Property, plant and equipment\" is not read as a class (no plant and machinery); last year's balance sheet agrees with the opening");
  ok(cc.comp.open.src === "upload" && cc.comp.open.gross === 500000 && cc.comp.open.acc === 300000 && cc.veh.open.acc === 350000, "the classes' opening from last year's balance sheet (the PPE note's gross block and depreciation)");
  eq(cc.comp.dep, 199152.00, "the register from the day book: computers 1,99,152.00");
  eq(cc.furn.dep, 30868.49, "... furniture 30,868.49");
  eq(cc.veh.dep, 87798.61, "... motor car 87,798.61, and its sale found in the day book (sale value 3,80,000)");
  eq(cc.veh.gainP, 17798.61, "... profit on sale 17,798.61");
  eq(cc.comp.booked + cc.furn.booked, 100000, "the books' own depreciation read (70,000 + 30,000)");
  ok(!d1.tb.rows.some(r => r.depr), "not yet used in the statements: no FinCom rows");
  const ann = d1.comp.itdep;
  ok(ann.depr && ann.blocks.find(z => z.key === "c40").open === 180000 && ann.blocks.find(z => z.key === "c40").src === "itr", "the computation's Annexure 1: opening WDV from the ITR");
  eq(ann.total, 167000, "... section 32 depreciation 1,38,000 + 29,000 + nil (the car's block ceased) = 1,67,000");
  eq((d1.comp.lines.find(l => l.key === "less_itdep") || {}).v, 167000, "... and the computation deducts 1,67,000");
  ok(ann.blocks.find(z => z.key === "pm15").ceased && ann.stcl === 20000, "... the 15% block ceased: short-term capital loss 20,000");

  FD.useSet("2025", {ca: true, dt: true});
  let d = FinSt.build("2025", {unit: 1, dec: 2});
  const rowsD = d.tb.rows.filter(r => r.depr);
  ok(rowsD.length >= 6, "used in the statements: FinCom rows in the trial balance (" + rowsD.length + ")");
  eq(rowsD.reduce((s, r) => s + r.final, 0), 0, "... which net to nil");
  eq(d.pl.dep.cy, 317819.10, "P&L depreciation = the register's 3,17,819.10");
  const g = d.ppe.cy, gr = cls => g.rows.find(z => z.cls === cls) || {};
  ok(g.fromRegister, "the PPE note is the register's");
  ok(gr("comp").D === 500000 && gr("comp").E === 210000 && gr("comp").G === 710000 && gr("comp").H === 300000 && gr("comp").I === 199152 && gr("comp").K === 499152 && gr("comp").M === 210848, "PPE note, computers: gross 5,00,000 + 2,10,000 = 7,10,000; depreciation 3,00,000 + 1,99,152 = 4,99,152; net 2,10,848");
  ok(gr("veh").F === -800000 && gr("veh").J === -437798.61 && gr("veh").M === 0, "PPE note, the car: (8,00,000) out of the gross block, (4,37,798.61) out of depreciation");
  eq((d.notes.find(n => n.key === "14").lines.find(l => l.code === "14B") || {}).cy, 17798.61, "Note 14: profit on sale of assets 17,798.61");
  eq(d.depr.dt.closing, -49838, "deferred tax: closing asset 49,838 (as worked out above)");
  const dr0 = d.depr.dt.rows.find(z => z.key === "dep");
  ok(dr0.book === 409979.51 && dr0.tax === 513000 && dr0.dtax === -25928, "... its depreciation line: books 4,09,979.51 less tax WDV 5,13,000, deferred tax (25,928)");
  eq(d.depr.dt.open, 12000, "... last year's liability 12,000 from the uploaded balance sheet");
  eq(d.pl.def.cy, -61838, "P&L deferred tax: a credit of 61,838");
  eq(d.bs.sections.NCA.lines.find(l => l.id === "dta").cy, 49838, "balance sheet: deferred tax assets (net) 49,838");
  eq(d.bs.sections.NCL.lines.find(l => l.id === "dtl").cy, 0, "... and the books' liability of 12,000 moved across (nil)");
  const bad = d.checks.filter(c => c.value !== 0);
  ok(!bad.length, "every check reads 0" + (bad.length ? ": " + bad.map(c => c.key + " " + c.value).join(", ") : ""));
  ok(d.depr.dt.mat && /115JB\(5A\)/.test(d.depr.dt.mat), "the MAT note: not relevant under 115BAA");
  // the unit: thousands with no decimals still ties
  const dk = FinSt.build("2025", {unit: 1000, dec: 0});
  ok(!dk.checks.filter(c => c.value !== 0).length, "in thousands, 0 decimals: every check reads 0" + (dk.checks.filter(c => c.value !== 0).map(c => " " + c.key + " " + c.value).join("")));

  console.log("\nA part of the year: H1");
  const dh = FinSt.build("2025", {unit: 1, dec: 2, period: {preset: "h1"}});
  eq(dh.pl.dep.cy, 170517.72, "H1 P&L depreciation = 85,758.74 + 14,289.04 + 70,469.94");
  ok(dh.depr.dt.part && /estimate/.test(dh.depr.dt.partNote), "H1 deferred tax: the tax WDV is an estimate, said so");
  // book WDV at 30-Sep 7,79,482.28; tax WDV (estimate) 2,39,836 + 2,27,967 + 3,69,918 = 8,37,721; provisions 60,000 + 20,000
  // ((58,238.72) + (80,000)) x 25.168% = (34,792)
  eq(dh.depr.dt.closing, -34792, "H1 deferred tax asset 34,792");
  ok(!dh.checks.filter(c => c.value !== 0).length, "H1: every check reads 0" + dh.checks.filter(c => c.value !== 0).map(c => " " + c.key + " " + c.value).join(""));
  const dq = FinSt.build("2025", {unit: 1, dec: 2, period: {preset: "q2"}});
  ok(!dq.tb.rows.some(r => r.depr) && /from 1 April/.test(dq.depr.postNote), "Q2 (not from 1 April): shown on the tab only, said so");
  eq(dq.depr.ca.total.dep, 85758.74 + 14289.04 + 70469.94 - FD.caItems(ITEMS, c => CFG[c], {y0: "20250401", from: "20250401", to: "20250630", diy: 365}).total.dep, "Q2's register = H1 less Q1");
} catch (e){ console.log("  FAIL threw: " + (e && e.stack || e)); fails++; }
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
