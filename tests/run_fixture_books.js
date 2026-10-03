// node run_fixture_books.js - the made-up books in tests/fixtures/books through the app, against the figures worked out by
// hand in tests/fixtures/books/EXPECTED.md: how the files are read, the profit and loss, the balance sheet, receivables
// and payables by age, week 1 of the 13-week forecast, the cash flow's GST lines and GST by month. Runs whether or not a
// real client's export is in tests/data: it always reads the fixture.
const fs = require("fs"), path = require("path"), {load, openBlob, HTML, FIXTURE_DIR} = require("./harness");
// the fixture's day book as the app reads it: the harness keeps it up to date in fixture mode; with a real export here, made now
const CACHE = (() => { const h = require("./harness"); if (!h.FIXTURE) require("child_process").execFileSync(process.execPath, [path.join(__dirname, "fixture_cache.js"), h.FIXTURE_CACHE], {stdio: "inherit"}); return h.FIXTURE_CACHE; })();
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "Parties", "FS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "GSTSet", "GSTF", "GSTQ", "choiceSplit", "choiceAcc", "choiceLegacy", "choiceDerive", "choiceRec", "choiceGet", "choiceUsable"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const eq = (a, b, w) => ok(Math.abs((+a || 0) - b) < 0.01, w + ": " + a + (Math.abs((+a || 0) - b) < 0.01 ? "" : " (by hand " + b + ")"));
const same = (a, b, w) => ok(JSON.stringify(a) === JSON.stringify(b), w + ": " + JSON.stringify(a) + (JSON.stringify(a) === JSON.stringify(b) ? "" : " (by hand " + JSON.stringify(b) + ")"));
(async () => {
  const {ctx, x} = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(path.join(FIXTURE_DIR, "Master.xml")));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, gstins: ms.gstins, pans: ms.pans, states: ms.states, challans: [], alloc: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.S.coId = "t";
  // the client record, for the per-ledger choices of round 4 (co.choices["flow:<ledger>"])
  ctx.S.companies = {t: {id: "t", name: "Larkspur Fixture Events Private Limited", gstin: "07AAGCL4827M1Z3", choices: {}}};
  ctx.CO = () => ctx.S.companies.t;
  x.LedMaster.refresh(b);
  const ORCHID = "Orchid Lane Hospitality Pvt Ltd (Noida)", QUILL = "Quillfeather Weddings LLP";
  console.log("reading the files");
  ok(b.vouchers.length === 77 && b.meta.from === "20250401" && b.meta.to === "20260331", "77 entries, 01-Apr-2025 to 31-Mar-2026");
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
  eq(r.sales.total, 1550000, "revenue from operations"); eq(H("oth"), 9200, "other income: interest 4,200 and the excess credit in finance costs 5,000"); eq(H("dir"), 610000, "direct expenses"); eq(H("emp"), 180000, "employee costs");
  eq(H("exp"), 314650, "other expenses: 3,22,150 less the 7,500 written back"); eq(H("fin"), 0, "finance costs: in credit, so nil"); eq(H("dep"), 60000, "depreciation"); eq(r.pl.income.t, 1559200, "total income"); eq(r.pl.gross.t, 940000, "gross profit"); eq(r.pl.pbt.t, 394550, "profit before tax");
  // the owner's rule (MIS.plRule): (a) a credit smaller than its head stays in it; (b) a head that ends in credit is nil, the rest in other income
  const led = (k, l) => ((r.pl.heads[k] || {led: []}).led.find(z => z.l === l) || {});
  ok(led("exp", "Sundry Balances Written Off").t === -7500 && led("exp", "Sundry Balances Written Off").flag === "expense ledger with a credit balance" && !led("oth", "Sundry Balances Written Off").l,
    "(a) Sundry Balances Written Off (7,500 Cr) set off in other expenses, flagged; not in other income");
  ok(led("fin", "Loan Processing Fees").t === -25000 && led("fin", "Loan Processing Fees").flag === "expense ledger with a credit balance" && led("fin", "Excess credit moved to Other income").t === 5000,
    "(b) Loan Processing Fees (25,000 Cr) against interest 20,000: finance costs nil, the set-off line 5,000");
  ok(led("oth", "Excess credit in Finance costs").t === 5000 && led("oth", "Excess credit in Finance costs").from === "fin", "(b) other income: Excess credit in Finance costs 5,000");

  // finding 3 (EXPECTED.md), fixed on 02-Oct-2026: the cost centres by the same rule
  const C = r.p2.cc, ccInc = C.rows.reduce((a, z) => a + z.inc, 0) + C.un.inc, ccExp = C.rows.reduce((a, z) => a + z.exp, 0) + C.un.exp;
  eq(ccInc, 1559200, "FINDING 3: profit by cost centre, income allocated or not"); eq(ccExp, 1164650, "FINDING 3: profit by cost centre, expenses allocated or not");
  same(C.rows.map(z => [z.name, z.inc, z.exp, z.profit]), [["Weddings", 1000000, 300000, 700000], ["Corporate", 550000, 50000, 500000]], "cost centres: Weddings and Corporate");
  ok(C.un.inc === 9200 && C.un.exp === 814650 && C.un.moved === 5000, "not allocated: income 9,200 (with the excess credit 5,000), expenses 8,14,650");

  console.log("balance sheet (Accounts)");
  const d = x.FS.build("2025"), P = k => d.put[k] || 0;
  ok(!d.error, "the statements are built from the masters' opening balances" + (d.error ? ": " + d.error : ""));
  eq(d.pbt, 394550, "profit before tax"); eq(d.inc, 1559200, "total income"); eq(d.exp, 1164650, "total expenses"); eq(d.pl.exp, 924650, "other expenses (direct expenses included)"); eq(d.pl.oth, 9200, "other income"); eq(d.pl.fin, 0, "finance costs nil");
  ok(JSON.stringify(d.plSum.fin) === JSON.stringify({dr: 20000, cr: 25000, moved: 5000, t: 0, label: "Finance costs"}) && JSON.stringify(d.plSet.oth) === JSON.stringify([["Excess credit in Finance costs", 5000, "fin"]]), "the accounts: finance costs 20,000 less credits 25,000; 5,000 to other income");
  ok(d.plSum.exp.dr === 932150 && d.plSum.exp.cr === 7500 && !d.plSet.exp, "the accounts: other expenses 9,32,150 less the 7,500 written back, nothing moved");
  const html = x.FS.html(d), noteFin = html.slice(html.indexOf(". Finance costs</h3>"), html.indexOf("</table>", html.indexOf(". Finance costs</h3>")));
  ok(/Loan Processing Fees <span class="tag warn" data-fs-flag="">expense ledger with a credit balance<\/span><\/td><td class="n">-25,000.00/.test(noteFin) && /Less: credit balances set off in the head<\/td><td class="n">-25,000.00/.test(noteFin) && /data-fs-moved><td class="note">Excess credit moved to Other income<\/td><td class="n">5,000.00/.test(noteFin) && /Total<\/b><\/td><td class="n"><b>0.00/.test(noteFin),
    "the note to finance costs: each ledger (the credit negative, flagged), the set-off, the excess moved and a total of nil");
  ok(/data-fs-excess="fin"><td class="note">Excess credit in Finance costs<\/td><td class="n">5,000.00/.test(html), "the note to other income says which head the 5,000 came from");
  eq(P("share"), 1000000, "share capital"); eq(P("reserves"), -405450, "reserves and surplus"); eq(P("ltb"), 368000, "long-term borrowings (with the director's loan 50,000)"); eq(P("tp"), 322400, "trade payables"); eq(P("ocl"), 268400, "other current liabilities");
  eq(P("ppe"), 190000, "property, plant and equipment"); eq(P("intang"), 100000, "intangible assets"); eq(P("tr"), 718200, "trade receivables"); eq(P("cash"), 231750, "cash and cash equivalents"); eq(P("stla"), 313400, "short-term loans and advances (with the staff loan 50,000)");
  eq(d.eqL, 1553350, "equity and liabilities"); eq(d.assets, 1553350, "assets");
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
  // finding 2 (EXPECTED.md), fixed on 02-Oct-2026: March's TDS is due on 30 April, not 7 April
  eq(w1.out, 352400, "FINDING 2: week 1 out"); eq(w1.net, 207400, "FINDING 2: week 1 net");
  ok(!w1.items.some(z => z.what === "TDS") && r.p2.fc.weeks.some(w => w.items.some(z => z.what === "TDS" && z.d === "20260430")), "FINDING 2: March's TDS is due on 30 April, not in week 1");

  console.log("cash flow");
  const line = l => (r.p2.cash.rows.find(z => z.lab === l) || {t: 0}).t;
  eq(line("GST"), -86600, "GST paid from the bank"); eq(line("Input GST paid with bills"), -3600, "input IGST paid from the bank, a line of its own");
  eq(line("Received from customers"), 1291800, "received from customers"); eq(line("Paid to suppliers"), -869400, "paid to suppliers");
  // finding 5 (EXPECTED.md), fixed on 02-Oct-2026 by the owner's rule: the cash flow's line comes from the ledger's Tally
  // group (MIS.flowGroup), never from words in its name. Loan Processing Fees and Staff Loan Processing Fee Refund are
  // under Indirect Expenses: their refunds are expenses refunded, not "Loans" (nor "Salaries and staff")
  eq(line("Expenses refunded or recovered"), 29500, "FINDING 5: expenses refunded (the travel refund 3,000, the processing fee 25,000, the staff loan fee 1,500)");
  const onLine = (lab, l) => ((r.p2.cash.rows.find(z => z.lab === lab) || {led: {}}).led[l]);
  ok(!r.p2.cash.rows.some(z => z.lab === "Loans") && !r.p2.cash.rows.some(z => z.sec === "fin"), "FINDING 5: no \"Loans\" line and nothing under financing: no loan was taken or repaid in cash");
  ok(onLine("Expenses refunded or recovered", "Staff Loan Processing Fee Refund") === 1500 && onLine("Expenses paid", "Staff Loan Processing Fee Refund") === -1500 && !r.p2.cash.rows.some(z => z.lab !== "Expenses refunded or recovered" && z.lab !== "Expenses paid" && z.led["Staff Loan Processing Fee Refund"] != null),
    "FINDING 5: Staff Loan Processing Fee Refund (Indirect Expenses): 1,500 refunded, 1,500 paid, on no other line");
  ok(onLine("Expenses refunded or recovered", "Loan Processing Fees") === 25000, "FINDING 5: Loan Processing Fees' refund of 25,000 under expenses refunded");
  ok(x.MIS.flowHead("Hemant Zaverchand (Loan)").join() === "fin,Loans" && x.MIS.flowHead("Laptops and Computers").join() === "inv,Fixed assets" && x.MIS.flowHead("Share Capital").join() === "fin,Capital and drawings" && x.MIS.flowHead("Security Deposit - Office Rent").join() === "op,Loans and advances (asset)",
    "by group: Unsecured Loans on Loans, Fixed Assets on Fixed assets, Capital Account on Capital and drawings, Loans & Advances (Asset) under operating");
  eq(line("Expenses paid"), -136450, "expenses paid (travel 12,000, rent 1,20,000, printing 2,500 in cash, the staff loan fee 1,500, interest on TDS 450)");
  eq(line("TDS and TCS"), -11200, "TDS and TCS (1,200 + 10,000; interest on TDS, an expense ledger, is in expenses paid)");
  eq(r.p2.cash.net, 38050, "net change in cash and bank"); ok(r.p2.cash.ties, "opening + change = closing");
  // round 4 (03-Oct-2026), the owner's rules 26-29 (EXPECTED.md, "Cash flow"): decided by Tally's group first
  ok(x.MIS.V >= 8, "MIS.V bumped for the rules of round 4 (" + x.MIS.V + ")");
  eq(line("Salaries and staff"), -179000, "27. salaries: Staff Salaries 1,35,000 by its group + Salary Payable 44,000 (directly under Current Liabilities, by its name)");
  ok(onLine("Salaries and staff", "Salary Payable") === -44000 && x.MIS.flowHead("Salary Payable").join() === "op,Salaries and staff,name", "27. Salary Payable: Salaries and staff, flagged as decided by the name");
  eq(line("Other receipts and payments"), -1000, "27. ESI Payable - Employees Share under the sub-group \"Statutory dues\": the sub-group decides (no staff word in it), so Other receipts and payments, not flagged");
  ok(x.MIS.flowHead("ESI Payable - Employees Share").join() === "op,Other receipts and payments", "27. ESI under Statutory dues: by the sub-group, no flag (" + x.MIS.flowHead("ESI Payable - Employees Share").join() + ")");
  eq(line("Partners' accounts"), 50000, "28. the loan from Devika Larkspur: her sub-group under Loans (Liability) matches her Capital Account ledger, so Partners' accounts (financing)");
  ok(x.MIS.flowHead("Devika Larkspur - Loan").join() === "fin,Partners' accounts,partner" && x.MIS.flowHead("Hemant Zaverchand (Loan)").join() === "fin,Loans", "28. flagged as the partner match; Hemant's loan (Unsecured Loans) stays on Loans");
  eq(line("Loans and advances (asset)"), -50000, "26. the staff loan given: Loans and advances (asset), operating, by default (no mark)");
  eq(r.p2.cash.op.t, -11950, "operating: 38,050 less the 50,000 lent"); eq(r.p2.cash.fin.t, 50000, "financing: the 50,000 from the director"); eq(r.p2.cash.inv.t, 0, "investing: nothing without a mark");
  const notes = x.MIS.flowNotes(ctx.S.companies.t);
  same(notes.map(n => [n.ledger, n.line]).sort(), [["Devika Larkspur - Loan", "Partners' accounts"], ["Salary Payable", "Salaries and staff"]], "29. grouping notes: the two ledgers decided by a name word or the partner match, no other");
  ok(notes.every(n => n.group && n.why) && /name/.test(notes.find(n => n.ledger === "Salary Payable").why) && /partner|Capital/.test(notes.find(n => n.ledger === "Devika Larkspur - Loan").why), "29. each note says the Tally group and why (" + JSON.stringify(notes) + ")");
  same((r.p2.cash.notes || []).map(n => n.ledger).sort(), ["Devika Larkspur - Loan", "Salary Payable"], "29. the cash flow carries the notes for the ledgers that moved");
  // 26. the owner's mark "Loan given" on the Mapping tab: a confirmed choice; a guess is never one
  const K = "flow:Loan to Staff - Ravi Menon";
  ctx.S.companies.t.choices[K] = {value: "loan_given", state: "guessed", by: "FinCom", at: "2026-10-03T00:00:00Z"};
  ok(x.MIS.flowHead("Loan to Staff - Ravi Menon").join() === "op,Loans and advances (asset)", "26. a guessed mark counts for nothing: still operating");
  ctx.S.companies.t.choices[K] = {value: "loan_given", state: "confirmed", by: "the owner", at: "2026-10-03T00:00:00Z"};
  ok(x.MIS.flowHead("Loan to Staff - Ravi Menon").join() === "inv,Loans given,mark", "26. marked Loan given: investing, Loans given, flagged as a mark");
  const r4 = x.MIS.cashActual("20250401", "20260331"), l4 = l => (r4.rows.find(z => z.lab === l) || {t: 0}).t;
  eq(l4("Loans given"), -50000, "26. with the mark: Loans given -50,000 under investing"); ok(!r4.rows.some(z => z.lab === "Loans and advances (asset)"), "26. and nothing left on Loans and advances (asset)");
  eq(r4.inv.t, -50000, "investing -50,000"); eq(r4.op.t, 38050, "operating 38,050"); eq(r4.net, 38050, "the net unchanged"); ok(r4.ties, "opening + change = closing");
  same(r4.notes.map(n => n.ledger).sort(), ["Devika Larkspur - Loan", "Loan to Staff - Ravi Menon", "Salary Payable"], "29. the mark is a grouping note too");
  ok(x.MIS.basis(b) !== (delete ctx.S.companies.t.choices[K], x.MIS.basis(b)), "a mark changes the MIS basis, so the MIS knows it is stale");

  console.log("GST by month");
  const want = {"202504": [72000, 0, 0, 72000, 0], "202505": [0, 36000, 0, 0, 72000], "202506": [27000, 3600, 0, 5400, 0], "202507": [18000, 14400, 0, 0, 5400], "202508": [9000, 21600, 0, 0, 0],
    "202509": [21600, 39600, 0, 0, 0], "202510": [54000, 0, 0, 9000, 0], "202511": [14400, 10800, 0, 3600, 0], "202512": [0, 0, 0, 0, 0], "202601": [36000, 30600, 3600, 9000, 0], "202602": [0, 11000, 5600, 5600, 3600], "202603": [23000, 10800, 10800, 12000, 5600]};
  // finding 1 (EXPECTED.md), fixed on 02-Oct-2026: each registration worked out on its own (MIS.gst3b)
  r.comp.gst.forEach(g => same([g.out, g.itc, g.rcm, g.due, g.pay], want[g.ym], (["202506", "202510"].includes(g.ym) ? "FINDING 1: " : "") + g.ym + ": output, credit, RCM, to pay, paid"));
  eq(r.comp.gst.reduce((a, g) => a + g.due, 0), 116600, "worked out to pay for the year");
  eq(r.comp.gst.reduce((a, g) => a + g.pay, 0), 86600, "paid from the bank for the year");
  const tm = x.GSTR.threeB("202603", "07");
  same([tm.net.igst, tm.net.cgst, tm.net.sgst, tm.rcmOut.taxable, tm.rcmOut.igst, tm.rcmOut.cgst, tm.rcmOut.sgst], [9000, 7000, 7000, 60000, 7200, 1800, 1800], "Mar-2026, 07: output IGST 9,000, CGST 7,000, SGST 7,000; reverse charge on 60,000: IGST 7,200 (advocate), CGST 1,800 and SGST 1,800 (godown rent)");
  same([tm.pay.cash.igst, tm.pay.cash.cgst, tm.pay.cash.sgst, tm.pay.carry.cgst, tm.pay.carry.sgst], [8400, 1800, 1800, 0, 0], "Mar-2026, 07: cash 12,000 (IGST 1,200 after credit + reverse charge 10,800); no credit left");
  const rcY = x.GSTR.months().reduce((a, m) => { const q = x.GSTR.threeB(m, "07").rcmOut; return [a[0] + q.taxable, a[1] + q.igst, a[2] + q.cgst, a[3] + q.sgst]; }, [0, 0, 0, 0]);
  same(rcY, [140000, 7200, 6400, 6400], "reverse charge for the year, 07: on 1,40,000 (freight 40,000, rent 60,000, advocate 40,000)");
  same(x.GSTR.inward("202603", "07").map(z => [z.party, z.taxable, z.igst, z.cgst, z.sgst, z.rcm]), [["Keshav Rathore, Advocate", 40000, 7200, 0, 0, true], ["Rukmini Sethuraman", 20000, 0, 1800, 1800, true]], "Mar-2026 input register, 07: the advocate and the rent journal, both reverse charge");
  const j = x.GSTR.toJson("202603", "07", {plain: true}), w16 = (j.b2b || []).flatMap(g => g.inv).find(i => i.inum === "LFE/25-26/016");
  same(w16 && w16.itms.map(z => [z.itm_det.rt, z.itm_det.txval, z.itm_det.camt, z.itm_det.samt]), [[5, 100000, 2500, 2500], [18, 50000, 4500, 4500]], "GSTR-1, Mar-2026: LFE/25-26/016 as two items, 5% and 18%");
  same((j.hsn.hsn_b2b || []).map(h => [h.hsn_sc, h.rt, h.txval, h.iamt, h.camt, h.samt]), [["998596", 18, 100000, 9000, 4500, 4500], ["6304", 5, 100000, 0, 2500, 2500]], "HSN summary, B2B, Mar-2026");
  b.rule37On = {"07": true}; const r37 = x.GSTR.threeB("202511", "07").r37; b.rule37On = {};
  same(r37 && [r37.rev.cgst, r37.rev.sgst, r37.rev.list.map(z => [z.party, z.ref])], [9000, 9000, [["Nightjar Sound & Light Co", "NSL/112"]]], "rule 37, Nov-2025: NSL/112 half unpaid 180 days after 08-May-2025: CGST 9,000 and SGST 9,000 reversed");
  const t09 = x.GSTR.threeB("202506", "09"), t07j = x.GSTR.threeB("202506", "07");
  ok(t09.pay.cash.cgst === 2700 && t09.pay.cash.sgst === 2700 && t07j.adv.cgst === 9000, "Jun-2025: UP pays 5,400; Delhi's 11A on the advance is 9,000 + 9,000");
  ok(x.GSTR.threeB("202507", "07").adv.cgst === -9000 && x.GSTR.threeB("202508", "07").adv.cgst === 4500 && x.GSTR.threeB("202509", "07").adv.igst === 0, "11B in July; Zinnia's advance with no invoice in August; same-month advance in September: none");
  const tr = r.comp.tdsRoll;
  ok(tr && tr.open === 1200 && tr.ded === 20000 && tr.paid === 11200 && tr.close === 10000 && tr.ties, "TDS: 1,200 + 20,000 - 11,200 = 10,000, as the ledgers");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
