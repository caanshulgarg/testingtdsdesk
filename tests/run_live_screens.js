// node tests/run_live_screens.js - next-db-load-2 (23-Nov-2026): the Realtime channels of one screen are joined only while
// it is drawn. Staging, 23-Nov-2026: tally_sync_cursor written 4,091 times in under 4 hours and tally_recorder_lines 1,114,
// each change sent to every open page of the firm (5 pages, 13 subscriptions each), nearly all passed over there.
//   1. a page opened: the firm's channel, jobs, books, postings, Tally, the copy (tally_book_changes and tally_alerts
//      only) - no recorder lines, no gap, no month locks or tie-outs
//   2. Sync activity drawn (Rec.actOf): the recorder's lines and the gap/locks/tie-outs joined, once however often it is
//      drawn; their changes reach Rec and CopyLive as before
//   3. the screen left: a minute later both are left (phx_leave); what still comes on them is passed over (their close
//      never closes the page's connection); drawn again: joined again
//   4. the tie-out drawn (Rec.tieOf): the gap/locks/tie-outs only
//   5. off Sync activity the gap is read each minute (not every 5), the held lines still every 5 minutes; the books
//      list the gap is shown with is kept between reads (review of 370f28773)
//   6. (review of 370f28773, the blocker) left Sync activity, then the line was applied: the bell's held lines, Look up's
//      "received, not yet entered" and the Tally page's "entries received today" never keep Sync activity's frozen lines
//      (Rec.act left with the channel); drawn again: read again
// The real Live of src/js/54 and Rec of src/js/61 and 99, a stand-in WebSocket. LIVE_SRC: another src/js folder.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const SRC = process.env.LIVE_SRC || path.join(__dirname, "..", "src", "js");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const live = fs.readFileSync(path.join(SRC, "54-live-sync.js"), "utf8"), la = live.indexOf("const Live = {"), lb = live.indexOf("/* ---------- next-realtime");
const rec = fs.readFileSync(path.join(SRC, "61-recorder.js"), "utf8"), ra = rec.indexOf("const Rec = {"), rb = rec.indexOf("\n};\n", ra) + 4;
const parts = fs.readFileSync(path.join(SRC, "99-screen-parts.js"), "utf8"), pa = parts.indexOf("Object.assign(Rec, {"), pb = parts.indexOf("\n});\n", pa) + 5;
const alerts = fs.readFileSync(path.join(SRC, "63-alerts.js"), "utf8"), aa = alerts.indexOf("const AlertHub = {"), ab = alerts.indexOf("\n};\n", aa) + 4;
let now = Date.parse("2026-11-23T10:00:00Z");
const RealDate = Date;
class FakeDate extends RealDate { constructor(...a){ super(...(a.length ? a : [now])); } static now(){ return now; } }
const sent = [];
let sock = null;
class WS { constructor(u){ this.url = u; this.readyState = 1; sock = this; setTimeout(() => this.onopen && this.onopen(), 0); } send(t){ sent.push(JSON.parse(t)); } close(){ this.readyState = 3; this.closed = true; if (this.onclose) this.onclose(); } }
const ctx = {console, JSON, Object, Array, Map, Set, String, Number, Math, Date: FakeDate, Error, RegExp, Promise, setTimeout, clearTimeout, setInterval: () => 0, clearInterval(){}, WebSocket: WS,
  render(){}, renderTop(){}, quietChanged(){}, pollOk: () => true, SLOW_MS: 300000, num: v => Number(v) || 0, istDay: () => "", fmtTime: () => ""};
