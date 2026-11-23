// Daily Check's data (next-assistant, phase 1): read from the cloud with the person's own sign-in (row-level security:
// their firm only), and every change through migration 206's functions (each checked and logged). Nothing here posts:
// Approve hands an entry to the EXISTING approval (the bill's approve() in Purchase, the bank line's bankSetLedger in
// Bank), so it reaches Tally the usual way, through the Post page and the bridge.
/* global Cloud, S, CO, openCompany, D, approve, loadBank, openStatement, bankSetLedger, bankRow, goStep, toast */
import { sendable } from "../../../../server/_shared/asks.js";
import { promotion, voucherId } from "../../../../server/_shared/dailytrust.js";

export const cloudOn = () => { try { return typeof Cloud === "object" && Cloud.on(); } catch (e) { return false; } };
export const isOwner = () => { try { return !!(S.account && S.account.me && S.account.me.role === "owner"); } catch (e) { return false; } };
export const canWrite = () => { try { const r = S.account && S.account.me && S.account.me.role; return r === "owner" || r === "staff" || !r; } catch (e) { return false; } };
// the test site (staging) never opens WhatsApp to a client, whatever the switches say (the second layer for WhatsApp)
export const testSite = () => import.meta.env.MODE === "test";
const api = (path, o) => Cloud.api(path, o);
export const rpc = (fn, args) => api("rpc/" + fn, { method: "POST", body: args || {} });
const all = async (path) => { const out = []; for (let off = 0; off < 20000; off += 1000) { const r = await api(path + "&limit=1000&offset=" + off); out.push(...(r || [])); if (!r || r.length < 1000) break; } return out; };

export const nameOf = (cid) => { try { return ((S.companies || {})[cid] || {}).name || "Client"; } catch (e) { return "Client"; } };

let lastPrior = [];
// everything the page shows, in the page's shape: findings with their question, entries, the last night, contacts
export async function loadAll() {
  if (!cloudOn()) return null;
  const [fs, qs, es, runs, cs, mail, trust, stats] = await Promise.all([
    all("night_findings?select=id,client_id,kind,key,state,facts,evidence,candidates,last_seen,undone_at&state=in.(ask,you,resolved)&order=client_id,last_seen.desc"),
    all("client_asks?select=id,client_id,finding_id,week,text,edited,state,answer,closed_by,history,created_at&order=created_at"),
    all("night_entries?select=id,client_id,finding_id,source,dedupe,work_ref,voucher,reason,why,evidence,checks,state,updated_at&state=in.(ready,approving)&order=created_at"),
    api("night_runs?select=client_id,night,status,finished_at&order=night.desc&limit=500").catch(() => []),
    all("client_contacts?select=id,client_id,name,email,whatsapp,by_email,by_whatsapp&removed_at=is.null&order=created_at").catch(() => []),
    api("assistant_mail?select=real_send,test_to,test_whatsapp").catch(() => []),
    // (phase 2, migration 208) the trust levels and the approvals behind a promotion suggestion; none before 208
    api("daily_trust?select=client_id,kind,level,limit_amt,dismissed_at").catch(() => []),
    rpc("trust_stats", {}).catch(() => []),
  ]);
  lastPrior = fs.map((f) => ({ cid: f.client_id, kind: f.kind, key: f.key, state: f.state, evidence: f.evidence || [], undone: !!f.undone_at }));
  const byFinding = new Map(qs.map((q) => [q.finding_id, q]));
  const findings = fs.map((f) => {
    const q = byFinding.get(f.id), x = f.facts || {};
    return { id: f.id, cid: f.client_id, kind: f.kind, state: f.state, facts: x, evidence: f.evidence || [], candidates: f.candidates || [],
      amt: x.amt || 0, party: x.party || "", date: x.date || x.ym || "", short: x.short || "", title: x.title || "",
      ask: q ? { id: q.id, text: q.edited || q.text, orig: q.text, state: q.state, history: q.history || [], answer: q.answer || "" } : null };
  });
  // a question's finding is "ask"; an answered or closed one stays on its client's list until the week is over
  const last = (runs || [])[0];
  const contacts = {};
  (cs || []).forEach((c) => (contacts[c.client_id] = contacts[c.client_id] || []).push(c));
  return { findings, entries: es, last, trust: trust || [], suggestions: suggestionsOf(stats, trust), clients: new Set((runs || []).filter((r) => r.night === (last && last.night)).map((r) => r.client_id)).size,
    contacts, mail: (mail || [])[0] || { real_send: false, test_to: "", test_whatsapp: "" } };
}

