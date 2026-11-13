// node tests/run_zoho_connect_bound.js - the page's side of connecting Zoho Books (13-Nov-2026, security review M3):
// the sign-in to Zoho is begun with the hash of a value kept for the tab, and finished by the same tab with the value
// itself and the person's FinCom sign-in. src/js/74-zoho-books.js and the router's lines, run here with stand-ins
// (no browser, no network).
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

function page() {
  const store = new Map(), calls = [], toasts = [];
  const ctx = {
    S: { account: { me: { role: "owner" } } }, calls, toasts, store,
    sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    location: { origin: "https://app.fincom.live", pathname: "/", href: "" },
    crypto: crypto.webcrypto, TextEncoder, toast: (t) => toasts.push(t), render: () => {}, console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/js/74-zoho-books.js"), "utf8") + "\n;globalThis.ZohoB = ZohoB;", ctx);
  ctx.answer = { ok: true, url: "https://accounts.zoho.in/oauth/v2/auth?state=s" };
  ctx.ZohoB.call = async (b) => { calls.push(JSON.parse(JSON.stringify(b))); return ctx.answer; };
  return ctx;
}

(async () => {
  let p = page();
  await p.ZohoB.connect();
  const start = p.calls[0] || {}, kept = [...p.store.values()][0] || "";
  ok(start.kind === "connect_start" && /^[0-9a-f]{64}$/.test(start.nonce_hash || "") && /^[0-9a-f]{64}$/.test(kept), "connect: a value is kept for the tab and its hash sent");
  ok(start.nonce_hash === sha(kept) && start.nonce_hash !== kept && !JSON.stringify(start).includes(kept), "connect: the function is sent the SHA-256, never the value");
  ok(p.location.href === p.answer.url, "connect: then Zoho's own page");
  const q = page(); await q.ZohoB.connect();
  ok([...q.store.values()][0] !== kept, "each connect makes a new value");

  // back from Zoho: the router keeps the code and the state for the page; finish() sends them with the tab's value
  p.calls.length = 0; p.S.zohoFinish = { code: "c-1", state: "st-1" }; p.answer = { ok: true, grant: "g-1" };
  const r = await p.ZohoB.finish();
  ok(JSON.stringify(p.calls) === JSON.stringify([{ kind: "connect_finish", code: "c-1", state: "st-1", nonce: kept }]), "finish: the code, the state and the tab's value, once");
  ok(r.ok && p.S.zohoGrant === "g-1" && p.S.zohoFinish === null && p.store.size === 0, "finish: the sign-in's organisations are shown; the value and the code are let go");
  await p.ZohoB.finish();
  ok(p.calls.length === 1, "finish again: nothing more is asked");

  // another tab or browser (no value kept): nothing is asked of the function
  p = page(); p.S.zohoFinish = { code: "c-2", state: "st-2" };
  await p.ZohoB.finish();
  ok(p.calls.length === 0 && p.S.zohoBack === "expired" && !p.S.zohoGrant, "a tab that did not begin the sign-in asks nothing and says it expired");

  // the function's refusal is shown in the page's words
  p = page(); await p.ZohoB.connect(); p.calls.length = 0; p.S.zohoFinish = { code: "c-3", state: "st-3" }; p.answer = { ok: false, why: "expired" };
  await p.ZohoB.finish();
  ok(p.S.zohoBack === "expired" && !p.S.zohoGrant, "a refusal from the function: said, no organisations shown");

  // the router: the code and the state leave the address at once
  const routes = fs.readFileSync(path.join(ROOT, "src/js/52-routes.js"), "utf8");
  ok(/qs\.get\("zcode"\) && qs\.get\("zstate"\)/.test(routes) && /S\.zohoFinish = \{code: qs\.get\("zcode"\), state: qs\.get\("zstate"\)\}/.test(routes) && /history\.replaceState\(history\.state, "", location\.pathname \+ location\.search \+ "#\/integrations\/zoho"\)/.test(routes),
    "the router keeps the code for the page and takes it out of the address");
  ok(/S\.zohoFinish \? ZohoB\.finish\(\)/.test(fs.readFileSync(path.join(ROOT, "app/src/screens/Integrations.jsx"), "utf8")), "the Zoho page finishes a sign-in that came back before it reads");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
