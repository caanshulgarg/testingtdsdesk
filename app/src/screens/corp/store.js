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
// How two computers (or two tabs) editing one record stay right (the reviews of 30f70eea6 and 74eccc47b):
//   - each record keeps the server's last row (base), its updated_at (at: the SERVER's time; no clock of this computer is
//     compared with it) and the fields changed here and not yet sent (dirty: field -> version);
//   - nothing is sent before the firm's copy has been read (pull); a row read is merged THREE WAYS with base as the common
//     ancestor: a scalar field changed here keeps this computer's value; a list of rows (directors, shareholders,
//     charges) is merged row by row by the row's id, an object (agms, letterhead, a filing's data, a document's fields)
//     key by key, a list of dates (boardDates) as a set: a row or key added, changed or removed on either side survives,
//     and this computer wins only where both changed the same field of the same row;
//   - a change is a conditional update (updated_at = the one last seen); when another computer changed the row meanwhile,
//     nothing is written, the row is read again, merged, and sent again; a removal is conditional too: a row changed
//     elsewhere meanwhile is kept (and said so); a record saved again while its removal was on its way is sent as new;
//   - a field is marked sent only if it was not changed again while the save was on its way (its version unchanged);
//   - two tabs: another tab's write of this client's copy ("storage" event) is merged in, and the stored copy is merged
//     in again before every write, the higher version of a field winning, so neither tab drops the other's edit;
//   - this computer's copy is written only for the person it belongs to (its owner = the signed-in copy's), never by a
//     page that another sign-in has taken over (LocalOwner.stale).
// Before the migrations are run on the server, a table that is not there is kept on this computer only, and said so for
// that part alone (cloudNote).
//
//   corpOf(cid)                     {profile, filings: [], docs: [], cloud, pending} (this computer's at once; the cloud's after)
//   saveProfile(cid, patch)         merge into the profile, keep, send
//   saveFiling(cid, f)              add or change a filing (by its ref), keep, send; dropFiling(cid, ref)
//   saveDoc(cid, d)                 add or change a document (by its id), keep, send; dropDoc(cid, id) (drafts only)
//   cloudNote(cid)                  where the work is kept, in words; canEdit() the owner and staff
const KEY = () => ((typeof LocalOwner === "object" && LocalOwner.P) || "tdsdesk:") + "corp:";
const mem = {};
const TABLES = { profile: "corp_profiles", filings: "corp_filings", docs: "corp_documents" };
const LISTS = ["directors", "shareholders", "charges", "letterhead"];
const nowIso = () => new Date().toISOString();
const redraw = () => { try { if (typeof render === "function") render(); } catch (e) { /* the next drawing shows it */ } };
const stale = () => { try { return typeof LocalOwner === "object" && !!LocalOwner.stale; } catch (e) { return false; } };
const cloudOn = () => { try { return typeof Cloud === "object" && Cloud.on() && !stale(); } catch (e) { return false; } };
const owner = () => { try { const b = LocalOwner.bound || LocalOwner.cur() || {}; return b.uid || ""; } catch (e) { return ""; } };
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
const plain = (x) => !!x && typeof x === "object" && !Array.isArray(x);
export const uid = () => { try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* below */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }); };
// a field's version: rising across tabs too (milliseconds, then a counter within the millisecond)
let lastVer = 0;
const nextVer = () => { lastVer = Math.max(lastVer + 1, Date.now() * 100); return lastVer; };

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

