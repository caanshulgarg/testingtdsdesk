/* ================================================================== */
/* The client's Tally ledgers: one list for the whole app (02-Oct-26)  */
/* ================================================================== */
// Review of 02-Oct-2026 (Testing AAD: "Kashi IT Solutions" not found although the cloud copy has all 1,110 ledgers).
// Every ledger box (bill, bank, sales) read S.bank.ledgers.list, a copy kept in this browser (BankDB "ledgers:<cid>")
// and loaded with the bank data. With the Tally computer here, the ledgers were read again only when that copy was
// EMPTY; the cloud copy was read only when the Tally computer was NOT here. So an older, shorter copy kept in the
// browser was never replaced. Now:
//   - one list per client (Ledgers.st[cid]): read from FinCom's cloud copy whenever the client is linked to it, else
//     from the bridge; read again on opening the client, on Refresh, and when the cloud's ledger time changes
//     (Live.bookChanged, or TCloud.status seen by Ledgers.watch);
//   - a list is never replaced by a shorter one that is older, and a copy kept in the browser never replaces a list
//     read in this session; S.bank.ledgers (bank, sales) and the browser copy are kept in step with it;
//   - ledgers created from FinCom and not yet in Tally (b.newLed) are added by knownLedgers().
// Each ledger: {name, group, chain?, gstin, pan, taxType, dutyHead, tdsNature, acNo, ifsc}.
const Ledgers = {
  st: {},             // cid -> {list, parents, at, srcAt, src, file, live, book, cloudAt}
  busy: {},           // cid -> promise of the read going on
  err: {},            // cid -> what went wrong in the last read
  seen: {},           // cid -> when Ledgers.watch last looked
  ver: 0,
  hist: {},           // cid -> {ledger -> vouchers} (the supplier's entries, from the cloud copy)
  histBusy: {},
  gstinMap: {},       // cid -> {GSTIN -> ledger} (from the cloud copy's entries)
  // the client on screen; outside a client's pages, the one whose bank data is loaded
  cid(){ if (S.view === "company" && S.coId) return S.coId; const b = typeof B === "function" ? B() : null; return (b && b.cid) || S.coId; },
  bankList(cid){ const b = S.bank; return b && b.cid === cid && b.ledgers && b.ledgers.list || []; },
  // the list for a client: the one held, or the bank's copy when that is longer (set by a file import or a test)
  list(cid){
    cid = cid || this.cid();
    const s = this.st[cid], bl = this.bankList(cid);
    return s && s.list.length >= bl.length ? s.list : bl;
  },
  t(x){ return new Date((x && (x.srcAt || x.importedAt || x.at)) || 0).getTime() || 0; },
  cur(cid){
    const s = this.st[cid], bl = this.bankList(cid);
    if (s && s.list.length >= bl.length) return s;
    const b = S.bank;
    return bl.length ? Object.assign({src: b.ledgers.src || (b.ledgers.live ? "bridge" : "browser"), at: b.ledgers.importedAt, srcAt: b.ledgers.srcAt || b.ledgers.importedAt}, b.ledgers) : null;
  },
  // a candidate list: taken unless it is shorter and older than the one held; a copy kept in the browser never
  // replaces a list held (it is only taken when nothing is held); a file the person chose is always taken
  take(cid, cand){
    if (!cand || !(cand.list || []).length) return false;
    const held = this.cur(cid);
    if (held && held.list && held.list.length && cand.src !== "file"){
      if (cand.src === "browser") return false;
      if (cand.list.length < held.list.length && this.t(cand) <= this.t(held)){ this.kept = {cid, n: cand.list.length, held: held.list.length, src: cand.src, at: new Date().toISOString()}; return false; }
    }
    cand.list = this.enrich(cid, cand.list, held);
    this.st[cid] = Object.assign({}, cand, {at: cand.at || new Date().toISOString()});
    this.ver++;
    this.toBank(cid);
    return true;
  },
  // S.bank.ledgers and the browser's copy follow the list held
  toBank(cid){
    const s = this.st[cid]; if (!s) return;
    const obj = {list: s.list, groups: Array.from(new Set(s.list.map(l => l.group).concat(Object.keys(s.parents || {})).filter(Boolean))).sort(), importedAt: s.at, srcAt: s.srcAt || s.at,
      file: s.file || "", live: s.src !== "file" && s.src !== "browser", src: s.src, parents: s.parents || {}, book: s.book || "", cloudAt: s.cloudAt || ""};
    if (S.bank && S.bank.cid === cid){
      S.bank.ledgers = obj;
      const have = new Set(s.list.map(l => l.name.toLowerCase()));
      S.bank.newLed = (S.bank.newLed || []).filter(n => !have.has(n.name.toLowerCase()));
      if (typeof saveBank === "function") saveBank({ledgers: true, newLed: true});
    } else if (typeof BankDB === "object" && s.src !== "browser") BankDB.set("ledgers:" + cid, obj);
  },
  // the copy kept in this browser, offered when the bank data is loaded: it is what the bank keeps only if nothing
  // newer is held
  fromBrowser(cid, saved){
    const s = this.st[cid];
    if (saved && (saved.list || []).length && !(s && s.list.length)){
      this.st[cid] = {list: saved.list, parents: saved.parents || {}, at: saved.importedAt || "", srcAt: saved.srcAt || saved.importedAt || "", src: saved.src === "cloud" || saved.src === "bridge" ? saved.src : "browser",
        file: saved.file || "", book: saved.book || "", cloudAt: saved.cloudAt || "", fromBrowser: true};
      this.ver++;
    }
    const h = this.st[cid];
    if (!h) return saved || {list: [], importedAt: ""};
    if (saved && (saved.list || []).length < h.list.length) this.kept = {cid, n: (saved.list || []).length, held: h.list.length, src: "browser", at: new Date().toISOString()};
    return {list: h.list, groups: Array.from(new Set(h.list.map(l => l.group).filter(Boolean))).sort(), importedAt: h.at, srcAt: h.srcAt, file: h.file || "", live: h.src === "cloud" || h.src === "bridge", src: h.src, parents: h.parents || {}, book: h.book || "", cloudAt: h.cloudAt || ""};
  },
  // GSTIN, PAN and the tax details: kept from the list held before (a bridge read has them; the cloud copy may not),
  // and from the client's books (ledger masters read from Tally)
  enrich(cid, list, held){
    const by = new Map(((held && held.list) || []).map(l => [l.name.toLowerCase(), l]));
    const bk = S.books && S.books.cid === cid ? S.books : null, info = (bk && bk.ledInfo) || {};
    const keys = ["gstin", "pan", "taxType", "dutyHead", "tdsNature", "acNo", "ifsc"];
    return list.map(l => {
      const o = by.get(l.name.toLowerCase()), i = info[l.name] || {}, x = Object.assign({}, l);
      // GSTIN and PAN as Tally gave them (the cloud's columns, a bridge read); the books copy is read apart (bookIds)
      keys.forEach(k => { if (!x[k]) x[k] = (o && o[k]) || (k === "gstin" || k === "pan" ? "" : i[k]) || ""; });
      if (!x.group) x.group = (o && o.group) || i.group || (bk && bk.under && bk.under[l.name]) || "";
      return x;
    });
  },

  // ---------- reading ----------
  async load(cid, opts){
    opts = opts || {};
    cid = cid || S.coId;
    const co = CO(cid);
    if (!co) return {ok: false, err: "no client"};
    if (this.busy[cid]) return this.busy[cid];
    const run = (async () => {
      const s = this.st[cid];
      let bk = null;
      if (typeof TCloud === "object" && TCloud.on()){
        try { await TCloud.status(cid, !!opts.force); } catch (e){}
        bk = TCloud.has(cid) ? TCloud.book(cid) : null;
      }
      const live = typeof bridgeLive === "function" && bridgeLive(co);
      try {
        let took = false, cand = null;
        if (bk && bk.book){
          if (!opts.force && s && s.src === "cloud" && s.book === bk.book && (s.cloudAt || "") === (bk.ledgersAt || "") && s.list.length) return {ok: true, n: s.list.length, same: true};
          cand = await this.readCloud(cid, bk);
          took = this.take(cid, cand);
        }
        // the Tally computer here: asked for a Refresh, or nothing in the cloud
        if (live && (opts.force || !bk)){
          if (opts.force || !(s && s.src === "bridge" && s.list.length && Date.now() - this.t(s) < 6 * 3600000)){
            const c2 = await this.readBridge(cid, co);
            took = this.take(cid, c2) || took; cand = cand || c2;
          }
        }
        if (!bk && !live) return {ok: false, err: "Neither FinCom's cloud copy nor the Tally computer has this client's ledgers."};
        this.err[cid] = "";
        const mapped = took && typeof ledgersChanged === "function" ? ledgersChanged(cid) : [];
        if (took) render();
        const h = this.st[cid] || {};
        return {ok: true, n: (h.list || []).length, took, mapped: mapped || [], kept: !took && cand && cand.list && cand.list.length < this.list(cid).length ? cand.list.length : 0};
      } catch (e){
        this.err[cid] = (e && e.message) || String(e);
        return {ok: false, err: this.err[cid]};
      }
    })();
    this.busy[cid] = run;
    try { return await run; } finally { delete this.busy[cid]; }
  },
  refresh(cid){
    cid = cid || S.coId;
    render();
    return this.load(cid, {force: true}).then(r => {
      if (r.ok) toast((r.n || 0).toLocaleString("en-IN") + " ledgers from Tally" + (r.kept ? " (a shorter list of " + r.kept + " was not taken)" : "") + ".");
      else toast("Could not read the ledgers: " + r.err);
      render(); return r;
    });
  },
  // hasConfirm: migration 39's needs_confirm / before_clean columns: null not known yet, true there, false not there
  // (a 42703 from the first read: read again without them, as TallyProof.hasDel does)
  hasConfirm: null,
  async readCloud(cid, bk){
    const q = sel => "tally_ledgers?select=" + sel + "&merged_into=is.null&book_id=eq." + encodeURIComponent(bk.book) + "&order=name.asc";
    let rows = null, last = null;
    // needs_confirm and before_clean from migration-39 on; gstin and pan from migration-27 on; chain and primary_group from migration-6 on
    const sels = (this.hasConfirm === false ? [] : ["name,parent,chain,gstin,pan,needs_confirm,before_clean"]).concat(["name,parent,chain,gstin,pan", "name,parent,chain", "name,parent"]);
    for (const sel of sels){
      try { rows = await TCloud.restAll(q(sel)); if (/needs_confirm/.test(sel)) this.hasConfirm = true; break; }
      catch (e){ last = e; if (/needs_confirm/.test(sel) && /needs_confirm|before_clean|42703/i.test(String((e && (e.message || e.code)) || e))) this.hasConfirm = false; }
    }
    if (!rows) throw last || {message: "The cloud copy did not answer."};
    const by = new Map();
    [].concat(rows || []).forEach(r => {
      const n = ledNm(r.name);
      if (!n || by.has(n)) return;
      const l = {name: n, group: ledNm(r.parent || ""), chain: Array.isArray(r.chain) ? r.chain.map(ledNm) : undefined, gstin: String(r.gstin || "").toUpperCase(), pan: String(r.pan || "").toUpperCase()};
      const rn = this.renameOf(r); if (rn) l.renamed = rn;
      by.set(n, l);
    });
    let parents = {};
    try { (await TCloud.restAll("tally_groups?select=name,parent&book_id=eq." + encodeURIComponent(bk.book) + "&order=name.asc") || []).forEach(g => { if (g && g.name) parents[ledNm(g.name)] = ledNm(g.parent || ""); }); } catch (e){ parents = {}; }
    const now = new Date().toISOString();
    return {list: Array.from(by.values()), parents, at: now, srcAt: bk.ledgersAt || now, src: "cloud", file: "Tally, from the copy in FinCom's cloud", book: bk.book, cloudAt: bk.ledgersAt || ""};
  },
  async readBridge(cid, co){
    const j = await Bridge.call("/ledgers?company=" + encodeURIComponent(tallyCoName(co)) + Bridge.pinQ(), null, 180000);
    const list = [].concat(j.ledgers || []).filter(l => l && l.name).map(l => ({name: ledNm(l.name), group: l.group || "", pan: String(l.pan || "").toUpperCase(), gstin: String(l.gstin || "").toUpperCase(), acNo: l.acNo || "", ifsc: l.ifsc || "", taxType: l.taxType || "", tdsNature: l.tdsNature || "", dutyHead: l.dutyHead || ""}));
    const parents = {}; [].concat(j.groups || []).forEach(g => { if (g && g.name) parents[g.name] = g.parent || ""; });
    const now = new Date().toISOString();
    return {list, parents, at: now, srcAt: now, src: "bridge", file: "Tally (live)"};
  },
  // the cloud's ledger time changed (the Tally computer sent its masters): read again
  bookRow(r){
    if (!r || !r.client_id) return;
    const s = this.st[r.client_id];
    if (s && s.src === "cloud" && r.ledgers_at && r.ledgers_at !== s.cloudAt && r.client_id === S.coId){
      if (typeof TCloud === "object" && TCloud.st[r.client_id]) TCloud.st[r.client_id].at = 0;
      this.load(r.client_id);
    }
  },
  // after each drawing of a client's page: the first read, and a read again when the cloud's ledger count or time
  // has changed (looked at most every 30 seconds)
  watch(cid){
    if (!cid || this.busy[cid] || Date.now() - (this.seen[cid] || 0) < 30000) return;
    this.seen[cid] = Date.now();
    const co = CO(cid), s = this.st[cid];
    const cloud = typeof TCloud === "object" && TCloud.on(), live = typeof bridgeLive === "function" && bridgeLive(co);
    if (!cloud && !live) return;
    if (!s || s.fromBrowser){ this.load(cid); return; }
    if (cloud) TCloud.status(cid).then(() => {
      const bk = TCloud.has(cid) ? TCloud.book(cid) : null;
      if (bk && (s.src !== "cloud" || s.book !== bk.book || (s.cloudAt || "") !== (bk.ledgersAt || "") || (bk.ledgers && bk.ledgers !== s.list.length))) this.load(cid);
    }, () => {});
  },
  status(cid){
    cid = cid || S.coId;
    const h = this.cur(cid);
    return {n: this.list(cid).length, at: h ? h.at || h.importedAt : "", src: h ? h.src : "", busy: !!this.busy[cid], err: this.err[cid] || ""};
  },
  // FinCom Bridge 2.1.4 (owner's request of 02-Oct-2026): a bill's ledger chooser opened with a list older than the
  // client's last posting asks for the list to be read again: the bridge here when it serves the company (POST
  // /ledgers/refresh), else the client's Tally computer through FinCom's cloud (tally-ingest wake, what "ledgers").
  // Asked once per opening of the chooser (acOpen); the new list comes in when the cloud's ledger time changes (watch)
  lastPost(cid){
    const t = x => Date.parse(x || "") || 0;
    let at = 0;
    Object.values(((S.data || {})[cid] || {}).entries || {}).forEach(e => { if (e && e.exportedAt) at = Math.max(at, t((e.tally && e.tally.at) || e.exportedAt)); });
    if (S.bank && S.bank.cid === cid) (S.bank.rows || []).forEach(r => { if (r.state === "sent" && r.sentAt) at = Math.max(at, t(r.sentAt)); });
    return at;
  },
  listAt(cid){
    const h = this.cur(cid), bk = typeof TCloud === "object" && TCloud.on() ? TCloud.book(cid) : null;
    return Math.max(h ? Date.parse(h.srcAt || h.at || h.importedAt || "") || 0 : 0, bk ? Date.parse(bk.ledgersAt || "") || 0 : 0);
  },
  async staleAsk(cid){
    cid = cid || this.cid();
    const co = CO(cid), post = this.lastPost(cid), at = this.listAt(cid);
    if (!co || !post || at >= post) return null;
    const here = typeof bridgeLive === "function" && bridgeLive(co) && !!Bridge.openFor(co);
    const r = {cid, at: Date.now(), post, listAt: at, via: here ? "bridge" : "cloud"};
    try {
      if (here) r.ans = await Bridge.call("/ledgers/refresh", {company: tallyCoName(co)}, 30000);
      else if (typeof TCloud === "object" && TCloud.on()) r.ans = await TCloudUp.post({kind: "wake", what: "ledgers", client: cid}, {client: cid});
      else r.via = "";
    } catch (e){ r.err = (e && e.message) || String(e); }
    this.asked = r;
    if (r.ans && !r.err) setTimeout(() => { this.seen[cid] = 0; this.watch(cid); }, 60000);
    return r;
  },
  // "1,110 ledgers from Tally · 02-Oct 10:56"
  when(at){ if (!at) return ""; const d = new Date(at); return isNaN(d) ? "" : String(d.getDate()).padStart(2, "0") + "-" + MONTHS3[d.getMonth()] + " " + fmtTime(d); },

  // ---------- a rename in Tally that carried the ledger's saved choices (migration 39) ----------
  // tally_ledgers.needs_confirm is true until an owner confirms; the rename's entry (before_clean.renamed[], confirm: true)
  // says from which name, when, and what was carried ({items, flow, values, clash}). Shown once per rename: a row
  // without the flag (confirmed, or a cloud without the column) shows nothing.
  renameOf(r){
    if (!r || !(r.needs_confirm === true || r.needs_confirm === "true")) return null;
    const list = r.before_clean && Array.isArray(r.before_clean.renamed) ? r.before_clean.renamed : [];
    const e = list.filter(x => x && (x.confirm === true || x.confirm === "true")).pop() || list[list.length - 1] || {};
    const c = e.carried && typeof e.carried === "object" ? e.carried : {};
    return {from: ledNm(e.from || e.mergedFrom || ""), at: e.at || "", carried: c, clash: Array.isArray(c.clash) ? c.clash.map(String) : [], merged: !!e.mergedFrom};
  },
  renamed(cid){ return this.list(cid || this.cid()).filter(l => l && l.renamed); },
  renamedOf(cid, name){ const k = String(name || "").toLowerCase(); return this.list(cid || this.cid()).find(l => l && l.renamed && l.name.toLowerCase() === k) || null; },
  // "Renamed in Tally from X on 02-Oct-2026: its saved choices were carried; confirm" (and the clash, when both names had one)
  CLASH_KEY: {map: "map", ledInfo: "ledger-info", gstins: "GSTIN", pans: "PAN"},
  renameLine(rn){
    if (!rn) return "";
    const day = rn.at ? (typeof fmtDate === "function" ? fmtDate(String(rn.at).slice(0, 10)) : String(rn.at).slice(0, 10)) : "";
    let s = (rn.merged ? "Merged in Tally with " : "Renamed in Tally from ") + (rn.from || "another name") + (day ? " on " + day : "") + ": its saved choices were carried; confirm";
    if (rn.clash.length) s += " (the new name already had a " + rn.clash.map(k => this.CLASH_KEY[k] || k).join(" and ") + " choice; the new name's stands)";
    return s;
  },
  // only an owner of the firm may confirm (the RPC refuses anyone else)
  canConfirmRename(){ return !!(S.account && (S.account.superadmin === true || ((S.account.me || {}).role === "owner"))); },
  async confirmRename(cid, name){
    cid = cid || this.cid();
    const bk = typeof TCloud === "object" && TCloud.on() && TCloud.has(cid) ? TCloud.book(cid) : null;
    if (!bk || !bk.book){ toast("This client's ledgers are not in FinCom's cloud."); return null; }
    const key = cid + "|" + name;
    if (this.confirming && this.confirming[key]) return null;
    (this.confirming = this.confirming || {})[key] = true; render();
    try {
      const r = await TCloud.rpc("tally_ledger_rename_confirm", {p_book: bk.book, p_name: name});
      toast(name + ": the rename is confirmed.");
      // the list read again: the flag is cleared in the cloud, so the line goes
      await this.load(cid, {force: true});
      return r;
    } catch (e){ toast("Could not confirm: " + ((e && e.message) || String(e))); return null; }
    finally { delete this.confirming[key]; render(); }
  },

  // a ledger's GSTIN and PAN: as Tally has them now (the cloud's ledger list from migration 28, or a bridge read), and
  // as the books copy has them (ledger masters read with the books: ledInfo, gstins, pans; staging client_book_items)
  ids(cid, name){
    const l = (cid === this.cid() && typeof knownLedgers === "function" ? knownLedgers().get(String(name).toLowerCase()) : null) || {};
    const bk = S.books && S.books.cid === cid ? S.books : null, i = (bk && (bk.ledInfo || {})[name]) || {};
    const up = v => String(v || "").toUpperCase().trim();
    const tg = up(l.gstin), tp = up(l.pan) || (GSTIN_RE.test(tg) ? tg.slice(2, 12) : "");
    const bg = up(i.gstin) || up(bk && (bk.gstins || {})[name]), bp = up(i.pan) || up(bk && (bk.pans || {})[name]) || (GSTIN_RE.test(bg) ? bg.slice(2, 12) : "");
    return {gstin: tg || bg, pan: tp || bp, tallyGstin: tg, bookGstin: bg, tallyPan: tp, bookPan: bp};
  },
  // ---------- groups ----------
  // the group chain of a ledger, from the list held, the cloud's groups, and the client's books
  chain(cid, name){
    const s = this.st[cid], bk = S.books && S.books.cid === cid ? S.books : null;
    const l = typeof knownLedgers === "function" && cid === this.cid() ? knownLedgers().get(String(name).toLowerCase()) : (this.list(cid).find(x => x.name.toLowerCase() === String(name).toLowerCase()));
    if (l && Array.isArray(l.chain) && l.chain.length) return l.chain;
    const parents = Object.assign({}, (bk && bk.groups) || {}, (S.bank && S.bank.cid === cid && S.bank.ledgers && S.bank.ledgers.parents) || {}, (s && s.parents) || {});
    let g = (l && l.group) || (bk && ((bk.ledInfo || {})[name] || {}).group) || (bk && (bk.under || {})[name]) || "";
    const out = [];
    // a group's parent looked up whatever its capitals (Tally's "Cash-in-hand" against a list's "Cash-in-Hand")
    for (let i = 0; i < 12 && g; i++){ out.push(g); const p = ledLook(parents, g); if (!p || ledKey(p) === ledKey(g) || /^\W*primary$/i.test(p)) break; g = p; }
    return out;
  },
  // what a ledger is for: party (Sundry Creditors / Debtors), expense (Direct / Indirect Expenses, Purchase
  // Accounts), asset (Fixed Assets), income (Sales Accounts, Direct / Indirect Incomes), tax (Duties & Taxes),
  // bank, or other; "" when its group is not known
  cls(cid, name){
    const ch = this.chain(cid || this.cid(), name);
    if (!ch.length) return "";
    const has = re => ch.some(g => re.test(String(g).trim()));
    if (has(/^sundry\s*(creditors|debtors)$/i)) return "party";
    if (has(/^(sales\s*accounts?|direct\s*incomes?|indirect\s*incomes?)$/i)) return "income";
    if (has(/^(direct\s*expenses?|indirect\s*expenses?|purchase\s*accounts?)$/i)) return "expense";
    if (has(/^fixed\s*assets?$/i)) return "asset";
    if (has(/^duties\s*(&|and)\s*taxes$/i)) return "tax";
    if (has(/^(bank\s*accounts?|bank\s*od\s*a\/c|cash-in-hand|cash\s*in\s*hand)$/i)) return "bank";
    return "other";
  },
  groupOf(cid, name){ const ch = this.chain(cid || this.cid(), name); return ch.length ? ch[ch.length - 1] : ""; },

  // ---------- searching (the drop-down under each ledger box) ----------
  // case, dots, spaces and "&" / "and" do not matter: "kashi", "kashi i.t" and "KASHI IT" all find "Kashi IT Solutions"
  key(s){ return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim(); },
  match(q, name){
    const kq = this.key(q), kn = this.key(name);
    if (!kq) return 1;
    const cq = kq.replace(/ /g, ""), cn = kn.replace(/ /g, "");
    if (cn === cq) return 100;
    if (cn.startsWith(cq)) return 90;
    const words = kq.split(" "), toks = kn.split(" ");
    if (words.every(w => toks.some(t => t.startsWith(w)))) return 80 + (toks[0].startsWith(words[0]) ? 5 : 0);
    if (cn.includes(cq)) return 70;
    if (words.every(w => cn.includes(w))) return 60;
    return 0;
  },
  // a role's own ledgers first; an expense box never offers an income ledger
  roleRank(role, c){
    if (role === "party") return c === "party" ? 0 : c === "" || c === "other" ? 1 : c === "income" || c === "expense" || c === "tax" ? 3 : 2;
    if (role === "expense") return c === "expense" ? 0 : c === "asset" ? 1 : c === "" || c === "other" ? 2 : c === "income" ? 9 : 3;
    if (role === "gst" || role === "tds" || role === "rcm-in" || role === "rcm-out") return c === "tax" ? 0 : c === "" || c === "other" ? 1 : 3;
    return 0;
  },
  allowed(role, c){ return !(role === "expense" && c === "income"); },

  // ---------- the supplier's earlier entries in Tally (the day book) ----------
  // from the client's books when they are open here, else from the cloud copy (read once, in the background; never a
  // live read of Tally while bills are processed: build 190)
  vouchers(cid, ledger){
    if (!ledger) return null;
    const bk = S.books && S.books.cid === cid && (S.books.vouchers || []).length ? S.books : null, key = normName(ledger);
    const t = new Date(Date.now() - 2 * 365 * 86400000), since = t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0");
    if (bk){
      const c = this._vc = this._vc && this._vc.v === bk.vouchers && this._vc.n === bk.vouchers.length ? this._vc : {v: bk.vouchers, n: bk.vouchers.length, m: new Map()};
      if (c.m.has(key)) return c.m.get(key);
      const out = bk.vouchers.filter(v => !v.cancel && !v.opt && String(v.date) >= since && (v.ent || []).some(e => normName(e.l) === key)).map(v => ({date: String(v.date), no: v.no || "", narr: v.narr || "", type: v.type || "", ent: v.ent || []}));
      c.m.set(key, out);
      return out;
    }
    const h = this.hist[cid] = this.hist[cid] || {};
    if (h[ledger]) return h[ledger];
    if (typeof TCloud === "object" && TCloud.on() && TCloud.has(cid) && typeof CloudTally === "object" && !this.histBusy[cid + "|" + ledger]){
      this.histBusy[cid + "|" + ledger] = true;
      const co = CO(cid), today = new Date().toISOString().slice(0, 10), from = t.toISOString().slice(0, 10);
      CloudTally.call(co, "/ledgerlines?company=" + encodeURIComponent(tallyCoName(co)) + "&from=" + isoToTally(from) + "&to=" + isoToTally(today) + "&ledger=" + encodeURIComponent(ledger)).then(j => {
        h[ledger] = [].concat(j.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || "") && !/^yes$/i.test(v.optional || "")).map(v => ({date: String(v.date), no: v.number || "", narr: String(v.narration || ""), type: v.type || "",
          ent: [].concat(v.entries || []).map(e => ({l: ledNm(e.ledger), a: parseFloat(String(e.amount).replace(/,/g, "")) || 0}))}));
        this.ver++;
        if (typeof billAutoAll === "function") billAutoAll(cid);
        render();
      }, () => { h[ledger] = []; }).finally(() => { delete this.histBusy[cid + "|" + ledger]; });
    }
    return null;
  },
  // the party ledger whose entries carried this GSTIN (the party's GSTIN on each entry: the books here, or the cloud copy)
  gstinParty(cid, g){
    if (!g) return "";
    const bk = S.books && S.books.cid === cid ? S.books : null;
    if (bk){
      const hit = Object.entries(bk.gstins || {}).filter(([, x]) => String(x).toUpperCase() === g).map(([n]) => n);
      if (hit.length === 1) return hit[0];
      const vs = (bk.vouchers || []).filter(v => String(v.gstin || "").toUpperCase() === g);
      const c = {};
      vs.forEach(v => { const p = (v.ent || []).map(e => e.l).find(l => this.cls(cid, l) === "party" && (normName(l) === normName(v.party) || nameSim(l, v.party || "") >= 0.6)) || (this.cls(cid, v.party) === "party" ? v.party : ""); if (p) c[p] = (c[p] || 0) + 1; });
      const top = Object.entries(c).sort((a, b) => b[1] - a[1]);
      if (top.length) return top[0][0];
    }
    const m = this.gstinMap[cid] = this.gstinMap[cid] || {};
    if (g in m) return m[g] || "";
    if (typeof TCloud === "object" && TCloud.on() && TCloud.has(cid)){
      m[g] = "";
      const bkc = TCloud.book(cid);
      // round 9 (owner item 10): the cloud copy keeps an entry deleted in Tally (tally_vouchers.deleted_at, migration-37):
      // only live entries are read here, so a deleted entry's lines (a direct read of tally_lines) are never read or used.
      // TallyProof.live adds the filter and reads as before on a cloud without the column (42703, hasDel false).
      const live = p => typeof TallyProof === "object" && TallyProof && typeof TallyProof.live === "function" ? TallyProof.live(p) : Cloud.api(p);
      live("tally_vouchers?select=party,guid&book_id=eq." + encodeURIComponent(bkc.book) + "&gstin=eq." + encodeURIComponent(g) + "&order=day.desc&limit=20").then(async rows => {
        rows = [].concat(rows || []);
        let found = "";
        for (const r of rows){
          if (exactLedger(ledNm(r.party)) && this.cls(cid, ledNm(r.party)) !== "income"){ found = exactLedger(ledNm(r.party)); break; }
          const ls = [].concat(await Cloud.api("tally_lines?select=ledger&book_id=eq." + encodeURIComponent(bkc.book) + "&guid=eq." + encodeURIComponent(r.guid)) || []).map(x => ledNm(x.ledger));
          const p = ls.find(l => this.cls(cid, l) === "party");
          if (p){ found = exactLedger(p) || p; break; }
        }
        m[g] = found;
        if (found){ this.ver++; if (typeof billAutoAll === "function") billAutoAll(cid); render(); }
      }, () => {});
    }
    return "";
  },

  // ---------- GST and TDS ledgers ----------
  // which tax a ledger is for: from the confirmed GST ledger check (S.books.map) first, Tally's own duty head next,
  // and its name only when neither says
  HEADS: {cgst: "CGST", sgst: "SGST", igst: "IGST", cess: "CESS"},
  headOfName(n){
    const u = String(n || "").toUpperCase();
    const h = [/\bC\.?\s*GST\b|CGST|CENTRAL\s*(GST|TAX)/.test(u) && "CGST", /\bS\.?\s*GST\b|SGST|UTGST|STATE\s*(GST|TAX)/.test(u) && "SGST", /\bI\.?\s*GST\b|IGST|INTEGRATED/.test(u) && "IGST", /\bCESS\b/.test(u) && "CESS"].filter(Boolean);
    return h.length === 1 ? h[0] : "";
  },
  headOfDuty(d){ const u = String(d || "").toUpperCase(); return /INTEGRATED|IGST/.test(u) ? "IGST" : /CENTRAL|CGST/.test(u) ? "CGST" : /STATE|UT|SGST/.test(u) ? "SGST" : /CESS/.test(u) ? "CESS" : ""; },
  gstInfo(cid, name){
    const bk = S.books && S.books.cid === cid ? S.books : null, m = bk && bk.map ? bk.map[name] : null;
    const li = (cid === this.cid() && typeof knownLedgers === "function" ? knownLedgers().get(String(name).toLowerCase()) : null) || {};
    const nameHead = this.headOfName(name), u = String(name).toUpperCase();
    const out = {head: "", side: "", rcm: /\bRCM\b|REVERSE/.test(u), rate: null, confirmed: false, gst: false, src: ""};
    const rm = u.match(/(\d+(?:\.\d+)?)\s*%/); if (rm) out.rate = num(rm[1]);
    if (m && (m.byHand || m.what !== "none")){
      if (!/^gst/.test(m.what || "")) return Object.assign(out, {gst: false, src: "check"});
      out.gst = true; out.head = String(m.tax || "").toUpperCase(); out.side = m.side || ""; out.rcm = !!m.rcm || /rcm/.test(m.what); out.confirmed = !!m.ok; out.src = m.ok ? "confirmed" : "check";
      if (m.gstRate) out.rate = num(m.gstRate);
      // an output RCM ledger takes every head ("RCM Payable"): its head is what its name says, if anything
      if (out.rcm && out.side === "output" && !nameHead) out.head = "";
      if (!out.confirmed && nameHead && out.head !== nameHead) out.head = nameHead;
    } else {
      const dh = this.headOfDuty(li.dutyHead);
      out.head = dh || nameHead; out.gst = !!(dh || /^gst$/i.test(li.taxType || "") || nameHead); out.src = dh ? "tally" : "name";
    }
    if (!out.side) out.side = /OUTPUT|PAYABLE|LIAB/.test(u) ? "output" : /INPUT|ITC|CREDIT|RECEIVABLE/.test(u) ? "input" : "";
    if (out.head === "UTGST") out.head = "SGST";
    return out;
  },
  // a TDS section from a ledger: its nature of payment in Tally, the ledger check, or its name ("TDS ON RENT 94I")
  secOf(cid, name){
    const bk = S.books && S.books.cid === cid ? S.books : null, m = bk && bk.map ? bk.map[name] : null;
    if (m && m.section) return this.sec(m.section);
    const li = (cid === this.cid() && typeof knownLedgers === "function" ? knownLedgers().get(String(name).toLowerCase()) : null) || {};
    return this.sec(li.tdsNature) || this.sec(name);
  },
  sec(s){ const x = typeof LedCheck === "object" ? LedCheck.section(s) : ""; return String(x || "").toUpperCase().replace(/[^0-9A-Z]/g, ""); },
  isTds(cid, name){
    const bk = S.books && S.books.cid === cid ? S.books : null, m = bk && bk.map ? bk.map[name] : null;
    if (m && (m.byHand || m.what !== "none")) return m.what === "tds_payable";
    const c = this.cls(cid, name);
    return /\bTDS\b|TAX\s*DEDUCTED/i.test(name) && !/RECEIVABLE|RECOVERABLE|REFUND|INTEREST|INTREST|LATE\s*FEE/i.test(name) && c !== "expense" && c !== "income" && c !== "party";
  },
  // how often each tax ledger was used in the day book, and at which rate of the value (one pass over the books)
  usage(cid){
    const bk = S.books && S.books.cid === cid && (S.books.vouchers || []).length ? S.books : null;
    if (!bk) return null;
    if (this._u && this._u.v === bk.vouchers && this._u.n === bk.vouchers.length && this._u.ver === this.ver) return this._u.u;
    const u = {}, clsC = {}, cl = l => clsC[l] === undefined ? (clsC[l] = this.cls(cid, l)) : clsC[l];
    bk.vouchers.forEach(v => {
      if (v.cancel || v.opt) return;
      const base = (v.ent || []).filter(e => ["expense", "asset"].includes(cl(e.l)) && e.a < 0).reduce((a, e) => a + Math.abs(e.a), 0);
      (v.ent || []).forEach(e => {
        const c = cl(e.l), x = u[e.l] = u[e.l] || {n: 0, rates: {}};
        x.n++;
        if (c === "expense" || c === "income" || c === "party" || c === "bank" || c === "asset") return;
        if (base > 0){ const r = this.snapRate(Math.abs(e.a) / base * 100); if (r) x.rates[r] = (x.rates[r] || 0) + 1; }
      });
    });
    this._u = {v: bk.vouchers, n: bk.vouchers.length, ver: this.ver, u};
    return u;
  },
  RATES: [0.125, 0.25, 1.5, 2.5, 3, 5, 6, 9, 12, 14, 18, 28],
  snapRate(r){ let best = null; this.RATES.forEach(x => { if (Math.abs(x - r) <= Math.max(0.06, x * 0.03) && (best == null || Math.abs(x - r) < Math.abs(best - r))) best = x; }); return best; }
};
