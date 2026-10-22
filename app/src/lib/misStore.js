// "My MIS" (ROUND 105, B5): where the reports are kept, who may change them, and the describe-by-words call.
//   - A client's reports: with the client's books (client_book_items, key "misCustom", one item a report "#<id>"), saved
//     with save_book_items, which keeps every earlier version with who saved it and when; removing one is soft (deleted,
//     kept in the history). No new table.
//   - The firm's templates ("use for all clients"): in the firm's own settings (S.firm.misTpl, the firm record that every
//     computer of the firm syncs, as MIS's ledger templates S.firm.ledTpl), without a typed budget.
//   - Share: a report is the person's own until shared; shared, every member of the firm sees it under the existing roles
//     (the books' items are read by the whole firm). Owners and staff change it; a look-only member (role readonly) sees
//     it read-only: the server refuses them too (save_book_items: can_write()).
//   - Describe: the words go to Ask FinCom (fincom-assistant, its build_mis tool); the layout it returns (kind "mis") opens
//     in the builder, its unknown names flagged.
/* global S, Cloud, ASST, Store */
import { normalizeDef, newId } from "../../../server/_shared/misdef.js";

export const KEY = "misCustom";
export const me = () => { try { const m = (S.account && S.account.me) || {}; return m.user_id || m.email || (Cloud.sess && (Cloud.sess() || {}).user_id) || ""; } catch (e) { return ""; } };
export const meName = () => { try { const m = (S.account && S.account.me) || {}; return m.name || m.email || ""; } catch (e) { return ""; } };
// owners and staff change reports; a look-only member only looks (and downloads)
export const mayEdit = () => !(S.account && S.account.me) || ["owner", "staff"].includes(S.account.me.role);

export const Reports = {
  by: {}, at: {}, err: {},
  list(cid) { return Object.values(this.by[cid] || {}).filter((r) => !r.deleted); },
  // what this person sees: their own reports and every shared one
  visible(cid) { const u = me(); return this.list(cid).filter((r) => r.shared || !r.by || r.by === u).sort((a, b) => String(a.name).localeCompare(String(b.name))); },
  get(cid, id) { return (this.by[cid] || {})[id] || null; },
  async load(cid, force) {
    if (!force && this.at[cid] && Date.now() - this.at[cid] < 60000) return this.visible(cid);
    this.at[cid] = Date.now();
    try {
      if (!(typeof Cloud === "object" && Cloud.on())) return this.visible(cid);
      const rows = await Cloud.api("client_book_items?select=item,data,updated_at,updated_by,deleted&client_id=eq." + encodeURIComponent(cid) + "&key=eq." + KEY + "&deleted=eq.false&order=updated_at.desc&limit=200") || [];
      const m = this.by[cid] = this.by[cid] || {};
      [].concat(rows).forEach((r) => { if (r && r.data && r.data.id && !(m[r.data.id] && m[r.data.id].dirty)) m[r.data.id] = Object.assign({}, r.data, { savedAt: r.updated_at, savedBy: r.updated_by }); });
      this.err[cid] = "";
    } catch (e) { this.err[cid] = (e && e.message) || String(e); }
    return this.visible(cid);
  },
  // a report saved (a new one, or a change): its definition, name, shared, who made it, a log line
  async save(cid, def, what, opt = {}) {
    const m = this.by[cid] = this.by[cid] || {}, old = m[def.id] || {};
    const rec = { id: def.id, name: def.name, def: normalizeDef(def).def, shared: opt.shared != null ? !!opt.shared : !!old.shared, by: old.by || me(), byName: old.byName || meName(),
      at: new Date().toISOString(), log: [].concat(old.log || [], what ? [{ at: new Date().toISOString(), by: meName() || me(), what: String(what).slice(0, 300) }] : []).slice(-100) };
    rec.def.shared = rec.shared;
    m[def.id] = Object.assign({}, rec, { dirty: true });
    if (!mayEdit()) { m[def.id].unsaved = "Look-only access: changes are not saved."; return { ok: false, why: m[def.id].unsaved }; }
    try {
      if (!(typeof Cloud === "object" && Cloud.on())) { m[def.id].unsaved = "Not signed in to the firm account: kept on this page only."; return { ok: false, why: m[def.id].unsaved }; }
      const r = await Cloud.api("rpc/save_book_items", { method: "POST", body: { p_client: cid, p_items: [{ k: KEY, i: "#" + def.id, d: rec }] } });
      if (!r || !r.ok) throw new Error("The server did not take the change.");
      m[def.id] = Object.assign({}, rec, { savedAt: r.at || rec.at });
      return { ok: true };
    } catch (e) { m[def.id].unsaved = "Not saved to FinCom's cloud yet: " + ((e && e.message) || e); return { ok: false, why: m[def.id].unsaved }; }
  },
  async remove(cid, id) {
    const m = this.by[cid] || {}, old = m[id]; if (!old) return { ok: true };
    if (!mayEdit()) return { ok: false, why: "Look-only access." };
    try {
      if (typeof Cloud === "object" && Cloud.on()) { const r = await Cloud.api("rpc/save_book_items", { method: "POST", body: { p_client: cid, p_items: [{ k: KEY, i: "#" + id, del: true }] } }); if (!r || !r.ok) throw new Error("The server did not take it."); }
      delete m[id]; return { ok: true };
    } catch (e) { return { ok: false, why: (e && e.message) || String(e) }; }
  },
};

