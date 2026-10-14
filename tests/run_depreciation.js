// node run_depreciation.js - fixed assets and depreciation (src/js/80-assets.js, FAR), the owner's approval of 14-Oct-2026.
// Every figure is checked to the paisa against an answer worked out by hand HERE, in the comments beside it, apart from
// FAR's code (FY 2025-26: 1 April 2025 to 31 March 2026, 365 days). FAR is read from the built page (site-test), so
// the build carries it. Test data only (tests/dep_fixtures.js).
//   1. Companies Act, SLM and WDV: a full-year asset, a mid-year addition, a sale mid-year (gain or loss), an old asset
//      with 2 years left, an asset fully depreciated, one whose life ends within the year; a hand override with a reason
//   2. Income-tax blocks (section 32): additions of 180 days or more and under, the 180th day, a sale reducing the full-rate
//      part, a sale above the block (STCG), a block emptied (STCL), additional depreciation and its half carried to the
//      next year, last year's closing as this year's opening, rupee rounding
//   3. a whole register: per class (det.far), per block (det.itBlocks), deferred tax, the suggested journal entry
//   4. the register proposed from books shaped like the four real patterns: per-asset and per-block accumulated
//      depreciation, the rate in the group's name; accumulated depreciation never an asset; the Confirm list
//   5. the statements (FSX, 78-reports.js) use the computed figures: the PPE note, the income-tax block note with STCG,
//      STCL and additional depreciation, check 11, Form 3CD clause 18; the Excel recalculated apart from FinCom
const fs = require("fs"), path = require("path");
const {load, HTML, OUT} = require("./harness");
const F = require("./dep_fixtures"), RF = require("./reports_fixtures");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {x} = load(HTML, ["FAR"]);
const FAR = x.FAR;
const eq = (a, b) => Math.round(a * 100) === Math.round(b * 100);
const asset = (o) => Object.assign({id: "L:" + o.ledger, group: "", clsSure: true, blockSure: true, adds: [], moves: [], bookOpen: o.openGross || 0}, o);
const reg = (assets, settings, blocks, extra) => Object.assign({v: 1, fy: "2025", kind: "company", settings: Object.assign({residualPct: 5}, settings || {}), assets, accDep: [], blocks: blocks || {}, ok: {}}, extra || {});
const one = (a, method) => FAR.compute(reg([asset(a)], {method})).assets[0];

console.log("== 1. Companies Act, asset by asset");
// 1a. a machine of 1,00,000 put to use on 01-04-2025 (all 365 days), life 15 (Schedule II, plant and machinery), residual 5% = 5,000
//   SLM: (1,00,000 - 5,000) / 15 = 6,333.333 -> 6,333.33
//   WDV: rate 1 - 0.05^(1/15) = 0.18103627; 1,00,000 x 0.18103627 = 18,103.63
const m1 = {ledger: "Lathe", cls: "pm_general", block: "pm15", adds: [{key: "k1", date: "2025-04-01", amount: 100000, kind: "add", putToUse: "2025-04-01"}]};
ok(eq(one(m1, "SLM").dep, 6333.33), "1a. full year, SLM: 6,333.33 (" + one(m1, "SLM").dep + ")");
ok(eq(one(m1, "WDV").dep, 18103.63), "1a. full year, WDV: 18,103.63 (" + one(m1, "WDV").dep + ")");
// 1b. a laptop of 60,000 put to use on 01-10-2025: 182 days (Oct 31, Nov 30, Dec 31, Jan 31, Feb 28, Mar 31), life 3, residual 3,000
//   SLM: 57,000 / 3 x 182/365 = 9,473.97;  WDV: 60,000 x (1 - 0.05^(1/3) = 0.63159700) x 182/365 = 18,895.99
const m2 = {ledger: "Laptop", cls: "computer_eud", block: "pm40", adds: [{key: "k2", date: "2025-10-01", amount: 60000, kind: "add", putToUse: "2025-10-01"}]};
ok(eq(one(m2, "SLM").dep, 9473.97), "1b. added 01-10-2025, SLM: 9,473.97 (" + one(m2, "SLM").dep + ")");
ok(eq(one(m2, "WDV").dep, 18895.99), "1b. added 01-10-2025, WDV: 18,895.99 (" + one(m2, "WDV").dep + ")");
// 1c. a car: cost 8,00,000, depreciation to 31-03-2025 2,00,000, put to use 01-04-2023 (2 years gone of 8: 6 left), sold
//     30-09-2025 for 5,50,000 (183 days: Apr 30 + May 31 + Jun 30 + Jul 31 + Aug 31 + Sep 30). Carrying 6,00,000, residual 40,000.
//   SLM: (6,00,000 - 40,000) / 6 x 183/365 = 46,794.52; carrying at sale 5,53,205.48; loss 5,50,000 - 5,53,205.48 = (3,205.48)
//   WDV: rate 1 - (40,000 / 6,00,000)^(1/6) = 0.36322678; 6,00,000 x 0.36322678 x 183/365 = 1,09,266.58; gain 5,50,000 - 4,90,733.42 = 59,266.58
const m3 = {ledger: "Car", cls: "mv_car", block: "pm15", typedOpen: true, openGross: 800000, openAcc: 200000, putToUse: "2023-04-01", moves: [{key: "k3", date: "2025-09-30", amount: 550000, kind: "sale", sale: 550000}]};
const c3s = one(m3, "SLM"), c3w = one(m3, "WDV");
ok(eq(c3s.dep, 46794.52) && eq(c3s.sales[0].gain, -3205.48) && eq(c3s.gDel, 800000) && eq(c3s.dDel, 246794.52) && eq(c3s.gClose, 0) && eq(c3s.dClose, 0),
  "1c. sold 30-09-2025, SLM: depreciation 46,794.52 to the date of sale, loss (3,205.48); 8,00,000 and 2,46,794.52 taken off (" + [c3s.dep, c3s.sales[0].gain, c3s.dDel] + ")");
