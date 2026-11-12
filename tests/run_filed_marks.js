// node run_filed_marks.js - the "filed" marks and filed months protected (the state-machine review, items 6 and 7, approved
// by the owner). Made-up books (Zeta Traders, GSTIN 09AAACZ1234A1Z5, made-up suppliers) and made-up TDS returns:
//  A. GST filed marks: a mark taken off goes whole (date, ARN, how, the 3B kept as filed, the IFF's documents) and can be
//     made again (by hand, the GST API, the browser helper); the browser helper's ARN carries how; a GSTR-1 saved through
//     the API or downloaded is not filed; a PDF removed from Returns filed takes back the date it filled in, restored puts
//     it back (one typed by hand stays)
//  B. TDS: two forms of a quarter filed, one taken off: the quarter stays closed (Settings › Closed periods); taking off is
//     in the audit trail; a correction open is asked about and closed, never dropped silently
//  C. a filed month (GSTLock): ITC decisions, eligibility, the old remark entry points, 2B pairs (confirm, link, unlink),
//     B2C summary marks and places of supply refuse (or ask, with a reason kept) on a filed month and work on an open one;
//     "Take now" goes into the line's 2B month, not the month on screen; a note or eligibility changed is dated now
//  D. Tally sync: the figures of a challan a TDS return marked filed uses are held, shown, and go in once a correction opens
// FILED_LIB (a folder with itcSync.js, itcFinal.js, PosPick.jsx) and TDSDESK_HTML compare another build (the base).
const fs = require("fs"), path = require("path"), vm = require("vm");
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "GST_STATES", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR",
  "normName", "nameSim", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ", "GSTV", "GSTMark", "GSTLock", "gstfSet", "gstfSnap", "gstfUnsnap", "gqIffFiled", "gstFileRoute", "gstSignWith", "GSTFILE", "GSTB",
  "gstvFind", "gstvFileIt", "gstvRemove", "gstvRestore", "ClosedP", "r2Reg", "r2Locked", "r2Confirm", "r2Unlink", "r2Link", "inregRows",
  "Audit", "TDS", "Certs", "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES", "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "NORM_CACHE", "normNameRaw", "TDSCH", "TDSRate", "TDSLdc", "TDSWatch",
  "TDSFiled", "TDSTally", "TDSReg", "TDS_SEC_CODES", "BOOKS_KEYS", "uid", "lsGet", "lsSet", "istParts", "p2ist", "istDay", "istToday"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const loads = NAMES.filter((n) => { try { load(HTML, [n]); return true; } catch (e) { return false; } });
