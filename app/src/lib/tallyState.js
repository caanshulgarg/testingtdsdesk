// One state of a Tally company, in Suvit's words (23-Oct-2026, next-tally-suvit; the owner: "make sure it should connect
// like Suvit.. every step.. don't need extra steps in connection"). Used by every place that says how a company or a
// client stands with Tally, so the words never disagree: the Tally page's Companies in Tally, the client's Tally card, the
// Clients list's chip and the top bar's sign.
//   Connected                                                  the company is open in Tally on a computer whose FinCom
//                                                              Bridge beat within about two minutes (devState: online or
//                                                              one beat late)
//   Disconnected — not open in Tally on NWS144 (last seen 20-Oct)   the computer is on, the company is not open there
//   Disconnected — computer offline since 14:02                the computer that keeps it has not beaten for 2 minutes
//   Disconnected — not seen in Tally yet                       no computer of the firm has reported it
// From what FinCom already reads (nothing new is asked): the heartbeats (tally_devices: info.beat.open, info.bridges[].open,
// TLight.st.devs / TCloud.pane.devices) and the companies (tally_companies.last_seen / device_id).
const IST = 5.5 * 3600e3, MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "today 15:21", "yesterday 15:21", "20-Oct" (IST)
export function seenWords(iso) {
  const t = Date.parse(iso || ""); if (!t) return "";
  const d = new Date(t + IST), now = new Date(Date.now() + IST), day = (x) => Math.floor(x.getTime() / 864e5);
  const gap = day(now) - day(d), hm = String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
  return gap <= 0 ? "today " + hm : gap === 1 ? "yesterday " + hm : String(d.getUTCDate()).padStart(2, "0") + "-" + MON[d.getUTCMonth()] + (d.getUTCFullYear() !== now.getUTCFullYear() ? "-" + d.getUTCFullYear() : "");
}
// (24-Oct-2026, Suvit: names with extra spaces break sync: the spaces are collapsed for comparing; the exact name is kept
// for the link, as the cloud has it)
export const coKey = (n) => (typeof ledNm === "function" ? ledNm(String(n || "")) : String(n || "")).replace(/\s+/g, " ").trim().toLowerCase();
export const spacesOdd = (n) => { const s = String(n || ""); return s !== s.replace(/\s+/g, " ").trim(); };
// the firm's computers, as TLight or the Tally page last read them (the newer beat of each)
export function tallyDevs() {
  const by = new Map(), at = (d) => String((((d && d.info) || {}).beat || {}).at || "");
  [].concat((typeof TLight === "object" && TLight.st.devs) || [], (typeof TCloud === "object" && TCloud.pane && TCloud.pane.devices) || [])
    .forEach((d) => { if (d && d.id && !d.revoked && (!by.has(d.id) || at(d) > at(by.get(d.id)))) by.set(d.id, d); });
  return [...by.values()];
}
// the companies a computer's beat says are open in Tally (its own beat and each bridge's)
export function openOn(d) {
  const info = (d && d.info) || {};
  return [].concat((info.beat || {}).open || []).concat(...Object.values(info.bridges || {}).map((b) => [].concat((b && b.open) || []))).map(String).filter(Boolean);
}
export const pcOf = (d) => { const i = (d && d.info) || {}; return String(i.computer || (i.beat || {}).computer || (d && d.name) || "the Tally computer"); };
// the computer is heard from (a beat in about the last two minutes)
export function pcLive(d) { if (typeof devState !== "function") return false; const s = devState(d).bridge; return s === "online" || s === "reconnecting"; }
// the rows FinCom keeps of a company (tally_companies)
export const coRows = (company) => { const k = coKey(company);
  return [].concat((typeof TLight === "object" && TLight.st.cos) || [], (typeof TCloud === "object" && TCloud.pane && TCloud.pane.companies) || []).filter((r) => r && coKey(r.company) === k); };

