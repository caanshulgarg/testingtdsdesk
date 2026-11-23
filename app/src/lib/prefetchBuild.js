// next-speed-2 (the speed plan, #8): a newer build is out (fresh.js note: the calm bar "A new version of FinCom is ready").
// Its first page's files (its program legacy.js?v=…, the app's entry and styles, the two faces it preloads: every one
// with its build's hash in its name or address) are fetched now, quietly and one after another, so pressing Reload (or
// the quiet reload of a hidden tab) opens the new build from this computer (the browser's cache and the service worker's
// kept files) instead of the line. Once per build; never on a slow line or one that saves data (lineSlow); any failure
// only means Reload fetches them as before. The page itself is read past every cache and only looked at.
import { lineSlow } from "../screens/lazy.js";
const done = new Set();
export async function prefetchBuild(build) {
  if (!build || done.has(build)) return;
  done.add(build);
  try {
    if (lineSlow()) return;
    const r = await fetch("./?v=" + encodeURIComponent(build), { cache: "no-store" });
    if (!r.ok) return;
    const html = await r.text();
    if (!html.includes(build)) return;      // not that build's page (a cache or a proxy in between)
    const files = [];
    const add = (u) => { if (u && !files.includes(u)) files.push(u); };
    for (const m of html.matchAll(/<script defer src="\.\/(legacy\.js\?v=[\w-]+)"/g)) add(m[1]);
    for (const m of html.matchAll(/<link rel="(?:modulepreload|stylesheet)" crossorigin href="\.\/(assets\/[\w.-]+\.(?:js|css))"/g)) add(m[1]);
    for (const m of html.matchAll(/<script type="module" crossorigin src="\.\/(assets\/[\w.-]+\.js)"/g)) add(m[1]);
    for (const m of html.matchAll(/<link rel="preload" as="font" type="font\/woff2" crossorigin href="\.\/(assets\/[\w.-]+\.woff2)"/g)) add(m[1]);
    for (const f of files) {
      // the same way the page asks for each (a module, a style, a font: with its crossorigin), so the copy is used
      const res = await fetch("./" + f, { mode: /^legacy/.test(f) ? "no-cors" : "cors", credentials: "same-origin", priority: "low" }).catch(() => null);
      if (res) await res.arrayBuffer().catch(() => null);
    }
  } catch (e) { /* Reload fetches them as before */ }
}
