// node run_itc_final.js - the decision on each line of 2B reconciliation into GSTR-3B table 4 (next-itc-simple; the owner,
// 24-Oct-2026: "what to do with the credit.. available in ITC (books) but not in 2B, we should be able to take it; and in
// 2B but we want to take it in following months.. one main tab should be Final credit taking into 3B.. option to increase
// or decrease like TDS add deduction or remove"). app/src/lib/itcSync.js (ITCDec) and app/src/lib/itcFinal.js (ITCF, the
// wrap of GSTR.threeBm) loaded beside the app's own GSTR, GST2B. Made-up books, worked out by hand:
//   April: Alpha A/101 (tax 1,800, in May's 2B), Beta B/7 (3,600, in April's 2B), Delta D/9 (5,400 in the books, 4,500 in
//          2B), Echo E/1 (900, never in 2B); April's 2B also Omega O/5 (900, not in the books) and Sigma's credit note CN/1
//          (180, not in the books)
//   May:   Foxtrot F/2 (1,440, in May's 2B)
//  0. nothing decided: 3B exactly as before (the wrap against GSTR.threeBm alone), April 4(A)(5) 3,600 + 4,500 - 180 = 7,920
//  1. each decision moves 4(A)(5) of its month by hand-worked amounts, and the carried credit with it
//  2. a line not taken is carried forward to the next month until taken or dropped
//  3. the old remarks and follow-up decisions are read as decisions, the latest wins
//  4. adjustments add to / take from their 3B line; removed, they stop counting and stay in the trail
//  5. the Excel brought back (ITCF.preview / applyImport): decisions, months, notes and adjustments as in the file
const fs = require("fs"), path = require("path"), vm = require("vm");
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR",
  "normName", "nameSim", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {ctx, x} = load(HTML, NAMES);
