/* ================================================================== */
/* Choices: confirm once, keep, show only when needed (review 18-21)  */
/* ================================================================== */
// Two shared pieces, used by every page (React: app/src/parts/Confirm.jsx):
//
// 1. The choice model. A choice a person confirms (which Tally ledger a bank account is, the Tally company a client posts
//    to, the GST / TDS / default expense ledgers of Client setup, the default sales ledgers) is kept inside the client
//    object, in co.choices["<key>"] = {value, state: "confirmed" | "guessed", by, at, why?, prev?}, so it rides the
//    client's merge to the cloud (cloudPushClient / merge3: each key on its own) to every user and computer. Keys:
//      "postTo", "gst:cgst" (sgst, igst, rcmCgstIn, …), "tds:<payment type>", "exp:<payment type>" (default purchase /
//      expense ledger), "bank:<bank account id>", "sales:<cfg key>" (default sales ledgers: sales, sales_18_l, …)
//    A supplier's matched ledger is kept on the party record: party.ledgerChoice, same shape.
//    The old fields (co.postTo, co.gst, co.tdsLedgers, co.expenseLedgers, bankAccounts[].ledger) are kept in step for
//    the code that reads them. Auto-matching only fills an empty or guessed slot (choiceGuess), never a confirmed one;
//    a sync never puts back an older or guessed value over a confirmed one (choiceMigrate, from fixCompany). Posting
//    uses confirmed choices only (choiceUsable): postToProblem, bankLedgerReady, billGuessedWhy.
//    Old values without a record (the Tally company, GST, TDS and default ledgers, a bank account's ledger) are
//    suggestions: shown pre-selected and confirmed by one press of Confirm. Sales settings count as confirmed.
//
// 2. The drafts of the settings pages (Drafts). A section's edits are made where they always were (so every check on
//    leaving a box still runs), but they are not saved, nor sent to the cloud, until Save: the section notes which
//    settings each of the person's actions in it changed (and their value before); while any is unsaved, the saving of
//    that store waits (Store.saveCompany / saveFirm / saveParty, saveBooks, saveSales' settings), and the cloud is
//    sent the saved values (cloudSnapshot → Drafts.view). Save confirms what was chosen and saves; Don't save puts the
//    values back. Leaving a page with unsaved changes asks "Save your changes?" (Save / Don't save / Stay): the
//    page change (Route.sync → Drafts.onPage), a panel closed (Drafts.guard), and closing the tab (beforeunload).