const missing = NAMES.filter((n) => !loads.includes(n));
if (missing.length) console.log("  (not in this build: " + missing.join(", ") + ")");
const {ctx, x} = load(HTML, loads);
const CMP = "09AAACZ1234A1Z5", reg = "09", G = x.GSTR;
ctx.S.companies = {t: {id: "t", name: "Zeta Traders", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
const toasts = [], audits = [], asked = []; let answer = {ok: true, data: "a test reason"};
Object.assign(ctx, {saveBooks: () => {}, render: () => {}, toast: (m) => toasts.push(m), whoAmI: () => "tester@zz.test", Cloud: {st: {email: "tester@zz.test"}, on: () => false},
  auditEvent: (k, d) => audits.push([k, d]), askConfirm: async (o) => { asked.push(o); return answer; }, Store: {saveCompany: () => {}}, perRender: undefined,
  setTimeout, clearTimeout, Promise, document: {getElementById: () => null}, window: {}});
ctx.FC = ctx.FC || {d8: (d) => String(d || "").replace(/-/g, "").slice(0, 8), when: (d) => d, monthLabel: (m) => G.label(m)};
const lastToast = () => toasts[toasts.length - 1] || "";
const flush = () => new Promise((r) => setImmediate(r));

// ---- the app modules, as the browser runs them (imports and exports taken off)
const LIB = process.env.FILED_LIB || path.join(__dirname, "..", "app", "src", "lib"), POS = process.env.FILED_LIB ? path.join(LIB, "PosPick.jsx") : path.join(__dirname, "..", "app", "src", "screens", "gst", "PosPick.jsx");
const strip = (f) => fs.readFileSync(path.join(LIB, f), "utf8").replace(/^import .*$/mg, "").replace(/^export (const|function|async function) /mg, "$1 ");
vm.runInContext("globalThis.__sync = (function(){" + strip("itcSync.js") + "\n; return {DECS, DEC_LABEL, r2Tag, itctSetAct}; })();\n(function(){ const {DECS, DEC_LABEL} = globalThis.__sync;\n" + strip("itcFinal.js") + "\n})();", ctx);
const posSrc = fs.readFileSync(POS, "utf8"), pi = posSrc.indexOf("// (an entry in a month") >= 0 ? posSrc.indexOf("// (an entry in a month") : posSrc.indexOf("export function posSave"), pj = posSrc.indexOf("export const POS_FROM");
vm.runInContext("globalThis.__pos = (function(){" + posSrc.slice(pi, pj).replace(/^export (async function|function) /mg, "$1 ") + "\n; return {posSave, posClear}; })();", ctx);
const ITCF = ctx.ITCF, ITCDec = ctx.ITCDec, POSF = ctx.__pos;

// ---- made-up books: April purchases (some in April's 2B), May's; sales in April and May
const V = (id, date, no, party, gstin, taxable, cgst) => ({id, type: "Purchase", date, no, party, gstin, pos: "", cmp: CMP, narr: "", hsn: [], cancel: false, opt: false,
  ent: [{l: "Office Expenses", a: -taxable}, {l: "Input CGST", a: -cgst}, {l: "Input SGST", a: -cgst}, {l: party, a: taxable + 2 * cgst}]});
const GA = "09AABCA1111A1Z1", GB = "09AABCB2222B1Z2", GE = "09AABCE6666F1Z7", GO = "09AABCO4444D1Z4", GF = "09AABCF8888H1Z9";
const vs = [V("a1", "20260405", "A/101", "Alpha Supplies", GA, 10000, 900), V("b1", "20260410", "B/7", "Beta Traders", GB, 20000, 1800),
  V("e1", "20260418", "E/1", "Echo Stores", GE, 5000, 450), V("f1", "20260508", "F/2", "Foxtrot Labs", GF, 8000, 720),
  {id: "s1", type: "Sales", date: "20260420", no: "S/1", party: "Kilo Retail", gstin: "", pos: "", cmp: CMP, narr: "", hsn: [], ent: [{l: "Kilo Retail", a: -236000}, {l: "Sales", a: 200000}, {l: "CGST", a: 18000}, {l: "SGST", a: 18000}]},
  {id: "s2", type: "Sales", date: "20260520", no: "S/2", party: "Lima Stores", gstin: "", pos: "", cmp: CMP, narr: "", hsn: [], ent: [{l: "Lima Stores", a: -118000}, {l: "Sales", a: 100000}, {l: "CGST", a: 9000}, {l: "SGST", a: 9000}]}];
const row = (ym, gstin, party, no, date, taxable, cgst) => ({no, noN: no.replace(/[^A-Z0-9]/gi, "").toUpperCase(), ym, dir: 1, ims: "N", key: ym.slice(4) + ym.slice(0, 4) + "|b2b|" + gstin + "|" + no + "|" + date,
  pos: reg, rcm: false, sec: "b2b", typ: "R", val: taxable + 2 * cgst, cess: 0, cgst, sgst: cgst, igst: 0, date, gstin, party, itcavl: "Y", taxable});
const TWOB = {[CMP + "|042026"]: {ym: "202604", gstin: CMP, period: "042026", rows: [row("202604", GB, "BETA TRADERS", "B/7", "20260410", 20000, 1800), row("202604", GO, "OMEGA LOGISTICS", "O/5", "20260415", 5000, 450)]},
  [CMP + "|052026"]: {ym: "202605", gstin: CMP, period: "052026", rows: [row("202605", GA, "ALPHA SUPPLIES", "A/101", "20260405", 10000, 900), row("202605", GF, "FOXTROT LABS", "F/2", "20260508", 8000, 720),
    row("202605", "09AABCP3333C1Z3", "PAPA PRINTS", "P/3", "20260512", 4000, 360)]}};
function books() {
  const b = {cid: "t", vouchers: vs, meta: {from: "20260401", to: "20260630", gstins: [CMP], bills: 1}, under: {}, groups: {}, gstins: {}, states: {}, challans: [], alloc: {}, certs: [], twoBs: JSON.parse(JSON.stringify(TWOB)),
    gstOpen: {[reg]: {igst: 0, cgst: 0, sgst: 0, cess: 0}}};
  ["Alpha Supplies", "Beta Traders", "Echo Stores", "Foxtrot Labs"].forEach((p) => { b.under[p] = "Sundry Creditors"; });
  b.under["Kilo Retail"] = "Sundry Debtors"; b.under["Lima Stores"] = "Sundry Debtors"; b.under.Sales = "Sales Accounts"; b.groups = {"Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets", "Sales Accounts": "Primary"};
  b.map = x.Books.mapLedgers(vs, {});
  const set = (n, o) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, {ok: true, byHand: true}); };
  ["CGST", "SGST"].forEach((t) => { set(t, {what: "gst", kind: "gst", tax: t, side: "output", reg}); set("Input " + t, {what: "gst", kind: "gst", tax: t, side: "input", reg}); });
  ctx.S.books = b; G._carry = null; x.GST2B._memo = null; return b;
}
const F = (ym) => x.GSTF.peek(ym, reg);