// ---- the three-way merge of one field: b the common ancestor (the server's row last seen), l this computer's, s the server's
const rowKey = (r, i) => (r && r.id) || "#" + i;
function merge3(b, l, s) {
  if (same(l, b)) return s;           // not changed here: the server's
  if (same(s, b) || same(s, l)) return l; // not changed there, or the same change
  if (Array.isArray(l) && Array.isArray(s) && [l, s, b || []].every((a) => a.every((x) => typeof x === "string"))) {
    // a set of values (boardDates): the server's, less what was removed here, plus what was added here
    const B = new Set(b || []), L = new Set(l);
    return Array.from(new Set(s.filter((x) => L.has(x) || !B.has(x)).concat(l.filter((x) => !B.has(x))))).sort();
  }
  if (Array.isArray(l) && Array.isArray(s) && l.concat(s).every((x) => plain(x))) {
    // rows by their ids: added on either side kept; removed on one side and unchanged on the other removed; a row changed
    // on both sides merged field by field (this computer wins on the same field)
    const B = new Map((b || []).map((r, i) => [rowKey(r, i), r])), L = new Map(l.map((r, i) => [rowKey(r, i), r])), out = [];
    s.forEach((r, i) => {
      const k = rowKey(r, i), br = B.get(k), lr = L.get(k);
      if (lr) out.push(br ? mergeObj(br, lr, r) : lr);
      else if (!br) out.push(r);                           // added there
      else if (!same(r, br)) out.push(r);                  // removed here, changed there: kept
    });
    l.forEach((r, i) => { const k = rowKey(r, i); if (out.some((x, j) => rowKey(x, j) === k) || s.some((x, j) => rowKey(x, j) === k)) return;
      const br = B.get(k); if (!br || !same(r, br)) out.push(r); });   // added here (or changed here, removed there: kept)
    return out;
  }
  if (plain(l) && plain(s)) return mergeObj(plain(b) ? b : {}, l, s);
  return l;                            // both changed one value: this computer's
}
function mergeObj(b, l, s) {
  const out = {};
  new Set(Object.keys(b).concat(Object.keys(l), Object.keys(s))).forEach((k) => {
    const v = merge3(b[k], l[k], s[k]);
    if (v !== undefined) out[k] = v;
  });
  return out;
}