ok(eq(c3w.dep, 109266.58) && eq(c3w.sales[0].gain, 59266.58), "1c. sold 30-09-2025, WDV: 1,09,266.58, gain 59,266.58 (" + [c3w.dep, c3w.sales[0].gain] + ")");
// 1d. furniture: cost 2,00,000, depreciation to date 1,40,000, 2 years left; residual 10,000, carrying 60,000
//   SLM: (60,000 - 10,000) / 2 = 25,000.00;  WDV: 60,000 x (1 - (10,000/60,000)^(1/2) = 0.59175171) = 35,505.10
const m4 = {ledger: "Sofa", cls: "furniture", block: "ff10", typedOpen: true, openGross: 200000, openAcc: 140000, remLife: 2};
ok(eq(one(m4, "SLM").dep, 25000) && eq(one(m4, "SLM").nClose, 35000), "1d. 2 years left, SLM: 25,000.00, carrying 35,000.00 at the end");
ok(eq(one(m4, "WDV").dep, 35505.10), "1d. 2 years left, WDV: 35,505.10 (" + one(m4, "WDV").dep + ")");
// 1e. an AC bought 01-04-2019, life 5 (office equipment): its life ended on 31-03-2024; cost 50,000, depreciated to its residual
//     2,500 (47,500): nothing more in either method, it stays at 2,500
const m5 = {ledger: "AC", cls: "office", block: "pm15", typedOpen: true, openGross: 50000, openAcc: 47500, putToUse: "2019-04-01"};
ok(one(m5, "SLM").dep === 0 && one(m5, "WDV").dep === 0 && eq(one(m5, "SLM").nClose, 2500), "1e. fully depreciated: nothing more, stays at the residual 2,500");
// 1f. a printer with half a year left: cost 30,000, 27,000 depreciated, residual 1,500: the 1,500 left above the residual goes in the year
const m6 = {ledger: "Printer", cls: "computer_eud", block: "pm40", typedOpen: true, openGross: 30000, openAcc: 27000, remLife: 0.5};
ok(eq(one(m6, "SLM").dep, 1500) && eq(one(m6, "WDV").dep, 1500) && eq(one(m6, "SLM").nClose, 1500), "1f. life ends within the year: down to the residual (1,500 in both methods)");
// 1g. the remaining life from the date put to use: 15-10-2023 to 01-04-2025 is 17 months and 17 days (17/12 + 17/365 years)
ok(Math.abs(FAR.yearsBetween("2023-10-15", "2025-04-01") - (17 / 12 + 17 / 365)) < 1e-12 && FAR.yearsBetween("2023-04-01", "2025-04-01") === 2, "1g. years between dates: whole months, then days");
// 1h. a hand override with its reason: shown, used, and the reason is asked for when missing
const ov = FAR.compute(reg([asset(Object.assign({}, m4, {override: {dep: 20000, reason: "technical valuation of 2025"}}))], {method: "SLM"}));
ok(eq(ov.assets[0].dep, 20000) && eq(ov.assets[0].computed, 25000) && ov.assets[0].override.reason === "technical valuation of 2025", "1h. override 20,000 with its reason (computed 25,000 kept beside it)");
const ov2 = FAR.compute(reg([asset(Object.assign({}, m4, {override: {dep: 20000, reason: ""}}))], {method: "SLM"}));
ok(ov2.confirm.some(c => c.key === "need:why:L:Sofa"), "1h. an override without a reason is in the Confirm list");

