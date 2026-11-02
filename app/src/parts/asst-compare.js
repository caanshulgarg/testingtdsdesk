// Ask FinCom: two financial statements attached and compared (the coordinator's request of 02-Nov-2026: "when two FS PDFs
// are attached and the question asks to compare them, compare them line by line, P&L and balance sheet, and list the
// differences with amounts"). Loaded only when such a question is sent (asst-upload.js prep), with the Financial
// statements page's own reader (FinPyBs.fromText, src/js/88-fin-pybs.js): each PDF's text layer, here in the browser.
//   splitStatements(text)  the text cut at each statement's title: "Balance Sheet as at …", "Statement of Profit and Loss
//                          for the year ended …" (or Income and Expenditure); the notes after them are left out
//   compareText(a, b)      the face lines of each statement, matched by their words (numbering, punctuation and case
//                          aside), in rupees (each file's own unit): every line that differs or is in one file only
//   compareFiles(ua, ub)   the same for two attached files: a table for the answer (the turn's results) and a short brief
//                          for the AI, so its words agree with the table
// A scanned PDF has no text: nothing is compared here and the AI reads both files as they are.
import "../lib/finGlobals.js";

const BS = /^(abridged\s+)?balance\s*sheet\b|^statement\s+of\s+(assets\s+and\s+liabilities|financial\s+position)\b/i;
const PL = /^(statement\s+of\s+)?profit\s*(and|&)\s*loss\b|^(statement\s+of\s+)?income\s*(and|&)\s*expenditure\b|^profit\s*(and|&)\s*loss\s+(account|statement)\b/i;
const NOTES = /^(significant\s+accounting\s+policies|notes?\s+(to|forming\s+part|on)\b|cash\s+flow\s+statement|statement\s+of\s+cash\s+flows?)/i;
const AMT = /\d[\d,]*(\.\d+)?\)?$/;
const NAMES = { bs: "Balance sheet", pl: "P&L" };

// the text, statement by statement: {bs: "…", pl: "…"} (a title line has no figure at its end)
export function splitStatements(text) {
  const out = { bs: "", pl: "" };
  let cur = "";
  String(text || "").split(/\r?\n/).forEach((line) => {
    const s = line.replace(/[\s ]+/g, " ").trim();
    if (!s) return;
    const title = !AMT.test(s) || /\b(19|20)\d{2}\b/.test(s.slice(-4));
    if (title && BS.test(s)) { cur = "bs"; return; }
    if (title && PL.test(s)) { cur = "pl"; return; }
    if (title && NOTES.test(s)) { cur = ""; return; }
    if (cur) out[cur] += s + "\n";
  });
  return out;
}

// a line's words, for matching: "(a) Trade Receivables" and "Trade receivables" are one line
export const keyOf = (label) => String(label || "").toLowerCase().replace(/₹|\brs\.?/g, " ")
  .replace(/^\s*(\(?[a-z]{1,4}\)|\(?[ivx]{1,5}[.)]|\d{1,2}[.)]|[-•*])\s+/i, "").replace(/[^a-z0-9]+/g, " ").trim();

