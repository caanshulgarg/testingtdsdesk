// Entries drafted by Ask FinCom (the owner, 22-Oct-2026: "make entries for Leads Insurance in their Tally, or prepare XML
// to upload"). The assistant drafts them (server/assistant/entries.ts checks them first); this module is what the preview
// does with them, kept out of legacy.js (its size budget) and loaded only with the panel or the Post page:
//   - the ONE Tally XML builder for these vouchers (draftVoucherXml): "Post to Tally" sends exactly its text, and
//     "Download XML" wraps exactly the same text in Tally's import envelope, so the two can never differ;
//   - the checks before either: every ledger one of the client's Tally ledgers (the cloud copy, CloudTally's /ledgers),
//     Dr equal to Cr, a real date inside the books' period, a voucher type;
//   - whether "Post to Tally" may be pressed: the client's posting company confirmed (postTo) and its Tally connected
//     (the bridge online: tallySign, canPostTally); else why not;
//   - posting through the EXISTING route only: Bridge.post (closed periods, dates, the confirmed company, the cloud's
//     queue tally_post_enqueue, the bridge's own Import request and its duplicate check by FinCom's id). Each voucher
//     carries FinCom's id as "TDSDesk:<id>" in its narration (and as REMOTEID when that test is on), as a bill does;
//   - everything happens in the chat card (the owner, 22-Oct-2026: "post to Tally should happen in the chatbot only"):
//     the posting's progress and each voucher's result (Posted with Tally's voucher id, or why not, with Retry) show
//     there live; the person is never sent to the Post page (the postings are kept there as a record, as every one is);
//   - the drafts kept with the client's books (client_book_items, key "asstEntries", one item a draft; save_book_items
//     keeps every earlier version with who saved it and when), each with its own log: drafted, every change, downloads,
//     each press of Post and what Tally said. Removing a draft is soft (kept, marked removed, can be restored).
// Nothing here posts by itself: post() runs only from the person's click on the preview.
/* global S, INR, Cloud, TCloud, CloudTally, CloudJobs, Bridge, xesc, toTallyDate, remoteIdFor, num, r2, ledNm, choiceGet, postToProblem, postReasonFor, tallySign, canPostTally, saveFile, fmtDate */

export const VTYPES = ["Journal", "Payment", "Receipt", "Contra", "Sales", "Purchase", "Debit Note", "Credit Note"];
export const KEY = "asstEntries";
const BANKISH = /bank|cash-?in-?hand|\bcash\b/i;

const n2 = (v) => { const x = typeof num === "function" ? num(v) : Number(v) || 0; return Math.round(parseFloat((x * 100).toFixed(6))) / 100; };
export const ledKey = (s) => String(typeof ledNm === "function" ? ledNm(s) : s || "").replace(/\s+/g, " ").trim().toLowerCase();
const rand = (n) => { try { const b = crypto.getRandomValues(new Uint8Array(n)); return Array.from(b, (x) => (x % 36).toString(36)).join(""); } catch (e) { return Math.random().toString(36).slice(2, 2 + n); } };
export const newVoucherId = () => "asst-" + rand(10);
export const newDraftId = () => "ad" + Date.now().toString(36) + rand(4);
export const me = () => {
  try { const m = (S.account && S.account.me) || {}; return m.name || m.email || (Cloud.sess && (Cloud.sess() || {}).email) || ""; } catch (e) { return ""; }
};

