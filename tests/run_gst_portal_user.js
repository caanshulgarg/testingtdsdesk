// node run_gst_portal_user.js - the GSTR-2B fetch asked for a username the owner had typed (17-Nov-2026). GST settings
// has two boxes: "GST portal username" (gstSet[state].portalUser, the only one the 2B fetch reads: GSTAPI.user) and the
// browser helper's "GST portal login" (user id and password, kept on the firm's server). Checks:
//  1. saving the helper's login fills an empty "GST portal username" (not a draft of the settings page, and never the
//     page's other unsaved edits saved with it), never replaces one already there, only for one of the client's GSTINs
//     and the client still open; a login already saved on the server fills it once when the logins are read (not
//     again after the person empties it);
//  2. "Don't save" of the settings page's draft never deletes or rolls back a setting stored since by other code (the
//     lost portalUser), and still undoes all of the person's own unsaved edits, also a new state's settings edited one
//     part after another (review of 421410935: the opening IGST and then CGST of a new state; PMT-06 and then the
//     composition rate).
// Runs the real code of src/js/01, 27, 60, 84 and server/_shared/gst3b.js (GSTSet). Made-up data only.
const fs = require("fs"), path = require("path"), os = require("os");
const {load} = require("./harness");
const rd = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gpu-")), "index.html");
fs.writeFileSync(html, '<script id="app-main">\n' + ["server/_shared/gst3b.js", "src/js/01-documents-in-the-firm-account.js", "src/js/27-firm-account.js", "src/js/60-choices.js", "src/js/84-gst-browser.js"]
  .map(rd).join("\n").replace(/^export \{[^}]*\};$/m, "") + "\n</script>");
