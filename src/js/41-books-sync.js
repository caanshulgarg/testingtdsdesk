/* ================================================================== */
/* Books sync: each client's TDS and GST work in the firm's database  */
/* ================================================================== */
// Before this, challans, allocations, certificates, 2B, returns filed and every other piece of TDS and GST work lived
// only in the browser that did it. Now that work (the "work" part of the books) is kept in Supabase, in the table
// client_books, one row per client, with a revision number:
//   - every save says which revision it was built on; the database refuses a save built on an old one;
//   - a refused save is merged, three ways, against what the other person saved: changes to different things are both
//     kept; where both changed the same thing, the database's copy stays and this browser's copy is kept in
//     client_books_history (note "conflict"), so nothing is lost;
//   - every earlier revision is kept in client_books_history.
// What is read from Tally (the day book, masters, balances) stays in this browser: it can be read again at any time.
// If the database does not have client_books yet (migration not applied), the books work as before, in this browser.
const BookSync = {
  PART: "work",
  // read from Tally and worked out from it again at any time: not sent
  FROM_TALLY: ["vouchers", "meta", "under", "states", "groups", "groupInfo", "ledInfo", "ledInfoAt", "tb", "mis"],
  st: {},            // cid -> {rev, base, timer, busy, again, error, at, by, readonly}
  off: false,        // the database has no client_books: work only in this browser
  wait: 1500,
  keys(){ return BOOKS_KEYS.filter(k => this.FROM_TALLY.indexOf(k) < 0); },
  of(cid){ return this.st[cid] || (this.st[cid] = {rev: null, base: null}); },
  on(){ return !this.off && typeof Cloud === "object" && Cloud.on() && !!Cloud.st.firm; },
  // the work part of a client's books, as plain data (no undefined, so it compares the same after a round trip)
  work(b){ const w = {}; this.keys().forEach(k => { if (b && b[k] !== undefined) w[k] = b[k]; }); return JSON.parse(JSON.stringify(w)); },
  same(a, b){ return stableStr(a === undefined ? null : a) === stableStr(b === undefined ? null : b); },
  /* ---------- what this browser last agreed with the database ---------- */
  async loadBase(cid){
    const s = this.of(cid);
    if (s.rev !== null) return s;
    try { const m = await IDBStore.get("booksync:" + cid); if (m){ s.rev = m.rev; s.base = m.base; } } catch (e){}
    if (s.rev === null){ s.rev = 0; s.base = {}; }
    return s;
  },
  async keepBase(cid, rev, base){
    const s = this.of(cid); s.rev = rev; s.base = base;
    try { await IDBStore.write([["booksync:" + cid, {rev, base, at: new Date().toISOString()}]]); } catch (e){}
  },
  /* ---------- three-way merge ---------- */
  // base: what both started from; mine: this browser; theirs: the database. Returns the merged value;
  // every place both changed differently is added to `clash` (the database's value is kept there).
  merge(base, mine, theirs, path, clash){
    if (this.same(mine, theirs)) return mine;
    if (this.same(base, mine)) return theirs;
    if (this.same(base, theirs)) return mine;
    const obj = v => v && typeof v === "object" && !Array.isArray(v);
    const byId = v => Array.isArray(v) && v.every(x => x && typeof x === "object" && typeof x.id === "string" && x.id);
    if (obj(mine) && obj(theirs)){
      const b = obj(base) ? base : {}, out = {};
      new Set(Object.keys(theirs).concat(Object.keys(mine))).forEach(k => {
        const v = this.merge(b[k], mine[k], theirs[k], path.concat(k), clash);
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    if (byId(mine) && byId(theirs) && (base === undefined || byId(base))){
      const map = a => { const m = {}; (a || []).forEach(x => { m[x.id] = x; }); return m; };
      const B = map(base), M = map(mine), T = map(theirs), out = [];
      const ids = theirs.map(x => x.id).concat(mine.map(x => x.id).filter(id => !(id in T)));
      ids.forEach(id => { const v = this.merge(B[id], M[id], T[id], path.concat(id), clash); if (v !== undefined) out.push(v); });
      return out;
    }
    clash.push(path.join(" › ") || "(all)");
    return theirs;
  },
  /* ---------- the database ---------- */
  async rpc(fn, args){ return Cloud.api("rpc/" + fn, {method: "POST", body: args}); },
  missing(e){ return /save_client_books|client_books|keep_books_conflict|PGRST202|PGRST205|schema cache|does not exist|404/i.test(String(e && e.message || e)); },
  async fetch(cid){
    const rows = await Cloud.api("client_books?select=rev,data,updated_at,updated_by&client_id=eq." + encodeURIComponent(cid) + "&part=eq." + this.PART);
    return rows && rows[0] ? rows[0] : null;
  },
  // put what came back into the open books (and this browser's copy)
  async apply(cid, data){
    const keys = this.keys();
    if (S.books && S.books.cid === cid){
      keys.forEach(k => { if (data[k] === undefined) delete S.books[k]; else S.books[k] = clone(data[k]); });
      if (S.books.vouchers && S.books.vouchers.length) try { LedMaster.refresh(S.books); } catch (e){}
      await saveBooks({fromCloud: true});
      render();
    } else {
      const saved = (await Books.load(cid)) || {cid};
      keys.forEach(k => { if (data[k] === undefined) delete saved[k]; else saved[k] = data[k]; });
      await Books.save(cid, saved);
    }
  },
  async localWork(cid){
    if (S.books && S.books.cid === cid && !S.books.loading) return this.work(S.books);
    const saved = await Books.load(cid);
    return saved ? this.work(saved) : null;
  },
  who(uid){ const m = ((Cloud.st && Cloud.st.members) || []).find(x => x.user_id === uid); return m ? (m.name || m.email) : "someone else"; },
  tell(cid, clash, by){
    if (!clash.length) return;
    const co = S.companies[cid], name = co ? co.name : cid;
    toast(name + ": " + this.who(by) + " changed the same TDS/GST items you did (" + clash.slice(0, 3).join("; ") + (clash.length > 3 ? " and " + (clash.length - 3) + " more" : "") +
      "). Their version is kept; yours is saved in the history.");
  },
  /* ---------- sending ---------- */
  schedule(cid){
    if (!this.on() || !cid) return;
    const s = this.of(cid);
    clearTimeout(s.timer);
    s.timer = setTimeout(() => this.push(cid), this.wait);
  },
  async push(cid){
    if (!this.on()) return;
    const s = this.of(cid);
    if (s.busy){ s.again = true; return; }
    if (s.readonly) return;
    s.busy = true; s.error = "";
    try {
      await this.loadBase(cid);
      for (let round = 0; round < 4; round++){
        const mine = await this.localWork(cid);
        if (!mine || (s.rev === 0 && !Object.keys(mine).length)) break;   // nothing to send yet
        if (s.rev > 0 && this.same(mine, s.base)) break;          // nothing new here
        const res = await this.rpc("save_client_books", {p_client: cid, p_part: this.PART, p_base: s.rev, p_data: mine});
        if (res && res.ok){ await this.keepBase(cid, res.rev, mine); s.at = Date.now(); break; }
        // someone saved first: merge with theirs and try again on top of their revision
        const theirs = (res && res.data) || {}, clash = [];
        const merged = this.merge(s.base || {}, mine, theirs, [], clash);
        if (clash.length){ try { await this.rpc("keep_books_conflict", {p_client: cid, p_part: this.PART, p_rev: res.rev, p_data: mine}); } catch (e){} }
        await this.keepBase(cid, res.rev, theirs);
        await this.apply(cid, merged);
        this.tell(cid, clash, res.updated_by);
      }
    } catch (e){
      if (this.missing(e)) this.off = true;
      else if (/not allowed|42501|permission/i.test(e.message)) s.readonly = true;
      else s.error = e.message;
    }
    s.busy = false;
    if (s.again){ s.again = false; this.schedule(cid); }
  },
  /* ---------- receiving ---------- */
  async pull(cid){
    if (!this.on() || !cid) return;
    const s = this.of(cid);
    if (s.busy) return;
    s.busy = true;
    let upload = false;
    try {
      await this.loadBase(cid);
      const row = await this.fetch(cid);
      if (!row){ upload = true; }                                    // first time: this browser's work goes up
      else if (row.rev !== s.rev){
        const mine = (await this.localWork(cid)) || {}, clash = [];
        const merged = s.rev === 0 && !Object.keys(s.base || {}).length && !Object.keys(mine).length ? row.data : this.merge(s.base || {}, mine, row.data || {}, [], clash);
        if (clash.length){ try { await this.rpc("keep_books_conflict", {p_client: cid, p_part: this.PART, p_rev: row.rev, p_data: mine}); } catch (e){} }
        await this.keepBase(cid, row.rev, row.data || {});
        await this.apply(cid, merged);
        this.tell(cid, clash, row.updated_by);
        upload = !this.same(merged, row.data || {});               // this browser had changes of its own
      } else {
        const mine = await this.localWork(cid);
        upload = !!mine && !this.same(mine, s.base);
      }
      s.by = row ? row.updated_by : null; s.at = Date.now(); s.error = "";
    } catch (e){
      if (this.missing(e)) this.off = true; else s.error = e.message;
    }
    s.busy = false;
    if (upload) await this.push(cid);
  },
  // called with every firm sync: send what is waiting, bring in what others saved for the client that is open
  async tick(){
    if (!this.on()) return;
    const open = S.books && S.books.cid && !S.books.loading ? S.books.cid : null;
    for (const cid of Object.keys(this.st)){ if (cid !== open && this.st[cid].timer && !this.st[cid].busy) await this.push(cid); }
    if (open) await this.pull(open);
  },
  // one line under the books' tabs
  note(cid){
    if (!(typeof Cloud === "object" && Cloud.on())) return '<p class="note" style="margin:6px 0">TDS and GST work is kept in this browser only. Sign in to the firm account to share it with your colleagues.</p>';
    if (this.off) return '<p class="note" style="margin:6px 0">The firm’s database is not set up for shared TDS and GST work yet: it is kept in this browser only.</p>';
    const s = this.st[cid] || {};
    if (s.readonly) return '<p class="note" style="margin:6px 0">Look-only access: changes here are not saved for the firm.</p>';
    if (s.error) return '<p class="note warn" style="margin:6px 0">TDS and GST work not saved to the firm yet: ' + esc(s.error) + ". It is safe in this browser and will be sent at the next sync.</p>";
    return "";
  }
};
if (typeof window === "object") window.addEventListener("beforeunload", () => { try { Object.keys(BookSync.st).forEach(cid => { if (BookSync.st[cid].timer){ clearTimeout(BookSync.st[cid].timer); BookSync.push(cid); } }); } catch (e){} });
