// node run_autopost_rules.js — "Post automatically" (src/js/90-autopost.js): each rule of the plan's section 4 and each
// "never automatic" stop on its own, with made-up lines and bills shaped on the staging cases (Cloud Wizard, the AKJ
// receipt, Prince's same-PDF bills, Jitin's same-file bills and its 2023 bill, Kashi / Aadi, Fingate rent after
// electricity, Suspense lines, INSTAALERTCHG's month names); the learning rule (only a person's approvals teach; an
// automatic entry or a guess posted in bulk never does; a person's change or undo pauses the party); the setting's rights
// (only the owner loosens it). No client data.
const {load, HTML} = require("./harness");
const {x} = load(HTML, ["num", "r2", "INR", "money0", "MONTHS3", "fmtDate", "NORM_CACHE", "normName", "normNameRaw", "partyKey", "GSTIN_RE", "GST_CHARS", "gstinCheckChar", "gstinValid", "AutoPost"]);
const AP = x.AutoPost;
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const cfg = (o) => Object.assign({}, AP.DEF, {on: true}, o || {});
const env0 = (o) => Object.assign({partyKey: x.partyKey, exactLedger: (n) => n, ledgerInfo: () => null}, o || {});
let n = 0;
// a bank line: out (debit) or in (credit), its party, already decided by a person (how) and in Tally, or new
const line = (o) => Object.assign({id: "r" + (++n), fp: "fp" + n, date: "2026-05-01", debit: 0, credit: 0, narr: "", dec: {}, ledger: "", state: "suggested", userSet: false, source: ""}, o);
const done = (o, how) => line(Object.assign({state: "sent"}, o, how === "hand" ? {userSet: true, source: "you"} : how === "confirm" ? {userSet: true, source: "history"} : how === "rule" ? {source: "rule"} : how === "auto" ? {source: "auto", auto: {run: "x"}} : {source: "history"}));
const BK = (d) => ({key: "name:bharatkosh", name: "BHARATKOSH", mode: "OTHER"});
const check = (r, prior, o, e) => AP.bankCheck(r, {cfg: cfg(o), idx: AP.bankIndex(prior, {}, env0(e)), env: env0(e)});

