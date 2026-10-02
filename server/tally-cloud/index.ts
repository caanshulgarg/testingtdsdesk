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
//                                                       the primary group is worked out from them and kept)
//   {kind:"groups", company, ledgers:[[name, parent]], groups:[[name, parent]]} -> (bridge 1.14.9) every ledger's group
//                                                       and Tally's groups, without openings: openings and entries stay
//   {kind:"state", company, state}
//   {kind:"beat", tally, open, ports?, companies:[{name, open, at, phase, waiting, lastRead}], updating, dailyAt, lastRun,
//    paused, notAnsweringSince, nightlyAt, lastRead, events} -> {updateNow, posts, wake, opened, activityAt}
//                                                       (FinCom Bridge 2.1.3 reads Tally only after an event: opened =
//                                                       {company: when} clients opened in FinCom lately, the fallback
//                                                       for the wake-up channel; activityAt = when FinCom was last used
//                                                       for this computer's clients, for the nightly catch-up)
//   {kind:"support", note, zip}                      -> the Connector's log and details for FinCom support
//   FinCom Bridge 2.1.4 as rebuilt on 02-Oct-2026 (migration-32-sync-safety; without it these answer as before, no lease):
//   {kind:"lease_take", company, ttl}                -> {held:false, lease:{until}} | {held:true, holder:{bridge, computer, until}}:
//                                                       only one bridge reads or posts a company at a time (renewed by taking
//                                                       it again); {noLease:true} when the cloud keeps none
//   {kind:"lease_release", company}                  -> the lease given back by its holder
//   {kind:"ledger_list", company, ledgers:[[guid, masterId, alterId, name, group, storedOpening, gstin, pan, openingChanged]],
//    renamed?:[[guid, from, to]], deleted?:[[guid, name]], groups?:[[name, parent]], last}
//                                                    -> {added, renamed, deleted, deletesSkipped, notes}: 2.1.4, the plain ledger
//                                                       list (applyLedgerList): rows added or brought up to date, renamed
//                                                       (old name kept), deleted ones marked (deleted_at), never removed
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
    open: (Array.isArray(body?.open) ? body.open : []).slice(0, 50).map((x: unknown) => s(x, 200)) } };
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
    // a bridge 2.0.0 in test mode sends no name of its own: it is kept in info.shadow only, never in bridge 1.15.0's place
    const info = me.id === "v1" ? { ...prev, shadow } : { ...prev, shadow, bridges: bridgesWith(prev, me.id, me.entry) };
    await db.from("tally_devices").update({ info }).eq("id", dev.id);
    const tok = dev.wake_token;
    const wake = tok ? { url: URL.replace(/^http/, "ws").replace(/\/+$/, "") + "/realtime/v1/websocket", key: ANON, topic: "tb-" + tok } : null;
    // made the main bridge on FinCom's Tally page: the bridge switches itself over (and 1.15.0 is refused postings already)
    return reply(200, { ok: true, updateNow: false, posts: 0, wake, shadow: true, makeMain: me.id !== "v1" && dev.main_bridge === me.id });
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
const dayVouchers = (r: any) => r.vouchers.map((v: any) => ({ guid: v.guid, alter: v.alter, type: v.type, no: v.no, party: cleanName(v.party), narr: v.narr, cancel: v.cancel, opt: v.opt, gstin: v.gstin, pos: v.pos, ref: v.ref, refDate: v.refDate, cmp: v.cmp }));
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
//   deleted [guid, name]: deleted_at set (migration-32), never removed; a ledger listed again is undeleted
//   groups [name, parent]: upserted (none removed)
// Without migration-32 (no tally_guid / deleted_at): renames by name, no deletions (counted in deletesSkipped and
// logged; the bridge sends them again later), nothing fails. Without migration-31: renames without the history.
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
async function applyLedgerList(firm: string, book: string, body: any) {
  const s = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const m32 = await hasCols("tally_ledgers", "tally_guid, alter_id, deleted_at");
  const m31 = await hasCols("tally_ledgers", "before_clean");
  const m28 = await hasCols("tally_ledgers", "gstin, pan");
  const notes: string[] = [];
  const out = { ok: true, ledgers: 0, added: 0, renamed: 0, deleted: 0, deletesSkipped: 0, groups: 0, notes };
  const now = new Date().toISOString();
  const cols = "name, parent" + (m32 ? ", tally_guid, deleted_at" : "") + (m31 ? ", before_clean" : "");
  // 1. groups (added or changed; none removed), and every group's parent for the chains
  const grpIn = cleanPairs(body.groups, 20000);
  for (let i = 0; i < grpIn.length; i += 1000) {
    const { error } = await db.from("tally_groups").upsert(grpIn.slice(i, i + 1000).map((g: any) => ({ book_id: book, firm_id: firm, name: g[0], parent: g[1] })), { onConflict: "book_id,name" });
    if (error) throw new Error(error.message);
  }
  out.groups = grpIn.length;
  const { data: allG, error: eg } = await db.from("tally_groups").select("name, parent").eq("book_id", book);
  if (eg) throw new Error(eg.message);
  const up = new Map((allG || []).map((g: any) => [g.name, g.parent || ""]));
  const chain = (p: string) => { const c: string[] = []; while (p && c.length < 30 && !c.includes(p)) { c.push(p); p = up.get(p) || ""; } return c; };
  // a row renamed (or, the new name being taken by another row, marked deleted and its GUID left to that row)
  const history = (row: any, entry: Record<string, unknown>) => {
    const b = row?.before_clean && typeof row.before_clean === "object" ? row.before_clean : {};
    return { ...b, renamed: [...(Array.isArray(b.renamed) ? b.renamed : []), entry].slice(-20) };
  };
  const rename = async (guid: string, from: string, to: string) => {
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
  // 3. the rows: one per clean name
  const seen = new Set<string>();
  const rows = (Array.isArray(body.ledgers) ? body.ledgers : []).slice(0, 5000).map((l: any) => ({
    guid: s(l?.[0], 100).trim(), alter: Math.max(0, Math.floor(Number(l?.[2]) || 0)), name: cleanName(s(l?.[3], 300)),
    parent: cleanName(s(l?.[4], 300)).replace(/^\W*Primary$/i, ""), open: Math.round(amt(l?.[5]) * 100) / 100,
    gstin: s(l?.[6], 15).trim().toUpperCase(), pan: s(l?.[7], 10).trim().toUpperCase(), oc: !!Number(l?.[8]) }))
    .filter((r: any) => r.name && !seen.has(r.name) && seen.add(r.name));
  out.ledgers = rows.length;
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
  // 4. deletions: marked, never removed
  const del = (Array.isArray(body.deleted) ? body.deleted : []).slice(0, 50000)
    .map((x: any) => ({ guid: s(x?.[0], 100).trim(), name: cleanName(s(x?.[1], 300)) })).filter((d: any) => d.guid || d.name);
  if (del.length && !m32) {
    out.deletesSkipped = del.length;
    notes.push("deletions skipped: migration-32 (tally_ledgers.deleted_at) is not applied");
    console.log("tally-ingest ledger_list: migration-32 not applied, deletions skipped", book, del.length);
  } else if (del.length) {
    const guids = del.map((d: any) => d.guid).filter(Boolean);
    for (let i = 0; i < guids.length; i += 150) {
      const { data, error } = await db.from("tally_ledgers").update({ deleted_at: now }).eq("book_id", book).in("tally_guid", guids.slice(i, i + 150)).is("deleted_at", null).select("name");
      if (error) throw new Error(error.message);
      out.deleted += (data || []).length;
    }
    // a row the copy holds without a GUID yet (from Master.xml): by its name, unless that name is listed in this call
    const names = del.map((d: any) => d.name).filter((n: string) => n && !seen.has(n));
    for (let i = 0; i < names.length; i += 150) {
      const { data, error } = await db.from("tally_ledgers").update({ deleted_at: now }).eq("book_id", book).in("name", names.slice(i, i + 150)).is("tally_guid", null).is("deleted_at", null).select("name");
      if (error) throw new Error(error.message);
      out.deleted += (data || []).length;
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
    const { error } = await db.rpc("tally_ingest_day", { p_book: book, p_day: iso(d.day),
      p_vouchers: dayVouchers(r), p_lines: dayLines(r), p_n: r.n, p_alter: r.alterMax, p_bytes: gz.length });
    if (error) throw new Error(error.message);
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
    const { error } = await db.rpc("tally_ingest_day", { p_book: book, p_day: iso(day),
      p_vouchers: dayVouchers(r), p_lines: dayLines(r), p_n: r.n, p_alter: r.alterMax, p_bytes: gz.length });
    if (error) throw new Error(error.message);
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
  const up = new Map((allG || []).map((g: any) => [g.name, g.parent || ""]));
  const chain = (p: string) => { const out: string[] = []; while (p && out.length < 30 && !out.includes(p)) { out.push(p); p = up.get(p) || ""; } return out; };
  for (let i = 0; i < leds.length; i += 1000) {
    const rows = leds.slice(i, i + 1000).map((l: any) => { const c = chain(l[1]); return { book_id: book, firm_id: firm, name: l[0], parent: l[1], chain: c, primary_group: c.length ? c[c.length - 1] : "" }; });
    const { error } = await db.from("tally_ledgers").upsert(rows, { onConflict: "book_id,name" });
    if (error) throw new Error(error.message);
  }
  const { error: eo } = await db.rpc("tally_year_openings", { p_book: book });
  if (eo) throw new Error(eo.message);
  return { ledgers: leds.length, groups: groups.length };
}
async function ingestLedgers(book: string, body: any, firm?: string) {
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
  const { data, error } = await db.rpc("tally_ingest_ledgers_g", { p_book: book, p_from: iso(body.from), p_open_as_on: iso(body.openAsOn), p_ledgers: led, p_groups: groups });
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
    if (body.kind === "upload_ledgers") return await ingestLedgers(book, body);
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
          paused: !!b.paused, notAnsweringSince: s(b.notAnsweringSince, 30), nightlyAt: s(b.nightlyAt, 5), lastRead: s(b.lastRead, 30), events: !!b.events };
        const prevInfo = ((dev as any).info && typeof (dev as any).info === "object") ? (dev as any).info : {};
        const me = bridgeOf(dev, body, false);
        const info = { ...prevInfo, beat, history: beatHistory(prevInfo, beat), bridges: bridgesWith(prevInfo, me.id, me.entry) };
        // build 197: someone pressed Update now on another computer: the bridge is told in this answer, once
        const want = (dev as any).want_update_at, sent = (dev as any).want_sent_at;
        const updateNow = !!want && (!sent || Date.parse(want) > Date.parse(sent));
        await db.from("tally_devices").update(updateNow ? { info, want_sent_at: want } : { info }).eq("id", dev.id);
        // 02-Oct-2026: a new last read, a read going on, or Tally's state changed: passed on at once on the firm's
        // broadcast channel (FinCom's pages listen: Live.joinTally), so "read 17:43" / "Reading now…" changes at once
        // instead of when a page next looks at tally_devices. Only the times and states, nothing of the books or keys
        const pb = (prevInfo.beat && typeof prevInfo.beat === "object") ? prevInfo.beat : {};
        const said = (x: any) => JSON.stringify([x.lastRead || "", !!x.updating, x.tallyState || "", !!x.paused, x.notAnsweringSince || "",
          (Array.isArray(x.companies) ? x.companies : []).map((c: any) => [c.name, c.lastRead || "", c.at || ""])]);
        if (said(pb) !== said(beat)) {
          await broadcast("fincom-tally-" + firm, "beat", { device: dev.id, beat: { at: beat.at, every: beat.every, lastRead: beat.lastRead, updating: beat.updating, tallyState: beat.tallyState,
            tally: beat.tally, paused: beat.paused, notAnsweringSince: beat.notAnsweringSince, busySince: beat.busySince, open: beat.open,
            companies: beat.companies.map((c: any) => ({ name: c.name, open: c.open, at: c.at, phase: c.phase, waiting: c.waiting, lastRead: c.lastRead })) } });
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
        return reply(200, { ok: true, updateNow, posts: posts || 0, wake, opened, ledgers, activityAt, ...(mayPost(dev, me.id) ? {} : { notMain: true }) });
      }
      case "make_main": return await makeMain(dev, bridgeOf(dev, body, false).id);
      case "posts_take": {
        if (!mayPost(dev, bridgeOf(dev, body, false).id)) return reply(403, { ok: false, notMain: true, error: "Another bridge is the main bridge on this computer now (chosen in FinCom); this one reads only and does not post." });
        const { data, error } = await db.rpc("tally_post_take", { p_device: dev.id });
        if (error) throw new Error(error.message);
        const j = (data || [])[0];
        return reply(200, { ok: true, job: j ? { id: j.id, company: j.company, payload: j.payload } : null });
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
          outcomeUnknown: !!r?.outcomeUnknown, sameId: !!r?.sameId, guidMismatch: !!r?.guidMismatch }));
        // 02-Oct-2026: each entry's state as the bridge sees it (waiting / sending / sent / in_tally / failed, with why)
        const STATES = ["waiting", "sending", "sent", "in_tally", "failed", "unknown"];
        const items = Array.isArray(body.items) ? body.items.slice(0, 5000).map((x: any) => ({ id: s(x?.id, 200), kind: s(x?.kind, 10),
          state: STATES.includes(x?.state) ? x.state : "waiting", reason: s(x?.reason, 500),
          // bridge 2.1.4: a failed item that was not posted because the same bill is in Tally (with its voucher), or
          // because Tally could not be checked first
          ...(x?.already ? { already: true, guid: s(x?.guid, 100), vchNo: s(x?.vchNo, 60), vchDate: s(x?.vchDate, 8) } : {}), ...(x?.checkFailed ? { checkFailed: true } : {}),
          ...(x?.outcomeUnknown ? { outcomeUnknown: true } : {}) })) : null;
        // a posting cancelled in FinCom, or gone: the bridge is told, and stops waiting for Tally
        const id = String(body.id || "");
        const { data: cur } = await db.from("tally_post_jobs").select("status").eq("id", id).eq("device_id", dev.id).maybeSingle();
        if (!cur) return reply(200, { ok: false, gone: true, error: "This posting is no longer in FinCom." });
        if (cur.status === "cancelled") return reply(200, { ok: false, cancelled: true, error: "This posting was cancelled in FinCom." });
        const row: Record<string, unknown> = { status: st, done: Math.max(0, Math.floor(Number(body.done) || 0)), message: s(body.message, 500), results, checking: !!body.checking, updated_at: new Date().toISOString() };
        if (items) row.items = items;
        let { error } = await db.from("tally_post_jobs").update(row).eq("id", id).eq("device_id", dev.id).neq("status", "cancelled");
        // before migration-24 there is no items column: the rest is kept as before
        if (error && items && /items/.test(error.message)) { delete row.items; ({ error } = await db.from("tally_post_jobs").update(row).eq("id", id).eq("device_id", dev.id).neq("status", "cancelled")); }
        if (error) throw new Error(error.message);
        return reply(200, { ok: true });
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
        return await ingestLedgers(book, body, firm);
      }
      case "ledger_list": {
        const book = await bookFor(firm, String(body.company || ""));
        if (!book) return reply(409, { ok: false, notLinked: true, error: "This Tally company is not linked to a FinCom client yet." });
        return await applyLedgerList(firm, book, body);
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