const {ctx, x} = load(html, ["GSTSet", "clone", "stableStr", "choiceSplit", "choiceWho", "choicePathGet", "choicePathSet", "choiceSame", "choicePathDiff", "DRAFT_SKIP", "choiceStore", "Drafts", "GSTR", "GSTB"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const GSTIN = "07AAACZ9999Z1Z5", REG = "07", SEC = "setup:gstset", D = x.Drafts;
let saves = [];   // each saveBooks let through (not held for the page's draft): what it saved
ctx.saveBooks = () => { if (!D.hold("books:c1")) saves.push(JSON.parse(JSON.stringify({gstSet: ctx.S.books.gstSet, gstOpen: ctx.S.books.gstOpen}))); };
ctx.render = () => {}; ctx.whoAmI = () => "owner@firm.test"; ctx.setTimeout = () => 0; ctx.clearTimeout = () => {};
ctx.Store = {saveCompany(){}, saveFirm(){}, saveParty(){}}; ctx.refreshStats = () => {};
ctx.Route = {of: () => "#/c/c1/setup/gstset"};
let rows = [];
// the firm's server stood in: the saved logins of client c1 (rows), none for any other client
ctx.Cloud = {on: () => true, async rpc(fn, a){ if (fn === "gst_portal_login_save"){ if (a.p_client === "c1") rows = [{gstin: a.p_gstin, username: a.p_username, has_password: true}]; return {ok: true}; } if (fn === "gst_portal_login_list") return a.p_client === "c1" ? rows : []; return null; }};
const fresh = (gstSet) => {
  ctx.S.companies = {c1: {id: "c1", name: "ZZ Test Traders"}}; ctx.S.coId = "c1"; ctx.S.firm = {};
  ctx.S.books = {cid: "c1", gstSet: gstSet || {}, gstOpen: {}, gstRegs: [{gstin: GSTIN}]};
  D.secs = {}; D.bypassN = 0; rows = []; saves = []; x.GSTB.logins = {}; x.GSTB.loginsAt = {};
  D.reg(SEC, {label: "GST", stores: ["client", "books:gstSet,gstOpen,gstApi"], cid: "c1"});
};
const edit = (f) => { D.touch(SEC); f(); D.attribute(D.secs[SEC]); };   // a person's edit inside the section
const user = () => x.GSTSet.peek(REG).portalUser, clone = (o) => JSON.parse(JSON.stringify(o));

(async () => {
  // ---- 1. the helper's login fills an empty "GST portal username"
  fresh();
  await x.GSTB.saveLogin(GSTIN, "fx_owner_user", "fx-made-up", null);
  ok(user() === "fx_owner_user", "1. the helper's login saved: the GST portal username (what the 2B fetch reads) is filled");
  ok(saves.length && saves[saves.length - 1].gstSet[REG].portalUser === "fx_owner_user", "1. ... and saved at once when the page has no unsaved edit");
  const open = () => ((ctx.S.books.gstOpen || {})[REG] || {}).igst;
  for (const how of ["save", "discard"]){
    fresh();
    edit(() => { ctx.S.books.gstOpen = {[REG]: {igst: 100}}; });          // an unsaved edit on the page: a draft open
    ok(D.dirty(SEC), "1. " + how + ": an edit on GST settings is a draft");
    await x.GSTB.saveLogin(GSTIN, "fx_owner_user", "fx-made-up", null);
    ok(user() === "fx_owner_user" && !saves.some(v => (v.gstOpen[REG] || {}).igst), "1. " + how + ": the username is filled; the page's unsaved opening credit is not saved with it");
    ok(D.dirty(SEC) && D.changes(SEC).length === 1, "1. " + how + ": the opening credit is still the page's only unsaved edit");
    saves = [];
    if (how === "save") D.save(SEC); else D.discard(SEC);
    if (how === "save") ok(user() === "fx_owner_user" && open() === 100, "1. Save: the opening credit and the username are both kept");
    else ok(user() === "fx_owner_user" && !open() && saves.length && saves[saves.length - 1].gstSet[REG].portalUser === "fx_owner_user", "1. Don't save: the opening credit goes back, the username stays and is saved");
  }
  // a new state's first setting made on the page, then the helper's login: the setting is still the page's draft
  fresh();
  edit(() => { x.GSTSet.store(REG).pmt = "self"; });
  await x.GSTB.saveLogin(GSTIN, "fx_owner_user", "fx-made-up", null);
  ok(user() === "fx_owner_user" && D.dirty(SEC) && !saves.some(v => (v.gstSet[REG] || {}).pmt), "1. a new state's unsaved PMT-06 method stays a draft (not saved) when the username is filled beside it");
  D.discard(SEC);
  ok(user() === "fx_owner_user" && !x.GSTSet.peek(REG).pmt, "1. Don't save: the PMT-06 method goes back, the username stays");
  fresh({[REG]: {portalUser: "fx_typed_before"}});
  await x.GSTB.saveLogin(GSTIN, "fx_other_user", "fx-made-up", null);
  ok(user() === "fx_typed_before", "1. a GST portal username already there is never replaced by the helper's");
  fresh();
  await x.GSTB.saveLogin("27AAACZ9999Z1Z9", "fx_other_user", "fx-made-up", null);
  ok(!x.GSTSet.peek("27").portalUser, "1. not for a GSTIN that is not the client's");
  fresh(); ctx.S.books.loading = true;
  await x.GSTB.saveLogin(GSTIN, "fx_other_user", "fx-made-up", null);
  ok(!user(), "1. not into books still loading");
  fresh();
  const rpc = ctx.Cloud.rpc; ctx.Cloud.rpc = async (fn, a) => { const r = await rpc(fn, a); if (fn === "gst_portal_login_save"){ ctx.S.coId = "c2"; ctx.S.books = {cid: "c2", gstSet: {}, gstRegs: [{gstin: GSTIN}]}; } return r; };
  await x.GSTB.saveLogin(GSTIN, "fx_other_user", "fx-made-up", null);
  ctx.Cloud.rpc = rpc;
  ok(!user(), "1. not when another client was opened while the login was being saved");
  fresh(); rows = [{gstin: GSTIN, username: "fx_server_user", has_password: true}];
  await x.GSTB.loadLogins(true);
  ok(user() === "fx_server_user" && saves.length, "1. a login saved on the server earlier fills the empty username when the logins are read");
  edit(() => { x.GSTSet.store(REG).portalUser = ""; }); D.save(SEC);          // the person empties it on purpose
  await x.GSTB.loadLogins(true);
  ok(!user(), "1. emptied by the person afterwards: reading the logins again does not fill it again");
  fresh(); ctx.S.books.cid = "other"; rows = [{gstin: GSTIN, username: "fx_server_user"}];
  await x.GSTB.loadLogins(true);
  ok(!user(), "1. not into another client's books");

  // ---- 2. the lost portalUser: "Don't save" deleted a username stored after the draft began
  fresh();
  edit(() => { x.GSTSet.store(REG).portalUser = "fx_draft"; });             // typed in the box, not saved...
  edit(() => { x.GSTSet.store(REG).portalUser = ""; });                     // ... and emptied again
  await x.GSTB.saveLogin(GSTIN, "fx_owner_user", "fx-made-up", null);       // the helper's login fills it at once
  ok(user() === "fx_owner_user" && !D.dirty(SEC), "2. the username stored by the helper's login is not taken as the page's unsaved edit");
  D.discard(SEC);
  ok(user() === "fx_owner_user", "2. Don't save keeps the username stored after the draft began (it was deleted before)");
  // a value changed outside the draft without Drafts.direct (e.g. another computer's copy): not rolled back either
  fresh();
  edit(() => { x.GSTSet.store(REG).portalUser = "fx_draft"; });
  ctx.S.books.gstSet = {[REG]: {portalUser: "fx_from_elsewhere"}};
  D.discard(SEC);
  ok(user() === "fx_from_elsewhere", "2. a setting whose stored value changed since the draft wrote it is never rolled back");
  // the person's own edits still go back, also when edited twice
  fresh({[REG]: {portalUser: "fx_saved"}});
  edit(() => { x.GSTSet.store(REG).portalUser = "fx_one"; });
  edit(() => { x.GSTSet.store(REG).portalUser = "fx_two"; });
  ok(D.dirty(SEC), "2. the person's edit is a draft");
  D.discard(SEC);
  ok(user() === "fx_saved", "2. Don't save: the person's own edit (changed twice) goes back to the saved value");
  fresh();
  edit(() => { x.GSTSet.store(REG).portalUser = "fx_new"; });
  D.discard(SEC);
  ok(!user(), "2. Don't save: a username typed and not saved goes (it had no value before)");
  fresh();
  edit(() => { x.GSTSet.store(REG).portalUser = "fx_new"; });
  D.save(SEC);
  ok(user() === "fx_new" && !D.secs[SEC], "2. Save keeps it");

  // a new state's settings edited one part after another: Don't save undoes every part, and the cloud is sent none
  fresh();
  edit(() => { const b = ctx.S.books; b.gstOpen = Object.assign({}, b.gstOpen); b.gstOpen[REG] = Object.assign({}, b.gstOpen[REG], {igst: 100}); });
  edit(() => { const b = ctx.S.books; b.gstOpen = Object.assign({}, b.gstOpen); b.gstOpen[REG] = Object.assign({}, b.gstOpen[REG], {cgst: 5}); });
  edit(() => { const b = ctx.S.books; b.gstOpen = Object.assign({}, b.gstOpen); b.gstOpen[REG] = Object.assign({}, b.gstOpen[REG], {igst: 200}); });
  ok(D.dirty(SEC), "2. a new state's opening IGST, then CGST, then IGST again: a draft");
  D.discard(SEC);
  ok(JSON.stringify(ctx.S.books.gstOpen) === "{}", "2. Don't save: all of it goes back (" + JSON.stringify(ctx.S.books.gstOpen) + ")");
  fresh();
  edit(() => { x.GSTSet.store(REG).pmt = "self"; });
  edit(() => { x.GSTSet.store(REG).comp = "mfr"; });
  D.discard(SEC);
  ok(JSON.stringify(ctx.S.books.gstSet) === "{}", "2. a new state's PMT-06 method, then its composition rate: Don't save undoes both (" + JSON.stringify(ctx.S.books.gstSet) + ")");
  fresh({[REG]: {portalUser: "fx_saved"}});
  edit(() => { x.GSTSet.store(REG).pmt = "self"; });
  edit(() => { x.GSTSet.store(REG).comp = "mfr"; });
  D.discard(SEC);
  ok(JSON.stringify(ctx.S.books.gstSet) === JSON.stringify({[REG]: {portalUser: "fx_saved"}}), "2. the same for a state already set up: back to what was saved");
  // the cloud copy while such a draft is open: the saved values (Drafts.view, for the client's own settings)
  fresh(); ctx.S.companies.c1.gst = {};
  edit(() => { ctx.S.companies.c1.gst = Object.assign({}, ctx.S.companies.c1.gst, {extra: {a: "x"}}); });
  edit(() => { ctx.S.companies.c1.gst.extra = Object.assign({}, ctx.S.companies.c1.gst.extra, {b: "y"}); });
  const sent = D.view("client", "c1", ctx.S.companies.c1);
  ok(!((sent.gst || {}).extra || {}).a && !((sent.gst || {}).extra || {}).b && ctx.S.companies.c1.gst.extra.b === "y", "2. the cloud is sent neither part of a new group of settings while it is unsaved");

  // review of 9a92f1000 (cases A-G): Don't save gives what it gave before these fixes
  const J = (v) => JSON.stringify(v);
  // A. Settings → Suppliers → Add supplier (a record with empty fields), renamed, Don't save: the record goes
  fresh(); ctx.S.data = {c1: {parties: {p1: {id: "p1", name: "Old", pan: "AAAPA1111A"}}}};
  D.reg("set:deductees", {label: "D", stores: ["parties"], cid: "c1"});
  const P = () => ctx.S.data.c1.parties, pe = (f) => { D.touch("set:deductees"); f(); D.attribute(D.secs["set:deductees"]); };
  pe(() => { P()["p-new"] = {id: "p-new", name: "New supplier", pan: "", gstin: "", ytd: {}}; });
  pe(() => { P()["p-new"].name = "Acme"; });
  ok(D.dirty("set:deductees") && J(D.view("party", "p-new", clone(P()["p-new"]), "c1")) === J(P()["p-new"]), "A. a new supplier is a draft; its cloud copy is the record as it is (as before)");
  D.discard("set:deductees");
  ok(J(P()) === J({p1: {id: "p1", name: "Old", pan: "AAAPA1111A"}}), "A. Don't save: the new supplier goes, empty fields and all (" + J(P()) + ")");
  // the same with something stored on it since by other code: only what the draft wrote goes
  fresh(); ctx.S.data = {c1: {parties: {}}}; D.reg("set:deductees", {label: "D", stores: ["parties"], cid: "c1"});
  pe(() => { P()["p-new"] = {id: "p-new", name: "New supplier", pan: "", ytd: {}}; });
  D.direct(() => { P()["p-new"].ledgerChoice = {value: "L", state: "confirmed"}; });
  D.discard("set:deductees");
  ok(J(P()) === J({"p-new": {ledgerChoice: {value: "L", state: "confirmed"}}}), "A. ... and with a value stored on it since by other code, only that stays (" + J(P()) + ")");
  // B. a new state: username typed, PMT-06 picked, username emptied, Don't save
  fresh();
  edit(() => { x.GSTSet.store(REG).portalUser = "abc"; });
  edit(() => { x.GSTSet.store(REG).pmt = "self"; });
  edit(() => { x.GSTSet.store(REG).portalUser = ""; });
  D.discard(SEC);
  ok(J(ctx.S.books.gstSet) === "{}", "B. a new state's username typed, PMT-06 picked, username emptied: Don't save leaves nothing (" + J(ctx.S.books.gstSet) + ")");
  // C. the same setting of a new state edited twice
  fresh();
  edit(() => { ctx.S.books.gstOpen = {[REG]: {igst: 100}}; });
  edit(() => { ctx.S.books.gstOpen = {[REG]: {igst: 200}}; });
  D.discard(SEC);
  ok(J(ctx.S.books.gstOpen) === "{}", "C. a new state's opening IGST edited twice: Don't save leaves nothing (" + J(ctx.S.books.gstOpen) + ")");
  // D. a state's settings: one edited, then the whole state's settings removed
  fresh({[REG]: {portalUser: "saved", pmt: "fixed"}});
  edit(() => { x.GSTSet.store(REG).pmt = "self"; });
  edit(() => { delete ctx.S.books.gstSet[REG]; });
  D.discard(SEC);
  ok(J(ctx.S.books.gstSet) === J({[REG]: {portalUser: "saved", pmt: "fixed"}}), "D. one setting edited, then the state's settings removed: Don't save brings back what was saved (" + J(ctx.S.books.gstSet) + ")");
  // E. the client's settings: a new group (TDS ledgers), two parts, the cloud copy while unsaved, Don't save
  fresh(); D.reg("set:cotds", {label: "T", stores: ["client"], cid: "c1"});
  const co = ctx.S.companies.c1, ce = (f) => { D.touch("set:cotds"); f(); D.attribute(D.secs["set:cotds"]); };
  ce(() => { co.tdsLedgers = {"194C": "TDS C"}; });
  ce(() => { co.tdsLedgers["194J"] = "TDS J"; });
  const v = D.view("client", "c1", clone(co));
  ok(!Object.keys(v.tdsLedgers || {}).length && v.name === co.name && co.tdsLedgers["194J"] === "TDS J", "E. the cloud is sent no unsaved TDS ledger (" + J(v.tdsLedgers) + ")");
  D.discard("set:cotds");
  ok(J(co) === J({id: "c1", name: "ZZ Test Traders"}), "E. Don't save: both go (" + J(co) + ")");
  // F. a setting six levels down (compared whole): the saved parts come back, one stored since by other code stays
  fresh(); ctx.S.books.gstSet = {[REG]: {a: {b: {c: {d: {k1: 1, k2: 2}}}}}};
  edit(() => { ctx.S.books.gstSet[REG].a.b.c.d.k2 = 3; });
  D.direct(() => { ctx.S.books.gstSet[REG].a.b.c.d.k9 = 9; });
  D.discard(SEC);
  ok(J(ctx.S.books.gstSet[REG].a.b.c.d) === J({k1: 1, k2: 2, k9: 9}), "F. six levels down: k1 and k2 as saved, k9 (stored since by other code) kept (" + J(ctx.S.books.gstSet[REG].a.b.c.d) + ")");
  fresh(); ctx.S.books.gstSet = {[REG]: {a: {b: {c: {d: {k1: 1, k2: 2}}}}}};
  edit(() => { ctx.S.books.gstSet[REG].a.b.c.d.k2 = 3; });
  D.discard(SEC);
  ok(J(ctx.S.books.gstSet[REG].a.b.c.d) === J({k1: 1, k2: 2}), "F. ... and without k9: as saved");
  // G. a list (the filing types) changed twice
  fresh({[REG]: {filing: [{type: "monthly", from: "202404"}]}});
  edit(() => { const t = x.GSTSet.store(REG); t.filing = t.filing.concat([{type: "qrmp", from: "202407"}]); });
  edit(() => { const t = x.GSTSet.store(REG); t.filing = t.filing.concat([{type: "monthly", from: "202410"}]); });
  D.discard(SEC);
  ok(J(ctx.S.books.gstSet) === J({[REG]: {filing: [{type: "monthly", from: "202404"}]}}), "G. the filing types changed twice: Don't save brings back the saved list");

  // no password in the books
  ok(!JSON.stringify(ctx.S.books).includes("fx-made-up"), "the helper's password is never in the books");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