console.log("== 2. Income-tax blocks (section 32)");
const add = (key, date, amount, putToUse) => ({key, date, amount, kind: "add", putToUse: putToUse || date});
const sale = (key, date, value) => ({key, date, amount: value, kind: "sale", sale: value});
// 2a. plant and machinery 15%: opening WDV 5,00,000 (typed); machine A 2,00,000 put to use 10-06-2025 (295 days: 180 or more),
//     machine B 1,00,000 put to use 15-01-2026 (76 days: under 180); an old lathe sold for 50,000.
//   (5,00,000 + 2,00,000 - 50,000) x 15% + 1,00,000 x 7.5% = 97,500 + 7,500 = 1,05,000; closing 8,00,000 - 50,000 - 1,05,000 = 6,45,000
const pm = (more) => [asset({ledger: "Old Lathe", cls: "pm_general", block: "pm15", openGross: 300000, moves: [sale("s1", "2025-08-01", 50000)]}),
  asset({ledger: "Machine A", cls: "pm_general", block: "pm15", adds: [add("a1", "2025-06-10", 200000)]}),
  asset({ledger: "Machine B", cls: "pm_general", block: "pm15", adds: [add("b1", "2026-01-10", 100000, "2026-01-15")]})].concat(more || []);
const b2a = FAR.compute(reg(pm(), {}, {pm15: {open: 500000}})).blocks.find(b => b.k === "pm15");
ok(eq(b2a.addGt180, 200000) && eq(b2a.addLt180, 100000) && eq(b2a.sale, 50000) && eq(b2a.dep, 105000) && eq(b2a.close, 645000) && b2a.stcg === 0, "2a. 15% block: 1,05,000 (half rate on the 76-day machine), closing 6,45,000 (" + [b2a.dep, b2a.close] + ")");
// 2b. the 180th day: put to use 03-10-2025 is 180 days to 31-03-2026 (Oct 29 + Nov 30 + Dec 31 + Jan 31 + Feb 28 + Mar 31): full;
//     04-10-2025 is 179 days: half. 1,00,000 each: 15,000 + 7,500 = 22,500
const b2b = FAR.compute(reg([asset({ledger: "M1", cls: "pm_general", block: "pm15", adds: [add("x", "2025-10-03", 100000)]}), asset({ledger: "M2", cls: "pm_general", block: "pm15", adds: [add("y", "2025-10-04", 100000)]})], {}, {pm15: {open: 0}})).blocks[0];
ok(eq(b2b.addGt180, 100000) && eq(b2b.addLt180, 100000) && eq(b2b.dep, 22500), "2b. 180 days (03-10-2025) full rate, 179 days (04-10-2025) half: 22,500 (" + b2b.dep + ")");
// 2c. a sale larger than the opening and full-rate additions: opening 10,000, 50,000 put to use 15-01-2026, an old item sold for 30,000
//   10,000 - 30,000 = (20,000): nothing at the full rate; (50,000 - 20,000) x 7.5% = 2,250; closing 30,000 - 2,250 = 27,750
const b2c = FAR.compute(reg([asset({ledger: "Old item", cls: "pm_general", block: "pm15", openGross: 10000, moves: [sale("s", "2025-06-01", 30000)]}), asset({ledger: "New", cls: "pm_general", block: "pm15", adds: [add("n", "2026-01-15", 50000)]})], {}, {pm15: {open: 10000}})).blocks[0];
ok(eq(b2c.dep, 2250) && eq(b2c.close, 27750), "2c. the sale first takes the full-rate part: 2,250, closing 27,750 (" + [b2c.dep, b2c.close] + ")");
// 2d. computers 40%: opening 80,000, sold for 1,20,000: 80,000 - 1,20,000 = (40,000): a short-term capital gain of 40,000, no depreciation, closing nil
const b2d = FAR.compute(reg([asset({ledger: "Old PCs", cls: "computer_eud", block: "pm40", openGross: 150000, moves: [sale("s", "2025-09-01", 120000)]})], {}, {pm40: {open: 80000}})).blocks[0];
ok(eq(b2d.stcg, -40000) && b2d.dep === 0 && b2d.close === 0, "2d. sale above the block: STCG 40,000 (shown (40,000)), no depreciation, closing nil");
// 2e. furniture 10%: opening 30,000, its only asset sold for 10,000: the block is empty with 20,000 left: a short-term capital loss of 20,000
const b2e = FAR.compute(reg([asset({ledger: "Sofa set", cls: "furniture", block: "ff10", openGross: 50000, moves: [sale("s", "2025-12-01", 10000)]})], {}, {ff10: {open: 30000}})).blocks[0];
ok(b2e.empty && eq(b2e.stcg, 20000) && b2e.dep === 0 && b2e.close === 0, "2e. block emptied: STCL 20,000, no depreciation, closing nil");
// 2f. additional depreciation 20% (switched on): A (2,00,000, 180 days or more) 40,000 + B (1,00,000, under 180) 10,000 = 50,000;
//     an AC of 40,000 (office equipment, 01-05-2025) adds to the block but is not eligible.
//   depreciation (5,00,000 + 2,40,000 - 50,000) x 15% + 1,00,000 x 7.5% = 1,03,500 + 7,500 = 1,11,000
//   closing 8,40,000 - 50,000 - 1,11,000 - 50,000 = 6,29,000; the other half of B's, 10,000, is carried to 2026-27
const r25 = reg(pm([asset({ledger: "AC unit", cls: "office", block: "pm15", adds: [add("ac", "2025-05-01", 40000)]})]), {addl: true, addlRate: 20}, {pm15: {open: 500000}});
const b2f = FAR.compute(r25).blocks[0];
ok(eq(b2f.dep, 111000) && eq(b2f.addl, 50000) && eq(b2f.addlGt180, 200000) && eq(b2f.addlLt180, 100000) && eq(b2f.addlCarry, 10000) && eq(b2f.close, 629000),
  "2f. additional depreciation 50,000 (AC not eligible), depreciation 1,11,000, closing 6,29,000, 10,000 carried (" + [b2f.dep, b2f.addl, b2f.close, b2f.addlCarry] + ")");
