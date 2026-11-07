// Corporate's records per client, and where they are kept (phase 1, 07-Nov-2026):
//   profile    one record a client: the company's details, directors and KMP, shareholders, charges, letterhead
//              -> corp_profiles (migration 143)
//   filings    the e-Forms tracked: one record a form and period (annual) or a form started for an event
//              -> corp_filings (migration 144)
//   docs       resolutions, notices and minutes made for the client (draft / final) -> corp_documents (migration 145)
// Signed in to a firm account: FinCom's cloud is the record (row security by firm: a firm's members read, its owner and
// staff write). Always also on this computer (localStorage, under the copy of the person signed in: LocalOwner.P, so it is
// put aside with that person's copy when someone else signs in), so the page opens at once, works without an account,
// and keeps an edit made while the line is down until it can be sent.
//
// How two computers editing one record stay right (the review of 30f70eea6):
//   - each record keeps the server's last row (base) and its updated_at (at: the SERVER's time; no clock of this computer
//     is ever compared with it), and the fields changed here and not yet sent (dirty: field -> version);
//   - nothing is sent before the firm's copy has been read (pull); a row read is taken as the base and this computer's
//     unsent fields are laid over it, field by field (an edit made offline is merged, never replaces the row);
//   - a change is a conditional update (updated_at = the one last seen): when another computer changed the row meanwhile,
//     nothing is written, the row is read again, the fields are merged, and the change is sent again;
//   - a field is marked sent only if it was not changed again while the save was on its way (its version unchanged);
//     otherwise it is sent once more.
// Fields: the profile's own keys and its four lists; a filing's or a document's columns.
// Before the migrations are run on the server, a table that is not there is kept on this computer only, and said so for
// that part alone (cloudNote).
//
//   corpOf(cid)                     {profile, filings: [], docs: [], cloud, pending} (this computer's at once; the cloud's after)
//   saveProfile(cid, patch)         merge into the profile, keep, send
//   saveFiling(cid, f)              add or change a filing (by its ref), keep, send; dropFiling(cid, ref)
//   saveDoc(cid, d)                 add or change a document (by its id), keep, send; dropDoc(cid, id) (drafts only)
//   cloudNote(cid)                  where the work is kept, in words; canEdit() the owner and staff
const OLD = "fincom:corp:";
const KEY = () => ((typeof LocalOwner === "object" && LocalOwner.P) || "tdsdesk:") + "corp:";
const mem = {};
const TABLES = { profile: "corp_profiles", filings: "corp_filings", docs: "corp_documents" };
const LISTS = ["directors", "shareholders", "charges", "letterhead"];
const nowIso = () => new Date().toISOString();
const redraw = () => { try { if (typeof render === "function") render(); } catch (e) { /* the next drawing shows it */ } };
const cloudOn = () => { try { return typeof Cloud === "object" && Cloud.on() && !(typeof LocalOwner === "object" && LocalOwner.stale); } catch (e) { return false; } };
const owner = () => { try { const b = LocalOwner.bound || LocalOwner.cur() || {}; return b.uid || ""; } catch (e) { return ""; } };
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
export const uid = () => { try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* below */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }); };

// ---- the three kinds: a server row <-> the flat record the page edits
const fromProfile = (r) => Object.assign({}, r.profile || {}, { directors: r.directors || [], shareholders: r.shareholders || [], charges: r.charges || [], letterhead: r.letterhead || {} });
const toProfile = (cid, x) => { const own = Object.assign({}, x); LISTS.concat(["at"]).forEach((k) => delete own[k]);
  return { client_id: cid, profile: own, directors: x.directors || [], shareholders: x.shareholders || [], charges: x.charges || [], letterhead: x.letterhead || {} }; };
const fromFiling = (r) => ({ ref: r.ref, form: r.form, kind: r.kind, period: r.period || "", director: r.director || "", status: r.status, steps: r.steps || 0, due: r.due_on || "", event: r.event_on || "",
  srn: r.srn || "", filedOn: r.filed_on || "", reason: r.reason || "", data: r.data || {} });
