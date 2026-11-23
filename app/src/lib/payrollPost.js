// Approve for a Tally Payroll company (next-payroll, docs/PAYROLL.md 4.3; bridge 2.5.18, FinComPayrollImport): the month's
// salary posted as Tally's own payroll voucher, the way Daily Check posts its journals (data.js approveJournal):
//   1. may it be posted here: the client's posting company and Tally connected (asstEntries postGate), and the bridge
//      that posts it 2.5.18 or later (an older bridge has no FinComPayrollImport): else "Install FinCom Bridge 2.5.18"
//   2. the second check: the night's entry is still what the books make (again.js recheck: the sheet kept with the books,
//      nothing booked since), the vouchers made again from the books now, every employee and pay head one Tally has
//      (the payroll FinCom read from Tally: Payroll.data(); no new Tally request), the bridge's own rules met, the same
//      gross and net as the night's entry, and (on the Payroll page) the very vouchers the person was shown
//   3. the claim (migration 208 entry_claim: ready -> approving, one person at a time), so two people never post it twice
//   4. each voucher in a posting of its own (Bridge.post: the bridge here or the cloud's queue; the bridge posts a payroll
//      voucher alone too), its draft kept with the client's books (asstEntries Drafts, "dc-tp-<yyyymm>-<n>", the night's
//      dedupe), the bridge's own check by FinCom's id against posting twice
//   5. the proof: Tally's answer for each voucher (created, with its voucher id) or Tally's refusal in plain words; then
//      entry_approved, or entry_release so it can be tried again
// Loaded only with the Payroll page or an Approve of a payroll entry (a lazy chunk).
import * as TP from "./tallyPayroll.js";
import { monLabel } from "./payrollSheet.js";
import { sheetMonth } from "../../../server/_shared/nightchecks.js";

export const NEED = "2.5.18";
export const OLD_BRIDGE = "Install FinCom Bridge " + NEED + " to post Tally Payroll";
export const CHANGED = "Changed since last night. Run again.";
/* global S, CO, Bridge, TCloud, Cloud, Payroll, tallyVia */
// the app's globals (legacy.js declares them with const: names in the page's global scope, not properties of window),
// read when used; the tests hand in their own (env.g)
const G = {
  get S() { return typeof S === "object" ? S : undefined; }, get CO() { return typeof CO === "function" ? CO : undefined; },
  get Bridge() { return typeof Bridge === "object" ? Bridge : undefined; }, get TCloud() { return typeof TCloud === "object" ? TCloud : undefined; },
  get Cloud() { return typeof Cloud === "object" ? Cloud : undefined; }, get Payroll() { return typeof Payroll === "object" ? Payroll : undefined; },
  get tallyVia() { return typeof tallyVia === "function" ? tallyVia : undefined; }, fetch: (...a) => fetch(...a),
};
const P = (x) => Math.round((Number(x) || 0) * 100);
const vkey = (v) => String(v || "").split(".").map((x) => String(parseInt(x, 10) || 0).padStart(3, "0")).join(".");
export const bridgeOk = (v) => !!String(v || "").trim() && vkey(v) >= vkey(NEED);
const errWords = (x) => String((x && x.message) || x || "").replace(/^.*?ERROR:\s*/, "");
const iso = (d) => { const t = String(d || "").replace(/-/g, ""); return /^\d{8}$/.test(t) ? t.slice(0, 4) + "-" + t.slice(4, 6) + "-" + t.slice(6, 8) : ""; };
export const lastDay = (ym) => ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-" + String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(4, 6), 0)).getUTCDate()).padStart(2, "0");
export const voucherIdOf = (ym, i) => "dc-tp-" + ym + "-" + (i + 1);
export const dedupeOf = (ym) => "payroll:" + ym;

