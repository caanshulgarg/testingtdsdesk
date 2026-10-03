// Step 3 of a client, "Post to Tally". Was viewPostStep() (src/js/02) and viewExport() (src/js/27).
// Review of 02-Oct-2026, second pass (Testing AAD, screen of 17:43): the page shows only what needs a decision.
//   1. one status line: "Posting into GARG SHEKHAR & COMPANY · Tally open on NWS144 · read 17:43 · Update now"; a second
//      line only when something is wrong, saying what to do, with one button where it helps; the bridge's version and
//      "Ready" are under More (postStatusFor, src/js/59);
//   2. "Ready to post": approved bills only, one row each (date, party, bill no., amount, the ledgers on one line), one
//      button "Post N to Tally"; "Nothing waiting to post" when there are none;
//   3. "Needs your attention", only when it has rows: a bill once, one line of reason, at most two buttons. A bill sent
//      and not confirmed in Tally is read afresh before it is called missing (PostCheck), and Post again reads Tally
//      live first;
//   4. every count from postCounts (src/js/59): the tab badge, the header chip, the dashboard tile and the button;
//   5. the postings of FinCom's cloud: one still failed is under "Needs your attention" (Retry, Dismiss); the rest is
//      History, hidden behind "History (N)", a failed posting finished by a later one shown as one line.
//   6. three tabs under the status line (plan piped-moseying-frost, item 1b): To post (Ready to post, the other entries
//      ready), Posted (the cloud's postings that went through, newest first, not folded away) and Errors (Needs your
//      attention, "Checking whether it reached Tally", the ones Tally refused). Each entry is in one tab only (postBucket),
//      the counts are postCounts (postTabCounts), the tab with work opens by itself (Errors when any), and the tab chosen
//      is kept for the client (S.postTabs).
// Posting itself stays in the business logic (postAllToTally, postBillsToTally, …).
import { useState } from "react";
import { notAllowedRest } from "../parts/BankChecks.jsx";

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const OPTIONAL_HELP = "Tally does not show these in the Day Book: Display More Reports → Exception Reports → Optional Vouchers. Open one and press Ctrl+L to make it a regular entry.";

// 1. the status line, and a second line only when something is wrong
function StatusLine({ co }) {
  const s = postStatusFor(co), p = s.problem;
  return <>
    <div className="post-status" data-post-line="">
      <span>{"Posting into "}<b>{s.company}</b></span>
      {s.where && <span data-post-where="">{"· " + s.where}</span>}
      {s.reading ? <span data-post-read="" data-reading="">{"· Reading now…"}</span> : s.read ? <span data-post-read="">{"· read " + tallyHm(s.read)}</span> : null}
      {s.where && <span>{"· "}<button className="linkbtn" data-update-now="" onClick={() => tallyUpdateNow(co.id)}>Update now</button></span>}
    </div>
    {p && <div className="bk-alert bad post-problem" data-post-problem={p.kind} data-not-allowed={p.kind === "stop" ? "" : undefined} data-guessed={p.kind === "stop" && !p.msg ? "" : undefined}>
      <span>{p.msg ? <><b>Not sent to Tally: choose the Tally company.</b> {notAllowedRest(p.msg)} The bills are still waiting here.</> : p.text}</span>
      {p.button && p.go && <button className="btn small primary" data-post-action="" data-choose-company={p.kind === "stop" ? "" : undefined} onClick={p.go}>{p.button}</button>}
    </div>}
  </>;
}