const toFiling = (cid, x) => ({ client_id: cid, ref: x.ref, form: x.form, kind: x.kind || "annual", period: x.period || "", director: x.director || "", status: x.status || "not_started",
  steps: Math.max(0, Math.min(4, x.steps | 0)), due_on: x.due || null, event_on: x.event || null, srn: x.srn || "", filed_on: x.filedOn || null, reason: x.reason || "", data: x.data || {} });
const meetingOf = (x) => { const m = x.meeting || (x.fields && x.fields.meetingDate) || ""; return /^\d{4}-\d{2}-\d{2}$/.test(m) ? m : null; };
const fromDoc = (r) => ({ id: r.id, template: r.template, title: r.title, kind: r.kind, status: r.status, fields: r.fields || {}, meeting: r.meeting_on || "", letterhead: r.letterhead !== false });
const toDoc = (cid, x) => ({ id: x.id, client_id: cid, template: x.template, title: String(x.title || "").slice(0, 300), kind: x.kind || "resolution", status: x.status === "final" ? "final" : "draft",
  fields: x.fields || {}, meeting_on: meetingOf(x), letterhead: x.letterhead !== false });
const KIND = {
  profile: { table: TABLES.profile, from: fromProfile, to: toProfile, where: (cid) => "client_id=eq." + encodeURIComponent(cid), skip: ["at"] },
  filings: { table: TABLES.filings, from: fromFiling, to: toFiling, where: (cid, x) => "client_id=eq." + encodeURIComponent(cid) + "&ref=eq." + encodeURIComponent(x.ref), skip: ["at", "fromProfile"] },
  docs: { table: TABLES.docs, from: fromDoc, to: toDoc, where: (cid, x) => "id=eq." + encodeURIComponent(x.id), skip: ["at"] },
};

// a record: {base: flat | null, at: the server's updated_at | "", cur: flat, dirty: {field: version}, gone, stamp (shown only)}
const entry = (cur) => ({ base: null, at: "", cur: cur || {}, dirty: {}, gone: false, stamp: "" });
function blank() { return { profile: entry({}), filings: {}, docs: {}, ver: 0, cloud: { state: "", none: {}, error: "", pulled: null }, owner: owner() }; }
function parse(t) { const o = JSON.parse(t); return Object.assign(blank(), { profile: o.profile && o.profile.cur ? o.profile : entry({}), filings: o.filings || {}, docs: o.docs || {}, ver: o.ver || 0 }); }
function readLocal(cid) {
  try { const t = localStorage.getItem(KEY() + cid); if (t) return parse(t); } catch (e) { /* none kept */ }
  // a copy kept under the first, browser-wide name (before the review of 30f70eea6): moved once into this person's copy,
  // only when it was kept for this same person (its owner; one without an owner only into the copy of nobody signed in)
  try {
    const t = localStorage.getItem(OLD + cid);
    if (t) {
      const o = JSON.parse(t);
      if ((o.owner || "") === owner()) {
        const c = o.profile && o.profile.cur ? parse(t) : blank();
        if (!(o.profile && o.profile.cur)) {   // the first shape: plain records, every field unsent
          const mark = (e, x) => { e.cur = Object.assign({}, x); delete e.cur.at; Object.keys(e.cur).forEach((k) => { e.dirty[k] = ++c.ver; }); return e; };
          if (o.profile) mark(c.profile, o.profile);
          (o.filings || []).forEach((x) => { c.filings[x.ref] = mark(entry({}), x); });
          (o.docs || []).forEach((x) => { c.docs[x.id] = mark(entry({}), x); });
        }
        localStorage.setItem(KEY() + cid, JSON.stringify({ profile: c.profile, filings: c.filings, docs: c.docs, ver: c.ver, owner: owner() }));
        localStorage.removeItem(OLD + cid);
        return c;
      }
    }
  } catch (e) { /* left where it is */ }
  return blank();
}
function keepLocal(cid) {
  const c = mem[cid]; if (!c) return;
  try { localStorage.setItem(KEY() + cid, JSON.stringify({ profile: c.profile, filings: c.filings, docs: c.docs, ver: c.ver, owner: c.owner })); c.cloud.local = ""; }
  catch (e) { c.cloud.local = "This computer’s storage is full: the last change is not kept here."; }
}