// ---------------------------------------------------------------- the client's ledgers (the cloud copy)
const led = {};
export async function clientLedgers(co, force) {
  const c = led[co.id];
  if (c && !force && Date.now() - c.at < 5 * 60000) return c.list;
  let list = null;
  try {
    if (typeof TCloud === "object" && TCloud.on && TCloud.on() && TCloud.has(co.id)) {
      const r = await CloudTally.call(co, "/ledgers");
      list = [].concat((r && r.ledgers) || []).map((l) => ({ name: String(l.name || ""), group: String(l.group || "") })).filter((l) => l.name);
    }
  } catch (e) { list = null; }
  led[co.id] = { at: Date.now(), list };
  return list;
}
export const ledgersCached = (cid) => (led[cid] ? led[cid].list : undefined);
export function ledgerIndex(list) { const m = new Map(); (list || []).forEach((l) => { const k = ledKey(l.name); if (!m.has(k)) m.set(k, l); }); return m; }
// the closest names to one typed (the words of it, then its first letters)
export function closest(list, typed, n = 5) {
  const k = ledKey(typed), ws = k.split(" ").filter((w) => w.length > 1);
  if (!k || !list) return [];
  const score = (l) => { const lk = ledKey(l.name); return (lk.startsWith(k) ? 4 : 0) + (lk.includes(k) ? 2 : 0) + ws.filter((w) => lk.includes(w)).length; };
  return list.map((l) => [l, score(l)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1] || a[0].name.length - b[0].name.length).slice(0, n).map((x) => x[0].name);
}

// ---------------------------------------------------------------- the checks before Post or Download
const realDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && toTallyDate(d) === d.replace(/-/g, "");
export function voucherProblems(v, idx, period) {
  const out = [];
  if (!VTYPES.includes(v.type)) out.push("Choose the voucher type.");
  if (!realDate(String(v.date || ""))) out.push("The date is not a date.");
  else if (period && period.from && v.date < period.from) out.push("Dated before the books begin (" + fmtDate(period.from) + ").");
  else if (period && period.to && v.date > period.to) out.push("Dated after this financial year (" + fmtDate(period.to) + ").");
  const lines = v.lines || [];
  if (lines.length < 2) out.push("A voucher needs at least two lines.");
  lines.forEach((l, j) => {
    const dr = n2(l.dr), cr = n2(l.cr);
    if (dr > 0 && cr > 0) out.push("Line " + (j + 1) + " has both Dr and Cr.");
    else if (!(dr > 0) && !(cr > 0)) out.push("Line " + (j + 1) + " has no amount.");
    if (!String(l.ledger || "").trim()) out.push("Line " + (j + 1) + " has no ledger.");
    else if (idx && !idx.has(ledKey(l.ledger))) out.push("“" + l.ledger + "” is not a ledger in the client's Tally.");
  });
  const t = totals(v);
  if (Math.abs(t.dr - t.cr) >= 0.005) out.push("Dr ₹" + INRf(t.dr) + " is not equal to Cr ₹" + INRf(t.cr) + ".");
  if (!idx) out.push("FinCom has no Tally ledger list for this client, so the ledgers cannot be checked.");
  return out;
}
const INRf = (v) => (typeof INR === "object" ? INR.format(v) : v.toFixed(2));
export const totals = (v) => ({ dr: n2((v.lines || []).reduce((a, l) => a + n2(l.dr), 0)), cr: n2((v.lines || []).reduce((a, l) => a + n2(l.cr), 0)) });