(async () => {
  // ================= A. GST filed marks
  let b = books(); ctx.S.gstReg = reg; ctx.S.gstYm = "202604";
  x.gstfSet("r3b", "2026-05-20");
  x.GSTFILE.markFiled("3B", "202604", reg, "AA0904260000011", "2026-05-20T10:00:00+05:30");
  ok(F("202604").r3bArn === "AA0904260000011" && F("202604").r3bVia === "api" && !!F("202604").snap, "A1. filed through the API: date, ARN, how and the 3B kept, together");
  x.gstfSet("r3b", "");
  const r0 = F("202604");
  ok(!r0.r3b && !r0.r3bArn && !r0.r3bVia && !r0.snap && !r0.snapAt, "A1. the filing date taken off takes the whole mark off: ARN, how and the kept 3B too (" + JSON.stringify(Object.keys(r0)) + ")");
  ok(audits.some(([k, d]) => k === "gst_filed_mark_off" && d.arn === "AA0904260000011"), "A1. taking the mark off is in the audit trail, with the ARN it had");
  x.GSTFILE.markFiled("3B", "202604", reg, "AA0904260000011", "2026-05-21T10:00:00+05:30");
  ok(F("202604").r3b === "2026-05-21" && F("202604").r3bArn === "AA0904260000011" && !!F("202604").snap, "A1. marked again through the API with the same ARN: marked (it no longer stops at the ARN left behind)");
  x.gstfUnsnap();
  ok(!!F("202604").snap && /ARN AA0904260000011/.test(lastToast()), "A2. a 3B filed with an ARN keeps its kept copy: “" + lastToast() + "”");
  x.gstfSet("r3b", ""); ctx.S.gstYm = "202605"; x.gstfSnap();
  ok(!!F("202605").r3b && !!F("202605").snap, "A2. Mark this 3B as filed and keep a copy: date and copy");
  x.gstfUnsnap();
  ok(!F("202605").r3b && !F("202605").snap, "A2. remove the kept copy: the month is no longer marked filed either (“" + lastToast() + "”)");
  // the IFF
  x.gqIffFiled("202605", "iff", "2026-06-12"); x.gqIffFiled("202605", "iffArn", "AA0905260000022");
  ok(F("202605").iff && F("202605").iffArn && F("202605").iffDocs, "A3. IFF filed: its date, ARN and documents recorded");
  x.gqIffFiled("202605", "iff", "");
  ok(!F("202605").iff && !F("202605").iffArn && !F("202605").iffDocs, "A3. the IFF's date taken off: its ARN and documents go with it");
  // the browser helper
  if (x.GSTB) {
    x.GSTB.onMsg({type: "arn", form: "3B", gstin: CMP, ym: "202605", arn: "AA0905260000033", at: "2026-06-20T11:00:00Z"});
    ok(F("202605").r3bArn === "AA0905260000033" && F("202605").r3bVia === "helper" && !!F("202605").r3b && !!F("202605").snap, "A4. the browser helper's ARN: date, ARN, how (helper) and the kept 3B together (" + JSON.stringify(F("202605")).slice(0, 120) + ")");
    x.gstfSet("r3b", ""); ctx.S.gstYm = "202605"; x.gstfSet("r3b", "");
    ok(!F("202605").r3bArn && !F("202605").r3bVia, "A4. taken off: nothing of the helper's mark left");
  } else ok(false, "A4. GSTB (the browser helper) loads");
  // GSTR-1 saved through the API, or downloaded: not filed
  x.gstfSet("r3b", ""); ctx.S.gstYm = "202604"; x.gstfSet("r3b", "");
  const j6 = {gstin: CMP, fp: "062026", b2b: []};
  x.GSTAmend.keep(JSON.parse(JSON.stringify(j6)), "downloaded", {via: "api"});
  ok(x.GSTAmend.nextOpen("202605", reg) === "202606", "A5. GSTR-1 for Jun saved on the portal through the API, not filed: still the next open return (" + x.GSTAmend.nextOpen("202605", reg) + ")");
  ok(!x.GSTAmend.filed(reg).some((f) => f.ym === "202606") && !(x.GSTLock && x.GSTLock.filed(reg, "202606", "r1")), "A5. and not counted as filed anywhere (GSTAmend.filed, GSTLock)");
  x.GSTAmend.keep(JSON.parse(JSON.stringify({gstin: CMP, fp: "072026", b2b: []})), "downloaded");
  ok(x.GSTAmend.nextOpen("202606", reg) === "202607", "A5. a draft download of Jul: not filed either");
  ctx.S.gstYm = "202606"; x.gstfSet("r1", "2026-07-11");
  ok(x.GSTAmend.nextOpen("202605", reg) === "202607" && x.GSTLock && x.GSTLock.filed(reg, "202606", "r1"), "A5. Jun's GSTR-1 marked filed: now it counts (the next open is Jul)");
  x.gstfSet("r1", "");
  // Returns filed: a PDF's date
  const rec = x.GSTV.addRecord({reg, form: "r3b", per: "202607", arn: "AA0907260000044", arnDate: "2026-08-18", name: "a.pdf", size: 10});
  ok(F("202607").r3b === "2026-08-18", "A6. a 3B PDF filed away fills the filing date (as before)");
  answer = {ok: true, data: "the wrong PDF"}; await x.gstvRemove(rec.id);
  ok(!F("202607").r3b, "A6. the PDF removed: the date it filled in goes with it (" + F("202607").r3b + ")");
  x.gstvRestore(rec.id);
  ok(F("202607").r3b === "2026-08-18", "A6. restored: the date is back");
  x.GSTF.rec("202608", reg).r3b = "2026-09-19";
  const rec2 = x.GSTV.addRecord({reg, form: "r3b", per: "202608", arn: "AA0908260000055", arnDate: "2026-09-20", name: "b.pdf", size: 11});
  await x.gstvRemove(rec2.id);
  ok(F("202608").r3b === "2026-09-19", "A6. a date typed before the PDF came is not the PDF's: removing the PDF leaves it");
  delete x.GSTF.rec("202607", reg).r3b; delete x.GSTF.rec("202608", reg).r3b; b.gstVault = [];

  // ================= C. a filed month: GSTLock in every path that changes its figures
  b = books(); ctx.S.gstReg = reg; ctx.S.gstYm = "202604";
  const Lk = x.GSTLock;
  ok(!!Lk && !Lk.filed(reg, "202604"), "C0. GSTLock: April open to start with");
  if (x.GSTMark) x.GSTMark.set("202604", reg, "r3b", "2026-05-20", "AA0904260000099", "api"); else Object.assign(x.GSTF.rec("202604", reg), {r3b: "2026-05-20", r3bArn: "AA0904260000099", r3bVia: "api"});
  ok(!!Lk && Lk.filed(reg, "202604").arn === "AA0904260000099" && !Lk.filed(reg, "202605"), "C0. April's 3B filed (ARN); May open");
  const W = Lk ? Lk.why(reg, ["202604"]) : "";
  ok(/GSTR-3B for Apr.*2026 is filed \(ARN AA0904260000099\)\. Changes go into the next return as an amendment\./.test(W), "C0. the words: “" + W + "”");
  const line = (no) => ITCF.rows(reg).find((r) => r.no === no || r.bookNo === no);
  const decOf = (no) => (ITCDec.all()[reg + "|" + line(no).key] || {});
  let rB = line("B/7"), d0 = JSON.stringify(decOf("B/7"));
  ok(rB && rB.e.C === "202604", "C1. Beta's credit is in April (" + (rB && rB.e.C) + ")");
  let res = ITCF.decide(reg, [rB], "later", "202606", "202604");
  ok(JSON.stringify(decOf("B/7")) === d0 && res.refused.length === 1 && res.lock === W, "C1. ITC decision on a line whose credit is in filed April: refused, with the words (" + JSON.stringify(res.lock) + ")");
  res = ITCF.decide(reg, [line("F/2")], "later", "202606", "202605");
  ok(decOf("F/2").d === "later" && decOf("F/2").ym === "202606" && !res.lock, "C1. the same on Foxtrot (May, open): set");
  ok(ITCF.setElig(reg, line("B/7"), "ineligible") === false && !decOf("B/7").el, "C1. eligibility of Beta (filed April): refused");
  ITCF.setElig(reg, line("F/2"), "ineligible");
  ok(decOf("F/2").el === "ineligible", "C1. eligibility of Foxtrot (May): set");
  ctx.__sync.itctSetAct(line("B/7").key, "wait");
  ok(JSON.stringify(decOf("B/7")) === d0 && lastToast() === W, "C1. the old follow-up entry point (itctSetAct) on Beta: refused too");
  ctx.__sync.r2Tag("b1", "Booked in a later month");
  ok(JSON.stringify(decOf("B/7")) === d0, "C1. the old 2B remark entry point (r2Tag) on Beta: refused too");
  // "Take now": the line's own 2B month, not the month on screen
  let rO = line("O/5");
  ITCF.decide(reg, [line("P/3")], "now", "", "202606");
  ok(decOf("P/3").ym === "202605", "C2. Take now on Papa's bill (in May's 2B) while June is on screen: into May, its 2B month (" + decOf("P/3").ym + ")");
  res = ITCF.decide(reg, [rO], "now", "", "202605");
  ok(decOf("O/5").ym === "202605" && !res.lock, "C2. Take now on Omega (in April's 2B, April filed) from May: into May, the month on screen (" + decOf("O/5").ym + ")");
  ITCF.decide(reg, [line("E/1")], "now", "", "202605");
  ok(decOf("E/1").ym === "202605", "C2. a bill not in 2B (Echo) taken now from May: May");
  // note and eligibility dated now
  const id = reg + "|" + line("F/2").key, at1 = ITCDec.all()[id].at; await new Promise((r) => setTimeout(r, 5));
  ITCDec.note(reg, line("F/2").key, "asked the supplier", line("F/2").s);
  const at2 = ITCDec.all()[id].at; await new Promise((r) => setTimeout(r, 5));
  ITCDec.setEl(reg, line("F/2").key, "", line("F/2").s);
  ok(at2 > at1 && ITCDec.all()[id].at > at2, "C3. a note, then the eligibility, changed: the decision's time moves on each (" + [at1, at2, ITCDec.all()[id].at].join(" < ") + ")");
  // 2B pairs
  const st = x.GST2B.state(), kB = TWOB[CMP + "|042026"].rows[0].key, kF = TWOB[CMP + "|052026"].rows[1].key, kP = TWOB[CMP + "|052026"].rows[2].key;
  const st0 = JSON.stringify([st.confirm, st.link]);
  x.r2Confirm(kB);
  ok(JSON.stringify([st.confirm, st.link]) === st0 && lastToast() === W, "C4. 2B: Same on Beta's pair (April, filed): refused (“" + lastToast() + "”)");
  x.r2Unlink(kB, ["b1"]);
  ok(JSON.stringify([st.confirm, st.link]) === st0, "C4. 2B: Unlink on Beta's pair: refused");
  x.r2Link(TWOB[CMP + "|042026"].rows[1].key, "e1");
  ok(!st.link[TWOB[CMP + "|042026"].rows[1].key], "C4. 2B: Omega's April document linked to Echo's April bill: refused");
  x.r2Link(kP, "e1");
  ok(JSON.stringify(st.link[kP]) === JSON.stringify(["e1"]), "C4. 2B: Papa's May document linked to Echo's April bill: the pair's credit is in May (open), so linked");
  x.r2Unlink(kP, ["e1"]);
  ok(!st.link[kP], "C4. and unlinked again");
  x.r2Confirm(kF);
  ok(st.confirm[kF] === "yes", "C4. 2B: Same on Foxtrot (May): kept");
  // B2C summary marks and places of supply: asked, with a reason kept in the audit trail
  asked.length = 0; answer = null;
  G.b2cSumEntry("s1", true); await flush();
  ok(asked.length === 1 && /filed/.test(asked[0].body) && !((b.gstPosFix || {}).s1), "C5. B2C summary mark on April's sale: asked first; cancelled, nothing changed");
  answer = {ok: true, data: "summary of the day's counter sales"}; audits.length = 0;
  G.b2cSumEntry("s1", true); await flush(); await flush();
  ok(((b.gstPosFix || {}).s1 || {}).b2cs && audits.some(([k, d]) => k === "gst_filed_changed" && d.reason === "summary of the day's counter sales"), "C5. said yes with a reason: marked, and the audit trail keeps the reason");
  asked.length = 0;
  G.b2cSumEntry("s2", true);
  ok(asked.length === 0 && ((b.gstPosFix || {}).s2 || {}).b2cs, "C5. the same on May's sale (open): marked at once, nothing asked");
  asked.length = 0; answer = null;
  G.b2cSumLedger("Kilo Retail", true); await flush();
  ok(asked.length === 1 && !((b.map["Kilo Retail"] || {}).b2cSum), "C5. the party switch for a party with April sales: asked; cancelled, not switched");
  G.b2cSumLedger("Lima Stores", true);
  ok(!!(b.map["Lima Stores"] || {}).b2cSum, "C5. the party switch for a party with only May sales: switched at once");
  asked.length = 0; answer = null;
  POSF.posSave(["s1"], "27"); await flush();
  ok(asked.length === 1 && ((b.gstPosFix || {}).s1 || {}).pos !== "27", "C6. place of supply on April's sale: asked; cancelled, not set");
  answer = {ok: true, data: "buyer's address confirmed"};
  POSF.posSave(["s1"], "27"); await flush(); await flush();
  ok(((b.gstPosFix || {}).s1 || {}).pos === "27", "C6. said yes with a reason: set");
  asked.length = 0; POSF.posSave(["s2"], "07");
  ok(asked.length === 0 && ((b.gstPosFix || {}).s2 || {}).pos === "07", "C6. May's sale: set at once");
  answer = null; POSF.posClear(["s1"]); await flush();
  ok(((b.gstPosFix || {}).s1 || {}).pos === "27", "C6. clearing April's: asked; cancelled, kept");
  answer = {ok: true, data: "x"};

  // ================= B. TDS returns marked filed
  b = books(); ctx.S.companies.t.closed = {};
  const cp = () => ((ctx.S.companies.t.closed || {}).tdsFiled || {})["2026-27|Q1"] || "";
  ctx.Store.saveCompany = () => {};
  const T = x.TDSFiled, R = x.TDSReg;
  answer = {ok: true}; audits.length = 0;
  await T.mark("2026-27", "Q1", "26Q", "2026-07-20", "");
  await T.mark("2026-27", "Q1", "24Q", "2026-07-25", "");
  ok(cp() === "2026-07-20", "B1. 26Q and 24Q of Q1 marked filed: the quarter's date under Closed periods is 26Q's (" + cp() + ")");
  await T.unmark("2026-27", "Q1", "26Q");
  ok(!!cp() && x.ClosedP.why(ctx.S.companies.t, b, "20260615", true).some((w) => /TDS return for Q1/.test(w)), "B1. 26Q taken off, 24Q still filed: the quarter stays closed (" + cp() + ")");
  ok(cp() === "2026-07-25" && !!T.get("2026-27", "Q1", "24Q") && !T.get("2026-27", "Q1", "26Q"), "B1. its date is now 24Q's, and 26Q reads not filed");
  ok(audits.some(([k, d]) => k === "tds_return_unfiled" && d.form === "26Q"), "B2. taking the mark off is in the audit trail, as marking is");
  await T.unmark("2026-27", "Q1", "24Q");
  ok(!cp(), "B1. 24Q taken off too: the quarter's date is cleared");
  // a correction open
  await T.mark("2026-27", "Q1", "26Q", "2026-07-20", "");
  R.openCorrection("2026-27", "Q1", "26Q"); asked.length = 0; audits.length = 0;
  await T.mark("2026-27", "Q1", "26Q", "2026-08-02", "");
  ok(asked.length === 1 && /correction is open/i.test(asked[0].body), "B3. marked filed again with a correction open: the question says the correction is open and is closed by this");
  ok(!R.corrOpen("2026-27", "Q1", "26Q") && audits.some(([k, d]) => k === "tds_return_filed" && d.correctionClosed), "B3. marked: the correction closed, and the trail says so");
  R.openCorrection("2026-27", "Q1", "26Q"); asked.length = 0;
  await T.unmark("2026-27", "Q1", "26Q");
  ok(/correction/i.test((asked[0] || {}).body || "") && !R.corrOpen("2026-27", "Q1", "26Q") && (b.allocLog || []).some((l) => l.act === "correction" && /filed mark was taken off/.test(l.note)), "B3. taken off with a correction open: asked, the correction closed and logged (not left open on a return not filed)");
  answer = null; R.openCorrection("2026-27", "Q1", "26Q");
  await T.mark("2026-27", "Q1", "26Q", "2026-07-20", "");
  ok(R.corrOpen("2026-27", "Q1", "26Q") && !T.get("2026-27", "Q1", "26Q"), "B3. the question cancelled: neither marked nor the correction dropped");
  answer = {ok: true};

  // ================= D. Tally sync and a challan a filed return uses
  b = books(); b.tdsFiled = {}; b.tdsCorr = {};
  const c = {id: "tally:v9:k", from: "tally", madeBy: "tally-sync", fromVoucher: "v9", bsr: "0510001", serial: "00012", date: "20260707", tax: 1000, interest: 0, section: "194C",
    tallyWas: {tax: 1000, interest: 0, fee: 0, others: 0, section: "194C"}};
  b.challans = [c];
  const TT = x.TDSTally;
  Object.assign(TT, {sections: () => 0, links: () => [], certsFrom: () => [], fromVouchers: () => [{vid: "v9", key: x.TDSCH.chKey(c), bsr: c.bsr, serial: c.serial, date: c.date, tax: 1200, interest: 0, fee: 0, others: 0, section: "194C"}]});
  x.TDS.challanUse = () => ({});
  R.placeNew = () => []; R.uses = () => ({[c.id]: {"26Q|2026-27|Q2": {form: "26Q", fy: "2026-27", q: "Q2", tax: 1000}}});
  b.tdsFiled["2026-27|Q2|26Q"] = {on: "2026-10-25", token: ""};
  let sres = TT.sync(b);
  const held = sres.conflicts.find((z) => z.challan === c.id && z.what === "tax");
  ok(c.tax === 1000 && held && /26Q Q2 2026-27/.test(held.held || ""), "D1. Tally gives 1,200 for a challan 26Q Q2 (marked filed) uses: kept at 1,000, held and shown (" + JSON.stringify(held) + ")");
  R.openCorrection("2026-27", "Q2", "26Q");
  sres = TT.sync(b);
  ok(c.tax === 1200, "D2. a correction opened for that return: the next sync takes Tally's 1,200 (" + c.tax + ")");
  delete b.tdsFiled["2026-27|Q2|26Q"]; c.tax = 1000; c.tallyWas.tax = 1000; delete b.tdsCorr["2026-27|Q2|26Q"];
  TT.sync(b);
  ok(c.tax === 1200, "D3. a challan no filed return uses: Tally's figure goes in as before");

  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
