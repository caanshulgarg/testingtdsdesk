// A small Supabase Realtime client for calls: broadcast and presence on one channel, over Realtime's own websocket
// (Phoenix channels, JSON, vsn 1.0.0). FinCom has no supabase-js; this is the part calls need (about 3 KB, in the calls
// chunk only). It reconnects by itself with back-off when the line drops, joins the channel again and tracks presence
// again; the call screen says "Reconnecting…" meanwhile.
//   const ch = channel({url, key, topic, presenceKey, onStatus});
//   ch.on("signal", (payload) => …); ch.onPresence((list) => …); ch.send("signal", {…}); ch.track({name, …}); ch.close();
export function channel({ url, key, topic, presenceKey, onStatus, token }) {
  const wsUrl = String(url).replace(/^http/, "ws").replace(/\/+$/, "") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(key) + "&vsn=1.0.0";
  const full = "realtime:" + topic;
  const handlers = {}, presenceHandlers = [];
  let ws = null, ref = 0, joinRef = null, joined = false, closed = false, tries = 0, beat = null, tracked = null, queue = [], timer = null;
  let presence = {};
  const status = (s) => { try { onStatus && onStatus(s); } catch (e) { /* */ } };
  const raw = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const push = (event, payload) => {
    const msg = { topic: full, event, payload, ref: String(++ref), join_ref: joinRef };
    if (joined) raw(msg); else if (queue.length < 200) queue.push(msg);
  };
  const emitPresence = () => {
    const list = [];
    for (const k of Object.keys(presence)) for (const m of presence[k]) list.push(Object.assign({ key: k }, m));
    presenceHandlers.forEach((f) => { try { f(list); } catch (e) { /* */ } });
  };
  function open() {
    if (closed) return;
    status(tries ? "reconnecting" : "connecting");
    try { ws = new WebSocket(wsUrl); } catch (e) { return later(); }
    ws.onopen = () => {
      joinRef = String(++ref);
      raw({ topic: full, event: "phx_join", ref: joinRef, join_ref: joinRef, payload: {
        config: { broadcast: { ack: false, self: false }, presence: { key: presenceKey || "" }, postgres_changes: [], private: false }, ...(token ? { access_token: token } : {}) } });
      clearInterval(beat);
      beat = setInterval(() => raw({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++ref) }), 25000);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.topic !== full) return;
      if (m.event === "phx_reply" && m.ref === joinRef) {
        if (m.payload && m.payload.status === "ok") {
          joined = true; tries = 0; status("joined");
          const q = queue; queue = []; q.forEach((x) => raw(Object.assign(x, { join_ref: joinRef })));
          if (tracked) push("presence", { type: "presence", event: "track", payload: tracked });
        } else { status("refused"); }
        return;
      }
      if (m.event === "broadcast" && m.payload) {
        const ev2 = m.payload.event; (handlers[ev2] || []).forEach((f) => { try { f(m.payload.payload || {}); } catch (e) { console.error(e); } });
        return;
      }
      if (m.event === "presence_state") { presence = {}; for (const k of Object.keys(m.payload || {})) presence[k] = (m.payload[k].metas || []); emitPresence(); return; }
      if (m.event === "presence_diff") {
        const d = m.payload || {};
        for (const k of Object.keys(d.leaves || {})) { const gone = new Set((d.leaves[k].metas || []).map((x) => x.phx_ref)); presence[k] = (presence[k] || []).filter((x) => !gone.has(x.phx_ref)); if (!presence[k].length) delete presence[k]; }
        for (const k of Object.keys(d.joins || {})) presence[k] = (presence[k] || []).concat(d.joins[k].metas || []);
        emitPresence(); return;
      }
      if (m.event === "phx_error" || m.event === "phx_close") { try { ws.close(4000, "again"); } catch (e) { /* */ } }
    };
    ws.onclose = () => { joined = false; clearInterval(beat); if (!closed) later(); };
    ws.onerror = () => { /* onclose follows */ };
  }
  function later() {
    if (closed) return;
    tries++; status("reconnecting");
    clearTimeout(timer);
    timer = setTimeout(open, Math.min(15000, 500 * Math.pow(2, Math.min(tries, 5))) + Math.random() * 300);
  }
  // back on line: at once, not after the back-off
  const online = () => { if (!joined && !closed) { clearTimeout(timer); open(); } };
  if (typeof window !== "undefined") window.addEventListener("online", online);
  open();
  return {
    topic,
    on(event, f) { (handlers[event] = handlers[event] || []).push(f); return () => { handlers[event] = handlers[event].filter((x) => x !== f); }; },
    onPresence(f) { presenceHandlers.push(f); emitPresence(); },
    send(event, payload) { push("broadcast", { type: "broadcast", event, payload }); },
    track(meta) { tracked = meta; if (joined) push("presence", { type: "presence", event: "track", payload: meta }); },
    get joined() { return joined; },
    close() {
      closed = true; clearInterval(beat); clearTimeout(timer);
      if (typeof window !== "undefined") window.removeEventListener("online", online);
      try { if (joined) raw({ topic: full, event: "phx_leave", payload: {}, ref: String(++ref), join_ref: joinRef }); ws && ws.close(1000, "left"); } catch (e) { /* */ }
    },
  };
}