/* ---------- the choice model ---------- */
// "flow:<ledger name>" (round 4, 03-Oct-2026): the owner's mark on a ledger for the cash flow ("loan_given": a Loans &
// Advances (Asset) ledger shown under investing, MIS.flowHead). Set only by a person on the Mapping tab (choiceConfirm),
// never guessed; it has no old field to keep in step
const CHOICE_LABEL = {postTo: "Tally company to post to", gst: "GST ledger", tds: "TDS ledger", exp: "default expense ledger", bank: "bank account's Tally ledger", sales: "default sales ledger", flow: "cash-flow line of a ledger"};
function choiceSplit(key){ const i = String(key).indexOf(":"); return i < 0 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)]; }
function choiceAcc(co, id){ return ((co && co.bankAccounts) || []).find(a => a.id === id) || null; }
// the old field a choice is kept in step with (undefined: none)
function choiceLegacy(co, key){
  const [k, sub] = choiceSplit(key);
  if (!co) return undefined;
  if (k === "postTo") return co.postTo || "";
  if (k === "gst") return (co.gst || {})[sub] || "";
  if (k === "tds") return (co.tdsLedgers || {})[sub] || "";
  if (k === "exp") return (co.expenseLedgers || {})[sub] || "";
  if (k === "bank"){ const a = choiceAcc(co, sub); return a ? a.ledger || "" : undefined; }
  return undefined;
}
function choiceLegacySet(co, key, rec){
  const [k, sub] = choiceSplit(key), v = rec ? rec.value || "" : "";
  if (k === "postTo"){ co.postTo = v; if (rec){ co.postToAt = rec.at; co.postToBy = rec.state === "guessed" ? "auto" : rec.by || ""; } }
  else if (k === "gst"){ co.gst = co.gst || {}; co.gst[sub] = v; co.gstPin = co.gstPin || {}; if (rec && rec.state === "confirmed" && v) co.gstPin[sub] = true; else delete co.gstPin[sub]; }
  else if (k === "tds"){ co.tdsLedgers = co.tdsLedgers || {}; co.tdsLedgers[sub] = v; }
  else if (k === "exp"){ co.expenseLedgers = co.expenseLedgers || {}; co.expenseLedgers[sub] = v; }
  else if (k === "bank"){ const a = choiceAcc(co, sub); if (a) a.ledger = v; }
}
// a choice from the old fields alone (no record yet)
function choiceDerive(co, key){
  const [k, sub] = choiceSplit(key), v = choiceLegacy(co, key);
  if (!v) return null;
  // An old saved value is a suggestion until a person confirms it (decision of 02-Oct-2026): it shows pre-selected,
  // marked "saved before, confirm", and posting waits for one Confirm. Only a Confirm press makes a choice confirmed.
  if (k === "postTo" || k === "gst" || k === "tds" || k === "exp" || k === "bank") return {value: v, state: "guessed", by: "", at: co.postToAt && k === "postTo" ? co.postToAt : "", old: true};
  return null;
}
function choiceRec(co, key){ return co && co.choices && co.choices[key] || null; }
// the choice now: {value, state, by, at, …} or null
function choiceGet(co, key){
  if (!co) return null;
  const rec = choiceRec(co, key), legacy = choiceLegacy(co, key);
  if (!rec) return choiceDerive(co, key);
  // the old field changed by code that does not know the choice: a confirmed choice holds; a guessed one follows it
  if (legacy !== undefined && (legacy || "") !== (rec.value || "")) return rec.state === "confirmed" ? rec : choiceDerive(co, key);
  return rec;
}
function choiceState(co, key){ const c = choiceGet(co, key); return c && (c.value || c.state === "confirmed") ? c.state : ""; }
function choiceValue(co, key){ const c = choiceGet(co, key); return c ? c.value || "" : ""; }
// what posting may use: the confirmed value only
function choiceUsable(co, key){ const c = choiceGet(co, key); return c && c.state === "confirmed" && c.value ? c.value : ""; }
function choiceWho(){ return typeof whoAmI === "function" ? whoAmI() : "this computer"; }
function choiceWrite(co, key, rec){
  if (rec){ co.choices = co.choices || {}; co.choices[key] = rec; }
  else if (co.choices){ delete co.choices[key]; }
  choiceLegacySet(co, key, rec);
}
// auto-matching: fills an empty or guessed slot only, never a confirmed one; true when something changed (not saved)
function choiceGuess(co, key, value, why){
  if (!co) return false;
  value = String(value || "").trim();
  const c = choiceGet(co, key);
  if (c && c.state === "confirmed") return false;
  if (c && c.value === value && !c.old) return false;
  return Drafts.direct(() => {
    if (!value){ choiceWrite(co, key, null); return true; }
    choiceWrite(co, key, {value, state: "guessed", by: "FinCom", at: new Date().toISOString(), why: why || ""});
    return true;
  });
}
// a person's choice: confirmed, with who and when, and what it was before; saved at once (it is its own confirm step)
function choiceConfirm(co, key, value, opts){
  if (!co) return null;
  opts = opts || {};
  value = String(value == null ? "" : value).trim();
  const was = opts.was || choiceGet(co, key), now = new Date().toISOString();
  const rec = {value, state: "confirmed", by: opts.by || choiceWho(), at: now};
  if (was && (was.value !== value || was.state !== "confirmed")) rec.prev = {value: was.value || "", state: was.state, by: was.by || "", at: was.at || ""};
  Drafts.direct(() => { choiceWrite(co, key, rec); if (!opts.nosave) Store.saveCompany(co); }, {bypass: true});
  return rec;
}
// forget a choice (a GST override emptied in Client setup: each bill picks its own again)
function choiceForget(co, key, opts){ if (!co) return; Drafts.direct(() => { choiceWrite(co, key, null); if (!(opts && opts.nosave)) Store.saveCompany(co); }, {bypass: true}); }
// one of two records of the same choice: a confirmed one is never replaced by a guess; else the later one
function choicePick(a, b){
  if (!a) return b; if (!b) return a;
  if (a.state !== b.state) return a.state === "confirmed" ? a : b;
  return String(a.at || "") >= String(b.at || "") ? a : b;
}
// From fixCompany: a client's copy coming in (the cloud, a merge) keeps any choice the copy here holds that is newer,
// or confirmed where the incoming one is only guessed or missing; and a confirmed choice puts its old field back.
function choiceMigrate(co, prior){
  if (!co || typeof co !== "object") return co;
  if (prior && prior !== co && prior.id === co.id && prior.choices){
    Object.keys(prior.choices).forEach(k => {
      const mine = prior.choices[k], theirs = co.choices && co.choices[k], keep = choicePick(mine, theirs);
      if (keep !== theirs){ co.choices = co.choices || {}; co.choices[k] = clone(keep); }
    });
    // a bank account known here and missing from the incoming copy is kept (its ledger choice is keyed by its id)
    (prior.bankAccounts || []).forEach(a => {
      if (!a || !a.id || (co.bankAccounts || []).some(x => x.id === a.id)) return;
      if (co.choices && co.choices["bank:" + a.id]){ co.bankAccounts = (co.bankAccounts || []).concat([clone(a)]); }
    });
  }
  Object.keys(co.choices || {}).forEach(k => {
    const rec = co.choices[k];
    if (!rec || rec.state !== "confirmed") return;
    const legacy = choiceLegacy(co, k);
    if (legacy !== undefined && (legacy || "") !== (rec.value || "")) choiceLegacySet(co, k, rec);
  });
  return co;
}
// A supplier's matched ledger, on the party record
function partyChoice(p){
  if (!p) return null;
  const rec = p.ledgerChoice;
  if (rec && (rec.value || "") === (p.ledgerName || "")) return rec;
  if (rec && rec.state === "confirmed") return rec;
  return p.ledgerName ? {value: p.ledgerName, state: p.ledgerAuto ? "guessed" : "confirmed", by: "", at: "", old: true} : null;
}
function partyChoiceSet(p, value, state){
  value = String(value || "").trim();
  const was = partyChoice(p);
  if (state === "guessed" && was && was.state === "confirmed") return false;
  const rec = {value, state, by: state === "guessed" ? "FinCom" : choiceWho(), at: new Date().toISOString()};
  if (was && was.value !== value && state === "confirmed") rec.prev = {value: was.value, state: was.state, by: was.by || "", at: was.at || ""};
  p.ledgerName = value; p.ledgerChoice = rec;
  if (state === "guessed") p.ledgerAuto = true; else delete p.ledgerAuto;
  return true;
}
// a party record coming from the cloud keeps the confirmed ledger held here when it is newer (or the incoming is a guess)
function partyKeepChoice(here, incoming){
  if (!here || !incoming || !here.ledgerChoice) return incoming;
  const keep = choicePick(here.ledgerChoice, incoming.ledgerChoice);
  if (keep !== incoming.ledgerChoice && keep.state === "confirmed"){ incoming.ledgerChoice = clone(keep); incoming.ledgerName = keep.value; delete incoming.ledgerAuto; }
  return incoming;
}