// (phase 2) a promotion is suggested after 20 approvals of a kind for a client, made as FinCom made them (owner only)
export function suggestionsOf(stats, trust) {
  const lv = new Map((trust || []).map((t) => [t.client_id + "|" + t.kind, t]));
  return (Array.isArray(stats) ? stats : []).map((s) => {
    const t = lv.get(s.client_id + "|" + s.kind) || {}, p = promotion({ approved: s.approved, lastAt: s.last_at, dismissedAt: t.dismissed_at || s.dismissed_at }, t.level != null ? t.level : s.level);
    return p ? { cid: s.client_id, kind: s.kind, n: p.n, to: p.to } : null;
  }).filter(Boolean);
}
export const trustSet = (cid, kind, level, limit) => rpc("trust_set", { p_client: cid, p_kind: kind, p_level: level, p_limit: limit == null ? null : limit });
export const trustLater = (cid, kind) => rpc("trust_dismiss", { p_client: cid, p_kind: kind });
export const loadTrust = (cid) => api("daily_trust?select=kind,level,limit_amt&client_id=eq." + encodeURIComponent(cid));
// phase 2's kinds: an entry FinCom made (shown under Entries), or a ledger to pick (Needs you); never under Done
export const P2 = new Set(["setoff_due", "payroll_due", "recurring_due", "ledger_pick", "setoff_exclude", "sent_check"]);
// (last fix) "Not in Tally: offer it again": the owner, on the entry being approved for that draft (entry_unconfirm)
export function unconfirm(f, entries) {
  const e = (entries || []).find((x) => x.client_id === f.cid && x.dedupe === (f.facts || {}).dedupe);
  if (!e) return Promise.reject(new Error("That entry is not here any more. Run again."));
  return rpc("entry_unconfirm", { p_id: e.id, p_finding: f.id });
}
export const JOURNAL = new Set(["gst_setoff", "payroll", "recurring"]);
// an entry someone is approving now (claimed in the last 30 minutes): shown, not to be approved again
export const beingApproved = (e) => e.state === "approving" && Date.now() - Date.parse(e.updated_at || 0) < 30 * 60000;

export const askable = (findings, cid) => sendable(findings.filter((f) => f.cid === cid && f.state === "ask"), null);

// ---------------------------------------------------------------- what the buttons do
export const undo = (id) => rpc("finding_undo", { p_id: id });
export const choose = (id, ref) => rpc("finding_choose", { p_id: id, p_ref: ref });
export const askEdit = (id, text) => rpc("ask_edit", { p_id: id, p_text: text });
export const askClose = (id) => rpc("ask_close", { p_id: id, p_why: "" });
export const askReopen = (id) => rpc("ask_reopen", { p_id: id });
export const askAnswer = (id, text) => rpc("ask_answer", { p_id: id, p_text: text });
export const reject = (id) => rpc("entry_decide", { p_id: id, p_decision: "rejected", p_work_ref: null });

