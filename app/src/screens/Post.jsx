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
      {/* round 17a: an entry FinCom Bridge 2.1.8 posted by Tally's reply (it does not read back) counts as in Tally, said so */}
      {(() => { const rep = bp.byReply || 0, ver = (bp.ok || 0) - (bp.altered || 0) - rep;
        return [ver || !rep ? ver + " in Tally (verified)" : "", rep ? rep + " in Tally (Tally's reply)" : ""].filter(Boolean).join(" · "); })()}{bp.altered ? " · " + bp.altered + " altered in Tally" : ""}{bp.dup ? " · " + bp.dup + " already in Tally (not posted again)" : ""}
      {bp.checkFailed ? " · " + bp.checkFailed + " not posted: Tally could not be checked first" : ""}
      {/* round 18: reading entries from Tally is off on the bridge (prospective only): the pre-check could not be made */}
      {bp.checkNote ? " · " + bp.checkNote : ""}
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
          <td>{e.x.invoiceNo || ""}{e.x.testCopy === true && <> <span className="tag" data-test-copy="">test copy</span></>}</td><td className="n">{money(num(e.x.total))}</td>
          <td className="led" data-ledgers="">{postLedgerLine(e)}</td>
          <td className="ac" style={{ whiteSpace: "nowrap" }}>
            <button className="linkbtn" data-preview="" onClick={() => postPreviewOne("bill", e.id)}>Preview</button>{" · "}
            <button className="linkbtn" data-back="" onClick={() => postBackToReview("bill", e.id)}>Back to review</button>
          </td>
        </tr>; })}</tbody>
    </table></div> : <p className="note" data-post-empty="">Nothing waiting to post</p>}
    {bills.sending.length > 0 && <p className="note" data-post-sending="" style={{ margin: "8px 0 0" }}>{"On its way to Tally: " + bills.sending.map((e) => e.x.invoiceNo || e.x.vendorName).join(", ")}</p>}
    {/* the owner's spec of 04-Oct: the entries waiting in the queue (4) or being posted now (5), in the fixed layout */}
    <div data-post-queue=""><EntryList co={co} tab="topost" canPost={canPost} title="Waiting to post and posting now" /></div>
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
  return <><label className="chk note" data-remoteid-test="" style={{ display: "inline-flex", gap: 6, alignItems: "center", marginTop: 8 }}>
    <input type="checkbox" checked={co.postRemoteId === true} onChange={(ev) => { co.postRemoteId = !!ev.target.checked; Store.saveCompany(co); render(); }} />
    {"Send a FinCom reference id (REMOTEID) with each voucher (test)"}
  </label>
  {co.postRemoteId === true && <span className="note" data-remoteid-note="" style={{ display: "block", marginTop: 4 }}>
    {"Works once the client's posting company is confirmed (Client setup → Tally). "}
    {typeof remoteIdFor === "function" && remoteIdFor({ id: "x" }, co) === "" ? "The posting company is not confirmed yet: no REMOTEID is sent." : ""}
  </span>}
  {co.postRemoteId === true && <label className="note" data-remoteid-fixed="" style={{ display: "block", marginTop: 4 }}>
    {"REMOTEID to send instead of the FinCom id (the second-send test: type the first bill's id here, post its Duplicate; Post asks first, and the narration starts TRIAL): "}
    <input type="text" value={co.postRemoteIdFixed || ""} placeholder="empty = each bill's own id" style={{ width: 220 }}
      onChange={(ev) => { co.postRemoteIdFixed = ev.target.value.trim().slice(0, 80); Store.saveCompany(co); render(); }} />
  </label>}
  </>;
}