// the firm's templates: S.firm.misTpl {id: {id, name, def, by, at}}, kept with the firm's settings
export const FirmTpl = {
  list() { const t = (S.firm && S.firm.misTpl) || {}; return Object.values(t).filter((x) => x && x.def).sort((a, b) => String(a.name).localeCompare(String(b.name))); },
  save(def) {
    if (!S.firm || !mayEdit()) return false;
    const d = normalizeDef(def).def; d.budget = {}; const id = "ft" + newId("");
    S.firm.misTpl = Object.assign({}, S.firm.misTpl || {}, { [id]: { id, name: d.name, def: Object.assign(d, { id }), by: meName() || me(), at: new Date().toISOString() } });
    try { Store.saveFirm(); } catch (e) { /* kept for this page; saved with the firm's next change */ }
    return true;
  },
  remove(id) { if (!S.firm || !S.firm.misTpl || !mayEdit()) return; const t = Object.assign({}, S.firm.misTpl); delete t[id]; S.firm.misTpl = t; try { Store.saveFirm(); } catch (e) { /* */ } },
};

// "Describe your MIS": the words to Ask FinCom; its layout (a result of kind "mis") back. No figure comes from the AI
export async function describeMis(text, cid, lang) {
  if (!(typeof Cloud === "object" && Cloud.on())) return { error: "Sign in to the firm account to describe an MIS in words." };
  try { await Cloud.fresh(); } catch (e) { /* the token as it is */ }
  const c = Cloud.cfg(), s = Cloud.sess();
  const q = /\bmis\b/i.test(text) ? text : "Build my MIS: " + text;
  const r = await fetch(ASST.url(), { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "ask", question: q, client_id: cid, history: [], attachments: [], uploads: [], firm: typeof ASST.letterhead === "function" ? ASST.letterhead() : {}, lang: lang || "en-IN" }) });
  if (!r.ok || !String(r.headers.get("content-type") || "").includes("event-stream")) { const j = await r.json().catch(() => ({})); return { error: j.error || "Ask FinCom could not be reached (" + r.status + ")." }; }
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = "", out = null, words = "", err = "";
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      if (!chunk.startsWith("data: ")) continue;
      let e; try { e = JSON.parse(chunk.slice(6)); } catch (x) { continue; }
      if (e.t === "result" && e.kind === "mis" && e.definition) out = e;
      else if (e.t === "done") words = e.text || words;
      else if (e.t === "text") words += e.d || "";
      else if (e.t === "error") err = e.message || "Ask FinCom could not lay it out.";
    }
  }
  if (!out) return { error: err || (words ? "Ask FinCom did not lay out a report: " + words.slice(0, 300) : "Ask FinCom did not lay out a report.") };
  const n = normalizeDef(out.definition);
  return { def: Object.assign(n.def, { id: newId("m") }), unknown: out.unknown || [], problems: (out.problems || []).concat(n.problems), words, summary: out.summary || "" };
}
