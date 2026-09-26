// node run_booksync.js - each client's TDS and GST work shared through the firm's database (build 156)
// Runs without any client's Tally files: two browsers talk to a stand-in database that behaves like save_client_books.
const {load, HTML} = require("./harness");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const J = v => JSON.parse(JSON.stringify(v));

// the stand-in database: one table client_books, the history, and the two functions, as in server/books-sync/migration.sql
function makeDb(){
  const db = {rows: {}, history: [], role: "staff", missing: false};
  db.call = (user, path, opts) => {
    if (db.missing) throw new Error("Could not find the function public.save_client_books (PGRST202)");
    if (path.startsWith("client_books?")){
      const cid = decodeURIComponent(/client_id=eq\.([^&]+)/.exec(path)[1]);
      const r = db.rows[cid]; return r ? [J(r)] : [];
    }
    const a = opts.body;
    if (path === "rpc/save_client_books"){
      if (db.role === "readonly") throw new Error("not allowed to save for this firm");
      const cur = db.rows[a.p_client];
      if (!cur){
        if (a.p_base !== 0) return {ok: false, rev: 0, data: {}};
        db.rows[a.p_client] = {rev: 1, data: J(a.p_data), updated_by: user}; return {ok: true, rev: 1};
      }
      if (cur.rev !== a.p_base) return {ok: false, rev: cur.rev, data: J(cur.data), updated_by: cur.updated_by};
      db.history.push({rev: cur.rev, data: J(cur.data), note: ""});
      db.rows[a.p_client] = {rev: cur.rev + 1, data: J(a.p_data), updated_by: user}; return {ok: true, rev: cur.rev + 1};
    }
    if (path === "rpc/keep_books_conflict"){ db.history.push({rev: a.p_rev, data: J(a.p_data), note: "conflict"}); return null; }
    throw new Error("unexpected " + path);
  };
  return db;
}
// one browser: the real BookSync with a stand-in Cloud, IndexedDB and books store
function browser(db, user){
  const {ctx, x} = load(HTML, ["BOOKS_KEYS", "stableStr", "clone", "BookSync"]);
  const idb = {}, saved = {};
  ctx.S = {books: null, companies: {c1: {name: "ZZ TEST"}}};
  ctx.Cloud = {on: () => true, st: {firm: "f1", members: [{user_id: "u1", name: "Anshul"}, {user_id: "u2", name: "Ruchi"}]}, api: async (p, o) => db.call(user, p, o || {})};
  ctx.IDBStore = {get: async k => J(idb[k] === undefined ? null : idb[k]), write: async pairs => { pairs.forEach(([k, v]) => { idb[k] = J(v); }); }};
  ctx.Books = {load: async cid => saved[cid] ? J(saved[cid]) : null, save: async (cid, d) => { saved[cid] = J(d); }};
  ctx.saveBooks = async () => { const b = ctx.S.books; const k = {cid: b.cid}; x.BOOKS_KEYS.forEach(n => { k[n] = b[n]; }); saved[b.cid] = J(k); };
  ctx.render = () => {}; ctx.esc = s => String(s); ctx.LedMaster = {refresh(){}};
  const toasts = []; ctx.toast = m => toasts.push(m);
  ctx.setTimeout = () => 0; ctx.clearTimeout = () => {};           // pushes are run by hand below
  x.BookSync.wait = 0;
  return {ctx, S: ctx.S, sync: x.BookSync, toasts, saved};
}