// what the last posting run said, in one line (and what is going on while it runs)
function RunLine({ co }) {
  const bp = S.billPost || {}, note = S.postNote && S.postNote.cid === co.id ? S.postNote : null, bc = S.billCheck || {};
  const failed = (bp.failed || []).filter((f) => !f.unread);
  return <>
    {bp.busy && <p className="bk-alert" data-post-busy="" style={{ margin: "0 0 8px" }}>{bp.busy}</p>}
    {bp.error && <p className="bk-alert bad" style={{ margin: "0 0 8px" }}>{bp.error}</p>}
    {bp.cancelled && <p className="note" style={{ margin: "0 0 8px" }}>{bp.cancelled}</p>}
    {bp.done && !bp.notAllowed && <p className={"note" + (failed.length ? " bad" : "")} data-post-result="" style={{ margin: "0 0 8px" }}>
      {(bp.ok || 0) - (bp.altered || 0) + " in Tally (verified)"}{bp.altered ? " · " + bp.altered + " altered in Tally" : ""}{bp.dup ? " · " + bp.dup + " already in Tally (not posted again)" : ""}
      {bp.checkFailed ? " · " + bp.checkFailed + " not posted: Tally could not be checked first" : ""}
      {failed.length ? " · " + failed.length + " failed and went back to To review (" + failed.map((f) => f.no + ": " + f.msg).join("; ") + ")" : ""}
      {(bp.masters || []).length > 0 && <span data-post-masters="">{" · Ledgers: " + bp.masters.map((m) => m.name + ": " + m.word).join(", ")}</span>}
      {bp.optional > 0 && <span>{" · " + bp.optional + " went in as Optional vouchers. " + OPTIONAL_HELP}</span>}
    </p>}
    {/* round 14c (C7): Tally's own reply counts for the run, on a line of their own (the result line keeps saying each entry's state in FinCom's words: ALTERED is never "created") */}
    {bp.done && !bp.notAllowed && bp.reply && <p className="note" data-post-reply="" style={{ margin: "0 0 8px" }}>{bp.reply}</p>}
    {note && <p className={"note" + (note.level === "bad" ? " bad" : "")} data-post-note="" style={{ margin: "0 0 8px" }}>{note.text}</p>}
    {bc.error && <p className="note bad" style={{ margin: "0 0 8px" }}>{bc.error}</p>}
    {bc.at && <p className="note" data-post-check="" style={{ margin: "0 0 8px" }}>{bc.checked + " sent bills checked in " + bc.company + " at " + tallyHm(bc.at) + ": " + bc.found + " found"}
      {(bc.missing || []).length ? " · not found: " + bc.missing.map((id) => (D().entries[id] || { x: {} }).x.invoiceNo || id).join(", ") : ""}
      {(bc.wrongDate || []).length ? " · under another date in Tally: " + bc.wrongDate.map((w) => w.no + " (" + fmtDate(w.got) + ")").join(", ") : ""}</p>}
  </>;
}

// 2. Ready to post
function Ready({ co, bills, canPost, more }) {
  const closed = (e) => typeof ClosedP === "object" ? ClosedP.note(e.x.invoiceDate, !!(e.snapshot && e.snapshot.tds)) : [];
  const n = bills.ready.length, why = n > 0 ? postWhyBlocked(co, canPost) : null;
  return <section className="post-sec" data-post-ready="">
    <h3>Ready to post</h3>
    {n ? <div className="tblwrap"><table className="data" data-post-table="">
      <thead><tr><th>Date</th><th>Party</th><th>Bill no.</th><th className="n">Amount</th><th>Ledgers</th><th></th></tr></thead>
      <tbody>{bills.ready.map((e) => { const cp = closed(e);
        return <tr key={e.id} data-post-row={e.id} data-bill-row={e.id} data-kind="bill">
          <td>{fmtDate(e.x.invoiceDate)}{cp.length > 0 && <> <span className="tag warn cp-tag" title={"Closed period: " + cp.join("; ")}>closed period</span></>}</td>
          <td>{e.x.vendorName}{e.noteKind && <> <span className="tag">{e.noteKind === "credit" ? "credit note" : "debit note"}</span></>}</td>
          <td>{e.x.invoiceNo || ""}</td><td className="n">{money(num(e.x.total))}</td>
          <td className="led" data-ledgers="">{postLedgerLine(e)}</td>
          <td className="ac" style={{ whiteSpace: "nowrap" }}>
            <button className="linkbtn" data-preview="" onClick={() => postPreviewOne("bill", e.id)}>Preview</button>{" · "}
            <button className="linkbtn" data-back="" onClick={() => postBackToReview("bill", e.id)}>Back to review</button>
          </td>
        </tr>; })}</tbody>
    </table></div> : <p className="note" data-post-empty="">Nothing waiting to post</p>}
    {bills.sending.length > 0 && <p className="note" data-post-sending="" style={{ margin: "8px 0 0" }}>{"On its way to Tally: " + bills.sending.map((e) => e.x.invoiceNo || e.x.vendorName).join(", ")}</p>}
    <div className="row" style={{ marginTop: 10, gap: 8, alignItems: "center" }}>
      {n > 0 && <button className="btn primary" data-post-main="" disabled={!!why} onClick={() => doAct("postAll")}>{"Post " + n + " to Tally"}</button>}
      {n > 0 && why && <span className={"note" + (why.kind === "busy" ? "" : " bad")} data-post-why={why.kind}>{why.text}</span>}
      {more}
    </div>
    <RemoteIdBox co={co} />
  </section>;
}
// round 14c (C3): why Post is blocked, in plain words beside the button (the gate's own words, postToProblem, not only a
// toast after a press): null when it can be pressed
function postWhyBlocked(co, canPost) {
  if (S.billPost && S.billPost.busy) return { kind: "busy", text: S.billPost.busy };
  if (!canPost) return { kind: "nowhere", text: "No Tally to post to from here: use More → Download Tally file." };
  const gate = typeof postToProblem === "function" && co.postTo ? postToProblem(co, "") : "";
  return gate ? { kind: "gate", text: gate } : null;
}
// round 14c (C7, owner item 4, a test): "Send a FinCom reference id (REMOTEID) with each voucher (test)", owners only,
// off by default, kept on the client (co.postRemoteId; voucherXml, src/js/01 puts REMOTEID="<the entry's FinCom id>")
function RemoteIdBox({ co }) {
  if (!(typeof postOwner === "function" && postOwner())) return null;
  return <label className="chk note" data-remoteid-test="" style={{ display: "inline-flex", gap: 6, alignItems: "center", marginTop: 8 }}>
    <input type="checkbox" checked={co.postRemoteId === true} onChange={(ev) => { co.postRemoteId = !!ev.target.checked; Store.saveCompany(co); render(); }} />
    {"Send a FinCom reference id (REMOTEID) with each voucher (test)"}
  </label>;
}