// what the page reads: the records as they are now (made again only when something changed)
function pendingOf(c) {
  const o = {}, has = (e) => Object.keys(e.dirty).length || (e.gone && e.at);
  if (Object.keys(c.profile.dirty).length) o.profile = 1;
  Object.entries(c.filings).forEach(([k, e]) => { if (has(e)) o["f:" + k] = 1; });
  Object.entries(c.docs).forEach(([k, e]) => { if (has(e)) o["d:" + k] = 1; });
  return o;
}
function view(c) {
  const live = (o) => Object.values(o).filter((e) => !e.gone).map((e) => Object.assign({}, e.cur, { at: e.at || e.stamp || "" }));
  return { profile: Object.assign({}, c.profile.cur, { at: c.profile.at || c.profile.stamp || "" }), filings: live(c.filings),
    docs: live(c.docs).sort((a, b) => String(b.at).localeCompare(String(a.at))), cloud: c.cloud, pending: pendingOf(c), ver: c.ver };
}
const views = new WeakMap();
export function corpOf(cid) {
  if (!cid) return view(blank());
  if (!mem[cid]) { mem[cid] = readLocal(cid); mem[cid].cloud.pulled = pull(cid); }
  const c = mem[cid];
  let v = views.get(c);
  if (!v || v.ver !== c.ver) { v = view(c); views.set(c, v); }
  return v;
}

// the PostgREST error of a table that is not there yet (the migration not run): PGRST205 / 42P01 / "schema cache"
const missing = (e) => /PGRST20[25]|42P01|does not exist|schema cache|Could not find the table/i.test(String((e && e.message) || e));
const dup = (e) => /23505|duplicate key|409/i.test(String((e && e.message) || e));

// a server row laid under a record: the base is the server's; this computer's unsent fields stay on top
function merge(kind, e, row) {
  const srv = KIND[kind].from(row), cur = Object.assign({}, srv);
  e.base = srv; e.at = row.updated_at || "";
  Object.keys(e.dirty).forEach((k) => { if (k in e.cur) cur[k] = e.cur[k]; });
  Object.keys(e.dirty).forEach((k) => { if (same(cur[k], srv[k])) delete e.dirty[k]; });   // already the server's
  e.cur = cur; e.gone = false;
}

async function pull(cid) {
  const c = mem[cid];
  if (!cloudOn()) { c.cloud.state = "local"; return; }
  c.cloud.state = "loading";
  const q = "client_id=eq." + encodeURIComponent(cid);
  // each table on its own: one not there yet (its migration not run) keeps only its own part on this computer
  const get = async (k, path) => {
    try { const r = await Cloud.api(path); delete c.cloud.none[k]; return r; }
    catch (e) { if (missing(e)) c.cloud.none[k] = true; else { c.cloud.error = String((e && e.message) || e).slice(0, 200); c.cloud.failed = true; } return null; }
  };
  const [p, f, d] = await Promise.all([get("profile", TABLES.profile + "?select=*&" + q), get("filings", TABLES.filings + "?select=*&" + q), get("docs", TABLES.docs + "?select=*&" + q)]);
  if (p && p[0]) merge("profile", c.profile, p[0]);
  const lay = (kind, rows, store, key) => {
    if (!rows) return;
    const seen = {};
    rows.forEach((r) => { const k = r[key]; seen[k] = 1; const e = store[k] || (store[k] = entry({})); if (e.gone) return; merge(kind, e, r); });
    // a record the server no longer has: removed on another computer, unless changed here since (then sent again as new)
    Object.entries(store).forEach(([k, e]) => {
      if (seen[k] || !e.at) return;
      if (Object.keys(e.dirty).length && !e.gone) { e.at = ""; e.base = null; Object.keys(e.cur).forEach((f2) => { e.dirty[f2] = e.dirty[f2] || ++c.ver; }); }
      else delete store[k];
    });
  };
  lay("filings", f, c.filings, "ref");
  lay("docs", d, c.docs, "id");
  // a read that failed (not a missing table): nothing is sent until the firm's copy has been read (the next opening)
  c.cloud.state = c.cloud.failed ? "unread" : "ready"; c.ver++; keepLocal(cid); redraw();
  if (c.cloud.state === "ready") await flush(cid);
}