/* ---------- the bank account's Tally ledger ---------- */
// is the ledger list of this client loaded, complete and not loading (only then can a ledger be said to be gone)
function ledgerListComplete(cid){
  cid = cid || S.coId;
  if (typeof Ledgers !== "object" || Ledgers.busy[cid]) return false;
  const b = typeof B === "function" ? B() : null;
  if (b && b.cid === cid && (b.ledgersLoading || b.loading)) return false;
  const cur = Ledgers.cur(cid);
  return !!(cur && (cur.list || []).length && cur.src !== "browser" && Ledgers.cid() === cid);
}
// {value, state, gone}: the account's ledger as chosen (it does not wait for the ledger list)
function bankLedgerChoice(co, acc){
  if (!co || !acc || !acc.id) return {value: "", state: "", gone: false};
  const c = choiceGet(co, "bank:" + acc.id), v = c ? c.value || "" : "";
  const gone = !!(v && ledgerListComplete(co.id) && !exactLedger(v));
  return {value: v, state: c && v ? c.state : "", gone, by: c ? c.by : "", at: c ? c.at : "", why: c ? c.why || "" : ""};
}
// the ledger posting may use: confirmed, and in Tally once the list is there; else ""
function bankLedgerReady(co, acc){
  const c = bankLedgerChoice(co, acc);
  if (c.state !== "confirmed" || !c.value || c.gone) return "";
  return exactLedger(c.value) || (hasLedgerList() ? "" : c.value);
}
// why bank lines cannot be posted yet, in one line ("" when they can)
function bankLedgerWhy(co, acc){
  const c = bankLedgerChoice(co, acc);
  if (!c.value) return "Posting waits: this bank account’s Tally ledger is not chosen.";
  if (c.gone) return "Posting waits: " + c.value + " is no longer in Tally. Choose again.";
  if (c.state !== "confirmed") return "Posting waits: this bank account’s Tally ledger (" + c.value + ") is guessed, not confirmed.";
  if (!bankLedgerReady(co, acc)) return "Posting waits: " + c.value + " is not in the ledger list from Tally.";
  return "";
}
// the bank account of a statement: a statement whose account is missing from the client (lost in a sync before the merge
// of 02-Oct-2026) gets it back from the statement itself, with the ledger choice kept under its id
function bankAccountOf(co, st){
  if (!co || !st || !st.acctId) return null;
  let a = choiceAcc(co, st.acctId);
  if (a) return a;
  const last4 = String(st.acct || "").replace(/\D/g, "").slice(-4);
  a = {id: st.acctId, bank: st.bank || "Bank", last4, acct: st.acct || "", ifsc: st.ifsc || "", ledger: choiceValue(co, "bank:" + st.acctId) || ""};
  const rec = choiceRec(co, "bank:" + st.acctId); if (rec) a.ledger = rec.value || "";
  co.bankAccounts = (co.bankAccounts || []).concat([a]);
  Drafts.direct(() => Store.saveCompany(co), {bypass: true});
  return a;
}
function bankHealAccounts(co, stmts){ (stmts || []).forEach(st => bankAccountOf(co, st)); }
// a person picked and confirmed the ledger of a bank account (the bank page, Bank accounts in Client setup)
function bankConfirmAccLedger(accId, v){
  const b = B(), co = CO(b ? b.cid : S.coId), a = choiceAcc(co, accId);
  if (!a) return false;
  const ex = exactLedger(v) || (hasLedgerList() ? "" : String(v || "").trim());
  if (!ex){ toast("“" + v + "” is not a Tally ledger. Choose one from the list."); return false; }
  choiceConfirm(co, "bank:" + accId, ex);
  if (b && b.cid === co.id){ suggestAll(b.rows, true); saveBank({rows: true}); }
  toast("Tally ledger confirmed: " + ex + ".");
  render();
  return true;
}