// ---------------------------------------------------------------- the one XML builder (Post and Download)
// the party a Payment, Receipt or Contra is for: its first line that is not cash or bank; else the first debit
function partyOf(v, groupOf) {
  const lines = v.lines || [], bankish = (l) => BANKISH.test(groupOf(l.ledger) || "") || /^cash$/i.test(String(l.ledger || "").trim());
  return ((["Payment", "Receipt", "Contra"].includes(v.type) && lines.find((l) => !bankish(l))) || lines.find((l) => n2(l.dr) > 0) || lines[0] || { ledger: "" }).ledger;
}
// v: {id, type, date, narration, lines: [{ledger, dr, cr}]}; groupOf(ledger): its Tally group (bank lines of a payment,
// receipt or contra carry the bank allocation Tally asks for, as a bank line's voucher does)
export function draftVoucherXml(v, co, groupOf = () => "") {
  const vt = xesc(v.type), d = toTallyDate(v.date);
  const ridVal = typeof remoteIdFor === "function" ? remoteIdFor({ id: v.id }, co) : "";
  const rid = ridVal ? ' REMOTEID="' + xesc(ridVal) + '"' : "";
  const party = partyOf(v, groupOf), banky = ["Payment", "Receipt", "Contra"].includes(v.type);
  let x = '<VOUCHER VCHTYPE="' + vt + '" ACTION="Create" OBJVIEW="Accounting Voucher View"' + rid + ">\n";
  x += "<DATE>" + d + "</DATE>\n<EFFECTIVEDATE>" + d + "</EFFECTIVEDATE>\n<VOUCHERTYPENAME>" + vt + "</VOUCHERTYPENAME>\n";
  x += "<PARTYLEDGERNAME>" + xesc(party) + "</PARTYLEDGERNAME>\n";
  x += "<NARRATION>" + xesc((String(v.narration || "").trim() ? String(v.narration).trim() + " | " : "") + "TDSDesk:" + v.id) + "</NARRATION>\n";
  x += "<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n<ISINVOICE>No</ISINVOICE>\n<ISOPTIONAL>" + (co.createOptional ? "Yes" : "No") + "</ISOPTIONAL>\n";
  (v.lines || []).forEach((l) => {
    const dr = n2(l.dr) > 0, a = (dr ? n2(l.dr) : n2(l.cr)).toFixed(2), sign = dr ? "-" : "";
    const bank = banky && /bank/i.test(groupOf(l.ledger) || "") ? "<BANKALLOCATIONS.LIST>\n<DATE>" + d + "</DATE>\n<INSTRUMENTDATE>" + d + "</INSTRUMENTDATE>\n<TRANSACTIONTYPE>Others</TRANSACTIONTYPE>\n" +
      "<PAYMENTFAVOURING>" + xesc(party) + "</PAYMENTFAVOURING>\n<BANKERSDATE>" + d + "</BANKERSDATE>\n<AMOUNT>" + sign + a + "</AMOUNT>\n</BANKALLOCATIONS.LIST>\n" : "";
    x += "<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>" + xesc(l.ledger) + "</LEDGERNAME>\n<ISDEEMEDPOSITIVE>" + (dr ? "Yes" : "No") + "</ISDEEMEDPOSITIVE>\n<AMOUNT>" + sign + a + "</AMOUNT>\n" + bank + "</ALLLEDGERENTRIES.LIST>\n";
  });
  return x + "</VOUCHER>\n";
}
// the company the entries go to: the client's confirmed posting company, else its Tally name (a file only)
export function postCompany(co) {
  const ch = typeof choiceGet === "function" ? choiceGet(co, "postTo") : { value: co.postTo, state: "confirmed" };
  return String((ch && ch.value) || co.tallyName || co.name || "").trim();
}
// Tally's import file: the same vouchers, word for word, in Tally's import envelope naming the company
export function draftEnvelope(xmls, company) {
  const sv = company ? "<STATICVARIABLES><SVCURRENTCOMPANY>" + xesc(company) + "</SVCURRENTCOMPANY></STATICVARIABLES>" : "";
  return '<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n<BODY>\n<IMPORTDATA>\n<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>' + sv + "</REQUESTDESC>\n<REQUESTDATA>\n" +
    xmls.map((x) => '<TALLYMESSAGE xmlns:UDF="TallySchema">\n' + x + "</TALLYMESSAGE>\n").join("") + "</REQUESTDATA>\n</IMPORTDATA>\n</BODY>\n</ENVELOPE>\n";
}

// ---------------------------------------------------------------- may "Post to Tally" be pressed?
export function postGate(co) {
  const why = typeof postToProblem === "function" ? postToProblem(co, "") : "";
  if (why) return { ok: false, why: why.replace(/ Nothing was posted\.$/, "") };
  const sg = typeof tallySign === "function" ? tallySign(co) : null;
  const can = typeof canPostTally === "function" ? canPostTally(co) : false;
  if (!sg || !sg.on || !can) return { ok: false, why: "Tally is not connected for " + co.name + (sg && sg.reason ? ": " + sg.reason + (sg.fix ? " " + sg.fix : "") : " (no FinCom Bridge online with " + postCompany(co) + ").") + " Download XML and import it in Tally instead." };
  return { ok: true, why: "", company: postCompany(co) };
}

