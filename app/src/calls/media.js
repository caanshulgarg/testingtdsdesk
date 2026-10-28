// The media layer of a call, behind one small interface, so another SFU (a self-hosted LiveKit, later) can take its place
// without the call screen changing:
//   const m = createMedia(mode, {signal, me, ice, api, room, onRemote, onLevel});   room: the call's id (fincom-call's room_id)
//   await m.start(localStream)        the camera and microphone (already through the effects, if any)
//   m.setVideoTrack(track|null)       a new picture (effects on or off, camera off) without a new connection
//   m.setScreen(stream|null)          the shared screen
//   m.setAudioOnly(on)                a weak line: the picture stops, the voice goes on
//   m.stop()
//   onRemote(peerId, {cam, screen})   a person's streams as they come and go (peerId: their participant id)
//   onLevel(level)                    what this line can carry now: high / mid / low / audio (rules.sendLevel)
//   onNet({blocked, turn})            (sfu) the line to Cloudflare not up after 15 s (blocked), or up again
// Two implementations: "p2p" (a mesh: each person sends to each other one; Cloudflare's free STUN, 4 people at most) and
// "sfu" (Cloudflare Realtime: one connection to Cloudflare, simulcast, the layer pulled to fit each tile and the line).
// The signal channel is the call's Supabase Realtime channel (realtime.js); every message names who it is for.
import { LEVELS, sendLevel, layerFor } from "./rules.js";

export function createMedia(mode, o) { return mode === "sfu" ? sfuMedia(o) : p2pMedia(o); }