// a ledger of a waiting bill that Tally does not have: choose Tally's ledger (for every bill using it), or create it
function LedgerPick({ name, role }) {
  const [to, setTo] = useState(() => suggestLedgers(name, role, 1)[0] || "");
  return <>
    <select value={to} aria-label={"Tally ledger for " + name} onChange={(ev) => setTo(ev.target.value)}>
      <option value="">— Choose the Tally ledger —</option>{(S.bank.ledgers.list || []).map((l) => <option key={l.name}>{l.name}</option>)}
    </select>
    <button className="btn small primary" onClick={() => billFixPick(name, role, to)}>Replace</button>
    <button className="btn small" onClick={() => billFixLedger(role, name, null)}>Create in Tally</button>
  </>;
}

// round 4, item 7: an entry is posted again only once FinCom's cloud has released its FinCom id (tally_post_ids: the
// bridge said it is not in Tally, or the posting failed as a whole; postIdReleased, src/js/59). Not known (an older
// cloud, the table not readable): as before. Held: these words, no button
const held = (id, cid) => typeof postIdReleased === "function" && postIdReleased(id, cid) === false;
const Wait = () => <span className="note" data-post-wait="">Waiting for the bridge to confirm it is not in Tally</span>;
// round 5 (S3, C6): an owner settles an entry Tally accepted but nobody confirmed (PostOwner, src/js/59): Mark posted
// (voucher no.) or Not in Tally — release (reason). Others see the words only; without a posting of the cloud naming the
// entry there is nothing to mark
function OwnerActs({ co, e }) {
  const job = typeof postJobOf === "function" ? postJobOf(co.id, e.id) : null;
  if (!job || typeof postOwner !== "function" || !postOwner()) return null;
  return <>
    <button className="btn small" data-mark-posted="" onClick={() => PostOwner.markPosted(co.id, e, job)}>Mark posted (voucher no.)</button>
    <button className="btn small" data-release-owner="" onClick={() => PostOwner.release(co.id, e, job)}>Not in Tally — release (reason)</button>
  </>;
}
// C6: a bill not found in Tally whose id the cloud still holds; nothing of the bridge releases the id of a finished posting
const Unconfirmed = ({ co, e }) => <><span className="note" data-post-wait="" data-post-unconfirmed="">Posted, not yet confirmed. If it is not in Tally, an owner can release it here.</span><OwnerActs co={co} e={e} /></>;
// one bill needing attention: {kind, why, acts}
function billItem(co, e, canPost) {
  if (e.postCheckFailed) return { kind: "checkfailed", why: e.postCheckFailed.message || "Could not check Tally, not posted. Try again.",
    acts: canPost ? (held(e.id, co.id) ? <Wait /> : <button className="btn small primary" data-retry-bill="" onClick={() => postAllToTally({ kind: "bill", id: e.id })}>Retry</button>) : null };
  const miss = !e.exportedAt && !e.postUnconfirmed ? postMissingLedgers(e) : [];
  if (miss.length) return { kind: "ledger", why: "Ledger “" + miss[0].ledger + "” is not in Tally" + (miss.length > 1 ? " (and " + (miss.length - 1) + " more)" : ""),
    acts: <LedgerPick name={miss[0].ledger} role={miss[0].role} /> };
  // sent and not confirmed (a Tally file, posted and not read back, or not found in Tally's entries since)
  const v = PostCheck.view(e), was = e.goneFromTally ? "Posted" : e.exportedAt ? (e.postedVia === "bridge" ? "Posted" : "In a Tally file") : "Sent";
  const why = (v.state === "notfound" ? "" : was + (PostCheck.postedAt(e) ? " " + tallyHm(PostCheck.postedAt(e)) : "") + ", not confirmed in Tally. ") + v.text + (v.state === "notfound" ? "." : "");
  const check = <button className="btn small" data-check-now="" onClick={() => PostCheck.run(co, e, true)}>Check now</button>;
  return { kind: e.goneFromTally ? "gone" : e.exportedAt ? "sent" : "unread", state: v.state, why,
    acts: v.state === "checking" ? null : v.state === "notfound" ? <>{canPost && (held(e.id, co.id) ? <Unconfirmed co={co} e={e} /> : <button className="btn small primary" data-post-again="" onClick={() => PostCheck.repost(co, e)}>Post again</button>)}{check}</> : check };
}