async function sendOne(cid, kind, e, tries) {
  const K = KIND[kind], c = mem[cid];
  if (e.gone) { await Cloud.api(K.table + "?" + K.where(cid, e.cur), { method: "DELETE", headers: { Prefer: "return=minimal" } }); return "dropped"; }
  const vers = Object.assign({}, e.dirty), body = K.to(cid, e.cur);
  let rows = null;
  try {
    rows = e.at
      ? await Cloud.api(K.table + "?" + K.where(cid, e.cur) + "&updated_at=eq." + encodeURIComponent(e.at), { method: "PATCH", headers: { Prefer: "return=representation" }, body })
      : await Cloud.api(K.table, { method: "POST", headers: { Prefer: "return=representation" }, body });
  } catch (x) { if (!(dup(x) && !e.at)) throw x; rows = []; }
  if (!rows || !rows.length) {
    // another computer changed (or made) the row meanwhile: read it, merge field by field, send again
    if (tries >= 3) throw new Error("the firm’s copy kept changing; tried again with the next change");
    const now = await Cloud.api(K.table + "?select=*&" + K.where(cid, e.cur));
    if (now && now[0]) merge(kind, e, now[0]); else { e.at = ""; e.base = null; }
    c.ver++;
    return Object.keys(e.dirty).length ? sendOne(cid, kind, e, tries + 1) : "merged";
  }
  const row = rows[0], srv = K.from(row);
  e.base = srv; e.at = row.updated_at || e.at;
  // sent: each field as it was when the save started; a field changed again meanwhile stays to be sent
  Object.keys(vers).forEach((k) => { if (e.dirty[k] === vers[k]) delete e.dirty[k]; });
  const cur = Object.assign({}, srv); Object.keys(e.dirty).forEach((k) => { cur[k] = e.cur[k]; }); e.cur = cur;
  c.ver++;
  return Object.keys(e.dirty).length ? "again" : "sent";
}

// send what this computer has not sent yet; never before the firm's copy has been read
export async function flush(cid) {
  const c = mem[cid];
  if (!c || !cloudOn()) return;
  if (c.cloud.state !== "ready") { if (c.cloud.state === "loading" && c.cloud.pulled) await c.cloud.pulled; return; }
  if (c.flushing) { c.again = true; return c.flushing; }
  c.flushing = (async () => {
    do {
      c.again = false;
      const jobs = [];
      if (Object.keys(c.profile.dirty).length) jobs.push(["profile", c.profile, null]);
      [["filings", c.filings], ["docs", c.docs]].forEach(([kind, store]) => Object.entries(store).forEach(([k, e]) => { if (Object.keys(e.dirty).length || (e.gone && e.at)) jobs.push([kind, e, k]); }));
      for (const [kind, e, k] of jobs) {
        if (c.cloud.none[kind]) continue;
        try {
          const r = await sendOne(cid, kind, e, 0);
          if (r === "dropped") delete (kind === "filings" ? c.filings : c.docs)[k];
          if (r === "again") c.again = true;
          c.cloud.error = "";
        } catch (x) { if (missing(x)) c.cloud.none[kind] = true; else c.cloud.error = String((x && x.message) || x).slice(0, 200); }
      }
      c.ver++; keepLocal(cid);
    } while (c.again);
  })();
  try { await c.flushing; } finally { c.flushing = null; redraw(); }
}

