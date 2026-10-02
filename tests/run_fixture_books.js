// node run_fixture_books.js - the made-up books in tests/fixtures/books through the app, against the figures worked out by
// hand in tests/fixtures/books/EXPECTED.md: how the files are read, the profit and loss, the balance sheet, receivables
// and payables by age, week 1 of the 13-week forecast, the cash flow's GST lines and GST by month. Runs whether or not a
// real client's export is in tests/data: it always reads the fixture.
const fs = require("fs"), path = require("path"), {load, openBlob, HTML, FIXTURE_DIR} = require("./harness");
// the fixture's day book as the app reads it: the harness keeps it up to date in fixture mode; with a real export here, made now
const CACHE = (() => { const h = require("./harness"); if (!h.FIXTURE) require("child_process").execFileSync(process.execPath, [path.join(__dirname, "fixture_cache.js"), h.FIXTURE_CACHE], {stdio: "inherit"}); return h.FIXTURE_CACHE; })();
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "Parties", "FS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "GSTSet", "GSTF", "GSTQ"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const eq = (a, b, w) => ok(Math.abs((+a || 0) - b) < 0.01, w + ": " + a + (Math.abs((+a || 0) - b) < 0.01 ? "" : " (by hand " + b + ")"));
const same = (a, b, w) => ok(JSON.stringify(a) === JSON.stringify(b), w + ": " + JSON.stringify(a) + (JSON.stringify(a) === JSON.stringify(b) ? "" : " (by hand " + JSON.stringify(b) + ")"));
(async () => {
  const {ctx, x} = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(path.join(FIXTURE_DIR, "Master.xml")));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, gstins: ms.gstins, pans: ms.pans, states: ms.states, challans: [], alloc: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.S.coId = "t";
  ctx.CO = () => ({name: "Larkspur Fixture Events Private Limited", gstin: "07AAGCL4827M1Z3"});
  x.LedMaster.refresh(b);
  const ORCHID = "Orchid Lane Hospitality Pvt Ltd (Noida)", QUILL = "Quillfeather Weddings LLP";
  console.log("reading the files");
  ok(b.vouchers.length === 61 && b.meta.from === "20250401" && b.meta.to === "20260331", "61 entries, 01-Apr-2025 to 31-Mar-2026");
  same(b.meta.gstins.slice().sort(), ["07AAGCL4827M1Z3", "09AAGCL4827M1ZZ"], "the company's two registrations, from CMPGSTIN");
  ok(ms.info[ORCHID] && b.vouchers.some(v => v.party === ORCHID) && !Object.keys(ms.info).some(n => /&#|\r|\n/.test(n)), "a name with a line break (&#13;&#10;) reads the same in the masters and the day book");
  ok(ms.info[ORCHID].gstin === "09AACCO6624H1ZC" && ms.info[ORCHID].pan === "" && ms.info[ORCHID].panFrom === "GSTIN", "a GSTIN in TallyPrime's dated registration details; the PAN taken from it");
  ok(ms.info["Nightjar Sound & Light Co"].msme === "Micro" && ms.info["Nightjar Sound & Light Co"].ob === 30000, "an ampersand in a name; Udyam details read as MSME; an opening credit positive");
  ok(ms.under["Profit & Loss A/c"] === "Primary" && ms.groupInfo["Employee Benefit Expenses"].rev && ms.groupInfo["Employee Benefit Expenses"].dr, "Profit & Loss A/c under Primary; the company's own primary group of expenses");
  const v8 = b.vouchers.find(v => v.no === "LFE/25-26/008"), atc = b.vouchers.find(v => v.ref === "ATC/56"), cx = b.vouchers.find(v => v.no === "LFE/25-26/004");
  ok(v8 && JSON.stringify(v8.ent[0].b) === JSON.stringify([["OL/ADV/9", "Agst Ref", -70800], ["LFE/25-26/008", "New Ref", -70800, 45]]), "an invoice's bills: the advance used and the new bill with its 45 credit days");
  ok(atc && atc.rcm && x.Books.isRcm(atc), "a reverse-charge bill");
  ok(cx && cx.cancel && !cx.ent.length, "a cancelled invoice kept, with no entries");
  ok(b.vouchers.find(v => v.no === "LFE/25-26/001").ent.find(e => e.l === "Sale of Decor Goods").c[0][1] === "Weddings", "cost centres on a sales line");

  console.log("profit and loss (MIS)");
  const r = x.MIS.run("20250401", "20260331", "test"), H = k => (r.pl.heads[k] || {t: 0}).t;
  eq(r.sales.total, 1400000, "revenue from operations"); eq(H("oth"), 11700, "other income"); eq(H("dir"), 610000, "direct expenses"); eq(H("emp"), 180000, "employee costs");
  eq(H("exp"), 222150, "other expenses"); eq(H("fin"), 20000, "finance costs"); eq(H("dep"), 60000, "depreciation"); eq(r.pl.gross.t, 790000, "gross profit"); eq(r.pl.pbt.t, 319550, "profit before tax");
  ok((r.pl.heads.oth.led.find(z => z.l === "Sundry Balances Written Off") || {}).flag === "expense ledger with a credit balance", "the expense ledger in credit is under other income, flagged");

  console.log("balance sheet (Accounts)");
  const d = x.FS.build("2025"), P = k => d.put[k] || 0;
  ok(!d.error, "the statements are built from the masters' opening balances" + (d.error ? ": " + d.error : ""));
  eq(d.pbt, 319550, "profit before tax"); eq(d.inc, 1411700, "total income"); eq(d.exp, 1092150, "total expenses"); eq(d.pl.exp, 832150, "other expenses (direct expenses included)"); eq(d.pl.oth, 11700, "other income");
  eq(P("share"), 1000000, "share capital"); eq(P("reserves"), -480450, "reserves and surplus"); eq(P("ltb"), 318000, "long-term borrowings"); eq(P("tp"), 322400, "trade payables"); eq(P("ocl"), 243600, "other current liabilities");
  eq(P("ppe"), 190000, "property, plant and equipment"); eq(P("intang"), 100000, "intangible assets"); eq(P("tr"), 718200, "trade receivables"); eq(P("cash"), 149950, "cash and cash equivalents"); eq(P("stla"), 245400, "short-term loans and advances");
  eq(d.eqL, 1403550, "equity and liabilities"); eq(d.assets, 1403550, "assets");
  const pyE = d.lines.filter(z => ["EQ", "NCL", "CL"].includes(z[2])).reduce((a, z) => a + (d.py[z[0]] || 0), 0), pyA = d.lines.filter(z => ["NCA", "CA"].includes(z[2])).reduce((a, z) => a + (d.py[z[0]] || 0), 0);
  eq(pyE, 538700, "last year's column, equity and liabilities"); eq(pyA, 538700, "last year's column, assets");
  same(d.fa.map(f => [f.l, f.k, f.open, f.add, f.del, f.close]), [["Event Software Licence", "intang", 0, 120000, 20000, 100000], ["Laptops and Computers", "ppe", 150000, 80000, 40000, 190000]], "fixed assets, the intangible one on its own line");

  console.log("receivables and payables");
  eq(r.owed.r, 718200, "trade receivables (customers in debit)"); eq(r.owed.custAdv, 59000, "advances received from customers"); eq(r.owed.p, 322400, "trade payables"); eq(r.owed.supAdv, 25000, "advances paid to suppliers");
  same(r.recv.sum.nb, [59000, 236000, 0, 264800, 59000], "receivables by age: 0-30, 31-60, 61-90, 91-180, over 180"); eq(r.recv.sum.und, 99400, "receivables not bill-wise");
  eq(r.recv.sum.nb.reduce((a, v) => a + v, 0) + r.recv.sum.und, 718200, "the ages and not bill-wise add up to the ledger balances");
  const q = r.recv.rows.find(p => p.party === QUILL), o = r.recv.rows.find(p => p.party === ORCHID), br = r.recv.rows.find(p => p.party === "Brindle Corporate Travels");
  same(q && q.open.map(z => [z.ref, z.left]), [["LFE/25-26/010", 194000], ["LFE/25-26/013", 236000]], "Quillfeather: on account and advance set against the oldest bill");
  ok(o && o.und === 30000 && br && br.und === 69400, "Orchid Lane: 30,000 of an opening bill not bill-wise; Brindle (bill-wise off): all 69,400");
  same(r.pay.sum.nb, [0, 206400, 0, 0, 116000], "payables by age"); eq(r.pay.sum.und, 0, "payables not bill-wise");
  same(r.msme.map(z => [z.party, z.amt]), [["Nightjar Sound & Light Co", 290000]], "MSME suppliers unpaid beyond 45 days");

  console.log("13-week forecast, week 1 (01-Apr-2026 to 07-Apr-2026)");
  const w1 = r.p2.fc.weeks[0];
  ok(w1.from === "20260401" && w1.to === "20260407", "week 1 runs 01-Apr to 07-Apr");
  eq(w1.inn, 559800, "week 1 in");
  // FINDING 2 (EXPECTED.md, findings): MIS.forecast puts March's TDS on 7 April; it is due on 30 April. Until that is
  // fixed, week 1 out is 3,54,400 (2,000 too much) and these three checks fail
  eq(w1.out, 352400, "FINDING 2: week 1 out"); eq(w1.net, 207400, "FINDING 2: week 1 net");
  ok(!w1.items.some(z => z.what === "TDS") && r.p2.fc.weeks.some(w => w.items.some(z => z.what === "TDS" && z.d === "20260430")), "FINDING 2: March's TDS is due on 30 April, not in week 1");

  console.log("cash flow");
  const line = l => (r.p2.cash.rows.find(z => z.lab === l) || {t: 0}).t;
  eq(line("GST"), -79400, "GST paid from the bank"); eq(line("Input GST paid with bills"), -3600, "input IGST paid from the bank, a line of its own");
  eq(line("Expenses refunded or recovered"), 3000, "an expense refund"); eq(r.p2.cash.net, -43750, "net change in cash and bank"); ok(r.p2.cash.ties, "opening + change = closing");

  console.log("GST by month");
  const want = {"202504": [72000, 0, 0, 72000, 0], "202505": [0, 36000, 0, 0, 72000], "202506": [27000, 3600, 0, 5400, 0], "202507": [18000, 14400, 0, 0, 5400], "202508": [9000, 21600, 0, 0, 0],
    "202509": [21600, 39600, 0, 0, 0], "202510": [54000, 0, 0, 9000, 0], "202511": [14400, 10800, 0, 3600, 0], "202512": [0, 0, 0, 0, 0], "202601": [36000, 27000, 0, 9000, 0], "202602": [0, 7400, 2000, 2000, 0], "202603": [9000, 0, 0, 1600, 2000]};
  // FINDING 1 (EXPECTED.md, findings): MIS.compliance works out one 3B for both registrations together, setting Delhi's
  // credit against UP's tax; until that is fixed Jun-2025 shows 0 to pay (by hand 5,400) and Oct-2025 14,400 (by hand 9,000)
  r.comp.gst.forEach(g => same([g.out, g.itc, g.rcm, g.due, g.pay], want[g.ym], (["202506", "202510"].includes(g.ym) ? "FINDING 1: " : "") + g.ym + ": output, credit, RCM, to pay, paid"));
  eq(r.comp.gst.reduce((a, g) => a + g.due, 0), 102600, "worked out to pay for the year");
  const t09 = x.GSTR.threeB("202506", "09"), t07j = x.GSTR.threeB("202506", "07");
  ok(t09.pay.cash.cgst === 2700 && t09.pay.cash.sgst === 2700 && t07j.adv.cgst === 9000, "Jun-2025: UP pays 5,400; Delhi's 11A on the advance is 9,000 + 9,000");
  ok(x.GSTR.threeB("202507", "07").adv.cgst === -9000 && x.GSTR.threeB("202508", "07").adv.cgst === 4500 && x.GSTR.threeB("202509", "07").adv.igst === 0, "11B in July; Zinnia's advance with no invoice in August; same-month advance in September: none");
  const tr = r.comp.tdsRoll;
  ok(tr && tr.open === 1200 && tr.ded === 20000 && tr.paid === 11200 && tr.close === 10000 && tr.ties, "TDS: 1,200 + 20,000 - 11,200 = 10,000, as the ledgers");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
