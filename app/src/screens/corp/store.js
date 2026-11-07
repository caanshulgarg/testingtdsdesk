// Corporate's records per client (phase 1, 07-Nov-2026; simplified after the reviews of 30f70eea6, 74eccc47b, 08b05e4c8):
//   profile    one record a client: the company's details, directors and KMP, shareholders, charges, letterhead
//              -> corp_profiles (migration 143)
//   filings    the e-Forms tracked: one record a form and period (annual) or a form started for an event
//              -> corp_filings (migration 144)
//   docs       resolutions, notices and minutes made for the client (draft / final) -> corp_documents (migration 145)
// FinCom's cloud is the only record: Corporate needs a firm account (signed out, the page says "Sign in to use
// Corporate" and nothing can be changed). Row security by firm: a firm's members read, its owner and staff write.
//   - a save goes straight to the server: a conditional update of the fields this edit changed (updated_at = the one last
//     read). When another computer saved meanwhile, nothing is written; the row is read again, merged three ways (the
//     row last read is the common ancestor: lists of rows by row id, objects key by key, boardDates as a set; this
//     computer wins only where both changed the same field of the same row), and sent again, three times at most;
//   - a field is never written with an old value: only the changed fields and lists are sent (the profile's own keys
//     go laid over the row last read, which the conditional update proves is the server's);
//   - offline or a failed save: the edit stays on the screen, the page says "Not saved: <reason>" with Retry, and tries
//     again by itself when the line is back ("online") and after 5 s, 15 s, 60 s, then every 5 minutes. Nothing is kept
//     across a reload: leaving the page with an edit not saved asks first;
//   - a removal is a conditional DELETE (updated_at = the one last read); a row changed elsewhere meanwhile is read again,
//     kept, and the page says so. A record never saved is simply dropped; no DELETE without updated_at;
//   - this computer keeps only a READ copy of the last rows read (localStorage, under the signed-in person's copy:
//     LocalOwner.P), to draw the page at once; nothing is ever sent from it or merged from it;
//   - another tab's save: "corp updated <cid>|<tab>" (BroadcastChannel and a storage ping) makes this tab read the server
//     again; a tab ignores its own ping, and pings only when it wrote something;
//   - a read is tried again only when the line is back, after signing in, or on its back-off timer: never from drawing.
//     After the first read a read again never makes the page "loading" nor stops editing; while a save is on its way a
//     read waits for it, and a read that a save finished during is thrown away and made again (never an older row over a
//     newer save);
//   - a record removed on another computer while it has an edit here not saved is kept: "Removed on another computer.
//     Your change isn't saved:" Restore (saved again as new) / Discard; never "Saved", never sent again by itself;
//   - a removal asked while the record's first save is on its way waits for it, then is a conditional DELETE;
//   - a part whose table is not there (the migration not run) takes no edit;
//   - (the review of 5ac1e8aca) a removal is never a DELETE without updated_at: a record whose first save failed or whose
//     answer was lost is looked up by its key first; a removal meeting another computer's change is not made (said); a
//     read that started before the last one laid is thrown away; every request gives up after 20 s.
// Before the migrations are run, a table not there (a missing relation) is said for that part alone (cloudNote).
//
//   corpOf(cid)                     {profile, filings: [], docs: [], cloud, pending, ver}
//   saveProfile / saveFiling / saveDoc, dropFiling / dropDoc, cloudNote(cid), retryNow(cid), canEdit(cid)
const KEY = () => ((typeof LocalOwner === "object" && LocalOwner.P) || "tdsdesk:") + "corp:";
const PING = "fincom:corp-updated";
const mem = {};
const TABLES = { profile: "corp_profiles", filings: "corp_filings", docs: "corp_documents" };
const LISTS = ["directors", "shareholders", "charges", "letterhead"];
const BACKOFF = [5000, 15000, 60000, 300000];
const isPending = (e) => !!(Object.keys(e.dirty).length || e.deleting);
const OUT = "you're signed out";
const NOT_REMOVED = "Not removed: it had been changed on another computer meanwhile. Look at it again, then remove it if it should go.";
const REFUSED = "Not removed: the firm account did not allow it (only the firm’s owner or staff remove a record, and a final document stays).";
// the store's requests: Cloud.api, given up after 20 s (an AbortController's signal goes with it; the legacy Cloud.api does
// not pass it to fetch, so a write given up may still land: the next try is conditional, and finds it)
const TIMEOUT = () => (typeof window === "object" && window.__corpTimeout) || 20000;   // (shorter in the tests)
async function api(path, o) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  let t = 0;
  try {
    return await Promise.race([Cloud.api(path, Object.assign({}, o || {}, ctl ? { signal: ctl.signal } : {})),
      new Promise((_, no) => { t = setTimeout(() => { try { if (ctl) ctl.abort(); } catch (e) { /* given up all the same */ } no(new Error("no answer from FinCom’s server in " + TIMEOUT() / 1000 + " s")); }, TIMEOUT()); })]);
  } finally { clearTimeout(t); }
}
const redraw = () => { try { if (typeof render === "function") render(); } catch (e) { /* the next drawing shows it */ } };
const stale = () => { try { return typeof LocalOwner === "object" && !!LocalOwner.stale; } catch (e) { return false; } };
export const cloudOn = () => { try { return typeof Cloud === "object" && Cloud.on() && !stale(); } catch (e) { return false; } };
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
const plain = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
export const uid = () => { try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* below */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }); };
const TAB = uid();   // this tab: its own ping is not news