console.log("== bank rules");
let P = [done({debit: 1000, narr: "SZ0IP6Q0XDIQK0/BHARATKOSH", dec: BK(), ledger: "MCA EXPENSE", date: "2026-04-03"}, "rule")];
let m = check(line({debit: 1000, narr: "SB0HCURB2HRMQG/BHARATKOSH", dec: BK(), date: "2026-04-08"}), P);
ok(m.ok && m.rule === "B1" && m.conf === "High" && m.ledger === "MCA EXPENSE", "B1 same line again: BHARATKOSH ₹1,000 → MCA EXPENSE, High (" + m.rule + " " + m.why + ")");
ok(/Auto · rule: BHARATKOSH → MCA EXPENSE/.test(AP.chipWords(m)) && /Copied from your approval/.test(AP.tipWords(m)), "the chip says “Auto · rule: BHARATKOSH → MCA EXPENSE”, the hover the approval it copied");
m = check(line({debit: 1001, narr: "X/BHARATKOSH", dec: BK()}), P);
ok(m.ok && m.rule === "B1", "B1 within ±₹1 of a precedent");
m = check(line({debit: 143, narr: "Y/BHARATKOSH", dec: BK()}), P);
ok(!m.ok && /differs from the one earlier approval/.test(m.why), "a different amount with one precedent waits (" + m.why + ")");
P = P.concat([done({debit: 2090, narr: "Q/BHARATKOSH", dec: BK(), ledger: "MCA EXPENSE", date: "2026-04-17"}, "rule")]);
m = check(line({debit: 1710, narr: "Z/BHARATKOSH", dec: BK()}), P);
ok(!m.ok && m.rule === "B2" && m.conf === "Medium" && /only the same amount/.test(m.why), "B2 (amount varies, two precedents) is Medium: waits by default (" + m.why + ")");
m = check(line({debit: 1710, narr: "Z/BHARATKOSH", dec: BK()}), P, {bankAmounts: "within"});
ok(m.ok && m.rule === "B2", "B2 posts when the owner chose “any amount within the limit”");
m = check(line({debit: 3200, narr: "Z/BHARATKOSH", dec: BK()}), P, {bankAmounts: "within"});
ok(!m.ok && /1\.5 times/.test(m.why), "B2 refuses more than 1.5 × the largest precedent (" + m.why + ")");
// B3 bank charges: out, any amount up to ₹5,000 once a person approved that kind of charge
const imps = (a, d) => ({debit: a, narr: "IMPS P2P 61" + d + "#13/04/2026-EPR27116712617" + d, dec: {key: "narr:imps p p epr", mode: "IMPS"}});
m = check(line(imps(5.9, 2)), [done(Object.assign(imps(2.96, 1), {ledger: "Office Expenses"}), "rule")]);
ok(m.ok && m.rule === "B3" && m.conf === "High", "B3 bank charges: IMPS P2P …EPR, another amount, High (" + m.rule + ")");
m = check(line(Object.assign(imps(6200, 2), {})), [done(Object.assign(imps(2.96, 1), {ledger: "Office Expenses"}), "rule")]);
ok(!m.ok, "B3 stops above ₹5,000");
// INSTAALERTCHG: month names stripped from the key (JANMAR26, APRAPR26 …)
const alert = (mon, a) => ({debit: a, narr: mon + " INSTAALERTCHG 3 SMS-CDT2614339757187", dec: {key: "name:" + mon.toLowerCase() + "instaalertchg3sms", name: mon + " INSTAALERTCHG 3 SMS", mode: "CHARGES"}});
ok(AP.bankKey(line(alert("JANMAR26", 0.7))) === AP.bankKey(line(alert("APRAPR26", 0.24))) && AP.bankKey(line(alert("MAYMAY26", 1))) === "name:instaalertchgsms", "INSTAALERTCHG: JANMAR26 and APRAPR26 are one key (" + AP.bankKey(line(alert("JANMAR26", 0.7))) + ")");
m = check(line(alert("APRAPR26", 17.7)), [done(Object.assign(alert("JANMAR26", 4.13), {ledger: "Bank Charges"}), "hand")]);
ok(m.ok && m.rule === "B3" && m.ledger === "Bank Charges", "a month's SMS charges follow the person's approval of another month's (B3)");
ok(AP.bankKey(line({dec: {key: "name:rajkumar", name: "Raj Kumar"}})) === "name:rajkumar" && AP.bankKey(line({dec: {key: "name:kumar", name: "KUMAR"}})) === "name:kumar", "a name ending in a month's letters (KUMAR) keeps its key");
// B4 GST challan: needs a precedent, never Suspense
const gib = (a) => ({debit: a, narr: "GIB/002074 789209/GST /260909006 12759", dec: {key: "name:gib", name: "GIB", mode: "OTHER"}});
m = check(line(gib(25000)), [done(Object.assign(gib(25000), {ledger: "Suspense"}), "hand")]);
ok(!m.ok && /Suspense/.test(m.stops.join(" ")), "B4 GST challan whose earlier one went to Suspense (set by hand) waits (" + m.why + ")");
m = check(line(gib(25000)), [done(Object.assign(gib(25000), {ledger: "GST Cash Ledger"}), "hand")]);
ok(m.ok && m.rule === "B4", "B4 GST challan with a person's precedent to the GST ledger posts");
ok(!check(line(gib(25000)), []).ok, "B4 never without a precedent");
// B5 monthly rent a month apart
const rent = (a, d) => ({debit: a, date: d, narr: "NEFT RENT FOR OCT FINGATE ADVISORY", dec: {key: "name:fingateadvisory", name: "FINGATE ADVISORY", mode: "NEFT"}});
m = check(line(rent(23000, "2026-10-01")), [done(Object.assign(rent(23000, "2026-09-01"), {ledger: "Rent"}), "hand")]);
ok(m.ok && m.rule === "B5", "B5 rent a month after the person's approval, the same amount (" + m.rule + ")");
// B6 pays a bill a person approved
m = AP.bankCheck(line({debit: 1652, narr: "NEFT PRINTASTIGO", dec: {key: "name:printastigo", name: "PRINTASTIGO"}}), {cfg: cfg(), idx: new Map(), env: env0(),
  billFor: () => ({id: "e1", ledger: "Printastigo", amt: 1652, ref: "GST/2026-27/245", by: "anshul@…", at: "2026-10-05"})});
ok(m.ok && m.rule === "B6" && m.billId === "e1" && m.ledger === "Printastigo", "B6 a payment of a bill a person approved goes to the party, against the bill");