const CMP = "09AAACZ1234A1Z5", reg = "09", G = x.GSTR, H = ["igst", "cgst", "sgst", "cess"];
ctx.S.companies = {t: {id: "t", name: "Zeta Traders", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
ctx.saveBooks = () => {}; ctx.render = () => {}; ctx.Cloud = {st: {email: "test@zz.test"}};
// the two app modules, as the browser runs them (their imports and exports taken off)
const APP = path.join(__dirname, "..", "app", "src", "lib");
const strip = (f) => fs.readFileSync(path.join(APP, f), "utf8").replace(/^import .*$/mg, "").replace(/^export (const|function|async function) /mg, "$1 ");
vm.runInContext("globalThis.__sync = (function(){" + strip("itcSync.js") + "\n; return {DECS, DEC_LABEL}; })();\n(function(){ const {DECS, DEC_LABEL} = globalThis.__sync;\n" + strip("itcFinal.js") + "\n})();", ctx);
const ITCF = ctx.ITCF, ITCDec = ctx.ITCDec, Adj = ctx.ITCAdj;
ok(typeof ITCF === "object" && G.threeBm.itcFinal === true, "GSTR.threeBm is wrapped by ITCF");
const V = (id, date, no, party, gstin, taxable, cgst) => ({id, type: "Purchase", date, no, party, gstin, pos: "", cmp: CMP, narr: "", hsn: [], cancel: false, opt: false,
  ent: [{l: "Office Expenses", a: -taxable}, {l: "Input CGST", a: -cgst}, {l: "Input SGST", a: -cgst}, {l: party, a: taxable + 2 * cgst}]});
const GA = "09AABCA1111A1Z1", GB = "09AABCB2222B1Z2", GD = "09AABCD5555E1Z6", GE = "09AABCE6666F1Z7", GO = "09AABCO4444D1Z4", GS = "09AABCS7777G1Z8", GF = "09AABCF8888H1Z9";
const vs = [V("a1", "20260405", "A/101", "Alpha Supplies", GA, 10000, 900), V("b1", "20260410", "B/7", "Beta Traders", GB, 20000, 1800),
  V("d1", "20260412", "D/9", "Delta Services", GD, 30000, 2700), V("e1", "20260418", "E/1", "Echo Stores", GE, 5000, 450), V("f1", "20260508", "F/2", "Foxtrot Labs", GF, 8000, 720),
  {id: "s1", type: "Sales", date: "20260420", no: "S/1", party: "Kilo Retail", gstin: "", pos: "", cmp: CMP, narr: "", hsn: [], ent: [{l: "Kilo Retail", a: -236000}, {l: "Sales", a: 200000}, {l: "CGST", a: 18000}, {l: "SGST", a: 18000}]},
  {id: "s2", type: "Sales", date: "20260520", no: "S/2", party: "Kilo Retail", gstin: "", pos: "", cmp: CMP, narr: "", hsn: [], ent: [{l: "Kilo Retail", a: -118000}, {l: "Sales", a: 100000}, {l: "CGST", a: 9000}, {l: "SGST", a: 9000}]}];
const row = (ym, gstin, party, no, date, taxable, cgst, dir = 1) => ({no, noN: no.replace(/[^A-Z0-9]/gi, "").toUpperCase(), ym, dir, ims: "N", key: ym.slice(4) + ym.slice(0, 4) + "|" + (dir < 0 ? "cdnr" : "b2b") + "|" + gstin + "|" + no + "|" + date,
  pos: reg, rcm: false, sec: dir < 0 ? "cdnr" : "b2b", typ: "R", val: taxable + 2 * cgst, cess: 0, cgst, sgst: cgst, igst: 0, date, gstin, party, itcavl: "Y", taxable});
const TWOB = {[CMP + "|042026"]: {ym: "202604", gstin: CMP, period: "042026", rows: [row("202604", GB, "BETA TRADERS", "B/7", "20260410", 20000, 1800), row("202604", GD, "DELTA SERVICES", "D/9", "20260412", 25000, 2250),
    row("202604", GO, "OMEGA LOGISTICS", "O/5", "20260415", 5000, 450), row("202604", GS, "SIGMA PAPER", "CN/1", "20260416", 1000, 90, -1)]},
  [CMP + "|052026"]: {ym: "202605", gstin: CMP, period: "052026", rows: [row("202605", GA, "ALPHA SUPPLIES", "A/101", "20260405", 10000, 900), row("202605", GF, "FOXTROT LABS", "F/2", "20260508", 8000, 720)]}};
function books() {
  const b = {cid: "t", vouchers: vs, meta: {from: "20260401", to: "20260531", gstins: [CMP], bills: 1}, under: {}, groups: {}, gstins: {}, states: {}, challans: [], alloc: {}, certs: [], twoBs: JSON.parse(JSON.stringify(TWOB)),
    gstOpen: {[reg]: {igst: 0, cgst: 0, sgst: 0, cess: 0}}};
  ["Alpha Supplies", "Beta Traders", "Delta Services", "Echo Stores", "Foxtrot Labs"].forEach((p) => { b.under[p] = "Sundry Creditors"; });
  b.under["Kilo Retail"] = "Sundry Debtors"; b.under.Sales = "Sales Accounts"; b.groups = {"Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets", "Sales Accounts": "Primary"};
  b.map = x.Books.mapLedgers(vs, {});
  const set = (n, o) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, {ok: true, byHand: true}); };
  ["CGST", "SGST"].forEach((t) => { set(t, {what: "gst", kind: "gst", tax: t, side: "output", reg}); set("Input " + t, {what: "gst", kind: "gst", tax: t, side: "input", reg}); });
  ctx.S.books = b; G._carry = null; x.GST2B._memo = null; return b;
}
const near = (a, c) => Math.abs(a - c) < 0.01, tax = (o) => Math.round(H.reduce((a, k) => a + ((o || {})[k] || 0), 0) * 100) / 100;
const f = (o) => H.map((h) => Math.round(((o || {})[h] || 0) * 100) / 100).join("/");
const T = (ym) => { G._carry = null; return G.threeBm(ym, reg); };
const a5 = (ym) => tax(T(ym).other);
const line = (no) => ITCF.rows(reg).find((r) => r.no === no || r.bookNo === no);
const inMonth = (ym, no) => ITCF.month(reg, ym).rows.find((r) => r.no === no || r.bookNo === no);
const decide = (no, d, ym, M) => { const r = line(no); ok(!!r, "the line " + no + " is there"); if (r) ITCF.decide(reg, [r], d, ym, M); };

