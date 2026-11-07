// Corporate's records per client, and where they are kept (phase 1, 07-Nov-2026):
//   profile    one record a client: the company's details, directors and KMP, shareholders, charges, letterhead
//              -> corp_profiles (migration 143)
//   filings    the e-Forms tracked: one record a form and period (annual) or a form started for an event
//              -> corp_filings (migration 144)
//   docs       resolutions, notices and minutes made for the client (draft / final) -> corp_documents (migration 145)
// Signed in to a firm account: FinCom's cloud is the record (row security by firm: a firm's members read, its owner and
// staff write). Always also on this computer (localStorage), so the page opens at once, works without an account, and
// keeps an edit made while the line is down until it can be sent. Before the migrations are run on the server, the cloud
// says the table is not there: the page then keeps working on this computer and says so (cloudNote).
//
//   corpOf(cid)                     {profile, filings: [], docs: []} (read from this computer at once; the cloud's after)
//   saveProfile(cid, patch)         merge into the profile, keep, send
//   saveFiling(cid, f)              add or change a filing (by its ref), keep, send; dropFiling(cid, ref)
//   saveDoc(cid, d)                 add or change a document (by its id), keep, send; dropDoc(cid, id) (drafts only)
//   cloudNote(cid)                  where the work is kept, in words
const KEY = "fincom:corp:";
const mem = {};
const TABLES = { profile: "corp_profiles", filings: "corp_filings", docs: "corp_documents" };
const nowIso = () => new Date().toISOString();
const redraw = () => { try { if (typeof render === "function") render(); } catch (e) { /* the next drawing shows it */ } };
const cloudOn = () => { try { return typeof Cloud === "object" && Cloud.on() && !(typeof LocalOwner === "object" && LocalOwner.stale); } catch (e) { return false; } };
export const uid = () => { try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* below */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }); };

function blank() { return { profile: { at: "" }, filings: [], docs: [], pending: {}, cloud: { state: "", none: {}, error: "" } }; }
function readLocal(cid) {
  try { const t = localStorage.getItem(KEY + cid); if (t) return Object.assign(blank(), JSON.parse(t), { cloud: { state: "", none: {}, error: "" } }); } catch (e) { /* none kept */ }
  return blank();
}
function keepLocal(cid) {
  const c = mem[cid]; if (!c) return;
  try { localStorage.setItem(KEY + cid, JSON.stringify({ profile: c.profile, filings: c.filings, docs: c.docs, pending: c.pending })); }
  catch (e) { c.cloud.local = "This computer’s storage is full: the last change is not kept here."; }
}

export function corpOf(cid) {
  if (!cid) return blank();
  if (!mem[cid]) { mem[cid] = readLocal(cid); pull(cid); }
  return mem[cid];
}

// the PostgREST error of a table that is not there yet (the migration not run): PGRST205 / 42P01 / "schema cache"
const missing = (e) => /PGRST20[25]|42P01|does not exist|schema cache|Could not find the table/i.test(String((e && e.message) || e));

async function pull(cid) {
  const c = mem[cid];
  if (!cloudOn()) { c.cloud.state = "local"; return; }
  c.cloud.state = "loading";
  const q = "client_id=eq." + encodeURIComponent(cid);
  const get = async (k, path) => {
    try { return await Cloud.api(path); }
    catch (e) { if (missing(e)) c.cloud.none[k] = true; else c.cloud.error = String((e && e.message) || e).slice(0, 200); return null; }
  };
  const [p, f, d] = await Promise.all([get("profile", TABLES.profile + "?select=*&" + q), get("filings", TABLES.filings + "?select=*&order=due_on.asc&" + q),
    get("docs", TABLES.docs + "?select=id,client_id,template,title,kind,status,fields,meeting_on,letterhead,updated_at,updated_by&order=updated_at.desc&" + q)]);
  if (p && p[0]) {
    const r = p[0];
    if (!c.pending.profile && (!c.profile.at || r.updated_at >= c.profile.at))
      c.profile = Object.assign({}, r.profile || {}, { directors: r.directors || [], shareholders: r.shareholders || [], charges: r.charges || [], letterhead: r.letterhead || {}, at: r.updated_at });
  }
  if (f) {
    const by = {}; c.filings.forEach((x) => { by[x.ref] = x; });
    f.forEach((r) => { const x = fromFiling(r); if (!c.pending["f:" + x.ref] && (!by[x.ref] || (x.at || "") >= (by[x.ref].at || ""))) by[x.ref] = x; });
    // a filing removed on another computer: gone here too, unless it is a change of this computer not sent yet
    c.filings = Object.values(by).filter((x) => c.pending["f:" + x.ref] || f.some((r) => r.ref === x.ref));
  }
  if (d) {
    const by = {}; c.docs.forEach((x) => { by[x.id] = x; });
    d.forEach((r) => { const x = fromDoc(r); if (!c.pending["d:" + x.id] && (!by[x.id] || (x.at || "") >= (by[x.id].at || ""))) by[x.id] = x; });
    c.docs = Object.values(by).filter((x) => c.pending["d:" + x.id] || d.some((r) => r.id === x.id));
  }
  c.cloud.state = "ready"; keepLocal(cid);
  await flush(cid);
  redraw();
}

const fromFiling = (r) => ({ ref: r.ref, form: r.form, kind: r.kind, period: r.period || "", director: r.director || "", status: r.status, steps: r.steps || 0, due: r.due_on || "", event: r.event_on || "",
  srn: r.srn || "", filedOn: r.filed_on || "", reason: r.reason || "", data: r.data || {}, at: r.updated_at || "" });
