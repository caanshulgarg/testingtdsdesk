// Someone asking to join reaches the host wherever FinCom is open (next-calls-lobby, 25-Oct-2026). The owner, 25-Oct
// 22:56 IST: a guest asked to join "but I was connecting through my iPhone.. I did not get any request.. ideally I should
// get the request". Until now the request showed only inside the call screen.
// Loaded once someone is signed in (launch.js; its own file, never with the page). It asks fincom-call's `lobby` who is
// waiting in the rooms this person hosts (or, while the host is not online, any room of the firm for an owner or staff
// member): at once, every R.LOBBY.watchSecs, when the page comes back to the front or the line comes back, and the moment
// the firm's lobby channel (Supabase Realtime, a name the function hands out) is pinged. A new request: a pop-up on top
// of whatever page is open ("<name> is asking to join <meeting> · Admit · Open the meeting · Deny"), a soft chime and a
// vibration where the browser allows them, a system notice when the tab is in the background and notices were already
// allowed (never asked for here), and the same in the bell (window.FinComKnocks, read by MeetLine.meetAlerts) until
// answered. Admit lets them in without opening the call; Open the meeting joins it (no lobby). A room whose call screen is
// open here is left to the call screen's own "wants to join" bar.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { X } from "lucide-react";
import { channel } from "./realtime.js";
import { base, publicKey } from "./api.js";
import { LOBBY, knockText } from "./rules.js";
import { Calls } from "./launch.js";
import "./calls.css";

const st = { list: [], hidden: new Set(), seen: new Set(), topic: "", ch: null, timer: null, busy: false, again: false, on: false, draw: null, ids: "" };
const signedIn = () => { try { return typeof Cloud === "object" && Cloud.on() && Cloud.st && Cloud.st.firm && !Cloud.st.mfa; } catch (e) { return false; } };
const call = (action, body) => Cloud.fn("fincom-call", Object.assign({ action }, body || {}));
const say = (s) => { try { toast(s); } catch (e) { /* the pop-up shows it */ } };
// a room whose call screen is open on this page: its own bar asks
const openHere = (rid) => !!document.querySelector('#fincom-call [data-call="in"][data-room="' + rid + '"]');

export function chime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
    [[660, 0], [880, 0.18], [660, 0.5], [880, 0.68]].forEach(([f, t]) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.35); o.connect(g).connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.4); });
    setTimeout(() => { try { ac.close(); } catch (e) { /* */ } }, 1800);
  } catch (e) { /* no sound here: the pop-up is seen */ }
}
function alertNow(k) {
  chime();
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* iPhone Safari: none */ }
  try { if (document.hidden && window.Notification && Notification.permission === "granted") new Notification("FinCom: someone is asking to join", { body: knockText(k.name, k.title), tag: "knock-" + k.id }); } catch (e) { /* */ }
}

function listen(topic) {
  if (st.ch) st.ch.close();
  st.topic = topic;
  let t = null;
  st.ch = channel({ url: base(), key: publicKey(), topic, presenceKey: "", onStatus: () => {} });
  st.ch.on("knock", () => { clearTimeout(t); t = setTimeout(refresh, 250); });
}
function schedule() {
  clearTimeout(st.timer);
  if (!st.on) return;
  st.timer = setTimeout(refresh, (st.ch && st.ch.joined ? LOBBY.watchSecs : 10) * 1000);
}
export async function refresh() {
  if (!st.on) return;
  if (!signedIn()) { stopKnocks(); return; }
  if (st.busy) { st.again = true; return; }
  st.busy = true;
  try {
    const j = await call("lobby", {});
    if (j.topic && j.topic !== st.topic) listen(j.topic);
    const list = j.knocks || [];
    const fresh = list.filter((k) => !st.seen.has(k.id));
    fresh.forEach((k) => st.seen.add(k.id));
    st.list = list;
    const shown = fresh.filter((k) => !openHere(k.room_id));
    if (shown.length) alertNow(shown[0]);
    draw();
  } catch (e) { /* asked again soon */ }
  st.busy = false;
  if (st.again) { st.again = false; refresh(); return; }
  schedule();
}
function draw() {
  if (st.draw) st.draw((n) => n + 1);
  const ids = st.list.map((k) => k.id).join(",");
  if (ids !== st.ids) { st.ids = ids; try { if (typeof window.render === "function") window.render(); } catch (e) { /* the bell catches up */ } }
}
const front = () => { if (!document.hidden) refresh(); };