// ---------------------------------------------------------------- peer to peer (mesh)
function p2pMedia({ signal, me, ice, onRemote, onLevel }) {
  const peers = new Map(), waiting = new Map();
  let local = null, screen = null, videoTrack = null, audioOnly = false, level = "high", statsTimer = null;
  const say = (to, data) => signal.send("rtc", Object.assign({ from: me, to }, data));
  function streamsOf(p) { return { cam: p.cam, screen: p.screen }; }
  function peer(id) {
    let p = peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: "max-bundle" });
    p = { id, pc, polite: me > id, makingOffer: false, ignoreOffer: false, inbox: Promise.resolve(), cam: null, screen: null, kinds: {}, senders: {}, lost: 0, downAt: 0, restarts: 0, watch: null };
    peers.set(id, p);
    pc.onicecandidate = (e) => { if (e.candidate) say(id, { ice: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.onnegotiationneeded = async () => {
      try { p.makingOffer = true; await pc.setLocalDescription(); say(id, { desc: pc.localDescription && pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription, kinds: myKinds() }); }
      catch (e) { console.warn("FinCom call: offer", e); } finally { p.makingOffer = false; watch(p); }
    };
    pc.ontrack = (e) => {
      const s = e.streams[0] || new MediaStream([e.track]);
      const kind = p.kinds[s.id] || "cam";
      if (kind === "screen") p.screen = s; else p.cam = s;
      s.onremovetrack = () => { if (!s.getTracks().length) { if (p.screen === s) p.screen = null; if (p.cam === s) p.cam = null; onRemote(id, streamsOf(p)); } };
      onRemote(id, streamsOf(p));
    };
    // a line that drops: ICE restarted; gone for good after 20 s
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      if (st === "failed") { try { pc.restartIce(); } catch (e) { /* older browser: renegotiated below */ } }
      if (st === "disconnected") { p.downAt = Date.now(); setTimeout(() => { if (pc.iceConnectionState === "disconnected" && Date.now() - p.downAt >= 7000) { try { pc.restartIce(); } catch (e) { /* */ } } }, 7500); }
      if (st === "connected" || st === "completed") p.downAt = 0;
      onRemote(id, Object.assign(streamsOf(p), { state: st }));
    };
    attach(p);
    return p;
  }
  // which of my streams is the camera and which the screen
  function myKinds() { const k = {}; if (local) k[local.id] = "cam"; if (screen) k[screen.id] = "screen"; return k; }
  function attach(p) {
    if (local) {
      for (const t of local.getAudioTracks()) if (!p.senders.audio) p.senders.audio = p.pc.addTrack(t, local);
      // no microphone here (Remote Desktop, refused): a silent voice is sent, so the call is set up as any other and the
      // others' voices are received
      if (!local.getAudioTracks().length && !p.senders.audio) { const t = dummyAudio(); if (t) p.senders.audio = p.pc.addTrack(t, local); }
      if (!p.senders.video) p.senders.video = p.pc.addTrack(videoTrack || local.getVideoTracks()[0] || dummyVideo(), local);
    }
    if (screen && !p.senders.screen) p.senders.screen = p.pc.addTrack(screen.getVideoTracks()[0], screen);
    if (!screen && p.senders.screen) { try { p.pc.removeTrack(p.senders.screen); } catch (e) { /* */ } p.senders.screen = null; }
    applyLevel(p);
  }
  // each person's messages one after another, in the order sent: an offer that comes while their answer is still being
  // applied is then seen in a settled state (not taken for a collision and dropped)
  function onSignal(m) {
    if (!m || m.to !== me || !m.from || m.from === me) return;
    if (waiting.has(m.from)) { clearTimeout(waiting.get(m.from)); waiting.delete(m.from); }
    const p = peer(m.from);
    p.inbox = p.inbox.then(() => handle(p, m));
  }
  async function handle(p, m) {
    if (peers.get(p.id) !== p) return;
    if (m.kinds) Object.assign(p.kinds, m.kinds);
    try {
      if (m.desc) {
        const collision = m.desc.type === "offer" && (p.makingOffer || p.pc.signalingState !== "stable");
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await p.pc.setRemoteDescription(m.desc);
        if (m.desc.type === "offer") { await p.pc.setLocalDescription(); say(m.from, { desc: p.pc.localDescription.toJSON ? p.pc.localDescription.toJSON() : p.pc.localDescription, kinds: myKinds() }); }
        watch(p);
      } else if (m.ice) {
        try { await p.pc.addIceCandidate(m.ice); } catch (e) { if (!p.ignoreOffer) console.warn("FinCom call: ice", e); }
      } else if (m.bye) drop(p.id);
    } catch (e) { console.warn("FinCom call: signal", e); }
  }
  // a line set up but whose ICE never gets going (its candidates lost on the way, or the browser's): the side that is not
  // polite restarts ICE after 10 s (new candidates, a new offer), a few times at most; "failed" and "disconnected" are
  // handled below as before
  function watch(p) {
    if (p.watch || p.polite) return;
    p.watch = setTimeout(() => {
      p.watch = null;
      const pc = p.pc, st = pc.iceConnectionState;
      if (peers.get(p.id) !== p || pc.signalingState === "closed" || st === "connected" || st === "completed") return;
      if (pc.signalingState !== "stable" || !pc.remoteDescription) { watch(p); return; }
      if ((st === "new" || st === "checking") && p.restarts < 3) { p.restarts++; try { pc.restartIce(); } catch (e) { /* older browser */ } }
      watch(p);
    }, 10000);
  }
  function drop(id) { const p = peers.get(id); if (!p) return; clearTimeout(p.watch); try { p.pc.close(); } catch (e) { /* */ } peers.delete(id); onRemote(id, null); }
  // a weak line: the picture made smaller, then stopped (the voice goes on)
  function applyLevel(p) {
    const s = p.senders.video; if (!s || !s.getParameters) return;
    const prm = s.getParameters(); if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
    const L = LEVELS[audioOnly ? "audio" : level];
    prm.encodings[0].scaleResolutionDownBy = L.scale; prm.encodings[0].maxBitrate = L.bitrate || 100000; prm.encodings[0].active = !(audioOnly || level === "audio");
    s.setParameters(prm).catch(() => {});
  }
  async function measure() {
    let worst = "high";
    const order = ["high", "mid", "low", "audio"];
    for (const p of peers.values()) {
      try {
        const st = await p.pc.getStats(); let bps = 0, lost = 0, sent = 0;
        st.forEach((r) => {
          if (r.type === "candidate-pair" && r.nominated && r.availableOutgoingBitrate) bps = r.availableOutgoingBitrate;
          if (r.type === "remote-inbound-rtp" && r.kind === "video") { lost = r.fractionLost || 0; }
          if (r.type === "outbound-rtp" && r.kind === "video") sent = r.packetsSent || 0;
        });
        const l = sent ? sendLevel(bps, lost) : "high";
        if (order.indexOf(l) > order.indexOf(worst)) worst = l;
      } catch (e) { /* closed */ }
    }
    if (worst !== level) { level = worst; peers.forEach(applyLevel); onLevel && onLevel(level); }
  }
  let offSignal = null;
  return {
    mode: "p2p",
    async start(stream) {
      local = stream; videoTrack = stream.getVideoTracks()[0] || null;
      offSignal = signal.on("rtc", onSignal);
      statsTimer = setInterval(measure, 4000);
    },
    // a person seen in presence: only the one with the smaller id (the side that is not polite) offers; the other waits
    // for that offer and makes its own only if none has come in 4 s (the other did not see it). Both offering at once
    // (glare) is handled by the polite side rolling its offer back, but Chromium then loses that side's ICE now and then:
    // no candidates gathered, the line "new" for ever, no picture either way (run_call_glare.py; CI's
    // run_video_calls_ui.py "the host receives the owner's picture")
    meet(id) {
      if (!id || id === me || peers.has(id) || waiting.has(id)) return;
      if (id > me) { peer(id); return; }
      waiting.set(id, setTimeout(() => { waiting.delete(id); if (!peers.has(id)) peer(id); }, 4000));
    },
    forget(id) { clearTimeout(waiting.get(id)); waiting.delete(id); drop(id); },
    setVideoTrack(t) { videoTrack = t; peers.forEach((p) => { if (p.senders.video) p.senders.video.replaceTrack(t || null).catch(() => {}); }); },
    setScreen(s) { screen = s; peers.forEach((p) => { attach(p); }); },
    setAudioOnly(on) { audioOnly = !!on; peers.forEach(applyLevel); },
    get level() { return level; },
    peers: () => [...peers.keys()],
    stop() { clearInterval(statsTimer); if (offSignal) offSignal(); waiting.forEach((t) => clearTimeout(t)); waiting.clear(); peers.forEach((p, id) => { clearTimeout(p.watch); say(id, { bye: true }); try { p.pc.close(); } catch (e) { /* */ } }); peers.clear(); },
  };
}
// a sender needs a track to start with (the camera off from the start): a tiny black picture
let silent = null;
function dummyAudio() {
  try {
    if (!silent) { const AC = window.AudioContext || window.webkitAudioContext, ac = new AC(), d = ac.createMediaStreamDestination(); silent = d.stream.getAudioTracks()[0]; }
    return silent;
  } catch (e) { return null; }
}
function dummyVideo() {
  const c = document.createElement("canvas"); c.width = 16; c.height = 9;
  const t = c.captureStream ? c.captureStream(1).getVideoTracks()[0] : null;
  return t;
}