// a bill row of Errors: number, party, date, amount — why
const BillWhyText = ({ text }) => <span className="why">{text}</span>;
const BillWhy = ({ e, why }) => <span className="why"><b>{e.x.invoiceNo || "—"}</b>{" · " + e.x.vendorName + " · " + fmtDate(e.x.invoiceDate) + " · " + money(num(e.x.total)) + " — "}<span data-why="">{why}</span></span>;
// 3. Needs your attention: the bills to look at, the ones sent when Tally stopped answering, the ones Tally refused, and
// the failed postings of the cloud (a refused bill of such a posting is listed inside it)
function Attention({ co, bills, canPost }) {
  const rows = bills.attention.map((e) => ({ e, ...billItem(co, e, canPost) }));
  const unknown = bills.unknown || [], refused = bills.refused || [], why = bills.why || {};
  const inJob = (j) => refused.filter((e) => why[e.id] && why[e.id].job.id === j.id);
  const alone = typeof postRefusedAlone === "function" ? postRefusedAlone(bills) : refused;
  const refusedRow = (e, nested) => <li key={e.id} data-attn-row="" data-bill-row={e.id} data-attn-kind="refused">
    <BillWhy e={e} why={"Tally refused it" + (why[e.id] && why[e.id].job.created_at ? " (posting of " + tallyHm(why[e.id].job.created_at) + ")" : "") + ": " + ((why[e.id] && why[e.id].reason) || "Tally did not take it")} />
    <span className="acts">
      {!nested && canPost && (held(e.id, co.id) ? <Wait /> : <button className="btn small primary" data-post-again="" onClick={() => postAllToTally({ kind: "bill", id: e.id })}>Post again</button>)}
      <button className="btn small" data-back="" onClick={() => postBackToReview("bill", e.id)}>Back to review</button>
    </span>
  </li>;
  // 03-Oct-2026: a press of Post that ended in neither a job nor a result (an error on the way, a stop said only in a toast)
  const pr = typeof postRefusedFor === "function" ? postRefusedFor(co.id) : null;
  if (!rows.length && !bills.jobs.length && !unknown.length && !refused.length && !pr) return <p className="note" data-post-noerrors="">Nothing needs your attention.</p>;
  return <section className="post-sec" data-post-attention="">
    <h3>Needs your attention</h3>
    <ul className="post-attn">
      {pr && <li data-attn-row="" data-attn-kind="post-refused">
        <BillWhyText text={<><b>{"Post did not go through at " + tallyHm(pr.at) + " (" + pr.name + ")"}</b>{" — "}<span data-why="">{pr.why}</span>{" Nothing was sent to Tally. What to do: " + pr.what}</>} />
        <span className="acts"><button className="btn small" data-dismiss="" onClick={() => { S.postRefused = null; render(); }}>Dismiss</button></span>
      </li>}
      {rows.map((r) => <li key={r.e.id} data-attn-row="" data-bill-row={r.e.id} data-attn-kind={r.kind} data-attn-state={r.state || ""}>
        <BillWhy e={r.e} why={r.why} />
        {r.acts && <span className="acts">{r.acts}</span>}
      </li>)}
      {unknown.map((e) => { const rs = (why[e.id] && why[e.id].reason) || "";
        // Tally took it, the bridge could not confirm it: the cloud keeps it in state unknown and looks again; no Retry or Post again
        return <li key={e.id} data-attn-row="" data-bill-row={e.id} data-attn-kind="unknown">
          <BillWhy e={e} why={"Posted, not yet confirmed — checking whether it reached Tally" + (rs && !/^Checking whether/i.test(rs) ? " (" + rs.replace(/…$/, "") + ")" : "") + ". It is not sent again until the Tally computer has answered, or an owner has settled it here."} />
          {typeof postOwner === "function" && postOwner() && <span className="acts"><OwnerActs co={co} e={e} /></span>}
        </li>; })}
      {alone.map((e) => refusedRow(e, false))}
      {bills.jobs.map((j) => { const left = CloudJobs.leftToSend(j), all = (CloudJobs.idsOf(j) || []).length, mine = inJob(j);
        return <li key={j.id} data-attn-row="" data-job={j.id} data-attn-kind="job">
          <span className="why"><b>{"Posting of " + fmtDateTime(j.created_at)}</b>{" · " + (j.status === "cancelled" ? "cancelled" : "failed") + ": "}<span data-why="">{plainMsg(j.message) || "Tally did not take it"}</span>
            {left ? <span className="nr">{" · " + left + " of " + all + " still to send"}</span> : null}</span>
          <span className="acts">
            {typeof postJobHeld === "function" && postJobHeld(j) ? <Wait /> : (typeof postRetryRefusal === "function" && postRetryRefusal(j)) ? null : <button className="btn small primary" data-retry="" onClick={() => CloudJobs.retry(j)}>Retry</button>}
            {CloudJobs.dismissOk && <button className="btn small" data-dismiss="" onClick={() => CloudJobs.dismiss(j)}>Dismiss</button>}
          </span>
          {/* round 14c (C3, C5a): why Retry is refused, on the row */}
          {typeof postRetryWhy === "function" && postRetryWhy(j) && <span className="bk-warn" data-retry-why="">{postRetryWhy(j)}</span>}
          <Reply j={j} />
          {mine.length > 0 && <ul className="post-attn post-attn-in">{mine.map((e) => refusedRow(e, true))}</ul>}
        </li>; })}
    </ul>
  </section>;
}

