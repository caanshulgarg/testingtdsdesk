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
if (typeof window !== "undefined") window.addEventListener("hashchange", () => {
  const j = joinHash();
  if (!j || !memberHere()) return;
  try { history.replaceState(history.state, "", location.pathname + location.search + "#/meetings"); } catch (e) { /* */ }
  try { navHome("meetings"); } catch (e) { /* */ }
  if (j.code) Calls.joinCode(j.code);
});