// ---- the three kinds: a server row <-> the flat record the page edits; body(): the columns of the fields changed
const fromProfile = (r) => Object.assign({}, r.profile || {}, { directors: r.directors || [], shareholders: r.shareholders || [], charges: r.charges || [], letterhead: r.letterhead || {} });
const ownOf = (x) => { const own = Object.assign({}, x); LISTS.concat(["at"]).forEach((k) => delete own[k]); return own; };
const profileBody = (cid, cur, row, fields) => {
  const b = {};
  fields.filter((k) => LISTS.includes(k)).forEach((k) => { b[k] = cur[k] || (k === "letterhead" ? {} : []); });
  const own = fields.filter((k) => !LISTS.includes(k));
  if (own.length || !row) { const p = ownOf(row || {}); own.forEach((k) => { if (cur[k] === undefined) delete p[k]; else p[k] = cur[k]; }); b.profile = p; }
  if (!row) { b.client_id = cid; LISTS.forEach((k) => { if (!(k in b)) b[k] = cur[k] || (k === "letterhead" ? {} : []); }); }
  return b;
};
const fromFiling = (r) => ({ ref: r.ref, form: r.form, kind: r.kind, period: r.period || "", director: r.director || "", status: r.status, steps: r.steps || 0, due: r.due_on || "", event: r.event_on || "",
  srn: r.srn || "", filedOn: r.filed_on || "", reason: r.reason || "", data: r.data || {} });
const FILING_COL = { ref: "ref", form: "form", kind: "kind", period: "period", director: "director", status: "status", steps: "steps", due: "due_on", event: "event_on", srn: "srn", filedOn: "filed_on", reason: "reason", data: "data" };
const filingVal = (k, v) => (k === "steps" ? Math.max(0, Math.min(4, v | 0)) : ["due", "event", "filedOn"].includes(k) ? v || null : k === "data" ? v || {} : v == null ? "" : v);
const filingBody = (cid, cur, row, fields) => {
  const b = {}, ks = row ? fields : Object.keys(FILING_COL);
  ks.forEach((k) => { if (FILING_COL[k]) b[FILING_COL[k]] = filingVal(k, cur[k]); });
  if (!row) Object.assign(b, { client_id: cid, kind: cur.kind || "annual", status: cur.status || "not_started" });
  return b;
};
// the meeting's date: the one in the fields as edited (the column read, meeting, is only the last one saved)
const meetingOf = (x) => { const m = (x.fields && x.fields.meetingDate) || x.meeting || ""; return /^\d{4}-\d{2}-\d{2}$/.test(m) ? m : null; };
const fromDoc = (r) => ({ id: r.id, template: r.template, title: r.title, kind: r.kind, status: r.status, fields: r.fields || {}, meeting: r.meeting_on || "", letterhead: r.letterhead !== false });
const docBody = (cid, cur, row, fields) => {
  const b = {}, ks = row ? fields : ["id", "template", "title", "kind", "status", "fields", "letterhead"];
  ks.forEach((k) => {
    if (k === "title") b.title = String(cur.title || "").slice(0, 300);
    else if (k === "status") b.status = cur.status === "final" ? "final" : "draft";
    else if (k === "letterhead") b.letterhead = cur.letterhead !== false;
    else if (k === "fields") { b.fields = cur.fields || {}; b.meeting_on = meetingOf(cur); }
    else if (["id", "template", "kind"].includes(k)) b[k] = cur[k] || (k === "kind" ? "resolution" : cur[k]);
  });
  if (!row) Object.assign(b, { client_id: cid, meeting_on: meetingOf(cur) });
  return b;
};
const KIND = {
  profile: { table: TABLES.profile, from: fromProfile, body: profileBody, where: (cid) => "client_id=eq." + encodeURIComponent(cid) },
  filings: { table: TABLES.filings, from: fromFiling, body: filingBody, where: (cid, x) => "client_id=eq." + encodeURIComponent(cid) + "&ref=eq." + encodeURIComponent(x.ref) },
  docs: { table: TABLES.docs, from: fromDoc, body: docBody, where: (cid, x) => "id=eq." + encodeURIComponent(x.id) },
};

