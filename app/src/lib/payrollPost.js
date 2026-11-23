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
import { sheetMonth, earningHead, notSalaryHeadName } from "../../../server/_shared/nightchecks.js";

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
// vouchers. Posting would book the month twice: refused, with the entry named. (re-review 1) only an entry paying an
// earning counts: one touching only the employer's contributions, gratuity and the like is not salary. (re-review 6) the
// narration from the books, else from Tally's payroll read; an entry whose narration FinCom has neither way is unknown
// (read the books again), never called one FinCom did not post
export function payrollInTally(ym, pay, b) {
  const tag = "TDSDesk:dc-tp-" + ym + "-", V = new Map(((b && b.vouchers) || []).filter((v) => v && v.id).map((v) => [String(v.id), v])), out = [], unknown = [];
  const inMonth = (d) => String(d || "").replace(/-/g, "").slice(0, 6) === ym, heads = (pay && pay.heads) || {};
  const earn = (h) => earningHead(h, (heads[h] || {}).type || "");
  const seen = new Set(), add = (id, day, type, no, narr) => {
    if (seen.has(id)) return; seen.add(id);
    const x = { id, day: String(day || "").replace(/-/g, ""), type, no };
    if (narr == null) unknown.push(x); else if (!String(narr).includes(tag)) out.push(x);
  };
  const pv = (pay && pay.vouchers) || {};
  ((pay && pay.allocs) || []).forEach((a) => { if (!a || !inMonth(a.day) || !earn(a.head)) return; const v = V.get(String(a.guid)), h = pv[a.guid] || {};
    add(String(a.guid), a.day, h.type || (v && v.type) || "", h.no || (v && v.no) || "", v && v.narr != null ? v.narr : h.narr != null ? h.narr : null); });
  V.forEach((v, id) => { if (!v.cancel && !v.opt && /payroll/i.test(String(v.type || "")) && inMonth(v.date) && (v.ent || []).some((e) => e.a < 0 && (heads[e.l] ? earn(e.l) : !notSalaryHeadName(e.l) && !/payable/i.test(e.l)))) add(id, v.date, v.type, v.no, v.narr || ""); });
  out.unknown = unknown;
  return out;
}
const dmy = (d) => (/^\d{8}$/.test(d) ? d.slice(6, 8) + "-" + d.slice(4, 6) + "-" + d.slice(0, 4) : d);
const named = (xs) => xs.slice(0, 2).map((x) => [x.type, x.no ? "no. " + x.no : "", dmy(x.day)].filter(Boolean).join(" ")).join("; ") + (xs.length > 2 ? "; and " + (xs.length - 2) + " more" : "");
// o: {co, ym, rows, date, pay (Payroll.data()), ledgers (the client's Tally ledger names), books (S.books), payable (the
// night entry's party, when it names one), skip (employees already in Tally in parts accepted as they are), partNo,
// parts (the numbering of the rest)} -> {vouchers, missing (sheet heads with no pay head picked), problems (plain words:
// what Tally lacks, what the bridge could not take), payable}
export function prepare(o) {
  const co = o.co || {}, pay = o.pay || {}, heads = pay.heads || {};
  const emps = (pay.employees || []).filter((e) => e && e.name && !e.group && !e.gone);
  const { plan, missing } = TP.payHeadPlan(o.rows || [], heads, co.payHeadPlan || {});
  // the ledger picked on Payroll; else the one the night's entry names; else one named like salary payable
  const L = o.ledgers || [], payable = co.payrollPayable && L.includes(co.payrollPayable) ? co.payrollPayable : o.payable && L.includes(o.payable) ? o.payable : payableOf(co, L);
  const read = emps.length > 0 || Object.keys(heads).length > 0;
  const no = o.partNo || ((i) => i + 1);
  const out = TP.payrollVouchers({ id: "dc-tp-" + o.ym, idOf: (i) => voucherIdOf(o.ym, no(i) - 1), date: o.date || lastDay(o.ym), label: monLabel(o.ym), type: co.payrollVchType || "Payroll",
    payable, rows: o.rows || [], plan, employees: emps, skip: o.skip, partNo: o.partNo, parts: o.parts });
  let problems = out.problems.filter((p) => !/^Pick the pay head for /.test(p));
  if (!read) problems = ["FinCom has not read this company’s payroll from Tally yet (its employees and pay heads). Open the company in Tally and read the books again"];
  if (!payable && (o.ledgers || []).length) problems = problems.filter((p) => p !== "Pick the salary payable ledger").concat(["Tally has no salary payable ledger FinCom can tell (a ledger named like “Salary Payable”). Create it in Tally, or pick it on Payroll"]);
  const there = payrollInTally(o.ym, pay, o.books);
  if (there.unknown.length) problems = ["FinCom’s copy of the books does not have the payroll entr" + (there.unknown.length === 1 ? "y" : "ies") + " of " + monLabel(o.ym) + " Tally has (" + named(there.unknown) + ") yet. Read the books again, so FinCom can tell whether it posted " + (there.unknown.length === 1 ? "it" : "them")].concat(problems);
  if (there.length) problems = ["Tally already has a payroll entry for " + monLabel(o.ym) + " that FinCom did not post (" + named(there) + "). Check it in Tally: FinCom does not post the month twice"].concat(problems);
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
  if (r.ok && r.unconfirmed) return of + "sent before from that computer (not sent again); Tally has not confirmed it yet. FinCom checks it, and asks you after 24 hours if it is not in Tally.";
  if (r.ok) { const n = Number(r.created) || 0; return of + (n ? "Tally created " + n + " payroll voucher" + (n === 1 ? "" : "s") : String(r.msg || "In Tally")) + (r.tallyId ? " (voucher id " + r.tallyId + ")" : "") + "."; }
  if (r.state === "sent" && r.onWay) return of + "on its way to Tally (sent before; not sent again). " + String(r.msg || "");
  if (r.state === "sent") return of + "queued for the Tally computer. " + String(r.msg || "It posts by itself.");
  return of ? of + "not posted. " + String(r.msg || "") : String(r.msg || "Not posted.");
}

