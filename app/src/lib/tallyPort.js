// Tally's port (26-Oct-2026, next-tally-port; next-link-record): the one free port FinCom proposes, the words of the
// "Set Tally's port" step, and whether a computer's Tally is on a port it should not be. Used by the Tally page's step 2
// (screens/Tally.jsx portState / PortStep) and by a client's one status (lib/linkStatus.js). Nothing is asked of Tally
// or the bridge: what the beats already say (info.bridges[].tallyPort and user, beat.tallyPort, beat.ports).
// The TallyPrime 7.1/7.2 proof (26-Oct-2026, docs/tally-72-proof.md): bridge 2.4.7 connects to Tally on any port it
// finds (4125 worked); the bridge's own "not accepting connections on port N" diagnosis for ports outside 9000-9999 is
// a false alarm. So FinCom says a port problem only when the bridge itself reports it cannot reach Tally (its beat's
// ports: an entry of its own, not another user's, with an error and nothing answering). A port it proposes stays in
// 9000-9099 (the bridge's fallback when Windows hides the programs is 9000-9005).
export const PORT_MIN = 9000, PORT_MAX = 9999;
// the ports FinCom never proposes: TallyPrime's own default (a new user's Tally starts there) and ports other programs
// commonly take (9001, 9009, 9042, 9050/9051, 9060, 9080, 9090 to 9095, 9099)
export const PORT_AVOID = [9000, 9001, 9009, 9030, 9042, 9043, 9050, 9051, 9060, 9080, 9090, 9091, 9092, 9093, 9094, 9095, 9099];
const lc = (x) => String(x || "").trim().replace(/\s+/g, " ").toLowerCase();
// the first of 9000-9099 not seen in use on that computer by anyone and not in PORT_AVOID, counted from a start that
// depends on the Windows user's name (two users setting up at once are not offered the same number)
export function freePort(seen, user) {
  const used = seen instanceof Set ? seen : new Set([].concat(seen || []).map(Number));
  const cands = [];
  for (let p = 9000; p <= 9099; p++) if (!used.has(p) && !PORT_AVOID.includes(p)) cands.push(p);
  let h = 0;
  for (const ch of lc(user)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return cands.find((p) => p >= 9000 + (h % 100)) || cands[0] || 0;
}
// the step's words: TallyPrime's own menu in one line (TallyPrime 3.0 to 7.1)
export const portHowWords = (free) => "In TallyPrime: F1 → Settings → Connectivity → Client/Server configuration → Acts as Both, Port " + free + ", ODBC Yes → Ctrl+A → restart Tally.";
// the one warning (the owner: "Use a port between 9000 and 9999 — 90xx is free")
export const portWarnWords = (free) => "Use a port between " + PORT_MIN + " and " + PORT_MAX + " — " + free + " is free";
const heard = (at) => { const t = Date.parse(at || ""); return !!t && Date.now() - t < 7 * 864e5; };
// the port problem the bridge reports for the Tally that keeps `company` on a computer (its bridge: the one with the
// company open, else the computer's beat): {kind: unreachable | clash, port, who, error, free, user}, or null. Only when
// the beat's own ports (not another user's, skipped) have none answering and one with an error
export function portIssueOf(dev, company, same) {
  const info = (dev && dev.info) || {}, beat = info.beat || {}, brs = Object.entries(info.bridges || {});
  const eq = same || ((a, b) => lc(a) === lc(b));
  const mine = (company && brs.find(([, b]) => b && Array.isArray(b.open) && b.open.some((n) => eq(n, company)))) || (brs.length === 1 ? brs[0] : null);
  const user = (mine && mine[1] && mine[1].user) || beat.windowsUser || "";
  const ports = [].concat(beat.ports || []).filter((x) => x && Number(x.port) > 0);
  const own = ports.filter((x) => !x.skipped);
  if (!own.length || own.some((x) => x.ok)) return null;
  const bad = own.find((x) => String(x.error || "").trim());
  if (!bad) return null;
  const port = Number(bad.port), used = new Set(ports.map((x) => Number(x.port))), other = new Map();
  brs.forEach(([id, b]) => { if (!b || (mine && id === mine[0])) return; const p = Number(b.tallyPort) || 0; if (p <= 0) return; used.add(p);
    if (heard(b.at) && lc(b.user) !== lc(user) && !other.has(p)) other.set(p, b.user || "another user"); });
  ports.forEach((x) => { if (x.skipped && Number(x.port) === port && !other.has(port)) other.set(port, "another user"); });
  const free = freePort(used, user);
  return other.has(port) ? { kind: "clash", port, who: other.get(port), error: String(bad.error), free, user } : { kind: "unreachable", port, error: String(bad.error), free, user };
}
// the reason in words: "FinCom Bridge cannot reach Tally on port 9005 (ravi's Tally is on it)"
export function portIssueWords(pi) {
  if (!pi) return "";
  return "FinCom Bridge cannot reach Tally on port " + pi.port + (pi.kind === "clash" ? " (" + (pi.who && pi.who !== "another user" ? pi.who + "'s" : "another user's") + " Tally is on it)" : "");
}