// round 14c (C7): Tally's reply for a posting (created / altered / exceptions / ignored and its words), so a second import
// of the same REMOTEID can be read as CREATED, ALTERED, COMBINED or IGNORED
function Reply({ j }) {
  const r = typeof postReply === "function" ? postReply(j.results) : null;
  return r && r.text ? <span className="note" data-post-reply="" style={{ display: "block" }}>{r.text}</span> : null;
}
// 5. Posted: the postings of FinCom's cloud that need nothing, newest first (a failed posting finished by a later one is
// one line with it); each names the entries it put in Tally (data-entries)
const NTH = ["", "second try", "third try", "fourth try"];
// round 11 (owner item 6): the entries a finished posting put in Tally, listed under it (postPostedEntries, src/js/59).
// One verified in Tally can be deleted there by hand since: an owner sees "Not in Tally — release (reason)" here too, the
// same box and call as on Errors (PostOwner.release); released, the entry says so and Post again is back by the
// postIdReleased gating. Staff see the entries only. An id the cloud never held (an older posting) has nothing to release
function PostedEntries({ co, job, ents }) {
  const owner = typeof postOwner === "function" && postOwner();
  return <ul className="post-attn post-attn-in" data-posted-entries="">
    {ents.map((x) => <li key={x.id} data-posted-entry={x.id} data-post-released={x.idState === "released" ? "" : undefined}>
      <span className="why"><b>{x.no}</b>{x.e.x && x.e.x.vendorName ? " · " + x.e.x.vendorName : ""}{x.idState === "released" ? " — released; it can be posted again" : ""}</span>
      {owner && x.idState !== "released" && x.idState !== "none" && <span className="acts">
        <button className="btn small" data-release-owner="" onClick={() => PostOwner.release(co.id, x.e, job)}>Not in Tally — release (reason)</button>
      </span>}
    </li>)}
  </ul>;
}
function History({ co }) {
  const h = typeof postPostedRows === "function" ? postPostedRows(co.id) : CloudJobs.history(co.id);
  if (!h.length) return <p className="note" data-post-noposted="">{"Nothing posted through FinCom’s cloud yet for this client."}</p>;
  return <section className="post-sec post-hist" data-post-history="" data-history-n={h.length}>
    <ul>{h.map((x) => { const j = x.job, tries = x.tries.length, at = tallyHm(x.at);
      const text = x.state === "posted" ? "Posted " + at + (tries ? " (" + (NTH[tries] || "after " + (tries + 1) + " tries") + ")" : "")
        : x.state === "partly" ? "Posted " + x.ok + " of " + x.n + " at " + at
        : x.state === "nothing" ? (j.status === "cancelled" ? "Cancelled" : "Failed") + " " + at + "; every entry was put in Tally another way"
        : (j.status === "cancelled" ? "Cancelled " : "Failed ") + at + (j.dismissed_at ? ", dismissed by " + memberName(j.dismissed_by) + " " + tallyHm(j.dismissed_at) : "");
      const ents = typeof postPostedEntries === "function" ? postPostedEntries(co.id, j) : [];
      return <li key={j.id} data-job={j.id} data-hist-state={x.state} data-entries={[...CloudJobs.okIn(j)].join(" ")}>
        <span data-hist-text="">{text}</span>{" · " + plural(Math.max(x.ok, x.state === "posted" ? x.n : 0) || x.n, "entry", "entries") + " · " + j.company}
        {j.dismissed_at && !j.dismiss_auto && x.state !== "posted" && <>{" "}<button className="linkbtn" data-undismiss="" onClick={() => CloudJobs.undismiss(j)}>Show under Errors</button></>}
        <Reply j={j} />
        {ents.length > 0 && <PostedEntries co={co} job={j} ents={ents} />}
      </li>; })}</ul>
  </section>;
}

