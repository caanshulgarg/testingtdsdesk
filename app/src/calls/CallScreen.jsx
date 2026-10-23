// The call screen (stage 1, the owner's approval of 23-Oct-2026), in its own file, loaded only when a call is opened
// (app/src/calls/launch.js). It is drawn over FinCom in its own root, and can be made small (a dock in the corner) so
// FinCom stays usable beside it, which "Work together" needs.
// Before joining: the camera and microphone, the effects. In the call: mute, camera, screen share, people, raise hand,
// reactions, chat with links and files, live captions (this browser's own speech recogniser), the host's admit / remove /
// mute all, recording with the notice everyone must see, "Work together", remote help (RustDesk), a weak line made
// smaller then audio only, and reconnecting by itself. After the call: the transcript, the summary and the action items.
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { makeApi, base, publicKey } from "./api.js";
import { channel } from "./realtime.js";
import { createMedia } from "./media.js";
import { makeEffects, loadChoice, saveChoice, effectsOn, BACKGROUNDS, lightDevice, shrinkImage } from "./effects.js";
import { compositeRecorder, micPieces, uploadQueue } from "./recorder.js";
import { chatParts, CONSENT_TEXT, mayPublish, FILE_MAX, rustdeskUri, rustdeskIdOk, rustdeskId, transcriptText } from "./rules.js";
import { startCowork } from "./cowork.js";
import "./calls.css";

const REACTIONS = ["👍", "👏", "😂", "🎉", "❤️", "🙏"];
const say = (s) => { try { toast(s); } catch (e) { /* the screen shows it too */ } };
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";

let root = null, host = null;
// opts: {start: {kind, client_id, batch_id, title}} | {join: room_id} | {guest: {gt, session, name}}
export function openCall(opts) {
  if (host) { host.setAttribute("data-call-min", "false"); return; }
  host = document.createElement("div"); host.id = "fincom-call"; host.setAttribute("data-call-min", "false");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<Call opts={opts} onClose={closeCall} />);
}
export function closeCall() { try { root && root.unmount(); } catch (e) { /* */ } if (host) host.remove(); root = null; host = null; }
export const callOpen = () => !!host;

function useForce() { const [, set] = useState(0); return () => set((x) => x + 1); }