// round 15 (T): test bills for the owner's timing (NWS144): "Make N test copies of this bill", owners only, for a client
// whose posting company is confirmed (round 19, the owner's decision of 04-Oct: any company linked in FinCom; postTestCopiesOk
// / postTestCopies, src/js/59). It asks "This will add N test entries to <company>. Continue?"; the copies' narration
// starts "TRIAL | "
function TestCopies({ co, bills }) {
  const [pick, setPick] = useState(""), [n, setN] = useState(10), [note, setNote] = useState("");
  if (!(typeof postOwner === "function" && postOwner() && typeof postTestCopiesOk === "function" && postTestCopiesOk(co))) return null;
  const ready = bills.ready || [], id = pick && ready.some((e) => e.id === pick) ? pick : (ready[0] || {}).id || "";
  const make = async () => {
    const r = await postTestCopies(co.id, id, n);
    setNote(r.ok ? "Made " + r.ids.length + " test copies; they are in Ready to post." : r.error || "Not made.");
  };
  return <section className="post-sec" data-test-copies="">
    <h3>Test bills</h3>
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select data-tc-bill="" aria-label="Bill to copy" value={id} onChange={(ev) => setPick(ev.target.value)}>
        {ready.map((e) => <option key={e.id} value={e.id}>{(e.x.invoiceNo || e.id) + " · " + (e.x.vendorName || "") + " · " + money(num(e.x.total))}</option>)}
      </select>
      <input type="number" data-tc-n="" aria-label="How many copies" min="1" max="100" value={n} style={{ width: 70 }} onChange={(ev) => setN(ev.target.value)} />
      <button className="btn small" data-tc-make="" disabled={!id} onClick={make}>{"Make " + (num(n) || 0) + " test copies of this bill"}</button>
      <span className="note">1 to 100: new bills numbered “&lt;no&gt;-T1” onwards, the same amounts, ledgers and date, marked test copy, narration starting TRIAL; asks first.</span>
    </div>
    {note && <p className="note" data-tc-note="" style={{ margin: "6px 0 0" }}>{note}</p>}
  </section>;
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
const isOwner = () => typeof postOwner === "function" && postOwner();
// decision B (05-Oct-2026): any member of the firm who may post (owner or staff) settles an uncertain posting
const canSettle = () => typeof postCanSettle === "function" ? postCanSettle() : isOwner();

// ---------- the owner's spec of 04-Oct-2026: one fixed layout per entry (bill or bank line), the same in every tab.
// Line 1: status · bill no. · party · amount · bill date · voucher type. Line 2 (sent or posted): when (IST), by whom,
// company, Tally id, voucher date in Tally (the FY sentence when it is another year), Tally's reply in one sentence and
// "Show Tally's reply". Line 3 (not posted): reason · what to do · the button. The statuses, reasons and Tally ids are
// src/js/62 (postStatus, POST_REASONS, postTallyIdOf); every amount is money(), every date fmtDate, every time fmtIST.
// The page's own styles (never the global stylesheet)
const POST_CSS = `
.pe-list{list-style:none;margin:0;padding:0;border:1px solid var(--rule);border-radius:8px}
.pe-row{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-top:1px solid var(--rule)}
.pe-row:first-child{border-top:0}
.pe-tick{margin-top:3px;flex:none}
.pe-main{flex:1 1 auto;min-width:0}
.pe-l1{display:grid;grid-template-columns:minmax(150px,15em) minmax(70px,10em) minmax(120px,1fr) 9.5em 7.5em minmax(60px,7em);gap:2px 12px;align-items:baseline}
.pe-st{font-weight:600}
.pe-st.ok{color:var(--ok)} .pe-st.bad{color:var(--stop)} .pe-st.warn{color:var(--warn)}
.pe-amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pe-party,.pe-no{min-width:0;overflow-wrap:anywhere}
.pe-l2,.pe-l3{margin-top:3px;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.pe-l3{color:inherit;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}
.pe-l3 .pe-why{flex:1 1 260px;min-width:0}
.pe-acts{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pe-links{display:inline-flex;gap:10px;margin-left:8px;font-size:13px}
.pe-raw{white-space:pre-wrap;font-size:12px;background:var(--shade);border-radius:6px;padding:6px 8px;margin:4px 0 0}
.pe-id{font-size:11px;color:var(--muted)}
.pe-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 8px}
.pe-bar input[type=search]{flex:1 1 260px;max-width:420px}
.pe-more{position:relative;display:inline-block}
.pe-more>summary{list-style:none;cursor:pointer}
.pe-more>summary::-webkit-details-marker{display:none}
.pe-more-list{position:absolute;right:0;z-index:5;background:var(--sheet);border:1px solid var(--rule);border-radius:8px;padding:4px;min-width:260px;box-shadow:0 4px 14px rgba(0,0,0,.12)}
.pe-more-list button{display:block;width:100%;text-align:left;padding:6px 8px;background:none;border:0;cursor:pointer;color:inherit;font:inherit}
.pe-more-list button:hover{background:var(--shade)}
@media (max-width:760px){.pe-l1{grid-template-columns:1fr auto}.pe-st{grid-column:1/-1}.pe-amt{grid-column:2;grid-row:2}}
`;
const PostStyles = () => <style data-post-css="">{POST_CSS}</style>;
const TONE = { 1: "ok", 2: "ok", 3: "ok", 10: "warn", 4: "", 5: "", 6: "warn", 7: "bad", 8: "bad", 9: "bad" };
const KIND = { 6: "review", 7: "refused", 8: "stopped", 9: "cancelled", 4: "waiting", 5: "sending" };
const dateOf = (d) => (d ? fmtDate(typeof postIsoOf === "function" ? postIsoOf(d) || d : d) : "");

// line 2: when it went, who, the company, Tally's id, the voucher's date in Tally (and the year sentence), Tally's reply
function Line2({ x, owner }) {
  const { st, job, r, e } = x, posted = [1, 2, 3, 10].includes(st.code);
  const sent = posted || (st.code === 6 && (job || (e && e.exportedAt)));
  const [open, setOpen] = useState(false);
  if (!sent) return null;
  const t = (e && e.tally) || {};
  const at = st.posted || (r && r.sentAt) || t.at || (job && (job.updated_at || job.created_at)) || "";
  // who pressed Post: the member's name (a bill marked here keeps the e-mail: the member of that e-mail, by name)
  const byMail = t.by && /@/.test(t.by) ? (((typeof Cloud === "object" && Cloud.st && Cloud.st.members) || []).find((m) => m.email === t.by) || {}).name : "";
  const by = (job && job.created_by ? memberName(job.created_by) : "") || byMail || t.by || "";
  const company = (r && r.company) || (job && job.company) || t.company || "";
  const tid = st.id || {};
  const idSay = tid.vch ? "Tally id " + tid.vch : tid.batchEnd ? "in batch ending Tally id " + tid.batchEnd : "";
  const vd = typeof postIsoOf === "function" ? postIsoOf((r && r.vchDate) || t.vchDate || "") : "";
  const fy = vd && typeof postFyOf === "function" ? postFyOf(vd) : "", fyNow = typeof postFyNow === "function" ? postFyNow() : "";
  const reply = typeof postReplySentence === "function" ? postReplySentence(r || (e && e.tally && e.tally.reply) || null, at) : "";
  const raw = typeof postReplyRaw === "function" ? postReplyRaw(r, x.it) : "";
  const timing = owner && job && typeof postTimingWords === "function" ? postTimingWords(job) : "";
  const parts = [(posted ? "Posted to Tally" : "Sent to Tally") + (at ? " on " + fmtIST(at) : "") + (by ? " by " + by : ""), company ? "company " + company : "", idSay, vd ? "voucher date in Tally " + fmtDate(vd) : ""].filter(Boolean);
  return <div className="pe-l2" data-pe-line2="" data-posted-mark="">
    <span data-pe-when="">{parts.join(" · ")}</span>
    {tid.suspect && <span data-id-suspect="">{" (the Tally id typed, " + (tid.typed || "?") + ", is the bill number, not Tally's id)"}</span>}
    {fy && fyNow && fy !== fyNow && <span data-pe-fy="">{" This entry is in FY " + fy + " in Tally; change the period in Tally to see it."}</span>}
    {reply && <span data-post-reply="">{" " + reply}</span>}
    {raw && <>{" "}<button className="linkbtn" data-show-reply="" onClick={() => setOpen(!open)}>{open ? "Hide Tally's reply" : "Show Tally's reply"}</button></>}
    {timing && <>{" · "}<span data-job-timing="" title="The bridge's requests to Tally for this posting, and their time in all">{timing}</span></>}
    {open && raw && <pre className="pe-raw" data-reply-raw="">{raw}</pre>}
  </div>;
}

// Tally's (or the bridge's) own words, behind a small link, on a row not posted
function RawReply({ x }) {
  const [open, setOpen] = useState(false);
  const raw = typeof postReplyRaw === "function" ? postReplyRaw(x.r, x.it) || (x.st.reason && x.st.reason.said) || "" : "";
  if (!raw) return null;
  return <>{" "}<button className="linkbtn" data-show-reply="" onClick={() => setOpen(!open)}>{open ? "Hide Tally's reply" : "Show Tally's reply"}</button>
    {open && <pre className="pe-raw" data-reply-raw="">{raw}</pre>}</>;
}
// the buttons of a row (line 3, and the More menu of a posted row)
function RowActs({ co, x, canPost }) {
  const { st, job, e } = x, a = st.action, owner = isOwner(), settle = canSettle(), out = [];
  const bill = x.kind === "bill" && e;
  const localOnly = !job && bill;
  if (a && a.kind === "postAgain" && canPost) {
    if (x.kind === "bank") out.push(<button key="b" className="btn small primary" data-open-bank="" onClick={() => txnGo("bank", x.id)}>Post again from Bank</button>);
    else if (job && job.status === "failed") out.push(typeof postJobHeld === "function" && postJobHeld(job) ? <Wait key="w" /> : (typeof postRetryRefusal === "function" && postRetryRefusal(job)) ? null : <button key="r" className="btn small primary" data-retry="" onClick={() => CloudJobs.retry(job)}>Post again</button>);
    else if (bill && !e.exportedAt) out.push(held(e.id, co.id) ? <Wait key="w" /> : <button key="p" className="btn small primary" data-post-again="" data-retry-bill={localOnly && e.postCheckFailed ? "" : undefined} onClick={() => postAllToTally({ kind: "bill", id: e.id })}>Post again</button>);
    // marked as sent here once (a released entry, a Tally file): Tally is read live first, then posted (PostCheck.repost)
    else if (bill && e.status === "approved") out.push(held(e.id, co.id) ? <Wait key="w" /> : <button key="p" className="btn small primary" data-post-again="" onClick={() => PostCheck.repost(co, e)}>Post again</button>);
  }
  if (a && a.kind === "cancel") out.push(<button key="c" className="btn small" data-cancel-post="" onClick={async () => { try { await TCloud.rpc("tally_post_cancel", { p_id: job.id }); toast("Cancelled; nothing is sent to Tally."); } catch (err) { toast(String((err && err.message) || err)); } CloudJobs.load(true); }}>Cancel</button>);
  if (a && a.kind === "restore" && bill && e.status === "deleted") out.push(<button key="rs" className="btn small" data-restore="" onClick={() => billRestore(e.id)}>Restore the bill</button>);
  if (a && a.kind === "ledger" && x.miss && x.miss.length) out.push(<LedgerPick key="l" name={x.miss[0].ledger} role={x.miss[0].role} />);
  if (a && a.kind === "settle") {
    // decision B (05-Oct-2026): any member who may post settles it; "Not in Tally - post again" lets the FinCom Bridge
    // look in Tally first (nothing is sent until it finds the entry is not there); while it looks, the row says so
    if (settle && bill) {
      out.push(<button key="m" className="btn small" data-mark-posted="" onClick={() => PostOwner.markPosted(co.id, e, job)}>It is in Tally: mark posted (Tally id)</button>);
      const freed = !!(x.ids && (!x.ids.live || x.ids.released_at));
      if (job && !freed && !st.check) out.push(<button key="rl" className="btn small" data-release-owner="" data-repost-check="" onClick={() => PostOwner.release(co.id, e, job)}>Not in Tally – post again</button>);
    }
    if (bill && job && st.check) out.push(<span key="ck" className="note" data-check-waiting="">The FinCom Bridge looks in Tally first; nothing is sent until it finds the entry is not there.</span>);
    // the final review of 2.3.0 (M2): the member who asked, or an owner, withdraws a waiting check
    const me = (S.account && S.account.me && S.account.me.user_id) || "";
    if (bill && job && st.check && typeof st.check === "object" && st.check.id && settle && (owner || (me && st.check.asked_by === me))) out.push(<button key="wd" className="btn small" data-withdraw-check="" onClick={() => PostOwner.withdrawCheck(co.id, st.check)}>Withdraw the check</button>);
    if (bill && !job && canPost && !held(e.id, co.id) && st.check === "notfound") out.push(<button key="pa" className="btn small primary" data-post-again="" onClick={() => PostCheck.repost(co, e)}>It is not in Tally: post again</button>);
    if (bill && !job && st.check !== "checking") out.push(<button key="cn" className="btn small" data-check-now="" onClick={() => PostCheck.run(co, e, true)}>Check now</button>);
    if (bill && job && !settle) out.push(<span key="o" className="note" data-owner-settles="">A member of the firm who may post settles this here.</span>);
    // a released id (the bridge or an owner said it is not in Tally): Post again is back
    if (bill && job && x.ids && (!x.ids.live || x.ids.released_at) && !st.accepted && !st.checking && canPost && !e.exportedAt) out.push(<button key="pa2" className="btn small primary" data-post-again="" onClick={() => postAllToTally({ kind: "bill", id: e.id })}>Post again</button>);
  }
  if (a && a.kind === "correctId" && settle && (bill || job)) out.push(<button key="ci" className="btn small" data-correct-id="" onClick={() => PostOwner.correctId(co.id, e || { id: x.id, x: {} }, job, st.id && st.id.vch, st.id && st.id.typed)}>Correct the Tally id</button>);
  // a failed posting of the cloud whose Post again is refused (a deleted bill, an accepted entry), said on the row
  const rw = job && typeof postRetryWhy === "function" ? postRetryWhy(job) : "";
  if (rw && [6, 7, 8].includes(st.code)) out.push(<span key="rw" className="bk-warn" data-retry-why="">{rw}</span>);
  if (bill && [7, 8, 9].includes(st.code) && !e.exportedAt && e.status === "approved" && !st.accepted && !st.checking) out.push(<button key="bk" className="btn small" data-back="" onClick={() => postBackToReview("bill", e.id)}>Back to review</button>);
  return out.filter(Boolean);
}

// the More menu of a posted row (owners): undo the posted mark, correct the Tally id
function MoreMenu({ co, x }) {
  const { st, job, e } = x;
  if (!canSettle() || ![1, 2, 3, 10].includes(st.code)) return null;
  const stub = e || { id: x.id, x: {} };
  const close = (fn) => (ev) => { const d = ev.currentTarget.closest("details"); if (d) d.open = false; fn(); };
  const canRelease = job ? (x.ids ? !!x.ids.live && !x.ids.released_at : typeof postIdReleased === "function" && postIdReleased(x.id, co.id) === false) : x.kind === "bill";
  if (!canRelease && !(job || x.kind === "bill")) return null;
  return <details className="pe-more" data-row-more=""><summary className="linkbtn">More</summary><div className="pe-more-list">
    {canRelease && <button data-release-owner="" data-repost-check={job ? "" : undefined} onClick={close(() => PostOwner.release(co.id, stub, job))}>{job ? "Not in Tally – post again" : "This entry is not in Tally (undo the posted mark)"}</button>}
    {(job || x.kind === "bill") && <button data-correct-id="" onClick={close(() => PostOwner.correctId(co.id, stub, job, st.id && st.id.vch, st.id && (st.id.typed || st.id.vch)))}>Correct the Tally id</button>}
  </div></details>;
}

// one entry, three lines
function EntryRow({ co, x, tab, canPost, flags, picked, pick, view }) {
  const { st, d, e, job } = x, owner = isOwner();
  const posted = [1, 2, 3, 10].includes(st.code);
  const acts = view === "removed" || view === "hidden" ? [] : RowActs({ co, x, canPost });
  const block = typeof postRowRemoveBlock === "function" ? postRowRemoveBlock(x) : "";
  const rm = flags && view === "removed" ? PostFlags.removed.get(x.key) : null;
  const released = x.st.released || (x.ids && x.ids.released_at);
  const kind = st.action && st.action.kind === "ledger" ? "ledger" : KIND[st.code];
  return <li className="pe-row" data-entry-row="" data-row-key={x.key} data-status={st.code} data-job={job ? job.id : undefined} data-entries={job ? x.id : undefined}
    data-posted-entry={tab === "posted" ? x.id : undefined} data-attn-kind={kind} data-post-released={released ? "" : undefined} data-batch-n={st.id && st.id.batchN || undefined}>
    {flags && view !== "removed" && <input type="checkbox" className="pe-tick" data-row-tick="" aria-label={"Select " + (d.no || x.id)} checked={!!picked} onChange={(ev) => pick(x.key, ev.target.checked)} />}
    <div className="pe-main" data-bill-row={x.kind === "bill" && tab !== "topost" ? x.id : undefined} data-queue-row={tab === "topost" ? x.id : undefined} data-attn-kind={kind} data-attn-state={st.reason ? st.reason.id : undefined}>
      <div className="pe-l1" data-pe-line1="">
        <span className={"pe-st " + (TONE[st.code] || "")} data-pe-status={st.code} data-matched={st.code === 2 ? "" : undefined}>{st.words}</span>
        {d.found ? <>
          <span className="pe-no" data-pe-no="">{d.no || "no bill no."}{e && e.x && e.x.testCopy === true && <> <span className="tag" data-test-copy="">test copy</span></>}</span>
          <span className="pe-party" data-pe-party="">{d.party}</span>
          <span className="pe-amt" data-pe-amount="">{d.amount ? money(d.amount) : ""}</span>
          <span data-pe-date="">{dateOf(d.date)}</span>
          <span data-pe-vtype="">{d.vchType}</span>
        </> : <span className="pe-no" data-pe-missing="" style={{ gridColumn: "2 / -1" }}>{"bill details not found "}<small className="pe-id" data-pe-id="">{x.id}</small></span>}
      </div>
      <Line2 x={x} owner={owner} />
      {!posted && st.todo && <div className="pe-l3" data-pe-line3="">
        <span className="pe-why" data-why="">{st.todo}{st.code !== 6 && <RawReply x={x} />}</span>
        {acts.length > 0 && <span className="pe-acts acts">{acts}</span>}
      </div>}
      {posted && (st.todo && st.code !== 1 && st.code !== 2 ? <div className="pe-l2" data-pe-note="">{st.todo}</div> : null)}
      {posted && acts.length > 0 && <div className="pe-l3"><span className="pe-acts acts">{acts}</span></div>}
      {rm && <div className="pe-l2" data-removed-by="">{"Removed by " + (memberName(rm.by) || "a member") + " on " + fmtIST(rm.at) + (rm.why ? ": " + rm.why : "")}</div>}
      <div className="pe-l2">
        <span className="pe-links">
          {x.kind === "bill" && e && <button className="linkbtn" data-open-bill="" onClick={() => txnGo("bill", e.id)}>Open the bill</button>}
          {x.kind === "bill" && e && (e.docPath || e.fileName) && <button className="linkbtn" data-open-pdf="" onClick={() => txnOpenDoc(e.id, e.docPath, e.fileName)}>PDF</button>}
          {x.kind === "bank" && <button className="linkbtn" data-open-bill="" onClick={() => txnGo("bank", x.id)}>Open the bank line</button>}
          {view !== "removed" && view !== "hidden" && <MoreMenu co={co} x={x} />}
          {flags && view === "hidden" && <button className="linkbtn" data-row-unhide="" onClick={() => PostFlags.hideRows([x.key], false)}>Show again</button>}
          {flags && view === "removed" && PostFlags.mayRestore(x.key) && <button className="linkbtn" data-row-restore="" onClick={() => PostFlags.restoreRows([x.key])}>Restore</button>}
          {flags && !view && <button className="linkbtn" data-row-hide="" onClick={() => PostFlags.hideRows([x.key], true)}>Hide</button>}
          {flags && !view && (block ? <span className="note" data-remove-why=""><button className="linkbtn" data-row-remove="" disabled title={block}>Remove</button>{" " + block}</span>
            : <button className="linkbtn" data-row-remove="" onClick={() => postRemoveAsk(co, [x])}>Remove</button>)}
        </span>
      </div>
    </div>
  </li>;
}
// Remove (one row: any member; more: an owner): asks once, nothing in Tally or in the posting changes
async function postRemoveAsk(co, rows) {
  const ok = rows.filter((x) => !postRowRemoveBlock(x));
  if (!ok.length) { toast("These rows cannot be removed: their posting is still going on."); return; }
  const n = ok.length, kept = rows.length - n;
  const a = await askConfirm({ title: n === 1 ? "Remove this row from the list?" : "Remove " + n + " rows?", ok: "Remove", danger: true,
    body: "<p>" + esc(n === 1 ? "Remove this row from the list? The entry in Tally is not affected. You can restore it from Removed." : "Remove " + n + " rows from this list? The entries in Tally are not affected. You can restore them from Removed.") + "</p>" +
      (kept ? "<p>" + esc(kept === 1 ? "1 row is left as it is: its posting is still going on." : kept + " rows are left as they are: their posting is still going on.") + "</p>" : "") +
      '<div class="bk-form one"><label><span>Why (optional)</span><input id="removeWhy" maxlength="300" placeholder="Seen and done"></label></div>',
    read: () => ({ why: ((document.getElementById("removeWhy") || {}).value || "").trim() }) });
  if (!a || !a.ok) return;
  await PostFlags.removeRows(ok.map((x) => x.key), a.data && a.data.why);
}

// the entries of a tab: search (Posted and Errors), Hide / Remove with a selection, Show hidden, Removed
function EntryList({ co, tab, canPost, empty, title }) {
  const [q, setQ] = useState(""), [sel, setSel] = useState({}), [view, setView] = useState("");
  if (typeof postTabRows !== "function") return null;
  const flags = PostFlags.ok === true && tab !== "topost";
  const t = postTabRows(co.id, tab), hit = (x) => postRowHit(x, q);
  const list = (view === "hidden" ? t.hidden : view === "removed" ? t.removed : t.shown).filter(hit);
  const picked = list.filter((x) => sel[x.key]), acting = picked.length ? picked : list;
  const pick = (k, on) => setSel({ ...sel, [k]: on });
  const owner = isOwner();
  if (!t.shown.length && !t.hidden.length && !t.removed.length) return empty || null;
  return <section className="post-sec" data-entry-list={tab}>
    {title && <h3>{title}</h3>}
    {tab !== "topost" && <div className="pe-bar">
      <input type="search" data-posted-search={tab === "posted" ? "" : undefined} data-entry-search="" aria-label={"Search the entries under " + (tab === "posted" ? "Posted" : "Errors")}
        placeholder="Search: bill no., party, amount, Tally id" value={q} onChange={(ev) => setQ(ev.target.value)} />
      {flags && !view && list.length > 0 && <button className="btn small" data-hide-all="" onClick={() => { PostFlags.hideRows(acting.map((x) => x.key), true); setSel({}); }}>{picked.length ? "Hide selected (" + picked.length + ")" : "Hide all"}</button>}
      {flags && !view && owner && list.length > 0 && <button className="btn small" data-remove-all="" onClick={() => { postRemoveAsk(co, acting); setSel({}); }}>{picked.length ? "Remove selected (" + picked.length + ")" : "Remove all"}</button>}
      {flags && view === "removed" && owner && list.length > 1 && <button className="btn small" data-restore-all="" onClick={() => PostFlags.restoreRows(list.map((x) => x.key))}>Restore all</button>}
      {flags && (t.hidden.length > 0 || view === "hidden") && <button className="linkbtn" data-show-hidden="" onClick={() => setView(view === "hidden" ? "" : "hidden")}>{view === "hidden" ? "Back to the list" : "Show hidden (" + t.hidden.length + ")"}</button>}
      {flags && (t.removed.length > 0 || view === "removed") && <button className="linkbtn" data-show-removed="" onClick={() => setView(view === "removed" ? "" : "removed")}>{view === "removed" ? "Back to the list" : "Removed (" + t.removed.length + ")"}</button>}
    </div>}
    {q.trim() && !list.length && <p className="note" data-post-nomatch="">{"Nothing here matches “" + q.trim() + "”."}</p>}
    {!q.trim() && !list.length && !view && (empty || null)}
    {list.length > 0 && <ul className="pe-list" data-entry-view={view || "list"}>
      {list.map((x) => <EntryRow key={x.key} co={co} x={x} tab={tab} canPost={canPost} flags={flags} picked={sel[x.key]} pick={pick} view={view} />)}
    </ul>}
  </section>;
}

// Errors: the row of a press of Post that ended in neither a job nor a result, then the entries in statuses 6 to 9
function Attention({ co, canPost }) {
  const pr = typeof postRefusedFor === "function" ? postRefusedFor(co.id) : null;
  const none = <p className="note" data-post-noerrors="">Nothing needs your attention.</p>;
  return <>
    {pr && <section className="post-sec" data-post-attention=""><ul className="post-attn">
      <li data-attn-row="" data-attn-kind="post-refused">
        <span className="why"><b>{"Post did not go through at " + tallyHm(pr.at) + " (" + pr.name + ")"}</b>{" — "}<span data-why="">{pr.why}</span>{" Nothing was sent to Tally. What to do: " + pr.what}</span>
        <span className="acts"><button className="btn small" data-dismiss="" onClick={() => { S.postRefused = null; render(); }}>Dismiss</button></span>
      </li></ul></section>}
    <div data-post-attention={pr ? undefined : ""}><EntryList co={co} tab="errors" canPost={canPost} empty={pr ? null : none} /></div>
  </>;
}
// Posted: every entry in statuses 1, 2, 3 and 10, newest first
function History({ co, canPost }) {
  return <div data-post-history=""><EntryList co={co} tab="posted" canPost={canPost} empty={<p className="note" data-post-noposted="">{"Nothing posted yet for this client."}</p>} /></div>;
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
    // the owner's spec of 04-Oct: who marked what (tally_post_marks) and the rows hidden or removed (migration 49)
    if (typeof PostMarks === "object") PostMarks.load(co.id);
    if (typeof PostChecks === "object") PostChecks.load(co.id);
    if (typeof PostFlags === "object") PostFlags.load();
    // round 17a: what a finished posting of FinCom's cloud put in Tally is marked here when the client's page is opened
    if (typeof postReconcile === "function") postReconcile(co.id);
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
      <PostStyles />
      <StatusLine co={co} />
      <RunLine co={co} />
      <PostTabs now={tab} counts={counts} pick={pick} />
      {tab === "topost" && <div data-post-panel="topost" role="tabpanel">
        <Ready co={co} bills={bills} canPost={canPost} more={more} />
        <TestCopies co={co} bills={bills} />
        {(nb > 0 || ns > 0) && <p className="note" data-post-others="" style={{ margin: "8px 0 0" }}>{"Also ready, posted from their own pages: "}
          {nb > 0 && <button className="linkbtn" onClick={() => goStep("post", "bank")}>{plural(nb, "bank line", "bank lines")}</button>}{nb > 0 && ns > 0 && " · "}
          {ns > 0 && <button className="linkbtn" onClick={() => goDocType("sales")}>{plural(ns, "sales invoice", "sales invoices")}</button>}</p>}
        {steps && <ImportSteps co={co} ledgers={ledgers} />}
      </div>}
      {tab === "posted" && <div data-post-panel="posted" role="tabpanel"><History co={co} canPost={canPost} /></div>}
      {tab === "errors" && <div data-post-panel="errors" role="tabpanel"><Attention co={co} canPost={canPost} /></div>}
    </section>
  );
}
// the old name of this page (a client page with no other screen): the same page
export const Export = PostStep;