// ---- 0. nothing decided: 3B as before
books();
const same = (ym) => { const w = T(ym), o = G.threeBm.orig.call(G, ym, reg); return ["other", "itc", "netItc", "rev1", "rev2"].every((k) => H.every((h) => near(w[k][h], o[k][h]))) && H.every((h) => near(w.pay.carry[h], o.pay.carry[h])) && near(tax(w.held), tax(o.held)) && near(tax(w.released), tax(o.released)) && near(tax(w.cn2b), tax(o.cn2b)); };
ok(same("202604") && same("202605"), "0. nothing decided: April and May 3B are exactly GSTR.threeBm's (4(A)(5), 4(C), held, released, credit notes, the credit carried)");
ok(near(a5("202604"), 7920), "April 4(A)(5) 7,920: Beta 3,600 + Delta 4,500 (the lower) - Sigma's credit note 180; Alpha (in May's 2B) and Echo (not in 2B) wait (" + a5("202604") + ")");
ok(near(a5("202605"), 1440 + 1800), "May 4(A)(5) 3,240: Foxtrot 1,440 + Alpha 1,800 taken when May's 2B shows it (" + a5("202605") + ")");
const chips = (ym) => { const m = {}; ITCF.month(reg, ym).rows.forEach((r) => { m[r.chip] = (m[r.chip] || 0) + 1; }); return m; };
const c4 = chips("202604");
ok(c4.matched === 1 && c4.diff === 1 && c4.books === 2 && c4["2b"] === 2, "April's chips: matched 1 (Beta), amount differs 1 (Delta), in books not in 2B 2 (Alpha, Echo), in 2B not in books 2 (Omega, Sigma) (" + JSON.stringify(c4) + ")");
ok(inMonth("202604", "A/101").show.code === "later" && inMonth("202604", "A/101").show.ym === "202605", "Alpha in April: FinCom's rule shows Take in a later month, May-2026");
ok(inMonth("202604", "E/1").show.code === "follow" && inMonth("202604", "O/5").show.code === "book" && inMonth("202604", "B/7").show.code === "now", "Echo: Follow up (held for 2B); Omega: Book in Tally; Beta: Take now");
const c5 = chips("202605");
ok(c5.cf >= 2 && inMonth("202605", "E/1") && inMonth("202605", "E/1").chip === "cf" && inMonth("202605", "A/101").chip === "cf", "2. May: Echo (not taken in April) and Alpha (booked in April, in May's 2B) are Carried forward (" + JSON.stringify(c5) + ")");