// ---- the three-way merge of one field: b the row last read (the common ancestor), l this computer's, s the server's now
const rowKey = (r, i) => (r && r.id) || "#" + i;
export function merge3(b, l, s) {
  if (same(l, b)) return s;
  if (same(s, b) || same(s, l)) return l;
  if (Array.isArray(l) && Array.isArray(s) && [l, s, b || []].every((a) => a.every((x) => typeof x === "string"))) {
    const B = new Set(b || []), L = new Set(l);
    return Array.from(new Set(s.filter((x) => L.has(x) || !B.has(x)).concat(l.filter((x) => !B.has(x))))).sort();
  }
  if (Array.isArray(l) && Array.isArray(s) && l.concat(s).every((x) => plain(x))) {
    const B = new Map((b || []).map((r, i) => [rowKey(r, i), r])), L = new Map(l.map((r, i) => [rowKey(r, i), r])), out = [];
    s.forEach((r, i) => {
      const k = rowKey(r, i), br = B.get(k), lr = L.get(k);
      if (lr) out.push(br ? mergeObj(br, lr, r) : lr);
      else if (!br) out.push(r);
      else if (!same(r, br)) out.push(r);
    });
    l.forEach((r, i) => { const k = rowKey(r, i); if (out.some((x, j) => rowKey(x, j) === k) || s.some((x, j) => rowKey(x, j) === k)) return;
      const br = B.get(k); if (!br || !same(r, br)) out.push(r); });
    return out;
  }
  if (plain(l) && plain(s)) return mergeObj(plain(b) ? b : {}, l, s);
  return l;
}
function mergeObj(b, l, s) {
  const out = {};
  new Set(Object.keys(b).concat(Object.keys(l), Object.keys(s))).forEach((k) => { const v = merge3(b[k], l[k], s[k]); if (v !== undefined) out[k] = v; });
  return out;
}

// ---- a record: row (the server's, last read: the ancestor), at (its updated_at), cur (shown: row + edits), dirty (fields
// edited and not saved), err (why the last save did not go), deleting, posting (its first save on its way), sent (a first
// save was tried: it may be on the server though no answer came), removed (gone from the server while edited here)
const rec = (row, at, from) => ({ row: row || null, at: at || "", cur: row ? copy(row) : {}, dirty: {}, err: "", deleting: false, posting: false, sent: false, removed: false, from });
// wseq: writes done (a read started before one finished is thrown away); rseq / laid: reads started / the last one laid
// (an older one is thrown away); rerr: a read again that failed (still editable)
function blank() { return { profile: rec(null, ""), filings: {}, docs: {}, ver: 0, state: "", none: {}, error: "", rerr: "", tries: 0, timer: 0, saveTries: 0, saveTimer: 0, note: "", wseq: 0, rseq: 0, laid: 0 }; }

