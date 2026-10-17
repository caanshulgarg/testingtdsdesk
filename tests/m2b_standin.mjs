// node m2b_standin.mjs < request.json - a stand-in for the gst-2b-match function in the screen tests (run_2b_automatch_ui.py):
// the same rules file the function runs (server/_shared/match2b.js), and in place of Claude a fixed stand-in that pairs
// the documents left over whose numbers end in the same digits and whose suppliers have the same PAN. Never the real API.
// stdin: {books, twob: [{period, rows}], decisions, ai, why}; stdout: the run as the function answers it.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const M = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "_shared", "match2b.js"));
const q = JSON.parse(fs.readFileSync(0, "utf8"));
const twob = q.twob.flatMap((t) => t.rows), books = q.books, dec = q.decisions || {};
const rules = M.m2bRules(twob, books);
let pairs = [], ai = { state: "off", say: "AI is off for this firm or client (Settings, AI help): the rules' result stands.", inr: 0 };
if (q.ai) {
  const inp = M.m2bAiInput(twob, books, rules.left2b, rules.leftBooks), last = (n) => (String(n).match(/\d+/g) || []).pop() || "";
  const used = new Set(), out = [];
  inp.g.forEach((g) => { const b = inp.b.find((x) => !used.has(x.id) && last(x.no) === last(g.no) && x.gstin.slice(2, 12) === g.gstin.slice(2, 12)); if (b) { used.add(b.id); out.push({ g: [g.id], b: [b.id], kind: "typo", reason: "invoice number written differently", confidence: "high" }); } });
  const parsed = M.m2bAiParse(JSON.stringify({ pairs: out }), inp.map);
  pairs = parsed.pairs;
  ai = { state: "used", say: "", inr: 1.87, model: "claude-sonnet-5-5" };
}
const res = M.m2bAiApply(twob, books, rules, pairs, dec);
if (q.ai) ai.say = "AI looked at the documents left: " + res.counts.byAi + " matched by AI, " + res.counts.probable + " to confirm · cost ₹1.87";
process.stdout.write(JSON.stringify({ ok: true, run: { id: q.id || 1, why: q.why, status: "done", at: new Date().toISOString(), line: M.m2bLine(res.counts), counts: res.counts, result: res, ai, decisions: dec } }));