// ---- 1. each decision moves its month's 4(A)(5)
const base4 = a5("202604"), base5 = a5("202605"), net4 = tax(T("202604").netItc), cash4 = tax(T("202604").pay.cash);
decide("E/1", "booksnow", "", "202604");
ok(near(a5("202604") - base4, 900), "Take now though not in 2B on Echo in April: April 4(A)(5) + 900 (" + (a5("202604") - base4) + ")");
ok(inMonth("202604", "E/1").show.code === "booksnow" && !inMonth("202605", "E/1"), "Echo taken in April: no longer carried to May");
decide("E/1", "follow", "", "202604");
ok(near(a5("202604"), base4) && inMonth("202605", "E/1") && inMonth("202605", "E/1").chip === "cf", "back to Follow up: April as before, Echo carried forward to May again");
decide("E/1", "now", "", "202605");
ok(near(a5("202605") - base5, 900) && near(a5("202604"), base4), "2. Echo taken now from May's carried forward: May + 900, April unchanged (" + (a5("202605") - base5) + ")");
ok(inMonth("202605", "E/1").show.code === "now" && inMonth("202604", "E/1").show.code === "later" && inMonth("202604", "E/1").show.ym === "202605", "in April Echo reads Take in a later month, May-2026; in May Take now");
decide("B/7", "later", "202606", "202604");
ok(near(a5("202604") - base4, -3600) && near(a5("202606"), 3600), "Take in a later month (Jun-2026) on Beta: April - 3,600, June + 3,600 (" + (a5("202604") - base4) + ", " + a5("202606") + ")");
ok(inMonth("202606", "B/7") && inMonth("202606", "B/7").chip === "cf", "Beta shows in June as Carried forward");
ok(near(tax(T("202604").pay.cash) - cash4, 3600) && near(tax(T("202604").netItc) - net4, -3600), "April's 4(C) - 3,600, and the tax to pay in cash + 3,600 (the payment worked out again)");
decide("B/7", "now", "", "202604");
decide("O/5", "now", "", "202604");
ok(near(a5("202604") - base4, 900), "Take now on Omega (only in 2B): April + 900 (" + (a5("202604") - base4) + ")");
decide("O/5", "book", "", "202604");
decide("CN/1", "reverse", "", "202604");
ok(near(a5("202604") - base4, 180), "Reverse / do not take on Sigma's credit note in 2B: it no longer reduces April, + 180 (" + (a5("202604") - base4) + ")");
decide("CN/1", "", "", "202604");
decide("D/9", "booksnow", "", "202604");
ok(near(a5("202604") - base4, 900), "Delta, Take the books' amount though 2B is lower: + 900, the excess (" + (a5("202604") - base4) + ")");
decide("D/9", "correct", "", "202604");
ok(near(a5("202604"), base4) && ITCF.letters(reg, ITCF.month(reg, "202604").rows).some((s) => s.gstin === GD), "Ask supplier to correct on Delta: the lower is taken as before, Delta is among the suppliers to write to");
decide("A/101", "reverse", "", "202604");
ok(near(a5("202605") - base5, 900 - 1800), "Reverse / do not take on Alpha: not taken in May (May - 1,800; + 900 Echo) (" + (a5("202605") - base5) + ")");
ok(!inMonth("202606", "A/101"), "a reversed line is not carried forward");
decide("A/101", "", "", "202604");
ok(near(a5("202605") - base5, 900), "taken off: Alpha back to FinCom's rule, taken in May");
const t4 = ITCF.table4(reg, "202604"), tw = T("202604");
ok(H.every((h) => near(Object.fromEntries(t4.lines)["4A5"][h], tw.other[h]) && near(Object.fromEntries(t4.lines)["4C"][h], tw.netItc[h])), "Final credit for 3B's table 4 is GSTR-3B's (4(A)(5), 4(C))");

// ---- 3. the old remarks and follow-up decisions
const b = ctx.S.books;
b.reco2b = {confirm: {}, link: {}, tag: {e1: {tag: "Reverse in 3B", at: new Date(Date.now() + 60000).toISOString()}}};
ok(line("E/1").e.code === "reverse" && line("E/1").s.src === "remark", "a remark made later than the decision (Reverse in 3B on Echo) is the decision now (" + line("E/1").e.code + ")");
b.reco2b.tag = {["042026|b2b|" + GO + "|O/5|20260415"]: {tag: "Booked in a later month", at: "2026-01-01T00:00:00Z"}};
ok(line("O/5").e.code === "book", "an older remark does not override a decision made since (Omega stays Book in Tally)");
delete b.itcDec[reg + "|" + line("O/5").key];
ok(line("O/5").e.code === "later" && !line("O/5").e.C && inMonth("202605", "O/5") && inMonth("202605", "O/5").chip === "cf", "Booked in a later month (old remark): Take in a later month with the month to pick; carried forward to May");
b.itcTrack = {[reg]: {dec: {["P|" + GO + "|O5|1"]: {act: "reject", at: "20990101"}}, sent: {}, contact: {}}};
ok(line("O/5").e.code === "reverse" && line("O/5").s.src === "follow-up", "an ITC follow-up decision (reject in IMS) reads as Reverse / do not take");
b.reco2b.tag = {}; b.itcTrack = {}; b.itcDec = {};
ok(near(a5("202604"), base4) && near(a5("202605"), base5), "every decision taken off: back to as before");