function Call({ opts, onClose }) {
  const guest = opts.guest || null;
  const api = useMemo(() => makeApi(guest), []);
  const who = guest ? "guest" : String((typeof Cloud === "object" && Cloud.sess && (Cloud.sess() || {}).user_id) || "me");
  const myName = guest ? guest.name : String(((typeof Cloud === "object" && Cloud.st && (Cloud.st.members || []).find((m) => m.user_id === who)) || {}).name || (typeof Cloud === "object" && Cloud.st && Cloud.st.email) || "Me");
  const role = guest ? "guest" : String((typeof Cloud === "object" && Cloud.st && Cloud.st.role) || "");
  const [phase, setPhase] = useState("lobby");            // lobby, joining, in, ended
  const [err, setErr] = useState("");
  const [sess, setSess] = useState(guest ? guest.session : null);
  const [mic, setMic] = useState(true), [cam, setCam] = useState(true);
  const [fx, setFx] = useState(() => loadChoice(who));
  const [fxNote, setFxNote] = useState("");
  const [panel, setPanel] = useState("");                  // "", people, chat, effects, more
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
  const [presence, setPresence] = useState([]);
  const [reacts, setReacts] = useState({});               // pid -> {e, at}
  const [caps, setCaps] = useState(false), [capLines, setCapLines] = useState([]);
  const [screenOn, setScreenOn] = useState(false);
  const [cowork, setCowork] = useState(null);             // {follow, people, isHost} while working together
  const [remote, setRemote] = useState(null);             // remote help: {phase, id, peerId, rid, reason}
  const [after, setAfter] = useState(null);               // after the call
  const [needTap, setNeedTap] = useState(false);          // the browser held the others' sound until a tap
  useEffect(() => { const f = () => setNeedTap(true); window.addEventListener("fincom-call-tap", f); return () => window.removeEventListener("fincom-call-tap", f); }, []);
  const force = useForce();
  const R = useRef({ remotes: new Map(), sigHandlers: {}, ch: null, media: null, raw: null, fxp: null, screen: null, recorder: null, mic: null, queue: null, t0: Date.now(), cw: null, recog: null }).current;
  // the room's host records, ends it for everyone, mutes all, starts working together and remote help; the firm's owner
  // may also admit and remove people (the server's rule)
  const amHost = !!(sess && !guest && sess.me.role === "host");
  const isHost = !!(sess && !guest && (amHost || role === "owner"));
  const canStaff = !guest && (role === "owner" || role === "staff");

  // ---------------------------------------------------------------- the camera and microphone (lobby preview too)
  const preview = useRef(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        R.raw = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } });
      } catch (e) {
        try { R.raw = await navigator.mediaDevices.getUserMedia({ audio: true }); setCam(false); setErr("The camera could not be opened; you can still talk."); }
        catch (e2) { R.raw = new MediaStream(); setMic(false); setCam(false); setErr(e2 && e2.name === "NotAllowedError" ? "The browser did not allow the camera and microphone. Allow them in the address bar, then open the call again." : "No camera or microphone was found."); }
      }
      if (!live) return;
      await applyFx(fx);
      force();
    })();
    return () => { live = false; };
  }, []);
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
    const ch = channel({ url: base(), key: publicKey(), topic, presenceKey: sess ? sess.me.id : "x", onStatus: (s) => setStatus(s === "joined" ? "" : s) });
    for (const ev of ["rtc", "sfu", "sfu-ask", "chat", "hand", "react", "rec", "kick", "rekey", "end", "mute-all", "cowork", "cap", "remote", "rdid"]) ch.on(ev, (p) => (R.sigHandlers[ev] || []).forEach((f) => f(p)));
    ch.onPresence((list) => { setPresence(list); if (R.media) list.forEach((p) => p.pid && R.media.meet(p.pid)); });
    R.ch = ch; trackMe();
  }
  function trackMe() { if (R.ch && sess) R.ch.track({ pid: sess.me.id, name: sess.me.name || myName, role: sess.me.role, mic: mic && mayPublish(!!rec, acked || !!R.recording), cam, hand, guest: !!guest, notice: true }); }
  useEffect(() => { trackMe(); }, [hand, sess]);

  // ---------------------------------------------------------------- joining
  async function join() {
    setPhase("joining"); setErr("");
    try {
      let s = sess;
      if (!s) s = opts.start ? await api.call("start", opts.start) : await api.call("join", { room_id: opts.join });
      setSess(s);
      R.t0 = s.room.started_at ? Date.parse(s.room.started_at) : Date.now();
      if (s.recording) setRec({ id: s.recording.id });
      setPhase("in");
    } catch (e) { setErr(e.message); setPhase("lobby"); }
  }
  useEffect(() => {
    if (phase !== "in" || !sess) return;
    openChannel(sess.topic);
    const local = new MediaStream([...(R.raw ? R.raw.getAudioTracks() : []), ...(outVideo() && cam ? [outVideo()] : [])]);
    R.media = createMedia(sess.mode, { signal: sig, me: sess.me.id, ice: sess.ice, api,
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
      sig.on("remote", (m) => onRemote(m)),
      sig.on("rdid", (m) => setRemote((r) => r && r.id ? Object.assign({}, r, { rid: m.id, peerName: m.name }) : r)),
    ];
    // the host: the waiting room and the people list every 3 s
    let poll = null;
    if (!guest) {
      const load = () => api.call("roster", { room_id: sess.room.id }).then((j) => { setRoster(j.people || []); if (j.status === "ended") leave(false, "The call has ended."); }).catch(() => {});
      load(); poll = setInterval(load, 3000);
    }
    if (sess.room.cowork_on && !guest) joinCowork();
    const bye = () => { try { navigator.sendBeacon && 0; } catch (e) { /* */ } };
    window.addEventListener("pagehide", bye);
    return () => { offs.forEach((f) => f()); clearInterval(poll); window.removeEventListener("pagehide", bye); };
  }, [phase, sess && sess.room.id]);

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

  // ---------------------------------------------------------------- captions (this browser's own recogniser)
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

  // ---------------------------------------------------------------- leaving
  async function leave(endAll, why) {
    if (phase === "ended") return;
    stopCowork();
    if (R.recorder) { await toggleRec().catch(() => {}); }
    stopMic();
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
  useEffect(() => { if (host) host.setAttribute("data-call-min", min ? "true" : "false"); }, [min]);

  // ---------------------------------------------------------------- drawing
  if (phase === "lobby" || phase === "joining") return <div className="call-shell" data-call="lobby" data-fx={R.fxp ? (R.fxp.segmenting ? "seg" : "on") : "off"}>
    <div className="call-lobby">
      <h2>{opts.start ? (opts.start.title || "Start the call") : guest ? (guest.session.room.title || "Join the call") : "Join the call"}</h2>
      <div className="call-preview"><video ref={preview} autoPlay playsInline muted data-preview="" />{!cam && <div className="call-camoff">Camera off</div>}</div>
      <div className="call-row">
        <button type="button" className={"call-btn" + (mic ? "" : " off")} aria-pressed={!mic} onClick={() => setMic(!mic)} data-call-mic="">{mic ? "Mic on" : "Mic off"}</button>
        <button type="button" className={"call-btn" + (cam ? "" : " off")} aria-pressed={!cam} onClick={() => setCam(!cam)} data-call-cam="">{cam ? "Camera on" : "Camera off"}</button>
        <button type="button" className="call-btn" onClick={() => setPanel(panel === "effects" ? "" : "effects")} data-call-effects="">Background and look</button>
      </div>
      {panel === "effects" && <Effects fx={fx} change={changeFx} note={fxNote} />}
      {err && <p className="call-err" role="alert">{err}</p>}
      <div className="call-row">
        <button type="button" className="call-primary" disabled={phase === "joining"} onClick={join} data-call-join="">{phase === "joining" ? "Joining…" : "Join now"}</button>
        <button type="button" className="call-btn" onClick={() => { [R.raw].forEach((s) => s && s.getTracks().forEach((t) => t.stop())); if (R.fxp) R.fxp.stop(); onClose(); }}>Cancel</button>
      </div>
    </div>
  </div>;

  if (phase === "ended") return <div className="call-shell" data-call="ended"><AfterCall api={api} after={after} canStaff={canStaff} onClose={onClose} guest={!!guest} /></div>;

  const pres = presence.filter((p) => p.pid && p.pid !== sess.me.id);
  const nameOf = (pid) => ((presence.find((p) => p.pid === pid) || roster.find((p) => p.id === pid) || {}).name) || "Someone";
  const screens = [...R.remotes.entries()].filter(([, s]) => s.screen).map(([pid, s]) => ({ pid, stream: s.screen }));
  if (R.screen) screens.unshift({ pid: sess.me.id, stream: R.screen, mine: true });
  const waiting = roster.filter((p) => p.state === "waiting");
  const held = rec && !acked && !R.recording;
  return <div className={"call-shell" + (min ? " min" : "")} data-call="in" data-fx={R.fxp ? (R.fxp.segmenting ? "seg" : "on") : "off"} data-mode={sess.mode}>
    <header className="call-top">
      <b>{sess.room.title}</b>
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
    {held && <div className="call-modal" role="dialog" aria-modal="true" data-consent="">
      <div><h3>{CONSENT_TEXT}</h3><p>The host is recording this call (picture, voices and the words said, for a transcript). Your microphone and camera stay off until you choose.</p>
        <button type="button" className="call-primary" onClick={accept} data-consent-stay="">Stay in the call</button> <button type="button" className="call-btn" onClick={declineRec} data-consent-leave="">Leave</button></div></div>}
    <div className="call-main">
      {screens.length > 0 && <div className="call-stage">{screens.slice(0, 1).map((s) => <Vid key={s.pid} stream={s.stream} screen name={(s.mine ? "Your" : nameOf(s.pid) + "’s") + " screen"} />)}</div>}
      <div className="call-grid" data-count={pres.length + 1}>
        <Tile me name={myName + " (you)"} stream={selfStream} camOn={cam} micOn={mic && !held} hand={hand} react={reacts[sess.me.id]} />
        {pres.map((p) => { const s = R.remotes.get(p.pid) || {}; return <Tile key={p.pid} name={p.name + (p.guest ? " (guest)" : "")} stream={s.cam} camOn={p.cam !== false && !!s.cam} micOn={p.mic !== false} hand={p.hand} react={reacts[p.pid]} state={s.state} />; })}
      </div>
      {capLines.length > 0 && caps && <div className="call-caps" data-captions="">{capLines.map((l) => <div key={l.pid}><b>{l.name}:</b> {l.text}</div>)}</div>}
      {panel === "people" && <aside className="call-side" data-call-people="">
        <h3>People ({pres.length + 1})</h3>
        {isHost && waiting.length > 0 && <><h4>Waiting to join</h4>{waiting.map((p) => <div key={p.id} className="call-person" data-waiting={p.name}><span>{p.name} <small>{p.email}{p.verified ? " · email checked" : " · email not checked"}</small></span>
          <button type="button" className="call-btn small" onClick={() => api.call("admit", { room_id: sess.room.id, participant_id: p.id }).then(() => setRoster((r) => r.map((x) => x.id === p.id ? Object.assign({}, x, { state: "admitted" }) : x))).catch((e) => say(e.message))} data-admit="">Admit</button>
          <button type="button" className="call-btn small" onClick={() => api.call("deny", { room_id: sess.room.id, participant_id: p.id }).catch((e) => say(e.message))}>Deny</button></div>)}</>}
        <div className="call-person"><span>{myName} (you){isHost ? " · host" : ""}</span></div>
        {pres.map((p) => <div key={p.pid} className="call-person" data-person={p.name}><span>{p.name}{p.guest ? " (guest)" : ""}{p.role === "host" ? " · host" : ""}{p.hand ? " ✋" : ""}{p.mic === false ? " · muted" : ""}</span>
          {isHost && <button type="button" className="call-btn small danger" onClick={async () => { if (!confirm("Remove " + p.name + " from the call?")) return; try { await api.call("remove", { room_id: sess.room.id, participant_id: p.pid }); sig.send("kick", { pid: p.pid }); R.media && R.media.forget(p.pid); sig.send("rekey", {}); const t = await api.call("topic", { room_id: sess.room.id }); openChannel(t.topic); } catch (e) { say(e.message); } }} data-remove="">Remove</button>}
          {amHost && canStaff && !remote && <button type="button" className="call-btn small" onClick={() => { const reason = prompt("Remote help for " + p.name + ": why do you need to control their computer? (kept in the log)"); if (reason) startRemote(reason, p); }} data-remote-start="">Remote help</button>}</div>)}
        {amHost && <button type="button" className="call-btn small" onClick={() => { sig.send("mute-all", { from: sess.me.id }); say("Everyone else is muted."); }} data-mute-all="">Mute all</button>}
        {isHost && !guest && <InviteBox api={api} room={sess.room} />}
      </aside>}
      {panel === "chat" && <aside className="call-side" data-call-chat="">
        <h3>Chat</h3>
        <div className="call-chat" ref={chatBox}>{chat.map((m) => <div key={m.id} className="call-msg"><b>{m.author}</b> <small>{new Date(m.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small>
          <div>{m.file ? <button type="button" className="linkbtn" onClick={() => openFile(m.file)} data-chat-file={m.file.name}>📎 {m.file.name} ({fmtSize(m.file.size)})</button>
            : chatParts(m.body).map((p, i) => p.link ? <a key={i} href={p.link} target="_blank" rel="noopener noreferrer nofollow">{p.link}</a> : <span key={i}>{p.text}</span>)}</div></div>)}</div>
        <form onSubmit={(e) => { e.preventDefault(); const t = e.target.elements.msg; sendChat(t.value); t.value = ""; }} className="call-chatform">
          <input name="msg" aria-label="Message" placeholder="Write a message" maxLength={4000} data-chat-input="" />
          <button type="submit" className="call-btn small">Send</button>
          <button type="button" className="call-btn small" onClick={() => fileIn.current && fileIn.current.click()} data-chat-attach="">File</button>
          <input ref={fileIn} type="file" hidden onChange={(e) => { sendFile(e.target.files[0]); e.target.value = ""; }} data-chat-fileinput="" />
        </form>
      </aside>}
      {panel === "effects" && <aside className="call-side"><Effects fx={fx} change={changeFx} note={fxNote} /></aside>}
    </div>
    <footer className="call-bar" role="toolbar" aria-label="Call controls">
      <button type="button" className={"call-btn" + (mic ? "" : " off")} aria-pressed={!mic} onClick={() => setMic(!mic)} data-call-mic="">{mic ? "Mute" : "Unmute"}</button>
      <button type="button" className={"call-btn" + (cam ? "" : " off")} aria-pressed={!cam} onClick={() => setCam(!cam)} data-call-cam="">{cam ? "Camera off" : "Camera on"}</button>
      {navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && <button type="button" className={"call-btn" + (screenOn ? " on" : "")} aria-pressed={screenOn} onClick={toggleScreen} data-call-share="">{screenOn ? "Stop sharing" : "Share screen"}</button>}
      <button type="button" className={"call-btn" + (hand ? " on" : "")} aria-pressed={hand} onClick={() => { setHand(!hand); }} data-call-hand="">{hand ? "Lower hand" : "Raise hand"}</button>
      <span className="call-reacts">{REACTIONS.map((e) => <button key={e} type="button" className="call-react" aria-label={"React " + e} onClick={() => { sig.send("react", { pid: sess.me.id, e }); setReacts((r) => Object.assign({}, r, { [sess.me.id]: { e, at: Date.now() } })); }} data-call-react={e}>{e}</button>)}</span>
      <button type="button" className={"call-btn" + (panel === "people" ? " on" : "")} onClick={() => setPanel(panel === "people" ? "" : "people")} data-call-people-btn="">People{isHost && waiting.length ? " (" + waiting.length + " waiting)" : ""}</button>
      <button type="button" className={"call-btn" + (panel === "chat" ? " on" : "")} onClick={() => { setPanel(panel === "chat" ? "" : "chat"); setUnread(0); }} data-call-chat-btn="">Chat{unread && panel !== "chat" ? " (" + unread + ")" : ""}</button>
      <button type="button" className={"call-btn" + (panel === "effects" ? " on" : "")} onClick={() => setPanel(panel === "effects" ? "" : "effects")} data-call-effects="">Background</button>
      <button type="button" className={"call-btn" + (caps ? " on" : "")} aria-pressed={caps} onClick={toggleCaps} data-call-caps="">Captions</button>
      <button type="button" className={"call-btn" + (audioOnly ? " on" : "")} aria-pressed={audioOnly} onClick={() => { const a = !audioOnly; setAudioOnly(a); R.media && R.media.setAudioOnly(a); }} data-call-audioonly="">Audio only</button>
      {amHost && <button type="button" className={"call-btn" + (rec ? " on rec" : "")} onClick={toggleRec} data-call-record="">{rec ? "Stop recording" : "Record"}</button>}
      {amHost && sess.room.kind !== "class" && <button type="button" className={"call-btn" + (cowork ? " on" : "")} onClick={toggleCowork} data-call-cowork="">{cowork ? "Stop working together" : "Work together"}</button>}
      {cowork && !amHost && <button type="button" className="call-btn" onClick={() => R.cw && R.cw.setFollow(!cowork.follow)} data-call-follow="">{cowork.follow ? "Stop following" : "Follow the host"}</button>}
      {amHost && <button type="button" className="call-btn danger" onClick={() => leave(true)} data-call-end="">End for everyone</button>}
      <button type="button" className="call-btn danger" onClick={() => leave(false)} data-call-leave="">Leave</button>
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
function Tile({ name, stream, camOn, micOn, hand, react, me, state }) {
  return <div className="call-tile" data-tile={name}>
    {stream ? <Vid stream={stream} muted={me} name={name} me={me} /> : null}
    {!camOn && <div className="call-camoff">{String(name || "?").slice(0, 1).toUpperCase()}</div>}
    <span className="call-name">{hand ? "✋ " : ""}{name}{micOn ? "" : " · muted"}{state === "disconnected" ? " · reconnecting" : ""}</span>
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

function InviteBox({ api, room }) {
  const [link, setLink] = useState(null), [email, setEmail] = useState("");
  const make = async () => { try { setLink(await api.call("invite", { room_id: room.id, email, base: location.href })); } catch (e) { alert(e.message); } };
  return <div className="call-invite" data-invite="">
    <h4>Invite someone without a FinCom sign-in</h4>
    <input type="email" placeholder="Their email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Guest's email" />
    <button type="button" className="call-btn small" onClick={make} data-invite-make="">Make a guest link</button>
    {link && <div><input readOnly value={link.url} aria-label="Guest link" data-invite-link="" onFocus={(e) => e.target.select()} />
      <button type="button" className="call-btn small" onClick={() => { try { navigator.clipboard.writeText(link.url); } catch (e) { /* */ } }}>Copy link</button>
      <a className="call-btn small" href={"https://wa.me/?text=" + encodeURIComponent(link.text)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <a className="call-btn small" href={"mailto:" + encodeURIComponent(email) + "?subject=" + encodeURIComponent("Join the call: " + room.title) + "&body=" + encodeURIComponent(link.text)}>Email</a>
      {link.emailed && <small> · emailed</small>}</div>}
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
function AfterCall({ api, after, canStaff, onClose, guest }) {
  const [t, setT] = useState(null), [busy, setBusy] = useState(""), [sum, setSum] = useState(null), [pick, setPick] = useState({}), [msg, setMsg] = useState("");
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
  async function summarise() { setBusy("summary"); setMsg(""); try { const j = await api.call("summarise", { room_id: room.id }); setSum(j.summary); setPick(Object.fromEntries(j.summary.actions.map((a, i) => [i, true]))); } catch (e) { setMsg(e.message); } setBusy(""); }
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
        <button type="button" className="call-btn" disabled={!!busy || !(t && t.lines && t.lines.length)} onClick={summarise} data-make-summary="">{busy === "summary" ? "Summarising…" : "Summary and action items"}</button>
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