// Approve: the existing approval first (it checks the bill or line as it always does and may refuse, saying why); only
// when it took is the decision recorded. Returns true when approved.
// review M3: the bill or line must still be what FinCom checked last night, else nothing is approved
const d8 = (v) => { const t = String(v || "").trim(); let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + m[2] + m[3]; m = t.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})$/); if (m) return m[3] + m[2] + m[1]; return /^\d{8}$/.test(t) ? t : ""; };
const n2 = (v) => Math.round((parseFloat(String(v == null ? "" : v).replace(/[,₹\s]/g, "")) || 0) * 100) / 100;
const noN = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const amtOf = (e) => n2(((e.voucher || {}).lines || []).reduce((s, l) => s + (Number(l.dr) || 0), 0));
export function sameBill(e, bill) {
  const v = e.voucher || {}, x = (bill && bill.x) || {};
  return !!bill && Math.abs(n2(x.total) - amtOf(e)) <= 0.01 && d8(x.invoiceDate) === d8(v.date) && noN(x.invoiceNo) === noN(v.no)
    && (!v.gstin || String(x.vendorGstin || "").toUpperCase() === String(v.gstin).toUpperCase());
}
export function sameLine(e, r) {
  const v = e.voucher || {}, out = v.type === "Payment";
  return !!r && Math.abs(n2(out ? r.debit : r.credit) - amtOf(e)) <= 0.01 && !n2(out ? r.credit : r.debit) && d8(r.date) === d8(v.date)
    && !(r.userSet && r.ledger && r.ledger !== v.against);
}
const CHANGED = "Changed since last night. Run again.";
export async function approveEntry(e) {
  const cid = e.client_id;
  if (e.source === "twob_inbox_bill") {
    await openCompany(cid);
    const bill = (D(cid).entries || {})[e.work_ref];
    if (!bill) { toast("That bill is no longer in FinCom."); return false; }
    if (!sameBill(e, bill)) { toast(CHANGED); return false; }
    if (bill.status !== "approved") approve(bill, { bulk: true });
    if (bill.status !== "approved") return false;               // approve() said why (a toast)
  } else if (e.source === "bank_self_answer") {
    const i = e.work_ref.lastIndexOf(":"), sid = e.work_ref.slice(0, i), row = e.work_ref.slice(i + 1);
    await openCompany(cid); S.tab = "bank"; await loadBank(cid); await openStatement(sid);
    const r = typeof bankRow === "function" ? bankRow(row) : null;
    if (!r) { toast("That bank line is no longer in its statement."); return false; }
    if (!sameLine(e, r)) { toast(CHANGED); return false; }
    if (!bankSetLedger(row, (e.voucher || {}).against || "")) return false;   // bankSetLedger said why
    if (r.state !== "ready") return false;
  } else if (JOURNAL.has(e.source)) {
    return approveJournal(e);
  } else return false;
  await rpc("entry_decide", { p_id: e.id, p_decision: "approved", p_work_ref: e.work_ref });
  return true;
}
// next-payroll (docs/PAYROLL.md 4.3, bridge 2.5.18): a company that books salary in Tally Payroll posts the month as Tally
// payroll vouchers, not this journal, unless the owner chose "Post as a journal this month" on Payroll
export function tallyPayrollFor(e, co) {
  if (!e || e.source !== "payroll") return false;
  if ((e.voucher || {}).kind === "tallyPayroll") return true;          // the night made it as a Tally payroll voucher
  if (!co || ((co.payrollMethod || {}).value !== "tally")) return false;
  return !(co.payrollJournal || {})[String((e.voucher || {}).period || "")];
}
// (phase 2) a journal FinCom made: the second check first (the same builder on the books as they are now: anything
// changed since the night, and nothing is approved), then the EXISTING path for a hand-made voucher
// (app/src/lib/asstEntries.js: its checks, the post gate, the one XML builder and Bridge.post: the bridge here or the
// cloud's queue, Tally checked for FinCom's id first). The decision is recorded only once Tally took it or it is queued.
export async function approveJournal(e) {
  const cid = e.client_id;
  await openCompany(cid);
  const { recheck } = await import("./again.js");
  // next-payroll: a Tally Payroll company's month goes as Tally payroll vouchers (lib/payrollPost.js: the same second check,
  // claim, one posting a voucher and the proof)
  if (tallyPayrollFor(e, CO(cid))) {
    const T = await import("../../lib/payrollPost.js");
    const r = await T.approveTallyPayroll(e, { prior: lastPrior.filter((p) => p.cid === cid) });
    toast(r.ok ? r.words : r.why + (r.install ? " Download it on Payroll or the Tally page." : ""));
    return r.ok ? (r.queued ? "queued" : true) : false;
  }
  // (fourth, fifth reviews) a month posted as a journal after Tally Payroll parts were sent: each such part settled from
  // Tally first (not in a copy of Tally read after its send: not posted); one that may still be in Tally, or any FinCom
  // Tally Payroll id of the month in Tally's copy (a draft or not), holds the journal back
  if (e.source === "payroll") {
    const A0 = await import("../../lib/asstEntries.js"), ds = ((await A0.Drafts.load(cid, true)) || []).filter((d) => d && /^dc-tp-/.test(String(d.id || "")) && d.dedupe === e.dedupe && !d.removed && ((d.results || {})[d.id] || {}).state !== "failed");
    const T = await import("../../lib/payrollPost.js"), bk = typeof S === "object" && S.coId === cid ? S.books : null;
    const st = await T.settleParts(CO(cid), e, ds, {}, A0, undefined, { forJournal: true, books: bk, pay: bk && bk.payroll, prior: lastPrior.filter((p) => p.cid === cid) });
    if (st.waits.length) { toast(st.waits[0]); return false; }
  }
  const why = await recheck(e, { prior: lastPrior.filter((p) => p.cid === cid) });
  if (why) { toast(why); return false; }
  const A = await import("../../lib/asstEntries.js");
  const co = CO(cid), gate = A.postGate(co);
  if (!gate.ok) { toast(gate.why); return false; }
  const list = await A.clientLedgers(co, true), v0 = e.voucher || {}, d8_ = d8(v0.date);
  const v = { id: voucherId(e.dedupe), type: "Journal", date: d8_.slice(0, 4) + "-" + d8_.slice(4, 6) + "-" + d8_.slice(6, 8), narration: v0.narration || "",
    lines: (v0.lines || []).map((l) => ({ ledger: l.ledger, dr: l.dr || "", cr: l.cr || "" })) };
  const probs = A.voucherProblems(v, A.ledgerIndex(list), null);
  if (probs.length) { toast(probs[0]); return false; }
  // (review M3) claimed on the server first (ready -> approving, one person at a time); refused: nothing posted
  try { const c = await rpc("entry_claim", { p_id: e.id }); if (c && c.ok === false) { toast(c.why || "This entry is not ready."); return false; } }
  catch (x) { toast(String((x && x.message) || x).replace(/^.*?ERROR:\s*/, "") || "This entry is not ready."); return false; }
  const d = { id: v.id, from: "daily", dedupe: e.dedupe, night_entry: e.id, title: e.why || e.reason, vouchers: [v], created: new Date().toISOString(), by: A.me() };
  let r = null, res = {};
  try { r = await A.postDraft(co, d, list); res = (d.results || {})[v.id] || {}; }
  catch (x) { r = { ok: false, error: String((x && x.message) || x) }; }
  if (!r || !r.ok || res.state === "failed") {
    if (r && r.ok) await A.Drafts.save(cid, Object.assign(d, { state: "failed" }), "Tally did not take it");
    await rpc("entry_release", { p_id: e.id, p_why: String((res && res.msg) || (r && r.error) || "").slice(0, 200) }).catch(() => null);
    toast((res && res.msg) || (r && r.error) || "Not posted."); return false;
  }
  await rpc("entry_approved", { p_id: e.id, p_work_ref: d.id });
  return res.state === "sent" ? "queued" : true;     // queued in the cloud for the Tally computer: said so, not "sent"
}
// Edit: the entry opened where it is made (the bill in Purchase, the line in Bank)
export async function editEntry(e) {
  if (JOURNAL.has(e.source)) return;                       // a journal FinCom made: Reject it and enter it by hand
  await openCompany(e.client_id);
  if (e.source === "twob_inbox_bill") { S.selected = e.work_ref; goStep("review", "bills"); }
  else { const i = e.work_ref.lastIndexOf(":"); S.tab = "bank"; await loadBank(e.client_id); await openStatement(e.work_ref.slice(0, i)); }
}