// the read copy: only rows read from the server, for a quick first drawing (never sent, never merged)
function cacheRead(cid) {
  try {
    const o = JSON.parse(localStorage.getItem(KEY() + cid) || "null"); if (!o || o.v !== 2) return null;
    const c = blank();
    if (o.profile) c.profile = rec(o.profile.row, o.profile.at);
    ["filings", "docs"].forEach((k) => Object.entries(o[k] || {}).forEach(([id, x]) => { c[k][id] = rec(x.row, x.at); }));
    return c;
  } catch (e) { return null; }
}
function cacheWrite(cid) {
  const c = mem[cid]; if (!c || stale()) return;
  const rows = (o) => Object.fromEntries(Object.entries(o).filter(([, e]) => e.at).map(([k, e]) => [k, { row: e.row, at: e.at }]));
  try { localStorage.setItem(KEY() + cid, JSON.stringify({ v: 2, profile: c.profile.at ? { row: c.profile.row, at: c.profile.at } : null, filings: rows(c.filings), docs: rows(c.docs) })); } catch (e) { /* a read copy only */ }
}
const announce = (cid) => {
  try { if (typeof BroadcastChannel === "function") { const b = new BroadcastChannel("fincom-corp"); b.postMessage("corp updated " + cid + "|" + TAB); b.close(); } } catch (e) { /* the storage ping below */ }
  try { localStorage.setItem(PING, cid + "|" + TAB + "|" + Date.now()); } catch (e) { /* none */ }
};

function pendingOf(c) {
  const o = {};
  if (isPending(c.profile)) o.profile = 1;
  Object.entries(c.filings).forEach(([k, e]) => { if (isPending(e)) o["f:" + k] = 1; });
  Object.entries(c.docs).forEach(([k, e]) => { if (isPending(e)) o["d:" + k] = 1; });
  return o;
}
function view(c) {
  // a record being removed is gone from the page at once (it comes back, and is said, if the removal is refused)
  const live = (o) => Object.values(o).filter((e) => !e.deleting).map((e) => Object.assign({}, e.cur, { at: e.at || "" }));
  return { profile: Object.assign({}, c.profile.cur, { at: c.profile.at }), filings: live(c.filings), docs: live(c.docs).sort((a, b) => String(b.at || "~").localeCompare(String(a.at || "~"))),
    cloud: { state: c.state, none: c.none, error: c.error }, pending: pendingOf(c), ver: c.ver };
}
const views = new WeakMap();
export function corpOf(cid) {
  if (!cid) return view(blank());
  if (!mem[cid]) { mem[cid] = cacheRead(cid) || blank(); mem[cid].state = cloudOn() ? "loading" : "signedout"; if (cloudOn()) pull(cid); }
  const c = mem[cid];
  // signed in since: one read (the state changes at once, so drawing never asks again)
  if (c.state === "signedout" && cloudOn()) { c.state = "loading"; if (c.error === OUT) c.error = ""; pull(cid); }
  else if (c.error === OUT && cloudOn()) { c.error = ""; if (c.state === "ready") setTimeout(() => save(cid), 0); }
  else if (c.state !== "signedout" && !cloudOn() && !Object.keys(pendingOf(c)).length) c.state = "signedout";
  let v = views.get(c);
  if (!v || v.ver !== c.ver) { v = view(c); views.set(c, v); }
  return v;
}
const bump = (cid) => { const c = mem[cid]; if (c) c.ver++; redraw(); };

// a missing relation (the migration not run): 42P01 / "relation ... does not exist" / PostgREST's PGRST205 "Could not
// find the table"; never a missing function or column
const missing = (e) => /42P01|relation "?[\w.]*"? does not exist|PGRST205|Could not find the table/i.test(String((e && e.message) || e));
const dup = (e) => /23505|duplicate key/i.test(String((e && e.message) || e));
const why = (e) => (typeof navigator === "object" && navigator.onLine === false ? "you're offline" : String((e && e.message) || e).replace(/^TypeError: /, "").slice(0, 160));

// a server row laid under a record: the shown value of a field edited here is merged three ways, the rest is the server's
function take(kind, e, row) {
  const srv = KIND[kind].from(row), cur = copy(srv);
  Object.keys(e.dirty).forEach((k) => { const v = merge3(e.row ? e.row[k] : undefined, e.cur[k], srv[k]); if (v === undefined) delete cur[k]; else cur[k] = v; });
  Object.keys(e.dirty).forEach((k) => { if (same(cur[k], srv[k])) delete e.dirty[k]; });
  e.row = srv; e.at = row.updated_at || ""; e.cur = cur; e.removed = false;
}

