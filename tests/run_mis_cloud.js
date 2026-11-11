// node run_mis_cloud.js IN.json ANSWERS.json OUT.json - next-cloud-mis: the MIS page's run from FinCom's cloud against the
// browser's own, on the made-up books tests/run_migration152.py wrote (IN.json, as run_migration152.js reads them) and the
// answers the real mis-run handler gave for them on the throwaway database (ANSWERS.json: {period: {first, second}}, the
// second as kept, from jsonb). The browser is this tree's (TDSDESK_HTML, built by its build.py). For each period:
//   1. MIS.fromCloud(answer) (src/js/18-mis-pack.js) equals MIS.runNow on the same books, every value of the run except
//      when and how it ran (at, how, the history's at and how) and where (cloud): the first answer and the kept one
//   2. the fingerprint guard (MIS.cloudFits): the answer fits only the books whose cloud version was kept with them
//      (meta.cloud.ver and verWork); another version, another book, another MIS working, a partial answer, an entry
//      added here or an MSME type changed here: it does not
//   3. MIS.cloudGo (the first period only): fits: the run from the cloud, saved, nothing worked out here; does not fit:
//      worked out here (local) and the cloud not asked again; the version not kept here: worked out here and the cloud
//      asked in the background (the refresh)
// OUT.json: {period: {diffs, fits, go}}; the Python side reports it.
const fs = require("fs"), {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B",
  "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "FC", "LK", "Rec", "TallyRead", "choiceSplit", "choiceAcc", "choiceLegacy", "choiceRec", "choiceDerive", "choiceGet", "choiceUsable", "MisCloud"];
const all = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), answers = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const inp = Object.assign({}, all.books, {saved: all.saved, company: all.company, periods: all.periods});
// the books as TCloud.load puts them together (as tests/run_migration152.js), in a fresh context each time, so nothing
// one run kept is used by the other
function books(){
  const {ctx, x} = load(HTML, NAMES);
  const b = {cid: inp.cid, meta: {from: inp.from, company: "Made-up Heron Traders"}, vouchers: JSON.parse(JSON.stringify(inp.vouchers))};
  b.vouchers.forEach(v => { v.ent.forEach(e => { if (!e.b) delete e.b; }); });
  b.groups = {}; (inp.groups || []).forEach(g => { b.groups[g.name] = g.parent || ""; });
  x.TallyRead.balances(b, {ledgers: inp.ledgers.map(l => ({name: l.name, parent: l.parent, open: String(l.open), close: ""}))}, inp.from, inp.today);
  b.tb.src = "copy"; if (String(b.tb.to) < inp.today) b.tb.to = inp.today;
  b.tb.at = "2026-11-09T06:00:00.000Z";       // when the books came in: the same for every context here (MIS.basis reads it)
  Object.assign(b, JSON.parse(JSON.stringify(inp.work)));
  b.map = x.Books.mapLedgers(b.vouchers, inp.saved || {});
  ctx.S.books = b; ctx.S.coId = b.cid; ctx.S.companies = {[b.cid]: inp.company}; ctx.CO = () => Object.assign({id: b.cid, name: "Made-up Heron Traders"}, inp.company);
  return {ctx, x, b};
}
// every difference: numbers exactly, keys both ways, lists in order
function diff(w, g, path, out){
  if (out.length > 12) return;
  if (w === g) return;
  if (typeof w === "number" && typeof g === "number"){ if (w !== g && !(isNaN(w) && isNaN(g))) out.push([path, w, g]); return; }
  if (w && g && typeof w === "object" && typeof g === "object"){
    if (Array.isArray(w) !== Array.isArray(g)){ out.push([path, "kind"]); return; }
    if (Array.isArray(w)){ if (w.length !== g.length){ out.push([path, "length", w.length, g.length]); return; } w.forEach((v, i) => diff(v, g[i], path + "[" + i + "]", out)); return; }
    const kw = Object.keys(w).sort(), kg = Object.keys(g).sort();
    if (kw.join("\u0001") !== kg.join("\u0001")){ out.push([path, "keys", kw.filter(k => !(k in g)).slice(0, 5), kg.filter(k => !(k in w)).slice(0, 5)]); return; }
    kw.forEach(k => diff(w[k], g[k], path + "." + k, out)); return;
  }
  out.push([path, w, g]);
}
const plain = (r) => { const o = JSON.parse(JSON.stringify(r)); delete o.at; delete o.how; delete o.cloud; return o; };
const out = {};
inp.periods.forEach(([from, to], pi) => {
  const k = from + "|" + to, A = answers[k], res = {diffs: {}, fits: {}, go: null};
  out[k] = res;
  if (!A){ res.missing = true; return; }
  // 1. the browser's own run, then the run from each answer (each in its own context)
  const [local, hist] = (() => { const L = books(); return [plain(L.x.MIS.runNow(from, to, "test")), L.b.mis.history.map(h => { const o = Object.assign({}, h); delete o.at; delete o.how; return o; })]; })();
  for (const which of ["first", "second"]){
    const c = Object.assign({}, A[which].result, {kept: !!A[which].kept});
    const C = books(); const r = C.x.MIS.fromCloud(c, "test");
    const d = [];
    if (!r) d.push(["fromCloud", "none"]);
    else {
      diff(local, plain(r), "r", d);
      diff(hist, C.b.mis.history.map(h => { const o = Object.assign({}, h); delete o.at; delete o.how; return o; }), "history", d);
      if (!r.cloud || r.cloud.at !== c.at || r.cloud.kept !== !!A[which].kept) d.push(["r.cloud", r.cloud]);
    }
    res.diffs[which] = d;
    res.code = [local.code, r && r.code];
  }
  // 2. the fingerprint guard
  const G = books(), M = G.x.MIS, c = Object.assign({}, A.first.result);
  G.ctx.Cloud = {on: () => true, sess: () => ({access_token: "made-up"})};
  const keep = () => { G.b.meta.cloud = {book: c.book, ver: c.version, verWork: M.cloudWork(G.b)}; };
  keep();
  res.fits.same = M.cloudFits(G.b, c);
  res.fits.otherVersion = M.cloudFits(G.b, Object.assign({}, c, {version: "another"}));
  res.fits.otherBook = M.cloudFits(G.b, Object.assign({}, c, {book: "00000000-0000-0000-0000-000000000000"}));
  res.fits.otherWorking = M.cloudFits(G.b, Object.assign({}, c, {misV: M.V + 1}));
  res.fits.noWorking = M.cloudFits(G.b, Object.assign({}, c, {misV: undefined}));
  res.fits.partial = M.cloudFits(G.b, Object.assign({}, c, {partial: true}));
  res.fits.notSignedIn = (G.ctx.Cloud.sess = () => null, M.cloudFits(G.b, c)); G.ctx.Cloud.sess = () => ({access_token: "made-up"});
  const v0 = G.b.vouchers.pop(); res.fits.entryChanged = M.cloudFits(G.b, c); G.b.vouchers.push(v0);
  const sup = Object.keys(G.b.msme || {})[0] || "Made-up Supplier"; const was = (G.b.msme || {})[sup];
  G.b.msme = Object.assign({}, G.b.msme, {[sup]: was === "Micro" ? "Small" : "Micro"}); res.fits.msmeChanged = M.cloudFits(G.b, c); G.b.msme[sup] = was;
  res.fits.sameAgain = M.cloudFits(G.b, c);
  // 3. MIS.cloudGo on the first period
  if (pi === 0){
    const go = {};
    const run = async (answer, kept) => {
      const H = books(), N = H.x.MIS, asked = [], saved = [];
      H.ctx.Cloud = {on: () => true, sess: () => ({access_token: "made-up"}), fn: async (name, body) => { asked.push([name, body]); return {ok: true, kept: false, result: answer}; }};
      H.ctx.setTimeout = setTimeout; H.ctx.clearTimeout = clearTimeout; H.ctx.memoScope = (f) => f(); H.ctx.saveBooks = async (o, b) => { saved.push(!!b); }; H.ctx.render = () => {};
      if (kept) H.b.meta.cloud = {book: c.book, ver: c.version, verWork: N.cloudWork(H.b)}; else H.b.meta.cloud = {book: c.book};
      let here = 0;
      const w = await N.cloudGo(from, to, "test", () => { here++; N.run(from, to, "test"); });
      await new Promise((r) => setTimeout(r, 0));
      return {w, here, asked: asked.map((a) => [a[0], a[1].action, a[1].client, a[1].from, a[1].to]), saved: saved.length, cloud: !!(H.b.mis && H.b.mis.last && H.b.mis.last.cloud), again: N._again};
    };
    // one after the other: one set of books in memory at a time (the 40,000-entry book)
    (async () => [await run(c, true), await run(Object.assign({}, c, {version: "another"}), true), await run(c, false)])().then(([a, b2, c2]) => {
      go.fits = a; go.other = b2; go.notKept = c2; res.go = go;
      fs.writeFileSync(process.argv[4], JSON.stringify(out));
    });
  }
});
fs.writeFileSync(process.argv[4], JSON.stringify(out));      // again with 3. once MIS.cloudGo has answered
