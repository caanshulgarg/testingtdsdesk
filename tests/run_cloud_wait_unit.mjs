// node tests/run_cloud_wait_unit.mjs - the reliability round of 11-Nov-2026, the two small pieces by themselves (the code
// is read out of src/js, as the page runs it):
// 1. Cloud.timed / Cloud.waitFor (src/js/27), and the token's refresh (src/js/43): a request with no answer is given up after its wait with e.timedOut and
//    words a person can read, and is itself stopped; an answer or a failure in time passes through as it is and stops
//    nothing; the wait: 20 s, a second more for each 8 KB sent, two minutes at most, or the caller's own.
// 2. TStale / tallyMark (src/js/49): a read that failed is "Could not check just now, trying again" as of the last good
//    read; the computers' state is judged at that moment (never "offline" from FinCom's own failure); a status loses its
//    green tick and says so; when the read works again nothing is marked.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(HERE, "..", "src", "js", f), "utf8");
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); if (i < 0 || j < 0) throw new Error("not found: " + a); return s.slice(i, j); };
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("== 1. Cloud.timed, Cloud.waitFor");
const Cloud = new Function("num", "return ({" + cut(src("27-firm-account.js"), "  WAIT: 20000,", "  async authCall(") + "});")((x) => Number(x) || 0);
ok(Cloud.waitFor({}, undefined) === 20000 && Cloud.waitFor(null, "") === 20000, "a read waits 20 s");
ok(Cloud.waitFor({}, "x".repeat(80000)) === 30000, "a save of 80 KB: 30 s (" + Cloud.waitFor({}, "x".repeat(80000)) + ")");
ok(Cloud.waitFor({}, "x".repeat(5e6)) === 120000, "two minutes at most");
ok(Cloud.waitFor({ timeout: 90000 }, "") === 90000 && Cloud.waitFor({ timeout: 5000 }, "x".repeat(5e6)) === 5000, "the caller's own wait");
{
  let sig = null, t0 = Date.now(), err = null;
  await Cloud.timed(60, (s) => { sig = s; return new Promise(() => {}); }).catch((e) => { err = e; });
  ok(err && err.timedOut === true && Date.now() - t0 < 500, "no answer: given up after its wait (e.timedOut)");
  ok(/did not answer in 0 seconds|did not answer/.test(err.message) && /timed out/.test(err.message) && /Check the internet/.test(err.message), "in words a person can read (" + err.message + ")");
  ok(sig && sig.aborted === true, "the request itself is stopped (its signal)");
  let s2 = null; const v = await Cloud.timed(200, async (s) => { s2 = s; await sleep(20); return 7; });
  await sleep(300);
  ok(v === 7 && s2.aborted === false, "an answer in time passes through; nothing is stopped afterwards");
  let e2 = null; await Cloud.timed(200, async () => { throw new Error("Cloud error 500"); }).catch((e) => { e2 = e; });
  ok(e2 && e2.message === "Cloud error 500" && !e2.timedOut, "a failure in time is the caller's own failure");
  let e3 = null; await Cloud.timed(200, () => { throw new Error("thrown at once"); }).catch((e) => { e3 = e; });
  ok(e3 && e3.message === "thrown at once", "a function that throws at once is a failure, not a crash");
  // a request that fails only after it was given up: no second, unhandled failure
  let un = 0; const h = () => { un++; }; process.on("unhandledRejection", h);
  await Cloud.timed(30, (s) => new Promise((_, no) => s.addEventListener("abort", () => no(new Error("aborted"))))).catch(() => {});
  await sleep(50); process.off("unhandledRejection", h);
  ok(un === 0, "the stopped request's own failure is not left unhandled");
}

