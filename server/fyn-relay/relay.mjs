// TDS Desk FYN relay: runs on a small server with a fixed IP, so Fynamics sees one whitelisted address.
// It passes on calls from the firm's Supabase function (gst-api) to Fynamics, and nothing else:
// - the caller must send the shared key (x-relay-key), compared in constant time
// - the target (x-target) must be an https address on fynamics.co.in
// Nothing is logged except the time, path and status; bodies and headers are never written anywhere.
import http from "node:http";
import crypto from "node:crypto";
const KEY = process.env.RELAY_KEY || "";
const PORT = +(process.env.PORT || 8080);
const ALLOW = new RegExp(process.env.ALLOW_HOST || "^([a-z0-9-]+\\.)*fynamics\\.co\\.in$");
if (KEY.length < 32) { console.error("RELAY_KEY must be at least 32 characters"); process.exit(1); }
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const DROP = new Set(["host", "connection", "content-length", "x-relay-key", "x-target", "accept-encoding", "transfer-encoding", "keep-alive", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "x-real-ip", "via"]);
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.url !== "/fwd") return send(res, 404, { ok: false, error: "not here" });
  if (!same(req.headers["x-relay-key"] || "", KEY)) return send(res, 401, { ok: false, error: "relay key wrong" });
  let target;
  try { target = new URL(String(req.headers["x-target"] || "")); } catch { return send(res, 400, { ok: false, error: "x-target missing" }); }
  if (target.protocol !== "https:" || !ALLOW.test(target.hostname)) return send(res, 403, { ok: false, error: "only Fynamics addresses are relayed" });
  const method = String(req.headers["x-method"] || req.method).toUpperCase();
  if (!["GET", "POST", "PUT"].includes(method)) return send(res, 405, { ok: false, error: "method" });
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 10 * 1024 * 1024) return send(res, 413, { ok: false, error: "too large" }); chunks.push(c); }
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP.has(k) && k !== "x-method") headers[k] = Array.isArray(v) ? v.join(", ") : v;
  try {
    const r = await fetch(target, { method, headers, body: method === "GET" ? undefined : Buffer.concat(chunks), signal: AbortSignal.timeout(120000) });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "application/octet-stream" }); res.end(buf);
    console.log(new Date().toISOString(), method, target.pathname, r.status);
  } catch (e) {
    console.log(new Date().toISOString(), method, target.pathname, "failed", String(e && e.message || e));
    send(res, 502, { ok: false, error: "Fynamics could not be reached from the relay: " + String(e && e.message || e) });
  }
}).listen(PORT, "127.0.0.1", () => console.log("FYN relay on 127.0.0.1:" + PORT));