// ---------------------------------------------------------------- one voucher, in a posting of its own
// Bridge.post's answer for the voucher -> the part's result. (review 6) as the bank path takes them (src/js/24, 59):
// already in Tally (the bridge found FinCom's id there: "already", "alreadyThere", "Already in Tally (voucher no. …)") is
// in Tally; held back by the resend guard (alreadySent) or a job whose answer never came here (notAnswered) with its job is
// on its way, settled from that job. (re-review 2) the resend guard's answer with no job to follow: posted without Tally's
// voucher id, so the 24-hour rule applies ("pending", then "Not confirmed in Tally": Needs you), never failed or silent
const alreadyIn = (x) => !!x && (x.already === true || (x.ok === true && (x.alreadyThere === true || x.existed === true)) || (!x.ok && /^Already in Tally \(voucher no\./i.test(String(x.message || ""))));
export function resultOf(x, out, A, why) {
  if (!x) return { ok: false, state: "failed", msg: out && out.notAllowed ? "Not allowed." : "Tally did not answer for this voucher." };
  if (alreadyIn(x)) return { ok: true, state: "posted", existed: true, created: 0, tallyId: A.tallyIdOf(x) || String(x.vchNumber || x.vchNo || "") || ((String(x.message || "").match(/voucher no\.\s*([^)\s]+)/i) || [])[1] || ""), msg: String(x.message || x.word || "Already in Tally").slice(0, 200) };
  if (x.ok) return { ok: true, state: "posted", existed: false, created: x.created == null ? null : Number(x.created), tallyId: A.tallyIdOf(x), msg: String(x.word || "In Tally").slice(0, 200) };
  if (x.held) return { ok: false, state: "sent", msg: String(x.message || "").slice(0, 300), job: x.job || (out && out.job && out.job.id) || "" };
  if (x.alreadySent === true || (x.notAnswered === true && x.jobId)) {
    const job = String((x.notAnswered ? x.jobId : x.sentJob) || x.jobId || (out && out.job && out.job.id) || ""), msg = String(x.message || "").replace(/^Failed:\s*/i, "").slice(0, 300);
    return job ? { ok: false, state: "sent", onWay: true, msg, job } : { ok: true, state: "posted", unconfirmed: true, tallyId: "", created: null, msg };
  }
  return { ok: false, state: "failed", msg: why(x.message || x.word).slice(0, 400), said: String(x.message || "").slice(0, 300) };
}
// the draft of a part (dc-tp-<yyyymm>-<n>), kept with the client's books: the voucher exactly as built (its XML, the proof
// of what each part holds: review B2) and how many parts the month has (the night counts the month done only with all)
function draftOf(co, e, v, A, at) {
  const d = A.Drafts.get(co.id, v.id) || { id: v.id, from: "daily", kind: "tallyPayroll", created: at(), by: A.me() };
  return Object.assign(d, { dedupe: e.dedupe, night_entry: e.id, parts: v.parts, part: v.part, title: "Tally Payroll " + monLabel(String(e.voucher.period)) + (v.parts > 1 ? ", part " + v.part + " of " + v.parts : ""),
    vouchers: [{ id: v.id, kind: "tallyPayroll", type: v.type, date: v.date, narration: v.narration, category: v.category, employees: v.employees.length, gross: v.gross, net: v.net, xml: TP.payrollVoucherXml(v) }], removed: false });
}
// (re-review 5; third review) the order of the saves, so that the cloud's settle (migration 208 asst_draft_state: the
// month's LATEST draft) is not left with a posted part latest while another part is still to go: the part saved "posting"
// (the XML sent kept in d.sent, never overwritten until its answer is saved), the last part still to go saved "waiting",
// the posting, the part's answer saved straight away, then the last part still to go saved "waiting" again (one save's
// window). (third review) a part whose earlier send was never answered is sent again only as the very same XML; when
// Tally says it already has the part (FinCom's id there), it counts as done only when FinCom's record of that earlier send
// is the XML being sent: else Tally holds a part FinCom cannot vouch for, and nothing more is sent
export const sentXmlOf = (d) => String((d && d.sent && d.sent.answered === "ok" && d.sent.xml) || ((((d || {}).vouchers || [])[0]) || {}).xml || "");
export const unanswered = (d) => !!(d && d.sent && !d.sent.answered);
async function postOne(co, company, e, v, A, g, progress, before) {
  const at = () => new Date().toISOString(), xml = TP.payrollVoucherXml(v);
  // the earlier send FinCom has on record: unanswered, or settled as not in Tally's copy (a copy behind Tally: the bridge's
  // own check by FinCom's id then says it is there, and it is this very XML only when the record says so)
  const was = A.Drafts.get(co.id, v.id), prevSent = unanswered(was) || (was && was.sent && was.sent.answered === "gone" && was.sent.xml) ? Object.assign({}, was.sent) : null;
  const d = draftOf(co, e, v, A, at);
  d.state = "posting"; d.sent = { xml, at: at() };
  d.results = Object.assign({}, d.results, { [v.id]: { ok: false, state: "sent", msg: "", at: at() } });
  await A.Drafts.save(co.id, d, "pressed Approve (Tally Payroll): " + v.employees.length + " employees, net " + v.net.toFixed(2) + " to " + company + (v.parts > 1 ? ", part " + v.part + " of " + v.parts : ""));
  if (before) await before();
  let out = null, x = null;
  try {
    out = await g.Bridge.post({ company, client: co.id, masters: [], vouchers: [{ id: v.id, xml }] }, (pj) => { try { progress && progress(v, pj); } catch (err) { /* only words */ } });
    x = [].concat((out && out.results) || []).find((r) => r && r.id === v.id) || null;
  } catch (err) { x = { id: v.id, ok: false, message: errWords(err) || "The posting did not go through." }; }
  if (out && out.job && out.job.id) d.job = out.job.id;
  let r = resultOf(x, out, A, (m) => plainPayrollWhy(m, (s) => A.plainWhy(s, co.id)));
  if (r.ok && r.existed && !(prevSent && prevSent.xml === xml)) {
    r = { ok: false, state: "failed", msg: "Tally already has part " + v.part + " under FinCom’s id from an earlier send FinCom has no record of. Check that part in Tally (Day Book) before anything more is posted: FinCom sends nothing that could pay someone twice.", said: String((x && (x.message || x.word)) || "").slice(0, 300) };
    d.sent = { xml: prevSent ? prevSent.xml : null, at: prevSent ? prevSent.at : "", unknown: true };
  } else d.sent.answered = r.ok ? "ok" : r.state === "failed" && r.said && x && x.message ? "refused" : "";
  if (r.job && !d.job) d.job = r.job;
  r.at = at();
  d.results[v.id] = r; d.state = r.ok ? "posted" : r.state === "sent" ? "posting" : "failed";
  const res = Object.assign({ id: v.id, part: v.part, parts: v.parts, employees: v.employees.length, net: v.net }, r);
  res.words = partWords(res);
  await A.Drafts.save(co.id, d, "Tally Payroll: " + res.words);
  return res;
}
async function holdNext(co, e, v, A) {
  const was = A.Drafts.get(co.id, v.id);
  if (was && ((((was.results || {})[v.id]) || {}).ok || unanswered(was))) return;      // in Tally, or its send not answered: as it is
  const at = () => new Date().toISOString(), d = draftOf(co, e, v, A, at);
  d.state = "waiting"; d.results = Object.assign({}, d.results, { [v.id]: { ok: false, state: "waiting", msg: "", at: at() } });
  await A.Drafts.save(co.id, d, "Tally Payroll: part " + v.part + " of " + v.parts + " to post next");
}

