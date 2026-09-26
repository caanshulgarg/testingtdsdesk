// node run_gstset.js - GST settings: filing type (monthly, QRMP, composition) and what follows from it, contacts, e-invoicing
const fs = require("fs"), {load, openBlob, HTML, DATA, CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "normName", "ITCT", "GSTSet", "CustIMS", "GSTF", "CO"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  const {ctx, x} = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, twoBs: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
  ctx.S.companies = {c: {id: "c", name: "VMS Events Pvt Ltd", gstin: "07AADCV3366N1ZU"}}; ctx.S.coId = "c";
  const G = x.GSTSet, F = x.GSTF;
  // monthly unless set
  ok(G.typeOf("202510", "07") === "monthly" && F.due("202510", "r1", "07") === "2025-11-11" && F.due("202510", "r3b", "07") === "2025-11-20", "monthly by default: GSTR-1 by the 11th, 3B by the 20th");
  // QRMP from Q3 2025-26 for Delhi (07): 3B by the 24th; Maharashtra (27) would be the 22nd
  G.store("07").filing = [{type: "qrmp", from: "202510"}];
  ok(G.typeOf("202509", "07") === "monthly" && G.typeOf("202511", "07") === "qrmp" && G.typeOf("202603", "07") === "qrmp", "QRMP from Q3 2025-26: September stays monthly, November and March are QRMP");
  ok(F.due("202512", "r1", "07") === "2026-01-13" && F.due("202512", "r3b", "07") === "2026-01-24", "QRMP quarter Oct-Dec: GSTR-1 by 13 Jan, 3B by 24 Jan for Delhi");
  G.store("27").filing = [{type: "qrmp", from: "202510"}];
  ok(F.due("202512", "r3b", "27") === "2026-01-22", "and 22 Jan for Maharashtra");
  ok(F.due("202510", "r1", "07") === "" && F.due("202510", "iff", "07") === "2025-11-13" && F.due("202510", "pmt06", "07") === "2025-11-25", "October (first month): no GSTR-1 or 3B; IFF by 13 Nov, PMT-06 by 25 Nov");
  ok(F.lateFee("202510", "07", "r3b", false).none && !F.files("202510", "07") && F.files("202512", "07"), "no late fee for a month with no return of its own");
  G.store("07").filing.push({type: "comp", from: "202601"});
  ok(G.typeOf("202602", "07") === "comp" && F.due("202602", "cmp08", "07") === "2026-04-18" && F.due("202602", "r3b", "07") === "", "composition from Q4: CMP-08 for Jan-Mar by 18 Apr, no 3B");
  G.store("07").filing = []; G.store("27").filing = [];
  // the window the portal allows to change QRMP and monthly, for the quarter starting October 2026
  const w = G.window("202610");
  ok(w.from === "2026-08-01" && w.to === "2026-10-31", "change for Oct-Dec 2026 allowed from 1 Aug to 31 Oct 2026");
  ok(G.qLabel("202601") === "Q4 2025-26" && G.qLabel("202607") === "Q2 2026-27", "quarters named by the financial year");
  // contacts: typed here first, then kept from earlier letters, then Tally
  const p = G.parties();
  ok(p.length > 100 && p[0].gstin && p.some(z => /supplier/.test(z.sides)) && p.some(z => /customer/.test(z.sides)), "parties with a GSTIN, suppliers and customers (" + p.length + ")");
  const one = p[0];
  b.gstContacts = {[one.gstin]: {email: "typed@x.example"}};
  ok(G.contact(one.gstin, one.party, {email: "old@x.example"}).email === "typed@x.example" && G.contact("XX", one.party, {email: "old@x.example"}).email === "old@x.example", "a contact typed in settings comes first, then one kept from earlier letters");
  // e-invoicing
  const sales = b.vouchers.filter(v => x.Books.isSale(v) && x.GSTR.regOf(v) === "07" && x.GSTR.ym(v.date) === "202603" && v.gstin && !/NOTE/i.test(v.type));
  sales[0].irn = "irn0"; sales[0].irnDate = sales[0].date;
  ok(F.einv("202603", "07").uses, "e-invoicing found from Tally when the books carry IRNs");
  G.store("07").einv = "no";
  ok(!F.einv("202603", "07").uses, "set as not applying: no e-invoice check");
  G.store("07").einv = "outside";
  ok(!F.einv("202603", "07").uses && F.einv("202603", "07").mode === "outside", "made outside Tally: no check from Tally's IRNs");
  delete sales[0].irn; delete sales[0].irnDate; G.store("07").einv = "auto";
  const src = fs.readFileSync(HTML, "utf8"), sv = (src.match(/async function saveBooks\(\)\{[\s\S]*?\}\); \}/) || [""])[0];
  ok(["gstSet", "gstContacts", "itcBasis", "gstOpen", "rule37On", "gstAato", "gstCashLedger"].every(k => new RegExp("\\b" + k + ": b\\." + k + "\\b").test(sv)), "every GST setting is saved with the books");
  ok(/\["gstset", "GST"\]/.test(src), "Client setup has a GST tab");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