console.log("== 1b. the review of 07041bcdd: a slow answer that keeps coming is never cut (idle, not total)");
{
  // an answer whose body comes in chunks: gaps in ms between them
  const slow = (gaps, size = 1000) => new Response(new ReadableStream({ async pull(c) { const g = gaps.shift(); if (g === undefined) { c.close(); return; } await sleep(g); c.enqueue(new TextEncoder().encode("x".repeat(size))); } }));
  const read = (ms, idle, mk) => Cloud.timed(ms, async (signal, alive) => { const r = await mk(); alive(); return Cloud.readText(r, alive); }, idle);
  let v = await read(100, 100, () => slow([60, 60, 60, 60, 60, 60, 60, 60]));
  ok(v.length === 8000, "a body that takes 480 ms in all, 60 ms between its parts, with a 100 ms limit: read whole (" + v.length + ")");
  let e1 = null; await read(100, 100, () => slow([30, 30, 250, 30])).catch((e) => { e1 = e; });
  ok(e1 && e1.timedOut && /stopped sending|did not answer/.test(e1.message), "a body that stops for longer than the limit: given up (" + (e1 && e1.message) + ")");
  let e2 = null; await Cloud.timed(80, () => new Promise(() => {}), 1000).catch((e) => { e2 = e; });
  ok(e2 && e2.timedOut, "no answer started in its first wait: given up (the idle wait is not the first one)");
  const u = new Response("é".repeat(3)); v = await Cloud.readText(u, () => {});
  ok(v === "ééé", "the text decoded as one (" + v + ")");
  ok(await Cloud.readText({ text: async () => "plain" }, () => {}) === "plain", "an answer without a stream: its text");
}