// the three tabs: [id, label, count]
const TABS = [["topost", "To post"], ["posted", "Posted"], ["errors", "Errors"]];
function PostTabs({ now, counts, pick }) {
  return <div className="post-tabs" role="tablist" data-post-tabs="">
    {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={now === id} data-post-tab={id} className={"post-tab" + (now === id ? " on" : "") + (id === "errors" && counts[id] ? " bad" : "")}
      onClick={() => pick(id)}>{label}{" "}<span className="sbar-n" data-tab-n="">{counts[id] || 0}</span></button>)}
  </div>;
}

function ImportSteps({ co, ledgers }) {
  return <div className="bk-alert" data-import-steps="" style={{ margin: "10px 0 0" }}><b>Import into Tally</b>
    <ol className="post-import">
      <li>More → Download Tally file, and unzip it to get the .xml file.</li>
      <li>Open <b>{co.tallyName || co.name}</b> in TallyPrime.</li>
      <li>Check these ledgers exist in it with the same names{ledgers.length ? ": " + ledgers.join(", ") : ""}.</li>
      <li>Go to Gateway of Tally, then Import, then Transactions, and choose the .xml file.</li>
      <li>{co.createOptional ? "The vouchers arrive as Optional. Review them in Day Book (include optional vouchers), then regularise them." : "The vouchers post straight to the books. Review them in Day Book."}</li>
    </ol>
    <p className="note" style={{ margin: "8px 0 0" }}>The file names this company, so Tally will not import it into a different one.</p>
  </div>;
}

