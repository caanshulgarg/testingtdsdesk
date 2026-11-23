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
// (review 2) the bridge that will post it, as Bridge.post routes it (src/js/24-tally-bridge.js, B11): every posting goes
// through the cloud's queue when the client's books are in FinCom's cloud (TCloud.has), also with a bridge on this
// computer, so the bridge asked is the one the queue hands it to (TCloud.postThrough); straight to the bridge here only
// when the cloud is not there for this client
export function postingBridge(co, g = G) {
  try {
    const T = g.TCloud, viaCloud = !!(co && T && typeof T.has === "function" && (typeof T.on !== "function" || T.on()) && T.has(co.id));
    if (viaCloud && typeof T.postThrough === "function") {
      const t = T.postThrough(co);
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
// the voucher types a payroll voucher can be entered with (the Payroll page's picker): Tally's own "Payroll" and every
// type the books' payroll entries carry
export function vchTypesOf(pay, b) {
  const t = new Set(["Payroll"]);
  Object.values((pay && pay.vouchers) || {}).forEach((v) => { if (v && v.type && /payroll|salary|pay\s*slip/i.test(v.type)) t.add(String(v.type)); });
  ((b && b.vouchers) || []).forEach((v) => { if (v && /payroll/i.test(String(v.type || ""))) t.add(String(v.type)); });
  return Array.from(t).sort((a, c) => (a === "Payroll" ? -1 : c === "Payroll" ? 1 : a.localeCompare(c)));
}
// (review B1) a payroll entry already in Tally for the month that FinCom did not post (no TDSDesk:dc-tp-<yyyymm>- in its
// narration): Tally's payroll read (Payroll.data(): the entries with pay-head allocations) and the books' payroll-type
// vouchers. Posting would book the month twice: refused, with the entry named
export function payrollInTally(ym, pay, b) {
  const tag = "TDSDesk:dc-tp-" + ym + "-", V = new Map(((b && b.vouchers) || []).filter((v) => v && v.id).map((v) => [String(v.id), v])), out = [];
  const inMonth = (d) => String(d || "").replace(/-/g, "").slice(0, 6) === ym;
  const seen = new Set(), add = (id, day, type, no, narr) => { if (seen.has(id)) return; seen.add(id); if (!String(narr || "").includes(tag)) out.push({ id, day: String(day || "").replace(/-/g, ""), type, no }); };
  const pv = (pay && pay.vouchers) || {};
  ((pay && pay.allocs) || []).forEach((a) => { if (!a || !inMonth(a.day)) return; const v = V.get(String(a.guid)) || {}, h = pv[a.guid] || {}; add(String(a.guid), a.day, h.type || v.type || "", h.no || v.no || "", v.narr); });
  V.forEach((v, id) => { if (!v.cancel && !v.opt && /payroll/i.test(String(v.type || "")) && inMonth(v.date)) add(id, v.date, v.type, v.no, v.narr); });
  return out;
}
const dmy = (d) => (/^\d{8}$/.test(d) ? d.slice(6, 8) + "-" + d.slice(4, 6) + "-" + d.slice(0, 4) : d);
// o: {co, ym, rows, date, pay (Payroll.data()), ledgers (the client's Tally ledger names), books (S.books), payable (the
// night entry's party, when it names one)} -> {vouchers, missing (sheet heads with no pay head picked), problems (plain
// words: what Tally lacks, what the bridge could not take), payable}
export function prepare(o) {
  const co = o.co || {}, pay = o.pay || {}, heads = pay.heads || {};
  const emps = (pay.employees || []).filter((e) => e && e.name && !e.group && !e.gone);
  const { plan, missing } = TP.payHeadPlan(o.rows || [], heads, co.payHeadPlan || {});
  // the ledger picked on Payroll; else the one the night's entry names; else one named like salary payable
  const L = o.ledgers || [], payable = co.payrollPayable && L.includes(co.payrollPayable) ? co.payrollPayable : o.payable && L.includes(o.payable) ? o.payable : payableOf(co, L);
  const read = emps.length > 0 || Object.keys(heads).length > 0;
  const out = TP.payrollVouchers({ id: "dc-tp-" + o.ym, idOf: (i) => voucherIdOf(o.ym, i), date: o.date || lastDay(o.ym), label: monLabel(o.ym), type: co.payrollVchType || "Payroll",
    payable, rows: o.rows || [], plan, employees: emps });
  let problems = out.problems.filter((p) => !/^Pick the pay head for /.test(p));
  if (!read) problems = ["FinCom has not read this company’s payroll from Tally yet (its employees and pay heads). Open the company in Tally and read the books again"];
  if (!payable && (o.ledgers || []).length) problems = problems.filter((p) => p !== "Pick the salary payable ledger").concat(["Tally has no salary payable ledger FinCom can tell (a ledger named like “Salary Payable”). Create it in Tally, or pick it on Payroll"]);
  const there = payrollInTally(o.ym, pay, o.books);
  if (there.length) problems = ["Tally already has a payroll entry for " + monLabel(o.ym) + " that FinCom did not post (" + there.slice(0, 2).map((x) => [x.type, x.no ? "no. " + x.no : "", dmy(x.day)].filter(Boolean).join(" ")).join("; ") + (there.length > 2 ? "; and " + (there.length - 2) + " more" : "") +
    "). Check it in Tally: FinCom does not post the month twice"].concat(problems);
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
  if (r.state === "sent" && r.onWay) return of + "on its way to Tally (sent before; not sent again). " + String(r.msg || "");
  if (r.state === "sent") return of + "queued for the Tally computer. " + String(r.msg || "It posts by itself.");
  return of ? of + "not posted. " + String(r.msg || "") : String(r.msg || "Not posted.");
}

// ---------------------------------------------------------------- one voucher, in a posting of its own
// Bridge.post's answer for the voucher -> the part's result. (review 6) as the bank path takes them (src/js/24, 59):
// already in Tally (the bridge found FinCom's id there: "already", "alreadyThere", "Already in Tally (voucher no. …)") is
// in Tally; held back by the resend guard (alreadySent: it went from that computer before) or a job whose answer never
// came here (notAnswered with its job) is on its way, settled from that job: neither is a failure, neither sent again
const alreadyIn = (x) => !!x && (x.already === true || (x.ok === true && (x.alreadyThere === true || x.existed === true)) || (!x.ok && /^Already in Tally \(voucher no\./i.test(String(x.message || ""))));
export function resultOf(x, out, A, why) {
  if (!x) return { ok: false, state: "failed", msg: out && out.notAllowed ? "Not allowed." : "Tally did not answer for this voucher." };
  if (alreadyIn(x)) return { ok: true, state: "posted", existed: true, created: 0, tallyId: A.tallyIdOf(x) || String(x.vchNumber || x.vchNo || "") || ((String(x.message || "").match(/voucher no\.\s*([^)\s]+)/i) || [])[1] || ""), msg: String(x.message || x.word || "Already in Tally").slice(0, 200) };
  if (x.ok) return { ok: true, state: "posted", existed: false, created: x.created == null ? null : Number(x.created), tallyId: A.tallyIdOf(x), msg: String(x.word || "In Tally").slice(0, 200) };
  if (x.held) return { ok: false, state: "sent", msg: String(x.message || "").slice(0, 300), job: x.job || (out && out.job && out.job.id) || "" };
  if (x.alreadySent === true || (x.notAnswered === true && x.jobId)) return { ok: false, state: "sent", onWay: true, msg: String(x.message || "").replace(/^Failed:\s*/i, "").slice(0, 300), job: String((x.notAnswered ? x.jobId : x.sentJob) || x.jobId || (out && out.job && out.job.id) || "") };
  return { ok: false, state: "failed", msg: why(x.message || x.word).slice(0, 400), said: String(x.message || "").slice(0, 300) };
}
// the draft of a part (dc-tp-<yyyymm>-<n>), kept with the client's books: the voucher exactly as built (its XML, the proof
// of what each part holds: review B2) and how many parts the month has (the night counts the month done only with all)
function draftOf(co, e, v, A, at) {
  const d = A.Drafts.get(co.id, v.id) || { id: v.id, from: "daily", kind: "tallyPayroll", created: at(), by: A.me() };
  return Object.assign(d, { dedupe: e.dedupe, night_entry: e.id, parts: v.parts, part: v.part, title: "Tally Payroll " + monLabel(String(e.voucher.period)) + (v.parts > 1 ? ", part " + v.part + " of " + v.parts : ""),
    vouchers: [{ id: v.id, kind: "tallyPayroll", type: v.type, date: v.date, narration: v.narration, category: v.category, employees: v.employees.length, gross: v.gross, net: v.net, xml: TP.payrollVoucherXml(v) }], removed: false });
}
async function postOne(co, company, e, v, A, g, progress) {
  const at = () => new Date().toISOString(), xml = TP.payrollVoucherXml(v);
  const d = draftOf(co, e, v, A, at);
  d.state = "posting";
  d.results = Object.assign({}, d.results, { [v.id]: { ok: false, state: "sent", msg: "", at: at() } });
  await A.Drafts.save(co.id, d, "pressed Approve (Tally Payroll): " + v.employees.length + " employees, net " + v.net.toFixed(2) + " to " + company + (v.parts > 1 ? ", part " + v.part + " of " + v.parts : ""));
  let out = null, x = null;
  try {
    out = await g.Bridge.post({ company, client: co.id, masters: [], vouchers: [{ id: v.id, xml }] }, (pj) => { try { progress && progress(v, pj); } catch (err) { /* only words */ } });
    x = [].concat((out && out.results) || []).find((r) => r && r.id === v.id) || null;
  } catch (err) { x = { id: v.id, ok: false, message: errWords(err) || "The posting did not go through." }; }
  if (out && out.job && out.job.id) d.job = out.job.id;
  const r = resultOf(x, out, A, (m) => plainPayrollWhy(m, (s) => A.plainWhy(s, co.id)));
  if (r.job && !d.job) d.job = r.job;
  r.at = at();
  d.results[v.id] = r; d.state = r.ok ? "posted" : r.state === "sent" ? "posting" : "failed";
  const res = Object.assign({ id: v.id, part: v.part, parts: v.parts, employees: v.employees.length, net: v.net }, r);
  res.words = partWords(res);
  await A.Drafts.save(co.id, d, "Tally Payroll: " + res.words);
  return res;
}
// (review, low: the page closed between parts) the cloud settles a claim left half way from the month's LATEST draft
// (migration 208 asst_draft_state): after a part is in Tally, a part not yet sent is saved again ("waiting"), so the
// latest draft is never a posted part while another is still to go: the entry goes back to ready, not to approved, and
// Approve again posts only what is missing
async function holdNext(co, e, v, A) {
  const at = () => new Date().toISOString(), d = draftOf(co, e, v, A, at);
  if (((d.results || {})[v.id] || {}).ok) return;
  d.state = "waiting"; d.results = Object.assign({}, d.results, { [v.id]: { ok: false, state: "waiting", msg: "", at: at() } });
  await A.Drafts.save(co.id, d, "Tally Payroll: part " + v.part + " of " + v.parts + " to post next");
}

// ---------------------------------------------------------------- Approve
// e: the night's payroll entry (night_entries row); env (tests, the page): {g, A, recheck, rpc, books, pay, prior, seen,
// progress, jobs}. Returns {ok, words, proof, queued} or {ok: false, why, install?, problems?, proof?}
export async function approveTallyPayroll(e, env = {}) {
  const g = env.g || G, cid = e.client_id, ym = String((e.voucher || {}).period || ""), ev = e.voucher || {};
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
  // 2. the second check: the night's builder again on the books here (again.js recheck), the month's own parts left out
  // (review B3: a part already in Tally is what is being finished, not salary booked since)
  const drafts = (await A.Drafts.load(cid, true)) || [];
  const mine = drafts.filter((d) => d && /^dc-tp-/.test(String(d.id || "")) && d.dedupe === e.dedupe && !d.removed);
  const ledgers = ((await A.clientLedgers(co, true)) || []).map((l) => l.name);
  const recheck = env.recheck || (await import("../screens/daily/again.js")).recheck;
  const why1 = await recheck(e, Object.assign({ prior: env.prior || [], drafts: drafts.filter((d) => !mine.includes(d)), ledgers }, env.jobs ? { jobs: env.jobs } : {}, env.now != null ? { now: env.now } : {}, env.bookId != null ? { bookId: env.bookId } : {}));
  if (why1) return no(why1);
  const b = env.books || (g.S && g.S.books) || {};
  // (review 3) the payable ledger is the one the night's entry names (the Payroll page's pick, else the one certain by
  // name); a night entry naming none takes the one found now
  const p = prepare({ co, ym, rows: monthRows(b, ym), date: iso(ev.date), pay: env.pay || payData(g), ledgers, books: b, payable: ev.kind === "tallyPayroll" ? ev.party : "" });
  if (p.missing.length) return no("Pick the Tally pay head for " + p.missing.map(TP.keyWords).join(", ") + " on Payroll first.", { problems: p.problems });
  if (p.problems.length) return no("Not posted: " + p.problems[0] + (p.problems.length > 1 ? " (and " + (p.problems.length - 1) + " more on Payroll)" : "") + ".", { problems: p.problems });
  const xmls = p.vouchers.map(TP.payrollVoucherXml);
  if (env.seen && env.seen.join("") !== xmls.join("")) return no("The salary kept with the books is not the sheet shown here. Keep this sheet with the books; Daily Check checks it again tonight.");
  const gross = p.vouchers.reduce((s, v) => s + P(v.gross), 0), net = p.vouchers.reduce((s, v) => s + P(v.net), 0);
  if (ev.kind === "tallyPayroll") {
    if (P(ev.gross) !== gross || P(ev.net) !== net || (ev.party && ev.party !== p.payable) || p.vouchers.some((v) => v.payable !== p.payable)) return no(CHANGED);
  } else {
    const lines = ev.lines || [], dr = lines.reduce((s, l) => s + P(l.dr), 0), cr = lines.filter((l) => l.ledger === ev.party).reduce((s, l) => s + P(l.cr), 0);
    if (dr !== gross || cr !== net) return no(CHANGED);
  }
  // a part already in Tally is not sent again, only when it is the very part built now (review B2: its saved voucher's
  // XML the same, byte for byte); one on its way is waited for
  const done = new Map(), byId = new Map(p.vouchers.map((v, i) => [v.id, xmls[i]]));
  for (const d of mine) {
    const r = (d.results || {})[d.id] || {};
    if (!byId.has(d.id) && r.ok) return no("Part of this month is already in Tally from an earlier approval, split differently. Check Tally before posting the rest.");
    if (r.ok) {
      const was = String((((d.vouchers || [])[0]) || {}).xml || "");
      if (was !== byId.get(d.id)) return no("Part " + (Number(d.part) || String(d.id).split("-").pop()) + " in Tally differs from the sheet now (other employees or amounts). Check that part in Tally; FinCom posts nothing until the sheet kept with the books is the one posted.");
      done.set(d.id, r); continue;
    }
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
  const proof = [], todo = p.vouchers.filter((v) => !done.has(v.id));
  for (const v of p.vouchers) {
    if (done.has(v.id)) { const r = Object.assign({ id: v.id, part: v.part, parts: v.parts, employees: v.employees.length, net: v.net }, done.get(v.id)); r.words = partWords(r); proof.push(r); continue; }
    const r = await postOne(co, company, e, v, A, g, env.progress);
    proof.push(r);
    if (r.state === "failed") break;
    const next = todo.filter((x) => x.part > v.part);
    if (next.length && r.ok) await holdNext(co, e, next[next.length - 1], A);
  }
  // 5. the proof, and the decision
  const failed = proof.find((r) => r.state === "failed") || (proof.length < p.vouchers.length ? { words: "Not all parts were sent." } : null);
  if (failed) {
    await rpc("entry_release", { p_id: e.id, p_why: String(failed.words || "").slice(0, 200) }).catch(() => null);
    return no(failed.words, { proof });
  }
  await rpc("entry_approved", { p_id: e.id, p_work_ref: p.vouchers[0].id });
  return { ok: true, proof, queued: proof.some((r) => r.state === "sent"), words: proof.map((r) => r.words).join(" ") };
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
    return ds.sort((a, b) => String(a.id).localeCompare(String(b.id), "en", { numeric: true })).map((d, i) => { const r = Object.assign({ id: d.id, part: Number(d.part) || i + 1, parts: Number(d.parts) || ds.length }, (d.results || {})[d.id] || {}); r.words = partWords(r); return r; });
  } catch (e) { return []; }
}
