// node run_choices_merge.js - review 19-21 (02-Oct-2026): a choice a person confirmed (co.choices, src/js/60-choices.js)
// is kept through every way a client's copy moves between computers: a save merged into the server's copy by a browser
// holding an older copy (cloudPushClient / merge3), an older or guessed copy applied from the server (cloudApply →
// fixCompany → choiceMigrate), auto-matching (choiceGuess), a supplier's record from the cloud (partyKeepChoice); and a
// settings page with unsaved changes sends the cloud the saved values only (Drafts.view in cloudSnapshot).
// Runs the real code of src/js/00, 01, 26, 27 and 60 against a stand-in server (PostgREST-like: GET, conditional PATCH).
const fs = require("fs"), path = require("path"), os = require("os");
const {load} = require("./harness");
const src = f => fs.readFileSync(path.join(__dirname, "..", "src", "js", f), "utf8");
const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cc-")), "index.html");
fs.writeFileSync(html, '<script id="app-main">\n' + ["00-core.js", "01-documents-in-the-firm-account.js", "26-sales-from-a-marketplace.js", "27-firm-account.js", "60-choices.js"].map(src).join("\n") + "\n</script>");
const {ctx, x} = load(html, ["GST_DEFAULTS", "TDS_LEDGER_DEFAULTS", "EXPENSE_DEFAULTS", "fixCompany", "clone", "fpHash", "stableStr", "cloudKey", "NOBASE", "plainObj", "sameVal", "merge3", "ClientBase",
  "takeClientHere", "cloudPushClient", "SAFE_ID", "ID_KEYS", "cleanIds", "cloudRowOk", "cloudApply", "cloudApplyNow", "cloudSnapshot",
  "CHOICE_LABEL", "choiceSplit", "choiceAcc", "choiceLegacy", "choiceLegacySet", "choiceDerive", "choiceRec", "choiceGet", "choiceState", "choiceValue", "choiceUsable", "choiceWho",
  "choiceWrite", "choiceGuess", "choiceConfirm", "choiceForget", "choicePick", "choiceMigrate", "partyChoice", "partyChoiceSet", "partyKeepChoice",
  "choicePathGet", "choicePathSet", "choiceSame", "choicePathDiff", "DRAFT_SKIP", "choiceStore", "Drafts"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const clone = o => JSON.parse(JSON.stringify(o));

// ---- a stand-in server and this browser's storage
let server = {}, tick = 0;
const stamp = () => "2026-10-02T07:" + String(10 + (++tick)).padStart(2, "0") + ":00.000000+00:00";
const kv = {}, saved = [];
ctx.BankDB = {get: async k => kv[k] === undefined ? undefined : clone(kv[k]), set: async (k, v) => { kv[k] = v === null ? undefined : clone(v); }};
ctx.Live = {applying: false};
ctx.Store = {saveCompany(c){ if (x.Drafts.hold("client:" + c.id)) return; saved.push(c.id); }, put(){}, saveFirm(){}, saveParty(){}, saveEntry(){}};
ctx.refreshStats = () => {};
ctx.render = () => {};
ctx.whoAmI = () => "a@firm.in";
ctx.CLOUD_CHUNK = 500;
ctx.Route = {of: () => "#/c/c1/setup/cotally"};
ctx.setTimeout = (f) => 0; ctx.clearTimeout = () => {};
ctx.Cloud = {
  st: {firm: "F1"},
  marks: () => ({}), setMarks(){},
  async api(p, o){
    o = o || {};
    const id = decodeURIComponent((p.match(/&id=eq\.([^&]+)/) || [])[1] || "");
    const row = server[id];
    if (!o.method || o.method === "GET") return row ? [{data: clone(row.data), updated_at: row.updated_at, deleted: !!row.deleted}] : [];
    if (o.method === "PATCH"){
      const want = decodeURIComponent((p.match(/&updated_at=eq\.([^&]+)/) || [])[1] || "");
      if (!row || row.updated_at !== want) return [];
      Object.assign(row, clone(o.body), {updated_at: stamp()});
      return [{data: clone(row.data), updated_at: row.updated_at}];
    }
    if (o.method === "POST"){ [].concat(o.body).forEach(b => { server[b.id] = Object.assign(clone(b), {updated_at: stamp()}); }); return null; }
    throw new Error("unexpected " + o.method);
  }
};
ctx.S = {companies: {}, data: {}, inbox: {}, firm: {firmName: "GSC"}, bank: null, sales: null, coId: "c1"};
const sendBatch = (table, rows) => ctx.Cloud.api(table, {method: "POST", body: rows});
const push = async id => x.cloudPushClient({kind: "client", id, data: clone(ctx.S.companies[id]), hash: x.fpHash(JSON.stringify(ctx.S.companies[id]))}, sendBatch);
const GARG = "GARG SHEKHAR & COMPANY";

(async () => {
  // the server's copy: the Tally company and a bank account's ledger confirmed on another computer at 07:00
  const base = {id: "c1", name: "Testing AAD", gst: {cgst: "INPUT CGST", sgst: "INPUT SGST", igst: "07 IGST INPUT"}, postTo: "OTHER CO", postToBy: "auto", postToAt: "2026-10-01T00:00:00Z",
    bankAccounts: [{id: "ba1", bank: "HDFC Bank", last4: "1234", ledger: ""}], stats: {records: 5}};
  const conf = {value: GARG, state: "confirmed", by: "b@firm.in", at: "2026-10-02T07:00:00Z"}, bank = {value: "HDFC BANK", state: "confirmed", by: "b@firm.in", at: "2026-10-02T07:00:00Z"};
  server = {c1: {data: Object.assign(clone(base), {postTo: GARG, postToBy: "b@firm.in", postToAt: conf.at, bankAccounts: [{id: "ba1", bank: "HDFC Bank", last4: "1234", ledger: "HDFC BANK"}],
    choices: {postTo: conf, "bank:ba1": bank}}), updated_at: stamp()}};

  // 1. this browser holds the older copy (its base) and saves a change of its own: the server keeps the choices
  await ctx.BankDB.set("cbase:c1", base);
  ctx.S.companies.c1 = Object.assign(clone(base), {roundOff: "Round Off A/c"});
  await push("c1");
  const d1 = server.c1.data;
  ok(d1.roundOff === "Round Off A/c", "1. the older copy's own change is saved");
  ok(d1.choices.postTo.value === GARG && d1.choices.postTo.state === "confirmed" && d1.postTo === GARG, "1. the confirmed Tally company stays on the server: " + d1.postTo);
  ok(d1.choices["bank:ba1"].value === "HDFC BANK" && d1.bankAccounts[0].ledger === "HDFC BANK", "1. the confirmed bank ledger and its account stay on the server");
  ok(x.choiceUsable(ctx.S.companies.c1, "postTo") === GARG && x.choiceUsable(ctx.S.companies.c1, "bank:ba1") === "HDFC BANK", "1. this browser now has both, usable for posting");

  // 2. the older copy changed the old field itself (postTo blanked by code that knows nothing of choices): the choice holds
  await ctx.BankDB.set("cbase:c1", Object.assign(clone(server.c1.data), {postTo: "OTHER CO", postToBy: "auto", choices: undefined}));
  ctx.S.companies.c1 = Object.assign(clone(server.c1.data), {postTo: "", postToBy: ""}); delete ctx.S.companies.c1.choices;
  await push("c1");
  ok(server.c1.data.choices.postTo.value === GARG, "2. the server's choice record is not touched");
  ok(ctx.S.companies.c1.postTo === GARG && x.choiceState(ctx.S.companies.c1, "postTo") === "confirmed", "2. and this browser's copy takes the confirmed company back (fixCompany → choiceMigrate)");
  await push("c1");
  ok(server.c1.data.postTo === GARG, "2. the next save puts the old field right on the server too: " + server.c1.data.postTo);

  // 3. no base kept yet (the first save after the change): the server's values stand
  delete kv["cbase:c1"];
  ctx.S.companies.c1 = clone(base);
  await push("c1");
  ok(server.c1.data.choices.postTo.value === GARG && server.c1.data.postTo === GARG && server.c1.data.choices["bank:ba1"].value === "HDFC BANK", "3. no base: an older copy blanks nothing");

  // 4. an older client row applied from the server (cloudApply): what is confirmed here, and newer, stays
  ctx.S.companies.c1 = x.fixCompany(clone(server.c1.data));
  const older = Object.assign(clone(base), {stats: {records: 9}});
  await x.cloudApply([{kind: "client", id: "c1", client_id: "c1", data: older, deleted: false}]);
  const c4 = ctx.S.companies.c1;
  ok(c4.stats.records === 9, "4. the row is applied");
  ok(x.choiceUsable(c4, "postTo") === GARG && c4.postTo === GARG && c4.postToBy !== "auto", "4. the confirmed Tally company is not blanked nor turned back into OTHER CO (auto)");
  ok(x.choiceUsable(c4, "bank:ba1") === "HDFC BANK" && (c4.bankAccounts.find(a => a.id === "ba1") || {}).ledger === "HDFC BANK", "4. the confirmed bank ledger is kept, its account too");
  // a guess in the incoming copy, even a later one, never replaces a confirmed choice; a later confirmed one does
  const guess = Object.assign(clone(server.c1.data), {choices: {postTo: {value: "OTHER CO", state: "guessed", by: "FinCom", at: "2026-12-01T00:00:00Z"}}, postTo: "OTHER CO", postToBy: "auto"});
  await x.cloudApply([{kind: "client", id: "c1", client_id: "c1", data: guess, deleted: false}]);
  ok(ctx.S.companies.c1.postTo === GARG && x.choiceState(ctx.S.companies.c1, "postTo") === "confirmed", "4. a later guess coming in: the confirmed company stays");
  const newer = Object.assign(clone(server.c1.data), {choices: Object.assign({}, server.c1.data.choices, {postTo: {value: "NEW CO", state: "confirmed", by: "c@firm.in", at: "2026-12-02T00:00:00Z"}}), postTo: "NEW CO"});
  await x.cloudApply([{kind: "client", id: "c1", client_id: "c1", data: newer, deleted: false}]);
  ok(ctx.S.companies.c1.postTo === "NEW CO" && x.choiceGet(ctx.S.companies.c1, "postTo").by === "c@firm.in", "4. a later confirmed change from another person is taken");

  // 5. auto-matching fills only an empty or guessed slot, never a confirmed one; old values count sensibly
  const c5 = x.fixCompany({id: "c5", name: "X", postTo: "AUTO CO", postToBy: "auto", gst: {cgst: "Typed CGST", sgst: "Auto SGST"}, gstPin: {cgst: true}, tdsLedgers: {professional: "TDS 94J"},
    bankAccounts: [{id: "b1", ledger: "SBI"}]});
  ok(["postTo", "gst:cgst", "gst:sgst", "tds:professional", "bank:b1"].every(k => x.choiceState(c5, k) === "guessed") && x.choiceGet(c5, "gst:cgst").value === "Typed CGST" && x.choiceGet(c5, "bank:b1").value === "SBI",
    "5. old saved values (even gstPin, even a bank account's ledger) are suggestions, kept pre-selected, until confirmed");
  ok(["postTo", "tds:professional", "gst:cgst", "bank:b1"].every(k => x.choiceUsable(c5, k) === ""), "5. posting uses confirmed choices only: none of the old values");
  x.choiceConfirm(c5, "gst:cgst", "Typed CGST");
  ok(x.choiceUsable(c5, "gst:cgst") === "Typed CGST" && x.choiceGuess(c5, "gst:cgst", "OTHER CGST") === false && c5.gst.cgst === "Typed CGST", "5. one Confirm makes it usable; a guess never replaces it");
  ok(x.choiceGuess(c5, "gst:sgst", "INPUT SGST", "test") === true && c5.gst.sgst === "INPUT SGST" && x.choiceState(c5, "gst:sgst") === "guessed", "5. a guess may replace a guess (kept as guessed)");
  x.choiceConfirm(c5, "tds:professional", "TDS 94J");
  ok(x.choiceUsable(c5, "tds:professional") === "TDS 94J" && x.choiceGet(c5, "tds:professional").by === "a@firm.in", "5. confirmed: usable, with who");
  c5.tdsLedgers.professional = "SOMETHING ELSE";                                      // a stray write of the old field
  ok(x.choiceUsable(c5, "tds:professional") === "TDS 94J", "5. a stray write of the old field does not change what posting uses");
  x.fixCompany(c5);
  ok(c5.tdsLedgers.professional === "TDS 94J", "5. and the old field is put back on the next load");

  // 6. a supplier's matched ledger from the cloud: a confirmed one here is kept over an older or guessed one
  const here = {id: "p1", name: "Kashi", ledgerName: "Kashi IT Solutions"}; x.partyChoiceSet(here, "Kashi IT Solutions", "confirmed");
  const came = x.partyKeepChoice(here, {id: "p1", name: "Kashi", ledgerName: "Kashi IT", ledgerChoice: {value: "Kashi IT", state: "guessed", by: "FinCom", at: "2027-01-01T00:00:00Z"}, ledgerAuto: true});
  ok(came.ledgerName === "Kashi IT Solutions" && came.ledgerChoice.state === "confirmed" && !came.ledgerAuto, "6. a supplier's confirmed ledger is kept over a later guess coming in");
  ok(x.partyChoiceSet(came, "Kashi IT", "guessed") === false, "6. and a guess cannot replace it here either");

  // 7. a settings page with unsaved changes: the cloud is sent the saved values, and the saving waits
  ctx.S.companies.c1 = x.fixCompany(clone(server.c1.data)); saved.length = 0;
  const D = x.Drafts;
  D.reg("setup:cotally", {label: "Tally", stores: ["client"], cid: "c1"});
  D.touch("setup:cotally"); ctx.S.companies.c1.roundOff = "Draft Round Off"; D.attribute(D.secs["setup:cotally"]);
  ok(D.dirty("setup:cotally") === true, "7. an edit in a section is a draft");
  ctx.Store.saveCompany(ctx.S.companies.c1);
  ok(saved.length === 0, "7. the client's saving waits for Save");
  const snap = x.cloudSnapshot().find(r => r.kind === "client" && r.id === "c1");
  ok(snap.data.roundOff === "Round Off A/c" && ctx.S.companies.c1.roundOff === "Draft Round Off", "7. the cloud is sent the saved value, the page shows the draft");
  D.save("setup:cotally");
  ok(saved.includes("c1") && !D.dirty("setup:cotally") && x.cloudSnapshot().find(r => r.kind === "client").data.roundOff === "Draft Round Off" && ctx.S.companies.c1.saved["setup:cotally"].by === "a@firm.in",
    "7. Save: saved, sent, and “saved by” kept with the client");
  D.reg("setup:cotds", {label: "TDS", stores: ["client"], cid: "c1"});
  D.touch("setup:cotds"); ctx.S.companies.c1.tdsLedgers = Object.assign({}, ctx.S.companies.c1.tdsLedgers, {professional: "TDS Typed"}); D.attribute(D.secs["setup:cotds"]);
  D.discard("setup:cotds");
  ok((ctx.S.companies.c1.tdsLedgers || {}).professional !== "TDS Typed" && !D.dirty("setup:cotds"), "7. Don't save: the value goes back");
  D.reg("setup:cotds", {label: "TDS", stores: ["client"], cid: "c1"});
  D.touch("setup:cotds"); ctx.S.companies.c1.tdsLedgers = Object.assign({}, ctx.S.companies.c1.tdsLedgers, {professional: "TDS Typed"}); D.attribute(D.secs["setup:cotds"]);
  D.save("setup:cotds");
  ok(x.choiceState(ctx.S.companies.c1, "tds:professional") === "confirmed" && x.choiceUsable(ctx.S.companies.c1, "tds:professional") === "TDS Typed", "7. Save of a TDS ledger: a confirmed choice");

  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