console.log("== bank stops");
const cwKey = {key: "name:cloudwizardconsulting", name: "CLOUD WIZARD CONSULTING PVT LTD", mode: "CHARGES"};
const cwRows = ["2026-04-07", "2026-05-06", "2026-06-03", "2026-07-08"].map((d) => done({credit: 16200, date: d, narr: "50200016049160-TPT-FEES-CLOUD WIZARD CONSULTING PVT LTD", dec: cwKey, ledger: "Bank Charges"}, "guess"));
m = check(line({credit: 16200, date: "2026-08-05", narr: "50200016049160-TPT-RETAINERAUG26-CLOUD WIZARD CONSULTING PVT", dec: cwKey}), cwRows);
ok(!m.ok && /first time/.test(m.why), "Cloud Wizard: four receipts posted on FinCom's guess teach nothing: first time (" + m.why + ")");
m = check(line({credit: 16200, date: "2026-09-05", narr: "…CLOUD WIZARD…", dec: cwKey}), cwRows.concat([done({credit: 16200, date: "2026-08-05", narr: "x", dec: cwKey, ledger: "CLOUD WIZARD CONSULTING PRIVATE LIMITED"}, "hand")]));
ok(m.ok && m.ledger === "CLOUD WIZARD CONSULTING PRIVATE LIMITED", "Cloud Wizard after the person's correction: the party's ledger (the guesses ignored)");
const cwAll = AP.bankIndex(cwRows.concat([done({credit: 16200, date: "2026-08-05", narr: "x", dec: cwKey, ledger: "CLOUD WIZARD CONSULTING PRIVATE LIMITED"}, "hand")]), {}, env0(), () => true);
m = AP.bankCheck(line({credit: 16200, narr: "…", dec: cwKey}), {cfg: cfg(), idx: cwAll, env: env0()});
ok(!m.ok && /disagree \(Bank Charges 4×, CLOUD WIZARD CONSULTING PRIVATE LIMITED 1×\)/.test(m.why), "precedents that disagree stop it: " + m.why);
const akj = {credit: 200000, narr: "INF/INFT/04 589413921 1/audit fee /AKJ REAL INF", dec: {key: "name:akjrealinf", name: "AKJ REAL INF", mode: "CHARGES"}};
m = check(line(akj), [done(Object.assign({}, akj, {ledger: "Bank Charges"}), "hand")]);
ok(!m.ok && m.stops.some((s) => /money in to an expense ledger/.test(s)) && m.stops.some((s) => /over the ₹50,000 limit/.test(s)), "AKJ audit fee receipt to Bank Charges: money in to an expense ledger, and over the limit (" + m.stops.join("; ") + ")");
m = check(line({debit: 5000, narr: "x", dec: {key: "name:incomeparty", name: "X"}}), [done({debit: 5000, narr: "x", dec: {key: "name:incomeparty", name: "X"}, ledger: "Interest Income"}, "hand")], {}, {ledgerInfo: (l) => ({group: "Indirect Incomes"})});
ok(!m.ok && /money out to an income ledger/.test(m.why), "money out to an income ledger waits (" + m.why + ")");
const mus = {debit: 25000, narr: "MMT/IMPS/6 251114394 21/BULD78 172781/Mus kan/CNRB0 002", dec: {key: "name:muskan", name: "Mus kan", mode: "IMPS"}};
m = check(line(mus), [done(Object.assign({}, mus, {ledger: "Suspense"}), "hand")]);
ok(!m.ok && /Suspense is never posted by itself/.test(m.why), "Suspense lines: never posted by themselves (" + m.why + ")");
m = check(line(mus), [done(Object.assign({}, mus, {ledger: "Ravi Branch"}), "hand")], {}, {ledgerInfo: () => ({group: "Branch / Divisions"})});
ok(!m.ok && /parking or clearing/.test(m.why), "a Branch / Divisions ledger waits");
m = check(line(mus), [done(Object.assign({}, mus, {ledger: "Old Ledger"}), "hand")], {}, {exactLedger: () => null});
ok(!m.ok && /not a ledger in Tally/.test(m.why), "a ledger not in Tally (or one FinCom would create) waits");
m = check(line(mus), [done(Object.assign({}, mus, {ledger: "Computers"}), "hand")], {}, {isFixed: () => true});
ok(!m.ok && /capital goods/.test(m.why), "a fixed-asset ledger waits (capital goods)");
m = check(line(mus), [done(Object.assign({}, mus, {ledger: "Muskan Imprest"}), "hand")], {perEntry: 20000});
ok(!m.ok && /over the ₹20,000 limit/.test(m.why), "over the per-entry limit (" + m.why + ")");
const fresh = (o) => line(Object.assign({}, mus, o));
const prec = [done(Object.assign({}, mus, {ledger: "Muskan Imprest"}), "hand")];
ok(check(fresh({}), prec).ok, "… and the same line with nothing wrong posts (the control)");
ok(!check(fresh({userSet: true}), prec).ok && /a person set or changed/.test(check(fresh({userSet: true}), prec).why), "a line a person set or changed waits (userSet)");
ok(!check(fresh({prevState: "ignored"}), prec).ok, "a line a person set aside and brought back waits (prevState)");
ok(!check(fresh({balOk: false}), prec).ok && !check(fresh({repaired: true}), prec).ok, "a misread line (running balance, ≈ amount from the balance change) waits");
ok(!check(fresh({source: "claude"}), prec).ok, "an AI suggestion waits");
m = check(fresh({}), prec, {}, {closedWhy: () => ["GSTR-3B for Sep-2026 was filed on 20-Oct-2026"]});
ok(!m.ok && /closed or filed period/.test(m.why), "a closed or filed period waits (" + m.why + ")");
m = check(fresh({}), prec, {}, {dupOf: () => "the same amount, date and party is already in Tally"});
ok(!m.ok && /possible duplicate/.test(m.why), "a possible duplicate waits");
m = check(fresh({}), prec, {}, {postWhy: () => "the Tally company to post to is not confirmed"});
ok(!m.ok && /not confirmed/.test(m.why), "the Tally company to post to not confirmed: waits");

