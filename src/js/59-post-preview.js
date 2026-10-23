/* ================================================================== */
/* Posting to Tally: what goes, seen first (review of 02-Oct-2026)     */
/* ================================================================== */
// With FinCom Bridge 2.1.1 on NWS144, jobs 0f9f0156 and c14b40fc sent "create master" for INPUT CGST and INPUT IGST,
// which GARG SHEKHAR & COMPANY already had (Tally answered ALTERED 1), and three postings went straight to the bridge
// without a trace in FinCom's cloud. Now:
//  - a ledger Tally already has (same name, ledNm, any case) is never sent as a master; one that must be created is
//    named first ("This will create ledger X under group Y in <company>") and nothing goes until that is confirmed;
//  - every voucher can be seen before it goes, as Tally will get it (date, type, each ledger Dr / Cr, narration), with a
//    warning for a new ledger, an income ledger on a purchase, and a party whose GSTIN is not the bill's;
//  - Tally's ALTERED is said as "Altered in Tally", never "created";
//  - a posting made straight to a bridge is recorded in FinCom's cloud afterwards (tally_post_record, migration-27).

// Tally's own text out of the XML being sent
function pvText(s){ return String(s == null ? "" : s).replace(/&#13;|&#10;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim(); }
// one voucher, read from the XML that goes to Tally: {type, date (yyyy-mm-dd), number, ref, party, narration, optional,
// lines: [{ledger, dr, amount}], dr, cr}
function voucherPreview(xml){
  const x = String(xml || "");
  const one = re => { const m = x.match(re); return m ? pvText(m[1]) : ""; };
  const head = x.split(/<(?:ALL)?LEDGERENTRIES\.LIST>/)[0];
  const h = re => { const m = head.match(re); return m ? pvText(m[1]) : ""; };
  const d8 = h(/<DATE>(\d{8})<\/DATE>/);
  const out = {type: (head.match(/<VOUCHER\b[^>]*\bVCHTYPE="([^"]*)"/) || [])[1] ? pvText(head.match(/<VOUCHER\b[^>]*\bVCHTYPE="([^"]*)"/)[1]) : h(/<VOUCHERTYPENAME>([\s\S]*?)<\/VOUCHERTYPENAME>/),
    date: d8 ? d8.slice(0, 4) + "-" + d8.slice(4, 6) + "-" + d8.slice(6, 8) : "", number: h(/<VOUCHERNUMBER>([\s\S]*?)<\/VOUCHERNUMBER>/), ref: h(/<REFERENCE>([\s\S]*?)<\/REFERENCE>/),
    party: h(/<PARTYLEDGERNAME>([\s\S]*?)<\/PARTYLEDGERNAME>/), narration: one(/<NARRATION>([\s\S]*?)<\/NARRATION>/), optional: /<ISOPTIONAL>\s*Yes/i.test(head), lines: [], dr: 0, cr: 0};
  const re = /<(ALLLEDGERENTRIES|LEDGERENTRIES)\.LIST>([\s\S]*?)<\/\1\.LIST>/g;
  let m;
  while ((m = re.exec(x))){
    // the line's own fields, without the lists inside it (bill and bank allocations carry amounts of their own)
    const own = m[2].replace(/<([A-Z0-9.]+\.LIST)>[\s\S]*?<\/\1>/g, "");
    const ledger = pvText((own.match(/<LEDGERNAME>([\s\S]*?)<\/LEDGERNAME>/) || [])[1]);
    const a = parseFloat(String((own.match(/<AMOUNT>\s*([-0-9.,]+)\s*<\/AMOUNT>/) || [])[1] || "0").replace(/,/g, "")) || 0;
    const dp = (own.match(/<ISDEEMEDPOSITIVE>\s*(Yes|No)/i) || [])[1];
    const dr = a < 0 || (a === 0 && /yes/i.test(dp || ""));
    out.lines.push({ledger, dr, amount: Math.abs(a)});
    if (dr) out.dr += Math.abs(a); else out.cr += Math.abs(a);
  }
  out.dr = r2(out.dr); out.cr = r2(out.cr);
  return out;
}
// a ledger master in the posting: {name, group, gstin}; null for anything else (a voucher type's numbering)
function masterPreview(xml){
  const x = String(xml || ""), m = x.match(/^\s*<LEDGER\b[^>]*\bNAME="([^"]*)"/);
  if (!m) return null;
  return {name: ledNm(pvText(m[1])), group: pvText((x.match(/<PARENT>([\s\S]*?)<\/PARENT>/) || [])[1]), gstin: pvText((x.match(/<PARTYGSTIN>([\s\S]*?)<\/PARTYGSTIN>/) || [])[1])};
}
// the client's ledger list is the one held here (Tally's, read live or from FinCom's cloud)
// (the one list of 58-ledgers.js when it is there: exactLedger reads the open client's list)
function pvListFor(cid){
  const here = typeof Ledgers === "object" && Ledgers.cid ? Ledgers.cid() : (S.bank && S.bank.cid);
  return !!(typeof hasLedgerList === "function" && (!cid || here === cid) && hasLedgerList());
}
// a ledger Tally has: the same name (ledNm, any case); a ledger made here and still waiting for Tally does not count
function ledgerInTally(name, cid){
  const n = ledNm(name);
  if (!n || !pvListFor(cid) || typeof exactLedger !== "function") return null;
  let hit = null;
  try { hit = exactLedger(n); } catch (e){ return null; }
  if (!hit || ledNm(hit).toLowerCase() !== n.toLowerCase()) return null;
  const info = typeof ledgerInfo === "function" ? ledgerInfo(hit) : null;
  return info && info.pending ? null : (info || {name: hit});
}
// Tally has a ledger spelt a little differently (the list matches "Input C.G.S.T" to "INPUT CGST")
function ledgerLike(name, cid){
  if (!pvListFor(cid) || typeof exactLedger !== "function") return "";
  let hit = null; try { hit = exactLedger(ledNm(name)); } catch (e){}
  const info = hit && typeof ledgerInfo === "function" ? ledgerInfo(hit) : null;
  return hit && !(info && info.pending) && ledNm(hit).toLowerCase() !== ledNm(name).toLowerCase() ? hit : "";
}
const INCOME_GROUPS = /^(sales accounts|direct incomes?|indirect incomes?)$/i;
function incomeLedger(name, cid){
  const info = ledgerInTally(name, cid) || (typeof ledgerInfo === "function" && pvListFor(cid) ? ledgerInfo(name) : null);
  const g = String((info && (info.group || info.parent)) || "");
  if (INCOME_GROUPS.test(g)) return g;
  try { if (typeof FC === "object" && S.books && S.books.cid === cid){ const top = ["Sales Accounts", "Direct Incomes", "Indirect Incomes"].find(x => FC.inGroup(ledNm(name), x)); if (top) return top; } } catch (e){}
  return "";
}

// Tally's answer for one entry, said one way everywhere (B12): "In Tally (verified)", "In Tally, not yet read back",
// "Altered in Tally", "Failed: reason"
function postAltered(x){
  if (!x || !x.ok) return false;
  if (num(x.altered) > 0 && !(num(x.created) > 0)) return true;
  const m = String(x.message || "");
  return /\bALTERED\b/i.test(m) && !/\bCREATED\b\s*[:=]?\s*[1-9]/i.test(m);
}
// FinCom Bridge 2.1.4 checks Tally for the same party, bill no., date and amount at the moment of every posting (first
// post, Retry, Post again) and answers per voucher: {ok: false, already: true, guid, vchNo, message: "Already in Tally
// (voucher no. X, dd-mm-yyyy)"}: the entry is in Tally, not failed; or {ok: false, checkFailed: true, message: "Could not
// check Tally, not posted. Try again."}: nothing was posted, the entry stays waiting. Read from the message too, for a
// cloud that does not pass the two flags on yet (tally-ingest before 02-Oct-2026)
// A posting the bridge found its own earlier one of in Tally (FinCom's tag; a resumed or queued job) answers ok with
// alreadyThere: in Tally too. "Waiting for Tally: Tally is busy …" before the check could run: nothing was posted either
// round 17a (owner, 04-Oct-2026): one rule for "Tally has it" in every path. FinCom Bridge 2.1.8 posts by Tally's reply
// and never reads back: {ok: true, byReply: true, verified: false, vchId | batchEnd + batchN}. Such a result is posted
// (not "In Tally, not yet read back"), as a result read back (verified) or one Tally altered
function postTaken(x){ return !!x && x.ok === true && (x.verified === true || x.byReply === true || postAltered(x)); }
function postAlready(x){ return !!x && (x.already === true || (x.ok === true && x.alreadyThere === true) || (!x.ok && /^Already in Tally \(voucher no\./i.test(String(x.message || "")))); }
function postCheckFail(x){ return !!x && !x.ok && !postAlready(x) && (x.checkFailed === true || /^(Could not check Tally|Waiting for Tally)\b/i.test(String(x.message || ""))); }
function postWord(x){
  if (!x) return "Failed: Tally did not answer for this entry";
  if (postAlready(x)) return plainMsg(x.message) || "Already in Tally (not sent again)";
  if (postCheckFail(x)) return plainMsg(x.message) || "Could not check Tally, not posted. Try again.";
  if (!x.ok) return "Failed: " + (plainMsg(x.message) || "Tally did not confirm it");
  if (x.existed) return "Already in Tally (not sent again)";
  if (postAltered(x)) return "Altered in Tally";
  if (x.verified === true) return "In Tally (verified)";
  if (x.byReply === true) return "Posted to Tally (Tally's reply)";
  return "In Tally, not yet read back";
}

const PostGate = {
  ok: null,                 // the new ledgers confirmed in the preview: {names: Set, company, until}
  approve(names, company){ this.ok = {names: new Set(names.map(n => ledNm(n).toLowerCase())), company: ledNm(company).toLowerCase(), until: Date.now() + 15 * 60000}; },
  approved(names, company){
    const a = this.ok;
    return !!a && Date.now() < a.until && (!company || !a.company || a.company === ledNm(company).toLowerCase()) && names.every(n => a.names.has(ledNm(n).toLowerCase()));
  },
  createLine(m, company){ return "This will create ledger <b>" + esc(m.name) + "</b> under group <b>" + esc(m.group || "(no group)") + "</b> in <b>" + esc(company) + "</b>."; },
  // the masters of a posting: those Tally has are dropped (answered here); new ones asked about first.
  // {masters, results, cancelled}
  async masters(payload, co){
    const keep = [], results = [], create = [];
    [].concat(payload.masters || []).forEach(m => {
      const info = masterPreview(m.xml);
      if (!info){ keep.push(m); return; }
      const has = ledgerInTally(info.name, co && co.id);
      if (has){ results.push({id: m.id, ok: true, kind: "master", existed: true, name: info.name, message: "Already in Tally (" + (has.name || info.name) + "): not sent"}); return; }
      keep.push(m); create.push(Object.assign({id: m.id, like: ledgerLike(info.name, co && co.id)}, info));
    });
    if (create.length && !this.approved(create.map(m => m.name), payload.company)){
      const a = await askConfirm({title: "Create " + (create.length === 1 ? "a new ledger" : create.length + " new ledgers") + " in " + payload.company + "?", ok: "Create and post", wide: true,
        body: '<div data-create-masters="">' + create.map(m => "<p style=\"margin:0 0 6px\">" + this.createLine(m, payload.company) + (m.like ? ' <span class="tag warn">Tally has “' + esc(m.like) + "”</span>" : "") + "</p>").join("") +
          '<p class="note" style="margin:10px 0 0">Nothing is sent to Tally until you confirm. Cancel, and choose the Tally ledger instead if it already exists under another name.</p></div>'});
      if (!a) return {cancelled: true, masters: keep, results};
    }
    return {masters: keep, results, created: create};
  },
  // ---------- the preview: each voucher as it goes to Tally, with what to look at
  warnings(it, co){
    const w = [], v = it.v, cid = co && co.id, listed = pvListFor(cid);
    if (!listed) w.push("Tally’s ledger list is not loaded here, so the ledgers were not checked.");
    else v.lines.forEach(l => {
      if (ledgerInTally(l.ledger, cid)) return;
      const pend = ((S.bank && S.bank.cid === cid && S.bank.newLed) || []).find(n => ledNm(n.name).toLowerCase() === ledNm(l.ledger).toLowerCase() && !n.sent);
      w.push("New ledger: " + l.ledger + (pend ? " will be created under " + (pend.group || "(no group)") : " is not in Tally’s ledger list") + ".");
    });
    if (it.kind === "bill"){
      v.lines.forEach(l => { const g = incomeLedger(l.ledger, cid); if (g) w.push("Income ledger on a purchase: " + l.ledger + " is under " + g + "."); });
      const e = it.e, info = e && listed ? (ledgerInTally(e.partyLedger, cid) || {}) : {};
      const a = gstinKeyOf(e && e.x.vendorGstin), b = gstinKeyOf(info.gstin);
      if (a && b && a !== b) w.push("Party not matched by GSTIN: the bill is from " + a + ", but the ledger " + (info.name || e.partyLedger) + " has " + b + ".");
    }
    if (it.kind === "sale" && it.e && listed){
      const info = ledgerInTally(it.e.customerLedger, cid) || {}, a = gstinKeyOf(it.e.x.customerGstin), b = gstinKeyOf(info.gstin);
      if (a && b && a !== b) w.push("Party not matched by GSTIN: the invoice is to " + a + ", but the ledger " + (info.name || it.e.customerLedger) + " has " + b + ".");
    }
    if (v.dr !== v.cr) w.push("Debits " + INR.format(v.dr) + " and credits " + INR.format(v.cr) + " do not agree.");
    return w;
  },
  html(items, co, masters, company){
    const amt = n => n ? INR.format(n) : "";
    const ms = (masters || []).length ? '<div class="bk-alert" data-pv-masters="" style="margin:0 0 10px">' + masters.map(m => "<div>" + this.createLine(m, company) + "</div>").join("") + "</div>" : "";
    return ms + items.map(it => {
      const v = it.v = it.v || voucherPreview(it.xml), w = this.warnings(it, co);
      return '<div class="pv" data-pv="' + esc(it.id) + '" data-pv-kind="' + it.kind + '" style="border:1px solid var(--line,#ddd);border-radius:8px;padding:8px 10px;margin:0 0 10px">' +
        "<div><b>" + esc(fmtDate(v.date) || "no date") + " · " + esc(v.type || "?") + (v.number ? " no. " + esc(v.number) : "") + "</b>" + (v.ref ? " · ref " + esc(v.ref) : "") + (v.optional ? ' <span class="tag">Optional</span>' : "") + "</div>" +
        '<div class="tblwrap"><table class="data" style="margin:6px 0"><thead><tr><th>Ledger</th><th class="n">Dr</th><th class="n">Cr</th></tr></thead><tbody>' +
        v.lines.map(l => '<tr data-pv-line=""><td>' + esc(l.ledger) + '</td><td class="n">' + (l.dr ? amt(l.amount) : "") + '</td><td class="n">' + (l.dr ? "" : amt(l.amount)) + "</td></tr>").join("") +
        '<tr><td><b>Total</b></td><td class="n"><b>' + amt(v.dr) + '</b></td><td class="n"><b>' + amt(v.cr) + "</b></td></tr></tbody></table></div>" +
        '<div class="note" data-pv-narr="">' + esc(v.narration) + "</div>" +
        (w.length ? '<ul class="pv-warn" data-pv-warn="" style="margin:6px 0 0 18px;padding:0;color:var(--bad,#b42318)">' + w.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") + "</div>";
    }).join("");
  }
};
function gstinKeyOf(g){ const k = String(g || "").toUpperCase().replace(/[^0-9A-Z]/g, ""); return /^\d{2}[A-Z0-9]{13}$/.test(k) ? k : ""; }

// A posting made straight to a bridge (no cloud for this client): recorded in FinCom's cloud afterwards, finished, so
// "Postings in FinCom's cloud" lists every posting (migration-27; an older cloud without it: nothing recorded, no error)
const PostRecord = {
  missing: false,
  clean(r){ const o = {}; ["id", "ok", "kind", "message", "verified", "vchNumber", "vchType", "guid", "masterId", "vchDate", "optional", "altered", "created", "existed", "pendingCheck", "already", "checkFailed", "vchNo",
    // bridge 2.1.8 (round 15): Tally's reply counted it, its exact voucher id or the batch's last id, and what needs review
    "byReply", "vchId", "batchEnd", "batchN", "company", "sentAt", "secondsReq", "needsReview", "accepted", "exceptions", "ignored", "errors", "lineError", "lastVchId"].forEach(k => { if (r[k] !== undefined) o[k] = r[k]; }); if (o.message) o.message = String(o.message).slice(0, 400); return o; },
  async save(co, payload, out){
    if (this.missing || !co || !out || typeof TCloud !== "object" || !TCloud.on()) return false;
    const uuidOk = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
    const id = out.recId || (out.job && uuidOk(out.job.id) ? out.job.id : CloudPost.uuid());
    out.recId = id;
    const vids = [].concat(payload.vouchers || []).map(v => v.id), res = [].concat(out.results || []).map(r => this.clean(r));
    const vres = res.filter(r => vids.includes(r.id)), okN = vres.filter(r => r.ok || postAlready(r)).length, unread = vres.filter(r => r.ok && !postTaken(r)).length;
    const status = vres.length && okN === vids.length ? "done" : (!vids.length && res.every(r => r.ok) ? "done" : "failed");
    const how = "sent straight to FinCom Bridge" + (Bridge.st.version ? " " + Bridge.st.version : "") + (Bridge.st.computer ? " on " + Bridge.st.computer : " on this computer");
    const message = (vids.length ? okN + " of " + vids.length + " in Tally" + (unread ? " (" + unread + " not yet read back)" : "") : res.length + " ledger" + (res.length === 1 ? "" : "s")) + ", " + how;
    try {
      const r = await TCloud.rpc("tally_post_record", {p_id: id, p_client: co.id, p_company: out.company || payload.company || "", p_status: status, p_results: res, p_entry_ids: vids, p_message: message});
      if (r && r.ok === false) return false;
      if (typeof CloudJobs === "object") CloudJobs.load(true);
      return true;
    } catch (e){
      if (/tally_post_record|does not exist|schema cache|PGRST202|404/i.test(String((e && e.message) || e))) this.missing = true;
      return false;
    }
  }
};

// One count of what is for Tally, from one place (review of 02-Oct-2026, Testing AAD at 17:43: the tab said "Post to
// Tally 1", the header chip "1 entry for Tally", the button "Post 0 to Tally"). The tab, the chip and the dashboard
// counted the bills approved and not confirmed in Tally, the button only those never sent; FA/ELEC/013 (posted on
// 29-Sep, then not found in the cloud copy) was in the first count and not in the second. Now each approved bill is in
// exactly one place (postBucket) and every number comes from postCounts:
//   ready      approved, never sent, nothing in its way: "Ready to post", the tab badge, the header chip, the
//              dashboard tile and "Post N to Tally";
//   attention  sent and not confirmed in Tally, not found in Tally, posted and not read back, Tally could not be checked
//              when it was posted (bridge 2.1.4), or a ledger Tally does not have: "Needs your attention", and the
//              tab's second badge (with the failed postings of FinCom's cloud);
//   sending    on its way to Tally now; intally: confirmed there. Neither is counted.
//   unknown    sent when Tally stopped answering, being looked for by its FinCom id (bridge 2.1.4, item state "unknown"):
//              "Checking whether it reached Tally" under Errors; counted with attention, never posted again from here;
//   refused    Tally refused it in the newest posting of FinCom's cloud that has it (made after the bill was approved,
//              not dismissed by a person): under Errors with Tally's words; counted with attention, except when it is
//              shown inside a failed posting that needs a decision (that posting is counted instead);
//   posted     put in Tally by the newest posting of the cloud that has it (also before this browser marked the bill):
//              under Posted, not counted.
// The three tabs of the page (plan piped-moseying-frost, item 1b): To post = ready (+ sending shown as on its way),
// Posted = the cloud's history, Errors = attention + unknown + refused + the failed postings.
// id -> {st: sending | unknown | refused | posted | "", job, reason}: the newest posting of the cloud naming the entry
function postJobStates(cid){
  const out = new Map();
  if (typeof CloudJobs !== "object") return out;
  const jobs = CloudJobs.forClient(cid).slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  jobs.forEach(j => {
    const items = [].concat(j.items || []).filter(Boolean), results = [].concat(j.results || []).filter(Boolean);
    const ids = CloudJobs.idsOf(j) || [...new Set(items.map(x => String(x.id)).concat(results.map(x => String(x.id))))];
    const live = CloudJobs.live(j), byPerson = !!(j.dismissed_at && !j.dismiss_auto);
    ids.forEach(id => {
      id = String(id);
      if (out.has(id)) return;
      const it = items.find(x => String(x.id) === id), r = results.find(x => String(x.id) === id);
      let st = "", reason = "";
      if ((r && (r.ok || postAlready(r))) || (it && (it.state === "in_tally" || it.state === "posted"))) st = "posted";
      // round 15 (B2): Tally accepted the request but its reply needs a look (bridge 2.1.8: ok false, needsReview true;
      // item state needs_review): under Errors with Tally's words, settled by an owner, never sent again while accepted
      else if ((r && postNeedsReview(r)) || (it && it.state === "needs_review")) { st = "review"; reason = plainMsg(r && r.message) || (it && it.reason) || "Tally\u2019s reply needs a look"; }
      else if ((it && it.state === "unknown") || (r && r.outcomeUnknown)) { st = "unknown"; reason = (it && it.reason) || "Checking whether it reached Tally"; }
      else if (live && (!it || ["waiting", "sending", "sent"].includes(it.state))) st = "sending";
      else if (byPerson || j.status === "cancelled") st = "";
      else if ((it && it.state === "failed") || (r && !r.ok) || j.status === "failed") { st = "refused"; reason = (it && it.reason) || plainMsg(r && r.message) || plainMsg(j.message) || "Tally did not take it"; }
      // bridge 2.1.8: a record refusal (alreadySent: the bridge's own record says it went from that computer) is not Tally's word
      out.set(id, {st, job: j, reason, alreadySent: !!(r && r.alreadySent)});
    });
  });
  return out;
}
function postSending(cid){
  const out = new Set();
  postJobStates(cid).forEach((v, id) => { if (v.st === "sending") out.add(id); });
  return out;
}
// the ledgers of a bill Tally does not have (only for the client open here, with Tally's ledger list at hand)
function postLedgerList(cid){ return !!(cid === S.coId && S.bank && S.bank.cid === cid && !S.bank.loading && typeof hasLedgerList === "function" && hasLedgerList()); }
function postMissingLedgers(e){ return (e.snapshot ? e.snapshot.lines : []).filter(l => l.ledger && !exactLedger(l.ledger)); }
function postBucket(e, ctx){
  if (!e || e.status !== "approved") return "";
  if (billInTally(e)) return "intally";
  if (e.exportedAt) return "attention";
  if (e.postUnconfirmed) return e.postUnconfirmed.pending ? "sending" : "attention";
  if (e.postCheckFailed) return "attention";
  const js = ctx && ctx.jobs ? ctx.jobs.get(String(e.id)) : null;
  // put in by the cloud's posting and not yet marked here (a bill once marked posted here and taken back out of Tally
  // keeps postedVia, and is waiting again)
  if (js && js.st === "posted" && !e.postedVia) return "intally";
  if (js && js.st === "unknown") return "unknown";
  if (js && js.st === "review") return "review";
  if ((js && js.st === "sending") || (ctx && ctx.sending && ctx.sending.has(e.id))) return "sending";
  // refused in a posting made after this approval (a bill sent back to review and approved again starts afresh)
  if (js && js.st === "refused" && String(js.job.created_at || "") >= String(e.approvedAt || "")) return "refused";
  if (ctx && ctx.ledgers && postMissingLedgers(e).length) return "attention";
  return "ready";
}
// {ready, attention, sending, unknown, refused: [bills], jobs: [failed postings of the cloud needing a decision],
// why: id -> {job, reason} for the unknown and refused ones}, or null when the client's bills are not loaded here
function postBills(cid){
  const d = S.data[cid];
  if (!d || !d.loaded) return null;
  const jobs = postJobStates(cid);
  const ctx = {jobs, ledgers: postLedgerList(cid)}, out = {ready: [], attention: [], sending: [], unknown: [], refused: [], review: [], jobs: [], why: {}};
  Object.values(d.entries).forEach(e => { const b = postBucket(e, ctx); if (out[b]){ out[b].push(e); if (b === "unknown" || b === "refused" || b === "review") out.why[e.id] = jobs.get(String(e.id)); } });
  ["ready", "attention", "sending", "unknown", "refused", "review"].forEach(k => out[k].sort(byDate));
  out.jobs = typeof CloudJobs === "object" ? CloudJobs.needing(cid) : [];
  return out;
}
// a refused bill inside a failed posting that needs a decision is shown (and counted) with that posting
function postRefusedAlone(b){ const need = new Set(b.jobs.map(j => j.id)); return b.refused.filter(e => !(b.why[e.id] && need.has(b.why[e.id].job.id))); }
// the counts: from the bills when they are here, else from the client's stats (kept by refreshStats with postBucket)
function postCounts(cid){
  const b = postBills(cid);
  // the owner's spec of 04-Oct (src/js/62): Errors counts the entries in statuses 6 to 9, one each, less the rows this
  // person hid and the rows removed from the list (postTabRows)
  if (b && typeof postTabRows === "function") return {ready: b.ready.length, attention: postTabRows(cid, "errors").shown.length};
  if (b) return {ready: b.ready.length, attention: b.attention.length + b.jobs.length + b.unknown.length + (b.review || []).length + postRefusedAlone(b).length};
  const st = (S.companies[cid] || {}).stats || {};
  return {ready: num(st.ready != null ? st.ready : st.waiting), attention: num(st.attention)};
}
function postCountFor(cid){ return postCounts(cid).ready; }
function postAttentionFor(cid){ return postCounts(cid).attention; }
// the bills ready to post (the dashboard's tile)
function postBillsOpen(cid){ const b = postBills(cid); return b ? b.ready : null; }
// the postings of the cloud under Posted: the history, less a finished posting that put nothing in (its entries are
// under Errors, refused); the entries each one put in Tally
function postPostedRows(cid){
  if (typeof CloudJobs !== "object") return [];
  return CloudJobs.history(cid).filter(x => !(x.state === "partly" && !x.ok));
}
// round 11 (owner item 6): the entries a finished posting put in Tally, as the Posted tab lists them under it, each with
// where its FinCom id stands in tally_post_ids: held (the cloud still holds it live: an owner may release it, the entry
// having been deleted in Tally by hand since it was verified), released (freed: Post again is back), none (the cloud
// holds no row for it: an older posting), or null (not known). e is the local entry, or a stub naming the id, enough
// for PostOwner.release (id, invoice no.)
function postPostedEntries(cid, j){
  if (typeof CloudJobs !== "object") return [];
  const d = S.data[cid], s = typeof PostIds === "object" ? PostIds.by[cid] : null;
  return [...CloudJobs.okIn(j)].map(id => {
    const e = (d && d.entries && d.entries[id]) || {id, x: {}};
    const rel = postIdReleased(id, cid);
    const idState = rel === null ? null : rel === false ? "held" : s && s.held && s.held.has(String(id)) ? "released" : "none";
    return {id, e, no: (e.x && e.x.invoiceNo) || id, idState};
  });
}
// the three tab counts: To post and Errors are postCounts (the step bar's badges, the chip, the dashboard), Posted the
// postings listed under it
function postTabCounts(cid){ const c = postCounts(cid); return {topost: c.ready, posted: typeof postTabRows === "function" && S.data[cid] && S.data[cid].loaded ? postTabRows(cid, "posted").shown.length : postPostedRows(cid).length, errors: c.attention + (postRefusedFor(cid) ? 1 : 0)}; }
// a bill's ledgers on one line, the party first; a Round Off of nothing is left out
function postLedgerLine(e){
  const ls = (e.snapshot ? e.snapshot.lines : []).filter(l => l.ledger && !((l.role === "roundoff" || /^round\s*(ed\s*)?off\b/i.test(l.ledger)) && Math.abs(num(l.amt)) < 0.005));
  const order = {party: 0, expense: 1, gst: 2, "rcm-in": 2, "rcm-out": 2, tds: 3, roundoff: 4};
  return [...new Set(ls.slice().sort((a, b) => (order[a.role] ?? 1) - (order[b.role] ?? 1)).map(l => l.ledger))].join(" · ");
}

// ---------- the Post to Tally page: one line, one table, one button (C15-C18)
// what this client's entries go into, and through what: {company, bridge, state, action, go}
function postLineFor(co){
  const cloud = typeof TCloud === "object" && TCloud.on();
  if (cloud && !TCloud.pane.at && !TCloud.pane.busy && Date.now() - (PostPage.paneAt || 0) > 5 * 60000){ PostPage.paneAt = Date.now(); setTimeout(() => { try { TCloud.refreshPane(); } catch (e){} }, 0); }
  let bk = null; try { bk = cloud ? TCloud.book(co.id) : null; } catch (e){}
  let company = co.postTo || (bk && bk.company) || "";
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
  if (!co.postTo){ state = ""; action = "Choose the Tally company"; go = "cotally"; }
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
  if (l && l.state === "open"){ out.where = l.text.replace(/ · last read .*$/, ""); out.read = l.read; out.reading = !!l.reading; }
  else if (!l && (pl.tally === "open" || pl.tally === "busy") && pl.computer) out.where = "Connected \u00b7 Tally open on " + pl.computer;   // 2.3.5: the cards' words
  const p = (text, button, go, kind) => ({text, button: button || "", go: go || null, kind: kind || ""});
  let st = S.postStop && S.postStop.cid === co.id ? S.postStop : null;
  // a stop that no longer holds goes by itself: the company confirmed since, or no bill waits on a guessed ledger now
  if (st && /^Confirm the Tally company/.test(st.msg) && typeof choiceState === "function" && choiceState(co, "postTo") === "confirmed"){ S.postStop = null; st = null; }
  if (st && /^Posting waits/.test(st.msg)){ const b0 = postBills(co.id); if (b0 && !b0.ready.some(e => billGuessedWhy(e, co))){ S.postStop = null; st = null; } }
  if (st){
    const guess = /^Confirm the Tally company/.test(st.msg), led = /^Posting waits/.test(st.msg);
    out.problem = p("Not sent to Tally: " + (guess ? "confirm the Tally company. " : led ? "a ledger is not confirmed. " : "choose the Tally company. ") + (guess || led ? st.msg + " " : "") + "The bills are still waiting here.",
      guess ? "Confirm the Tally company" : led ? "Open Client setup" : "Choose the Tally company", guess || !led ? goChooseTallyCompany : () => goSetupFor(st.msg), "stop");
    // the cloud's own words of what is allowed (Post.jsx puts them in: notAllowedRest)
    if (!guess && !led) out.problem.msg = st.msg;
    out.problem.dismiss = () => { S.postStop = null; render(); };
    return out;
  }
  if (pl.go === "cotally") { out.problem = p(pl.action === "Confirm the Tally company" ? "Posting waits: confirm the Tally company (" + pl.company + " was found by FinCom, not chosen by a person)." : "Posting waits: choose the Tally company this client posts to.", pl.action, goChooseTallyCompany, "company"); return out; }
  if (l && l.state !== "open"){
    const T = {offline: [l.text + ": start that computer, or FinCom Bridge on it. Nothing can be posted or checked until then.", "", null],
      closed: [l.text + ": open TallyPrime there, with " + pl.company + ".", "", null],
      notanswering: [l.text + ": close any message box in Tally there; FinCom carries on by itself.", "", null],
      paused: [l.text + ": resume it from the FinCom Bridge icon there. Update now still reads.", "Update now", () => tallyUpdateNow(co.id)],
      stopped: [l.text + ". This is FinCom\u2019s Stop, set by an owner of the firm: an owner resumes it on the Tally page; posting goes on, Update now does not read until then.", "", null]}[l.state] || [l.text, "", null];
    out.problem = p(T[0], T[1], T[2], l.state); return out;
  }
  if (!pl.state && pl.action){ out.problem = p(pl.action + ".", pl.go === "tally" ? "Open the Tally page" : "", pl.go === "tally" ? goTallyPage : null, "bridge"); return out; }
  const b = postBills(co.id), why = b && typeof billGuessedWhy === "function" ? b.ready.map(e => billGuessedWhy(e, co)).find(Boolean) : "";
  if (why) out.problem = p(why + " Confirm it in Client setup.", "Open Client setup", () => goSetupFor(why), "ledger");
  return out;
}
function goSetupFor(msg){ S.postStop = null; S.step = null; S.tab = /TDS/.test(msg) || /expense/.test(msg) ? "cotds" : "cotally"; render(); window.scrollTo(0, 0); }

// ---------- a bill sent and not confirmed in Tally, checked with a fresh read of Tally (review of 02-Oct-2026, item 3)
// FA/ELEC/013 (Fingate, 25,535.00, 01-Jul-2026) was offered to be posted again on the strength of a read of 15:34,
// made while bridge 2.1.1 was timing out: a duplicate in real books. Now, before such a bill is shown, Tally is read
// afresh for it: the bridge here asked directly when it has the company open; else the client's Tally computer asked to
// read now (Update now) and its new read waited for. "Not found in Tally at the 17:43 read" only after such a read,
// made after the posting; otherwise "Not checked yet" with why, and no Post again.
const PostCheck = {
  st: {},                  // entry id -> {busy, at, ok, found, vch, readAt, why, said}
  fresh: {},               // client id -> {at, res} (the Tally computer's fresh read, shared by the client's bills)
  reading: {},             // client id -> a promise while the Tally computer is asked to read
  WAIT: 150000, POLL: 4000, KEEP: 10 * 60000,
  sleep(ms){ return new Promise(r => setTimeout(r, ms)); },
  postedAt(e){ return Date.parse((e.tally && e.tally.at) || e.exportedAt || (e.postUnconfirmed && e.postUnconfirmed.at) || 0) || 0; },
  // the same bill in Tally's vouchers: FinCom's tag, else the bill no. and party, else the party, date and amount
  match(e, vs){
    const nm = x => norm(String(x || "")), party = nm(e.partyLedger || e.x.vendorName), d8 = isoToTally(e.x.invoiceDate), amt = r2(num(e.x.total));
    const partyLine = ((e.snapshot && e.snapshot.lines) || []).find(l => l.role === "party"), pAmt = partyLine ? r2(num(partyLine.amt)) : 0;
    const hasParty = v => nm(v.party) === party || [].concat(v.entries || []).some(en => nm(en.ledger) === party);
    const amounts = v => [].concat(v.entries || []).map(en => r2(Math.abs(num(en.amount))));
    return vs.find(v => String(v.narration || "").includes("TDSDesk:" + e.id))
      || vs.find(v => e.x.invoiceNo && nm(v.reference) === nm(e.x.invoiceNo) && hasParty(v))
      || vs.find(v => String(v.date || "") === d8 && hasParty(v) && amounts(v).some(a => Math.abs(a - amt) < 0.01 || (pAmt && Math.abs(a - pAmt) < 0.01)))
      || null;
  },
  vouchersUrl(co, tname, e){
    const vt = co.voucherType || "Journal";
    return "/vouchers?company=" + encodeURIComponent(tname) + "&from=" + isoToTally(addDays(e.x.invoiceDate, -5)) + "&to=" + isoToTally(addDays(e.x.invoiceDate, 5)) +
      "&types=" + encodeURIComponent([...new Set([vt, "Purchase", "Journal", co.debitNoteType || "Debit Note"])].join(",")) + (typeof Bridge === "object" && Bridge.pinQ ? Bridge.pinQ() : "");
  },
  // the client's Tally computer reads Tally now; the answer: {ok, readAt} or {ok: false, why}
  async remoteRead(co, force){
    const f = this.fresh[co.id];
    if (!force && f && Date.now() - f.at < 60000) return f.res;
    if (this.reading[co.id]) return this.reading[co.id];
    const run = (async () => {
      const l0 = typeof tallyLine === "function" ? tallyLine(co) : null;
      if (!l0) return {ok: false, why: "no Tally computer keeps " + postCompanyName(co) + " for this client"};
      if (l0.state !== "open") return {ok: false, why: l0.text};
      const before = Date.parse(l0.read || 0) || 0;
      try { const j = await TCloud.rpc("tally_want_update", {p_client: co.id}); if (j && j.ok === false) return {ok: false, why: "the Tally computer could not be asked to read"}; }
      catch (err){ return {ok: false, why: "the Tally computer could not be asked to read (" + ((err && err.message) || err) + ")"}; }
      tallyAskedRead(co.id);
      const end = Date.now() + this.WAIT;
      while (Date.now() < end){
        await this.sleep(this.POLL);
        try { if (typeof TLight === "object"){ TLight.st.at = 0; await TLight.refresh(); } } catch (err){}
        const l = tallyLine(co);
        if (!l) return {ok: false, why: "no Tally computer keeps this client's company"};
        if (l.state !== "open") return {ok: false, why: l.text};
        const at = Date.parse(l.read || 0) || 0;
        if (at > before) return {ok: true, readAt: l.read, via: "computer"};
      }
      return {ok: false, why: "the Tally computer has not read Tally since " + (l0.read ? tallyHm(l0.read) : "it was asked") + " (asked at " + fmtTime(Date.now() - this.WAIT) + ")"};
    })();
    this.reading[co.id] = run;
    try { const res = await run; this.fresh[co.id] = {at: Date.now(), res}; return res; } finally { delete this.reading[co.id]; }
  },
  // a fresh look at Tally for one bill: {ok, found, vch, readAt} or {ok: false, why}
  async live(co, e, force){
    const tname = postCompanyName(co);
    if (typeof tallyVia === "function" && tallyVia(co) === "bridge"){
      try {
        const j = await Bridge.call(this.vouchersUrl(co, tname, e), null, 120000);
        const vs = [].concat((j && j.vouchers) || []).filter(v => !/^yes$/i.test(v.cancelled || ""));
        return {ok: true, found: this.match(e, vs), readAt: new Date().toISOString(), via: "bridge"};
      } catch (err){ return {ok: false, why: "FinCom Bridge did not answer (" + plainMsg((err && err.message) || String(err)) + ")"}; }
    }
    if (typeof TCloud !== "object" || !TCloud.on()) return {ok: false, why: Bridge.on() ? "FinCom Bridge here does not have " + tname + " open" : "FinCom Bridge is not running on this computer"};
    const r = await this.remoteRead(co, force);
    if (!r.ok) return r;
    try {
      const j = await CloudTally.call(co, this.vouchersUrl(co, tname, e));
      const vs = [].concat((j && j.vouchers) || []).filter(v => !/^yes$/i.test(v.cancelled || ""));
      return {ok: true, found: this.match(e, vs), readAt: r.readAt, via: "computer"};
    } catch (err){ return {ok: false, why: "the read could not be looked at (" + plainMsg((err && err.message) || String(err)) + ")"}; }
  },
  vchSay(v){ return "voucher no. " + (v.number || v.vchNumber || "?") + ", " + fmtDate(tallyToIso(v.date) || v.date || ""); },
  // found in Tally: the bill counts as in Tally, with Tally's voucher
  markIn(co, e, v){
    const now = new Date().toISOString();
    e.exportedAt = e.exportedAt || now; e.postVerified = true; e.postUnconfirmed = null; e.postError = ""; e.postCheckFailed = null; delete e.goneFromTally;
    e.tally = Object.assign({}, e.tally || {}, {guid: v.guid || (e.tally && e.tally.guid) || "", vchDate: v.date || (e.tally && e.tally.vchDate) || "", vchType: v.type || (e.tally && e.tally.vchType) || "", company: postCompanyName(co), at: (e.tally && e.tally.at) || now, checkedAt: now});
    if (v.number) e.tallyVchNo = v.number;
    Store.saveEntry(co.id, e);
  },
  // Check now (and on its own, once, before the bill is shown)
  async run(co, e, force){
    const s = this.st[e.id];
    if (s && s.busy) return s;
    this.st[e.id] = Object.assign({}, s || {}, {busy: true}); render();
    let r; try { r = await this.live(co, e, force); } catch (err){ r = {ok: false, why: plainMsg((err && err.message) || String(err))}; }
    const st = this.st[e.id] = {busy: false, at: Date.now(), ok: r.ok, found: r.ok ? r.found : null, readAt: r.readAt || "", why: r.why || "", via: r.via || ""};
    if (r.ok && r.found){ this.markIn(co, e, r.found); st.said = e.x.invoiceNo + " is in Tally (" + this.vchSay(r.found) + ")."; postNote(co.id, st.said); }
    refreshStats(co.id); render();
    return st;
  },
  // what the page says of a bill sent and not confirmed: {state: checking | notchecked | notfound | unsure, text}
  view(e){
    const s = this.st[e.id], posted = this.postedAt(e);
    if (s && s.busy) return {state: "checking", text: "Checking Tally now…"};
    if (!s) return {state: "notchecked", text: "Not checked yet: Tally has not been read since this was sent"};
    if (!s.ok) return {state: "notchecked", text: "Not checked yet: " + s.why};
    const at = Date.parse(s.readAt || 0) || 0;
    if (!at || at <= posted) return {state: "notchecked", text: "Not checked yet: the last read (" + tallyHm(s.readAt) + ") is older than the posting (" + tallyHm(posted) + ")"};
    return {state: "notfound", text: "Not found in Tally at the " + tallyHm(s.readAt) + " read"};
  },
  // a bill to check by itself before it is shown: not checked in the last 10 minutes
  due(e){ const s = this.st[e.id]; return !s || (!s.busy && Date.now() - (s.at || 0) > this.KEEP); },
  // Post again: Tally read LIVE first, for the same party, bill no., date and amount; posted only when that read worked
  // and found nothing
  async repost(co, e){
    const s = this.st[e.id] || {};
    if (s.busy) return false;
    this.st[e.id] = Object.assign({}, s, {busy: true}); render();
    let r; try { r = await this.live(co, e, true); } catch (err){ r = {ok: false, why: plainMsg((err && err.message) || String(err))}; }
    this.st[e.id] = {busy: false, at: Date.now(), ok: r.ok, found: r.ok ? r.found : null, readAt: r.readAt || "", why: r.why || "", via: r.via || ""};
    if (!r.ok){ const t = "Not posted again: Tally could not be checked (" + r.why + ")."; postNote(co.id, t, "bad"); toast(t); render(); return false; }
    if (r.found){
      const t = "Already in Tally (" + this.vchSay(r.found) + "): " + e.x.invoiceNo + " was not posted again.";
      this.markIn(co, e, r.found); postNote(co.id, t); toast(t); refreshStats(co.id); render(); return false;
    }
    if (Date.parse(r.readAt || 0) <= this.postedAt(e)){ const t = "Not posted again: the read of Tally (" + tallyHm(r.readAt) + ") is older than the posting."; postNote(co.id, t, "bad"); toast(t); render(); return false; }
    // not in Tally at a read made just now: waiting again, and posted (the bridge checks Tally once more as it posts)
    e.exportedAt = null; e.postNote = ""; e.postVerified = false; e.postByReply = false; e.tallyCheck = null; e.postUnconfirmed = null; e.postError = ""; e.postCheckFailed = null; delete e.goneFromTally;
    Store.saveEntry(co.id, e); refreshStats(co.id);
    await postAllToTally({kind: "bill", id: e.id});
    return true;
  }
};
// round 4, item 7 (migration-37): the FinCom ids FinCom's cloud holds for the client's postings (tally_post_ids). An
// entry Tally refused, or one not found at a fresh read, is posted again only once its id is released (live = false, or
// released_at set: the bridge said it is not in Tally, or the posting failed as a whole); until then the Errors tab says
// "Waiting for the bridge to confirm it is not in Tally" and has no button. When the table cannot be read at all (an
// older cloud, or no select for members: readable = false), the buttons are shown as before migration-37: nothing is
// held back for want of a column, and nothing is posted twice either (the bridge checks Tally for the id as it posts).
const PostIds = {
  by: {}, readable: null, busy: {},
  jobsKey(cid){ return (typeof CloudJobs === "object" ? CloudJobs.forClient(cid) : []).slice(0, 40).map(j => j.id).join(","); },
  async load(cid, force){
    if (!cid || typeof TCloud !== "object" || !TCloud.on() || this.readable === false || this.busy[cid]) return;
    const key = this.jobsKey(cid), s = this.by[cid];
    if (!key || (!force && s && s.key === key && Date.now() - s.at < 60000)) return;
    this.busy[cid] = true;
    try {
      const q = cols => "tally_post_ids?select=" + cols + "&job_id=in.(" + key + ")";
      // round 15 (B5, B1): matched_at / matched_vch ("Matched with Tally", nothing writes it yet) and Tally's ids as the
      // cloud keeps them (reply_vch, batch_end, batch_n), from migration 43; an older cloud is read as before
      // the owner's spec of 04-Oct (src/js/62, postStatus): each row kept too, with the acceptance (accepted_at,
      // accepted_vch: migration 36b) and who released it (released_by)
      const base = "job_id,fincom_id,entry_id,live", tries = [base + ",released_at,released_why,released_by,accepted_at,accepted_vch,matched_at,matched_vch,reply_vch,batch_end,batch_n", base + ",released_at,released_why,matched_at,matched_vch,reply_vch,batch_end,batch_n", base + ",released_at,released_why", base];
      let rows;
      for (let i = 0; ; i++){
        try { rows = await TCloud.restAll(q(tries[i])); break; }
        catch (e){ if (i >= tries.length - 1 || !/released_at|released_why|released_by|accepted_at|accepted_vch|matched_at|matched_vch|reply_vch|batch_end|batch_n|42703/i.test(String(e && e.message))) throw e; }
      }
      const held = new Map(), matched = new Map(), ids = new Map(), byRow = new Map();
      [].concat(rows || []).forEach(r => { const h = !!r.live && !r.released_at, ks = [r.fincom_id, r.entry_id].filter(Boolean).map(String);
        ks.forEach(k => byRow.set(r.job_id + "|" + k, r));
        ks.forEach(k => held.set(k, held.get(k) || h));
        if (r.matched_at) ks.forEach(k => matched.set(k, {at: r.matched_at, vch: r.matched_vch == null ? "" : String(r.matched_vch)}));
        if (r.reply_vch != null || r.batch_end != null) ks.forEach(k => { if (!ids.has(k)) ids.set(k, r.reply_vch != null ? {vch: r.reply_vch} : {batchEnd: r.batch_end, batchN: num(r.batch_n)}); }); });
      const sig = JSON.stringify([[...held.entries()].sort(), [...matched.entries()].sort(), [...ids.entries()].sort(), [...byRow.entries()].map(([k, r]) => [k, r.live, r.released_at, r.accepted_vch]).sort()]);
      const changed = !s || s.sig !== sig;
      this.by[cid] = {at: Date.now(), key, held, matched, ids, rows: byRow, sig}; this.readable = true;
      if (changed) render();
    } catch (e){ this.readable = false; this.by[cid] = {at: Date.now(), key, held: null, rows: null, sig: ""}; render(); }
    finally { delete this.busy[cid]; }
  }
};
// true: the id is released (or the cloud holds no row for it); false: still held live; null: not known (tally_post_ids
// not readable, or not read yet): then the page behaves as before
function postIdReleased(id, cid){
  cid = cid || S.coId;
  const s = PostIds.by[cid];
  if (PostIds.readable === false || !s || !s.held) return null;
  return !s.held.get(String(id));
}
// a failed posting of the cloud: one of the entries still to send is held live
function postJobHeld(j){
  if (typeof CloudJobs !== "object") return false;
  const ids = (CloudJobs.idsOf(j) || []).filter(id => !CloudJobs.inTally(j, id));
  return ids.some(id => postIdReleased(id, j.client_id) === false);
}
// round 14c (C5a): a failed posting of the cloud cannot be retried while a bill of it (one still to send) is deleted in
// FinCom: the words for the row, else ""
function postRetryRefusal(j){
  if (!j || typeof CloudJobs !== "object") return "";
  const d = S.data[j.client_id], ents = (d && d.entries) || {};
  const ids = (CloudJobs.idsOf(j) || []).filter(id => !CloudJobs.inTally(j, id));
  for (const id of ids){
    const e = ents[id];
    if (e && e.status === "deleted"){
      const dl = e.deleted || {}, when = dl.at ? fmtDate(String(dl.at).slice(0, 10)) : "an unknown date";
      return "Retry not possible: this bill was deleted in FinCom on " + when + " (" + (dl.reason || "no reason given") + "). Restore it first.";
    }
  }
  // round 15 (B2): an entry Tally accepted whose reply needs review is never sent again by a Retry
  const rev = [].concat(j.results || []).filter(r => postNeedsReview(r) && r.accepted === true && ids.includes(String(r.id)));
  if (rev.length) return "Retry not possible: Tally accepted " + rev.length + (rev.length === 1 ? " entry that needs" : " entries that need") + " review first (Mark posted, or Not in Tally \u2014 release, under Errors).";
  return "";
}
// what the row of a posting says beside Retry: the refusal of the last press, or the standing one (a deleted bill)
function postRetryWhy(j){ return (j && typeof CloudJobs === "object" && CloudJobs.refused && CloudJobs.refused[j.id]) || postRetryRefusal(j) || ""; }
// round 14c (C7): Tally's reply for a posting, summed over its entries' results: {created, altered, exceptions, ignored,
// has (any count came back), messages}; the words for the page in .text ("" when Tally said nothing countable)
function postReply(results){
  const out = {created: 0, altered: 0, exceptions: 0, ignored: 0, has: false, messages: [], text: ""};
  [].concat(results || []).forEach(r => {
    if (!r || r.kind === "master" || /^led:|^vt:/.test(String(r.id || ""))) return;
    ["created", "altered", "exceptions", "ignored"].forEach(k => { if (r[k] != null && r[k] !== ""){ out[k] += num(r[k]); out.has = true; } });
    const m = plainMsg(r.message || "");
    if (m && !out.messages.includes(m)) out.messages.push(m);
  });
  if (!out.has) return out;
  out.text = "Tally\u2019s reply: created " + out.created + " \u00b7 altered " + out.altered + " \u00b7 exceptions " + out.exceptions + " \u00b7 ignored " + out.ignored + (out.messages.length ? " \u00b7 " + out.messages.slice(0, 3).join("; ") : "");
  return out;
}
// ---------- round 15 (B1–B5): what Tally confirmed, kept on the entry and said on the page
// A result of bridge 2.1.8 says how Tally counted the request: vchId is Tally's exact voucher id (only when the request
// held one voucher), batchEnd the last Tally id of a request of several (batchN of them). An id is never inferred for an
// entry of a batch: the page says the batch's end. {vch | batchEnd, batchN, company, at, by} from a result, or null for
// an older result (verified by read-back, vchNumber/masterId), which keeps showing as before
function postTallyMark(x, more){
  if (!x) return null;
  more = more || {};
  const has = v => v != null && v !== "";
  if (!has(x.vchId) && !has(x.batchEnd)) return null;
  const m = {company: x.company || more.company || "", at: x.sentAt || more.at || "", by: more.by || ""};
  if (has(x.vchId)) m.vch = x.vchId; else { m.batchEnd = x.batchEnd; m.batchN = num(x.batchN) || 0; }
  return m;
}
function postNeedsReview(x){ return !!x && !x.ok && x.needsReview === true; }
// a moment in Indian time, as the owner reads Tally's clock: "03-Oct-2026 14:05 IST"
function fmtIST(t){
  const ms = typeof t === "number" ? t : Date.parse(String(t || ""));
  if (!ms) return "";
  const p = {};
  try { new Intl.DateTimeFormat("en-GB", {timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false}).formatToParts(ms).forEach(q => { p[q.type] = q.value; }); }
  catch (e){ return fmtDateTime(ms); }
  return p.day + "-" + String(p.month).replace(/^Sept$/, "Sep") + "-" + p.year + " " + (p.hour === "24" ? "00" : p.hour) + ":" + p.minute + " IST";
}
// the words for a mark: "Posted to Tally: voucher id N" or "Posted to Tally, batch ending Tally id N", then
// " · <company> · <date time IST> · by <name>"; "" without a mark
function postMarkWords(m){
  if (!m || (m.vch == null && m.batchEnd == null)) return "";
  const head = m.vch != null ? "Posted to Tally: voucher id " + m.vch : "Posted to Tally, batch ending Tally id " + m.batchEnd;
  return head + (m.company ? " · " + m.company : "") + (m.at ? " · " + fmtIST(m.at) : "") + (m.by ? " · by " + m.by : "");
}
// the mark kept on an entry or a bank line (e.tally: set with exportedAt / sentAt when the result arrived here)
function postMarkOf(e){ const t = e && e.tally; return t && (t.vch != null || t.batchEnd != null) ? {vch: t.vch, batchEnd: t.batchEnd, batchN: t.batchN, company: t.company, at: t.at, by: t.by} : null; }
// the mark from a posting of the cloud (seen from any computer): the entry's result, the job's company, when, and the
// person who pressed Post (created_by); else the ids the cloud kept in tally_post_ids
function postMarkFromJob(j, id){
  if (!j) return null;
  const r = [].concat(j.results || []).find(x => x && String(x.id) === String(id));
  const by = j.created_by ? memberName(j.created_by) : "";
  const m = postTallyMark(r, {company: j.company, at: j.updated_at || j.created_at, by});
  if (m) return m;
  const s = typeof PostIds === "object" && PostIds.by[j.client_id], k = s && s.ids && s.ids.get(String(id));
  return k ? Object.assign({company: j.company || "", at: j.updated_at || j.created_at || "", by}, k) : null;
}
function postMarkFor(cid, id, e){ return postMarkOf(e) || postMarkFromJob(typeof postJobOf === "function" ? postJobOf(cid, id) : null, id); }
// round 17a (owner, 04-Oct-2026): a posting of FinCom's cloud that finished while this page was not waiting for it (on
// another computer, the page closed or reloaded, a Live update) left its entries unmarked here, so they read as never
// posted. Each result Tally took (postTaken: read back, Tally's reply, altered) in the newest posting naming the entry is
// written onto the bill (billPosted) or the open statement's bank line (bankPosted) as the page would have done, with the
// job's company, when it was sent (sentAt, else the job's time) and who pressed Post (created_by). Never queues, never
// calls the bridge, sends nothing to Tally. Left alone: an entry already marked, not approved (deleted, back in review),
// released by an owner (not in Tally), or once marked here and taken back out of Tally since (postedVia kept). A stale
// "not yet read back" on it is cleared. Not while this page is itself waiting on a posting (it marks those). Returns the
// number marked; one toast when it marked any.
function postReconcile(cid, quiet){
  if (typeof CloudJobs !== "object" || !cid || !CloudJobs.list) return 0;
  if ((S.billPost && S.billPost.busy) || (S.bank && S.bank.cid === cid && S.bank.busy)) return 0;
  const d = S.data[cid], b = S.bank && S.bank.cid === cid && !S.bank.loading ? S.bank : null;
  const pid = typeof PostIds === "object" ? PostIds.by[cid] : null;
  const released = id => !!(pid && pid.held && pid.held.has(id) && !pid.held.get(id));
  let bills = 0, lines = 0;
  postJobStates(cid).forEach((v, id) => {
    const j = v.job;
    if (v.st !== "posted" || !j || !["done", "failed"].includes(j.status)) return;
    const x = [].concat(j.results || []).find(r => r && String(r.id) === id);
    if (!postTaken(x) || released(id)) return;
    const at = x.sentAt || j.updated_at || j.created_at || new Date().toISOString(), by = j.created_by ? memberName(j.created_by) : "";
    const e = d && d.loaded && d.entries ? d.entries[id] : null;
    if (e){
      if (e.status !== "approved" || billInTally(e) || e.goneFromTally) return;
      if (e.postedVia && !(e.exportedAt && e.postVerified !== true && e.postByReply !== true)) return;
      billPosted(cid, e, x, j.company || "", at, {by, quiet: true});
      Store.saveEntry(cid, e); bills++;
      return;
    }
    const r = b ? b.rows.find(q => String(q.id) === id) : null;
    if (!r || r.goneFromTally || r.postVerified === true || r.postByReply === true) return;
    if (!((r.state === "ready" && !r.postedVia) || (r.state === "sent" && !r.checking))) return;
    if (typeof bankPosted === "function"){ bankPosted(cid, r, x, j.company || "", at, {by, quiet: true}); lines++; }
  });
  const n = bills + lines;
  if (lines) saveBank({rows: true, posted: true});
  if (bills) refreshStats(cid);
  if (n){
    if (!quiet) toast(n + (n === 1 ? " posting" : " postings") + " marked from Tally's reply" + (cid !== S.coId && S.companies[cid] ? " (" + S.companies[cid].name + ")" : "") + ".");
    render();
  }
  return n;
}
// the name for "by <name>" when the result comes through this browser: the member's name, else the e-mail
function postMyName(){
  const st = (typeof Cloud === "object" && Cloud.st) || {}, me = (st.members || []).find(m => m.email && m.email === st.email);
  return (me && me.name) || st.email || "";
}
// B5: "Matched with Tally" is said only when tally_post_ids carries matched_at for the entry: {at, vch} or null
function postMatched(id, cid){
  const s = PostIds.by[cid || S.coId], m = s && s.matched && s.matched.get(String(id));
  return m || null;
}
// Tally's counts for one entry's reply: "created 1 · altered 0 · exceptions 1 · ignored 0" ("" when none came back)
function postReplyCounts(x){
  return ["created", "altered", "exceptions", "ignored"].filter(k => x && x[k] != null && x[k] !== "").map(k => k + " " + num(x[k])).join(" · ");
}
// Tally's line errors on a reply (bridge 2.1.8: lineError, an array of texts, or one text): the first three, as one line
function postLineErrors(x){
  const l = x && x.lineError, arr = Array.isArray(l) ? l : l ? [l] : [];
  return arr.map(t => plainMsg(String(t || ""))).filter(Boolean).slice(0, 3).join("; ");
}
// B2: the posting's line: "Posted N of M" / "Posted N of M; K need review"
function postJobCount(j){
  const rs = [].concat((j && j.results) || []).filter(r => r && r.kind !== "master" && !/^led:|^vt:/.test(String(r.id || "")));
  const ok = rs.filter(r => r.ok || postAlready(r)).length, rev = rs.filter(postNeedsReview).length;
  const n = Math.max(num(j && j.n) || 0, ((typeof CloudJobs === "object" && CloudJobs.idsOf(j)) || []).length, rs.length);
  return "Posted " + ok + " of " + n + (rev ? "; " + rev + (rev === 1 ? " needs review" : " need review") : "");
}
// B4: the timing the bridge wrote on the job (tally_post_jobs.timing = {reqs: [{n, seconds, …}], secondsTotal}): "K requests, T s"
function postTimingWords(j){
  const t = j && j.timing;
  if (!t || typeof t !== "object") return "";
  const k = Array.isArray(t.reqs) ? t.reqs.length : num(t.reqs), s = t.secondsTotal != null ? num(t.secondsTotal) : (Array.isArray(t.reqs) ? t.reqs.reduce((a, q) => a + num(q.seconds), 0) : 0);
  if (!k && !s) return "";
  return k + (k === 1 ? " request, " : " requests, ") + (Math.round(s * 10) / 10) + " s";
}
// T: test bills (the owner's timing). Round 19 (the owner's decision, 04-Oct): any company linked in FinCom, no
// company-name check; only a client whose posting company (postTo) is confirmed, and an owner (postTestCopies)
function postTestCopiesOk(co){
  return !!co && typeof choiceState === "function" && choiceState(co, "postTo") === "confirmed" && !!String(co.postTo || "").trim();
}
// round 19, guard (b): anything that adds test entries asks once, naming the company; true on yes
async function postTrialConfirm(co, n){
  const company = String((co && co.postTo) || "").trim() || postCompanyName(co);
  const a = await askConfirm({title: "Add test entries?", ok: "Continue",
    body: "<p>" + esc("This will add " + n + (n === 1 ? " test entry" : " test entries") + " to " + company + ". Continue?") + "</p>" +
      "<p>Their narration starts with TRIAL.</p>"});
  return !!(a && a.ok);
}
// N copies of a ready bill: new ids, invoice numbers "<no>-T1".."-TN", the same amounts, ledgers and date, x.testCopy
// true, narration "TRIAL | ...", ready to post, after the owner says yes to "This will add N test entries to <company>.
// Continue?". {ok, ids} or {ok: false, error} (cancelled: {ok: false, cancelled: true})
async function postTestCopies(cid, id, n){
  const co = S.companies[cid], d = S.data[cid], src = d && d.entries && d.entries[id];
  if (!postOwner()) return {ok: false, error: "Only an owner of the firm makes test copies."};
  if (!co || !postTestCopiesOk(co)) return {ok: false, error: "Test copies are made only for a client whose posting company is confirmed (Client setup \u2192 Tally)."};
  if (!src) return {ok: false, error: "Choose a bill first."};
  n = Math.floor(num(n));
  if (!(n >= 1 && n <= 100)) return {ok: false, error: "Choose a number from 1 to 100."};
  if (src.status !== "approved" || src.exportedAt || src.postUnconfirmed) return {ok: false, error: "Choose a bill that is ready to post."};
  if (!(await postTrialConfirm(co, n))) return {ok: false, cancelled: true, error: "Nothing made."};
  if (!d.entries[id] || S.companies[cid] !== co) return {ok: false, error: "Choose a bill first."};
  const now = new Date().toISOString(), no = src.x.invoiceNo || "T", ids = [];
  for (let i = 1; i <= n; i++){
    const e = JSON.parse(JSON.stringify(src));
    e.id = uid("e"); e.createdAt = now; e.approvedAt = now; e.fileName = "Test copy " + i + " of " + no; e.notDuplicate = true;
    e.x.invoiceNo = no + "-T" + i; e.x.testCopy = true;
    // TRIAL in the narration (voucherXml adds " | TDSDesk:<id>" after it)
    const nar = e.narration || narrationFor(e);
    e.narration = /^TRIAL \| /.test(nar) ? nar : "TRIAL | " + nar;
    ["exportedAt", "postUnconfirmed", "postCheckFailed", "postError", "postNote", "postAlreadyMsg", "tally", "tallyVchNo", "tallyCheck", "postVerified", "postByReply", "postAltered", "postedVia", "postedInto", "postedOptional", "goneFromTally", "postFailedAt", "paidBy", "vchNo", "docPath", "dupOf"].forEach(k => { delete e[k]; });
    d.entries[e.id] = e; Store.saveEntry(cid, e); ids.push(e.id);
  }
  refreshStats(cid); render();
  return {ok: true, ids};
}

// round 5 (S3, C6): an owner settles an entry Tally accepted but nobody confirmed, or one not found in Tally whose id
// FinCom's cloud still holds. "Mark posted (voucher no.)" -> tally_post_job_mark_posted(job, id, vch, note) (migration
// 36b: results and items say in_tally, the id stays accepted); "Not in Tally — release (reason)" -> tally_post_id_release_
// owner(job, id, why) (the id freed, the entry notfound, a mark 'released'). Both ask for the text first; the cloud
// refuses anyone but an owner, and the page shows the buttons to owners only. A cloud without 36b says so.
// owners of the firm alone (the cloud accepts only an active member with role owner; a superadmin who is not one is refused there)
function postOwner(){ return !!(S.account && ((S.account.me || {}).role === "owner")); }
// the owner's decision B (05-Oct-2026, migration 55): any member of the firm who may post (owner or staff: the cloud's
// can_write) settles a posting whose result is uncertain: "Mark posted" (a Tally id) and "Not in Tally - post again"
// (the FinCom Bridge looks in Tally first; nothing is sent until it finds the entry is not there). A reason is required;
// the name and time are kept. A superadmin who is not a member, or a viewer, does not
function postCanSettle(){ const r = S.account && (S.account.me || {}).role; return r === "owner" || r === "staff"; }
// the posting of FinCom's cloud that holds the entry: the newest naming it (by entry_ids, results or items)
function postJobOf(cid, id){
  const js = postJobStates(cid).get(String(id));
  if (js && js.job) return js.job;
  if (typeof CloudJobs !== "object") return null;
  return CloudJobs.forClient(cid).slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .find(j => (CloudJobs.idsOf(j) || []).includes(String(id)) || [].concat(j.results || [], j.items || []).some(x => x && String(x.id) === String(id))) || null;
}
const PostOwner = {
  notReady(m){ return /tally_post_job_mark_posted|tally_post_id_release_owner|tally_post_settle_ask|tally_post_check_withdraw|tally_post_check_confirm|PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(String(m || "")); },
  async call(cid, fn, args, done){
    try {
      const r = await TCloud.rpc(fn, args);
      if (r && r.ok === false) throw new Error(r.error || "It was not done.");
      toast(done);
    } catch (e){
      const m = String((e && e.message) || e);
      toast(this.notReady(m) ? "FinCom\u2019s cloud is not ready for this yet (migration " + (fn === "tally_post_settle_ask" || fn === "tally_post_check_withdraw" || fn === "tally_post_check_confirm" ? "55" : "36b") + ")." : m.replace(/^ERROR:\s*/i, ""));
    }
    if (typeof PostChecks === "object") PostChecks.load(cid, true);
    if (typeof PostMarks === "object") PostMarks.load(cid, true);
    if (typeof CloudJobs === "object") await CloudJobs.load(true);
    if (typeof PostIds === "object") PostIds.load(cid, true);
    render();
  },
  // E (the owner's spec of 04-Oct): the Tally id is Tally's own number, digits only; one the same as the bill number is
  // warned about (asked again), not refused. Without a posting of the cloud (a bill posted straight to a bridge) the mark
  // is kept on the bill here (markLocal). A bill FinCom's copy of Tally did not show is cleared of that once marked.
  idCheck(v){ return !v ? "Type Tally's id for this entry, as Tally shows it." : /^\d+$/.test(v) ? "" : "The Tally id is digits only (for example 26301)."; },
  async sameAsBill(e, v){
    const no = String((e && e.x && e.x.invoiceNo) || "").trim();
    if (!no || no !== v) return true;
    const a = await askConfirm({title: "The Tally id is the same as the bill number", ok: "Use " + v + " anyway",
      body: "<p>" + esc("You typed " + v + ", which is the bill number. Tally's id is the number Tally gives the entry (for example 26301). Use " + v + " anyway?") + "</p>"});
    return !!(a && (a === true || a.ok));
  },
  // why: a reason is required (Mark posted, decision B); a correction carries its own ("Correction: the Tally id is ...")
  async askId(e, title, ok, pre, intro, why){
    why = why !== false;
    const a = await askConfirm({title, ok,
      body: "<p>" + intro + "</p>" +
        '<div class="bk-form one"><label><span>Tally id</span><input id="markVch" maxlength="20" inputmode="numeric" placeholder="Digits only, as Tally shows it" value="' + esc(pre || "") + '"></label>' +
        '<label><span>' + (why ? "Reason (kept with your name)" : "Note (optional)") + '</span><input id="markNote" maxlength="300" placeholder="Where you saw it in Tally"></label></div>',
      read: () => ({vch: ((document.getElementById("markVch") || {}).value || "").trim(), note: ((document.getElementById("markNote") || {}).value || "").trim()}),
      validate: d => this.idCheck(d && d.vch) || (!why || (d && d.note) ? "" : "Say where you saw it in Tally (kept with your name and the time).")});
    if (!a || !a.ok) return null;
    if (!(await this.sameAsBill(e, a.data.vch))) return null;
    return a.data;
  },
  clearGone(cid, e){ if (e && e.x && e.goneFromTally){ delete e.goneFromTally; e.postVerified = true; Store.saveEntry(cid, e); refreshStats(cid); } },
  async markPosted(cid, e, job){
    const no = (e.x && e.x.invoiceNo) || e.id;
    if (!job) return this.markLocal(cid, e);
    const d = await this.askId(e, "Mark " + no + " as posted in Tally?", "Mark posted", "", "You saw this entry in Tally. FinCom records it as posted, with who marked it and when; nothing is sent to Tally.");
    if (!d) return;
    await this.call(cid, "tally_post_job_mark_posted", {p_job: job.id, p_id: String(e.id), p_vch: d.vch, p_note: d.note}, no + " is marked posted.");
    this.clearGone(cid, e);
  },
  // a bill posted straight to a bridge (no posting of the cloud names it): the mark is kept on the bill
  async markLocal(cid, e){
    const no = (e.x && e.x.invoiceNo) || e.id;
    const d = await this.askId(e, "Mark " + no + " as posted in Tally?", "Mark posted", (e.tally && (e.tally.vch || e.tally.masterId)) || "", "You saw this entry in Tally. FinCom records it as posted on this bill, with who marked it and when; nothing is sent to Tally.");
    if (!d) return;
    const now = new Date().toISOString(), me = (S.account && S.account.me) || {};
    e.exportedAt = e.exportedAt || now; e.postVerified = true; e.postedVia = e.postedVia || "bridge"; delete e.goneFromTally;
    e.tally = Object.assign({}, e.tally || {}, {vch: d.vch, byOwner: postMyName() || me.name || "an owner", byOwnerId: me.user_id || "", byOwnerAt: now, byOwnerNote: d.note || "", company: (e.tally && e.tally.company) || postCompanyName(S.companies[cid] || CO())});
    Store.saveEntry(cid, e); refreshStats(cid); toast(no + " is marked posted."); render();
  },
  // F (Jitin & Co. 4861): an owner typed the bill number as the Tally id; the correction is recorded the same way as a mark
  // (tally_post_job_mark_posted: a new row in tally_post_marks, the result's voucher, the id's accepted_vch)
  async correctId(cid, e, job, suggest, was){
    const no = (e.x && e.x.invoiceNo) || e.id;
    const d = await this.askId(e, "Correct the Tally id of " + no, "Correct the Tally id", suggest || "", "The Tally id kept for this entry" + (was ? " (" + esc(was) + ")" : "") + " is not Tally's own id. Type the id Tally shows for it; FinCom keeps the correction with who made it and when. Nothing is sent to Tally.", false);
    if (!d) return;
    const note = ("Correction: the Tally id is " + d.vch + (was ? ", not " + was : "") + (d.note ? " (" + d.note + ")" : "")).slice(0, 300);
    if (!job){
      const me = (S.account && S.account.me) || {};
      e.tally = Object.assign({}, e.tally || {}, {vch: d.vch, corrected: {from: was || "", by: postMyName() || me.name || "", byId: me.user_id || "", at: new Date().toISOString()}});
      Store.saveEntry(cid, e); toast("The Tally id of " + no + " is now " + d.vch + "."); render(); return;
    }
    await this.call(cid, "tally_post_job_mark_posted", {p_job: job.id, p_id: String(e.id), p_vch: d.vch, p_note: note}, "The Tally id of " + no + " is now " + d.vch + ".");
  },
  // the owner's rule (a duplicate entry must never be possible from this button): after the FinCom Bridge did not see the
  // entry on its day ("notseen"), a member who may post looks in Tally and confirms it is not there, a reason required
  // (tally_post_check_confirm: the only way it is released and sent again, that entry alone; name and time kept)
  async confirmNotSeen(cid, e, job){
    if (!job) return;
    const no = (e.x && e.x.invoiceNo) || e.id, co = job.company || "the company";
    const a = await askConfirm({title: no + ": you looked in Tally and it is not there?", ok: "I looked in Tally: not there \u2013 post again", danger: true,
      body: "<p>" + esc("The FinCom Bridge did not see this entry in " + co + " on its date, but it cannot see other dates. Confirm only after looking in Tally (Day Book, or search the narration TDSDesk:" + String(e.id) + "). It is then sent again, once; your name, the time and the reason are kept.") + "</p>" +
        '<div class="bk-form one"><label><span>Reason (where you looked in Tally)</span><input id="confirmWhy" maxlength="500" placeholder="Searched TDSDesk:\u2026 in the Day Book"></label></div>',
      read: () => ({why: ((document.getElementById("confirmWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say where you looked in Tally."});
    if (!a || !a.ok) return;
    return this.call(cid, "tally_post_check_confirm", {p_job: job.id, p_id: String(e.id), p_why: a.data.why}, no + " is sent again, once.");
  },
  // the final review of 2.3.0 (M2): the member who asked for a check, or an owner, withdraws it while it waits
  // (tally_post_check_withdraw: who, when and why kept); nothing is released or sent
  async withdrawCheck(cid, ck){
    if (!ck || !ck.id) return;
    const a = await askConfirm({title: "Withdraw the check?", ok: "Withdraw the check",
      body: "<p>The FinCom Bridge stops looking in Tally for this entry. Nothing is released or sent; your name and the time are kept.</p>" +
        '<div class="bk-form one"><label><span>Reason (optional)</span><input id="withdrawWhy" maxlength="300" placeholder="Found it in Tally myself"></label></div>',
      read: () => ({why: ((document.getElementById("withdrawWhy") || {}).value || "").trim()})});
    if (!a || !a.ok) return;
    return this.call(cid, "tally_post_check_withdraw", {p_check: ck.id, p_why: (a.data && a.data.why) || ""}, "The check is withdrawn; nothing was released or sent.");
  },
  // decision B (05-Oct-2026): "Not in Tally - post again", any member who may post, a reason required. With a posting of
  // FinCom's cloud: tally_post_settle_ask (migration 55): the FinCom Bridge looks in that company in Tally first; found:
  // marked posted with the voucher found; not there: released and sent again, once; Tally not reachable: it waits and
  // looks again by itself. Nothing is sent from here. Without one (a bill posted straight to a bridge): undone here
  async release(cid, e, job){
    const no = (e.x && e.x.invoiceNo) || e.id;
    const co = (job && job.company) || "the company";
    const a = await askConfirm({title: no + ": not in Tally, post it again?", ok: "Not in Tally \u2013 post again", danger: true,
      body: "<p>" + (job ? "Before anything is sent, the FinCom Bridge looks in " + esc(co) + " in Tally for this entry. If it is there, it is marked posted with Tally\u2019s id; if it is not, it is sent again, once. If Tally cannot be asked now, it waits and looks again by itself. Your name, the time and the reason are kept."
          : "You looked in Tally and this entry is not there. FinCom undoes its posted mark so it can be posted again; the reason is kept with the entry. Nothing is sent to Tally now.") + "</p>" +
        '<div class="bk-form one"><label><span>Reason (what you saw in Tally)</span><input id="releaseWhy" maxlength="500" placeholder="Not in the Day Book of …"></label></div>',
      read: () => ({why: ((document.getElementById("releaseWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say what you saw in Tally."});
    if (!a || !a.ok) return;
    if (job) return this.call(cid, "tally_post_settle_ask", {p_job: job.id, p_id: String(e.id), p_why: a.data.why}, "The FinCom Bridge looks in " + co + " in Tally first; " + no + " is sent again only if it is not there.");
    if (!job){
      e.postUndo = {why: a.data.why, at: new Date().toISOString(), by: postMyName()};
      e.exportedAt = null; e.postVerified = false; e.postByReply = false; e.postUnconfirmed = null; e.postError = ""; e.postCheckFailed = null; delete e.goneFromTally;
      Store.saveEntry(cid, e); refreshStats(cid); toast(no + ": the posted mark is undone; it can be posted again."); render(); return;
    }
  }
};
// one line on the page after a check or a posting ("Already in Tally (voucher no. …)"): S.postNote
function postNote(cid, text, level){ S.postNote = {cid, text, level: level || "", at: Date.now()}; }

function goChooseTallyCompany(){ S.step = null; S.arm = null; S.tab = "cotally"; render(); window.scrollTo(0, 0); }
function goTallyPage(){ closeSwitcher(); S.view = "home"; S.homeTab = "tally"; S.arm = null; render(); window.scrollTo(0, 0); }
// the role of a bill's ledger line, as the table groups them
const PV_ROLE = {party: "party", expense: "expense", gst: "gst", "rcm-in": "gst", "rcm-out": "gst", tds: "tds"};
// the entries waiting or on their way: bills, the open statement's bank lines, and sales ready to post
function postRows(co){
  const out = [], d = D(co.id), jobs = typeof CloudJobs === "object" ? CloudJobs.forClient(co.id) : [];
  const live = jobs.filter(j => ["waiting", "taken", "running"].includes(j.status) || j.checking);
  const stOf = (id, fallback) => {
    for (const j of live){
      const it = [].concat(j.items || []).find(x => x.id === id);
      if (it) return it.state === "waiting" ? ["Waiting for Tally", "warn"] : it.state === "sending" ? ["Sending", "warn"] : it.state === "sent" ? ["In Tally, not yet read back", "warn"] : it.state === "in_tally" ? ["In Tally (verified)", "ok"] : it.state === "posted" ? ["Posted to Tally (Tally's reply)", "ok"] : ["Failed: " + (it.reason || "Tally refused it"), "bad"];
      if ((CloudJobs.idsOf(j) || []).includes(id)) return [j.status === "waiting" ? "Waiting for Tally" : "Sending", "warn"];
    }
    return fallback;
  };
  const busyBills = !!(S.billPost && S.billPost.busy && /^Posting/.test(S.billPost.busy));
  (postBillsOpen(co.id) || []).sort(byDate).forEach(e => {
    const led = {party: [], expense: [], gst: [], tds: []};
    (e.snapshot ? e.snapshot.lines : []).forEach(l => { const k = PV_ROLE[l.role] || "expense"; if (l.ledger && !led[k].includes(l.ledger)) led[k].push(l.ledger); });
    // sent (a Tally file, or posted and not confirmed): listed with where it stands, not posted again from here
    const sent = !!e.exportedAt, ts = sent ? tallyStateOf(e) : null;
    out.push({kind: "bill", id: e.id, date: e.x.invoiceDate, party: e.x.vendorName, no: e.x.invoiceNo || "", amount: num(e.x.total), led, e, sent,
      state: sent ? [ts[1], ts[0] === "bad" ? "bad" : "warn"] : stOf(e.id, e.postUnconfirmed ? ["In Tally, not yet read back", "warn"] : busyBills ? ["Sending", "warn"] : ["Waiting for Tally", ""])});
  });
  const b = S.bank && S.bank.cid === co.id && !S.bank.loading ? S.bank : null, st = b ? curStmt() : null;
  if (b && st){
    const acc = (co.bankAccounts || []).find(a => a.id === st.acctId) || {};
    b.rows.filter(r => r.state === "ready").forEach(r => out.push({kind: "bank", id: r.id, date: r.date, party: (r.dec && r.dec.name) || r.narr.slice(0, 40), no: (r.dec && (r.dec.chq || r.dec.utr)) || r.ref || "",
      amount: num(r.debit || r.credit), led: {party: [r.ledger].filter(Boolean), expense: [acc.ledger].filter(Boolean), gst: [], tds: r.tdsAtPay ? [r.tdsLedger || ""].filter(Boolean) : []}, e: r,
      state: stOf(r.id, r.postError ? ["Failed: " + r.postError, "bad"] : b.busy && /^Posting/.test(b.busy) ? ["Sending", "warn"] : ["Waiting for Tally", ""])}));
  }
  const s = S.sales && S.sales.cid === co.id && !S.sales.loading ? S.sales : null;
  if (s) s.list.filter(v => v.status === "ready").forEach(v => {
    const ls = typeof salesLines === "function" ? salesLines(v) : [];
    out.push({kind: "sale", id: v.id, date: v.x.date, party: v.x.customerName || v.customerLedger, no: v.x.number || "", amount: num(v.x.total),
      led: {party: [v.customerLedger].filter(Boolean), expense: ls.map(l => l.ledger).filter(l => l && l !== v.customerLedger && !/gst|cess/i.test(l)), gst: ls.map(l => l.ledger).filter(l => /gst|cess/i.test(l || "")), tds: []}, e: v,
      state: stOf(v.id, v.postError ? ["Failed: " + v.postError, "bad"] : s.busy && /^Posting/.test(s.busy) ? ["Sending", "warn"] : ["Waiting for Tally", ""])});
  });
  return out;
}
// the voucher XML of a row, exactly as it would go now
function postRowXml(co, row){
  if (row.kind === "bill") return voucherXml(row.e, co);
  if (row.kind === "bank"){ const st = curStmt(), acc = st && (co.bankAccounts || []).find(a => a.id === st.acctId); return acc ? bankVoucherXml(row.e, acc, co) : ""; }
  if (row.kind === "sale") return typeof salesVoucherXml === "function" ? salesVoucherXml(row.e, co) : "";
  return "";
}
// the new ledgers the rows would make in Tally (waiting here, not in Tally's list)
function postNewMasters(co, rows){
  if (!S.bank || S.bank.cid !== co.id) return [];
  const used = new Set();
  rows.forEach(r => { const xml = r.xml || postRowXml(co, r); voucherPreview(xml).lines.forEach(l => used.add(ledNm(l.ledger).toLowerCase())); });
  return (S.bank.newLed || []).filter(l => !l.sent && used.has(ledNm(l.name).toLowerCase()) && !ledgerInTally(l.name, co.id)).map(l => ({name: ledNm(l.name), group: l.group || ""}));
}
function postCompanyName(co){ if (co.postTo) return co.postTo; try { return tallyCoName(co); } catch (e){ return co.tallyName || co.name; } }
// the posting stopped by the company check: kept for the page (nothing was sent; the entries stay waiting)
function postStopped(msg, cid){ S.postStop = {msg: plainMsg(msg), cid: cid || S.coId, at: Date.now()}; }
// Preview of one entry, or of the ones about to go: the dialog; true when the person pressed Post
async function postPreview(co, rows, opts){
  opts = opts || {};
  rows.forEach(r => { r.xml = r.xml || postRowXml(co, r); });
  const company = postCompanyName(co), masters = postNewMasters(co, rows);
  const items = rows.filter(r => r.xml).map(r => ({kind: r.kind, id: r.id, xml: r.xml, e: r.e}));
  const nWarn = () => document.querySelectorAll("#confirmBox [data-pv-warn] li").length;
  const a = await askConfirm({title: opts.view ? "Preview: " + (rows[0] ? (rows[0].no || rows[0].party) : "") : "Post " + entries(items.length) + " to " + company + "?", ok: opts.view ? "Close" : "Post", wide: true,
    body: '<div data-post-preview="" style="max-height:60vh;overflow:auto">' + (opts.view ? "" : '<p style="margin:0 0 8px">Each entry exactly as it goes to Tally, into <b>' + esc(company) + "</b>." + (typeof postThroughWords === "function" && postThroughWords(co) ? " " + esc(postThroughWords(co)) : "") + "</p>" + postTargetHtml(co, company)) + PostGate.html(items, co, masters, company) + "</div>",
    onReady: box => { postTargetWire(box, co, company); if (opts.view){ const no = box.querySelector('[data-cbx="no"]'); if (no) no.remove(); } else { const n = nWarn(); if (n){ const p = document.createElement("p"); p.className = "bk-warn"; p.setAttribute("data-pv-count", ""); p.textContent = n + " warning" + (n === 1 ? "" : "s") + " above: look at them before posting."; box.querySelector(".cbx .row").before(p); } } }});
  if (!a || opts.view) return false;
  PostGate.approve(masters.map(m => m.name), company);
  return true;
}
// FinCom Bridge 2.3.0: the confirm step names the bridge that posts: computer · Windows user · company · data folder; an
// owner may pick another bridge that may post (never one set to changes only). Nothing when FinCom's cloud does not know
// the bridges (no cloud, or none heard from)
function postTargetHtml(co, company){
  if (typeof TCloud !== "object" || !TCloud.on() || typeof TCloud.postThrough !== "function") return "";
  let r = null, list = [];
  try { r = TCloud.postThrough(co); list = TCloud.postTargets(); } catch (e){ return ""; }
  if (!r && !list.length && !(TCloud.pane.devices || []).length) return "";
  const owner = S.account && S.account.me && S.account.me.role === "owner";
  // the owner's rule of 05-Oct-2026: no bridge of the poster's own for this company: the words say what to do (never
  // another person's bridge by chance)
  let h = r || TCloud.pane.noTarget ? '<p data-post-target="' + esc(r ? r.id : "") + '" style="margin:0 0 8px">Through <b data-post-target-words="">' + esc(r ? TCloud.bridgeWords(r, company) : "the main bridge of the computer that keeps " + company) + "</b>.</p>"
    : '<p data-post-target="" data-post-target-none="" class="bk-warn" style="margin:0 0 8px"><span data-post-target-words="">' + esc(TCloud.noTargetWords(company)) + "</span></p>";
  if (owner && !TCloud.pane.noTarget && list.length > 1)
    h += '<p style="margin:0 0 8px"><label class="note">Post through another bridge: <select data-post-target-pick="" aria-label="The bridge that posts">' +
      list.map(x => '<option value="' + esc(x.id) + '"' + (r && x.id === r.id ? " selected" : "") + ">" + esc(TCloud.bridgeWords(x, company)) + "</option>").join("") + "</select></label></p>";
  return h;
}
function postTargetWire(box, co, company){
  const sel = box && box.querySelector("[data-post-target-pick]");
  if (!sel) return;
  sel.addEventListener("change", () => {
    S.postTarget = Object.assign({}, S.postTarget, {[co.id]: sel.value});
    const r = TCloud.bridgesHeard().find(x => x.id === sel.value), w = box.querySelector("[data-post-target-words]"), p = box.querySelector("[data-post-target]");
    if (w && r) w.textContent = TCloud.bridgeWords(r, company);
    if (p) p.setAttribute("data-post-target", sel.value);
  });
}
// "Post N to Tally": the bills ready to post (review of 02-Oct-2026: "Ready to post" is approved bills only; bank lines
// and sales are posted from their own pages), each shown first as it goes to Tally. only: one bill (Retry of one whose
// check of Tally failed, Post again of one not found in Tally at a fresh read)
// 03-Oct-2026 (the owner's report: with an earlier posting ended failed on the list, Post for another bill did nothing on
// the page and queued nothing). The cause, read from the path: anything thrown on the way to the queue was never caught.
// Before the preview (the voucher's XML, voucherXml; the preview's own HTML, PostGate.html) it was an unhandled promise
// rejection of the button's click: no dialog, no job, no message. After "Loading ledgers…" (postBillsToTally: the ledger
// read, autoMapCompanyLedgers, canonicalizeBills, billGuessedWhy run before its own try) it also left S.billPost busy, so
// the Post button stayed disabled and every later press did nothing at all, until the page was reloaded. And a stop with
// a toast only (ensureTallyCompany) was gone a moment later. Rule now: every press of Post ends in a job row ("Sent to
// Tally") or a row on the Errors tab with the error's name, what happened and what to do (S.postRefused); never silence.
async function postAllToTally(only){
  const co = CO();
  if (!co) return;
  S.postRefused = null;
  const said = [], t0 = toast;
  window.toast = m => { said.push(String(m)); return t0(m); };
  try {
    if (!co.postTo) await autoPostTo(co);
    if (!co.postTo || postToProblem(co, "")){ postStopped(postToProblem(co, ""), co.id); render(); return; }
    if (!S.bank || S.bank.cid !== co.id) await loadBank(co.id);
    const b = postBills(co.id) || {ready: [], attention: []};
    let list = b.ready;
    if (only){ const e = D(co.id).entries[only.id]; list = e && e.status === "approved" && !e.exportedAt && (b.ready.includes(e) || (b.refused || []).includes(e) || e.postCheckFailed) ? [e] : []; }
    const all = postRows(co), rows = list.map(e => all.find(r => r.kind === "bill" && r.id === e.id) || {kind: "bill", id: e.id, no: e.x.invoiceNo, party: e.x.vendorName, e});
    if (!rows.length){ toast("Nothing is waiting to be posted."); return; }
    S.postStop = null; S.postNote = null;
    // round 19: the second-send test (a typed REMOTEID) adds test entries: asked once, naming the company, before the preview
    const trial = typeof remoteIdTrial === "function" && remoteIdTrial(co);
    if (trial && !(await postTrialConfirm(co, rows.length))) return;
    if (!(await postPreview(co, rows))) return;
    rows.forEach(r => { if (r.e.postCheckFailed){ r.e.postCheckFailed = null; Store.saveEntry(co.id, r.e); } });
    S.billPost = null;
    await postBillsToTally(trial ? {ids: rows.map(r => r.id), trialOk: true} : {ids: rows.map(r => r.id)});
    // back with nothing on the page (a toast only: Tally not connected, no company open, no entry waiting): kept as a row
    if (!S.billPost && !S.postStop) postRefusedShow(co.id, {name: "Not sent", message: said[said.length - 1] || "The posting stopped before anything was sent."});
  } catch (err){
    postRefusedShow(co.id, err);
  } finally {
    window.toast = t0;
    if (S.billPost && S.billPost.busy) S.billPost = null;
    render();
  }
}
// the row on the Errors tab when a press of Post ended in neither a job nor a result line: {cid, at, name, why, what}
function postRefusedShow(cid, err, what){
  const e = err || {}, msg = plainMsg((e && e.message) || (typeof err === "string" ? err : "")) || "no reason given";
  const name = e.name && e.name !== "Error" ? String(e.name) : e.code ? String(e.code) : "Error";
  S.postRefused = {cid, at: Date.now(), name, why: msg,
    what: what || (/^Not sent$/.test(name) ? "Put right what the line says, then press Post again." : "Press Post again. If it stops the same way, send this line to FinCom support: nothing is lost, the bills are still waiting here.")};
  if (S.billPost && S.billPost.busy) S.billPost = null;
  S.postTabs = S.postTabs || {}; S.postTabs[cid] = "errors";
  try { console.error("Post did not go through:", err); } catch (x){}
  render();
}
function postRefusedFor(cid){ const r = S.postRefused; return r && r.cid === cid ? r : null; }
function postPreviewOne(kind, id){
  const co = CO(), row = postRows(co).find(r => r.kind === kind && r.id === id);
  if (row) postPreview(co, [row], {view: true});
}
function postOneToTally(kind, id){ return postAllToTally({kind, id}); }
// Back to review from the Post to Tally page, for any kind
function postBackToReview(kind, id){
  if (kind === "bill"){ billBack(id); return; }
  if (kind === "bank" && S.bank){ const r = S.bank.rows.find(x => x.id === id); if (r){ r.state = "attention"; r.userSet = false; saveBank({rows: true}); toast("Back in To review in Bank."); render(); } return; }
  if (kind === "sale" && S.sales){ const v = S.sales.list.find(x => x.id === id); if (v){ v.status = "review"; saveSales(); toast("Back in To review in Sales."); render(); } }
}

// ---------- the company a client may post to, set by itself when it is clear (B14)
// Exactly one Tally company is linked to the client (FinCom's cloud, or the company open in Tally here) and its GSTIN is
// the client's: that one, saved (it syncs), with postToBy "auto". For existing clients too, when one is opened.
const AutoPostTo = {at: {}};
async function autoPostTo(co, force){
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
  toast(co.name + ": " + one.name + " is the one Tally company linked (same GSTIN " + mine + "). Confirm it in Client setup \u2192 Tally before posting.");
  render();
  return true;
}