// ---------------------------------------------------------------- the drafts, kept with the client's books
export const Drafts = {
  by: {}, at: {}, err: {}, inflight: new Set(),     // inflight: the drafts being posted from this page now
  list(cid) { return Object.values(this.by[cid] || {}); },
  get(cid, id) { return (this.by[cid] || {})[id] || null; },
  async load(cid, force) {
    if (!force && this.at[cid] && Date.now() - this.at[cid] < 60000) return this.list(cid);
    this.at[cid] = Date.now();
    try {
      if (!Cloud.on()) return this.list(cid);
      const rows = await Cloud.api("client_book_items?select=item,data,updated_at,updated_by,deleted&client_id=eq." + encodeURIComponent(cid) + "&key=eq." + KEY + "&deleted=eq.false&order=updated_at.desc&limit=500") || [];
      const m = this.by[cid] = this.by[cid] || {};
      [].concat(rows).forEach((r) => { if (r && r.data && r.data.id && !(m[r.data.id] && m[r.data.id].dirty)) m[r.data.id] = Object.assign(r.data, { savedAt: r.updated_at, savedBy: r.updated_by }); });
      this.err[cid] = "";
    } catch (e) { this.err[cid] = (e && e.message) || String(e); }
    return this.list(cid);
  },
  // one log line (who, when, what) and the draft saved; save_book_items keeps the version it replaces, with who and when
  async save(cid, d, what) {
    (this.by[cid] = this.by[cid] || {})[d.id] = d;
    if (what) d.log = [].concat(d.log || [], [{ at: new Date().toISOString(), by: me(), what: String(what).slice(0, 400) }]).slice(-300);
    d.dirty = true;
    try {
      if (!Cloud.on()) { d.unsaved = "Not signed in to the firm account: kept on this page only."; return false; }
      const { dirty: _d, unsaved: _u, savedAt: _s, savedBy: _b, ...data } = d;
      const r = await Cloud.api("rpc/save_book_items", { method: "POST", body: { p_client: cid, p_items: [{ k: KEY, i: "#" + d.id, d: data }] } });
      if (!r || !r.ok) throw new Error("The server did not take the change.");
      d.dirty = false; d.unsaved = "";
      return true;
    } catch (e) { d.unsaved = "Not saved to FinCom's cloud yet: " + ((e && e.message) || e); return false; }
  },
};