console.log("== 1c. the token's refresh (src/js/43, the only one): one at a time; a network or server error never ends the sign-in");
{
  // stay signed in (the owner, 13-Nov-2026): a refresh whose answer never came is tried again later with the same refresh
  // token (Supabase Auth gives back the session it made for it); only the firm account's own refusal ends the sign-in
  const LS = {}, now0 = Date.now(), s43 = src("43-two-step.js");
  const R = new Function("num", "lsGet", "lsSet", "lsDel", "switchedOff", "fetch",
    "return ({" + cut(src("27-firm-account.js"), "  WAIT: 20000,", "  // through the sign-in function") + "});");
  let answer = null, sent = [], ended = [];
  const fetchS = (url, o) => { sent.push(JSON.parse(o.body).refresh_token); return answer(); };
  const C = R((x) => Number(x) || 0, (k) => LS[k] || null, (k, v) => { LS[k] = v; }, (k) => { delete LS[k]; }, () => "", fetchS);
  new Function("Cloud", "lsGet", "lsSet", "lsDel", "num", "sessionEnded", "window", "const SESS_KEY = \"tdsdesk:cloudsess\";\n" + cut(s43, "const sessLock = {", "// a session that cannot continue"))(
    C, (k) => LS[k] || null, (k, v) => { LS[k] = v; }, (k) => { delete LS[k]; }, (x) => Number(x) || 0, (why) => { ended.push(why); sess = null; }, { addEventListener() {}, removeEventListener() {} });
  let sess = { access_token: "a1", refresh_token: "r1-aaaaaaaaaaaaaaaaaaaa", at: now0 };
  C.cfg = () => ({ url: "https://cloud.test", key: "k" }); C.sess = () => sess; C.setSess = (s) => { sess = s; };
  ok(/grant_type=refresh_token", \{refresh_token: s\.refresh_token\}, 6e4\)/.test(s43), "the refresh waits a minute (not the 20 s of a read)");
  answer = async () => { await sleep(30); return new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2-bbbbbbbbbbbbbbbbbbbbbb", expires_in: 3600 }), { status: 200 }); };
  await Promise.all([C.refreshToken(), C.refreshToken(), C.refreshToken("a1")]);
  ok(sent.length === 1 && sess.refresh_token.startsWith("r2"), "three asking together: one refresh sent, the new session kept (" + sent.length + ")");
  sent = []; answer = async () => { throw new TypeError("Failed to fetch"); };
  let e1 = null; await C.refreshToken().catch((e) => { e1 = e; }); await C.refreshToken().catch(() => {});
  ok(e1 && sent.length === 2 && sess && sess.refresh_token.startsWith("r2") && !ended.length, "no answer (no internet): the session stays and is tried again (" + sent.length + " sent, ended " + ended.length + ")");
  sent = []; answer = async () => new Response(JSON.stringify({ message: "upstream unavailable" }), { status: 503 });
  await C.refreshToken().catch(() => {});
  ok(sent.length === 1 && sess && !ended.length, "a server error (503): the session stays");
  answer = async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid Refresh Token: Refresh Token Not Found" }), { status: 400 });
  let e3 = null; await C.refreshToken().catch((e) => { e3 = e; });
  ok(e3 && ended.length === 1 && /Refresh Token Not Found/.test(ended[0]), "the firm account refused the refresh token: the sign-in ends, once (" + ended.length + ")");
}

console.log("== 2. TStale, tallyMark");
const { TStale, tallyMark } = new Function("tallyHm", cut(src("49-tally-cloud.js"), "const TStale = {", "function devState(") + "; return {TStale, tallyMark};")(
  (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(11, 16) + " IST");
const now = Date.now();
ok(TStale.now() === null && TStale.clock(now) === now, "nothing read yet, nothing failed: not marked, the clock is now");
TStale.ok("light"); const okAt = TStale.by.light.okAt;
ok(TStale.now() === null && TStale.clock(now + 5000) === now + 5000, "the read worked: not marked");
TStale.fail("light", new Error("Cloud error 520"));
const st = TStale.now();
ok(st && st.words === "Could not check just now, trying again" && st.at === okAt && /^as of \d\d:\d\d IST$/.test(st.as), "the read failed: the words, as of the last good read (" + JSON.stringify(st) + ")");
ok(TStale.clock(now + 10 * 60000) === okAt, "ten minutes of failures: the computers are judged at the last good read, their beats do not age");
const m = tallyMark({ state: "connected", level: "ok", word: "Connected", text: "Connected" });
ok(m.level === "warn" && m.state === "connected" && /could not check just now, trying again \(as of \d\d:\d\d IST\)/.test(m.text) && m.stale.at === okAt, "a connected status: no green tick, the words and the time (" + m.text + ")");
ok(tallyMark({ state: "offline", level: "bad", text: "Disconnected" }).level === "bad", "a bad one stays bad");
const u = { state: "unlinked", level: "warn", text: "Not linked" };
ok(tallyMark(u) === u && tallyMark(null) === null, "a client not linked (FinCom's own fact) is not marked");
TStale.fail("sum", new Error("x"));
ok(TStale.now().at === 0 && TStale.now().as === "nothing read yet", "another read that never worked: the oldest counts (nothing read yet)");
TStale.ok("sum"); TStale.ok("light");
const p = { state: "connected", level: "ok", text: "Connected" };
ok(TStale.now() === null && tallyMark(p) === p && TStale.clock(now + 99) === now + 99, "the reads work again: nothing marked");

console.log("== 2b. the review of 07041bcdd: a mark per read, its own row only, never for ever");
{
  TStale.reset();
  TStale.ok("light"); TStale.ok("prog:bk-1");
  TStale.fail("prog:bk-1", new Error("Cloud error 520"));
  ok(TStale.now(["light"]) === null && tallyMark({ state: "connected", level: "ok", text: "Connected" }).level === "ok", "one book's progress failed: the chips and the computers are not marked");
  ok(TStale.now(["prog:bk-1"]) && TStale.now(["prog:bk-2"]) === null, "that book's row is, another book's is not");
  ok(TStale.now() && TStale.now().words === "Could not check just now, trying again", "the page's one line says it");
  TStale.ok("prog:bk-1");
  ok(TStale.now() === null, "its next good read clears it");
  TStale.fail("prog:bk-1", new Error("x")); TStale.by["prog:bk-1"].errAt = Date.now() - 121000;
  ok(TStale.now() === null && TStale.now(["prog:bk-1"]) === null, "a mark not tried again for 2 minutes is gone (a company closed, a row no longer read)");
  TStale.fail("prog:bk-1", new Error("x")); TStale.forget("prog:bk-1");
  ok(TStale.now() === null, "a row no longer shown: forgotten");
  TStale.fail("light", new Error("x")); TStale.fail("prog:bk-3", new Error("x"));
  TStale.reset("prog:");
  ok(TStale.now(["prog:bk-3"]) === null && TStale.now(["light"]), "another client opened: the rows' marks go, the firm's computers' stays");
  TStale.reset();
  ok(TStale.now() === null && Object.keys(TStale.by).length === 0, "signed out: nothing kept");
  let n = 0; TStale.fail("prog:bk-9", new Error("x"), () => { n++; }); TStale.by["prog:bk-9"].errAt = Date.now() - 121000; TStale.retry();
  ok(n === 0, "an expired mark is not asked again for ever");
  TStale.reset();
}

console.log("== 3. Trash.put / list: a removal the server saved but whose answer was lost is not kept twice");
{
  const DB = new Map(); let server = [], answer = null;
  const IDBStore = { write: async (rows) => rows.forEach(([k, v]) => DB.set(k, JSON.parse(JSON.stringify(v)))), prefix: async (p) => [...DB.entries()].filter(([k]) => k.startsWith(p)) };
  const Cloud = { on: () => true, api: async (path, o) => { if (/^rpc\/trash_put/.test(path)) return answer(o); if (/^client_trash/.test(path)) return JSON.parse(JSON.stringify(server)); return null; } };
  const Trash = new Function("Cloud", "IDBStore", "toast", "whoAmI", "fmtDateTime", "return " + cut(src("23-column-filters.js"), "const Trash = {", "\nfunction askConfirm(").replace(/^const Trash = /, "").replace(/;\s*$/, ""))(Cloud, IDBStore, () => {}, () => "me@firm.test", (x) => x);
  answer = async () => { const e = new Error("FinCom’s cloud did not answer in 20 seconds (timed out)."); e.timedOut = true; server.push({ id: 41, kind: "party", label: "Party A", reason: "", deleted_at: new Date().toISOString(), deleted_by_email: "me@firm.test", restored_at: null }); throw e; };
  const r = await Trash.put("c1", "party", "Party A", { x: 1 }, "");
  ok(r.server === false, "the answer lost: kept here, said so");
  let l = await Trash.list("c1");
  ok(l.length === 1 && l[0].server && l[0].sid === 41, "the next list: one Party A, the server's (" + l.map((x) => x.id + "/" + x.server).join(", ") + ")");
  const mine = [...DB.values()][0];
  ok(mine.sid === 41, "this browser's copy now knows the server's id (" + mine.sid + ")");
  // a removal the server truly does not have stays listed from here
  answer = async () => { throw new Error("Cloud error 500"); };
  await Trash.put("c1", "party", "Party B", { x: 2 }, "");
  l = await Trash.list("c1");
  ok(l.length === 2 && l.some((x) => x.label === "Party B" && !x.server), "a removal the server refused: still listed, from this browser (" + l.map((x) => x.label).join(", ") + ")");
  // the same label removed again later: a lost answer matches only a server row of about its own time
  server.push({ id: 42, kind: "party", label: "Party C", reason: "", deleted_at: new Date(Date.now() - 3600e3).toISOString(), deleted_by_email: "", restored_at: null });
  answer = async () => { const e = new Error("timed out"); e.timedOut = true; throw e; };
  await Trash.put("c1", "party", "Party C", { x: 3 }, "");
  l = await Trash.list("c1");
  ok(l.filter((x) => x.label === "Party C").length === 2, "an hour-old server row of the same name is another removal: both listed");
}

console.log(fails ? "\n" + fails + " failed" : "\nall passed");
process.exit(fails ? 1 : 0);
