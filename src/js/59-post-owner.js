/* @react-lazy: begin 59-post-owner.js (the React app loads this file with its Post to Tally screen (app/src/screens/Post.jsx): build.py react_parts) */
/* Post to Tally: who holds a posting (was in src/js/59) */
const PostOwner = {
  notReady(m){ return /tally_post_job_mark_posted|tally_post_id_release_owner|tally_post_owner_release|tally_post_settle_ask|tally_post_check_withdraw|tally_post_check_confirm|PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(String(m || "")); },
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
  // migration 174 (fifth review M2): an owner's own "I checked in Tally: not there" when no check can be answered (the
  // bridge that took the posting is gone): a reason required, kept with the name and the time; no bridge looks first
  async ownerNotThere(cid, e, job){
    if (!job) return;
    const no = (e.x && e.x.invoiceNo) || e.id;
    const a = await askConfirm({title: no + ": you checked in Tally and it is not there?", ok: "I checked in Tally: not there", danger: true,
      body: "<p>" + esc("No FinCom Bridge looks first. If it is in Tally, it will be posted twice. Confirm only after looking in Tally (Day Book, or search the narration TDSDesk:" + String(e.id) + "); your name, the time and the reason are kept.") + "</p>" +
        '<div class="bk-form one"><label><span>Reason (where you looked in Tally)</span><input id="ownerWhy" maxlength="400" placeholder="Searched TDSDesk:\u2026 in the Day Book"></label></div>',
      read: () => ({why: ((document.getElementById("ownerWhy") || {}).value || "").trim()}), validate: d => d && d.why ? "" : "Say where you looked in Tally."});
    if (!a || !a.ok) return;
    if (typeof auditEvent === "function") auditEvent("post_owner_not_there", no + ": " + a.data.why, cid);
    return this.call(cid, "tally_post_owner_release", {p_job: job.id, p_id: String(e.id), p_why: a.data.why}, no + " is released; it can be posted again.");
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
      if (!(await postClearReady())) return;
      e.postUndo = {why: a.data.why, at: new Date().toISOString(), by: postMyName()};
      billClearPosting(e);
      Store.saveEntry(cid, e); refreshStats(cid); toast(no + ": the posted mark is undone; it can be posted again."); render(); return;
    }
  }
};
// Fix C (state-machine review, item 5), loaded when it is asked for (postPart, src/js/59-post-preview.js): "Deleted in
// Tally" under a posted bill, the owner's release of it (Post to Tally > Errors), "Not this Tally entry" (bank, sales).
// FinCom reads Tally only to find the bill still there (any read, any match); it never decides by itself that it is gone:
// the owner says so ("I checked in Tally: not there – release": a reason, the risk said, audited), a member asks the owner
Object.assign(PostOwner, {
  delBusy: {},
  // a bank line's or an invoice's own button on one in Tally: left as it is, the next step named
  keptOne(r, inv){
    const next = inv ? (r.status === "intally" ? "If it was matched to the wrong Tally entry, press \u201cNot this Tally entry\u201d on it." : "")
      : r.state === "intally" && !bankOwnPost(r) ? "If it was matched to the wrong Tally entry, press \u201cNot this Tally entry\u201d on the line." : "To post it again, press \u201cTake it back\u201d on the line first.";
    return "This " + (inv ? "invoice" : "line") + " is already in Tally, so it was left as it is." + (next ? " " + next : "");
  },
  // Retry of an old posting: refused when an entry of it was taken back, undone, put to No entry or posted again since
  retryChanged(j, ids, ents){
    for (const id of ids){
      const e = ents[id], r = !e && S.bank && S.bank.cid === j.client_id ? S.bank.rows.find(x => String(x.id) === id) : null, x = e || r;
      if (x && ((x.postClearedJobs || []).includes(j.id) || (e ? e.status !== "approved" || e.exportedAt || e.postUnconfirmed : r.state !== "ready")))
        return "Retry not possible: " + (e ? [e.x.vendorName, e.x.invoiceNo].filter(Boolean).join(" ") || "a bill" : "a bank line") + " of this posting was changed since (taken back, undone, No entry or posted again). Post it from To post if it is still to go.";
    }
    return "";
  },
  // {found} from any read that has it; else {found: null, read: [read, nothing found], failed: [could not be read]}
  async tallyHas(co, e){
    const t = e.tally || {}, days = [tallyToIso(t.vchDate || ""), e.x.invoiceDate].filter(Boolean).sort(), tn = postCompanyName(co), read = [], failed = [];
    const q = (what, p) => Promise.resolve().then(() => p()).then(x => { read.push(what); return x; }, () => { failed.push(what); return null; });
    const hit = vs => { vs = [].concat(vs || []).filter(v => !/^yes$/i.test(v.cancelled || "")); return PostCheck.match(e, vs) || vs.find(v => (t.guid && v.guid === t.guid) || (t.masterId && String(v.masterId || v.masterid || "") === String(t.masterId))); };
    const span = "&from=" + isoToTally(addDays(days[0], -5)) + "&to=" + isoToTally(addDays(days[days.length - 1], 5)) + Bridge.pinQ();
    if (Bridge.on() && Bridge.up()){
      const j = await q("the FinCom Bridge’s read of Tally", () => Bridge.call("/vouchers?company=" + encodeURIComponent(tn) + span, null, 120000)), f = j && hit(j.vouchers);
      if (f) return {found: f};
      const l = e.partyLedger && await q("the party’s ledger in Tally", () => Bridge.call("/ledgervouchers?company=" + encodeURIComponent(tn) + "&ledger=" + encodeURIComponent(e.partyLedger) + span));
      const h = l && [].concat(l.rows || []).find(v => days.map(isoToTally).includes(String(v.date)) && Math.abs(num(v.cr || v.dr) - r2(num(e.x.total))) < 0.01);
      if (h) return {found: {number: "", date: h.date, type: h.type}};
    }
    if (typeof TCloud === "object" && TCloud.on() && TCloud.has(co.id)){
      const bk = TCloud.book(co.id), g = bk && t.guid && await q("FinCom’s cloud copy of Tally", () => TallyProof.live("tally_vouchers?select=guid,cancelled&book_id=eq." + encodeURIComponent(bk.book) + "&guid=in.(" + encodeURIComponent('"' + String(t.guid).replace(/"/g, "") + '"') + ")"));
      if (g && g.some(x => !x.cancelled)) return {found: {number: e.tallyVchNo, date: t.vchDate}};
      const j = await q("the Tally computer’s read", () => CloudTally.call(co, PostCheck.vouchersUrl(co, tn, e))), f = j && hit(j.vouchers);
      if (f) return {found: f};
    }
    return {found: null, read, failed};
  },
  async deletedInTally(e){
    const P = PostOwner, cid = S.coId, co = CO(cid);
    if (P.delBusy[e.id]) return;
    if (postSending(cid).has(String(e.id))){ toast("Its posting to Tally is still being sent. Wait for it to finish."); return; }
    if (!billPostLive(e, cid)) return;
    if (!(e.tally && e.tally.vchDate) && !e.x.invoiceDate){ toast("This bill has no date to look for in Tally: give it its bill date first."); return; }
    P.delBusy[e.id] = true; toast("Looking in Tally…");
    let r; try { r = await P.tallyHas(co, e); } catch (err){ r = {found: null, read: [], failed: ["Tally (" + plainMsg((err && err.message) || String(err)) + ")"]}; }
    delete P.delBusy[e.id];
    if (r.found){ PostCheck.markIn(co, e, r.found); toast("Tally still has it (" + PostCheck.vchSay(r.found) + "): it stays posted."); refreshStats(cid); render(); return; }
    const said = [r.read.length && "nothing found in " + r.read.join(", "), r.failed.length && "could not read " + r.failed.join(", ")].filter(Boolean).join("; ") || "nothing here can read Tally";
    toast("FinCom could not find it, but cannot be sure it is gone (" + said + ").", {actions: [postOwner() ? {label: "I checked in Tally: not there – release", run: () => P.ownerAsk(cid, e)}
      : {label: "Ask the owner to release", run: () => P.why("Ask the owner to release it?", "Ask the owner", ": you looked in Tally and it is not there. The firm’s owner checks and releases it (Post to Tally › Errors).", e).then(a => {
        if (!a) return; e.ownerRelease = {at: new Date().toISOString(), by: whoAmI(), why: a.data, ask: true}; Store.saveEntry(cid, e);
        auditEvent("bill_release_asked", (e.x.vendorName || "") + " " + (e.x.invoiceNo || e.id) + ": " + a.data, cid); toast("Sent to the owner: Post to Tally › Errors."); render(); })}]});
  },
  // the owner: a fresh reason, the risk said, then the release (a bill already cleared: only the cloud's id)
  ownerAsk(cid, e){
    if (!postOwner()){ toast("Only the firm’s owner can release it."); return; }
    if (!billPostLive(e, cid)) return PostOwner.ownerRelease(cid, e);
    PostOwner.why("Not in Tally?", "Release", ": you looked in Tally yourself and it is not there. If it is in Tally, it will be posted twice.", e).then(a => { if (a) PostOwner.goneFromTally(cid, e, a.data); });
  },
  // the owner keeps it posted: a member's ask is dismissed
  dismissAsk(cid, e){
    if (!postOwner() || !e.ownerRelease || !e.ownerRelease.ask) return;
    delete e.ownerRelease; Store.saveEntry(cid, e); auditEvent("bill_release_ask_dismissed", (e.x.vendorName || "") + " " + (e.x.invoiceNo || e.id), cid);
    toast("Dismissed: it stays posted."); render();
  },
  why(title, ok, words, e){
    return askConfirm({title, ok, danger: true,
      body: '<p class="note">' + esc(e.x.vendorName || e.fileName || "") + (e.x.invoiceNo ? " · " + esc(e.x.invoiceNo) : "") + words + "</p>" +
        '<label class="f" style="margin-top:8px"><span>What you did in Tally</span><input type="text" id="deletedWhy" maxlength="200" placeholder="For example: deleted in the Day Book on 12-Nov"></label>',
      read: () => ((document.getElementById("deletedWhy") || {}).value || "").trim(),
      validate: why => why.length < 3 ? "Say what you did in Tally." : ""});
  },
  // the owner's word: cleared, back to To review, released once (the bridge: e.release; the cloud's id: ownerRelease)
  async goneFromTally(cid, e, why){
    if (!(await postClearReady())) return;
    const by = whoAmI(), at = new Date().toISOString(), vch = e.tallyVchNo || (e.tally && (e.tally.vchNo || e.tally.number)) || "";
    const job = postJobOf(cid, e.id), held = !!job || postIdReleased(e.id, cid) === false;
    billClearPosting(e);
    e.deletedInTally = {at, by, why, vch, verified: at};
    e.release = {at, by, why: "Deleted in Tally: " + why};
    // a bill posted through the bridge only: nothing held by the cloud, a member's ask settled here
    if (held) e.ownerRelease = {at, by, why, job: job ? job.id : ""}; else delete e.ownerRelease;
    if (e.status === "approved") unapply(e, cid, {force: true});
    Store.saveEntry(cid, e);
    auditEvent("bill_deleted_in_tally", (e.x.vendorName || e.fileName || "") + " " + (e.x.invoiceNo || e.id) + (vch ? " (voucher " + vch + ")" : "") + ": I checked in Tally: not there (" + why + "). If it is in Tally, it will be posted twice.", cid);
    if (S.coId === cid){ S.filter = "draft"; S.selected = e.id; }
    refreshStats(cid); toast("Not in Tally: back in To review, not posted again."); render();
    if (held) await PostOwner.ownerRelease(cid, e);
  },
  // FinCom's cloud frees the id (migration 174: tally_post_owner_release, an owner only, a reason, refused while sending);
  // refused or not there yet: the server's words, and it waits under Post to Tally > Errors
  async ownerRelease(cid, e){
    const o = e.ownerRelease; if (!o) return;
    const job = o.job || ((postJobOf(cid, e.id) || {}).id || "");
    if (!job){
      if (postIdReleased(e.id, cid) === false){ toast("FinCom’s cloud holds it, but its posting is not found here yet: open Post to Tally and try again."); return; }
      delete e.ownerRelease; Store.saveEntry(cid, e); toast("Released: FinCom’s cloud does not hold it."); render(); return;
    }
    try {
      const j = await TCloud.rpc("tally_post_owner_release", {p_job: job, p_id: String(e.id), p_why: o.why});
      if (!j || j.ok === false) throw new Error((j && j.error) || "not released");
      delete e.ownerRelease; Store.saveEntry(cid, e); toast("Released in FinCom’s cloud: it can be posted once more.");
    } catch (err){ o.job = job; Store.saveEntry(cid, e); toast("FinCom’s cloud did not release it: " + String((err && err.message) || err).replace(/^ERROR:\s*/i, "") + ". It waits under Post to Tally › Errors."); }
    render();
  },
  // "Not this Tally entry": the entry kept on the line (notTally), never matched again; the line waits for a person
  bankNotTally(id){
    const b = B(), r = bankRow(id);
    if (!r || r.state !== "intally" || bankOwnPost(r)) return;
    const t = bankBookEntry(r), keys = t ? bankTallyKeys(t) : r.tallyKey ? [r.tallyKey] : [];
    if (!keys.length){ toast("FinCom does not know which Tally entry this line was matched to. Read the Tally bank book again first."); return; }
    const words = t ? [fmtDate(t.date), [t.vt, t.vn].filter(Boolean).join(" "), money0(num(t.debit) || num(t.credit))].filter(Boolean).join(" \u00b7 ") : r.tallyRef || keys[0];
    askConfirm({title: "Not this Tally entry?", ok: "Not that entry", body: '<p class="note">This bank line was matched to Tally entry ' + esc(words) + ". Mark it as NOT that entry? If this entry really is it, posting will put it in Tally twice.</p>"}).then(ok => {
      if (!ok || r.state !== "intally") return;
      r.notTally = (r.notTally || []).concat(keys); r.state = "attention"; r.userSet = false;
      delete r.tallyIdx; delete r.tallyKey; r.tallyHow = ""; r.tallyRef = "";
      const fp = fpHash(r.fp || r.id);
      b.postedTags = b.postedTags || {};
      if (/^tally:/.test(String(b.postedTags[fp] || ""))) delete b.postedTags[fp];
      b.postedTags["nt:" + fp] = r.notTally.join("\n");
      if (b.hist && (b.hist.rows[r.fp] || {}).s === "tally"){ delete b.hist.rows[r.fp]; b.histVer++; }
      auditEvent("bank_not_tally", (r.dec.name || r.narr || r.id) + " " + money0(num(r.debit) || num(r.credit)) + " " + r.date + ": not Tally entry " + words, b.cid);
      saveBank({rows: true, posted: true, hist: true}); toast("Marked as not that Tally entry: it is not matched to it again. Choose its ledger and post it, or ignore it."); render();
    });
  },
  // "Not this Tally entry" (owner, item 5): an invoice matched to the wrong Tally voucher; the voucher is kept on the invoice
  // (notTally) and it goes back to review or ready
  salesNotTally(id){
    const s = SL(), v = inv(id); if (!v || v.status !== "intally") return;
    const m = v.tallyMatch || {}, key = m.key || "num:" + normInvNo(v.x.number), d = String(m.date || "");
    const words = [d ? fmtDate(/^\d{8}$/.test(d) ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6) : d) : "", m.number || v.x.number, m.amount ? money0(m.amount) : ""].filter(Boolean).join(" \u00b7 ");
    askConfirm({title: "Not this Tally entry?", ok: "Not that entry", body: '<p class="note">This invoice was matched to Tally entry ' + esc(words) + ". Mark it as NOT that entry? If this entry really is it, posting will put it in Tally twice." +
      (m.key ? "" : " FinCom did not keep which voucher it was, so every Tally voucher numbered " + esc(v.x.number || "") + " is left out for this invoice.") + "</p>"}).then(ok => {
      if (!ok || v.status !== "intally") return;
      // back to review: a person confirms it before it is posted
      v.notTally = (v.notTally || []).concat(key); const no = normInvNo(v.x.number); s.cfg.notTally = Object.assign({}, s.cfg.notTally, {[no]: v.notTally}); saveSales({cfg: true}); delete v.tallyMatch; v.postNote = ""; mapInvoice(v); v.status = "review";
      auditEvent("sales_not_tally", "Invoice " + (v.x.number || v.id) + ": not Tally entry " + words, s.cid);
      saveSales(); toast("Marked as not that Tally entry: it is not matched to it again."); render();
    });
  },
});
if (typeof PostOwner !== "undefined") globalThis.PostOwner = PostOwner;
// (each name only when declared: a test's harness loads a file's names one by one, tests/harness.js)
/* @react-lazy: end */