// a record: {base: flat | null, at: the server's updated_at | "", cur: flat, dirty: {field: version}, gone, stamp (shown only)}
// sent: field -> the version last sent (by this tab or another), so a tab never takes back a field already sent;
// gone: 0, or the version of its removal; back: the version it was saved again or kept after one (the newer wins in a tab)
const entry = (cur) => ({ base: null, at: "", cur: cur || {}, dirty: {}, sent: {}, gone: 0, back: 0, stamp: "" });
// a record back after a removal: one no longer on the server is sent whole, as new
const unGone = (e) => { if (e.gone) { e.gone = 0; e.back = nextVer(); if (!e.at) allDirty(e); } };
function blank() { return { profile: entry({}), filings: {}, docs: {}, ver: 0, cloud: { state: "", none: {}, error: "", pulled: null, note: "" }, owner: owner() }; }
function stored(cid) {
  try { const t = localStorage.getItem(KEY() + cid); return t ? JSON.parse(t) : null; } catch (e) { return null; }
}
function readLocal(cid) {
  const o = stored(cid), c = blank();
  // a copy kept for another person is never taken (nor written over: c.foreign)
  if (o && (o.owner || "") !== c.owner) { c.foreign = true; return c; }
  if (o) Object.assign(c, { profile: o.profile && o.profile.cur ? o.profile : entry({}), filings: o.filings || {}, docs: o.docs || {}, ver: o.ver || 0 });
  return c;
}
// another tab's copy of the client merged into this one: its unsent fields (the higher version wins), its newer server rows
function mergeTab(c, o) {
  if (!o || (o.owner || "") !== c.owner) return false;
  let moved = false;
  const one = (mine, theirs) => {
    if (!theirs) return mine;
    if (!mine) { moved = true; return Object.assign(entry({}), theirs, { sent: theirs.sent || {} }); }
    mine.sent = mine.sent || {};
    // the other tab's newer server row (never over a removal this tab has already made on the server)
    const tomb = mine.gone && !mine.at;
    if (theirs.at && !tomb && (!mine.at || theirs.at > mine.at)) { mine.base = theirs.base; mine.at = theirs.at; moved = true; }
    // a field the other tab has sent: no longer to be sent from here unless changed here since
    Object.entries(theirs.sent || {}).forEach(([k, v]) => {
      if (!(mine.sent[k] >= v)) mine.sent[k] = v;
      if (mine.dirty[k] && mine.dirty[k] <= v) { delete mine.dirty[k]; if (theirs.base && k in theirs.base) mine.cur = Object.assign({}, mine.cur, { [k]: theirs.base[k] }); moved = true; }
    });
    // the other tab's unsent fields: taken when newer than anything this tab has for that field (changed or sent)
    Object.entries(theirs.dirty || {}).forEach(([k, v]) => {
      if (v > (mine.dirty[k] || 0) && v > (mine.sent[k] || 0)) { mine.dirty[k] = v; mine.cur = Object.assign({}, mine.cur, { [k]: theirs.cur[k] }); moved = true; }
    });
    if (theirs.gone && theirs.gone > (mine.gone || 0) && theirs.gone > (mine.back || 0)) { mine.gone = theirs.gone; mine.dirty = {}; moved = true; }
    if (theirs.back && theirs.back > (mine.back || 0) && theirs.back > (mine.gone || 0)) { mine.back = theirs.back; mine.gone = 0; moved = true; }
    return mine;
  };
  c.profile = one(c.profile, o.profile && o.profile.cur ? o.profile : null);
  ["filings", "docs"].forEach((kind) => Object.entries(o[kind] || {}).forEach(([k, e]) => { c[kind][k] = one(c[kind][k], e); }));
  return moved;
}
function keepLocal(cid) {
  const c = mem[cid]; if (!c) return;
  if (stale() || c.foreign || owner() !== c.owner) return;   // never this person's copy written by a page that is not theirs
  mergeTab(c, stored(cid));
  try { localStorage.setItem(KEY() + cid, JSON.stringify({ profile: c.profile, filings: c.filings, docs: c.docs, ver: c.ver, owner: c.owner })); c.cloud.local = ""; }
  catch (e) { c.cloud.local = "This computer’s storage is full: the last change is not kept here."; }
}
if (typeof window === "object") {
  window.addEventListener("storage", (ev) => {
    const k = String(ev.key || ""), p = KEY();
    if (k.indexOf(p) || !ev.newValue) return;
    const cid = k.slice(p.length), c = mem[cid];
    if (!c) return;
    let o = null; try { o = JSON.parse(ev.newValue); } catch (e) { return; }
    if (mergeTab(c, o)) { c.ver++; redraw(); }
  });
  // the line back: the reads not made and the changes not sent are tried again
  window.addEventListener("online", () => Object.keys(mem).forEach((cid) => retry(cid)));
}
function retry(cid) {
  const c = mem[cid]; if (!c || !cloudOn()) return;
  if (c.cloud.state === "ready") flush(cid);
  else if (c.cloud.state !== "loading") c.cloud.pulled = pull(cid);
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
  // signed in since the copy was opened (or the read failed): read the firm's copy now
  if ((c.cloud.state === "local" || c.cloud.state === "unread") && cloudOn() && !c.retrying) { c.retrying = true; setTimeout(() => { c.retrying = false; retry(cid); }, 0); }
  let v = views.get(c);
  if (!v || v.ver !== c.ver) { v = view(c); views.set(c, v); }
  return v;
}

// a table that is not there yet (its migration not run): the relation is missing (42P01, "relation ... does not exist"),
// which PostgREST reports as PGRST205 "Could not find the table ... in the schema cache". A missing function or column
// is an error of its own, never taken for this
const missing = (e) => /42P01|relation "?[\w.]*"? does not exist|PGRST205|Could not find the table/i.test(String((e && e.message) || e));
const dup = (e) => /23505|duplicate key/i.test(String((e && e.message) || e));

// a server row laid under a record, three ways with the last row seen as the ancestor
function merge(kind, e, row) {
  const srv = KIND[kind].from(row), base = e.base || {}, cur = Object.assign({}, srv);
  Object.keys(e.dirty).forEach((k) => { const v = merge3(base[k], e.cur[k], srv[k]); if (v === undefined) delete cur[k]; else cur[k] = v; });
  e.sent = e.sent || {};
  Object.keys(e.dirty).forEach((k) => { if (same(cur[k], srv[k])) { e.sent[k] = Math.max(e.sent[k] || 0, e.dirty[k]); delete e.dirty[k]; } });   // nothing left to send
  e.base = srv; e.at = row.updated_at || ""; e.cur = cur; unGone(e);
}
const allDirty = (e) => { Object.keys(e.cur).forEach((k) => { e.dirty[k] = e.dirty[k] || nextVer(); }); };