// a change here: the fields that differ from the record now are marked, each with a new version
function edit(cid, e, patch, skip) {
  const c = mem[cid];
  Object.entries(patch).forEach(([k, v]) => { if (skip.includes(k) || same(e.cur[k], v)) return; e.cur = Object.assign({}, e.cur, { [k]: v }); e.dirty[k] = ++c.ver; });
  e.stamp = nowIso();
}
function changed(cid) {
  const c = mem[cid]; c.ver++; keepLocal(cid); redraw();
  clearTimeout(c.timer); c.timer = setTimeout(() => flush(cid), 400);
}

export function saveProfile(cid, patch) { corpOf(cid); edit(cid, mem[cid].profile, patch, KIND.profile.skip); changed(cid); }
export function saveFiling(cid, f) {
  corpOf(cid); const c = mem[cid], e = c.filings[f.ref] || (c.filings[f.ref] = entry({ ref: f.ref }));
  e.gone = false; edit(cid, e, f, KIND.filings.skip); changed(cid);
  return Object.assign({}, e.cur);
}
export function dropFiling(cid, ref) { corpOf(cid); const c = mem[cid], e = c.filings[ref]; if (!e) return; if (e.at) { e.gone = true; e.dirty = {}; } else delete c.filings[ref]; changed(cid); }
export function saveDoc(cid, d) {
  corpOf(cid); const c = mem[cid], id = d.id || uid(), e = c.docs[id] || (c.docs[id] = entry({ id }));
  edit(cid, e, Object.assign({}, d, { id }), KIND.docs.skip); changed(cid);
  return Object.assign({}, e.cur, { at: e.at || e.stamp });
}
export function dropDoc(cid, id) { corpOf(cid); const c = mem[cid], e = c.docs[id]; if (!e) return; if (e.at) { e.gone = true; e.dirty = {}; } else delete c.docs[id]; changed(cid); }

const PART = { profile: "the profile", filings: "e-Forms", docs: "the documents" };
export function cloudNote(cid) {
  corpOf(cid);
  const c = mem[cid], n = Object.keys(pendingOf(c)).length, none = Object.keys(c.cloud.none);
  if (c.cloud.local) return { tone: "bad", text: c.cloud.local };
  if (!cloudOn()) return { tone: "", text: "Saved on this computer (not signed in to a firm account)." };
  if (c.cloud.none.profile) return { tone: "warn", text: "Saved on this computer. Sharing with the firm starts once FinCom’s server is updated for Corporate." };
  if (none.length) return { tone: "warn", text: "Saved to the firm account, except " + none.map((k) => PART[k]).join(" and ") + ": on this computer until FinCom’s server is updated for " + (none.length > 1 ? "them" : "it") + "." };
  if (c.cloud.state === "unread") return { tone: "warn", text: "The firm’s copy could not be read (" + c.cloud.error + "): changes are kept on this computer and sent once it has been read." };
  if (c.cloud.error) return { tone: "warn", text: "Saved on this computer; not sent to the firm account yet (" + c.cloud.error + "). Tried again with the next change." };
  if (c.cloud.state === "loading") return { tone: "", text: "Bringing in the firm’s copy…" };
  return { tone: "ok", text: n ? "Sending to the firm account…" : "Saved to the firm account." };
}

// the owner and staff edit; a member who only looks (viewer) sees the records without the means to change them
export function canEdit() { try { return !cloudOn() || ["owner", "staff", ""].includes(String((Cloud.st && Cloud.st.role) || "")); } catch (e) { return true; } }

// for the tests: forget what is held in this page (the next corpOf reads this computer and the cloud again)
export function forget(cid) { if (cid) delete mem[cid]; else Object.keys(mem).forEach((k) => delete mem[k]); }
if (typeof window === "object") window.FCCorp = { corpOf, forget, flush, saveProfile, saveFiling, saveDoc, dropFiling, dropDoc, cloudNote, canEdit, key: KEY, raw: (cid) => mem[cid] };
