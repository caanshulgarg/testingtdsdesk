/* ================================================================== */
/* The books in FinCom's cloud: kept in step by the bridge            */
/* ================================================================== */
// The bridge on a computer with Tally sends each linked company's day book (the days that changed), its ledgers and
// the copy's state to the cloud (server/tally-cloud). From there:
//   - the books load into FinCom on any computer, with Tally closed: only the days that changed since last time are
//     downloaded, the rest come from this browser's own store (IndexedDB, "tcday:<book>:<day>");
//   - a large company (more than TCloud.BIG entries) is not loaded at all: the trial balance and ledgers are asked of
//     the cloud's ready totals and come back in a moment, fit for a phone;
//   - Settings, Books in the cloud: the computers that send (connect one, remove one) and which Tally company is
//     which client.
const TCloud = {
  BIG: 60000,
  st: {},                 // cid -> {books, at, err}
  pane: {devices: null, companies: null, busy: "", err: ""},
  on(){ return typeof Cloud === "object" && Cloud.on() && !!(Cloud.st && Cloud.st.firm); },
  ingestUrl(){ return Cloud.cfg().url.replace(/\/+$/, "") + "/functions/v1/tally-ingest"; },
  iso(d8){ return String(d8).slice(0, 4) + "-" + String(d8).slice(4, 6) + "-" + String(d8).slice(6, 8); },
  d8(iso){ return String(iso || "").replace(/-/g, "").slice(0, 8); },
  rpc(fn, args, q){ return Cloud.api("rpc/" + fn + (q || ""), {method: "POST", body: args || {}}); },
  // a list function, a thousand rows at a time (the database gives at most that many in one answer)
  async rpcAll(fn, args){
    let out = [], off = 0;
    for (;;){
      const page = await this.rpc(fn, args, "?limit=1000&offset=" + off) || [];
      out = out.concat(page);
      if (page.length < 1000) return out;
      off += 1000;
    }
  },
  async restAll(path){
    let out = [], off = 0;
    for (;;){
      const page = await Cloud.api(path + "&limit=1000&offset=" + off) || [];
      out = out.concat(page);
      if (page.length < 1000) return out;
      off += 1000;
    }
  },
  // the client's books in the cloud (one per Tally company; the latest first)
  async status(cid, force){
    const s = this.st[cid] = this.st[cid] || {};
    if (!this.on()) return null;
    if (!force && s.books && Date.now() - s.at < 30000) return s.books;
    try { s.books = await this.rpc("tally_status", {p_client: cid}) || []; s.err = ""; }
    catch (e){ s.books = s.books || []; s.err = (e && e.message) || String(e); if (/tally_status|does not exist|schema cache/i.test(s.err)) s.books = []; }
    s.at = Date.now();
    return s.books;
  },
  book(cid){ const s = this.st[cid]; return s && s.books && s.books.find(b => b.from) || null; },
  has(cid){ return !!this.book(cid); },
  big(cid){ const b = this.book(cid); return !!(b && b.entries > this.BIG); },
  // ---------- answers from the cloud's ready totals
  async tb(cid, asOn){
    const rows = await this.rpcAll("tally_tb", {p_client: cid, p_as_on: this.iso(asOn)});
    const bk = this.book(cid) || {};
    const out = rows.filter(r => Math.abs(num(r.closing)) >= 0.005).map(r => ({l: r.ledger, top: this.top(r.ledger, rows), sub: r.parent || "", bal: -r2(num(r.closing))}));
    return LK.tbShape({kind: "tb", src: "cloud", asOn, rows: out, note: "From the copy in FinCom's cloud (" + (bk.company || "") + "), " + this.age(bk) + "."});
  },
  // the top group of a ledger, from the groups FinCom knows, else the ledger's own group
  top(l, rows){ try { const t = FC.top(l); if (t) return t; } catch (e){} const r = rows.find(x => x.ledger === l); return (r && r.parent) || "Other"; },
  async ledger(cid, led, from, to){
    const j = await this.rpc("tally_ledger", {p_client: cid, p_ledger: led, p_from: this.iso(from), p_to: this.iso(to)});
    if (!j || j.none) throw new Error("The cloud has no copy of these books yet.");
    const open = -r2(num(j.open));
    let run = open, dr = 0, cr = 0;
    const rows = [].concat(j.lines || []).map(([d, type, no, party, narr, a, guid]) => {
      a = num(a); const dd = a < 0 ? -a : 0, c = a > 0 ? a : 0;
      dr = r2(dr + dd); cr = r2(cr + c); run = r2(run + dd - c);
      return {id: guid, date: d, type, no, part: party && party !== led ? party : "", narr: narr || "", dr: dd, cr: c, run};
    });
    const ends = j.to && this.d8(j.to) < to ? " This copy (" + (j.company || "") + ") has entries up to " + FC.when(this.d8(j.to)) + "; a later year kept as another company in Tally is asked separately." : "";
    return {kind: "ledger", src: "cloud", led, from, to, open, close: run, dr, cr, rows, note: "From the copy in FinCom's cloud (" + (j.company || "") + "), " + this.age(this.book(cid)) + "." + ends};
  },
  age(bk){
    if (!bk) return "";
    const st = bk.state || {}, at = String(st.seen || bk.stateAt || bk.daysAt || "");
    return at ? "in step with Tally as of " + at.replace("T", " ").slice(0, 16) + (st.computer ? " (sent by " + String(st.computer).slice(0, 60) + ")" : "") : "not sent yet";
  },
  // ---------- one day's day book, from this browser's store or the cloud
  async day(bk, d, at){
    const k = "tcday:" + bk + ":" + d;
    try { const c = await IDBStore.get(k); if (c && c.at === at) return c.text; } catch (e){}
    const c = Cloud.cfg(), s = Cloud.sess();
    const url = c.url.replace(/\/+$/, "") + "/storage/v1/object/authenticated/tally-days/" + Cloud.st.firm + "/" + bk + "/" + d.slice(0, 6) + "/" + d + ".xml.gz";
    let r = await fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + s.access_token}, cache: "no-store"});
    if (r.status === 401 || r.status === 400){ await Cloud.refreshToken(); r = await fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token}, cache: "no-store"}); }
    if (r.status === 404) return "";
    if (!r.ok) throw new Error("Could not fetch " + d + " from the cloud (" + r.status + ").");
    const text = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
    try { await IDBStore.write([[k, {at, text}]]); } catch (e){}
    return text;
  },
  // ---------- bring the cloud's copy into FinCom: only the months with a day that changed
  async load(force){
    const co = CO(), b = S.books;
    if (!co || !b || b.cid !== co.id || !this.on()) return false;
    const books = await this.status(co.id, force) || [];
    const bk = books.find(x => x.from);
    if (!bk) return false;
    const f = LK.fr();
    if (bk.entries > this.BIG){
      // answered from the cloud's totals, not loaded here; only the ledgers and their groups, for choosing and grouping
      const m0 = b.meta = b.meta || {};
      if (!(m0.cloud && m0.cloud.book === bk.book && m0.cloud.big && m0.cloud.ledgersAt === bk.ledgersAt)){
        const led = await this.restAll("tally_ledgers?select=name,parent,open&order=name&book_id=eq." + bk.book);
        b.vouchers = []; TallyRead.balances(b, {ledgers: led.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, this.d8(bk.from), Audit.today());
        m0.cloud = {book: bk.book, company: bk.company, ledgersAt: bk.ledgersAt, big: true, at: new Date().toISOString()};
        LK.cache = {}; render();
      }
      return "big";
    }
    const from = this.d8(bk.from), to = Audit.today();
    const list = await this.rpcAll("tally_days_list", {p_book: bk.book, p_from: bk.from, p_to: this.iso(to)});
    const meta = b.meta = b.meta || {};
    const same = meta.cloud && meta.cloud.book === bk.book;
    const known = same ? (meta.cloud.days || {}) : {};
    const byMonth = {};
    list.forEach(x => { (byMonth[x.day.slice(0, 6)] = byMonth[x.day.slice(0, 6)] || []).push(x); });
    const todo = Object.keys(byMonth).sort().filter(ym => byMonth[ym].some(x => known[x.day] !== x.at));
    const ledNew = !same || meta.cloud.ledgersAt !== bk.ledgersAt;
    if (!todo.length && !ledNew) return true;
    f.busy = "Bringing in " + (todo.length === 1 ? FC.monthLabel(todo[0]) : todo.length + " months") + " from the copy in FinCom's cloud…"; render();
    try {
      if (!same){ b.vouchers = []; b.tb = null; }
      if (ledNew){
        const led = await this.restAll("tally_ledgers?select=name,parent,open&order=name&book_id=eq." + bk.book);
        TallyRead.balances(b, {ledgers: led.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, from, to);
      }
      const days = {};
      for (const ym of todo){
        const parts = [];
        for (const x of byMonth[ym]){ parts.push(await this.day(bk.book, x.day, x.at)); days[x.day] = x.at; }
        const res = await Books.importDayBook(new Blob(["<ENVELOPE>" + parts.join("") + "</ENVELOPE>"], {type: "text/xml"}));
        const bad = notThisClient((res.meta || {}).gstins);
        if (bad.length) throw new Error(panRefusal("The company in the cloud copy", bad));
        const m = TallyRead.months(ym + "01", to).find(z => z.ym === ym) || {from: ym + "01", to: ym + "31"};
        TallyRead.merge(b, res, m.from < from ? from : m.from, m.to);
      }
      if (b.tb && String(b.tb.to) < to) b.tb.to = to;
      b.map = Books.mapLedgers(b.vouchers || [], b.map); try { LedMaster.refresh(b); } catch (e){}
      meta.cloud = {book: bk.book, company: bk.company, ledgersAt: bk.ledgersAt, days: Object.assign({}, known, days), at: new Date().toISOString()};
      meta.at = meta.cloud.at; meta.keep = true; meta.file = "the copy in FinCom's cloud"; meta.from = meta.from && meta.from < from ? meta.from : from;
      TallyRead.after(b, "after changes came from the cloud copy");
      LK.cache = {}; await saveBooks();
    } catch (e){ toast("Could not bring in the cloud copy: " + ((e && e.message) || e)); }
    f.busy = ""; render();
    return true;
  },
  // ---------- Settings: computers and companies
  async refreshPane(){
    const p = this.pane; p.busy = "Loading…"; render();
    try {
      p.devices = await Cloud.api("tally_devices?select=id,name,created_at,last_seen,version,info,revoked&order=created_at.desc");
      p.companies = await this.restAll("tally_companies?select=company,client_id,gstin,last_seen,linked_at&order=company.asc");
      p.err = "";
    } catch (e){ p.err = /tally_devices|does not exist|schema cache/i.test(String(e && e.message)) ? "The cloud copy is not set up in this database yet." : (e && e.message) || String(e); }
    p.busy = ""; render();
  },
  async connect(){
    if (!this.on()){ toast("Sign in to the firm account first."); return; }
    if (!Bridge.on() || !Bridge.up()){ toast("Connect the Tally Bridge on this computer first (Settings, Tally Bridge)."); return; }
    const r = await askConfirm({title: "Send this computer's Tally books to FinCom's cloud?", ok: "Connect this computer",
      body: "<p>The bridge on this computer will send the books of each Tally company it keeps in step to your firm's space in FinCom's cloud, " +
        "so everyone in the firm sees them on any computer or phone, even with Tally closed.</p><p>Only companies linked to one of your clients are sent (by their Tally name, or as you link them below). " +
        "The data is kept in India (Mumbai), separate from every other firm, and only people in your firm can see it. You can disconnect this computer at any time.</p>" +
        '<label class="f" style="margin-top:8px"><span>Name for this computer</span><input type="text" id="tcName" value="' + esc((Bridge.st.computer || "Office computer")) + '"></label>',
      read: () => (document.getElementById("tcName") || {}).value || "", validate: v => String(v).trim() ? "" : "Give the computer a name."});
    if (!r || !r.ok) return;
    const p = this.pane; p.busy = "Connecting this computer…"; render();
    try {
      const d = await this.rpc("tally_device_create", {p_name: String(r.data).trim()});
      const j = await Bridge.call("/cloudlink", {url: this.ingestUrl(), key: d.key}, 60000);
      toast("This computer is connected to " + (j.firm || "the firm") + ". Linked companies start going to the cloud within a few minutes.");
    } catch (e){
      const m = (e && e.message) || String(e);
      toast(/Unknown address|No such/i.test(m) ? "This needs Tally Bridge 1.13.0 or later. Download the new setup from Settings, Tally Bridge." : "Could not connect: " + m);
    }
    p.busy = ""; await this.refreshPane();
  },
  async revoke(id, name){
    const r = await askConfirm({title: "Remove " + name + "?", ok: "Remove it", danger: true, body: "<p>That computer will not be able to send anything to the cloud any more. What it sent stays. To send again, connect it again.</p>"});
    if (!r || !r.ok) return;
    try { await this.rpc("tally_device_revoke", {p_id: id}); toast(name + " removed."); } catch (e){ toast("Could not remove it: " + ((e && e.message) || e)); }
    await this.refreshPane();
  },
  async link(company, client){
    try { await this.rpc("tally_company_link", {p_company: company, p_client: client || null}); toast(client ? company + " is linked to " + ((CO(client) || {}).name || "the client") + ". Its books go to the cloud within a few minutes." : company + " is no longer linked."); }
    catch (e){ toast("Could not link it: " + ((e && e.message) || e)); }
    await this.refreshPane();
  },
  view(){
    const p = this.pane;
    if (!this.on()) return '<div class="pane"><p class="note">Sign in to the firm account to keep the books in FinCom’s cloud.</p></div>';
    if (p.devices === null && !p.busy && !p.err) setTimeout(() => this.refreshPane(), 0);
    const when = s => s ? new Date(s).toLocaleString("en-IN", {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}) : "never";
    const cos = Object.values(S.companies || {}).filter(c => !c.deleted).sort((a, c) => a.name.localeCompare(c.name));
    let h = '<div class="pane"><h2>Books in FinCom’s cloud</h2><p class="note" style="margin:0 0 12px">The bridge on each connected computer sends the books of the Tally companies it keeps in step. ' +
      "Then Look up, Reports and the books open on any computer or phone, even with Tally closed, and a trial balance or ledger for any date comes back in a moment. Kept in India, for your firm only.</p>" +
      (p.err ? '<p class="note bad">' + esc(p.err) + "</p>" : "") + (p.busy ? '<p class="note">' + esc(p.busy) + "</p>" : "") +
      '<div class="row"><button class="btn primary" data-tc="connect">Connect this computer</button><button class="btn small" data-tc="refresh">Refresh</button></div></div>';
    const dv = (p.devices || []).filter(d => !d.revoked);
    h += '<div class="pane"><h3 style="margin-top:0">Computers that send</h3>' + (dv.length ? '<div class="tblwrap"><table class="data"><thead><tr><th>Computer</th><th>Last heard from</th><th>Bridge</th><th></th></tr></thead><tbody>' +
      dv.map(d => "<tr><td>" + esc(d.name) + ((d.info || {}).computer ? '<div class="nr">' + esc(d.info.computer) + (d.info.user ? " · " + esc(d.info.user) : "") + "</div>" : "") + "</td><td>" + when(d.last_seen) + "</td><td>" + esc(d.version || "—") +
        '</td><td class="n"><button class="btn small" data-tc="revoke" data-tcid="' + esc(d.id) + '" data-tcname="' + esc(d.name) + '">Remove</button></td></tr>').join("") + "</tbody></table></div>"
      : '<p class="note">None yet. On the computer with Tally and the bridge, press “Connect this computer”.</p>') + "</div>";
    const cl = p.companies || [];
    h += '<div class="pane"><h3 style="margin-top:0">Tally companies and clients</h3><p class="note" style="margin:0 0 8px">A company named in Tally as a client’s “Tally name” is linked by itself. ' +
      "Link the others here. A company whose GSTIN is not the client’s cannot be linked, so no one’s books land in the wrong client.</p>" +
      (cl.length ? '<div class="tblwrap"><table class="data"><thead><tr><th>Company in Tally</th><th>GSTIN</th><th>Client in FinCom</th><th>Last seen</th></tr></thead><tbody>' +
        cl.map(c => "<tr><td>" + esc(c.company) + "</td><td>" + esc(c.gstin || "—") + '</td><td><select data-tclink="' + esc(c.company) + '"><option value="">— not linked —</option>' +
          cos.map(k => '<option value="' + esc(k.id) + '"' + (k.id === c.client_id ? " selected" : "") + ">" + esc(k.name) + "</option>").join("") + "</select></td><td>" + when(c.last_seen) + "</td></tr>").join("") + "</tbody></table></div>"
        : '<p class="note">No Tally companies have been seen yet. They appear here once a connected computer has a company open in Tally.</p>') + "</div>";
    return h;
  },
  // what Look up shows about the cloud copy
  bar(cid){
    const bk = this.book(cid); if (!bk) return "";
    const st = bk.state || {}, sk = [].concat(st.skipped || []).filter(Boolean);
    let t = "<b>From FinCom’s cloud</b>: " + (st.phase === "first" ? "the first copy is still being made (up to " + esc(FC.when(String(st.doneTo || ""))) + ")" : esc(this.age(bk))) + ".";
    if (sk.length) t += ' <span class="bad"><b>' + sk.length + (sk.length === 1 ? " day" : " days") + " not read yet</b> from Tally.</span>";
    if (st.trouble && st.trouble.at) t += ' <span class="note">Tally did not answer at ' + esc(String(st.trouble.at).slice(11, 16)) + "; the bridge carries on by itself.</span>";
    const q = Math.max(0, Math.floor(Number(st.queue) || 0));
    if (q) t += ' <span class="note">' + q + " day" + (q === 1 ? "" : "s") + " waiting to be sent.</span>";
    return t;
  }
};
(function(){
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-tc]");
    if (!t) return;
    const a = t.dataset.tc;
    if (a === "connect") TCloud.connect();
    else if (a === "refresh") TCloud.refreshPane();
    else if (a === "revoke") TCloud.revoke(t.dataset.tcid, t.dataset.tcname);
  });
  document.addEventListener("change", e => {
    const t = e.target.closest && e.target.closest("[data-tclink]");
    if (t) TCloud.link(t.dataset.tclink, t.value);
  });
})();
// FinCom opened by the FinCom Connector's "Connect FinCom on this computer": the page's address carries the bridge's
// one-time connect code (#pair=123456). It is taken off the address at once, and used to connect to the bridge.
(function(){
  const take = () => {
    const m = String(location.hash || "").match(/(?:^#|&)pair=(\d{6})\b/);
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e){ location.hash = ""; }
    const code = m[1];
    const go = async () => {
      try {
        const j = await Bridge.pair(code);
        toast("Connected to the Tally Bridge on " + (j.computer || "this computer") + ".");
        try { await Bridge.refresh(); } catch (e){}
        render();
      } catch (e){ toast("Could not connect to the bridge: " + ((e && e.message) || e) + " Press “Connect FinCom on this computer” in FinCom Connector again."); }
    };
    // after the page has drawn itself
    setTimeout(go, 600);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", take); else take();
})();

// Files exported from Tally and chosen in FinCom (the day book part by part, the trial balance) go to FinCom's cloud
// too, into the same copy a connected computer fills: everyone in the firm then works on the same books, from any
// computer. Every day of the dates chosen is sent (an empty day as empty, so a deleted entry goes too)
const TCloudUp = {
  on(){ return typeof Cloud === "object" && Cloud.on() && !!(Cloud.st && Cloud.st.firm); },
  b64(u){ let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
  async gz(text){ const cs = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")); return this.b64(new Uint8Array(await new Response(cs).arrayBuffer())); },
  async post(body){
    const c = Cloud.cfg(), s = Cloud.sess();
    if (!s) throw new Error("Sign in to the firm account first.");
    const r = await fetch(TCloud.ingestUrl(), {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"}, body: JSON.stringify(Object.assign({client: S.coId, company: BridgeSeed.company()}, body))});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || ("FinCom's cloud answered with error " + r.status));
    return j;
  },
  async days(text, range, onStep){
    if (!this.on()) return {skipped: "not signed in to the firm account"};
    const re = /<VOUCHER\b[\s\S]*?<\/VOUCHER>/g, byDay = new Map();
    let m;
    while ((m = re.exec(text))){ const d = (m[0].match(/<DATE>(\d{8})<\/DATE>/) || [])[1]; if (!d || d < range.from || d > range.to) continue; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(m[0]); }
    const all = []; for (let d = range.from; d <= range.to; d = BridgeSeed.add(d, 1)) all.push(d);
    let batch = [], size = 0, sent = 0, done = 0;
    const flush = async () => { if (!batch.length) return; if (onStep) onStep("Putting the day book in FinCom’s cloud (" + Math.round(done * 100 / all.length) + "%), for everyone in the firm…"); const j = await this.post({kind: "upload_days", days: batch}); sent += (j.done || []).length; batch = []; size = 0; };
    for (const d of all){
      const xml = "<ENVELOPE><BODY><DATA>" + (byDay.get(d) || []).map(v => "<TALLYMESSAGE>" + v + "</TALLYMESSAGE>").join("") + "</DATA></BODY></ENVELOPE>";
      const gz = await this.gz(xml);
      if (batch.length && (size + gz.length > 12e6 || batch.length >= 31)) await flush();
      batch.push({day: d, gz}); size += gz.length; done++;
    }
    await flush();
    return {days: sent};
  },
  async opening(from, asOn, led){
    if (!this.on()) return {skipped: "not signed in to the firm account"};
    return this.post({kind: "upload_ledgers", from, openAsOn: asOn, ledgers: Object.entries(led).map(([n, x]) => [n, x.parent || "", String(x.open)])});
  }
};

