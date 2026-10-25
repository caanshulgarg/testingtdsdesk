// The call screen (stage 1, the owner's approval of 23-Oct-2026), in its own file, loaded only when a call is opened
// (app/src/calls/launch.js). It is drawn over FinCom in its own root, and can be made small (a dock in the corner) so
// FinCom stays usable beside it, which "Work together" needs.
// next-calls-meet (23-Oct-2026; the owner "didn't know where anyone will go or connect"): laid out like Google Meet.
//   Before joining, the lobby: the camera's preview with the microphone and camera switches, the devices, the background,
//     your name (a guest: name and email), My language and Subtitles on or off, then "Join now" (a member) or "Ask to
//     join" (a guest: "Asking to join…" until the host lets them in, then straight into the call).
//   The host who starts a meeting sees "Your meeting's ready" (the link and the code to share); "Meeting details" (i) shows
//     the same at any time. Someone asking to join: "<name> wants to join · Admit · View", with a sound, over the call.
//   In the call: a dark stage, the tiles in a grid with names and who is speaking; the bar at the foot (microphone,
//     camera, present, raise hand, reactions, subtitles, more ⋮, the red leave), on the right Meeting details, People
//     (the number waiting) and Chat; the time and the code at the top left.
//   Everything of before stays: recording with the notice everyone must see, the transcript, "Work together", remote
//   help, mute all, remove, the effects, a weak line made smaller then audio only, reconnecting by itself.
//   Live translated subtitles (23-Oct-2026): each person's own switch (off at first) and language; the speaker's short
//   pieces go to the function (Groq) only while someone in the call has subtitles on.
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Mic, MicOff, Video, VideoOff, MonitorUp, Hand, Smile, Captions, EllipsisVertical, PhoneOff, Info, Users, MessageSquare, Sparkles, X } from "lucide-react";
import { makeApi, base, publicKey } from "./api.js";
import { channel } from "./realtime.js";
import { createMedia } from "./media.js";
import { makeEffects, loadChoice, saveChoice, effectsOn, BACKGROUNDS, lightDevice, shrinkImage } from "./effects.js";
import { compositeRecorder, micPieces, uploadQueue } from "./recorder.js";
import { LOBBY, waitText, codeFrom } from "./rules.js";
import { chatParts, CONSENT_TEXT, mayPublish, FILE_MAX, rustdeskUri, rustdeskIdOk, rustdeskId, transcriptText, SUB_LANGS, SUB_PIECE, defaultSubLang, subLangOk, subLangName, subTargets, subsNeeded, subLine, emailOk, nameOk } from "./rules.js";
import { startCowork } from "./cowork.js";
import { MeetCard } from "./MeetCard.jsx";
import NoDeviceNote from "../parts/NoDeviceNote.jsx";
import { noDeviceError, devicesMissing } from "../parts/noDevice.js";
import "./calls.css";

const REACTIONS = ["👍", "👏", "😂", "🎉", "❤️", "🙏"];
const say = (s) => { try { toast(s); } catch (e) { /* the screen shows it too */ } };
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const nowIst = () => { try { return fmtTime(new Date()); } catch (e) { return ""; } };
const b64 = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = no; r.readAsDataURL(blob); });
// a soft two-note chime (no sound file): someone asks to join
function chime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
    [[660, 0], [880, 0.18]].forEach(([f, t]) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.35); o.connect(g).connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.4); });
    setTimeout(() => { try { ac.close(); } catch (e) { /* */ } }, 1200);
  } catch (e) { /* no sound here: the toast is seen */ }
}
// subtitles: each person's own choice, remembered on this device (off at first)
const SUBS_KEY = (who) => "fincom.call-subs:" + who;
function loadSubs(who) {
  let x = null; try { x = JSON.parse(localStorage.getItem(SUBS_KEY(who)) || "null"); } catch (e) { x = null; }
  return { on: !!(x && x.on), lang: x && subLangOk(x.lang) ? x.lang : defaultSubLang([(document.documentElement.lang || ""), ...(navigator.languages || [navigator.language])]) };
}
const saveSubs = (who, s) => { try { localStorage.setItem(SUBS_KEY(who), JSON.stringify(s)); } catch (e) { /* this call only */ } };

let root = null, host = null;
// opts: {start: {kind, client_id, batch_id, title}} | {join: room_id, auto} (auto: straight in, no lobby: the pop-up's
//       "Open the meeting") | {code} (a member with a code) | {guest: {code | token, hello}} (the guest's page)
// next-calls-lobby (25-Oct-2026): a call screen already open is only brought back when it is the same meeting and still in
// it; otherwise (another meeting, or this device's place was left: the owner's iPhone, still showing the 17:10 call when
// he opened the invite link at 17:25) it is closed and the link joins afresh.
export function openCall(opts) {
  if (host) {
    const room = host.getAttribute("data-room") || "", code = host.getAttribute("data-code") || "", phase = host.getAttribute("data-phase") || "";
    const same = (opts.join && opts.join === room) || (opts.code && codeFrom(opts.code) === code) || (!opts.join && !opts.code && !opts.guest);
    if (same && phase === "in") { host.setAttribute("data-call-min", "false"); return; }
    closeCall(true);
  }
  host = document.createElement("div"); host.id = "fincom-call"; host.setAttribute("data-call-min", "false");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<Call opts={opts} onClose={closeCall} />);
}
export function closeCall(quiet) { try { root && root.unmount(); } catch (e) { /* */ } if (host) host.remove(); root = null; host = null; if (!quiet) try { window.dispatchEvent(new Event("fincom-meetings-changed")); } catch (e) { /* */ } }
export const callOpen = () => !!host;

function useForce() { const [, set] = useState(0); return () => set((x) => x + 1); }