/* ---------- posting uses confirmed choices only ---------- */
// a bill's lines taken from Client setup whose choice is not confirmed: the one-line reason, or ""
function billGuessedWhy(e, co){
  if (!e || !co) return "";
  const lines = (e.snapshot && e.snapshot.lines) || [];
  for (const l of lines){
    const ck = l.ck || (/^Client setup/.test(l.why || "") ? (l.role === "tds" ? "tds:" + e.natureId : l.role === "gst" && l.head ? "gst:" + l.head.toLowerCase() : "") : "");
    if (!ck || !l.ledger) continue;
    const c = choiceGet(co, ck);
    if (!c || c.state !== "confirmed" || (exactLedger(c.value) || c.value) !== (exactLedger(l.ledger) || l.ledger))
      return "Posting waits: the " + (CHOICE_LABEL[choiceSplit(ck)[0]] || "ledger") + " “" + l.ledger + "” comes from Client setup, where it is guessed, not confirmed.";
  }
  if (/^Client setup/.test(e.expenseFrom || "") && e.natureId && !e.expenseUserSet){
    const c = choiceGet(co, "exp:" + e.natureId);
    if (!c || c.state !== "confirmed") return "Posting waits: the default expense ledger “" + e.expenseLedger + "” comes from Client setup, where it is guessed, not confirmed.";
  }
  return "";
}