// a line's caption as shown: without its numbering ("(b) Trade receivables" is "Trade receivables")
const shown = (label) => String(label || "").replace(/^\s*(\(?[a-z]{1,4}\)|\(?[ivx]{1,5}[.)]|\d{1,2}[.)]|[-•*])\s+/i, "").trim();
const cap = (s) => { const t = String(s || "").toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
// the face lines of one statement: [{key, label, amt}] in rupees; a bare "Total" says which side it closes ("Total
// (Assets)"), from the heading in capitals above it
function faceLines(text) {
  if (!String(text || "").trim()) return [];
  const r = FinPyBs.fromText(text), unit = +r.unit || 1, seen = {};
  let side = "";
  const out = [];
  (r.lines || []).forEach((z) => {
    const lab = String(z.label || "").trim();
    if (z.isHead) { if (lab && lab === lab.toUpperCase() && /[A-Z]{3}/.test(lab)) side = cap(lab); return; }
    if (z.amt == null || z.face === false || !lab) return;
    const label = /^(grand\s+)?total\W*$/i.test(lab) && side ? "Total (" + side + ")" : shown(lab);
    const k = keyOf(label); seen[k] = (seen[k] || 0) + 1;
    out.push({ key: seen[k] > 1 ? k + "#" + seen[k] : k, label, amt: Math.round(z.amt * unit * 100) / 100 });
  });
  return out;
}

// two statements' texts compared: {rows: [{st, line, a, b, d, why}], lines, same, read: {a: {bs, pl}, b: {bs, pl}}}
export function compareText(textA, textB) {
  const A = splitStatements(textA), B = splitStatements(textB), rows = [], read = { a: {}, b: {} };
  let lines = 0, same = 0;
  for (const st of ["bs", "pl"]) {
    const la = faceLines(A[st]), lb = faceLines(B[st]);
    read.a[st] = la.length; read.b[st] = lb.length;
    if (!la.length && !lb.length) continue;
    const mb = new Map(lb.map((z) => [z.key, z])), used = new Set();
    const one = (za, zb) => {
      lines++;
      const a = za ? za.amt : null, b = zb ? zb.amt : null;
      if (a != null && b != null && Math.abs(a - b) < 0.005) { same++; return; }
      rows.push({ st: NAMES[st], line: (za || zb).label, a, b, d: Math.round(((b || 0) - (a || 0)) * 100) / 100, why: a == null ? "only in the second" : b == null ? "only in the first" : "" });
    };
    // in the first file's order; a line the second file alone has goes after the line it follows there
    const pos = new Map(lb.map((z, i) => [z.key, i]));
    la.forEach((za) => {
      const zb = mb.get(za.key);
      if (zb) {
        // the second file's lines before this one that the first does not have
        for (let i = 0; i < pos.get(za.key); i++) if (!used.has(lb[i].key) && !la.some((x) => x.key === lb[i].key)) { used.add(lb[i].key); one(null, lb[i]); }
        used.add(zb.key);
      }
      one(za, zb);
    });
    lb.forEach((zb) => { if (!used.has(zb.key)) { used.add(zb.key); one(null, zb); } });
  }
  return { rows, lines, same, read };
}

const inr = (v) => (v < 0 ? "-" : "") + new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v));
// a file's name as a column's heading: its start and its end (where "draft" and "final" usually are)
const short = (n) => { const t = String(n || "").replace(/\.[a-z0-9]+$/i, ""); return t.length > 34 ? t.slice(0, 14) + "…" + t.slice(-19) : t; };

async function pdfText(file) {
  if (typeof getPdf !== "function" || typeof pageTextLines !== "function") throw new Error("the PDF reader could not be loaded");
  const pdf = await getPdf(file);
  let text = "";
  for (let p = 1; p <= Math.min(pdf.numPages, 40); p++) text += pageTextLines(await (await pdf.getPage(p)).getTextContent()) + "\n";
  return text;
}

// two attached files: {result, brief} for the answer, or {why} when nothing could be compared here
export async function compareFiles(ua, ub) {
  const [ta, tb] = await Promise.all([pdfText(ua.file), pdfText(ub.file)]);
  const c = compareText(ta, tb);
  const none = (r) => !r.bs && !r.pl;
  if (none(c.read.a) || none(c.read.b)) {
    const which = none(c.read.a) ? ua.name : ub.name;
    return { why: "FinCom could not find a balance sheet or a profit and loss with figures in " + which + " (a scanned copy?): the AI reads both files as they are, nothing here was compared line by line." };
  }
  const A = short(ua.name), B = short(ub.name);
  const result = {
    id: "cmp" + Date.now().toString(36), tool: "compare_statements", label: "compare", title: "Differences between the two statements",
    columns: [{ k: "st", label: "Statement" }, { k: "line", label: "Line" }, { k: "a", label: A, t: "amount" }, { k: "b", label: B, t: "amount" }, { k: "d", label: "Difference", t: "amount" }, { k: "why", label: "Note" }],
    rows: c.rows,
    basis: "Difference: the second file's figure less the first's. " + c.lines + " lines compared (the face of the balance sheet and of the profit and loss, as printed in each PDF, in rupees): " + (c.rows.length ? c.rows.length + " differ, " + c.same + " agree." : "all agree."),
  };
  const brief = "[FinCom read both PDFs and compared them line by line (first = " + A + ", second = " + B + "): " + c.lines + " lines, " + c.rows.length + " differ" +
    (c.rows.length ? ". The differences (second − first, in rupees), shown as a table under your answer:\n" + c.rows.slice(0, 40).map((r) => "- " + r.st + " | " + r.line + " | " + (r.a == null ? "not in the first" : inr(r.a)) + " | " + (r.b == null ? "not in the second" : inr(r.b)) + " | " + (r.d >= 0 ? "+" : "") + inr(r.d)).join("\n") : "") +
    "]\nExplain the main differences and what they mean; use these figures.";
  return { result, brief };
}