console.log("== learning: only a person's approvals");
const k0 = {debit: 500, narr: "UPI-ZOMATO", dec: {key: "upi:zomato@hdfc", name: "ZOMATO"}};
ok(AP.rowHow(done(k0, "hand")) === "hand" && AP.rowHow(done(k0, "confirm")) === "confirm" && AP.rowHow(done(k0, "rule")) === "rule-written" && AP.rowHow(done(k0, "guess")) === "guess-posted" && AP.rowHow(done(k0, "auto")) === "auto",
  "who decided: hand, confirm, rule-written, guess-posted, auto");
ok(!check(line(k0), [done(Object.assign({}, k0, {ledger: "Staff Welfare"}), "auto")]).ok, "an automatic entry never becomes a precedent");
ok(!check(line(k0), [done(Object.assign({}, k0, {ledger: "Staff Welfare"}), "guess"), done(Object.assign({}, k0, {ledger: "Staff Welfare"}), "guess")]).ok, "lines posted in bulk on FinCom's guess never become precedents");
const hist = {fpN: {k: "upi:blinkit@hdfc", n: "BLINKIT", l: "Staff Welfare", d: "out", a: 500, dt: "2026-04-01", h: "hand", p: false}, fpH: {k: "upi:zomato@hdfc", n: "ZOMATO", l: "Staff Welfare", d: "out", a: 500, dt: "2026-04-01", h: "hand", p: true, by: "anshul@…", at: "2026-04-02T10:00:00Z"}, fpG: {k: "upi:swiggy@hdfc", n: "SWIGGY", l: "Staff Welfare", d: "out", a: 500, dt: "2026-04-01", h: "guess-posted"}, fpO: {k: "upi:uber@hdfc", n: "UBER", l: "Conveyance", d: "out", a: 300, dt: "2026-04-01", s: "sent"}};
const hidx = AP.bankIndex([], hist, env0());
ok(hidx.has("upi:zomato@hdfc|out") && !hidx.has("upi:swiggy@hdfc|out") && !hidx.has("upi:uber@hdfc|out") && !hidx.has("upi:blinkit@hdfc|out"), "the memory (hist) teaches only a person's entries (h: hand) that reached Tally, not guess-posted, not one not yet posted, nor older records without who");
// a person's change or undo pauses the party until a later approval by hand
const pz = {"upi:zomato@hdfc|out": {at: "2026-05-01T00:00:00Z", by: "staff@…"}};
m = check(line(k0), [done(Object.assign({}, k0, {ledger: "Staff Welfare", sentAt: "2026-04-02T00:00:00Z"}), "hand")], {}, {pausedAt: (k) => pz[k]});
ok(!m.ok && /paused after a change by staff@/.test(m.why), "after a person's undo the party's rule is paused (" + m.why + ")");
m = check(line(k0), [done(Object.assign({}, k0, {ledger: "Staff Welfare", sentAt: "2026-05-03T00:00:00Z"}), "hand")], {}, {pausedAt: (k) => pz[k]});
ok(m.ok, "… and resumes after a later approval by hand");
ok(!check(line(Object.assign({}, k0, {autoUndone: {at: "x"}})), [done(Object.assign({}, k0, {ledger: "Staff Welfare"}), "hand")]).ok, "the entry a person took back never goes by itself again");