export function startKnocks() {
  if (st.on) return;
  st.on = true;
  if (!document.getElementById("fincom-knock")) {
    const el = document.createElement("div"); el.id = "fincom-knock"; document.body.appendChild(el);
    createRoot(el).render(<Knocks />);
  }
  document.addEventListener("visibilitychange", front);
  window.addEventListener("focus", front); window.addEventListener("online", front); window.addEventListener("pageshow", front);
  window.FinComKnocks = () => st.list.map((k) => ({ key: "knock:" + k.id, sev: "warn", text: knockText(k.name, k.title), fix: k.mine ? "" : "The host isn't online, so you are asked.",
    act: { label: "Answer", run: () => { st.hidden.delete(k.id); draw(); } } }));
  refresh();
}
export function stopKnocks() {
  st.on = false; clearTimeout(st.timer);
  if (st.ch) { st.ch.close(); st.ch = null; st.topic = ""; }
  st.list = []; draw();
  document.removeEventListener("visibilitychange", front);
  window.removeEventListener("focus", front); window.removeEventListener("online", front); window.removeEventListener("pageshow", front);
}

async function answer(k, yes) {
  try {
    await call(yes ? "admit" : "deny", { room_id: k.room_id, participant_id: k.id });
    st.list = st.list.filter((x) => x.id !== k.id); draw();
    say(yes ? k.name + " is in the meeting." : k.name + " was not let in.");
  } catch (e) { say(e.message || "That did not work; try again."); }
  refresh();
}
function enter(k) {
  st.list.filter((x) => x.room_id === k.room_id).forEach((x) => st.hidden.add(x.id)); draw();
  Calls.enter(k.room_id);
}

function Knocks() {
  const [, set] = useState(0);
  const [busy, setBusy] = useState("");
  useEffect(() => { st.draw = set; return () => { st.draw = null; }; }, []);
  const show = st.list.filter((k) => !st.hidden.has(k.id) && !openHere(k.room_id));
  if (!show.length) return null;
  const k = show[0], more = show.length - 1;
  const go = async (what) => { setBusy(what); if (what === "open") enter(k); else await answer(k, what === "admit"); setBusy(""); };
  return <div className="knock-pop" role="alertdialog" aria-live="assertive" aria-labelledby="knock-text" data-knock-pop={k.name}>
    <button type="button" className="knock-x" aria-label="Hide (it stays in the bell)" title="Hide (it stays in the bell)" onClick={() => { st.hidden.add(k.id); draw(); }} data-knock-hide=""><X width={16} height={16} /></button>
    <p id="knock-text" className="knock-text" data-knock-text=""><b>{k.name}</b> is asking to join <b>{k.title || "the meeting"}</b></p>
    <p className="knock-sub">{k.email ? k.email + (k.verified ? " · email checked" : "") : ""}{!k.mine ? (k.email ? " · " : "") + "The host isn't online, so you are asked." : ""}{more > 0 ? " · " + more + " more waiting" : ""}</p>
    <div className="knock-acts">
      <button type="button" className="btn primary" disabled={!!busy} onClick={() => go("admit")} data-knock-pop-admit="">{busy === "admit" ? "Admitting…" : "Admit"}</button>
      <button type="button" className="btn" disabled={!!busy} onClick={() => go("open")} data-knock-pop-open="">Open the meeting</button>
      <button type="button" className="btn" disabled={!!busy} onClick={() => go("deny")} data-knock-pop-deny="">{busy === "deny" ? "Denying…" : "Deny"}</button>
    </div>
  </div>;
}
