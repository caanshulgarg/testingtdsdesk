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
//    release (the owner's rule of 05-Oct-2026, migration 54): {newest:true, allowed:true, held:[versions], version?} (the
//    newest version goes to every computer by itself, except those the owner held or withdrew) or {version, allowed:true,
//    rollback:true} (the owner's "Roll back to <version>"). Without
//    migration-35 none of the three is said. Older bridges ignore them. Round 2 (migration-34): the beat also carries
//    allowlist:{measured, hash} (every Tally request on the bridge's allow-list timed, and which list); kept with the
//    beat and, for the pilot computer, as evidence on the release (approval waits for measured)
//   {kind:"support", note, zip}                      -> the Connector's log and details for FinCom support
//   FinCom Bridge 2.1.4 as rebuilt on 02-Oct-2026 (migration-32-sync-safety; without it these answer as before, no lease):
//   {kind:"lease_take", company, ttl}                -> {held:false, lease:{until}} | {held:true, holder:{bridge, computer, until}}:
//                                                       only one bridge reads or posts a company at a time (renewed by taking
//                                                       it again); {noLease:true} when the cloud keeps none
//   {kind:"lease_release", company}                  -> the lease given back by its holder
//   {kind:"ledger_list", company, ledgers:[[guid, masterId, alterId, name, group, storedOpening, gstin, pan, openingChanged, state?, deducteeType? (2.3.1)]],
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
//   {kind:"ledger_changes", company, company_guid, ledgers:[the ledger_list row shape], why: counter | wanted, after?, upto?}
//                                                    -> {ok, ledgers, added, updated, kept}: FinCom Bridge 2.3.1 (masters,
//                                                       applyLedgerChanges): the ledgers created or altered since Tally's
//                                                       master counter last moved, or one an entry uses that FinCom did not
//                                                       have; name (new ledgers), group, GSTIN, PAN, state and opening kept
//                                                       current; nothing marked gone, renamed or moved (kept: said for 2.3.2)
//   {kind:"read_guard", company, guid, alter, count} -> {state: ok | needs_baseline, why}: the company's Tally GUID, highest
//                                                       AlterID and the entries read, kept at each read (tally_sync_reads)
//   companies:[{name, gstin, guid}]                  -> the company's Tally GUID kept with its book (tally_sync_cursor)
//   {kind:"posts_take"}                              -> {job: {id, company, payload} | null}: the next posting queued in
//                                                       FinCom for this computer (build 199); the beat says how many wait
//   {kind:"posts_update", id, status, done, message, results, checking} -> how a posting taken by this computer is going
//    FinCom Bridge 2.1.8 (round 15, migration 43: posting by Tally's reply): a result may also carry byReply, vchId, batchEnd,
//    batchN, needsReview, accepted, created, altered, exceptions, ignored, errors, lineError, lastVchId, company, sentAt,
//    secondsReq (stored); the update may carry reqs:[{n, seconds, created, altered, exceptions, ignored, lastVchId}] and
//    secondsTotal (stored in tally_post_jobs.timing). A byReply + ok result is taken: tally_post_id_accept_reply(job, id,
//    vchId | null, batchEnd, batchN) (tally_post_id_accept when 43 is missing); needsReview + accepted: tally_post_id_accept
//    (job, id, lastVchId), unconfirmed (the posting held, done + checking); needsReview without accepted: the id released
//    'needs review: ' + message. The beat's answer carries settings:{postOnly, postBatchBills, postBatchBank, at} (the
//    owner's per-computer posting settings, tally_device_post_settings; null fields without 43) and the beat may carry
//    postOnly, postBatchBills, postBatchBank, settingsAt (the values applied; kept in info.beat and the bridge's entry).
//    The code review of 2.1.8 (docs/reviews/bridge-2.1.8-code-review.md): item states posted / needs_review kept; lineError
//    an array (at most 5 texts of 200); an entry of a batch (batchN > 1) is stamped with vchId alone, never the request's
//    LASTVCHID; an alreadySent refusal (this computer sent it before) is an acceptance kept locked, never released nor
//    rewritten as being checked; a 'failed' update carrying an entry sent with no answer from Tally is stored done
//    FinCom Bridge 2.2.0 (migration 45, docs/recorder-bulk-posting.md 3): the job's last update may carry window {a0, a1,
//    vouchersCreated, mastersCreated, guid} (Tally's ALTVCHID before and after the job, the counts of Tally's replies, the
//    company GUID of the company check): kept per book by tally_post_window_save(firm, job, device, a0, a1, vch, mst, guid),
//    so the gap check counts FinCom's own postings. Each a whole number 0..10^15 (below) and a1 not below a0, else ignored
//    with a log line; saved only after the update's own checks (never for a cancelled, late or settled update); never fails
//    the update. With an acceptance, the job's short lines held before it are re-run (tally_recorder_short_held / _retry)
//   Phase 2, the Tally change recorder (migration 44; without it both answer 503 {notReady}):
//   {kind:"recorder_lines", company, lines:[{line_id, event, saved_at, pc, user, company_guid, object_guid, master_id,
//    alter_id, vch_type, vch_no, vch_date, xml?, ledgers?, save_ms, name?, from?, to?}]} -> {ok, results:[{line_id, state,
//                                                       why}], applied, held, duplicate, stale, failed}: the add-on's lines
//                                                       (at most 500 a call; the bridge marks a line sent only on this answer).
//                                                       event: created|altered|deleted|cancelled|imported|ledger_created|
//                                                       ledger_altered|ledger_renamed|ledger_deleted (another: failed here, not
//                                                       stored); next-masterhook (migration 66): master_created|master_altered|
//                                                       master_deleted {master_type (Pay Head, Stock Item or Godown; any other
//                                                       'failed'), name, parent, object_guid, master_id, alter_id} heads only,
//                                                       kept by tally_recorder_masters_save ('kept' / 'duplicate'); xml: the whole <VOUCHER ...>...</VOUCHER> when the add-on can
//                                                       give it, read with parse.js (parseDay) into the days path's vouchers
//                                                       and lines; vch_date yyyymmdd (or yyyy-mm-dd); ledgers [{name, guid}];
//                                                       name (ledger_*), from / to (ledger_renamed); save_ms the delay added
//                                                       to saving. tally_recorder_apply(firm, book, device, lines)
//    migration 45 (docs/recorder-bulk-posting.md 4): a SHORT line, FinCom's own entry (the add-on writes only company_guid,
//    object_guid, master_id, alter_id, fid (or narration carrying "TDSDesk:<id>"), event, saved_at; no xml): the posted XML
//    of its FinCom id is fetched for a created / imported line only (tally_post_xml_for(firm, book, fids): the live,
//    accepted posting of this firm for this book; a short 'altered' line is a person's change: no body, held there) and read
//    with parse.js, the line's GUID and AlterID overriding, into the line's vouchers / lines as a full body
//    (short: true). The database matches it to the posting (tally_post_ids.matched_*) and builds the entry once by GUID; a
//    FinCom id matching no posting is held there. Without 45 the fetch is skipped (the line is held for want of a body)
//    round 20 (migration 47): more than 50 FULL lines in one request (an entry body read from the xml; short lines do not
//    count) go on the pgmq queue tally_recorder as ONE message (tally_recorder_enqueue(firm, book, device, lines)) and are
//    answered at once {ok, queued: n, failed, msg, results: [{line_id, state: "queued" | "failed", why}]}; the database's
//    drain (tally_recorder_drain, pg_cron every 30 s) applies them in order, each line's state then in tally_recorder_lines
//    (Sync activity). 50 or fewer, or short lines only: applied directly as before. Without 47: applied directly
//   the beat's companies may carry altvchid, altmstid, recorderSeen, recorderLastAt (at: the check's time): each company with
//   altvchid is checked (tally_recorder_gap_check) and the answer carries recorder:{company: {gap, missing, needsBaseline?,
//   startRecorded?}}; recorderSeen kept per bridge in info.bridges[id].recorder = {company: {seen, lastAt}}
//   round 19: the beat's change numbers are read in BOTH shapes (beatChanges): FinCom Bridge 2.1.9 sends them top-level only,
//   startPoint {company: {altvchid, altmstid, at, guid}} and changeNumbers {company: {altvchid, altmstid, at, recorderSeen,
//   recorderLastAt}}; 2.1.10 also in companies[] {name, ..., guid, altvchid, altmstid, recorderSeen}. companies[] first, else the
//   top-level fields by name. A company with a GUID and an altvchid gets tally_start_point (once per cold start; the database
//   keeps it once) before the gap check. A zoneless time from the bridge is IST. A failed call is logged with the company and
//   the error (console.error); a function the database lacks is said once per cold start. The beat's answer carries
//   trialTools: true / false (tally_devices.trial_tools, migration 46: the owner's switch "Trial tools on this computer";
//   false without the column); and (round 20, migration 47) recorderSource: addon | alterid | both (tally_devices.
//   recorder_source, the owner's tally_device_recorder_source), left out without the column; and (FinCom Bridge 2.2.2)
//   heldLines: [{line_id, company, company_guid, event, master_id, vch_type, vch_no, vch_date}] this computer's lines held
//   without their entry (heldLinesFor; from 06-Oct-2026 this bridge's only), left out when none; and (06-Oct-2026) refetch:
//   the same fields, at most 20 of this bridge's own held lines whose body is missing or whose GUID is a placeholder
//   (refetchFor), asked of its own Tally again by a bridge built after 2.3.0 and sent as "<line id>:resolved"; left out when none
//   FinCom Bridge 2.3.1 (masters): a recorder line whose body names a ledger the book does not have is held "waiting for the
//   ledger '<name>' from Tally" (ledgerWait); the beat answers ledgersWanted: [{company, company_guid, name}] (at most 20, this
//   bridge's own held lines), and lists such a line in heldLines / refetch only once its ledgers are in (refetch with
//   ledgerAgain: true when its "<line id>:resolved" was the line held so); left out when none
//   {kind:"start_point", company, guid?, altvchid, altmstid, at} -> {set, startVoucher, startMaster, guid, at, state}: the
//                                                       bridge's starting point (reading is prospective), kept once per book
//                                                       and company GUID on tally_sync_cursor (tally_start_point)
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
//   {kind:"upload_new", client, name, size, from, to} -> (round 20, migration 47) {job, path '<firm>/<job>.xml', bucket
//                                                       'tally-uploads', days}: a tally_jobs row kind upload (total: the
//                                                       period's days; the path, period, size and name on tally_jobs.upload)
//                                                       for the app's resumable (TUS) upload to Storage; 413 over 2 GB; a
//                                                       cloud without 47: 400 'unknown kind' (the app hands the file over the
//                                                       old way)
//   {kind:"upload_done", client, job, path}       -> the file is in Storage (its size checked): the job sealed and the
//                                                       split's first piece queued on tally_work {job, firm, book, upload:
//                                                       {path, size, from, range}}; the worker reads the file by byte ranges
//                                                       and queues the days pieces (uploadPiece); a second call: {already}
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
  const port = (v: unknown) => { const n = Math.floor(Number(v)); return n > 0 && n <= 65535 ? n : null; };
  return { id, entry: { at: new Date().toISOString(), version: s(body?.version, 40) || s(b?.version, 40),
    computer: s(b?.computer, 60) || (id === "v1" ? s(hello.computer, 60) : ""), user: s(b?.user, 60) || s(body?.windowsUser, 60) || (id === "v1" ? s(hello.user, 60) : ""),
    // FinCom Bridge 2.3.0 (one bridge per Windows user on a shared server): its own local port, its Tally's port and data
    // folder (tally.ini's Data), for the Tally page's "<PC> · <Windows user>" line; null / "" when not said
    port: port(body?.bridgePort ?? b?.port), tallyPort: port(body?.tallyPort), dataFolder: s(body?.dataFolder, 260),
    mode: shadow ? "test" : "main", runMode: ["user", "service", "window"].includes(b?.runMode) ? b.runMode : "",
    tally: !!body?.tally, tallyState: ["open", "busy", "closed"].includes(body?.tallyState) ? body.tallyState : (body?.tally ? "open" : "closed"),
    open: (Array.isArray(body?.open) ? body.open : []).slice(0, 50).map((x: unknown) => s(x, 200)),
    // 2.1.5: its request timings, whether it stopped reading, and (round 2) its allow-list state
    reqs: cleanReqs(body?.reqs), readStopped: cleanReadStopped(body?.readStopped), allowlist: cleanAllowlist(body?.allowlist),
    ...tallyRetryOf(body),
    // 2.1.6 (round 11): the companies this bridge posts to (PostOnly); [] when any; absent on an older bridge
    ...(Array.isArray(body?.postOnly) ? { postOnly: cleanPostOnly(body.postOnly) } : {}),
    // 2.1.8 (round 15, migration 43): the posting settings this bridge applied (batch sizes, when), absent on an older bridge
    ...postSettingsApplied(body),
    // phase 2 (migration 44): per company, whether this PC holds the recorder's file and its last line ({company: {seen,
    // lastAt}}), for the app's banner "Tally changes are not being recorded on <PC>"; absent on a bridge that does not say
    ...recorderOf(body),
    // condition 4 (bridge 2.2.0): per company, the methods its 2-second rule switched off (the entry fetch, Tally's change
    // list, month slices), {bodies, B, C}; absent on an older bridge or when none is off
    ...recorderOffOf(body) } };
}
// condition 4: recorderBodyFetch / recorderSourceB / recorderSourceC of a 2.2.0 beat, each {company: {off, seconds, at, why}}
// (bridge-go/recorder_probes.go liveBeatOff): company names up to 200, at most 50, off true, seconds a number 0..3600 (to
// 0.1), at up to 30, why up to 300; anything else is not kept
function cleanOffs(x: any) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const out: Record<string, { off: true; seconds: number; at: string; why: string }> = {};
  for (const [name, v] of Object.entries(x)) {
    if (Object.keys(out).length >= 50) break;
    const o: any = v;
    if (!name || name.length > 200 || !o || typeof o !== "object" || Array.isArray(o) || o.off !== true) continue;
    if (typeof o.seconds !== "number" || !Number.isFinite(o.seconds) || o.seconds < 0 || o.seconds > 3600) continue;
    out[name] = { off: true, seconds: Math.round(o.seconds * 10) / 10, at: typeof o.at === "string" ? o.at.slice(0, 30) : "", why: typeof o.why === "string" ? o.why.slice(0, 300) : "" };
  }
  return Object.keys(out).length ? out : null;
}
function recorderOffOf(body: any) {
  const all: Record<string, unknown> = {};
  for (const [k, f] of [["bodies", "recorderBodyFetch"], ["B", "recorderSourceB"], ["C", "recorderSourceC"]]) { const c = cleanOffs(body?.[f]); if (c) all[k] = c; }
  return Object.keys(all).length ? { recorderOff: all } : {};
}
// phase 2: the companies of a beat that say recorderSeen (a boolean): {company: {seen, lastAt}}, at most 50. Round 19: read
// from either shape of the beat (beatChanges: companies[] first, else the top-level changeNumbers of bridge 2.1.9)
function recorderOf(body: any) {
  const out: Record<string, { seen: boolean; lastAt: string }> = {};
  for (const c of beatChanges(body)) if (typeof c.recorderSeen === "boolean") out[c.name] = { seen: c.recorderSeen, lastAt: c.recorderLastAt };
  return Object.keys(out).length ? { recorder: out } : {};
}
// phase 2: Tally's highest change numbers per company as the beat says them (FinComCompany's ALTVCHID / ALTMSTID). 0 or
// less is unknown (the bridge sends 0 for a value it could not read), never a number: 0 would read as a rewind or set a
// starting point of 0 (review M2); 10^15 or more is past Tally's range
const altOf = (v: unknown) => v === null || v === undefined || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v)) || Number(v) <= 0 || Number(v) >= 1e15 ? null : Math.floor(Number(v));
// round 19: the bridge's times carry no zone (FinCom Bridge writes Windows' local time, IST, "2006-01-02T15:04:05"): only that
// exact form is read as +05:30, never as the cloud's UTC; an ISO time with its zone (Z or +hh:mm) as it says; any other form
// is not read: now (review 46 L3). A time more than 5 minutes ahead of the server's now (a PC clock ahead) is taken as now,
// so a last match is never stamped in the future (review 46 M2)
function atOf(v: unknown) {
  const t = typeof v === "string" ? v.trim().slice(0, 40) : "";
  const ms = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(t) ? Date.parse(t + "+05:30")
    : /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?(Z|[+-]\d\d:\d\d)$/i.test(t) ? Date.parse(t) : NaN;
  return isNaN(ms) || ms > Date.now() + 300000 ? new Date().toISOString() : new Date(ms).toISOString();
}
// round 19: a beat's change numbers per company, in both shapes. FinCom Bridge 2.1.9 sends them top-level only
// (bridge-go/cloud.go beatBody): startPoint {company: {altvchid, altmstid, at, guid, otherGuids?}} and changeNumbers {company:
// {altvchid, altmstid, at, recorderSeen, recorderLastAt}}, its companies[] without them (only the kept companies there). 2.1.10
// also puts {guid, altvchid, altmstid, recorderSeen} in companies[] for every open company. companies[] is read first, else the
// top-level fields by the company's name; the GUID from companies[], else startPoint's, else changeNumbers'. start: the
// bridge's own starting point (startPoint) when it is of that GUID. at: the check's time, changeNumbers' only (2.1.10's
// companies[].at is the company's last update, never the check's: review 46 L2; none: now). At most 50 companies; names cut to 200
type BeatChange = { name: string; altvchid: number | null; altmstid: number | null; at: string; guid: string; recorderSeen?: boolean; recorderLastAt: string; start: { altvchid: number; altmstid: number | null } | null };
function beatChanges(body: any): BeatChange[] {
  const o = (x: any) => x && typeof x === "object" && !Array.isArray(x) ? x : null;
  const s = (v: unknown, n: number) => typeof v === "string" ? v.slice(0, n) : "";
  const cn = o(body?.changeNumbers) || {}, sp = o(body?.startPoint) || {};
  const list = new Map<string, any>();
  for (const c of (Array.isArray(body?.companies) ? body.companies : []).slice(0, 200) as any[]) {
    const name = s(c?.name, 200);
    if (name && !list.has(name)) list.set(name, o(c) || {});
  }
  const names = [...new Set([...list.keys(), ...Object.keys(cn).slice(0, 50), ...Object.keys(sp).slice(0, 50)].map((n) => n.slice(0, 200)).filter(Boolean))];
  const out: BeatChange[] = [];
  for (const name of names) {
    if (out.length >= 50) break;
    const c = list.get(name) || {}, n = o(cn[name]) || {}, p = o(sp[name]);
    const fromList = altOf(c.altvchid) !== null, cur = fromList ? c : n;
    const guid = s(c.guid, 100).trim() || s(p?.guid, 100).trim() || s(n.guid, 100).trim();
    const seenFrom = typeof c.recorderSeen === "boolean" ? c : typeof n.recorderSeen === "boolean" ? n : null;
    const pAlt = p ? altOf(p.altvchid) : null, pGuid = p ? s(p.guid, 100).trim() : "";
    const altvchid = altOf(cur.altvchid);
    if (altvchid === null && pAlt === null && !seenFrom) continue;
    out.push({ name, altvchid, altmstid: altvchid === null ? null : altOf(cur.altmstid), at: s(n.at, 40), guid,
      ...(seenFrom ? { recorderSeen: seenFrom.recorderSeen as boolean } : {}), recorderLastAt: seenFrom ? s(seenFrom.recorderLastAt, 40) : "",
      start: pAlt !== null && (!guid || !pGuid || pGuid === guid) ? { altvchid: pAlt, altmstid: altOf(p.altmstid) } : null });
  }
  return out;
}
// round 19: a failed RPC of the beat is said with words (the company and the error), never swallowed; a function the
// database does not have (a cloud without migration 44) is said once per cold start, not every beat
const missingSaid = new Set<string>();
const missingFn = (m: string) => /could not find the function|function .* does not exist|schema cache|no such function/i.test(m);
function beatFail(fn: string, company: string, e: unknown) {
  const m = String((e as any)?.message ?? e ?? "").slice(0, 300);
  if (missingFn(m)) {
    if (missingSaid.has(fn)) return;
    missingSaid.add(fn);
    console.error(`tally-ingest beat: ${fn} is not in the database (migration 44 not run?), first for ${company}: ${m}. Said once until tally-ingest restarts`);
    return;
  }
  console.error(`tally-ingest beat: ${fn} failed for ${company}: ${m}`);
}
// round 19: the starting points asked in this run (book and company GUID): tally_start_point keeps it once in the database
// anyway, so it is called once per company per 5 minutes, not every beat (it takes the cursor's lock and writes). Review 46 H1
// (migration 46): its answer says whether the GUID is another company than the book's (otherCompany: needs_baseline, the
// point kept); bookGuid keeps the book's company GUID it answered. A company of another GUID gets no gap check (its numbers
// are not this book's), said once in the log. Asked again after 5 minutes so that the owner's baseline clear (the next call
// records afresh, migration 46) is seen
const startDone = new Map<string, { other: boolean; t: number }>();
const bookGuid = new Map<string, string>();
const otherSaid = new Set<string>();
// review 46 M1: the book of a company, per firm and company, for 5 minutes (not linked: 1 minute). tally_book_for writes
// tally_books (in the Realtime publication) at every call; a client unlinked or relinked is seen by the beat within that time
const bookMemo = new Map<string, { book: string | null; t: number }>();
async function bookForBeat(firm: string, name: string) {
  const k = firm + "|" + name, m = bookMemo.get(k);
  if (m && Date.now() - m.t < (m.book ? 300000 : 60000)) return m.book;
  const book = await bookFor(firm, name);
  if (bookMemo.size > 5000) bookMemo.clear();
  bookMemo.set(k, { book, t: Date.now() });
  return book;
}
// each company of the beat (either shape) with a GUID and an ALTVCHID: tally_start_point(firm, book, GUID, the bridge's starting
// numbers, else the numbers now) once per 5 minutes (migration 44, 46: kept once per book; another GUID never moves it and is
// answered {needsBaseline, otherCompany} without a gap check), then tally_recorder_gap_check(book,
// device, altvchid, at) (migration 44, 45): compared with what every PC's recorder lines (and the day books read) reached; the
// answer per company {gap, missing (UP TO: an upper bound on the changes not received), needsBaseline, startRecorded}. A company
// without a GUID gets the gap check alone (it records a starting point without the GUID). Never fails the beat
// FinCom Bridge 2.2.2: the lines this computer sent that the cloud holds without their entry (state 'held', received in the
// last 7 days, created / altered / imported, its company still linked to the same book, the entry's month not locked),
// oldest first, at most 200: the bridge asks Tally for each again by its MasterID (else its number) and sends it as
// <line_id>:resolved with Tally's own GUID and body; it uses nothing else of these rows as the entry's. Without the table
// (or on any error) the field is left out: the beat never fails for it
// 06-Oct-2026: only the lines of THIS bridge (the same computer key and the same bridge id, the column bridge): on a shared
// server every Windows user's bridge has its own lines (the owner's rule: no line from another user's session)
// Bridge 2.3.1 (2.2.2 review L-F): a line whose "<line id>:resolved" already reached FinCom is left out, as refetch does
// (a 2.2.1 bridge resolved it and kept no mark, so a later bridge asked Tally again and sent a duplicate ":resolved"); the
// same exception as refetch (2.3.1 H1: the only ":resolved" row held for want of a complete body) keeps it listed
async function heldLinesFor(dev: any, firm: string, bridge: string) {
  const out = await heldOwnLines(dev, firm, bridge, 200, () => true, "held lines", true);
  return out.length ? out : null;
}
// 06-Oct-2026 (the owner, NWS144 lines 4, 17 and 18: "the bridge must ask again for held lines of its own user and settle
// them"): refetch, at most 20 of this bridge's own held lines (the same computer key AND the same bridge id) whose entry's
// body is missing (body null, {} or without vouchers) or whose GUID is none or a placeholder ("<company GUID>-00000000"),
// with no "<line id>:resolved" line in FinCom's record yet (2.3.1, review H1: or only one, itself held without a complete body:
// listed once more, see heldOwnLines); the same fields and rules as heldLines (7 days, created /
// altered / imported, the company still linked to the same book, the month not locked, oldest first). A bridge
// built after 2.3.0 asks its own Tally for each again with the allow-listed reads (by MasterID, else by type and number), spaced and
// within its 2-second stop, never during a posting, and sends "<line id>:resolved" with Tally's GUID, AlterID and body,
// which the database applies once and marks the held line 'replaced' (migrations 50-52). An older bridge ignores the
// field. Left out when none or on any error: the beat never fails for it
const REFETCH_MAX = 20;
async function refetchFor(dev: any, firm: string, bridge: string) {
  const out = await heldOwnLines(dev, firm, bridge, REFETCH_MAX, (r) => {
    const g = String(r?.object_guid ?? "").trim(), b = r?.body;
    const noBody = !b || typeof b !== "object" || !Array.isArray(b.vouchers) || !b.vouchers.length;
    return noBody || !g || /-0{8}$/.test(g);
  }, "refetch", true);
  return out.length ? out : null;
}
// bridge 2.3.1, part B (masters): ledgersWanted, the ledgers this bridge's own held lines wait for (held with the words
// "waiting for the ledger ..." by ledgerWait, the line itself or its "<line id>:resolved"; the same computer key AND bridge
// id, the last 7 days, the company still linked to the same book) that the book's ledger list still has no row of: at most
// 20 [{company, company_guid, name}], oldest line first. The bridge asks its own Tally for each by its name (one request a
// ledger, FinComLedgerByName) and sends what Tally has as kind ledger_changes; the line is then listed for refetch. Left out
// when none or on any error: the beat never fails for it
const LEDGERS_WANTED_MAX = 20;
async function ledgersWantedFor(dev: any, firm: string, bridge: string) {
  try {
    if (!bridge) return null;
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data, error } = await db.from("tally_recorder_lines").select("line_id, company, company_guid, book_id, received_at, bridge, device_id, held_why, payload")
      .eq("firm_id", firm).eq("device_id", dev.id).eq("bridge", bridge).eq("state", "held").gt("received_at", since).order("received_at", { ascending: true }).limit(400);
    if (error || !Array.isArray(data)) return null;
    const rows = (data as any[]).filter((r) => r && String(r.device_id ?? "") === String(dev.id) && String(r.bridge ?? "") === bridge && Date.parse(String(r.received_at)) > Date.now() - 7 * 86400000 && waitsFor(r).length)
      .sort((a, b) => Date.parse(String(a.received_at)) - Date.parse(String(b.received_at)));
    if (!rows.length) return null;
    const s = (v: unknown, n: number) => typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, n) : "";
    const linked = new Map<string, string | null>(), still = new Map<string, LedgerWaitState | null>(), seen = new Map<string, Record<string, string>>();
    const out: Record<string, string>[] = [];
    for (const r of rows) {
      const company = s(r.company, 200), book = String(r.book_id || "");
      if (!company || !book) continue;
      if (!linked.has(company)) { try { linked.set(company, await bookForBeat(firm, company)); } catch { linked.set(company, null); } }
      if (linked.get(company) !== book) continue;
      if (!still.has(book)) still.set(book, await ledgerWaitState(book, rows.filter((x) => String(x.book_id || "") === book).flatMap(waitsFor)));
      const m = still.get(book);
      if (!m) continue;
      const holdAt = Date.parse(String(r.received_at));
      for (const name of waitsFor(r)) {
        const k = book + "|" + name;
        if (!stillMissing(m, name, holdAt)) continue;
        // re-review M-A: heldAt, the latest hold waiting for it: the bridge asks again unless it asked after that
        const had = seen.get(k);
        if (had) { if (Date.parse(had.heldAt) < holdAt) had.heldAt = new Date(holdAt).toISOString(); continue; }
        const e = { company, company_guid: s(r.company_guid, 100), name, heldAt: new Date(holdAt).toISOString() };
        seen.set(k, e);
        out.push(e);
        if (out.length >= LEDGERS_WANTED_MAX) return out;
      }
    }
    return out.length ? out : null;
  } catch (e) {
    console.log("tally-ingest beat: ledgers wanted not read:", String((e as Error)?.message || e).slice(0, 200));
    return null;
  }
}
// bridge 2.3.1 (review H1): a ":resolved" row held for want of a complete body: the guard's words (guard-230), or no body
const GUARD_WORDS = "the entry's details from Tally are incomplete";
function heldIncomplete(x: any): boolean {
  if (String(x?.state || "") !== "held") return false;
  const b = x?.body, noBody = !b || typeof b !== "object" || !Array.isArray(b.vouchers) || !b.vouchers.length;
  return noBody || String(x?.held_why || "").startsWith(GUARD_WORDS);
}
async function heldOwnLines(dev: any, firm: string, bridge: string, max: number, want: (r: any) => boolean, what: string, unresolved = false) {
  try {
    if (!bridge) return [];
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data, error } = await db.from("tally_recorder_lines").select("line_id, company, company_guid, event, master_id, vch_type, vch_no, vch_date, book_id, received_at, bridge, device_id, object_guid, body, held_why, payload")
      .eq("firm_id", firm).eq("device_id", dev.id).eq("bridge", bridge).eq("state", "held").in("event", ["created", "altered", "imported"]).gt("received_at", since)
      .order("received_at", { ascending: true }).limit(400);
    if (error || !Array.isArray(data) || !data.length) return [];
    let rows = (data as any[]).filter((r) => r && String(r.device_id ?? dev.id) === String(dev.id) && String(r.bridge ?? "") === bridge && Date.parse(String(r.received_at)) > Date.now() - 7 * 86400000 && want(r))
      .sort((a, b) => Date.parse(String(a.received_at)) - Date.parse(String(b.received_at)));
    if (unresolved && rows.length) {
      // a line whose ":resolved" line already reached FinCom (in any state) is not asked for again. Bridge 2.3.1 (review H1):
      // except when that ":resolved" line is the ONLY one and is itself held for want of a complete body (the cloud guard's
      // words "the entry's details from Tally are incomplete ...", or no body at all): a 2.3.0 bridge's refetch of an item
      // invoice, whose request did not fetch the items' ledger lines. Such a line is listed again, so that a 2.3.1 bridge asks
      // Tally once more and sends "<line id>:resolved" again (the same id: a second row; no migration). Once two ":resolved"
      // rows are here it is never listed again (asked once). When the second comes complete it is applied once and, by 50-53's
      // rules, replaces the held line (by its line id) and the earlier held ":resolved" row (the same GUID at an AlterID not
      // above its own); the earlier one never had a body, so it is never applied
      const rids = [...new Set(rows.map((r) => String(r.line_id || "") + ":resolved"))].slice(0, 400);
      // 2.3.1 (2.3.0 review round 3 L2): asked 60 ids at a time (400 in one URL could pass a gateway's limit and fail
      // quietly to an empty list); a failure is logged. 2.3.1 (masters): id, payload and received_at for the ledger wait
      const rs: any[] = [];
      for (let i = 0; i < rids.length; i += 60) {
        const { data: d, error: re } = await db.from("tally_recorder_lines").select("id, line_id, state, held_why, body, payload, received_at").eq("firm_id", firm).in("line_id", rids.slice(i, i + 60));
        if (re) { console.log("tally-ingest beat: " + what + ": the lines already resolved not read:", String(re.message || "").slice(0, 200)); return []; }
        rs.push(...(d || []));
      }
      const have = new Map<string, any[]>();
      for (const x of (rs || []) as any[]) {
        const k = String(x?.line_id || "");
        if (!have.has(k)) have.set(k, []);
        have.get(k)!.push(x);
      }
      rows = rows.filter((r) => {
        const xs = have.get(String(r.line_id || "") + ":resolved") || [];
        // bridge 2.3.1 (masters): the newest ":resolved" line held waiting for a ledger FinCom did not have (and the only one so
        // held): listed again with ledgerAgain once the ledger is in (below), so that the bridge asks Tally for the entry once
        // more and sends "<line id>:resolved" again (the same id), applied then; it replaces both held rows (50-53's rules)
        const newest = xs.slice().sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0) || Date.parse(String(b?.received_at)) - Date.parse(String(a?.received_at)))[0];
        if (newest && String(newest.state || "") === "held" && waitsFor(newest).length) {
          if (xs.length > 2 || xs.filter((x) => waitsFor(x).length).length > 1) return false;
          r._waits = waitsFor(newest); r._ledgerAgain = true; r._holdAt = Date.parse(String(newest.received_at));
          return true;
        }
        return !xs.length || (xs.length === 1 && heldIncomplete(xs[0]) && !waitsFor(xs[0]).length);
      });
    }
    // bridge 2.3.1 (masters): a line waiting for a ledger FinCom did not have is listed (heldLines, refetch) only once every
    // ledger it waits for is in the book's ledger list; until then the bridge fetches the ledgers (ledgersWanted)
    for (const r of rows) if (!r._waits) r._waits = waitsFor(r);
    const waiting = rows.filter((r) => r._waits.length);
    if (waiting.length) {
      const byBook = new Map<string, string[]>();
      for (const r of waiting) byBook.set(String(r.book_id || ""), [...(byBook.get(String(r.book_id || "")) || []), ...r._waits]);
      const still = new Map<string, LedgerWaitState | null>();
      for (const [b, ns] of byBook) still.set(b, b ? await ledgerWaitState(b, ns) : null);
      rows = rows.filter((r) => {
        if (!r._waits.length) return true;
        const m = still.get(String(r.book_id || ""));
        const holdAt = Number.isFinite(r._holdAt) ? r._holdAt : Date.parse(String(r.received_at));
        return !!m && !r._waits.some((n: string) => stillMissing(m, n, holdAt));
      });
    }
    const books = [...new Set(rows.map((r) => String(r.book_id || "")).filter(Boolean))];
    const locked = new Set<string>();
    if (books.length) {
      const { data: lk, error: le } = await db.from("tally_month_locks").select("book_id, month").in("book_id", books).is("unlocked_at", null);
      if (!le && Array.isArray(lk)) for (const l of lk as any[]) locked.add(String(l.book_id) + "|" + String(l.month || "").slice(0, 7));
    }
    const linked = new Map<string, string | null>();
    const s = (v: unknown, n: number) => typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, n) : "";
    const out: Record<string, unknown>[] = [];
    for (const r of rows) {
      const lid = s(r.line_id, 80), company = s(r.company, 200), day = s(r.vch_date, 10);
      if (!lid || lid.endsWith(":resolved") || !company || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (locked.has(String(r.book_id) + "|" + day.slice(0, 7))) continue;
      if (!linked.has(company)) { try { linked.set(company, await bookForBeat(firm, company)); } catch { linked.set(company, null); } }
      if (!r.book_id || linked.get(company) !== String(r.book_id)) continue;
      out.push({ line_id: lid, company, company_guid: s(r.company_guid, 100), event: s(r.event, 20), master_id: s(r.master_id, 40), vch_type: s(r.vch_type, 60),
        vch_no: s(r.vch_no, 60), vch_date: day.replace(/-/g, ""), ...(r._ledgerAgain ? { ledgerAgain: true } : {}) });
      if (out.length >= max) break;
    }
    return out;
  } catch (e) {
    console.log("tally-ingest beat: " + what + " not read:", String((e as Error)?.message || e).slice(0, 200));
    return [];
  }
}
async function recorderGaps(dev: any, firm: string, bridge: string, changes: BeatChange[]) {
  const out: Record<string, unknown> = {};
  for (const c of changes.filter((c) => c.altvchid !== null || (c.start && c.guid)).slice(0, 20)) {
    let book: string | null = null;
    try { book = await bookForBeat(firm, c.name); } catch (e) { beatFail("tally_book_for", c.name, e); continue; }
    if (!book) continue;
    let started = false;
    const sAlt = c.start ? c.start.altvchid : c.altvchid, sMst = c.start ? c.start.altmstid : c.altmstid, key = book + "|" + c.guid;
    const sd = startDone.get(key);
    if (c.guid && sAlt !== null && !(sd && Date.now() - sd.t < 300000)) {
      try {
        const { data, error } = await db.rpc("tally_start_point", { p_firm: firm, p_book: book, p_guid: c.guid, p_altvch: sAlt, p_altmst: sMst, p_device: dev.id, p_bridge: bridge });
        if (error) beatFail("tally_start_point", c.name, error);
        else {
          const d = data as any;
          if (startDone.size > 5000) startDone.clear();
          startDone.set(key, { other: d?.otherCompany === true, t: Date.now() }); started = d?.set === true;
          if (typeof d?.bookGuid === "string" && d.bookGuid) { if (bookGuid.size > 5000) bookGuid.clear(); bookGuid.set(book, d.bookGuid); }
          if (started) console.log("tally-ingest beat: starting point recorded", c.name, JSON.stringify({ guid: c.guid, startVoucher: (data as any)?.startVoucher, startMaster: (data as any)?.startMaster }));
        }
      } catch (e) { beatFail("tally_start_point", c.name, e); }
    }
    const bg = bookGuid.get(book);
    if (c.guid && (startDone.get(key)?.other === true || (bg && bg !== c.guid))) {
      if (!otherSaid.has(key)) {
        if (otherSaid.size > 5000) otherSaid.clear();
        otherSaid.add(key);
        console.log(`tally-ingest beat: ${c.name}: Tally company GUID ${c.guid} is another company than the book's (${bg || "not known"}): needs_baseline, the starting point kept, no gap check for it (said once)`);
      }
      out[c.name] = { gap: null, missing: 0, needsBaseline: true, otherCompany: true };
      continue;
    }
    if (c.altvchid === null) { if (started) out[c.name] = { gap: null, missing: 0, startRecorded: true }; continue; }
    try {
      const { data, error } = await db.rpc("tally_recorder_gap_check", { p_book: book, p_device: dev.id, p_altvchid: c.altvchid, p_at: atOf(c.at) });
      if (error) { beatFail("tally_recorder_gap_check", c.name, error); continue; }
      const d = data as any;
      out[c.name] = { gap: d?.gap ?? null, missing: d?.missing ?? 0, ...(d?.needsBaseline ? { needsBaseline: true } : {}), ...(d?.startRecorded || started ? { startRecorded: true } : {}) };
    } catch (e) { beatFail("tally_recorder_gap_check", c.name, e); }
  }
  return out;
}
// 2.1.8: the owner's per-computer posting settings as the bridge applied them, said in its beat: postBatchBills /
// postBatchBank (1..500, or null when not a number), settingsAt (a string, cut to 40); nothing kept when none is sent
function postSettingsApplied(b: any) {
  if (!b || typeof b !== "object" || !("postBatchBills" in b || "postBatchBank" in b || "settingsAt" in b)) return {};
  return { postBatchBills: cleanBatch(b.postBatchBills), postBatchBank: cleanBatch(b.postBatchBank), settingsAt: typeof b.settingsAt === "string" ? b.settingsAt.slice(0, 40) : "" };
}
function cleanBatch(v: unknown) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v))) return null;
  return Math.max(1, Math.min(500, Math.floor(Number(v))));
}
// postOnly: an array of company names, strings only, trimmed, each cut to 200, at most 20, blanks dropped
function cleanPostOnly(x: unknown) {
  return (Array.isArray(x) ? x : []).filter((v) => typeof v === "string").map((v) => v.trim().slice(0, 200)).filter(Boolean).slice(0, 20);
}
// round 2 (migration-34): allowlist:{measured, hash} in the beat; anything else is not kept
function cleanAllowlist(x: any) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  return { measured: x.measured === true, hash: typeof x.hash === "string" ? x.hash.slice(0, 80) : "" };
}
// the bridges heard from, with this one brought up to date: at most 200 (the owner's rule of 05-Oct-2026: no limit by
// user or number of bridges; was 12), none silent for more than 60 days
function bridgesWith(info: any, id: string, entry: any) {
  const old = info?.bridges && typeof info.bridges === "object" ? info.bridges : {};
  const cut = Date.now() - 60 * 86400000;
  const kept = Object.entries({ ...old, [id]: entry }).filter(([, v]: any) => Date.parse(v?.at || "") > cut)
    .sort((a: any, b: any) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 200);
  return Object.fromEntries(kept);
}
// may this bridge post? The owner's rule of 05-Oct-2026 (migration 54's tally_bridge_may_post): the main-bridge rule holds
// only among ONE Windows user's bridges. The main one chosen (tally_devices.main_bridge) stops only the other bridges of
// its own Windows user on that key; on a key shared by several Windows users (1.15.0's settings carried over), another
// user's main bridge stops nobody. user: this bridge's Windows user (its beat's), else as its line says
const winUser = (v: unknown) => String(v ?? "").trim().toLowerCase();
function mayPost(dev: any, id: string, user?: string) {
  const m = dev?.main_bridge;
  if (!m || m === id) return true;
  const bs = dev?.info?.bridges && typeof dev.info.bridges === "object" ? dev.info.bridges : {};
  if (!bs[m]) return true;
  return winUser(bs[m].user) !== winUser(user !== undefined ? user : bs[id]?.user);
}
// a posting naming no bridge (queued before migration 54) is the key's main bridge's, as before: the main one chosen, else any
function isMain(dev: any, id: string) { return !dev?.main_bridge || dev.main_bridge === id; }
// migration 54 (FinCom Bridge 2.3.0): the owner's "Changes only" for a bridge (tally_bridge_prefs): it reads Tally's changes
// and is never given a posting. False on a cloud without the table
const CHANGES_ONLY = "This bridge is set to changes only in FinCom (Tally page): it reads Tally's changes and never posts.";
async function changesOnly(dev: any, id: string) {
  const { data, error } = await db.from("tally_bridge_prefs").select("changes_only").eq("device_id", dev.id).eq("bridge_id", id).maybeSingle();
  // 2.3.1 (2.3.0 review, cloud Lows): an error is logged (a cloud without the table says nothing, as before)
  if (error && !missingRel(error)) console.error("tally-ingest: tally_bridge_prefs (changes only) not read", dev.id, id, String(error.message || "").slice(0, 200));
  return !error && data?.changes_only === true;
}
// a cloud without the table or column asked (an older migration): PostgREST's PGRST204/205, PostgreSQL's 42P01/42703
const missingRel = (e: any) => ["PGRST204", "PGRST205", "42P01", "42703"].includes(String(e?.code || "")) || /does not exist|schema cache/i.test(String(e?.message || ""));
// review M-B (migration 54): a bridge refused postings (not the main one, changes only, test mode) never leaves a posting
// waiting for ever: the computer's waiting postings that no bridge of it may take are moved to its bridge that may post,
// else failed in plain words (tally_post_rescue; never to another computer key). Never fails the call; a cloud without
// the function: as before
async function rescuePosts(dev: any) {
  const { error } = await db.rpc("tally_post_rescue", { p_device: dev.id });
  if (error && error.code !== "PGRST202" && !missingFn(String(error.message || ""))) console.error("tally-ingest: tally_post_rescue", dev.id, error.message);
}
// the waiting postings this bridge may take: those naming it (tally_post_jobs.target_bridge), and those naming none when it
// is the computer's main bridge; a cloud without migration 54 (no column): every waiting posting of the computer, when main
async function postsFor(dev: any, id: string, main: boolean) {
  const { data, error } = await db.from("tally_post_jobs").select("id, target_bridge").eq("device_id", dev.id).eq("status", "waiting");
  if (error) {
    if (!main) return 0;
    const { count } = await db.from("tally_post_jobs").select("id", { count: "exact", head: true }).eq("device_id", dev.id).eq("status", "waiting");
    return count || 0;
  }
  return (data || []).filter((j: any) => j.target_bridge === id || (!j.target_bridge && main)).length;
}
// migration 55 (the owner's decision B, 05-Oct-2026): the checks "Not in Tally - post again" asks of this bridge (its
// computer's postings that name it, or name none when it is the main one): the company, the entry and its voucher. A cloud
// without 55 (or any error): none, as before
async function checksFor(dev: any, id: string, main: boolean) {
  try {
    const { data, error } = await db.rpc("tally_post_checks_for", { p_device: dev.id, p_bridge: id, p_main: main });
    return !error && Array.isArray(data) ? data.slice(0, 20) : [];
  } catch (_) { return []; }
}


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
// bridge 2.3.1 (the owner's last change): a request not answered in time and when the bridge tries again by itself
// (tallyRetry {words, at, next, tries}); the bridge never stops reading by itself any more. Kept on the bridge's entry and
// the beat for the Tally page's plain words; absent when the background requests go as normal (or an older bridge)
function cleanTallyRetry(x: any) {
  if (!x || typeof x !== "object" || typeof x.words !== "string" || !x.words.trim()) return null;
  const t = (v: unknown) => typeof v === "string" ? v.slice(0, 30) : "";
  return { words: x.words.slice(0, 200), at: t(x.at), next: t(x.next), tries: Math.max(0, Math.min(1e6, Math.floor(Number(x.tries) || 0))) };
}
const tallyRetryOf = (b: any) => { const r = cleanTallyRetry(b?.tallyRetry); return r ? { tallyRetry: r } : {}; };
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
    if (!rl.error) {
      // the owner's rule of 05-Oct-2026 (migration 54): no pilot, no approval. The newest version goes to every computer
      // by itself ({newest, allowed}: the newest on FinCom's signed list, latest.json; version: the newest a row names
      // that is not held, for an older bridge that needs one named), except the versions the firm's owner HELD or
      // withdrew (held); the owner's "Roll back to <version>" (tally_bridge_rollbacks, not cleared) instead names that
      // version as a rollback. A cloud without migration 54 (no tally_bridge_rollbacks): no rollback
      const blocked = (r: any) => !!(r.held_at || r.withdrawn_at);
      const held = [...new Set(rows.filter(blocked).map((r: any) => String(r.version)))].sort(newer);
      const free = rows.filter((r: any) => !blocked(r)).sort((a: any, b: any) => newer(b.version, a.version))[0];
      const rbq = await db.from("tally_bridge_rollbacks").select("version, set_at").eq("firm_id", firm).is("cleared_at", null);
      const rb = rbq.error ? null : (rbq.data || []).filter((x: any) => VERSION.test(String(x?.version || ""))).sort((a: any, b: any) => String(b.set_at || "").localeCompare(String(a.set_at || "")))[0];
      out.release = rb ? { version: rb.version, allowed: true, rollback: true } : { newest: true, allowed: true, held, ...(free ? { version: free.version } : {}) };
    }
    if (rows.length) {
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
// final review M3: {kind: "own_key", oldKey, bridge}: the bridge, given a new computer key by its member's FinCom page,
// moves its identity from the old key (shared with another Windows user's bridge) to the new one. The old key must be a
// key of the same firm, not removed, that FinCom knows; the database checks the rest (tally_bridge_own_key_move: the id
// bound to the old key under that Windows user, the new key made by a member within 15 minutes, nothing else on it)
async function ownKey(dev: any, firm: string, body: any) {
  const me = body?.bridge && typeof body.bridge === "object" ? body.bridge : {};
  const bid = String(me.id || ""), oldKey = String(body.oldKey || "").trim();
  if (!/^go-[0-9a-f]{6,32}$/.test(bid)) return reply(400, { ok: false, error: "Not a FinCom Bridge id." });
  if (!/^fcd_[0-9a-f]{48}$/.test(oldKey)) return reply(400, { ok: false, error: "The old computer key is missing." });
  const { data: old } = await db.from("tally_devices").select("id, firm_id, revoked").eq("key_hash", await sha256(oldKey)).maybeSingle();
  if (!old || old.revoked || old.firm_id !== firm || old.id === dev.id) return reply(403, { ok: false, error: "Not moved: the old computer key is not a key of this firm that FinCom knows." });
  const { data, error } = await db.rpc("tally_bridge_own_key_move", { p_bridge: bid, p_from: old.id, p_to: dev.id, p_user: String(me.user || "").slice(0, 120) });
  if (error) return (error.code === "PGRST202" || missingFn(String(error.message || ""))) ? reply(409, { ok: false, error: "FinCom's cloud is not ready for this yet (migration 54)." }) : reply(500, { ok: false, error: error.message });
  console.log("tally-ingest: own_key", bid, old.id, "->", dev.id, JSON.stringify(data));
  return reply(data && (data as any).ok === false ? 409 : 200, data);
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
  if (kind === "posts_take" || kind === "posts_update" || kind === "post_check") {
    if (kind === "posts_take") await rescuePosts(dev);   // review M-B: a posting for this bridge before it went to test mode is not left waiting
    return reply(403, { ok: false, error: "A bridge in test mode does not post." });
  }
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
    if (me.id !== "v1") await rescuePosts(dev);   // review M-B: a bridge now in test mode does not post: its postings are not left waiting
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
const dayVouchers = (r: any) => r.vouchers.map((v: any) => ({ guid: v.guid, alter: v.alter, type: v.type, no: v.no, party: cleanName(v.party), narr: v.narr, cancel: v.cancel, opt: v.opt, gstin: v.gstin, pos: v.pos, ref: v.ref, refDate: v.refDate, cmp: v.cmp, fid: v.fid ?? null,   // fid (migration 37): the TDSDesk id from the full narration
  ...partA(v) }));
// bridge 2.3.1 part A (migration 57): the rest of the entry, read by parse.js the same way on both paths (the days path and
// the recorder's entry body): the e-invoice and e-way bill, the items, cost centres, bank and TDS details, due dates given
// as dates, and the accuracy checks' plain words (none: []). Names cleaned as every other name. A voucher a parser without
// part A read (none of these keys) carries none of them: the database then keeps what it has (never blanked)
function partA(v: any): Record<string, unknown> {
  if (!Array.isArray(v?.items)) return {};
  const nm = (x: any) => ({ ...x, ledger: cleanName(String(x.ledger || "")) });
  return { irn: v.irn || "", ackNo: v.ackNo || "", ackDate: v.ackDate || "", eway: v.eway || "",
    items: v.items.map((x: any) => ({ ...x, item: cleanName(String(x.item || "")) })), costs: (v.costs || []).map(nm), banks: (v.banks || []).map(nm),
    tds: (v.tds || []).map((x: any) => ({ ...nm(x), party: cleanName(String(x.party || "")) })), dues: (v.dues || []).map(nm), checks: Array.isArray(v.checks) ? v.checks : [] };
}
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
    const args = { p_firm: firm, p_book: book, p_holder: me.id, p_device: dev.id, p_ttl: ttl, p_info: { computer: me.entry.computer, user: me.entry.user, version: me.entry.version } };
    // migration 55 (decision D): the lease's purpose (post / read): a posting finding a read records "want to post", the
    // reader yields on its renewal; a bridge that says none (older), or a cloud without 55: the 6-argument call as before
    const purpose = body.purpose === "post" || body.purpose === "read" ? body.purpose : null;
    let { data, error } = purpose ? await db.rpc("tally_lease_take", { ...args, p_purpose: purpose }) : await db.rpc("tally_lease_take", args);
    if (error && purpose && (error.code === "PGRST202" || missingFn(String(error.message || "")))) ({ data, error } = await db.rpc("tally_lease_take", args));
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
// bridge 2.3.1 (parts A and B): the party's deductee type (TDSDEDUCTEETYPE, a ledger master field; the owner asked for it
// with the TDS details) is the 11th column of a ledger_list / ledger_changes row, kept in tally_ledgers.tds_deductee_type
// (migration 57: text, not null, default ''). Absent (a row of 10 columns): left as it is; "" clears it
const DTYPE = "tds_deductee_type";
function deducteeType(l: any): string | null {
  return Array.isArray(l) && l.length > 10 ? String(l[10] ?? "").trim().slice(0, 100) : null;
}
// the ledgers upserted; refused for want of 57's column (the cloud's update out before 57 ran, the column check cached):
// the same rows again without it, and the check remembered as "not there"
async function upsertLedgers(rows: Record<string, unknown>[]) {
  let { error } = await db.from("tally_ledgers").upsert(rows, { onConflict: "book_id,name" });
  if (error && rows.some((r) => DTYPE in r) && String(error.message || "").includes(DTYPE)) {
    colCache.set("tally_ledgers:" + DTYPE, { ok: false, at: Date.now() });
    ({ error } = await db.from("tally_ledgers").upsert(rows.map(({ [DTYPE]: _drop, ...r }) => r), { onConflict: "book_id,name" }));
  }
  return error;
}
async function applyLedgerList(firm: string, book: string, body: any, dev?: any, me?: { id: string; entry: any }) {
  const s = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const m32 = await hasCols("tally_ledgers", "tally_guid, alter_id, deleted_at");
  const m31 = await hasCols("tally_ledgers", "before_clean");
  const m28 = await hasCols("tally_ledgers", "gstin, pan");
  const m40 = await hasCols("tally_ledgers", "state");            // migration 40: Tally's LEDSTATENAME (the bridge's 10th column)
  const m57 = await hasCols("tally_ledgers", DTYPE);              // migration 57: the party's deductee type (the 11th column, 2.3.1)
  const notes: string[] = [];
  const out = { ok: true, ledgers: 0, added: 0, renamed: 0, deleted: 0, deletesHeld: 0, deletedIgnored: 0, groups: 0, round: "", notes };
  const now = new Date().toISOString();
  const cols = "name, parent" + (m32 ? ", tally_guid, deleted_at" : "") + (m31 ? ", before_clean" : "");
  // the rows: one per clean name
  const seen = new Set<string>();
  const rows = (Array.isArray(body.ledgers) ? body.ledgers : []).slice(0, 5000).map((l: any) => ({
    guid: s(l?.[0], 100).trim(), alter: Math.max(0, Math.floor(Number(l?.[2]) || 0)), name: cleanName(s(l?.[3], 300)),
    parent: cleanName(s(l?.[4], 300)).replace(/^\W*Primary$/i, ""), open: Math.round(amt(l?.[5]) * 100) / 100,
    gstin: s(l?.[6], 15).trim().toUpperCase(), pan: s(l?.[7], 10).trim().toUpperCase(), oc: !!Number(l?.[8]), state: s(l?.[9], 60).trim(), dtype: deducteeType(l) }))
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
    if (m57 && r.dtype !== null) o[DTYPE] = r.dtype;   // 2.3.1: sent (blank too): as Tally has it; absent: left as it is
    if (m32) { o.tally_guid = r.guid && (!owner.has(r.guid) || owner.get(r.guid) === r.name) ? r.guid : null; o.alter_id = r.alter; o.deleted_at = null; }
    return o;
  };
  const fresh = rows.filter((r: any) => !have.has(r.name)).map((r: any) => ({ ...base(r), open: r.open, open_sent: r.open }));
  const opened = rows.filter((r: any) => have.has(r.name) && r.oc).map((r: any) => ({ ...base(r), open: r.open, open_sent: r.open }));
  const plain = rows.filter((r: any) => have.has(r.name) && !r.oc).map(base);
  for (const set of [fresh, opened, plain]) {
    for (let i = 0; i < set.length; i += 1000) {
      const error = await upsertLedgers(set.slice(i, i + 1000));
      if (error) throw new Error(error.message);
    }
  }
  out.added = fresh.length;
  await endStaleAliases(book, rows);     // review H2: the full ledger list proves aliases stale too (migration 59)
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
// Bridge 2.3.1, part B (the owner's scope of 06-Oct-2026, masters): {kind:"ledger_changes", company, company_guid, ledgers:
// [[guid, masterId, alterId, name, group, opening, gstin, pan, openingChanged, state, deducteeType]] (the ledger list's row shape, at most
// 2000), why: "counter" (the ledgers created or altered since Tally's master counter last moved; after, upto: the AlterID
// span) | "wanted" (a ledger an entry uses that FinCom did not have)} -> {ok, ledgers, added, updated, kept:[words]}. Keeps
// name, group, GSTIN, PAN, state and opening balance current and nothing else: a new ledger is added (its group's chain from
// the groups FinCom has); a ledger FinCom has (by Tally's GUID, else by its name) gets GSTIN, PAN, state (when Tally gives one),
// AlterID and, when Tally's opening is not the one it last sent (open_sent), the opening. Never marks a ledger gone or brings
// one back, never renames, never moves a ledger to another group, never adds or changes a group (2.3.2): a GUID FinCom has
// under another name, or a ledger in another group than FinCom's, keeps FinCom's name and group and is said in kept (the
// bridge logs it). A row older than FinCom's (a lower AlterID) changes nothing. No round, no seen list, no deleted list.
// The openings of the year are worked out again when a ledger is added or its opening changes. At most 60 calls a minute
// from one computer (shared with ledger_list). No migration of its own (the columns of 28, 32 and 40, each used when there);
// the 11th column, the party's deductee type, goes to 57's tds_deductee_type when 57 is there
async function applyLedgerChanges(firm: string, book: string, body: any) {
  const s = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const m32 = await hasCols("tally_ledgers", "tally_guid, alter_id, deleted_at");
  const m28 = await hasCols("tally_ledgers", "gstin, pan");
  const m40 = await hasCols("tally_ledgers", "state");
  const m57 = await hasCols("tally_ledgers", DTYPE);
  const why = body.why === "wanted" ? "wanted" : "counter";
  const kept: string[] = [];
  const out = { ok: true, ledgers: 0, added: 0, updated: 0, kept };
  const seen = new Set<string>();
  const rows = (Array.isArray(body.ledgers) ? body.ledgers : []).slice(0, 2000).map((l: any) => ({
    guid: s(l?.[0], 100).trim(), alter: Math.max(0, Math.floor(Number(l?.[2]) || 0)), name: cleanName(s(l?.[3], 300)),
    parent: cleanName(s(l?.[4], 300)).replace(/^\W*Primary$/i, ""), open: Math.round(amt(l?.[5]) * 100) / 100,
    gstin: s(l?.[6], 15).trim().toUpperCase(), pan: s(l?.[7], 10).trim().toUpperCase(), state: s(l?.[9], 60).trim(), dtype: deducteeType(l) }))
    .filter((r: any) => r.name && !seen.has(r.name) && seen.add(r.name));
  out.ledgers = rows.length;
  if (!rows.length) return reply(200, out);
  const { data: allG, error: eg } = await db.from("tally_groups").select("name, parent").eq("book_id", book);
  if (eg) throw new Error(eg.message);
  const up = new Map((allG || []).map((g: any) => [String(g.name).toLowerCase(), g.parent || ""]));
  const chain = (p: string) => { const c: string[] = []; while (p && c.length < 30 && !c.some((x) => x.toLowerCase() === p.toLowerCase())) { c.push(p); p = up.get(p.toLowerCase()) || ""; } return c; };
  const cols = "name, parent, open, open_sent" + (m32 ? ", tally_guid, alter_id" : "");
  const byGuid = new Map<string, any>(m32 ? (await selectIn(cols, book, "tally_guid", rows.map((r: any) => r.guid).filter(Boolean))).map((g: any) => [String(g.tally_guid), g]) : []);
  const byName = new Map<string, any>((await selectIn(cols, book, "name", rows.map((r: any) => r.name))).map((g: any) => [String(g.name), g]));
  const fresh: Record<string, unknown>[] = [], opened: Record<string, unknown>[] = [], plain: Record<string, unknown>[] = [];
  const aliases: Record<string, unknown>[] = [];
  for (const r of rows) {
    const g = r.guid ? byGuid.get(r.guid) : undefined, have = g || byName.get(r.name);
    if (!have) {
      const c = chain(r.parent);
      const o: Record<string, unknown> = { book_id: book, firm_id: firm, name: r.name, parent: r.parent, chain: c, primary_group: c.length ? c[c.length - 1] : "", open: r.open, open_sent: r.open };
      if (m28) { o.gstin = r.gstin || null; o.pan = r.pan || null; }
      if (m40 && r.state) o.state = r.state;
      if (m57 && r.dtype !== null) o[DTYPE] = r.dtype;
      if (m32) { o.tally_guid = r.guid || null; o.alter_id = r.alter; }
      fresh.push(o);
      continue;
    }
    if (m32 && have.alter_id !== null && have.alter_id !== undefined && Number(have.alter_id) > r.alter) continue;   // FinCom has a newer one
    if (have.name !== r.name) {
      kept.push(("'" + have.name + "' is named '" + r.name + "' in Tally now: the rename is left for 2.3.2 (the name stays)").slice(0, 300));
      // 2.3.1 (the owner's decision of 06-Oct-2026, migration 59): the same Tally GUID under a new name: recorded, so an entry
      // using the new name is applied under FinCom's ledger without asking Tally again (and 2.3.2 has the rename to make).
      // Only by GUID, and only when no other ledger of FinCom's has the new name
      if (g !== undefined && r.guid && !byName.has(r.name)) {
        // review H2: a fetch by this very name (why "wanted") confirms the GUID; the counter's sighting records it unconfirmed
        const at = new Date().toISOString();
        aliases.push({ book_id: book, firm_id: firm, tally_name: r.name, fincom_name: have.name, tally_guid: r.guid, seen_at: at, ended_at: null, confirmed_at: why === "wanted" ? at : null });
      }
    }
    if (String(have.parent || "") !== r.parent) kept.push(("'" + have.name + "' is in the group '" + (r.parent || "Primary") + "' in Tally, '" + (have.parent || "Primary") + "' in FinCom: the move is left for 2.3.2 (the group stays)").slice(0, 300));
    if (m32 && g === undefined && have.tally_guid && r.guid && have.tally_guid !== r.guid) kept.push(("'" + have.name + "' has another Tally GUID in FinCom: its fields are brought up to date, the GUID stays").slice(0, 300));
    const c = chain(String(have.parent || ""));
    const o: Record<string, unknown> = { book_id: book, firm_id: firm, name: have.name, parent: have.parent ?? "", chain: c, primary_group: c.length ? c[c.length - 1] : "" };
    if (m28) { o.gstin = r.gstin || null; o.pan = r.pan || null; }
    if (m40 && r.state) o.state = r.state;
    if (m57 && r.dtype !== null) o[DTYPE] = r.dtype;
    if (m32) { o.alter_id = r.alter; if (!have.tally_guid && r.guid && !byGuid.has(r.guid)) o.tally_guid = r.guid; }
    const was = have.open_sent ?? have.open, sent = was === null || was === undefined ? null : Math.round(Number(was) * 100) / 100;
    if (sent === null || sent !== r.open) opened.push({ ...o, open: r.open, open_sent: r.open });
    else plain.push(o);
  }
  // one upsert per shape (the same keys in every row of a call)
  const shape = (o: Record<string, unknown>) => Object.keys(o).sort().join(",");
  for (const set of [fresh, opened, plain]) {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const o of set) groups.set(shape(o), [...(groups.get(shape(o)) || []), o]);
    for (const g of groups.values()) {
      for (let i = 0; i < g.length; i += 1000) {
        const error = await upsertLedgers(g.slice(i, i + 1000));
        if (error) throw new Error(error.message);
      }
    }
  }
  out.added = fresh.length; out.updated = opened.length + plain.length;
  await endStaleAliases(book, rows);     // review H2: before the new ones are recorded
  if (aliases.length) {
    const { error } = await db.from("tally_ledger_aliases").upsert(aliases, { onConflict: "book_id,tally_name" });
    if (error) console.log("tally-ingest ledger_changes: the new names not recorded (migration 59):", book, String(error.message || "").slice(0, 200));
    else for (const a of aliases) kept.push(("entries using '" + a.tally_name + "' are applied under '" + a.fincom_name + "' until 2.3.2 renames it").slice(0, 300));
  }
  if (fresh.length || opened.length) {
    const { error } = await db.rpc("tally_year_openings", { p_book: book });
    if (error) kept.push(("year openings: " + error.message).slice(0, 300));
  }
  console.log("tally-ingest ledger_changes", book, why, JSON.stringify({ ...out, after: body.after ?? null, upto: body.upto ?? null, kept: kept.slice(0, 5) }));
  return reply(200, out);
}
// Migration 45: the posting window of a job's last posts_update, {a0, a1, vouchersCreated, mastersCreated, guid}: whole numbers
// 0..10^15 (below), a1 not below a0; anything else ignored with a log line. guid: the company GUID the bridge read in its
// company check (the review's M1: the gap check counts a window only for the book's own company GUID). Saved only after the
// update's own checks passed (the review's L8: never for a cancelled job, a late or a settled update). Never fails the
// update (a cloud without 45: skipped)
const WIN_MAX = 1e15;
const winNum = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < WIN_MAX ? v : typeof v === "string" && /^\d{1,15}$/.test(v) && Number(v) < WIN_MAX ? Number(v) : null;
async function postWindow(firm: string, dev: any, job: string, w: any) {
  const a0 = winNum(w?.a0), a1 = winNum(w?.a1), vch = winNum(w?.vouchersCreated ?? 0), mst = winNum(w?.mastersCreated ?? 0);
  if (!w || typeof w !== "object" || a0 === null || a1 === null || vch === null || mst === null || a1 < a0) {
    console.log("tally-ingest posts_update: posting window ignored (whole numbers 0..10^15, a1 not below a0)", job, JSON.stringify(w).slice(0, 200));
    return;
  }
  try {
    const guid = typeof w.guid === "string" ? w.guid.trim().slice(0, 100) : typeof w.companyGuid === "string" ? w.companyGuid.trim().slice(0, 100) : "";
    const { data, error } = await db.rpc("tally_post_window_save", { p_firm: firm, p_job: job, p_device: dev.id, p_a0: a0, p_a1: a1, p_vch: vch, p_mst: mst, p_guid: guid || null });
    if (error) { if (!/could not find|does not exist|schema cache|no such function/i.test(String(error.message || ""))) console.log("tally-ingest posts_update: posting window", job, String(error.message || "").slice(0, 200)); return; }
    if ((data as any)?.ok === false) console.log("tally-ingest posts_update: posting window not kept", job, String((data as any)?.error || "").slice(0, 200));
  } catch (e) { console.log("tally-ingest posts_update: posting window", job, (e as Error).message); }
}
// Phase 2 (migration 44): the recorder's lines. Each line is cleaned (strings cut, known events only, the voucher's XML
// read with parse.js into the days path's shape: [{guid, alter, type, no, party, narr, cancel, opt, gstin, pos, ref,
// refDate, cmp, fid, day}] and [[guid, ledger, amount, hsn, rate, bills]]), then tally_recorder_apply stores every line
// and applies it once (the same change from two computers: 'duplicate'). A line with no GUID is held there, never a new row
// review 47/48 L5: a database error's own text goes to the function's log only; the caller gets plain words
function dbFail(where: string, error: any, words: string) {
  console.error("tally-ingest " + where + ":", String(error?.code || ""), String(error?.message || error || "").slice(0, 500));
  return new Error(words);
}
const RECORDER_EVENTS = new Set(["created", "altered", "deleted", "cancelled", "imported", "ledger_created", "ledger_altered", "ledger_renamed", "ledger_deleted"]);
// next-masterhook (migration 66): the add-on's master forms (Pay Head, Stock Item, Godown: the ones it hooks, proven on real
// TallyPrime 7.1), HEADS ONLY: kept in tally_recorder_masters by tally_recorder_masters_save, never applied to the books, never
// with a body. Review L3 of 2.4.0 part 2: a Unit or Employee line (not hooked, not proven) is refused, 'failed' with words
const MASTER_EVENTS = new Set(["master_created", "master_altered", "master_deleted"]);
const MASTER_TYPES = new Set(["Pay Head", "Stock Item", "Godown"]);
function cleanMasterLine(x: any, me: { id: string }): { line?: Record<string, unknown>; bad?: string } {
  const s = (v: unknown, n: number) => typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, n) : "";
  const mt = s(x?.master_type, 40);
  if (!MASTER_TYPES.has(mt)) return { bad: "unknown master type: " + (mt || "(none)") };
  const alterN = Number(x?.alter_id), alter = x?.alter_id !== null && x?.alter_id !== "" && Number.isInteger(alterN) && alterN >= 0 && alterN < 1e15 ? alterN : null;
  const at = Date.parse(s(x?.saved_at, 40));
  return { line: { line_id: s(x?.line_id, 80), event: s(x?.event, 40), master_type: mt, name: cleanName(s(x?.name, 300)) || null, parent: cleanName(s(x?.parent, 300)) || null,
    object_guid: s(x?.object_guid, 100) || null, master_id: s(x?.master_id, 40), alter_id: alter, saved_at: isNaN(at) ? null : new Date(at).toISOString(),
    pc: s(x?.pc, 60), user: s(x?.user, 60), company_guid: s(x?.company_guid, 100), bridge: me.id } };
}
const MAX_RECORDER_LINES = 500, MAX_RECORDER_XML = 2 * 1024 * 1024, QUEUE_OVER = 50;
const notReady44 = (e: any) => !!e && /tally_recorder_apply|tally_start_point|could not find|does not exist|schema cache/i.test(String(e.message || ""));
function cleanRecorderLine(x: any, me: { id: string }): { line?: Record<string, unknown>; bad?: string } {
  const s = (v: unknown, n: number) => typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, n) : "";
  const event = s(x?.event, 40);
  if (!RECORDER_EVENTS.has(event)) return { bad: "unknown event: " + (event || "(none)") };
  const alterN = Number(x?.alter_id), alter = x?.alter_id !== null && x?.alter_id !== "" && Number.isInteger(alterN) && alterN >= 0 && alterN < 1e15 ? alterN : null;
  const d8 = s(x?.vch_date, 10).replace(/-/g, ""), day = isDay(d8) ? iso(d8) : null;
  const at = Date.parse(s(x?.saved_at, 40)), ms = Number(x?.save_ms);
  const ledgers = (Array.isArray(x?.ledgers) ? x.ledgers : []).slice(0, 50).map((l: any) => Array.isArray(l) ? { guid: s(l[0], 100), name: cleanName(s(l[1], 300)) } : { guid: s(l?.guid, 100), name: cleanName(s(l?.name, 300)) }).filter((l: any) => l.guid || l.name);
  const line: Record<string, unknown> = { line_id: s(x?.line_id, 80), event, saved_at: isNaN(at) ? null : new Date(at).toISOString(), pc: s(x?.pc, 60), user: s(x?.user, 60),
    company_guid: s(x?.company_guid, 100), bridge: me.id, object_guid: s(x?.object_guid, 100) || null, master_id: s(x?.master_id, 40), alter_id: alter,
    vch_type: s(x?.vch_type, 60), vch_no: s(x?.vch_no, 60), vch_date: day, ledgers, save_ms: Number.isFinite(ms) && ms >= 0 && ms < 3.6e6 ? Math.round(ms * 1000) / 1000 : null };
  if (event.startsWith("ledger_")) { line.name = cleanName(s(x?.name, 300)) || null; line.from = cleanName(s(x?.from, 300)) || null; line.to = cleanName(s(x?.to, 300)) || null; }
  // re-review M-B (06-Oct-2026): a cancel without an AlterID carries Tally's voucher counter at the time of the cancel (the
  // bridge's vch_counter, from FinComCompany): kept in the payload (vchCounter), migration 57 cancels again only a body of
  // that GUID at or below it. Never on a delete (always deleted again) nor with an AlterID
  const vc = Number(x?.vch_counter);
  if (event === "cancelled" && alter === null && typeof x?.vch_counter === "number" && Number.isInteger(vc) && vc > 0 && vc < 1e15) line.vchCounter = vc;
  const xml = typeof x?.xml === "string" ? x.xml : "";
  // migration 45: a short line (FinCom's own entry): its FinCom id as fid, or the text after "TDSDesk:" in the narration it
  // carries (the rule of parse.js); an id outside [A-Za-z0-9._-]{1,80} is none
  const fidRaw = s(x?.fid, 120), narr = s(x?.narration, 1000);
  // FinCom Bridge 2.2.2 (second review L-C): lineFid, a FinCom id the line carries that is NOT the entry's (a voucher copied
  // from one FinCom posted): kept as it is, and then no fid is ever taken from the narration's "TDSDesk:<id>"
  const lineFidRaw = s(x?.lineFid, 120), lineFid = /^[A-Za-z0-9._-]{1,80}$/.test(lineFidRaw) ? lineFidRaw : "";
  const fid = /^[A-Za-z0-9._-]{1,80}$/.test(fidRaw) ? fidRaw : (lineFid ? "" : ((narr.match(/TDSDesk:([A-Za-z0-9._-]{1,80})/) || [])[1] || ""));
  if (lineFid) line.lineFid = lineFid;
  if (fid && !event.startsWith("ledger_")) { line.fid = fid; if (!xml) line.short = true; }
  // bridge 2.2.2 (migration 51): the add-on's ids did not belong together (idsMismatch, the add-on's GUID as lineGuid, for
  // information only), and the bridge's plain reason when the line goes without the entry's body (heldWhy)
  if (x?.idsMismatch === true) line.idsMismatch = true;
  const lg = s(x?.lineGuid, 100); if (lg) line.lineGuid = lg;
  const hw = s(x?.heldWhy, 300); if (hw) line.heldWhy = hw;
  // bridge 2.3.0 review H1: a cancel / delete the bridge's own Tally does not show happened there (guidHeld): kept held,
  // never resolved from FinCom's record (guidsFromRecord)
  if (x?.guidHeld === true && (event === "deleted" || event === "cancelled")) line.guidHeld = true;
  line.payload = { ...line, xmlBytes: xml.length || undefined };
  if (xml && ["created", "altered", "imported"].includes(event)) {
    if (xml.length > MAX_RECORDER_XML) return { bad: "the entry's XML is larger than FinCom takes (" + xml.length + " characters)" };
    const r = parseDay(xml);
    // the days path's shape, each voucher with its own date (Tally's, from the XML); the line's own voucher (its GUID) and
    // that voucher's lines alone: the rest of the add-on's XML is never stored with the line (review L1)
    const og = line.object_guid as string | null;
    line.vouchers = og ? r.vouchers.filter((v: any) => v?.guid === og).map((v: any) => ({ ...dayVouchers({ vouchers: [v] })[0], day: isDay(v.date) ? iso(v.date) : day })) : [];
    // 2.2.2 (second review L-C): a copied FinCom id (lineFid) is not the entry's, from the body's narration either
    if (lineFid && !fid) line.vouchers = (line.vouchers as any[]).map((v: any) => ({ ...v, fid: null }));
    // bridge 2.3.1 (the owner's decision of 06-Oct-2026: "let blanks through for every field the 2.3.1 request fetches in
    // full; keep the guard only for lines from a bridge older than 2.3.1 that did not ask for the field"): the bridge marks a
    // line "full": true only when its body is the answer to its 2.3.1 entry request (FinComVoucherByMaster / ByNumber), whose
    // fetch has the party GSTIN, place of supply, ref, ref date, company GSTIN and the lines' HSN and rate. Its voucher goes
    // "full": true, so migration 56's keep passes it as sent (a blank is Tally's) and 56's repair skips it. Never guessed from
    // the body: no marker (a 2.3.0 bridge, the add-on's own XML), no "full" (56 keeps). The Day Book path never marks
    if (x?.full === true) line.vouchers = (line.vouchers as any[]).map((v: any) => ({ ...v, full: true }));
    line.lines = og ? dayLines(r).filter((l: any) => Array.isArray(l) && l[0] === og) : [];
    // guard-230 (review: bridge 2.3.x reads an entry's body with ALLLEDGERENTRIES only; an item invoice's sales or purchase
    // ledger may sit only under ALLINVENTORYENTRIES' ACCOUNTINGALLOCATIONS, so such a body would come without it): the body
    // is accepted only when the line's voucher has at least 2 ledger lines adding up to 0 (parse.js keeps Tally's signed
    // AMOUNTs, Dr negative, so a whole entry sums to 0) within 0.01. Else the body is not sent (vouchers [], lines []) and
    // the line is held for want of its body (migrations 50-51) with these words as heldWhy (in the payload too). A
    // cancelled voucher with no lines is kept as before. The Day Book upload (days) is read as before and settles it
    const bv = (line.vouchers as any[])[0], bl = line.lines as any[];
    if (bv && !(bv.cancel && !bl.length)) {
      const sum = Math.round(bl.reduce((a: number, l: any) => a + (Number(l[2]) || 0), 0) * 100) / 100;
      if (bl.length < 2 || Math.abs(sum) > 0.01) {
        const why = "the entry's details from Tally are incomplete (" + (bl.length < 2 ? "fewer than two ledger lines came"
          : hasInventory(xml, og as string) ? "its lines do not add up: an item invoice's sales or purchase ledger may not have come" : "its lines do not add up")
          + "): upload this day's Day Book to settle it";
        console.log("tally-ingest recorder_lines: body not taken (" + bl.length + " lines, sum " + sum + ")", line.line_id, og);
        line.vouchers = []; line.lines = []; line.heldWhy = why;
        (line.payload as Record<string, unknown>).heldWhy = why;
      } else if (Array.isArray(bv.checks) && bv.checks.length) {
        // bridge 2.3.1, the owner's rule after review (06-Oct-2026): an entry is HELD only when its ledger lines do not total
        // zero (the balance guard above). Every other mismatch (item taxable value plus tax against the ledger lines, the
        // per-item tax FinCom works out, bill-wise or cost centres against their line) APPLIES the entry as Tally has it and
        // keeps the plain words for a person: tally_vouchers.check_notes (migration 57, from the voucher's checks) and the
        // line's payload (checkNotes, shown in Sync activity). GST on freight or packing has no item line, and round-off or
        // discounts make the worked-out tax differ: holding would keep valid invoices out
        console.log("tally-ingest recorder_lines: applied with notes for checking", line.line_id, og, bv.checks);
        (line.payload as Record<string, unknown>).checkNotes = bv.checks.slice(0, 20);
      }
    }
  }
  return { line };
}
// guard-230: the voucher element of this GUID (else the whole XML) carries inventory entries
function hasInventory(xml: string, guid: string): boolean {
  let el = xml;
  const m = new RegExp("<GUID(?:\\s[^>]*)?>\\s*" + guid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*</GUID>").exec(xml);
  if (m) {
    const a = xml.lastIndexOf("<VOUCHER ", m.index), z = xml.indexOf("</VOUCHER>", m.index);
    if (a >= 0 && z > a) el = xml.slice(a, z);
  }
  return /<(?:ALL)?INVENTORYENTRIES\.LIST[\s>]/.test(el);
}
// Bridge 2.3.1, part B (the owner's scope of 06-Oct-2026: "If an entry uses a ledger FinCom does not have, fetch the ledger
// first, then apply the entry"). A recorder line whose entry body (read from the add-on's or Tally's XML; never a short line,
// FinCom's own posting) names a ledger the book's ledger list has no row of (by its clean name, else the same name in other
// capitals; a row marked gone counts as had) is not applied: its body is not sent (vouchers [], lines []) and the database
// holds it for want of its body (migrations 50-51) with the words "waiting for the ledger '<name>' from Tally" (heldWhy, in
// the payload too, with the names as waitLedgers). The beat names those ledgers (ledgersWanted); the bridge asks its own
// Tally for each by name and sends it (kind ledger_changes); once every ledger is in, the beat lists the line for refetch and
// the bridge sends the entry again ("<line id>:resolved"), applied then. The balance guard (guard-230) goes first: a body it
// held is not looked at. A book with no ledger list yet holds nothing (every name would be unknown); a ledger list that
// cannot be read holds nothing (as before 2.3.1). No migration
const LEDGER_WAIT = "waiting for the ledger";
function ledgerWaitWords(names: string[]): string {
  const q = names.slice(0, 5).map((n) => "'" + n + "'").join(", ") + (names.length > 5 ? " and " + (names.length - 5) + " more" : "");
  return ((names.length === 1 ? LEDGER_WAIT + " " : LEDGER_WAIT + "s ") + q + " from Tally (FinCom does not have " + (names.length === 1 ? "it" : "them")
    + " yet; the bridge fetches " + (names.length === 1 ? "it" : "them") + ", then the entry is applied)").slice(0, 300);
}
// the names of these the book's ledger list has no row of (exact clean name, else the same name in other capitals); null
// when the list cannot be read or the book has none yet (then nothing is held)
// re-review M-A (06-Oct-2026): an alias never maps an entry by itself. A held line's name is no longer missing only when it
// is in the ledger list, or when a fetch by that name made AFTER the line was held (the alias's confirmed_at above the hold)
// gave the alias's GUID. Missing (and so wanted again by name) otherwise: every use of an alias has its own fetch
type LedgerWaitState = { raw: Set<string>; al: Map<string, { fincom: string; at: number }> };
async function ledgerWaitState(book: string, names: string[]): Promise<LedgerWaitState | null> {
  const raw = await ledgersMissingRaw(book, names);
  if (!raw) return null;
  return { raw, al: raw.size ? await ledgerAliases(book, [...raw]) : new Map() };
}
function stillMissing(m: LedgerWaitState, name: string, holdAt: number): boolean {
  if (!m.raw.has(name)) return false;
  const a = m.al.get(name);
  return !(a && Number.isFinite(holdAt) && a.at > holdAt);
}
// bridge 2.3.1 (the owner's decision of 06-Oct-2026, migration 59): a ledger renamed in Tally and fetched for an unknown name.
// The names of these that Tally gave to a ledger FinCom holds under another name (tally_ledger_aliases: same Tally GUID,
// recorded by ledger_changes), each with FinCom's name, when FinCom's ledger is still in the book's list. An entry using
// such a name is applied under FinCom's ledger and never waits for it. Empty on any error (a cloud without 59: as before)
async function ledgerAliases(book: string, names: string[]): Promise<Map<string, { fincom: string; at: number }>> {
  const out = new Map<string, { fincom: string; at: number }>();
  try {
    const want = [...new Set(names.filter(Boolean))].slice(0, 2000);
    const rows: any[] = [];
    for (let i = 0; i < want.length; i += 150) {
      const { data, error } = await db.from("tally_ledger_aliases").select("tally_name, fincom_name, confirmed_at, ended_at").eq("book_id", book).in("tally_name", want.slice(i, i + 150));
      if (error) { console.log("tally-ingest: the renamed ledgers not read (migration 59):", book, String(error.message || "").slice(0, 200)); return out; }
      rows.push(...(data || []));
    }
    // review H2 (06-Oct-2026): only a valid alias: confirmed by a fetch by its name (confirmed_at) and not ended (ended_at).
    // An unconfirmed or ended one: the entry is held and the ledger fetched by its name (which confirms it, or brings a new
    // ledger of that name)
    const pairs = rows.filter((r: any) => r?.confirmed_at && !r?.ended_at).map((r: any) => [String(r?.tally_name || ""), String(r?.fincom_name || ""), Date.parse(String(r.confirmed_at))] as [string, string, number])
      .filter(([a, b, t]) => a && b && a !== b && Number.isFinite(t));
    if (!pairs.length) return out;
    const gone = await ledgersMissingRaw(book, pairs.map(([, b]) => b));
    if (!gone) return out;
    for (const [a, b, t] of pairs) if (!gone.has(b)) out.set(a, { fincom: b, at: t });
  } catch (e) {
    console.log("tally-ingest: the renamed ledgers not read:", book, String((e as Error)?.message || e).slice(0, 200));
  }
  return out;
}
// a line's entry under FinCom's ledger names (the aliases above): the ledger lines' names, the party, and the ledger / party
// named in its details; amounts, dates and everything else untouched (the lines total what they did)
function mapLedgerNames(l: Record<string, any>, al: Map<string, string>): string[] {     // al: Tally's name -> FinCom's
  const used = new Set<string>();
  const m = (n: unknown) => { const k = String(n ?? ""); if (al.has(k)) { used.add(k); return al.get(k)!; } return n; };
  l.lines = (l.lines as any[]).map((x: any) => Array.isArray(x) && al.has(String(x[1] ?? "")) ? [x[0], m(x[1]), ...x.slice(2)] : x);
  l.vouchers = (l.vouchers as any[]).map((v: any) => {
    if (!v || typeof v !== "object") return v;
    const o: Record<string, any> = { ...v, party: m(v.party) };
    for (const k of ["items", "costs", "banks", "tds", "dues"]) {
      if (Array.isArray(v[k])) o[k] = v[k].map((x: any) => x && typeof x === "object" ? { ...x, ...("ledger" in x ? { ledger: m(x.ledger) } : {}), ...("party" in x ? { party: m(x.party) } : {}) } : x);
    }
    return o;
  });
  return [...used];
}
// review H2 (06-Oct-2026): the aliases these ledger rows prove stale end (ended_at; kept, never removed): one whose GUID is
// seen under another name (renamed again), one whose name is seen with another GUID (a new ledger of that name). Nothing
// fails without migration 59
async function endStaleAliases(book: string, rows: { guid: string; name: string }[]) {
  try {
    const gs = [...new Set(rows.map((r) => r.guid).filter(Boolean))].slice(0, 2000), ns = [...new Set(rows.map((r) => r.name).filter(Boolean))].slice(0, 2000);
    if (!gs.length && !ns.length) return;
    const have: any[] = [];
    for (const [col, vals] of [["tally_guid", gs], ["tally_name", ns]] as [string, string[]][]) {
      for (let i = 0; i < vals.length; i += 150) {
        const { data, error } = await db.from("tally_ledger_aliases").select("tally_name, tally_guid, ended_at").eq("book_id", book).in(col, vals.slice(i, i + 150));
        if (error) return;
        have.push(...(data || []));
      }
    }
    const byGuid = new Map(rows.filter((r) => r.guid).map((r) => [r.guid, r.name])), byName = new Map(rows.filter((r) => r.name).map((r) => [r.name, r.guid]));
    const end = [...new Set(have.filter((a: any) => !a?.ended_at && (
      (byGuid.has(String(a.tally_guid)) && byGuid.get(String(a.tally_guid)) !== String(a.tally_name)) ||
      (byName.has(String(a.tally_name)) && byName.get(String(a.tally_name)) && byName.get(String(a.tally_name)) !== String(a.tally_guid)))).map((a: any) => String(a.tally_name)))];
    for (let i = 0; i < end.length; i += 150) {
      const { error } = await db.from("tally_ledger_aliases").update({ ended_at: new Date().toISOString() }).eq("book_id", book).in("tally_name", end.slice(i, i + 150));
      if (error) { console.log("tally-ingest: stale ledger aliases not ended:", book, String(error.message || "").slice(0, 200)); return; }
    }
    if (end.length) console.log("tally-ingest: ledger aliases ended (renamed again, or the name now another ledger's):", book, JSON.stringify(end.slice(0, 10)));
  } catch (e) {
    console.log("tally-ingest: stale ledger aliases not read:", book, String((e as Error)?.message || e).slice(0, 200));
  }
}
async function ledgersMissingRaw(book: string, names: string[]): Promise<Set<string> | null> {
  try {
    const want = [...new Set(names.filter(Boolean))].slice(0, 2000);
    if (!want.length) return new Set();
    const { data: any1, error: e1 } = await db.from("tally_ledgers").select("name").eq("book_id", book).limit(1);
    if (e1 || !Array.isArray(any1) || !any1.length) return null;
    const have = new Set((await selectIn("name", book, "name", want)).map((r: any) => String(r.name)));
    const miss = want.filter((n) => !have.has(n));
    for (const n of miss.slice(0, 20)) {
      const { data, error } = await db.from("tally_ledgers").select("name").eq("book_id", book).ilike("name", n.replace(/[\\%_]/g, (c) => "\\" + c)).limit(1);
      if (error) return null;
      if (Array.isArray(data) && data.length) have.add(n);
    }
    return new Set(miss.filter((n) => !have.has(n)));
  } catch (e) {
    console.log("tally-ingest: the ledger list not read for the ledgers an entry uses:", book, String((e as Error)?.message || e).slice(0, 200));
    return null;
  }
}
async function ledgerWait(book: string, send: Record<string, any>[]) {
  const look = send.filter((l) => l.short !== true && !l.heldWhy && Array.isArray(l.vouchers) && l.vouchers.length && Array.isArray(l.lines) && l.lines.length);
  if (!look.length) return;
  const st = await ledgerWaitState(book, look.flatMap((l) => (l.lines as any[]).map((x: any) => String(x?.[1] ?? ""))));
  if (!st || !st.raw.size) return;
  // 2.3.1 (migration 59): a name Tally gave to a ledger FinCom holds under another name: the entry goes under FinCom's
  // ledger (said in the payload as renamedLedgers, the note for 2.3.2), never a second ledger. Re-review M-A: only an entry
  // that comes again for its own hold (its ":resolved") after a fetch by that name made since the hold gave the alias's
  // GUID; any other entry naming it is held and the ledger fetched by its name (each use its own fetch)
  const holds = await ledgerHoldTimes(book, look.map((l) => String(l.line_id || "")).filter((id) => id.endsWith(":resolved")).map((id) => id.slice(0, -9)));
  for (const l of look) {
    const id = String(l.line_id || ""), holdAt = id.endsWith(":resolved") ? (holds.get(id.slice(0, -9)) ?? NaN) : NaN;
    const use = new Map<string, string>();
    for (const n of new Set((l.lines as any[]).map((x: any) => String(x?.[1] ?? "")))) {
      const a = st.al.get(n);
      if (st.raw.has(n) && a && !stillMissing(st, n, holdAt)) use.set(n, a.fincom);
    }
    if (!use.size) continue;
    const used = mapLedgerNames(l, use);
    if (!used.length) continue;
    const ren = Object.fromEntries(used.map((n) => [n, use.get(n)]));
    console.log("tally-ingest recorder_lines: ledger renamed in Tally (confirmed by a fetch for this hold), applied under FinCom's name", l.line_id, JSON.stringify(ren));
    l.payload = { ...(l.payload || {}), renamedLedgers: ren };
  }
  const miss = new Set([...st.raw]);
  for (const l of look) {
    const all = [...new Set((l.lines as any[]).map((x: any) => String(x?.[1] ?? "")).filter((n) => miss.has(n)))];
    // review L4 (06-Oct-2026): a name a TDL string cannot hold (the bridge's ledNameOK: a quote mark, a control character,
    // over 200 characters) can never be asked from Tally by its name: said in plain words, never named in ledgersWanted
    const bad = all.filter((n) => !askableName(n)), names = all.filter(askableName).slice(0, 10);
    if (!all.length) continue;
    const why = bad.length
      ? ("the ledger " + bad.slice(0, 3).map((n) => "'" + n + "'").join(", ") + " is not in FinCom and cannot be fetched from Tally by its name (a quote mark or a line break in it): upload this day's Day Book, or Update now for the ledger list, to settle it").slice(0, 300)
      : ledgerWaitWords(names);
    console.log("tally-ingest recorder_lines: " + why, l.line_id, l.object_guid);
    l.vouchers = []; l.lines = []; l.heldWhy = why;
    l.payload = { ...(l.payload || {}), heldWhy: why, ...(bad.length ? { unaskableLedgers: bad.slice(0, 10) } : { waitLedgers: names }) };
  }
}
// re-review M-A: when each line was last held waiting for a ledger (its own row or an earlier ":resolved" of it), by line id
async function ledgerHoldTimes(book: string, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const want = [...new Set(ids.filter(Boolean))].slice(0, 400);
  if (!want.length) return out;
  try {
    const all = want.flatMap((id) => [id, id + ":resolved"]);
    for (let i = 0; i < all.length; i += 60) {
      const { data, error } = await db.from("tally_recorder_lines").select("line_id, received_at, held_why").eq("book_id", book).in("line_id", all.slice(i, i + 60));
      if (error) return out;
      for (const r of (data || []) as any[]) {
        if (!String(r?.held_why || "").startsWith(LEDGER_WAIT)) continue;
        const base = String(r.line_id || "").replace(/:resolved$/, ""), t = Date.parse(String(r.received_at));
        if (Number.isFinite(t) && t > (out.get(base) ?? -Infinity)) out.set(base, t);
      }
    }
  } catch (e) {
    console.log("tally-ingest: the holds for a ledger not read:", book, String((e as Error)?.message || e).slice(0, 200));
  }
  return out;
}
// review L4: a name the bridge can ask Tally for (its ledNameOK: trimmed, 1-200 characters, no quote mark, no control character)
function askableName(n: string): boolean {
  return !!n && n === n.trim() && [...n].length <= 200 && !n.includes('"') && !/[\x00-\x1f\x7f]/.test(n);
}
// the ledgers a held line waits for (its payload's waitLedgers), when its words say so
function waitsFor(r: any): string[] {
  if (!String(r?.held_why || "").startsWith(LEDGER_WAIT)) return [];
  const w = r?.payload && typeof r.payload === "object" ? r.payload.waitLedgers : null;
  return Array.isArray(w) ? w.map((n: any) => String(n || "").slice(0, 300)).filter(Boolean).slice(0, 10) : [];
}
async function recorderLines(dev: any, firm: string, book: string, body: any) {
  const me = bridgeOf(dev, body, false);
  const company = String(body.company || "").slice(0, 200);
  const given = (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_RECORDER_LINES);
  const results: { line_id: string; state: string; why: string | null }[] = new Array(given.length);
  const send: Record<string, unknown>[] = [], at: number[] = [];
  const masters: Record<string, unknown>[] = [], mat: number[] = [];
  given.forEach((x: any, i: number) => {
    if (MASTER_EVENTS.has(String(x?.event ?? "").trim())) {
      const m = cleanMasterLine(x, me);
      if (m.bad) results[i] = { line_id: String(x?.line_id ?? "").slice(0, 80), state: "failed", why: m.bad };
      else { masters.push({ ...m.line, company }); mat.push(i); }
      return;
    }
    const c = cleanRecorderLine(x, me);
    if (c.bad) results[i] = { line_id: String(x?.line_id ?? "").slice(0, 80), state: "failed", why: c.bad };
    else { send.push({ ...c.line, company }); at.push(i); }
  });
  if (masters.length) await keepMasters(firm, book, dev, masters, mat, results);
  if (send.length) await shortBodies(firm, book, send);
  if (send.length) await ledgerWait(book, send);     // bridge 2.3.1 (masters): an entry naming a ledger FinCom does not have waits for it
  const found = send.length ? await guidsFromRecord(book, send, String(dev?.id || ""), me.id) : new Map<string, string>();     // bridge 2.3.0: cancel/delete GUID
  // round 20 (migration 47): more than 50 FULL lines (an entry body read from the add-on's XML; short lines' bodies built from
  // the posting do not count) go on the queue as ONE message and are answered {queued: n} at once; the database's drain
  // (pg_cron every 30 s) applies them in order and Sync activity shows each line's state. Round 21 (review 47/48 H1): ONE
  // call, tally_recorder_send(..., queue), which also queues a small request while the book has a queued message not applied
  // yet (a later request never overtakes it: per book in order); else it applies them at once as before. A cloud without
  // 47: tally_recorder_apply directly (said in the log)
  const full = send.filter((l: any) => Array.isArray(l.vouchers) && l.short !== true).length;
  if (send.length) {
    let data: any = null, error: any = null, via = "send";
    ({ data, error } = await db.rpc("tally_recorder_send", { p_firm: firm, p_book: book, p_device: dev.id, p_lines: send, p_queue: full > QUEUE_OVER }));
    if (error && /tally_recorder_send|could not find|does not exist|schema cache/i.test(String(error.message || ""))) {
      console.log("tally-ingest recorder_lines: no queue in this cloud (migration 47): " + send.length + " lines applied directly", book);
      via = "apply";
      ({ data, error } = await db.rpc("tally_recorder_apply", { p_firm: firm, p_book: book, p_device: dev.id, p_lines: send }));
    }
    if (error && notReady44(error)) return reply(503, { ok: false, notReady: true, error: "The cloud does not take recorder lines yet (migration 44)." });
    if (error) throw dbFail("recorder_lines " + via, error, "The cloud could not store these recorder lines just now; send them again.");
    if (data && typeof data.queued === "number") {
      send.forEach((l: any, k: number) => { results[at[k]] = { line_id: String(l.line_id ?? ""), state: "queued", why: null, ...(found.has(String(l.line_id ?? "")) ? { guid: found.get(String(l.line_id ?? "")) } : {}) }; });
      const failed = results.filter((r) => r?.state === "failed").length;
      console.log("tally-ingest recorder_lines queued", book, JSON.stringify({ n: send.length, full, failed, msg: data.msg ?? null, behind: data.behind ?? 0 }));
      return reply(200, { ok: true, queued: send.length, failed, msg: data.msg ?? null, ...(data.behind ? { behind: data.behind } : {}), results });
    }
    ((data as any)?.results || []).forEach((r: any, k: number) => {
      if (k >= at.length) return;
      const lid = String(r?.line_id ?? send[k].line_id ?? "");
      results[at[k]] = { line_id: lid, state: String(r?.state || "failed"), why: r?.why ?? null, ...(found.has(lid) ? { guid: found.get(lid) } : {}) };
    });
  }
  const out: Record<string, unknown> = { ok: true, results };
  for (const k of ["applied", "held", "duplicate", "stale", "failed", "kept"]) out[k] = results.filter((r) => r?.state === k).length;
  if (out.held || out.failed) console.log("tally-ingest recorder_lines", book, JSON.stringify({ n: results.length, held: out.held, failed: out.failed, why: results.filter((r) => r && r.state !== "applied" && r.state !== "duplicate").slice(0, 3).map((r) => r.why) }));
  return reply(200, out);
}
// next-masterhook (migration 66): the master lines of one call kept (heads only); a cloud without 66 answers them 'failed'
// with words (the voucher and ledger lines of the call go on as before)
async function keepMasters(firm: string, book: string, dev: any, masters: Record<string, unknown>[], mat: number[], results: { line_id: string; state: string; why: string | null }[]) {
  const { data, error } = await db.rpc("tally_recorder_masters_save", { p_firm: firm, p_book: book, p_device: dev.id, p_lines: masters });
  const none = (why: string) => masters.forEach((m, k) => { results[mat[k]] = { line_id: String(m.line_id ?? ""), state: "failed", why }; });
  if (error && /tally_recorder_masters_save|could not find|does not exist|schema cache/i.test(String(error.message || ""))) {
    console.log("tally-ingest recorder_lines: " + masters.length + " master line(s) not kept: no migration 66 in this cloud", book);
    return none("FinCom does not keep master lines yet (migration 66)");
  }
  if (error) { console.error("tally-ingest recorder_lines masters:", String(error?.message || "").slice(0, 300)); return none("FinCom could not keep this master line just now"); }
  if ((data as any)?.ok === false) return none(String((data as any)?.error || "not kept").slice(0, 200));
  ((data as any)?.results || []).forEach((r: any, k: number) => {
    if (k < mat.length) results[mat[k]] = { line_id: String(r?.line_id ?? masters[k].line_id ?? ""), state: String(r?.state || "failed"), why: r?.why ?? null };
  });
}
// FinCom Bridge 2.3.0 (cancel/delete GUID): a real TallyPrime 7.1 writes no GUID on a voucher's delete or cancel line (the
// add-on's Before/After Delete / Cancel Object), and the bridge sends one only when Tally (a cancel, asked by its MasterID) or
// its own record gave it. For such a line without a GUID, FinCom's own record: the book's recorder lines under the same
// company GUID and MasterID that ended applied or duplicate and came WITH Tally's entry under their GUID (body.vouchers
// holding it): never a placeholder (...-00000000), never a line whose ids did not belong together (idsMismatch), never the
// GUID a MasterID makes on its own (an entry that came by import or sync keeps another GUID). Exactly one GUID found: the line
// goes on with it (the bridge's heldWhy dropped; payload.guidFrom), and the answer's result carries guid. Else the line goes
// as sent: the database holds it with words. No migration: tally_recorder_lines is read through the API. Never fails the call
// Review H1 (2.3.0): every Windows user's Tally on a computer writes into one shared recorder folder, so another user's
// bridge reads a line made in a copy of the company in that user's Tally. FinCom's record is therefore only the earlier
// lines sent by the SAME computer key (device_id) and the SAME bridge (its id, the column bridge) as this call; a line the
// bridge held because its own Tally does not show the cancel / delete (guidHeld) is never resolved here
async function guidsFromRecord(book: string, send: Record<string, any>[], device: string, bridge: string) {
  const found = new Map<string, string>();
  const want = send.filter((l) => (l.event === "deleted" || l.event === "cancelled") && !l.object_guid && l.guidHeld !== true && /^[0-9]{1,10}$/.test(String(l.master_id || "")) && Number(l.master_id) > 0 && l.company_guid);
  if (!want.length || !device || !bridge) return found;
  try {
    // 2.3.1 (2.3.0 review, cloud Lows): the company GUID is in the query (case ignored, as below; a GUID of other characters is
    // never looked up), the MasterIDs asked 100 at a time, so another company's newer rows under the same MasterID never push
    // this company's out of a read's 2,000 rows
    const data: any[] = [];
    const cgs = [...new Set(want.map((l) => String(l.company_guid).toLowerCase()))].filter((g) => /^[0-9a-z-]{1,100}$/.test(g));
    for (const cg of cgs) {
      const mids = [...new Set(want.filter((l) => String(l.company_guid).toLowerCase() === cg).map((l) => String(l.master_id)))].slice(0, 500);
      for (let i = 0; i < mids.length; i += 100) {
        const { data: d, error } = await db.from("tally_recorder_lines").select("id, object_guid, master_id, company_guid, state, event, body, payload, device_id, bridge")
          .eq("book_id", book).eq("device_id", device).eq("bridge", bridge).ilike("company_guid", cg).in("master_id", mids.slice(i, i + 100)).in("state", ["applied", "duplicate"]).in("event", ["created", "altered", "imported"]).order("id", { ascending: false }).limit(2000);
        if (error || !Array.isArray(d)) { console.log("tally-ingest recorder_lines: cancel/delete GUID: FinCom's record not read", book, String(error?.message || "").slice(0, 200)); return found; }
        data.push(...d);
      }
    }
    for (const l of want) {
      const gs = new Map<string, number | string>();
      // the lines BEFORE it in this same call that carry Tally's entry under their GUID (an alteration and its delete sent
      // together): as the stored ones
      for (const e of send) {
        if (e === l) break;
        const g = String(e.object_guid || "");
        if (!["created", "altered", "imported"].includes(String(e.event)) || String(e.master_id || "") !== String(l.master_id)) continue;
        if (String(e.company_guid || "").toLowerCase() !== String(l.company_guid).toLowerCase() || !g || /-0{8}$/.test(g) || e.idsMismatch === true) continue;
        if (Array.isArray(e.vouchers) && e.vouchers.some((v: any) => v?.guid === g) && !gs.has(g)) gs.set(g, "sent with it (" + String(e.line_id || "") + ")");
      }
      for (const r of data as any[]) {
        const g = String(r?.object_guid || "");
        if (String(r?.device_id || "") !== device || String(r?.bridge || "") !== bridge) continue;     // review H1: this computer key's and this bridge's only
        if (String(r?.master_id || "") !== String(l.master_id) || String(r?.company_guid || "").toLowerCase() !== String(l.company_guid).toLowerCase()) continue;
        if (!g || /-0{8}$/.test(g) || r?.payload?.idsMismatch === true || String(r?.payload?.idsMismatch || "").toLowerCase() === "true") continue;
        if (!(Array.isArray(r?.body?.vouchers) && r.body.vouchers.some((v: any) => v?.guid === g))) continue;     // Tally's entry came with it
        if (!gs.has(g)) gs.set(g, Number(r.id));
      }
      const lid = String(l.line_id || ""), verb = l.event === "deleted" ? "delete" : "cancel";
      if (gs.size !== 1) {
        console.log("tally-ingest recorder_lines: cancel/delete GUID: line " + lid + ", " + verb + " of mid " + l.master_id + ": " + (gs.size ? gs.size + " different GUIDs in FinCom's record: not told" : "not in FinCom's record") + "; held", book);
        continue;
      }
      const [g, rid] = [...gs.entries()][0];
      const made = String(l.company_guid) + "-" + Number(l.master_id).toString(16).padStart(8, "0");
      l.object_guid = g; delete l.heldWhy;
      const src = typeof rid === "number" ? "recorder line " + rid : "the line " + rid.replace(/^sent with it \(|\)$/g, "") + " sent with it";
      const pl = { ...(l.payload || {}), object_guid: g, guidFrom: "FinCom's copy: " + src };
      delete (pl as any).heldWhy; l.payload = pl;
      found.set(lid, g);
      console.log("tally-ingest recorder_lines: cancel/delete GUID: line " + lid + ", " + verb + " of mid " + l.master_id + ": GUID from FinCom's record (" + src + "): " + g +
        (g.toLowerCase() === made.toLowerCase() ? "; the GUID its MasterID makes agrees" : "; not the GUID its MasterID makes"), book);
    }
  } catch (e) {
    console.log("tally-ingest recorder_lines: cancel/delete GUID: FinCom's record not read", book, String((e as Error)?.message || e).slice(0, 200));
  }
  return found;
}
// migration 45: the short lines' entries from FinCom's own posted XML (tally_post_xml_for: the live, accepted posting of
// each FinCom id for this firm and book), read with parse.js as a day book is, the line's GUID and AlterID overriding (the
// posted XML has none: Tally gives them), its voucher number when the XML has none; dated by the XML, else by the line.
// A FinCom id with no posting gets no body (the database holds the line with its words). Without 45: skipped
const xesc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function withIds(xml: string, guid: string, alter: number | null) {
  const open = xml.match(/<VOUCHER\b[^>]*>/);
  if (!open || open.index === undefined) return "";
  let body = xml.slice(open.index + open[0].length).replace(/<GUID>[^<]*<\/GUID>/g, "").replace(/<ALTERID>[^<]*<\/ALTERID>/g, "");
  const head = open[0].replace(/\sREMOTEID="[^"]*"/g, "");
  body = "<GUID>" + xesc(guid) + "</GUID>" + (alter !== null ? "<ALTERID>" + alter + "</ALTERID>" : "") + body;
  const out = xml.slice(0, open.index) + head + body;
  return out.indexOf("</VOUCHER>") >= 0 ? out : "";
}
// The review's H2: only a short line of FinCom's own CREATION (created / imported) is built from the posting; a short 'altered'
// line is a person's change in Tally after the posting, so the posted XML is not its content: no body, the database holds it
// ('changed in Tally after posting') and the gap check counts it as not received until a full line or a Day Book brings it
async function shortBodies(firm: string, book: string, send: Record<string, any>[]) {
  const want = send.filter((l) => l.short === true && l.fid && l.object_guid && ["created", "imported"].includes(String(l.event)));
  if (!want.length) return;
  const { data, error } = await db.rpc("tally_post_xml_for", { p_firm: firm, p_book: book, p_fids: [...new Set(want.map((l) => String(l.fid)))].slice(0, 1000) });
  if (error) { if (!/could not find|does not exist|schema cache|no such function/i.test(String(error.message || ""))) console.log("tally-ingest recorder_lines: posted XML", book, String(error.message || "").slice(0, 200)); return; }
  const byFid = new Map<string, string>();
  for (const p of ((data as any)?.posts || []) as any[]) if (p && typeof p.fid === "string" && typeof p.xml === "string" && p.xml.length <= MAX_RECORDER_XML) byFid.set(p.fid, p.xml);
  let unread = 0;
  for (const l of want) {
    const xml = byFid.get(String(l.fid));
    if (!xml) continue;
    const og = String(l.object_guid), r = parseDay(withIds(xml, og, typeof l.alter_id === "number" ? l.alter_id : null));
    const vs = r.vouchers.filter((v: any) => v?.guid === og);
    if (!vs.length) { unread++; continue; }
    l.vouchers = vs.map((v: any) => { const d = dayVouchers({ vouchers: [v] })[0]; return { ...d, no: d.no || l.vch_no || "", day: isDay(v.date) ? iso(v.date) : l.vch_date }; });
    l.lines = dayLines(r).filter((x: any) => Array.isArray(x) && x[0] === og);
  }
  if (unread) console.log("tally-ingest recorder_lines: posted XML not readable for " + unread + " short line(s)", book);
}
// The review's M6: a short line that reached the cloud before its posting's acceptance was held 'FinCom id <id> matches no
// posting of this firm'. After posts_update stamps the acceptance: tally_recorder_short_held(firm, job) gives those lines (the
// stored line, its row and book), their bodies are built from the posted XML as for any short line, and
// tally_recorder_short_retry(firm, book, lines) re-runs the same rows. Never fails the update (a cloud without it: skipped)
async function retryHeldShort(firm: string, job: string) {
  try {
    const { data, error } = await db.rpc("tally_recorder_short_held", { p_firm: firm, p_job: job });
    if (error) { if (!/could not find|does not exist|schema cache|no such function/i.test(String(error.message || ""))) console.log("tally-ingest posts_update: held short lines", job, String(error.message || "").slice(0, 200)); return; }
    const byBook = new Map<string, Record<string, any>[]>();
    for (const x of (((data as any)?.lines || []) as any[])) {
      if (!x || typeof x.book !== "string" || !x.line || typeof x.line !== "object") continue;
      const l = { ...x.line, row: x.row, short: true };
      byBook.set(x.book, [...(byBook.get(x.book) || []), l]);
    }
    for (const [book, lines] of byBook) {
      await shortBodies(firm, book, lines);
      const { data: r, error: e2 } = await db.rpc("tally_recorder_short_retry", { p_firm: firm, p_book: book, p_lines: lines.map((l) => ({ row: l.row, line_id: l.line_id, vouchers: l.vouchers || [], lines: l.lines || [] })) });
      if (e2) console.log("tally-ingest posts_update: held short lines", job, String(e2.message || "").slice(0, 200));
      else console.log("tally-ingest posts_update: held short lines retried", book, JSON.stringify({ applied: (r as any)?.applied, held: (r as any)?.held, skipped: (r as any)?.skipped }));
    }
  } catch (e) { console.log("tally-ingest posts_update: held short lines", job, (e as Error).message); }
}
// the bridge's starting point (the owner's change of 04-Oct: reading is prospective): kept once per book and company GUID
async function startPoint(dev: any, firm: string, book: string, body: any) {
  // altOf: 0 or less is unknown, never a starting point (review M2); 10^15 or more is past Tally's range (review L9)
  const altvch = altOf(body.altvchid), altmst = altOf(body.altmstid);
  if (altvch === null) return reply(400, { ok: false, error: "altvchid (Tally's highest voucher AlterID, more than 0) is needed" });
  const { data, error } = await db.rpc("tally_start_point", { p_firm: firm, p_book: book, p_guid: String(body.guid || body.company_guid || "").slice(0, 100) || null,
    p_altvch: altvch, p_altmst: altmst, p_device: dev.id, p_bridge: bridgeOf(dev, body, false).id });
  if (error && notReady44(error)) return reply(503, { ok: false, notReady: true, error: "The cloud does not keep a starting point yet (migration 44)." });
  if (error) throw new Error(error.message);
  return reply(200, data);
}
// a few days of the day book (each gzipped), into a book: stored, and read into entries, lines and ready totals
async function ingestDays(firm: string, book: string, daysIn: unknown) {
  const r = await ingestDaysRaw(firm, book, daysIn);
  return r.error ? reply(400, { ok: false, error: r.error }) : reply(200, { ok: true, done: r.done, bad: r.bad, ...(r.locked.length ? { locked: r.locked } : {}) });
}
// migration 44 (review M3): a day of a month the owner locked is refused by tally_ingest_day (nothing stored, nothing
// marked). It is answered under `locked` [{day, why}], never under `done`, and logged as kept, not applied: the file stays
// in the bucket and a re-read after the unlock applies it. It also goes in `bad` (locked: true, with the words) so a bridge
// that knows only done / bad drops it with a log line instead of sending it again for ever
type LockedDay = { day: string; why: string };
function lockedDay(dayAns: any, day: string, book: string, locked: LockedDay[], bad: { day: string; error: string; locked?: boolean }[]) {
  const why = String(dayAns?.refused || "month locked").slice(0, 300);
  console.log("tally-ingest day of a locked month kept, not applied (held until the owner unlocks it and the day is read again): " + why, book, day);
  locked.push({ day, why });
  bad.push({ day, error: why, locked: true });
}
async function ingestDaysRaw(firm: string, book: string, daysIn: unknown): Promise<{ done: string[]; bad: { day: string; error: string; locked?: boolean }[]; locked: LockedDay[]; error?: string }> {
  const days = (Array.isArray(daysIn) ? daysIn : []).slice(0, 62);
  const done: string[] = [], locked: LockedDay[] = [];
  let unzipped = 0;
  const bad: { day: string; error: string; locked?: boolean }[] = [];
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
    if (r.dates.some((x: string) => x !== d.day)) return { done, bad, locked, error: "The day book for " + d.day + " has entries of other dates (" + r.dates.filter((x: string) => x !== d.day).slice(0, 3).join(", ") + ")." };
    const path = `${firm}/${book}/${d.day.slice(0, 6)}/${d.day}.xml.gz`;
    const up = await db.storage.from("tally-days").upload(path, gz, { upsert: true, contentType: "application/gzip" });
    if (up.error) throw new Error("storage: " + up.error.message);
    // migration 39: the bridge says when it positively read the day and Tally listed no entries (empty: true): the cloud
    // then marks the day's entries deleted; without the flag an empty file is a short read (nothing marked, migration 38).
    // A cloud without 39 has no p_empty: the 7-argument call as before
    // migration 38/39's short-read guard works only against the bridge's OWN count of the day (d.n, counted in the text it
    // kept): with the parsed count alone (r.n) the two could never differ. The parsed count is used when the bridge sends none
    // 2.3.1 (migration-50 review L7): the entries the reader leaves out by its rule (no GUID; no ledger lines and not a cancelled
    // document with a number: an inventory-only Stock Journal, a Delivery Note) are taken off the bridge's count: they are in the
    // file, not missing, so such a day is no longer a short read after every bridge store; a voucher not read at all still is
    const nSent = Number.isInteger(Number(d.n)) && Number(d.n) >= 0 && Number(d.n) <= 100000 && d.n !== null && d.n !== "" ? Number(d.n) : null;
    const nBridge = nSent === null ? null : Math.max(0, nSent - (Number.isInteger(r.skipped) ? r.skipped : 0));
    if (nBridge !== null && r.n < nBridge) console.log("tally-ingest day " + d.day + ": parsed " + r.n + " of the bridge's " + nBridge + " entries (short read: the cloud marks nothing)", book);
    const dayArgs = { p_book: book, p_day: iso(d.day), p_vouchers: dayVouchers(r), p_lines: dayLines(r), p_n: nBridge ?? r.n, p_alter: r.alterMax, p_bytes: gz.length };
    let { data: dayAns, error } = d.empty === true ? await db.rpc("tally_ingest_day", { ...dayArgs, p_empty: true }) : await db.rpc("tally_ingest_day", dayArgs);
    if (error && d.empty === true && /p_empty|tally_ingest_day.*(schema cache|does not exist)/i.test(String(error.message || ""))) ({ data: dayAns, error } = await db.rpc("tally_ingest_day", dayArgs));   // only "no such 8-argument function", never any other error
    if (error) throw new Error(error.message);
    if ((dayAns as any)?.locked === true) { lockedDay(dayAns, d.day, book, locked, bad); continue; }
    if ((dayAns as any)?.empty) console.log("tally-ingest day empty (the bridge vouched for it): " + String((dayAns as any).marked || 0) + " marked deleted", book, d.day);
    // migration 38 (item 9): a short read (no entries, or fewer than the bridge counted) upserted what came and marked nothing; said in the log
    if ((dayAns as any)?.refused) console.log("tally-ingest day " + String((dayAns as any).refused) + ": nothing marked deleted", book, String((dayAns as any).day || ""));
    done.push(d.day);
  }
  return { done, bad, locked };
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
  if (!month) return { done: [] as string[], bad: [] as { day: string; error: string; locked?: boolean }[], locked: [] as LockedDay[], next: null, months: 0 };
  const { data: files, error: e2 } = await db.storage.from("tally-days").list(`${base}/${month}`, { limit: 100, sortBy: { column: "name", order: "asc" } });
  if (e2) throw new Error("storage: " + e2.message);
  const done: string[] = [], bad: { day: string; error: string; locked?: boolean }[] = [], locked: LockedDay[] = [];
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
    if ((dayAns as any)?.locked === true) { lockedDay(dayAns, day, book, locked, bad); continue; }
    // migration 38 (item 9): a short read (no entries, or fewer than the bridge counted) upserted what came and marked nothing; said in the log
    if ((dayAns as any)?.refused) console.log("tally-ingest day " + String((dayAns as any).refused) + ": nothing marked deleted", book, String((dayAns as any).day || ""));
    done.push(day);
  }
  const next = all.find((m: string) => m > month) || null;
  return { month, done, bad, ...(locked.length ? { locked } : {}), next, months: all.length };
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
// when the browser that handed it over is closed. A piece is {job, firm, book, days:[{day, gz}]} (a part of a day book),
// {job, firm, book, month} (a month of the kept day books read again) or {job, firm, book, upload: {...}} (a byte range of a
// Day Book uploaded to Storage: uploadPiece, round 20). A piece that fails is seen again after its
// time is up (VT seconds) and tried up to 5 times; then the job says what failed. Done pieces are archived (kept).
// Run by: the hand-over itself (in the background, after answering) and the database's timer every 30 seconds.
const VT = Number(Deno.env.get("TALLY_WORK_VT") || 240), TRIES = 5;      // seconds a piece is hidden while worked on (tests: shorter)
// deno-lint-ignore no-explicit-any
const later = (p: Promise<unknown>) => { const er = (globalThis as any).EdgeRuntime; if (er && typeof er.waitUntil === "function") er.waitUntil(p); else p.catch(() => {}); };
// A stopped job stays stopped: tally_job_step (migration 13) sets the status from done/total on every step, so a piece that
// was already running when another piece stopped the job (a Fatal, or 5 tries) would turn "failed" back into "running" and the
// job would never end. The stop leaves its own entry in bad (no day); a later step that finds it puts "failed" back.
async function jobStep(job: string, units: number, bad: unknown[], failed?: string) {
  const { error } = await db.rpc("tally_job_step", { p_job: job, p_done: units, p_bad: bad || [], p_failed: failed || null });
  if (error) { console.error("tally-ingest job step", job, error.message); return; }
  if (failed) return;
  const { data: j } = await db.from("tally_jobs").select("status, bad").eq("id", job).maybeSingle();
  // deno-lint-ignore no-explicit-any
  if (j && j.status !== "failed" && Array.isArray(j.bad) && j.bad.some((b: any) => b && typeof b === "object" && !b.day && b.error)) {
    const { error: e2 } = await db.from("tally_jobs").update({ status: "failed" }).eq("id", job).neq("status", "failed");
    if (e2) console.error("tally-ingest job step (kept stopped)", job, e2.message);
  }
}
// review 47/48 M4, M5, L2: a piece that can never succeed (another file, an entry too large, a Storage that ignores Range):
// the job stops at once with these words, no 5 tries
class Fatal extends Error {}
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
  } else if (m.upload && typeof m.upload === "object") {
    await uploadPiece(job, firm, book, m.upload);
  }
}
// ---------- round 20 (migration 47): a Day Book uploaded to Storage (bucket tally-uploads, '<firm>/<job>.xml', by the app's
// resumable upload) is split into days HERE, from the queue, a piece of a few MB at a time, so the page can be closed.
// A piece {job, firm, book, upload: {path, size, from, range: {from, to}, enc, tail, tailAt, pend, seen, late, ext, top}}
// reads the bytes [from, from + PIECE) of the stored file (Range), decodes them (UTF-16LE with or without the BOM, UTF-8 with
// or without; a range end inside a character is moved back to the character's start), and cuts the text into vouchers with
// the browser's own rule (TCloudUp.split, src/js/49-tally-cloud.js: /<VOUCHER\b[\s\S]*?<\/VOUCHER>/, the first <DATE>, inside
// the period only). The text after the last whole voucher (a voucher cut at the range end) is carried in the next piece's
// message ("tail"). A Day Book is in date order, so the vouchers of the latest date met so far are carried too ("pend": its
// day may go on in the next range) and every earlier day is complete: it becomes the browser's day file
// ("<ENVELOPE><BODY><DATA>" + each voucher in <TALLYMESSAGE> + "</DATA></BODY></ENVELOPE>"), packed and queued as the existing
// days pieces ({days: [{day, gz}]}, at most 31 days or 4 MB a piece, as the browser's hand-over). The last piece queues
// the rest and every day of the period with no entry (an empty file, as the browser sends). A file NOT in date order: a
// voucher of a day already queued marks that day "late"; after the last piece a second pass reads again the byte ranges
// where the late days' vouchers were ("ext": per day, the range boundaries around them) and queues each late day WHOLE
// (the job's total grows by those days). Progress: tally_job_step on the job (done counts the days read by tally_ingest_day).
// Each piece logs the time of its own work (decoding, cutting, building and packing; not the waits for Storage or the queue).
const UPLOAD_BUCKET = "tally-uploads", UPLOAD_MAX = 2 * 1024 * 1024 * 1024;
const PIECE = Math.max(65536, Math.min(16 * 1024 * 1024, Math.floor(Number(Deno.env.get("TALLY_UPLOAD_PIECE")) || 4 * 1024 * 1024)));
const MAX_CARRY = 6 * 1024 * 1024;            // characters a piece's message may carry (an open day, a cut voucher; review M5: was 24 M)
// review M5: the cut voucher carried into the next piece; an entry longer than this stops the job with words
const MAX_TAIL = Math.max(65536, Math.floor(Number(Deno.env.get("TALLY_UPLOAD_MAX_TAIL")) || 2 * 1024 * 1024));
const addDay = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + n)).toISOString().slice(0, 10).replace(/-/g, "");
const realDay = (d: unknown) => isDay(d) && addDay(d as string, 0) === d;
function periodDays(from: string, to: string) { const out: string[] = []; for (let d = from; d <= to && out.length <= 4000; d = addDay(d, 1)) out.push(d); return out; }
function bytesB64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
// [from, to] of a stored upload (Supabase Storage answers a Range with 206 and Content-Range "bytes a-b/size"); null: not there.
// Review M4: never the whole object into memory. A server that ignores the Range (200: a proxy, a CDN, another backend):
// from the start only, at most the bytes asked are read from the stream and the rest cancelled; from further on it cannot be
// read in pieces at all (Fatal, with words). Review L5: Storage's own error text goes to the log only
async function storageRange(path: string, from: number, to: number): Promise<{ bytes: Uint8Array; size: number } | null> {
  const r = await fetch(URL.replace(/\/+$/, "") + "/storage/v1/object/authenticated/" + UPLOAD_BUCKET + "/" + path.split("/").map(encodeURIComponent).join("/"),
    { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, Range: "bytes=" + from + "-" + to } });
  const total = (h: string | null) => Number(((h || "").match(/\/(\d+)\s*$/) || [])[1] || 0);
  if (r.status === 404 || r.status === 400) { await r.body?.cancel(); return null; }
  if (r.status === 416) { await r.body?.cancel(); return { bytes: new Uint8Array(0), size: total(r.headers.get("content-range")) }; }
  if (!r.ok) {
    console.error("tally-ingest storage", r.status, path, (await r.text().catch(() => "")).slice(0, 300));
    throw new Error("FinCom's storage answered " + r.status + " for the uploaded Day Book; it is tried again.");
  }
  const want = to - from + 1;
  if (r.status === 206) {
    const all = new Uint8Array(await r.arrayBuffer());
    return { bytes: all.length > want ? all.subarray(0, want) : all, size: total(r.headers.get("content-range")) || from + all.length };
  }
  const size = Number(r.headers.get("content-length") || 0);
  if (from > 0 || !r.body || !size) {
    await r.body?.cancel();
    throw new Fatal("FinCom's storage did not answer the byte range asked (it sent the whole file), so the Day Book cannot be read in pieces: tell FinCom's support.");
  }
  const out = new Uint8Array(Math.min(want, size)), rd = r.body.getReader();
  let got = 0;
  while (got < out.length) {
    const { done, value } = await rd.read();
    if (done || !value) break;
    const k = Math.min(value.length, out.length - got);
    out.set(value.subarray(0, k), got); got += k;
  }
  await rd.cancel().catch(() => {});
  return { bytes: out.subarray(0, got), size };
}
// the bytes of whole characters only (a range end inside a character moves back to its start)
function wholeChars(b: Uint8Array, enc: string) {
  if (enc === "utf-16le") {
    let c = b.length & ~1;
    if (c >= 2) { const u = b[c - 2] | (b[c - 1] << 8); if (u >= 0xD800 && u <= 0xDBFF) c -= 2; }        // a surrogate pair cut in two
    return c;
  }
  let k = b.length - 1, back = 0;
  while (k >= 0 && (b[k] & 0xC0) === 0x80 && back < 3) { k--; back++; }
  if (k < 0) return b.length;
  const need = b[k] >= 0xF0 ? 4 : b[k] >= 0xE0 ? 3 : b[k] >= 0xC0 ? 2 : 1;
  return k + need > b.length ? k : b.length;
}
const dayXml = (vs: string[]) => "<ENVELOPE><BODY><DATA>" + vs.map((v) => "<TALLYMESSAGE>" + v + "</TALLYMESSAGE>").join("") + "</DATA></BODY></ENVELOPE>";
async function uploadPiece(job: string, firm: string, book: string, u: any) {
  const t0 = performance.now(); let wait = 0;
  const timed = async <T>(p: PromiseLike<T>): Promise<T> => { const t = performance.now(); try { return await p; } finally { wait += performance.now() - t; } };
  const rf = String(u?.range?.from || ""), rt = String(u?.range?.to || ""), path = String(u?.path || ""), late = u?.pass === "late";
  if (!path || !realDay(rf) || !realDay(rt)) throw new Error("the upload's piece is incomplete (path, period)");
  // review L2: only the job's own file, '<firm>/<job>.xml' (the path upload_new issued), is ever read
  if (path !== firm + "/" + job + ".xml") throw new Fatal("This upload's piece names another file than its job's; it is not read.");
  const from = Math.max(0, Math.floor(Number(u.from) || 0)), size0 = Math.floor(Number(u.size) || 0);
  const end = late ? Math.min(Math.floor(Number(u.end) || 0), size0) : size0;
  const got = from < end ? await timed(storageRange(path, from, Math.min(end, from + PIECE) - 1)) : { bytes: new Uint8Array(0), size: size0 };
  if (!got) throw new Error("The uploaded Day Book is not in FinCom's storage any more (" + path + ").");
  const bytes = got.bytes;
  let enc = String(u.enc || "");
  if (!enc) {
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) throw new Error("The file is UTF-16 big-endian, which Tally does not write: export the Day Book from Tally again.");
    enc = (bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes.length > 1 && bytes[1] === 0 && bytes[0] !== 0) ? "utf-16le" : "utf-8";
  }
  const isLast = from + bytes.length >= end;
  const cut = isLast ? bytes.length : wholeChars(bytes, enc);
  if (!isLast && cut === 0) throw new Error("a piece of the upload holds no whole character");
  const nextFrom = from + cut;
  const tail0 = typeof u.tail === "string" ? u.tail : "", tailLen = tail0.length, tailAt0 = Number.isFinite(Number(u.tailAt)) ? Number(u.tailAt) : from;
  // only the very start of the file may hold the BOM (dropped); elsewhere U+FEFF is text
  const text = tail0 + new TextDecoder(enc, { ignoreBOM: from > 0 }).decode(bytes.subarray(0, cut));
  const pend: Record<string, string[]> = (u.pend && typeof u.pend === "object") ? u.pend : {};
  const seen = new Set<string>(Array.isArray(u.seen) ? u.seen : []), lateDays = new Set<string>(Array.isArray(u.late) ? u.late : []), only = new Set<string>(Array.isArray(u.only) ? u.only : []);
  const ext: Record<string, number[]> = (u.ext && typeof u.ext === "object") ? u.ext : {};
  let top = String(u.top || ""), lastEnd = 0, n = 0, m: RegExpExecArray | null;
  const re = /<VOUCHER\b[\s\S]*?<\/VOUCHER>/g;
  while ((m = re.exec(text))) {
    lastEnd = re.lastIndex;
    const v = m[0], d = (v.match(/<DATE>(\d{8})<\/DATE>/) || [])[1];
    if (!d || d < rf || d > rt) continue;
    n++;
    if (late) { if (only.has(d)) (pend[d] = pend[d] || []).push(v); continue; }
    const at = m.index < tailLen ? tailAt0 : from, e = ext[d];
    ext[d] = e ? [Math.min(e[0], at), Math.max(e[1], nextFrom)] : [at, nextFrom];
    if (seen.has(d)) { lateDays.add(d); continue; }
    (pend[d] = pend[d] || []).push(v);
    if (d > top) top = d;
  }
  // the text after the last whole voucher: from a voucher's start (cut at the range end), else its last characters
  const k = text.slice(lastEnd).search(/<VOUCHER\b/);
  const tailStart = k >= 0 ? lastEnd + k : Math.max(lastEnd, text.length - 16);
  const tail = text.slice(tailStart), tailAt = tailStart < tailLen ? tailAt0 : from;
  // the days complete now: every day before the latest met (a Day Book is in date order); at the end, all
  const emit = late ? (isLast ? [...only].sort() : []) : Object.keys(pend).filter((d) => isLast || d < top).sort();
  const files: { day: string; vs: string[] }[] = emit.map((d) => ({ day: d, vs: pend[d] || [] }));
  for (const d of emit) delete pend[d];
  if (!late) {
    for (const d of emit) seen.add(d);
    if (isLast) for (const d of periodDays(rf, rt)) if (!seen.has(d)) { files.push({ day: d, vs: [] }); seen.add(d); }
  }
  if (tail.length > MAX_TAIL) throw new Fatal("An entry in the Day Book (near byte " + tailAt + ") is larger than FinCom reads (" + Math.round(tail.length / 1024) + " K characters, at most " + Math.round(MAX_TAIL / 1024) + " K): check that entry in Tally, then upload again.");
  let carry = tail.length; for (const d in pend) for (const v of pend[d]) carry += v.length;
  if (carry > MAX_CARRY) throw new Fatal("A day of the Day Book is larger than FinCom reads in one piece (" + Math.round(carry / 1048576) + " M characters): upload a shorter period.");
  // a file not in date order: the late days are read again whole after this (a second pass over the ranges their vouchers
  // were in); the job's total grows by them in the same step that queues the last piece's work, so the job is not done
  // before they are. Review M3: this piece's day files and its next piece are handed over in ONE call (tally_upload_advance,
  // migration 47), queued only while the job's cursor is this piece's own ('main:<from>' / 'late:<from>'), and the cursor
  // moved to the next piece's in the same transaction: a piece run again (killed before its message was archived) queues
  // nothing twice and raises the total once
  const lt = !late && isLast ? [...lateDays].sort() : [];
  const msgs: Record<string, unknown>[] = [];
  let batch: { day: string; gz: string }[] = [], bsize = 0, queued = 0;
  const flush = () => { if (batch.length) { msgs.push({ job, firm, book, days: batch }); queued += batch.length; batch = []; bsize = 0; } };
  for (const f of files) {
    const gz = bytesB64(await gzipBytes(new TextEncoder().encode(dayXml(f.vs))));
    if (batch.length && (bsize + gz.length > 4e6 || batch.length >= 31)) flush();
    batch.push({ day: f.day, gz }); bsize += gz.length;
  }
  flush();
  let next: Record<string, unknown> | null = null;
  if (!isLast) next = { ...u, from: nextFrom, enc, tail, tailAt, pend, seen: [...seen], late: [...lateDays].sort(), ext, top };
  else if (lt.length) {
    const a = Math.min(...lt.map((d) => ext[d][0])), b = Math.max(...lt.map((d) => ext[d][1]));
    next = { path, size: size0, range: { from: rf, to: rt }, enc, pass: "late", from: a, end: b, only: lt, pend: {}, tail: "", tailAt: a };
    console.log("tally-ingest upload not in date order: " + lt.length + " day(s) read again whole", job, lt.slice(0, 10).join(","));
  }
  if (next) msgs.push({ job, firm, book, upload: next });
  const at = (late ? "late:" : "main:") + from, nextAt = next ? ((next.pass === "late" ? "late:" : "main:") + next.from) : "end";
  const { data: adv, error: advErr } = await timed(db.rpc("tally_upload_advance", { p_job: job, p_at: at, p_next: nextAt, p_msgs: msgs, p_late: lt.length }));
  if (advErr) throw dbFail("upload piece " + job, advErr, "The upload's next part could not be queued just now; it is tried again.");
  if ((adv as any)?.moved === false) { console.log("tally-ingest upload piece", job, at, "ran again: its work was queued already (" + (adv as any)?.at + ")"); return; }
  await timed(jobStep(job, 0, []));
  console.log("tally-ingest upload piece", job, "from", from, cut, "bytes", "work", (performance.now() - t0 - wait).toFixed(1), "ms", "vouchers", n, "days", queued, late ? "late pass" : "", isLast ? "last" : "");
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
      const fatal = e instanceof Fatal;
      if (fatal || x.read_ct >= TRIES) { await db.rpc("tally_work_done", { p_msg: x.msg_id }); if (x.message?.job) await jobStep(String(x.message.job), 0, [{ error: why }], fatal ? why : "Stopped after " + TRIES + " tries: " + why); }
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
  // round 20 (migration 47): a Day Book through Storage. upload_new: the job (kind upload, its total the period's days) and
  // the path the app's resumable upload writes to; the period, size and name kept on the job (tally_jobs.upload). A cloud
  // without 47 answers 'unknown kind' (the app then hands the file over the old way)
  if (body.kind === "upload_new") {
    const from = String(body.from || ""), to = String(body.to || ""), size = Number(body.size), name = String(body.name || "").slice(0, 200);
    if (!realDay(from) || !realDay(to) || from > to || periodDays(from, to).length > 3700) return reply(400, { ok: false, error: "Give the Day Book's period: from and to as yyyymmdd, from not after to." });
    if (!Number.isInteger(size) || size <= 0) return reply(400, { ok: false, error: "Give the file's size in bytes." });
    if (size > UPLOAD_MAX) return reply(413, { ok: false, error: "The file is larger than 2 GB; export the Day Book in two parts." });
    const id = crypto.randomUUID(), path = `${firm}/${id}.xml`, total = periodDays(from, to).length;
    const { error } = await db.from("tally_jobs").insert({ id, firm_id: firm, client_id: client, book_id: book, kind: "upload", total, created_by: user, message: name, upload: { path, from, to, size, name } });
    // review L4: only the errors that mean 'no kind upload here' (the kind check, the upload column missing); any other is a 500
    if (error && (["42703", "PGRST204"].includes(String((error as any).code || "")) || /tally_jobs_kind_check/.test(String(error.message || "")))) {
      console.log("tally-ingest upload_new: the cloud does not take uploads yet (migration 47)", String(error.message || "").slice(0, 160));
      return reply(400, { ok: false, error: "unknown kind: this cloud does not take Day Book uploads yet (migration 47)" });
    }
    if (error) throw dbFail("upload_new", error, "The upload could not be started just now; try again.");
    return reply(200, { ok: true, job: id, path, bucket: UPLOAD_BUCKET, days: total });
  }
  // upload_done: the file is in Storage; the job sealed and its first piece queued (once: a second call changes nothing)
  if (body.kind === "upload_done") {
    const { data: j } = await db.from("tally_jobs").select("id, firm_id, client_id, book_id, kind, sealed, total, upload").eq("id", String(body.job || "")).maybeSingle();
    const up = (j as any)?.upload;
    if (!j || j.firm_id !== firm || j.client_id !== client || j.kind !== "upload" || !up || typeof up.path !== "string") return reply(404, { ok: false, error: "No such upload for this client." });
    if (body.path !== undefined && String(body.path) !== up.path) return reply(409, { ok: false, error: "That is not this upload's file." });
    if (j.sealed) return reply(200, { ok: true, job: j.id, already: true });
    const head = await storageRange(up.path, 0, 0);
    if (!head || !head.size) return reply(404, { ok: false, error: "The Day Book is not in FinCom's storage yet: finish the upload first." });
    if (Number(up.size) && head.size !== Number(up.size)) return reply(409, { ok: false, error: "The stored file is " + head.size + " bytes, not the " + up.size + " the upload began with: upload it again." });
    // review M2: one conditional update (where not sealed, returning): only the call that sealed it queues the split. Review
    // M3: the job's cursor starts at the first piece ('main:0'). Review L3: the job's own book, never the company linked now
    const { data: won, error: se } = await db.from("tally_jobs").update({ sealed: true, status: "running", updated_at: new Date().toISOString(), upload: { ...up, at: "main:0" } })
      .eq("id", j.id).eq("sealed", false).select("id");
    if (se) throw dbFail("upload_done", se, "The upload could not be started just now; try again.");
    if (!Array.isArray(won) || !won.length) return reply(200, { ok: true, job: j.id, already: true });
    const jb = String((j as any).book_id || book);
    if (jb !== book) console.log("tally-ingest upload_done: the company is linked to another book now; the job's book kept", j.id, jb, book);
    const { error } = await db.rpc("tally_work_send", { p_msg: { job: j.id, firm, book: jb, upload: { path: up.path, size: head.size, from: 0, range: { from: up.from, to: up.to } } } });
    if (error) {
      await db.from("tally_jobs").update({ sealed: false, status: "queued" }).eq("id", j.id);
      throw dbFail("upload_done", error, "The upload could not be queued just now; try again.");
    }
    console.log("tally-ingest upload_done: the split queued", j.id, up.path, head.size, "bytes", up.from + "-" + up.to);
    later(work(110000));
    return reply(200, { ok: true, job: j.id, queued: true, size: head.size, days: j.total });
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
// The owner's rule of 05-Oct-2026 (#14, as migration 54's tally_want_update): "open" and "ledgers" wake the company's own
// computer (tally_companies.device_id), every computer key of the firm (not removed) one of whose bridges has the
// company open, and the caller's own keys (created_by): each user's bridge on a shared server is its own key
const coName = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
function openOn(d: any) {
  const bs = d?.info?.bridges && typeof d.info.bridges === "object" ? d.info.bridges : {}, out = new Set<string>();
  for (const b of Object.values(bs) as any[]) for (const o of Array.isArray(b?.open) ? b.open : []) out.add(coName(o));
  return out;
}
async function wakeFor(firm: string, body: any, userId = "") {
  const what = body.what === "open" ? "open" : body.what === "active" ? "active" : body.what === "ledgers" ? "ledgers" : "";
  if (!what) return reply(400, { ok: false, error: "Say what: open, active or ledgers." });
  const at = new Date().toISOString();
  let links: { company: string; device_id: string }[] = [];
  if (what === "open" || what === "ledgers") {
    const { data } = await db.from("tally_companies").select("company, device_id").eq("firm_id", firm).eq("client_id", String(body.client || ""));
    links = ((data || []) as any[]).filter((r: any) => r.device_id || r.company);
    if (!links.length) return reply(200, { ok: true, woken: 0 });
  }
  const { data: all } = await db.from("tally_devices").select("*").eq("firm_id", firm);
  // the companies of this client a key is woken for: its own (the company's computer), those open there, all for the caller's own key
  const cosOf = (d: any) => { const o = openOn(d), mine = !!userId && d.created_by === userId;
    return [...new Set(links.filter((r) => r.device_id === d.id || mine || o.has(coName(r.company))).map((r) => r.company))]; };
  const devs = what === "active" ? (all || []) : (all || []).filter((d: any) => cosOf(d).length > 0);
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
      const mineCos = cosOf(d), cos = mineCos.filter((c) => !(led[c] && Date.parse(led[c]) > Date.now() - 60000));
      debounced += mineCos.length - cos.length;
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
    const cos = what === "open" ? cosOf(d) : [];
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
  if (body.kind === "wake") return await wakeFor(firm, body, user.id);
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
  // final review M3 (migration 54): the bridge moves itself to its new computer key. This call comes with the NEW key; its
  // body holds the OLD key the bridge id is bound to: only a program holding both keys can ask (a member alone cannot move
  // a bridge, and no owner is needed for one's own). Answered before the id is bound to the new key
  if (body?.kind === "own_key") {
    try { return await ownKey(dev, firm, body); } catch (e) { console.error("tally-ingest own_key", (e as Error).message); return reply(500, { ok: false, error: (e as Error).message }); }
  }
  // migration 54 (review M3): a bridge id ("go-…", which the bridge reports itself) belongs to the first computer key that
  // reported it (tally_bridge_ids); another key naming it (an id copied from another Windows user's settings) is refused,
  // and nothing it says is kept. A cloud without the function: as before
  let boundOwn = "";     // 2.3.1: the bridge id the bind just found this computer's own (its idRefused, if any, was cleared there)
  {
    const bid = body?.bridge && typeof body.bridge === "object" ? String(body.bridge.id || "") : "";
    if (/^go-[0-9a-f]{6,32}$/.test(bid)) {
      // Fix 2c: the words (naming the computer and Windows user the id belongs to) go to the bridge, which shows them in
      // its tray; the database keeps them on this computer's line and one bell alert for the owners
      const { data: bound, error: be } = await db.rpc("tally_bridge_bind", { p_device: dev.id, p_bridge: bid });
      // 2.3.1 (2.3.0 review round 1 L1): only a cloud without the function (PGRST202) goes on unchecked; any other error
      // refuses the call (the bridge asks again) and is logged, never passes as "own"
      if (be && be.code !== "PGRST202" && !missingFn(String(be.message || ""))) {
        console.error("tally-ingest: tally_bridge_bind", dev.id, bid, String(be.message || "").slice(0, 200));
        return reply(503, { ok: false, error: "FinCom's cloud could not check this bridge just now; it asks again by itself." });
      }
      if (!be && bound && typeof bound === "object" && bound.own === false) {
        console.error("tally-ingest: bridge id of another computer", dev.id, bid);
        return reply(409, { ok: false, idRefused: true, error: String(bound.words || "This computer key cannot use bridge " + bid + ". Ask the firm's owner.").slice(0, 400) });
      }
      if (!be && bound && typeof bound === "object" && bound.own === true) boundOwn = bid;
    }
  }
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
            waiting: Math.max(0, Math.min(1e6, Math.floor(Number(c?.waiting) || 0))), lastRead: s(c?.lastRead, 30),
            // phase 2 (migration 44): Tally's highest change numbers and the recorder's state, when the bridge says them
            ...(altOf(c?.altvchid) !== null ? { altvchid: altOf(c?.altvchid), altmstid: altOf(c?.altmstid) } : {}),
            ...(typeof c?.recorderSeen === "boolean" ? { recorderSeen: c.recorderSeen, recorderLastAt: s(c?.recorderLastAt, 40) } : {}) })),
          // go-bridge: Tally open / busy (open, slow to answer) / closed, and how often the beat comes (2.0: 30 s; 1.15.0: 60 s)
          tallyState: ["open", "busy", "closed"].includes(b.tallyState) ? b.tallyState : (b.tally ? "open" : "closed"), busySince: s(b.busySince, 30),
          every: Math.max(10, Math.min(600, Math.floor(Number(b.every) || 60))), version: s(body.version, 40),
          // FinCom Bridge 2.1.3: background reading paused in its tray, since when Tally has not answered, the hour of the
          // nightly catch-up, the last read from Tally, and that it reads Tally only after an event
          paused: !!b.paused, notAnsweringSince: s(b.notAnsweringSince, 30), nightlyAt: s(b.nightlyAt, 5), lastRead: s(b.lastRead, 30), events: !!b.events,
          // FinCom Bridge 2.1.5 (migration-35): its request timings, and whether it stopped reading (by itself, or from FinCom);
          // round 2 (migration-34): its allow-list state
          reqs: cleanReqs(b.reqs), readStopped: cleanReadStopped(b.readStopped), allowlist: cleanAllowlist(b.allowlist),
          // FinCom Bridge 2.1.6 (round 11): the companies this computer posts to (PostOnly); [] when any; absent on an older bridge
          ...(Array.isArray(b.postOnly) ? { postOnly: cleanPostOnly(b.postOnly) } : {}),
          // FinCom Bridge 2.1.8 (round 15, migration 43): the posting settings it applied (postBatchBills, postBatchBank, settingsAt)
          ...postSettingsApplied(b),
          // FinCom Bridge 2.3.0: the Windows user it works for, its own local port, its Tally's port and data folder
          // bridge 2.3.1 (review H1): why this computer's changes wait (its own Tally lists its companies too slowly), in plain words
          ...(s(b.recorderWaitWords, 300) ? { recorderWaitWords: s(b.recorderWaitWords, 300) } : {}),
          // bridge 2.3.1 (the owner's last change): a request not answered in time, and when it tries again by itself
          ...tallyRetryOf(b),
          windowsUser: s(b.windowsUser, 60), bridgePort: Math.max(0, Math.min(65535, Math.floor(Number(b.bridgePort) || 0))), tallyPort: Math.max(0, Math.min(65535, Math.floor(Number(b.tallyPort) || 0))), dataFolder: s(b.dataFolder, 260) };
        const prevInfo = ((dev as any).info && typeof (dev as any).info === "object") ? (dev as any).info : {};
        const me = bridgeOf(dev, body, false);
        // migration 54: switched to changes only by an owner (said on the bridge's line and to the bridge)
        const co = await changesOnly(dev, me.id);
        if (co) (me.entry as any).changesOnly = true;
        // migration-35: Stop reading from FinCom, Resume, the version it may install (and the pilot's evidence)
        const ctl = await bridgeControl(dev, firm, me, prevInfo);
        const info = { ...prevInfo, ...ctl.info, beat, history: beatHistory(prevInfo, beat), bridges: bridgesWith(prevInfo, me.id, me.entry) };
        // 2.3.1 (2.3.0 review, cloud Lows): the computer's row was read before the bind; a refusal of THIS bridge's id that
        // the bind has just cleared (the id is this computer's own again) is not written back. Another bridge's is kept
        if (boundOwn && boundOwn === me.id && (info as any).idRefused?.bridge === me.id) delete (info as any).idRefused;
        // build 197: someone pressed Update now on another computer: the bridge is told in this answer, once
        const want = (dev as any).want_update_at, sent = (dev as any).want_sent_at;
        const updateNow = !!want && (!sent || Date.parse(want) > Date.parse(sent));
        await db.from("tally_devices").update(updateNow ? { info, want_sent_at: want } : { info }).eq("id", dev.id);
        // 02-Oct-2026: a new last read, a read going on, or Tally's state changed: passed on at once on the firm's
        // broadcast channel (FinCom's pages listen: Live.joinTally), so "read 17:43" / "Reading now…" changes at once
        // instead of when a page next looks at tally_devices. Only the times and states, nothing of the books or keys
        const pb = (prevInfo.beat && typeof prevInfo.beat === "object") ? prevInfo.beat : {};
        const said = (x: any, stop: unknown) => JSON.stringify([x.lastRead || "", !!x.updating, x.tallyState || "", !!x.paused, x.notAnsweringSince || "",
          (Array.isArray(x.companies) ? x.companies : []).map((c: any) => [c.name, c.lastRead || "", c.at || ""]), x.reqs ?? null, x.readStopped ?? null, stop ?? null, x.postOnly ?? null, x.postBatchBills ?? null, x.postBatchBank ?? null, x.settingsAt ?? null, x.tallyRetry?.words ?? null]);
        if (said(pb, prevInfo.readStop) !== said(beat, (info as any).readStop)) {
          await broadcast("fincom-tally-" + firm, "beat", { device: dev.id, beat: { at: beat.at, every: beat.every, lastRead: beat.lastRead, updating: beat.updating, tallyState: beat.tallyState,
            tally: beat.tally, paused: beat.paused, notAnsweringSince: beat.notAnsweringSince, busySince: beat.busySince, open: beat.open,
            companies: beat.companies.map((c: any) => ({ name: c.name, open: c.open, at: c.at, phase: c.phase, waiting: c.waiting, lastRead: c.lastRead })),
            bridge: me.id, reqs: beat.reqs, readStopped: beat.readStopped, readStop: (info as any).readStop ?? null, postOnly: (beat as any).postOnly ?? null,
            postBatchBills: (beat as any).postBatchBills ?? null, postBatchBank: (beat as any).postBatchBank ?? null, settingsAt: (beat as any).settingsAt ?? null,
            // bridge 2.3.1: a request not answered in time and when it tries again by itself (null: as normal)
            tallyRetry: (beat as any).tallyRetry ?? null } });
        }
        // 2.1.8 (round 15, migration 43): the owner's per-computer posting settings (tally_device_post_settings), read from the
        // device's row: postOnly (null = no restriction, [] = any company, else the names), the batch sizes, and when they were
        // set. On a cloud without the columns every field is null; the beat never fails for them
        const settings = { postOnly: Array.isArray((dev as any).post_only) ? (dev as any).post_only : null, postBatchBills: cleanBatch((dev as any).post_batch_bills), postBatchBank: cleanBatch((dev as any).post_batch_bank),
          at: typeof (dev as any).post_settings_at === "string" ? (dev as any).post_settings_at : null };
        // migration 54: only the postings this bridge may take (for it, or naming none when it is the main bridge); none when changes only
        const may = mayPost(dev, me.id, (me.entry as any).user);
        if (co || !may) await rescuePosts(dev);
        // migration 55: a check waiting for this bridge counts as work too (the bridge then asks posts_take, which carries it)
        // (final review M1: the checks of the postings this bridge took or is named in; with no record, only the key's main bridge)
        const posts = co ? 0 : await postsFor(dev, me.id, may && isMain(dev, me.id)) + (may ? (await checksFor(dev, me.id, isMain(dev, me.id))).length : 0);
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
        // phase 2 (migration 44): a PC without the add-on - the change numbers compared with the recorder's lines. Round 19: read
        // from both shapes of the beat (companies[] first, else the top-level startPoint / changeNumbers of 2.1.9), the
        // starting point recorded first (tally_start_point, once)
        const recorder = await recorderGaps(dev, firm, me.id, beatChanges(b));
        // round 19 (migration 46): the owner's switch "Trial tools on this computer" (tally_devices.trial_tools); a cloud
        // without the column answers false
        const trialTools = (dev as any).trial_tools === true;
        // round 20 (migration 47): where this computer's changes come from (the owner's tally_device_recorder_source): addon,
        // alterid or both; left out when the cloud has no column (the bridge keeps its own default)
        const rs = (dev as any).recorder_source, recorderSource = rs === "addon" || rs === "alterid" || rs === "both" ? rs : null;
        // FinCom Bridge 2.2.2: the lines held without their entry, asked of Tally again by the bridge (left out when none)
        const heldLines = await heldLinesFor(dev, firm, me.id);
        // 06-Oct-2026: this bridge's own held lines without their entry's body or with a placeholder GUID, at most 20
        const refetch = await refetchFor(dev, firm, me.id);
        // bridge 2.3.1 (masters): the ledgers this bridge's held lines wait for, fetched by the bridge before the entry
        const ledgersWanted = await ledgersWantedFor(dev, firm, me.id);
        return reply(200, { ok: true, updateNow, posts: posts || 0, wake, opened, ledgers, activityAt, settings, trialTools, ...(recorderSource ? { recorderSource } : {}), ...(Object.keys(recorder).length ? { recorder } : {}), ...(heldLines ? { heldLines } : {}), ...(refetch ? { refetch } : {}), ...(ledgersWanted ? { ledgersWanted } : {}), ...(co ? { notMain: true, changesOnly: true, error: CHANGES_ONLY } : may ? {} : { notMain: true }), ...ctl.out });
      }
      case "make_main": return await makeMain(dev, bridgeOf(dev, body, false).id);
      case "posts_take": {
        const meB = bridgeOf(dev, body, false), meT = meB.id;
        // review M-B: refused, but a posting that was for this bridge is moved to the one that may post (or failed in words) first
        if (!mayPost(dev, meT, (meB.entry as any).user)) { await rescuePosts(dev); return reply(403, { ok: false, notMain: true, error: "Another bridge of the same Windows user is the main bridge on this computer now (chosen in FinCom); this one reads only and does not post." }); }
        if (await changesOnly(dev, meT)) { await rescuePosts(dev); return reply(403, { ok: false, notMain: true, changesOnly: true, error: CHANGES_ONLY }); }
        // migration 54: only a posting naming this bridge, or naming none when it is the key's main bridge (#7: on a key
        // shared with another Windows user whose bridge is the main one, this bridge takes only its own); an older cloud: as before
        const main = isMain(dev, meT);
        let { data, error } = await db.rpc("tally_post_take_for", { p_device: dev.id, p_bridge: meT, p_main: main });
        if (error && (error.code === "PGRST202" || missingFn(String(error.message || "")))) ({ data, error } = main ? await db.rpc("tally_post_take", { p_device: dev.id }) : { data: [], error: null });
        if (error) throw new Error(error.message);
        const j = (data || [])[0];
        // round 7 (F2): the ids of this posting an owner released (Not in Tally) travel with it, so the bridge sends them
        // once and does not mark them accepted from its memory of a first send; none on a cloud without migration 36b
        let released: unknown[] = [];
        // final review M1 / L2 (migrations 54, 55): handed back after this bridge's "not found": the entries to send again,
        // and only those (resend_only); the bridge sends nothing else of the posting
        const resendOnly = j && Array.isArray(j.resend_only) ? j.resend_only.filter((x: unknown) => typeof x === "string" && x).slice(0, 5000) : [];
        if (j) {
          const { data: rel, error: relErr } = await db.from("tally_post_ids").select("entry_id, fincom_id, released_at, released_by, released_why").eq("job_id", j.id).eq("released_by", "owner");
          if (!relErr) released = (rel || []).filter((r: any) => r.released_at).map((r: any) => ({ id: r.entry_id || r.fincom_id, at: r.released_at, by: r.released_by, why: r.released_why }));
        }
        // migration 55 (decision B): the checks waiting for this bridge travel with it ([] on a cloud without 55). Final review
        // M1: only those of the postings it took (or is named in); a posting with no record, only for the key's main bridge
        const checks = await checksFor(dev, meT, main);
        return reply(200, { ok: true, job: j ? { id: j.id, company: j.company, payload: j.payload, released, ...(resendOnly.length ? { resendOnly } : {}) } : null, ...(checks.length ? { checks } : {}) });
      }
      case "post_check": {
        // migration 55 (decision B): the bridge looked in Tally for an entry of an uncertain posting ("Not in Tally - post
        // again"): found (the voucher found), notseen (not in that company on that day) or unable (Tally not asked). The
        // database decides; it never releases on a report (a member confirms "not there" after looking)
        const meCB = bridgeOf(dev, body, false), meC = meCB.id;
        if (!mayPost(dev, meC, (meCB.entry as any).user)) return reply(403, { ok: false, notMain: true, error: "Another bridge of the same Windows user is the main bridge on this computer now (chosen in FinCom); this one reads only and does not post." });
        if (await changesOnly(dev, meC)) return reply(403, { ok: false, notMain: true, changesOnly: true, error: CHANGES_ONLY });
        const result = String(body.result || "");
        // the owner's rule (a duplicate entry must never be possible from this button): notseen (Tally answered for that
        // company and has no such voucher on that day) never releases; only a member's confirm does (the database).
        // "notfound" (an earlier word) is taken as notseen
        if (!["found", "notseen", "notfound", "unable"].includes(result)) return reply(400, { ok: false, error: "The check's result is found, notseen or unable." });
        const s = (v: unknown, n: number) => typeof v === "string" ? v.slice(0, n) : "";
        // final review M1: the database answers only the bridge that took the posting (or is named in it); p_main (the
        // key's main bridge) counts only for a posting with no record of its bridge
        const { data, error } = await db.rpc("tally_post_check_report", { p_check: Math.max(0, Math.floor(Number(body.check) || 0)), p_device: dev.id, p_bridge: meC, p_main: isMain(dev, meC),
          p_company: s(body.company, 200), p_result: result, p_vch: s(body.vch, 60), p_master: s(body.master, 30), p_words: s(body.words, 500) });
        if (error) return (error.code === "PGRST202" || missingFn(String(error.message || ""))) ? reply(409, { ok: false, error: "FinCom's cloud is not ready for this yet (migration 55)." }) : reply(500, { ok: false, error: error.message });
        return reply(200, data);
      }
      case "posts_update": {
        const meUB = bridgeOf(dev, body, false), meU = meUB.id;
        if (!mayPost(dev, meU, (meUB.entry as any).user)) return reply(403, { ok: false, notMain: true, error: "Another bridge of the same Windows user is the main bridge on this computer now (chosen in FinCom); this one reads only and does not post." });
        // migration 54: a posting for another bridge is never reported by this one (a cloud without the column: as before).
        // A bridge switched to changes only still reports a posting it took before the switch
        {
          const { data: tj, error: te } = await db.from("tally_post_jobs").select("target_bridge").eq("id", String(body.id || "")).eq("device_id", dev.id).maybeSingle();
          if (te && !missingRel(te)) console.error("tally-ingest: posts_update target check not read", dev.id, String(body.id || "").slice(0, 60), String(te.message || "").slice(0, 200));     // 2.3.1: logged
          if (!te && tj?.target_bridge && tj.target_bridge !== meU) return reply(403, { ok: false, error: "This posting is for another bridge on this computer; this one does not report it." });
        }
        const st = ["taken", "running", "done", "failed"].includes(body.status) ? body.status : "running";
        const s = (v: unknown, n: number) => typeof v === "string" ? v.slice(0, n) : "";
        const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v)) || 0));
        const secs = (v: unknown) => Math.max(0, Math.min(86400 * 30, Math.round((Number(v) || 0) * 1000) / 1000));
        const REPLY_KEYS = ["byReply", "vchId", "batchEnd", "batchN", "needsReview", "exceptions", "ignored", "errors", "lineError", "company", "sentAt", "secondsReq", "alreadySent"];
        // the review of 2.1.8 (finding 8): the bridge's lineError is an array of Tally's LINEERROR texts: at most 5, each cut to 200; a lone text is one
        const lineErrs = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x) => typeof x === "string" && x).slice(0, 5).map((x) => String(x).slice(0, 200));
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
          refused: !!r?.refused, postOnly: !!r?.postOnly,
          // 2.1.8 (round 15, migration 43): posting by Tally's reply: byReply (ok decided by the reply's counts), vchId (Tally's
          // exact voucher id when the request held this voucher alone), batchEnd / batchN (the request's LASTVCHID and size),
          // needsReview (Tally created something with exceptions, or nothing), the reply's counts, the line in error, the
          // company Tally answered for, when it was sent and how long the request took. Kept only when the bridge sends them
          ...(REPLY_KEYS.some((k) => r && typeof r === "object" && k in r) ? { byReply: !!r?.byReply, vchId: s(r?.vchId, 30), batchEnd: s(r?.batchEnd, 30), batchN: int(r?.batchN, 500), needsReview: !!r?.needsReview,
            exceptions: int(r?.exceptions, 1e6), ignored: int(r?.ignored, 1e6), errors: int(r?.errors, 1e6), lineError: lineErrs(r?.lineError), company: s(r?.company, 200), sentAt: s(r?.sentAt, 40), secondsReq: secs(r?.secondsReq),
            // the review of 2.1.8 (finding 5): this computer sent the entry before (its own record): a refusal that is an acceptance, kept locked
            alreadySent: !!r?.alreadySent } : {}) }));
        // 2.1.8: the bridge's request timings of the posting, for tally_post_jobs.timing (migration 43; dropped on an older cloud)
        const reqs = Array.isArray(body.reqs) ? body.reqs.slice(0, 1000).map((x: any) => ({ n: int(x?.n, 500), seconds: secs(x?.seconds), created: int(x?.created, 1e6), altered: int(x?.altered, 1e6), exceptions: int(x?.exceptions, 1e6), ignored: int(x?.ignored, 1e6), lastVchId: s(x?.lastVchId, 30) })) : null;
        const timing = reqs || body.secondsTotal !== undefined ? { reqs: reqs || [], secondsTotal: secs(body.secondsTotal) } : null;
        // 02-Oct-2026: each entry's state as the bridge sees it (waiting / sending / sent / in_tally / failed, with why)
        // notfound (migration 37): checked and not in Tally; posted / needs_review (bridge 2.1.8, by Tally's reply; the review's finding 3)
        const STATES = ["waiting", "sending", "sent", "in_tally", "failed", "unknown", "notfound", "posted", "needs_review"];
        const items = Array.isArray(body.items) ? body.items.slice(0, 5000).map((x: any) => ({ id: s(x?.id, 200), kind: s(x?.kind, 10),
          state: STATES.includes(x?.state) ? x.state : "waiting", reason: s(x?.reason, 500),
          // bridge 2.1.4: a failed item that was not posted because the same bill is in Tally (with its voucher), or
          // because Tally could not be checked first
          ...(x?.already ? { already: true, guid: s(x?.guid, 100), vchNo: s(x?.vchNo, 60), vchDate: s(x?.vchDate, 8) } : {}), ...(x?.checkFailed ? { checkFailed: true } : {}),
          ...(x?.outcomeUnknown ? { outcomeUnknown: true } : {}), ...(x?.postOnly ? { postOnly: true, refused: true } : {}) })) : null;
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
        // 2.1.8: a needsReview result WITHOUT accepted (Tally created nothing) is never an acceptance, whatever its counts or words
        // (finding 5) an alreadySent refusal (this computer sent the entry before, on its own record) is an acceptance: locked, never released
        const acceptedRes = (r: any) => r.alreadySent === true || (!(r.refused === true && r.postOnly === true) && !(r.needsReview === true && r.accepted !== true)
          && !!(r.ok || r.accepted || r.held || r.created > 0 || r.altered > 0 || r.lastVchId || r.vchNumber || r.masterId || r.guid || acceptedMsg(r.message) || acceptedMsg(r.reason)));
        const accepted = new Set<string>(results.filter((r: any) => r.id && acceptedRes(r)).map((r: any) => fid(r.id)));
        // the voucher id to stamp: the exact one (vchId); lastVchId only when the result is not an entry of a batch (finding 4: the
        // bridge puts the request's LASTVCHID on every entry of a batch, and a batch end is never an entry's voucher id); an
        // alreadySent refusal gives vchId alone, and only when its request held one voucher (never an inferred id)
        const batchN = (r: any) => Math.floor(Number(r && r.batchN) || 0);
        const vchOf = (r: any) => r.alreadySent === true ? (batchN(r) === 1 ? String(r.vchId || "") : "")
          : batchN(r) > 1 ? String(r.vchId || "")     // an entry of a batch: its words name the request's LASTVCHID, not its own id
          : String(r.vchId || r.lastVchId || r.vchNumber || r.masterId || ((String(r.message || "") + " " + String(r.reason || "")).match(/\b(?:LASTVCHID|VCHID|MASTERID|voucher(?: no\.?| number)?)\D{0,6}([1-9]\d*)/i) || [])[1] || "");
        if (items) for (const x of items as any[]) if (x.id && !x.postOnly && (x.state === "failed" || x.state === "notfound") && acceptedMsg(x.reason)) accepted.add(fid(x.id));
        // the accepted entries not confirmed: the ones that hold the posting
        const itemOf = (a: string) => ((items || []) as any[]).find((x) => fid(x.id) === a);
        const unconfirmed = new Set<string>();
        for (const a of accepted) {
          const r0 = (results as any[]).find((r) => fid(r.id) === a), x0 = itemOf(a);
          // 2.1.8: an entry posted by Tally's reply (byReply + ok) is taken: it never holds the posting open (tally_post_result_taken, migration 43)
          // (finding 5) an alreadySent refusal holds nothing open and is never rewritten as being checked: it is kept as it came
          const confirmed = (r0 && r0.verified === true) || (r0 && r0.byReply === true && r0.ok === true) || (r0 && r0.alreadySent === true) || ["in_tally", "sent"].includes(String((r0 && r0.state) || "")) || ["in_tally", "sent"].includes(String((x0 && x0.state) || ""));
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
        let mergedResults = merge(results as any[], ownerOf(cur.results)), mergedItems = items ? merge(items as any[], ownerOf(cur.items)) : null;
        // final review M1 / L2: a posting handed back to send only some entries again (resend_only): the bridge reports those;
        // every other entry's result stands as it was (never rewritten as missing)
        {
          const { data: ro, error: roErr } = await db.from("tally_post_jobs").select("resend_only").eq("id", id).eq("device_id", dev.id).maybeSingle();
          if (!roErr && Array.isArray(ro?.resend_only) && ro.resend_only.length) {
            const keepOld = (mine: any[], old: any[]) => mine.concat((Array.isArray(old) ? old : []).filter((x) => x && x.id && !mine.some((m) => fid(m.id) === fid(x.id))));
            mergedResults = keepOld(mergedResults, cur.results);
            if (mergedItems) mergedItems = keepOld(mergedItems, cur.items);
          }
        }
        let stale = false;
        // the review of 2.1.8 (finding 2, the cloud half): a 'failed' update that carries an entry sent with no answer from Tally
        // (outcomeUnknown, or sent / state sent, not ok) is stored done: the posting never goes to 'failed' while an entry may be
        // in Tally (tally_post_ids_sync would free its id, and Post again could double it). The bridge sends done too
        const noAnswer = st === "failed" && (results as any[]).some((r) => !r.ok && (r.outcomeUnknown === true || r.sent === true || r.state === "sent") && !accepted.has(fid(r.id)));
        let status = heldOpen || noAnswer ? "done" : st;
        // done or failed never goes back to running or taken (a late update of the bridge while the posting is being checked)
        let checking = heldOpen || !!body.checking;
        // (R2) a posting held for checking (done + checking) keeps that while the bridge is still sending running updates
        if (["done", "failed"].includes(cur.status) && ["running", "taken"].includes(status)) { status = cur.status; stale = true; checking = !!cur.checking; }
        const row: Record<string, unknown> = { status, done: Math.max(0, Math.floor(Number(body.done) || 0)), message: s(body.message, 500), results: mergedResults, checking, updated_at: new Date().toISOString() };
        if (heldOpen) row.message = s("Posted, not yet confirmed: Tally accepted " + unconfirmed.size + (unconfirmed.size === 1 ? " entry" : " entries") + " the bridge reported failed; held for checking, not posted again. " + s(body.message, 300), 500);
        if (mergedItems) row.items = mergedItems;
        if (seq !== null) row.seq = seq;
        if (timing) row.timing = timing;
        // F3: the posting's ids read once; only an id not yet stamped is stamped, only one not yet released is released
        // (the bridge reports every few seconds). Not readable (an older cloud): every one, as before
        let known: any[] | null = null;
        if (accepted.size || (items || []).some((x: any) => x.state === "failed" || x.state === "notfound") || (results as any[]).some((r) => r.needsReview)) {
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
          // 2.1.8 (migration 43): an entry posted by Tally's reply is stamped with the reply (the exact voucher id when the
          // request held it alone, the request's LASTVCHID and size): tally_post_id_accept_reply; on a cloud without 43 the
          // function is missing ('Could not find the function', as missing34 reads it) and the plain stamp is used
          let accData: unknown = null, accErr: any = null, fnName = "tally_post_id_accept";
          if (r0.byReply === true && r0.ok === true) {
            fnName = "tally_post_id_accept_reply";
            ({ data: accData, error: accErr } = await db.rpc("tally_post_id_accept_reply", { p_job: id, p_id: a, p_vch: r0.vchId || null, p_batch_end: r0.batchEnd || null, p_batch_n: r0.batchN || null }));
            if (accErr && /tally_post_id_accept_reply|could not find|does not exist|schema cache/i.test(String(accErr.message || ""))) fnName = "tally_post_id_accept";
          }
          if (fnName === "tally_post_id_accept") ({ data: accData, error: accErr } = await db.rpc("tally_post_id_accept", { p_job: id, p_id: a, p_vch: r0.alreadySent === true ? vchOf(r0) : (vchOf(r0) || vchOf(x0)) }));
          if (accErr && !/tally_post_id_accept|schema cache|does not exist/i.test(accErr.message)) console.error(fnName, accErr.message);
          else if (!accErr && accData && typeof accData === "object" && (accData as any).stamped === 0) console.warn(fnName + ": stamped 0 for " + a + " (" + s(r0.id || x0.id, 60) + ") in posting " + id + ": no id of the posting matches");
        }
        let { error } = await db.from("tally_post_jobs").update(row).eq("id", id).eq("device_id", dev.id).neq("status", "cancelled");
        // before migration-36b there is no seq column, before migration-24 no items column: the rest is kept as before
        if (error && "timing" in row && /timing/.test(error.message)) { delete row.timing; ({ error } = await db.from("tally_post_jobs").update(row).eq("id", id).eq("device_id", dev.id).neq("status", "cancelled")); }
        if (error && "seq" in row && /seq/.test(error.message)) { delete row.seq; ({ error } = await db.from("tally_post_jobs").update(row).eq("id", id).eq("device_id", dev.id).neq("status", "cancelled")); }
        if (error && items && /items/.test(error.message)) { delete row.items; ({ error } = await db.from("tally_post_jobs").update(row).eq("id", id).eq("device_id", dev.id).neq("status", "cancelled")); }
        if (error) throw new Error(error.message);
        // migration 45: the posting window (Tally's change numbers before and after the job), saved only now: after the update's
        // own checks (not cancelled, not late, not settled) and its row stored (the review's L8)
        if (body.window !== undefined && body.window !== null) await postWindow(firm, dev, id, body.window);
        // migration 45 (the review's M6): short lines held before this acceptance reached the cloud are applied now
        if (accepted.size) await retryHeldShort(firm, id);
        // migration 37 (item 7): an entry refused or not found in Tally releases its id (tally_post_id_release: job, id,
        // why), per entry, so Post again is offered for it alone. On the states after the guard above: never an unknown
        // entry, never one Tally accepted. Before migration 37 the function is missing: skipped
        // 2.1.8 (migration 43): a needsReview result without accepted (Tally created nothing) releases its id with the reason
        // 'needs review: ' + the bridge's message, once (its item, failed, is not released again below)
        const releasedNow = new Set<string>();
        for (const r of results as any[]) {
          if (!r.id || r.needsReview !== true || r.accepted === true || accepted.has(fid(r.id))) continue;
          const k = rowOf(fid(r.id));
          if (known && k && k.released_at) continue;
          releasedNow.add(fid(r.id));
          const { error: relErr } = await db.rpc("tally_post_id_release", { p_job: id, p_id: r.id, p_why: ("needs review: " + String(r.message || r.reason || r.lineError || "")).slice(0, 500) });
          if (relErr && !/tally_post_id_release|schema cache|does not exist/i.test(relErr.message)) console.error("tally_post_id_release", relErr.message);
        }
        for (const x of (items || []) as any[]) {
          if (!x.id || !(x.state === "failed" || x.state === "notfound") || accepted.has(fid(x.id)) || releasedNow.has(fid(x.id))) continue;
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
      case "ledger_changes": {
        // bridge 2.3.1 (masters): the ledgers created or altered since Tally's master counter last moved, or one an entry uses
        if (!ledgerListAllowed(String(dev.id))) return reply(429, { ok: false, error: "This computer has sent sixty ledger lists in the last minute; try again in a minute." });
        const book = await bookFor(firm, String(body.company || ""));
        if (!book) return reply(409, { ok: false, notLinked: true, error: "This Tally company is not linked to a FinCom client yet." });
        return await applyLedgerChanges(firm, book, body);
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
      case "recorder_lines": case "start_point": {
        const book = await bookFor(firm, String(body.company || ""));
        if (!book) return reply(409, { ok: false, notLinked: true, error: "This Tally company is not linked to a FinCom client yet." });
        return body.kind === "recorder_lines" ? await recorderLines(dev, firm, book, body) : await startPoint(dev, firm, book, body);
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