(async () => {
  const db = makeDb();
  const A = browser(db, "u1"), B = browser(db, "u2");
  const S0 = A.sync;

  // 1. the merge itself
  let clash = [];
  let m = S0.merge({challans: [{id: "a", tax: 1}]}, {challans: [{id: "a", tax: 1}, {id: "b", tax: 2}]}, {challans: [{id: "a", tax: 1}, {id: "c", tax: 3}]}, [], clash);
  ok(m.challans.map(c => c.id).join() === "a,c,b" && !clash.length, "two people each add a challan: both are kept");
  clash = [];
  m = S0.merge({challans: [{id: "a"}, {id: "b"}]}, {challans: [{id: "a"}]}, {challans: [{id: "a"}, {id: "b"}]}, [], clash);
  ok(m.challans.length === 1 && m.challans[0].id === "a", "a challan deleted here, untouched there: it stays deleted");
  clash = [];
  m = S0.merge({filed: {q1: {arn: "1"}}}, {filed: {q1: {arn: "2"}}, itcTrack: {x: 1}}, {filed: {q1: {arn: "3"}}}, [], clash);
  ok(m.filed.q1.arn === "3" && m.itcTrack.x === 1 && clash.length === 1 && clash[0] === "filed › q1 › arn", "both change the same ARN: the database's stays, the clash is named, other changes are kept");

  // 2. first browser saves; what is read from Tally is not sent
  A.S.books = {cid: "c1", vouchers: [{id: "v1"}], ledInfo: {x: 1}, challans: [{id: "ch1", tax: 1000}], alloc: {}};
  await A.sync.push("c1");
  ok(db.rows.c1 && db.rows.c1.rev === 1, "the work is saved to the database as revision 1");
  ok(!("vouchers" in db.rows.c1.data) && !("ledInfo" in db.rows.c1.data), "the day book and ledger balances read from Tally stay in the browser");

  // 3. second browser has its own work from before sharing: it is merged, not lost, and not over-written
  B.S.books = {cid: "c1", certs: [{id: "ct1", pan: "AAAPA1234A"}]};
  await B.sync.pull("c1");
  ok(db.rows.c1.rev === 2, "the second browser's work goes up on top of the first (revision 2)");
  ok(B.S.books.challans && B.S.books.challans[0].id === "ch1" && B.S.books.certs[0].id === "ct1", "the second browser now has the first one's challan and keeps its own certificate");
  ok(db.rows.c1.data.challans.length === 1 && db.rows.c1.data.certs.length === 1, "the database has both");

  // 4. the first browser picks up the change at the next sync
  await A.sync.pull("c1");
  ok(A.S.books.certs && A.S.books.certs[0].id === "ct1" && A.S.books.vouchers.length === 1, "the first browser receives the certificate and keeps its day book");

  // 5. both change the same thing at the same time: no silent over-write
  A.S.books.filed = {"26Q|Q2": {token: "111"}};
  B.S.books.filed = {"26Q|Q2": {token: "222"}};
  await A.sync.push("c1");
  const before = db.history.length;
  await B.sync.push("c1");
  ok(db.rows.c1.data.filed["26Q|Q2"].token === "111", "the first save stands");
  ok(db.history.slice(before).some(h => h.note === "conflict" && h.data.filed["26Q|Q2"].token === "222"), "the losing copy is kept in the history, marked conflict");
  ok(B.toasts.some(t => /Anshul/.test(t) && /filed/.test(t)), "the second person is told who changed what");
  ok(B.S.books.filed["26Q|Q2"].token === "111", "the second browser now shows what the database has");

  // 6. nothing to send, nothing sent
  const rev = db.rows.c1.rev; await A.sync.pull("c1"); await A.sync.push("c1");
  ok(db.rows.c1.rev === rev, "no change, no new revision");

  // 7. look-only staff, and a database without the new table
  const db2 = makeDb(); db2.role = "readonly";
  const C = browser(db2, "u3"); C.S.books = {cid: "c1", challans: [{id: "z"}]};
  await C.sync.push("c1");
  ok(C.sync.st.c1.readonly && !db2.rows.c1, "look-only access: nothing saved, no error loop");
  const db3 = makeDb(); db3.missing = true;
  const D = browser(db3, "u1"); D.S.books = {cid: "c1", challans: [{id: "z"}]};
  await D.sync.push("c1");
  ok(D.sync.off === true, "the database without client_books: sharing turns itself off, the books work as before");

  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