// ---- 4. adjustments
const r0 = T("202604");
const add1 = Adj.save(reg, "202604", {line: "4A5", head: "igst", amt: "500", reason: "credit note after the books closed"});
const add2 = Adj.save(reg, "202604", {line: "4B1", head: "cgst", amt: "-100", reason: "reversal written back"});
ok(add1.ok && add2.ok && !Adj.save(reg, "202604", {line: "4A5", head: "igst", amt: "", reason: "x"}).ok && !Adj.save(reg, "202604", {line: "4A5", head: "igst", amt: "10", reason: ""}).ok, "an adjustment needs an amount and a reason");
const r1 = T("202604");
ok(near(r1.other.igst - r0.other.igst, 500) && near(r1.rev1.cgst - r0.rev1.cgst, -100) && near(tax(r1.netItc) - tax(r0.netItc), 600), "+ 500 IGST on 4(A)(5) and - 100 CGST on 4(B)(1): 4(C) + 600 (" + f(r1.other) + ")");
ok(near(r1.pay.carry.igst + r1.pay.use.igst.igst + r1.pay.use.igst.cgst + r1.pay.use.igst.sgst, r1.netItc.igst + r1.opening.igst), "the payment is worked out again with the new credit");
ok(Adj.remove(add1.id, "").ok === false && Adj.remove(add1.id, "typed twice").ok, "removing asks the reason");
const r2 = T("202604");
ok(near(r2.other.igst, r0.other.igst) && Adj.removed(reg, "202604").length === 1 && Adj.list(reg, "202604").length === 1, "removed: 4(A)(5) as before; kept in the trail");

// ---- 5. the Excel brought back
const d = ITCF.excelData(reg, "202604");
ok(d.rows.length === ITCF.month(reg, "202604").rows.length && d.rows.every((y) => y.key) && d.base["4A5"] && d.adj.length === 1, "the Excel's data: a row a line with its key, the base figures, this month's adjustments");
const edit = d.rows.map((y) => ({row: 0, key: y.key, dec: y.dec, takeIn: y.takeIn, note: y.note, party: y.party, no: y.no || y.bookNo}));
edit.find((y) => y.no === "E/1").dec = "Take now though not in 2B";
edit.find((y) => y.no === "B/7").dec = "Take in a later month"; edit.find((y) => y.no === "B/7").takeIn = x.GSTR.label("202606");
edit.find((y) => y.no === "O/5").note = "asked the supplier";
edit.push({row: 99, key: "B|zz|ZZ|1", dec: "Take now", party: "Nobody", no: "ZZ"});
const p = ITCF.preview(reg, "202604", {rows: edit.filter((y) => y.no !== "F/2"), adj: [{id: d.adj[0].id, head: "CGST", amt: -150, reason: "reversal written back", line: "4(B)(1) Reversed: rules 38, 42, 43 and section 17(5)"},
  {head: "SGST", amt: 250, reason: "missed invoice", line: "4(A)(5) All other ITC"}]});
ok(p.changes.length === 2 && p.notes.length === 1 && p.unknown.length === 1 && p.adj.add.length === 1 && p.adj.edit.length === 1 && p.adj.del.length === 0, "preview: 2 decisions, 1 note, 1 unknown key refused, 1 adjustment added and 1 changed (" + [p.changes.length, p.notes.length, p.unknown.length, p.adj.add.length, p.adj.edit.length].join(",") + ")");
const bad = ITCF.preview(reg, "202604", {rows: [{key: d.rows.find((y) => (y.no || y.bookNo) === "O/5").key, dec: "Take now though not in 2B"}, {key: d.rows.find((y) => (y.no || y.bookNo) === "B/7").key, dec: "Pay the supplier"}], adj: []});
ok(bad.refused.length === 2 && bad.missing.length === d.rows.length - 2, "a choice a line cannot take, and a word that is no choice, are refused; lines not in the file are left as they are");
ITCF.applyImport(reg, "202604", p);
ok(line("E/1").e.code === "booksnow" && line("B/7").e.code === "later" && line("B/7").e.C === "202606" && (line("O/5").s || {}).note === "asked the supplier", "Apply: the decisions, the month and the note as in the file");
const fin = T("202604");
ok(near(fin.other.igst - r0.other.igst, 0) && near(tax(fin.other) - tax(r0.other), 900 - 3600 + 250) && near(fin.rev1.cgst - r0.rev1.cgst, -150), "and 3B: Echo + 900, Beta - 3,600, the new adjustment + 250, 4(B)(1) - 150 (" + f(fin.other) + ")");