// sending: email from the server (assistant-send: the owner only, the guard there); WhatsApp as a wa.me link opened
// here, to the firm's own number in test mode, the open logged
export const sendEmail = (cid, ids) => Cloud.fn("assistant-send", { client_id: cid, ask_ids: ids });
// the server decides whether it was a test (real sending off, or not the client's own number) and logs it
export const markWhatsApp = (cid, ids, to) => rpc("ask_whatsapp_opened", { p_client: cid, p_ids: ids, p_to: to });
// the firm's sending setting alone (Settings › Email and messages, the new look): the same row Daily Check loads
// (null: no row this person may read; the owner then starts from real sending off, the default; anyone else is told it is not known)
export const loadMail = () => api("assistant_mail?select=real_send,test_to,test_whatsapp").then((r) => (r || [])[0] || null);
export const setMail = (real, testTo, testWa) => rpc("assistant_mail_set", { p_real: real, p_test_to: testTo || "", p_test_whatsapp: testWa || "" });

// contacts (Client setup)
export const loadContacts = (cid) => api("client_contacts?select=id,name,role,email,whatsapp,by_email,by_whatsapp&client_id=eq." + encodeURIComponent(cid) + "&removed_at=is.null&order=created_at");
export const loadPrefs = (cid) => api("assistant_prefs?select=auto_reminders&client_id=eq." + encodeURIComponent(cid)).then((r) => !!(r && r[0] && r[0].auto_reminders));
export const setPrefs = (cid, on) => rpc("prefs_set", { p_client: cid, p_auto: on });
export async function saveContacts(cid, before, rows) {
  const was = new Map(before.map((c) => [c.id, c])), keep = new Set();
  const body = (r) => ({ name: r.name.trim(), role: (r.role || "").trim(), email: (r.email || "").trim(), whatsapp: (r.whatsapp || "").trim(), by_email: !!r.by_email, by_whatsapp: !!r.by_whatsapp });
  for (const r of rows) {
    if (!r.name.trim()) continue;
    if (was.has(r.id)) {
      keep.add(r.id);
      const a = JSON.stringify(body(was.get(r.id))), b = JSON.stringify(body(r));
      if (a !== b) await api("client_contacts?id=eq." + encodeURIComponent(r.id), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: body(r) });
    } else await api("client_contacts", { method: "POST", headers: { Prefer: "return=minimal" }, body: Object.assign({ client_id: cid }, body(r)) });
  }
  for (const c of before) if (!keep.has(c.id)) await api("client_contacts?id=eq." + encodeURIComponent(c.id), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { removed_at: new Date().toISOString() } });
}