console.log("== bills: rules and stops");
const G = "07AXWPT2445D1Z2";
const bill = (o, s) => {
  o = o || {}; const id = "e" + (++n);
  const xx = Object.assign({vendorName: "PRINTASTIGO", vendorGstin: G, vendorPan: "AXWPT2445D", invoiceNo: "PT/" + n, invoiceDate: "2026-10-01", total: 1652, taxable: 1400, igst: 252, cgst: 0, sgst: 0,
    items: [{hsn: "48201020", gstRate: 18, taxable: 1400}]}, o.x || {});
  const snap = Object.assign({lines: [{role: "expense", ledger: "Printing & Stationery"}, {role: "gst", head: "IGST", ledger: "Input IGST 18%"}, {role: "party", ledger: "Printastigo"}], tds: 0, skip: null, rcm: null, blocked: null}, s || {});
  return Object.assign({id, status: "draft", fileHash: "h" + n + "p1", createdAt: "2026-10-0" + (n % 9 + 1), readMode: "free (PDF text)", natureId: "goods", partyLedger: "Printastigo", snapshot: snap}, o, {x: xx});
};
const approved = (o, s, how) => Object.assign(bill(Object.assign({}, o, {x: Object.assign({invoiceDate: "2026-08-01"}, (o || {}).x)}), s), {status: "approved", approvedAt: "2026-09-25T10:00:00Z", approvedHow: how || "hand", approvedBy: "anshul@…", exportedAt: "2026-09-25T11:00:00Z"});
const benv = (o) => Object.assign({gstinValid: x.gstinValid, panOf: (xx) => String(xx.vendorPan || "").toUpperCase(), exactLedger: (l) => l, ledgerInfo: () => null, partyConfirmed: () => true}, o || {});
const bcheck = (e, prior, c, o) => { const entries = {}; prior.concat([e]).forEach((b) => { entries[b.id] = b; }); return AP.billCheck(e, {cfg: cfg(c), entries, env: benv(o)}); };
ok(x.gstinValid(G), "(the fixture's GSTIN passes its check digit)");
let p1 = approved({x: {invoiceNo: "PT/1098", invoiceDate: "2026-09-25", total: 1400}});
m = bcheck(bill({x: {invoiceNo: "PT/1144", total: 1652}}), [p1]);
ok(m.ok && m.rule === "P1" && m.conf === "High", "P1 same supplier GSTIN, same ledgers, HSN, GST and TDS: posts (" + m.why + ")");
ok(/Auto · rule: PRINTASTIGO 07AXWPT2445D1Z2/.test(AP.chipWords(m)) && /PT\/1098/.test(AP.tipWords(m)), "the chip names the supplier and GSTIN; the hover the bill it copied");
m = bcheck(bill({}), [approved({x: {invoiceNo: "PT/1"}}, null, "auto")]);
ok(!m.ok && /first bill/.test(m.why), "an automatic bill is never a precedent");
ok(bcheck(bill({}), [Object.assign(approved({}), {approvedHow: undefined})]).ok, "a bill approved before this build (no approvedHow, not automatic) counts as a person's");
m = bcheck(bill({}), []);
ok(!m.ok && /first bill of this supplier/.test(m.why), "first bill of the supplier waits");
m = bcheck(bill({x: {items: [{hsn: "997212", gstRate: 18, taxable: 105000}], total: 123900, taxable: 105000, igst: 18900}}), [approved({x: {items: [{hsn: "996912", gstRate: 18, taxable: 21640}], total: 25535, taxable: 21640, igst: 3895}})]);
ok(!m.ok && m.stops.some((s) => /HSN\/SAC 9972 not on earlier approved bills/.test(s)) && m.stops.some((s) => /over the ₹50,000 limit/.test(s)), "Fingate rent after electricity: SAC 9972 not on earlier bills, and over the limit (" + m.stops.join("; ") + ")");
// Jitin & Co. (no GSTIN, by PAN): the switch, two agreeing precedents, the 3 ledgers that disagree
const J = (o, led, how) => { const b = (how ? approved : bill)({x: Object.assign({vendorName: "JITIN & CO.", vendorGstin: "", vendorPan: "AIYPP8427G", total: 15000, taxable: 15000, igst: 0, items: []}, o)}, {lines: [{role: "expense", ledger: led}, {role: "party", ledger: "Jitin & Co."}], tds: 1500}, how); b.partyLedger = "Jitin & Co."; b.natureId = "professional"; return b; };
m = bcheck(J({invoiceNo: "3916"}, "Legal and Professional Fee"), [J({invoiceNo: "3594"}, "Legal and Professional Fee", "hand")]);
ok(!m.ok && /no GSTIN/.test(m.why), "a supplier without a GSTIN waits unless “Also suppliers without a GSTIN” is ticked");
m = bcheck(J({invoiceNo: "3916"}, "Legal and Professional Fee"), [J({invoiceNo: "3594"}, "Legal and Professional Fee", "hand")], {billsNoGstin: true});
ok(!m.ok && /only one earlier bill/.test(m.why), "P2 needs two agreeing earlier bills (" + m.why + ")");
const j1 = J({invoiceNo: "6009", invoiceDate: "2026-08-01"}, "Professional Fee", "hand"), j2 = J({invoiceNo: "5000", invoiceDate: "2026-10-01", total: 30000}, "Miscelleneous Exps.", "hand");
j2.approvedAt = "2026-10-04T00:00:00Z";
m = bcheck(J({invoiceNo: "3916"}, "Miscelleneous Exps."), [j1, j2], {billsNoGstin: true});
ok(!m.ok && /earlier bills disagree \(expense ledger\)/.test(m.stops.join(" ")), "Jitin: earlier bills used different ledgers: waits (" + m.stops[0] + ")");
const j3 = J({invoiceNo: "3594", invoiceDate: "2026-09-30"}, "Legal and Professional Fee", "hand"), j4 = J({invoiceNo: "3829b", invoiceDate: "2026-09-01"}, "Legal and Professional Fee", "hand");
j3.approvedAt = "2026-10-04T16:00:00Z"; j4.approvedAt = "2026-10-04T15:00:00Z";
m = bcheck(J({invoiceNo: "4100", invoiceDate: "2026-10-05", total: 17500, taxable: 17500}, "Legal and Professional Fee"), [j3, j4], {billsNoGstin: true});
ok(m.ok && m.rule === "P2" && m.conf === "Medium", "P2 by PAN with two agreeing bills posts when ticked (" + m.why + ")");
m = bcheck(J({invoiceNo: "3829", invoiceDate: "2023-10-02"}, "Legal and Professional Fee"), [j3, j4], {billsNoGstin: true}, {closedWhy: (d) => d < "2026-04-01" ? ["the books are closed up to 31-Mar-2026"] : []});
ok(!m.ok && /closed or filed period/.test(m.why), "Jitin 3829 dated 02-Oct-2023: closed period (" + m.why + ")");
// the same file read twice: Jitin 4861 / 5000 (0898890b…p1), Prince 0679 / 0691 (84deb15…, p1 / p2)
const pr1 = approved({x: {vendorName: "PRINCE COMPUTER", vendorGstin: "07DZBPK1760G1ZJ", invoiceNo: "PC/26-27/0691", total: 1298}}); pr1.fileHash = "84deb1521abcc0cdc78dp1"; pr1.partyLedger = "Prince Computers";
const pr2 = bill({x: {vendorName: "PRINCE COMPUTER", vendorGstin: "07DZBPK1760G1ZJ", invoiceNo: "PC/26-27/0679", total: 1298, invoiceDate: "2026-09-21"}}); pr2.fileHash = "84deb1521abcc0cdc78dp2"; pr2.partyLedger = "Prince Computers";
ok(x.gstinValid("07DZBPK1760G1ZJ"), "(Prince's GSTIN passes its check digit)");
m = bcheck(pr2, [pr1]);
ok(!m.ok && /possible duplicate \(same file as PC\/26-27\/0691\)/.test(m.why), "Prince: the same PDF (page 2 of the file of 0691): possible duplicate (" + m.why + ")");
const jf1 = J({invoiceNo: "4861", invoiceDate: "2026-01-30", total: 30000}, "Miscelleneous Exps.", "hand"); jf1.fileHash = "0898890bdf72aap1";
const jf2 = J({invoiceNo: "5000", invoiceDate: "2026-10-01", total: 30000}, "Miscelleneous Exps."); jf2.fileHash = "0898890bdf72aap1";
m = bcheck(jf2, [jf1], {billsNoGstin: true});
ok(m.stops.some((s) => /same file as 4861/.test(s)), "Jitin 5000 read from the file of 4861: a file hash already used stops it");
m = bcheck(bill({x: {invoiceNo: "PT/9", total: 1652, invoiceDate: "2026-10-10"}}), [approved({x: {invoiceNo: "PT/8", total: 1652, invoiceDate: "2026-09-20"}})]);
ok(!m.ok && /within 45 days/.test(m.why), "the same supplier and total within 45 days with the same HSN set: possible duplicate");
m = bcheck(bill({}), [p1], {}, {findDuplicate: () => ({msg: "Duplicate of PRINTASTIGO bill PT/1098"})});
ok(!m.ok && /Duplicate of PRINTASTIGO/.test(m.why), "findDuplicate's own finding stops it");
// Kashi I.T Solutions approved with Aadi Info Solutions' ledger: the names differ
const kas = (how) => { const b = (how ? approved : bill)({x: {vendorName: "KASHI I.T SOLUTIONS", vendorGstin: "09DEYPD8166R1Z5", total: 1239, items: [{hsn: "998365", gstRate: 18, taxable: 1050}], taxable: 1050, igst: 0, cgst: 94.5, sgst: 94.5}}, {lines: [{role: "expense", ledger: "Advertisment Exp."}, {role: "party", ledger: "Aadi Info Solutions Pvt. Ltd"}]}, how); b.partyLedger = "Aadi Info Solutions Pvt. Ltd"; b.natureId = "none"; return b; };
const sim = (a, b2) => (x.normName(a).split(" ")[0] === x.normName(b2).split(" ")[0] ? 1 : 0);
m = bcheck(kas(), [kas("hand")], {}, {nameSim: sim});
ok(x.gstinValid("09DEYPD8166R1Z5") && !m.ok && /name and the party ledger/.test(m.why), "Kashi / Aadi: the supplier's name and its Tally ledger differ, no GSTIN on the ledger: waits (" + m.why + ")");
m = bcheck(bill({}), [p1], {}, {ledgerInfo: () => ({gstin: "07AAAAA0000A1Z5"})});
ok(!m.ok && /GSTIN mismatch/.test(m.why), "GSTIN mismatch with the Tally ledger's GSTIN");
m = bcheck(bill({x: {vendorGstin: "07AXWPT2445D1Z9"}}), [p1]);
ok(!m.ok && (/check digit/.test(m.stops.join(" ")) || /first bill/.test(m.why)), "a GSTIN that fails its check digit never matches (" + m.why + ")");
m = bcheck(bill({}), [p1], {}, {notFiling: () => true});
ok(!m.ok && /Not filing/.test(m.why), "a supplier “Not filing” in the 2B waits");
m = bcheck(bill({}, {rcm: {cat: "advocate"}}), [approved({}, {rcm: {cat: "advocate"}})]);
ok(!m.ok && /reverse charge/.test(m.stops.join(" ")), "reverse charge waits (even when the earlier bill had it)");
m = bcheck(bill({x: {items: [{hsn: "998211", gstRate: 18, taxable: 1400}]}}), [approved({x: {items: [{hsn: "998211", gstRate: 18, taxable: 1400}]}})]);
ok(!m.ok && /reverse charge/.test(m.why), "an RCM SAC (legal 9982) waits");
m = bcheck(bill({x: {items: [{hsn: "84713010", gstRate: 18, taxable: 45000}], total: 53100, taxable: 45000, igst: 8100}}), [approved({x: {items: [{hsn: "84713010", gstRate: 18, taxable: 45000}], total: 53100, taxable: 45000, igst: 8100}})], {perEntry: 100000});
ok(!m.ok && /capital goods/.test(m.why), "capital goods (a laptop, HSN 8471, ₹45,000) wait");
m = bcheck(bill({}), [p1], {}, {isFixed: (l) => /Printing/.test(l)});
ok(!m.ok && /capital goods/.test(m.why), "an expense ledger under Fixed Assets waits");
m = bcheck(bill({readMode: "Claude (images)", uncertain: ["total"]}), [p1]);
ok(!m.ok && /image/.test(m.why), "read from an image with a field to check: waits");
ok(bcheck(bill({readMode: "Claude (images)"}), [p1]).ok, "… an image read with every field sure posts");
ok(!bcheck(bill({notRead: {reason: "x"}}), [p1]).ok, "a bill not read yet waits");
m = bcheck(bill({ai: {suggested: "goods"}, natureId: "goods"}), [Object.assign(approved({}), {natureId: "contract"})]);
ok(!m.ok && /AI suggestion/.test(m.stops.join(" ")), "the kind of bill from AI, not the person's earlier choice: waits");
m = bcheck(bill({}, {lines: [{role: "expense", ledger: "Suspense"}, {role: "party", ledger: "Printastigo"}]}), [approved({}, {lines: [{role: "expense", ledger: "Suspense"}, {role: "party", ledger: "Printastigo"}]})]);
ok(!m.ok && /parking ledger/.test(m.why), "a parking ledger on the bill waits");
m = bcheck(bill({}), [p1], {}, {exactLedger: (l) => /Printing/.test(l) ? null : l});
ok(!m.ok && /not in Tally/.test(m.why), "a ledger the bill needs that is not in Tally: waits");
m = bcheck(bill({}), [p1], {}, {partyConfirmed: () => false});
ok(!m.ok && /not confirmed/.test(m.why), "the supplier's Tally ledger not confirmed: waits");
m = bcheck(bill({}), [p1], {}, {guessedWhy: () => "Posting waits: the GST ledger “Input IGST 18%” comes from Client setup, where it is guessed, not confirmed."});
ok(!m.ok && /guessed, not confirmed/.test(m.why), "a ledger from a guessed Client setup choice: waits");
m = bcheck(bill({x: {total: 1700}}), [approved({x: {total: 1700}})]);
ok(!m.ok && /not the sum of the lines/.test(m.stops.join(" ")), "a total that is not the sum of the lines waits");
m = bcheck(bill({touchedBy: {by: "staff"}}), [p1]);
ok(!m.ok && /a person changed this bill/.test(m.why), "a bill a person changed waits");
// P3: TDS worked out afresh, never copied; a change in kind waits
m = bcheck(bill({}), [p1], {}, {compute: () => ({missing: [], lines: [{role: "expense", ledger: "Printing & Stationery"}, {role: "gst", head: "IGST", ledger: "Input IGST 18%"}, {role: "party", ledger: "Printastigo"}, {role: "tds", ledger: "TDS 194Q"}], tds: 2, skip: null})});
ok(!m.ok && /TDS now differs in kind/.test(m.why), "P3: the yearly limit crossed (TDS now due, none before): waits (" + m.why + ")");
m = bcheck(bill({}), [p1], {}, {compute: () => ({missing: [], lines: p1.snapshot.lines, tds: 0, skip: null})});
ok(m.ok, "P3: TDS worked out afresh and the same in kind: posts");

