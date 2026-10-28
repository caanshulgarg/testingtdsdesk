// The others' voices, each in its own <audio> element (28-Oct-2026: the owner heard nobody). A voice played through the
// picture's <video> waits for the picture's first frame and goes when a browser mutes that element; an <audio> element
// plays the voice alone. A browser that holds sound until the person touches the page (Safari, a phone, Chrome without
// an earlier tap) is told about through onBlocked(true): the call screen says "Tap to hear", and the next tap or key
// anywhere plays every voice.
//   const v = makeVoices({ root, onBlocked });
//   v.set(peerId, stream|null)   the person's stream (its audio tracks are played; none, or null: the element goes)
//   v.unlock()                   play them all now (from a tap)
//   v.setSink(deviceId)          the speaker chosen
//   v.stop()
export function makeVoices({ root, onBlocked } = {}) {
  const els = new Map();
  let blocked = false, sink = "", stopped = false;
  const say = (b) => { if (b === blocked) return; blocked = b; try { onBlocked && onBlocked(b); } catch (e) { /* */ } };
  const gesture = () => { if (blocked) unlock(); };
  const EVENTS = ["pointerdown", "keydown", "touchend"];
  if (typeof document !== "undefined") EVENTS.forEach((e) => document.addEventListener(e, gesture, true));
  function play(el) {
    let p;
    try { p = el.play(); } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(p).then(() => true, (e) => {
      if (e && e.name === "AbortError") return true;          // a newer stream took its place
      say(true); return false;
    });
  }
  function set(pid, stream) {
    if (stopped || !pid) return;
    const tracks = stream && stream.getAudioTracks ? stream.getAudioTracks().filter((t) => t.readyState !== "ended") : [];
    let x = els.get(pid);
    if (!tracks.length) { if (x) { try { x.el.srcObject = null; x.el.remove(); } catch (e) { /* */ } els.delete(pid); } return; }
    const key = tracks.map((t) => t.id).join(",");
    if (x && x.key === key) { if (x.el.paused) play(x.el); return; }
    if (!x) {
      const el = document.createElement("audio");
      el.autoplay = true; el.setAttribute("playsinline", ""); el.setAttribute("data-voice", pid); el.hidden = true;
      if (sink && el.setSinkId) el.setSinkId(sink).catch(() => {});
      (root || document.body).appendChild(el);
      x = { el, key: "" }; els.set(pid, x);
    }
    x.key = key; x.el.srcObject = new MediaStream(tracks); play(x.el);
  }
  function unlock() {
    if (!els.size) { say(false); return Promise.resolve(true); }
    return Promise.all([...els.values()].map((x) => play(x.el))).then((r) => { const okAll = r.every(Boolean); if (okAll) say(false); return okAll; });
  }
  return {
    set, unlock,
    setSink(id) { sink = id || ""; els.forEach((x) => { try { x.el.setSinkId && x.el.setSinkId(sink).catch(() => {}); } catch (e) { /* */ } }); },
    get blocked() { return blocked; },
    playing() { let n = 0; els.forEach((x) => { if (!x.el.paused) n++; }); return n; },
    stop() {
      stopped = true;
      if (typeof document !== "undefined") EVENTS.forEach((e) => document.removeEventListener(e, gesture, true));
      els.forEach((x) => { try { x.el.pause(); x.el.srcObject = null; x.el.remove(); } catch (e) { /* */ } }); els.clear();
    },
  };
}
