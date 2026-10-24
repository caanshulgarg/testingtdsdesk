// node run_2b_automatch.js - the 2B matching that runs by itself (round 72b), its rules (server/_shared/match2b.js):
//   A. invoice numbers written differently (case, spaces, "/", "-", leading zeros, a financial year in the number)
//   B. the rules on a fixture: matched (same GSTIN, number, dates in the same financial year, the tax within Rs 1.00: 0.99
//      and 1.00 in, 1.01 out; next-itc-simple: a date or a taxable value differing alone is a note, not to look at), a bill
//      booked in two entries, mismatches said in plain words, notes never with invoices, another GSTIN
//      and no GSTIN left for step 2, and the answer the same whatever order the rows come in
//   C. the AI step's pure parts: what is sent (only GSTIN, name, number, date, taxable, IGST, CGST, SGST, cess), the answer
//      checked (not JSON, wrong shape, unknown ids, an id twice: refused or dropped), auto-accept against suggest, never
//      an amount from the AI, a person's accept and reject kept
//   D. the app and the server agree: the app (site-test/index.html, built by build.py with this same file) gives the same
//      result as the module the server imports, and GST2B.fromJson reads a 2B JSON as the module does
const path = require("path"), fs = require("fs");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const J = JSON.stringify;

(async () => {
  const M = await import(path.join(__dirname, "..", "server", "_shared", "match2b.js"));
  // ---------------------------------------------------------------- A
  const same = [["INV/0045/2024-25", "inv-45-24-25", "INV 45 FY2024-25", "INV/45/2024-2025", "Inv 0045"], ["GST/24-25/101", "GST/101/2024-25", "gst-101"], ["0045", "45", "00045"], ["FY25-26/0012", "12"]];
  same.forEach(g => ok(new Set(g.map(M.m2bNormNo)).size === 1, "A. the same number: " + g.join(" = ") + " (" + M.m2bNormNo(g[0]) + ")"));
  const apart = [["A/1/23", "A/12/3"], ["INV-45", "INV-46"], ["45", "450"], ["INV/12/24-25", "INV/24-25"], ["S1", "S/2"]];
  apart.forEach(([a, b]) => ok(M.m2bNormNo(a) !== M.m2bNormNo(b), "A. two numbers: " + a + " and " + b));

  // ---------------------------------------------------------------- B
  const G = "09AAACB1234C1Z5", G_OTHER = "07AAACB1234C1Z9" /* same PAN */, H = "27AAAPL1234C1ZV";
  const g2 = (key, no, date, taxable, igst, extra) => Object.assign({key, gstin: G, party: "Bharat Steel", no, date, ym: date.slice(0, 6), dir: 1, taxable, igst, cgst: 0, sgst: 0, cess: 0}, extra || {});
  const bk = (id, no, date, taxable, igst, extra) => Object.assign({id, gstin: G, party: "Bharat Steel Pvt Ltd", no, date, ym: date.slice(0, 6), voucher: "P" + id, dir: 1, taxable, igst, cgst: 0, sgst: 0, cess: 0}, extra || {});
  const twob = [
    g2("k01", "INV/0045/2024-25", "20260905", 10000, 1800),          // = b01, number written differently, 2 days apart
    g2("k02", "INV-50", "20260910", 10000, 1800),                     // b02 is 3 days later: in
    g2("k03", "INV-51", "20260910", 10000, 1800),                     // b03 is 4 days later: matched, a note (date)
    g2("k04", "INV-52", "20260912", 10000.99, 1800),                  // b04 0.99 less: in
    g2("k05", "INV-53", "20260912", 10001.00, 1800),                  // b05 1.00 less: in
    g2("k06", "INV-54", "20260912", 10001.01, 1800),                  // b06 1.01 less, the tax equal: matched, a note (taxable)
    g2("k07", "INV-55", "20260915", 20000, 3600),                     // booked in two entries b07a + b07b
    g2("k08", "CN-7", "20260920", 1000, 180, {dir: -1}),               // a credit note: b08 is an invoice of that number: never paired
    g2("k09", "INV-60", "20260921", 5000, 0, {cgst: 450, sgst: 450}),  // b09 has IGST 900: same tax, other heads: a mismatch
    g2("k10", "INV-61", "20260922", 7000, 1260, {gstin: G_OTHER}),     // b10 under the other GSTIN: left for step 2
    g2("k11", "INV-62", "20260923", 8000, 1440),                      // b11 has no GSTIN: left for step 2
    g2("k12", "INV-70", "20260925", 3000, 540, {gstin: H, party: "Lakshmi Traders"})   // nothing in the books: 2B only
  ];
  const books = [
    bk("b01", "inv-45-24-25", "20260907", 10000, 1800), bk("b02", "INV 50", "20260913", 10000, 1800), bk("b03", "INV51", "20260914", 10000, 1800),
    bk("b04", "INV-52", "20260912", 10000, 1800), bk("b05", "INV-52A", "20260912", 10000, 1800), bk("b05x", "INV-53", "20260912", 10000, 1800), bk("b06", "INV-54", "20260912", 10000, 1800),
    bk("b07a", "INV-55", "20260915", 12000, 2160), bk("b07b", "INV/55", "20260916", 8000, 1440), bk("b08", "CN-7", "20260920", 1000, 180),
    bk("b09", "INV-60", "20260921", 5000, 900), bk("b10", "INV-61", "20260922", 7000, 1260), bk("b11", "62", "20260923", 8000, 1440, {gstin: ""}),
    bk("b13", "X-99", "20260930", 999, 179.82)                        // books only
  ];
  const r = M.m2bRules(twob, books);
  const by = k => r.pairs.find(p => p.g.includes(k));
  const st = k => (by(k) || {}).st || "left";
  ok(st("k01") === "matched-rules" && J(by("k01").b) === J(["b01"]), "B. INV/0045/2024-25 and inv-45-24-25, 2 days apart: matched by rules");
  ok(st("k02") === "matched-rules", "B. dates 3 days apart: matched");
  ok(st("k03") === "matched-rules" && /date differs: 2B 10-09-2026, books 14-09-2026/.test((by("k03").note || []).join()), "B. 4 days apart, the same year: matched, with the note \"" + ((by("k03") || {}).note || []).join("; ") + "\"");
  ok(st("k04") === "matched-rules" && J(by("k04").b) === J(["b04"]), "B. taxable Rs 0.99 apart: matched");
  ok(st("k05") === "matched-rules" && J(by("k05").b) === J(["b05x"]), "B. taxable Rs 1.00 apart: matched (INV-52A is another number)");
  ok(st("k06") === "matched-rules" && /taxable ₹10,001.01 in 2B, ₹10,000.00 in books/.test((by("k06").note || []).join()), "B. taxable Rs 1.01 apart, the tax equal: matched, with the note \"" + ((by("k06") || {}).note || []).join("; ") + "\"");
  ok(st("k07") === "matched-rules" && J(by("k07").b.slice().sort()) === J(["b07a", "b07b"]) && /booked in 2 entries/.test(by("k07").why.join()), "B. one bill booked in two entries that add up: matched");
  ok(st("k08") === "left" && r.leftBooks.includes("b08"), "B. a credit note is never paired with an invoice of the same number");
  ok(st("k09") === "mismatch" && /CGST \+ SGST in 2B, IGST in books/.test(by("k09").why.join()), "B. the same tax under other heads: to look at");
  ok(st("k10") === "left" && st("k11") === "left" && st("k12") === "left", "B. another GSTIN, no GSTIN in the books, nothing in the books: left for step 2");
  ok(J(r.leftBooks.slice().sort()) === J(["b05", "b08", "b10", "b11", "b13"]), "B. left in the books: " + r.leftBooks.join(", "));
  const shuffled = M.m2bRules(twob.slice().reverse(), books.slice().reverse());
  ok(J(shuffled) === J(r), "B. the same answer whatever order the rows come in");
  const c0 = M.m2bRulesOnly(twob, books, {}).counts;
  ok(M.m2bLine(c0) === "7 matched (7 by rules, 0 by AI) · 1 to look at · 5 in books only · 4 in 2B only", "B. the line: " + M.m2bLine(c0));

  // ---------------------------------------------------------------- B2 (next-itc-simple, the owner, 24-Oct-2026: Leads's 2B
  // "To look at" list, "why is this showing"): shaped like those seven: a date that differs only (tax within Rs 1, paise
  // rounding) and the tax equal with the books' taxable counting the voucher's other lines are MATCHED, with a note; a tax
  // differing by more than Rs 1, and a date in another financial year, are still to look at
  {
    const E1 = "09AAICE1111A1Z1", CH = "33AAACC2222B1Z2", AT = "09AAACB3333C1Z3", JM = "09AAJFJ4444D1Z4";
    const gg = (key, gstin, no, date, taxable, cg) => ({key, gstin, party: "S", no, date, ym: date.slice(0, 6), dir: 1, taxable, igst: 0, cgst: cg, sgst: cg, cess: 0});
    const bb = (id, gstin, no, date, taxable, cg) => ({id, gstin, party: "S", no, date, ym: date.slice(0, 6), voucher: id, dir: 1, taxable, igst: 0, cgst: cg, sgst: cg, cess: 0});
    const tw = [gg("e1", E1, "ETWTT/2526/4681", "20260109", 4092, 368.28), gg("e2", CH, "2162017469400000", "20250418", 9844.44, 886), gg("e3", E1, "ETWTT/2526/1739", "20250711", 4664, 419.76),
      gg("e4", AT, "MF2609I003801464", "20250806", 1000, 90), gg("j1", JM, "JE20250083", "20250526", 1000, 90), gg("j2", JM, "JE20250106", "20250621", 4000, 360), gg("j3", JM, "JE20250158", "20250702", 500, 45),
      gg("x1", AT, "MF-77", "20250806", 1000, 90), gg("x2", AT, "MF-78", "20260402", 1000, 90)];
    const bs = [bb("be1", E1, "ETWTT/2526/4681", "20260105", 4092, 368), bb("be2", CH, "2162017469400000", "20250402", 9844, 885.78), bb("be3", E1, "ETWTT/2526/1739", "20250611", 4664, 420),
      bb("be4", AT, "MF2609I003801464", "20250824", 1000, 90), bb("bj1", JM, "JE20250083", "20250526", 36630, 90), bb("bj2", JM, "JE20250106", "20250621", 1023223, 360), bb("bj3", JM, "JE20250158", "20250702", 217381, 45),
      bb("bx1", AT, "MF-77", "20250806", 1000, 91.01), bb("bx2", AT, "MF-78", "20260330", 1000, 90)];
    const rr = M.m2bRules(tw, bs), by2 = k => rr.pairs.find(p => p.g.includes(k)) || {}, note = k => (by2(k).note || []).join("; ");
    ok(["e1", "e2", "e3", "e4"].every(k => by2(k).st === "matched-rules"), "B2. ET INFRA, Cholamandalam, ET INFRA, Airtel: a date that differs only: matched (" + ["e1", "e2", "e3", "e4"].map(k => by2(k).st).join(", ") + ")");
    ok(/date differs: 2B 09-01-2026, books 05-01-2026/.test(note("e1")) && /paise rounding/.test(note("e1")) && /paise rounding/.test(note("e2")) && !/paise/.test(note("e4")), "B2. the notes say it: \"" + note("e1") + "\"; Airtel's tax identical, no paise note");
    ok(/timing: in 2B of 07-2025, booked 06-2025/.test(note("e3")), "B2. booked in another return period than 2B's: a timing note, still matched (\"" + note("e3") + "\")");
    ok(["j1", "j2", "j3"].every(k => by2(k).st === "matched-rules") && /books taxable includes other lines ₹35,630.00/.test(note("j1")) && /₹10,19,223.00/.test(note("j2")), "B2. JMD: the tax equal, the books' taxable counting the ticket: matched, \"" + note("j1") + "\"");
    ok(by2("x1").st === "mismatch" && /tax ₹180.00 in 2B, ₹182.02 in books/.test(by2("x1").why.join()), "B2. the tax differing by Rs 2.02: still to look at (" + (by2("x1").why || []).join("; ") + ")");
    ok(by2("x2").st === "mismatch" && /another financial year/.test(by2("x2").why.join()), "B2. a date in another financial year: still to look at (" + (by2("x2").why || []).join("; ") + ")");
    ok(M.m2bLine(M.m2bRulesOnly(tw, bs, {}).counts) === "7 matched (7 by rules, 0 by AI) · 2 to look at · 0 in books only · 0 in 2B only", "B2. the line: " + M.m2bLine(M.m2bRulesOnly(tw, bs, {}).counts));
  }

  // ---------------------------------------------------------------- C
  const inp = M.m2bAiInput(twob, books, r.left2b, r.leftBooks);
  const keys = new Set(inp.g.concat(inp.b).flatMap(o => Object.keys(o)));
  ok(J(Array.from(keys).sort()) === J(["cess", "cgst", "date", "gstin", "id", "igst", "name", "no", "sgst", "taxable"]), "C. only GSTIN, name, number, date, taxable, IGST, CGST, SGST, cess (and an id) are sent");
  const cn = inp.g.find(o => inp.map[o.id] === "k08");
  ok(cn && cn.taxable === -1000 && cn.igst === -180 && cn.date === "20-09-2026", "C. a credit note goes with negative amounts, the date as DD-MM-YYYY");
  const id = (k) => Object.keys(inp.map).find(x => inp.map[x] === k);
  ok(!M.m2bAiParse("Sure! Here are the pairs", inp.map).ok && !M.m2bAiParse('{"matches": []}', inp.map).ok && !M.m2bAiParse("[]", inp.map).ok, "C. an answer that is not JSON of the agreed shape is refused whole");
  const p1 = M.m2bAiParse(J({pairs: [
    {g: [id("k10")], b: [id("b10")], kind: "other_gstin", reason: "booked under the Delhi GSTIN", confidence: "high", taxable: 1},
    {g: [id("k11")], b: [id("b11")], kind: "typo", reason: "62 written without its prefix", confidence: "medium"},
    {g: ["G999"], b: [id("b13")], kind: "same", reason: "x", confidence: "low"},
    {g: [id("k12")], b: [id("b10")], kind: "same", reason: "b10 again", confidence: "low"},
    {g: [id("k12")], b: [id("b13")], kind: "guess", reason: "x", confidence: "low"}]}), inp.map);
  ok(p1.ok && p1.pairs.length === 2 && p1.bad === 3, "C. unknown ids, an id used twice and an unknown kind are dropped (" + p1.bad + " dropped)");
  const ap = M.m2bAiApply(twob, books, r, p1.pairs, {});
  const row = k => ap.rows.find(x => x.g.includes(k));
  ok(row("k10").st === "matched-ai" && row("k10").why[0] === "AI: booked under the Delhi GSTIN", "C. the same PAN and equal amounts: matched by AI, with its reason");
  ok(row("k11").st === "probable" && /no GSTIN in books/.test(row("k11").why.join()), "C. no GSTIN in the books: a probable match for a person, not accepted by itself");
  // the AI pairs a 2B document with an entry of other amounts: probable, and the difference is the documents' own figures
  const p2 = M.m2bAiParse(J({pairs: [{g: [id("k12")], b: [id("b13")], kind: "same", reason: "close enough", confidence: "high"}]}), inp.map);
  const ap2 = M.m2bAiApply(twob, books, r, p2.pairs, {});
  const x2 = ap2.rows.find(x => x.g.includes("k12"));
  ok(x2.st === "probable" && /taxable ₹3,000.00 in 2B, ₹999.00 in books/.test(x2.why.join()), "C. other amounts, another GSTIN: probable, with the figures of 2B and the books: " + x2.why.join("; "));
  // a person's reject: the pair is not suggested again; an accept: it stays matched without asking the AI
  const pid = M.m2bPairId(["k12"], ["b13"]);
  const ap3 = M.m2bAiApply(twob, books, r, p2.pairs, {[pid]: "reject"});
  ok(!ap3.rows.some(x => x.id === pid) && ap3.left2b.includes("k12"), "C. a rejected pair is not suggested again");
  const ap4 = M.m2bAiApply(twob, books, r, [], {[pid]: "accept"});
  ok(ap4.rows.find(x => x.id === pid).st === "matched-ai" && ap4.rows.find(x => x.id === pid).accepted, "C. an accepted pair stays matched in a run without AI");
  // a monthly rent of the same figure: AI may not pair it by itself
  const rent2b = [g2("r1", "R/APR", "20260401", 50000, 9000), g2("r2", "R/MAY", "20260501", 50000, 9000)];
  const rentBk = [bk("q1", "Rent April", "20260403", 50000, 9000), bk("q2", "Rent May", "20260502", 50000, 9000)];
  const rr = M.m2bRules(rent2b, rentBk), ri = M.m2bAiInput(rent2b, rentBk, rr.left2b, rr.leftBooks);
  const rid = k => Object.keys(ri.map).find(x => ri.map[x] === k);
  const rp = M.m2bAiParse(J({pairs: [{g: [rid("r1")], b: [rid("q1")], kind: "typo", reason: "April rent", confidence: "high"}, {g: [rid("r2")], b: [rid("q2")], kind: "typo", reason: "May rent", confidence: "high"}]}), ri.map);
  const ra = M.m2bAiApply(rent2b, rentBk, rr, rp.pairs, {});
  ok(ra.rows.every(x => x.st === "probable") && /same amounts/.test(ra.rows[0].why.join()), "C. two rents of the same figure: probable (the figures cannot tell them apart), never matched by AI alone");

  // ---------------------------------------------------------------- D
  const HTML = process.env.TDSDESK_HTML || path.join(__dirname, "..", "site-test", "index.html");
  if (!fs.existsSync(HTML)){ ok(false, "D. the app is not built (python3 build.py)"); }
  else {
    const {load} = require("./harness");
    // every declaration of the shared file (as the app carries it), then the app's own GST2B and M2B
    const shared = fs.readFileSync(path.join(__dirname, "..", "server", "_shared", "match2b.js"), "utf8").match(/^(?:function|const) ([A-Za-z_$][\w$]*)/gm).map(x => x.split(" ")[1]);
    const h = load(HTML, ["num", "r2"].concat(shared, ["GST2B", "M2B"]));
    const X = h.x;
    const file = fs.readFileSync(path.join(__dirname, "..", "server", "_shared", "match2b.js"), "utf8").replace(/^export \{[^}]*\};\s*$/m, "");
    ok(fs.readFileSync(HTML, "utf8").includes(file), "D. the app carries server/_shared/match2b.js unchanged (but its export line)");
    ok(J(X.m2bRules(twob, books)) === J(r), "D. the app's rules give the server's answer, pair by pair");
    ok(J(X.M2B.local(twob, books, {})) === J(M.m2bRulesOnly(twob, books, {})), "D. M2B.local (the app, without the server) = the server's rules-only result");
    const j2b = {data: {gstin: "09AANFG3202D1ZR", rtnprd: "092026", gendt: "14-10-2026", docdata: {
      b2b: [{ctin: G, trdnm: "Bharat Steel", supfildt: "11-10-2026", inv: [{inum: "INV/0045/2024-25", dt: "05-09-2026", val: 11800, txval: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0, itcavl: "Y", rev: "N"}]}],
      cdnr: [{ctin: G, trdnm: "Bharat Steel", nt: [{ntnum: "CN-7", dt: "20-09-2026", val: 1180, txval: 1000, igst: 180, typ: "C"}]}],
      impg: [{boenum: "1234567", boedt: "02-09-2026", portcode: "INNSA1", txval: 50000, igst: 9000}]},
      docRejdata: {b2b: [{ctin: H, trdnm: "Lakshmi", inv: [{inum: "R-1", dt: "01-09-2026", txval: 100, igst: 18, remarks: "not ours"}]}]}}};
    const a = X.GST2B.fromJson(j2b), b = M.m2bFrom2bJson(j2b);
    ok(J(a) === J(b) && a.rows.length === 4 && a.rows[1].dir === -1 && a.rows[3].rej === true, "D. GST2B.fromJson reads a 2B JSON row for row as the server does (" + a.rows.length + " rows)");
    // E. the ECO and ISDA sections (17-Oct-2026): read by the app and the server alike, ECO as B2B invoices, ISDA as ISD
    // with the original document beside it; the rows of the other sections keep their keys
    const ECO = "07AAICE1234F1CZ", ISD = "07AAACI5555K1ZQ";
    const j3 = JSON.parse(J(j2b)), dd = j3.data.docdata;
    dd.ecom = [{ctin: ECO, trdnm: "Quickbite Foods ECO", supfildt: "11-10-2026", supprd: "092026", inv: [{inum: "ECO/26/0091", typ: "R", dt: "12-09-2026", val: 1050, pos: "07", txval: 1000, igst: 0, cgst: 25, sgst: 25, cess: 0, itcavl: "Y", rsn: "", irn: "abc123"}]}];
    dd.isda = [{ctin: ISD, trdnm: "Head Office ISD", supfildt: "13-10-2026", supprd: "092026", doclist: [
      {doctyp: "I", docnum: "ISD/7A", docdt: "28-09-2026", odoctyp: "I", odocnum: "ISD/7", odocdt: "31-08-2026", igst: 360, cgst: 0, sgst: 0, cess: 0, itcelg: "Y"},
      {doctyp: "C", docnum: "ISDC/2A", docdt: "29-09-2026", odoctyp: "C", odocnum: "ISDC/2", odocdt: "30-08-2026", igst: 90, cgst: 0, sgst: 0, cess: 0, itcelg: "N"}]}];
    j3.data.docRejdata.ecom = [{ctin: ECO, trdnm: "Quickbite Foods ECO", inv: [{inum: "ECO/26/0099", dt: "14-09-2026", txval: 200, cgst: 5, sgst: 5, remarks: "not ours"}]}];
    const a3 = X.GST2B.fromJson(j3), b3 = M.m2bFrom2bJson(j3), sec = s => a3.rows.filter(r => r.sec === s);
    ok(J(a3) === J(b3), "E. the app and the server read ECO and ISDA row for row alike (" + a3.rows.length + " rows)");
    const e = sec("ecom");
    ok(e.length === 2 && e[0].gstin === ECO && e[0].no === "ECO/26/0091" && e[0].date === "20260912" && e[0].taxable === 1000 && e[0].cgst === 25 && e[0].sgst === 25 && e[0].val === 1050 && e[0].dir === 1 && e[0].itcavl === "Y" && e[0].irn === "abc123" && e[0].supPrd === "092026"
      && e[1].rej === true && e[1].itcavl === "N" && e[1].remarks === "not ours", "E. ECO: GSTIN of the operator, number, date, value, taxable, tax, ITC available, IRN; one rejected in IMS kept apart");
    const ia = sec("isda");
    ok(ia.length === 2 && ia[0].no === "ISD/7A" && ia[0].date === "20260928" && ia[0].dir === 1 && ia[0].igst === 360 && ia[0].oNo === "ISD/7" && ia[0].oDate === "20260831" && ia[0].oTyp === "I"
      && ia[1].dir === -1 && ia[1].oNo === "ISDC/2" && ia[1].itcavl === "N", "E. ISDA: the amended document, the original's type, number and date beside it; a credit note (doctyp C) reduces credit; itcelg read");
    ok(J(a.rows.map(r => r.key)) === J(a3.rows.filter(r => r.sec !== "isda" && r.sec !== "ecom").map(r => r.key)), "E. the rows of B2B, CDNR, IMPG and IMS-rejected keep their keys (the new sections come last)");
    // matched like B2B (ECO) and ISD (ISDA): same GSTIN and number; the same rules, nothing new
    const r2bE = a3.rows.filter(r => !r.rej && (r.sec === "ecom" || r.sec === "isda")).map(M.m2bRow2b);
    const bkE = [bk("e1", "ECO-26-91", "20260913", 1000, 0, {gstin: ECO, cgst: 25, sgst: 25}), bk("i1", "ISD/7A", "20260928", 0, 360, {gstin: ISD}), bk("i2", "ISDC/2A", "20260929", 0, 90, {gstin: ISD, dir: -1})];
    const rE = M.m2bRules(r2bE, bkE), stE = no => ((rE.pairs.find(p => p.g.some(k => r2bE.find(x => x.key === k && x.no === no))) || {}).st || "left");
    ok(stE("ECO/26/0091") === "matched-rules" && stE("ISD/7A") === "matched-rules" && stE("ISDC/2A") === "matched-rules" && J(X.m2bRules(r2bE, bkE)) === J(rE),
      "E. an ECO document and ISDA documents match their bills by the same rules, in the app as on the server");
  }
  console.log(fails ? "\nFAILED: " + fails : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
