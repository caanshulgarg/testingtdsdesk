/* @react-lazy: begin 98-prefetch-books.js (the React app loads this file with FirstOpen once the firm is signed in: app/src/lib/firstOpen.js, through window.loadFirstOpen from src/js/27's startCloudSync2; build.py react_parts) */
/* ================================================================== */
/* The clients' books brought into this browser right after sign-in    */
/* ================================================================== */
// The owner, 26-Oct-2026: "Every new browser sign-up loads complete books.. it takes time.. can we have it just after
// login.. not after clicking on the part where books required.. so that no latency." Then: "dont write anything at the
// bottom sidebar.. just do it at the earliest".
// A browser with no copy (a new one, or after signing out) brought a client's books in only when the client was opened:
// its day files, ledgers and entries from FinCom's cloud (TCloud.load, src/js/49, through FirstOpen, src/js/95) and its
// TDS/GST work (BookItems, src/js/54). Now, as soon as the firm is signed in and its client list is known (each start of
// the app while signed in too), the clients' books are brought into this browser's own stores behind the page, with the
// same reads and the same functions an opening uses, into the same places (books:<cid>, tcday:<book>:<day>,
// bookitems:<cid>), so an opening later finds them and only checks for changes. Nothing is shown or said.
//   - which: this person's recent clients here first (tdsdesk:recent, kept per person: LocalOwner), then the firm's other
//     clients by their books' last change (tally_books.days_at); every client when the firm has 15 or fewer, else 10;
//   - never in the way: after the first page is drawn; one client at a time, one request at a time; before each request
//     the gate waits while the person opens a client, saves, has just clicked or typed, or the work of every client is
//     being brought in (DueList.syncAll); a client the person opens while it is being brought in is finished at once
//     (rush: the opening waits for it, then opens from the store: nothing fetched twice);
//   - stops: a connection that saves data or is 2g; the tab hidden for a minute (carries on when shown again); this
//     browser's storage over 70% full; signed out or another person;
//   - reads only: nothing is sent to the cloud, nothing marked synced but what an opening marks (BookItems.take), the open
//     books (S.books) never touched, saved with fromCloud (never sent); a staff member's reads are refused by the database
//     (row-level security) for a client they may not read, and nothing more is asked for it;
//   - what only the open books work out (Tally's challans and tags, the payroll's carry, the drift of filed returns) is done
//     on the client's first opening (meta.pre, TCloud.load);
//   - measured: the timings' kinds prefetch/<step> (app/src/lib/timings.js; Prefetch.mark set by app/src/lib/firstOpen.js).
const Prefetch = {
  MAX_ALL: 15, MOST: 10, HIDDEN_MS: 60000, FULL: 0.7, INPUT_MS: 1000, WAIT: 200,
  running: false, cur: "", curP: null, rushing: "", stopped: "", who: "", firm: "", p: null, input: 0, hiddenAt: 0, paused: 0, n: 0,
  mark(){},
  slow(){ const c = typeof navigator === "object" && navigator.connection; return !!(c && (c.saveData || /(^|-)2g$/.test(String(c.effectiveType || "")))); },
  async full(){ try { const e = await navigator.storage.estimate(); return !!(e && e.quota > 0 && e.usage / e.quota > this.FULL); } catch (e){ return false; } },
  uid(){ return ((typeof Cloud === "object" && Cloud.sess()) || {}).user_id || ""; },
  on(){ return typeof Cloud === "object" && Cloud.on() && !!Cloud.st.firm && !Cloud.st.mfa && !LocalOwner.stale && typeof TCloud === "object" && TCloud.on(); },
  ok(){ return this.on() && this.uid() === this.who && Cloud.st.firm === this.firm; },
  // the person is doing something: a client opening, a save, a click or key a moment ago, every client's work coming in
  inWay(){
    if (Date.now() - this.input < this.INPUT_MS) return true;
    if (typeof booksOpening !== "undefined" && booksOpening) return true;
    const b = S.books;
    if ((b && (b.loading || b.busy || b.catchUp)) || S.loadingCo || TCloud.opens > 0) return true;
    if ((typeof Live === "object" && Live.sv.state === "saving") || (typeof cloudBusy !== "undefined" && cloudBusy)) return true;
    if (typeof DueList === "object" && DueList.busy) return true;
    return typeof BookItems === "object" && Object.values(BookItems.st).some(s => s && s.timer);
  },
  halt(why){ this.stopped = why; if (this.p) this.p.stop = true; const e = new Error("prefetch stopped: " + why); e.prefetch = true; throw e; },
  // before each request: stopped, or waiting while the person is doing something (never for the client they wait for)
  async gate(){
    for (let t = 0; ; t += this.WAIT){
      if (!this.ok()) this.halt("signed out");
      if (this.slow()) this.halt("slow");
      if (typeof document === "object" && document.visibilityState === "hidden"){ this.hiddenAt = this.hiddenAt || Date.now(); if (Date.now() - this.hiddenAt > this.HIDDEN_MS) this.halt("hidden"); }
      else this.hiddenAt = 0;
      if ((this.rushing && this.rushing === this.cur) || !this.inWay()){ this.paused += t; return; }
      await new Promise(ok => setTimeout(ok, this.WAIT));
    }
  },
  // a client being brought in, opened by the person: finished now, without waiting for anything
  rush(cid){ if (this.cur !== cid || !this.curP) return Promise.resolve(); this.rushing = cid; return this.curP; },
  // the clients in order: recent (this person's, here) first, then by the books' last change; 15 or fewer all, else 10
  order(cos, recent, books){
    const at = {};
    (books || []).forEach(r => { if (r && r.client_id && String(r.days_at || "") > (at[r.client_id] || "")) at[r.client_id] = String(r.days_at || ""); });
    const ids = (cos || []).map(c => c.id), rec = [...new Set((recent || []).filter(id => ids.includes(id)))];
    const all = rec.concat(ids.filter(id => !rec.includes(id)).sort((a, c) => (at[c] || "").localeCompare(at[a] || "")));
    return all.length <= this.MAX_ALL ? all : all.slice(0, this.MOST);
  },
  // the first page drawn first (the frame drawn before the program gone, as main.jsx's firstPage looks for it; 10 s at most)
  drawn(){ return new Promise(ok => { const t0 = Date.now(), go = () => setTimeout(ok, 0), look = () => (!document.querySelector("[data-boot-part]") || Date.now() - t0 > 10000 ? (document.hidden ? go() : requestAnimationFrame(go)) : setTimeout(look, 100)); look(); }); },
  async start(){
    if (this.running || !this.on()) return;
    if (this.slow()){ this.stopped = "slow"; return; }
    this.running = true; this.stopped = ""; this.who = this.uid(); this.firm = Cloud.st.firm; this.paused = 0; this.n = 0;
    const t0 = performance.now();
    let why = "done";
    try {
      await this.drawn();
      await this.gate();
      if (await this.full()) return void (why = "full");
      let books = [];
      try { books = await TCloud.restPages("tally_books?select=client_id,days_at"); } catch (e){ books = []; }
      const list = this.order(Object.values(S.companies || {}).filter(c => c && !c.deleted), typeof recentIds === "function" ? recentIds() : [], books);
      this.mark("prefetch/start", performance.now() - t0, {q: list.length});
      for (const cid of list){
        if (await this.full()){ why = "full"; break; }
        await this.one(cid);
      }
    } catch (e){ why = (e && e.prefetch && this.stopped) || "error"; }
    finally {
      this.running = false; this.cur = ""; this.p = null;
      this.mark("prefetch/all", performance.now() - t0, {q: this.n});
      this.mark("prefetch/paused", this.paused, {});
      if (why !== "done") this.mark("prefetch/stop-" + why, performance.now() - t0, {});
    }
  },
  async one(cid){
    const co = S.companies[cid];
    if (!co || (S.books && S.books.cid === cid)) return;           // the open client: its opening brings it in
    let done; this.curP = new Promise(ok => { done = ok; }); this.cur = cid;
    const t = performance.now();
    try {
      const it = await this.items(cid), bk = await this.books(cid, co);
      if (it || bk){ this.n++; this.mark("prefetch/client", performance.now() - t, {}); }
    } catch (e){ if (e && e.prefetch) throw e; this.last = cid + ": " + ((e && e.message) || e); this.mark("prefetch/failed", performance.now() - t, {}); }
    finally { this.cur = ""; this.rushing = ""; this.p = null; done(); }
  },
  // the TDS/GST work: from the start, as an opening does (BookItems.pullNow's read and take; nothing sent, no heal)
  async items(cid){
    if (!(typeof BookItems === "object" && BookItems.on())) return false;
    const t = performance.now();
    const n = await BookItems.queue(cid, async () => {
      const s = await BookItems.state(cid);
      if (s.seq) return -1;
      await this.gate();
      const rows = await BookItems.fetch(cid, 0);
      await this.gate();
      if (rows.length) await BookItems.take(cid, rows, {first: true, cursor: true});
      return rows.length;
    });
    if (n >= 0) this.mark("prefetch/items", performance.now() - t, {q: n});
    return n > 0;
  },
  // the books from FinCom's cloud: TCloud.load on a books object of this client (not the open one), saved as it saves them
  async books(cid, co){
    let held = null; try { held = await IDBStore.get("books:" + cid); } catch (e){ held = null; }
    // books here already (brought in before, or a Day Book read here): the opening checks them for changes
    if (held && held.cid === cid && ((held.meta && held.meta.cloud) || (held.vouchers || []).length)) return false;
    await this.gate();
    const t = performance.now();
    await TCloud.status(cid, true);
    if (!TCloud.has(cid) || (S.books && S.books.cid === cid && this.rushing !== cid)) return false;
    const saved = await Books.load(cid), b = saved && saved.cid === cid ? clone(saved) : {cid};
    this.p = {b, co, gate: () => this.gate(), stop: false};
    const r = await TCloud.load(false, false, this.p);
    if (r === "big"){ await this.gate(); await saveBooks({fromCloud: true}, b); }
    this.mark("prefetch/books", performance.now() - t, {q: (b.vouchers || []).length});
    return !!r;
  }
};
if (typeof document === "object"){
  const used = () => { Prefetch.input = Date.now(); };
  document.addEventListener("pointerdown", used, {capture: true, passive: true});
  document.addEventListener("keydown", used, {capture: true, passive: true});
  // stopped for a hidden tab: carries on when it is shown again
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Prefetch.stopped === "hidden") Prefetch.start(); });
}
if (typeof globalThis === "object") Object.assign(globalThis, {Prefetch});
/* @react-lazy: end */
