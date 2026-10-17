/* ================================================================== */
/* 2B matched by itself (round 72b, the owner's request of 16-Oct:     */
/* "minimum work should be with the user"). The matching runs on the  */
/* server (gst-2b-match): after a 2B is fetched there, and from here  */
/* when a 2B is brought in, when the purchases of the year change, or */
/* on "Match again". The rules (server/_shared/match2b.js, the same   */
/* file here and on the server) first, then one Claude call for what  */
/* is left. The screen part is app/src/screens/gst/TwoBAuto.jsx.      */
/* ================================================================== */
// Hook for the 2B screen (and its redesign, branch next-gst-portal): M2B.view(reg) gives the run for the registration and
// the year of S.gstYm; M2B.statusOf2b(key) / M2B.statusOfBook(id) give each document's status:
//   "matched-rules" | "matched-ai" | "probable" | "mismatch" | "2b-only" | "books-only".
const M2B = {
  st: {},                                           // reg|fy -> {run, hash, busy, err, at}
  url(){ return String(Cloud.cfg().url || "").replace(/\/+$/, "") + "/functions/v1/gst-2b-match"; },
  fyOf(ym){ const y = +String(ym).slice(0, 4), m = +String(ym).slice(4, 6); const s = m >= 4 ? y : y - 1; return s + "-" + String((s + 1) % 100).padStart(2, "0"); },
  months(fy){ const y = +String(fy).slice(0, 4), out = []; for (let m = 4; m <= 15; m++) out.push((m <= 12 ? y : y + 1) + String(m <= 12 ? m : m - 12).padStart(2, "0")); return out; },
  fyNow(){ const ms = (typeof GSTR === "object" && GSTR.months) ? GSTR.months() : []; return this.fyOf(S.gstYm || ms[ms.length - 1] || new Date().toISOString().slice(0, 7).replace("-", "")); },
  gstinOf(reg){ return ((typeof GSTR === "object" && GSTR.gstins(S.books)) || []).find(g => g.slice(0, 2) === reg) || ((GST2B.all2b(reg)[0] || {}).gstin) || ""; },
  key(reg, fy){ return (reg || "") + "|" + fy; },
  // AI only where the firm's AI help is on for 2B (Settings, AI help) and the client is not left out of it
  aiAllowed(){ return typeof AIH === "object" && AIH.enabled("r2b"); },
  // the year's 2B documents (not those rejected in IMS: no credit, nothing to match) and the purchases, as GST2B.run reads
  // them (its result is kept until the books or the 2Bs change, so this is cheap on every render)
  _in: new WeakMap(),
  inputs(reg, fy){
    const r = GST2B.run(reg), c = this._in.get(r);
    if (c && c.fy === fy) return c.x;
    const months = new Set(this.months(fy)), periods = {};
    (r.portal || []).filter(p => months.has(p.ym) && /^\d{6}$/.test(String(p.period))).forEach(p => { (periods[p.period] = periods[p.period] || []).push(m2bRow2b(p)); });
    const books = (r.books || []).filter(d => months.has(d.ym)).map(m2bRowBk);
    const x = {periods, twob: [].concat(...Object.values(periods)), books};
    x.hash = this.hash(x);
    this._in.set(r, {fy, x});
    return x;
  },
  hash(x){ const s = JSON.stringify([x.books, Object.keys(x.periods).sort().map(p => [p, x.periods[p]])]); let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16) + ":" + s.length; },
  // why the next run runs: a 2B just brought in or fetched says so (src/js/23, src/js/39)
  next: "",
  // the rules alone, here (no server, or signed out): the same file as the server's
  local(twob, books, decisions){ return m2bRulesOnly(twob, books, decisions || {}); },
  async call(body){
    await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), s = Cloud.sess();
    const r = await fetch(this.url(), {method: "POST", headers: {"Content-Type": "application/json", apikey: c.key, Authorization: "Bearer " + (s && s.access_token)}, body: JSON.stringify(body)});
    let j = null; try { j = await r.json(); } catch (e){}
    if (!j || !j.ok) throw Object.assign(new Error((j && j.error) || ("The 2B matching answered HTTP " + r.status + ".")), {kind: (j && j.kind) || "other"});
    return j;
  },
  online(){ return typeof Cloud === "object" && Cloud.on && Cloud.on() && Cloud.sess && Cloud.sess(); },
  // run (or, when nothing changed since the last run, read) the matching for the registration and year
  async sync(reg, why, force){
    const fy = this.fyNow(), k = this.key(reg, fy), s = this.st[k] = this.st[k] || {};
    if (s.busy) return;
    const x = this.inputs(reg, fy), h = x.hash;
    if (!force && s.hash === h && s.run) return;
    if (this.next && why !== "match again") why = this.next;      // a 2B just brought in or fetched says why
    this.next = "";
    const gstin = this.gstinOf(reg);
    if (!x.twob.length || !gstin){ s.hash = h; s.run = null; return; }
    s.busy = true; s.err = ""; s.hash = h; render();
    try {
      if (!this.online()) throw Object.assign(new Error("Not signed in to the firm account: matched here by the rules only."), {kind: "offline"});
      const j = await this.call({action: "run", client_id: S.books.cid, gstin, fy, why: why || "opened", ai: this.aiAllowed(),
        books: x.books, twob: Object.keys(x.periods).sort().map(p => ({period: p, rows: x.periods[p]}))});
      s.run = j.run;
    } catch (e){
      const res = this.local(x.twob, x.books, (s.run && s.run.decisions) || {});
      s.run = {local: true, result: res, counts: res.counts, line: m2bLine(res.counts), ai: {state: e.kind === "offline" ? "offline" : "failed", say: e.kind === "offline" ? e.message : "The server could not be reached (" + e.message + "): matched here by the rules only."}};
      s.err = e.message;
    }
    s.busy = false; s.at = Date.now(); render();
  },
  // called on every render of the 2B screen: the first time, and whenever the year's purchases or 2B change
  view(reg){
    const fy = this.fyNow(), s = this.st[this.key(reg, fy)] || {};
    try {
      const x = this.inputs(reg, fy);
      if (!s.busy && s.hash !== x.hash) setTimeout(() => this.sync(reg, s.run ? "new entries" : "opened"), 0);
    } catch (e){}
    return Object.assign({fy}, s);
  },
  statusMaps(reg){
    const s = this.st[this.key(reg, this.fyNow())], res = s && s.run && s.run.result;
    if (!res) return null;
    if (res._maps) return res._maps;
    const g = {}, b = {};
    (res.rows || []).forEach(r => { r.g.forEach(k => { g[k] = r.st; }); r.b.forEach(k => { b[k] = r.st; }); });
    (res.left2b || []).forEach(k => { g[k] = "2b-only"; }); (res.leftBooks || []).forEach(k => { b[k] = "books-only"; });
    Object.defineProperty(res, "_maps", {value: {g, b}, enumerable: false});
    return res._maps;
  },
  statusOf2b(key, reg){ const m = this.statusMaps(reg === undefined ? r2Reg(S.books) : reg); return m ? m.g[key] || "" : ""; },
  statusOfBook(id, reg){ const m = this.statusMaps(reg === undefined ? r2Reg(S.books) : reg); return m ? m.b[id] || "" : ""; },
  // a person's accept or reject of a probable pair (one, or all of them): kept on the server, and an accepted pair of one
  // 2B document is linked for the rest of the 2B screen as a link by hand is
  async decide(reg, pairs, decision){
    const fy = this.fyNow(), s = this.st[this.key(reg, fy)];
    if (!s || !s.run || s.busy || !pairs.length) return;
    s.busy = true; render();
    try {
      const j = await this.call({action: "decide", client_id: S.books.cid, gstin: this.gstinOf(reg), fy, pairs: pairs.map(p => p.id), decision});
      s.run = j.run;
      if (decision === "accept"){
        const st = GST2B.state();
        pairs.filter(p => p.g.length === 1).forEach(p => { st.link[p.g[0]] = p.b.slice(); delete st.confirm[p.g[0]]; });
        GST2B._memo = null; await saveBooks();
      }
    } catch (e){ toast("Could not keep it: " + e.message); }
    s.busy = false; render();
  }
};
// The 2B reconciliation's hook (app/src/screens/gst/reco.js autoFor): the automatic run's pairs for the registration, in
// its shape {results: [{key2b, books, status, reason, confidence, id}]}; mismatches stay with the reconciliation's own rules.
const GSTAutoMatch = {
  result(reg){
    const s = M2B.st[M2B.key(reg, M2B.fyNow())], res = s && s.run && s.run.result;
    if (!res) return null;
    const results = [];
    (res.rows || []).filter(r => r.st === "matched-rules" || r.st === "matched-ai" || r.st === "probable")
      .forEach(r => r.g.forEach(k => results.push({key2b: k, books: r.b.slice(), status: r.st, reason: (r.why || []).join("; "), confidence: null, id: r.id})));
    return {results};
  },
  decide(reg, id, decision){ if (id) m2bDecide(reg, [id], decision); }
};
if (typeof window !== "undefined") window.GSTAutoMatch = GSTAutoMatch;
function m2bAgain(reg){ M2B.sync(reg, "match again", true); }
function m2bDecide(reg, ids, decision){
  const s = M2B.st[M2B.key(reg, M2B.fyNow())], rows = ((s && s.run && s.run.result && s.run.result.rows) || []).filter(r => r.st === "probable" && ids.includes(r.id));
  M2B.decide(reg, rows, decision);
}