// 2g. 2026-27, nothing bought or sold: opening = last year's closing in FinCom (6,29,000, not the 1,00,000 typed),
//     6,29,000 x 15% = 94,350; additional 10,000 brought forward; closing 6,29,000 - 94,350 - 10,000 = 5,24,650
const r26 = Object.assign(JSON.parse(JSON.stringify(r25)), {fy: "2026", blocks: {pm15: {open: 100000}}});
const b2g = FAR.compute(r26, r25).blocks[0];
ok(eq(b2g.open, 629000) && b2g.openFrom === "last year's closing in FinCom" && eq(b2g.dep, 94350) && eq(b2g.addlBf, 10000) && eq(b2g.addl, 10000) && eq(b2g.close, 524650),
  "2g. next year: opening 6,29,000 from last year's closing, 94,350 + 10,000 brought forward, closing 5,24,650 (" + [b2g.open, b2g.dep, b2g.addl, b2g.close] + ")");
// 2h. rupee rounding: 40% of 12,345.67 = 4,938.268 -> 4,938; closing 7,407.67
const b2h = FAR.compute(reg([asset({ledger: "PC", cls: "computer_eud", block: "pm40", openGross: 20000})], {}, {pm40: {open: 12345.67}})).blocks[0];
ok(eq(b2h.dep, 4938) && eq(b2h.close, 7407.67), "2h. depreciation rounded to the rupee: 4,938, closing 7,407.67");
// 2i. no opening WDV typed and no last year in FinCom: asked for in the Confirm list
ok(FAR.compute(reg([asset({ledger: "PC", cls: "computer_eud", block: "pm40", openGross: 20000})])).confirm.some(c => c.key === "open:pm40"), "2i. a block's opening WDV, when unknown, is in the Confirm list");