export function hereOpen(k) {
  try { return typeof Bridge === "object" && Bridge.up() && [].concat(Bridge.st.open || []).some((x) => coKey(x && x.name) === k); } catch (e) { return false; }
}
// {state: connected | notopen | offline | unseen, level, word, text, computer, seen}
export function tallyCoState(company) {
  const k = coKey(company), devs = tallyDevs(), rows = coRows(company);
  const seen = rows.map((r) => String(r.last_seen || "")).sort().pop() || "";
  // (next-link-record: or its other name, a company renamed in Tally: the link record's LinkRec.same)
  const has = (d) => openOn(d).some((n) => coKey(n) === k || (globalThis.LinkRec && LinkRec.same(n, company))) && (typeof devState !== "function" || devState(d).tally !== "closed");
  const o = (state, text, d) => ({ state, level: state === "connected" ? "ok" : "bad", word: state === "connected" ? "Connected" : "Disconnected", text, computer: d ? pcOf(d) : "", seen });
  const on = devs.find((d) => pcLive(d) && has(d));
  if (on) return o("connected", "Connected", on);
  const dev = devs.find((d) => rows.some((r) => r.device_id === d.id)) || devs.find(has);
  // FinCom Bridge on this computer, answering here, with the company open (no word from the cloud for it)
  if (hereOpen(k)) return Object.assign(o("connected", "Connected", null), { computer: "this computer" });
  if (!dev) return o("unseen", "Disconnected — not seen in Tally yet", null);
  if (!pcLive(dev)) { const at = ((dev.info || {}).beat || {}).at || dev.last_seen || "";
    return o("offline", "Disconnected — computer offline" + (at && typeof tallyHm === "function" ? " since " + String(tallyHm(at)).replace(/ IST$/, "") : ""), dev); }
  return o("notopen", "Disconnected — not open in Tally on " + pcOf(dev) + (seen ? " (last seen " + seenWords(seen) + ")" : ""), dev);
}
// a client's: its linked company's state; "Not linked" when it has none (the bridge on this computer counts when FinCom's
// cloud is not in use)
export function clientTallyState(co) {
  // next-link-record: one word everywhere (Linked / Waiting for Tally / Needs you), lib/linkStatus.js once loaded
  const w = globalThis.LinkWord && LinkWord(co); if (w) return w;
  const k = co && typeof tallyLinkOf === "function" ? tallyLinkOf(co) : null;
  if (!k || k.state === "unlinked") return { state: "unlinked", level: "warn", word: "Not linked", text: "Not linked to its company in Tally yet", computer: "", seen: "", company: "" };
  const cloud = typeof TCloud === "object" && TCloud.on();
  if (!cloud && k.line && k.line.state === "open") return { state: "connected", level: "ok", word: "Connected", text: "Connected", computer: k.line.computer || "", seen: "", company: k.company };
  return Object.assign(tallyCoState(k.company), { company: k.company });
}
// the last entry: Tally's change recorder on the company's computer (its heartbeat), else the bridge's last read
export function lastEntry(co, k) {
  const tl = (typeof TLight === "object" && TLight.st) || {};
  const row = (tl.cos || []).find((c) => String(c.client_id || "") === String(co.id) && c.device_id && (!k || !k.company || c.company === k.company)), dev = row && (tl.devs || []).find((d) => d.id === row.device_id);
  let rec = ""; try { const rc = dev && typeof Rec === "object" && Rec.recOf ? Rec.recOf(dev) : null, y = rc && row.company ? rc[row.company] : null; rec = (y && y.lastAt) || ""; } catch (e) { rec = ""; }
  return [k && k.line && k.line.read, rec].filter(Boolean).sort().pop() || "";
}
// next-tally-firstlink (the owner, 24-Oct-2026: "it should be above, on the Tally icon"): the companies open in Tally now,
// on a computer heard from, that are no client's (a client deleted here: not linked), once each. The top bar's Tally sign
// counts them (its badge) and its panel offers each one's link (parts/TallyOffer.jsx)
export function unlinkedOpen() {
  if (typeof TCloud !== "object" || !TCloud.on()) return [];
  const linked = new Set(), seen = new Set(), out = [];
  [].concat((typeof TLight === "object" && TLight.st.cos) || [], (TCloud.pane && TCloud.pane.companies) || [])
    .forEach((r) => { const co = r && r.client_id && S.companies ? S.companies[r.client_id] : null; if (r && r.client_id && !(co && co.deleted)) linked.add(coKey(r.company)); });
  tallyDevs().forEach((d) => { if (pcLive(d)) openOn(d).forEach((n) => { const k = coKey(n); if (k && !linked.has(k) && !seen.has(k)) { seen.add(k); out.push(n); } }); });
  return out;
}
// who may link a company to a client: the cloud's can_write (members owner or staff)
export const mayLink = () => !!(S.account && S.account.me && ["owner", "staff"].includes(S.account.me.role));
