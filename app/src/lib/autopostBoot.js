// Post automatically (src/js/90-autopost.js, loaded only when needed): the small part that is always there, kept out of
// legacy.js (at its size budget) and loaded with the app.
//  1. Who decided, recorded on what the program already keeps (no change of its behaviour): every bank line remembered
//     (histEntry) carries h (hand / confirm / rule-written / guess-posted / auto), by and at; every bill approved carries
//     approvedBy and approvedHow (hand / bulk / auto). Before this build every posted line was simply "learned", guesses
//     included (learnRows(…, "sent")): the drift of the Cloud Wizard receipts.
//  2. A person who changes or undoes an automatic entry pauses that party's rule (co.autopostPause) until a later approval
//     by hand; a person who works on an entry before it goes keeps it (it waits for them).
//  3. The run: for the client open in this tab, when it is opened, after a statement or bill comes in, and every 15
//     minutes; only when the client's setting is on. The postings log says "auto (rule …)".
//  4. One notification a day in the bell: "Posted automatically today: N · M waiting for you".
// The program's functions are wrapped by name (each is a top-level function of legacy.js, called by name everywhere).
let mod = null;
export function loadAP() {
  return mod || (mod = import("./autopost.js").then((m) => m.AutoPost).catch((e) => { mod = null; throw e; }));
}
window.loadAutoPost = loadAP;
const W = window;
const who = () => (typeof W.whoAmI === "function" ? W.whoAmI() : "");
const on = (co) => !!(co && co.choices && co.choices.autopost && co.choices.autopost.value && co.choices.autopost.value.on);
const AP = () => W.AutoPost;
function wrap(name, make) {
  const f = W[name];
  if (typeof f !== "function" || f.__ap) return;
  const g = make(f); g.__ap = true;
  try { W[name] = g; } catch (e) { /* not writable: left as it is */ }
}
// the party of an automatic entry, paused (bank: key|dir; bill: the supplier's key)
function pause(x, why) {
  const a = x && (x.auto || x.autoHold);
  if (!a || !a.key) return;
  const co = W.CO && W.CO();
  if (!co) return;
  const k = x.state ? a.key + "|" + a.dir : a.key;
  co.autopostPause = Object.assign({}, co.autopostPause || {}, { [k]: { at: new Date().toISOString(), by: who(), why } });
  try { Store.saveCompany(co); } catch (e) { /* kept here; saved with the next change */ }
}
// a person acts on an entry still in the hold: it waits for them (taken out, the party paused)
function personTouch(x, why) {
  if (!x) return;
  if (x.autoHold && !x.auto) { pause(x, why); delete x.autoHold; delete x.autoPrev; }
  else if (x.auto) { pause(x, why); x.auto = Object.assign({}, x.auto, { changedBy: { by: who(), at: new Date().toISOString(), why } }); }
}
export function installAutopost() {
  if (W.__apInstalled || typeof W.histEntry !== "function") return;
  W.__apInstalled = true;
  // 1. who decided a bank line
  wrap("histEntry", (f) => function (r, ledger, src) {
    const h = f.apply(this, arguments);
    const how = r.auto || r.source === "auto" ? "auto" : r.userSet ? (r.source === "you" || !r.source ? "hand" : "confirm") : r.source === "rule" ? "rule-written"
      : src === "you" || src === "set" ? "hand" : src === "accepted" ? "confirm" : "guess-posted";
    const at = new Date().toISOString();
    // p: in Tally (a precedent must be); sh: what else must be the same (AutoPost.rowShape)
    Object.assign(h, { p: src === "sent" || r.state === "sent" || r.state === "intally", sh: [(r.splits || []).map((s) => s.ledger).sort().join("+"), Number(r.tdsAtPay) > 0 ? "tds" : ""].join("|"), h: how, by: how === "guess-posted" || how === "auto" ? "" : who(), at, a: Math.round((Number(r.debit) || Number(r.credit) || 0) * 100) / 100, vt: r.vtype || "" });
    if (src !== "sent" && how !== "auto") { r.decidedAt = at; r.decidedBy = who(); }
    return h;
  });
  // … and of a bill
  wrap("approve", (f) => function (e, o) {
    const was = e && e.status, out = f.apply(this, arguments);
    if (e && was !== "approved" && e.status === "approved") {
      const a = AP() && AP().approving;
      e.approvedBy = a ? "" : who(); e.approvedHow = a ? "auto" : o && o.bulk ? "bulk" : "hand";
      if (a && a.from) e.autoFrom = a.from;
      try { Store.saveEntry(S.coId, e); } catch (x) { /* saved with the bill's next change */ }
    }
    return out;
  });
  // 2. a person's change of an entry
  wrap("setLedgerFor", (f) => function (rows) { (rows || []).forEach((r) => personTouch(r, "ledger changed")); return f.apply(this, arguments); });
  wrap("bankRowAct", (f) => function (a, id) {
    if (["accept", "ignore", "restore", "unready", "unpost"].includes(a) && W.B && W.B()) personTouch(W.B().rows.find((r) => r.id === id), a);
    return f.apply(this, arguments);
  });
  wrap("bulkAction", (f) => function () { if (W.B && W.B()) W.bankSelected().forEach((r) => personTouch(r, "changed in bulk")); return f.apply(this, arguments); });
  ["billSetX", "billSetText", "billSetChoice", "billBookTds", "billGst", "billUseExpense"].forEach((n) => wrap(n, (f) => function (e) {
    if (e && e.status === "draft") { e.touchedBy = { by: who(), at: new Date().toISOString() }; personTouch(e, "bill changed"); }
    return f.apply(this, arguments);
  }));
  wrap("undoApproval", (f) => function (e) { personTouch(e, "approval undone"); return f.apply(this, arguments); });
  // 3. the postings log: an automatic run says so, and who set it on
  wrap("logPosting", (f) => function (rec) {
    const p = AP() && AP().posting;
    if (p && rec && rec.action !== "removed") rec = Object.assign({}, rec, { by: p.owner || p.by, auto: p.run });
    return f.call(this, rec);
  });
  // a statement read, a client opened: the run looks soon
  wrap("suggestAll", (f) => function () { const out = f.apply(this, arguments); kick(1500); return out; });
  // 4. one notification a day
  if (typeof AlertHub === "object" && AlertHub.all && !AlertHub.all.__ap) {
    const all = AlertHub.all;
    AlertHub.all = function () { const out = all.apply(this, arguments); try { const a = bellAlert(); if (a) out.push(a); } catch (e) { /* the bell without it */ } return out; };
    AlertHub.all.__ap = true;
  }
  setInterval(() => look(false), 30000);
  setTimeout(() => look(false), 4000);
}
// the bell's line of the day: "Posted automatically today: 44 · 7 waiting for you"
function bellAlert() {
  const ap = AP();
  if (!ap || typeof AlertClear !== "object") return null;
  const t = ap.today(), cos = S.companies || {};
  if (!t.n) return null;
  const parts = Object.entries(t.by).map(([cid, c]) => ((cos[cid] || {}).name || "a client") + ": " + [c.bank && c.bank + " bank line" + (c.bank === 1 ? "" : "s"), c.bills && c.bills + " bill" + (c.bills === 1 ? "" : "s")].filter(Boolean).join(", ") + (c.queued ? " (" + c.queued + " queued: Tally not open)" : ""));
  const waiting = Object.values(ap.st.last || {}).reduce((a, l) => a + (Number(l.waiting) || 0), 0);
  const full = Object.entries(ap.st.last || {}).filter(([, l]) => l.dayFull).map(([cid]) => (cos[cid] || {}).name).filter(Boolean);
  const first = Object.keys(t.by)[0];
  return { key: "autopost:" + t.day, fp: AlertClear.fp(["autopost:" + t.day + ":" + t.n]), sev: "info", cid: "", selfClear: false, at: new Date().toISOString(),
    text: "Posted automatically today: " + t.n + (waiting ? " · " + waiting + " waiting for you" : "") + (full.length ? " · daily limit reached for " + full.join(", ") : ""),
    fix: parts.join(" · "), act: { label: "See them", run: () => W.openCompany(first).then(() => { S.postTabs = Object.assign({}, S.postTabs, { [first]: "posted" }); W.goStep("post", "bills"); }) } };
}
let kicked = 0, lastSig = "", lastAt = 0, lastCid = "";
function kick(ms) { kicked = Date.now() + (ms || 0); setTimeout(() => look(true), ms || 0); }
// what a run would look at, in one line: a change means a new statement or bill came in
function sig(cid) {
  const b = S.bank && S.bank.cid === cid ? S.bank : null, d = S.data && S.data[cid];
  const open = b ? b.rows.filter((r) => ["attention", "suggested", "ready"].includes(r.state) && !r.auto && !r.autoHold && r.autoWhy === undefined).length : 0;
  const drafts = d && d.entries ? Object.values(d.entries).filter((e) => e.status === "draft" && !e.autoHold && e.autoWhy === undefined).length : 0;
  const due = (b ? b.rows.some((r) => r.autoHold && !r.auto && Date.parse(r.autoHold.until) <= Date.now()) : false) || (d && d.entries ? Object.values(d.entries).some((e) => e.autoHold && e.status === "draft" && Date.parse(e.autoHold.until) <= Date.now()) : false);
  return [cid, b ? b.cur : "", open, drafts, due ? Date.now() : 0].join("|");
}
function look(force) {
  if (!S || !S.companies) return;
  // Today and the bell need the figures when any client has it on
  if (!AP() && Object.values(S.companies).some(on)) loadAP().then((ap) => ap.loadCloudToday()).catch(() => {});
  else if (AP()) AP().loadCloudToday();
  const cid = S.coId, co = cid && S.companies[cid];
  if (!on(co) || document.hidden) return;
  const s = sig(cid), fifteen = Date.now() - lastAt > 15 * 60000;
  if (!(force || fifteen || s !== lastSig || cid !== lastCid)) return;
  lastSig = s; lastCid = cid; lastAt = Date.now();
  loadAP().then((ap) => ap.tick(cid, force ? "kick" : fifteen ? "every 15 minutes" : "new entries")).then(() => { lastSig = sig(cid); }).catch((e) => { try { console.error("FinCom: automatic posting", e); } catch (x) { /* */ } });
}
