/* @react-lazy: begin 97-postto-link.js (the React app loads this file with Post to Tally, Bank, Sales, the Assistant's entries, Settings and the Tally page's companies, and Post automatically: app/src/screens/Post.jsx, Bank.jsx, Sales.jsx, Settings.jsx, app/src/parts/TallyCompanies.jsx, app/src/lib/asstEntries.js, autopost.js) */
/* ================================================================== */
/* The Tally company a client posts to, from its Tally link            */
/* ================================================================== */
// Kept out of legacy.js (its size budget, tests/run_stability.py). Callers in src/js/24, 27, 49 and 59 check that these
// names exist; every page that posts or links loads this file first.
// ---------- the Post to Tally page: one line, one table, one button (C15-C18)
// what this client's entries go into, and through what: {company, bridge, state, action, go}
function postLineFor(co){
  const cloud = typeof TCloud === "object" && TCloud.on();
  if (cloud && !TCloud.pane.at && !TCloud.pane.busy && Date.now() - (PostPage.paneAt || 0) > 5 * 60000){ PostPage.paneAt = Date.now(); setTimeout(() => { try { TCloud.refreshPane(); } catch (e){} }, 0); }
  let bk = null; try { bk = cloud ? TCloud.book(co.id) : null; } catch (e){}
  // next-link-record: the company of the client's link record that allows posting (98-link-record.js), when read
  const lp = typeof linkPostOf === "function" ? linkPostOf(co) : null;
  let company = (lp && lp.pick && LinkRec.nameOf(lp.pick)) || (lp && lp.linked[0]) || co.postTo || (bk && bk.company) || "";
  if (!company){ try { company = tallyCoName(co); } catch (e){ company = co.tallyName || co.name; } }
  let bridge = "", state = "Ready", action = "", go = "", computer = "", tally = "";
  let heard = []; try { heard = cloud ? TCloud.bridgesHeard() : []; } catch (e){}
  const main = heard.find(r => r.main && r.go) || heard.find(r => r.main) || null;
  const local = Bridge.on() && Bridge.up();
  if (main){
    bridge = "FinCom Bridge " + (main.version || ""); computer = main.computer || ""; tally = main.online ? main.tally : "";
    if (!main.online){ state = ""; action = "FinCom Bridge on " + main.computer + " is not running"; go = "tally"; }
    else if (main.tally !== "open" && main.tally !== "busy" && !(local && bridgeLive(co))){ state = ""; action = "Tally not open on " + main.computer; }
  } else if (local){
    bridge = "FinCom Bridge " + (Bridge.st.version || ""); computer = Bridge.st.computer || "this computer"; tally = bridgeLive(co) ? "open" : "";
    if (!bridgeLive(co)){ state = ""; action = Bridge.st.tallyUp ? "Open " + company + " in Tally" : "Tally not open on " + (Bridge.st.computer || "this computer"); }
  } else if (Bridge.on()){ bridge = "FinCom Bridge"; state = ""; action = "FinCom Bridge is not answering on this computer"; go = "tally"; }
  else { state = ""; action = "Install FinCom Bridge"; go = "tally"; }
  if (lp){ if (!lp.linked.length){ state = ""; action = "Link to Tally"; go = "tally"; } else if (!lp.allowed.length){ state = ""; action = "Allow posting"; go = "cotally"; } }
  else if (!co.postTo){ state = ""; action = "Choose the Tally company"; go = "cotally"; }
  else if (typeof choiceState === "function" && choiceState(co, "postTo") !== "confirmed"){ state = ""; action = "Confirm the Tally company"; go = "cotally"; }
  return {company, bridge, state, action, go, computer, tally};
}
const PostPage = {paneAt: 0};
// ---------- the status line of Post to Tally (review of 02-Oct-2026, item 1): one line, "Posting into GARG SHEKHAR &
// COMPANY · Tally open on NWS144 · read 17:43 · Update now"; a second line only when something is wrong, saying what to
// do, with one button where it helps. The bridge's version and "Ready" are under More.
// {company, where, read, reading, more, problem: {text, button, go, kind} | null}
function postStatusFor(co){
  const pl = postLineFor(co), l = typeof tallyLine === "function" ? tallyLine(co) : null;
  const out = {company: pl.company, where: "", read: "", reading: false, more: [pl.bridge, pl.state].filter(Boolean).join(" · "), problem: null};
  // the steady sign (11-Oct-2026): the connection in the line is the firm's sign for this client (tallySign, src/js/49),
  // as steady as the top bar: "Posting into X on NWS144 (anshul) · Tally ready · read 15:34" (the owner: no "via"); not
  // ready only once that held a minute. Only the words: posting itself checks the bridge and the cloud at the moment it
  // posts (canPostTally, the posting's own checks), never this
  const sg = typeof tallySign === "function" ? tallySign(co) : null;
  // next-link-record: the client's one word, as every place says it (lib/linkStatus.js, globalThis.LinkWord)
  const w = typeof LinkWord === "function" ? LinkWord(co) : null;
  if (w) out.word = w.word;
  // (the owner, 26-Oct-2026: the same word in every place, at once, as the title chip and the Clients list say it)
  if (sg && sg.on){ out.where = w ? w.word : "Tally ready"; out.on = sg.many ? sg.many.length + " computers" : sg.pc || ""; if (l){ out.read = l.read; out.reading = !!l.reading; } }
  const p = (text, button, go, kind) => ({text, button: button || "", go: go || null, kind: kind || ""});
  let st = S.postStop && S.postStop.cid === co.id ? S.postStop : null;
  // a stop that no longer holds goes by itself: the company confirmed since, or no bill waits on a guessed ledger now
  if (st && /^Confirm the Tally company/.test(st.msg) && typeof choiceState === "function" && choiceState(co, "postTo") === "confirmed"){ S.postStop = null; st = null; }
  if (st && /^Posting waits/.test(st.msg)){ const b0 = postBills(co.id); if (b0 && !b0.ready.some(e => billGuessedWhy(e, co))){ S.postStop = null; st = null; } }
  // no company confirmed and the client linked: the linked company asked about here, one click (postToOffer)
  const lp = typeof linkPostOf === "function" ? linkPostOf(co) : null;
  const offer = typeof postToOffer !== "function" || (lp ? lp.allowed.length > 0 : choiceState(co, "postTo") === "confirmed" && co.postTo) ? null : postToOffer(co);
  const ask = (lead, kind) => { const o = p(lead + offer.ask, offer.companies.length === 1 ? "Allow posting" : "", offer.companies.length === 1 ? () => postToAllow(co, offer.companies[0]) : null, kind);
    if (offer.companies.length > 1) o.offer = offer.companies.map(c => ({company: c, go: () => postToAllow(co, c)}));
    return o; };
  if (st && offer && offer.companies.length && !/^Posting waits/.test(st.msg)){
    out.problem = ask("Not sent to Tally. ", "stop");
    out.problem.dismiss = () => { S.postStop = null; render(); };
    return out;
  }
  if (pl.go === "cotally" && offer && offer.companies.length){ out.problem = ask("", "company"); return out; }
  if (st){
    const guess = /^Confirm the Tally company/.test(st.msg), led = /^Posting waits/.test(st.msg);
    out.problem = p("Not sent to Tally: " + (guess ? "confirm the Tally company. " : led ? "a ledger is not confirmed. " : "choose the Tally company. ") + (guess || led ? st.msg + " " : "") + "The bills are still waiting here.",
      guess ? "Confirm the Tally company" : led ? "Open Client setup" : "Choose the Tally company", guess || !led ? goChooseTallyCompany : () => goSetupFor(st.msg), "stop");
    // the cloud's own words of what is allowed (Post.jsx puts them in: notAllowedRest)
    if (!guess && !led) out.problem.msg = st.msg;
    out.problem.dismiss = () => { S.postStop = null; render(); };
    return out;
  }
  if (pl.go === "tally" && lp && !lp.linked.length) { out.problem = p("Posting waits: link " + co.name + " to its company in Tally.", "Open the Tally page", goTallyPage, "company"); return out; }
  if (pl.go === "cotally") { out.problem = p(pl.action === "Confirm the Tally company" ? "Posting waits: confirm the Tally company (" + pl.company + " was found by FinCom, not chosen by a person)." : "Posting waits: choose the Tally company this client posts to.", pl.action, goChooseTallyCompany, "company"); return out; }
  // the one word not Linked: its one line and button (the same as the title chip's)
  // (reading stopped, paused or not answering: the lines below, with their own buttons)
  const reading = l && ["stopped", "paused", "notanswering"].includes(l.state);
  if (w && (w.kind === "waiting" || (w.kind === "needs" && !reading))){ out.where = w.word; out.problem = p(w.line + ".", w.port ? "Open the Tally page" : w.button ? w.button.label : "", w.button && w.button.act ? w.button.act : w.port ? goTallyPage : null, w.kind); return out; }
  // not ready (confirmed): the sign's reason and what to do, with Check again
  if (sg && !sg.on && (sg.computer || l)){ out.problem = p(sg.reason + " " + sg.fix, "Check again", () => tallyCheckNow(), sg.code); return out; }
  // ready: what is about this client's company on that computer (Tally not answering, reading paused, FinCom's Stop)
  if (l && sg && sg.on && ["notanswering", "paused", "stopped"].includes(l.state)){
    const T = {offline: [l.text + ": start that computer, or FinCom Bridge on it. Nothing can be posted or checked until then.", "", null],
      closed: [l.text + ": open TallyPrime there, with " + pl.company + ".", "", null],
      notanswering: [l.text + ": close any message box in Tally there; FinCom carries on by itself.", "", null],
      paused: [l.text + ": resume it from the FinCom Bridge icon there. Update now still reads.", "Update now", () => tallyUpdateNow(co.id)],
      stopped: [l.text + ". This is FinCom\u2019s Stop, set by an owner of the firm: an owner resumes it on the Tally page; posting goes on, Update now does not read until then.", "", null]}[l.state] || [l.text, "", null];
    out.problem = p(T[0], T[1], T[2], l.state); return out;
  }
  if (!pl.state && pl.action && !(sg && sg.on)){ out.problem = p(pl.action + ".", pl.go === "tally" ? "Open the Tally page" : "", pl.go === "tally" ? goTallyPage : null, "bridge"); return out; }
  const b = postBills(co.id), why = b && typeof billGuessedWhy === "function" ? b.ready.map(e => billGuessedWhy(e, co)).find(Boolean) : "";
  if (why) out.problem = p(why + " Confirm it in Client setup.", "Open Client setup", () => goSetupFor(why), "ledger");
  return out;
}
// ---------- the company a client may post to, set by itself when it is clear (B14)
// Exactly one Tally company is linked to the client (FinCom's cloud, or the company open in Tally here) and its GSTIN is
// the client's: that one, saved (it syncs), with postToBy "auto". For existing clients too, when one is opened.
const AutoPostTo = {at: {}};
async function autoPostTo(co, force){
  if (typeof linkPostOf === "function" && linkPostOf(co)) return false;
  // only an empty slot is filled, and as a guess to confirm; never over a confirmed choice (src/js/60), even "stop posting"
  if (!co || co.postTo || co.deleted || (typeof choiceGet === "function" && (choiceGet(co, "postTo") || {}).state === "confirmed")) return false;
  const mine = gstinKeyOf(co.gstin);
  if (!mine) return false;
  if (!force && Date.now() - (AutoPostTo.at[co.id] || 0) < 60000) return false;
  AutoPostTo.at[co.id] = Date.now();
  const found = new Map();
  const add = (name, gstin) => { const n = ledNm(name); if (!n) return; const k = n.toLowerCase(), x = found.get(k) || {name: n, gstins: new Set()}; if (gstinKeyOf(gstin)) x.gstins.add(gstinKeyOf(gstin)); found.set(k, x); };
  if (typeof TCloud === "object" && TCloud.on()){
    let rows = TCloud.pane.companies ? TCloud.pane.companies.filter(c => c.client_id === co.id) : null;
    if (!rows){ try { rows = await Cloud.api("tally_companies?select=company,client_id,gstin&client_id=eq." + encodeURIComponent(co.id)) || []; } catch (e){ rows = []; } }
    rows.forEach(c => add(c.company, c.gstin));
  }
  const o = Bridge.up() ? Bridge.openFor(co) : null;
  if (o) add(o.name, o.gstin);
  if (found.size !== 1) return false;
  const one = Array.from(found.values())[0];
  if (!one.gstins.has(mine) || one.gstins.size !== 1 || co.postTo) return false;
  choiceGuess(co, "postTo", one.name, "the one Tally company linked, same GSTIN " + mine);
  Store.saveCompany(co);
  toast(co.name + ": " + one.name + " is the one Tally company linked (same GSTIN " + mine + "). Confirm it on the Tally page (its row: Post entries here) before posting.");
  render();
  return true;
}
// ---------- the company a client posts to, from its Tally link (owner decision, 26-Oct-2026: "yes", linking a client to
// its Tally company also allows posting to that same company). Staging, 26-Oct-2026: ITSEasy Solutions Pvt Ltd, linked
// on 24-Oct, had no confirmed company; its bank posting said "choose the Tally company" and the button only opened the
// Tally page, where the confirmation was in the row's ⋯ (Post entries here) and linking again confirmed nothing.
//   - Link (tallyLinkClient): the linked company is confirmed, by the person who linked, unless the client has another
//     company a person confirmed (kept; nothing new said);
//   - a client linked to exactly one company with none confirmed (linked before this): confirmed on opening the client
//     or on posting, "confirmed from the Tally link", by the signed-in person; a person's "Stop posting" stays;
//   - two or more linked: nothing picked; the gate asks which, one button each (postToOffer); posting still goes only
//     into the confirmed company (postToProblem), and it is changed on the Tally page as before.
// the companies linked to the client in FinCom's cloud, as last read (TLight, else the Tally page); null: not read yet
function postToLinked(co){
  if (!co) return null;
  const lp = typeof linkPostOf === "function" ? linkPostOf(co) : null;
  if (lp) return lp.linked;
  const st = (typeof TLight === "object" && TLight.st) || {}, pane = (typeof TCloud === "object" && TCloud.pane) || {};
  const rows = st.cos && st.cos.length ? st.cos : Array.isArray(pane.companies) ? pane.companies : st.loaded ? [] : null;
  if (!rows) return null;
  const out = new Map();
  rows.forEach(r => { if (r && r.company && String(r.client_id || "") === String(co.id)){ const k = ledNm(r.company).toLowerCase(); if (!out.has(k)) out.set(k, ledNm(r.company)); } });
  return Array.from(out.values());
}
function postToMayWrite(){ const me = S.account && S.account.me; return !me || !me.role || ["owner", "staff"].includes(me.role); }
const PostToLink = {at: {}};
// fills the slot from the one linked company; returns the company confirmed now, or ""
async function postToFromLink(co){
  if (!co || co.deleted || typeof TCloud !== "object" || !TCloud.on()) return "";
  // next-link-record: the record decides (read first when it is not yet); clients.data postTo is only written from it
  if (typeof LinkRec === "object" && LinkRec.on()){
    if (!LinkRec.ready()) await LinkRec.load();
    const lp = linkPostOf(co);
    // (not linked at all: nothing to post into, and nothing written)
    if (lp){ if (!lp.linked.length || (typeof ZohoB === "object" && ZohoB.isZoho && ZohoB.isZoho(co))) return ""; return postToMirror(co, lp.pick ? LinkRec.nameOf(lp.pick) : ""); }
  }
  if (!postToMayWrite()) return "";
  const done = () => { const c = choiceGet(co, "postTo"); return !!(c && c.state === "confirmed"); };
  if (done()) return "";
  if (typeof ZohoB === "object" && ZohoB.isZoho && ZohoB.isZoho(co)) return "";
  let cos = postToLinked(co);
  if (!cos || !cos.length){
    if (Date.now() - (PostToLink.at[co.id] || 0) < 30000) return "";
    PostToLink.at[co.id] = Date.now();
    try { cos = Array.from(new Set(((await Cloud.api("tally_companies?select=company,client_id&client_id=eq." + encodeURIComponent(co.id))) || []).filter(r => r && r.company && String(r.client_id || "") === String(co.id)).map(r => ledNm(r.company)))); }
    catch (e){ return ""; }
  }
  if (!cos || cos.length !== 1 || done() || co.deleted) return "";
  choiceConfirm(co, "postTo", cos[0], {why: "confirmed from the Tally link"});
  postToCleared(co);
  render();
  // the cloud checks a posting against the client's saved copy (tally_post_enqueue): sent before the posting goes
  try {
    if (typeof cloudPushNow === "function" && Cloud.on()){
      for (let i = 0; i < 20 && typeof cloudBusy !== "undefined" && cloudBusy; i++) await new Promise(r => setTimeout(r, 250));
      await cloudPushNow();
    }
  } catch (e){}
  return cos[0];
}
// the old field (clients.data postTo, its choice) written from the record, for the code paths that still read it: the
// company posted into, or "" when posting is stopped or not linked. Only by a member who may write; returns the company
async function postToMirror(co, want){
  const c = choiceGet(co, "postTo"), same = c && c.state === "confirmed" && ledNm(c.value || "").toLowerCase() === ledNm(want || "").toLowerCase();
  if (same || !postToMayWrite()) return want;
  choiceConfirm(co, "postTo", want, {why: want ? "from the Tally link record" : "posting stopped in the Tally link record"});
  postToCleared(co);
  render();
  try {
    if (typeof cloudPushNow === "function" && Cloud.on()){
      for (let i = 0; i < 20 && typeof cloudBusy !== "undefined" && cloudBusy; i++) await new Promise(r => setTimeout(r, 250));
      await cloudPushNow();
    }
  } catch (e){}
  return want;
}
// a person's Link: the company linked now, unless another one is confirmed (a confirmed "Stop posting" gives way to it).
// With the record: the link allowed posting in the cloud (tally_link_set); the old field follows once it is read again
function postToOnLink(co, company){
  if (typeof LinkRec === "object" && LinkRec.ready()){ LinkRec.load(true).then(() => postToFromLink(co)).catch(() => {}); return true; }
  if (!co || !company || !postToMayWrite()) return false;
  const c = choiceGet(co, "postTo");
  if (c && c.state === "confirmed" && c.value) return false;
  choiceConfirm(co, "postTo", ledNm(company), {why: "confirmed when linked to Tally"});
  postToCleared(co);
  return true;
}
// a refusal said for this client (Post to Tally, the bank statement's report) goes once a company is confirmed
function postToCleared(co){
  if (S.postStop && S.postStop.cid === co.id) S.postStop = null;
  if (S.bank && S.bank.cid === co.id && S.bank.postReport && S.bank.postReport.notAllowed) S.bank.postReport = null;
  if (S.coId === co.id && S.billPost && S.billPost.notAllowed) delete S.billPost.notAllowed;
}
// what the gate offers for a client without a confirmed company: the companies linked to it, each one click
// ({ask, companies}; companies empty: not linked, the Tally page links it)
function postToOffer(co){
  const cos = postToLinked(co) || [];
  if (!co || !cos.length || !postToMayWrite()) return {ask: "", companies: []};
  return {ask: cos.length === 1 ? "Allow posting to " + cos[0] + "?" : "Post to which Tally company?", companies: cos};
}
function postToAllow(co, company){
  if (!co || !company) return;
  const rec = typeof LinkRec === "object" && LinkRec.ready() ? LinkRec.forClient(co.id).find(r => LinkRec.isName(r, company)) : null;
  if (rec){ linkPostingSet(co, rec, true); return; }
  choiceConfirm(co, "postTo", company, {why: "allowed from the posting"});
  postToCleared(co);
  toast("Posting allowed into " + company + ".");
  render();
}
// the client open when this file loads (the screen that loaded it): filled now; later openings by src/js/27
setTimeout(() => { try { const co = typeof CO === "function" ? CO() : null; if (co) postToFromLink(co).catch(() => {}); } catch (e){} }, 0);
if (typeof globalThis === "object") Object.assign(globalThis, {postLineFor, PostPage, postStatusFor, AutoPostTo, autoPostTo, postToLinked, postToMayWrite, PostToLink, postToFromLink, postToMirror, postToOnLink, postToCleared, postToOffer, postToAllow});
/* @react-lazy: end */