export async function pull(cid) {
  const c = mem[cid];
  if (!c) return;
  if (!cloudOn()) { c.state = "signedout"; bump(cid); return; }
  if (c.saving) { c.pullAfter = true; return; }        // read once the save on its way is in
  clearTimeout(c.timer);
  const first = c.state !== "ready", w0 = c.wseq, seq = ++c.rseq;
  if (first) c.state = "loading";
  const q = "client_id=eq." + encodeURIComponent(cid);
  let failed = null;
  const get = async (k, path) => {
    try { const r = await api(path); delete c.none[k]; return r || []; }
    catch (e) { if (missing(e)) c.none[k] = true; else failed = e; return null; }
  };
  const [p, f, d] = await Promise.all([get("profile", TABLES.profile + "?select=*&" + q), get("filings", TABLES.filings + "?select=*&" + q), get("docs", TABLES.docs + "?select=*&" + q)]);
  // a newer read is in already: this one is older than what the page shows
  if (seq < c.laid) return;
  // a save went (or is going) while this read was on its way: what it read may be older than the save; read again after
  if (c.saving || c.wseq !== w0) { if (c.saving) c.pullAfter = true; else pull(cid); return; }
  if (failed) {
    // tried again on its back-off timer (and when the line is back, or on signing in): never from drawing. After the first
    // read the page stays as it is, editable (rerr says it)
    if (first) { c.state = "unread"; c.error = why(failed); } else c.rerr = why(failed);
    const wait = BACKOFF[Math.min(c.tries, BACKOFF.length - 1)]; c.tries++;
    c.timer = setTimeout(() => pull(cid), wait);
    bump(cid); return;
  }
  c.laid = seq; c.tries = 0; c.error = ""; c.rerr = "";
  // a record the server no longer has: removed on another computer (gone here too), unless it is edited here and not saved:
  // kept, and said (Restore / Discard)
  const goneThere = (e) => { if (Object.keys(e.dirty).length) { e.removed = true; return false; } return true; };
  if (p) { if (p[0]) take("profile", c.profile, p[0]); else if (c.profile.at && !c.profile.removed && goneThere(c.profile)) c.profile = rec(null, ""); }
  const lay = (kind, rows, store, key) => {
    if (!rows) return;
    const seen = {};
    rows.forEach((r) => { const k = r[key]; seen[k] = 1; const e = store[k] || (store[k] = rec(null, "")); if (!e.deleting) take(kind, e, r); });
    // being removed here and gone there: done
    Object.keys(store).forEach((k) => { const e = store[k]; if (seen[k] || !e.at) return; if (e.deleting || (!e.removed && goneThere(e))) delete store[k]; });
  };
  lay("filings", f, c.filings, "ref");
  lay("docs", d, c.docs, "id");
  c.state = "ready"; cacheWrite(cid); bump(cid);
  if (Object.keys(pendingOf(c)).length) save(cid);
}

async function sendOne(cid, kind, e, tries) {
  const K = KIND[kind], fields = Object.keys(e.dirty), sentVals = Object.fromEntries(fields.map((k) => [k, copy(e.cur[k])]));
  const body = K.body(cid, e.cur, e.at ? e.row : null, fields);
  let rows = null;
  // a first save: what it sent is kept, so that a row found later by its key can be told to be this one (or another's)
  e.posting = !e.at; if (!e.at) { e.sent = true; e.sentBody = K.body(cid, e.cur, null, []); }
  try {
    rows = e.at ? await api(K.table + "?" + K.where(cid, e.cur) + "&updated_at=eq." + encodeURIComponent(e.at), { method: "PATCH", headers: { Prefer: "return=representation" }, body })
      : await api(K.table, { method: "POST", headers: { Prefer: "return=representation" }, body });
  } catch (x) { if (!(dup(x) && !e.at)) throw x; rows = []; } finally { e.posting = false; }
  if (!rows || !rows.length) {
    if (tries >= 3) throw new Error("another computer kept changing it");
    const now = await api(K.table + "?select=*&" + K.where(cid, e.cur));
    // its removal was asked meanwhile: another computer's row is no leave to remove it (said); gone there: done
    if (e.deleting) { if (!now || !now[0]) return "gone";
      // the first save's own row (a retry after an answer lost): removed now, by its updated_at
      if (!e.at && mine(cid, kind, e, now[0])) { e.at = now[0].updated_at; e.row = KIND[kind].from(now[0]); return "again"; }
      e.deleting = false; e.dirty = {}; take(kind, e, now[0]); mem[cid].note = NOT_REMOVED; return "merged"; }
    if (now && now[0]) take(kind, e, now[0]);
    else if (e.at) { e.removed = true; return "removed"; }    // removed on another computer: kept, said; never sent as new by itself
    return Object.keys(e.dirty).length ? sendOne(cid, kind, e, tries + 1) : "merged";
  }
  mem[cid].wseq++;
  const srv = K.from(rows[0]), cur = copy(srv);
  // its removal was asked while this first save was on its way: now a conditional DELETE (the save loop goes again)
  if (e.deleting) { e.row = srv; e.at = rows[0].updated_at || e.at; e.cur = cur; return "again"; }
  // saved: a field edited again while the save was on its way stays to be saved
  fields.forEach((k) => { if (same(e.cur[k], sentVals[k])) delete e.dirty[k]; });
  Object.keys(e.dirty).forEach((k) => { cur[k] = e.cur[k]; });
  e.row = srv; e.at = rows[0].updated_at || e.at; e.cur = cur; e.err = "";
  return Object.keys(e.dirty).length ? "again" : "saved";
}