console.log("== 3. a whole register (worked by hand)");
// Straight line, residual 5%, FY 2025-26.
//  Edge Binding Machine: cost 3,00,000, depreciated 60,000, put to use 01-04-2021 (4 of 15 years gone: 11 left): (2,40,000 - 15,000) / 11
//    = 20,454.55; added 1,50,000 put to use 20-11-2025 (132 days: Nov 11 + Dec 31 + Jan 31 + Feb 28 + Mar 31): (1,50,000 - 7,500) / 15 x 132/365
//    = 3,435.62; the year 23,890.17
//  HP Laptop: cost 52,000, depreciated 20,000, put to use 01-04-2024 (2 of 3 years left), sold 10-02-2026 for 18,000 (316 days):
//    (32,000 - 2,600) / 2 x 316/365 = 12,726.58; carrying at sale 19,273.42; loss (1,273.42)
//  AC - Hitachi: cost 45,000, at its residual 2,250 (42,750 depreciated), life over (2019): nil
const R3 = FAR.compute(F.handRegister());
const cls = k => R3.classes.find(c => c.k === k);
ok(eq(cls("pm_general").gOpen, 300000) && eq(cls("pm_general").gAdd, 150000) && eq(cls("pm_general").dOpen, 60000) && eq(cls("pm_general").dYear, 23890.17) && eq(cls("pm_general").nClose, 366109.83),
  "3. plant and machinery: 3,00,000 + 1,50,000; depreciation 60,000 + 23,890.17; net 3,66,109.83 (" + cls("pm_general").dYear + ")");
ok(eq(cls("computer_eud").gDel, 52000) && eq(cls("computer_eud").dYear, 12726.58) && eq(cls("computer_eud").dDel, 32726.58) && eq(cls("computer_eud").nClose, 0), "3. computers: 12,726.58 to the sale; 52,000 and 32,726.58 taken off");
ok(eq(cls("office").dYear, 0) && eq(cls("office").nClose, 2250), "3. office equipment: nil, stays at 2,250");
const hp = R3.assets.find(a => a.ledger === "HP Laptop");
ok(eq(hp.sales[0].carrying, 19273.42) && eq(hp.sales[0].gain, -1273.42), "3. the laptop's loss on sale (1,273.42)");
ok(eq(R3.totals.dep, 36616.75) && R3.far.length === 3 && R3.far.every(f => f.fromRegister) && eq(R3.far.find(f => f.cls === FAR.cls("pm_general").name).dYear, 23890.17), "3. det.far: three classes, 36,616.75 for the year");
//  blocks: P&M 15% (machine and AC): 2,10,000 + 1,50,000 put to use 20-11-2025 (132 days, half): 31,500 + 11,250 = 42,750; closing 3,17,250
//          computers 40%: 25,000, its only asset sold for 18,000: block emptied, STCL 7,000, closing nil
const p15 = R3.blocks.find(b => b.k === "pm15"), p40 = R3.blocks.find(b => b.k === "pm40");
ok(eq(p15.dep, 42750) && eq(p15.close, 317250) && eq(p15.addLt180, 150000), "3. block 15%: 42,750, closing 3,17,250");
ok(p40.empty && eq(p40.stcg, 7000) && p40.close === 0 && p40.dep === 0, "3. block 40%: emptied, STCL 7,000");
ok(R3.itRows.length === 2 && R3.rows3cd.find(r => r[0] === FAR.block("pm15").name).join("|") === [FAR.block("pm15").name, 15, 210000, 150000, 0, 42750, 317250].join("|"), "3. det.itBlocks and the 3CD clause 18 rows");
//  deferred tax at 25.168%: books 3,66,109.83 + 2,250 = 3,68,359.83 against tax 3,17,250: 51,109.83 x 25.168% = 12,863.32 (liability);
//  at the start 2,74,250 against 2,35,000: 39,250 x 25.168% = 9,878.44; the year's charge 2,984.88
ok(eq(R3.dt.bookClose, 368359.83) && eq(R3.dt.taxClose, 317250) && eq(R3.dt.close, 12863.32) && eq(R3.dt.open, 9878.44) && eq(R3.dt.move, 2984.88), "3. deferred tax: 12,863.32 at the end, 9,878.44 at the start, charge 2,984.88 (" + [R3.dt.close, R3.dt.open, R3.dt.move] + ")");
//  the journal: Dr Depreciation 36,616.75; Cr Provision for Dep on P&M @15% 23,890.17; Cr Accumulated Depreciation- Computers 12,726.58
const je = R3.je, line = l => je.lines.find(z => z.ledger === l) || {};
ok(eq(line("Depreciation").dr, 36616.75) && eq(line("Provision for Dep on P&M @15%").cr, 23890.17) && eq(line("Accumulated Depreciation- Computers").cr, 12726.58) && je.posted === false,
  "3. suggested journal: Dr Depreciation 36,616.75, Cr the two accumulated-depreciation ledgers; not posted");