// ---------------------------------------------------------------- Cloudflare Realtime (SFU)
// 28-Oct-2026 (the owner, two laptops, 26 and 27-Oct: each saw the other's name, no picture and no voice; every
// fincom-call step answered 200): Cloudflare answers a pull with a result per track, and a track whose publisher is not
// sending yet (just pushed, ICE still connecting) comes back with errorCode not_found_track_error or empty_track_error
// and no mid ("retry after the source is available", Cloudflare's error-code reference). That was dropped: the track
// never got a mid and was never asked for again. Now: a failed track or a failed pull is tried again (0.5, 1, 2, 4, 8 s…,
// about 30 s), "sfu-ask" every 10 s while anyone's track is still missing, the tracks announced again once this side's
// line is up, a dead line (ICE failed, restartIce not enough: nothing renegotiates it with the SFU) rebuilt with a new
// session, and what happened sent to fincom-call ("diag": ICE state, candidate types, bytes received) for the next look.
const RETRY = [500, 1000, 2000, 4000, 8000, 8000, 8000];
const ASK_MS = 10000, BLOCKED_MS = 15000, DIAG_MS = 12000, REBUILDS = 3;
function sfuMedia({ signal, me, ice, api, room, onRemote, onLevel, onNet }) {
  let pc = null, sessionId = "", local = null, screen = null, videoTrack = null, level = "high", audioOnly = false, statsTimer = null, chain = Promise.resolve();
  let stopped = false, everUp = false, rebuilds = 0, askTimer = null, blockTimer = null, diagTimer = null, failTimer = null, t0 = Date.now(), netBlocked = false;
  let mine = {};                   // trackName -> sender
  const pulled = new Map();        // mid -> {peer, kind}
  const people = new Map();        // peer -> {sessionId, tracks: [{trackName, kind, mid}], cam, screen, tries, timer}
  const errors = [];               // the last pull errors, for "diag"
  const hasTurn = (ice || []).some((s) => [].concat((s && s.urls) || []).some((u) => /^turns?:/.test(String(u))));
  const serial = (f) => (chain = chain.then(f, f));
  const note = (code) => { errors.push(String(code || "error").slice(0, 40) + "@" + Math.round((Date.now() - t0) / 1000)); if (errors.length > 10) errors.shift(); };
  const short = me.slice(0, 8);
  // 25-Oct-2026 (no picture and no voice in any call since Cloudflare's keys were set): fincom-call finds a member's call
  // by room_id (a guest's by its pass); without it every step was refused, 400 "Say which call." (tests/run_call_sfu.py)
  const cf = (op, body) => api.call("cf", Object.assign({ op }, room ? { room_id: room } : {}, body || {}));
  const net = (blocked) => { if (blocked === netBlocked) return; netBlocked = blocked; try { onNet && onNet({ blocked, turn: hasTurn }); } catch (e) { /* */ } };
  async function push(tracks) {
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const res = await cf("push", { sdp: { type: "offer", sdp: offer.sdp }, tracks: tracks.map((t) => ({ mid: t.tr.mid, trackName: t.name })) });
    await pc.setRemoteDescription(res.sessionDescription);
  }
  function announce() {
    const tracks = Object.keys(mine).map((n) => ({ trackName: n, kind: n.startsWith("screen") ? "screen" : n.startsWith("cam") ? "cam" : "audio" }));
    signal.send("sfu", { from: me, sessionId, tracks });
  }
  const missing = (p) => p.tracks.some((t) => !t.mid);
  function retry(peerId) {
    const p = people.get(peerId);
    if (stopped || !p || p.timer || !missing(p)) return;
    const d = RETRY[p.tries]; if (d == null) return;      // after ~30 s the 10 s ask carries on
    p.tries++;
    p.timer = setTimeout(() => { p.timer = null; serial(() => pull(peerId)); }, d);
  }
  async function pull(peerId) {
    const p = people.get(peerId); if (stopped || !pc || !p || !p.sessionId) return;
    const want = p.tracks.filter((t) => !t.mid);
    if (!want.length) { p.tries = 0; return; }
    let res;
    try { res = await cf("pull", { tracks: want.map((t) => ({ sessionId: p.sessionId, trackName: t.trackName, rid: t.kind === "audio" ? "" : layerFor(t.kind === "screen" ? 1280 : 480, level === "low" || level === "audio") })) }); }
    catch (e) { note("pull:" + ((e && (e.status || e.kind)) || "failed")); console.warn("FinCom call: pull", e); retry(peerId); return; }
    // each track's own result, by its name (an index is used only when Cloudflare names none)
    const got = (res && res.tracks) || [], named = got.some((x) => x && x.trackName);
    const now = [];
    want.forEach((t, i) => {
      const r = named ? got.find((x) => x && x.trackName === t.trackName && (!x.sessionId || x.sessionId === p.sessionId)) : got[i];
      if (r && r.mid != null && !r.errorCode) { t.mid = String(r.mid); pulled.set(t.mid, { peer: peerId, kind: t.kind }); now.push(t); }
      else note((r && r.errorCode) || "no_result");
    });
    if (res && res.requiresImmediateRenegotiation && res.sessionDescription) {
      try {
        await pc.setRemoteDescription(res.sessionDescription);
        const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
        await cf("renegotiate", { sdp: { type: "answer", sdp: ans.sdp } });
      } catch (e) {
        note("renegotiate:" + ((e && (e.status || e.kind)) || "failed")); console.warn("FinCom call: renegotiate", e);
        now.forEach((t) => { pulled.delete(t.mid); delete t.mid; });
        if (pc.signalingState === "have-remote-offer") { try { await pc.setLocalDescription({ type: "rollback" }); } catch (e2) { /* */ } }
      }
    }
    if (missing(p)) retry(peerId); else p.tries = 0;
  }
  function onSfu(m) {
    if (!m || m.from === me || !m.sessionId) return;
    const old = people.get(m.from);
    const keep = old && old.sessionId === m.sessionId ? old.tracks : [];
    if (old) clearTimeout(old.timer);
    people.set(m.from, { sessionId: m.sessionId, tracks: (m.tracks || []).map((t) => keep.find((k) => k.trackName === t.trackName) || { trackName: t.trackName, kind: t.kind }), cam: old && old.cam, screen: old && old.screen, tries: 0, timer: null });
    serial(() => pull(m.from));
  }
  // while someone's track is still missing: ask everyone to say their tracks again, and try the pull again
  function ask() {
    if (stopped) return;
    let any = false;
    people.forEach((p, id) => { if (missing(p)) { any = true; if (!p.timer) { p.tries = 0; serial(() => pull(id)); } } });
    if (any || !people.size) signal.send("sfu-ask", { from: me });
  }
  async function setLayer() {
    const tracks = [];
    pulled.forEach((v, mid) => { if (v.kind !== "audio") tracks.push({ mid, rid: layerFor(v.kind === "screen" ? 1280 : 480, level === "low" || level === "audio") }); });
    if (tracks.length) await cf("layer", { tracks }).catch(() => {});
  }
  // what this line did, kept by fincom-call for the next look at a call that did not work: no media, no names
  async function stats() {
    const d = { ice: pc ? pc.iceConnectionState : "none", conn: pc ? pc.connectionState : "none", turn: hasTurn, local: "", remote: "", proto: "", rx: { audio: 0, video: 0 }, tx: { audio: 0, video: 0 },
      peers: people.size, want: 0, got: 0, rebuilds, secs: Math.round((Date.now() - t0) / 1000), errors: errors.slice() };
    people.forEach((p) => p.tracks.forEach((t) => { d.want++; if (t.mid) d.got++; }));
    if (!pc) return d;
    try {
      const st = await pc.getStats(), byId = {};
      let pair = null;
      st.forEach((r) => { byId[r.id] = r; });
      st.forEach((r) => {
        if (r.type === "transport" && r.selectedCandidatePairId && byId[r.selectedCandidatePairId]) pair = byId[r.selectedCandidatePairId];
        if (r.type === "inbound-rtp" && (r.kind === "audio" || r.kind === "video")) d.rx[r.kind] += r.bytesReceived || 0;
        if (r.type === "outbound-rtp" && (r.kind === "audio" || r.kind === "video")) d.tx[r.kind] += r.bytesSent || 0;
      });
      if (!pair) st.forEach((r) => { if (!pair && r.type === "candidate-pair" && r.nominated && r.state === "succeeded") pair = r; });
      if (pair) { const l = byId[pair.localCandidateId] || {}, rc = byId[pair.remoteCandidateId] || {}; d.local = l.candidateType || ""; d.remote = rc.candidateType || ""; d.proto = l.relayProtocol || l.protocol || ""; }
    } catch (e) { /* closed */ }
    return d;
  }
  async function diag(why) { if (stopped && why !== "left") return; try { const d = await stats(); d.why = why; await cf("diag", { diag: d }); } catch (e) { /* the call goes on */ } }
  function forgetMedia() {
    pulled.clear();
    people.forEach((p, id) => { p.tracks.forEach((t) => { delete t.mid; }); clearTimeout(p.timer); p.timer = null; p.tries = 0; p.cam = null; p.screen = null; onRemote(id, { cam: null, screen: null }); });
  }
  // one connection to Cloudflare: a session, my microphone, camera (and screen) pushed
  async function connect() {
    pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: "max-bundle" });
    const mypc = pc;
    pc.ontrack = (e) => {
      if (pc !== mypc) return;
      const v = pulled.get(String(e.transceiver.mid)); if (!v) return;
      const p = people.get(v.peer); if (!p) return;
      // a new stream each time (the tile and the voice see the change and play it)
      if (v.kind === "screen") p.screen = new MediaStream([e.track]);
      else p.cam = new MediaStream([...(p.cam ? p.cam.getTracks().filter((t) => t.kind !== e.track.kind && t.readyState !== "ended") : []), e.track]);
      onRemote(v.peer, { cam: p.cam, screen: p.screen });
    };
    pc.oniceconnectionstatechange = () => {
      if (pc !== mypc || stopped) return;
      const st = pc.iceConnectionState;
      if (st === "connected" || st === "completed") {
        clearTimeout(failTimer); failTimer = null; net(false);
        // my tracks are only there to be pulled once my line is up: said again then
        if (!everUp) { everUp = true; announce(); }
      }
      if (st === "failed" || st === "disconnected") {
        if (st === "failed") { try { pc.restartIce(); } catch (e) { /* */ } }
        if (!failTimer) failTimer = setTimeout(() => {
          failTimer = null;
          const now = pc && pc.iceConnectionState;
          if (pc === mypc && (now === "failed" || now === "disconnected")) rebuild();
        }, st === "failed" ? 4000 : 8000);
      }
    };
    sessionId = (await cf("session")).sessionId;
    mine = {};
    const tracks = [];
    const a = local && local.getAudioTracks()[0];
    if (a) { const tr = pc.addTransceiver(a, { direction: "sendonly" }); mine["audio-" + short] = tr.sender; tracks.push({ tr, name: "audio-" + short }); }
    const v = videoTrack || dummyVideo();
    if (v) {
      const tr = pc.addTransceiver(v, { direction: "sendonly", sendEncodings: [{ rid: "q", scaleResolutionDownBy: 4, maxBitrate: 150000 }, { rid: "h", scaleResolutionDownBy: 2, maxBitrate: 500000 }, { rid: "f", maxBitrate: 1200000 }] });
      mine["cam-" + short] = tr.sender; tracks.push({ tr, name: "cam-" + short });
    }
    if (screen && screen.getVideoTracks()[0]) { const tr = pc.addTransceiver(screen.getVideoTracks()[0], { direction: "sendonly" }); mine["screen-" + short] = tr.sender; tracks.push({ tr, name: "screen-" + short }); }
    await push(tracks);
    if (audioOnly) applyAudioOnly();
  }
  // the line died and restartIce did not bring it back (nothing renegotiates ICE with the SFU): a new session, my tracks
  // pushed again, everyone's pulled again
  function rebuild() {
    if (stopped || rebuilds >= REBUILDS) { net(true); return; }
    rebuilds++;
    diag("failed");
    serial(async () => {
      if (stopped) return;
      const old = pc; pc = null;
      try { old && old.close(); } catch (e) { /* */ }
      forgetMedia(); everUp = false;
      try { await connect(); } catch (e) { note("rebuild:" + ((e && (e.status || e.kind)) || "failed")); console.warn("FinCom call: reconnect", e); net(true); return; }
      announce(); signal.send("sfu-ask", { from: me });
      for (const id of people.keys()) await pull(id);
    });
  }
  function applyAudioOnly() { const s = mine["cam-" + short]; if (s) { const p = s.getParameters(); (p.encodings || []).forEach((e) => { e.active = !audioOnly; }); s.setParameters(p).catch(() => {}); } }
  let offA = null, offB = null;
  return {
    mode: "sfu",
    async start(stream) {
      local = stream; videoTrack = stream.getVideoTracks()[0] || null; t0 = Date.now();
      offA = signal.on("sfu", onSfu);
      offB = signal.on("sfu-ask", (m) => { if (m.from !== me && sessionId) announce(); });
      // the line not up in 15 s: said plainly (a network that lets no call through without a relay)
      blockTimer = setTimeout(() => { if (!everUp && !stopped) net(true); }, BLOCKED_MS);
      diagTimer = setTimeout(() => diag("10s"), DIAG_MS);
      askTimer = setInterval(ask, ASK_MS);
      try { await serial(connect); }
      catch (e) { stopped = true; clearInterval(askTimer); clearTimeout(blockTimer); clearTimeout(diagTimer); throw e; }
      announce(); signal.send("sfu-ask", { from: me });
      statsTimer = setInterval(async () => {
        try {
          if (!pc) return;
          const st = await pc.getStats(); let bps = 0, lost = 0;
          st.forEach((r) => { if (r.type === "candidate-pair" && r.nominated && r.availableOutgoingBitrate) bps = r.availableOutgoingBitrate; if (r.type === "remote-inbound-rtp" && r.kind === "video") lost = r.fractionLost || 0; });
          const l = sendLevel(bps, lost);
          if (l !== level) { level = l; onLevel && onLevel(level); setLayer(); }
        } catch (e) { /* */ }
      }, 4000);
    },
    meet() { signal.send("sfu-ask", { from: me }); },
    forget(id) { const p = people.get(id); if (p) clearTimeout(p.timer); people.delete(id); onRemote(id, null); },
    setVideoTrack(t) { videoTrack = t || null; const s = mine["cam-" + short]; if (s) s.replaceTrack(t || null).catch(() => {}); },
    setScreen(s) {
      serial(async () => {
        const name = "screen-" + short;
        if (s && !mine[name]) { const tr = pc.addTransceiver(s.getVideoTracks()[0], { direction: "sendonly" }); mine[name] = tr.sender; await push([{ tr, name }]); }
        else if (!s && mine[name]) {
          const tr = pc.getTransceivers().find((x) => x.sender === mine[name]);
          if (tr) { const mid = tr.mid; tr.stop(); const off = await pc.createOffer(); await pc.setLocalDescription(off); const res = await cf("close", { mids: [mid], sdp: { type: "offer", sdp: off.sdp } }); if (res.sessionDescription) await pc.setRemoteDescription(res.sessionDescription); }
          delete mine[name];
        }
        screen = s; announce();
      }).catch((e) => console.warn("FinCom call: screen", e));
    },
    setAudioOnly(on) { audioOnly = !!on; applyAudioOnly(); },
    get level() { return level; },
    peers: () => [...people.keys()],
    stats,
    stop() {
      stopped = true;
      clearInterval(statsTimer); clearInterval(askTimer); clearTimeout(blockTimer); clearTimeout(diagTimer); clearTimeout(failTimer);
      people.forEach((p) => clearTimeout(p.timer));
      offA && offA(); offB && offB(); try { pc && pc.close(); } catch (e) { /* */ }
    },
  };
}
