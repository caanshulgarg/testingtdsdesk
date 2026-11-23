// Entries that did not reach Tally and need a person (the owner, 23-Nov-2026: "If tally has not posted entry then user
// action should be treated on priority with the warning message"), read in one place for Home's Needs you, the client's
// page header and the Post page (parts/PostNeeds.jsx). Its own file (a lazy chunk): nothing of it is in legacy.js.
//
// postWaitWhy(job): why a posting still waits, from what its own bridge said in its last beat (tally_devices.info.bridges,
//   as TLight and the Tally page read them): Tally closed or the company not open there -> "Open Tally and <company> on
//   <computer> (<Windows user>)"; the bridge not heard from -> turn the computer on; else "" (the posting's own words).
//   The cloud's 2-hour words ("restart FinCom Bridge") are never shown while the bridge says Tally is closed.
// postNeedList(now): [{cid, client, key, rank, n, kind, what, todo, label, tab, since}] for every client: one line per
//   client and reason, the most urgent first, then the oldest. Each line is made from the postings of FinCom's cloud
//   (CloudJobs, as the Post page reads them) with the Post page's own words (62-post-reasons postStatus): a line clears by
//   itself once its entries are in Tally (the posting's results), because nothing is kept here.
//   rank 1: may be in Tally or held for a person (Needs review, held, stopped after timeouts); 2: not posted (refused by
//   Tally, stopped, a ledger missing); 3: waiting more than 10 minutes for Tally (closed, company not open, bridge off).
import { tallyDevs } from "./tallyState.js";

export const WAIT_MS = 10 * 60000;
const BEAT_MS = 3 * 60000;
const norm = (x) => String(x || "").trim().replace(/\s+/g, " ").toLowerCase();
const userOf = (u) => String(u || "").split("\\").pop().trim();
const reasonText = (m) => (typeof postReasonText === "function" ? postReasonText(m) : String(m || "").trim());

// the bridge a posting goes through, as its computer last told the cloud: {computer, user, online, tally, open} or null
export function bridgeOf(job, devs, now = Date.now()) {
  const id = (job && (job.taken_by || job.target_bridge)) || "";
  if (!id) return null;
  for (const d of devs || tallyDevs()) {
    const info = (d && d.info) || {}, b = (info.bridges || {})[id];
    if (!b) continue;
    const at = Date.parse(b.at || "") || 0;
    return { id, computer: b.computer || info.computer || String(d.name || "").split(" · ")[0], user: userOf(b.user || info.user), at,
      version: String(b.version || ""), online: !!at && now - at < BEAT_MS, tally: b.tallyState || (b.tally ? "open" : "closed"), open: [].concat(b.open || []) };
  }
  return null;
}
// "NWS144 (bhoomi)"
const where = (b) => b.computer + (b.user ? " (" + b.user + ")" : "");
// {what, todo} of a posting that waits, from its bridge's last beat; null when the beat explains nothing
export function postWaitParts(job, devs, now) {
  if (!job || !["waiting", "taken", "running"].includes(job.status)) return null;
  const b = bridgeOf(job, devs, now), co = String(job.company || "the company").trim();
  if (!b) return null;
  if (!b.online) return { what: "FinCom Bridge on " + where(b) + " is not running", todo: "Turn on " + b.computer + " and sign in to Windows" + (b.user ? " as " + b.user : "") + ", then open Tally and " + co + "; the posting carries on by itself." };
  if (b.tally === "closed") return { what: "Tally is closed on " + where(b), todo: "Open Tally and " + co + " on " + where(b) + "; the posting carries on by itself." };
  if (b.tally === "busy") return { what: "Tally is busy on " + where(b) + " (a report or a pop-up is open)", todo: "Close it in Tally on " + where(b) + "; the posting carries on by itself." };
  if (job.company && !b.open.some((o) => norm(o) === norm(job.company))) return { what: co + " is not open in Tally on " + where(b), todo: "Open Tally and " + co + " on " + where(b) + "; the posting carries on by itself." };
  return null;
}
const OLD_BRIDGE = "2.5.15";
const verLess = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
export function postWaitWhy(job, devs, now) { const p = postWaitParts(job, devs, now); return p ? p.what + ". " + p.todo : ""; }
if (typeof window === "object") window.postWaitWhy = (job) => { try { return postWaitWhy(job); } catch (e) { return ""; } };