// ---------------------------------------------------------------- Post (the person's click) and Download
export function groupsOf(list) { const idx = ledgerIndex(list); return (name) => ((idx.get(ledKey(name)) || {}).group || ""); }
export function xmlsOf(d, co, list) { const g = groupsOf(list); return d.vouchers.map((v) => draftVoucherXml(v, co, g)); }
export async function downloadXml(co, d, list) {
  const xml = draftEnvelope(xmlsOf(d, co, list), postCompany(co));
  const name = "tally-entries-" + String(co.name || "client").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "-" + new Date().toISOString().slice(0, 10) + ".xml";
  const ok = await saveFile(name, new Blob([xml], { type: "application/xml" }));
  if (ok) await Drafts.save(co.id, d, "downloaded the Tally XML (" + d.vouchers.length + " voucher" + (d.vouchers.length === 1 ? "" : "s") + ")");
  return ok;
}
// the Tally voucher id a result names (the bridge's exact id, else the one voucher of its batch, else its number)
export function tallyIdOf(x) {
  const dig = (v) => (/\d/.test(String(v == null ? "" : v)) ? String(v) : "");
  return dig(x && x.vchId) || (x && Number(x.batchN || 1) <= 1 ? dig(x.batchEnd) : "") || dig(x && x.masterId) || dig(x && x.vchNumber) || "";
}
// Tally's refusal in plain words (the Post page's own table of reasons, postReasonFor), else Tally's words as they came
export function plainWhy(msg, cid) {
  try {
    if (typeof postReasonFor === "function") { const r = postReasonFor(msg, cid); if (r) return (r.reason + ". " + r.fix).replace(/\bthe bill\b/g, "the entry").replace(/\bOpen the entry, check/, "Check"); }
  } catch (e) { /* the words as they came */ }
  return String(msg || "Not posted").replace(/^Failed:\s*/i, "");
}
// the person pressed "Post to Tally" (or Retry) in the chat card: the vouchers not in Tally yet go by the existing posting
// route; the card follows it live (draw): each voucher Sent, then Posted with Tally's voucher id, or why not
export async function postDraft(co, d, list, draw = () => {}) {
  const company = postCompany(co), g = groupsOf(list), at = () => new Date().toISOString();
  const todo = d.vouchers.filter((v) => !((d.results || {})[v.id] || {}).ok);
  if (!todo.length) return { ok: true, results: [] };
  d.results = d.results || {};
  todo.forEach((v) => { d.results[v.id] = { ok: false, state: "sent", msg: "", at: at() }; });
  d.state = "posting"; d.error = ""; d.progress = "Sending to Tally\u2026";
  Drafts.inflight.add(d.id);
  draw();
  try { return await postNow(co, d, todo, company, g, at, draw); } finally { Drafts.inflight.delete(d.id); draw(); }
}
async function postNow(co, d, todo, company, g, at, draw) {
  await Drafts.save(co.id, d, "pressed Post to Tally: " + todo.length + " voucher" + (todo.length === 1 ? "" : "s") + " to " + company);
  const take = (rs) => {
    [].concat(rs || []).forEach((x) => {
      if (!x || !x.id || !todo.some((v) => v.id === x.id)) return;
      d.results[x.id] = x.ok ? { ok: true, state: "posted", tallyId: tallyIdOf(x), checking: !!x.pendingCheck, msg: String(x.word || "In Tally").slice(0, 200), at: at() }
        : { ok: false, state: "failed", msg: plainWhy(x.message || x.word, co.id).slice(0, 400), said: String(x.message || "").slice(0, 300), at: at() };
    });
    const okN = d.vouchers.filter((v) => (d.results[v.id] || {}).ok).length;
    d.state = okN === d.vouchers.length ? "posted" : okN ? "partly" : "failed";
    draw();
  };
  let out;
  try {
    out = await Bridge.post({ company, client: co.id, masters: [], vouchers: todo.map((v) => ({ id: v.id, xml: draftVoucherXml(v, co, g) })) },
      (pj) => { d.progress = pj && pj.message ? pj.message + (pj.total ? " (" + (pj.done || 0) + " of " + pj.total + ")" : "") : "Posting\u2026"; draw(); },
      (chk) => { take(chk.results); Drafts.save(co.id, d, "Tally's check after posting: " + summary(d)).then(draw); });
  } catch (e) {
    d.error = plainWhy((e && e.message) || String(e), co.id); d.progress = "";
    todo.forEach((v) => { d.results[v.id] = { ok: false, state: "failed", msg: d.error, at: at() }; });
    d.state = d.vouchers.some((v) => (d.results[v.id] || {}).ok) ? "partly" : "failed";
    await Drafts.save(co.id, d, "Post to Tally did not go through: " + d.error); draw();
    return { ok: false, error: d.error };
  }
  d.progress = "";
  d.error = out && out.notAllowed ? String(((out.results || [])[0] || {}).message || "Not allowed") : "";
  if (out && out.job && out.job.id) d.job = out.job.id;
  take(out && out.results);
  await Drafts.save(co.id, d, "posted to " + (out && out.company || company) + ": " + summary(d) + (d.job ? " (posting " + d.job + ")" : ""));
  try { if (typeof CloudJobs === "object") CloudJobs.load(true); } catch (e) { /* the Post page's record reads it again */ }
  draw();
  return { ok: true, out };
}
function summary(d) {
  const rs = d.vouchers.map((v) => (d.results || {})[v.id]).filter(Boolean), ok = rs.filter((r) => r.ok);
  return ok.length + " of " + d.vouchers.length + " in Tally" + (ok.some((r) => r.tallyId) ? " (Tally voucher id " + ok.map((r) => r.tallyId).filter(Boolean).join(", ") + ")" : "") +
    (rs.length > ok.length ? "; not posted: " + rs.filter((r) => !r.ok).map((r) => r.said || r.msg).join("; ") : "");
}