// a row found by its key is the one this computer's first save made: the same as what it sent
const mine = (cid, kind, e, row) => !!e.sentBody && same(e.sentBody, KIND[kind].body(cid, KIND[kind].from(row), null, []));
async function removeOne(cid, kind, store, k, e) {
  const K = KIND[kind];
  if (!e.at) {
    // its first save failed, or its answer was lost: on the server or not, looked up by its key (never a DELETE without
    // updated_at)
    const now = await api(K.table + "?select=*&" + K.where(cid, e.cur));
    if (!now || !now[0] || !now[0].updated_at) { delete store[k]; return; }
    // another computer's row (or changed there since): not removed, said
    if (!mine(cid, kind, e, now[0])) { e.deleting = false; e.dirty = {}; take(kind, e, now[0]); mem[cid].note = NOT_REMOVED; return; }
    e.at = now[0].updated_at;
  }
  const gone = await api(K.table + "?" + K.where(cid, e.cur) + "&updated_at=eq." + encodeURIComponent(e.at), { method: "DELETE", headers: { Prefer: "return=representation" } });
  if (gone && gone.length) { mem[cid].wseq++; delete store[k]; return; }
  // changed on another computer since it was read (or already removed there): read again and say so
  const now = await api(K.table + "?select=*&" + K.where(cid, e.cur));
  // the row as it was read (the same updated_at): the row security refused the removal; else changed meanwhile
  if (now && now[0]) { const refused = now[0].updated_at === e.at; e.deleting = false; e.dirty = {}; take(kind, e, now[0]); mem[cid].note = refused ? REFUSED : NOT_REMOVED; }
  else delete store[k];
}

// save what is edited on this page; on a failure: said, with Retry, and tried again by itself (online, then a back-off)
export async function save(cid) {
  const c = mem[cid];
  if (!c) return;
  if (!cloudOn()) { c.error = OUT; bump(cid); return; }
  if (c.state !== "ready") return;           // after the read (it saves what is pending once it is in)
  if (c.saving) { c.again = true; return c.saving; }
  clearTimeout(c.saveTimer);
  const w0 = c.wseq;
  c.saving = (async () => {
    let failed = null;
    do {
      c.again = false;
      const jobs = [];
      if (isPending(c.profile) && !c.profile.removed) jobs.push(["profile", c.profile, null, null]);
      [["filings", c.filings], ["docs", c.docs]].forEach(([kind, store]) => Object.entries(store).forEach(([k, e]) => { if (isPending(e) && !e.removed) jobs.push([kind, e, store, k]); }));
      for (const [kind, e, store, k] of jobs) {
        if (store ? store[k] !== e : c.profile !== e) continue;    // dropped (never saved) or discarded meanwhile
        if (c.none[kind]) { e.err = "FinCom’s server is not updated for this part yet"; continue; }
        try {
          if (e.deleting) await removeOne(cid, kind, store, k, e);
          else { const r = await sendOne(cid, kind, e, 0); if (r === "again") c.again = true; else if (r === "gone") delete store[k]; }
          e.err = "";
        } catch (x) { if (missing(x)) { c.none[kind] = true; e.err = "FinCom’s server is not updated for this part yet"; } else { e.err = why(x); failed = x; } }
      }
    } while (c.again && !failed);
    if (failed) {
      const wait = BACKOFF[Math.min(c.saveTries, BACKOFF.length - 1)]; c.saveTries++;
      c.saveTimer = setTimeout(() => save(cid), wait);
    } else c.saveTries = 0;
    if (c.wseq !== w0) announce(cid);        // only when something was written
    cacheWrite(cid);
  })();
  try { await c.saving; } finally { c.saving = null; bump(cid); if (c.pullAfter) { c.pullAfter = false; pull(cid); } }
}
// Retry: read again when the copy is not in (or a read again failed); otherwise send what is not saved, if anything
export function retryNow(cid) {
  const c = mem[cid]; if (!c) return; c.saveTries = 0; c.tries = 0;
  if (c.state !== "ready" || c.rerr) return pull(cid);
  if ([c.profile].concat(Object.values(c.filings), Object.values(c.docs)).some((e) => isPending(e) && !e.removed)) save(cid);
}
// a record removed on another computer while edited here: keep = saved again as a new record; else the edit is dropped.
// key: that record ("profile", "f:<ref>", "d:<id>"; cloudNote's removed[]); none: all of them
export function settleRemoved(cid, keep, key) {
  const c = mem[cid]; if (!c) return;
  const one = (e, gone, k) => { if (!e.removed || (key && key !== k)) return; if (keep) { Object.assign(e, { removed: false, row: null, at: "", err: "" }); Object.keys(e.cur).forEach((k) => { if (k !== "at") e.dirty[k] = 1; }); } else gone(); };
  one(c.profile, () => { c.profile = rec(null, ""); }, "profile");
  ["filings", "docs"].forEach((kind) => Object.keys(c[kind]).forEach((k) => one(c[kind][k], () => { delete c[kind][k]; }, kind[0] + ":" + k)));
  c.ver++; redraw(); if (keep) save(cid);
}