// ---------------------------------------------------------------- the bridge that will post it
// the bridge here when this computer posts; else the one the cloud's queue hands it to (TCloud.postThrough); its version
export function postingBridge(co, g = G) {
  try {
    const via = typeof g.tallyVia === "function" ? g.tallyVia(co) : null;
    if (via === "cloud" && g.TCloud && typeof g.TCloud.postThrough === "function") {
      const t = g.TCloud.postThrough(co);
      return t ? { version: String(t.version || ""), where: [t.computer, t.user].filter(Boolean).join(" · ") } : { version: "", where: "" };
    }
    const st = (g.Bridge && g.Bridge.st) || {};
    return { version: String(st.version || ""), where: "this computer" };
  } catch (e) { return { version: "", where: "" }; }
}
// the FinCom Bridge setup this site hands out (assets/bridge-go/latest.json, as the Tally page reads it)
export async function setupLink(fetchFn = G.fetch) {
  try {
    const r = await fetchFn("assets/bridge-go/latest.json", { cache: "no-store" });
    const m = r && r.ok ? await r.json() : null, s = m && m.setup;
    if (!s || !s.url) return null;
    const file = String(s.url).split("/").pop();
    return { file, version: String(s.version || ""), href: "assets/bridge-go/" + file + (s.sha256 ? "?v=" + String(s.sha256).slice(0, 12) : "") };
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- the month's vouchers, and what Tally must have first
export const monthRows = (b, ym) => ((b && b.salary) || []).filter((r) => sheetMonth(r) === ym);
export const payData = (g = G) => { try { return typeof g.Payroll === "object" && g.Payroll ? g.Payroll.data() : {}; } catch (e) { return {}; } };
export function payableOf(co, ledgers) {
  const l = ledgers || [];
  return co && co.payrollPayable && l.includes(co.payrollPayable) ? co.payrollPayable : l.find((x) => /salar(y|ies).*payable|payable.*salar/i.test(x)) || "";
}
// o: {co, ym, rows, date, pay (Payroll.data()), ledgers (the client's Tally ledger names)} -> {vouchers, missing (sheet heads
// with no pay head picked), problems (plain words: what Tally lacks, what the bridge could not take), payable}
export function prepare(o) {
  const co = o.co || {}, pay = o.pay || {}, heads = pay.heads || {};
  const emps = (pay.employees || []).filter((e) => e && e.name && !e.group && !e.gone);
  const { plan, missing } = TP.payHeadPlan(o.rows || [], heads, co.payHeadPlan || {});
  const payable = payableOf(co, o.ledgers || []);
  const read = emps.length > 0 || Object.keys(heads).length > 0;
  const out = TP.payrollVouchers({ id: "dc-tp-" + o.ym, idOf: (i) => voucherIdOf(o.ym, i), date: o.date || lastDay(o.ym), label: monLabel(o.ym), type: co.payrollVchType || "Payroll",
    payable, rows: o.rows || [], plan, employees: emps });
  let problems = out.problems.filter((p) => !/^Pick the pay head for /.test(p));
  if (!read) problems = ["FinCom has not read this company’s payroll from Tally yet (its employees and pay heads). Open the company in Tally and read the books again"];
  if (!payable && (o.ledgers || []).length) problems = problems.filter((p) => p !== "Pick the salary payable ledger").concat(["Tally has no salary payable ledger FinCom can tell (a ledger named like “Salary Payable”). Create it in Tally, or pick it on Payroll"]);
  return { vouchers: missing.length || problems.length ? [] : out.vouchers, missing, problems, payable, plan };
}

// ---------------------------------------------------------------- Tally's answer, in plain words
const MASTER = [[/employee/i, "employee", "Create it in Tally (Payroll › Employee)"], [/pay\s*head/i, "pay head", "Create it in Tally (Payroll › Pay Head)"],
  [/voucher\s*type/i, "voucher type", "Create a Payroll voucher type in Tally, or pick the one this company uses"], [/cost\s*category/i, "cost category", "Create it in Tally"],
  [/ledger/i, "ledger", "Create it in Tally"]];
export function plainPayrollWhy(msg, plainWhy) {
  const m = String(msg || "");
  if (/not one payroll voucher|FinComPayrollImport/i.test(m)) return "FinCom Bridge refused it: the voucher was not exactly the payroll shape it takes. Nothing was sent to Tally.";
  if (/does not exist|not found|could not find|no such|missing/i.test(m)) {
    for (const [re, what, fix] of MASTER) if (re.test(m)) {
      const n = (m.match(/['"“‘]([^'"”’]{1,200})['"”’]/) || [])[1];
      return "Tally has no " + what + (n ? " “" + n + "”" : " named in the voucher") + ". " + fix + ", then Approve again.";
    }
  }
  return typeof plainWhy === "function" ? plainWhy(m) : m.replace(/^Failed:\s*/i, "") || "Not posted.";
}
export function partWords(r) {
  const of = r.parts > 1 ? "Part " + r.part + " of " + r.parts + ": " : "";
  if (r.ok && r.existed) return of + "already in Tally (not sent again).";
  if (r.ok) { const n = Number(r.created) || 0; return of + (n ? "Tally created " + n + " payroll voucher" + (n === 1 ? "" : "s") : String(r.msg || "In Tally")) + (r.tallyId ? " (voucher id " + r.tallyId + ")" : "") + "."; }
  if (r.state === "sent") return of + "queued for the Tally computer. " + String(r.msg || "It posts by itself.");
  return of ? of + "not posted. " + String(r.msg || "") : String(r.msg || "Not posted.");
}

// ---------------------------------------------------------------- one voucher, in a posting of its own
async function postOne(co, company, e, v, A, g, progress) {
  const at = () => new Date().toISOString(), xml = TP.payrollVoucherXml(v);
  const d = A.Drafts.get(co.id, v.id) || { id: v.id, from: "daily", kind: "tallyPayroll", created: at(), by: A.me() };
  Object.assign(d, { dedupe: e.dedupe, night_entry: e.id, title: "Tally Payroll " + monLabel(String(e.voucher.period)) + (v.parts > 1 ? ", part " + v.part + " of " + v.parts : ""),
    vouchers: [{ id: v.id, kind: "tallyPayroll", type: v.type, date: v.date, narration: v.narration, employees: v.employees.length, gross: v.gross, net: v.net, xml }], state: "posting", removed: false });
  d.results = Object.assign({}, d.results, { [v.id]: { ok: false, state: "sent", msg: "", at: at() } });
  await A.Drafts.save(co.id, d, "pressed Approve (Tally Payroll): " + v.employees.length + " employees, net " + v.net.toFixed(2) + " to " + company + (v.parts > 1 ? ", part " + v.part + " of " + v.parts : ""));
  let out = null, x = null;
  try {
    out = await g.Bridge.post({ company, client: co.id, masters: [], vouchers: [{ id: v.id, xml }] }, (pj) => { try { progress && progress(v, pj); } catch (err) { /* only words */ } });
    x = [].concat((out && out.results) || []).find((r) => r && r.id === v.id) || null;
  } catch (err) { x = { id: v.id, ok: false, message: errWords(err) || "The posting did not go through." }; }
  if (out && out.job && out.job.id) d.job = out.job.id;
  const why = (m) => plainPayrollWhy(m, (s) => A.plainWhy(s, co.id));
  const r = !x ? { ok: false, state: "failed", msg: out && out.notAllowed ? "Not allowed." : "Tally did not answer for this voucher." }
    : x.ok ? { ok: true, state: "posted", existed: !!x.existed, created: x.created == null ? null : Number(x.created), tallyId: A.tallyIdOf(x), msg: String(x.word || "In Tally").slice(0, 200) }
    : x.held ? { ok: false, state: "sent", msg: String(x.message || "").slice(0, 300), job: x.job || (out && out.job && out.job.id) || "" }
    : { ok: false, state: "failed", msg: why(x.message || x.word).slice(0, 400), said: String(x.message || "").slice(0, 300) };
  r.at = at();
  d.results[v.id] = r; d.state = r.ok ? "posted" : r.state === "sent" ? "posting" : "failed";
  const res = Object.assign({ id: v.id, part: v.part, parts: v.parts, employees: v.employees.length, net: v.net }, r);
  res.words = partWords(res);
  await A.Drafts.save(co.id, d, "Tally Payroll: " + res.words);
  return res;
}

// ---------------------------------------------------------------- Approve
// e: the night's payroll entry (night_entries row); env (tests, the page): {g, A, recheck, rpc, books, pay, prior, seen,
// progress}. Returns {ok, words, proof} or {ok: false, why, install?, problems?, proof?}
export async function approveTallyPayroll(e, env = {}) {
  const g = env.g || G, cid = e.client_id, ym = String((e.voucher || {}).period || "");
  const no = (why, extra) => Object.assign({ ok: false, why }, extra || {});
  if (!/^\d{6}$/.test(ym)) return no("This payroll entry names no month. Run again.");
  const co = env.co || (typeof g.CO === "function" ? g.CO(cid) : null);
  if (!co) return no("This client is not open here.");
  const A = env.A || await import("./asstEntries.js");
  const rpc = env.rpc || ((fn, args) => g.Cloud.api("rpc/" + fn, { method: "POST", body: args || {} }));
  // 1. may it be posted, and by a bridge that knows the payroll voucher
  const gate = A.postGate(co);
  if (!gate.ok) return no(gate.why);
  const br = postingBridge(co, g);
  if (!bridgeOk(br.version)) return no(OLD_BRIDGE + ".", { install: true, version: br.version, where: br.where });
  const company = A.postCompany(co);
  { const why = TP.companyProblem(company); if (why) return no(why + "."); }
  // 2. the second check
  const drafts = (await A.Drafts.load(cid, true)) || [];
  const mine = drafts.filter((d) => d && /^dc-tp-/.test(String(d.id || "")) && d.dedupe === e.dedupe && !d.removed);
  const recheck = env.recheck || (await import("../screens/daily/again.js")).recheck;
  const why1 = await recheck(e, { prior: env.prior || [], drafts: drafts.filter((d) => !mine.includes(d)) });
  if (why1) return no(why1);
  const b = env.books || (g.S && g.S.books) || {};
  const ledgers = ((await A.clientLedgers(co, true)) || []).map((l) => l.name);
  const p = prepare({ co, ym, rows: monthRows(b, ym), date: iso((e.voucher || {}).date), pay: env.pay || payData(g), ledgers });
  if (p.missing.length) return no("Pick the Tally pay head for " + p.missing.map(TP.keyWords).join(", ") + " on Payroll first.", { problems: p.problems });
  if (p.problems.length) return no("Not posted: " + p.problems[0] + (p.problems.length > 1 ? " (and " + (p.problems.length - 1) + " more on Payroll)" : "") + ".", { problems: p.problems });
  const xmls = p.vouchers.map(TP.payrollVoucherXml);
  if (env.seen && env.seen.join("") !== xmls.join("")) return no("The salary kept with the books is not the sheet shown here. Keep this sheet with the books; Daily Check checks it again tonight.");
  const lines = (e.voucher || {}).lines || [], dr = lines.reduce((s, l) => s + P(l.dr), 0), net = lines.filter((l) => l.ledger === e.voucher.party).reduce((s, l) => s + P(l.cr), 0);
  if (dr !== p.vouchers.reduce((s, v) => s + P(v.gross), 0) || net !== p.vouchers.reduce((s, v) => s + P(v.net), 0)) return no(CHANGED);
  // a part already in Tally is not sent again; one on its way is waited for
  const done = new Map(), ids = new Set(p.vouchers.map((v) => v.id));
  for (const d of mine) {
    const r = (d.results || {})[d.id] || {};
    if (!ids.has(d.id) && r.ok) return no("Part of this month is already in Tally from an earlier approval, split differently. Check Tally before posting the rest.");
    if (r.ok) { done.set(d.id, r); continue; }
    if (r.state === "sent" && (r.job || d.job)) {
      let live = true;
      try { const j = ((await g.Cloud.api("tally_post_jobs?select=id,status&id=eq." + encodeURIComponent(r.job || d.job))) || [])[0]; live = !!j && ["waiting", "taken", "running"].includes(j.status); } catch (x) { live = true; }
      if (live) return no("On its way to Tally: wait for it to finish.");
    }
  }
  // 3. the claim
  try { const c = await rpc("entry_claim", { p_id: e.id }); if (c && c.ok === false) return no(c.why || "This entry is not ready."); }
  catch (x) { return no(errWords(x) || "This entry is not ready."); }
  // 4. each voucher alone, in order; a refusal stops the rest
  const proof = [];
  for (const v of p.vouchers) {
    if (done.has(v.id)) { const r = Object.assign({ id: v.id, part: v.part, parts: v.parts, employees: v.employees.length, net: v.net }, done.get(v.id)); r.words = partWords(r); proof.push(r); continue; }
    const r = await postOne(co, company, e, v, A, g, env.progress);
    proof.push(r);
    if (r.state === "failed") break;
  }
  // 5. the proof, and the decision
  const failed = proof.find((r) => r.state === "failed") || (proof.length < p.vouchers.length ? { words: "Not all parts were sent." } : null);
  if (failed) {
    await rpc("entry_release", { p_id: e.id, p_why: String(failed.words || "").slice(0, 200) }).catch(() => null);
    return no(failed.words, { proof });
  }
  await rpc("entry_approved", { p_id: e.id, p_work_ref: p.vouchers[0].id });
  return { ok: true, proof, words: proof.map((r) => r.words).join(" ") };
}

// the night's payroll entry for the month (Daily Check, migration 206/208's night_entries; RLS: the firm's own), or null
export async function loadEntry(cid, ym, g = G) {
  try {
    if (!(g.Cloud && typeof g.Cloud.on === "function" && g.Cloud.on())) return null;
    const r = await g.Cloud.api("night_entries?select=id,client_id,finding_id,source,dedupe,work_ref,voucher,reason,why,evidence,checks,state,updated_at&client_id=eq." + encodeURIComponent(cid) +
      "&source=eq.payroll&dedupe=eq." + encodeURIComponent(dedupeOf(ym)) + "&state=in.(ready,approving,approved)&order=updated_at.desc&limit=1");
    return (r || [])[0] || null;
  } catch (e) { return null; }
}
// what the month's drafts say Tally answered (the proof of an earlier Approve), part by part
export async function proofOf(cid, ym, A) {
  try {
    const ds = ((await A.Drafts.load(cid)) || []).filter((d) => d && !d.removed && d.dedupe === dedupeOf(ym) && /^dc-tp-/.test(String(d.id || "")));
    return ds.sort((a, b) => String(a.id).localeCompare(String(b.id), "en", { numeric: true })).map((d, i) => { const r = Object.assign({ id: d.id, part: i + 1, parts: ds.length }, (d.results || {})[d.id] || {}); r.words = partWords(r); return r; });
  } catch (e) { return []; }
}
