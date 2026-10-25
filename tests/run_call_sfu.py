"""python3 run_call_sfu.py - the Cloudflare Realtime (SFU) media of calls (app/src/calls/media.js, mode "sfu"), in
Chromium with a fake camera and microphone, the module loaded as it is (no build), against:
  - a stand-in for fincom-call's "cf" step that keeps server/video-calls/handler.ts's rules: a member names the call
    (room_id; without it the answer is 400 "Say which call."), a guest's pass (gt) names it; a session first; a pull only
    of tracks of others in the same call;
  - a stand-in for Cloudflare's SFU made of real RTCPeerConnections in the page (one per session): tracks pushed to it
    are kept by name and sent on to whoever pulls them.
25-Oct-2026 (the owner: "in meeting, video and audio call is not working"; a Mac and an iPhone, both in the meeting,
no picture and no voice on either side): since Cloudflare's keys were set on staging (23-Oct) every call is "sfu", and a
member's "cf" request did not say which call, so fincom-call answered 400 "Say which call." (its log: the host's
30-byte {"action":"cf","op":"session"} at 17:03:13); the member never had a session, sent nothing and pulled nothing,
and the guest had nobody to pull. The tests' stand (calls_stand.py) only ever gave "p2p", so nothing caught it.
  1. a member (the host) and a guest: both open a session, push their camera and microphone, and each gets the other's
     picture (frames drawn) and voice
  2. every "cf" request of the member named the call; none was refused
  3. a third person (a member) joining later gets both, and both get theirs
Run: python3 tests/run_call_sfu.py"""
import os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
CALLS = os.path.join(HERE, "..", "app", "src", "calls")
ORIGIN = "http://localhost:9"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

def serve(route, request):
    name = request.url[len(ORIGIN) + 1:].split("?")[0]
    if name == "": return route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>sfu</title><body></body>")
    path = os.path.join(CALLS, os.path.basename(name))
    if not os.path.isfile(path): return route.fulfill(status=404, body="")
    route.fulfill(status=200, content_type="text/javascript", body=open(path, encoding="utf-8").read())

SETUP = """async () => {
  const { createMedia } = await import('/media.js');
  window.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 640, height: 360 } });
  const ROOM = '11111111-2222-4333-8444-555555555555';
  window.ROOM = ROOM;
  // the signal channel: every message to everyone else on the bus, in its own task
  const bus = [];
  const signalFor = (me) => {
    const handlers = {};
    bus.push({ me, handlers });
    return { send: (ev, p) => { for (const s of bus) if (s.me !== me) setTimeout(() => (s.handlers[ev] || []).forEach((f) => f(JSON.parse(JSON.stringify(p)))), 0); },
             on: (ev, f) => { (handlers[ev] = handlers[ev] || []).push(f); return () => { handlers[ev] = handlers[ev].filter((x) => x !== f); }; } };
  };
  // the SFU: one RTCPeerConnection per session; what is pushed is kept by its track name
  const sfu = {};
  let nsid = 0;
  const gathered = (pc) => new Promise((ok) => { if (pc.iceGatheringState === 'complete') return ok(); const t = setTimeout(ok, 3000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); ok(); } }); });
  // simulcast is Cloudflare's business: this stand-in takes one layer
  const plain = (sdp) => sdp.split('\\r\\n').filter((l) => !/^a=(simulcast|rid):/.test(l)).join('\\r\\n');
  const CF = {
    async session() { const id = 'cf-' + (++nsid); const pc = new RTCPeerConnection({ iceServers: [] }); const s = sfu[id] = { pc, pushed: {}, byMid: {} };
      pc.ontrack = (e) => { const n = s.byMid[e.transceiver.mid]; if (n) s.pushed[n] = e.track; }; return { sessionId: id }; },
    async push(id, b) { const s = sfu[id]; (b.tracks || []).forEach((t) => { s.byMid[String(t.mid)] = t.trackName; });
      await s.pc.setRemoteDescription({ type: 'offer', sdp: plain(b.sdp.sdp) });
      const ans = await s.pc.createAnswer(); await s.pc.setLocalDescription(ans); await gathered(s.pc);
      return { sessionDescription: { type: 'answer', sdp: s.pc.localDescription.sdp }, tracks: b.tracks.map((t) => ({ mid: t.mid, trackName: t.trackName })) }; },
    async pull(id, b) { const s = sfu[id]; const out = [];
      for (const t of b.tracks) { const src = sfu[t.sessionId] && sfu[t.sessionId].pushed[t.trackName];
        if (!src) { out.push({ errorCode: 'not_found', trackName: t.trackName }); continue; }
        const tr = s.pc.addTransceiver(src, { direction: 'sendonly' }); out.push({ tr, trackName: t.trackName, sessionId: t.sessionId }); }
      const off = await s.pc.createOffer(); await s.pc.setLocalDescription(off); await gathered(s.pc);
      return { requiresImmediateRenegotiation: true, sessionDescription: { type: 'offer', sdp: s.pc.localDescription.sdp },
               tracks: out.map((x) => x.tr ? { mid: x.tr.mid, trackName: x.trackName, sessionId: x.sessionId } : x) }; },
    async renegotiate(id, b) { await sfu[id].pc.setRemoteDescription({ type: b.sdp.type, sdp: b.sdp.sdp }); return {}; },
  };
  // fincom-call's "cf" step, by handler.ts's rules
  window.cfLog = [];
  const people = {};   // participant id -> {cf_session}
  const server = async (who, gt, b) => {
    const roomId = gt ? ROOM : b.room_id;
    cfLog.push({ who, op: b.op, room_id: b.room_id || null, gt: !!gt, status: 0 });
    const row = cfLog[cfLog.length - 1];
    const no = (code, msg) => { row.status = code; throw Object.assign(new Error(msg), { status: code }); };
    if (!roomId) no(400, 'Say which call.');
    if (roomId !== ROOM) no(404, 'No such call.');
    const p = people[who];
    if (b.op === 'session') { const j = await CF.session(); p.cf_session = j.sessionId; row.status = 200; return { ok: true, sessionId: j.sessionId }; }
    if (!p.cf_session) no(409, 'Open the call session first.');
    if (b.op === 'push') { row.status = 200; return { ok: true, ...(await CF.push(p.cf_session, b)) }; }
    if (b.op === 'pull') {
      const okSess = new Set(Object.values(people).map((x) => x.cf_session).filter(Boolean));
      const tracks = (b.tracks || []).filter((t) => okSess.has(String(t.sessionId)) && String(t.sessionId) !== p.cf_session);
      if (!tracks.length) no(400, 'No track of this call to receive.');
      row.status = 200; return { ok: true, ...(await CF.pull(p.cf_session, { tracks })) };
    }
    if (b.op === 'renegotiate') { row.status = 200; return { ok: true, ...(await CF.renegotiate(p.cf_session, b)) }; }
    row.status = 200; return { ok: true };   // close, layer
  };
  // the app's api (calls/api.js): a guest's requests carry its pass, a member's carry only what the caller gives
  const apiFor = (who, guest) => ({ call: (action, body) => { if (action !== 'cf') return Promise.resolve({ ok: true }); return server(who, guest ? 'gt-' + who : null, Object.assign({ action }, guest ? { gt: 'gt-' + who } : {}, body || {})); } });
  window.seen = {};
  window.person = async (me, guest) => {
    people[me] = { cf_session: null };
    const got = seen[me] = {};
    const m = createMedia('sfu', { signal: signalFor(me), me, ice: [], api: apiFor(me, guest), room: ROOM,
      onRemote: (id, s) => { if (!s) { delete got[id]; return; }
        const x = got[id] = got[id] || {};
        if (s.cam) { x.cam = s.cam; x.audio = s.cam.getAudioTracks().length; x.videoTracks = s.cam.getVideoTracks().length;
          if (!x.el && x.videoTracks) { x.el = document.createElement('video'); x.el.muted = true; x.el.autoplay = true; x.el.playsInline = true; document.body.appendChild(x.el); }
          if (x.el && x.el.srcObject !== s.cam) { x.el.srcObject = s.cam; x.el.play().catch(() => {}); } } },
      onLevel: () => {} });
    try { await m.start(stream); } catch (e) { got.__error = String(e && e.message || e); }
    return true;
  };
  window.state = (a, b) => { const x = (seen[a] || {})[b] || {}; return { video: !!(x.el && x.el.videoWidth > 0), audio: x.audio || 0, err: (seen[a] || {}).__error || '' }; };
}"""