vm.createContext(ctx);
const api = [];
ctx.Cloud = {on: () => true, st: {firm: "f1"}, cfg: () => ({url: "https://made-up.example", key: "k"}), sess: () => ({access_token: "t1", user_id: "u1"}), fresh: async () => {}, api: async (p) => { api.push(p); return []; }};
ctx.TCloud = {on: () => true, jobRow(){}, restAll: async () => [], st: {}};
ctx.S = {syncClient: ""};
vm.runInContext(live.slice(la, lb) + "\n" + rec.slice(ra, rb) + "\n" + parts.slice(pa, pb) + "\n" + alerts.slice(aa, ab) + "\nthis.Live = Live; this.Rec = Rec; this.AlertHub = AlertHub;", ctx);
const lines = [], copies = [];
ctx.Rec.lineIn = r => { lines.push(r); return true; };
ctx.CopyLive = {in: (t, r) => copies.push(t)};
const joins = () => sent.filter(m => m.event === "phx_join");
const joined = t => joins().filter(m => m.topic.indexOf(t) >= 0);
const tables = m => ((m.payload.config || {}).postgres_changes || []).map(x => x.table);
const reply = m => sock.onmessage({data: JSON.stringify({topic: m.topic, event: "phx_reply", ref: m.ref, payload: {status: "ok", response: {}}})});
const replyAll = () => joins().forEach(reply);
(async () => {
  const L = ctx.Live;
  L.start(); await sleep(5);
  reply(joins()[0]); await sleep(10); replyAll(); await sleep(5);
  console.log("== 1. a page opened");
  const all = joins().map(m => m.topic.replace(/-?f1$/, "") + ":" + tables(m).join(","));
  ok(L.st === "live", "the page's connection is live");
  ok(!joined("recorder").length, "no recorder channel (" + all.join(" | ") + ")");
  ok(!joins().some(m => tables(m).some(t => /tally_sync_cursor|tally_month_locks|tally_tieouts/.test(t))), "no channel with the gap, the month locks or the tie-outs");
  const copy = joined("fincom-copy-")[0];
  ok(copy && tables(copy).join(",") === "tally_book_changes,tally_alerts", "the copy's channel: the book changes and the alerts (" + (copy ? tables(copy).join(",") : "none") + ")");
  console.log("== 2. Sync activity drawn");
  for (let i = 0; i < 5; i++) ctx.Rec.actOf();
  await sleep(10);
  ok(joined("fincom-recorder-").length === 1, "the recorder's lines joined once (" + joined("fincom-recorder-").length + ")");
  const sync = joins().filter(m => tables(m).indexOf("tally_sync_cursor") >= 0);
  ok(sync.length === 1 && tables(sync[0]).join(",") === "tally_sync_cursor,tally_month_locks,tally_tieouts", "the gap, the month locks and the tie-outs joined once");
  replyAll(); await sleep(5);
  ok(L.recorderLive && L.syncLive, "both live");
  const rt = joined("fincom-recorder-")[0].topic, st = sync[0] && sync[0].topic;
  sock.onmessage({data: JSON.stringify({topic: rt, event: "postgres_changes", payload: {data: {table: "tally_recorder_lines", record: {id: 7}}}})});
  if (st) sock.onmessage({data: JSON.stringify({topic: st, event: "postgres_changes", payload: {data: {table: "tally_sync_cursor", record: {book_id: "b1", gap: null}}}})});
  ok(lines.length === 1 && copies.indexOf("tally_sync_cursor") >= 0, "a line reaches Sync activity, a gap's change the pages (CopyLive)");
  console.log("== 3. the screen left");
  now += 30000; L.unwant();
  ok(!sent.some(m => m.event === "phx_leave"), "30 s later: still joined");
  now += 40000; L.unwant();
  const left = sent.filter(m => m.event === "phx_leave").map(m => m.topic);
  ok(left.indexOf(rt) >= 0 && left.indexOf(st) >= 0, "a minute later both left (" + left.length + ")");
  ok(!L.recorderLive && !L.syncLive, "...and not live");
  sock.onmessage({data: JSON.stringify({topic: rt, event: "phx_close", payload: {}})});
  sock.onmessage({data: JSON.stringify({topic: rt, event: "postgres_changes", payload: {data: {table: "tally_recorder_lines", record: {id: 8}}}})});
  ok(!sock.closed && lines.length === 1, "what comes on a channel left is passed over; the page's connection stays open");
  const n0 = joined("fincom-recorder-").length;
  ctx.Rec.actOf(); await sleep(10);
  ok(joined("fincom-recorder-").length === n0 + 1, "drawn again: joined again");
  console.log("== 4. the tie-out drawn");
  now += 70000; L.unwant(); replyAll();
  const r0 = joined("fincom-recorder-").length, s0 = joins().filter(m => tables(m).indexOf("tally_sync_cursor") >= 0).length;
  ctx.Rec.tieOf("c1"); await sleep(10);
  ok(joined("fincom-recorder-").length === r0 && joins().filter(m => tables(m).indexOf("tally_sync_cursor") >= 0).length === s0 + 1, "the gap, locks and tie-outs joined; the recorder's lines not");
  console.log("== 5. read on their own timer");
  now += 70000; L.unwant(); api.length = 0;
  ctx.Rec.gaps = {at: now - 61000}; ctx.Rec.gapsOf(); await sleep(5);
  ok(api.some(p => /tally_sync_cursor/.test(p)), "off Sync activity: the gap read after a minute");
  // the books list kept between reads (a gap in the cursor: the books are read the first time only)
  const books = [{book_id: "b1", client_id: "c1", company: "ZZ MADE UP CO"}];
  ctx.Cloud.api = async (p) => { api.push(p); return /tally_sync_cursor/.test(p) ? [{book_id: "b1", gap: {missing: 2}}] : []; };
  let bookReads = 0; ctx.TCloud.restAll = async () => { bookReads++; return books; };
  await ctx.Rec.gapsLoad(); await ctx.Rec.gapsLoad(); await ctx.Rec.gapsLoad();
  ok(bookReads === 1 && (ctx.Rec.gaps.byClient.c1 || []).length === 1, "the gap read 3 times: the books list read once (" + bookReads + "), the gap on its client");
  ctx.Cloud.api = async (p) => { api.push(p); return /tally_sync_cursor/.test(p) ? [{book_id: "b2", gap: {missing: 1}}] : []; };
  books.push({book_id: "b2", client_id: "c2", company: "ZZ OTHER CO"});
  await ctx.Rec.gapsLoad();
  ok(bookReads === 2 && (ctx.Rec.gaps.byClient.c2 || []).length === 1, "a gap of a book not in the list: the list read again (" + bookReads + ")");
  ctx.Cloud.api = async (p) => { api.push(p); return []; };
  console.log("== 6. left Sync activity, then the line was applied");
  ctx.S.syncClient = "";
  ctx.Rec.act = {rows: [], at: now, busy: false, cid: ""};
  ctx.Rec.actOf(); await sleep(10); replyAll(); await sleep(5);
  const held = {id: 9, client_id: "c1", book_id: "b1", company: "ZZ MADE UP CO", event: "created", state: "held", held_why: "waiting: FinCom asks again at 10:42", received_at: new FakeDate(now).toISOString()};
  ctx.Rec.lineIn = undefined; delete ctx.Rec.lineIn;
  vm.runInContext("Rec.lineIn = " + rec.slice(rec.indexOf("lineIn(r){"), rec.indexOf("\n  },", rec.indexOf("lineIn(r){")) + 4).replace(/^lineIn/, "function"), ctx);
  const rt2 = joined("fincom-recorder-").pop().topic;
  sock.onmessage({data: JSON.stringify({topic: rt2, event: "postgres_changes", payload: {data: {table: "tally_recorder_lines", record: held}}})});
  ctx.AlertHub.held = {rows: [held], at: now, busy: false, none: false};
  ok(ctx.AlertHub.heldFor(["c1"]).length === 1, "on Sync activity: the held line is in the bell's list");
  now += 70000; L.unwant();                       // the person left Sync activity a minute ago
  ctx.AlertHub.held = {rows: [], at: now, busy: false, none: false};    // the bell's read: the line applied since
  ok(ctx.AlertHub.heldFor(["c1"]).length === 0 && ctx.AlertHub.booksHeld("c1") === null, "left Sync activity, then the line was applied: nothing held (Look up, trial balance, day book; Home in sync) (" + ctx.AlertHub.heldFor(["c1"]).length + ")");
  ok(!Array.isArray(ctx.Rec.act.rows), "Sync activity's lines are let go with its channel (the Tally page's 'entries received today' is not shown from them)");
  ctx.Rec.actOf(); await sleep(10);
  ok(api.some(p => /tally_recorder_lines\?select=id,client_id/.test(p)), "Sync activity drawn again: its lines read again");
  console.log(fails ? "FAILED: " + fails : "ALL OK");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("  FAIL " + (e && e.stack || e)); process.exit(1); });