/* ---------- the drafts of the settings pages ---------- */
// a value of a nested object by its path (an array of keys)
function choicePathGet(o, path){ let x = o; for (const k of path){ if (x == null || typeof x !== "object") return undefined; x = x[k]; } return x; }
function choicePathSet(o, path, v){
  let x = o;
  for (let i = 0; i < path.length - 1; i++){ if (x[path[i]] == null || typeof x[path[i]] !== "object") x[path[i]] = {}; x = x[path[i]]; }
  const k = path[path.length - 1];
  if (v === undefined) delete x[k]; else x[k] = clone(v);
}
// (an empty value and a missing one are the same: a box emptied, a choice put back to "none")
function choiceSame(a, b){ const e = v => v === undefined || v === null || (typeof v === "object" && !Object.keys(v).length); if (e(a)) a = ""; if (e(b)) b = ""; return a === b || stableStr(a) === stableStr(b); }
// the paths where two copies differ (objects compared key by key, to a depth of 6; arrays and values whole)
function choicePathDiff(a, b, pre, out, depth){
  const isO = v => !!v && typeof v === "object" && !Array.isArray(v);
  if (isO(a) && isO(b) && depth < 6){ new Set(Object.keys(a).concat(Object.keys(b))).forEach(k => choicePathDiff(a[k], b[k], pre.concat([k]), out, depth + 1)); return out; }
  if (!choiceSame(a, b)) out.push(pre);
  return out;
}
// what a section keeps a draft of: "client", "parties", "firm", "books:<key,key>", "salescfg", "reading"
const DRAFT_SKIP = {client: new Set(["stats", "hashes", "keys", "readCounts", "saved", "choices", "postTo", "postToAt", "postToBy", "deleted"]), firm: new Set(["postLog", "saved"])};
function choiceStore(spec, cid){
  const [kind, arg] = choiceSplit(spec);
  const pickKeys = (o, skip) => { const out = {}; Object.keys(o || {}).forEach(k => { if (!skip.has(k)) out[k] = o[k]; }); return out; };
  if (kind === "client") return {kind, hold: "client:" + cid, root: () => S.companies[cid], snap(){ const c = this.root(); return c ? clone(pickKeys(c, DRAFT_SKIP.client)) : null; },
    persist(){ const c = this.root(); if (c){ Store.saveCompany(c); try { refreshStats(cid); } catch (e){} } },
    after(){ const b = S.bank; if (b && b.cid === cid && !b.loading && b.rows && typeof suggestAll === "function"){ suggestAll(b.rows, true); saveBank({rows: true}); } }};
  if (kind === "parties") return {kind, hold: "parties:" + cid, root: () => (S.data[cid] || {}).parties, snap(){ const p = this.root(); return p ? clone(p) : null; },
    persist(paths){ const ps = this.root() || {}; new Set((paths || []).map(p => p[0])).forEach(id => { if (ps[id]) Store.saveParty(cid, ps[id]); }); }};
  if (kind === "firm") return {kind, hold: "firm", root: () => S.firm, snap(){ return S.firm ? clone(pickKeys(S.firm, DRAFT_SKIP.firm)) : null; },
    persist(paths){ Store.saveFirm(); if ((paths || []).some(p => p[0] === "firmName") && typeof firmNameToAccount === "function") firmNameToAccount(S.firm.firmName); }};
  if (kind === "books"){
    const keys = String(arg || "").split(",").filter(Boolean);
    return {kind, hold: "books:" + cid, root: () => S.books && S.books.cid === cid ? S.books : null,
      snap(){ const b = this.root(); if (!b) return null; const o = {}; keys.forEach(k => { o[k] = b[k] === undefined ? null : b[k]; }); return clone(o); },
      persist(){ if (this.root()) saveBooks(); }};
  }
  if (kind === "salescfg") return {kind, hold: "salescfg:" + cid, root: () => S.sales && S.sales.cid === cid ? S.sales : null,
    snap(){ const s = this.root(); return s ? clone({cfg: s.cfg || {}}) : null; }, persist(){ if (this.root()) saveSales({cfg: true}); },
    after(){ const s = this.root(); if (s && typeof mapInvoice === "function"){ s.list.forEach(v => mapInvoice(v)); saveSales(); } }};
  if (kind === "reading") return {kind, hold: "", root: () => S, snap(){ return {askClaudeNewSupplier: !!S.askClaudeNewSupplier, freeFirst: !!S.freeFirst}; },
    persist(){ lsSet("tdsdesk:askClaudeNew", S.askClaudeNewSupplier ? "1" : ""); lsSet("tdsdesk:freeFirst", S.freeFirst ? "1" : "0"); }};
  return null;
}
const Drafts = {
  secs: {},             // section id -> {id, page, label, cid, stores, pre, paths, armed, custom}
  picks: {},            // a choice picked and not yet confirmed (the bank account's ledger): id -> value
  page: "",             // the page shown at the last drawing
  asking: false,
  bypassN: 0,
  // a section on the page: registered as it is drawn (React: <Confirm>); its draft outlives it until saved or not
  reg(id, o){
    const cid = o.cid === undefined ? S.coId : o.cid;
    let s = this.secs[id];
    const want = (o.stores || []).join("|") + "#" + cid;
    if (s && s.want !== want && !this.dirty(id)){ delete this.secs[id]; s = null; }
    if (!s){ s = this.secs[id] = {id, want, cid, stores: (o.stores || []).map(x => choiceStore(x, cid)).filter(Boolean), pre: null, paths: new Map(), armed: 0, custom: null, page: ""}; }
    s.label = o.label || s.label || "Settings";
    s.page = o.page || s.page || this.pageNow();
    if (o.custom) s.custom = o.custom;
    if (o.onSave) s.onSave = o.onSave;
    return s;
  },
  pageNow(){ try { return typeof Route === "object" ? Route.of() : ""; } catch (e){ return ""; } },
  // before an action of the person inside the section: a copy of what it may change
  touch(id){
    const s = this.secs[id]; if (!s || s.custom) return;
    if (!s.armed){ s.pre = s.stores.map(st => st.snap()); s.armed = Date.now(); }
    clearTimeout(s.timer); s.timer = setTimeout(() => { const n = s.paths.size; this.attribute(s); if (s.paths.size !== n && typeof FinComReact === "object") FinComReact.redraw(); }, 0);
  },
  // after it: the settings it changed, with their value before (the first time each is changed)
  attribute(s){
    if (!s || !s.armed || !s.pre) return;
    s.stores.forEach((st, i) => {
      const before = s.pre[i], now = st.snap();
      if (!before || !now) return;
      choicePathDiff(before, now, [], [], 0).forEach(p => { const k = i + ":" + JSON.stringify(p); if (!s.paths.has(k)) s.paths.set(k, {i, path: p, base: choicePathGet(before, p)}); });
    });
    s.armed = 0; s.pre = null;
  },
  attributeAll(){ Object.values(this.secs).forEach(s => { if (s.armed) this.attribute(s); }); },
  // a change that is not the person's edit (a guess, a confirm of its own): what was edited before it is noted first,
  // and the change itself is not taken as an edit; with bypass, what it saves is saved at once
  direct(fn, o){
    this.attributeAll();
    const by = !!(o && o.bypass); if (by) this.bypassN++;
    let r;
    try { r = fn(); }
    finally {
      if (by) this.bypassN--;
      Object.values(this.secs).forEach(s => { if (s.armed) s.pre = s.stores.map(st => st.snap()); });
    }
    return r;
  },
  changes(s){
    if (typeof s === "string") s = this.secs[s];
    if (!s) return [];
    if (s.armed) this.attribute(s);
    return Array.from(s.paths.values()).filter(c => { const root = s.stores[c.i] && s.stores[c.i].root(); return root && !choiceSame(choicePathGet(root, c.path), c.base); });
  },
  dirty(id){
    const s = typeof id === "string" ? this.secs[id] : id;
    if (!s) return false;
    if (s.custom) return !!s.custom.dirty();
    return this.changes(s).length > 0;
  },
  dirtyOn(page){ return Object.values(this.secs).filter(s => s.page === page && this.dirty(s)); },
  anyDirty(){ return Object.values(this.secs).some(s => this.dirty(s)); },
  // the saving of a store waits while a section holding it has unsaved changes (true: do not save now)
  hold(key){
    if (this.bypassN || !key) return false;
    for (const s of Object.values(this.secs)){
      if (s.custom || !s.stores.some(st => st.hold === key)) continue;
      if (this.dirty(s)){ s.held = s.held || new Set(); s.held.add(key); return true; }
    }
    return false;
  },
  // the copy the cloud is sent while a draft is open: the saved values, without the unsaved edits
  view(kind, id, data, cid){
    const want = kind === "client" ? "client:" + id : kind === "firm" ? "firm" : kind === "party" ? "parties:" + cid : kind === "sales_cfg" ? "salescfg:" + id : "";
    if (!want) return data;
    let out = data;
    Object.values(this.secs).forEach(s => {
      if (s.custom) return;
      s.stores.forEach((st, i) => {
        if (st.hold !== want) return;
        this.changes(s).filter(c => c.i === i).forEach(c => {
          let path = c.path;
          if (kind === "party"){ if (path[0] !== id) return; path = path.slice(1); }
          if (!path.length) return;
          if (out === data) out = clone(data);
          choicePathSet(out, path, c.base);
        });
      });
    });
    return out;
  },
  // Save: what was chosen is confirmed and saved, with who and when
  save(id){
    const s = this.secs[id]; if (!s) return false;
    if (s.custom){ const ok = s.custom.save(); if (ok !== false){ this.stamp(s); delete this.secs[id]; render(); if (typeof Smart === "object") setTimeout(() => Smart.afterSave(), 0); } return ok !== false; }
    const ch = this.changes(s);
    this.bypassN++;
    try {
      const co = s.cid ? S.companies[s.cid] : null;
      s.stores.forEach((st, i) => {
        const mine = ch.filter(c => c.i === i).map(c => c.path);
        if (st.kind === "client" && co) ch.filter(c => c.i === i).forEach(cc => {
          const p = cc.path;
          const k = p[0] === "gst" && p.length === 2 && /^(cgst|sgst|igst|rcm(Cgst|Sgst|Igst)(In|Out))$/.test(p[1]) ? "gst:" + p[1] : p[0] === "tdsLedgers" && p.length === 2 ? "tds:" + p[1] : p[0] === "expenseLedgers" && p.length === 2 ? "exp:" + p[1] : "";
          if (!k) return;
          const v = choicePathGet(co, p);
          if (v) choiceConfirm(co, k, v, {nosave: true, was: cc.base ? {value: cc.base, state: "", by: "", at: ""} : null}); else choiceForget(co, k, {nosave: true});
        });
        if (st.kind === "parties") mine.forEach(p => { if (p.length === 2 && p[1] === "ledgerName"){ const pt = (S.data[s.cid] || {}).parties[p[0]]; if (pt) partyChoiceSet(pt, pt.ledgerName, "confirmed"); } });
        if (st.kind === "salescfg" && co) mine.forEach(p => { if (p[0] === "cfg" && p[1] === "ledgers" && p.length === 3){ const v = choicePathGet(st.root(), p); co.choices = co.choices || {}; co.choices["sales:" + p[2]] = {value: v || "", state: "confirmed", by: choiceWho(), at: new Date().toISOString()}; } });
      });
      if (s.onSave) try { s.onSave(ch); } catch (e){}
      this.stamp(s, true);
      s.stores.forEach((st, i) => st.persist(ch.filter(c => c.i === i).map(c => c.path)));
      if (co && !s.stores.some(st => st.kind === "client")) Store.saveCompany(co);
    } finally { this.bypassN--; }
    delete this.secs[id];
    render();
    // smart moves round 1 (9): saved on a setup page reached from another page: "Saved · Back to Post to Tally →"
    if (typeof Smart === "object") setTimeout(() => Smart.afterSave(), 0);
    return true;
  },
  // "Saved · <time> · <who>", kept with the client (or the firm) so every computer shows it
  stamp(s, quiet){
    const rec = {by: choiceWho(), at: new Date().toISOString()};
    const firmOnly = s.cid === "" || (s.stores.length && s.stores.every(st => st.kind === "firm" || st.kind === "reading"));
    if (firmOnly && S.firm){ S.firm.saved = Object.assign({}, S.firm.saved, {[s.id]: rec}); this.bypassN++; try { Store.saveFirm(); } finally { this.bypassN--; } }
    else { const co = s.cid && S.companies[s.cid]; if (co){ co.saved = Object.assign({}, co.saved, {[s.id]: rec}); if (!quiet){ this.bypassN++; try { Store.saveCompany(co); } finally { this.bypassN--; } } } }
    return rec;
  },
  savedRec(id, cid){
    const co = cid === "" ? null : S.companies[cid === undefined ? S.coId : cid];
    return (co && co.saved && co.saved[id]) || (S.firm && S.firm.saved && S.firm.saved[id]) || null;
  },
  // Don't save: every value edited goes back to what it was; what else waited is saved
  discard(id){
    const s = this.secs[id]; if (!s) return;
    if (s.custom){ try { s.custom.discard(); } catch (e){} delete this.secs[id]; render(); return; }
    const ch = this.changes(s);
    ch.slice().reverse().forEach(c => { const root = s.stores[c.i].root(); if (root) choicePathSet(root, c.path, c.base); });
    delete this.secs[id];
    this.bypassN++;
    try { s.stores.forEach((st, i) => { if ((s.held && s.held.has(st.hold)) || ch.some(c => c.i === i)) st.persist(ch.filter(c => c.i === i).map(c => c.path)); if (st.after && ch.some(c => c.i === i)) st.after(); }); }
    finally { this.bypassN--; }
    render();
  },
  // a pick waiting for its Confirm button (the bank account's ledger): kept here so leaving the page can ask
  pick(id, o){
    if (o.value === null || o.value === undefined || o.value === ""){ delete this.picks[id]; delete this.secs[id]; return; }
    this.picks[id] = o.value;
    this.reg(id, {label: o.label, cid: o.cid, page: this.pageNow(), custom: {dirty: () => !!this.picks[id], save: () => { const v = this.picks[id]; delete this.picks[id]; return o.save(v); }, discard: () => { delete this.picks[id]; }}});
  },
  // after each drawing: the page changed with unsaved changes on the one left → ask
  onPage(h){
    const prev = this.page;
    this.page = h;
    if (!prev || prev === h || this.asking) return;
    const list = this.dirtyOn(prev);
    Object.values(this.secs).forEach(s => { if (s.page === prev && !list.includes(s)) delete this.secs[s.id]; });
    if (!list.length) return;
    this.ask(list).then(a => {
      if (a === "stay"){ if (typeof Route === "object") Route.apply(prev); }
    });
  },
  // a panel closed (Bank settings, Sales settings): asked first when it has unsaved changes
  guard(ids, then){
    const list = [].concat(ids).map(i => this.secs[i]).filter(s => s && this.dirty(s));
    if (!list.length){ then(); return; }
    this.ask(list).then(a => { if (a !== "stay") then(); });
  },
  // "Save your changes?": Save / Don't save / Stay
  ask(list){
    this.asking = true;
    return new Promise(done => {
      let box = document.getElementById("confirmBox");
      if (!box){ box = document.createElement("div"); box.id = "confirmBox"; document.body.appendChild(box); }
      box.innerHTML = '<div class="cbx" role="dialog" aria-modal="true" aria-labelledby="cbxT" data-leave-ask=""><h2 id="cbxT">Save your changes?</h2>' +
        '<div class="note" style="font-size:14px;line-height:1.5">Not saved yet: <b>' + list.map(s => esc(s.label)).join("</b>, <b>") + "</b>.</div>" +
        '<div class="row" style="justify-content:flex-end;margin-top:16px;gap:8px"><button class="btn" data-leave="stay">Stay</button><button class="btn" data-leave="drop">Don’t save</button><button class="btn primary" data-leave="save">Save</button></div></div>';
      box.style.display = "flex";
      const finish = v => {
        box.style.display = "none"; box.innerHTML = ""; document.removeEventListener("keydown", onKey, true); this.asking = false;
        if (v === "save") list.forEach(s => this.save(s.id));
        else if (v === "drop") list.forEach(s => this.discard(s.id));
        done(v);
      };
      const onKey = ev => { if (ev.key === "Escape"){ ev.preventDefault(); ev.stopPropagation(); finish("stay"); } };
      document.addEventListener("keydown", onKey, true);
      box.onclick = ev => { const bt = ev.target.closest("[data-leave]"); if (bt){ ev.stopPropagation(); finish(bt.dataset.leave); } };
      const sv = box.querySelector('[data-leave="save"]'); if (sv) sv.focus();
    });
  }
};
if (typeof window !== "undefined"){
  window.addEventListener("beforeunload", ev => { try { if (Drafts.anyDirty()){ ev.preventDefault(); ev.returnValue = ""; return ""; } } catch (e){} });
}
