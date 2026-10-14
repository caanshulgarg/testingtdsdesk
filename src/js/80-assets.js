/* @react-lazy: begin 80-assets.js (the React app loads this file with its Statements and Fixed assets screens: build.py react_parts) */
/* ================================================================== */
/* Fixed assets and depreciation: the asset register, the Companies   */
/* Act (Schedule II) and the Income-tax Act (section 32) side by side */
/* ================================================================== */
// Approved by the owner on 14-Oct-2026 (branch depreciation). FAR is self-contained, like FSX (78-reports.js): the app
// calls it with the books it holds (FAR.fromBooks / FAR.refresh: the only part that reads the program's globals), and the
// Assistant's tool depreciation_schedule (server/assistant/tools/depreciation.ts) imports this file and calls
// FAR.compute on the register read back by migration 81 (asst_dep_register). Both give the same figures.
//
// The register is kept with the client's books, one per financial year: b.fixedAssets["2025"] (one of BOOKS_KEYS, so it
// is shared through client_book_items as key "fixedAssets", item ".2025"). It is PROPOSED from the books FinCom already
// has (no request to Tally): every ledger under Fixed Assets that is not an accumulated-depreciation ledger is an asset;
// its opening is the ledger's opening; a debit in the year is an addition (put to use on the voucher's date unless
// changed); a credit is a sale, scrapping or transfer (the voucher's amount is the sale value), or, when the other side is
// a depreciation ledger, depreciation booked straight to the asset. An accumulated-depreciation ledger ("Accumulated Dep
// for Car", "Provision for Dep on P&M @15%") is never an asset: it is matched by name to one asset or to a block of
// assets, and the match is shown for the person to confirm. Whatever the rules cannot be sure of is in the Confirm list.
//
// Nothing here writes to the books or to Tally. The journal entry for the year's depreciation is a suggestion only.
// Amounts are rupees with paise (Dr positive). Companies Act depreciation is worked to the paisa per component; the
// income-tax depreciation of a block is rounded to the rupee, as the statements' block working (FSX) rounds it.
const FAR = (() => {
  const X = {V: 1};
  // ------------------------------------------------------------ numbers and dates
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  // to the paisa, half away from zero
  const r2 = v => { const n = num(v), a = Math.round(Math.abs(n) * 100 + 1e-6) / 100; return n < 0 ? -a : a; };
  // paise to whole rupees in paise, as FSX's R0 (Excel's ROUND(x, 0))
  const R0p = p => { const a = Math.abs(p), r = Math.floor((a + 50) / 100) * 100; return p < 0 ? -r : r; };
  const P = v => Math.round(num(v) * 100);
  const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
  X.r2 = r2;
  const DAY = 86400000;
  const dnum = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : null; };
  const iso = n => new Date(n * DAY).toISOString().slice(0, 10);
  X.dnum = dnum; X.iso = iso;
  X.fyDates = fy => { const y = Number(fy), from = y + "-04-01", to = (y + 1) + "-03-31", s = dnum(from), e = dnum(to); return {from, to, s, e, diy: e - s + 1}; };
  X.fyLabel = fy => Number(fy) + "-" + String(Number(fy) + 1).slice(2);
  const addMonths = (d, m) => { const [y, mo, da] = d.split("-").map(Number), t = (mo - 1) + m, ny = y + Math.floor(t / 12), nm = ((t % 12) + 12) % 12, last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return ny + "-" + String(nm + 1).padStart(2, "0") + "-" + String(Math.min(da, last)).padStart(2, "0"); };
  // the years between two dates: whole months / 12, and the days left over / 365 (01-04-2023 to 01-04-2025 is 2 exactly)
  X.yearsBetween = function(a, b){
    if (!a || !b || dnum(b) <= dnum(a)) return 0;
    const [ay, am] = a.split("-").map(Number), [by, bm] = b.split("-").map(Number);
    let m = (by - ay) * 12 + (bm - am);
    while (m > 0 && dnum(addMonths(a, m)) > dnum(b)) m--;
    return m / 12 + (dnum(b) - dnum(addMonths(a, m))) / 365;
  };

  // ------------------------------------------------------------ the rules' tables
  X.SCH2_SOURCE = "Schedule II to the Companies Act, 2013, Part C (useful lives), as notified and amended by G.S.R. 237(E) of 31-03-2014 and G.S.R. 627(E) of 29-08-2014; residual value not more than 5% of the original cost (Part A, paragraph 3(i)). Intangible assets are not in Schedule II: AS 26 / Ind AS 38 (useful life estimated by management, residual value nil).";
  // k, the Schedule II head, useful life in years (null: not depreciated, or to be given), the statements' line
  X.SCH2 = [
    {k: "bldg_rcc", head: "I. Buildings", name: "Buildings (other than factory buildings), RCC frame structure", life: 60, line: "ppe"},
    {k: "bldg_nonrcc", head: "I. Buildings", name: "Buildings (other than factory buildings), other than RCC frame structure", life: 30, line: "ppe"},
    {k: "bldg_factory", head: "I. Buildings", name: "Factory buildings", life: 30, line: "ppe"},
    {k: "bldg_fence", head: "I. Buildings", name: "Fences, wells, tube wells", life: 5, line: "ppe"},
    {k: "bldg_temp", head: "I. Buildings", name: "Other buildings (including temporary structures)", life: 3, line: "ppe"},
    {k: "roads_rcc", head: "III. Roads", name: "Carpeted roads, RCC", life: 10, line: "ppe"},
    {k: "roads_other", head: "III. Roads", name: "Carpeted roads, other than RCC", life: 5, line: "ppe"},
    {k: "pm_general", head: "IV. Plant and Machinery", name: "Plant and machinery (general, other than continuous process plant)", life: 15, line: "ppe"},
    {k: "pm_cpp", head: "IV. Plant and Machinery", name: "Continuous process plant", life: 25, line: "ppe"},
    {k: "furniture", head: "V. Furniture and fittings", name: "Furniture and fittings (general)", life: 10, line: "ppe"},
    {k: "furniture_hotel", head: "V. Furniture and fittings", name: "Furniture and fittings used in hotels, restaurants, schools, colleges, cinema houses and the like", life: 8, line: "ppe"},
    {k: "mv_2w", head: "VI. Motor Vehicles", name: "Motor cycles, scooters and other mopeds", life: 10, line: "ppe"},
    {k: "mv_car", head: "VI. Motor Vehicles", name: "Motor vehicles other than those used in a business of running them on hire", life: 8, line: "ppe"},
    {k: "mv_hire", head: "VI. Motor Vehicles", name: "Motor buses, lorries, cars and taxis used in a business of running them on hire", life: 6, line: "ppe"},
    {k: "office", head: "X. Office equipment", name: "Office equipment", life: 5, line: "ppe"},
    {k: "computer_eud", head: "XI. Computers and data processing units", name: "Computers: end user devices (desktops, laptops and the like)", life: 3, line: "ppe"},
    {k: "computer_server", head: "XI. Computers and data processing units", name: "Computers: servers and networks", life: 6, line: "ppe"},
    {k: "lab", head: "XII. Laboratory equipment", name: "Laboratory equipment (general)", life: 10, line: "ppe"},
    {k: "electrical", head: "XIII. Electrical installations and equipment", name: "Electrical installations and equipment", life: 10, line: "ppe"},
    {k: "land", head: "Land", name: "Land (not depreciated)", life: null, line: "ppe", noDep: true},
    {k: "intang_software", head: "Intangible assets (AS 26)", name: "Computer software", life: null, line: "intang"},
    {k: "intang_other", head: "Intangible assets (AS 26)", name: "Other intangible assets (trademarks, patents, licences)", life: null, line: "intang"},
    {k: "cwip", head: "Capital work-in-progress", name: "Capital work-in-progress (not depreciated)", life: null, line: "cwip", noDep: true},
  ];
  X.cls = k => X.SCH2.find(c => c.k === k) || null;
  X.IT_SOURCE = "Income-tax Rules, 1962, Appendix I (rule 5), rates from assessment year 2018-19; section 32(1)(ii) with its second proviso (half the rate on an asset put to use for less than 180 days in the year); section 32(1)(iia) (additional depreciation on new plant and machinery, half for less than 180 days, the other half the next year); section 50 (a block's short-term capital gain or loss).";
  X.IT = [
    {k: "bldg5", name: "Buildings, residential (5%)", rate: 5},
    {k: "bldg10", name: "Buildings, other than residential (10%)", rate: 10},
    {k: "bldg40", name: "Buildings, purely temporary erections (40%)", rate: 40},
    {k: "ff10", name: "Furniture and fittings, including electrical fittings (10%)", rate: 10},
    {k: "pm15", name: "Plant and machinery, general, including motor cars (15%)", rate: 15},
    {k: "pm30", name: "Motor buses, lorries and taxis used in a business of running them on hire (30%)", rate: 30},
    {k: "pm40", name: "Computers including computer software (40%)", rate: 40},
    {k: "int25", name: "Intangible assets: know-how, patents, copyrights, trademarks, licences, franchises (25%)", rate: 25},
    {k: "none", name: "Not depreciable (land; goodwill from AY 2021-22)", rate: 0},
  ];
  X.block = k => X.IT.find(b => b.k === k) || (/^r\d/.test(String(k || "")) ? {k, name: "Block at " + k.slice(1) + "% (from the books' group)", rate: Number(k.slice(1)), custom: true} : null);
  // The rules and defaults of this file (docs/depreciation.md, the ten points: the Schedule II list, residual 5% and nil for
  // intangibles, WDV by default with straight line for intangibles, old assets over the remaining life, days counted
  // inclusive, block-level accumulated depreciation spread by cost, a sale taking the whole asset, the section 32 working,
  // additional depreciation, the deferred tax rates, the block's opening): approved by the owner on 14-Oct-2026.
  X.DEFAULTS = {method: "WDV", residualPct: 5, addl: false, addlRate: 20, dtRate: null, dtStd: "AS 22"};

  // ------------------------------------------------------------ proposing from the names
  // [pattern, Schedule II class, income-tax block, sure, why]: the first that matches the ledger's name, else its groups'
  const RULES = [
    [/capital\s*work|\bc\.?\s*w\.?\s*i\.?\s*p\b|work[\s-]*in[\s-]*progress/i, "cwip", "none", false, "capital work-in-progress: not depreciated until put to use"],
    [/\bland\b/i, "land", "none", true, "land is not depreciated"],
    [/goodwill/i, "intang_other", "none", false, "goodwill: no tax depreciation from AY 2021-22; its useful life in the books is to be given"],
    [/software|\berp\b|licen[cs]e|website|\bapps?\b/i, "intang_software", "pm40", false, "software: computers block (40%) for tax; its useful life in the books (AS 26) is to be given"],
    [/trade\s*marks?|patents?|copy\s*rights?|know[\s-]*how|franchise|intangible|\bbrand/i, "intang_other", "int25", false, "an intangible asset: its useful life in the books (AS 26) is to be given"],
    [/residential|staff\s*quarters?|\bflats?\b|\bhouse\b/i, "bldg_rcc", "bldg5", false, "a residential building: 5% block; RCC frame structure (60 years) assumed"],
    [/factory\s*(building|shed)|\bsheds?\b|godown|warehouse/i, "bldg_factory", "bldg10", true, "a factory building"],
    [/building|premises|office\s*space|construction|civil\s*work/i, "bldg_rcc", "bldg10", false, "a building: RCC frame structure (60 years) and non-residential assumed"],
    [/\bservers?\b|network|router|\bswitch\b|firewall|\bnas\b/i, "computer_server", "pm40", true, "a server or network"],
    [/computer|laptop|desktop|printer|scanner|\bups\b|monitor|\bcpu\b|notebook|tablet|ipad|macbook/i, "computer_eud", "pm40", true, "a computer (end user device)"],
    [/\btaxis?\b|\bcabs?\b|on\s*hire/i, "mv_hire", "pm30", false, "a vehicle used on hire"],
    [/scooter|scooty|motor\s*cycle|motorbike|\bbikes?\b|activa|moped|two[\s-]*wheeler/i, "mv_2w", "pm15", true, "a two-wheeler"],
    [/vehicle|\bcars?\b|motor\s*car|truck|lorry|tempo|\bbus\b|tractor|innova|swift|ertiga|creta|fortuner|scorpio|bolero|\bxuv|verna|wagon|maruti|toyota|hyundai|mahindra/i, "mv_car", "pm15", true, "a motor vehicle (not on hire)"],
    [/furniture|fixture|almirah|\bchairs?\b|\btables?\b|sofa|cupboard|cabinet|interior|partition|workstation|\bracks?\b|counter/i, "furniture", "ff10", true, "furniture and fittings"],
    [/laborator|\blab\b/i, "lab", "pm15", true, "laboratory equipment"],
    [/generator|\bd\.?\s*g\.?\s*set|transformer/i, "electrical", "pm15", false, "a generator: electrical installations (10 years) in the books, plant and machinery (15%) for tax"],
    [/electric|wiring|\blights?\b|\bfans?\b|inverter|stabili[sz]er|cabl(e|ing)/i, "electrical", "ff10", true, "electrical installations (electrical fittings: furniture and fittings block for tax)"],
    [/\ba\.?\s?c\b|air\s*condition|\bsplit\b|refrigerator|fridge|\btv\b|television|mobile|i?phone|camera|cctv|xerox|photo\s*copier|\bfax\b|water\s*(cooler|purifier|dispenser)|\bro\b|projector|epabx|biometric|attendance|microwave|\boven\b|cooler|office\s*equipment|appliance/i, "office", "pm15", true, "office equipment"],
    [/machine|machinery|machionary|machinary|plant|\bp\s*&\s*m\b|\btools?\b|mou?lds?\b|\bdies?\b|compressor|pump|lathe|boiler|crane|fork\s*lift|conveyor|weigh|equipment/i, "pm_general", "pm15", true, "plant and machinery"],
  ];
  const rateIn = s => { const m = /(\d{1,2}(?:\.\d+)?)\s*%/.exec(String(s || "")); return m ? Number(m[1]) : null; };
  // the block for a rate found in the books' names, within the class's family where two blocks share a rate
  const blockForRate = (rate, cls) => {
    const bld = /^bldg/.test(cls || "");
    const hit = X.IT.filter(b => b.rate === rate && b.k !== "none");
    if (!hit.length) return "r" + rate;
    if (hit.length === 1) return hit[0].k;
    return (hit.find(b => bld ? /^bldg/.test(b.k) : !/^bldg/.test(b.k)) || hit[0]).k;
  };
  X.classify = function(ledger, groups){
    const names = [ledger].concat((groups || []).filter(g => !/^fixed assets$/i.test(String(g).trim())));
    let rule = null, from = null;
    for (const n of names){ rule = RULES.find(r => r[0].test(n)); if (rule){ from = n; break; } }
    const rate = names.map(rateIn).find(r => r != null), rateFrom = names.find(n => rateIn(n) != null);
    const out = {cls: rule ? rule[1] : null, clsSure: !!(rule && rule[3]), clsWhy: rule ? rule[4] + " (from " + (from === ledger ? "the ledger's name" : "the group “" + from + "”") + ")" : "no rule matches the name or the group: choose the class"};
    if (rate != null){
      const bk = blockForRate(rate, out.cls), usual = rule ? X.block(rule[2]) : null;
      out.block = bk;
      out.blockSure = !!(rule && usual && usual.rate === rate) && !X.block(bk).custom;
      out.blockWhy = "the rate " + rate + "% in “" + rateFrom + "”" + (usual && usual.rate !== rate ? "; the usual block for " + X.cls(out.cls).name.toLowerCase() + " is " + usual.rate + "%" : "");
    } else if (rule){ out.block = rule[2]; out.blockSure = rule[3]; out.blockWhy = rule[4]; }
    else { out.block = null; out.blockSure = false; out.blockWhy = "no rule: choose the block"; }
    return out;
  };
  // an accumulated-depreciation ledger: never an asset
  X.isAccDep = l => /\bdep(n|r|reciation|\.|\b)|amorti[sz]/i.test(String(l || ""));
  const SYN = {"p&m": "pm", plant: "pm", machinery: "pm", machionary: "pm", machinary: "pm", machine: "pm", "f&f": "ff", furniture: "ff", fixture: "ff", fitting: "ff",
    computers: "computer", laptops: "laptop", vehicles: "vehicle", cars: "car", buildings: "building", equipments: "equipment", intangibles: "intangible"};
  const STOP = new Set(["accumulated", "accum", "acc", "aggregate", "provision", "prov", "for", "on", "of", "the", "dep", "depn", "depr", "depreciation", "amortisation", "amortization", "fund", "reserve", "a", "c", "ac", "account", "upto", "till", "to", "date", "and", "&"]);
  const norm = t => { t = SYN[t] || t; if (!SYN[t] && t.length > 3 && /s$/.test(t) && !/ss$/.test(t)) t = t.slice(0, -1); return SYN[t] || t; };
  const toks = s => String(s || "").toLowerCase().replace(/@?\s*\d+(\.\d+)?\s*%/g, " ").replace(/p\s*&\s*m/g, "p&m").replace(/f\s*&\s*f/g, "f&f").split(/[^a-z0-9&]+/).filter(Boolean).map(norm);
  const FAMILY = {pm_general: "pm", pm_cpp: "pm", office: "pm", lab: "pm", electrical: "electrical", furniture: "ff", furniture_hotel: "ff", computer_eud: "computer", computer_server: "computer",
    mv_2w: "vehicle", mv_car: "vehicle", mv_hire: "vehicle", bldg_rcc: "building", bldg_nonrcc: "building", bldg_factory: "building", intang_software: "intangible", intang_other: "intangible"};
  // a name's match among the assets (one asset) or their groups (a block); null when not one
  X.matchAccDep = function(ledger, assets){
    const rest = toks(ledger).filter(t => !STOP.has(t)), rate = rateIn(ledger);
    const live = assets.filter(a => !a.manual);
    if (!rest.length) return live.length ? {kind: "all", why: "a general accumulated-depreciation ledger: spread over every asset in proportion to cost"} : null;
    // one asset: the name holds every word of the asset's own name that says which one it is ("Car", "HP Laptop"), not
    // only a kind of asset ("P&M", "Computers": those name a block)
    const GENERIC = new Set(["pm", "ff", "computer", "laptop", "vehicle", "building", "equipment", "asset", "intangible", "office", "electrical"]);
    const one = live.filter(a => { const at = toks(a.ledger), o2 = at.filter(t => !GENERIC.has(t)), own = o2.length ? o2 : at; return rest.every(t => at.includes(t)) && own.every(t => rest.includes(t)); });
    if (one.length === 1) return {kind: "asset", id: one[0].id, why: "the name matches the asset “" + one[0].ledger + "”"};
    const groups = Array.from(new Set(live.map(a => a.group).filter(Boolean)));
    const gHit = groups.filter(g => {
      const gt = new Set(toks(g)), mem = live.filter(a => a.group === g);
      mem.forEach(a => { if (FAMILY[a.cls]) gt.add(FAMILY[a.cls]); toks(a.ledger).forEach(t => gt.add(t)); });
      const gr = rateIn(g);
      return rest.every(t => gt.has(t)) && (rate == null || gr == null || gr === rate);
    });
    if (gHit.length === 1) return {kind: "group", group: gHit[0], why: "the name matches the group “" + gHit[0] + "”" + (rate != null ? " (" + rate + "%)" : "")};
    return null;
  };

  // ------------------------------------------------------------ the register proposed from the books
  // input: {fy, ledgers: [{l, path: [parent, ..., "Fixed Assets"], open (Dr positive, at the start of the year)}],
  //         vouchers: [{id, date: YYYY-MM-DD, no, type, ent: [{l, a (Dr positive)}]}] of the year, isDepExpense(l)}
  X.propose = function(input){
    const fy = String(input.fy), D = X.fyDates(fy), led = input.ledgers || [];
    const accL = led.filter(x => X.isAccDep(x.l)), assetL = led.filter(x => !X.isAccDep(x.l));
    const isAsset = new Set(assetL.map(x => x.l)), isAcc = new Set(accL.map(x => x.l));
    // a depreciation (expense) ledger: never one under Fixed Assets
    const isDepExp = l => !isAsset.has(l) && !isAcc.has(l) && (input.isDepExpense ? input.isDepExpense(l) : /depreciation|amorti[sz]/i.test(l));
    const assets = assetL.map(x => {
      const groups = (x.path || []).slice(0, -1), c = X.classify(x.l, groups);
      return {id: "L:" + x.l, ledger: x.l, group: groups[0] || "", groups, cls: c.cls, clsSure: c.clsSure, clsWhy: c.clsWhy, life: null, lifeWhy: "", residualPct: null, method: null,
        block: c.block, blockSure: c.blockSure, blockWhy: c.blockWhy, putToUse: null, remLife: null, bookOpen: r2(x.open), bookDr: 0, bookCr: 0, adds: [], moves: [], bookedDep: 0, addlEligible: null, override: null};
    });
    const byL = Object.fromEntries(assets.map(a => [a.id.slice(2), a]));
    const accDep = accL.map(x => ({ledger: x.l, open: r2(-x.open), match: X.matchAccDep(x.l, assets), booked: 0, group: (x.path || [])[0] || ""}));
    const accBy = Object.fromEntries(accDep.map(a => [a.ledger, a]));
    (input.vouchers || []).filter(v => v.date >= D.from && v.date <= D.to).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).forEach(v => {
      v.ent.forEach((e, n) => {
        // the other side of the entry: for a credit, the ledgers debited; for a debit, those credited (one journal can
        // credit two assets with the year's depreciation: that is no transfer between them)
        const others = v.ent.filter((z, j) => j !== n && (e.a < 0 ? z.a > 0 : z.a < 0)).map(z => z.l), key = (v.id || v.no + "@" + v.date) + "|" + n;
        const cDep = others.some(isDepExp) && !others.some(l => isAsset.has(l)), cFA = others.some(l => isAsset.has(l)), cAcc = others.some(l => isAcc.has(l)), cGL = others.some(l => /(profit|loss|gain)\b.*\b(sale|asset|disposal|discard)|(sale|disposal|discard).*\b(profit|loss|gain)/i.test(l));
        if (isAcc.has(e.l)){ if (e.a < 0 && others.some(isDepExp)) accBy[e.l].booked = r2(accBy[e.l].booked - e.a); return; }
        const a = byL[e.l]; if (!a) return;
        const m = {key, date: v.date, vno: v.no || "", vtype: v.type || "", amount: r2(Math.abs(e.a)), with: others.slice(0, 3).join(", ")};
        if (e.a > 0){
          a.bookDr = r2(a.bookDr + e.a);
          const kind = cDep || cAcc || cGL ? "ignore" : cFA ? "transfer" : "add";
          a.adds.push(Object.assign(m, {kind, putToUse: v.date, sure: kind === "add", why: kind === "add" ? "a debit to the asset: an addition" : kind === "transfer" ? "from another asset ledger: a transfer" : "a debit from " + (cDep ? "depreciation" : cAcc ? "accumulated depreciation" : "a gain or loss") + ": not an addition"}));
        } else if (e.a < 0){
          a.bookCr = r2(a.bookCr - e.a);
          const kind = cDep ? "dep" : cAcc || cGL ? "ignore" : cFA ? "transfer" : "sale";
          if (kind === "dep") a.bookedDep = r2(a.bookedDep - e.a);
          a.moves.push(Object.assign(m, {kind, sale: kind === "sale" ? m.amount : null, costPart: null, sure: kind === "dep" || kind === "ignore",
            why: kind === "dep" ? "credited from a depreciation ledger: depreciation booked to the asset, not a sale" : kind === "ignore" ? "taken off against " + (cAcc ? "accumulated depreciation" : "a gain or loss") + " on a disposal" : kind === "transfer" ? "to another asset ledger: a transfer" : "a credit to the asset: sold (the voucher's amount is the sale value)"}));
        }
      });
    });
    const out = {v: X.V, fy, settings: {}, assets, accDep, blocks: {}, ok: {}, depLedger: input.depLedger || null, kind: input.kind || "company", at: input.at || ""};
    return out;
  };
  // a new proposal with what the person changed in the saved register kept
  const USER = ["cls", "clsSure", "life", "lifeWhy", "residualPct", "method", "block", "blockSure", "putToUse", "remLife", "addlEligible", "override", "typedOpen", "openGross", "openAcc", "name", "note"];
  X.merge = function(saved, fresh){
    if (!saved) return fresh;
    const out = Object.assign({}, fresh, {settings: Object.assign({}, saved.settings || {}), blocks: Object.assign({}, saved.blocks || {}), ok: Object.assign({}, saved.ok || {}), depLedger: saved.depLedger || fresh.depLedger});
    const sv = Object.fromEntries((saved.assets || []).map(a => [a.id, a])), seen = new Set();
    out.assets = fresh.assets.map(a => {
      const s = sv[a.id]; seen.add(a.id); if (!s) return a;
      const o = Object.assign({}, a); USER.forEach(k => { if (s[k] !== undefined) o[k] = s[k]; });
      const keep = (list, old, ks) => list.map(x => { const p = (old || []).find(z => z.key === x.key); if (!p) return x; const y = Object.assign({}, x); ks.forEach(k => { if (p[k] !== undefined) y[k] = p[k]; }); return y; });
      o.adds = keep(a.adds, s.adds, ["putToUse", "kind", "sure", "addlEligible"]);
      o.moves = keep(a.moves, s.moves, ["kind", "sale", "costPart", "sure"]);
      return o;
    });
    (saved.assets || []).forEach(a => { if (!seen.has(a.id)) out.assets.push(a.manual ? a : Object.assign({}, a, {gone: true})); });
    const sa = Object.fromEntries((saved.accDep || []).map(a => [a.ledger, a]));
    out.accDep = fresh.accDep.map(a => sa[a.ledger] && sa[a.ledger].byHand ? Object.assign({}, a, {match: sa[a.ledger].match, byHand: true}) : a);
    return out;
  };

  // ------------------------------------------------------------ Companies Act, one asset
  // a component's depreciation from its start in the year to `until` (a day number): SLM (carrying - residual) over the
  // remaining life, WDV at 1 - (residual / carrying) ^ (1 / remaining life), pro-rata by days; never below the residual
  const depOf = (c, until, D, method) => {
    const start = Math.max(D.s, c.put ? dnum(c.put) : D.s), d = Math.max(0, until - start + 1);
    const C = c.cost - c.acc, R = c.res, base = C - R;
    if (!d || base <= 0 || !(c.rem > 0)) return 0;
    if (c.rem * D.diy <= d) return base;                               // the life ends within the days used: down to the residual
    if (method === "SLM") return base / c.rem * d / D.diy;
    if (C <= 0) return 0;
    const rate = 1 - Math.pow(Math.max(R, 0) / C, 1 / c.rem);
    return Math.min(base, C * rate * d / D.diy);
  };
  const usedYears = (c, D) => { const start = Math.max(D.s, c.put ? dnum(c.put) : D.s); return Math.max(0, D.e - start + 1) / D.diy; };
  X.assetCalc = function(a, set, D, prevA, accOpen){
    const cls = X.cls(a.cls), life = a.life != null && a.life !== "" ? num(a.life) : cls ? cls.life : null;
    const resPct = a.residualPct != null && a.residualPct !== "" ? num(a.residualPct) : cls && cls.line === "intang" ? 0 : num(set.residualPct);
    const method = a.method || (cls && cls.line === "intang" ? "SLM" : set.method), noDep = !cls || cls.noDep || !(life > 0);
    const flags = [];
    let comps;
    if (prevA && !a.typedOpen) comps = prevA.closeComps.map(c => Object.assign({}, c, {open: true, rem: a.remLife != null && a.remLife !== "" ? num(a.remLife) : c.rem}));
    else {
      const G0 = r2(a.typedOpen ? a.openGross : a.bookOpen), A0 = r2(a.typedOpen ? a.openAcc : accOpen || 0);
      let rem = life || 0;
      if (a.remLife != null && a.remLife !== "") rem = num(a.remLife);
      else if (a.putToUse && dnum(a.putToUse) < D.s) rem = Math.max(0, (life || 0) - X.yearsBetween(a.putToUse, D.from));
      else if (G0 && !noDep) flags.push("rem");
      comps = G0 ? [{cost: G0, acc: A0, put: a.putToUse && dnum(a.putToUse) < D.s ? a.putToUse : null, rem, open: true}] : [];
    }
    comps.forEach(c => { c.res = c.cost * resPct / 100; });
    const adds = (a.adds || []).filter(x => (x.kind === "add" || x.kind === "transfer") && x.date >= D.from && x.date <= D.to);
    adds.forEach(x => { const put = x.putToUse || x.date; comps.push({cost: r2(x.amount), acc: 0, put, rem: life || 0, res: r2(x.amount) * resPct / 100, open: false, key: x.key, idle: dnum(put) > D.e}); if (dnum(put) > D.e) flags.push("idle"); });
    const total = sum(comps, c => c.cost);
    // the disposals in date order; each takes a share of the asset (its cost part, else what is left)
    let left = 1;
    const sales = (a.moves || []).filter(x => ["sale", "scrap", "transfer"].includes(x.kind) && x.date >= D.from && x.date <= D.to).map(x => {
      const f = Math.max(0, Math.min(left, x.costPart != null && x.costPart !== "" && total ? num(x.costPart) / total : left)); left -= f;
      return {m: x, f};
    });
    const dep = (c, until) => noDep || c.idle ? 0 : depOf(c, until, D, method);
    const parts = [];
    sales.forEach((s, i) => comps.forEach((c, j) => parts.push({sale: i, comp: j, v: r2(s.f * dep(c, dnum(s.m.date)))})));
    comps.forEach((c, j) => parts.push({sale: -1, comp: j, v: r2(left * dep(c, D.e))}));
    const computed = r2(sum(parts, p => p.v));
    let depYear = computed;
    if (a.override && a.override.dep != null && a.override.dep !== ""){
      depYear = r2(a.override.dep);
      if (computed > 0){ parts.forEach(p => { p.v = r2(p.v * depYear / computed); }); const diff = r2(depYear - sum(parts, p => p.v)); if (diff){ const big = parts.reduce((b, p) => Math.abs(p.v) > Math.abs(b.v) ? p : b, parts[0]); big.v = r2(big.v + diff); } }
      else { parts.forEach(p => { p.v = 0; }); const k = parts.find(p => p.sale === -1) || parts[0]; if (k) k.v = depYear; }
    }
    const gOpen = r2(sum(comps.filter(c => c.open), c => c.cost)), gAdd = r2(sum(comps.filter(c => !c.open), c => c.cost));
    const dOpen = r2(sum(comps.filter(c => c.open), c => c.acc));
    const saleOut = sales.map((s, i) => {
      const cost = r2(s.f * total), accAt = r2(s.f * sum(comps, c => c.acc)), depTo = r2(sum(parts.filter(p => p.sale === i), p => p.v));
      const carrying = r2(cost - accAt - depTo), value = s.m.kind === "transfer" ? carrying : r2(s.m.sale != null && s.m.sale !== "" ? s.m.sale : s.m.amount);
      return {key: s.m.key, date: s.m.date, kind: s.m.kind, share: s.f, cost, accAt, depTo, dDel: r2(accAt + depTo), carrying, value, gain: r2(value - carrying)};
    });
    const gDel = r2(sum(saleOut, s => s.cost)), dDel = r2(sum(saleOut, s => s.dDel));
    const gClose = r2(gOpen + gAdd - gDel), dClose = r2(dOpen + depYear - dDel);
    // what is carried to next year, component by component (the share kept)
    const closeComps = left > 1e-9 ? comps.map((c, j) => ({cost: r2(left * c.cost), acc: r2(left * c.acc + (parts.find(p => p.sale === -1 && p.comp === j) || {v: 0}).v), put: c.put || null,
      rem: Math.max(0, (c.rem || 0) - (c.idle ? 0 : usedYears(c, D)))})) : [];
    if (cls && cls.line === "intang" && !(life > 0)) flags.push("life");
    return {id: a.id, ledger: a.ledger, name: a.name || a.ledger, cls: a.cls, clsName: cls ? cls.name : "(class to be chosen)", line: cls ? cls.line : "ppe", life, resPct, method, block: a.block,
      putToUse: a.putToUse || (adds[0] && (adds[0].putToUse || adds[0].date)) || null, gOpen, gAdd, gDel, gClose, dOpen, dep: depYear, computed, override: a.override && a.override.dep != null && a.override.dep !== "" ? a.override : null,
      dDel, dClose, nOpen: r2(gOpen - dOpen), nClose: r2(gClose - dClose), sales: saleOut, gone: left <= 1e-9 && (gOpen + gAdd) > 0, closeComps, flags, noDep};
  };

  // ------------------------------------------------------------ the year: every asset, the classes, the blocks
  X.compute = function(reg, prev, o){
    o = o || {};
    const fy = String(reg.fy), D = X.fyDates(fy), set = Object.assign({}, X.DEFAULTS, reg.settings || {});
    const pr = prev && String(prev.fy) === String(Number(fy) - 1) ? X.compute(prev, null, {inner: true}) : null;
    const prA = pr ? Object.fromEntries(pr.assets.map(a => [a.id, a])) : {};
    const list = (reg.assets || []).filter(a => !a.gone || (a.adds || []).length || (a.moves || []).length || prA[a.id]);
    // the opening accumulated depreciation of each asset from the accumulated-depreciation ledgers (per asset, or a block's
    // spread over its assets in proportion to their opening cost; the last asset takes the paise left)
    const accOpen = {}, accOf = {};
    const spread = (ad, members) => {
      const live = members.filter(a => r2(a.bookOpen) > 0), tot = sum(live, a => r2(a.bookOpen));
      if (!tot) return;
      let left = r2(ad.open); live.sort((a, b) => r2(a.bookOpen) - r2(b.bookOpen));
      live.forEach((a, i) => { const v = i === live.length - 1 ? left : r2(ad.open * r2(a.bookOpen) / tot); left = r2(left - v); accOpen[a.id] = r2((accOpen[a.id] || 0) + v); accOf[a.id] = accOf[a.id] || ad.ledger; });
    };
    const own = new Set((reg.accDep || []).filter(x => x.match && x.match.kind === "asset").map(x => x.match.id));
    (reg.accDep || []).forEach(ad => {
      const m = ad.match; if (!m) return;
      if (m.kind === "asset"){ accOpen[m.id] = r2((accOpen[m.id] || 0) + r2(ad.open)); accOf[m.id] = ad.ledger; }
      else if (m.kind === "group") spread(ad, list.filter(a => a.group === m.group && !own.has(a.id) && !/^(land|cwip)$/.test(a.cls || "")));
      else if (m.kind === "all") spread(ad, list.filter(a => !own.has(a.id) && !/^(land|cwip)$/.test(a.cls || "")));
    });
    const assets = list.map(a => Object.assign(X.assetCalc(a, set, D, prA[a.id], accOpen[a.id]), {accLedger: accOf[a.id] || null, accOpenBooks: accOpen[a.id] || 0}));
    // the classes (det.far rows): one per Schedule II class, in the table's order
    const classes = [];
    X.SCH2.concat([{k: null, name: "(class to be chosen)", line: "ppe"}]).forEach(c => {
      const m = assets.filter(a => (a.cls || null) === c.k); if (!m.length) return;
      const t = k => r2(sum(m, a => a[k]));
      classes.push({cls: c.name, k: c.k, line: c.line, gOpen: t("gOpen"), gAdd: t("gAdd"), gDel: t("gDel"), gClose: t("gClose"), dOpen: t("dOpen"), dYear: t("dep"), dDel: t("dDel"), dClose: t("dClose"), nOpen: t("nOpen"), nClose: t("nClose"), n: m.length});
    });
    // the income-tax blocks (section 32)
    const blocks = [], bks = Array.from(new Set(list.map(a => a.block || null)));
    X.IT.map(b => b.k).concat(bks.filter(k => k && !X.IT.some(b => b.k === k)).sort()).concat(bks.includes(null) ? [null] : []).forEach(k => {
      if (!bks.includes(k) && !(reg.blocks || {})[k]) return;
      // only the blocks of section 32: not land or goodwill ("none"), not an asset with no block chosen yet (Confirm list)
      const bk = k ? X.block(k) : null; if (!bk || !(bk.rate > 0)) return;
      const typed = (reg.blocks || {})[k || "-"] || {};
      const mem = list.filter(a => (a.block || null) === k), memC = assets.filter(a => (a.block || null) === k);
      const pb = pr ? pr.blocks.find(z => z.k === k) : null;
      const openFrom = pr ? "last year's closing in FinCom" : typed.open != null && typed.open !== "" ? "typed" : null;
      const openP = P(pr ? (pb ? pb.close : 0) : typed.open);
      let a1 = 0, a2 = 0, e1 = 0, e2 = 0, sale = 0, idle = 0;
      const addRows = [];
      mem.forEach(a => {
        const c = X.cls(a.cls), elig = set.addl && (a.addlEligible != null ? !!a.addlEligible : !!(c && /^pm_(general|cpp)$/.test(c.k)));
        (a.adds || []).filter(x => x.kind === "add" && x.date >= D.from && x.date <= D.to).forEach(x => {
          const put = x.putToUse || x.date, days = D.e - dnum(put) + 1, amt = P(x.amount);
          if (dnum(put) > D.e){ idle += amt; return; }
          const full = days >= 180;
          if (full) a1 += amt; else a2 += amt;
          const el = elig && (x.addlEligible != null ? !!x.addlEligible : true);
          if (el){ if (full) e1 += amt; else e2 += amt; }
          addRows.push({asset: a.ledger, date: x.date, putToUse: put, days, amount: amt / 100, half: !full, addl: el});
        });
        (a.moves || []).filter(x => (x.kind === "sale" || x.kind === "scrap") && x.date >= D.from && x.date <= D.to).forEach(x => { sale += P(x.sale != null && x.sale !== "" ? x.sale : x.amount); });
      });
      const empty = typed.empty != null ? !!typed.empty : memC.length > 0 && memC.every(a => a.gone);
      const rate = bk.rate || 0, ar = set.addl ? num(set.addlRate) : 0;
      const bfP = P(pr ? (pb ? pb.addlCarry : 0) : typed.addlBf);
      const base = openP + a1 + a2 - sale, s1 = openP + a1 - sale;
      let dep = 0, addl = 0, stcg = 0, close, carry = 0;
      if (base < 0){ stcg = base; close = 0; }
      else if (empty && base > 0){ stcg = base; close = 0; }
      else if (empty){ close = 0; }
      else {
        dep = R0p(Math.max(0, s1) * rate / 100 + Math.max(0, a2 + Math.min(0, s1)) * rate / 200);
        addl = Math.max(0, Math.min(base - dep, R0p(e1 * ar / 100 + e2 * ar / 200) + bfP));
        carry = R0p(e2 * ar / 200);
        close = base - dep - addl;
      }
      blocks.push({k, name: bk.name, rate, open: openP / 100, openFrom, addGt180: a1 / 100, addLt180: a2 / 100, sale: sale / 100, stcg: stcg / 100, empty, dep: dep / 100, addlRate: ar, addlGt180: e1 / 100, addlLt180: e2 / 100,
        addlBf: bfP / 100, addl: addl / 100, addlCarry: carry / 100, close: close / 100, idle: idle / 100, adds: addRows, assets: mem.map(a => a.ledger)});
    });
    // deferred tax: the books' carrying amount of the depreciable assets against the blocks' written down value
    const dtRate = set.dtRate != null && set.dtRate !== "" ? num(set.dtRate) : (reg.kind || "company") === "company" ? 25.168 : 31.2;
    const inDt = a => a.block && (X.block(a.block) || {}).rate > 0 && !/^(land|cwip)$/.test(a.cls || "");
    const bookO = r2(sum(assets.filter(inDt), a => a.nOpen)), bookC = r2(sum(assets.filter(inDt), a => a.nClose));
    const taxO = r2(sum(blocks, b => b.open)), taxC = r2(sum(blocks, b => b.close));
    const dOpen = r2(bookO - taxO), dClose = r2(bookC - taxC), dtO = r2(dOpen * dtRate / 100), dtC = r2(dClose * dtRate / 100);
    const dt = {rate: dtRate, rateGiven: set.dtRate != null && set.dtRate !== "", std: set.dtStd, bookOpen: bookO, bookClose: bookC, taxOpen: taxO, taxClose: taxC, diffOpen: dOpen, diffClose: dClose, open: dtO, close: dtC, move: r2(dtC - dtO)};
    // the suggested journal entry for the year's depreciation in the books: the year's charge less what is booked already
    const tgt = {};
    const T = (l, kind) => (tgt[l] = tgt[l] || {ledger: l, kind, charge: 0, booked: 0});
    assets.forEach(a => { if (!a.dep) return; T(a.accLedger || a.ledger, a.accLedger ? "accumulated depreciation" : "the asset (no accumulated-depreciation ledger)").charge += a.dep; });
    (reg.accDep || []).forEach(x => { if (x.booked) T(x.ledger, "accumulated depreciation").booked += num(x.booked); });
    list.forEach(a => { if (a.bookedDep) T(a.ledger, "the asset (no accumulated-depreciation ledger)").booked += num(a.bookedDep); });
    const lines = Object.values(tgt).map(t => Object.assign(t, {charge: r2(t.charge), booked: r2(t.booked), net: r2(t.charge - t.booked)})).filter(t => t.net).sort((a, b) => a.ledger.localeCompare(b.ledger));
    const depL = reg.depLedger || "Depreciation and amortisation expense", jeTot = r2(sum(lines, t => t.net));
    const je = {ledger: depL, lines: [{ledger: depL, dr: jeTot > 0 ? jeTot : 0, cr: jeTot < 0 ? -jeTot : 0}].concat(lines.map(t => ({ledger: t.ledger, dr: t.net < 0 ? -t.net : 0, cr: t.net > 0 ? t.net : 0, kind: t.kind}))).filter(l => l.dr || l.cr),
      charge: r2(sum(assets, a => a.dep)), booked: r2(sum(Object.values(tgt), t => t.booked)), total: jeTot, date: D.to, posted: false};
    const res = {fy, D, settings: set, kind: reg.kind || "company", assets, classes, blocks, dt, je, prev: pr, hasPrev: !!pr,
      totals: {gOpen: r2(sum(classes, c => c.gOpen)), gAdd: r2(sum(classes, c => c.gAdd)), gDel: r2(sum(classes, c => c.gDel)), gClose: r2(sum(classes, c => c.gClose)), dOpen: r2(sum(classes, c => c.dOpen)), dep: r2(sum(classes, c => c.dYear)), dDel: r2(sum(classes, c => c.dDel)), dClose: r2(sum(classes, c => c.dClose)), nClose: r2(sum(classes, c => c.nClose)),
        itDep: r2(sum(blocks, b => b.dep)), itAddl: r2(sum(blocks, b => b.addl)), itClose: r2(sum(blocks, b => b.close)), gain: r2(sum(assets, a => sum(a.sales, s => s.gain)))}};
    // the statements' inputs: det.far (Companies Act, by class) and det.itBlocks (income-tax blocks)
    res.far = classes.map(c => ({cls: c.cls, line: c.line, gOpen: c.gOpen, gAdd: c.gAdd, gDel: c.gDel, dOpen: c.dOpen, dYear: c.dYear, dDel: c.dDel, fromRegister: true}));
    res.itRows = blocks.map(b => ({block: b.name, rate: b.rate, open: b.open, addGt180: b.addGt180, addLt180: b.addLt180, sale: b.sale, stcg: b.stcg, addlRate: b.addlRate,
      addlGt180: b.addlGt180, addlLt180: b.addlLt180, addlBf: b.addlBf, fromRegister: true}));
    res.rows3cd = blocks.map(b => [b.name, b.rate, b.open, r2(b.addGt180 + b.addLt180), b.sale, r2(b.dep + b.addl), b.close]);
    if (!o.inner) res.confirm = X.confirmList(reg, res);
    return res;
  };

  // ------------------------------------------------------------ what a person is to confirm
  X.confirmList = function(reg, res){
    const ok = reg.ok || {}, out = [], set = Object.assign({}, X.DEFAULTS, reg.settings || {});
    const amt = v => "\u20b9" + inr(v), dmy = d => String(d || "").split("-").reverse().join("-");
    const add = (key, text, o) => { if (!ok[key]) out.push(Object.assign({key, text}, o || {})); };
    if (!ok.settings) add("settings", "The client's defaults: " + (set.method === "SLM" ? "straight line" : "written down value") + " method, residual value " + set.residualPct + "% of cost, additional depreciation " + (set.addl ? "on (" + set.addlRate + "%)" : "off") + ".", {kind: "settings"});
    const R = Object.fromEntries(res.assets.map(a => [a.id, a]));
    (reg.assets || []).forEach(a => {
      const c = R[a.id]; if (!c) return;
      const nm = a.name || a.ledger;
      if (!a.cls) out.push({key: "need:cls:" + a.id, text: nm + ": choose its Schedule II class (" + (a.clsWhy || "no rule matches") + ").", asset: a.id, kind: "need"});
      else if (!a.clsSure) add("cls:" + a.id, nm + ": " + (X.cls(a.cls) || {}).name + ", " + c.life + " years? (" + a.clsWhy + ")", {asset: a.id, kind: "cls"});
      if (!a.block) out.push({key: "need:block:" + a.id, text: nm + ": choose its income-tax block.", asset: a.id, kind: "need"});
      else if (!a.blockSure) add("block:" + a.id, nm + ": income-tax block " + (X.block(a.block) || {}).name + "? (" + a.blockWhy + ")", {asset: a.id, kind: "block"});
      if (c.flags.includes("life")) out.push({key: "need:life:" + a.id, text: nm + ": give its useful life in years (an intangible asset: AS 26 / Ind AS 38, not in Schedule II).", asset: a.id, kind: "need"});
      if (c.flags.includes("rem")) add("rem:" + a.id, nm + ": no put-to-use date or remaining life; the remaining life is taken as the full " + c.life + " years. Give the date it was put to use, or its remaining life.", {asset: a.id, kind: "rem"});
      if (c.flags.includes("idle")) add("idle:" + a.id, nm + ": an addition is put to use after the year: no depreciation this year; in the income-tax block only once used.", {asset: a.id, kind: "idle"});
      if (!res.hasPrev && !a.typedOpen && r2(a.bookOpen) > 0 && !c.accLedger && !c.noDep) add("noacc:" + a.id, nm + ": no accumulated-depreciation ledger: its opening " + amt(a.bookOpen) + " is taken as cost with nothing depreciated. If the ledger holds the written down value, give the original cost and the depreciation to date.", {asset: a.id, kind: "noacc"});
      (a.moves || []).forEach(m => {
        if (m.kind === "sale" || m.kind === "scrap" || m.kind === "transfer" || !m.sure) add("move:" + m.key, nm + ": a credit of " + amt(m.amount) + " on " + dmy(m.date) + " (" + m.vtype + " " + m.vno + ") is taken as " + ({sale: "a sale", scrap: "scrapped", transfer: "a transfer", dep: "depreciation booked", ignore: "not a disposal"}[m.kind]) + " (" + m.why + ").", {asset: a.id, kind: "move", move: m.key});
      });
      (a.adds || []).forEach(m => { if (!m.sure) add("add:" + m.key, nm + ": a debit of " + amt(m.amount) + " on " + dmy(m.date) + " (" + m.vtype + " " + m.vno + ") is taken as " + (m.kind === "add" ? "an addition" : m.kind === "transfer" ? "a transfer in" : "not an addition") + " (" + m.why + ").", {asset: a.id, kind: "add"}); });
      const sold = (a.moves || []).filter(m => m.kind === "sale" || m.kind === "scrap");
      const bookClose = r2(num(a.bookOpen) + num(a.bookDr) - num(a.bookCr));
      if (sold.length && Math.abs(bookClose) >= 1 && !sold.some(m => m.costPart != null && m.costPart !== "")) add("part:" + a.id, nm + ": the ledger still holds " + amt(bookClose) + " after the sale; the whole asset is taken as sold. If only a part was sold, give the cost of the part.", {asset: a.id, kind: "part"});
      if (set.addl && a.block && c.gAdd > 0) add("addl:" + a.id, nm + ": additional depreciation (section 32(1)(iia)) " + ((a.addlEligible != null ? a.addlEligible : /^pm_(general|cpp)$/.test(a.cls || "")) ? "claimed" : "not claimed") + ": new plant or machinery of a manufacturer or power producer, not second-hand, not office or residential, not a vehicle, not under section 115BAA / 115BAB / 115BAC.", {asset: a.id, kind: "addl"});
      if (a.override && a.override.dep != null && a.override.dep !== "" && !String(a.override.reason || "").trim()) out.push({key: "need:why:" + a.id, text: nm + ": give the reason for the depreciation typed by hand.", asset: a.id, kind: "need"});
    });
    (reg.accDep || []).forEach(x => {
      const m = x.match;
      if (!m) out.push({key: "need:acc:" + x.ledger, text: "“" + x.ledger + "” (" + amt(x.open) + ") is accumulated depreciation, not an asset; it matches no asset or block by name: choose which.", acc: x.ledger, kind: "need"});
      else if (!x.byHand) add("acc:" + x.ledger, "“" + x.ledger + "” (" + amt(x.open) + ") is accumulated depreciation of " + (m.kind === "asset" ? "the asset “" + m.id.slice(2) + "”" : m.kind === "group" ? "the block “" + m.group + "”, spread over its assets in proportion to cost" : "every asset, spread in proportion to cost") + " (" + m.why + ").", {acc: x.ledger, kind: "acc"});
    });
    res.blocks.forEach(b => { if (b.k && !b.openFrom && b.rate > 0) add("open:" + b.k, "Income-tax block " + b.name + ": no closing for last year in FinCom; give its opening written down value (taken as 0).", {block: b.k, kind: "open"}); });
    if (!res.dt.rateGiven) add("dt", "Deferred tax at " + res.dt.rate + "% (" + (res.kind === "company" ? "a company under section 115BAA, with surcharge and cess" : "30% with cess") + "): give the rate that applies.", {kind: "dt"});
    return out;
  };

  // ------------------------------------------------------------ the statements' details, from the register
  // det: the year's "details for you" (FSX); the register's figures replace the typed fixed asset register and blocks
  X.feedDet = function(det, res){
    if (!res) return det;
    const d = Object.assign({}, det || {});
    d.far = Object.assign({}, d.far || {}, {cy: res.far}); d.itBlocks = Object.assign({}, d.itBlocks || {}, {cy: res.itRows});
    if (res.prev){ d.far.py = res.prev.far; d.itBlocks.py = res.prev.itRows; }
    d.farFrom = "register";
    return d;
  };
  X.forYear = function(b, fy){
    const all = (b && b.fixedAssets) || {}, reg = all[String(fy)];
    if (!reg || !(reg.assets || []).length) return null;
    try { return X.compute(reg, all[String(Number(fy) - 1)] || null); } catch (e){ return null; }
  };

  // ------------------------------------------------------------ the app: the books FinCom holds (browser only)
  X.inputFromBooks = function(fy){
    const b = S.books, D = X.fyDates(fy), from = D.from.replace(/-/g, ""), to = D.to.replace(/-/g, "");
    const bal = Audit.balances(from, to);
    if (!bal.ok) return {error: bal.why};
    const open = bal.at(Audit.dayBefore(from)), names = new Set(Object.keys(open));
    (b.vouchers || []).forEach(v => v.ent.forEach(e => names.add(e.l)));
    Object.keys(b.under || {}).forEach(l => names.add(l));
    const path = l => Books.groupPath(l), isFA = l => { const p = path(l); return p.length && /^fixed assets$/i.test(String(p[p.length - 1]).trim()); };
    const ledgers = Array.from(names).filter(isFA).sort().map(l => ({l, path: path(l), open: r2(-(num(open[l])))}));
    const fa = new Set(ledgers.map(x => x.l));
    const t = d => d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
    const vouchers = (b.vouchers || []).filter(v => v.date >= from && v.date <= to && !v.opt && !v.cancel && v.ent.some(e => fa.has(e.l)))
      .map(v => ({id: v.id, date: t(v.date), no: v.no, type: v.type, ent: v.ent.map(e => ({l: e.l, a: -num(e.a)}))}));
    const depL = Array.from(names).filter(l => !fa.has(l) && /depreciation|amorti[sz]/i.test(l) && !path(l).some(g => /fixed assets/i.test(g)));
    const kind = typeof FSX === "object" ? FSX.kindOf(b) : (typeof FS === "object" ? ({C: "company", F: "firm", P: "proprietor"})[FS.entityOf(S.companies && S.companies[b.cid]).code] || "company" : "company");
    return {fy: String(fy), ledgers, vouchers, depLedger: depL[0] || null, isDepExpense: l => !fa.has(l) && /depreciation|amorti[sz]/i.test(l), kind, at: new Date().toISOString().slice(0, 10)};
  };
  // the year's register proposed again from the books, keeping what was changed by hand; saved with the books
  X.refresh = function(b, fy){
    const inp = X.inputFromBooks(fy); if (inp.error) return inp;
    b.fixedAssets = Object.assign({}, b.fixedAssets || {});
    const old = b.fixedAssets[String(fy)], reg = X.merge(old, X.propose(inp));
    if (old && old.kind) reg.kind = old.kind;
    b.fixedAssets[String(fy)] = reg;
    return reg;
  };
  X.okSet = (reg, key, who) => { reg.ok = Object.assign({}, reg.ok || {}, {[key]: {by: who || "", at: new Date().toISOString().slice(0, 10)}}); };

  // ------------------------------------------------------------ out: print (PDF), Excel (formulas), Word
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const inr = v => { const n = r2(v); if (!n) return "-"; const s = Math.abs(n).toFixed(2), [w, p] = s.split("."), l3 = w.slice(-3), rest = w.slice(0, -3);
    const g = (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + l3 + "." + p; return n < 0 ? "(" + g + ")" : g; };
  X.inr = inr;
  const yEnd = fy => "March 31, " + (Number(fy) + 1);
  X.tables = function(res){
    // the same tables for the screen, the print, the Word and the Assistant: [{title, cols: [[label, numeric]], rows: [[..]], total}]
    const T = [];
    T.push({id: "classes", title: "Companies Act, 2013: property, plant and equipment and intangible assets by class (Schedule II)", cols: [["Class", 0], ["Gross at start", 1], ["Additions", 1], ["Deductions", 1], ["Gross at end", 1], ["Depreciation at start", 1], ["For the year", 1], ["On deductions", 1], ["Depreciation at end", 1], ["Net at end", 1], ["Net at start", 1]],
      rows: res.classes.map(c => [c.cls, c.gOpen, c.gAdd, c.gDel, c.gClose, c.dOpen, c.dYear, c.dDel, c.dClose, c.nClose, c.nOpen]), total: true});
    T.push({id: "assets", title: "Asset register: Companies Act depreciation, asset by asset", cols: [["Asset", 0], ["Class", 0], ["Put to use", 0], ["Life (years)", 1], ["Method", 0], ["Cost at start", 1], ["Additions", 1], ["Deductions", 1], ["Depreciation for the year", 1], ["Carrying amount at end", 1], ["Sale value", 1], ["Gain / (loss) on sale", 1]],
      rows: res.assets.map(a => [a.name + (a.override ? " (by hand: " + (a.override.reason || "") + ")" : ""), a.clsName, a.putToUse || "", a.life || "", a.noDep ? "-" : a.method, a.gOpen, a.gAdd, a.gDel, a.dep, a.nClose, r2(sum(a.sales, s => s.value)), r2(sum(a.sales, s => s.gain))]), total: true, skip: [3]});
    T.push({id: "blocks", title: "Income-tax Act, 1961: depreciation by block (section 32)", cols: [["Block", 0], ["Rate %", 1], ["Opening WDV", 1], ["Added, 180 days or more", 1], ["Added, under 180 days", 1], ["Sale value", 1], ["STCL / (STCG)", 1], ["Depreciation", 1], ["Additional depreciation", 1], ["Closing WDV", 1]],
      rows: res.blocks.map(b => [b.name, b.rate, b.open, b.addGt180, b.addLt180, b.sale, b.stcg, b.dep, b.addl, b.close]), total: true, skip: [1]});
    const dt = res.dt;
    T.push({id: "dt", title: "Deferred tax working (" + dt.std + "): a suggestion; no entry is posted", cols: [["Particulars", 0], ["At the start", 1], ["At the end", 1]],
      rows: [["Carrying amount in the books (depreciable assets)", dt.bookOpen, dt.bookClose], ["Written down value for income tax", dt.taxOpen, dt.taxClose], ["Difference", dt.diffOpen, dt.diffClose],
        ["Deferred tax at " + dt.rate + "% (" + (dt.diffClose >= 0 ? "liability" : "asset") + ")", dt.open, dt.close], ["Movement for the year (" + (dt.move >= 0 ? "charge" : "credit") + " to profit and loss)", "", dt.move]]});
    T.push({id: "je", title: "Suggested journal entry for the year's depreciation, " + res.je.date + " (shown only; nothing is posted to Tally)", cols: [["Ledger", 0], ["Debit", 1], ["Credit", 1]],
      rows: res.je.lines.map(l => [l.ledger + (l.kind ? " (" + l.kind + ")" : ""), l.dr, l.cr]), total: true});
    return T;
  };
  const cellHtml = (v, n) => n ? (typeof v === "number" ? inr(v) : esc(v)) : esc(v);
  X.html = function(res, ent){
    const name = String((ent && ent.name) || "").toUpperCase();
    const tb = t => "<h3>" + esc(t.title) + "</h3><table><thead><tr>" + t.cols.map(c => "<th>" + esc(c[0]) + "</th>").join("") + "</tr></thead><tbody>" +
      t.rows.map(r => "<tr>" + r.map((v, i) => '<td class="' + (t.cols[i][1] ? "n" : "") + '">' + (t.skip && t.skip.includes(i) ? esc(v) : cellHtml(v, t.cols[i][1])) + "</td>").join("") + "</tr>").join("") +
      (t.total && t.rows.length > 1 ? '<tr class="t"><td>Total</td>' + t.cols.slice(1).map((c, j) => '<td class="n">' + (c[1] && !(t.skip || []).includes(j + 1) ? inr(sum(t.rows, r => typeof r[j + 1] === "number" ? r[j + 1] : 0)) : "") + "</td>").join("") + "</tr>" : "") + "</tbody></table>";
    return '<!doctype html><html><head><meta charset="utf-8"><title>Fixed assets and depreciation ' + esc(X.fyLabel(res.fy)) + '</title><style>@page{size:A4 landscape;margin:12mm;@bottom-right{content:counter(page) " / " counter(pages)}}body{font:9pt Calibri,Arial,sans-serif}table{border-collapse:collapse;width:100%;margin-bottom:10px}td,th{border:.6px solid #000;padding:2px 4px;vertical-align:top}th{background:#f2f2f2}td.n{text-align:right;white-space:nowrap}tr.t td{font-weight:bold;border-top:1.2px solid #000}h1{font-size:13pt;margin:0;text-align:center}h2{font-size:11pt;margin:2px 0;text-align:center}h3{font-size:10pt;margin:10px 0 4px}.u{text-align:center;font-style:italic}.note{font-size:8pt}</style></head><body>' +
      "<h1>" + esc(name) + "</h1><h2>Fixed assets and depreciation for the year ended " + yEnd(res.fy) + "</h2><div class=\"u\">(All amounts in ₹, unless otherwise stated)</div>" +
      X.tables(res).map(tb).join("") +
      '<h3>Basis</h3><p class="note">' + esc(X.SCH2_SOURCE) + "</p><p class=\"note\">" + esc(X.IT_SOURCE) + "</p><p class=\"note\">" + esc(X.RULES_TEXT) + "</p></body></html>";
  };
  X.RULES_TEXT = "Companies Act: straight line = (cost - residual) / useful life; written down value at 1 - (residual / cost) ^ (1 / life); pro-rata by days from the date put to use, and up to the date of sale. An asset held at the start: its carrying amount less the residual over the remaining life. Nothing below the residual value. Gain or loss on sale = sale value - carrying amount at the date of sale. Income tax: opening WDV + additions - sale value; half the rate on additions put to use for less than 180 days; a negative block is a short-term capital gain, a block emptied with value left a short-term capital loss, with no depreciation in either case; depreciation rounded to the rupee.";
  // Excel: the register and the schedules with live formulas (FSX.xlsx writes the file)
  X.sheets = function(res, ent){
    const name = String((ent && ent.name) || "").toUpperCase(), M = (v, s) => ({v: r2(v), s: s || 2}), C = (f, v, s) => ({f, v: r2(v), s: s || 2});
    const head = t => [[{v: name, s: 1}], [{v: t, s: 1}], ["(All amounts in ₹, unless otherwise stated)"], []];
    // 1. assets: J = F+G-H (gross at end), M = I+K-L (depreciation at end), N = J-M
    const A = {name: "Assets", rows: head("Asset register, year ended " + yEnd(res.fy)).concat([["Asset", "Class", "Put to use", "Life", "Method", "Gross at start", "Additions", "Deductions", "Depreciation at start", "Gross at end", "For the year", "On deductions", "Depreciation at end", "Net at end", "Sale value", "Carrying at sale", "Gain / (loss)", "Hand override, reason"].map(h => ({v: h, s: 7}))]),
      widths: [30, 34, 12, 6, 7, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 30]};
    const a0 = A.rows.length + 1;
    res.assets.forEach((a, i) => { const r = a0 + i, sv = r2(sum(a.sales, s => s.value)), ca = r2(sum(a.sales, s => s.carrying));
      A.rows.push([a.name, a.clsName, a.putToUse || "", a.life || "", a.noDep ? "-" : a.method, M(a.gOpen), M(a.gAdd), M(a.gDel), M(a.dOpen), C("F" + r + "+G" + r + "-H" + r, a.gClose), M(a.dep), M(a.dDel), C("I" + r + "+K" + r + "-L" + r, a.dClose), C("J" + r + "-M" + r, a.nClose), M(sv), M(ca), C("O" + r + "-P" + r, r2(sv - ca)), a.override ? String(a.override.reason || "") : ""]); });
    const a1 = A.rows.length, tot = c => C("SUM(" + c + a0 + ":" + c + a1 + ")", sum(res.assets, a => ({F: a.gOpen, G: a.gAdd, H: a.gDel, I: a.dOpen, J: a.gClose, K: a.dep, L: a.dDel, M: a.dClose, N: a.nClose, O: sum(a.sales, s => s.value), P: sum(a.sales, s => s.carrying), Q: sum(a.sales, s => s.gain)})[c]), 3);
    if (res.assets.length) A.rows.push([{v: "Total", s: 1}, "", "", "", ""].concat("FGHIJKLMNOPQ".split("").map(tot)));
    // 2. classes: SUMIFS over the assets
    const K = {name: "Schedule II classes", rows: head("Property, plant and equipment and intangible assets (Companies Act, 2013), year ended " + yEnd(res.fy)).concat([["Class", "Gross at start", "Additions", "Deductions", "Gross at end", "Depreciation at start", "For the year", "On deductions", "Depreciation at end", "Net at end"].map(h => ({v: h, s: 7}))]), widths: [52, 15, 15, 15, 15, 15, 15, 15, 15, 15]};
    const k0 = K.rows.length + 1, rng = c => "Assets!$" + c + "$" + a0 + ":$" + c + "$" + Math.max(a0, a1), si = (r, c, v) => C("SUMIFS(" + rng(c) + "," + rng("B") + ",$A" + r + ")", v);
    res.classes.forEach((c, i) => { const r = k0 + i; K.rows.push([c.cls, si(r, "F", c.gOpen), si(r, "G", c.gAdd), si(r, "H", c.gDel), C("B" + r + "+C" + r + "-D" + r, c.gClose), si(r, "I", c.dOpen), si(r, "K", c.dYear), si(r, "L", c.dDel), C("F" + r + "+G" + r + "-H" + r, c.dClose), C("E" + r + "-I" + r, c.nClose)]); });
    const k1 = K.rows.length; if (res.classes.length) K.rows.push([{v: "Total", s: 1}].concat("BCDEFGHIJ".split("").map((c, j) => C("SUM(" + c + k0 + ":" + c + k1 + ")", sum(res.classes, x => [x.gOpen, x.gAdd, x.gDel, x.gClose, x.dOpen, x.dYear, x.dDel, x.dClose, x.nClose][j]), 3))));
    // 3. the blocks: the section 32 working as formulas
    const B = {name: "Income-tax blocks", rows: head("Depreciation under section 32 of the Income-tax Act, 1961, previous year " + X.fyLabel(res.fy)).concat([["Block", "Rate %", "Opening WDV", "Added, 180 days or more", "Added, under 180 days", "Sale value", "Block emptied (1 = yes)", "Total", "STCL / (STCG)", "Depreciation", "Additional rate %", "Eligible, 180 days or more", "Eligible, under 180 days", "Additional brought forward", "Additional depreciation", "Closing WDV"].map(h => ({v: h, s: 7}))]),
      widths: [52, 8, 15, 15, 15, 15, 10, 15, 15, 15, 9, 15, 15, 15, 15, 15]};
    const b0 = B.rows.length + 1;
    res.blocks.forEach((b, i) => { const r = b0 + i, s1 = "(C" + r + "+D" + r + "-F" + r + ")";
      B.rows.push([b.name, {v: b.rate, s: 5}, M(b.open), M(b.addGt180), M(b.addLt180), M(b.sale), {v: b.empty ? 1 : 0, s: 6}, C("C" + r + "+D" + r + "+E" + r + "-F" + r, r2(b.open + b.addGt180 + b.addLt180 - b.sale)),
        C("IF(H" + r + "<0,H" + r + ",IF(G" + r + "=1,H" + r + ",0))", b.stcg),
        C("IF(OR(H" + r + "<0,G" + r + "=1),0,ROUND(MAX(0," + s1 + ")*B" + r + "/100+MAX(0,E" + r + "+MIN(0," + s1 + "))*B" + r + "/200,0))", b.dep),
        {v: b.addlRate, s: 5}, M(b.addlGt180), M(b.addlLt180), M(b.addlBf),
        C("IF(OR(H" + r + "<0,G" + r + "=1),0,MAX(0,MIN(H" + r + "-J" + r + ",ROUND(L" + r + "*K" + r + "/100+M" + r + "*K" + r + "/200,0)+N" + r + ")))", b.addl),
        C("IF(OR(H" + r + "<0,G" + r + "=1),0,H" + r + "-J" + r + "-O" + r + ")", b.close)]); });
    const b1 = B.rows.length; if (res.blocks.length) B.rows.push([{v: "Total", s: 1}, ""].concat("CDEF".split("").map(c => C("SUM(" + c + b0 + ":" + c + b1 + ")", sum(res.blocks, x => ({C: x.open, D: x.addGt180, E: x.addLt180, F: x.sale})[c]), 3))).concat(["", C("SUM(H" + b0 + ":H" + b1 + ")", sum(res.blocks, x => x.open + x.addGt180 + x.addLt180 - x.sale), 3), C("SUM(I" + b0 + ":I" + b1 + ")", sum(res.blocks, x => x.stcg), 3), C("SUM(J" + b0 + ":J" + b1 + ")", res.totals.itDep, 3), "", "", "", "", C("SUM(O" + b0 + ":O" + b1 + ")", res.totals.itAddl, 3), C("SUM(P" + b0 + ":P" + b1 + ")", res.totals.itClose, 3)]));
    // 4. deferred tax and 5. the journal entry
    const dt = res.dt, Tt = {name: "Deferred tax", rows: head("Deferred tax working (" + dt.std + "), a suggestion: no entry is posted").concat([["Particulars", "At the start", "At the end"].map(h => ({v: h, s: 7}))]), widths: [60, 16, 16]};
    const t0 = Tt.rows.length + 1;
    Tt.rows.push(["Carrying amount in the books (depreciable assets)", M(dt.bookOpen), M(dt.bookClose)], ["Written down value for income tax", M(dt.taxOpen), M(dt.taxClose)],
      ["Difference", C("B" + t0 + "-B" + (t0 + 1), dt.diffOpen), C("C" + t0 + "-C" + (t0 + 1), dt.diffClose)], ["Tax rate %", {v: dt.rate, s: 5}, {v: dt.rate, s: 5}],
      ["Deferred tax liability / (asset)", C("ROUND(B" + (t0 + 2) + "*B" + (t0 + 3) + "/100,2)", dt.open), C("ROUND(C" + (t0 + 2) + "*C" + (t0 + 3) + "/100,2)", dt.close)],
      ["Movement for the year: charge / (credit) to profit and loss", "", C("C" + (t0 + 4) + "-B" + (t0 + 4), dt.move, 3)]);
    const J = {name: "Journal (suggested)", rows: head("Suggested journal entry for the year's depreciation, " + res.je.date + ": shown only, nothing is posted to Tally").concat([["Ledger", "Debit", "Credit"].map(h => ({v: h, s: 7}))]), widths: [60, 16, 16]};
    const j0 = J.rows.length + 1; res.je.lines.forEach(l => J.rows.push([l.ledger, M(l.dr), M(l.cr)])); const j1 = J.rows.length;
    if (res.je.lines.length) J.rows.push([{v: "Total", s: 1}, C("SUM(B" + j0 + ":B" + j1 + ")", sum(res.je.lines, l => l.dr), 3), C("SUM(C" + j0 + ":C" + j1 + ")", sum(res.je.lines, l => l.cr), 3)]);
    const R = {name: "Basis", rows: [[{v: "Basis", s: 1}], [X.SCH2_SOURCE], [X.IT_SOURCE], [X.RULES_TEXT], []].concat([[{v: "Schedule II class", s: 7}, {v: "Useful life (years)", s: 7}]]).concat(X.SCH2.map(c => [c.head + ": " + c.name, c.life == null ? "-" : c.life])), widths: [110, 18]};
    return [A, K, B, Tt, J, R];
  };
  // Word: the same tables (FSX.docx writes the file); amounts in paise for FSX
  X.docxBlocks = function(res, ent){
    const name = String((ent && ent.name) || "").toUpperCase();
    const items = [];
    X.tables(res).forEach(t => {
      items.push({p: t.title, b: 1});
      const rows = t.rows.map(r => ({t: String(r[0]), k: "r", c: r.slice(1).map((v, j) => t.cols[j + 1][1] && typeof v === "number" && !(t.skip || []).includes(j + 1) ? {v: Math.round(v * 100)} : String(v == null ? "" : v))}));
      if (t.total && t.rows.length > 1) rows.push({t: "Total", k: "t", c: t.cols.slice(1).map((c, j) => c[1] && !(t.skip || []).includes(j + 1) ? {v: Math.round(sum(t.rows, r => typeof r[j + 1] === "number" ? r[j + 1] : 0) * 100)} : "")});
      items.push({table: {cols: t.cols.map(c => ({h: c[0], n: c[1]})), rows}});
    });
    items.push({p: "Basis", b: 1}, {p: X.SCH2_SOURCE, i: 1}, {p: X.IT_SOURCE, i: 1}, {p: X.RULES_TEXT, i: 1});
    return [{section: {head: [name, "Fixed assets and depreciation for the year ended " + yEnd(res.fy), "(All amounts in ₹, unless otherwise stated)"], landscape: true}, items}];
  };
  return X;
})();
if (typeof globalThis === "object") globalThis.FAR = FAR;
/* @react-lazy: end */
