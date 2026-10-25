// The way into calls from the rest of FinCom: a few lines in the app's first file; everything else (the call screen,
// realtime, media, effects, recording, the Meetings page) is fetched only when it is opened (never with the page).
import { staleReload } from "../staleChunk.js";
const load = (f) => f().catch((e) => { staleReload(e, true); throw e; });
export const loadCallScreen = () => load(() => import("./CallScreen.jsx"));
export const loadCallMenu = () => load(() => import("./CallMenu.jsx"));
const fail = (e) => { try { toast((e && e.message) || "The call could not be opened."); } catch (x) { /* */ } };
export const Calls = {
  start: (o) => loadCallScreen().then((m) => m.openCall({ start: o })).catch(fail),
  join: (roomId) => loadCallScreen().then((m) => m.openCall({ join: roomId })).catch(fail),
  // next-calls-lobby: "Open the meeting" from the pop-up: straight in (no lobby)
  enter: (roomId) => loadCallScreen().then((m) => m.openCall({ join: roomId, auto: true })).catch(fail),
  // a code typed on Meetings, or the link opened while signed in (#/join/<code>)
  joinCode: (code) => loadCallScreen().then((m) => m.openCall({ code })).catch(fail),
  schedule: (o) => loadCallMenu().then((m) => m.openSchedule(o)).catch(fail),
  later: (o) => loadCallMenu().then((m) => m.openLater(o)).catch(fail),
  settings: (o) => loadCallMenu().then((m) => m.openSettings(o)).catch(fail),
  history: (o) => loadCallMenu().then((m) => m.openHistory(o)).catch(fail),
  kept: (room) => loadCallMenu().then((m) => m.openKept(room)).catch(fail),
  meetings: () => { try { navHome("meetings"); } catch (e) { /* */ } },
};
window.FinComCall = Calls;
// a guest's link (…#join=<token>): the guest's page instead of FinCom (no sign-in)
export const guestLink = () => /^#join=[A-Za-z0-9_-]{43}$/.test(String(location.hash || ""));
// the one join link of a meeting (…#/join/<code>) and the join page (…#/join): -> {code} ("" on the join page), or null
export function joinHash(h) {
  const m = /^#\/join(?:\/([A-Za-z-]{0,20}))?\/?$/.exec(String(h == null ? location.hash : h || ""));
  return m ? { code: String(m[1] || "").toLowerCase() } : null;
}
// someone signed in to a firm on this browser: the link opens FinCom and the meeting's lobby; else the guest's page
export const memberHere = () => { try { return typeof Cloud === "object" && !!Cloud.on(); } catch (e) { return false; } };
export const startGuest = () => load(() => import("./guest.jsx")).then((m) => m.mountGuest());
// next-calls-lobby (25-Oct-2026): once someone is signed in, the waiting-room watcher (knock.jsx, its own file: a pop-up
// wherever FinCom is open when someone asks to join), and the meeting link they opened before signing in ("Sign in with
// FinCom" on the link's page keeps it in fincom.join-after for 30 minutes)
const signedIn = () => { try { return typeof Cloud === "object" && Cloud.on() && Cloud.st && Cloud.st.firm && !Cloud.st.mfa; } catch (e) { return false; } };
let knockOn = false;
if (typeof window !== "undefined") setInterval(() => {
  if (!signedIn()) return;
  if (!knockOn) { knockOn = true; load(() => import("./knock.jsx")).then((m) => m.startKnocks(), () => { knockOn = false; }); }
  let a = null; try { a = JSON.parse(localStorage.getItem("fincom.join-after") || "null"); localStorage.removeItem("fincom.join-after"); } catch (e) { a = null; }
  if (a && a.code && Date.now() - a.at < 1800000) { try { navHome("meetings"); } catch (e) { /* */ } Calls.joinCode(a.code); }
}, 2000);
// FinCom started from a join link: FinCom's own address becomes #/meetings and the lobby opens over it
let pending = "";
export function takeJoin() {
  const j = joinHash();
  if (!j) return;
  pending = j.code || "";
  try { history.replaceState(history.state, "", location.pathname + location.search + "#/meetings"); } catch (e) { /* */ }
}
export function pendingJoin() { const c = pending; pending = ""; return c; }
// a join link pasted into a FinCom tab already open
// (the link read from the event: FinCom's own router, nav.js, may already have put its route back in the address)
if (typeof window !== "undefined") window.addEventListener("hashchange", (ev) => {
  let h = null; try { h = new URL(ev.newURL).hash; } catch (e) { h = null; }
  const j = joinHash(h) || joinHash();
  if (!j || !memberHere()) return;
  try { history.replaceState(history.state, "", location.pathname + location.search + "#/meetings"); } catch (e) { /* */ }
  try { navHome("meetings"); } catch (e) { /* */ }
  if (j.code) Calls.joinCode(j.code);
});