// ---------------------------------------------------------------- a part in Tally that is not the part built now
const xun = (s) => String(s).replace(/&(amp|lt|gt|quot|apos);/g, (m, k) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[k]);
const fold = (s) => String(s || "").toUpperCase().split(/\s+/).filter(Boolean).join(" ");
// a saved voucher's XML (the builder's own shape) read back: its type, payable, category, net and employees
export function readVoucherXml(x) {
  const s = String(x || ""), one = (re) => xun((s.match(re) || [])[1] || ""), employees = [];
  const re = /<EMPLOYEEENTRIES\.LIST>\n<EMPLOYEENAME>([^<]*)<\/EMPLOYEENAME>\n<AMOUNT>([^<]*)<\/AMOUNT>\n([\s\S]*?)<\/EMPLOYEEENTRIES\.LIST>/g;
  let m;
  while ((m = re.exec(s))) {
    const heads = []; const hr = /<PAYHEADNAME>([^<]*)<\/PAYHEADNAME>\n<ISDEEMEDPOSITIVE>(?:Yes|No)<\/ISDEEMEDPOSITIVE>\n<AMOUNT>([^<]*)<\/AMOUNT>/g; let h;
    while ((h = hr.exec(m[3]))) heads.push({ head: xun(h[1]), amount: Number(h[2]) });
    employees.push({ name: xun(m[1]), amount: Number(m[2]), heads });
  }
  return { type: one(/VCHTYPE="([^"]*)"/), payable: one(/<LEDGERNAME>([^<]*)<\/LEDGERNAME>/), category: one(/<CATEGORY>([^<]*)<\/CATEGORY>/), net: Number(one(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<AMOUNT>([^<]*)<\/AMOUNT>/)) || 0, employees };
}
const fpOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36) + ":" + s.length; };
const rsx = (p) => "₹" + (Math.abs(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
// (re-review 4) exactly what changed since the part went to Tally: the payable, the voucher type, an employee's pay heads
// (a pay head picked again), cost category, amounts, or an employee no longer on the sheet
export function partChanges(was, now, id) {
  const out = [], cur = new Map(), v0 = now[0] || {};
  now.forEach((v) => v.employees.forEach((e) => cur.set(fold(e.name), { v, e })));
  if (v0.payable && was.payable !== v0.payable) out.push("the salary payable ledger (" + was.payable + " in Tally, " + v0.payable + " now)");
  if (v0.type && was.type !== v0.type) out.push("the voucher type (" + was.type + " in Tally, " + v0.type + " now)");
  was.employees.forEach((we) => {
    const c = cur.get(fold(we.name));
    if (!c) { out.push(we.name + " is no longer on the sheet"); return; }
    const hk = (hs) => hs.map((h) => fold(h.head)).sort().join("|"), hv = (hs) => hs.map((h) => fold(h.head) + "=" + P(h.amount)).sort().join("|");
    if (P(c.e.amount) !== P(we.amount)) out.push(we.name + "’s net (" + rsx(P(we.amount)) + " in Tally, " + rsx(P(c.e.amount)) + " now)");
    else if (hk(we.heads) !== hk(c.e.heads)) out.push(we.name + "’s pay heads (" + we.heads.map((h) => h.head).join(", ") + " in Tally; " + c.e.heads.map((h) => h.head).join(", ") + " now: a pay head picked again)");
    else if (hv(we.heads) !== hv(c.e.heads)) { const now2 = new Map(c.e.heads.map((h) => [fold(h.head), P(h.amount)])); out.push(we.name + "’s amounts by pay head (" + we.heads.filter((h) => now2.get(fold(h.head)) !== P(h.amount)).map((h) => h.head + " " + rsx(P(h.amount)) + " in Tally, " + rsx(now2.get(fold(h.head)) || 0) + " now").join("; ") + ")"); }
    if (c.v.category !== was.category) out.push(we.name + "’s cost category (" + was.category + " in Tally, " + c.v.category + " now)");
  });
  // (fourth review) who joined the part and who is now in another part, by name
  const inWas = new Set(was.employees.map((e) => fold(e.name))), same = id ? now.find((v) => v.id === id) : null;
  if (same) {
    const inNow = new Set(same.employees.map((e) => fold(e.name)));
    const joined = same.employees.filter((e) => !inWas.has(fold(e.name))).map((e) => e.name);
    const moved = was.employees.filter((e) => !inNow.has(fold(e.name)) && cur.has(fold(e.name))).map((e) => e.name + " (now part " + cur.get(fold(e.name)).v.part + ")");
    if (joined.length) out.push("joined this part now: " + joined.slice(0, 4).join(", ") + (joined.length > 4 ? " and " + (joined.length - 4) + " more" : ""));
    if (moved.length) out.push("in another part now: " + moved.slice(0, 4).join(", ") + (moved.length > 4 ? " and " + (moved.length - 4) + " more" : ""));
  } else if (id && !out.length) out.push("this part is no longer made (its employees are in other parts now)");
  if (!out.length) out.push("the employees in it");
  return out.length > 6 ? out.slice(0, 6).concat(["and " + (out.length - 6) + " more"]) : out;
}

// ---------------------------------------------------------------- a send never answered, settled from Tally itself
// (fourth review) a part sent and never answered (the page closed, the answer lost), or one Tally already had with no
// record of FinCom sending it, is settled from Tally's own copy (FinCom's cloud copy of the books, read afresh): only when
// no posting of that part is still running in the cloud's queue.
//   FinCom's id in Tally: the voucher's employees and amounts against what was sent (or, unknown, the part built now):
//     the same -> answered, in Tally; else answered with Tally's own figures (the part as it is in Tally: the owner may
//     accept it and post the rest), never sent again while the id is there
//   not in Tally: "not posted", may go again (the bridge checks FinCom's id before posting, so a copy behind Tally can
//     never make it post twice). For a journal instead (forJournal), and for a part once answered in Tally, only when
//     Tally's copy shows it deleted, or (never seen) 24 hours after its send: a journal is not checked by FinCom's id
// readPart(cid, id) -> null (cannot read) | {found: false, deleted} | {found: true, no, employees: [{name, amount, heads}]}
export async function readPart(cid, id, g = G) {
  try {
    const bk = g.TCloud && typeof g.TCloud.book === "function" ? g.TCloud.book(cid) : null, book = bk && bk.book;
    if (!book || !g.Cloud || typeof g.Cloud.api !== "function") return null;
    const B = "&book_id=eq." + encodeURIComponent(book), re = new RegExp("TDSDesk:" + id.replace(/[-]/g, "\\-") + "(?!\\d)");
    const vs = ((await g.Cloud.api("tally_vouchers?select=guid,alter_id,vno,narration,cancelled,optional,deleted_at" + B + "&narration=like." + encodeURIComponent("*TDSDesk:" + id + "*"))) || []).filter((v) => v && re.test(String(v.narration || "")));
    const live = vs.find((v) => !v.deleted_at && !v.cancelled && !v.optional);
    if (!live) return { found: false, deleted: vs.length > 0 };
    const al = ((await g.Cloud.api("tally_cost_allocs?select=alter_id,ledger,centre,amount&gone_at=is.null" + B + "&guid=eq." + encodeURIComponent(live.guid))) || []).filter((a) => a && (a.alter_id == null || live.alter_id == null || Number(a.alter_id) === Number(live.alter_id)));
    const by = new Map();
    al.forEach((a) => { const k = String(a.centre || ""); if (!k) return; if (!by.has(k)) by.set(k, { name: k, amount: 0, heads: [] }); const e = by.get(k), x = Math.round(Number(a.amount) * 100) / 100; e.heads.push({ head: String(a.ledger || ""), amount: x }); e.amount = Math.round((e.amount + x) * 100) / 100; });
    return { found: true, no: String(live.vno || ""), employees: Array.from(by.values()) };
  } catch (x) { return null; }
}
const figs = (emps) => (emps || []).map((e) => fold(e.name) + ":" + (e.heads || []).map((h) => fold(h.head) + "=" + P(h.amount)).sort().join(",")).sort().join("|");
const live3 = async (g, job) => { if (!job) return false; try { const j = ((await g.Cloud.api("tally_post_jobs?select=id,status&id=eq." + encodeURIComponent(job))) || [])[0]; return !!j && ["waiting", "taken", "running"].includes(j.status); } catch (x) { return true; } };
// drafts: the month's drafts (changed in place and saved); built: {id: the part built now}; o: {forJournal, now}
export async function settleParts(co, e, drafts, built, A, g = G, o = {}) {
  const read = o.readPart || ((cid, id) => readPart(cid, id, g)), now = o.now == null ? Date.now() : o.now, at = () => new Date(now).toISOString(), waits = [];
  for (const d of drafts.filter((x) => x && /^dc-tp-/.test(String(x.id || "")) && x.dedupe === e.dedupe && !x.removed)) {
    const r = (d.results || {})[d.id] || {}, open = unanswered(d), wasOk = !!r.ok;
    if (!open && !(wasOk && o.forJournal)) continue;
    if (await live3(g, r.job || d.job)) { waits.push("On its way to Tally (part " + (d.part || 1) + "): wait for it to finish."); continue; }
    const t = await read(co.id, d.id);
    if (!t) { if (open) waits.push("FinCom could not read Tally’s copy of the books to settle part " + (d.part || "") + ". Read the books again, then try again."); continue; }
    if (t.found) {
      if (o.forJournal) waits.push("Part " + (d.part || "") + " of the Tally Payroll voucher is in Tally (voucher no. " + (t.no || "?") + "). Delete it in Tally first, or post this month as Tally Payroll: a journal would book that salary twice.");
      if (wasOk) continue;
      const ref = (d.sent && d.sent.xml) || (built[d.id] ? TP.payrollVoucherXml(built[d.id]) : ""), rv = ref ? readVoucherXml(ref) : null;
      const same = !!rv && figs(rv.employees) === figs(t.employees);
      const asTally = same ? ref : TP.payrollVoucherXml({ id: d.id, type: (rv && rv.type) || "Payroll", date: (((d.vouchers || [])[0]) || {}).date || "", payable: (rv && rv.payable) || "", category: (rv && rv.category) || "", narration: "as in Tally",
        employees: t.employees, net: -t.employees.reduce((s, x) => s + P(x.amount), 0) / 100 });
      d.sent = { xml: asTally, at: (d.sent && d.sent.at) || "", answered: "ok", fromTally: !same };
      d.results = Object.assign({}, d.results, { [d.id]: { ok: true, state: "posted", tallyId: t.no, existed: true, msg: same ? "In Tally (read from Tally)" : "In Tally with other figures than FinCom sent (read from Tally)", at: at() } });
      d.state = "posted";
      await A.Drafts.save(co.id, d, "Tally Payroll: part " + (d.part || "") + " found in Tally" + (same ? "" : " with other figures"));
      continue;
    }
    const sentAt = Date.parse((d.sent && d.sent.at) || r.at || "") || 0, old = now - sentAt >= 24 * 3600e3;
    if ((o.forJournal || wasOk) && !t.deleted && !old) { if (o.forJournal) waits.push("Part " + (d.part || "") + " of the Tally Payroll voucher was sent " + (wasOk ? "and taken by Tally" : "") + " less than a day ago and is not in FinCom’s copy of Tally yet. Read the books again (or delete it in Tally) before a journal."); continue; }
    d.sent = Object.assign({}, d.sent || {}, { answered: "gone" });
    d.results = Object.assign({}, d.results, { [d.id]: { ok: false, state: "failed", msg: "Not in Tally (read from Tally)", said: "not in Tally", at: at() } });
    d.state = "failed";
    await A.Drafts.save(co.id, d, "Tally Payroll: part " + (d.part || "") + " is not in Tally (read from Tally)");
  }
  return { waits };
}

// ---------------------------------------------------------------- Approve
// the client's findings from last night (the owner's ledger picks, the drafts said not in Tally), as Daily Check reads
// them: the second check needs them to make the very entry the night made (re-review 3)
export async function priorOf(cid, g = G) {
  try {
    const r = await g.Cloud.api("night_findings?select=client_id,kind,key,state,evidence,undone_at&client_id=eq." + encodeURIComponent(cid) + "&state=in.(ask,you,resolved)");
    return (Array.isArray(r) ? r : []).map((f) => ({ cid: f.client_id, kind: f.kind, key: f.key, state: f.state, evidence: f.evidence || [], undone: !!f.undone_at }));
  } catch (e) { return []; }
}
// e: the night's payroll entry (night_entries row); env (tests, the page): {g, A, recheck, rpc, books, pay, prior, seen,
// progress, jobs, accept (the owner accepts the parts in Tally as they are)}. Returns {ok, words, proof, queued} or
// {ok: false, why, install?, problems?, proof?, stuck?, canAccept?}
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
  const prior = env.prior || await priorOf(cid, g);
  const recheck = env.recheck || (await import("../screens/daily/again.js")).recheck;
  const why1 = await recheck(e, Object.assign({ prior, drafts: drafts.filter((d) => !mine.includes(d)), ledgers }, env.jobs ? { jobs: env.jobs } : {}, env.now != null ? { now: env.now } : {}, env.bookId != null ? { bookId: env.bookId } : {}));
  if (why1) return no(why1);
  const b = env.books || (g.S && g.S.books) || {}, pay = env.pay || payData(g);
  // (review 3) the payable ledger is the one the night's entry names (the Payroll page's pick, else the one certain by
  // name); a night entry naming none takes the one found now
  const base = { co, ym, rows: monthRows(b, ym), date: iso(ev.date), pay, ledgers, books: b, payable: ev.kind === "tallyPayroll" ? ev.party : "" };
  const p = prepare(base);
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
  // (fourth review) sends never answered settled from Tally itself first (above)
  if (mine.some((d) => unanswered(d))) {
    const st = await settleParts(co, e, mine, Object.fromEntries(p.vouchers.map((v) => [v.id, v])), A, g, { readPart: env.readPart, now: env.now });
    if (st.waits.length) return no(st.waits[0]);
  }
  // a part already in Tally is not sent again; one on its way is waited for
  const done = new Map(), byId = new Map(p.vouchers.map((v, i) => [v.id, xmls[i]])), inTally = [];
  for (const d of mine) {
    const r = (d.results || {})[d.id] || {};
    if (r.ok) { inTally.push(d); done.set(d.id, r); continue; }
    if (r.state === "sent" && (r.job || d.job)) {
      let live = true;
      try { const j = ((await g.Cloud.api("tally_post_jobs?select=id,status&id=eq." + encodeURIComponent(r.job || d.job))) || [])[0]; live = !!j && ["waiting", "taken", "running"].includes(j.status); } catch (x) { live = true; }
      if (live) return no("On its way to Tally: wait for it to finish.");
    }
  }
  // (review B2) a part in Tally counts only when it is the very part built now (its saved XML, byte for byte). (re-review 4)
  // one that is not: what changed is said exactly; the owner may accept the parts in Tally as they are and post the rest,
  // only when the rest can be built without anyone in those parts and the parts add up to the night's entry
  let plan = p.vouchers;
  const nPart = (d) => Number(d.part) || Number(String(d.id).split("-").pop()) || 0;
  const differs = inTally.filter((d) => sentXmlOf(d) !== byId.get(d.id));
  if (differs.length) {
    const kept = inTally.map((d) => ({ d, x: readVoucherXml(sentXmlOf(d)), no: nPart(d) }));
    const skip = kept.flatMap((k) => k.x.employees.map((x) => x.name)), used = new Set(kept.map((k) => k.no));
    const keptNet = kept.reduce((s, k) => s + P(k.x.net), 0), keptGross = kept.reduce((s, k) => s + P(((k.d.vouchers || [])[0] || {}).gross), 0);
    const onSheet = new Set(p.vouchers.flatMap((v) => v.employees.map((x) => fold(x.name))));
    let rest = null, canWhy = "";
    const nowNet = new Map(p.vouchers.flatMap((v) => v.employees.map((x) => [fold(x.name), P(x.amount)])));
    if (!skip.every((nm) => onSheet.has(fold(nm)))) canWhy = "someone in that part is no longer on the sheet";
    else if (kept.some((k) => k.x.employees.some((x) => nowNet.get(fold(x.name)) !== P(x.amount)))) canWhy = "the parts in Tally have other amounts than the sheet";
    else {
      const all = skip.length >= onSheet.size;
      const r0 = all ? { vouchers: [], problems: [], missing: [] } : prepare(Object.assign({}, base, { skip }));
      const freeNo = (k) => { const out = []; for (let i = 1; out.length < k; i++) if (!used.has(i)) out.push(i); return out; };
      const nos = freeNo(r0.vouchers.length), r1 = all || !r0.vouchers.length ? r0 : prepare(Object.assign({}, base, { skip, partNo: (i) => nos[i], parts: kept.length + r0.vouchers.length }));
      const rg = r1.vouchers.reduce((s, v) => s + P(v.gross), 0), rn = r1.vouchers.reduce((s, v) => s + P(v.net), 0);
      if (r1.problems.length || r1.missing.length) canWhy = r1.problems[0] || "a pay head to pick";
      else if (keptNet + rn !== net || keptGross + rg !== gross) canWhy = "the parts in Tally have other amounts than the sheet";
      else rest = r1.vouchers;
    }
    // (third review) what was accepted is kept as a fingerprint of the differences (each employee's amounts by pay head
    // among them): anything else differing since is asked again
    const changes = differs.map((d) => (differs.length > 1 || inTally.length > 1 || p.vouchers.length > 1 ? "part " + nPart(d) + ": " : "") + partChanges(readVoucherXml(sentXmlOf(d)), p.vouchers, d.id).join("; "));
    const fp = fpOf(changes.join("|") + "#" + (rest || []).map(TP.payrollVoucherXml).join(""));
    const accepted = env.accept || differs.every((d) => d.accepted && d.accepted.fp === fp);
    if (!accepted || !rest) {
      const label = differs.length === 1 ? "Part " + nPart(differs[0]) : "Parts " + differs.map(nPart).join(" and ");
      return no(label + " in Tally differs from the sheet now: " + changes.join(". ") + ". " + (rest ? "On Payroll you can accept " + label.toLowerCase() + " as it is in Tally and post the rest." : "Correct it in Tally or on the sheet first (" + canWhy + "); FinCom posts nothing until they agree."),
        { stuck: true, canAccept: !!rest, changes });
    }
    // (third review) the month's new count of parts on the parts kept too, so the night counts the month done
    const total = kept.length + rest.length;
    for (const k of kept) {
      const d = k.d, dif = differs.includes(d), fresh = dif && !(d.accepted && d.accepted.fp === fp);
      if (!fresh && Number(d.parts) === total) continue;
      if (fresh) d.accepted = { by: A.me(), at: new Date().toISOString(), fp };
      d.parts = total;
      await A.Drafts.save(co.id, d, "Tally Payroll: part " + nPart(d) + (fresh ? " accepted as it is in Tally" : " of " + total));
    }
    plan = kept.map((k) => ({ id: k.d.id, part: k.no, parts: kept.length + rest.length, employees: k.x.employees, net: k.x.net, kept: true })).concat(rest).sort((a, c) => a.part - c.part);
  }
  const todo = plan.filter((v) => !done.has(v.id));
  // (third review) a part sent before whose answer never came (the page closed, the answer lost) goes again only as the
  // very XML sent then: else what is in Tally under that id may not be the part built now
  for (const v of todo) {
    const d = drafts.find((x) => x && x.id === v.id);
    if (!unanswered(d) || d.sent.xml === TP.payrollVoucherXml(v)) continue;
    const ch = d.sent.xml ? partChanges(readVoucherXml(d.sent.xml), plan.filter((x) => !x.kept), v.id) : [];
    return no("Part " + v.part + " was sent to Tally before and FinCom never had Tally’s answer" + (d.sent.xml ? "; the sheet has changed since: " + ch.join("; ") : d.sent.unknown ? ": Tally has a part under FinCom’s id FinCom has no record of" : "") + ". Check part " + v.part + " in Tally (Day Book) first: FinCom sends nothing that could pay someone twice.", { stuck: true, canAccept: false, unconfirmed: v.id });
  }
  // 3. the claim (a part already in Tally is not left the latest draft: the last part to go saved "waiting" first)
  if (done.size && todo.length) await holdNext(co, e, todo[todo.length - 1], A);
  try { const c = await rpc("entry_claim", { p_id: e.id }); if (c && c.ok === false) return no(c.why || "This entry is not ready."); }
  catch (x) { return no(errWords(x) || "This entry is not ready."); }
  // 4. each voucher alone, in order; a refusal stops the rest; each answer saved straight away (above)
  const proof = [];
  for (const v of plan) {
    if (done.has(v.id)) { const r = Object.assign({ id: v.id, part: v.part, parts: v.parts, employees: v.employees.length, net: v.net }, done.get(v.id)); r.words = partWords(r); proof.push(r); continue; }
    const after = todo.filter((x) => x.part > v.part), last = after[after.length - 1], hold = last ? () => holdNext(co, e, last, A) : null;
    const res = await postOne(co, company, e, v, A, g, env.progress, hold);
    proof.push(res);
    if (res.state === "failed") break;
    if (hold) await hold();
  }
  // 5. the proof, and the decision
  const failed = proof.find((r) => r.state === "failed") || (proof.length < plan.length ? { words: "Not all parts were sent." } : null);
  if (failed) {
    await rpc("entry_release", { p_id: e.id, p_why: String(failed.words || "").slice(0, 200) }).catch(() => null);
    return no(failed.words, { proof });
  }
  await rpc("entry_approved", { p_id: e.id, p_work_ref: plan[0].id });
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