const KIND = { bill: ["bill", "bills"], bank: ["bank entry", "bank entries"], sale: ["sales invoice", "sales invoices"], other: ["entry", "entries"] };
export const kindWords = (k, n) => n + " " + (KIND[k] || KIND.other)[n === 1 ? 0 : 1];
// what an entry is: a bill here, a bank line (its statement's id and row), a sale (Tally's voucher type), else an entry
function kindOf(cid, id, r) {
  const d = typeof S === "object" && S.data ? S.data[cid] : null;
  if (d && d.entries && d.entries[id]) return "bill";
  if (/^stm\w*-\d+$/.test(id)) return "bank";
  if (r && /^(sales|credit note)/i.test(String(r.vchType || ""))) return "sale";
  return "other";
}
const idsOf = (j) => Array.isArray(j.entry_ids) && j.entry_ids.length ? j.entry_ids.map(String)
  : [...new Set([].concat(j.items || [], j.results || []).filter((x) => x && x.id).map((x) => String(x.id)))];
const ageOf = (j, now) => now - (Date.parse(j.status === "waiting" ? j.created_at : (j.updated_at || j.created_at)) || now);
const LABEL = { review: "Check in Tally", held: "See why it is held", refused: "Fix and post again", ledger: "Choose the Tally ledger", stopped: "Fix and post again", wait: "See the waiting posting" };

// the line one entry of one posting adds, or null: {key, rank, kind, what, todo, label, tab, since}
function lineOf(cid, id, job, devs, now, held) {
  const ix = CloudJobs.idx(job), r = ix.res.get(id) || null, it = ix.it.get(id) || null;
  const kind = kindOf(cid, id, r), since = job.updated_at || job.created_at || "";
  // held for a person by the cloud (174's stop flag) or stopped after timeouts in a row: before anything else
  if (job.stop_reason && (CloudJobs.live(job)) && !(r && r.ok)) return { key: "held:" + job.id, rank: 1, kind, what: "held, not sent to Tally", todo: reasonText(job.stop_reason), label: LABEL.held, tab: "errors", since };
  const entry = (typeof S === "object" && S.data && S.data[cid] && S.data[cid].entries && S.data[cid].entries[id]) || { id };
  let st = null;
  try { st = postStatus(entry, job, null, [], { id, held }); } catch (e) { st = null; }
  if (!st) return null;
  if (st.code === 4 || st.code === 5) {
    if (ageOf(job, now) < WAIT_MS) return null;
    if (/kept timing out/i.test(String(job.message || ""))) return { key: "timeouts:" + job.id, rank: 1, kind, what: "stopped: FinCom's cloud kept timing out", todo: "Tell FinCom support; the posting waits and nothing is sent twice.", label: LABEL.wait, tab: "topost", since };
    const p = postWaitParts(job, devs, now);
    // an old FinCom Bridge (before 2.5.15: no asking FinCom before each part, no carrying on after a pause) on that computer
    const b = p ? null : bridgeOf(job, devs, now), old = b && b.version && verLess(b.version, OLD_BRIDGE) ? { what: "FinCom Bridge on " + where(b) + " is an old version (" + b.version + ")", todo: "Update FinCom Bridge on " + where(b) + " to the latest version; the posting carries on by itself." } : null;
    const why = p || old || (() => { const x = typeof postReasonFor === "function" ? postReasonFor(job.message, cid) : null; return x && x.id !== "unknown" ? { what: x.reason.charAt(0).toLowerCase() + x.reason.slice(1), todo: x.fix } : { what: "waiting for Tally for " + Math.round(ageOf(job, now) / 60000) + " minutes", todo: "Open the posting on the Post page to see what it waits for." }; })();
    return { key: "wait:" + why.what, rank: 3, kind, what: why.what, todo: why.todo, label: LABEL.wait, tab: "topost", since: job.created_at || since };
  }
  // cancelled after the Tally computer had started it: part of it may be in Tally (the Post page's settle button)
  if (st.code === 9) return st.accepted === true ? { key: "cancelledlate:" + job.id, rank: 1, kind, what: "cancelled after it may have reached Tally", todo: (st.reason && st.reason.fix) || "Check Tally first.", label: LABEL.review, tab: "errors", since } : null;
  if (![6, 7, 8].includes(st.code)) return null;
  const rs = st.reason || {};
  const id2 = st.code === 6 ? "review" : rs.id === "ledger" ? "ledger" : st.code === 7 ? "refused" : "stopped";
  const what = st.code === 6 ? "not confirmed in Tally" : id2 === "ledger" ? String(rs.reason || "a ledger is not in Tally").replace(/^The ledger/, "the ledger") : (st.code === 7 ? "refused by Tally" : "stopped before sending") + (rs.reason && rs.id !== "unknown" ? " (" + rs.reason.charAt(0).toLowerCase() + rs.reason.slice(1) + ")" : "");
  const todo = st.code === 6 ? (rs.fix || "Look in Tally's Day Book: if it is there, mark it posted; if not, press Not in Tally – post again.") : (rs.fix || st.todo || "");
  return { key: id2 + ":" + (rs.id || "") + ":" + what, rank: st.code === 6 ? 1 : 2, kind, what, todo, label: LABEL[id2], tab: "errors", since: (r && r.sentAt) || since, reasonLine: st.code !== 6 && rs.reason ? rs.reason : "" };
}