console.log("== the setting and its rights");
ok(JSON.stringify(AP.cfg({})) === JSON.stringify(Object.assign({}, AP.DEF)) && AP.DEF.on === false && AP.DEF.holdMin === 0, "off by default; hold 0 (the owner's choice “Post at once”)");
ok(AP.cfg({choices: {autopost: {value: {on: true, holdMin: 15}}}}).holdMin === 15, "the hold is a setting the owner can raise");
const L = (a, b2) => AP.loosens(a, b2);
ok(L({}, {on: true}).includes("switch it on") && L({on: true}, {on: false}).length === 0, "switching on loosens; off never does");
ok(L({on: true, perEntry: 50000}, {on: true, perEntry: 100000}).includes("raise the limit per entry") && L({on: true, perEntry: 50000}, {on: true, perEntry: 10000}).length === 0, "raising the limit loosens; lowering does not");
ok(L({on: true, perDay: 500000}, {on: true, perDay: null}).includes("raise the daily limit") && L({on: true, perDay: null}, {on: true, perDay: 100000}).length === 0, "removing the daily limit loosens; setting one does not");
ok(L({on: true}, {on: true, bankAmounts: "within"}).length === 1 && L({on: true, holdMin: 15}, {on: true, holdMin: 0}).includes("shorten the hold") && L({on: true, holdMin: 0}, {on: true, holdMin: 15}).length === 0, "any amount within the limit and a shorter hold loosen; a longer hold does not");
ok(L({}, {whoUndo: "owner"}).includes("change who may change it"), "who may change it: the owner only");
ok(/Switched on for Testing AAD: bank lines, purchase bills; limit ₹50,000 an entry, ₹5,00,000 a day; hold 0 min/.test(AP.changeWords({}, {on: true, perDay: 500000}, "Testing AAD")), "the log's words: " + AP.changeWords({}, {on: true, perDay: 500000}, "Testing AAD"));
ok(/Hold before posting|hold before posting 0 → 15 minutes/.test(AP.changeWords({on: true}, {on: true, holdMin: 15}, "X")), "a change of the hold is logged in words");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
