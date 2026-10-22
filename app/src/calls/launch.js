// The way into calls from the rest of FinCom: a few lines in the app's first file; everything else (the call screen,
// realtime, media, effects, recording) is fetched only when a call is opened (never with the page, never preloaded).
import { staleReload } from "../staleChunk.js";
const load = (f) => f().catch((e) => { staleReload(e, true); throw e; });
export const loadCallScreen = () => load(() => import("./CallScreen.jsx"));
export const loadCallMenu = () => load(() => import("./CallMenu.jsx"));
const fail = (e) => { try { toast((e && e.message) || "The call could not be opened."); } catch (x) { /* */ } };
export const Calls = {
  start: (o) => loadCallScreen().then((m) => m.openCall({ start: o })).catch(fail),
  join: (roomId) => loadCallScreen().then((m) => m.openCall({ join: roomId })).catch(fail),
  schedule: (o) => loadCallMenu().then((m) => m.openSchedule(o)).catch(fail),
  settings: (o) => loadCallMenu().then((m) => m.openSettings(o)).catch(fail),
  history: (o) => loadCallMenu().then((m) => m.openHistory(o)).catch(fail),
};
window.FinComCall = Calls;
// a guest's link (…#join=<token>): the guest's page instead of FinCom (no sign-in)
export const guestLink = () => /^#join=[A-Za-z0-9_-]{43}$/.test(String(location.hash || ""));
export const startGuest = () => load(() => import("./guest.jsx")).then((m) => m.mountGuest());
