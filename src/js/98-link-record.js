/* @react-lazy: begin 98-link-record.js (the React app loads this file with the Tally page, Post to Tally, Bank, Sales, Settings, the Assistant's entries and Post automatically: app/src/parts/TallyCompanies.jsx, LinkStatus.jsx, app/src/screens/Post.jsx, Bank.jsx, Sales.jsx, Settings.jsx, app/src/lib/asstEntries.js, autopost.js; the screens' files are fetched once the first page is up, so it runs for every page) */
/* ================================================================== */
/* One cloud link record per client and Tally company                  */
/* ================================================================== */
// next-link-record (26-Oct-2026, stage 1 of "Stable Tally linking"; migration 110, public.tally_links). A client's Tally
// connection lived in four places that drifted: tally_companies.client_id, clients.data (postTo, tallyName, choices), each
// browser's copy and the bridge's files. Now the link and whether the client may post into that company are ONE record
// in FinCom's cloud, keyed by the Tally company's GUID (a rename keeps it; the name is for display only), changed only by
// the link functions (tally_link_set, tally_link_posting; tally_company_link goes through them), never by a client's
// save: a browser holding an older copy of the client cannot undo it.
// What reads it (and nothing else decides):
//   - the companies' rows (tally_companies, read by TLight every 30 s and by the Tally page) carry the record's client:
//     TCloud.restAll below lays the record over them, so tallyRowOf / tallyLinkOf / tallyLine / the chips / the Tally
//     page say the record's link; a name a computer reports with a linked company's GUID is that company (renamed);
//   - the posting gate: postToProblem (src/js/24) is the record's here; 97's postToFromLink, postLineFor, postToOffer,
//     postToAllow follow it; clients.data postTo (and the client's Tally name) are still WRITTEN from it for older code
//     paths (postToMirror), never read for a decision.
// Without the table (110 not run yet), or a firm without any record: as before (tally_companies, clients.data postTo).
const LinkRec = {
  st: {rows: null, at: 0, p: null, missing: false, err: "", guid: {}, now: null},
  COLS: "book_id,client_id,company_guid,company_name,gstin,device_id,computer,posting_allowed,state,linked_by,linked_at,updated_by,updated_at,version,how,data_loc,data_folder,windows_user,tally_port",
  PCOLS: "book_id,data_loc,data_folder,computer,windows_user,tally_port,state,last_seen,entries_at,last_entry",
  on(){ return typeof TCloud === "object" && TCloud.on() && !this.st.missing; },
  // read, and there: a firm without any record (110 not run, or never linked: the backfill made one for every link, and
  // every link since makes one) keeps the old rules, which then say the same (nothing linked)
  ready(){ return this.on() && Array.isArray(this.st.rows) && this.st.rows.length > 0; },
  key(n){ return (typeof ledNm === "function" ? ledNm(String(n || "")) : String(n || "")).replace(/\s+/g, " ").trim().toLowerCase(); },
  // the firm's records, read again after 15 s (TLight asks every 30 s); a cloud without the table: missing, as before
  load(force){
    if (!this.on()) return Promise.resolve(null);
    if (this.st.p) return this.st.p;
    if (!force && this.st.rows && Date.now() - this.st.at < 15000) return Promise.resolve(this.st.rows);
    // (the data locations: the same company in two places, tally_link_places; none on a cloud without them)
    const places = Promise.resolve().then(() => TCloud.restPages("tally_link_places?select=" + this.PCOLS + "&state=neq.not_used")).then(r => [].concat(r || []), () => []);
    const p = this.st.p = Promise.resolve().then(() => TCloud.restPages("tally_links?select=" + this.COLS + "&order=company_name.asc"))
      .then(async rows => { this.st.places = (await places).filter(x => x && x.book_id && x.data_loc);
        this.st.rows = [].concat(rows || []).filter(r => r && r.book_id); this.st.at = Date.now(); this.st.err = ""; return this.st.rows; },
        e => { const m = String((e && e.message) || e); this.st.err = m; if (/tally_links|PGRST205|42P01|does not exist/i.test(m)) this.st.missing = true; return this.st.rows; })
      .finally(() => { if (this.st.p === p) this.st.p = null; });
    return p;
  },
  // the GUID each computer's beat says for a company name (bridge 2.4.5 and later; kept across beats), and the names
  // each GUID is reported under now (st.now: the beats as last read)
  learn(devs){
    const now = {};
    [].concat(devs || []).forEach(d => { const cs = (((d || {}).info || {}).beat || {}).companies;
      if (Array.isArray(cs)) cs.forEach(c => { const g = c && typeof c.guid === "string" ? c.guid.trim().toLowerCase() : "";
        if (c && c.name && /^[0-9a-z-]{1,100}$/.test(g)){ this.st.guid[this.key(c.name)] = g; const l = now[g] = now[g] || []; if (!l.some(n => this.key(n) === this.key(c.name))) l.push(String(c.name)); } }); });
    if (Object.keys(now).length) this.st.now = now;
  },
  // the beats as this page holds them now (learnt again whenever one of them changed)
  learnNow(){
    const devs = [].concat((typeof TLight === "object" && TLight.st.devs) || [], (typeof TCloud === "object" && TCloud.pane && TCloud.pane.devices) || []);
    const k = devs.map(d => { const b = (((d || {}).info || {}).beat) || {}; return (d && d.id) + "@" + (b.at || "") + ":" + [].concat(b.companies || []).map(c => c && c.name + "=" + c.guid).join(","); }).join("|");
    if (k !== this.st.devsKey){ this.st.devsKey = k; this.learn(devs); }
    return this.st.now;
  },
  guidOf(name){ return this.st.guid[this.key(name)] || ""; },
  live(){ return (this.st.rows || []).filter(r => r.state === "linked" && r.client_id); },
  // the company's name in Tally now: renamed when the computers no longer report the record's name and report its GUID
  // under exactly one other name; else the record's. (Two copies of one company under two names, both reported, are
  // two companies: the GUID never links the second one; tally_link_set refuses it for another client)
  nameOf(r){
    if (!r) return "";
    const all = this.learnNow(), now = r.company_guid && all ? all[r.company_guid] : null;
    if (!now || !now.length || now.some(n => this.key(n) === this.key(r.company_name))) return r.company_name || "";
    return now.length === 1 ? now[0] : r.company_name || "";
  },
  // the record a name stands for: its own (the cloud's name), or the one whose company has that name in Tally now
  ofName(name){ const k = this.key(name), L = this.live();
    return L.find(r => this.key(r.company_name) === k) || L.find(r => r.company_guid && this.key(this.nameOf(r)) === k) || null; },
  isName(r, name){ const k = this.key(name); return !!r && !!k && (this.key(r.company_name) === k || this.key(this.nameOf(r)) === k); },
  // the linked company a row's name is the new name of (renamed in Tally; FinCom's cloud still keeps it under its old
  // name), or null
  renamedOf(name){ const x = this.ofName(name); return x && this.key(x.company_name) !== this.key(name) ? x : null; },
  // a record's data locations: the one FinCom reads first, then those that wait for a person's choice (the same company
  // in two places; nothing from them is applied)
  placesOf(r){ const l = r ? [].concat(this.st.places || []).filter(x => x.book_id === r.book_id) : [];
    return l.sort((a, b) => (a.state === "chosen" ? 0 : 1) - (b.state === "chosen" ? 0 : 1) || String(b.last_seen || "").localeCompare(String(a.last_seen || ""))); },
  // next-tally-linknow (28-Oct-2026; staging: ONE computer, bridge and Windows user shown as two places, "Data:" and none;
  // the owner: "I don't want false alarms at all, use a proper system"). Two places ONLY when two different, complete
  // folders (absolute paths, compared normalised as migration 127's tally_folder_norm: case, / or \, repeated and trailing
  // separators; the same folder on another computer is another place) have each sent entries (entries_at). Anything else
  // (blank, TallyPrime's "Data:", a port only, Tally closed, the same folder spelled differently, a restart) is one place,
  // said nowhere. A cloud without 127 gives no entries_at (its places are not read at all): never a card
  folderKey(f){
    const a = String(f || "").trim().replace(/\//g, "\\").toLowerCase();
    const unc = /^\\\\[^\\]+\\[^\\]+/.test(a);
    if (/^\\\\/.test(a) && !unc) return "";
    const b = unc ? "\\\\" + a.slice(2).replace(/\\+/g, "\\") : a.replace(/\\+/g, "\\");
    if (!/^([a-z]:\\[^\\]|\\\\[^\\]+\\[^\\]+|\\[^\\])/.test(b)) return "";
    return b.replace(/\\+$/, "");
  },
  realFolder(f){ return !!this.folderKey(f); },
  twoPlaces(r){
    const l = this.placesOf(r).filter(x => (x.state === "waiting" || x.state === "chosen") && x.entries_at && this.realFolder(x.data_folder));
    const k = x => String(x.computer || "").trim().toLowerCase() + "|" + this.folderKey(x.data_folder);
    return l.some(x => x.state === "waiting") && l.some(x => x.state === "chosen") && new Set(l.map(k)).size > 1;
  },
  // the places the card shows: those of twoPlaces, one per folder
  realPlaces(r){
    const seen = new Set();
    return this.placesOf(r).filter(x => (x.state === "waiting" || x.state === "chosen") && x.entries_at && this.realFolder(x.data_folder))
      .filter(x => { const k = String(x.computer || "").trim().toLowerCase() + "|" + this.folderKey(x.data_folder); if (seen.has(k)) return false; seen.add(k); return true; });
  },
  // an owner's choice of the place that is the books (tally_link_place_choose); true when the cloud took it
  async choosePlace(r, loc){
    try { await TCloud.rpc("tally_link_place_choose", {p_book: r.book_id, p_loc: loc}); }
    catch (e){ toast("Could not choose: " + ((e && e.message) || e)); return false; }
    await this.again(); toast("FinCom reads " + this.nameOf(r) + " from the data you chose."); return true;
  },
  forClient(cid){ return this.live().filter(r => String(r.client_id) === String(cid)); },
  // two names of one company: the same words, or one linked company's names (its record's and its name in Tally now)
  same(a, b){ if (this.key(a) === this.key(b)) return true; const r = this.ofName(a) || this.ofName(b); return !!r && this.isName(r, a) && this.isName(r, b); },
  // the companies' rows with the record's client, by the book (the row's own record; a row read before the book was
  // asked for: by the record's name). A row under a linked company's new name in Tally is that company: renamedOf
  overlay(rows){
    if (!this.ready() || !Array.isArray(rows)) return rows;
    this.learnNow();
    const L = this.live();
    rows.forEach(r => {
      if (!r) return;
      const x = (r.book_id ? L.find(l => l.book_id === r.book_id) : L.find(l => this.key(l.company_name) === this.key(r.company))) || null;
      r.rec = x; r.client_id = x ? x.client_id : null; r.posting = !!(x && x.posting_allowed);
      if (x && x.linked_at && !r.linked_at) r.linked_at = x.linked_at;
    });
    return rows;
  },
  // of a client's records allowing posting, the one its computer reported last (the row's last_seen)
  pick(co){
    const recs = co ? this.forClient(co.id).filter(r => r.posting_allowed) : [];
    if (recs.length < 2) return recs[0] || null;
    const rows = [].concat((typeof TLight === "object" && TLight.st.cos) || [], (typeof TCloud === "object" && TCloud.pane && TCloud.pane.companies) || []);
    const seen = r => rows.filter(x => x && x.rec === r).map(x => String(x.last_seen || "")).sort().pop() || "";
    return recs.slice().sort((a, b) => seen(b).localeCompare(seen(a)))[0];
  },
  // after a link, an unlink or a posting change: read again, and every page with it
  async again(){
    await this.load(true);
    try { if (typeof TLight === "object"){ TLight.st.at = 0; await TLight.refresh(); } } catch (e){}
    if (typeof render === "function") render();
  }
};
// the companies a client may post into, as its records say (null: no record read, or no table: the old rules)
//   {recs, linked: [names], allowed: [names], pick: the record posted into}
function linkPostOf(co){
  if (!co || !LinkRec.ready()) return null;
  const recs = LinkRec.forClient(co.id), pk = LinkRec.pick(co);
  return {recs, linked: recs.map(r => LinkRec.nameOf(r)), allowed: recs.filter(r => r.posting_allowed).map(r => LinkRec.nameOf(r)), pick: pk};
}
// the gate (src/js/24's postToProblem, the record's): "" when it may post (into company, when named)
const postToProblemOld = typeof postToProblem === "function" ? postToProblem : null;
function postToProblemRec(co, company){
  if (!co) return "";
  const lp = linkPostOf(co);
  if (!lp) return postToProblemOld ? postToProblemOld(co, company) : "";
  if (!lp.linked.length) return "Link " + co.name + " to its company in Tally first (the Tally page). Nothing was posted.";
  if (!lp.allowed.length) return "Posting into Tally is stopped for " + co.name + ": allow it on the Tally page (" + lp.linked[0] + " ⋯ Post entries here). Nothing was posted.";
  if (company && !lp.recs.some(r => r.posting_allowed && LinkRec.isName(r, company))) return co.name + " may post only to " + lp.allowed.join(" or ") + ", but " + company + " was about to receive it. Nothing was posted.";
  return "";
}
// the company the bridge is asked about for a client: the record's (its name in Tally now), else as before
const tallyCoNameOld = typeof tallyCoName === "function" ? tallyCoName : null;
function tallyCoNameRec(co){
  const lp = co ? linkPostOf(co) : null, r = lp && (lp.pick || lp.recs[0]);
  return r ? LinkRec.nameOf(r) : tallyCoNameOld ? tallyCoNameOld(co) : (co && (co.tallyName || co.name)) || "";
}
// next-tally-link-any-bridge (the owner, 06-Nov-2026, staging: "a client <-> Tally company link belongs to the COMPANY, not to
// one Windows login's bridge"; a link pinned to one login's computer key waited for that login's Tally while the company
// was open in another login's bridge on the same server). The bridge that serves a company is chosen at the time of use:
// one of the firm's bridges heard within 3 minutes whose own beat has the company open (by its GUID when both the link
// and that computer key's beat know one: a company of the same name under another GUID is another company; else by name),
// reading the link's data location when the record has a real folder (the computer and the data folder, as migration 127's
// tally_link_loc: a copy of the company in another folder is never the books; a bridge naming no real folder counts, as
// tally_link_place_check applies its data), this browser's own bridge first, then the link's computer key (tally_links.device_id / tally_companies.device_id: the
// last used), then the newest heard. null: open in none. {dev, id, how: "own" | "linked" | "other", at, all: Set of the keys}
// o.reads (next-link-follow): for a read, a bridge with reading stopped or in test mode does not count
function tallyServeDevs(){
  const by = new Map(), at = d => String((((d && d.info) || {}).beat || {}).at || "");
  [].concat((typeof TLight === "object" && TLight.st.devs) || [], (typeof TCloud === "object" && TCloud.pane && TCloud.pane.devices) || [])
    .forEach(d => { if (d && d.id && !d.revoked && (!by.has(d.id) || at(d) > at(by.get(d.id)))) by.set(d.id, d); });
  return [...by.values()];
}
function tallyServeOwn(){
  try { const b = typeof globalThis.tallyOwnBridge === "function" ? globalThis.tallyOwnBridge() : null; if (b && b.id) return b.id; } catch (e){}
  try { return (typeof Bridge === "object" && Bridge.cfg && (Bridge.cfg() || {}).bridgeId) || ""; } catch (e){ return ""; }
}
// the plain words "Open <company> in Tally" (open in none) only where they are true: another computer key of the firm was
// heard within 3 minutes, and the linked key (devId) is heard too (its Tally simply lacks the company) or that other key is
// on the same computer (another Windows login of a shared server, where the company can be opened). Otherwise (the linked
// key offline, its bridge not running, no internet, and no other login on its computer) the existing words stand
const tallyPcOf = d => { const i = (d && d.info) || {}; return String(i.computer || (i.beat || {}).computer || "").trim().toLowerCase(); };
const tallyFresh = d => Date.now() - (Date.parse((((d && d.info) || {}).beat || {}).at || (d && d.last_seen) || "") || 0) < 180000;
function tallyPlain(devId){
  const devs = tallyServeDevs(), me = devs.find(d => d.id === devId), others = devs.filter(d => d.id !== devId && tallyFresh(d));
  if (!others.length) return false;
  if (!me) return !devId;
  return tallyFresh(me) || (!!tallyPcOf(me) && others.some(d => tallyPcOf(d) === tallyPcOf(me)));
}
function tallyServe(company, o){
  o = o || {};
  const k = LinkRec.key(company); if (!k) return null;
  const rec = o.rec || LinkRec.ofName(company), guid = String(o.guid || (rec && rec.company_guid) || "").trim().toLowerCase();
  const linked = o.device || (rec && rec.device_id) || "", own = o.own === undefined ? tallyServeOwn() : o.own, now = Date.now(), hits = [];
  const fk = rec && LinkRec.folderKey(rec.data_folder), place = fk ? String(rec.computer || "").trim().toLowerCase() + "|" + fk : "";
  tallyServeDevs().forEach(d => {
    const info = d.info || {}, beat = info.beat || {}, br = info.bridges && typeof info.bridges === "object" ? info.bridges : {}, ids = Object.keys(br);
    const g = {}; [].concat(beat.companies || []).forEach(c => { if (c && c.name && c.guid) g[LinkRec.key(c.name)] = String(c.guid).trim().toLowerCase(); });
    const same = n => { const nk = LinkRec.key(n); return (nk === k || LinkRec.same(n, company)) && (!guid || !g[nk] || g[nk] === guid); };
    (ids.length ? ids : [""]).forEach(id => {
      const b = (id && br[id]) || {}, mine = !id || ids.length === 1 || d.main_bridge === id;
      const t = Date.parse(b.at || (mine ? beat.at : "") || "") || 0, open = Array.isArray(b.open) ? b.open : mine ? [].concat(beat.open || []) : [];
      const bf = LinkRec.folderKey(b.dataFolder || (mine ? beat.dataFolder : "")), at = String(b.computer || info.computer || beat.computer || "").trim().toLowerCase() + "|" + bf;
      if (place && bf && at !== place) return;
      if (o.only && !o.only(d, id)) return;
      // next-link-follow: for reads (o.reads), never a bridge whose reading is stopped (by itself, or from FinCom) or one in test mode
      if (o.reads && ((b.readStopped && typeof b.readStopped === "object") || (info.readStop && typeof info.readStop === "object") || b.mode === "test")) return;
      if (now - t < 180000 && open.some(n => same((n && n.name) || n))) hits.push({dev: d, id, at: t, how: own && id === own ? "own" : d.id === linked ? "linked" : "other"});
    });
  });
  const rank = {own: 0, linked: 1, other: 2};
  const best = hits.sort((a, b) => rank[a.how] - rank[b.how] || b.at - a.at)[0] || null;
  if (best) best.all = new Set(hits.map(h => h.dev.id));   // every computer key serving it (the sign counts them all)
  return best;
}
// a client's line (src/js/49 tallyLine): read from the computer key whose bridge serves the company now (tallyServe), else
// the link's as before; open in none while the firm has more than one computer key: the plain words "Open <company> in
// Tally" (never one Windows login's computer); a company renamed in Tally is open under its new name, not "not open"
const tallyLineOld = typeof tallyLine === "function" ? tallyLine : null;
function tallyLineRec(co){
  const row = co && typeof tallyRowOf === "function" ? tallyRowOf(co, (typeof TLight === "object" && TLight.st.cos) || []) : null;
  const name = row ? LinkRec.nameOf(row.rec) || row.company : "", sv = name ? tallyServe(name, {rec: row.rec, device: row.device_id}) : null;
  let l = tallyLineOld ? tallyLineOld(co, sv && sv.dev) : null;
  if (l && row && !sv && /^(closed|notopen|offline)$/.test(l.state) && tallyPlain(row.device_id)) l = Object.assign({}, l, {text: "Open " + name + " in Tally", plain: true});
  if (!l || l.state !== "notopen" || !LinkRec.ready() || !l.company || l.plain) return l;
  const devs = [].concat((typeof TLight === "object" && TLight.st.devs) || []);
  const open = devs.some(d => { const i = (d && d.info) || {}; return [i.beat && i.beat.open].concat(Object.values(i.bridges || {}).map(b => b && b.open)).some(x => Array.isArray(x) && x.some(n => LinkRec.same(n, l.company))); });
  return open ? Object.assign({}, l, {state: "open", level: "ok", text: "Connected \u00b7 Tally open on " + l.computer + (l.read && typeof tallyHm === "function" ? " \u00b7 last read " + tallyHm(l.read) : "")}) : l;
}
// allow or stop posting into a linked company (the record; the version as this page read it: a change made meanwhile
// elsewhere is refused and read again). true when the cloud took it
async function linkPostingSet(co, rec, on){
  if (!co || !rec) return false;
  try { await TCloud.rpc("tally_link_posting", {p_book: rec.book_id, p_allowed: !!on, p_version: rec.version}); }
  catch (e){
    const m = String((e && e.message) || e);
    toast(/changed by someone else/.test(m) ? "Someone changed " + co.name + "’s Tally link meanwhile: it is read again; look and try again." : "Could not change posting: " + m);
    await LinkRec.again();
    return false;
  }
  await LinkRec.again();
  if (typeof postToFromLink === "function") await postToFromLink(co);
  toast(on ? "Posting allowed into " + LinkRec.nameOf(rec) + "." : "Posting stopped for " + co.name + ".");
  return true;
}
// the link: tally_company_link (through the record on a cloud with 110) as before, then the record read again
(function hookLinkRec(){
  if (typeof TCloud !== "object" || TCloud.linkRecHooked) return;
  TCloud.linkRecHooked = true;
  const restAll = TCloud.restAll, link = TCloud.link;
  TCloud.restAll = async function (path){
    if (!/^tally_companies\?select=/.test(String(path)) || !LinkRec.on()) return restAll.call(this, path);
    const p = /[=,]book_id(,|&|$)/.test(path) ? path : String(path).replace("tally_companies?select=", "tally_companies?select=book_id,");
    const [rows] = await Promise.all([restAll.call(this, p), LinkRec.load()]);
    return LinkRec.overlay(rows);
  };
  // (the record only: the caller, tallyLinkClient, marks the rows and asks TLight to read again itself)
  TCloud.link = async function (company, client){
    const ok = await link.call(this, company, client);
    await LinkRec.load(true);
    return ok;
  };
  // what was read before this file came: laid over once the record is in
  LinkRec.load(true).then(() => { if (!LinkRec.ready()) return;
    [(typeof TLight === "object" && TLight.st.cos) || null, (TCloud.pane && TCloud.pane.companies) || null].forEach(l => LinkRec.overlay(l));
    if (typeof TLight === "object") TLight.st.at = 0;
    if (typeof render === "function") render(); }, () => {});
})();
// next-tally-read-any (re-review of part A): READING follows the company (tallyServe), but POSTING is unchanged until
// migration 142 is decided: a posting still goes to the poster's own target bridge, so whether Post is offered and enabled
// is the sign by the old rule (src/js/49 tallySignNow(co, old)), steady as tallySign is (connected at once, not connected
// once it held a minute). asstEntries' postGate, the Post line (src/js/97 postStatusFor) and postThroughWords ask this
// part B (the owner, 06-Nov-2026: postings go to whichever login has the company open): only once FinCom's cloud has
// migration 142, which tally_post_any_bridge() answering true says (asked once a page, again every 10 minutes while it
// is not; no such function, an error, offline, or not asked yet: no). Until then the posting's old rule stands
const TallyCap = {any: false, at: 0, busy: false};
function tallyPost142(){
  if (TallyCap.any) return true;
  if (!TallyCap.busy && Date.now() - TallyCap.at > 600000 && typeof TCloud === "object" && typeof TCloud.on === "function" && TCloud.on() && typeof TCloud.rpc === "function"){
    TallyCap.busy = true; TallyCap.at = Date.now();
    Promise.resolve().then(() => TCloud.rpc("tally_post_any_bridge", {}))
      .then(v => { TallyCap.any = v === true; if (TallyCap.any && typeof render === "function") render(); }, () => {})
      .then(() => { TallyCap.busy = false; });
  }
  return false;
}
function tallyPostSign(co){
  // 142 here: a posting goes to whichever bridge serves the company, so Post follows the reading sign
  if (tallyPost142()) return tallySign(co);
  const raw = tallySignNow(co, true);
  return TallySteady.step("post:" + (co ? co.id : ""), raw, raw.on ? "on:" + (raw.through || []).join(",") : "off:" + raw.code + ":" + (raw.computer || ""), !!raw.on);
}
// the Clients page's Tally column (src/js/49 TLight.work): each company's state from the computer key serving it now
(function hookServeWork(){
  if (typeof TLight !== "object" || typeof TLight.work !== "function" || TLight.workServed) return;
  const work = TLight.work; TLight.workServed = true;
  TLight.work = function (cos, devs, now){
    return work.call(this, [].concat(cos || []).map(c => { const sv = c && c.company ? tallyServe(LinkRec.nameOf(c.rec) || c.company, {rec: c.rec, device: c.device_id}) : null;
      return sv && sv.dev.id !== c.device_id ? Object.assign({}, c, {device_id: sv.dev.id}) : c; }), devs, now);
  };
})();
// PART B (posting; needs migration 142 live): the bridge a posting goes through, as the Post confirm says it (src/js/49
// TCloud.postThrough). The poster has no bridge of their own with the company open: the bridge that serves it now among
// the bridges a posting may go through (TCloud.postTargets(): 2.x, may post, not changes only), as 142's
// tally_post_enqueue_to queues it. Only once 142 is in the cloud (tallyPost142); until then exactly as before (the words
// of no bridge of your own)
(function hookServePost(){
  if (typeof TCloud !== "object" || typeof TCloud.postThrough !== "function" || TCloud.postServed) return;
  const through = TCloud.postThrough; TCloud.postServed = true;
  TCloud.postThrough = function (co){
    const r = through.call(this, co);
    if (r || !co || this.pane.noTarget || !tallyPost142()) return r;
    const company = typeof this.companyOf === "function" ? this.companyOf(co.id) : "", ts = this.postTargets() || [];
    const sv = company ? tallyServe(company, {only: (d, id) => ts.some(x => x.id === id && x.device && x.device.id === d.id)}) : null;
    return sv ? ts.find(x => x.id === sv.id && x.device && x.device.id === sv.dev.id) || null : null;
  };
})();
if (typeof globalThis === "object") Object.assign(globalThis, {LinkRec, linkPostOf, linkPostingSet, postToProblem: postToProblemRec, tallyCoName: tallyCoNameRec, tallyLine: tallyLineRec, tallyServe, tallyPlain, tallyPostSign, TallyCap, tallyPost142});
/* @react-lazy: end */