// the whole step
export function PostStep() {
  const co = CO(), v = Object.values(D().entries);
  const [steps, setSteps] = useState(false);
  CloudJobs.load();
  // with Tally's ledger list at hand, names are put in Tally's spelling first (the ones Tally lacks need attention)
  if (postLedgerList(co.id)) canonicalizeBills(v.filter((e) => e.status === "approved" && !e.exportedAt));
  const bills = postBills(co.id) || { ready: [], attention: [], sending: [], unknown: [], refused: [], jobs: [], why: {} };
  const canPost = canPostTally(co), bc = S.billCheck || {};
  // a bill sent and not confirmed is read afresh before it is called missing (PostCheck, src/js/59); the cloud copy's
  // check (TallyProof) and the company found by itself as before
  setTimeout(() => {
    if (typeof PostIds === "object") PostIds.load(co.id);
    TallyProof.check(co.id).catch(() => {});
    if (!co.postTo) autoPostTo(co).catch(() => {});
    bills.attention.filter((e) => (e.exportedAt || e.postUnconfirmed) && PostCheck.due(e)).forEach((e) => PostCheck.run(co, e).catch(() => {}));
  }, 0);
  const waiting = bills.ready, unsent = v.filter((e) => e.status === "approved" && !e.exportedAt).length, sent = v.filter(billInTally).length, undoable = v.filter((e) => e.exportedAt && e.tally && e.tally.guid).length;
  const ledgers = [...new Set(waiting.flatMap((e) => (e.snapshot ? e.snapshot.lines : []).map((l) => l.ledger)))].filter(Boolean);
  const others = postRows(co).filter((r) => r.kind !== "bill"), nb = others.filter((r) => r.kind === "bank").length, ns = others.length - nb;
  const status = postStatusFor(co);
  // the tab: the one chosen for this client, else the one with work (Errors when there are any)
  const counts = typeof postTabCounts === "function" ? postTabCounts(co.id) : { topost: waiting.length, posted: 0, errors: 0 };
  S.postTabs = S.postTabs || {};
  const tab = S.postTabs[co.id] || (counts.errors ? "errors" : "topost");
  const pick = (id) => { S.postTabs[co.id] = id; render(); };
  const close = (fn) => (ev) => { const d = ev.currentTarget.closest("details"); if (d) d.open = false; fn(); };
  const more = <details className="bk-menu" data-more="post"><summary className="btn">More</summary><div className="bk-menu-list">
    {status.more && <div className="note" data-post-bridge="" style={{ padding: "6px 10px" }}>{status.more}</div>}
    <button disabled={!unsent} onClick={close(() => doAct("xml"))}>Download Tally file<small>The approved bills not sent yet, as a file to import in Tally</small></button>
    {/* read by doAct("xml") */}
    <label className="chk" style={{ padding: "4px 10px" }}><input type="checkbox" id="markSent" defaultChecked /> Mark these as sent after download</label>
    <button onClick={close(() => doAct("csv"))}>Download TDS register (Excel CSV)</button>
    {canPost && undoable > 0 && <button onClick={close(() => doAct("billUnpost"))}>Take an entry back out of Tally<small>{undoable} posted bills can be removed from Tally from here</small></button>}
    {canPost && sent > 0 && <button disabled={!!bc.busy} onClick={close(() => doAct("billCheck"))}>{bc.busy ? "Checking Tally…" : "Check sent bills in Tally"}<small>Confirms that every bill marked as sent is really in Tally</small></button>}
    {waiting.length > 1 && <button onClick={close(() => doAct("billBackAll"))}>Send all {waiting.length} bills back to review</button>}
    <button onClick={close(() => setSteps(!steps))}>{steps ? "Hide the import steps" : "How to import the file into Tally"}</button>
    <button className="danger" onClick={close(() => doAct("clearSent"))}>Clear sent invoices older than 90 days<small>They move to “Deleted”, where each can be restored; deductee year totals are kept</small></button>
  </div></details>;
  return (
    <section className="poststep" data-post-page="">
      <StatusLine co={co} />
      <RunLine co={co} />
      <PostTabs now={tab} counts={counts} pick={pick} />
      {tab === "topost" && <div data-post-panel="topost" role="tabpanel">
        <Ready co={co} bills={bills} canPost={canPost} more={more} />
        {(nb > 0 || ns > 0) && <p className="note" data-post-others="" style={{ margin: "8px 0 0" }}>{"Also ready, posted from their own pages: "}
          {nb > 0 && <button className="linkbtn" onClick={() => goStep("post", "bank")}>{plural(nb, "bank line", "bank lines")}</button>}{nb > 0 && ns > 0 && " · "}
          {ns > 0 && <button className="linkbtn" onClick={() => goDocType("sales")}>{plural(ns, "sales invoice", "sales invoices")}</button>}</p>}
        {steps && <ImportSteps co={co} ledgers={ledgers} />}
      </div>}
      {tab === "posted" && <div data-post-panel="posted" role="tabpanel"><History co={co} /></div>}
      {tab === "errors" && <div data-post-panel="errors" role="tabpanel"><Attention co={co} bills={bills} canPost={canPost} /></div>}
    </section>
  );
}
// the old name of this page (a client page with no other screen): the same page
export const Export = PostStep;
