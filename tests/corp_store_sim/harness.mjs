// A stand-in of FinCom's server for one scenario of Corporate's store (made-up rows only); after the review of 263c13939
// (its scripts, made into tests). Each scenario runs in its own process: tests/run_corp_store_sim.mjs.
export const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.LocalOwner = { P: "tdsdesk:", stale: false };
const ev = new EventTarget();
globalThis.window = { addEventListener: (t, f) => ev.addEventListener(t, f) };
let tick = 0;
export const st = () => "2026-11-07T10:00:00." + String(++tick).padStart(6, "0") + "+00:00";
export const srv = { corp_profiles: [], corp_filings: [], corp_documents: [] };
export const H = { log: [], fail: false, delay: {}, hook: null };
const parse = (path) => { const [t, q] = path.split("?"); const f = {}; (q || "").split("&").forEach((kv) => { const m = /^([a-z_]+)=eq\.(.*)$/.exec(kv); if (m) f[m[1]] = decodeURIComponent(m[2]); }); return { t, f }; };
const match = (r, f) => Object.entries(f).every(([k, v]) => String(r[k]) === v);
export const cp = (x) => JSON.parse(JSON.stringify(x));
export const W = (ms) => new Promise((r) => setTimeout(r, ms));
globalThis.Cloud = { on: () => true, st: { role: "owner" }, async api(path, o = {}) {
  const m = o.method || "GET", { t, f } = parse(path);
  H.log.push({ m, path, body: o.body ? cp(o.body) : null, at: Date.now() });
  if (H.hook) await H.hook(m, t, f, o);
  if (H.fail) throw new TypeError("Failed to fetch");
  // the server acts at once; its reply may be held (H.delay[m] ms)
  let res;
  const rows = srv[t];
  if (m === "GET") res = cp(rows.filter((r) => match(r, f)));
  else if (m === "POST") { if (rows.some((r) => r.client_id === o.body.client_id && (t === "corp_profiles" || (o.body.ref && r.ref === o.body.ref) || (o.body.id && r.id === o.body.id)))) throw new Error("duplicate key (23505)");
    const r = Object.assign({}, cp(o.body), { updated_at: st() }); rows.push(r); res = [cp(r)]; }
  else if (m === "PATCH") { const hit = rows.filter((r) => match(r, f)); hit.forEach((r) => Object.assign(r, cp(o.body), { updated_at: st() })); res = cp(hit); }
  else if (m === "DELETE") { const gone = rows.filter((r) => match(r, f)); srv[t] = rows.filter((r) => !gone.includes(r)); res = cp(gone); }
  if (H.delay[m]) await W(H.delay[m]);
  return res;
} };
let fails = 0;
export const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
export const done = () => { process.exit(fails ? 1 : 0); };
export const STORE = "../../app/src/screens/corp/store.js";
export const profile0 = (p) => srv.corp_profiles.push({ client_id: "c1", profile: p || {}, directors: [], shareholders: [], charges: [], letterhead: {}, updated_at: st() });
