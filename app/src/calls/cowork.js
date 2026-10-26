// "Work together" (option A, the owner's approval of 23-Oct-2026): during a call the host's FinCom screen is followed by
// the firm's signed-in members who can open the client: the same client and page (follow-me), a pointer per person with
// their name, and the field each is typing in outlined. Only the route, pointers and focus travel (Supabase Realtime
// broadcast on the call's own working-together channel, which the function gives to members only); every figure is read
// by each person's own FinCom with their own sign-in, and every change is saved by their own FinCom through its usual
// paths and rights (a look-only member stays look-only: the database refuses their save as it always does). A guest is
// never on this channel; they see the host's screen only if the host shares it.
import { channel } from "./realtime.js";
import { routeOf, routeClean, throttle, POINTER_MS } from "./rules.js";
import { subscribe } from "../store.js";

const COLORS = ["#4F46E5", "#059669", "#D97706", "#E11D48", "#0284C7", "#7C3AED"];
const colorOf = (id) => COLORS[Math.abs([...String(id)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % COLORS.length];
const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// a field's place on the page, from #app down (the same page on both sides gives the same path)
export function pathOf(el) {
  const app = document.getElementById("app"); if (!app || !el || !app.contains(el)) return "";
  const parts = [];
  for (let n = el; n && n !== app; n = n.parentElement) {
    const p = n.parentElement; if (!p) return "";
    const same = [...p.children].filter((c) => c.tagName === n.tagName);
    parts.unshift(n.tagName.toLowerCase() + (same.length > 1 ? ":nth-of-type(" + (same.indexOf(n) + 1) + ")" : ""));
  }
  return "#app > " + parts.join(" > ");
}

export function startCowork({ url, key, topic, me, name, hostId, isHost, onState }) {
  const ch = channel({ url, key, topic, presenceKey: me });
  let follow = !isHost, people = [], last = "", stopped = false, applying = false;
  const ptrs = new Map(), focus = new Map();
  ch.track({ id: me, name, host: !!isHost });
  ch.onPresence((list) => { people = list; draw(); tell(); });
  const tell = () => onState && onState({ follow, people: people.filter((p) => p.id !== me).map((p) => p.name), isHost });

  // the layer: pointers, outlines and the banner (pointer-events none: it never takes a click)
  const layer = document.createElement("div"); layer.className = "cw-layer"; layer.setAttribute("data-cowork-layer", "");
  const banner = document.createElement("div"); banner.className = "cw-banner"; banner.setAttribute("role", "status"); banner.setAttribute("data-cowork-banner", "");
  document.body.appendChild(layer); document.body.appendChild(banner);
  banner.addEventListener("click", (e) => { const b = e.target.closest("button[data-cw]"); if (!b) return; if (b.dataset.cw === "unfollow") setFollow(false); if (b.dataset.cw === "follow") setFollow(true); });
  function draw() {
    if (stopped) return;
    const others = people.filter((p) => p.id !== me).map((p) => esc(p.name));
    // the banner written again only when its words change (a button replaced under a finger misses the tap)
    const words = "<span>Working together with " + (others.join(", ") || "no one yet") + "</span>" + (isHost ? "" : follow
      ? " · following the host <button type='button' data-cw='unfollow'>Stop following</button>" : " <button type='button' data-cw='follow'>Follow the host</button>");
    if (banner.innerHTML !== words) banner.innerHTML = words;
    let html = "";
    for (const [id, p] of ptrs) {
      if (Date.now() - p.at > 8000 || p.route !== last) continue;
      html += "<div class='cw-ptr' style='left:" + Math.round(p.x * document.documentElement.clientWidth - window.scrollX) + "px;top:" + Math.round(p.y - window.scrollY) + "px;--c:" + colorOf(id) + "'><svg width='16' height='20' viewBox='0 0 16 20'><path d='M1 1l13 10-6 1-3 6z' fill='var(--c)' stroke='#fff'/></svg><span>" + esc(p.name) + "</span></div>";
    }
    for (const [id, f] of focus) {
      if (!f.path || f.route !== last) continue;
      let el = null; try { el = document.querySelector(f.path); } catch (e) { el = null; }
      if (!el) continue;
      const r = el.getBoundingClientRect();
      html += "<div class='cw-focus' data-cowork-focus='" + esc(f.name) + "' style='left:" + (r.left - 3) + "px;top:" + (r.top - 3) + "px;width:" + (r.width + 6) + "px;height:" + (r.height + 6) + "px;--c:" + colorOf(id) + "'><span>" + esc(f.name) + " is editing</span></div>";
    }
    if (layer.innerHTML !== html) layer.innerHTML = html;
  }
  const redraw = setInterval(draw, 500);
  window.addEventListener("scroll", draw, true);

  // the host's route, sent when it changes (and every 3 s for anyone who came late)
  const routeKey = () => JSON.stringify(routeOf(S));
  function sendRoute(force) { const k = routeKey(); if (force || k !== last) { last = k; ch.send("route", { from: me, route: routeOf(S) }); } }
  let unsub = null, every = null;
  if (isHost) { unsub = subscribe(() => sendRoute(false)); every = setInterval(() => sendRoute(true), 3000); sendRoute(true); }
  else { last = routeKey(); unsub = subscribe(() => { last = routeKey(); }); }
  ch.on("route", async (m) => {
    if (isHost || m.from !== hostId || !follow || applying) return;
    const r = routeClean(m.route);
    if (JSON.stringify(routeOf(S)) === JSON.stringify(routeOf(r))) return;
    applying = true;
    try {
      // a client this person cannot open (not on their list): they stop following, told why
      if (r.view === "company" && r.coId && r.coId !== S.coId) {
        if (!S.companies || !S.companies[r.coId]) { setFollow(false); toastSay("You cannot open this client, so you are no longer following."); return; }
        await openCompany(r.coId);
      }
      Object.assign(S, r);
      render();
      last = routeKey();
    } finally { applying = false; }
  });
  // pointers (about 20 a second) and the field being edited
  const sendPtr = throttle((x, y) => ch.send("ptr", { from: me, name, x, y, route: last }), POINTER_MS);
  const onMove = (e) => sendPtr((e.clientX + window.scrollX) / Math.max(1, document.documentElement.clientWidth), e.clientY + window.scrollY);
  const onFocus = (e) => { const t = e.target; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) ch.send("focus", { from: me, name, path: pathOf(t), route: last }); };
  const onBlur = (e) => { const t = e.target; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) ch.send("focus", { from: me, name, path: "", route: last }); };
  document.addEventListener("mousemove", onMove, { passive: true });
  document.addEventListener("focusin", onFocus); document.addEventListener("focusout", onBlur);
  ch.on("ptr", (m) => { if (m.from !== me) { ptrs.set(m.from, { x: Number(m.x) || 0, y: Number(m.y) || 0, name: m.name, route: m.route, at: Date.now() }); draw(); } });
  ch.on("focus", (m) => { if (m.from !== me) { focus.set(m.from, { path: String(m.path || "").slice(0, 600), name: m.name, route: m.route }); draw(); } });
  ch.on("end", () => stop());
  function setFollow(on) { follow = !!on; draw(); tell(); if (follow) ch.send("route-ask", { from: me }); }
  if (isHost) ch.on("route-ask", () => sendRoute(true));
  function toastSay(s) { try { toast(s); } catch (e) { /* */ } }
  function stop() {
    if (stopped) return; stopped = true;
    if (isHost) ch.send("end", { from: me });
    clearInterval(redraw); clearInterval(every); unsub && unsub();
    window.removeEventListener("scroll", draw, true);
    document.removeEventListener("mousemove", onMove); document.removeEventListener("focusin", onFocus); document.removeEventListener("focusout", onBlur);
    setTimeout(() => ch.close(), 100);
    layer.remove(); banner.remove();
    onState && onState(null);
  }
  draw(); tell();
  return { stop, setFollow, get follow() { return follow; } };
}
