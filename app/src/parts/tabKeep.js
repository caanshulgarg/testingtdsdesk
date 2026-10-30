// Every page's tab rows keep their tab over a Refresh (the owner, 30-Oct-2026: "when I refresh the page, it takes me to
// the first tab of the page, whichever tab I was on; it should stay on the same tab"). One mechanism for every row, not
// one per screen: a tab row is a nav.sbar / nav.tabs / nav.bk-tabs / [role=tablist] with an aria-label (PageTabs and the
// hand-drawn rows alike). A tab picked in a row that the page's address does not already carry (Route.of(), src/js/52:
// the Books part, a TDS return's step, a GST return's part, Settings' section… are carried there) is kept after the
// page's address, …?t=<row>:<tab>[,<row>:<tab>] (before a detail's ?d=), replacing the address (a tab is not a new step
// of Back). Opening that address again (Refresh, Back/Forward, a link) picks the same tabs once the rows are drawn: the
// row's own button is clicked, so the screen does whatever its tab needs. The tabs belong to the page they were picked on:
// another page starts with none. A row inside a dialog or the assistant is not kept.
import { FinComNav } from "../nav.js";

const ROWS = 'nav.sbar, nav.tabs, nav.bk-tabs, [role="tablist"]';
const SKIP = '[role="dialog"], [data-tabs-keep="no"]';
const NOISE = /^data-(on|orientation|disabled|highlighted|radix)/;
let at = null, map = {}, tried = {}, picked = {}, obs = null, queued = false, since = 0;

const routeOf = () => { try { return typeof Route === "object" ? Route.of() : ""; } catch (e) { return ""; } };
// the tabs kept belong to one page: another page's address starts with none
function page(h) { if (h !== at) { at = h; map = {}; tried = {}; picked = {}; } }
// the rows of the page: the innermost match (a Radix list inside a nav.sbar is the row), with a name
function rows() {
  const app = document.getElementById("app");
  if (!app) return [];
  return [...app.querySelectorAll(ROWS)].filter((r) => !r.querySelector(ROWS) && !r.closest(SKIP) && r.getAttribute("aria-label"));
}
// a row's key: its name, and "#2", "#3" for a second and third row of the same name on the page
function keyOf(row, all) {
  const l = row.getAttribute("aria-label"), same = all.filter((r) => r.getAttribute("aria-label") === l);
  const i = same.indexOf(row);
  return i > 0 ? l + "#" + (i + 1) : l;
}
function tabsOf(row) {
  const all = [...row.querySelectorAll("button")].filter((b) => b.closest(ROWS) === row);
  const t = all.filter((b) => b.hasAttribute("aria-selected") || b.getAttribute("role") === "tab");
  return t.length ? t : all;
}
// a tab's name: its own data- id when it has one (data-fin-tab="cf"), else its words without its count
function idOf(b) {
  for (const a of b.attributes) if (a.name.startsWith("data-") && a.value && !NOISE.test(a.name)) return a.value;
  const c = b.cloneNode(true);
  c.querySelectorAll('.sbar-n, [aria-hidden="true"], [role="img"]').forEach((x) => x.remove());
  return c.textContent.replace(/\s*\(\d[\d,]*\)\s*$/, "").replace(/\s+/g, " ").trim();
}
const isOn = (b) => b.getAttribute("aria-selected") === "true" || (b.getAttribute("aria-current") || "false") !== "false" || b.classList.contains("on");
function rowByKey(key, all) { return all.find((r) => keyOf(r, all) === key) || null; }

function write() {
  if (typeof Route !== "object" || !Route.ready) return;
  try { Route.replaceNext = true; Route.sync(); } catch (e) { /* the address is written at the next drawing */ }
}
// after a pick: once the page has settled (a page change asked for by a click waits a frame, FinComNav.go)
function settle(fn, n = 0) {
  requestAnimationFrame(() => setTimeout(() => { if (FinComNav.busy() && n < 40) settle(fn, n + 1); else fn(); }, 0));
}
document.addEventListener("click", (ev) => {
  const b = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  const row = b && b.closest(ROWS);
  if (!row || row.closest(SKIP) || !row.getAttribute("aria-label") || !tabsOf(row).includes(b)) return;
  const all = rows();
  if (!all.includes(row)) return;
  const key = keyOf(row, all), id = idOf(b), before = routeOf();
  settle(() => {
    // the address changed: the row is carried by the address itself (or the page changed); nothing to keep
    if (routeOf() !== before) return;
    page(before);
    tried[key] = true; map[key] = id;
    // rows no longer drawn (inside the part the pick replaced) are let go
    const now = rows(), names = now.map((r) => keyOf(r, now));
    Object.keys(map).forEach((k) => { if (tried[k] && !names.includes(k)) delete map[k]; });
    write(); watch();
  });
}, true);

// the page drawn again: tabs still to pick are picked, outer rows first (the order they were picked in); a tab changed by
// the page itself (not by a click) is followed
function step() {
  queued = false;
  if (at !== routeOf()) { stop(); return; }
  const all = rows();
  let changed = false;
  for (const key of Object.keys(map)) {
    const row = rowByKey(key, all);
    if (!row) continue;
    const tabs = tabsOf(row);
    if (!tried[key]) {
      const b = tabs.find((x) => idOf(x) === map[key]);
      if (!b) continue;
      tried[key] = true; picked[key] = Date.now();
      if (!isOn(b) && !b.disabled) { b.click(); return; }   // the rest once the page is drawn again
      continue;
    }
    const on = tabs.find(isOn);
    if (on && idOf(on) !== map[key] && Date.now() - (picked[key] || 0) > 1500) { map[key] = idOf(on); changed = true; }
  }
  if (changed) write();
  if (!Object.keys(map).length || (Object.keys(map).every((k) => tried[k]) && Date.now() - since > 60000)) stop();
}
function watch() {
  if (!Object.keys(map).length) { stop(); return; }
  since = Date.now();
  if (!obs) {
    obs = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(step); } });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "class"] });
  }
  if (!queued) { queued = true; requestAnimationFrame(step); }
}
function stop() { if (obs) { obs.disconnect(); obs = null; } }

window.FCTabs = {
  // the end of the page's address for its tabs (Route.sync and Route.full)
  suffix(h) {
    page(h);
    const k = Object.keys(map);
    return k.length ? "?t=" + k.map((x) => encodeURIComponent(x) + ":" + encodeURIComponent(map[x])).join(",") : "";
  },
  // an address opened (Route.apply): its tabs, for the page it opened (h)
  want(v, h) {
    at = h; map = {}; tried = {}; picked = {};
    String(v || "").split(",").forEach((p) => {
      const i = p.indexOf(":");
      if (i <= 0) return;
      try { map[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); } catch (e) { /* a broken part is left out */ }
    });
    watch();
  },
};