function edit(cid, e, patch, skip) {
  Object.entries(patch).forEach(([k, v]) => { if ((skip || []).includes(k) || same(e.cur[k], v)) return; e.cur = Object.assign({}, e.cur, { [k]: copy(v) }); e.dirty[k] = 1; });
  const c = mem[cid]; c.note = ""; c.ver++; redraw();
  clearTimeout(c.debounce); c.debounce = setTimeout(() => save(cid), 400);
}
// an edit is taken whenever signed in (before the first read is in, it is saved once the read is in: never dropped),
// except for a part whose table is not there
const ready = (cid, kind) => { corpOf(cid); const c = mem[cid]; return cloudOn() && c.state !== "signedout" && !c.none[kind]; };
export function saveProfile(cid, patch) { if (!ready(cid, "profile")) return; edit(cid, mem[cid].profile, patch, ["at"]); }
export function saveFiling(cid, f) {
  if (!ready(cid, "filings")) return Object.assign({}, f);
  const c = mem[cid], e = c.filings[f.ref] || (c.filings[f.ref] = rec(null, ""));
  if (e.deleting) return Object.assign({}, e.cur);
  if (!e.at && !e.cur.ref) e.cur = { ref: f.ref };
  edit(cid, e, f, ["at", "fromProfile"]);
  return Object.assign({}, e.cur);
}
export function saveDoc(cid, d) {
  if (!ready(cid, "docs")) return Object.assign({ id: d.id || "" }, d);
  const c = mem[cid], id = d.id || uid(), e = c.docs[id] || (c.docs[id] = rec(null, ""));
  if (e.deleting) return Object.assign({}, e.cur);
  if (!e.at && !e.cur.id) e.cur = { id };
  edit(cid, e, Object.assign({}, d, { id }), ["at"]);
  return Object.assign({}, e.cur);
}
function drop(cid, kind, k) {
  if (!ready(cid, kind)) return;
  const store = mem[cid][kind], e = store[k]; if (!e) return;
  // never sent: nothing on the server to remove (a first save on its way, or one that failed, is looked up first)
  if (!e.at && !e.posting && !e.sent) { delete store[k]; mem[cid].ver++; redraw(); return; }
  e.dirty = {}; e.deleting = true; e.removed = false; mem[cid].ver++; redraw(); save(cid);
}
export function dropFiling(cid, ref) { drop(cid, "filings", ref); }
export function dropDoc(cid, id) { drop(cid, "docs", id); }