async function pull(cid) {
  const c = mem[cid];
  if (!cloudOn()) { c.cloud.state = "local"; return; }
  c.cloud.state = "loading"; c.cloud.failed = false;
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
    // a removal here not sent yet stays one; a removal already made on the server, with the row there again (made anew
    // elsewhere): the row is taken
    rows.forEach((r) => { const k = r[key]; seen[k] = 1; const e = store[k] || (store[k] = entry({})); if (e.gone && e.at) return; merge(kind, e, r); });
    // a record the server no longer has: removed on another computer, unless changed here since (then sent again as new)
    Object.entries(store).forEach(([k, e]) => {
      if (seen[k] || !e.at) return;
      if (Object.keys(e.dirty).length && !e.gone) { e.at = ""; e.base = null; allDirty(e); } else { e.at = ""; e.base = null; e.gone = e.gone || nextVer(); }
    });
  };
  lay("filings", f, c.filings, "ref");
  lay("docs", d, c.docs, "id");
  // a read that failed (not a missing table): nothing is sent until the firm's copy has been read (tried again later)
  c.cloud.state = c.cloud.failed ? "unread" : "ready"; c.ver++; keepLocal(cid); redraw();
  if (c.cloud.state === "ready") await flush(cid);
}

async function sendOne(cid, kind, e, tries) {
  const K = KIND[kind], c = mem[cid];
  if (e.gone) {
    // a removal, only of the row as last seen: one changed elsewhere meanwhile is kept, and said so
    const rows = await Cloud.api(K.table + "?" + K.where(cid, e.cur) + (e.at ? "&updated_at=eq." + encodeURIComponent(e.at) : ""), { method: "DELETE", headers: { Prefer: "return=representation" } });
    if (!e.gone) { e.at = ""; e.base = null; allDirty(e); return "again"; }   // saved again here while the removal was on its way
    if (rows && rows.length === 0 && e.at) {
      const now = await Cloud.api(K.table + "?select=*&" + K.where(cid, e.cur));
      if (now && now[0]) { merge(kind, e, now[0]); c.cloud.note = "A record removed here had been changed on another computer meanwhile: it is kept."; return "kept"; }
    }
    return "dropped";
  }
  const vers = Object.assign({}, e.dirty), body = K.to(cid, e.cur);
  let rows = null;
  try {
    rows = e.at
      ? await Cloud.api(K.table + "?" + K.where(cid, e.cur) + "&updated_at=eq." + encodeURIComponent(e.at), { method: "PATCH", headers: { Prefer: "return=representation" }, body })
      : await Cloud.api(K.table, { method: "POST", headers: { Prefer: "return=representation" }, body });
  } catch (x) { if (!(dup(x) && !e.at)) throw x; rows = []; }
  if (!rows || !rows.length) {
    // another computer changed (or made) the row meanwhile: read it, merge, send again
    if (tries >= 3) throw new Error("the firm’s copy kept changing; tried again with the next change");
    const now = await Cloud.api(K.table + "?select=*&" + K.where(cid, e.cur));
    if (now && now[0]) merge(kind, e, now[0]); else { e.at = ""; e.base = null; }
    c.ver++;
    return Object.keys(e.dirty).length ? sendOne(cid, kind, e, tries + 1) : "merged";
  }
  const row = rows[0], srv = K.from(row);
  // sent: each field as it was when the save started; a field changed again meanwhile stays to be sent
  e.sent = e.sent || {};
  Object.keys(vers).forEach((k) => { e.sent[k] = Math.max(e.sent[k] || 0, vers[k]); if (e.dirty[k] === vers[k]) delete e.dirty[k]; });
  const cur = Object.assign({}, srv); Object.keys(e.dirty).forEach((k) => { cur[k] = e.cur[k]; });
  e.base = srv; e.at = row.updated_at || e.at; e.cur = cur;
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
          // removed on the server: kept here as a removal (a tombstone), so no tab's older copy brings it back
          if (r === "dropped" && e.gone) { e.at = ""; e.base = null; }
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
function edit(e, patch, skip) {
  Object.entries(patch).forEach(([k, v]) => { if (skip.includes(k) || same(e.cur[k], v)) return; e.cur = Object.assign({}, e.cur, { [k]: v }); e.dirty[k] = nextVer(); });
  e.stamp = nowIso();
}
function changed(cid) {
  const c = mem[cid]; c.ver++; keepLocal(cid); redraw();
  clearTimeout(c.timer); c.timer = setTimeout(() => flush(cid), 400);
}

export function saveProfile(cid, patch) { corpOf(cid); edit(mem[cid].profile, patch, KIND.profile.skip); changed(cid); }
export function saveFiling(cid, f) {
  corpOf(cid); const c = mem[cid], e = c.filings[f.ref] || (c.filings[f.ref] = entry({ ref: f.ref }));
  unGone(e); edit(e, f, KIND.filings.skip); changed(cid);
  return Object.assign({}, e.cur);
}
export function dropFiling(cid, ref) { corpOf(cid); const c = mem[cid], e = c.filings[ref]; if (!e) return; e.gone = nextVer(); e.dirty = {}; changed(cid); }
export function saveDoc(cid, d) {
  corpOf(cid); const c = mem[cid], id = d.id || uid(), e = c.docs[id] || (c.docs[id] = entry({ id }));
  unGone(e); edit(e, Object.assign({}, d, { id }), KIND.docs.skip); changed(cid);
  return Object.assign({}, e.cur, { at: e.at || e.stamp });
}
export function dropDoc(cid, id) { corpOf(cid); const c = mem[cid], e = c.docs[id]; if (!e) return; e.gone = nextVer(); e.dirty = {}; changed(cid); }

const PART = { profile: "the profile", filings: "e-Forms", docs: "the documents" };
export function cloudNote(cid) {
  corpOf(cid);
  const c = mem[cid], n = Object.keys(pendingOf(c)).length, none = Object.keys(c.cloud.none);
  if (c.cloud.local) return { tone: "bad", text: c.cloud.local };
  if (!cloudOn()) return { tone: "", text: "Kept on this computer: not signed in." };
  if (c.cloud.none.profile) return { tone: "warn", text: "Saved on this computer. Sharing with the firm starts once FinCom’s server is updated for Corporate." };
  if (none.length) return { tone: "warn", text: "Saved to the firm account, except " + none.map((k) => PART[k]).join(" and ") + ": on this computer until FinCom’s server is updated for " + (none.length > 1 ? "them" : "it") + "." };
  if (c.cloud.state === "unread") return { tone: "warn", text: "The firm’s copy could not be read (" + c.cloud.error + "): changes are kept on this computer and sent once it has been read." };
  if (c.cloud.error) return { tone: "warn", text: "Saved on this computer; not sent to the firm account yet (" + c.cloud.error + "). Tried again with the next change." };
  if (c.cloud.state === "loading") return { tone: "", text: "Bringing in the firm’s copy…" };
  return { tone: "ok", text: (n ? "Sending to the firm account…" : "Saved to the firm account.") + (c.cloud.note ? " " + c.cloud.note : "") };
}

// the owner and staff edit; a member who only looks (viewer) sees the records without the means to change them
export function canEdit() { try { return !cloudOn() || ["owner", "staff", ""].includes(String((Cloud.st && Cloud.st.role) || "")); } catch (e) { return true; } }

// for the tests: forget what is held in this page (the next corpOf reads this computer and the cloud again)
export function forget(cid) { if (cid) delete mem[cid]; else Object.keys(mem).forEach((k) => delete mem[k]); }
if (typeof window === "object") window.FCCorp = { corpOf, forget, flush, saveProfile, saveFiling, saveDoc, dropFiling, dropDoc, cloudNote, canEdit, key: KEY, raw: (cid) => mem[cid], merge3 };