function Call({ opts, onClose }) {
  // a guest: from the guest's page, or a member of another firm who typed this firm's code
  const [gmode, setGmode] = useState(opts.guest || null);
  const guest = gmode;
  const apiBox = useRef(makeApi(gmode ? {} : null));
  const api = useMemo(() => ({ call: (...a) => apiBox.current.call(...a), upload: (...a) => apiBox.current.upload(...a), put: (...a) => apiBox.current.put(...a) }), []);
  const member = typeof Cloud === "object" && Cloud.sess && Cloud.sess();
  const who = guest ? "guest" : String((member || {}).user_id || "me");
  const accountName = String(((typeof Cloud === "object" && Cloud.st && (Cloud.st.members || []).find((m) => m.user_id === who)) || {}).name || (typeof Cloud === "object" && Cloud.st && Cloud.st.email) || "Me");
  const [gname, setGname] = useState(() => { try { return localStorage.getItem("fincom.guest-name") || ""; } catch (e) { return ""; } });
  const [gemail, setGemail] = useState(() => { try { return localStorage.getItem("fincom.guest-email") || ""; } catch (e) { return ""; } });
  const [otp, setOtp] = useState("");
  const myName = guest ? (gname.trim() || "Guest") : accountName;
  const role = guest ? "guest" : String((typeof Cloud === "object" && Cloud.st && Cloud.st.role) || "");
  const [phase, setPhase] = useState("lobby");            // lobby, joining, code, asking, denied, in, ended
  const [err, setErr] = useState("");
  const [sess, setSess] = useState(null);
  const [mic, setMic] = useState(true), [cam, setCam] = useState(true);
  const [fx, setFx] = useState(() => loadChoice(who));
  const [fxNote, setFxNote] = useState("");
  const [panel, setPanel] = useState("");                  // "", people, chat, effects, details
  const [menu, setMenu] = useState("");                    // "", more, reacts, subs
  const [min, setMin] = useState(false);
  const [status, setStatus] = useState("");               // reconnecting, …
  const [level, setLevel] = useState("high");
  const [audioOnly, setAudioOnly] = useState(false);
  const [rec, setRec] = useState(null);                   // {id, by}
  const [acked, setAcked] = useState(false);
  const [hand, setHand] = useState(false);
  const [chat, setChat] = useState([]);
  const [unread, setUnread] = useState(0);
  const [roster, setRoster] = useState([]);               // the host's list (with the waiting room)
  const [knocks, setKnocks] = useState([]);               // people asking to join, not yet answered (the host)
  const [presence, setPresence] = useState([]);
  const [reacts, setReacts] = useState({});               // pid -> {e, at}
  const [caps, setCaps] = useState(false), [capLines, setCapLines] = useState([]);   // the browser's own captions (no Groq key)
  const [subs, setSubs] = useState(() => loadSubs(who));  // {on, lang}: my subtitles
  const [subLines, setSubLines] = useState([]);           // [{pid, name, text, lang, tr, paused, at}]
  const [subNote, setSubNote] = useState("");
  const [showOrig, setShowOrig] = useState({});
  const [screenOn, setScreenOn] = useState(false);
  const [cowork, setCowork] = useState(null);             // {follow, people, isHost} while working together
  const [remote, setRemote] = useState(null);             // remote help: {phase, id, peerId, rid, reason}
  const [after, setAfter] = useState(null);               // after the call
  const [needTap, setNeedTap] = useState(false);          // the browser held the others' sound until a tap
  const [gone, setGone] = useState("");                   // this device's place was left (its other device left, or away too long)
  const [admitOk, setAdmitOk] = useState(false);          // the server lets me answer the waiting room (the host away: owner or staff)
  const [wait, setWait] = useState(null);                 // a guest asking: {host_name, host_online}
  const [timedOut, setTimedOut] = useState(false);        // a guest asked for LOBBY.waitMinutes: Ask again
  const [ready, setReady] = useState(false);              // "Your meeting's ready"
  const [speaking, setSpeaking] = useState({});           // pid -> true
  const [clock, setClock] = useState(nowIst());
  const [devices, setDevices] = useState({ mics: [], cams: [], outs: [] }), [dev, setDev] = useState({ mic: "", cam: "", out: "" });
  const [hello, setHello] = useState(gmode && gmode.hello ? gmode.hello : null);
  // no microphone or camera reached this browser (Remote Desktop, a cloud PC, refused): {mic, cam}; joining still works
  const [noDev, setNoDev] = useState({ mic: false, cam: false });
  useEffect(() => { const f = () => setNeedTap(true); window.addEventListener("fincom-call-tap", f); return () => window.removeEventListener("fincom-call-tap", f); }, []);
  useEffect(() => { const t = setInterval(() => setClock(nowIst()), 20000); return () => clearInterval(t); }, []);
  const force = useForce();
  const subsRef = useRef(subs); subsRef.current = subs;
  const micRef = useRef(mic); micRef.current = mic;
  const R = useRef({ remotes: new Map(), sigHandlers: {}, ch: null, media: null, raw: null, fxp: null, screen: null, recorder: null, mic: null, queue: null, t0: Date.now(), cw: null, recog: null, seen: new Set(), subMic: null, subBusy: 0, subPauseUntil: 0 }).current;
  // the room's host records, ends it for everyone, mutes all, starts working together and remote help; the firm's owner
  // may also admit and remove people (the server's rule)
  const amHost = !!(sess && !guest && sess.me.role === "host");
  const isHost = !!(sess && !guest && (amHost || role === "owner"));
  const canAdmit = isHost || (!!sess && !guest && admitOk);
  const canStaff = !guest && (role === "owner" || role === "staff");

  // ---------------------------------------------------------------- the camera and microphone (lobby preview too)
  const preview = useRef(null);
  async function openDevices(want) {
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(want && want.mic ? { deviceId: { exact: want.mic } } : {}) };
    const video = { width: { ideal: 1280 }, height: { ideal: 720 }, ...(want && want.cam ? { deviceId: { exact: want.cam } } : { facingMode: "user" }) };
    let s;
    try { s = await navigator.mediaDevices.getUserMedia({ audio, video }); setErr(""); setNoDev({ mic: false, cam: false }); }
    catch (e) {
      try { s = await navigator.mediaDevices.getUserMedia({ audio }); setCam(false); setNoDev({ mic: false, cam: noDeviceError(e) }); setErr(noDeviceError(e) ? "" : "The camera could not be opened; you can still talk."); }
      catch (e2) {
        s = new MediaStream(); setMic(false); setCam(false);
        // nothing reached the browser: one plain message (with Remote Desktop's steps) and joining to listen and chat
        if (noDeviceError(e2)) { setNoDev({ mic: true, cam: true }); setErr(""); }
        else setErr("The camera and microphone could not be opened; you can still join to listen and chat.");
      }
    }
    return s;
  }
  async function listDevices() {
    const miss = await devicesMissing();
    if (miss && (miss.mic || miss.cam)) { setNoDev((d) => ({ mic: d.mic || miss.mic, cam: d.cam || miss.cam })); if (miss.mic) setMic(false); if (miss.cam) setCam(false); }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({ mics: all.filter((d) => d.kind === "audioinput"), cams: all.filter((d) => d.kind === "videoinput"), outs: all.filter((d) => d.kind === "audiooutput") });
      const a = R.raw && R.raw.getAudioTracks()[0], v = R.raw && R.raw.getVideoTracks()[0];
      setDev((d) => ({ mic: (a && a.getSettings && a.getSettings().deviceId) || d.mic, cam: (v && v.getSettings && v.getSettings().deviceId) || d.cam, out: d.out }));
    } catch (e) { /* no list: the browser's own choice */ }
  }
  useEffect(() => {
    let live = true;
    (async () => {
      R.raw = await openDevices(null);
      if (!live) { R.raw.getTracks().forEach((t) => t.stop()); return; }
      await applyFx(fx);
      listDevices();
      force();
      // the pop-up's "Open the meeting": straight in
      if (opts.auto && opts.join && !opts.guest) join();
    })();
    return () => { live = false; };
  }, []);
  // another microphone or camera picked in the lobby
  async function pickDevice(kind, id) {
    const want = Object.assign({}, dev, { [kind]: id });
    setDev(want);
    if (kind === "out") { document.querySelectorAll("#fincom-call video[data-cam]").forEach((v) => { try { v.setSinkId && v.setSinkId(id); } catch (e) { /* */ } }); return; }
    const old = R.raw;
    if (R.fxp) { R.fxp.stop(); R.fxp = null; }
    if (old) old.getTracks().forEach((t) => t.stop());
    R.raw = await openDevices(want);
    await applyFx(fx);
    if (R.media) R.media.setVideoTrack(cam ? outVideo() : null);
    force();
  }
  const outVideo = () => (R.fxp ? R.fxp.track : (R.raw && R.raw.getVideoTracks()[0]) || null);
  async function applyFx(next) {
    const on = effectsOn(next);
    if (on && R.raw && R.raw.getVideoTracks().length) {
      try {
        if (!R.fxp) R.fxp = await makeEffects(R.raw, next, (n) => setFxNote(n));
        else await R.fxp.set(next);
      } catch (e) { setFxNote(e.message); R.fxp = null; }
    } else if (R.fxp) { R.fxp.stop(); R.fxp = null; }
    if (R.media) R.media.setVideoTrack(cam ? outVideo() : null);
    force();
  }
  const changeFx = (p) => { const next = Object.assign({}, fx, p); setFx(next); saveChoice(who, next); applyFx(next); };
  // the preview and my own tile: a stream made again only when the picture's track changes (a new stream on every
  // drawing restarted the video and made the page jump)
  const selfTrack = cam ? outVideo() : null;
  const selfStream = useMemo(() => (selfTrack ? new MediaStream([selfTrack]) : null), [selfTrack]);
  useEffect(() => { if (preview.current && preview.current.srcObject !== selfStream) preview.current.srcObject = selfStream; });
  useEffect(() => { if (R.raw) R.raw.getAudioTracks().forEach((t) => { t.enabled = mic && mayPublish(!!rec, acked || !!R.recording); }); trackMe(); }, [mic, rec, acked]);
  useEffect(() => { if (R.media) R.media.setVideoTrack(cam && mayPublish(!!rec, acked || !!R.recording) ? outVideo() : null); trackMe(); }, [cam, rec, acked]);

  // ---------------------------------------------------------------- the signal channel (switched when the host removes someone)
  const sig = useMemo(() => ({
    send: (ev, p) => { if (R.ch) R.ch.send(ev, p); },
    on: (ev, f) => { (R.sigHandlers[ev] = R.sigHandlers[ev] || []).push(f); return () => { R.sigHandlers[ev] = R.sigHandlers[ev].filter((x) => x !== f); }; },
  }), []);
  function openChannel(topic) {
    if (R.ch) R.ch.close();
    const ch = channel({ url: base(), key: publicKey(), topic, presenceKey: R.sess ? R.sess.me.id : "x", onStatus: (s) => setStatus(s === "joined" ? "" : s) });
    for (const ev of ["rtc", "sfu", "sfu-ask", "chat", "hand", "react", "rec", "kick", "rekey", "end", "mute-all", "cowork", "cap", "remote", "rdid", "sub", "knock"]) ch.on(ev, (p) => (R.sigHandlers[ev] || []).forEach((f) => f(p)));
    ch.onPresence((list) => { setPresence(list); if (R.media) list.forEach((p) => p.pid && R.media.meet(p.pid)); });
    R.ch = ch; trackMe();
  }
  function trackMe() { const s = R.sess; if (R.ch && s) R.ch.track({ pid: s.me.id, name: s.me.name || myName, role: s.me.role, mic: mic && mayPublish(!!rec, acked || !!R.recording), cam, hand, guest: !!guest, notice: true, subs: !!subs.on, lang: subs.lang }); }
  useEffect(() => { trackMe(); }, [hand, sess, subs]);
  const setMySubs = (p) => { const n = Object.assign({}, subs, p); setSubs(n); saveSubs(who, n); if (p.on === false) setSubLines([]); };

  // ---------------------------------------------------------------- joining
  function enter(s) {
    R.sess = s; setSess(s);
    R.t0 = s.room.started_at ? Date.parse(s.room.started_at) : Date.now();
    if (s.recording) setRec({ id: s.recording.id });
    // the host who has just opened a meeting: the link and the code to share
    if (!guest && s.me.role === "host" && (opts.start || opts.code)) setReady(true);
    setPhase("in");
  }
  async function join() {
    setPhase("joining"); setErr("");
    try {
      const s = opts.start ? await api.call("start", opts.start) : opts.code ? await api.call("join_code", { code: opts.code }) : await api.call("join", { room_id: opts.join });
      enter(s);
    } catch (e) {
      // another firm's meeting: this person joins it as a guest (their name and email, then the host lets them in)
      if (e.kind === "otherfirm") {
        apiBox.current = makeApi({});
        setGname(accountName === "Me" ? "" : accountName); setGemail(String((Cloud.st && Cloud.st.email) || ""));
        setGmode({ code: opts.code }); setPhase("lobby");
        apiBox.current.call("guest_hello", { code: opts.code }).then(setHello, (x) => setErr(x.message));
        setErr("This meeting is another firm's: write your name and email and ask to join.");
        return;
      }
      setErr(e.message); setPhase("lobby");
    }
  }
  // the link's page: "Sign in with FinCom" (the owner, 25-Oct: whoever has the link can sign in from it): FinCom opens, and
  // once signed in the same meeting is joined as that member (launch.js reads fincom.join-after)
  const signinCode = guest && !member ? (codeFrom((hello && hello.code) || guest.code || "") || "") : "";
  function signIn(code) {
    try { localStorage.setItem("fincom.join-after", JSON.stringify({ code, at: Date.now() })); } catch (e) { /* */ }
    [R.raw].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
    location.href = location.pathname + location.search;
  }
  // a guest: name and email, then (with FinCom's email set up) the code sent to it, then waiting for the host
  async function askToJoin() {
    setErr("");
    if (!nameOk(gname)) { setErr("Write your name (2 to 60 letters)."); return; }
    if (!emailOk(gemail.trim())) { setErr("Write your email address."); return; }
    try { localStorage.setItem("fincom.guest-name", gname.trim()); localStorage.setItem("fincom.guest-email", gemail.trim()); } catch (e) { /* */ }
    setPhase("joining");
    try {
      const j = await apiBox.current.call("guest_start", Object.assign(guest.code ? { code: guest.code } : { token: guest.token }, { name: gname.trim(), email: gemail.trim() }));
      apiBox.current = makeApi({ gt: j.gt });
      setPhase(j.code_sent ? "code" : "asking");
    } catch (e) { setErr(e.message); setPhase("lobby"); }
  }
  async function verify() {
    setErr("");
    try { await api.call("guest_verify", { code: otp.trim() }); setPhase("asking"); } catch (e) { setErr(e.message); }
  }
  useEffect(() => {
    if (phase !== "asking" || timedOut) return;
    let stop = false, first = true;
    const t0 = Date.now();
    const tick = async () => {
      if (stop) return;
      // nobody let them in for LOBBY.waitMinutes: stop asking, offer Ask again
      if (Date.now() - t0 > LOBBY.waitMinutes * 60000) { setTimedOut(true); return; }
      try {
        const j = await api.call("guest_poll", first && R.knockAgain ? { knock: true } : {});
        first = false; R.knockAgain = false;
        if (j.state === "waiting" && "host_online" in j) setWait({ host_name: j.host_name, host_online: j.host_online });
        if (j.state === "admitted") { enter(j); return; }
        if (j.state === "denied") { setPhase("denied"); return; }
        if (j.state === "removed") { setPhase("denied"); setErr("The host removed you from this call."); return; }
        if (j.state === "ended") { setAfter({ why: "This meeting has ended.", room: null }); setPhase("ended"); return; }
      } catch (e) { if (e.status === 401) { setErr(e.message); setPhase("lobby"); return; } }
      setTimeout(tick, 2500);
    };
    tick();
    return () => { stop = true; };
  }, [phase, timedOut]);
  const askAgain = () => { R.knockAgain = true; setTimedOut(false); };

  useEffect(() => {
    if (phase !== "in" || !sess) return;
    openChannel(sess.topic);
    const local = new MediaStream([...(R.raw ? R.raw.getAudioTracks() : []), ...(outVideo() && cam ? [outVideo()] : [])]);
    R.media = createMedia(sess.mode, { signal: sig, me: sess.me.id, ice: sess.ice, api, room: sess.room.id,
      onRemote: (pid, s) => { if (!s) R.remotes.delete(pid); else R.remotes.set(pid, Object.assign(R.remotes.get(pid) || {}, s)); force(); },
      onLevel: (l) => { setLevel(l); if (l === "audio") { setAudioOnly(true); say("The line is weak: audio only for now."); } } });
    R.media.start(local).catch((e) => setErr("The call could not connect: " + e.message));
    api.call("history_chat", { room_id: sess.room.id }).then((j) => setChat(j.messages || [])).catch(() => {});
    const offs = [
      sig.on("chat", (m) => { setChat((c) => c.some((x) => x.id === m.message.id) ? c : c.concat([m.message])); setUnread((u) => u + 1); }),
      sig.on("react", (m) => { setReacts((r) => Object.assign({}, r, { [m.pid]: { e: m.e, at: Date.now() } })); setTimeout(() => setReacts((r) => { const x = Object.assign({}, r); if (x[m.pid] && Date.now() - x[m.pid].at > 2900) delete x[m.pid]; return x; }), 3000); }),
      sig.on("rec", (m) => { if (m.on) { setRec({ id: m.id }); } else { setRec(null); setAcked(false); stopMic(); } }),
      sig.on("kick", (m) => { if (m.pid === sess.me.id) { leave(false, "The host removed you from the call."); } else R.media && R.media.forget(m.pid); }),
      sig.on("rekey", async () => { try { const t = await api.call("topic", { room_id: sess.room.id }); openChannel(t.topic); } catch (e) { /* removed: the kick says so */ } }),
      sig.on("end", () => leave(false, "The host ended the call.")),
      sig.on("mute-all", (m) => { if (m.from !== sess.me.id) { setMic(false); say("The host muted everyone. Unmute when you speak."); } }),
      sig.on("cowork", (m) => { if (m.on) joinCowork(); else stopCowork(); }),
      sig.on("cap", (m) => { setCapLines((l) => l.filter((x) => x.pid !== m.pid).concat([{ pid: m.pid, name: m.name, text: m.text, at: Date.now() }]).slice(-4)); }),
      sig.on("sub", (m) => addSub(m)),
      sig.on("remote", (m) => onRemote(m)),
      sig.on("rdid", (m) => setRemote((r) => r && r.id ? Object.assign({}, r, { rid: m.id, peerName: m.name }) : r)),
    ];
    // members: the people list every LOBBY.pollSecs and at once when someone asks (the call's channel is pinged by the
    // server); the host (or, the host away, owner or staff) also the waiting room, with a sound for each new person asking.
    // A refusal is said, never retried in silence (the owner's iPhone, 25-Oct: 403 every 3 s, nothing on the screen)
    let poll = null, beat = null;
    if (!guest) {
      let stopped = false;
      const load = () => stopped ? null : api.call("roster", { room_id: sess.room.id }).then((j) => {
        const ps = j.people || [];
        setRoster(ps);
        const may = !!(j.admit || j.host);
        setAdmitOk(may);
        const waiting = ps.filter((p) => p.state === "waiting");
        const fresh = waiting.filter((p) => !R.seen.has(p.id));
        fresh.forEach((p) => R.seen.add(p.id));
        if (fresh.length && may) { chime(); }
        setKnocks((k) => waiting.filter((p) => k.some((x) => x.id === p.id) || fresh.some((x) => x.id === p.id)));
        if (j.status === "ended") leave(false, "The call has ended.");
      }).catch((e) => {
        if (e && (e.kind === "left" || e.kind === "notin" || e.kind === "removed")) { stopped = true; clearInterval(poll); setGone(e.message || "You are no longer in this meeting."); }
        else if (e && e.kind === "ended") { stopped = true; clearInterval(poll); leave(false, "The call has ended."); }
        else if (e && (e.kind === "auth" || e.kind === "mfa" || e.kind === "firm")) { stopped = true; clearInterval(poll); setGone(e.message); }
      });
      load(); poll = setInterval(load, LOBBY.pollSecs * 1000);
      offs.push(sig.on("knock", () => load()));
      const back = () => { if (!document.hidden) load(); };
      document.addEventListener("visibilitychange", back);
      offs.push(() => document.removeEventListener("visibilitychange", back));
    } else {
      // a guest in the call says it is there (a member's people list does it for them)
      const b = () => api.call("beat", {}).then((j) => { if (j.state === "removed") leave(false, "The host removed you from the call."); }).catch(() => {});
      beat = setInterval(b, LOBBY.beatSecs * 1000);
      const back = () => { if (!document.hidden) b(); };
      document.addEventListener("visibilitychange", back);
      offs.push(() => document.removeEventListener("visibilitychange", back));
    }
    if (sess.room.cowork_on && !guest) joinCowork();
    return () => { offs.forEach((f) => f()); clearInterval(poll); clearInterval(beat); };
  }, [phase, sess && sess.room.id]);

  // ---------------------------------------------------------------- who is speaking (each voice's level, a few times a second)
  useEffect(() => {
    if (phase !== "in" || !sess) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ac; try { ac = new AC(); } catch (e) { return; }
    const meters = new Map();      // pid -> {track, an, buf}
    const meter = (pid, track) => {
      const m = meters.get(pid);
      if (m && m.track === track) return m;
      try { const src = ac.createMediaStreamSource(new MediaStream([track])), an = ac.createAnalyser(); an.fftSize = 512; src.connect(an); const x = { track, an, buf: new Float32Array(an.fftSize) }; meters.set(pid, x); return x; } catch (e) { return null; }
    };
    const t = setInterval(() => {
      const on = {};
      const tracks = [[sess.me.id, mic && R.raw && R.raw.getAudioTracks()[0]], ...[...R.remotes.entries()].map(([pid, s]) => [pid, s.cam && s.cam.getAudioTracks()[0]])];
      for (const [pid, tr] of tracks) {
        if (!tr) continue;
        const m = meter(pid, tr); if (!m) continue;
        m.an.getFloatTimeDomainData(m.buf);
        let s = 0; for (let i = 0; i < m.buf.length; i++) s += m.buf[i] * m.buf[i];
        if (Math.sqrt(s / m.buf.length) > 0.02) on[pid] = true;
      }
      setSpeaking((old) => { const a = Object.keys(old).sort().join(","), b = Object.keys(on).sort().join(","); return a === b ? old : on; });
    }, 250);
    return () => { clearInterval(t); try { ac.close(); } catch (e) { /* */ } };
  }, [phase, sess && sess.room.id, mic]);

  // ---------------------------------------------------------------- live subtitles
  function addSub(m) {
    if (!m || !m.text) return;
    setSubLines((l) => l.filter((x) => x.pid !== m.pid && Date.now() - x.at < 8000).concat([Object.assign({}, m, { at: Date.now() })]).slice(-3));
  }
  useEffect(() => { if (!subLines.length) return; const t = setTimeout(() => setSubLines((l) => l.filter((x) => Date.now() - x.at < 7000)), 7200); return () => clearTimeout(t); }, [subLines]);
  // my microphone in short pieces, only while someone in the call (me too) reads subtitles; never while held by the notice
  const anyoneSubs = phase === "in" && subsNeeded(presence.length ? presence : [{ subs: subs.on }], false);
  const held0 = rec && !acked && !R.recording;
  useEffect(() => {
    const want = anyoneSubs && mic && !held0 && R.raw && R.raw.getAudioTracks().length && window.MediaRecorder && sess;
    if (!want) { if (R.subMic) { R.subMic.stop(); R.subMic = null; } return; }
    if (R.subMic) return;
    try {
      R.subMic = micPieces({ track: R.raw.getAudioTracks()[0], t0: R.t0, isMuted: () => !micRef.current, sizes: SUB_PIECE, onPiece: (blob, seq, start, dur) => sendPiece(blob, start, dur) });
    } catch (e) { R.subMic = null; }
    return undefined;
  }, [anyoneSubs, mic, held0, sess && sess.room.id]);
  useEffect(() => () => { if (R.subMic) { R.subMic.stop(); R.subMic = null; } }, []);
  async function sendPiece(blob, start, dur) {
    if (!R.sess || R.subBusy >= 2 || Date.now() < R.subPauseUntil) return;      // a backlog is dropped: subtitles must be quick
    const people = presenceRef.current.length ? presenceRef.current : [{ subs: subsRef.current.on, lang: subsRef.current.lang }];
    const targets = subTargets(people, "");
    if (!subsNeeded(people, false)) return;
    R.subBusy++;
    try {
      const j = await api.call("caption", { room_id: R.sess.room.id, audio: await b64(blob), mime: blob.type, secs: Math.round(dur / 100) / 10, start_ms: start, targets });
      if (j.text) {
        const line = { pid: R.sess.me.id, name: R.sess.me.name || myName, text: j.text, lang: j.lang, tr: j.tr || {}, paused: !!j.paused };
        sig.send("sub", line); addSub(line);
      }
      setSubNote(j.paused ? "Translation paused for a moment (the free limit): the words are shown as said." : "");
    } catch (e) {
      if (e.kind === "limit") { R.subPauseUntil = Date.now() + 30000; setSubNote("Subtitles paused for a moment (the free limit)."); }
      else if (e.kind === "nokey") { R.subPauseUntil = Date.now() + 3600000; setSubNote("Translated subtitles are not set up yet; the browser's own captions are used."); if (!caps) toggleCaps(); }
    }
    R.subBusy--;
  }

  // the recording notice: someone in the call while it records sees it and decides
  useEffect(() => {
    if (!rec || !sess) return;
    if (R.recording) { setAcked(true); startMic(); return; }
    api.call("consent", { room_id: sess.room.id, recording_id: rec.id, event: "shown" }).catch(() => {});
  }, [rec && rec.id]);
  function accept() { setAcked(true); api.call("consent", { room_id: sess.room.id, recording_id: rec.id, event: "accepted" }).catch(() => {}); startMic(); }
  function declineRec() { api.call("consent", { room_id: sess.room.id, recording_id: rec.id, event: "left" }).catch(() => {}); leave(false, "You left the call because it is being recorded."); }

  // my own microphone, in pieces, for the transcript (only while recording, after the notice)
  function startMic() {
    if (R.mic || !R.raw || !R.raw.getAudioTracks().length || !window.MediaRecorder || !sess) return;
    R.queue = R.queue || uploadQueue(async (job) => { const u = await api.upload("mic", job.blob, { room_id: sess.room.id, seq: job.seq }); await api.call("piece", { room_id: sess.room.id, seq: job.seq, start_ms: job.start, dur_ms: job.dur, path: u.path, mime: job.blob.type }); });
    try { R.mic = micPieces({ track: R.raw.getAudioTracks()[0], t0: R.t0, isMuted: () => !mic, onPiece: (blob, seq, start, dur) => R.queue.add({ blob, seq, start, dur }) }); } catch (e) { /* no transcript from this device */ }
  }
  function stopMic() { if (R.mic) { R.mic.stop(); R.mic = null; } }

  // ---------------------------------------------------------------- the host's recording
  async function toggleRec() {
    if (rec && R.recorder) {
      const r = rec; setRec(null); R.recording = false; setAcked(false);
      await R.recorder.stop(); R.recorder = null; stopMic();
      await (R.recQueue && R.recQueue.drain());
      await api.call("rec_stop", { recording_id: r.id }).catch(() => {});
      sig.send("rec", { on: false });
      say("Recording stopped and saved.");
      return;
    }
    try {
      const j = await api.call("rec_start", { room_id: sess.room.id, mime: "video/webm" });
      R.recording = true;
      setRec({ id: j.recording_id });
      R.recQueue = uploadQueue(async (job) => { await api.upload("rec", job.blob, { room_id: sess.room.id, recording_id: j.recording_id, seq: job.seq }); await api.call("rec_part", { recording_id: j.recording_id, seq: job.seq, bytes: job.blob.size }); });
      R.recorder = compositeRecorder({
        tiles: () => [...document.querySelectorAll("#fincom-call [data-tile] video[data-cam]")].map((v) => ({ video: v, name: v.dataset.name || "", camOn: v.dataset.camon !== "false" })),
        screen: () => document.querySelector("#fincom-call video[data-screen]"),
        audio: () => [R.raw, ...[...R.remotes.values()].map((x) => x.cam).filter(Boolean)].filter(Boolean),
        onPart: (blob, seq) => R.recQueue.add({ blob, seq }),
      });
      sig.send("rec", { on: true, id: j.recording_id });
    } catch (e) { say(e.message); }
  }

  // ---------------------------------------------------------------- screen share
  async function toggleScreen() {
    if (R.screen) { R.screen.getTracks().forEach((t) => t.stop()); R.screen = null; setScreenOn(false); R.media && R.media.setScreen(null); return; }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      R.screen = s; setScreenOn(true); R.media && R.media.setScreen(s);
      s.getVideoTracks()[0].onended = () => { if (R.screen === s) { R.screen = null; setScreenOn(false); R.media && R.media.setScreen(null); } };
    } catch (e) { if (e && e.name !== "NotAllowedError") say("The screen could not be shared: " + e.message); }
  }

  // ---------------------------------------------------------------- chat
  const fileIn = useRef(null), chatBox = useRef(null);
  async function sendChat(text) {
    const body = String(text || "").trim(); if (!body) return;
    try { const j = await api.call("chat", { room_id: sess.room.id, body }); setChat((c) => c.concat([j.message])); sig.send("chat", { message: j.message }); }
    catch (e) { say(e.message); }
  }
  async function sendFile(f) {
    if (!f) return;
    if (f.size > FILE_MAX) { say("A file may be at most 20 MB."); return; }
    try {
      const u = await api.upload("chat", f, { room_id: sess.room.id, name: f.name });
      const j = await api.call("chat", { room_id: sess.room.id, body: "", file: { path: u.path, name: f.name, size: f.size, type: f.type } });
      setChat((c) => c.concat([j.message])); sig.send("chat", { message: j.message });
    } catch (e) { say(e.message); }
  }
  async function openFile(file) { try { const j = await api.call("download", { room_id: sess.room.id, path: file.path }); window.open(j.url, "_blank", "noopener"); } catch (e) { say(e.message); } }

  // ---------------------------------------------------------------- the browser's own captions (when Groq is not set up)
  function toggleCaps() {
    if (caps) { try { R.recog && R.recog.stop(); } catch (e) { /* */ } R.recog = null; setCaps(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { say("Live captions need Chrome or Safari."); return; }
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = "en-IN";
    r.onresult = (e) => { let t = ""; for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript; if (t.trim() && mic) { const line = { pid: sess.me.id, name: myName, text: t.trim().slice(-160) }; sig.send("cap", line); setCapLines((l) => l.filter((x) => x.pid !== line.pid).concat([Object.assign(line, { at: Date.now() })]).slice(-4)); } };
    r.onend = () => { if (R.recog === r) try { r.start(); } catch (e) { /* */ } };
    try { r.start(); R.recog = r; setCaps(true); } catch (e) { say("Captions could not start."); }
  }

  // ---------------------------------------------------------------- working together
  async function toggleCowork() {
    try {
      if (cowork) { await api.call("cowork", { room_id: sess.room.id, on: false }); sig.send("cowork", { on: false }); stopCowork(); return; }
      const j = await api.call("cowork", { room_id: sess.room.id, on: true });
      R.cw = startCowork({ url: base(), key: publicKey(), topic: j.topic, me: sess.me.id, name: myName, hostId: sess.me.id, isHost: true, onState: setCowork });
      sig.send("cowork", { on: true, host: sess.me.id });
      setMin(true);
    } catch (e) { say(e.message); }
  }
  async function joinCowork() {
    if (guest || R.cw) return;
    try {
      const j = await api.call("cowork_join", { room_id: sess.room.id });
      const hostPid = (presence.find((p) => p.role === "host") || {}).pid || "";
      R.cw = startCowork({ url: base(), key: publicKey(), topic: j.topic, me: sess.me.id, name: myName, hostId: hostPid || findHostPid(), isHost: false, onState: setCowork });
      setMin(true);
    } catch (e) { say(e.message); }
  }
  const findHostPid = () => ((R.ch && presenceRef.current.find((p) => p.role === "host")) || {}).pid || "";
  const presenceRef = useRef([]); presenceRef.current = presence;
  function stopCowork() { if (R.cw) { R.cw.stop(); R.cw = null; } setCowork(null); }

  // ---------------------------------------------------------------- remote help (stage 2, RustDesk)
  async function startRemote(reason, peer) {
    try {
      const j = await api.call("remote", { room_id: sess.room.id, op: "start", reason, peer_name: peer ? peer.name : "" });
      setRemote({ phase: "asked", id: j.id, server: j.server || {}, reason, to: peer ? peer.pid : "" });
      sig.send("remote", { state: "card", from: sess.me.id, to: peer ? peer.pid : "", server: j.server || {} });
    } catch (e) { say(e.message); }
  }
  function onRemote(m) {
    // the card only for the person the host chose; the banner for everyone in the call
    if (m.state === "card" && m.to === sess.me.id) setRemote({ phase: "card", server: m.server || {}, from: m.from });
    if (m.state === "started") setRemote((r) => Object.assign({}, r || { from: m.from }, { phase: "started", target: m.to }));
    if (m.state === "ended") setRemote(m.close && m.to === sess.me.id ? { phase: "ended" } : null);
  }
  function markRemote(state) {
    if (state === "started") { setRemote((r) => Object.assign({}, r, { phase: "started" })); sig.send("remote", { state: "started", from: sess.me.id, to: remote && remote.to }); }
    if (state === "ended") { const id = remote && remote.id; setRemote(null); sig.send("remote", { state: "ended", close: true, to: remote && remote.to }); if (id) api.call("remote", { room_id: sess.room.id, op: "end", id }).catch(() => {}); }
  }

  // ---------------------------------------------------------------- the waiting room (the host)
  async function answer(p, yes) {
    try {
      await api.call(yes ? "admit" : "deny", { room_id: sess.room.id, participant_id: p.id });
      setRoster((r) => r.map((x) => x.id === p.id ? Object.assign({}, x, { state: yes ? "admitted" : "denied" }) : x));
      setKnocks((k) => k.filter((x) => x.id !== p.id));
    } catch (e) { say(e.message); }
  }

  // ---------------------------------------------------------------- leaving
  async function leave(endAll, why) {
    if (phase === "ended") return;
    stopCowork();
    if (R.recorder) { await toggleRec().catch(() => {}); }
    stopMic();
    if (R.subMic) { R.subMic.stop(); R.subMic = null; }
    if (R.queue) await Promise.race([R.queue.drain(), new Promise((ok) => setTimeout(ok, 15000))]);
    try { R.recog && R.recog.stop(); } catch (e) { /* */ }
    if (endAll && sess) { sig.send("end", {}); await api.call("end", { room_id: sess.room.id }).catch(() => {}); }
    else if (sess && !why) await api.call("leave", { room_id: sess.room.id }).catch(() => {});
    try { R.media && R.media.stop(); } catch (e) { /* */ }
    setTimeout(() => { try { R.ch && R.ch.close(); } catch (e) { /* */ } }, 300);
    [R.raw, R.screen].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
    if (R.fxp) { R.fxp.stop(); R.fxp = null; }
    setAfter({ why: why || (endAll ? "You ended the call for everyone." : "You left the call."), room: sess && sess.room });
    setPhase("ended"); setMin(false);
  }
  // this device's place was left: Rejoin opens the meeting again here, straight in
  function rejoin() {
    const id = sess && sess.room.id;
    stopCowork(); stopMic();
    if (R.subMic) { R.subMic.stop(); R.subMic = null; }
    try { R.media && R.media.stop(); } catch (e) { /* */ }
    try { R.ch && R.ch.close(); } catch (e) { /* */ }
    [R.raw, R.screen].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
    if (R.fxp) { R.fxp.stop(); R.fxp = null; }
    closeCall(true);
    if (id) setTimeout(() => openCall({ join: id, auto: true }), 0);
  }
  function cancelLobby() { [R.raw].forEach((s) => s && s.getTracks().forEach((t) => t.stop())); if (R.fxp) R.fxp.stop(); if (phase === "asking" || phase === "code") api.call("leave", {}).catch(() => {}); onClose(); }
  useEffect(() => { if (host) host.setAttribute("data-call-min", min ? "true" : "false"); }, [min]);
  useEffect(() => { if (!host) return; host.setAttribute("data-phase", gone ? "gone" : phase); host.setAttribute("data-room", (sess && sess.room.id) || opts.join || ""); host.setAttribute("data-code", (sess && sess.room.code) || codeFrom(opts.code || "") || ""); }, [phase, sess, gone]);
  // a menu of the bar closes on a click elsewhere or Esc
  useEffect(() => {
    if (!menu) return;
    const out = (e) => { if (!e.target.closest || !e.target.closest("[data-bar-menu], [data-bar-opener]")) setMenu(""); };
    const esc = (e) => { if (e.key === "Escape") setMenu(""); };
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [menu]);

  // ---------------------------------------------------------------- drawing: the lobby
  const lobbyLike = ["lobby", "joining", "code", "asking", "denied"].includes(phase);
  if (lobbyLike) {
    const title = guest ? (hello ? hello.title : "Join the meeting") : opts.start ? (opts.start.title || "Start the call") : "Ready to join?";
    const sub = guest && hello ? (hello.firm ? "with " + hello.firm : "") + (hello.scheduled_at ? (hello.firm ? " · " : "") + (typeof fmtDateTime === "function" ? fmtDateTime(hello.scheduled_at) : "") : "") : opts.code ? "Meeting code " + opts.code : "";
    return <div className="call-shell call-lobby-shell" data-call="lobby" data-guest-page={guest ? "" : undefined} data-fx={R.fxp ? (R.fxp.segmenting ? "seg" : "on") : "off"}>
      <div className="lobby-brand"><span className="lobby-mark" aria-hidden="true">F</span> FinCom <span className="lobby-brand-sub">Meetings</span></div>
      <div className="lobby">
        <div className="lobby-left">
          <div className="call-preview"><video ref={preview} autoPlay playsInline muted data-preview="" />{!cam && <div className="call-camoff">Camera is off</div>}
            <span className="lobby-me">{myName}</span>
            <div className="lobby-toggles">
              <button type="button" className={"round" + (mic ? "" : " off")} aria-pressed={!mic} aria-label={noDev.mic ? "No microphone reached this browser" : mic ? "Turn off the microphone" : "Turn on the microphone"} title={noDev.mic ? "No microphone reached this browser" : mic ? "Turn off the microphone" : "Turn on the microphone"} disabled={noDev.mic} onClick={() => setMic(!mic)} data-call-mic="">{mic ? <Mic width={20} height={20} /> : <MicOff width={20} height={20} />}</button>
              <button type="button" className={"round" + (cam ? "" : " off")} aria-pressed={!cam} aria-label={noDev.cam ? "No camera reached this browser" : cam ? "Turn off the camera" : "Turn on the camera"} title={noDev.cam ? "No camera reached this browser" : cam ? "Turn off the camera" : "Turn on the camera"} disabled={noDev.cam} onClick={() => setCam(!cam)} data-call-cam="">{cam ? <Video width={20} height={20} /> : <VideoOff width={20} height={20} />}</button>
              <button type="button" className={"round" + (panel === "effects" ? " on" : "")} aria-label="Background and look" title="Background and look" onClick={() => setPanel(panel === "effects" ? "" : "effects")} data-call-effects=""><Sparkles width={20} height={20} /></button>
            </div>
          </div>
          <div className="lobby-devices">
            <label><span>Microphone</span><select value={dev.mic} onChange={(e) => pickDevice("mic", e.target.value)} data-dev-mic="">{devices.mics.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || "Microphone " + (i + 1)}</option>)}{!devices.mics.length && <option value="">The browser's choice</option>}</select></label>
            <label><span>Camera</span><select value={dev.cam} onChange={(e) => pickDevice("cam", e.target.value)} data-dev-cam="">{devices.cams.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || "Camera " + (i + 1)}</option>)}{!devices.cams.length && <option value="">The browser's choice</option>}</select></label>
            {devices.outs.length > 0 && <label><span>Speaker</span><select value={dev.out} onChange={(e) => pickDevice("out", e.target.value)} data-dev-out="">{devices.outs.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || "Speaker " + (i + 1)}</option>)}</select></label>}
          </div>
          {(noDev.mic || noDev.cam) && <NoDeviceNote className="lobby-nodev" />}
          {panel === "effects" && <Effects fx={fx} change={changeFx} note={fxNote} />}
        </div>
        <div className="lobby-right">
          <h2 data-lobby-title="">{phase === "asking" ? "Asking to join…" : phase === "denied" ? "You can't join this call" : title}</h2>
          {sub && phase !== "asking" && <p className="lobby-sub">{sub}</p>}
          {!guest && phase !== "denied" && <p className="lobby-sub">Joining as <b>{accountName}</b></p>}
          {guest && (phase === "lobby" || phase === "joining") && signinCode && <div className="lobby-choice" data-member-choice="">
            <button type="button" className="btn" onClick={() => signIn(signinCode)} data-member-signin="">Sign in with FinCom</button>
            <small>Part of the firm (or the host)? Sign in and you join as yourself, straight in.</small>
          </div>}
          {guest && (phase === "lobby" || phase === "joining") && signinCode && <p className="lobby-or" data-guest-or="">Or join as a guest</p>}
          {guest && (phase === "lobby" || phase === "joining") && <form className="lobby-form" onSubmit={(e) => { e.preventDefault(); askToJoin(); }}>
            <label className="f"><span>Your name</span><input value={gname} onChange={(e) => setGname(e.target.value)} required minLength={2} maxLength={60} autoComplete="name" data-guest-name="" /></label>
            <label className="f"><span>Your email</span><input type="email" value={gemail} onChange={(e) => setGemail(e.target.value)} required autoComplete="email" data-guest-email="" /></label>
            <p className="lobby-note">{hello && hello.mail ? "A code is sent to this email to check it is yours. " : ""}The host sees your name and lets you in. Your camera and microphone are used only in this call.</p>
          </form>}
          {phase === "code" && <form className="lobby-form" onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <label className="f"><span>The 6-figure code sent to {gemail}</span><input inputMode="numeric" pattern="[0-9]{6}" value={otp} onChange={(e) => setOtp(e.target.value)} required autoComplete="one-time-code" data-guest-code="" /></label>
            <button type="submit" className="btn primary" data-guest-verify="">Check the code</button>
          </form>}
          {phase === "asking" && !timedOut && <p className="lobby-wait" role="status" data-guest-waiting="" data-host-online={wait ? String(!!wait.host_online) : undefined}><span className="lobby-spin" aria-hidden="true" />{wait ? waitText(wait) : "You'll join the call when someone lets you in."}</p>}
          {phase === "asking" && !timedOut && wait && !wait.host_online && <p className="lobby-note" data-guest-keep="">Keep this page open: you join as soon as they let you in.</p>}
          {phase === "asking" && timedOut && <div role="status" data-guest-timeout=""><p className="lobby-wait">No one has let you in yet.</p>
            <p className="lobby-note">The host may be busy. Ask again, or contact them another way.</p>
            <button type="button" className="btn primary" onClick={askAgain} data-guest-retry="">Ask again</button></div>}
          {phase === "denied" && <p data-guest-denied="">{err || "Someone in the call denied your request to join."}</p>}
          {(phase === "lobby" || phase === "joining") && <div className="lobby-subs">
            <label><span>My language</span><select value={subs.lang} onChange={(e) => setMySubs({ lang: e.target.value })} data-subs-lang="">{SUB_LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}{l.native ? " · " + l.native : ""}</option>)}</select></label>
            <label className="lobby-switch"><input type="checkbox" checked={subs.on} onChange={(e) => setMySubs({ on: e.target.checked })} data-subs-lobby="" /> Subtitles: {subs.on ? "On" : "Off"}</label>
          </div>}
          {err && phase !== "denied" && <p className="call-err" role="alert" data-guest-error="">{err}</p>}
          <div className="lobby-acts">
            {(phase === "lobby" || phase === "joining") && (guest
              ? <button type="button" className="btn primary lobby-go" disabled={phase === "joining"} title={phase === "joining" ? "Asking…" : undefined} onClick={askToJoin} data-guest-continue="" data-call-ask="">{phase === "joining" ? "Asking…" : "Ask to join"}</button>
              : <button type="button" className="btn primary lobby-go" disabled={phase === "joining"} title={phase === "joining" ? "Joining…" : undefined} onClick={join} data-call-join="">{phase === "joining" ? "Joining…" : "Join now"}</button>)}
            <button type="button" className="btn" onClick={cancelLobby} data-call-cancel="">{phase === "asking" ? "Cancel the request" : "Cancel"}</button>
          </div>
        </div>
      </div>
    </div>;
  }

  if (phase === "ended") return <div className="call-shell" data-call="ended"><AfterCall api={api} after={after} canStaff={canStaff} onClose={onClose} guest={!!guest} lang={subs.lang} /></div>;

  // ---------------------------------------------------------------- drawing: in the call
  const pres = presence.filter((p) => p.pid && p.pid !== sess.me.id);
  const nameOf = (pid) => ((presence.find((p) => p.pid === pid) || roster.find((p) => p.id === pid) || {}).name) || "Someone";
  const screens = [...R.remotes.entries()].filter(([, s]) => s.screen).map(([pid, s]) => ({ pid, stream: s.screen }));
  if (R.screen) screens.unshift({ pid: sess.me.id, stream: R.screen, mine: true });
  const waiting = roster.filter((p) => p.state === "waiting");
  const held = rec && !acked && !R.recording;
  const info = { room_id: sess.room.id, code: sess.room.code, title: sess.room.title, at: sess.room.scheduled_at, minutes: sess.room.minutes };
  const shownSubs = subs.on ? subLines.map((l) => ({ l, v: subLine(l, subs.lang) })) : [];
  const toggle = (p) => setPanel(panel === p ? "" : p);
  return <div className={"call-shell call-in" + (min ? " min" : "") + (panel ? " has-side" : "")} data-call="in" data-room={sess.room.id} data-fx={R.fxp ? (R.fxp.segmenting ? "seg" : "on") : "off"} data-mode={sess.mode}>
    <header className="call-top">
      <span className="call-when" data-call-clock="">{clock}{sess.room.code ? <> <span aria-hidden="true">|</span> <span data-call-code="">{sess.room.code}</span></> : null}</span>
      <b className="call-title">{sess.room.title}</b>
      {rec && <span className="call-rec" data-call-recording="" role="status">● {CONSENT_TEXT}</span>}
      {status === "reconnecting" && <span className="call-warn" data-call-reconnecting="">Reconnecting…</span>}
      {level !== "high" && <span className="call-warn" data-call-level={level}>{level === "audio" || audioOnly ? "Weak line: audio only" : "Weak line: picture made smaller"}</span>}
      {sess.mode === "p2p" && <span className="call-note" title="Until the call service is set up, calls run directly between computers">Up to {sess.max} people</span>}
      {cowork && <span className="call-note">Working together</span>}
      {needTap && <button type="button" className="call-primary" onClick={() => { document.querySelectorAll("#fincom-call video[data-cam]:not(.mirror)").forEach((x) => { x.muted = false; x.play().catch(() => {}); }); setNeedTap(false); }} data-call-sound="">Turn on sound</button>}
      <button type="button" className="call-btn small" onClick={() => setMin(!min)} data-call-min-btn="">{min ? "Open the call" : "Make small"}</button>
    </header>
    {remote && remote.phase === "started" && <div className="call-banner" data-remote-banner="" role="status">Remote control in progress{remote.id ? "" : remote.target === sess.me.id ? ": " + nameOf(remote.from) + " is controlling your computer through RustDesk." : ""}{remote.id && <button type="button" className="call-btn small" onClick={() => markRemote("ended")} data-remote-end="">End</button>}</div>}
    {remote && !remote.id && remote.phase === "card" && <RemoteCard remote={remote} share={(id) => { sig.send("rdid", { id: rustdeskId(id), name: myName }); setRemote(Object.assign({}, remote, { shared: true })); }} />}
    {remote && !remote.id && remote.phase === "ended" && <div className="call-banner" data-remote-ended="">Remote control has ended. Close RustDesk now (or press Disconnect in RustDesk). <button type="button" className="call-btn small" onClick={() => setRemote(null)}>OK</button></div>}
    {remote && remote.id && remote.phase === "asked" && <div className="call-card" data-remote-host="">
      <b>Remote help</b> · reason: {remote.reason}
      {remote.rid ? <p>Their RustDesk ID: <b data-remote-id="">{remote.rid}</b>. <a className="call-primary" href={rustdeskUri(remote.rid)} data-remote-connect="">Connect in RustDesk</a>{" "}
        <button type="button" className="call-btn small" onClick={() => { try { navigator.clipboard.writeText(remote.rid); } catch (e) { /* */ } }}>Copy ID</button>
        {" "}<button type="button" className="call-btn small" onClick={() => markRemote("started")} data-remote-started="">They accepted: mark started</button></p>
        : <p>Waiting for them to share their RustDesk ID (their screen shows the steps).</p>}
      <button type="button" className="call-btn small" onClick={() => markRemote("ended")}>Cancel</button>
    </div>}
    {noDev.mic && !min && <div className="call-banner call-listen" data-call-listen-only="" role="status"><NoDeviceNote text={"Listening only: no microphone" + (noDev.cam ? " or camera" : "") + " reached this browser, so the others cannot hear you (chat works)."} /></div>}
    {held && <div className="call-modal" role="dialog" aria-modal="true" data-consent="">
      <div><h3>{CONSENT_TEXT}</h3><p>The host is recording this call (picture, voices and the words said, for a transcript). Your microphone and camera stay off until you choose.</p>
        <button type="button" className="call-primary" onClick={accept} data-consent-stay="">Stay in the call</button> <button type="button" className="call-btn" onClick={declineRec} data-consent-leave="">Leave</button></div></div>}
    {/* someone asks to join: seen over the call whatever is open, with a sound */}
    {gone && <div className="call-gone" role="alertdialog" aria-modal="true" data-call-gone="">
      <div><h3>You're no longer in this meeting</h3><p data-call-gone-text="">{gone}</p>
        <button type="button" className="call-primary" onClick={rejoin} data-call-rejoin="">Rejoin</button> <button type="button" className="call-btn" onClick={() => leave(false, "You left the call.")} data-call-gone-close="">Close</button></div></div>}
    {canAdmit && knocks.length > 0 && <div className="call-knock" role="alert" data-knock="">
      {knocks.length === 1 ? <><span><b>{knocks[0].name}</b> wants to join this call{knocks[0].email ? <small> · {knocks[0].email}{knocks[0].verified ? " · email checked" : ""}</small> : null}</span>
        <button type="button" className="call-primary" onClick={() => answer(knocks[0], true)} data-knock-admit="">Admit</button>
        <button type="button" className="call-btn" onClick={() => answer(knocks[0], false)} data-knock-deny="">Deny</button>
        <button type="button" className="call-btn" onClick={() => setPanel("people")} data-knock-view="">View</button></>
        : <><span><b>{knocks.length} people</b> want to join this call</span>
          <button type="button" className="call-primary" onClick={() => knocks.forEach((p) => answer(p, true))} data-knock-admit-all="">Admit all</button>
          <button type="button" className="call-btn" onClick={() => setPanel("people")} data-knock-view="">View all</button></>}
    </div>}
    {ready && !min && <div className="call-ready" data-call-ready="">
      <button type="button" className="call-ready-x" aria-label="Close" onClick={() => setReady(false)} data-call-ready-close=""><X width={18} height={18} /></button>
      <MeetCard info={info} api={api} />
    </div>}
    <div className="call-main">
      {screens.length > 0 && <div className="call-stage">{screens.slice(0, 1).map((s) => <Vid key={s.pid} stream={s.stream} screen name={(s.mine ? "Your" : nameOf(s.pid) + "’s") + " screen"} />)}</div>}
      <div className="call-grid" data-count={pres.length + 1}>
        <Tile me name={myName + " (you)"} stream={selfStream} camOn={cam} micOn={mic && !held} hand={hand} react={reacts[sess.me.id]} speaking={!!speaking[sess.me.id]} />
        {pres.map((p) => { const s = R.remotes.get(p.pid) || {}; return <Tile key={p.pid} name={p.name + (p.guest ? " (guest)" : "")} stream={s.cam} camOn={p.cam !== false && !!s.cam} micOn={p.mic !== false} hand={p.hand} react={reacts[p.pid]} state={s.state} speaking={!!speaking[p.pid]} />; })}
      </div>
      {(shownSubs.length > 0 || (caps && capLines.length > 0)) && <div className="call-caps" data-captions="" aria-live="polite">
        {shownSubs.map(({ l, v }) => <div key={l.pid} className="call-sub" data-sub-line={l.name} data-sub-lang={v.original ? subs.lang : l.lang} title={v.original ? "As said: " + l.text : undefined}
          onClick={() => v.original && setShowOrig((o) => Object.assign({}, o, { [l.pid]: !o[l.pid] }))}>
          <b>{l.name}:</b> <span data-sub-text="">{showOrig[l.pid] && v.original ? l.text : v.text}</span>{v.paused && <small className="call-sub-paused" data-sub-paused=""> · translation paused</small>}</div>)}
        {caps && capLines.map((l) => <div key={"c" + l.pid}><b>{l.name}:</b> {l.text}</div>)}
      </div>}
      {subNote && subs.on && <p className="call-subnote" data-sub-note="">{subNote}</p>}
      {panel === "people" && <aside className="call-side" data-call-people="">
        <div className="call-side-head"><h3>People</h3><button type="button" className="call-x" aria-label="Close" onClick={() => setPanel("")}><X width={18} height={18} /></button></div>
        {isHost && <button type="button" className="call-btn wide" onClick={() => setPanel("details")} data-people-add="">Add people (link, code, email)</button>}
        {canAdmit && waiting.length > 0 && <><h4>Waiting to join ({waiting.length})</h4>{waiting.map((p) => <div key={p.id} className="call-person" data-waiting={p.name}><span>{p.name} <small>{p.email}{p.verified ? " · email checked" : " · email not checked"}</small></span>
          <button type="button" className="call-btn small" onClick={() => answer(p, true)} data-admit="">Admit</button>
          <button type="button" className="call-btn small" onClick={() => answer(p, false)} data-deny="">Deny</button></div>)}</>}
        <h4>In the call ({pres.length + 1})</h4>
        <div className="call-person"><span>{myName} (you){isHost ? " · host" : ""}</span></div>
        {pres.map((p) => <div key={p.pid} className="call-person" data-person={p.name}><span>{p.name}{p.guest ? " (guest)" : ""}{p.role === "host" ? " · host" : ""}{p.hand ? " ✋" : ""}{p.mic === false ? " · muted" : ""}</span>
          {isHost && <button type="button" className="call-btn small danger" onClick={async () => { if (!confirm("Remove " + p.name + " from the call?")) return; try { await api.call("remove", { room_id: sess.room.id, participant_id: p.pid }); sig.send("kick", { pid: p.pid }); R.media && R.media.forget(p.pid); sig.send("rekey", {}); const t = await api.call("topic", { room_id: sess.room.id }); openChannel(t.topic); } catch (e) { say(e.message); } }} data-remove="">Remove</button>}
          {amHost && canStaff && !remote && <button type="button" className="call-btn small" onClick={() => { const reason = prompt("Remote help for " + p.name + ": why do you need to control their computer? (kept in the log)"); if (reason) startRemote(reason, p); }} data-remote-start="">Remote help</button>}</div>)}
        {amHost && <button type="button" className="call-btn small" onClick={() => { sig.send("mute-all", { from: sess.me.id }); say("Everyone else is muted."); }} data-mute-all="">Mute all</button>}
      </aside>}
      {panel === "details" && <aside className="call-side" data-call-details="">
        <div className="call-side-head"><h3>Meeting details</h3><button type="button" className="call-x" aria-label="Close" onClick={() => setPanel("")}><X width={18} height={18} /></button></div>
        <MeetCard title=" " info={info} api={isHost ? api : null} guest={!isHost} />
      </aside>}
      {panel === "chat" && <aside className="call-side" data-call-chat="">
        <div className="call-side-head"><h3>In-call messages</h3><button type="button" className="call-x" aria-label="Close" onClick={() => setPanel("")}><X width={18} height={18} /></button></div>
        <div className="call-chat" ref={chatBox}>{chat.map((m) => <div key={m.id} className="call-msg"><b>{m.author}</b> <small>{typeof fmtTime === "function" ? fmtTime(m.at) : ""}</small>
          <div>{m.file ? <button type="button" className="linkbtn" onClick={() => openFile(m.file)} data-chat-file={m.file.name}>📎 {m.file.name} ({fmtSize(m.file.size)})</button>
            : chatParts(m.body).map((p, i) => p.link ? <a key={i} href={p.link} target="_blank" rel="noopener noreferrer nofollow">{p.link}</a> : <span key={i}>{p.text}</span>)}</div></div>)}</div>
        <form onSubmit={(e) => { e.preventDefault(); const t = e.target.elements.msg; sendChat(t.value); t.value = ""; }} className="call-chatform">
          <input name="msg" aria-label="Message" placeholder="Send a message" maxLength={4000} data-chat-input="" />
          <button type="submit" className="call-btn small">Send</button>
          <button type="button" className="call-btn small" onClick={() => fileIn.current && fileIn.current.click()} data-chat-attach="">File</button>
          <input ref={fileIn} type="file" hidden onChange={(e) => { sendFile(e.target.files[0]); e.target.value = ""; }} data-chat-fileinput="" />
        </form>
      </aside>}
      {panel === "effects" && <aside className="call-side"><div className="call-side-head"><h3>Background and look</h3><button type="button" className="call-x" aria-label="Close" onClick={() => setPanel("")}><X width={18} height={18} /></button></div><Effects fx={fx} change={changeFx} note={fxNote} /></aside>}
    </div>
    <footer className="call-bar" role="toolbar" aria-label="Call controls">
      <span className="call-bar-left" aria-hidden="true">{sess.room.title}</span>
      <div className="call-bar-mid">
        <button type="button" className={"round" + (mic ? "" : " off")} aria-pressed={!mic} aria-label={mic ? "Mute" : "Unmute"} title={noDev.mic ? "No microphone reached this browser" : mic ? "Turn off the microphone" : "Turn on the microphone"} disabled={noDev.mic} onClick={() => setMic(!mic)} data-call-mic="">{mic ? <Mic width={20} height={20} /> : <MicOff width={20} height={20} />}</button>
        <button type="button" className={"round" + (cam ? "" : " off")} aria-pressed={!cam} aria-label={cam ? "Camera off" : "Camera on"} title={noDev.cam ? "No camera reached this browser" : cam ? "Turn off the camera" : "Turn on the camera"} disabled={noDev.cam} onClick={() => setCam(!cam)} data-call-cam="">{cam ? <Video width={20} height={20} /> : <VideoOff width={20} height={20} />}</button>
        {navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && <button type="button" className={"round" + (screenOn ? " on" : "")} aria-pressed={screenOn} aria-label={screenOn ? "Stop presenting" : "Present now"} title={screenOn ? "Stop presenting" : "Present your screen"} onClick={toggleScreen} data-call-share=""><MonitorUp width={20} height={20} /></button>}
        <button type="button" className={"round" + (hand ? " on" : "")} aria-pressed={hand} aria-label={hand ? "Lower hand" : "Raise hand"} title={hand ? "Lower hand" : "Raise hand"} onClick={() => setHand(!hand)} data-call-hand=""><Hand width={20} height={20} /></button>
        <span className="call-pop-wrap">
          <button type="button" className={"round" + (menu === "reacts" ? " on" : "")} aria-label="Send a reaction" title="Send a reaction" aria-expanded={menu === "reacts"} onClick={() => setMenu(menu === "reacts" ? "" : "reacts")} data-bar-opener="" data-call-reacts=""><Smile width={20} height={20} /></button>
          <span className="call-pop call-reacts" hidden={menu !== "reacts"} data-bar-menu="">{REACTIONS.map((e) => <button key={e} type="button" className="call-react" aria-label={"React " + e} onClick={() => { sig.send("react", { pid: sess.me.id, e }); setReacts((r) => Object.assign({}, r, { [sess.me.id]: { e, at: Date.now() } })); setMenu(""); }} data-call-react={e}>{e}</button>)}</span>
        </span>
        <span className="call-pop-wrap">
          <button type="button" className={"round" + (subs.on ? " on" : "")} aria-pressed={subs.on} aria-label={subs.on ? "Turn off subtitles" : "Turn on subtitles"} title={(subs.on ? "Subtitles on" : "Subtitles off") + " · " + subLangName(subs.lang)} onClick={() => setMySubs({ on: !subs.on })} data-call-caps="" data-call-subs=""><Captions width={20} height={20} /></button>
          <button type="button" className="round tiny" aria-label="Subtitle language" title="Subtitle language" onClick={() => setMenu(menu === "subs" ? "" : "subs")} data-bar-opener="" data-call-subs-menu="">▾</button>
          <span className="call-pop call-subs-pop" hidden={menu !== "subs"} data-bar-menu="">
            <label className="lobby-switch"><input type="checkbox" checked={subs.on} onChange={(e) => setMySubs({ on: e.target.checked })} data-subs-toggle="" /> Subtitles {subs.on ? "on" : "off"}</label>
            <label><span>My language</span><select value={subs.lang} onChange={(e) => setMySubs({ lang: e.target.value })} data-subs-lang="">{SUB_LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}{l.native ? " · " + l.native : ""}</option>)}</select></label>
            <small>Only you see your subtitles. Off: nothing is translated for you.</small>
          </span>
        </span>
        <span className="call-pop-wrap">
          <button type="button" className={"round" + (menu === "more" ? " on" : "")} aria-label="More options" title="More options" aria-expanded={menu === "more"} onClick={() => setMenu(menu === "more" ? "" : "more")} data-bar-opener="" data-call-more=""><EllipsisVertical width={20} height={20} /></button>
          <span className="call-pop call-more" hidden={menu !== "more"} data-bar-menu="" role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenu(""); toggle("effects"); }} data-call-effects="">Background and effects</button>
            <button type="button" role="menuitem" aria-pressed={audioOnly} onClick={() => { const a = !audioOnly; setAudioOnly(a); R.media && R.media.setAudioOnly(a); setMenu(""); }} data-call-audioonly="">{audioOnly ? "Picture back on (audio only now)" : "Audio only (a weak line)"}</button>
            <button type="button" role="menuitem" aria-pressed={caps} onClick={() => { toggleCaps(); setMenu(""); }} data-call-browser-caps="">{caps ? "Stop the browser's captions" : "The browser's own captions (English)"}</button>
            {amHost && <button type="button" role="menuitem" onClick={() => { setMenu(""); toggleRec(); }} data-call-record="">{rec ? "Stop recording" : "Record the call"}</button>}
            {amHost && sess.room.kind !== "class" && <button type="button" role="menuitem" onClick={() => { setMenu(""); toggleCowork(); }} data-call-cowork="">{cowork ? "Stop working together" : "Work together (FinCom side by side)"}</button>}
            {cowork && !amHost && <button type="button" role="menuitem" onClick={() => { R.cw && R.cw.setFollow(!cowork.follow); setMenu(""); }} data-call-follow="">{cowork.follow ? "Stop following" : "Follow the host"}</button>}
            {amHost && <button type="button" role="menuitem" onClick={() => { setMenu(""); sig.send("mute-all", { from: sess.me.id }); say("Everyone else is muted."); }} data-call-muteall="">Mute everyone else</button>}
            <button type="button" role="menuitem" onClick={() => { setMenu(""); setMin(!min); }}>{min ? "Open the call" : "Make the call small (use FinCom beside it)"}</button>
            {amHost && <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(""); leave(true); }} data-call-end="">End the call for everyone</button>}
          </span>
        </span>
        <button type="button" className="round leave" aria-label="Leave call" title="Leave call" onClick={() => leave(false)} data-call-leave=""><PhoneOff width={22} height={22} /></button>
      </div>
      <div className="call-bar-right">
        <button type="button" className={"flat" + (panel === "details" ? " on" : "")} aria-label="Meeting details" title="Meeting details" onClick={() => toggle("details")} data-call-details-btn=""><Info width={20} height={20} /></button>
        <button type="button" className={"flat" + (panel === "people" ? " on" : "")} aria-label={"People" + (canAdmit && waiting.length ? ", " + waiting.length + " waiting" : "")} title="People" onClick={() => toggle("people")} data-call-people-btn=""><Users width={20} height={20} />
          <span className="flat-n">{pres.length + 1}</span>{canAdmit && waiting.length > 0 && <span className="badge" data-waiting-count="">{waiting.length}</span>}</button>
        <button type="button" className={"flat" + (panel === "chat" ? " on" : "")} aria-label={"Chat" + (unread && panel !== "chat" ? ", " + unread + " new" : "")} title="Chat with everyone" onClick={() => { toggle("chat"); setUnread(0); }} data-call-chat-btn=""><MessageSquare width={20} height={20} />{unread > 0 && panel !== "chat" && <span className="badge" data-chat-unread="">{unread}</span>}</button>
      </div>
    </footer>
  </div>;
}

