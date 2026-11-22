// node tests/run_audit_sync_tally.js - the audit of 22-Nov-2026 (track sync-speed-tally): each confirmed finding of
// tally-sync.json, speed-db.json and the legacy half of tally-pages.json, run on the real code of src/js with made-up data
// (no client, GSTIN or PAN of anyone). AUDIT_SRC: another src/js folder (the code before the fixes: each part fails there).
//   1. bank_rows: a 300-line part merged line by line (27 bankRowsMerge through cloudApplyNow): a line posted on the
//      other computer keeps its posting and its Tally voucher; a ledger chosen here stays
//   2. AutoPost.through: CloudPost.uuid is never swapped; each run takes the posting of its own client and entries
//   3. the last-posting slot (tdsdesk:cloudpost) is cleared only by its own posting
//   4. CloudJobs.load: a forced read asked while one runs is read after it, never dropped
//   5. CloudJobs.changed: the live row put in its place, no read of the whole history; a posting read twice once
//   6. postReconcile: the lines by id, once (not a find over every line for each id posted)
//   7. BookItems.remote: a burst of live rows taken together; this computer's own rows coming back copy nothing
//   8. Rec.unkOf: the firm-wide unknown-ledger list read every 10 minutes, a client's every minute; an error keeps the list
//   9. TCloud.rpcAll: a row on two pages (the list moved between pages) read again, never counted twice
//  10. TCloud.noTargetWords: no computer name or Windows login
//  11. tallyHereNow: a key FinCom's cloud refuses is "Key not accepted" (bad), not "No internet"
//  12. (re-review) an automatic run whose every entry an earlier posting holds: the run's posting is its own (held), never
//      the earlier one, so Undo never cancels someone's posting by hand; also from the last-posting slot
//  (re-review, in 5 and 9: a live change without its unchanged large columns merged in place; a row removed between two
//   pages read again, never a list short of a row)
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), vm = require("vm");
process.env.TDSDESK_NO_FIXCACHE = process.env.TDSDESK_NO_FIXCACHE || "1";   // (no books read: no fixture cache)
const {load} = require("./harness");
const SRC = process.env.AUDIT_SRC || path.join(__dirname, "..", "src", "js");
const src = f => fs.readFileSync(path.join(SRC, f), "utf8");
const FILES = ["00-core.js", "01-documents-in-the-firm-account.js", "26-sales-from-a-marketplace.js", "27-firm-account.js", "49-tally-cloud.js", "51-tally-queue.js", "59-post-preview.js", "61-recorder.js", "90-autopost.js"];
const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "audit-st-")), "index.html");
const ALL = FILES.map(src).join("\n");
fs.writeFileSync(html, '<script id="app-main">\n' + ALL + "\n</script>");
const has = n => new RegExp("\\n(?:async function|function|const|let|var) " + n + "\\b").test("\n" + ALL);
const L = names => load(html, names.filter(has));
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const clone = o => JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = (c) => { Object.assign(c, {setTimeout, clearTimeout, Promise, crypto: require("crypto").webcrypto, Uint8Array, render(){}, soonRender(){}, toast(){}, console: {log(){}, warn(){}, error(){}}}); return c; };

