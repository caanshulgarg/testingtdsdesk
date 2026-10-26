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
  PCOLS: "book_id,data_loc,data_folder,computer,windows_user,tally_port,state,last_seen",
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
  twoPlaces(r){ return this.placesOf(r).some(x => x.state === "waiting"); },
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
// a client's line (src/js/49 tallyLine): a company renamed in Tally is open under its new name, not "not open"
const tallyLineOld = typeof tallyLine === "function" ? tallyLine : null;
function tallyLineRec(co){
  const l = tallyLineOld ? tallyLineOld(co) : null;
  if (!l || l.state !== "notopen" || !LinkRec.ready() || !l.company) return l;
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
if (typeof globalThis === "object") Object.assign(globalThis, {LinkRec, linkPostOf, linkPostingSet, postToProblem: postToProblemRec, tallyCoName: tallyCoNameRec, tallyLine: tallyLineRec});
/* @react-lazy: end */