function Vid({ stream, muted, name, screen, me }) {
  const v = useRef(null);
  useEffect(() => {
    const el = v.current; if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream || null;
    // started by hand (a stream set after the element is made does not always start); a browser that will not play sound
    // before a tap plays it muted and says so on the bar (Safari on a phone)
    if (stream) el.play().catch(() => { if (!muted) { el.muted = true; el.play().catch(() => {}); window.dispatchEvent(new Event("fincom-call-tap")); } });
  }, [stream]);
  return <video ref={v} autoPlay playsInline muted={!!muted} data-cam={screen ? undefined : ""} data-screen={screen ? "" : undefined} data-name={name} className={me ? "mirror" : ""} />;
}
function Tile({ name, stream, camOn, micOn, hand, react, me, state, speaking }) {
  return <div className={"call-tile" + (speaking && micOn ? " speaking" : "")} data-tile={name} data-speaking={speaking && micOn ? "" : undefined}>
    {stream ? <Vid stream={stream} muted={me} name={name} me={me} /> : null}
    {(!camOn || !stream) && <div className="call-camoff"><span className="call-avatar">{String(name || "?").slice(0, 1).toUpperCase()}</span></div>}
    <span className="call-name">{hand ? "✋ " : ""}{name}{micOn ? "" : " · muted"}{state === "disconnected" ? " · reconnecting" : ""}</span>
    {!micOn && <span className="call-muted" aria-hidden="true">🔇</span>}
    {react && <span className="call-float" data-reaction={react.e}>{react.e}</span>}
  </div>;
}

