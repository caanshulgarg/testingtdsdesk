/* @react-lazy: begin 95-first-open.js (the React app loads this file when a client's books first come into this browser: app/src/lib/firstOpen.js, window.loadFirstOpen; build.py react_parts) */
/* ================================================================== */
/* A client's books brought into this browser for the first time      */
/* ================================================================== */
// The owner, 25-Oct-2026: "start faster first open". Opening Leads Insurance on a computer for the first time (or after
// the browser's copy was cleared) downloaded its 560 day files (6.2 MB packed, 55 MB of Tally text) and showed nothing
// of the books until every one was read: 2.5 minutes on the owner's line (staging, 24-Oct 10:14-10:16 UTC), 36 s on the
// Leads stand (tests/leads_stand.py) at 4x CPU. Where it went: each day file read from this browser's store and written
// to it one by one as 55 MB of text (16 s for the files where the line needs 5.5 s), every entry of the cloud copy read in
// full (2.8 MB) before the first day file, and every month read only after the last day came. Now (TCloud.load, src/js/49,
// hands the first opening here and puts what comes back into the books as before):
//   - the days are fetched newest first, sixteen at a time, and kept packed as they came, many to a write;
//   - each month is read as soon as its last day is in, while the older days are still coming;
//   - the latest financial year with entries is shown as soon as its months are read (b.firstOpen: the Books pages say
//     "Books: 2026-27 ready · loading 2025-26…"; the pages that need the older years wait for them, the TDS and GST
//     pages of that year show at once);
//   - the cloud copy's entries are checked by GUID and AlterID beside the days, and only the entries whose version is not
//     the one in the day files are read in full (the check TCloud.copyHeads makes on a reopening);
//   - the ledger list is read once, beside the days.
// The books are then made from the same months, ledgers and entries the way TCloud.load always made them, so they end
// exactly as a load without this file (tests/run_books_speed.py compares the two).
const FirstOpen = {
  WORKERS: 16, MONTHS: 6, noPack: false,
  fyStart(d8){ const y = +String(d8).slice(0, 4), m = +String(d8).slice(4, 6); return m < 4 ? y - 1 : y; },
  fyLabel(y){ return y + "-" + String(y + 1).slice(2); },
  // the days a first opening cut short kept here (their keys only; a day is read from the store only when kept)
  async keptKeys(book){
    try {
      const db = await IDBStore.ready(), p = "tcday:" + book + ":";
      return await new Promise(ok => { const q = db.transaction("docs").objectStore("docs").getAllKeys(IDBKeyRange.bound(p, p + "￿")); q.onsuccess = () => ok(new Set(q.result || [])); q.onerror = () => ok(new Set()); });
    } catch (e){ return new Set(); }
  },
  async fetchDay(book, d){
    await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), url = c.url.replace(/\/+$/, "") + "/storage/v1/object/authenticated/tally-days/" + Cloud.st.firm + "/" + book + "/" + d.slice(0, 6) + "/" + d + ".xml.gz";
    const get = () => fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token}, cache: "no-store"});
    let r = await get();
    if (r.status === 401 || r.status === 400){ await Cloud.refreshToken(Cloud.sess().access_token); r = await get(); }
    if (r.status === 404) return "";
    if (!r.ok) throw new Error("Could not fetch " + d + " from the cloud (" + r.status + ").");
    return r.arrayBuffer();
  },
  // a month of day files in one answer (tally-ingest month_days); unpack: FirstOpen.unpack, set by app/src/lib/firstOpen.js
  // from server/tally-cloud/monthpack.js (the server's own rule). A server without it answers 404 (no such client)
  async fetchMonth(book, ym){
    await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), go = () => fetch(TCloud.ingestUrl(), {method: "POST", cache: "no-store",
      headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token, "Content-Type": "application/json"}, body: JSON.stringify({kind: "month_days", book, month: ym})});
    let r = await go();
    if (r.status === 401){ await Cloud.refreshToken(Cloud.sess().access_token); r = await go(); }
    if (!r.ok || !/octet-stream/.test(r.headers.get("content-type") || "")) throw new Error("FinCom's server gave no month of day files (" + r.status + ").");
    return this.unpack(await r.arrayBuffer());
  },
  // the ledger list as TCloud.load reads it (with the TDS settings, then without them, then without PAN and GSTIN)
  async ledgers(bk){
    const q = cols => TCloud.restAll("tally_ledgers?select=" + cols + "&merged_into=is.null&order=name&book_id=eq." + bk.book);
    try { return await q("name,parent,open,pan,gstin,tds_nature,tds_special_rate,tds_ldc"); }
    catch (e0){
      if (!/tds_|42703|PGRST204|does not exist/i.test(String((e0 && e0.message) || e0))) throw e0;
      try { return await q("name,parent,open,pan,gstin"); }
      catch (e){ if (!/pan|gstin|42703/i.test(String((e && e.message) || e))) throw e; return q("name,parent,open"); }
    }
  },
  // the cloud copy's entries in brief (GUID, AlterID, deleted, the AlterID of Tally's TDS details), and the newest line
  // applied before they were read (TCloud.copyHeads)
  async thin(bk){
    const B = "&book_id=eq." + encodeURIComponent(bk.book);
    let last = [];
    try { last = await Cloud.api("tally_recorder_lines?select=applied_at&state=eq.applied&applied_at=not.is.null" + B + "&order=applied_at.desc&limit=1") || []; } catch (e){ last = []; }
    const rows = await TCloud.restPages("tally_vouchers?select=guid,alter_id,deleted_at,tds_tally_alter_id" + B + "&order=guid.asc");
    return {newest: (last[0] || {}).applied_at || "", rows};
  },
  // the entries of the cloud copy the books take (TCloud.copyHeads' check on a reopening, against the entries of the day
  // files read here): deleted ones held, new or later ones, and the ones whose Tally TDS details are not here yet, read in full
  async copyFor(b, bk, res, months, thinP){
    if (/^Zoho Books · /.test(String(bk.company || ""))) return TCloud.copyHeads(b, bk, true);
    const t = await thinP;
    if (!t) return TCloud.copyHeads(b, bk, true);
    const held = new Map();
    months.slice().sort().forEach(ym => ((res[ym] || {}).vouchers || []).forEach(v => { if (v && v.id) held.set(v.id, v); }));
    const alt = x => BookSrc.alt(x), want = t.rows.filter(h => {
      if (!h || !h.guid) return false;
      const v = held.get(h.guid) || null;
      if (h.deleted_at) return !!v;
      if (BookSrc.wins(h.alter_id, v)) return true;
      return !!v && !v.tdsx && v.alt != null && v.alt !== "" && h.tds_tally_alter_id != null && h.tds_tally_alter_id !== "" && alt(v.alt) === alt(h.alter_id) && alt(h.tds_tally_alter_id) === alt(h.alter_id);
    }).map(h => String(h.guid));
    const B = "&book_id=eq." + encodeURIComponent(bk.book), cols = [BookSrc.HEADS_TDS, BookSrc.HEADS_GST, BookSrc.HEADS, BookSrc.HEADS_OLD];
    const read = async (extra) => {
      for (let i = 0; ; i++){
        try { return await TCloud.restPages("tally_vouchers?select=" + cols[i] + B + extra + "&order=guid.asc"); }
        catch (e){ if (i === cols.length - 1 || !(/42703|PGRST204|does not exist/i.test(String((e && e.message) || e) + " " + String((e && e.code) || "")))) throw e; }
      }
    };
    let heads = [];
    for (let i = 0; i < want.length; i += 40) heads = heads.concat(await read("&guid=in.(" + want.slice(i, i + 40).map(x => encodeURIComponent('"' + x + '"')).join(",") + ")"));
    return {heads, seen: t.newest, changes: heads.length > 0, daysAt: bk.daysAt || "", fullAt: new Date().toISOString()};
  },
  // the progress line on the Books pages, changed in place (a full drawing of the TDS page for each day would cost more
  // than the day itself)
  tell(st, text){
    st.text = text;
    try { document.querySelectorAll("[data-first-open]").forEach(el => { el.textContent = text; }); } catch (e){}
  },
  // the latest year shown: its months, the ledgers and their groups put into the books as TCloud.load puts them; nothing
  // kept, sent or worked out over the whole books (that comes once every year is in)
  async preview(o, st, led, list){
    const {b, bk, from, to, say} = o;
    if (led){ TallyRead.balances(b, {ledgers: led.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, from, to); b.tb.src = "copy"; BookSrc.ledgersInto(b, led, bk.ledgersAt); }
    try { await TCloud.groupsInto(b, bk.book); await TCloud.naturesInto(b, bk.book); } catch (e){}
    st.mapBefore = JSON.stringify(b.map || {});
    b.vouchers = (b.vouchers || []).filter(v => v && v.src !== "bridge");
    list.sort((x, y) => x[0] < y[0] ? -1 : 1).forEach(([ym, res]) => {
      const m = TallyRead.months(ym + "01", to).find(z => z.ym === ym) || {from: ym + "01", to: ym + "31"};
      // a copy of the month's entries: the drawings of these pages never touch the ones the books are made from
      TallyRead.merge(b, {vouchers: structuredClone(res.vouchers || []), meta: res.meta || {}}, m.from < from ? from : m.from, m.to);
    });
    if (b.tb && String(b.tb.to) < to) b.tb.to = to;
    b.map = Books.mapLedgers(b.vouchers || [], b.map); try { LedMaster.refresh(b); } catch (e){}
    st.mapShown = JSON.stringify(b.map);
    if (typeof BOOKS_REV === "number") BOOKS_REV++;
    LK.cache = {}; st.ready = true; st.readyAt = Date.now();
    say("");
  },
  // {res: {ym: the month read}, copy, led}, for TCloud.load to put into the books
  async run(o){
    const {b, bk, byMonth, todo, say} = o, book = bk.book, meta = b.meta = b.meta || {};
    meta.fo = book;
    const months = todo.slice().sort().reverse();
    const all = [].concat(...months.map(ym => byMonth[ym]));
    const lastIn = all.filter(x => +x.n > 0).map(x => x.day).sort().pop() || all.map(x => x.day).sort().pop() || "";
    const fy = this.fyStart(String(lastIn).replace(/-/g, "")), recent = months.filter(ym => ym >= fy + "04"), older = months.filter(ym => ym < fy + "04");
    const oldFy = older.length ? this.fyStart(older[older.length - 1] + "01") : fy;
    const oldLabel = oldFy === fy - 1 ? this.fyLabel(fy - 1) : this.fyLabel(oldFy) + " to " + this.fyLabel(fy - 1);
    const st = b.firstOpen = {book, fy: this.fyLabel(fy), older: oldLabel, ready: false, text: "Books: coming in from FinCom's cloud…", at: Date.now()};
    // the newest days first; within a month, its days in any order (a month is read once all of them are in)
    const want = [].concat(...months.map(ym => byMonth[ym].slice().sort((x, y) => x.day < y.day ? 1 : -1)));
    const nRecent = [].concat(...recent.map(ym => byMonth[ym])).length;
    const ledP = this.ledgers(bk);
    ledP.catch(() => {});
    const thinP = this.thin(bk).catch(() => null);
    const kept = await this.keptKeys(book);
    const z = {}, res = {}, left = {}, fin = {}, ready = {};
    months.forEach(ym => { left[ym] = byMonth[ym].length; ready[ym] = new Promise((ok, no) => { fin[ym] = [ok, no]; }); ready[ym].catch(() => {}); });
    let chain = Promise.resolve(), failed = null, writes = [], wq = Promise.resolve(), got = 0, next = 0;
    const flush = () => { if (!writes.length) return; const w = writes; writes = []; wq = wq.then(() => IDBStore.write(w)).catch(() => {}); };
    const readMonth = ym => {
      chain = chain.then(async () => {
        if (failed) return;
        const parts = await Promise.all(byMonth[ym].map(x => { const v = z[x.day]; return typeof v === "string" ? v : v ? TCloud.unzip(v) : ""; }));
        byMonth[ym].forEach(x => { delete z[x.day]; });
        const r = await Books.importDayBook(new Blob(["<ENVELOPE>" + parts.join("") + "</ENVELOPE>"], {type: "text/xml"}));
        const bad = notThisClient((r.meta || {}).gstins);
        if (bad.length) throw new Error(panRefusal("The company in the cloud copy", bad));
        res[ym] = r; fin[ym][0]();
      }).catch(e => { failed = failed || e; months.forEach(m => fin[m][1](e)); });
    };
    const progress = () => {
      if (!st.ready){ if (got % 10 === 0 || got === want.length) say("Bringing in " + st.fy + " from FinCom's cloud: " + Math.min(got, nRecent) + " of " + nRecent + " days…"); return; }
      if (got % 5 === 0 || got === want.length) this.tell(st, "Books: " + st.fy + " ready · loading " + st.older + " (" + (got - nRecent) + " of " + (want.length - nRecent) + " days)…");
    };
    // a day in: kept (packed, many to a write), and its month read once its last day is in
    const take = (x, v, keep) => {
      if (keep && v) { writes.push(["tcday:" + book + ":" + x.day, {at: x.at, gz: v}]); if (writes.length >= 40) flush(); }
      z[x.day] = v; got++;
      const ym = x.day.slice(0, 6);
      if (--left[ym] === 0) readMonth(ym);
      progress();
    };
    const oneDay = async (x) => {
      const k = "tcday:" + book + ":" + x.day;
      if (kept.has(k)){ try { const w = await IDBStore.get(k); if (w && w.at === x.at) return take(x, w.gz || w.text || "", false); } catch (e){} }
      take(x, await this.fetchDay(book, x.day), true);
    };
    const one = async () => { while (next < want.length && !failed) await oneDay(want[next++]); };
    // a month in one answer from FinCom's server (tally-ingest month_days, server/tally-cloud/monthpack.js): a day whose
    // version is not the one tally_days_list gave (changed meanwhile), or not in the answer, is fetched by itself
    let mnext = 0;
    const oneMonth = async (first) => {
      while (mnext < months.length && !failed){
        const ym = months[mnext++];
        let pack = null;
        try { pack = mnext === 1 && first ? first : await this.fetchMonth(book, ym); } catch (e){ pack = null; }
        const by = new Map((pack || []).map(p => [p.day, p]));
        await Promise.all(byMonth[ym].map(x => { const p = by.get(x.day); return p && p.at === x.at && !kept.has("tcday:" + book + ":" + x.day) ? take(x, p.gz || "", true) : oneDay(x); }));
      }
    };
    // the latest year shown once its months are read (when there is an older one to wait for)
    const shown = older.length && recent.length ? Promise.all(recent.map(ym => ready[ym])).then(async () => {
      const led = await ledP;
      if (!failed) await this.preview(o, st, led, recent.map(ym => [ym, res[ym]]));
      this.tell(st, "Books: " + st.fy + " ready · loading " + st.older + "…");
      render();
    }) : Promise.resolve();
    shown.catch(() => {});
    try {
      // the newest month asked of FinCom's server in one answer: when it answers, every month so; else (a server without
      // month_days) the days one by one, sixteen at a time
      let first = null;
      if (!this.noPack && months.length) try { first = await this.fetchMonth(book, months[0]); } catch (e){ this.noPack = true; }
      try {
        if (first) await Promise.all(Array.from({length: Math.min(this.MONTHS, months.length)}, (_, i) => oneMonth(i === 0 ? first : null)));
        else await Promise.all(Array.from({length: Math.min(this.WORKERS, want.length)}, one));
      } catch (e){ failed = failed || e; }
      flush();
      await chain;
      if (failed) throw failed;
      await shown;
      if (st.ready) this.tell(st, "Books: " + st.fy + " ready · putting " + st.older + " in…");
      const [led, copy] = await Promise.all([ledP, this.copyFor(b, bk, res, months, thinP)]);
      // the ledgers' kinds as they were before the latest year was shown, unless someone changed one meanwhile (the
      // books then work them out from every entry, as always)
      if (st.mapShown && JSON.stringify(b.map) === st.mapShown) b.map = JSON.parse(st.mapBefore);
      await wq;
      return {res, copy, led};
    } catch (e){
      st.failed = String((e && e.message) || e);
      this.tell(st, "Books: " + (st.ready ? st.fy + " ready · " : "") + "the rest could not be brought in (" + st.failed.replace(/[.\s]+$/, "") + "). Open the client again to carry on.");
      throw e;
    }
  }
};
if (typeof globalThis === "object") Object.assign(globalThis, {FirstOpen});
/* @react-lazy: end */
