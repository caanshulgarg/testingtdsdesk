// tally-ingest: where the bridge on a computer with Tally sends its copy of the books.
//
// Who may call: a computer with a key made in FinCom (Settings, Tally connection). The key comes in the header
// x-fincom-device; only its SHA-256 is kept (tally_devices). A key that is revoked, or unknown, gets nothing.
// What it may send: only for its own firm, and only for a Tally company linked to one of that firm's clients
// (tally_companies). A company not linked yet is recorded (so FinCom can offer it for linking) and its data refused.
//
// Requests (POST, JSON):
//   {kind:"hello", version, info}                    -> {firm, device}
//   {kind:"companies", companies:[{name, gstin}]}    -> {links: {name: true|false}}; a company named exactly as one
//                                                       client's Tally name, with no GSTIN clash, is linked by itself
//   {kind:"days", company, days:[{day, gz}]}         -> each day's day book (gzip, base64): kept in the bucket
//                                                       tally-days, read into entries and lines, totals made ready
//   {kind:"ledgers", company, from, openAsOn, ledgers:[[name, parent, open]], groups?:[[name, parent]]}
//                                                       (groups from bridge 1.14.7: each ledger's chain of groups up to
//                                                       the primary group is worked out from them and kept; migration-33:
//                                                       add-only, a ledger missing from the list marked deleted, never
//                                                       removed, with the list it was missing from; upload_ledgers the same)
//   {kind:"groups", company, ledgers:[[name, parent]], groups:[[name, parent]]} -> (bridge 1.14.9) every ledger's group
//                                                       and Tally's groups, without openings: openings and entries stay
//   {kind:"state", company, state}
//   {kind:"beat", tally, open, ports?, companies:[{name, open, at, phase, waiting, lastRead}], updating, dailyAt, lastRun,
//    paused, notAnsweringSince, nightlyAt, lastRead, events} -> {updateNow, posts, wake, opened, activityAt}
//                                                       (FinCom Bridge 2.1.3 reads Tally only after an event: opened =
//                                                       {company: when} clients opened in FinCom lately, the fallback
//                                                       for the wake-up channel; activityAt = when FinCom was last used
//                                                       for this computer's clients, for the nightly catch-up)
//    FinCom Bridge 2.1.5 (plan items 10-12, migration-35-bridge-control): the beat also carries its self-watch,
//    reqs:{day, last:{kind, ms, at}, longest:{kind, ms, at}, over20, n} and readStopped:{by: self|fincom, reason, at}|null
//    (kept in info.beat and its info.bridges entry), and the answer carries readStop:{by:"fincom", reason, at}|null
//    (Stop reading from FinCom, for this computer or all of the firm's), readResume:true once after a Resume, and
//    release:{version, allowed} (the version this computer may install; none without a release row). Without
//    migration-35 none of the three is said. Older bridges ignore them. Round 2 (migration-34): the beat also carries
//    allowlist:{measured, hash} (every Tally request on the bridge's allow-list timed, and which list); kept with the
//    beat and, for the pilot computer, as evidence on the release (approval waits for measured)
//   {kind:"support", note, zip}                      -> the Connector's log and details for FinCom support
//   FinCom Bridge 2.1.4 as rebuilt on 02-Oct-2026 (migration-32-sync-safety; without it these answer as before, no lease):
//   {kind:"lease_take", company, ttl}                -> {held:false, lease:{until}} | {held:true, holder:{bridge, computer, until}}:
//                                                       only one bridge reads or posts a company at a time (renewed by taking
//                                                       it again); {noLease:true} when the cloud keeps none
//   {kind:"lease_release", company}                  -> the lease given back by its holder
//   {kind:"ledger_list", company, ledgers:[[guid, masterId, alterId, name, group, storedOpening, gstin, pan, openingChanged]],
//    renamed?:[[guid, from, to]], deleted?:[[guid, name]], groups?:[[name, parent]], last, round?, complete?, rowsRead?, seen?:[guid]}
//                                                    -> {added, renamed, deleted, deletesHeld, deletedIgnored, notes}: 2.1.4, the
//                                                       plain ledger list (applyLedgerList): rows added or brought up to date,
//                                                       renamed (old name kept), never removed. 2.1.5 (migration-34): each call
//                                                       is one batch of a read (round) carrying the GUIDs it read (seen); the
//                                                       batch is recorded with them (tally_ledger_round_batch), renames go
//                                                       through tally_ledger_rename (migration-36: the entries follow the
//                                                       name), the rows are upserted, THEN the GUIDs seen are stamped
//                                                       (tally_ledger_round_seen, migration-36), and on the last batch
//                                                       tally_ledgers_mark_gone(book, round) marks what the round did not see
//                                                       (complete round, every batch arrived, the bulk limit, the guard). The
//                                                       bridge's deleted list is ignored for marking (deletedIgnored). Without
//                                                       migration-34, or without a round id, nothing is marked. At most 60
//                                                       calls a minute from one computer (429)
//   {kind:"read_guard", company, guid, alter, count} -> {state: ok | needs_baseline, why}: the company's Tally GUID, highest
//                                                       AlterID and the entries read, kept at each read (tally_sync_reads)
//   companies:[{name, gstin, guid}]                  -> the company's Tally GUID kept with its book (tally_sync_cursor)
//   {kind:"posts_take"}                              -> {job: {id, company, payload} | null}: the next posting queued in
//                                                       FinCom for this computer (build 199); the beat says how many wait
//   {kind:"posts_update", id, status, done, message, results, checking} -> how a posting taken by this computer is going
//   {kind:"make_main", bridge}                        -> this bridge (FinCom Bridge 2.x, its menu) is the main one: only it posts
//   every call of FinCom Bridge 2.x carries bridge:{id, computer, user, mode, runMode, version} (bridgeOf); the beat's
//   answer says makeMain (made the main one on FinCom's Tally page) or notMain (another bridge posts on this computer)
//   any of these with shadow:true (go-bridge: FinCom Bridge 2.0.0 in test mode, beside bridge 1.15.0): compared, never
//                                                       kept, never a posting (shadowCall)
// Or a person signed in to FinCom (Authorization: Bearer, two-step done, a member of the firm), for one of the firm's
// clients, giving the books from files exported from Tally:
//   {kind:"wake", what:"open", client}             -> (2.1.3) a client opened in FinCom: its Tally computer is woken on its
//                                                       own channel ("open", {company}) for one light update
//   {kind:"wake", what:"active"}                   -> (2.1.3) FinCom in use: the nightly catch-up waits 15 quiet minutes
//   {kind:"wake", what:"ledgers", client}          -> (2.1.4) a bill's ledger chooser opened with a list older than the last
//                                                       posting: the Tally computer is woken ("ledgers", {company, at}) to
//                                                       read the ledger list; at most one a minute per company ({debounced})
//   {kind:"upload_days", client, company?, days:[{day, gz}]}
//   {kind:"upload_ledgers", client, company?, from, openAsOn, ledgers:[[name, parent, open]], groups?}
//   {kind:"reparse", client, month?}               -> the day books kept in the bucket read again into entries and
//                                                       lines (review of 01-Oct-2026: GSTIN, place of supply, HSN and
//                                                       rate were not kept before); one month a call, owners only;
//                                                       answers {done, next} until next is null
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseDay, amt, cleanName } from "./parse.js";
import { corsFor } from "../_shared/cors.ts";   // the one list of headers for every function (server/_shared/cors.ts)

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const MAX_BODY = 25 * 1024 * 1024;          // one request
const MAX_DAY = 60 * 1024 * 1024;           // one day's day book, unzipped
const MAX_UNZIP = 200 * 1024 * 1024;        // all the days of one request, unzipped

const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
// "*": the Tally bridge (no browser) and the app both call it, and every call carries a device key or a sign-in token
const cors = corsFor(null, { any: true, methods: "POST, OPTIONS" });
const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64bytes(s: string) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
// unzipped a piece at a time, and stopped past a limit (a small file that unzips to gigabytes is refused)
async function gunzip(u: Uint8Array, max: number) {
  const r = new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const parts: Uint8Array[] = []; let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await r.cancel(); } catch { /* */ } throw new Error("A day's day book is larger than FinCom takes in one go."); }
    parts.push(value);
  }
  const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return { text: new TextDecoder("utf-8").decode(all), size: n };
}
async function gzipBytes(u: Uint8Array) {
  const b = await new Response(new Blob([u]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return new Uint8Array(b);
}
// the body read a piece at a time, whatever the request says its length is
async function readBody(req: Request) {
  if (!req.body) return "";
  const r = req.body.getReader(); const parts: Uint8Array[] = []; let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    if (n > MAX_BODY) { try { await r.cancel(); } catch { /* */ } throw new Error("too large"); }
    parts.push(value);
  }
  const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return new TextDecoder("utf-8").decode(all);
}
// what a computer may say about its copy: known fields, of the right kind, nothing else
function cleanState(st: any) {
  const s = (v: unknown, n = 40) => typeof v === "string" ? v.slice(0, n) : "";
  const tr = st && typeof st.trouble === "object" && st.trouble ? { at: s(st.trouble.at), why: s(st.trouble.why, 300) } : null;
  return {
    phase: s(st?.phase, 12), from: s(st?.from, 8), to: s(st?.to, 8), doneTo: s(st?.doneTo, 8), seen: s(st?.seen, 30), bridge: s(st?.bridge, 20), computer: s(st?.computer, 60),
    skipped: (Array.isArray(st?.skipped) ? st.skipped : []).filter((d: unknown) => isDay(d)).slice(0, 400),
    queue: Math.max(0, Math.min(1e6, Math.floor(Number(st?.queue) || 0))), trouble: tr,
  };
}
const isDay = (d: unknown) => typeof d === "string" && /^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(d);
const iso = (d: string) => d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
const pan = (g: unknown) => String(g || "").toUpperCase().slice(2, 12);

// 02-Oct-2026: every bridge FinCom hears from on a computer key, kept in info.bridges by its id: FinCom Bridge 2.x sends
// bridge:{id "go-…", computer, user, mode test|main, runMode, version}; bridge 1.15.0 sends none and is kept as "v1", with
// the computer and Windows user of its hello. The Tally page lists them; the one in tally_devices.main_bridge (set from
// the Tally page or the bridge's menu, migration-22) is the only one given postings. Unset: the bridge not in test mode.
function bridgeOf(dev: any, body: any, shadow: boolean) {
  const s = (v: unknown, n = 80) => typeof v === "string" ? v.slice(0, n) : "";
  const b = body?.bridge && typeof body.bridge === "object" ? body.bridge : null;
  const id = b && /^go-[0-9a-f]{6,32}$/.test(String(b.id || "")) ? String(b.id) : "v1";
  const hello = (dev?.info && typeof dev.info === "object") ? dev.info : {};
  return { id, entry: { at: new Date().toISOString(), version: s(body?.version, 40) || s(b?.version, 40),
    computer: s(b?.computer, 60) || (id === "v1" ? s(hello.computer, 60) : ""), user: s(b?.user, 60) || (id === "v1" ? s(hello.user, 60) : ""),
    mode: shadow ? "test" : "main", runMode: ["user", "service", "window"].includes(b?.runMode) ? b.runMode : "",
    tally: !!body?.tally, tallyState: ["open", "busy", "closed"].includes(body?.tallyState) ? body.tallyState : (body?.tally ? "open" : "closed"),
    open: (Array.isArray(body?.open) ? body.open : []).slice(0, 50).map((x: unknown) => s(x, 200)),
    // 2.1.5: its request timings, whether it stopped reading, and (round 2) its allow-list state
    reqs: cleanReqs(body?.reqs), readStopped: cleanReadStopped(body?.readStopped), allowlist: cleanAllowlist(body?.allowlist) } };
}
// round 2 (migration-34): allowlist:{measured, hash} in the beat; anything else is not kept
function cleanAllowlist(x: any) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  return { measured: x.measured === true, hash: typeof x.hash === "string" ? x.hash.slice(0, 80) : "" };
}
// the bridges heard from, with this one brought up to date: at most 12, none silent for more than 60 days
function bridgesWith(info: any, id: string, entry: any) {
  const old = info?.bridges && typeof info.bridges === "object" ? info.bridges : {};
  const cut = Date.now() - 60 * 86400000;
  const kept = Object.entries({ ...old, [id]: entry }).filter(([, v]: any) => Date.parse(v?.at || "") > cut)
    .sort((a: any, b: any) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 12);
  return Object.fromEntries(kept);
}
// may this bridge post? Only the main one; with none chosen, any bridge not in test mode (as before)
function mayPost(dev: any, id: string) { return !dev?.main_bridge || dev.main_bridge === id; }