function Effects({ fx, change, note }) {
  const light = lightDevice(), own = useRef(null);
  const bgImage = (f) => change({ bg: "image", image: (window.TDS_ASSETS || "assets/") + f });
  return <div className="call-fx" data-fx-panel="">
    <h4>Background</h4>
    {light && <p className="call-note" data-fx-light="">This device is light: blur only is suggested (the others may make your picture stutter).</p>}
    <div className="call-row wrap">
      <button type="button" className={"call-btn small" + (fx.bg === "none" ? " on" : "")} onClick={() => change({ bg: "none" })} data-fx-bg="none">None</button>
      <button type="button" className={"call-btn small" + (fx.bg === "blur" ? " on" : "")} onClick={() => change({ bg: "blur" })} data-fx-bg="blur">Blur</button>
      {BACKGROUNDS.map((b) => <button key={b.id} type="button" className={"call-btn small" + (fx.bg === "image" && fx.image.endsWith(b.file) ? " on" : "")} onClick={() => bgImage(b.file)} data-fx-bg={b.id}>{b.name}</button>)}
      <button type="button" className={"call-btn small" + (fx.bg === "image" && fx.image.startsWith("data:") ? " on" : "")} onClick={() => own.current && own.current.click()} data-fx-bg="own">Your own image</button>
      <input ref={own} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files[0]; if (f) shrinkImage(f).then((u) => change({ bg: "image", image: u }), (er) => alert(er.message)); e.target.value = ""; }} />
    </div>
    <label className="call-check"><input type="checkbox" checked={fx.light} onChange={(e) => change({ light: e.target.checked })} data-fx-light-toggle="" /> Lighting fix (brightness and contrast){light ? " · may be slow here" : ""}</label>
    <label className="call-check">Touch-up <input type="range" min="0" max="1" step="0.25" value={fx.touch} onChange={(e) => change({ touch: Number(e.target.value) })} aria-label="Touch-up" data-fx-touch="" />{light ? " · may be slow here" : ""}</label>
    {note && <p className="call-err">{note}</p>}
    <p className="call-note">All off by default; remembered for you on this device. Nothing of your picture leaves this computer except the call itself.</p>
  </div>;
}

