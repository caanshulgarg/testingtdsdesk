// node run_migration151.js IN.json OUT.json - the browser's own engine (src/js, from the test build: TDSDESK_HTML) on the
// made-up books run_migration151.py wrote, the books put together as TCloud.load puts them (src/js/49): the groups as
// TCloud.groupsInto reads tally_groups, then TallyRead.balances with the ledger rows TCloud.restAll reads (not merged, not
// deleted in Tally: the Python side gives exactly those rows) and the copy's first day (its yearOpen moves the profit and
// loss openings when that is 1 April), tb.src "copy", tb.to today; FinCom's ledger list by Books.mapLedgers. Then:
// Audit.balances().at(d), Rec.fincom (the month-end tie-out), MIS.ageing, and what MIS.runNow takes from the day's
// balances (Parties.position: owed; r.balances: cash and bank), each timed. The figures go to OUT.json.
const fs = require("fs"), {load} = require("./harness"), {HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B",
  "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "FC", "LK", "Rec", "TallyRead"];
const {ctx, x} = load(HTML, NAMES);
const inp = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const b = {cid: inp.cid, meta: {from: inp.from, company: "Made-up Heron Traders"}, vouchers: inp.vouchers};
b.vouchers.forEach(v => { v.ent.forEach(e => { if (!e.b) delete e.b; }); });
// TCloud.groupsInto: tally_groups (name, parent)
b.groups = {}; (inp.groups || []).forEach(g => { b.groups[g.name] = g.parent || ""; });
// TCloud.load: TallyRead.balances(b, {ledgers}, from, to) with String(open); tb.src = "copy"; tb.to at least today
x.TallyRead.balances(b, {ledgers: inp.ledgers.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, inp.from, inp.today);
b.tb.src = "copy"; if (String(b.tb.to) < inp.today) b.tb.to = inp.today;
b.map = x.Books.mapLedgers(b.vouchers || [], b.map);      // as TCloud.load
ctx.S.books = b; ctx.S.coId = b.cid; ctx.CO = () => ({id: b.cid, name: "Made-up Heron Traders"});
const out = {map: b.map, ms: {}, plOpen: (b.tb.led["Profit & Loss A/c"] || {}).open};
const time = (k, f) => { const t0 = Date.now(), r = f(); out.ms[k] = Date.now() - t0; return r; };
// 1. Audit.balances().at(d): the period's start is the books' first day (any period inside the copy gives the same at)
out.bal = time("balances", () => { const B = x.Audit.balances(b.tb.from, inp.dates[inp.dates.length - 1]); if (!B.ok) throw new Error(B.why); const r = {}; inp.dates.forEach(d => { r[d] = B.at(d); }); return r; });
// 2. the tie-out's five figures at each month-end
out.tie = time("tieout", () => { const r = {}; inp.months.forEach(m => { r[m] = x.Rec.fincom(b.cid, m); }); return r; });
// 3. the ageing, receivables and payables, with the balances on the day (as MIS.runNow passes them); and what runNow
// takes from the same balances: r.owed (Parties.position(to)) and r.balances' cash and bank
out.age = time("ageing", () => { const r = {}; inp.ageing.forEach(d => { const B = x.Audit.balances(b.tb.from, d), at = B.at(d); r[d] = {r: x.MIS.ageing(d, "r", at), p: x.MIS.ageing(d, "p", at)}; }); return r; });
out.now = {}; inp.ageing.forEach(d => {
  const P = x.Parties.position(d), at = x.Audit.balances(b.tb.from, d).at(d);
  out.now[d] = {owed: P.ok ? {r: P.owed, p: P.youOwe, custAdv: P.custAdv, supAdv: P.supAdv} : null,
    cash: Object.keys(at).filter(l => x.Audit.isCash(l)).sort().map(l => [l, x.r2(-at[l])]), bank: Object.keys(at).filter(l => x.Audit.isBankL(l)).sort().map(l => [l, x.r2(-at[l])])};
});
fs.writeFileSync(process.argv[3], JSON.stringify(out));