console.log("== 4. proposed from the books");
const PA = FAR.propose(F.books.A), RA = FAR.compute(PA);
const A = l => PA.assets.find(a => a.ledger === l);
ok(PA.assets.map(a => a.ledger).sort().join("|") === "AC - Hitachi|Edge Binding Machine|HP Laptop", "4A. three assets; the two accumulated-depreciation ledgers are not assets");
ok(A("AC - Hitachi").cls === "office" && A("AC - Hitachi").block === "pm15" && A("AC - Hitachi").blockSure && A("Edge Binding Machine").cls === "pm_general" && A("HP Laptop").cls === "computer_eud" && A("HP Laptop").block === "pm40",
  "4A. classes from the names (AC: office equipment, machine: plant and machinery, laptop: computer) and blocks from the groups' rates (15%, 40%)");
const acc = l => PA.accDep.find(z => z.ledger === l);
ok(acc("Provision for Dep on P&M @15%").match.kind === "group" && acc("Provision for Dep on P&M @15%").match.group === "Plant & Machionary @ 15%" && acc("Accumulated Depreciation- Computers").match.group === "Computer & Laptops 40%",
  "4A. per-block accumulated depreciation matched to its group by name and rate");
//  1,10,000 over the block's two assets by cost: AC 45,000 / 3,45,000 = 14,347.83; the machine takes the rest, 95,652.17
const RAa = l => RA.assets.find(a => a.ledger === l);
ok(eq(RAa("AC - Hitachi").dOpen, 14347.83) && eq(RAa("Edge Binding Machine").dOpen, 95652.17) && eq(RAa("HP Laptop").dOpen, 20000), "4A. spread over the block by cost: 14,347.83 and 95,652.17 (" + [RAa("AC - Hitachi").dOpen, RAa("Edge Binding Machine").dOpen] + ")");
ok(A("Edge Binding Machine").adds.length === 1 && A("Edge Binding Machine").adds[0].amount === 150000 && A("Edge Binding Machine").adds[0].putToUse === "2025-11-20" && A("HP Laptop").moves[0].kind === "sale" && A("HP Laptop").moves[0].sale === 18000,
  "4A. the purchase is an addition (put to use on its date, editable); the receipt is a sale of 18,000; last year's journal is not in the year");
ok(RA.confirm.some(c => c.key === "acc:Provision for Dep on P&M @15%") && RA.confirm.some(c => c.key === "move:A2|1") && RA.confirm.some(c => c.key === "settings"), "4A. the matches and the sale are in the Confirm list, never applied silently");
const PB = FAR.propose(F.books.B), RB = FAR.compute(PB), B = l => PB.assets.find(a => a.ledger === l);
ok(PB.assets.length === 2 && PB.accDep[0].match.kind === "asset" && PB.accDep[0].match.id === "L:CAR" && B("CAR").cls === "mv_car" && B("CAR").block === "pm15" && B("Office Furniture").block === "ff10", "4B. per-asset accumulated depreciation (for Car) matched to the CAR; furniture 10%");
ok(eq(PB.accDep[0].booked, 75000) && RB.confirm.some(c => c.key === "noacc:L:Office Furniture") && eq(RB.assets.find(a => a.ledger === "CAR").dOpen, 300000), "4B. the year's journal to the accumulated depreciation is depreciation booked (75,000); furniture with none is asked about");
ok(eq(RB.je.lines.find(l => l.ledger === "Accumulated Dep for Car").cr, r2(RB.assets.find(a => a.ledger === "CAR").dep - 75000)), "4B. the suggested journal is the year's charge less the 75,000 already booked");
const PC = FAR.propose(F.books.C), RC = FAR.compute(PC), C = l => PC.assets.find(a => a.ledger === l);
ok(C("Trademark").cls === "intang_other" && C("Trademark").block === "int25" && C("Trademark").blockSure && C("Tally ERP Licence").cls === "intang_software" && C("Tally ERP Licence").block === "pm40", "4C. Intangible Assets @25%: 25% block; software in the 40% block");
ok(RC.confirm.some(c => c.key === "need:life:L:Trademark") && RC.assets.every(a => a.dep === 0 && a.line === "intang"), "4C. an intangible's useful life is asked for (not in Schedule II); nothing worked out until given");
const PD = FAR.propose(F.books.D), RD = FAR.compute(PD), Dd = l => PD.assets.find(a => a.ledger === l);
ok(Dd("Office Building").cls === "bldg_rcc" && !Dd("Office Building").clsSure && Dd("Land at Noida").cls === "land" && Dd("Land at Noida").block === "none", "4D. a building (RCC, to confirm) and land (not depreciated)");
ok(Dd("Office Building").moves[0].kind === "dep" && eq(Dd("Office Building").bookedDep, 125000) && !RD.assets.find(a => a.ledger === "Office Building").sales.length, "4D. depreciation credited to the building is booked depreciation, not a sale");
ok(RD.assets.find(a => a.ledger === "Land at Noida").dep === 0 && !RD.blocks.some(b => b.k === "none"), "4D. land: no depreciation, no income-tax block");
// one journal crediting two assets with the year's depreciation: depreciation booked on each, never a transfer between them
const P2 = FAR.propose({fy: "2025", ledgers: [{l: "Generator", path: ["Fixed Assets"], open: 90000}, {l: "Office AC", path: ["Fixed Assets"], open: 30000}],
  vouchers: [{id: "J9", date: "2026-03-31", no: "9", type: "Journal", ent: [{l: "Depreciation", a: 18000}, {l: "Generator", a: -13500}, {l: "Office AC", a: -4500}]}]});