(async () => {
  // ------------------------------------------------------------------ 1
  console.log("== 1. bank lines from another computer, merged line by line");
  {
    const {ctx, x} = L(["clone", "fpHash", "stableStr", "cloudKey", "NOBASE", "plainObj", "sameVal", "merge3", "BANK_POST_KEYS", "bankRowsMerge", "CloudBase", "CLOUD_BASE_SEED", "cloudBaseSet",
      "SAFE_ID", "ID_KEYS", "cleanIds", "cloudRowOk", "cloudApplyNow", "cloudApplyBankPart"]);
    base(ctx);
    const kv = {}, marks = {};
    ctx.BankDB = {get: async k => kv[k] === undefined ? undefined : clone(kv[k]), set: async (k, v) => { kv[k] = clone(v); }, del: async k => { delete kv[k]; }};
    ctx.Cloud = {marks: () => marks, setMarks(){}};
    ctx.S = {companies: {}, data: {}, inbox: {}, firm: {}, bank: null, sales: null, coId: "c1"};
    ctx.CLOUD_CHUNK = 300; ctx.refreshStats = () => {};
    const line = (i, o) => Object.assign({id: "r" + i, date: "2025-06-0" + i, narr: "MADE UP LINE " + i, debit: 1000 * i, credit: 0, state: "ready", ledger: ""}, o || {});
    const b0 = {rows: [1, 2, 3, 4].map(i => line(i))};
    // computer A posted line 1 (sent, Rent, its voucher); this computer (B) set Salary on line 3 and has not sent it
    const theirs = {rows: [line(1, {state: "sent", ledger: "Rent", sentAt: "2026-11-22T05:00:00Z", postedVia: "bridge", tally: {guid: "g-made-up-1", vchType: "Payment"}}), line(2), line(3), line(4)]};
    const mine = {rows: [line(1), line(2), line(3, {ledger: "Salary"}), line(4)]};
    const k = "bank_rows|c1|c1:s1:0";
    ctx.cloudSnapshot = () => [{kind: "bank_rows", id: "c1:s1:0", client_id: "c1", data: clone(mine)}];
    marks[k] = x.fpHash(JSON.stringify(b0));                     // the last copy both had: b0 (this copy changed since)
    if (x.CloudBase) x.CloudBase.set(k, JSON.stringify(b0));
    kv["stmt:c1:s1"] = clone(mine.rows);
    await x.cloudApplyNow([{kind: "bank_rows", id: "c1:s1:0", client_id: "c1", data: clone(theirs), deleted: false, updated_at: "2026-11-22T05:01:00Z"}]);
    const got = kv["stmt:c1:s1"] || [];
    const l1 = got.find(r => r.id === "r1") || {}, l3 = got.find(r => r.id === "r3") || {};
    ok(l1.state === "sent" && (l1.tally || {}).guid === "g-made-up-1" && l1.ledger === "Rent", "1. line 1 keeps the other computer's posting, its voucher and ledger (" + l1.state + ", " + ((l1.tally || {}).guid || "no voucher") + ", " + (l1.ledger || "no ledger") + ")");
    ok(l3.ledger === "Salary", "1. line 3 keeps this computer's ledger, not yet sent (" + l3.ledger + ")");
    // no copy both had (a reload): this computer's lines, but a line posted there is never ready here again
    if (x.CloudBase) x.CloudBase.delete(k);
    kv["stmt:c1:s1"] = clone(mine.rows);
    await x.cloudApplyNow([{kind: "bank_rows", id: "c1:s1:0", client_id: "c1", data: clone(theirs), deleted: false, updated_at: "2026-11-22T05:02:00Z"}]);
    const g2 = kv["stmt:c1:s1"] || [], m1 = g2.find(r => r.id === "r1") || {};
    ok(m1.state === "sent" && (m1.tally || {}).guid === "g-made-up-1" && (g2.find(r => r.id === "r3") || {}).ledger === "Salary", "1. no base kept: line 1 still posted (" + m1.state + "), line 3 still Salary");
    ok(!!(x.CLOUD_BASE_SEED && x.CLOUD_BASE_SEED.has("bank_rows")), "1. a statement part in step with the server is kept as the base to merge against");
  }

  // ------------------------------------------------------------------ 2, 3
  console.log("== 2-3. automatic posting runs and the last-posting slot");
  {
    const {ctx, x} = L(["CloudPost", "AutoPost"]);
    base(ctx);
    const ls = {};
    ctx.lsGet = k => (k in ls ? ls[k] : null); ctx.lsSet = (k, v) => { ls[k] = v; }; ctx.lsDel = k => { delete ls[k]; };
    const queued = [], done = {}; let allDone = false;
    ctx.postMarkNew = () => {};
    ctx.TCloud = {postTargetFor: () => "", bridgesHeard: () => [], rpc: async (fn, a) => { queued.push({id: a.p_id, cid: a.p_client, ids: [].concat(a.p_payload.vouchers || []).map(v => v.id)}); return {ok: true}; }};
    ctx.Cloud = {api: async p => { const id = (p.match(/id=eq\.([^&]+)/) || [])[1]; const d = done[id] || allDone; return [{id, status: d ? "done" : "waiting", n: 1, done: d ? 1 : 0, results: d ? [{id: "x", ok: true}] : [], company: "MADE UP CO"}]; }};
    const original = x.CloudPost.uuid;
    const post = (cid, id) => x.CloudPost.run(cid, {vouchers: [{id}], company: "MADE UP CO"});
    const jobFor = id => (queued.find(q => q.ids.includes(id)) || {}).id;
    // run A (client cA) waits in the cloud; run B (client cB) starts; a posting by hand of client cB goes meanwhile
    const pa = x.AutoPost.through("runA", () => post("cA", "a1"), () => false, "cA", () => ["a1"]);
    await sleep(50);
    const pb = x.AutoPost.through("runB", () => post("cB", "b1"), () => false, "cB", () => ["b1"]);
    await sleep(50);
    const pm = post("cB", "m1");
    await sleep(50);
    const slotB = JSON.parse(ls["tdsdesk:cloudpost"] || "{}").id;
    done[jobFor("a1")] = true;                       // A ends first, B later
    await pa;
    const slotAfterA = JSON.parse(ls["tdsdesk:cloudpost"] || "{}").id;
    done[jobFor("m1")] = true; await pm;
    done[jobFor("b1")] = true; await pb;
    const rj = x.AutoPost.runJob || {};
    ok(rj.runA === jobFor("a1"), "2. run A has its own posting (" + rj.runA + " / " + jobFor("a1") + ")");
    ok(rj.runB === jobFor("b1"), "2. run B has its own posting, not the posting by hand (" + rj.runB + " / " + jobFor("b1") + ", by hand " + jobFor("m1") + ")");
    ok(x.CloudPost.uuid === original, "2. CloudPost.uuid is the original after both runs");
    const before = Object.assign({}, rj);
    allDone = true; await post("cA", "a9").catch(() => {});
    ok(JSON.stringify(x.AutoPost.runJob || {}) === JSON.stringify(before), "2. a later posting is credited to no run");
    ok(slotB && slotAfterA === slotB, "3. the slot of the newer posting stays when an older one ends (" + slotAfterA + ")");
  }

  // ------------------------------------------------------------------ 12 (re-review: every entry held by an earlier posting)
  console.log("== 12. an automatic run whose every entry an earlier posting holds");
  {
    const {ctx, x} = L(["CloudPost", "AutoPost"]);
    base(ctx);
    const ls = {}; let wrote = null;
    ctx.lsGet = k => (k in ls ? ls[k] : null); ctx.lsSet = (k, v) => { ls[k] = v; if (k === "tdsdesk:cloudpost") wrote = v; }; ctx.lsDel = k => { delete ls[k]; };
    ctx.postMarkNew = () => {};
    // a posting by hand (J-HAND-1, made up) holds B1, B2 and B3; the run takes B1 only: the cloud queues nothing
    let answer = null; const made = [];
    ctx.TCloud = {postTargetFor: () => "", bridgesHeard: () => [], rpc: async (fn, a) => { made.push(a.p_id); return answer(a); }};
    ctx.Cloud = {api: async p => { const id = (p.match(/id=eq\.([^&]+)/) || [])[1]; return [{id, status: "done", n: 3, done: 3, results: [], company: "MADE UP CO"}]; }};
    const post = (cid, vs) => x.CloudPost.run(cid, {vouchers: vs.map(id => ({id})), company: "MADE UP CO"});
    answer = () => ({ok: true, none: true, dupes: [{id: "B1", job: "J-HAND-1", status: "waiting"}]});
    await x.AutoPost.through("runN", () => post("cH", ["B1"]), () => false, "cH", () => ["B1"]);
    const job = x.AutoPost.jobOf("cH", ["B1"], "runN");
    ok(job && job !== "J-HAND-1", "12. all held: the run's posting is its own, not the posting by hand (" + job + "); held = " + ("J-HAND-1" !== job));
    // the slot fallback (no run record, e.g. a run record lost) must not name the earlier posting as the run's own either
    delete x.AutoPost.runJob.runN; ls["tdsdesk:cloudpost"] = wrote;   // (the slot as the run wrote it, while it waits)
    const job2 = x.AutoPost.jobOf("cH", ["B1"], "runN");
    ok(job2 !== "J-HAND-1", "12. all held, from the last-posting slot: not the posting by hand (" + job2 + ")");
    ok(JSON.parse(wrote || "{}").id === "J-HAND-1", "12. the slot still follows the posting that holds the entries (for the reload message)");
    // some held, some new: the run's own posting
    answer = a => ({ok: true, dupes: [{id: "B1", job: "J-HAND-1", status: "waiting"}]});
    await x.AutoPost.through("runM", () => post("cH", ["B1", "B4"]), () => false, "cH", () => ["B1", "B4"]);
    const j3 = x.AutoPost.jobOf("cH", ["B1", "B4"], "runM");
    ok(j3 === made[made.length - 1], "12. some held: the run's posting is the one queued for it (" + j3 + ")");
  }

  // ------------------------------------------------------------------ 4, 5
  console.log("== 4-5. the list of postings");
  {
    const {ctx, x} = L(["CloudJobs"]);
    base(ctx);
    let reads = 0, gate = null;
    const COLS = {id: "", client_id: "c1", company: "MADE UP CO", status: "running", done: 0, n: 2, message: "", results: [], created_by: "", created_at: "", updated_at: "", attempts: 0, items: [], entry_ids: ["e1", "e2"], dismissed_at: null, dismissed_by: null, dismiss_note: null, dismiss_auto: false, timing: null};
    const job = (id, o) => Object.assign({}, COLS, {id, created_at: "2026-11-22T0" + id.slice(-1) + ":00:00Z"}, o || {});
    let server = [job("j1"), job("j2")];
    ctx.TCloud = {on: () => true, restAll: async () => { reads++; if (gate) await gate; return clone(server); }};
    ctx.S = {data: {}}; ctx.Live = {postsLive: true};
    let open; gate = new Promise(r => { open = r; });
    const p1 = x.CloudJobs.load(true);
    await sleep(10);
    server = [job("j1", {status: "done", done: 2}), job("j2")];
    x.CloudJobs.load(true);                    // the posting's last change, while the first read is still going
    gate = null; open();
    await p1; await sleep(20);
    const j1 = (x.CloudJobs.list || []).find(j => j.id === "j1") || {};
    ok(reads === 2 && j1.status === "done", "4. the change that came during a read is read after it (" + reads + " reads, j1 " + j1.status + ")");
    // 5. a live row: put in its place, nothing read
    const r0 = reads;
    x.CloudJobs.changed({type: "UPDATE", record: Object.assign(job("j2", {status: "done", done: 2}), {payload: {vouchers: ["big"]}}), errors: null});
    await sleep(900);
    const j2 = (x.CloudJobs.list || []).find(j => j.id === "j2") || {};
    ok(reads === r0 && j2.status === "done" && !("payload" in j2), "5. a live change: its row put in place, no read of every posting (" + (reads - r0) + " reads, j2 " + j2.status + ")");
    // (re-review) a status-only change of a big posting: Realtime leaves its unchanged large columns (results, items) out
    // of the record; the row here keeps them, the changed ones are taken, nothing is read
    const r1 = reads, big = [{id: "e1", ok: true, message: "MADE UP RESULT"}];
    x.CloudJobs.list = x.CloudJobs.list.map(j => j.id === "j1" ? Object.assign({}, j, {results: big}) : j);
    const part = Object.assign({}, job("j1", {status: "done", message: "Posted (made up)"})); delete part.results; delete part.items; delete part.timing;
    x.CloudJobs.changed({type: "UPDATE", record: part, errors: null});
    await sleep(900);
    const j1b = (x.CloudJobs.list || []).find(j => j.id === "j1") || {};
    ok(reads === r1 && j1b.message === "Posted (made up)" && JSON.stringify(j1b.results) === JSON.stringify(big) && Array.isArray(j1b.items), "5. a change without its unchanged large columns: merged into the row here, no read (" + (reads - r1) + " reads, " + j1b.message + ")");
    // a new posting that comes without all its columns: the list is read
    const r2 = reads, part2 = job("j7"); delete part2.results;
    x.CloudJobs.changed({type: "INSERT", record: part2, errors: null});
    await sleep(900);
    ok(reads === r2 + 1, "5. a posting not here yet, not whole: the list is read (" + (reads - r2) + ")");
    const r3 = reads;
    x.CloudJobs.changed({type: "UPDATE", record: {id: "j2"}, errors: ["Error 413: Payload Too Large"]});
    await sleep(900);
    ok(reads === r3 + 1, "5. a row too big to come live: the list is read (" + (reads - r3) + " read)");
    // a posting made between two pages shifts the next page: each posting once
    ctx.TCloud.restAll = async () => [job("j3"), job("j1"), job("j1"), job("j2")];
    await x.CloudJobs.load(true);
    ok((x.CloudJobs.list || []).length === 3, "5. a posting read twice across pages is listed once (" + (x.CloudJobs.list || []).length + ")");
  }

  // ------------------------------------------------------------------ 6
  console.log("== 6. postReconcile on a large statement");
  {
    const {ctx, x} = L(["postReconcile", "postMarkNew"]);
    base(ctx);
    const N = 8000, rows = [];
    for (let i = 0; i < N; i++) rows.push({id: "line-" + i, state: "sent", checking: false, postVerified: true});
    const states = new Map(), job = {id: "j", status: "done", company: "MADE UP CO", updated_at: "2026-11-22T00:00:00Z"};
    rows.forEach(r => states.set(r.id, {st: "posted", job}));
    ctx.S = {data: {c1: {loaded: true, entries: {}}}, bank: {cid: "c1", rows, loading: false}, billPost: null};
    const res = new Map(rows.map(r => [r.id, {id: r.id, ok: true}]));
    ctx.CloudJobs = {list: [job], idx: () => ({res})};
    ctx.postJobStates = () => states; ctx.postTaken = () => true; ctx.PostIds = {by: {}}; ctx.saveBank = () => {}; ctx.refreshStats = () => {};
    ctx.bankPosted = () => {}; ctx.postOld = () => false; ctx.memberName = () => "";
    const t0 = Date.now(); x.postReconcile("c1", true); const ms = Date.now() - t0;
    ok(ms < 250, "6. " + N + " posted lines with the statement open: " + ms + " ms (a find for each: about a second)");
    const t1 = Date.now(); x.postMarkNew("c1", rows.map(r => r.id), "j9"); const ms2 = Date.now() - t1;
    ok(ms2 < 250 && rows[N - 1].postJobNew === "j9", "6. postMarkNew for " + N + " lines: " + ms2 + " ms");
  }

  // ------------------------------------------------------------------ 7
  console.log("== 7. live rows of a client's books");
  {
    const t = src("54-live-sync.js"), a = t.indexOf("Object.assign(BookItems, {"), b = t.indexOf("/* ---------- Supabase Realtime");
    const ctx = base({console, JSON, Object, Array, Map, Set, String, Number, Math, Date, Error, RegExp});
    vm.createContext(ctx);
    let copies = [], keeps = 0, saves = 0;
    // (BookItems.join: server/_shared/gst3b.js, at the head of the app)
    const g = fs.readFileSync(path.join(__dirname, "..", "server", "_shared", "gst3b.js"), "utf8"), ga = g.indexOf("const BookItems = {"), gb = g.indexOf("\n};", ga);
    vm.runInContext("var BookItems = " + g.slice(ga + "const BookItems = ".length, gb + 3), ctx);
    ctx.num = v => Number(v) || 0; ctx.clone = o => JSON.parse(JSON.stringify(o));
    ctx.fpHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
    ctx.stableStr = v => JSON.stringify(v);
    const work = {map: {}, challans: []};
    for (let i = 0; i < 400; i++) work.map["LEDGER " + i] = {what: "sales", ok: true};
    ctx.S = {books: Object.assign({cid: "c1", loading: false}, clone(work))};
    ctx.BookSync = {localWork: async (cid, keys) => { copies.push(keys ? keys.join(",") : "ALL"); return clone(keys ? Object.fromEntries(keys.filter(k => k in work).map(k => [k, work[k]])) : work); }, keys: () => ["map", "challans"], MASTERS: []};
    ctx.IDBStore = {get: async () => null, write: async () => { keeps++; }};
    ctx.Live = {me: () => "u-here", noteItems(){}, ok(){}, saved(){}, saving(){}};
    ctx.saveBooks = async () => { saves++; }; ctx.LK = {}; ctx.LedMaster = {refresh(){}};
    vm.runInContext(t.slice(a, b), ctx);
    const BI = ctx.BookItems, s = await BI.state("c1");
    // this computer's own save of 400 items coming back, one live event each
    const echo = Object.keys(work.map).map((n, i) => ({client_id: "c1", key: "map", item: "." + n, ord: null, data: work.map[n], deleted: false, seq: 100 + i, updated_by: "u-here", updated_at: "2026-11-22T05:00:00Z"}));
    echo.forEach(r => { s.base[BI.ik(r.key, r.item)] = BI.h(r.data, r.ord); });
    copies = []; keeps = 0;
    echo.forEach(r => BI.remote(r));
    await sleep(400); await s.chain;
    ok(copies.length === 0 && keeps <= 1, "7. 400 rows of this computer's own save: the books copied " + copies.length + " times (was 400), kept " + keeps + " times");
    // a colleague's 50 changes: one copy, of the part they touch
    copies = [];
    for (let i = 0; i < 50; i++) BI.remote({client_id: "c1", key: "map", item: ".LEDGER " + i, ord: null, data: {what: "purchase", ok: true}, deleted: false, seq: 600 + i, updated_by: "u-other", updated_at: "2026-11-22T05:01:00Z"});
    // and the same item twice in the burst: its last row
    BI.remote({client_id: "c1", key: "map", item: ".LEDGER 0", ord: null, data: {what: "expense", ok: true}, deleted: false, seq: 700, updated_by: "u-other", updated_at: "2026-11-22T05:01:01Z"});
    await sleep(400); await s.chain;
    ok(copies.length === 1 && copies[0] === "map", "7. a colleague's 51 rows: the books copied once, the ledger map only (" + copies.join(" | ") + ")");
    ok(ctx.S.books.map["LEDGER 1"].what === "purchase" && ctx.S.books.map["LEDGER 0"].what === "expense", "7. their changes are in the books here, the later of an item twice");
  }

  // ------------------------------------------------------------------ 8
  console.log("== 8. the unknown ledgers (the Bell's firm-wide list)");
  {
    const {ctx, x} = L(["Rec"]);
    base(ctx);
    let loads = 0;
    ctx.TCloud = {on: () => true, rpc: async () => { loads++; throw new Error("canceling statement due to statement timeout"); }, restAll: async () => []};
    ctx.pollOk = () => true; ctx.ledNm = n => n;
    const R = x.Rec;
    R.unk = {firm: {rows: [{book_id: "b1", client_id: "c1", guid: "g1", ledgers: ["MADE UP LEDGER"]}], known: {}, at: Date.now() - 120000, busy: false, none: false, err: ""}};
    R.unkOf(null);
    await sleep(30);
    ok(loads === 0, "8. the firm-wide list read 2 minutes ago is not read again (" + loads + " reads)");
    R.unk.firm.at = Date.now() - 11 * 60000;
    R.unkOf(null); await sleep(30);
    ok(loads === 1, "8. after 10 minutes it is read again (" + loads + ")");
    ok((R.unk.firm.rows || []).length === 1 && !!R.unk.firm.err, "8. a time-out keeps the last list, with the error (" + (R.unk.firm.rows || []).length + " rows, err: " + R.unk.firm.err + ")");
    R.unk["b:bk1"] = {rows: [], known: {}, at: Date.now() - 70000, busy: false, none: false, err: ""};
    R.unkOf(["bk1"]); await sleep(30);
    ok(loads === 2, "8. a client's own list still every minute (" + loads + ")");
  }

  // ------------------------------------------------------------------ 9, 10, 11
  console.log("== 9-11. the Tally cloud's lists and words");
  {
    const {ctx, x} = L(["TCloud", "tallyNoNet", "beatEvery", "tallyWinUser", "tallyIst", "tallyHereNow"]);
    base(ctx);
    ctx.num = v => Number(v) || 0; ctx.fmtDateTime = v => String(v); ctx.fmtTime = v => String(v); ctx.istDay = v => new Date(v).toISOString().slice(0, 10);
    let calls = 0;
    const row = i => ({ledger: "LEDGER " + String(i).padStart(5, "0"), dr: i, cr: 0});
    ctx.Cloud = {api: async p => { calls++; const off = Number((p.match(/offset=(\d+)/) || [])[1] || 0);
      // the first read: a ledger written between page 1 and page 2 moves page 2 by one; read again: steady
      const all = []; for (let i = 0; i < 1500; i++) all.push(row(i));
      if (calls === 2) all.unshift(row(-1));
      return all.slice(off, off + 1000); }};
    let out = null, err = "";
    try { out = await x.TCloud.rpcAll("tally_tb", {p_book: "b1"}); } catch (e){ err = e.message; }
    const names = (out || []).map(r => r.ledger), dup = names.length - new Set(names).size;
    ok(out && dup === 0 && names.length === 1500, "9. a trial balance read while it moved: read again, " + names.length + " ledgers, " + dup + " twice" + (err ? " (" + err + ")" : ""));
    // (re-review) a ledger removed (merged) above the page boundary between two pages: the list moves up by one and
    // a row would be skipped without a word; read again, every ledger once
    calls = 0;
    ctx.Cloud = {api: async p => { calls++; const off = Number((p.match(/offset=(\d+)/) || [])[1] || 0);
      const all = []; for (let i = 0; i < 1500; i++) all.push(row(i));
      if (calls === 2) all.splice(10, 1);
      return all.slice(off, off + Number((p.match(/limit=(\d+)/) || [])[1] || 1000)); }};
    out = null; err = "";
    try { out = await x.TCloud.rpcAll("tally_tb", {p_book: "b1"}); } catch (e){ err = e.message; }
    const n2 = (out || []).map(r => r.ledger);
    ok(out && n2.length === 1500 && new Set(n2).size === 1500, "9. a ledger removed between two pages: read again, " + n2.length + " ledgers (1500)" + (err ? " (" + err + ")" : ""));
    // moving on every read: an error, never a list short of a ledger
    calls = 0;
    ctx.Cloud = {api: async p => { calls++; const off = Number((p.match(/offset=(\d+)/) || [])[1] || 0);
      const all = []; for (let i = 0; i < 1500; i++) all.push(row(i));
      if (off) all.splice(10, 1);
      return all.slice(off, off + Number((p.match(/limit=(\d+)/) || [])[1] || 1000)); }};
    out = null; err = "";
    try { out = await x.TCloud.rpcAll("tally_tb", {p_book: "b1"}); } catch (e){ err = e.message; }
    ok(!out && /changed while/.test(err), "9. still moving when read again: an error (" + (err || (out || []).length + " rows") + ")");
    // a list of exactly 1000 and a short one: as before
    calls = 0;
    ctx.Cloud = {api: async p => { calls++; const off = Number((p.match(/offset=(\d+)/) || [])[1] || 0);
      const all = []; for (let i = 0; i < 1000; i++) all.push(row(i));
      return all.slice(off, off + Number((p.match(/limit=(\d+)/) || [])[1] || 1000)); }};
    out = await x.TCloud.rpcAll("tally_tb", {p_book: "b1"});
    ok(out.length === 1000 && new Set(out.map(r => r.ledger)).size === 1000, "9. exactly 1000 ledgers: " + out.length);
    ctx.Cloud.api = async () => [row(1), row(2)];
    out = await x.TCloud.rpcAll("tally_tb", {p_book: "b1"});
    ok(out.length === 2, "9. a short list: " + out.length);
    // 10.
    ctx.TCloud = x.TCloud;
    x.TCloud.bridgesHeard = () => [{go: true, old: false, id: "go-abc123", computer: "MADEUP-PC7", user: "madeup.user", mayPost: true, device: {id: "d1"}}];
    x.TCloud.isOwn = () => true; x.TCloud.hasOpen = () => true;
    const w1 = x.TCloud.noTargetWords("MADE UP CO");
    x.TCloud.hasOpen = () => false;
    const w2 = x.TCloud.noTargetWords("MADE UP CO");
    ok(!/MADEUP-PC7|madeup\.user/.test(w1 + w2), "10. no computer name or Windows login in the words (" + w1.slice(60, 140) + "…)");
    // 11.
    const old = new Date(Date.now() - 10 * 60000).toISOString();
    ctx.Bridge = {on: () => true, blocked: () => false, okAt: 0, openFor: () => ({name: "MADE UP CO"}),
      st: {state: "ok", tallyState: "open", tallyUp: true, open: [{name: "MADE UP CO"}], computer: "MADEUP-PC7", user: "madeup.user", beat: {on: true, last: old, missedSince: old, every: 60}}};
    ctx.TLight = {st: {cos: []}}; ctx.tallyLinkOf = () => ({state: "linked"});
    ctx.FCOwn = {refused: () => true};
    const h = x.tallyHereNow({id: "c1", name: "MADE UP CO"});
    ok(h.code === "refused" && h.level === "bad", "11. a refused key: " + h.code + " / " + h.level + " (" + h.label + ")");
    ctx.FCOwn = {refused: () => false};
    const h2 = x.tallyHereNow({id: "c1", name: "MADE UP CO"});
    ok(h2.code === "nonet", "11. no word of a refused key: still No internet (" + h2.code + ")");
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