// the card the other person sees for remote help: RustDesk's own download, their ID, plain steps; RustDesk's own accept
// window on their side is the consent; FinCom never asks for a password and never sets up unattended access
function RemoteCard({ remote, share }) {
  const [id, setId] = useState("");
  const srv = remote.server || {};
  return <div className="call-card" data-remote-card="">
    <b>Remote help: the host asks to control your computer</b>
    <ol>
      <li>Install or open <b>RustDesk</b>: <a href="https://rustdesk.com/download" target="_blank" rel="noopener noreferrer">rustdesk.com/download</a> (Windows or Mac, free).</li>
      {(srv.id_server || srv.relay) && <li>In RustDesk, Settings › Network › ID/Relay server: ID server <code>{srv.id_server}</code>{srv.relay ? <>, relay <code>{srv.relay}</code></> : null}{srv.key ? <>, key <code>{srv.key}</code></> : null}.</li>}
      <li>Type the <b>ID</b> RustDesk shows under "Your Desktop" here and press Share. Never share its password.</li>
      <li>When RustDesk asks you to accept, accept only if you expected this. You can stop at any time in RustDesk.</li>
    </ol>
    <input value={id} onChange={(e) => setId(e.target.value)} placeholder="RustDesk ID, e.g. 123 456 789" aria-label="Your RustDesk ID" data-remote-idinput="" />
    <button type="button" className="call-primary" disabled={!rustdeskIdOk(id)} onClick={() => share(id)} data-remote-share="">Share my RustDesk ID</button>
    {remote.shared && <small> · shared; wait for RustDesk's request</small>}
    <p className="call-note"><a href="./remote-help.html" target="_blank" rel="noopener">How remote help works (English / हिन्दी)</a></p>
  </div>;
}

// after the call: the transcript (each person's own microphone through Whisper), the summary, the action items
function AfterCall({ api, after, canStaff, onClose, guest, lang }) {
  const [t, setT] = useState(null), [busy, setBusy] = useState(""), [sum, setSum] = useState(null), [pick, setPick] = useState({}), [msg, setMsg] = useState("");
  // the summary in the person's own language (default English; the subtitle language they chose is offered)
  const [sumLang, setSumLang] = useState(lang && lang !== "hinglish" ? lang : "en");
  const room = after && after.room;
  async function transcribe() {
    setBusy("transcript"); setMsg("");
    try {
      for (let i = 0; i < 200; i++) {
        const j = await api.call("transcribe", { room_id: room.id });
        setT(j);
        if (!j.left) break;
        if (j.wait) { setMsg("Whisper's free limit for this minute is reached; going on in a minute…"); await new Promise((ok) => setTimeout(ok, j.wait * 1000)); }
      }
    } catch (e) { setMsg(e.message); }
    setBusy("");
  }
  async function summarise() { setBusy("summary"); setMsg(""); try { const j = await api.call("summarise", { room_id: room.id, lang: sumLang }); setSum(j.summary); setPick(Object.fromEntries(j.summary.actions.map((a, i) => [i, true]))); } catch (e) { setMsg(e.message); } setBusy(""); }
  async function addTasks() {
    const items = sum.actions.filter((a, i) => pick[i]);
    try { const j = await api.call("tasks", { room_id: room.id, items }); setMsg(j.added + " added to the client's due list."); } catch (e) { setMsg(e.message); }
  }
  return <div className="call-after" data-call-after="">
    <h2>{after && after.why}</h2>
    {!guest && canStaff && room && <>
      <p className="call-note">The recording, transcript, summary and chat stay with {room.client_id ? "the client" : room.kind === "class" ? "the batch" : "this meeting"}.</p>
      <div className="call-row">
        <button type="button" className="call-btn" disabled={!!busy} onClick={transcribe} data-make-transcript="">{busy === "transcript" ? "Making the transcript…" : "Make the transcript"}</button>
        <button type="button" className="call-btn" disabled={!!busy || !(t && t.lines && t.lines.length)} title={!(t && t.lines && t.lines.length) ? "Make the transcript first" : undefined} onClick={summarise} data-make-summary="">{busy === "summary" ? "Summarising…" : "Summary and action items"}</button>
        <label className="call-check">in <select value={sumLang} onChange={(e) => setSumLang(e.target.value)} data-summary-lang="">{SUB_LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      </div>
      {t && <p className="call-note" data-transcript-progress="">{t.done} of {t.all} pieces read{t.left ? ", " + t.left + " to go" : ""}.</p>}
      {t && t.lines && t.lines.length > 0 && <pre className="call-transcript" data-transcript="">{transcriptText(t.lines)}</pre>}
      {sum && <div data-summary="">
        <h3>Summary</h3><p>{sum.summary}</p>
        {sum.decisions.length > 0 && <><h4>Decisions</h4><ul>{sum.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></>}
        {sum.actions.length > 0 && <><h4>Action items</h4>{sum.actions.map((a, i) => <label key={i} className="call-check"><input type="checkbox" checked={!!pick[i]} onChange={(e) => setPick(Object.assign({}, pick, { [i]: e.target.checked }))} /> {a.title}{a.who ? " · " + a.who : ""}{a.due ? " · by " + a.due : ""}</label>)}
          {room.client_id ? <button type="button" className="call-btn" onClick={addTasks} data-add-tasks="">Add to the client's due list</button>
            : <button type="button" className="call-btn" onClick={() => { try { navigator.clipboard.writeText(sum.actions.map((a) => "- " + a.title).join("\n")); setMsg("Copied."); } catch (e) { /* */ } }}>Copy the action items</button>}</>}
      </div>}
    </>}
    {msg && <p className="call-note" role="status" data-after-msg="">{msg}</p>}
    <button type="button" className="call-primary" onClick={onClose} data-call-close="">Close</button>
  </div>;
}