ok(P2.assets.every(a => a.moves.length === 1 && a.moves[0].kind === "dep") && P2.assets[0].bookedDep + P2.assets[1].bookedDep === 18000, "4. one depreciation journal on two assets: booked depreciation on each, not a transfer");
ok(["Accumulated Dep for Car", "Provision for Dep on P&M @15%", "Accumulated Depreciation- Computers", "Depreciation Fund", "Acc. Depn. - Plant"].every(FAR.isAccDep) && !["Deposit with MSEB", "HP Laptop", "CAR"].some(FAR.isAccDep), "4. accumulated-depreciation names recognised; deposits are not");
// merging: what was changed by hand survives the books being read again
PA.assets.find(a => a.ledger === "AC - Hitachi").life = 7; PA.assets.find(a => a.ledger === "HP Laptop").moves[0].kind = "scrap";
const MA = FAR.merge(PA, FAR.propose(F.books.A));
ok(MA.assets.find(a => a.ledger === "AC - Hitachi").life === 7 && MA.assets.find(a => a.ledger === "HP Laptop").moves[0].kind === "scrap", "4. read again: the life and the scrapped flag typed by hand are kept");

console.log("== 5. the statements, 3CD clause 18 and the Excel use the computed figures");
const FSX = RF.loadFSX();
const co = RF.company(), st = RF.confirmed(FSX, co);
const det = FAR.feedDet(co.det, R3);
const M = FSX.run(Object.assign({}, co, {mapStore: st, det})).model, ppe = M.notes.find(n => n.key === "ppe"), t = ppe.tables.find(z => z.far === "cy");
const rowOf = name => t.rows.find(r => r.t === name);
const pmRow = rowOf(FAR.cls("pm_general").name), cpRow = rowOf(FAR.cls("computer_eud").name);
ok(pmRow && [0, 1, 2, 3, 4, 5, 6, 7].map(j => pmRow.c[j].v).join() === [30000000, 15000000, 0, 45000000, 6000000, 2389017, 0, 8389017].join(), "5. the PPE note: plant and machinery as the register (gross 4,50,000; depreciation 23,890.17)");
ok(cpRow && cpRow.c[2].v === 5200000 && cpRow.c[6].v === 3272658 && cpRow.c[8].v === 0, "5. the PPE note: the laptop sold (52,000 and 32,726.58 taken off, net nil)");
// a firm: the income-tax block note from the register, with STCL, additional depreciation and the 3CD clause 18
const firm = RF.firm(), stf = RF.confirmed(FSX, firm), RFm = FAR.compute(Object.assign(JSON.parse(JSON.stringify(r25)), {kind: "firm", assets: r25.assets.concat([asset({ledger: "Sofa set", cls: "furniture", block: "ff10", openGross: 50000, moves: [sale("s", "2025-12-01", 10000)]})]), blocks: {pm15: {open: 500000}, ff10: {open: 30000}}}));
const Mf = FSX.run(Object.assign({}, firm, {mapStore: stf, det: FAR.feedDet(firm.det, RFm)})).model, nf = Mf.notes.find(n => n.key === "ppe");
const blk = name => nf.cyBlocks.find(b => b.b === name).cells.map(c => c.v);
const c15 = blk(FAR.block("pm15").name), c10 = blk(FAR.block("ff10").name);
ok(c15[6] === 11100000 && c15[8] === 5000000 && c15[9] === 62900000, "5. the block note, 15%: depreciation 1,11,000, additional 50,000, closing 6,29,000 (" + [c15[6], c15[8], c15[9]].map(v => v / 100) + ")");
ok(c10[4] === 2000000 && c10[6] === 0 && c10[9] === 0, "5. the block note, 10%: STCL 20,000, no depreciation, closing nil");
const ck11 = FSX.run(Object.assign({}, firm, {mapStore: stf, det: FAR.feedDet(firm.det, RFm)})).checks.find(c => c.id === 11);
ok(!ck11.items.some(i => /is not the rate on the block|is not the closing WDV/.test(i)), "5. check 11 agrees with the register's block working (" + ck11.items.filter(i => /block|WDV/.test(i)).join("; ").slice(0, 200) + ")");
const d3 = FSX.form3cd({entity: {name: "X", kind: "firm"}, fy: "2025", fromBooks: [], itBlocks: RFm.rows3cd});
const c18 = d3.clauses.find(c => c.no === "18");
ok(c18.src === "books" && c18.rows.find(r => r[0] === FAR.block("pm15").name).join("|") === [FAR.block("pm15").name, 15, 500000, 340000, 50000, 161000, 629000].join("|"), "5. 3CD clause 18: the block's opening, additions, sale, depreciation (with additional) and closing");
// the Excel: every formula recalculated apart from FinCom equals FAR's figures
const xbytes = FSX.xlsx(FAR.sheets(R3, {name: "Kestrel"}), {}), xfile = path.join(OUT, "depreciation.xlsx");
fs.writeFileSync(xfile, Buffer.from(xbytes));
let rc = ""; try { rc = require("child_process").execFileSync("python3", ["-W", "ignore", path.join(__dirname, "reports_recalc.py"), xfile], {encoding: "utf8", timeout: 300000}); } catch (e){ rc = String(e.stdout || e.message); }
const rcs = [...rc.matchAll(/(LibreOffice|Python evaluator) (\d+) formulas, (\d+) differ/g)];
ok(rcs.length >= 1 && rcs.every(m => Number(m[2]) > 40 && m[3] === "0"), "5. the Excel recalculated independently: " + (rcs.map(m => m[1] + " " + m[2] + " formulas, " + m[3] + " differ").join("; ") || rc.slice(-300)));
// the statements' own Excel (FSX.excel) with the register's blocks this year and last (additional depreciation brought
// forward, STCL): every formula recalculated apart from FinCom
const R26 = FAR.compute(Object.assign(JSON.parse(JSON.stringify(r26)), {kind: "firm"}), Object.assign(JSON.parse(JSON.stringify(r25)), {kind: "firm", assets: r25.assets.concat([asset({ledger: "Sofa set", cls: "furniture", block: "ff10", openGross: 50000, moves: [sale("s", "2025-12-01", 10000)]})]), blocks: {pm15: {open: 500000}, ff10: {open: 30000}}}));
const Mf2 = FSX.run(Object.assign({}, firm, {mapStore: stf, det: FAR.feedDet(firm.det, R26)}), {files: ["xlsx"]}), sfile = path.join(OUT, "depreciation-statements.xlsx");
fs.writeFileSync(sfile, Buffer.from(Mf2.files.xlsx));
let rc2 = ""; try { rc2 = require("child_process").execFileSync("python3", ["-W", "ignore", path.join(__dirname, "reports_recalc.py"), sfile], {encoding: "utf8", timeout: 300000}); } catch (e){ rc2 = String(e.stdout || e.message); }
const rcs2 = [...rc2.matchAll(/(LibreOffice|Python evaluator) (\d+) formulas, (\d+) differ/g)];
const pyB = Mf2.model.notes.find(n => n.key === "ppe").pyBlocks.find(b => b.b === FAR.block("pm15").name);
ok(pyB && pyB.cells[9].v === 62900000 && rcs2.length >= 1 && rcs2.every(m => Number(m[2]) > 200 && m[3] === "0"), "5. the statements' Excel with the register's blocks (last year's from FinCom: closing 6,29,000) recalculated independently: " + (rcs2.map(m => m[1] + " " + m[2] + " formulas, " + m[3] + " differ").join("; ") || rc2.slice(-400)));
const html = FAR.html(R3, {name: "Kestrel"});
ok(/KESTREL/.test(html) && /36,616\.75/.test(html) && /3,17,250\.00/.test(html) && /nothing is posted to Tally/.test(html), "5. the print view: the schedules, the totals, the journal marked not posted");
function r2(v){ return Math.round(v * 100) / 100; }
console.log("\n" + (fails ? fails + " FAILED" : "all passed"));
process.exit(fails ? 1 : 0);