const PART = { profile: "the profile", filings: "e-Forms", docs: "the documents" };
export function cloudNote(cid) {
  corpOf(cid);
  const c = mem[cid], n = Object.keys(pendingOf(c)).length, none = Object.keys(c.none);
  const errs = [c.profile].concat(Object.values(c.filings), Object.values(c.docs)).map((e) => e.err).filter(Boolean);
  if (c.state === "signedout" && !n) return { tone: "", text: "Sign in to use Corporate.", signin: true };
  // removed on another computer: each record named, its own Restore / Discard; another record's failed save said too
  const rm = [["profile", c.profile]].concat(Object.entries(c.filings).map(([k, e]) => ["f:" + k, e]), Object.entries(c.docs).map(([k, e]) => ["d:" + k, e])).filter(([, e]) => e.removed)
    .map(([key, e]) => ({ key, name: key === "profile" ? "the company’s details" : key[0] === "f" ? (e.cur.form || "a form") + (e.cur.kind === "event" ? (e.cur.event ? " · event of " + e.cur.event.split("-").reverse().join("-") : "") : e.cur.period ? " · FY " + e.cur.period : "") : e.cur.title || "a document" }));
  if (rm.length) {
    const other = [c.profile].concat(Object.values(c.filings), Object.values(c.docs)).find((e) => !e.removed && e.err);
    return { tone: "bad", text: "Removed on another computer. Your change isn’t saved:", removed: rm, retry: !!other, after: other ? "Not saved: " + other.err + "." : "" };
  }
  if (none.length) return { tone: "warn", text: (none.includes("profile") ? "Corporate is not set up on FinCom’s server yet: nothing can be saved." : PART[none[0]][0].toUpperCase() + PART[none[0]].slice(1) + (none.length > 1 ? " and " + PART[none[1]] : "") + ": not set up on FinCom’s server yet, so not saved.") };
  if (n && (errs.length || c.error)) return { tone: "bad", text: "Not saved: " + (errs[0] || c.error) + ".", retry: true };
  if (c.state === "unread" || c.rerr) return { tone: "warn", text: "The firm’s copy could not be read (" + (c.error || c.rerr) + "). Trying again…", retry: true };
  if (c.state === "loading") return { tone: "", text: "Bringing in the firm’s copy…" };
  return { tone: c.note ? "warn" : "ok", text: (n ? "Saving…" : "Saved to the firm account.") + (c.note ? " " + c.note : "") };
}

// the owner and staff edit, once the firm's copy is in; a viewer, or signed out, only looks
export function canEdit(cid) {
  try { if (!cloudOn()) return false; if (cid && mem[cid] && (mem[cid].state !== "ready" || mem[cid].none.profile)) return false; return ["owner", "staff", ""].includes(String((Cloud.st && Cloud.st.role) || "")); } catch (e) { return false; }
}

if (typeof window === "object") {
  // another tab's ping (never this tab's own)
  const reread = (cid, tab) => { if (tab !== TAB && mem[cid] && cloudOn() && mem[cid].state !== "loading") pull(cid); };
  try { if (typeof BroadcastChannel === "function") new BroadcastChannel("fincom-corp").onmessage = (m) => { const t = String(m.data || ""); if (t.indexOf("corp updated ") === 0) { const [cid, tab] = t.slice(13).split("|"); reread(cid, tab); } }; } catch (e) { /* the storage ping */ }
  window.addEventListener("storage", (ev) => { if (ev.key === PING && ev.newValue) { const [cid, tab] = String(ev.newValue).split("|"); reread(cid, tab); } });
  window.addEventListener("online", () => Object.keys(mem).forEach((cid) => retryNow(cid)));
  window.addEventListener("beforeunload", (ev) => { if (Object.values(mem).some((c) => Object.keys(pendingOf(c)).length)) { ev.preventDefault(); ev.returnValue = ""; } });
}

// for the tests: forget what is held in this page (the next corpOf reads the server again)
export function forget(cid) { const drop1 = (k) => { clearTimeout(mem[k].timer); clearTimeout(mem[k].saveTimer); clearTimeout(mem[k].debounce); delete mem[k]; }; if (cid) { if (mem[cid]) drop1(cid); } else Object.keys(mem).forEach(drop1); }
if (typeof window === "object") window.FCCorp = { corpOf, forget, save, pull, retryNow, settleRemoved, saveProfile, saveFiling, saveDoc, dropFiling, dropDoc, cloudNote, canEdit, key: KEY, raw: (cid) => mem[cid], merge3 };
