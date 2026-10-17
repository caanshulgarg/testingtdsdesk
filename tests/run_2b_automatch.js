// node run_2b_automatch.js - the 2B matching that runs by itself (round 72b), its rules (server/_shared/match2b.js):
//   A. invoice numbers written differently (case, spaces, "/", "-", leading zeros, a financial year in the number)
//   B. the rules on a fixture: matched (same GSTIN, number, dates within 3 days, amounts within Rs 1.00: 0.99 and 1.00 in,
//      1.01 out), a bill booked in two entries, mismatches said in plain words, notes never with invoices, another GSTIN
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
    g2("k03", "INV-51", "20260910", 10000, 1800),                     // b03 is 4 days later: a mismatch (date)
    g2("k04", "INV-52", "20260912", 10000.99, 1800),                  // b04 0.99 less: in
    g2("k05", "INV-53", "20260912", 10001.00, 1800),                  // b05 1.00 less: in
    g2("k06", "INV-54", "20260912", 10001.01, 1800),                  // b06 1.01 less: a mismatch (taxable)
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
  ok(st("k03") === "mismatch" && /4 days apart/.test(by("k03").why.join()), "B. 4 days apart: to look at, \"" + (by("k03") || {why: []}).why.join("; ") + "\"");
  ok(st("k04") === "matched-rules" && J(by("k04").b) === J(["b04"]), "B. taxable Rs 0.99 apart: matched");
  ok(st("k05") === "matched-rules" && J(by("k05").b) === J(["b05x"]), "B. taxable Rs 1.00 apart: matched (INV-52A is another number)");
  ok(st("k06") === "mismatch" && /taxable ₹10,001.01 in 2B, ₹10,000.00 in books \(differs by ₹1.01\)/.test(by("k06").why.join()), "B. taxable Rs 1.01 apart: to look at, \"" + (by("k06") || {why: []}).why.join("; ") + "\"");
  ok(st("k07") === "matched-rules" && J(by("k07").b.slice().sort()) === J(["b07a", "b07b"]) && /booked in 2 entries/.test(by("k07").why.join()), "B. one bill booked in two entries that add up: matched");
  ok(st("k08") === "left" && r.leftBooks.includes("b08"), "B. a credit note is never paired with an invoice of the same number");
  ok(st("k09") === "mismatch" && /CGST \+ SGST in 2B, IGST in books/.test(by("k09").why.join()), "B. the same tax under other heads: to look at");
  ok(st("k10") === "left" && st("k11") === "left" && st("k12") === "left", "B. another GSTIN, no GSTIN in the books, nothing in the books: left for step 2");
  ok(J(r.leftBooks.slice().sort()) === J(["b05", "b08", "b10", "b11", "b13"]), "B. left in the books: " + r.leftBooks.join(", "));
  const shuffled = M.m2bRules(twob.slice().reverse(), books.slice().reverse());
  ok(J(shuffled) === J(r), "B. the same answer whatever order the rows come in");
  const c0 = M.m2bRulesOnly(twob, books, {}).counts;
  ok(M.m2bLine(c0) === "5 matched (5 by rules, 0 by AI) · 3 to look at · 5 in books only · 4 in 2B only", "B. the line: " + M.m2bLine(c0));

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
  }
  console.log(fails ? "\nFAILED: " + fails : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
