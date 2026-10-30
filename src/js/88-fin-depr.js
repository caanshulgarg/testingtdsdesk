/* @react-lazy: begin 88-fin-depr.js (the React app loads this file with the Financial statements page: app/src/lib/finGlobals.js; build.py react_parts) */
/* ================================================================== */
/* Depreciation under the Companies Act and the Income-tax Act, last  */
/* year's ITR uploaded, and deferred tax (owner, 29-Oct-2026:         */
/* "depreciation as per companies act and income tax act should be   */
/* there so that deferred tax can easily be calculated")              */
/* ================================================================== */
// FinDepr works beside FinSt (src/js/88-fin-statements.js; docs/fin-statements-api.md, "Depreciation and deferred tax"):
//   Companies Act (Schedule II): a register by the statements' PPE classes (FinSt.PPE / INT), item by item where the
//     books say so: the opening gross block and accumulated depreciation of each class from last year's audited balance
//     sheet (FinPyBs, uploaded), else last year's register / FinCom's opening balances, else typed; additions and sales from
//     the day book's entries in the class's ledgers (purchase, sale and journal vouchers); SLM or WDV per class with the
//     Schedule II useful life and 5% residual value (editable); pro-rata by days, so any period of the year works (the
//     depreciation of From -> To is the depreciation to To less that to the day before From); profit or loss on sale.
//   Income-tax Act (section 32): block by block, rates of Appendix I to the Income-tax Rules; additions put to use for
//     less than 180 days at half the rate; the sale value off the block; a block that ceases has no depreciation and its
//     short-term capital gain or loss is shown (section 50). The opening WDV of each block comes from last year's ITR
//     (ITR-3, 5, 6 or 7 JSON from the e-filing portal, else the PDF's text), else typed, else last year's in FinCom.
//   Deferred tax (AS 22): book WDV less tax WDV, and the provisions allowed only when paid (40A(7), 43B), at the client's
//     rate (its regime); last year's from the uploaded balance sheet; the movement is the P&L's deferred tax.
// Kept in b.fs.depr (synced with the books): cls {cls: {method, life, res, block}}, open {fy: {cls: {gross, acc}}} (typed),
// sale {fy: {key: {cost}}}, put {fy: {key: ymd}}, itr {fy: {versions: [...]}} (add-only), itOpen {fy: {block: wdv}} (typed),
// ceased {fy: {block: true/false}}, use {fy: {ca, dt}} (the statements take the register / the deferred tax), dtRate.
// Nothing is written to Tally. In the statements the register's figures come in as FinCom rows of the trial balance
// (rowsFor: the difference from what the books hold), only once "use" is ticked for the year.
const FinDepr = (() => {
  const N = v => +v || 0;
  const RND = (v, d) => { v = +v || 0; const p = Math.pow(10, d), x = Number((Math.abs(v) * p).toPrecision(15)), r = Math.round(x) / p * Math.sign(v); return r === 0 ? 0 : r; };
  const R2 = v => RND(v, 2), R0 = v => RND(v, 0);
  // dates: YYYYMMDD (as FinSt); a day number for counting
  const dn = ymd => Date.UTC(N(String(ymd).slice(0, 4)), N(String(ymd).slice(4, 6)) - 1, N(String(ymd).slice(6, 8))) / 864e5;
  const ymdOf = n => new Date(n * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DMY = ymd => ymd ? String(ymd).slice(6, 8) + "-" + MON[N(String(ymd).slice(4, 6)) - 1] + "-" + String(ymd).slice(0, 4) : "";
  const fyOf = fy => ({y0: String(fy) + "0401", y1: String(N(fy) + 1) + "0331", diy: dn(String(N(fy) + 1) + "0331") - dn(String(fy) + "0401") + 1});

  // ---------- the rules' tables ----------
  // the statements' classes (FinSt.PPE / INT) with Schedule II's useful life (Part C), the method and the income-tax block
  // they usually fall in. Residual value 5% of cost (Part A, para 3(i)); intangibles (AS 26) straight line, nil residual
  const CLS = {
    comp: {method: "WDV", life: 3, res: 5, block: "c40", why: "Schedule II, Part C, XI(i): computers, end user devices (desktops, laptops): 3 years"},
    oe: {method: "WDV", life: 5, res: 5, block: "pm15", why: "Schedule II, Part C, X: office equipment: 5 years"},
    furn: {method: "WDV", life: 10, res: 5, block: "f10", why: "Schedule II, Part C, V: furniture and fittings (general): 10 years"},
    pm: {method: "WDV", life: 15, res: 5, block: "pm15", why: "Schedule II, Part C, IV(i): plant and machinery (general): 15 years"},
    veh: {method: "WDV", life: 8, res: 5, block: "pm15", why: "Schedule II, Part C, VI(ii): motor cars not used on hire: 8 years (motor cycles 10, on hire 6)"},
    bld: {method: "WDV", life: 60, res: 5, block: "b10", why: "Schedule II, Part C, I(a): buildings other than factory, RCC frame: 60 years (factory 30)"},
    land: {method: "NONE", life: 0, res: 0, block: "", why: "freehold land is not depreciated"},
    lhi: {method: "SLM", life: 10, res: 0, block: "b10", why: "leasehold improvements: over the lease (10 years assumed; give the lease term)"},
    sw: {method: "SLM", life: 5, res: 0, block: "c40", why: "AS 26: computer software, its useful life estimated by management (5 years assumed), nil residual; for tax, software is in the computers block (40%)"}
  };
  // section 32 blocks, Appendix I to the Income-tax Rules, 1962, as amended from assessment year 2018-19 (rates unchanged
  // since; the Income-tax Act, 2025 keeps them from tax year 2026-27): [key, name, rate]
  const BLOCKS = [["b5", "Buildings, mainly residential (5%)", 0.05], ["b10", "Buildings, other than residential (10%)", 0.1], ["b40", "Buildings, purely temporary erections (40%)", 0.4],
    ["f10", "Furniture and fittings, including electrical fittings (10%)", 0.1], ["pm15", "Plant and machinery, general, including motor cars (15%)", 0.15],
    ["pm30", "Motor buses, lorries and taxis used in a business of running them on hire (30%)", 0.3], ["c40", "Computers including computer software, and other plant and machinery at 40%", 0.4],
    ["i25", "Intangible assets: know-how, patents, copyrights, trademarks, licences, franchises (25%)", 0.25], ["s20", "Ships (20%)", 0.2]];
  const BK = Object.fromEntries(BLOCKS.map(([k, name, rate]) => [k, {k, name, rate}]));
  const SOURCES = {sch2: "Schedule II to the Companies Act, 2013 (Part A para 3(i): residual value not more than 5% of cost; Part C: useful lives)",
    it: "Income-tax Act, 1961: section 32(1)(ii) and its second proviso (half the rate on an asset put to use for less than 180 days), section 43(6) (written down value), section 50 (a block's short-term capital gain or loss); rates: Appendix I to the Income-tax Rules, 1962, as amended from AY 2018-19",
    dt: "AS 22 (Accounting for Taxes on Income): deferred tax on timing differences at the rates enacted; deferred tax assets on unabsorbed items only with virtual certainty"};

  // ---------- Companies Act: the items of a class, worked out for a period ----------
  // item: {id, cls, name, put (YYYYMMDD; null: held from before the year), sale (YYYYMMDD or null), value, cost, acc (at the
  // start of the year)}; cfg {method, life, res}; o {y0, from, to, diy}. Each item's depreciation to a day T:
  //   annual = SLM: cost x (1 - res) / life;  WDV: (cost - acc) x (1 - res ^ (1 / life))
  //   days(T) = from the later of the year's start and the put-to-use date, to T or the day before the sale, both counted
  //   depTo(T) = ROUND(MIN(cost - residual - acc, annual x days(T) / days in the year), 2)   (never below the residual)
  // the period's charge is depTo(To) - depTo(From - 1), so the parts of a year add up to the year.
  function itemCalc(it, cfg, o){
    const res = N(cfg.res) / 100, life = N(cfg.life), none = cfg.method === "NONE" || !(life > 0);
    const rate = cfg.method === "WDV" && life > 0 ? 1 - Math.pow(res, 1 / life) : 0;
    const annual = none ? 0 : cfg.method === "SLM" ? it.cost * (1 - res) / life : (it.cost - it.acc) * rate;
    const room = Math.max(0, it.cost - it.cost * res - it.acc);
    const y0 = dn(o.y0), start = it.put ? Math.max(y0, dn(it.put)) : y0, sale = it.sale ? dn(it.sale) : null;
    const days = T => Math.max(0, Math.min(T, sale != null ? sale - 1 : T) - start + 1);
    const depTo = T => R2(Math.min(room, annual * days(T) / o.diy));
    const S = dn(o.from), E = dn(o.to);
    const held = (!it.put || dn(it.put) < S) && (sale == null || sale >= S), inAdd = !!it.put && dn(it.put) >= S && dn(it.put) <= E, inDel = sale != null && sale >= S && sale <= E;
    const a = depTo(S - 1), b = depTo(E);
    const gO = held ? it.cost : 0, gA = inAdd ? it.cost : 0, gD = inDel ? it.cost : 0;
    const dO = held ? R2(it.acc + a) : 0, dep = R2(b - a), dD = inDel ? R2(it.acc + b) : 0;
    return Object.assign({}, it, {rate, annual, room, daysA: days(S - 1), daysB: days(E), depA: a, depB: b, gO, gA, gD, gC: R2(gO + gA - gD), dO, dep, dD, dC: R2(dO + dep - dD),
      nO: R2(gO - dO), gain: inDel ? R2(N(it.value) - (it.cost - it.acc - b)) : 0, held, inAdd, inDel});
  }
  const COLS = ["gO", "gA", "gD", "gC", "dO", "dep", "dD", "dC", "nO", "nC", "gain"];
  function caItems(items, cfgOf, o){
    const out = items.map(it => itemCalc(it, cfgOf(it.cls), o)), classes = {};
    out.forEach(x => { x.nC = R2(x.gC - x.dC); const c = classes[x.cls] = classes[x.cls] || Object.fromEntries(COLS.map(k => [k, 0])); COLS.forEach(k => { c[k] = R2(c[k] + N(x[k])); }); });
    const total = Object.fromEntries(COLS.map(k => [k, R2(Object.values(classes).reduce((s, c) => s + c[k], 0))]));
    return {items: out, classes, total};
  }

  // ---------- Income-tax Act: the blocks for the previous year ----------
  // blocks {k: {open, src}}, adds [{block, put, amt}], sales [{block, date, value}], ceased {k: true|false}; o {fy, to?}.
  // Section 32: depreciation = ROUND(MAX(0, open + added 180+ - sale) x rate + MAX(0, added <180 + MIN(0, open + added 180+ -
  // sale)) x rate / 2, 0); a block gone negative: no depreciation, the excess a short-term capital gain (section 50(1));
  // a block that ceases (every asset in it transferred) with value left: no depreciation, a short-term capital loss (50(2)).
  // to (a part of the year): what is added and sold to that day, and the depreciation for the days so far (an estimate:
  // section 32 works for a whole previous year).
  function itBlocks(inp){
    const F = fyOf(inp.fy), to = inp.to && inp.to < F.y1 ? inp.to : F.y1, part = to !== F.y1, frac = part ? (dn(to) - dn(F.y0) + 1) / F.diy : 1;
    // the blocks with a figure: an opening WDV, an addition or a sale
    const keys = BLOCKS.map(b => b[0]).filter(k => N(((inp.blocks || {})[k] || {}).open) || (inp.adds || []).some(a => a.block === k) || (inp.sales || []).some(s => s.block === k));
    return keys.map(k => {
      const b = BK[k], o = (inp.blocks || {})[k] || {}, open = R2(N(o.open));
      let addA = 0, addB = 0, sale = 0;
      const adds = (inp.adds || []).filter(a => a.block === k && a.put >= F.y0 && a.put <= to).map(a => { const days = dn(F.y1) - dn(a.put) + 1, half = days < 180; if (half) addB += N(a.amt); else addA += N(a.amt); return Object.assign({}, a, {days, half}); });
      (inp.sales || []).filter(s => s.block === k && s.date >= F.y0 && s.date <= to).forEach(s => { sale += N(s.value); });
      addA = R2(addA); addB = R2(addB); sale = R2(sale);
      const total = R2(open + addA + addB - sale), ceased = !!(inp.ceased || {})[k], s1 = R2(open + addA - sale);
      let dep = 0, close = 0, stcg = 0;
      if (total < 0){ stcg = -total; }
      else if (ceased){ stcg = -total; }
      else { dep = R0((Math.max(0, s1) * b.rate + Math.max(0, addB + Math.min(0, s1)) * b.rate / 2) * frac); close = R2(total - dep); }
      return {key: k, name: b.name, rate: b.rate, open, src: o.src || "", srcLabel: o.label || "", addA, addB, sale, total, ceased, stcg: R2(stcg), dep, close, adds, part};
    });
  }

  // ---------- deferred tax ----------
  // the rate by regime: 115BAA 22% + 10% surcharge + 4% cess = 25.168%; a company at the normal rate 25% (turnover up to
  // Rs 400 crore) or 30%, + 4% cess (surcharge 7% / 12% above Rs 1 / 10 crore of income: give the rate); a firm or LLP 30%
  // + 4% cess (12% surcharge above Rs 1 crore: give the rate); slab rates: 30% + 4% cess
  function rateFor(regime, small400){
    if (regime === "115BAA") return {rate: 25.168, why: "section 115BAA: 22% + surcharge 10% + cess 4%"};
    if (regime === "normal") return small400 === false ? {rate: 31.2, why: "normal rate 30% + cess 4% (surcharge, if the income is above Rs 1 crore, to be added: give the rate)"} : {rate: 26, why: "normal rate 25% (turnover up to Rs 400 crore) + cess 4% (surcharge, if the income is above Rs 1 crore, to be added: give the rate)"};
    if (regime === "firm") return {rate: 31.2, why: "firm / LLP: 30% + cess 4% (surcharge 12% above Rs 1 crore: give the rate)"};
    return {rate: 31.2, why: "the highest slab, 30% + cess 4%"};
  }
  const MAT = r => r === "115BAA" ? "MAT (section 115JB) does not apply: a company that opts for section 115BAA is outside it (section 115JB(5A)), and no MAT credit is carried."
    : r === "normal" ? "MAT (section 115JB) can apply to a company at the normal rates: book profit at 15% is not worked here, nor the MAT credit (section 115JAA)."
      : "MAT does not apply (not a company); alternate minimum tax (section 115JC) is not worked here.";
  // rows [{key, label, diff}] (a positive difference makes a liability) at rate % -> {total, closing (rupees), ...}
  function dtCalc(rows, rate, open){
    const total = R2(rows.reduce((s, r) => s + N(r.diff), 0)), closing = R0(total * rate / 100);
    return {rows: rows.map(r => Object.assign({}, r, {dtax: R0(N(r.diff) * rate / 100)})), total, rate, closing, open: R2(N(open)), move: R2(closing - N(open)), side: closing >= 0 ? "liability" : "asset"};
  }

  // ---------- last year's ITR ----------
  // The real shape (the owner's ITR-3 and ITR-6 for AY 2026-27, 30-Oct-2026; tests/fixtures/fin-depr/*-ay2026-shape.json copy
  // it with made-up figures): ITR.ITRn.ScheduleDPM.PlantMachinery.Rate15|Rate30|Rate40|Rate45.DepreciationDetail.{WDVFirstDay,
  // AdditionsGrThan180Days, ..., TotalDepreciation, CapGainUs50, WDVLastDay}; ScheduleDOA.Building.Rate5|Rate10|Rate40,
  // FurnitureFittings.Rate10, IntangibleAssets.Rate25, Ships.Rate20, each .DepreciationDetail; ScheduleDOA.Land.
  // DepreciationDetail with no rate (land: no block, not read). A form lists only the rates it uses (an ITR-3 may have
  // Rate15 and Rate40 only). Before that, as first written:
  // The return as downloaded from the e-filing portal (JSON): {"ITR": {"ITR6": {"Form_ITR6": {FormName, AssessmentYear},
  // "ScheduleDPM": {...}, "ScheduleDOA": {...}, "ScheduleDEP": {...}}}} (ITR-3, ITR-5, ITR-7 the same under ITR3 / ITR5 / ITR7).
  // Read: in Schedule DPM (plant and machinery) and Schedule DOA (other assets), each rate's object holding WDVLastDay (the
  // written down value on the last day of the previous year: next year's opening) and WDVFirstDay; the block is the
  // rate key (Rate15, Rate30, Rate40, Rate45 ...) under its asset (PlantMachinery / Building / Furniture / Intangible / Ships).
  // The reader looks for those keys anywhere under the two schedules, so the forms' differences in nesting do not matter.
  const famOf = path => { const p = path.join("/"); return /plant|machin|ScheduleDPM/i.test(p) && !/build|furnit|intang|ship/i.test(p) ? "pm" : /build/i.test(p) ? "b" : /furnit/i.test(p) ? "f" : /intang/i.test(p) ? "i" : /ship/i.test(p) ? "s" : ""; };
  const blockOfPath = path => {
    const rk = path.slice().reverse().map(k => /^(?:Rate|Dep(?:reciation)?Rate|DepRate)?(\d{1,2})$|Rate(\d{1,2})\b|Rate(\d{1,2})[A-Za-z]/i.exec(k)).find(Boolean);
    if (!rk) return "";
    const r = N(rk[1] || rk[2] || rk[3]), fam = famOf(path);
    if (fam === "pm") return r === 15 ? "pm15" : r === 30 ? "pm30" : r === 40 || r === 45 ? "c40" : "";
    if (fam === "b") return r === 5 ? "b5" : r === 10 ? "b10" : r === 40 ? "b40" : "";
    if (fam === "f") return r === 10 ? "f10" : "";
    if (fam === "i") return r === 25 ? "i25" : "";
    if (fam === "s") return r === 20 ? "s20" : "";
    return "";
  };
  function readItrJson(obj, fy){
    const out = {src: "json", form: "", ay: "", pan: "", name: "", blocks: {}, found: [], why: ""};
    if (!obj || typeof obj !== "object") return Object.assign(out, {why: "This is not an ITR JSON file."});
    const root = obj.ITR && typeof obj.ITR === "object" ? obj.ITR : obj, fk = Object.keys(root).find(k => /^ITR\d$/i.test(k)), f = fk ? root[fk] : root;
    out.form = fk ? "ITR-" + fk.slice(3) : "";
    const fm = Object.keys(f || {}).find(k => /^Form_ITR\d$/i.test(k));
    if (fm){ out.form = String(f[fm].FormName || out.form || ""); out.ay = String(f[fm].AssessmentYear || ""); }
    if (!/ITR-?[3567]\b/i.test(out.form)) return Object.assign(out, {why: out.form ? out.form + " has no depreciation schedules: upload ITR-3, ITR-5, ITR-6 or ITR-7." : "This file is not an ITR from the e-filing portal (no ITR3 / ITR5 / ITR6 / ITR7 in it)."});
    const walk = (o, path, fn) => { if (!o || typeof o !== "object") return; fn(o, path); Object.keys(o).forEach(k => walk(o[k], path.concat(k), fn)); };
    walk(f, [], (o, path) => { if (!out.pan && typeof o.PAN === "string" && /^[A-Z]{5}\d{4}[A-Z]$/.test(o.PAN)) out.pan = o.PAN; });
    // which value is the opening for the year asked: last year's return (AY = fy) gives its last day; this year's (AY = fy + 1) its first day
    const ay = N(String(out.ay).slice(0, 4)), useFirst = fy && ay === N(fy) + 1;
    if (fy && ay && ay !== N(fy) && ay !== N(fy) + 1) out.warn = "This return is for assessment year " + ay + "-" + String(ay + 1).slice(2) + "; the opening of " + fy + "-" + String(N(fy) + 1).slice(2) + " is the closing of the return for assessment year " + fy + "-" + String(N(fy) + 1).slice(2) + ".";
    ["ScheduleDPM", "ScheduleDOA"].forEach(sk => {
      const sch = f[Object.keys(f).find(k => k.toLowerCase() === sk.toLowerCase())];
      if (!sch) return;
      walk(sch, [sk], (o, path) => {
        const lk = Object.keys(o).find(k => /^WDVLastDay$|^WrittenDownValueLastDay$|WDV.*Last.*Day|^ClosingWDV$/i.test(k)), fk2 = Object.keys(o).find(k => /^WDVFirstDay$|WDV.*First.*Day|^OpeningWDV$/i.test(k));
        if (!lk && !fk2) return;
        const k = blockOfPath(path); if (!k) return;
        const v = useFirst ? N(o[fk2]) : N(o[lk]);
        out.blocks[k] = R2(N(out.blocks[k]) + v);
        out.found.push({block: k, path: path.join(" › "), field: useFirst ? fk2 : lk, v});
      });
    });
    if (!out.found.length) out.why = "No closing written down value was found in Schedule DPM or Schedule DOA of this " + (out.form || "return") + " (the return may have no business depreciation). Type the opening WDV instead.";
    out.field = useFirst ? "WDVFirstDay" : "WDVLastDay";
    return out;
  }
  // the PDF's text (pdf.js text layer, a line per row, as the app reads it: getPdf + pageTextLines). Read against the
  // portal's PDFs of ITR-3 and ITR-6 for AY 2026-27 (owner, 30-Oct-2026; fixtures copy their layout with made-up figures):
  //   Schedule DPM: "2 Rate (%) 15 30 40 45", then "21 Written down value on the last day of previous year a b c d";
  //     in ITR-6 the label is a line of its own and the figures come on the next line behind the row number
  //     ("21 a b c d"), followed by the formula "(6+ 9 - 15 )";
  //   Schedule DOA: "2 Rate (%) nil 5 10 40 10 25 20": Land first (nil: no block), then buildings 5 / 10 / 40, furniture
  //     10, intangibles 25, ships 20; "18 Written down value on the last day of previous a b c d e f g".
  // The columns come from the schedule's own Rate row; the figures are the last as many numbers on the row (a row
  // number in front never counts; a formula in brackets is left out). Last year's return (AY = the year) gives its last
  // day; this year's own (AY = the year + 1) its first day ("3 / 3a Written down value on the first day"), as the JSON.
  // A scan has no text: said plainly, never guessed.
  const AMT = /^-?(\d{1,3}(,\d{2,3})+|\d+)(\.\d{1,2})?$/;
  const DPM_RATE = {15: "pm15", 30: "pm30", 40: "c40", 45: "c40"}, DOA_ORDER = ["b5", "b10", "b40", "f10", "i25", "s20"];
  function readItrText(text, fy){
    const out = {src: "pdf", form: "", ay: "", pan: "", blocks: {}, found: [], why: ""};
    const ls = String(text || "").split(/\r?\n/).map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (ls.join("").replace(/\W/g, "").length < 40) return Object.assign(out, {why: "This PDF has no text to read (a scanned copy?): FinCom cannot read it and sends it nowhere. Upload the JSON from the e-filing portal, or type the opening WDV."});
    const all = ls.join(" "), fm = /\bITR[- ]?([3567])\b/i.exec(all), ay = /assessment\s+year\s*:?\s*(20\d{2})\s*-\s*(\d{2})/i.exec(all), pan = /\b([A-Z]{5}\d{4}[A-Z])\b/.exec(all);
    out.form = fm ? "ITR-" + fm[1] : ""; out.ay = ay ? ay[1] : ""; out.pan = pan ? pan[1] : "";
    const useFirst = !!(fy && out.ay && N(out.ay) === N(fy) + 1);
    if (fy && out.ay && N(out.ay) !== N(fy) && !useFirst) out.warn = "This return is for assessment year " + out.ay + "-" + String(N(out.ay) + 1).slice(2) + "; the opening of " + fy + "-" + String(N(fy) + 1).slice(2) + " is the closing of the return for assessment year " + fy + "-" + String(N(fy) + 1).slice(2) + ".";
    const nums = s => String(s).replace(/\([^)]*\)/g, " ").split(" ").filter(t => AMT.test(t)).map(t => N(t.replace(/,/g, "")));
    const ROW = useFirst ? /written\s+down\s+value\s+on\s+the\s+first\s+day|wdv\s+on\s+the\s+first\s+day/i : /written\s+down\s+value\s+on\s+the\s+last\s+day|wdv\s+on\s+the\s+last\s+day/i;
    const take = (re, dpm) => {
      const i = ls.findIndex(s => re.test(s)); if (i < 0) return false;
      let end = ls.length; for (let j = i + 1; j < ls.length; j++){ if (/^schedule\s*-?\s*[a-z]/i.test(ls[j])){ end = j; break; } }
      const sec = ls.slice(i, end);
      // the columns, from the Rate row: a rate, or nil (land: no block)
      const rr = sec.find(s => /\brate\s*\(\s*%\s*\)/i.test(s)), toks = rr ? rr.replace(/^.*?\(\s*%\s*\)/, "").trim().split(" ").filter(t => /^(nil|\d{1,2}(\.\d+)?)$/i.test(t)) : [];
      let cols;
      if (toks.length){ let n = 0; cols = toks.map(t => /^nil$/i.test(t) ? null : dpm ? DPM_RATE[N(t)] || null : DOA_ORDER[n++] || null); }
      else cols = dpm ? ["pm15", "pm30", "c40", "c40"] : DOA_ORDER.slice();
      const j = sec.findIndex(s => ROW.test(s)); if (j < 0) return false;
      let v = nums(sec[j].replace(ROW, " "));
      if (v.length < cols.length && sec[j + 1]) v = nums(sec[j + 1]);
      if (v.length < cols.length) return false;
      v = v.slice(v.length - cols.length);
      v.forEach((x, n) => { const k = cols[n]; if (!k) return; out.blocks[k] = R2(N(out.blocks[k]) + x); out.found.push({block: k, path: sec[0].slice(0, 40) + " › " + sec[j].slice(0, 60), field: useFirst ? "first day" : "last day", v: x}); });
      return true;
    };
    const a = take(/^schedule\s*-?\s*dpm\b/i, true), b = take(/^schedule\s*-?\s*doa\b/i, false);
    if (!a && !b) out.why = "FinCom could not find the " + (useFirst ? "opening" : "closing") + " written down value (Schedule DPM / DOA, \"written down value on the " + (useFirst ? "first" : "last") + " day of the previous year\") in this PDF's text. Upload the JSON from the e-filing portal, or type the opening WDV.";
    out.field = useFirst ? "WDVFirstDay" : "WDVLastDay";
    return out;
  }

  // ---------- last year's audited balance sheet (FinPyBs) as the opening of the classes ----------
  // its lines in rupees by class: gross block, accumulated depreciation, or the net block when that is all it gives
  const clsOfText = t => { const s = String(t || "").toUpperCase();
    return /SOFTWARE|INTANGIBLE|TRADE ?MARK|PATENT|LICEN[CS]E|GOODWILL/.test(s) ? "sw" : /COMPUTER|LAPTOP|SERVER|PRINTER|DESKTOP/.test(s) ? "comp" : /FURNITURE|FIXTURE/.test(s) ? "furn" :
      /VEHICLE|\bCARS?\b|MOTOR|SCOOTER|BIKE/.test(s) ? "veh" : /LEASEHOLD IMPROVE/.test(s) ? "lhi" : /BUILDING|PREMISES|\bFLAT\b|OFFICE SPACE/.test(s) ? "bld" : /\bLAND\b/.test(s) ? "land" :
        /PLANT|MACHIN/.test(s) ? "pm" : /EQUIP|MOBILE|AIR CONDITION|CCTV|ELECTRICAL|APPLIANCE/.test(s) ? "oe" : ""; };
  function fromPyBs(v){
    const out = {}; if (!v || !v.lines) return out;
    const u = N(v.unit) || 1, codeCls = {};
    if (typeof FinSt === "object") FinSt.PPE.concat(FinSt.INT).forEach(([cls, , g, a]) => { codeCls[g] = [cls, "gross"]; if (a) codeCls[a] = [cls, "acc"]; });
    v.lines.forEach(z => {
      if (z.isHead || z.isTotal || z.amt == null) return;
      // the balance sheet's own caption ("Property, plant and equipment") is the whole note, not a class
      if (/property,?\s*plant|fixed assets|tangible assets|capital work/i.test(z.label)) return;
      const txt = [z.label, z.sub, z.head].join(" "), byCode = codeCls[z.code] || null, cls = clsOfText(z.label) || (byCode && byCode[0]) || clsOfText(z.sub);
      if (!cls) return;
      const ppeCtx = /property|plant|fixed asset|tangible|intangible|block|depreciation|note/i.test(txt) || byCode;
      if (!ppeCtx) return;
      const kind = /accumulated|depreciation|amorti/i.test(txt) ? "acc" : /gross|cost|original/i.test(txt) ? "gross" : /\bnet\b|wdv|written down|carrying/i.test(txt) ? "net" : byCode ? (byCode[1] === "acc" ? "acc" : "net") : "net";
      const x = out[cls] = out[cls] || {gross: null, acc: null, net: null, lines: []};
      x[kind] = R2(N(x[kind]) + Math.abs(N(z.amt)) * u); x.lines.push(z.label);
    });
    Object.values(out).forEach(x => {
      if (x.gross == null && x.acc == null){ x.gross = x.net; x.acc = 0; x.netOnly = true; }
      else { if (x.gross == null) x.gross = R2(N(x.net) + N(x.acc)); if (x.acc == null) x.acc = x.net != null ? R2(x.gross - x.net) : 0; }
    });
    return out;
  }

  // ---------- the app: what is kept, and the year worked out from the books ----------
  const books = () => (typeof S === "object" && S && S.books) || {};
  const st = () => (books().fs || {}).depr || null;
  const save = () => { if (typeof saveBooks === "function") saveBooks(); };
  const stW = () => { const b = books(); b.fs = b.fs || {}; b.fs.depr = Object.assign({}, b.fs.depr); return b.fs.depr; };
  const at = (o, fy) => (o || {})[String(fy)] || {};
  const CLASSES = () => (typeof FinSt === "object" ? FinSt.PPE.concat(FinSt.INT) : []).map(([cls, label, g, a, blk], i, all) => ({cls, label, g, a, blk, note: i < FinSt.PPE.length ? "8" : "34"}));
  function cfgOf(cls){ const s = (st() || {}).cls || {}, d = CLS[cls] || CLS.pm, t = s[cls] || {};
    const block = t.block != null ? t.block : (((books().fs || {}).taxBlockCls || {})[cls]) || d.block;
    return {method: t.method || d.method, life: t.life != null && t.life !== "" ? N(t.life) : d.life, res: t.res != null && t.res !== "" ? N(t.res) : d.res, block, why: d.why, typed: !!(t.method || t.life != null || t.res != null || t.block != null)}; }
  const kindOf = () => (typeof FS === "object" && FS.cfg(books()).kind === "co") ? "co" : "nc";
  const ON = () => !!st();

  // the day book's entries in the classes' ledgers for the year: additions, sales, the books' own depreciation and
  // profit / loss on sale; each ledger's balance at the start of the year
  function readBooks(fy){
    const b = books(), F = fyOf(fy), kind = kindOf(), map = (b.fs || {}).map || {}, cache = {};
    let open = {}; try { const bal = Audit.balances(F.y0, F.y1); if (bal.ok) open = bal.at(Audit.dayBefore(F.y0)); } catch (e){ open = {}; }
    // each ledger's code as the trial balance gives it (its balance tells its side; FinSt.codeOf)
    const codeOf = l => cache[l] !== undefined ? cache[l] : (cache[l] = FinSt.codeOf(l, -N(open[l]) || 1, kind, map).code || "");
    const clsOfCode = {}; CLASSES().forEach(c => { clsOfCode[c.g] = [c.cls, "gross"]; if (c.a) clsOfCode[c.a] = [c.cls, "acc"]; });
    const ledOpen = {}; Object.keys(open).forEach(l => { const c = clsOfCode[codeOf(l)]; if (c) ledOpen[l] = {cls: c[0], kind: c[1], v: R2(-N(open[l]))}; });
    // the books' own depreciation and profit / loss on sale, entry by entry (a period takes its own)
    const adds = [], sales = [], booked = [], gainBk = [], lossBk = [], flags = [];
    const isFA = c => !!clsOfCode[c], isDepC = c => c === "8E" || c === "34D";
    (b.vouchers || []).forEach(v => {
      if (v.date < F.y0 || v.date > F.y1 || v.opt || v.cancel) return;
      const ent = (v.ent || []).map(e => ({l: e.l, a: -N(e.a), c: codeOf(e.l)}));   // a debit positive
      if (!ent.some(e => isFA(e.c))) return;
      const key = (v.id || (v.no + "@" + v.date)), party = (ent.filter(e => !isFA(e.c)).sort((x, y) => Math.abs(y.a) - Math.abs(x.a))[0] || {}).l || "";
      // the books' own depreciation (Dr 8E / 34D, Cr the asset or its accumulated depreciation; a reversal the other way)
      if (ent.some(e => isDepC(e.c))){ ent.forEach(e => { const c = clsOfCode[e.c]; if (c) booked.push({cls: c[0], date: v.date, v: R2(-e.a)}); }); return; }
      // profit / loss on sale the books booked against the class's ledgers
      const g = ent.filter(e => e.c === "14B").reduce((s, e) => s - e.a, 0), lo = ent.filter(e => e.c === "17T").reduce((s, e) => s + e.a, 0);
      const faCls = Array.from(new Set(ent.filter(e => isFA(e.c)).map(e => clsOfCode[e.c][0])));
      if (g) gainBk.push({cls: faCls[0], date: v.date, v: R2(g)});
      if (lo) lossBk.push({cls: faCls[0], date: v.date, v: R2(lo)});
      // the consideration: what the other side (a party, bank, cash) brings or takes
      const other = ent.filter(e => !isFA(e.c) && !isDepC(e.c) && e.c !== "14B" && e.c !== "17T");
      const consider = R2(other.reduce((s, e) => s + (e.a > 0 ? e.a : 0), 0));
      const grossDr = ent.filter(e => e.a > 0 && isFA(e.c) && clsOfCode[e.c][1] === "gross"), grossCr = ent.filter(e => e.a < 0 && isFA(e.c) && clsOfCode[e.c][1] === "gross");
      const crTot = grossCr.reduce((s, e) => s - e.a, 0);
      grossDr.forEach((e, n) => { if (!other.length){ flags.push({key, date: v.date, ledger: e.l, why: "a debit to the asset from another asset ledger: a transfer, not an addition"}); return; }
        adds.push({key: key + "|" + n, vkey: key, date: v.date, ledger: e.l, cls: clsOfCode[e.c][0], amt: R2(e.a), party, vno: v.no || "", vtype: v.type || "", narr: v.narr || ""}); });
      grossCr.forEach((e, n) => {
        if (!other.length && !g && !lo){ flags.push({key, date: v.date, ledger: e.l, why: "a credit to the asset against an asset or accumulated-depreciation ledger only: not a sale"}); return; }
        sales.push({key: key + "|c" + n, vkey: key, date: v.date, ledger: e.l, cls: clsOfCode[e.c][0], credit: R2(-e.a), value: R2(crTot ? consider * (-e.a) / crTot : 0), party, vno: v.no || "", vtype: v.type || "", narr: v.narr || ""});
      });
    });
    return {ledOpen, adds, sales, booked, gainBk, lossBk, flags};
  }

  // the opening of each class: last year's audited balance sheet, else last year's register in FinCom, else FinCom's
  // opening balances (the classes' ledgers), else typed; typed wins when typed for the year
  function openings(fy, bk, depth){
    const typed = at((st() || {}).open, fy), up = typeof FinPyBs === "object" && FinPyBs.latest ? FinPyBs.latest(fy) : null, fromUp = up ? fromPyBs(up) : {};
    const prev = (depth || 0) < 4 && hasPrev(String(N(fy) - 1)) ? yearCA(String(N(fy) - 1), (depth || 0) + 1) : null;
    const out = {};
    CLASSES().forEach(c => {
      const t = typed[c.cls], u = fromUp[c.cls], p = prev && prev.classes[c.cls];
      const ls = Object.entries(bk.ledOpen).filter(([, x]) => x.cls === c.cls), g = R2(ls.filter(([, x]) => x.kind === "gross").reduce((s, [, x]) => s + x.v, 0)), a = R2(-ls.filter(([, x]) => x.kind === "acc").reduce((s, [, x]) => s + x.v, 0));
      // (the owner's order: last year's audited balance sheet, else last year's figures in FinCom, else typed; with none of
      // them, FinCom's opening balances of the class's ledgers, said so)
      const books = {gross: g, acc: a};
      if (u) out[c.cls] = {gross: u.gross, acc: u.acc, src: "upload", label: "last year's balance sheet (" + (up.file || "uploaded") + ", version " + up.v + ")" + (u.netOnly ? ": the net block only, taken as cost with nothing depreciated" : ""), books};
      else if (p) out[c.cls] = {gross: p.gC, acc: p.dC, src: "fincom", label: "last year's register in FinCom", books};
      else if (t && (t.gross != null || t.acc != null)) out[c.cls] = {gross: R2(N(t.gross)), acc: R2(N(t.acc)), src: "typed", label: "typed" + (t.by ? " by " + t.by : ""), books};
      else out[c.cls] = {gross: g, acc: a, src: "books", label: "FinCom's opening balances (the class's ledgers; give last year's audited figures)", books};
    });
    return out;
  }
  const hasPrev = fy => { const s = st() || {}; return !!(at(s.open, fy) && Object.keys(at(s.open, fy)).length) || !!(typeof FinPyBs === "object" && FinPyBs.latest && FinPyBs.latest(fy)) || !!at(s.use, fy).ca; };

  // the items of the year: each class's opening (one lot, split where a part is sold), and each addition; the sales
  function itemsOf(fy, bk, op){
    const F = fyOf(fy), s = st() || {}, saleEd = at(s.sale, fy), putEd = at(s.put, fy), items = [], events = [];
    const lots = {};
    CLASSES().forEach(c => { const o = op[c.cls]; if (o && (o.gross || o.acc)) lots[c.cls] = {id: "open:" + c.cls, cls: c.cls, name: "Opening balance: " + c.label, put: null, sale: null, value: 0, cost: o.gross, acc: o.acc, kind: "open"}; });
    const adds = bk.adds.map(a => ({id: "add:" + a.key, key: a.key, cls: a.cls, name: a.ledger + (a.party ? " · " + a.party : "") + (a.vno ? " (" + a.vtype + " " + a.vno + ")" : ""), ledger: a.ledger, date: a.date, put: putEd[a.key] || a.date, sale: null, value: 0, cost: a.amt, acc: 0, kind: "add"}));
    const grossOpenOf = cls => Object.values(bk.ledOpen).filter(x => x.cls === cls && x.kind === "gross").reduce((t, x) => t + x.v, 0);
    bk.sales.slice().sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0).forEach(sl => {
      const ed = saleEd[sl.key] || {}, lot = lots[sl.cls], parts = [];
      if (ed.cost != null && ed.cost !== ""){
        // the cost of what was sold, typed: from the class's opening
        if (lot && lot.cost > 0){ const f = Math.min(1, N(ed.cost) / lot.cost); parts.push({lot, f}); }
      } else {
        // the whole ledger: its share of the class's opening, and its additions before the sale
        const lo = N((bk.ledOpen[sl.ledger] || {}).v), tot = grossOpenOf(sl.cls);
        if (lot && lo > 0 && tot > 0) parts.push({lot, f: Math.min(1, lo / tot)});
        adds.filter(a => a.ledger === sl.ledger && a.date <= sl.date && !a.sale).forEach(a => parts.push({add: a}));
      }
      const sold = [];
      parts.forEach(p => {
        if (p.add){ p.add.sale = sl.date; sold.push(p.add); return; }
        const L = p.lot, cost = R2(L.cost * p.f), acc = R2(L.acc * p.f);
        if (!cost && !acc) return;
        const it = {id: L.id + ":sold:" + sl.key, cls: L.cls, name: "Sold from the opening balance: " + sl.ledger, put: null, sale: sl.date, value: 0, cost, acc, kind: "open", saleKey: sl.key};
        L.cost = R2(L.cost - cost); L.acc = R2(L.acc - acc); sold.push(it); items.push(it);
      });
      // the sale value over what was sold, by cost (the last takes the paise left)
      const tc = sold.reduce((t, x) => t + x.cost, 0); let left = sl.value;
      sold.forEach((x, n) => { const v = n === sold.length - 1 ? R2(left) : R2(tc ? sl.value * x.cost / tc : 0); x.value = v; x.saleKey = sl.key; left = R2(left - v); });
      events.push(Object.assign({}, sl, {items: sold.map(x => x.id), cost: R2(tc), typedCost: ed.cost != null && ed.cost !== "", none: !sold.length}));
    });
    Object.values(lots).forEach(L => { if (L.cost || L.acc) items.unshift(L); });
    adds.forEach(a => items.push(a));
    return {items, events};
  }

  // the Companies Act for a year and a period (memoised on what it reads)
  let memo = {};
  const keyOf = (fy, from, to) => { const b = books(), f = b.fs || {}; let up = null; try { up = typeof FinPyBs === "object" && FinPyBs.latest ? (FinPyBs.latest(fy) || {}).v : null; } catch (e){ up = null; }
    return [b.cid, fy, from, to, (b.vouchers || []).length, (b.tb || {}).at || "", JSON.stringify(f.depr || {}), JSON.stringify(f.map || {}), up, JSON.stringify(f.pyBs ? Object.keys(f.pyBs) : [])].join("\u0001"); };
  function yearCA(fy, depth, from, to){
    const F = fyOf(fy); from = from && from > F.y0 ? from : F.y0; to = to && to < F.y1 ? to : F.y1;
    const k = keyOf(fy, from, to); if (memo[k]) return memo[k];
    const bk = readBooks(fy), op = openings(fy, bk, depth), {items, events} = itemsOf(fy, bk, op);
    const o = {y0: F.y0, from, to, diy: F.diy}, cfgs = {}; CLASSES().forEach(c => { cfgs[c.cls] = cfgOf(c.cls); });
    const r = caItems(items, cls => cfgs[cls], o);
    const classes = {};
    CLASSES().forEach(c => { const x = r.classes[c.cls]; if (!x && !(op[c.cls] && (op[c.cls].gross || op[c.cls].acc))) return;
      const y = Object.assign(Object.fromEntries(COLS.map(k2 => [k2, 0])), x || {});
      const gains = r.items.filter(z => z.cls === c.cls && z.inDel);
      const inP = list => R2(list.filter(z => z.cls === c.cls && z.date >= from && z.date <= to).reduce((s, z) => s + z.v, 0));
      classes[c.cls] = Object.assign(y, {cls: c.cls, label: c.label, g: c.g, a: c.a, note: c.note, cfg: cfgs[c.cls], open: op[c.cls], booked: inP(bk.booked),
        gainP: R2(gains.reduce((s, z) => s + Math.max(0, z.gain), 0)), lossP: R2(gains.reduce((s, z) => s + Math.max(0, -z.gain), 0)), gainBk: inP(bk.gainBk), lossBk: inP(bk.lossBk)}); });
    const out = {fy, from, to, y0: F.y0, y1: F.y1, diy: F.diy, full: from === F.y0 && to === F.y1, fromStart: from === F.y0, items: r.items, events, classes, total: r.total, books: bk, cfgs, flags: bk.flags};
    memo[k] = out; if (Object.keys(memo).length > 40) memo = {[k]: out};
    return out;
  }

  // the Income-tax side for the year: opening per block from last year's ITR, else typed here, else typed on the
  // Computation tab (FinSt's taxDep), else last year's closing in FinCom
  const itrLatest = fy => { const v = (at((st() || {}).itr, fy).versions || []); return v.length ? v[v.length - 1] : null; };
  function itOpen(fy, depth){
    const s = st() || {}, itr = itrLatest(fy), typed = at(s.itOpen, fy), old = (((books().fs || {}).taxDep) || {})[fy] || {}, out = {};
    const prev = (depth || 0) < 4 && (itrLatest(String(N(fy) - 1)) || Object.keys(at(s.itOpen, String(N(fy) - 1))).length) ? yearIT(String(N(fy) - 1), null, (depth || 0) + 1) : null;
    BLOCKS.forEach(([k]) => {
      if (itr && itr.blocks && itr.blocks[k] != null) out[k] = {open: itr.blocks[k], src: "itr", label: (itr.form || "ITR") + (itr.ay ? " AY " + itr.ay + "-" + String(N(itr.ay) + 1).slice(2) : "") + " (" + (itr.src === "pdf" ? "PDF" : "JSON") + ", " + (itr.file || "uploaded") + ")"};
      else if (typed[k] != null && typed[k] !== "") out[k] = {open: R2(N(typed[k])), src: "typed", label: "typed"};
      else if (old[k] != null && old[k] !== "") out[k] = {open: R2(N(old[k])), src: "typed", label: "typed on the Computation of income tab"};
      else if (prev){ const z = prev.blocks.find(x => x.key === k); if (z) out[k] = {open: z.close, src: "fincom", label: "last year's closing WDV in FinCom"}; }
    });
    return out;
  }
  function yearIT(fy, to, depth){
    const F = fyOf(fy), ca = yearCA(fy, depth), s = st() || {}, ced = at(s.ceased, fy), op = itOpen(fy, depth), blockOf = cls => ca.cfgs[cls] ? ca.cfgs[cls].block : "";
    const adds = ca.items.filter(x => x.kind === "add" && x.put && x.put <= F.y1 && blockOf(x.cls)).map(x => ({block: blockOf(x.cls), put: x.put, amt: x.cost, name: x.name, cls: x.cls}));
    const sales = ca.events.filter(e => blockOf(e.cls)).map(e => ({block: blockOf(e.cls), date: e.date, value: e.value, name: e.ledger, cls: e.cls}));
    // a block ceases when every asset in it is sold by the year end (or the day the period ends) and something was sold:
    // changeable for the year
    const T = to && to < F.y1 ? to : F.y1, ceasedAuto = {};
    BLOCKS.forEach(([k]) => { const cl = Object.keys(ca.cfgs).filter(c => ca.cfgs[c].block === k), held = ca.items.some(x => cl.includes(x.cls) && (!x.sale || x.sale > T) && x.cost > 0), sold = sales.some(z => z.block === k && z.date <= T);
      ceasedAuto[k] = sold && !held; });
    const ceased = Object.fromEntries(BLOCKS.map(([k]) => [k, ced[k] != null && sales.some(z => z.block === k && z.date <= T) ? !!ced[k] : ceasedAuto[k]]));
    const blocks = itBlocks({fy, to, blocks: op, adds, sales, ceased});
    blocks.forEach(z => { z.ceasedAuto = ceasedAuto[z.key]; z.ceasedTyped = ced[z.key] != null; });
    return {fy, blocks, adds, sales, total: R2(blocks.reduce((t, z) => t + z.dep, 0)), close: R2(blocks.reduce((t, z) => t + z.close, 0)), open: R2(blocks.reduce((t, z) => t + z.open, 0)), itr: itrLatest(fy), part: !!(to && to < F.y1)};
  }

  // ---------- the statements: the trial balance's FinCom rows, the PPE schedule, the computation's depreciation ----------
  const useOf = fy => at((st() || {}).use, fy);
  const RATE = () => { const s = st() || {}, rg = FinSt.regime(), r = rateFor(rg, (((books().fs || {}).inputs) || {}).small400);
    return s.dtRate != null && s.dtRate !== "" ? {rate: N(s.dtRate), why: "given", regime: rg} : Object.assign(r, {regime: rg}); };
  // the deferred tax at the end of the period: rows of the trial balance (balances at To, a debit positive; FinCom's own
  // rows left out) for the provisions and the deferred tax already in the books
  function dtOf(fy, P, rows){
    const F = fyOf(fy), to = P && P.to ? P.to : F.y1, ca = yearCA(fy, 0, P && P.from, to), it = yearIT(fy, to < F.y1 ? to : null), b = books(), f = b.fs || {};
    const RS = codes => R2((rows || []).filter(r => !r.depr && codes.includes(r.code)).reduce((s, r) => s + N(r.final), 0));
    const dep = cls => !/^(land)$/.test(cls) && (ca.cfgs[cls] || {}).method !== "NONE";
    // book WDV at the end of the period: the register's net block (depreciable classes); before it, the year's opening
    const bookC = R2(Object.values(ca.classes).filter(c => dep(c.cls)).reduce((s, c) => s + c.nC, 0));
    const yr = yearCA(fy, 0), bookO = R2(Object.values(yr.classes).filter(c => dep(c.cls)).reduce((s, c) => s + R2(N(c.open && c.open.gross) - N(c.open && c.open.acc)), 0));
    const taxC = it.close, taxO = it.open;
    let msme = 0; try { const r = Audit.checks.msme43Bh(Audit, [], {to, from: F.y0}); msme = r ? R2(r.amount) : 0; } catch (e){ msme = 0; }
    const statEd = (((f.compEdits || {})[fy]) || {}).add_43b_stat, stat = statEd && statEd.v != null && statEd.v !== "" ? R2(N(statEd.v)) : 0;
    const rate = RATE();
    const rows2 = [{key: "dep", label: "Property, plant and equipment: carrying amount in the books less written down value for income tax", book: bookC, tax: taxC, diff: R2(bookC - taxC)},
      {key: "grat", label: "Provision for gratuity, allowed when paid (section 40A(7))", diff: RS(["5A", "5E"])},
      {key: "leave", label: "Provision for leave encashment, allowed when paid (section 43B(f))", diff: RS(["5B", "5C"])},
      {key: "msme", label: "Dues to micro and small enterprises unpaid beyond the time allowed (section 43B(h))", diff: R2(-msme)},
      {key: "stat", label: "Statutory dues unpaid by the due date (section 43B), as on the Computation of income tab", diff: R2(-stat)}];
    // last year's: the uploaded balance sheet's deferred tax line (31A liability, 9A asset), else the books' opening
    const up = typeof FinPyBs === "object" && FinPyBs.latest ? FinPyBs.latest(fy) : null;
    let open = null, openSrc = "";
    if (up){ const ls = (up.lines || []).filter(z => z.use && (z.code === "31A" || z.code === "9A")); if (ls.length){ open = R2(ls.reduce((s, z) => s + (z.code === "31A" ? 1 : -1) * Math.abs(N(z.amt)) * (N(up.unit) || 1), 0)); openSrc = "last year's balance sheet (" + (up.file || "uploaded") + ")"; } }
    const booksL = R2(-RS(["31A"])), booksA = R2(RS(["9A"])), booksNow = R2(booksL - booksA);
    if (open == null){ open = R2(-(rows || []).filter(r => !r.depr && (r.code === "31A" || r.code === "9A")).reduce((s, r) => s + N(P && !P.full && r.op != null ? r.op : r.py), 0)); openSrc = "FinCom's opening balances (the deferred tax ledgers)"; }
    // the timing difference at the start of the year, worked out the same way: to see last year's figure explained
    const openWork = R2(bookO - taxO);
    const x = dtCalc(rows2, rate.rate, open);
    return Object.assign(x, {rateWhy: rate.why, regime: rate.regime, given: rate.why === "given", openSrc, booksNow, booksL, booksA, adj: R2(x.closing - booksNow), bookO, taxO, openWork, mat: MAT(rate.regime), part: !!it.part,
      partNote: it.part ? "For a part of the year the income-tax written down value is an estimate (section 32 works for a whole previous year): the depreciation for the days so far." : ""});
  }

  // FinCom's rows in the trial balance (FinSt.tb: synthetic rows with their code), the differences between the register /
  // the deferred tax and what the books hold for the period; only for a period that starts on the year's first day
  function rowsFor(fy, P, out){
    if (!ON() || typeof FinSt !== "object") return [];
    const u = useOf(fy), F = fyOf(fy); if (!u.ca && !u.dt) return [];
    if (!P || P.from !== F.y0) return [];
    const res = [], add = (key, ledger, code, cy) => { if (Math.abs(cy) >= 0.005) res.push({key, ledger, code, cy: R2(cy)}); };
    if (u.ca){
      const ca = yearCA(fy, 0, P.from, P.to);
      Object.values(ca.classes).forEach(c => {
        const acc = c.a || c.g, depC = c.note === "34" ? "34D" : "8E";
        const dd = R2(c.dep - c.booked);
        add("dep:" + c.cls, "FinCom: depreciation as per the register (Companies Act) - " + c.label, depC, dd);
        const gp = R2(c.gainP - c.gainBk), lp = R2(c.lossP - c.lossBk);
        add("gain:" + c.cls, "FinCom: profit on sale as per the register - " + c.label, "14B", -gp);
        add("loss:" + c.cls, "FinCom: loss on sale as per the register - " + c.label, "17T", lp);
        add("net:" + c.cls, "FinCom: the register's adjustment to " + c.label + (c.a ? " - accumulated depreciation" : ""), acc, R2(-dd + gp - lp));
      });
    }
    if (u.dt){
      // the P&L takes the difference; the balance sheet shows the net figure on its side (a liability in Note 31, an asset
      // in Note 9), what the books hold on the other side moved across
      const dt = dtOf(fy, P, out), Lt = dt.closing >= 0 ? dt.closing : 0, At = dt.closing < 0 ? -dt.closing : 0;
      add("dt:pl", "FinCom: deferred tax as worked out (AS 22)", "22C", dt.adj);
      add("dt:dtl", "FinCom: deferred tax liability as worked out (AS 22)", "31A", -R2(Lt - dt.booksL));
      add("dt:dta", "FinCom: deferred tax asset as worked out (AS 22)", "9A", R2(At - dt.booksA));
    }
    return res;
  }
  // the PPE and intangibles schedules from the register, in the unit (FinSt.build's grid shape), when used
  function grids(fy, P, unit, dec){
    if (!ON() || !useOf(fy).ca || typeof FinSt !== "object") return null;
    const F = fyOf(fy); if (!P || P.from !== F.y0) return null;
    const ca = yearCA(fy, 0, P.from, P.to), U = v => RND(N(v) / unit, dec);
    const one = note => {
      const rows = [];
      Object.values(ca.classes).filter(c => c.note === note).forEach(c => {
        const D = U(c.gO), E = U(c.gA), Fv = -U(c.gD), G = RND(D + E + Fv, dec), H = U(c.dO), I = U(c.dep), J = -U(c.dD), K = RND(H + I + J, dec);
        if (!D && !G && !H && !K && !E) return;
        rows.push({cls: c.cls, label: c.label, g: c.g, a: c.a, D, E, F: Fv, G, H, I, J, K, L: RND(D - H, dec), M: RND(G - K, dec), dc: 0, reg: true});
      });
      const total = {}; "DEFGHIJKLM".split("").forEach(k => { total[k] = rows.length ? RND(rows.reduce((s, r) => s + N(r[k]), 0), dec) : null; });
      return {rows, total, fromRegister: true};
    };
    return {ppe: one("8"), int: one("34")};
  }
  // the computation's Annexure 1 (FinSt.taxDep's shape), once this tab is in use for the client
  function taxDep(fy){
    if (!ON() || typeof FinSt !== "object") return null;
    const it = yearIT(fy);
    const blocks = it.blocks.map(z => ({key: z.key, name: z.name, rate: z.rate, open: z.open, addA: z.addA, addB: z.addB, sale: z.sale, dep: z.dep, close: z.close, stcg: z.stcg, ceased: z.ceased, src: z.src, srcLabel: z.srcLabel}));
    return {fy, blocks, total: it.total, typed: blocks.some(z => z.src === "typed"), carried: blocks.some(z => z.src === "fincom"), depr: true, list: BLOCKS.map(([k, n]) => [k, n]),
      stcg: R2(it.blocks.reduce((s, z) => s + Math.max(0, z.stcg), 0)), stcl: R2(it.blocks.reduce((s, z) => s + Math.max(0, -z.stcg), 0))};
  }
  // everything the page, the Excel and the PDF show, put on the statements (d.depr)
  function attach(d){
    if (!ON() || !d || d.error) return d;
    const P = d.period || {}, F = fyOf(d.fy), rows = (d.tb && d.tb.rows) || [];
    const ca = yearCA(d.fy, 0, P.from, P.to), it = yearIT(d.fy), itP = P.to && P.to < F.y1 ? yearIT(d.fy, P.to) : null, dt = dtOf(d.fy, P, rows);
    const u = useOf(d.fy), canPost = !P.from || P.from === F.y0;
    d.depr = {fy: d.fy, period: {from: ca.from, to: ca.to, full: ca.full}, ca, it, itP, dt, use: {ca: !!u.ca && canPost, dt: !!u.dt && canPost, asked: u}, canPost,
      postNote: canPost ? "" : "For a period that does not start on 1 April the register and the deferred tax are shown here only: the statements take them for periods from 1 April (the full year, H1, Q1, 9 months, year to date).",
      sources: SOURCES, rows: rows.filter(r => r.depr)};
    return d;
  }

  // ---------- changes (each saved with the books, synced) ----------
  const who = () => (typeof Cloud === "object" && Cloud.st && Cloud.st.email) || "this computer";
  function start(){ const s = stW(); s.v = 1; save(); return s; }
  function cfgSet(cls, patch){ const s = stW(); s.cls = Object.assign({}, s.cls); s.cls[cls] = Object.assign({}, s.cls[cls], patch); Object.keys(s.cls[cls]).forEach(k => { if (s.cls[cls][k] == null || s.cls[cls][k] === "") delete s.cls[cls][k]; }); save(); }
  function openSet(fy, cls, o){ const s = stW(); s.open = Object.assign({}, s.open); const y = Object.assign({}, s.open[fy]); if (!o) delete y[cls]; else y[cls] = {gross: R2(N(o.gross)), acc: R2(N(o.acc)), by: who(), at: new Date().toISOString()}; s.open[fy] = y; save(); }
  const setIn = (name, fy, k, v) => { const s = stW(); s[name] = Object.assign({}, s[name]); const y = Object.assign({}, s[name][fy]); if (v == null || v === "") delete y[k]; else y[k] = v; s[name][fy] = y; save(); };
  const itOpenSet = (fy, k, v) => setIn("itOpen", String(fy), k, v === "" || v == null ? null : R2(N(v)));
  const ceasedSet = (fy, k, v) => setIn("ceased", String(fy), k, v == null ? null : !!v);
  const saleSet = (fy, key, cost) => setIn("sale", String(fy), key, cost === "" || cost == null ? null : {cost: R2(N(cost))});
  const putSet = (fy, key, ymd) => setIn("put", String(fy), key, /^\d{8}$/.test(String(ymd || "")) ? String(ymd) : null);
  function useSet(fy, o){ const s = stW(); s.use = Object.assign({}, s.use); s.use[fy] = Object.assign({}, s.use[fy], o); save(); }
  function dtRateSet(v){ const s = stW(); if (v === "" || v == null) delete s.dtRate; else s.dtRate = N(v); save(); }
  function itrSave(fy, read){
    const s = stW(); s.itr = Object.assign({}, s.itr); const y = s.itr[fy] = Object.assign({versions: []}, s.itr[fy]);
    const v = ((y.versions || []).slice(-1)[0] || {v: 0}).v + 1;
    const keep = {v, at: new Date().toISOString(), by: who(), file: read.file || "", size: N(read.size), sha256: read.sha256 || "", src: read.src, form: read.form || "", ay: read.ay || "", pan: read.pan || "",
      field: read.field || "", blocks: Object.assign({}, read.blocks), found: (read.found || []).slice(0, 40), warn: read.warn || ""};
    y.versions = (y.versions || []).concat([keep]); s.itr[fy] = y; save();
    return keep;
  }
  return {CLS, BLOCKS, BK, SOURCES, COLS, dn, ymdOf, DMY, fyOf, itemCalc, caItems, itBlocks, rateFor, MAT, dtCalc, readItrJson, readItrText, blockOfPath, fromPyBs, clsOfText,
    cfgOf, yearCA, yearIT, itOpen, dtOf, rowsFor, grids, taxDep, attach, on: ON, useOf, itrLatest,
    start, cfgSet, openSet, itOpenSet, ceasedSet, saleSet, putSet, useSet, dtRateSet, itrSave, forget: () => { memo = {}; }};
})();

if (typeof globalThis === "object") Object.assign(globalThis, {FinDepr});
/* @react-lazy: end */