// every client's lines (see the head of this file); cache: the same list for the same postings within a minute
let memo = { list: null, devAt: "", min: -1, out: [] };
export function postNeedList(now = Date.now(), devs) {
  if (typeof CloudJobs !== "object" || typeof postStatus !== "function") return [];
  const list = CloudJobs.list || [];
  const dv = devs || tallyDevs(), devAt = dv.map((d) => ((d.info || {}).beat || {}).at || "").join(",");
  if (!devs && memo.list === list && memo.devAt === devAt && memo.min === Math.floor(now / 60000)) return memo.out;
  const seen = new Set(), groups = new Map();
  // the newest posting naming an entry decides (the Post page's rule)
  const jobs = list.slice().filter((j) => j && j.id && j.client_id).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  for (const j of jobs) {
    const cid = j.client_id, ids = idsOf(j);
    const quiet = j.dismissed_at || (CloudJobs.stopped && CloudJobs.stopped(j) && CloudJobs.absorber && CloudJobs.absorber(j)) || (j.status === "cancelled" && !/after the Tally computer had started/i.test(String(j.message || "")));
    for (const id of ids) {
      const k = cid + "|" + id;
      if (seen.has(k)) continue;
      seen.add(k);
      if (quiet || (CloudJobs.okIn && CloudJobs.okIn(j).has(id))) continue;
      if (CloudJobs.inTally && CloudJobs.inTally(j, id)) continue;
      const l = lineOf(cid, id, j, dv, now, null);
      if (!l) continue;
      const gk = cid + "|" + l.key + "|" + l.kind;
      const g = groups.get(gk);
      if (g) { g.n++; if (String(l.since) < String(g.since)) g.since = l.since; }
      else groups.set(gk, Object.assign({ cid, client: clientName(cid, j), n: 1 }, l));
    }
  }
  // a ready bill whose ledger Tally lacks (no posting names it): the Post page's own rows, for a client loaded here
  if (typeof postEntryRows === "function") for (const cid of Object.keys((typeof S === "object" && S.data) || {})) {
    let rows = null; try { rows = S.data[cid] && S.data[cid].loaded ? postEntryRows(cid) : null; } catch (e) { rows = null; }
    for (const r of rows || []) {
      if (r.job || !r.st || r.st.code !== 8 || !r.st.reason || r.st.reason.id !== "ledger" || seen.has(cid + "|" + r.id)) continue;
      const l = { key: "ledger:" + r.st.reason.reason, rank: 2, kind: r.kind === "bank" ? "bank" : "bill", what: String(r.st.reason.reason).replace(/^The ledger/, "the ledger"), todo: r.st.reason.fix, label: LABEL.ledger, tab: "errors", since: (r.e && (r.e.approvedAt || r.e.createdAt)) || "" };
      const gk = cid + "|" + l.key + "|" + l.kind, g = groups.get(gk);
      if (g) g.n++; else groups.set(gk, Object.assign({ cid, client: clientName(cid, { company: "" }), n: 1 }, l));
    }
  }
  const out = [...groups.values()].sort((a, b) => a.rank - b.rank || String(a.since).localeCompare(String(b.since)) || a.client.localeCompare(b.client));
  if (!devs) memo = { list, devAt, min: Math.floor(now / 60000), out };
  return out;
}
function clientName(cid, j) { const c = typeof S === "object" && S.companies ? S.companies[cid] : null; return (c && c.name) || j.company || "A client"; }
// one sentence: "12 bank entries not in Tally: Tally is closed on NWS144 (bhoomi). Open Tally and X on NWS144 (bhoomi); …"
export function needSentence(x) {
  return kindWords(x.kind, x.n) + " " + (x.what === "not confirmed in Tally" ? x.what : "not in Tally: " + x.what) + ". " + x.todo;
}
// per client: [{cid, client, n, rank, since, lines}], the most urgent client first
export function postNeedClients(now, devs) {
  const by = new Map();
  for (const x of postNeedList(now, devs)) {
    if (!by.has(x.cid)) by.set(x.cid, { cid: x.cid, client: x.client, n: 0, rank: x.rank, since: x.since, lines: [] });
    const c = by.get(x.cid); c.n += x.n; c.lines.push(x); c.rank = Math.min(c.rank, x.rank); if (String(x.since) < String(c.since)) c.since = x.since;
  }
  return [...by.values()].sort((a, b) => a.rank - b.rank || String(a.since).localeCompare(String(b.since)));
}