def wait(pg, pairs, secs):
    t0 = time.time()
    while time.time() - t0 < secs:
        st = {a + ">" + b: pg.evaluate("([a, b]) => state(a, b)", [a, b]) for a, b in pairs}
        if all(x["video"] and x["audio"] for x in st.values()): return st, time.time() - t0
        pg.wait_for_timeout(250)
    return st, time.time() - t0

with sync_playwright() as p:
    br = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns", "--autoplay-policy=no-user-gesture-required"])
    ctx = br.new_context(permissions=["camera", "microphone"])
    pg = ctx.new_page()
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route(ORIGIN + "/**", serve)
    pg.goto(ORIGIN + "/")
    pg.evaluate(SETUP)

    print("1. a member (the host) and a guest in a call over the SFU")
    pg.evaluate("() => Promise.all([person('host-0001', false), person('guest-0002', true)])")
    st, took = wait(pg, [("host-0001", "guest-0002"), ("guest-0002", "host-0001")], 15)
    ok(not pg.evaluate("seen['host-0001'].__error || ''"), "the host's media started (%s)" % pg.evaluate("seen['host-0001'].__error || 'no error'"))
    ok(not pg.evaluate("seen['guest-0002'].__error || ''"), "the guest's media started (%s)" % pg.evaluate("seen['guest-0002'].__error || 'no error'"))
    ok(st["host-0001>guest-0002"]["video"] and st["host-0001>guest-0002"]["audio"], "the host gets the guest's picture and voice (%s)" % st["host-0001>guest-0002"])
    ok(st["guest-0002>host-0001"]["video"] and st["guest-0002>host-0001"]["audio"], "the guest gets the host's picture and voice (%s, %.1f s)" % (st["guest-0002>host-0001"], took))

    print("2. the member's requests named the call")
    log = pg.evaluate("cfLog")
    mem = [x for x in log if not x["gt"]]
    ok(mem and all(x["room_id"] == pg.evaluate("ROOM") for x in mem), "every 'cf' request of the member carried room_id (%s)" % [(x["op"], x["room_id"]) for x in mem][:6])
    bad = [x for x in log if x["status"] != 200]
    ok(not bad, "none refused (%s)" % bad[:4])
    ok(any(x["op"] == "session" and not x["gt"] for x in log) and any(x["op"] == "push" and not x["gt"] for x in log), "the member opened a session and pushed")

    print("3. a third person joins later")
    pg.evaluate("() => person('member-0003', false)")
    st, took = wait(pg, [("member-0003", "host-0001"), ("member-0003", "guest-0002"), ("host-0001", "member-0003"), ("guest-0002", "member-0003")], 15)
    ok(all(x["video"] and x["audio"] for x in st.values()), "everyone gets the newcomer and the newcomer gets everyone (%s, %.1f s)" % (st, took))
    ok(not errors, "no page errors (%s)" % errors[:3])
    br.close()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
