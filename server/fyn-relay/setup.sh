#!/bin/bash
# TDS Desk FYN relay: one-paste setup on a fresh Ubuntu 22.04 / 24.04 server with a static IP.
# Run as:  sudo bash setup.sh     (or paste the whole thing into the server's browser terminal)
# At the end it prints the relay address and key to put in Supabase, and the IP to whitelist at Fynamics.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
IP=$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')
HOST="$(echo "$IP" | tr . -).sslip.io"
echo "== Public IP $IP, address https://$HOST"
apt-get update -qq
apt-get install -y -qq nodejs curl debian-keyring debian-archive-keyring apt-transport-https gnupg openssl >/dev/null
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
mkdir -p /opt/fyn-relay
cat > /opt/fyn-relay/relay.mjs <<'RELAY'
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
RELAY
[ -f /opt/fyn-relay/env ] || echo "RELAY_KEY=$(openssl rand -hex 32)" > /opt/fyn-relay/env
chmod 600 /opt/fyn-relay/env
cat > /etc/systemd/system/fyn-relay.service <<UNIT
[Unit]
Description=TDS Desk FYN relay
After=network-online.target
[Service]
EnvironmentFile=/opt/fyn-relay/env
ExecStart=/usr/bin/node /opt/fyn-relay/relay.mjs
Restart=always
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
  reverse_proxy 127.0.0.1:8080
}
CADDY
systemctl daemon-reload
systemctl enable --now fyn-relay >/dev/null
systemctl restart fyn-relay caddy
sleep 8
echo
if curl -fsS "https://$HOST/health" >/dev/null 2>&1; then echo "== Relay is up: https://$HOST/health answers"; else echo "== Relay not answering on https yet. Check the firewall allows ports 80 and 443, then: sudo systemctl restart caddy"; fi
echo
echo "================ put these in Supabase > Edge Functions > Secrets ================"
echo "FYN_RELAY_URL = https://$HOST"
echo "FYN_RELAY_KEY = $(cut -d= -f2 /opt/fyn-relay/env)"
echo "================ whitelist this IP at Fynamics ================"
echo "$IP"