// ---- 6. a travel agent's journal (Leads, 24-Oct-2026: JMD): the ticket and the fee in one expense line, GST only on the
// fee, no rate anywhere in the books. The rate is never assumed (the owner: "if charged 5% then no ITC, if charged 18% then
// full ITC"): Tally's rate on the line, a tax ledger's name, the narration, else 2B's own rate; none: rate unknown
{
  const J = (id, date, no, value, cg, extra) => Object.assign({id, type: "Journal", date, no, party: "Juno Travels", gstin: GJ, pos: "", cmp: CMP, narr: "", hsn: [],
    ent: [{l: "Tour & Travels", a: -value}, {l: "Input CGST", a: -cg}, {l: "Input SGST", a: -cg}, {l: "Juno Travels", a: value + 2 * cg}]}, extra || {});
  const GJ = "09AAJFJ4444D1Z4";
  const b0 = books();
  b0.vouchers = vs.concat([J("j1", "20260602", "JE/1", 36630, 90), J("j2", "20260603", "JE/2", 40000, 90), J("j3", "20260604", "JE/3", 40000, 90), J("j4", "20260605", "JE/4", 21000, 50, {narr: "service charge @ 5%"}),
    J("j5", "20260606", "JE/5", 40000, 90)]);
  b0.under["Juno Travels"] = "Sundry Creditors"; b0.map = x.Books.mapLedgers(b0.vouchers, {});
  ["CGST", "SGST"].forEach((t) => { b0.map[t] = Object.assign(b0.map[t] || {n: 0}, {what: "gst", kind: "gst", tax: t, side: "output", reg, ok: true, byHand: true}); b0.map["Input " + t] = Object.assign(b0.map["Input " + t] || {n: 0}, {what: "gst", kind: "gst", tax: t, side: "input", reg, ok: true, byHand: true}); });
  b0.twoBs[CMP + "|062026"] = {ym: "202606", gstin: CMP, period: "062026", rows: [row("202606", GJ, "JUNO TRAVELS", "JE/1", "20260602", 1000, 90), row("202606", GJ, "JUNO TRAVELS", "JE/2", "20260603", 3600, 90),
    row("202606", GJ, "JUNO TRAVELS", "JE/3", "20260604", 7000, 90)]};
  x.GST2B._memo = null; G._carry = null;
  const docs = Object.fromEntries(x.GST2B.bookDocs().filter((d) => d.party === "Juno Travels").map((d) => [d.no, d]));
  ok(docs["JE/1"].ru && docs["JE/1"].taxable === 36630 && !docs["JE/1"].gstRate, "6. JE/1: no rate in the books: rate unknown, nothing assumed");
  ok(docs["JE/4"].gstRate === 5 && docs["JE/4"].taxable === 2000 && docs["JE/4"].other === 19000 && docs["JE/4"].noItc, "JE/4: 5% in its narration: its value 2,000 (the tax at 5%), the rest apart, no ITC");
  const r1 = line("JE/1"), r2 = line("JE/2"), r3 = line("JE/3"), r4 = line("JE/4"), r5 = line("JE/5");
  ok(r1.kind === "pair" && r1.status === "matched" && !r1.noItc && !r1.rateUnknown && r1.e.C === "202606", "JE/1 in 2B at 18% (180 on 1,000): matched, full ITC taken in June");
  ok(r2.kind === "pair" && r2.noItc && !r2.e.C && inMonth("202606", "JE/2").show.code === "reverse", "JE/2 in 2B at 5% (180 on 3,600): matched, \"5% tour operator rate: no ITC\", not taken (Reverse / do not take)");
  ok(r3.kind === "pair" && r3.status === "diff" && r3.rateUnknown, "JE/3 with no GST rate in 2B either (180 on 7,000): Amount differs, rate unknown");
  ok(r4.noItc && !r4.e.C && r5.rateUnknown, "JE/4 (5% in the books, not in 2B): no ITC; JE/5 (not in 2B, no rate): rate unknown");
  const jun = T("202606");
  ok(near(tax(jun.other), 180) && near(tax(jun.held), 180 + 180 + 100 + 180), "June 4(A)(5): JE/1 180 taken; JE/2 and JE/4 (5%), JE/3 (rate unknown) and JE/5 (not in 2B) not until decided (" + tax(jun.other) + ", held " + tax(jun.held) + ")");
  ok(inMonth("202606", "JE/3").show.code === "follow", "JE/3, rate unknown: Follow up (FinCom's rule), to be decided");
  decide("JE/3", "now", "", "202606");
  ok(near(tax(T("202606").other), 360), "JE/3 decided Take now: June + 180");
}
console.log(fails ? "\n" + fails + " FAILED" : "\nall ok"); process.exit(fails ? 1 : 0);
