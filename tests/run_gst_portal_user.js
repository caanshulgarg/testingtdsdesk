// node run_gst_portal_user.js - the GSTR-2B fetch asked for a username the owner had typed (17-Nov-2026). GST settings
// has two boxes: "GST portal username" (gstSet[state].portalUser, the only one the 2B fetch reads: GSTAPI.user) and the
// browser helper's "GST portal login" (user id and password, kept on the firm's server). Checks:
//  1. saving the helper's login fills an empty "GST portal username" at once (not a draft of the settings page), and
//     never replaces one already there; a login already saved on the server fills it when the logins are read;
//  2. "Don't save" of the settings page's draft never deletes or rolls back a setting stored since by other code (the
//     lost portalUser), and still undoes the person's own unsaved edits.
// Runs the real code of src/js/01, 27, 60, 84 and server/_shared/gst3b.js (GSTSet). Made-up data only.
const fs = require("fs"), path = require("path"), os = require("os");
const {load} = require("./harness");
const rd = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gpu-")), "index.html");
fs.writeFileSync(html, '<script id="app-main">\n' + ["server/_shared/gst3b.js", "src/js/01-documents-in-the-firm-account.js", "src/js/27-firm-account.js", "src/js/60-choices.js", "src/js/84-gst-browser.js"]
  .map(rd).join("\n").replace(/^export \{[^}]*\};$/m, "") + "\n</script>");
const {ctx, x} = load(html, ["GSTSet", "clone", "stableStr", "choiceSplit", "choiceWho", "choicePathGet", "choicePathSet", "choiceSame", "choicePathDiff", "DRAFT_SKIP", "choiceStore", "Drafts", "GSTB"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const GSTIN = "07AAACZ9999Z1Z5", REG = "07", SEC = "setup:gstset", D = x.Drafts;
let saves = [];   // each saveBooks: was it let through (bypass), and the portalUser then
ctx.saveBooks = () => { saves.push({through: !D.hold("books:c1"), user: (((ctx.S.books.gstSet || {})[REG]) || {}).portalUser}); };
ctx.render = () => {}; ctx.whoAmI = () => "owner@firm.test"; ctx.setTimeout = () => 0; ctx.clearTimeout = () => {};
ctx.Store = {saveCompany(){}, saveFirm(){}, saveParty(){}}; ctx.refreshStats = () => {};
ctx.GSTR = {_carry: 1}; ctx.Route = {of: () => "#/c/c1/setup/gstset"};
let rows = [];
ctx.Cloud = {on: () => true, async rpc(fn, a){ if (fn === "gst_portal_login_save"){ rows = [{gstin: a.p_gstin, username: a.p_username, has_password: true}]; return {ok: true}; } if (fn === "gst_portal_login_list") return rows; return null; }};
const fresh = (gstSet) => {
  ctx.S.companies = {c1: {id: "c1", name: "ZZ Test Traders"}}; ctx.S.coId = "c1"; ctx.S.firm = {};
  ctx.S.books = {cid: "c1", gstSet: gstSet || {}, gstOpen: {}};
  D.secs = {}; D.bypassN = 0; rows = []; saves = []; x.GSTB.logins = {}; x.GSTB.loginsAt = {};
  D.reg(SEC, {label: "GST", stores: ["client", "books:gstSet,gstOpen,gstApi"], cid: "c1"});
};
const edit = (f) => { D.touch(SEC); f(); D.attribute(D.secs[SEC]); };   // a person's edit inside the section
const user = () => x.GSTSet.peek(REG).portalUser;

(async () => {
  // ---- 1. the helper's login fills an empty "GST portal username"
  fresh();
  edit(() => { ctx.S.books.gstOpen = {[REG]: {igst: 100}}; });            // an unsaved edit on the page: a draft open
  ok(D.dirty(SEC), "1. an edit on GST settings is a draft");
  await x.GSTB.saveLogin(GSTIN, "fx_owner_user", "fx-made-up", null);
  ok(user() === "fx_owner_user", "1. the helper's login saved: the GST portal username (what the 2B fetch reads) is filled");
  ok(saves.length && saves[0].through && saves[0].user === "fx_owner_user", "1. ... and saved at once, past the page's draft");
  D.discard(SEC);
  ok(user() === "fx_owner_user" && !((ctx.S.books.gstOpen || {})[REG] || {}).igst, "1. Don't save: the page's own edit goes back, the username stays");
  fresh({[REG]: {portalUser: "fx_typed_before"}});
  await x.GSTB.saveLogin(GSTIN, "fx_other_user", "fx-made-up", null);
  ok(user() === "fx_typed_before", "1. a GST portal username already there is never replaced by the helper's");
  fresh(); rows = [{gstin: GSTIN, username: "fx_server_user", has_password: true}];
  await x.GSTB.loadLogins(true);
  ok(user() === "fx_server_user" && saves.some(s => s.through), "1. a login saved on the server earlier fills the empty username when the logins are read");
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

  // no password in the books
  ok(!JSON.stringify(ctx.S.books).includes("fx-made-up"), "the helper's password is never in the books");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