// FinCom Bridge 2.1.5's self-watch in its beat (plan item 10): the last request, the longest today (kind and
// milliseconds), how many took over 20 s and how many there were; and whether it stopped reading (by itself, or told to
// from FinCom). Known fields only, of the right kind, cut to length; anything else is not kept
function cleanReqs(r: any) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const s = (v: unknown, n: number) => typeof v === "string" ? v.slice(0, n) : "";
  const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v)) || 0));
  const one = (x: any) => x && typeof x === "object" && !Array.isArray(x) ? { kind: s(x.kind, 40), ms: int(x.ms, 3600000), at: s(x.at, 30) } : null;
  return { day: s(r.day, 10), last: one(r.last), longest: one(r.longest), over20: int(r.over20, 1e6), n: int(r.n, 1e9) };
}
function cleanReadStopped(x: any) {
  if (!x || typeof x !== "object" || !["self", "fincom"].includes(x.by)) return null;
  return { by: x.by as string, reason: typeof x.reason === "string" ? x.reason.slice(0, 300) : "", at: typeof x.at === "string" ? x.at.slice(0, 30) : "" };
}
const VERSION = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/;
const newer = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
// migration-35: what the beat tells this bridge about Stop reading / Resume (tally_read_stops) and the staged release
// (tally_bridge_releases), and the evidence of a pilot it records. out: added to the answer; info: added to the
// device's info (readStop for the app, readResumeSeen: the last resume passed to each bridge). Without the migration
// (its tables unknown), or if they cannot be read, nothing is said: the bridge keeps what it had
async function bridgeControl(dev: any, firm: string, me: { id: string; entry: any }, prevInfo: any) {
  const out: Record<string, unknown> = {}, info: Record<string, unknown> = {};
  try {
    const now = Date.now(), at = new Date(now).toISOString();
    const [st, rs, rl] = await Promise.all([
      db.from("tally_read_stops").select("id, device_id, reason, stopped_at").eq("firm_id", firm).eq("action", "stop").is("cleared_at", null),
      // a resume is passed on for a week (a computer off for longer reads again when it comes back only if it was not stopped)
      db.from("tally_read_stops").select("id, device_id, stopped_at").eq("firm_id", firm).eq("action", "resume").gt("stopped_at", new Date(now - 7 * 86400000).toISOString()),
      db.from("tally_bridge_releases").select("*").eq("firm_id", firm)]);
    const mine = (r: any) => !r?.device_id || r.device_id === dev.id;
    if (!st.error && !rs.error) {
      // the newest stop for this computer or for all of the firm's
      const live = (st.data || []).filter(mine).sort((a: any, b: any) => Number(b.id) - Number(a.id))[0];
      const readStop = live ? { by: "fincom", reason: String(live.reason || "").slice(0, 300), at: String(live.stopped_at || "") } : null;
      out.readStop = readStop; info.readStop = readStop;
      // Resume pressed since this bridge last heard: readResume once (each bridge on the computer once)
      const seenAll = prevInfo?.readResumeSeen && typeof prevInfo.readResumeSeen === "object" ? prevInfo.readResumeSeen : {};
      const top = Math.max(0, ...(rs.data || []).filter(mine).map((r: any) => Number(r.id) || 0));
      if (top > (Number(seenAll[me.id]) || 0)) {
        if (!readStop) out.readResume = true;       // stopped again since: the stop stands
        const keep = Object.entries({ ...seenAll, [me.id]: top }).sort((a: any, b: any) => b[1] - a[1]).slice(0, 20);
        info.readResumeSeen = Object.fromEntries(keep);
      }
    }
    const rows = rl.error ? [] : (rl.data || []).filter((r: any) => VERSION.test(String(r?.version || "")));
    if (rows.length) {
      // the newest version this computer may install: approved for all, or this computer is its pilot (started);
      // none allowed: the newest there is, not allowed
      const may = rows.filter((r: any) => r.approved_at || (r.pilot_device === dev.id && r.pilot_started_at));
      const pick = (may.length ? may : rows).slice().sort((a: any, b: any) => newer(b.version, a.version))[0];
      out.release = { version: pick.version, allowed: may.length > 0 };
      // the pilot computer beating on the version during its pilot: evidence for approval (at most one write each
      // 5 minutes), and a stop by itself on it (approval is then refused)
      const v = String(me.entry?.version || "");
      const pr = rows.find((r: any) => r.version === v && r.pilot_device === dev.id && r.pilot_started_at && !r.approved_at);
      if (pr) {
        const upd: Record<string, unknown> = {};
        if (!pr.pilot_seen_at || now - (Date.parse(pr.pilot_last_seen_at || "") || 0) >= 300000) {
          upd.pilot_last_seen_at = at; upd.pilot_beats = (Number(pr.pilot_beats) || 0) + 1;
          if (!pr.pilot_seen_at) upd.pilot_seen_at = at;
        }
        const self = me.entry?.readStopped;
        const since = Date.parse(self?.at || "");
        if (self?.by === "self" && !pr.pilot_self_stop && (isNaN(since) || since >= Date.parse(pr.pilot_started_at))) upd.pilot_self_stop = { reason: self.reason, at: self.at || at };
        // round 2 (migration-34): the pilot's allow-list state, whenever it changes (approval waits for measured)
        const al = me.entry?.allowlist;
        if (al && (pr.pilot_allowlist_measured !== al.measured || String(pr.pilot_allowlist_hash || "") !== al.hash)) { upd.pilot_allowlist_measured = al.measured; upd.pilot_allowlist_hash = al.hash; }
        if (Object.keys(upd).length) {
          const write = () => db.from("tally_bridge_releases").update(upd).eq("firm_id", firm).eq("version", v).eq("pilot_device", dev.id).is("approved_at", null);
          let { error } = await write();
          // a cloud with migration-35 but not 34 (no pilot_allowlist_* columns): the other evidence still written
          if (error && "pilot_allowlist_measured" in upd && /pilot_allowlist/i.test(error.message)) {
            delete upd.pilot_allowlist_measured; delete upd.pilot_allowlist_hash;
            if (Object.keys(upd).length) ({ error } = await write());
          }
          if (error) console.error("tally-ingest pilot evidence", error.message);
        }
      }
    }
  } catch (e) { console.error("tally-ingest bridge control", (e as Error).message); }
  return { out, info };
}
// a support pack (the bridge's log, or its install log) for FinCom support; readable only by the platform's admins
async function supportPack(firm: string, dev: any, body: any) {
  const zip = typeof body.zip === "string" ? b64bytes(body.zip) : new Uint8Array();
  if (!zip.length || zip.length > 9 * 1024 * 1024) return reply(413, { ok: false, error: "The support pack is empty or too large." });
  // at most five a day from one computer
  const today = new Date().toISOString().slice(0, 10);
  const { data: had } = await db.storage.from("tally-support").list(`${firm}/${dev.id}`, { limit: 100, search: today });
  if ((had || []).length >= 5) return reply(429, { ok: false, error: "This computer has sent five support packs today already; FinCom support has them." });
  const path = `${firm}/${dev.id}/${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  const up = await db.storage.from("tally-support").upload(path, zip, { contentType: "application/zip" });
  if (up.error) throw new Error("storage: " + up.error.message);
  console.log("tally-ingest support pack", path, String(body.note || "").slice(0, 200));
  return reply(200, { ok: true, path });
}
// a bridge makes itself the main one (its menu: Switch to main bridge): from now on the others on this key do not post
async function makeMain(dev: any, id: string) {
  if (id === "v1") return reply(400, { ok: false, error: "Only FinCom Bridge 2.x can be made the main bridge from its menu." });
  const { error } = await db.from("tally_devices").update({ main_bridge: id, main_set_at: new Date().toISOString(), main_set_by: null }).eq("id", dev.id);
  if (error) return reply(409, { ok: false, error: /main_bridge/.test(error.message) ? "FinCom's cloud is not ready to choose a main bridge yet (migration-22)." : error.message });
  console.log("tally-ingest: main bridge", dev.id, id);
  return reply(200, { ok: true, main: id });
}

// go-bridge: a call from FinCom Bridge 2.0.0 in test mode ("shadow"). It runs beside bridge 1.15.0 with the same computer
// key to be compared with it, so nothing it sends may change what 1.15.0 keeps:
//   - postings: never handed to it (only one bridge may ever post);
//   - heartbeat: noted apart (info.shadow), the device's own heartbeat, version and "Update now" left to 1.15.0;
//   - days: each compared with the day kept in the cloud (1.15.0's): same / differ / new; nothing stored;
//   - companies, ledgers, groups, state: answered, nothing stored.
async function shadowCall(dev: any, firm: string, body: any) {
  const kind = String(body.kind || "");
  if (kind === "posts_take" || kind === "posts_update") return reply(403, { ok: false, error: "A bridge in test mode does not post." });
  if (kind === "support") return await supportPack(firm, dev, body);
  if (kind === "make_main") return await makeMain(dev, bridgeOf(dev, body, true).id);
  if (kind === "hello") {
    const { data: f } = await db.from("firms").select("name").eq("id", firm).maybeSingle();
    return reply(200, { ok: true, firm: f?.name || "", device: dev.name, shadow: true });
  }
  if (kind === "beat") {
    const s = (v: unknown, n = 80) => typeof v === "string" ? v.slice(0, n) : "";
    const shadow = { at: new Date().toISOString(), version: s(body.version, 40), tally: !!body.tally, updating: !!body.updating,
      open: (Array.isArray(body.open) ? body.open : []).slice(0, 50).map((x: unknown) => s(x, 200)) };
    // read and written together, so 1.15.0's own heartbeat in between is not lost
    const { data: cur } = await db.from("tally_devices").select("info").eq("id", dev.id).maybeSingle();
    const prev = (cur?.info && typeof cur.info === "object") ? cur.info : {};
    const me = bridgeOf(dev, body, true);
    // migration-35: Stop reading / Resume / release apply to a bridge in test mode too
    const ctl = await bridgeControl(dev, firm, me, prev);
    // a bridge 2.0.0 in test mode sends no name of its own: it is kept in info.shadow only, never in bridge 1.15.0's place
    const info = me.id === "v1" ? { ...prev, ...ctl.info, shadow } : { ...prev, ...ctl.info, shadow, bridges: bridgesWith(prev, me.id, me.entry) };
    await db.from("tally_devices").update({ info }).eq("id", dev.id);
    const tok = dev.wake_token;
    const wake = tok ? { url: URL.replace(/^http/, "ws").replace(/\/+$/, "") + "/realtime/v1/websocket", key: ANON, topic: "tb-" + tok } : null;
    // made the main bridge on FinCom's Tally page: the bridge switches itself over (and 1.15.0 is refused postings already)
    return reply(200, { ok: true, updateNow: false, posts: 0, wake, shadow: true, makeMain: me.id !== "v1" && dev.main_bridge === me.id, ...ctl.out });
  }
  if (kind === "companies") {
    const { data: have } = await db.from("tally_companies").select("company, client_id").eq("firm_id", firm);
    const linked = new Map((have || []).map((r: any) => [r.company, !!r.client_id]));
    const links: Record<string, boolean> = {};
    for (const c of (Array.isArray(body.companies) ? body.companies : []).slice(0, 200)) { const n = String(c?.name || "").trim(); if (n) links[n] = !!linked.get(n); }
    return reply(200, { ok: true, links, shadow: true });
  }
  const book = await bookFor(firm, String(body.company || ""));
  if (!book) return reply(409, { ok: false, notLinked: true, error: "This Tally company is not linked to a FinCom client yet." });
  if (kind === "days") {
    const done: string[] = [], same: string[] = [], differ: string[] = [], fresh: string[] = [], bad: { day: string; error: string }[] = [];
    for (const d of (Array.isArray(body.days) ? body.days : []).slice(0, 62) as any[]) {
      if (!isDay(d?.day)) continue;
      let text = "";
      try {
        if (typeof d.b64 === "string") text = new TextDecoder("utf-8").decode(b64bytes(d.b64));
        else text = (await gunzip(b64bytes(d.gz), MAX_DAY)).text;
      } catch (e) { bad.push({ day: d.day, error: String((e as Error)?.message || e).slice(0, 200) }); continue; }
      done.push(d.day);
      const { data: blob } = await db.storage.from("tally-days").download(`${firm}/${book}/${d.day.slice(0, 6)}/${d.day}.xml.gz`);
      if (!blob) { fresh.push(d.day); continue; }
      const kept = (await gunzip(new Uint8Array(await blob.arrayBuffer()), MAX_DAY)).text;
      (kept === text ? same : differ).push(d.day);
    }
    if (differ.length) console.log("tally-ingest shadow: days differ from the kept copy", book, differ.slice(0, 10).join(","));
    return reply(200, { ok: true, done, bad, same, differ, new: fresh, shadow: true });
  }
  return reply(200, { ok: true, shadow: true });
}
// go-bridge: the connection history of a computer for the last 24 hours (FinCom: Settings, Tally Bridge), worked out from
// its heartbeats: a gap of three missed beats or more (the bridge offline from - to), each change of Tally's state
// (open / busy / closed), and the companies opened and closed in Tally. Kept in tally_devices.info (no table of its own)
function beatHistory(prev: any, beat: any) {
  const now = Date.parse(beat.at), day = 24 * 3600 * 1000;
  const h = (Array.isArray(prev.history) ? prev.history : []).filter((e: any) => e && Date.parse(e.to || e.at) > now - day);
  const last = prev.beat && typeof prev.beat === "object" ? prev.beat : null;
  if (!last || !last.at) h.push({ kind: "bridge", state: "online", at: beat.at });
  else {
    const every = Math.max(10, Math.min(600, Number(last.every) || 60)) * 1000;
    if (now - Date.parse(last.at) > 3 * every + 30000) h.push({ kind: "bridge", state: "offline", at: last.at, to: beat.at });
    const was = last.tallyState || (last.tally ? "open" : "closed");
    if (was !== beat.tallyState) h.push({ kind: "tally", state: beat.tallyState, at: beat.at, was });
    const before = new Set(Array.isArray(last.open) ? last.open : []), nowOpen = new Set(beat.open);
    for (const c of nowOpen) if (!before.has(c)) h.push({ kind: "company", state: "open", name: c, at: beat.at });
    for (const c of before) if (!nowOpen.has(c)) h.push({ kind: "company", state: "closed", name: c, at: beat.at });
  }
  return h.slice(-300);
}
async function bookFor(firm: string, company: string) {
  const { data, error } = await db.rpc("tally_book_for", { p_firm: firm, p_company: company });
  if (error) throw new Error(error.message);
  return data as string | null;
}

// a day's entries and lines as tally_ingest_day takes them. Ledger and party names are cleaned (migration-23: no line
// breaks; other spaces kept as Tally has them), as the masters are, so an entry meets its ledger's opening in every report
const dayVouchers = (r: any) => r.vouchers.map((v: any) => ({ guid: v.guid, alter: v.alter, type: v.type, no: v.no, party: cleanName(v.party), narr: v.narr, cancel: v.cancel, opt: v.opt, gstin: v.gstin, pos: v.pos, ref: v.ref, refDate: v.refDate, cmp: v.cmp, fid: v.fid ?? null }));   // fid (migration 37): the TDSDesk id from the full narration
const dayLines = (r: any) => r.lines.map((l: any[]) => [l[0], cleanName(l[1]), ...l.slice(2)]);
// a list of [name, parent] (ledgers or groups) with the names cleaned (migration-23); "Primary" as a parent is none. Two
// that are one once cleaned are kept once: the one with a parent, else the one already clean
function cleanPairs(list: unknown, max: number) {
  const by = new Map<string, { n: string; p: string; clean: boolean }>();
  for (const x of (Array.isArray(list) ? list : []).slice(0, max) as any[]) {
    const raw = String(x?.[0] || "").slice(0, 300), n = cleanName(raw), p = cleanName(String(x?.[1] || "").slice(0, 300)).replace(/^\W*Primary$/i, "");
    if (!n) continue;
    const had = by.get(n), clean = raw === n;
    if (!had || (!had.p && p) || (!!had.p === !!p && clean && !had.clean)) by.set(n, { n, p, clean });
  }
  return Array.from(by.values()).map((x) => [x.n, x.p]);
}
// FinCom Bridge 2.1.4 (rebuilt): the lease on a company and the rewind guard (migration-32-sync-safety). A cloud without
// the migration answers as before: no lease (the bridge goes on as it did), no guard
const notReady = (m: string) => /tally_lease|tally_sync_guard|does not exist|schema cache/i.test(m);
async function bridgeSafety(dev: any, firm: string, body: any) {
  const book = await bookFor(firm, String(body.company || ""));
  if (!book) return reply(409, { ok: false, notLinked: true, error: "This Tally company is not linked to a FinCom client yet." });
  const me = bridgeOf(dev, body, false);
  if (body.kind === "lease_take") {
    const ttl = Math.max(30, Math.min(900, Math.floor(Number(body.ttl) || 120)));
    const { data, error } = await db.rpc("tally_lease_take", { p_firm: firm, p_book: book, p_holder: me.id, p_device: dev.id, p_ttl: ttl,
      p_info: { computer: me.entry.computer, user: me.entry.user, version: me.entry.version } });
    if (error) return notReady(error.message) ? reply(200, { ok: true, noLease: true }) : reply(500, { ok: false, error: error.message });
    return reply(200, data);
  }
  if (body.kind === "lease_release") {
    const { data, error } = await db.rpc("tally_lease_release", { p_firm: firm, p_book: book, p_holder: me.id });
    if (error) return notReady(error.message) ? reply(200, { ok: true, noLease: true }) : reply(500, { ok: false, error: error.message });
    return reply(200, data);
  }
  // read_guard
  const n = (v: unknown) => v == null || v === "" || isNaN(Number(v)) ? null : Math.max(0, Math.floor(Number(v)));
  const { data, error } = await db.rpc("tally_sync_guard", { p_firm: firm, p_book: book, p_guid: String(body.guid || "").slice(0, 100) || null,
    p_alter: n(body.alter), p_count: n(body.count), p_device: dev.id, p_bridge: me.id });
  if (error) return notReady(error.message) ? reply(200, { ok: true, state: "ok", noGuard: true }) : reply(500, { ok: false, error: error.message });
  return reply(200, data);
}
// FinCom Bridge 2.1.4 (02-Oct-2026): the plain ledger list read by Update now (and after a posting with a new ledger,
// and when a bill's ledger chooser asks for it). Applied without removing anything and without touching entries:
//   rows [guid, masterId, alterId, name, group, storedOpening, gstin, pan, openingChanged]: a ledger not in the copy is
//     added with its stored opening; one there (by its Tally GUID, else by name) takes its group, GSTIN, PAN, GUID and
//     AlterID; its opening only when Tally's stored opening changed since the bridge last read it (openingChanged)
//   renamed [guid, from, to]: the row renamed (found by GUID, else by the old name), the old name kept in before_clean
//     (migration-31: {renamed: [{from, at}]}); the row's entries take the new name when the bridge sends their days
//     again. A row with the new name already there: the old row is marked deleted, the other takes the GUID
//   seen [guid]: the GUIDs the bridge read in this batch (migration-34): counted on the round first, stamped on the rows
//     after the upsert (migration-36: so a first round stamps rows that had no GUID yet); on the last batch the cloud
//     marks the live rows with a GUID the round did not see (tally_ledgers_mark_gone), never removed
//   deleted [guid, name]: ignored for marking (counted in deletedIgnored; a bridge before the seen contract)
//   groups [name, parent]: upserted (none removed)
// Without migration-32 (no tally_guid / deleted_at): renames by name, nothing fails. Without migration-34: nothing
// is marked, said in the notes. Without migration-31: renames without the history.
const ledgerListAt = new Map<string, number[]>();
function ledgerListAllowed(devId: string) {
  const now = Date.now(), had = (ledgerListAt.get(devId) || []).filter((t) => now - t < 60000);
  if (had.length >= 60) { ledgerListAt.set(devId, had); return false; }
  had.push(now); ledgerListAt.set(devId, had);
  return true;
}
const colCache = new Map<string, { ok: boolean; at: number }>();
async function hasCols(table: string, cols: string) {
  const k = table + ":" + cols, c = colCache.get(k);
  if (c && Date.now() - c.at < 300000) return c.ok;
  const { error } = await db.from(table).select(cols).limit(1);
  const ok = !error;
  colCache.set(k, { ok, at: Date.now() });
  return ok;
}
async function selectIn(cols: string, book: string, field: string, vals: string[]) {
  const out: any[] = [];
  for (let i = 0; i < vals.length; i += 150) {
    const { data, error } = await db.from("tally_ledgers").select(cols).eq("book_id", book).in(field, vals.slice(i, i + 150));
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return out;
}
async function applyLedgerList(firm: string, book: string, body: any, dev?: any, me?: { id: string; entry: any }) {
  const s = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const m32 = await hasCols("tally_ledgers", "tally_guid, alter_id, deleted_at");
  const m31 = await hasCols("tally_ledgers", "before_clean");
  const m28 = await hasCols("tally_ledgers", "gstin, pan");
  const m40 = await hasCols("tally_ledgers", "state");            // migration 40: Tally's LEDSTATENAME (the bridge's 10th column)
  const notes: string[] = [];
  const out = { ok: true, ledgers: 0, added: 0, renamed: 0, deleted: 0, deletesHeld: 0, deletedIgnored: 0, groups: 0, round: "", notes };
  const now = new Date().toISOString();
  const cols = "name, parent" + (m32 ? ", tally_guid, deleted_at" : "") + (m31 ? ", before_clean" : "");
  // the rows: one per clean name
  const seen = new Set<string>();
  const rows = (Array.isArray(body.ledgers) ? body.ledgers : []).slice(0, 5000).map((l: any) => ({
    guid: s(l?.[0], 100).trim(), alter: Math.max(0, Math.floor(Number(l?.[2]) || 0)), name: cleanName(s(l?.[3], 300)),
    parent: cleanName(s(l?.[4], 300)).replace(/^\W*Primary$/i, ""), open: Math.round(amt(l?.[5]) * 100) / 100,
    gstin: s(l?.[6], 15).trim().toUpperCase(), pan: s(l?.[7], 10).trim().toUpperCase(), oc: !!Number(l?.[8]), state: s(l?.[9], 60).trim() }))
    .filter((r: any) => r.name && !seen.has(r.name) && seen.add(r.name));
  out.ledgers = rows.length;
  // 0. migration-34: this call is one batch of a read of the whole list (round); the bridge says whether the read is
  // complete, how many GUIDs it read in the round (rowsRead) and which it read in this batch (seen, passed as sent:
  // the cloud adds the batches up against rowsRead). The batch is recorded first; the answer tells whether
  // migration-34 is there (m34): then renames go through its function, never direct updates
  const round = s(body.round, 80).trim();
  const complete = body.complete === true;
  const rowsRead = body.rowsRead === null || body.rowsRead === undefined || body.rowsRead === "" || !Number.isFinite(Number(body.rowsRead)) ? null : Math.max(0, Math.floor(Number(body.rowsRead)));
  const seenIn = (Array.isArray(body.seen) ? body.seen : []).slice(0, 50000).map((g: any) => s(g, 100).trim());
  let m34: boolean | null = null;
  const missing34 = (e: any) => !!e && /could not find|does not exist|schema cache|tally_ledger_round_batch|tally_ledgers_mark_gone|tally_ledger_rename/i.test(String(e.message || ""));
  if (round) {
    const { error } = await db.rpc("tally_ledger_round_batch", { p_book: book, p_round: round, p_rows: rows.length, p_rows_read: rowsRead, p_complete: complete, p_device: dev?.id ?? null, p_bridge: me?.id ?? null, p_seen: seenIn });
    if (error && missing34(error)) { m34 = false; notes.push("round not recorded: migration-34 (tally_ledger_rounds) is not applied"); }
    else if (error) throw new Error(error.message);
    else { m34 = true; out.round = round; }
  }
  // 1. groups (added or changed; none removed), and every group's parent for the chains
  const grpIn = cleanPairs(body.groups, 20000);
  for (let i = 0; i < grpIn.length; i += 1000) {
    const { error } = await db.from("tally_groups").upsert(grpIn.slice(i, i + 1000).map((g: any) => ({ book_id: book, firm_id: firm, name: g[0], parent: g[1] })), { onConflict: "book_id,name" });
    if (error) throw new Error(error.message);
  }
  out.groups = grpIn.length;
  const { data: allG, error: eg } = await db.from("tally_groups").select("name, parent").eq("book_id", book);
  if (eg) throw new Error(eg.message);
  // group names met whatever their capitals (Tally names the group "Cash-in-hand"; migration-33)
  const up = new Map((allG || []).map((g: any) => [String(g.name).toLowerCase(), g.parent || ""]));
  const chain = (p: string) => { const c: string[] = []; while (p && c.length < 30 && !c.some((x) => x.toLowerCase() === p.toLowerCase())) { c.push(p); p = up.get(p.toLowerCase()) || ""; } return c; };
  // a row renamed (or, the new name being taken by another row, marked deleted and its GUID left to that row)
  const history = (row: any, entry: Record<string, unknown>) => {
    const b = row?.before_clean && typeof row.before_clean === "object" ? row.before_clean : {};
    return { ...b, renamed: [...(Array.isArray(b.renamed) ? b.renamed : []), entry].slice(-20) };
  };
  const rename = async (guid: string, from: string, to: string) => {
    // migration-34: by GUID in SQL (refused with a note when the new name is another GUID's; merged when it is a row
    // with no GUID, the guard keeping a row with entries); the old way only on a cloud without it
    if (m34 !== false) {
      const { data, error } = await db.rpc("tally_ledger_rename", { p_book: book, p_guid: guid || null, p_from: from, p_to: to });
      if (!error) {
        m34 = true;
        if (data?.renamed || data?.merged) out.renamed++;
        if (data?.refused || data?.merged) notes.push(String(data.note || "").slice(0, 300));
        return;
      }
      if (/trial balance|rolled back/i.test(String(error.message || ""))) {
        // migration-36: the rename was rolled back (the trial balance would not tie, or the book's does not); said,
        // the batch goes on, and the next round asks again (the GUID is still under the old name)
        notes.push(("rename " + from + " -> " + to + " not made: " + String(error.message || "")).slice(0, 300));
        console.log("tally-ingest ledger_list: rename rolled back", book, from, "->", to, String(error.message || "").slice(0, 200));
        return;
      }
      if (!missing34(error)) throw new Error(error.message);
      m34 = false;
    }
    let row: any = null;
    if (m32 && guid) row = (await selectIn(cols, book, "tally_guid", [guid]))[0] || null;
    if (!row && from) row = (await selectIn(cols, book, "name", [from])).find((r: any) => !m32 || !r.tally_guid || r.tally_guid === guid) || null;
    if (!row || row.name === to) return;
    const other = (await selectIn(cols, book, "name", [to]))[0];
    if (other) {
      if (!m32 || (other.tally_guid && other.tally_guid !== guid)) { notes.push("rename " + row.name + " -> " + to + ": that name is another ledger's; left"); return; }
      const upd: Record<string, unknown> = { deleted_at: now, tally_guid: null };
      if (m31) upd.before_clean = history(row, { from: row.name, to, at: now, merged: true, guid });
      const { error } = await db.from("tally_ledgers").update(upd).eq("book_id", book).eq("name", row.name);
      if (error) throw new Error(error.message);
    } else {
      const upd: Record<string, unknown> = { name: to };
      if (m31) upd.before_clean = history(row, { from: row.name, at: now });
      const { error } = await db.from("tally_ledgers").update(upd).eq("book_id", book).eq("name", row.name);
      if (error) throw new Error(error.message);
    }
    out.renamed++;
  };
  // 2. renames first, so the rows below meet their ledger under its new name
  const ren = (Array.isArray(body.renamed) ? body.renamed : []).slice(0, 5000)
    .map((x: any) => ({ guid: s(x?.[0], 100).trim(), from: cleanName(s(x?.[1], 300)), to: cleanName(s(x?.[2], 300)) })).filter((r: any) => r.from && r.to && r.from !== r.to);
  for (const r of ren) await rename(r.guid, r.from, r.to);
  // 3. the rows (made above)
  if (m32) {
    // a GUID the copy holds under another name: a rename the bridge did not send (its first list, or an older copy)
    const byGuid = await selectIn(cols, book, "tally_guid", rows.map((r: any) => r.guid).filter(Boolean));
    const want = new Map(rows.map((r: any) => [r.guid, r.name]));
    for (const g of byGuid) if (want.get(g.tally_guid) && want.get(g.tally_guid) !== g.name) await rename(g.tally_guid, g.name, want.get(g.tally_guid) as string);
  }
  // a GUID still held by another row (a rename that could not be made): not given to a second row
  const owner = new Map<string, string>(m32 ? (await selectIn(cols, book, "tally_guid", rows.map((r: any) => r.guid).filter(Boolean))).map((g: any) => [g.tally_guid, g.name]) : []);
  const have = new Map((await selectIn(cols, book, "name", rows.map((r: any) => r.name))).map((r: any) => [r.name, r]));
  const base = (r: any) => {
    const c = chain(r.parent);
    const o: Record<string, unknown> = { book_id: book, firm_id: firm, name: r.name, parent: r.parent, chain: c, primary_group: c.length ? c[c.length - 1] : "" };
    if (m28) { o.gstin = r.gstin || null; o.pan = r.pan || null; }
    if (m40 && r.state) o.state = r.state;      // absent or empty: left as it is
    if (m32) { o.tally_guid = r.guid && (!owner.has(r.guid) || owner.get(r.guid) === r.name) ? r.guid : null; o.alter_id = r.alter; o.deleted_at = null; }
    return o;
  };
  const fresh = rows.filter((r: any) => !have.has(r.name)).map((r: any) => ({ ...base(r), open: r.open, open_sent: r.open }));
  const opened = rows.filter((r: any) => have.has(r.name) && r.oc).map((r: any) => ({ ...base(r), open: r.open, open_sent: r.open }));
  const plain = rows.filter((r: any) => have.has(r.name) && !r.oc).map(base);
  for (const set of [fresh, opened, plain]) {
    for (let i = 0; i < set.length; i += 1000) {
      const { error } = await db.from("tally_ledgers").upsert(set.slice(i, i + 1000), { onConflict: "book_id,name" });
      if (error) throw new Error(error.message);
    }
  }
  out.added = fresh.length;
  // 3b. migration-36: the GUIDs this batch read are stamped on the rows NOW, after the upsert (which gave a row its GUID
  // when it had none): a first round on a copy whose rows had no GUID yet stamps every row, so the last batch's
  // tally_ledgers_mark_gone finds nothing unseen and logs no 'held' burst. Before 36, tally_ledger_round_batch stamped
  // before the upsert and missed them all. A cloud with 34 but not 36: the batch stamped as before, said in the notes
  if (round && m34 !== false && seenIn.length) {
    const { error } = await db.rpc("tally_ledger_round_seen", { p_book: book, p_round: round, p_seen: seenIn });
    if (error && /tally_ledger_round_seen|could not find|does not exist|schema cache/i.test(String(error.message || ""))) notes.push("seen stamped by the batch before the upsert: migration-36 (tally_ledger_round_seen) is not applied");
    else if (error) throw new Error(error.message);
  }
  // 4. deletions: marked, never removed, and only by tally_ledgers_mark_gone(book, round) on the last batch of a round
  // (migration-34): the cloud marks the live ledgers with a GUID the round did not see, when the round is complete and
  // every batch arrived, within the bulk limit, each row past the guard. The bridge's deleted list is ignored for
  // marking (an older bridge, or sent alongside): counted and said. Without migration-34, or with no round id (a
  // bridge before 2.1.5), nothing is marked; the next complete round decides by itself
  const del = (Array.isArray(body.deleted) ? body.deleted : []).slice(0, 50000);
  if (del.length) {
    out.deletedIgnored = del.length;
    notes.push("the deleted list (" + del.length + ") is ignored: marking goes by the GUIDs the round saw");
    console.log("tally-ingest ledger_list: deleted list ignored", book, del.length);
  }
  const noMark = (why: string) => { notes.push("nothing marked: " + why); console.log("tally-ingest ledger_list: nothing marked", book, why); };
  if (m34 === false) noMark("migration-34 not applied (tally_ledgers_mark_gone)");
  else if (!round) noMark("the bridge sent no round id (bridge before 2.1.5)");
  else if (body.last === true) {
    const { data, error } = await db.rpc("tally_ledgers_mark_gone", { p_book: book, p_round: round });
    if (error && missing34(error)) { m34 = false; noMark("migration-34 not applied (tally_ledgers_mark_gone)"); }
    else if (error) throw new Error(error.message);
    else {
      out.deleted = Math.max(0, Math.floor(Number(data?.marked) || 0));
      out.deletesHeld = Math.max(0, Math.floor(Number(data?.held) || 0));
      if (data?.note) notes.push("round " + round + ": " + String(data.note).slice(0, 300));
    }
  }
  // 5. the year's openings worked out again (a ledger added, an opening or a group changed)
  if (fresh.length || opened.length || body.last) {
    const { error } = await db.rpc("tally_year_openings", { p_book: book });
    if (error) notes.push("year openings: " + error.message);
  }
  if (!m31 && out.renamed) notes.push("renamed without the old name kept: migration-31 (before_clean) is not applied");
  console.log("tally-ingest ledger_list", book, JSON.stringify({ ...out, notes: notes.slice(0, 5) }));
  return reply(200, out);
}
// a few days of the day book (each gzipped), into a book: stored, and read into entries, lines and ready totals
async function ingestDays(firm: string, book: string, daysIn: unknown) {
  const r = await ingestDaysRaw(firm, book, daysIn);
  return r.error ? reply(400, { ok: false, error: r.error }) : reply(200, { ok: true, done: r.done, bad: r.bad });
}
async function ingestDaysRaw(firm: string, book: string, daysIn: unknown): Promise<{ done: string[]; bad: { day: string; error: string }[]; error?: string }> {
  const days = (Array.isArray(daysIn) ? daysIn : []).slice(0, 62);
  const done: string[] = [];
  let unzipped = 0;
  const bad: { day: string; error: string }[] = [];
  for (const d of days as any[]) {
    if (!isDay(d?.day) || (typeof d?.gz !== "string" && typeof d?.b64 !== "string")) continue;
    // a day sent as text (b64, the bridge from 1.14.0) is packed here; one sent packed (gz) is opened to be read
    let gz: Uint8Array, z: { text: string; size: number };
    try {
      if (typeof d.b64 === "string") {
        const raw = b64bytes(d.b64);
        if (raw.length > Math.min(MAX_DAY, MAX_UNZIP - unzipped)) throw new Error("A day's day book is larger than FinCom takes in one go.");
        z = { text: new TextDecoder("utf-8").decode(raw), size: raw.length };
        gz = await gzipBytes(raw);
      } else {
        gz = b64bytes(d.gz);
        z = await gunzip(gz, Math.min(MAX_DAY, MAX_UNZIP - unzipped));
      }
    } catch (e) { bad.push({ day: d.day, error: String((e as Error)?.message || e).slice(0, 200) }); continue; }
    unzipped += z.size;
    const r = parseDay(z.text);
    // every entry of a day is dated that day; anything else means the file is not what it says
    if (r.dates.some((x: string) => x !== d.day)) return { done, bad, error: "The day book for " + d.day + " has entries of other dates (" + r.dates.filter((x: string) => x !== d.day).slice(0, 3).join(", ") + ")." };
    const path = `${firm}/${book}/${d.day.slice(0, 6)}/${d.day}.xml.gz`;
    const up = await db.storage.from("tally-days").upload(path, gz, { upsert: true, contentType: "application/gzip" });
    if (up.error) throw new Error("storage: " + up.error.message);
    // migration 39: the bridge says when it positively read the day and Tally listed no entries (empty: true): the cloud
    // then marks the day's entries deleted; without the flag an empty file is a short read (nothing marked, migration 38).
    // A cloud without 39 has no p_empty: the 7-argument call as before
    const dayArgs = { p_book: book, p_day: iso(d.day), p_vouchers: dayVouchers(r), p_lines: dayLines(r), p_n: r.n, p_alter: r.alterMax, p_bytes: gz.length };
    let { data: dayAns, error } = d.empty === true ? await db.rpc("tally_ingest_day", { ...dayArgs, p_empty: true }) : await db.rpc("tally_ingest_day", dayArgs);
    if (error && d.empty === true && /p_empty|could not find|does not exist|schema cache/i.test(String(error.message || ""))) ({ data: dayAns, error } = await db.rpc("tally_ingest_day", dayArgs));
    if (error) throw new Error(error.message);
    if ((dayAns as any)?.empty) console.log("tally-ingest day empty (the bridge vouched for it): " + String((dayAns as any).marked || 0) + " marked deleted", book, d.day);
    // migration 38 (item 9): a short read (no entries, or fewer than the bridge counted) upserted what came and marked nothing; said in the log
    if ((dayAns as any)?.refused) console.log("tally-ingest day " + String((dayAns as any).refused) + ": nothing marked deleted", book, String((dayAns as any).day || ""));
    done.push(d.day);
  }
  return { done, bad };
}
// the day books already kept in the bucket, read again with today's parser: one month a call (a year is 12 calls), so
// no call runs long. Nothing is asked of the computer with Tally; the files are the ones it sent
async function reparseMonth(firm: string, book: string, monthIn: unknown) {
  return reply(200, { ok: true, ...(await reparseMonthRaw(firm, book, monthIn)) });
}
async function keptMonths(firm: string, book: string) {
  const { data: months, error } = await db.storage.from("tally-days").list(`${firm}/${book}`, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error("storage: " + error.message);
  return (months || []).map((m: any) => String(m.name)).filter((m: string) => /^\d{6}$/.test(m)).sort();
}
async function reparseMonthRaw(firm: string, book: string, monthIn: unknown) {
  const base = `${firm}/${book}`;
  const { data: months, error: e1 } = await db.storage.from("tally-days").list(base, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  if (e1) throw new Error("storage: " + e1.message);
  const all = (months || []).map((m: any) => String(m.name)).filter((m: string) => /^\d{6}$/.test(m)).sort();
  const month = /^\d{6}$/.test(String(monthIn || "")) ? String(monthIn) : all[0];
  if (!month) return { done: [] as string[], bad: [] as { day: string; error: string }[], next: null, months: 0 };
  const { data: files, error: e2 } = await db.storage.from("tally-days").list(`${base}/${month}`, { limit: 100, sortBy: { column: "name", order: "asc" } });
  if (e2) throw new Error("storage: " + e2.message);
  const done: string[] = [], bad: { day: string; error: string }[] = [];
  for (const f of files || []) {
    const day = String(f.name).slice(0, 8);
    if (!isDay(day) || !/\.xml\.gz$/.test(f.name)) continue;
    const { data: blob, error: e3 } = await db.storage.from("tally-days").download(`${base}/${month}/${f.name}`);
    if (e3 || !blob) { bad.push({ day, error: "could not read the kept file" }); continue; }
    const gz = new Uint8Array(await blob.arrayBuffer());
    let z: { text: string; size: number };
    try { z = await gunzip(gz, MAX_DAY); } catch (e) { bad.push({ day, error: String((e as Error)?.message || e).slice(0, 200) }); continue; }
    const r = parseDay(z.text);
    if (r.dates.some((x: string) => x !== day)) { bad.push({ day, error: "entries of other dates" }); continue; }
    const { data: dayAns, error } = await db.rpc("tally_ingest_day", { p_book: book, p_day: iso(day),
      p_vouchers: dayVouchers(r), p_lines: dayLines(r), p_n: r.n, p_alter: r.alterMax, p_bytes: gz.length });
    if (error) throw new Error(error.message);
    // migration 38 (item 9): a short read (no entries, or fewer than the bridge counted) upserted what came and marked nothing; said in the log
    if ((dayAns as any)?.refused) console.log("tally-ingest day " + String((dayAns as any).refused) + ": nothing marked deleted", book, String((dayAns as any).day || ""));
    done.push(day);
  }
  const next = all.find((m: string) => m > month) || null;
  return { month, done, bad, next, months: all.length };
}
// review of 01-Oct-2026: each ledger's group and Tally's groups, kept without touching openings or entries; each ledger's
// chain up to its primary group is worked out here. A ledger not in the copy yet is added with a nil opening
async function applyGroups(firm: string, book: string, ledIn: unknown, grpIn: unknown) {
  const groups = cleanPairs(grpIn, 20000), leds = cleanPairs(ledIn, 100000);
  for (let i = 0; i < groups.length; i += 1000) {
    const { error } = await db.from("tally_groups").upsert(groups.slice(i, i + 1000).map((g: any) => ({ book_id: book, firm_id: firm, name: g[0], parent: g[1] })), { onConflict: "book_id,name" });
    if (error) throw new Error(error.message);
  }
  const { data: allG, error: eg } = await db.from("tally_groups").select("name, parent").eq("book_id", book);
  if (eg) throw new Error(eg.message);
  // group names met whatever their capitals (migration-33)
  const up = new Map((allG || []).map((g: any) => [String(g.name).toLowerCase(), g.parent || ""]));
  const chain = (p: string) => { const out: string[] = []; while (p && out.length < 30 && !out.some((x) => x.toLowerCase() === p.toLowerCase())) { out.push(p); p = up.get(p.toLowerCase()) || ""; } return out; };
  for (let i = 0; i < leds.length; i += 1000) {
    const rows = leds.slice(i, i + 1000).map((l: any) => { const c = chain(l[1]); return { book_id: book, firm_id: firm, name: l[0], parent: l[1], chain: c, primary_group: c.length ? c[c.length - 1] : "" }; });
    const { error } = await db.from("tally_ledgers").upsert(rows, { onConflict: "book_id,name" });
    if (error) throw new Error(error.message);
  }
  const { error: eo } = await db.rpc("tally_year_openings", { p_book: book });
  if (eo) throw new Error(eo.message);
  return { ledgers: leds.length, groups: groups.length };
}
// who sent a full list (migration-33 keeps it with each ledger the list marks deleted): the bridge's computer, or the
// person who uploaded the file
type ListFrom = { source: string; by?: string; device?: string; bridge?: string; computer?: string; user?: string; file?: string };
// declare (migration-34): the sender says the list is complete and how many ledgers it holds; only then may the list mark
// the ledgers missing from it. The bridge's trial-balance list ("ledgers") never declares it
async function ingestLedgers(book: string, body: any, firm?: string, from?: ListFrom, declare?: { complete: boolean; count: number | null }) {
  if (!isDay(body.from) || !isDay(body.openAsOn)) return reply(400, { ok: false, error: "from and openAsOn are dates (yyyymmdd)" });
  // review of 01-Oct-2026: a copy that starts later than the book's own (the bridge keeping 2026-27 where the year 2025-26
  // came from files) must not move the book's start: that would take away the earlier entries. The groups are kept;
  // the openings and entries stay as they are
  const { data: bk } = await db.from("tally_books").select("from_date, firm_id").eq("book_id", book).maybeSingle();
  if (bk && bk.from_date && iso(body.from) > String(bk.from_date)) {
    const { count } = await db.from("tally_vouchers").select("guid", { count: "exact", head: true }).eq("book_id", book).lt("day", iso(body.from));
    if ((count || 0) > 0) {
      const g = await applyGroups(String(firm || bk.firm_id), book, (Array.isArray(body.ledgers) ? body.ledgers : []).map((l: any) => [l?.[0], l?.[1]]), body.groups);
      console.log("tally-ingest ledgers kept", book, body.from, "book from", bk.from_date, count);
      return reply(200, { ok: true, ...g, kept: "the copy in the cloud starts on " + bk.from_date + " and has " + count + " entries before " + iso(body.from) + ": its openings and entries are kept; the groups are taken" });
    }
  }
  // the names cleaned (migration-23); the same name sent twice is taken once. Two masters that are one once cleaned both go
  // (tally_ingest_ledgers adds their openings into one ledger)
  const seen = new Set<string>();
  const led = (Array.isArray(body.ledgers) ? body.ledgers : []).slice(0, 100000)
    .map((l: any) => [String(l?.[0] || "").slice(0, 300), String(l?.[1] || "").slice(0, 300), String(Math.round(amt(l?.[2]) * 100) / 100)])
    .filter((l: any) => l[0] && !seen.has(l[0]) && seen.add(l[0])).map((l: any) => [cleanName(l[0]), cleanName(l[1]), l[2]]).filter((l: any) => l[0]);
  // the groups (bridge 1.14.7 on): [[name, parent]]; a primary group's parent is empty. Without them the groups kept
  // before stay as they are
  const groups = cleanPairs(body.groups, 20000);
  // migration-33: the list is add-only (a ledger missing from it marked deleted, never removed) and kept with who sent it;
  // a cloud without migration-33 takes the call without p_list
  const args = { p_book: book, p_from: iso(body.from), p_open_as_on: iso(body.openAsOn), p_ledgers: led, p_groups: groups };
  const list = { source: "full list", ...(from || {}), file: from?.file || (typeof body.file === "string" ? body.file.slice(0, 200) : undefined) };
  // migration-34: a list declared complete goes with p_complete and p_count (a cloud without 34 takes it undeclared: nothing marked)
  let data: any = null, error: any = null;
  if (declare?.complete) ({ data, error } = await db.rpc("tally_ingest_ledgers_g", { ...args, p_list: list, p_complete: true, p_count: declare.count }));
  if (!declare?.complete || (error && /p_complete|p_count|tally_ingest_ledgers_g|could not find|does not exist|schema cache/i.test(error.message))) ({ data, error } = await db.rpc("tally_ingest_ledgers_g", { ...args, p_list: list }));
  if (error && /p_list|tally_ingest_ledgers_g|could not find|does not exist|schema cache/i.test(error.message)) ({ data, error } = await db.rpc("tally_ingest_ledgers_g", args));
  if (error) throw new Error(error.message);
  // FinCom Bridge 2.1.2 on: each ledger's GSTIN and PAN ([name, group, opening, gstin, pan]), for matching a bill's supplier
  // to its ledger (migration-28; an older cloud without it just leaves them out)
  const ids = (Array.isArray(body.ledgers) ? body.ledgers : []).slice(0, 100000)
    .filter((l: any) => Array.isArray(l) && l[0] && (l[3] || l[4]))
    .map((l: any) => [cleanName(String(l[0]).slice(0, 300)), String(l[3] || "").toUpperCase().slice(0, 15), String(l[4] || "").toUpperCase().slice(0, 10)]);
  let idsOut: any = null;
  if (ids.length) {
    const r = await db.rpc("tally_ingest_ledger_ids", { p_book: book, p_ids: ids });
    idsOut = r.error ? { idsError: /tally_ingest_ledger_ids|does not exist|schema cache/i.test(r.error.message) ? "migration-28 not applied" : r.error.message } : { ids: r.data?.ids };
  }
  return reply(200, { ok: true, ...data, ...(idsOut || {}) });
}
// ---------- fast-sync (migration-13): the work done by the server, from a queue (pgmq tally_work), so it finishes even
// when the browser that handed it over is closed. A piece is {job, firm, book, days:[{day, gz}]} (a part of a day book)
// or {job, firm, book, month} (a month of the kept day books read again). A piece that fails is seen again after its
// time is up (VT seconds) and tried up to 5 times; then the job says what failed. Done pieces are archived (kept).
// Run by: the hand-over itself (in the background, after answering) and the database's timer every 30 seconds.
const VT = Number(Deno.env.get("TALLY_WORK_VT") || 240), TRIES = 5;      // seconds a piece is hidden while worked on (tests: shorter)
// deno-lint-ignore no-explicit-any
const later = (p: Promise<unknown>) => { const er = (globalThis as any).EdgeRuntime; if (er && typeof er.waitUntil === "function") er.waitUntil(p); else p.catch(() => {}); };
async function jobStep(job: string, units: number, bad: unknown[], failed?: string) {
  const { error } = await db.rpc("tally_job_step", { p_job: job, p_done: units, p_bad: bad || [], p_failed: failed || null });
  if (error) console.error("tally-ingest job step", job, error.message);
}
async function workPiece(m: any) {
  const job = String(m?.job || ""), firm = String(m?.firm || ""), book = String(m?.book || "");
  if (!job || !firm || !book) return;
  if (Array.isArray(m.days)) {
    const r = await ingestDaysRaw(firm, book, m.days);
    if (r.error) throw new Error(r.error);
    await jobStep(job, r.done.length + r.bad.length, r.bad);
  } else if (/^\d{6}$/.test(String(m.month || ""))) {
    const r = await reparseMonthRaw(firm, book, m.month);
    await jobStep(job, 1, r.bad || []);
  }
}
async function work(budgetMs: number) {
  const until = Date.now() + budgetMs; let n = 0;
  while (Date.now() < until) {
    const { data, error } = await db.rpc("tally_work_read", { p_vt: VT, p_n: 1 });
    if (error) throw new Error(error.message);
    const x = (data || [])[0];
    if (!x) break;
    try { await workPiece(x.message); await db.rpc("tally_work_done", { p_msg: x.msg_id }); n++; }
    catch (e) {
      const why = String((e as Error)?.message || e).slice(0, 300);
      console.error("tally-ingest work", x.msg_id, x.read_ct, why);
      if (x.read_ct >= TRIES) { await db.rpc("tally_work_done", { p_msg: x.msg_id }); if (x.message?.job) await jobStep(String(x.message.job), 0, [{ error: why }], "Stopped after " + TRIES + " tries: " + why); }
    }
  }
  return n;
}
// a person hands over work: a day book (its days, a part at a time) or the kept day books to be read again
async function queueJob(firm: string, client: string, book: string, user: string, body: any, isOwner: () => Promise<boolean>) {
  if (body.kind === "job_new") {
    const total = Math.max(0, Math.min(5000, Math.floor(Number(body.total) || 0)));
    const { data, error } = await db.from("tally_jobs").insert({ firm_id: firm, client_id: client, book_id: book, kind: "daybook", total, created_by: user, message: String(body.name || "").slice(0, 200) }).select("id").single();
    if (error) throw new Error(error.message);
    return reply(200, { ok: true, job: data.id });
  }
  if (body.kind === "stage_days") {
    const { data: j } = await db.from("tally_jobs").select("id, firm_id, client_id, kind, status").eq("id", String(body.job || "")).maybeSingle();
    if (!j || j.firm_id !== firm || j.client_id !== client || j.kind !== "daybook") return reply(404, { ok: false, error: "No such job for this client." });
    const days = (Array.isArray(body.days) ? body.days : []).filter((d: any) => isDay(d?.day) && typeof d?.gz === "string").slice(0, 62).map((d: any) => ({ day: d.day, gz: d.gz }));
    if (days.length) { const { error } = await db.rpc("tally_work_send", { p_msg: { job: j.id, firm, book, days } }); if (error) throw new Error(error.message); }
    if (body.last) {
      const { data: cur } = await db.from("tally_jobs").select("done, total").eq("id", j.id).single();
      await db.from("tally_jobs").update({ sealed: true, updated_at: new Date().toISOString(), ...(cur && cur.done >= cur.total ? { status: "done" } : {}) }).eq("id", j.id);
    }
    later(work(110000));
    return reply(200, { ok: true, queued: days.length });
  }
  if (body.kind === "reparse_queue") {
    if (!(await isOwner())) return reply(403, { ok: false, error: "Only the firm's owner can read the kept day books again." });
    const months = await keptMonths(firm, book);
    const { data, error } = await db.from("tally_jobs").insert({ firm_id: firm, client_id: client, book_id: book, kind: "reparse", total: months.length, sealed: true, created_by: user, status: months.length ? "queued" : "done" }).select("id").single();
    if (error) throw new Error(error.message);
    for (const month of months) { const { error: e2 } = await db.rpc("tally_work_send", { p_msg: { job: data.id, firm, book, month } }); if (e2) throw new Error(e2.message); }
    later(work(110000));
    return reply(200, { ok: true, job: data.id, months: months.length });
  }
  return null;
}

// a person signed in to FinCom giving the books from files exported from Tally (the day book part by part, the trial
// balance): the same cloud copy a connected computer sends, so everyone in the firm works on the same books
// FinCom Bridge 2.1.3 reads Tally only after an event. A client opened in FinCom wakes the computer that keeps its Tally
// company, on that computer's own Realtime channel (Realtime's broadcast API: no table, function or SQL is needed); the
// time is also kept in tally_devices.info (opened, activityAt) for the heartbeat's answer, the fallback when the channel
// is down. "active": FinCom in use (a page says so every few minutes at most), so the nightly catch-up waits.
async function wakeFor(firm: string, body: any) {
  const what = body.what === "open" ? "open" : body.what === "active" ? "active" : body.what === "ledgers" ? "ledgers" : "";
  if (!what) return reply(400, { ok: false, error: "Say what: open, active or ledgers." });
  const at = new Date().toISOString();
  let links: { company: string; device_id: string }[] = [];
  if (what === "open" || what === "ledgers") {
    const { data } = await db.from("tally_companies").select("company, device_id").eq("firm_id", firm).eq("client_id", String(body.client || ""));
    links = (data || []).filter((r: any) => r.device_id) as any;
    if (!links.length) return reply(200, { ok: true, woken: 0 });
  }
  let q = db.from("tally_devices").select("*").eq("firm_id", firm);
  if (what === "open" || what === "ledgers") q = q.in("id", [...new Set(links.map((r) => r.device_id))]);
  const { data: devs } = await q;
  let woken = 0;
  // 2.1.4: a bill's ledger chooser opened with a list older than the last posting: the computer reads the ledger list
  // ("ledgers", {company, at}); the time kept in info.ledgers for the heartbeat's answer. At most one a minute per
  // company here; the bridge itself reads at most once every few minutes
  if (what === "ledgers") {
    let debounced = 0;
    for (const d of (devs || []).filter((x: any) => !x.revoked)) {
      const prev = (d.info && typeof d.info === "object") ? d.info : {};
      const led: Record<string, string> = {};
      for (const [k, v] of Object.entries((prev.ledgers && typeof prev.ledgers === "object") ? prev.ledgers : {})) if (Date.parse(String(v)) > Date.now() - 3600000) led[k] = String(v);
      const cos = links.filter((r) => r.device_id === d.id).map((r) => r.company).filter((c) => !(led[c] && Date.parse(led[c]) > Date.now() - 60000));
      debounced += links.filter((r) => r.device_id === d.id).length - cos.length;
      if (!cos.length) continue;
      cos.forEach((c) => { led[c] = at; });
      await db.from("tally_devices").update({ info: { ...prev, ledgers: led, activityAt: at } }).eq("id", d.id);
      if (d.wake_token) for (const c of cos) if (await broadcast("tb-" + d.wake_token, "ledgers", { company: c, at })) woken++;
    }
    return reply(200, { ok: true, woken, debounced });
  }
  for (const d of (devs || []).filter((x: any) => !x.revoked)) {
    const prev = (d.info && typeof d.info === "object") ? d.info : {};
    const opened: Record<string, string> = {};
    for (const [k, v] of Object.entries((prev.opened && typeof prev.opened === "object") ? prev.opened : {})) if (Date.parse(String(v)) > Date.now() - 3600000) opened[k] = String(v);
    const cos = links.filter((r) => r.device_id === d.id).map((r) => r.company);
    cos.forEach((c) => { opened[c] = at; });
    await db.from("tally_devices").update({ info: { ...prev, opened, activityAt: at } }).eq("id", d.id);
    if (d.wake_token) for (const c of cos) if (await broadcast("tb-" + d.wake_token, "open", { company: c, at })) woken++;
  }
  return reply(200, { ok: true, woken });
}
async function broadcast(topic: string, event: string, payload: Record<string, unknown>) {
  try {
    const r = await fetch(URL.replace(/\/+$/, "") + "/realtime/v1/api/broadcast", { method: "POST", headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic, event, payload, private: false }] }) });
    return r.ok;
  } catch (_) { return false; }
}

async function userUpload(req: Request, auth: string) {
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await asUser.auth.getUser();
  const user = who?.user;
  if (!user) return reply(401, { ok: false, error: "Sign in to FinCom again." });
  const { data: mfaOk } = await asUser.rpc("mfa_ok");
  if (mfaOk !== true) return reply(403, { ok: false, error: "Finish the two-step sign-in first." });
  const { data: m } = await db.from("members").select("firm_id, active").eq("user_id", user.id).maybeSingle();
  if (!m || !m.active) return reply(403, { ok: false, error: "This account is not part of a firm." });
  const firm = m.firm_id as string;
  let body: any;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return (e as Error).message === "too large" ? reply(413, { ok: false, error: "Too much in one go; send fewer days at a time." }) : reply(400, { ok: false, error: "Bad request" }); }
  // an install log dropped on FinCom's Tally page (the bridge could not send it: not connected yet), for FinCom support
  if (body.kind === "install_log") {
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim() || text.length > 2 * 1024 * 1024) return reply(413, { ok: false, error: "The install log is empty or larger than 2 MB." });
    const today = new Date().toISOString().slice(0, 10);
    const { data: had } = await db.storage.from("tally-support").list(`${firm}/web`, { limit: 100, search: today });
    if ((had || []).length >= 10) return reply(429, { ok: false, error: "Ten install logs were sent today already; FinCom support has them." });
    const path = `${firm}/web/${new Date().toISOString().replace(/[:.]/g, "-")}-install.log`;
    const up = await db.storage.from("tally-support").upload(path, new TextEncoder().encode(text), { contentType: "text/plain" });
    if (up.error) return reply(500, { ok: false, error: "The install log could not be kept: " + up.error.message });
    console.log("tally-ingest install log from the web", path, user.id, String(body.name || "").slice(0, 100));
    return reply(200, { ok: true, path });
  }
  if (body.kind === "wake") return await wakeFor(firm, body);
  const clientId = String(body.client || "");
  const { data: cl } = await db.from("clients").select("id, name, tally_name, gstin, deleted").eq("firm_id", firm).eq("id", clientId).maybeSingle();
  if (!cl || cl.deleted) return reply(404, { ok: false, error: "No such client in this firm." });
  // the client's Tally company in the cloud: the one linked to it, or one made for it now, named as in Tally
  const { data: tcs } = await db.from("tally_companies").select("company, last_seen").eq("firm_id", firm).eq("client_id", clientId);
  let company = ((tcs || []).sort((a: any, b: any) => String(b.last_seen || "").localeCompare(String(a.last_seen || "")))[0] || {} as any).company as string | undefined;
  if (!company && (body.kind === "reparse" || body.kind === "reparse_queue" || body.kind === "stage_days")) return reply(404, { ok: false, error: "This client has no Tally company in the cloud yet." });
  if (!company) {
    company = String(body.company || cl.tally_name || cl.name || "").trim().slice(0, 200);
    if (!company) return reply(400, { ok: false, error: "Give the client's company name as in Tally (Client setup)." });
    const { data: other } = await db.from("tally_companies").select("client_id").eq("firm_id", firm).eq("company", company).maybeSingle();
    if (other && other.client_id && other.client_id !== clientId) return reply(409, { ok: false, error: "The Tally company " + company + " is linked to another client." });
    const { error } = await db.from("tally_companies").upsert({ firm_id: firm, company, client_id: clientId, ...(cl.gstin ? { gstin: cl.gstin } : {}), linked_at: new Date().toISOString(), linked_by: user.id }, { onConflict: "firm_id,company" });
    if (error) throw new Error(error.message);
  }
  const book = await bookFor(firm, company);
  if (!book) return reply(409, { ok: false, error: "The Tally company " + company + " cannot take this client's books (its GSTIN is another PAN's)." });
  try {
    const q = await queueJob(firm, clientId, book, user.id, body, async () => {
      const { data: me } = await db.from("members").select("role").eq("user_id", user.id).eq("firm_id", firm).maybeSingle();
      return !!me && me.role === "owner";
    });
    if (q) return q;
    if (body.kind === "upload_days") return await ingestDays(firm, book, body.days);
    // migration-34: a person's list marks missing ledgers only when the app declares it complete with the count it parsed
    // (a Master.xml; the app's trial-balance upload never declares it)
    if (body.kind === "upload_ledgers") return await ingestLedgers(book, body, undefined, { source: "upload_ledgers", by: user.id },
      body.complete === true ? { complete: true, count: Number.isInteger(body.count) ? body.count : null } : undefined);
    if (body.kind === "reparse") {
      const { data: me } = await db.from("members").select("role").eq("user_id", user.id).eq("firm_id", firm).maybeSingle();
      if (!me || me.role !== "owner") return reply(403, { ok: false, error: "Only the firm's owner can read the kept day books again." });
      return await reparseMonth(firm, book, body.month);
    }
    return reply(400, { ok: false, error: "unknown kind" });
  } catch (e) {
    console.error("tally-ingest upload", body?.kind, (e as Error).message);
    return reply(500, { ok: false, error: (e as Error).message });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
  // the database's timer: the queue's pieces (migration-13); its key is kept in the vault
  const workKey = (req.headers.get("x-fincom-work") || "").trim();
  if (workKey) {
    const { data: okKey } = await db.rpc("tally_work_key_ok", { p_key: workKey });
    if (okKey !== true) return reply(401, { ok: false, error: "not allowed" });
    try { return reply(200, { ok: true, done: await work(100000) }); } catch (e) { console.error("tally-ingest work", (e as Error).message); return reply(500, { ok: false, error: (e as Error).message }); }
  }
  const key = (req.headers.get("x-fincom-device") || "").trim();
  const auth = req.headers.get("authorization") || "";
  if (!key && /^Bearer\s+\S+/.test(auth)) {
    if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return reply(413, { ok: false, error: "Too much in one go; send fewer days at a time." });
    return userUpload(req, auth);
  }
  if (!/^fcd_[0-9a-f]{48}$/.test(key)) return reply(401, { ok: false, error: "This computer is not connected to FinCom. Connect it from FinCom: Settings, Tally connection." });
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY) return reply(413, { ok: false, error: "Too much in one go; send fewer days at a time." });
  // every column: wake_token is there from migration-13 on, and the heartbeat works without it
  const { data: dev } = await db.from("tally_devices").select("*").eq("key_hash", await sha256(key)).maybeSingle();
  if (!dev || dev.revoked) return reply(401, { ok: false, error: "This computer's key is not valid any more. Connect it again from FinCom." });
  let body: any;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return (e as Error).message === "too large" ? reply(413, { ok: false, error: "Too much in one go; send fewer days at a time." }) : reply(400, { ok: false, error: "Bad request" }); }
  const firm = dev.firm_id as string;
  // go-bridge (FinCom Bridge 2.0.0 in test mode, beside bridge 1.15.0 on the same computer and key): compared, never kept
  if (body?.shadow === true) {
    try { return await shadowCall(dev, firm, body); } catch (e) { console.error("tally-ingest shadow", body?.kind, (e as Error).message); return reply(500, { ok: false, error: (e as Error).message }); }
  }
  const seen = { last_seen: new Date().toISOString() } as Record<string, unknown>;
  if (body.version) seen.version = String(body.version).slice(0, 40);
  if (body.kind === "hello" && body.info && typeof body.info === "object") {
    // kept beside the heartbeat and history (it used to replace them)
    const i = body.info, prev = (dev.info && typeof dev.info === "object") ? dev.info : {};
    seen.info = { ...prev, computer: String(i.computer || "").slice(0, 60), user: String(i.user || "").slice(0, 60) };
  }
  await db.from("tally_devices").update(seen).eq("id", dev.id);

  try {
    switch (body.kind) {
      case "hello": {
        const { data: f } = await db.from("firms").select("name").eq("id", firm).maybeSingle();
        return reply(200, { ok: true, firm: f?.name || "", device: dev.name });
      }
      case "beat": {
        // every few minutes from the bridge (1.14.1): is Tally open, which companies, when each was last updated and
        // how many days wait to be sent. FinCom's clients list shows a light from it. Nothing of the books is in it
        const b = body || {};
        const s = (v: unknown, n = 80) => typeof v === "string" ? v.slice(0, n) : "";
        const beat = { at: new Date().toISOString(), tally: !!b.tally, updating: !!b.updating, dailyAt: s(b.dailyAt, 5), lastRun: s(b.lastRun, 8),
          open: (Array.isArray(b.open) ? b.open : []).slice(0, 50).map((x: unknown) => s(x, 200)),
          // bridge 1.14.9: each Tally port as the bridge sees it (open, another user's, how many companies, the error)
          ports: (Array.isArray(b.ports) ? b.ports : []).slice(0, 20).map((p: any) => ({ port: Math.max(0, Math.min(65535, Math.floor(Number(p?.port) || 0))), ok: !!p?.ok, skipped: !!p?.skipped,
            n: Math.max(0, Math.min(1000, Math.floor(Number(p?.n) || 0))), error: s(p?.error, 120) })),
          companies: (Array.isArray(b.companies) ? b.companies : []).slice(0, 200).map((c: any) => ({ name: s(c?.name, 200), open: !!c?.open, at: s(c?.at, 30), phase: s(c?.phase, 12),
            waiting: Math.max(0, Math.min(1e6, Math.floor(Number(c?.waiting) || 0))), lastRead: s(c?.lastRead, 30) })),
          // go-bridge: Tally open / busy (open, slow to answer) / closed, and how often the beat comes (2.0: 30 s; 1.15.0: 60 s)
          tallyState: ["open", "busy", "closed"].includes(b.tallyState) ? b.tallyState : (b.tally ? "open" : "closed"), busySince: s(b.busySince, 30),
          every: Math.max(10, Math.min(600, Math.floor(Number(b.every) || 60))), version: s(body.version, 40),
          // FinCom Bridge 2.1.3: background reading paused in its tray, since when Tally has not answered, the hour of the
          // nightly catch-up, the last read from Tally, and that it reads Tally only after an event
          paused: !!b.paused, notAnsweringSince: s(b.notAnsweringSince, 30), nightlyAt: s(b.nightlyAt, 5), lastRead: s(b.lastRead, 30), events: !!b.events,
          // FinCom Bridge 2.1.5 (migration-35): its request timings, and whether it stopped reading (by itself, or from FinCom);
          // round 2 (migration-34): its allow-list state
          reqs: cleanReqs(b.reqs), readStopped: cleanReadStopped(b.readStopped), allowlist: cleanAllowlist(b.allowlist) };
        const prevInfo = ((dev as any).info && typeof (dev as any).info === "object") ? (dev as any).info : {};
        const me = bridgeOf(dev, body, false);
        // migration-35: Stop reading from FinCom, Resume, the version it may install (and the pilot's evidence)
        const ctl = await bridgeControl(dev, firm, me, prevInfo);
        const info = { ...prevInfo, ...ctl.info, beat, history: beatHistory(prevInfo, beat), bridges: bridgesWith(prevInfo, me.id, me.entry) };
        // build 197: someone pressed Update now on another computer: the bridge is told in this answer, once
        const want = (dev as any).want_update_at, sent = (dev as any).want_sent_at;
        const updateNow = !!want && (!sent || Date.parse(want) > Date.parse(sent));
        await db.from("tally_devices").update(updateNow ? { info, want_sent_at: want } : { info }).eq("id", dev.id);
        // 02-Oct-2026: a new last read, a read going on, or Tally's state changed: passed on at once on the firm's
        // broadcast channel (FinCom's pages listen: Live.joinTally), so "read 17:43" / "Reading now…" changes at once
        // instead of when a page next looks at tally_devices. Only the times and states, nothing of the books or keys
        const pb = (prevInfo.beat && typeof prevInfo.beat === "object") ? prevInfo.beat : {};
        const said = (x: any, stop: unknown) => JSON.stringify([x.lastRead || "", !!x.updating, x.tallyState || "", !!x.paused, x.notAnsweringSince || "",
          (Array.isArray(x.companies) ? x.companies : []).map((c: any) => [c.name, c.lastRead || "", c.at || ""]), x.reqs ?? null, x.readStopped ?? null, stop ?? null]);
        if (said(pb, prevInfo.readStop) !== said(beat, (info as any).readStop)) {
          await broadcast("fincom-tally-" + firm, "beat", { device: dev.id, beat: { at: beat.at, every: beat.every, lastRead: beat.lastRead, updating: beat.updating, tallyState: beat.tallyState,
            tally: beat.tally, paused: beat.paused, notAnsweringSince: beat.notAnsweringSince, busySince: beat.busySince, open: beat.open,
            companies: beat.companies.map((c: any) => ({ name: c.name, open: c.open, at: c.at, phase: c.phase, waiting: c.waiting, lastRead: c.lastRead })),
            bridge: me.id, reqs: beat.reqs, readStopped: beat.readStopped, readStop: (info as any).readStop ?? null } });
        }
        const { count: waiting } = await db.from("tally_post_jobs").select("id", { count: "exact", head: true }).eq("device_id", dev.id).eq("status", "waiting");
        const posts = mayPost(dev, me.id) ? waiting : 0;
        // fast-sync (bridge 1.15.0): the computer's own Realtime channel, where the database wakes it the moment a
        // posting is queued or an update asked for (migration-13); the heartbeat stays the fallback
        const tok = (dev as any).wake_token;
        const wake = tok ? { url: URL.replace(/^http/, "ws").replace(/\/+$/, "") + "/realtime/v1/websocket", key: ANON, topic: "tb-" + tok } : null;
        // 2.1.3: clients opened in FinCom in the last 10 minutes (the bridge reads each at most once every few minutes),
        // and when FinCom was last used for this computer: a client opened, Update now, a posting
        const opened: Record<string, string> = {};
        for (const [k, v] of Object.entries((prevInfo.opened && typeof prevInfo.opened === "object") ? prevInfo.opened : {})) if (Date.parse(String(v)) > Date.now() - 600000) opened[k] = String(v);
        // 2.1.4: ledger lists asked for in the last 10 minutes (the ledger chooser), the fallback for the wake-up channel
        const ledgers: Record<string, string> = {};
        for (const [k, v] of Object.entries((prevInfo.ledgers && typeof prevInfo.ledgers === "object") ? prevInfo.ledgers : {})) if (Date.parse(String(v)) > Date.now() - 600000) ledgers[k] = String(v);
        const { data: lastJob } = await db.from("tally_post_jobs").select("updated_at").eq("device_id", dev.id).order("updated_at", { ascending: false }).limit(1);
        const activityAt = [prevInfo.activityAt, want, lastJob && lastJob[0] && lastJob[0].updated_at].filter((x) => x && !isNaN(Date.parse(String(x))))
          .map((x) => new Date(String(x)).toISOString()).sort().pop() || "";
        return reply(200, { ok: true, updateNow, posts: posts || 0, wake, opened, ledgers, activityAt, ...(mayPost(dev, me.id) ? {} : { notMain: true }), ...ctl.out });
      }
      case "make_main": return await makeMain(dev, bridgeOf(dev, body, false).id);
      case "posts_take": {
        if (!mayPost(dev, bridgeOf(dev, body, false).id)) return reply(403, { ok: false, notMain: true, error: "Another bridge is the main bridge on this computer now (chosen in FinCom); this one reads only and does not post." });
        const { data, error } = await db.rpc("tally_post_take", { p_device: dev.id });
        if (error) throw new Error(error.message);
        const j = (data || [])[0];
        // round 7 (F2): the ids of this posting an owner released (Not in Tally) travel with it, so the bridge sends them
        // once and does not mark them accepted from its memory of a first send; none on a cloud without migration 36b
        let released: unknown[] = [];
        if (j) {
          const { data: rel, error: relErr } = await db.from("tally_post_ids").select("entry_id, fincom_id, released_at, released_by, released_why").eq("job_id", j.id).eq("released_by", "owner");
          if (!relErr) released = (rel || []).filter((r: any) => r.released_at).map((r: any) => ({ id: r.entry_id || r.fincom_id, at: r.released_at, by: r.released_by, why: r.released_why }));
        }
        return reply(200, { ok: true, job: j ? { id: j.id, company: j.company, payload: j.payload, released } : null });
      }
      case "posts_update": {
        if (!mayPost(dev, bridgeOf(dev, body, false).id)) return reply(403, { ok: false, notMain: true, error: "Another bridge is the main bridge on this computer now (chosen in FinCom); this one reads only and does not post." });
        const st = ["taken", "running", "done", "failed"].includes(body.status) ? body.status : "running";
        const s = (v: unknown, n: number) => typeof v === "string" ? v.slice(0, n) : "";
        const results = (Array.isArray(body.results) ? body.results : []).slice(0, 5000).map((r: any) => ({ id: s(r?.id, 200), ok: !!r?.ok, verified: r?.verified === true ? true : r?.verified === false ? false : null,
          message: s(r?.message, 1000), vchNumber: s(r?.vchNumber, 60), vchType: s(r?.vchType, 100), guid: s(r?.guid, 100), masterId: s(r?.masterId, 30), vchDate: s(r?.vchDate, 8),
          optional: !!r?.optional, alreadyThere: !!r?.alreadyThere, kind: s(r?.kind, 10), state: s(r?.state, 12), reason: s(r?.reason, 500),
          // bridge 2.1.4: Tally checked for the same party, bill no., date and amount at the moment of posting: already
          // there (with its voucher), or the check could not be made (nothing posted)
          already: !!r?.already, checkFailed: !!r?.checkFailed, vchNo: s(r?.vchNo, 60),
          // rebuilt 2.1.4: sent when Tally stopped answering and being looked for by its FinCom id (state "unknown":
          // "Checking whether it reached Tally"); its FinCom id already in Tally; the company's GUID not the one held
          outcomeUnknown: !!r?.outcomeUnknown, sameId: !!r?.sameId, guidMismatch: !!r?.guidMismatch,
          // bridge 2.1.6 (round 5): Tally replied CREATED / ALTERED with a voucher id (lastVchId) but the entry is not
          // confirmed yet: ok false, accepted true, state unknown. Only a confirmed entry has ok true
          accepted: !!r?.accepted, lastVchId: s(r?.lastVchId, 30), acceptedAt: s(r?.acceptedAt, 40),
          // bridge 2.1.5 (round 7): an entry of a partly made batch not found yet by its tag: held, never sent again, looked for
          held: !!r?.held,
          // the 2.1.5 bridge's counts of Tally's reply, and the company Tally put the entry into when not the one asked
          created: Math.max(0, Math.floor(Number(r?.created) || 0)), altered: Math.max(0, Math.floor(Number(r?.altered) || 0)), wrongCompany: s(r?.wrongCompany, 200),
          // round 11 bridge: a plain refusal (PostOnly: this computer posts to one company only): never an acceptance, the id released
          refused: !!r?.refused, postOnly: !!r?.postOnly }));
        // 02-Oct-2026: each entry's state as the bridge sees it (waiting / sending / sent / in_tally / failed, with why)
        const STATES = ["waiting", "sending", "sent", "in_tally", "failed", "unknown", "notfound"];   // notfound (migration 37): checked and not in Tally
        const items = Array.isArray(body.items) ? body.items.slice(0, 5000).map((x: any) => ({ id: s(x?.id, 200), kind: s(x?.kind, 10),
          state: STATES.includes(x?.state) ? x.state : "waiting", reason: s(x?.reason, 500),
          // bridge 2.1.4: a failed item that was not posted because the same bill is in Tally (with its voucher), or
          // because Tally could not be checked first
          ...(x?.already ? { already: true, guid: s(x?.guid, 100), vchNo: s(x?.vchNo, 60), vchDate: s(x?.vchDate, 8) } : {}), ...(x?.checkFailed ? { checkFailed: true } : {}),
          ...(x?.outcomeUnknown ? { outcomeUnknown: true } : {}) })) : null;
        // a posting cancelled in FinCom, or gone: the bridge is told, and stops waiting for Tally
        const id = String(body.id || "");
        let cur: any = null;
        {
          // seq (migration 36b) may be missing on an older cloud: read without it then
          let q = await db.from("tally_post_jobs").select("status, checking, seq, results, items").eq("id", id).eq("device_id", dev.id).maybeSingle();
          if (q.error && /seq/.test(q.error.message)) q = await db.from("tally_post_jobs").select("status, checking, results, items").eq("id", id).eq("device_id", dev.id).maybeSingle();
          cur = q.data;
        }
        if (!cur) return reply(200, { ok: false, gone: true, error: "This posting is no longer in FinCom." });
        if (cur.status === "cancelled") return reply(200, { ok: false, cancelled: true, error: "This posting was cancelled in FinCom." });
        // round 7 (F4, H1): an update never goes back in time. The bridge numbers its updates per posting (seq): a lower
        // one is late and ignored. A posting finished (done or failed, nothing being checked) takes no bridge update at
        // all: what is there (an owner's settlement among it) stands
        const seq = body.seq === undefined || body.seq === null || !Number.isFinite(Number(body.seq)) ? null : Math.floor(Number(body.seq));
        if (seq !== null && typeof cur.seq === "number" && seq < cur.seq) return reply(200, { ok: true, stale: true, seq: cur.seq });
        if (["done", "failed"].includes(cur.status) && !cur.checking) return reply(200, { ok: true, stale: true, settled: true, status: cur.status });
        // 03-Oct-2026 (round 4): an entry Tally accepted is never stored as failed. An acceptance is ok, accepted (bridge
        // 2.1.6), a voucher id (lastVchId) / voucher number / master id / GUID, or CREATED / ALTERED with a voucher id in
        // Tally's words ("CREATED 0" is not one). The fault of the day: Tally replied CREATED with LASTVCHID 26298, the
        // bridge reported the posting failed, and the sync freed the id (a duplicate risk). Here: the id of EVERY accepted
        // entry is stamped accepted_at on tally_post_ids (migration 36b: the sync then never frees it; before it, the
        // function is missing and the stamp is skipped) and never released; and, per entry (round 5, C2), an accepted
        // entry not confirmed (verified not true, its state neither in_tally nor sent) is stored unknown (checking) and
        // holds the posting open: stored 'done' with checking = true, never failed while such an entry is in it, and
        // NEVER 'running' or 'taken' (the real-books fault of 03-Oct, job 3b03cc5e: parked 'running', tally_post_requeue
        // moved it back to 'waiting' after 30 minutes and the bridge sent it again: a second copy in Tally. The requeue
        // never looks at 'done'; the app treats a job with checking as still going on). A verified entry holds nothing:
        // a posting with one verified and one plainly refused entry is failed, as before.
        const fid = (v: string) => String(v || "").replace(/[^A-Za-z0-9]/g, "");
        // Tally's words with a voucher id, or the 2.1.5 bridge's own ("Tally replied 'created', but the entry cannot be
        // found in '…'": that build sent no voucher id; it is the build on NWS144)
        const acceptedMsg = (m: string) => (/\b(CREATED|ALTERED)\b/i.test(m) && (/\b(LASTVCHID|VCHID|MASTERID|voucher(?: no\.?| number| id)?)\D{0,6}[1-9]\d*/i.test(m) || /\b(CREATED|ALTERED)\b\D{0,4}[1-9]\d*/i.test(m) || /cannot be found/i.test(m)))
          || /replied '(created|altered)'/i.test(m);
        const acceptedRes = (r: any) => !!(r.ok || r.accepted || r.held || r.created > 0 || r.altered > 0 || r.lastVchId || r.vchNumber || r.masterId || r.guid || acceptedMsg(r.message) || acceptedMsg(r.reason));
        const accepted = new Set<string>(results.filter((r: any) => r.id && acceptedRes(r)).map((r: any) => fid(r.id)));
        const vchOf = (r: any) => String(r.lastVchId || r.vchNumber || r.masterId || ((String(r.message || "") + " " + String(r.reason || "")).match(/\b(?:LASTVCHID|VCHID|MASTERID|voucher(?: no\.?| number)?)\D{0,6}([1-9]\d*)/i) || [])[1] || "");
        if (items) for (const x of items as any[]) if (x.id && (x.state === "failed" || x.state === "notfound") && acceptedMsg(x.reason)) accepted.add(fid(x.id));
        // the accepted entries not confirmed: the ones that hold the posting
        const itemOf = (a: string) => ((items || []) as any[]).find((x) => fid(x.id) === a);
        const unconfirmed = new Set<string>();
        for (const a of accepted) {
          const r0 = (results as any[]).find((r) => fid(r.id) === a), x0 = itemOf(a);
          const confirmed = (r0 && r0.verified === true) || ["in_tally", "sent"].includes(String((r0 && r0.state) || "")) || ["in_tally", "sent"].includes(String((x0 && x0.state) || ""));
          if (!confirmed) unconfirmed.add(a);
        }
        let heldOpen = false;
        if (unconfirmed.size) {
          // L4: Tally created it in another company: the voucher IS in Tally (held, never sent again), the words say so
          const wrong = (r: any) => r && r.wrongCompany ? "Tally created it in " + r.wrongCompany + " instead; an owner marks it posted or releases it" : "";
          for (const r of results as any[]) if (unconfirmed.has(fid(r.id)) && !r.ok) { r.state = "unknown"; r.outcomeUnknown = true; r.reason = s(wrong(r) || r.reason || "Tally accepted it; being checked", 500); if (wrong(r)) r.message = s(wrong(r) + ". " + r.message, 1000); }
          if (items) for (const x of items as any[]) if (unconfirmed.has(fid(x.id)) && (x.state === "failed" || x.state === "notfound")) {
            const w = wrong((results as any[]).find((r) => fid(r.id) === fid(x.id)));
            x.state = "unknown"; x.reason = s(w || "Tally accepted it (" + (x.reason || "the bridge reported it failed") + "); being checked", 500); x.outcomeUnknown = true; }
          heldOpen = st === "failed";
        }
        // H1: an owner's settlement of an entry (Mark posted, Not in Tally: byOwner on the result and item, migration 36b)
        // is never written over by the bridge: per entry id, the owner's stands, and one the bridge no longer names stays
        // (R1) unless the bridge's entry is newer than the owner's stamp (byOwnerAt): the bridge sent the entry once more
        // after the owner's release and reports what Tally said now (its acceptedAt, or the report's updatedAt)
        const ownerOf = (list: any[]) => (Array.isArray(list) ? list : []).filter((x) => x && x.byOwner === true && x.id);
        const when = (v: unknown) => { const t = Date.parse(String(v || "")); return Number.isFinite(t) ? t : 0; };
        const bridgeAt = (x: any) => when(x && x.acceptedAt) || when(body.updatedAt);
        const merge = (mine: any[], theirs: any[]) => {
          const by = new Map(theirs.map((x) => [fid(x.id), x]));
          const out = mine.map((x) => { const o = by.get(fid(x.id)); return o && !(bridgeAt(x) && bridgeAt(x) > when(o.byOwnerAt)) ? o : x; });
          for (const x of theirs) if (!mine.some((m) => fid(m.id) === fid(x.id))) out.push(x);
          return out;
        };
        const mergedResults = merge(results as any[], ownerOf(cur.results)), mergedItems = items ? merge(items as any[], ownerOf(cur.items)) : null;
        let stale = false;
        let status = heldOpen ? "done" : st;
        // done or failed never goes back to running or taken (a late update of the bridge while the posting is being checked)
        let checking = heldOpen || !!body.checking;
        // (R2) a posting held for checking (done + checking) keeps that while the bridge is still sending running updates
        if (["done", "failed"].includes(cur.status) && ["running", "taken"].includes(status)) { status = cur.status; stale = true; checking = !!cur.checking; }
        const row: Record<string, unknown> = { status, done: Math.max(0, Math.floor(Number(body.done) || 0)), message: s(body.message, 500), results: mergedResults, checking, updated_at: new Date().toISOString() };
        if (heldOpen) row.message = s("Posted, not yet confirmed: Tally accepted " + unconfirmed.size + (unconfirmed.size === 1 ? " entry" : " entries") + " the bridge reported failed; held for checking, not posted again. " + s(body.message, 300), 500);
        if (mergedItems) row.items = mergedItems;
        if (seq !== null) row.seq = seq;
        // F3: the posting's ids read once; only an id not yet stamped is stamped, only one not yet released is released
        // (the bridge reports every few seconds). Not readable (an older cloud): every one, as before
        let known: any[] | null = null;
        if (accepted.size || (items || []).some((x: any) => x.state === "failed" || x.state === "notfound")) {
          const { data: idRows, error: idErr } = await db.from("tally_post_ids").select("fincom_id, entry_id, accepted_at, released_at").eq("job_id", id);
          if (!idErr) known = idRows || [];
        }
        const rowOf = (a: string) => known ? known.find((r) => fid(r.fincom_id) === a || fid(r.entry_id) === a) : undefined;
        // the id of every accepted entry is stamped (tally_post_id_accept, migration 36b: the sync then never frees it);
        // before 36b the function is missing and the stamp is skipped. Stamped 0 (36b matches the tag's spelling, the
        // bridge's and FinCom's entry id; none of the posting's ids is this one) is said in the log
        for (const a of accepted) {
          const k = rowOf(a);
          // stamped already and not released: nothing to do; released (by the owner, as history): stamped again, so that
          // a new acceptance after a Retry clears the release (36b judges by its own clock and the posting's taken_at)
          if (known && k && k.accepted_at && !k.released_at) continue;
          const r0 = (results as any[]).find((r) => fid(r.id) === a) || {}, x0 = itemOf(a) || {};
          const { data: accData, error: accErr } = await db.rpc("tally_post_id_accept", { p_job: id, p_id: a, p_vch: vchOf(r0) || vchOf(x0) });
          if (accErr && !/tally_post_id_accept|schema cache|does not exist/i.test(accErr.message)) console.error("tally_post_id_accept", accErr.message);
          else if (!accErr && accData && typeof accData === "object" && (accData as any).stamped === 0) console.warn("tally_post_id_accept: stamped 0 for " + a + " (" + s(r0.id || x0.id, 60) + ") in posting " + id + ": no id of the posting matches");
        }
        let { error } = await db.from("tally_post_jobs").update(row).eq("id", id).eq("device_id", dev.id).neq("status", "cancelled");
        // before migration-36b there is no seq column, before migration-24 no items column: the rest is kept as before
        if (error && "seq" in row && /seq/.test(error.message)) { delete row.seq; ({ error } = await db.from("tally_post_jobs").update(row).eq("id", id).eq("device_id", dev.id).neq("status", "cancelled")); }
        if (error && items && /items/.test(error.message)) { delete row.items; ({ error } = await db.from("tally_post_jobs").update(row).eq("id", id).eq("device_id", dev.id).neq("status", "cancelled")); }
        if (error) throw new Error(error.message);
        // migration 37 (item 7): an entry refused or not found in Tally releases its id (tally_post_id_release: job, id,
        // why), per entry, so Post again is offered for it alone. On the states after the guard above: never an unknown
        // entry, never one Tally accepted. Before migration 37 the function is missing: skipped
        for (const x of (items || []) as any[]) {
          if (!x.id || !(x.state === "failed" || x.state === "notfound") || accepted.has(fid(x.id))) continue;
          const k = rowOf(fid(x.id));
          if (known && k && k.released_at) continue;
          const { error: relErr } = await db.rpc("tally_post_id_release", { p_job: id, p_id: x.id, p_why: String(x.reason || x.state).slice(0, 500) });
          if (relErr && !/tally_post_id_release|schema cache|does not exist/i.test(relErr.message)) console.error("tally_post_id_release", relErr.message);
        }
        return reply(200, stale ? { ok: true, stale: true, status } : { ok: true });
      }
      case "companies": {
        const list = (Array.isArray(body.companies) ? body.companies : []).slice(0, 200)
          .map((c: any) => ({ name: String(c?.name || "").trim().slice(0, 200), gstin: String(c?.gstin || "").trim().toUpperCase().slice(0, 15), guid: String(c?.guid || "").trim().slice(0, 100) })).filter((c: any) => c.name);
        const { data: have } = await db.from("tally_companies").select("company, client_id, linked_at").eq("firm_id", firm);
        const known = new Map((have || []).map((r: any) => [r.company, r.client_id]));
        const unlinked = new Set((have || []).filter((r: any) => !r.client_id && r.linked_at).map((r: any) => r.company));   // unlinked by a person: left so
        const { data: clients } = await db.from("clients").select("id, tally_name, gstin, deleted").eq("firm_id", firm);
        const links: Record<string, boolean> = {};
        for (const c of list) {
          let client = known.get(c.name) || null, auto = false;
          if (!client && !unlinked.has(c.name)) {
            // linked by itself only when exactly one client has this Tally name and the GSTINs do not clash
            const m = (clients || []).filter((k: any) => !k.deleted && String(k.tally_name || "").trim().toLowerCase() === c.name.toLowerCase());
            if (m.length === 1 && !(m[0].gstin && c.gstin && pan(m[0].gstin) !== pan(c.gstin))) { client = m[0].id; auto = true; }
          }
          // a GSTIN is recorded when the computer knows it (the company open in Tally); never wiped by a report without one
          await db.from("tally_companies").upsert({ firm_id: firm, company: c.name, ...(c.gstin ? { gstin: c.gstin } : {}), device_id: dev.id, last_seen: new Date().toISOString(),
            ...(auto ? { client_id: client, linked_at: new Date().toISOString() } : {}) }, { onConflict: "firm_id,company" });
          links[c.name] = !!client;
          // rebuilt 2.1.4: the company's Tally GUID kept with its book; another GUID marks it needs_baseline (no migration-32: skipped)
          if (client && c.guid) {
            const book = await bookFor(firm, c.name);
            if (book) await db.rpc("tally_sync_guard", { p_firm: firm, p_book: book, p_guid: c.guid, p_alter: null, p_count: null, p_device: dev.id, p_bridge: bridgeOf(dev, body, false).id });
          }
        }
        return reply(200, { ok: true, links });
      }
      case "days": {
        const book = await bookFor(firm, String(body.company || ""));
        if (!book) return reply(409, { ok: false, notLinked: true, error: "This Tally company is not linked to a FinCom client yet." });
        return await ingestDays(firm, book, body.days);
      }
      case "ledgers": {
        const book = await bookFor(firm, String(body.company || ""));
        if (!book) return reply(409, { ok: false, notLinked: true, error: "This Tally company is not linked to a FinCom client yet." });
        const me = bridgeOf(dev, body, false);
        return await ingestLedgers(book, body, firm, { source: "bridge ledgers", device: dev.id, bridge: me.id, computer: me.entry.computer, user: me.entry.user });
      }
      case "ledger_list": {
        // at most 60 ledger_list calls a minute from one computer (a rogue key cannot bloat the rounds)
        if (!ledgerListAllowed(String(dev.id))) return reply(429, { ok: false, error: "This computer has sent sixty ledger lists in the last minute; try again in a minute." });
        const book = await bookFor(firm, String(body.company || ""));
        if (!book) return reply(409, { ok: false, notLinked: true, error: "This Tally company is not linked to a FinCom client yet." });
        return await applyLedgerList(firm, book, body, dev, bridgeOf(dev, body, false));
      }
      case "groups": {
        const book = await bookFor(firm, String(body.company || ""));
        if (!book) return reply(409, { ok: false, notLinked: true, error: "This Tally company is not linked to a FinCom client yet." });
        return reply(200, { ok: true, ...(await applyGroups(firm, book, body.ledgers, body.groups)) });
      }
      case "state": {
        const book = await bookFor(firm, String(body.company || ""));
        if (!book) return reply(409, { ok: false, notLinked: true, error: "This Tally company is not linked to a FinCom client yet." });
        const st = cleanState(body.state && typeof body.state === "object" ? body.state : {});
        const { error } = await db.rpc("tally_ingest_state", { p_book: book, p_state: st });
        if (error) throw new Error(error.message);
        return reply(200, { ok: true });
      }
      case "support": return await supportPack(firm, dev, body);
      case "lease_take": case "lease_release": case "read_guard": return await bridgeSafety(dev, firm, body);
      default:
        return reply(400, { ok: false, error: "unknown kind" });
    }
  } catch (e) {
    console.error("tally-ingest", body?.kind, (e as Error).message);
    return reply(500, { ok: false, error: (e as Error).message });
  }
});
