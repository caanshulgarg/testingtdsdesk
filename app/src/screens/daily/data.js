// Daily Check's data (next-assistant, phase 1): read from the cloud with the person's own sign-in (row-level security:
// their firm only), and every change through migration 206's functions (each checked and logged). Nothing here posts:
// Approve hands an entry to the EXISTING approval (the bill's approve() in Purchase, the bank line's bankSetLedger in
// Bank), so it reaches Tally the usual way, through the Post page and the bridge.
/* global Cloud, S, openCompany, D, approve, loadBank, openStatement, bankSetLedger, bankRow, goStep, toast */
import { sendable } from "../../../../server/_shared/asks.js";

export const cloudOn = () => { try { return typeof Cloud === "object" && Cloud.on(); } catch (e) { return false; } };
export const isOwner = () => { try { return !!(S.account && S.account.me && S.account.me.role === "owner"); } catch (e) { return false; } };
export const canWrite = () => { try { const r = S.account && S.account.me && S.account.me.role; return r === "owner" || r === "staff" || !r; } catch (e) { return false; } };
// the test site (staging) never opens WhatsApp to a client, whatever the switches say (the second layer for WhatsApp)
export const testSite = () => import.meta.env.MODE === "test";
const api = (path, o) => Cloud.api(path, o);
export const rpc = (fn, args) => api("rpc/" + fn, { method: "POST", body: args || {} });
const all = async (path) => { const out = []; for (let off = 0; off < 20000; off += 1000) { const r = await api(path + "&limit=1000&offset=" + off); out.push(...(r || [])); if (!r || r.length < 1000) break; } return out; };

export const nameOf = (cid) => { try { return ((S.companies || {})[cid] || {}).name || "Client"; } catch (e) { return "Client"; } };

// everything the page shows, in the page's shape: findings with their question, entries, the last night, contacts
export async function loadAll() {
  if (!cloudOn()) return null;
  const [fs, qs, es, runs, cs, mail] = await Promise.all([
    all("night_findings?select=id,client_id,kind,key,state,facts,evidence,candidates,last_seen,undone_at&state=in.(ask,you,resolved)&order=client_id,last_seen.desc"),
    all("client_asks?select=id,client_id,finding_id,week,text,edited,state,answer,closed_by,history,created_at&order=created_at"),
    all("night_entries?select=id,client_id,finding_id,source,dedupe,work_ref,voucher,reason,why,evidence,checks,state&state=eq.ready&order=created_at"),
    api("night_runs?select=client_id,night,status,finished_at&order=night.desc&limit=500").catch(() => []),
    all("client_contacts?select=id,client_id,name,email,whatsapp,by_email,by_whatsapp&removed_at=is.null&order=created_at").catch(() => []),
    api("assistant_mail?select=real_send,test_to,test_whatsapp").catch(() => []),
  ]);
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
  return { findings, entries: es, last, clients: new Set((runs || []).filter((r) => r.night === (last && last.night)).map((r) => r.client_id)).size,
    contacts, mail: (mail || [])[0] || { real_send: false, test_to: "", test_whatsapp: "" } };
}

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
  } else return false;
  await rpc("entry_decide", { p_id: e.id, p_decision: "approved", p_work_ref: e.work_ref });
  return true;
}
// Edit: the entry opened where it is made (the bill in Purchase, the line in Bank)
export async function editEntry(e) {
  await openCompany(e.client_id);
  if (e.source === "twob_inbox_bill") { S.selected = e.work_ref; goStep("review", "bills"); }
  else { const i = e.work_ref.lastIndexOf(":"); S.tab = "bank"; await loadBank(e.client_id); await openStatement(e.work_ref.slice(0, i)); }
}

// sending: email from the server (assistant-send: the owner only, the guard there); WhatsApp as a wa.me link opened
// here, to the firm's own number in test mode, the open logged
export const sendEmail = (cid, ids) => Cloud.fn("assistant-send", { client_id: cid, ask_ids: ids });
// the server decides whether it was a test (real sending off, or not the client's own number) and logs it
export const markWhatsApp = (cid, ids, to) => rpc("ask_whatsapp_opened", { p_client: cid, p_ids: ids, p_to: to });
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