const toFiling = (cid, x) => ({ client_id: cid, ref: x.ref, form: x.form, kind: x.kind || "annual", period: x.period || "", director: x.director || "", status: x.status || "not_started",
  steps: Math.max(0, Math.min(4, x.steps | 0)), due_on: x.due || null, event_on: x.event || null, srn: x.srn || "", filed_on: x.filedOn || null, reason: x.reason || "", data: x.data || {} });
const fromDoc = (r) => ({ id: r.id, template: r.template, title: r.title, kind: r.kind, status: r.status, fields: r.fields || {}, meeting: r.meeting_on || "", letterhead: r.letterhead !== false, at: r.updated_at || "" });
const toDoc = (cid, x) => ({ id: x.id, client_id: cid, template: x.template, title: String(x.title || "").slice(0, 300), kind: x.kind || "resolution", status: x.status === "final" ? "final" : "draft",
  fields: x.fields || {}, meeting_on: meetingOf(x), letterhead: x.letterhead !== false });
const meetingOf = (x) => { const m = x.meeting || (x.fields && x.fields.meetingDate) || ""; return /^\d{4}-\d{2}-\d{2}$/.test(m) ? m : null; };

// send what this computer has not sent yet (each change once; a failure stays pending and is tried with the next change)
async function flush(cid) {
  const c = mem[cid];
  if (!c || !cloudOn() || c.flushing) return;
  c.flushing = true;
  try {
    for (const k of Object.keys(c.pending)) {
      const kind = k === "profile" ? "profile" : k[0] === "f" ? "filings" : "docs";
      if (c.cloud.none[kind]) continue;
      try {
        if (kind === "profile") {
          const p = c.profile, own = Object.assign({}, p);
          ["directors", "shareholders", "charges", "letterhead", "at"].forEach((k) => delete own[k]);
          const body = { client_id: cid, profile: own, directors: p.directors || [], shareholders: p.shareholders || [], charges: p.charges || [], letterhead: p.letterhead || {} };
          await Cloud.api(TABLES.profile + "?on_conflict=firm_id,client_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body });
        } else if (kind === "filings") {
          const ref = k.slice(2), x = c.filings.find((z) => z.ref === ref);
          if (x) await Cloud.api(TABLES.filings + "?on_conflict=firm_id,client_id,ref", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: toFiling(cid, x) });
          else await Cloud.api(TABLES.filings + "?client_id=eq." + encodeURIComponent(cid) + "&ref=eq." + encodeURIComponent(ref), { method: "DELETE", headers: { Prefer: "return=minimal" } });
        } else {
          const id = k.slice(2), x = c.docs.find((z) => z.id === id);
          if (x) await Cloud.api(TABLES.docs + "?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: toDoc(cid, x) });
          else await Cloud.api(TABLES.docs + "?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: { Prefer: "return=minimal" } });
        }
        delete c.pending[k]; c.cloud.error = "";
      } catch (e) {
        if (missing(e)) c.cloud.none[kind] = true; else c.cloud.error = String((e && e.message) || e).slice(0, 200);
      }
    }
  } finally { c.flushing = false; keepLocal(cid); }
}
function changed(cid, k) {
  const c = mem[cid]; c.pending[k] = 1; keepLocal(cid); redraw();
  clearTimeout(c.timer); c.timer = setTimeout(() => flush(cid).then(redraw), 400);
}

export function saveProfile(cid, patch) {
  const c = corpOf(cid);
  c.profile = Object.assign({}, c.profile, patch, { at: nowIso() });
  changed(cid, "profile");
}
export function saveFiling(cid, f) {
  const c = corpOf(cid), i = c.filings.findIndex((x) => x.ref === f.ref), x = Object.assign({}, i >= 0 ? c.filings[i] : {}, f, { at: nowIso() });
  if (i >= 0) c.filings[i] = x; else c.filings.push(x);
  c.filings = c.filings.slice();
  changed(cid, "f:" + x.ref);
  return x;
}
export function dropFiling(cid, ref) { const c = corpOf(cid); c.filings = c.filings.filter((x) => x.ref !== ref); changed(cid, "f:" + ref); }
export function saveDoc(cid, d) {
  const c = corpOf(cid), x = Object.assign({ id: uid() }, c.docs.find((z) => z.id === d.id) || {}, d, { at: nowIso() }), i = c.docs.findIndex((z) => z.id === x.id);
  if (i >= 0) c.docs[i] = x; else c.docs.unshift(x);
  c.docs = c.docs.slice();
  changed(cid, "d:" + x.id);
  return x;
}
export function dropDoc(cid, id) { const c = corpOf(cid); c.docs = c.docs.filter((x) => x.id !== id); changed(cid, "d:" + id); }

export function cloudNote(cid) {
  const c = corpOf(cid), n = Object.keys(c.pending).length;
  if (c.cloud.local) return { tone: "bad", text: c.cloud.local };
  if (!cloudOn()) return { tone: "", text: "Saved on this computer (not signed in to a firm account)." };
  if (Object.keys(c.cloud.none).length) return { tone: "warn", text: "Saved on this computer. Sharing with the firm starts once FinCom’s server is updated for Corporate." };
  if (c.cloud.error) return { tone: "warn", text: "Saved on this computer; not sent to the firm account yet (" + c.cloud.error + "). Tried again with the next change." };
  if (c.cloud.state === "loading") return { tone: "", text: "Bringing in the firm’s copy…" };
  return { tone: "ok", text: n ? "Sending to the firm account…" : "Saved to the firm account." };
}

// for the tests: forget what is held in this page (the next corpOf reads this computer and the cloud again)
export function forget(cid) { if (cid) delete mem[cid]; else Object.keys(mem).forEach((k) => delete mem[k]); }
if (typeof window === "object") window.FCCorp = { corpOf, forget, flush, saveProfile, saveFiling, saveDoc };
