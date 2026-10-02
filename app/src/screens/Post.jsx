// Step 3 of a client, "Post to Tally": everything approved and not yet in Tally, in one place — purchase bills, bank
// lines, sales invoices. Was viewPostStep() (src/js/02) and viewExport() (src/js/27).
// Review of 02-Oct-2026 (C15-C18): one line (what it posts into, through which bridge, ready or what to do), one table of
// the entries with Preview / Post / Back to review, one main button "Post N to Tally" (each voucher shown as it goes to
// Tally first), everything else under More, and the finished postings below (QueueJobs).
//
// Posting itself stays in the business logic: postBillsToTally, checkBillsInTally, exportXml, … are reached through
// doAct("billPost") and friends; bank buttons through bankAct(). What a posting run reports back lives in
// S.billPost (bills) and S.bank.postReport (bank); S.billCheck is the last "Check sent bills in Tally".
import { useState } from "react";
import { PostReport, notAllowedRest } from "../parts/BankChecks.jsx";

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const ROLE = { party: "Supplier", expense: "Expense", gst: "Input GST", tds: "TDS payable", roundoff: "Round off", "rcm-in": "RCM input", "rcm-out": "RCM payable" };
const OPTIONAL_HELP = "Tally does not show these in the Day Book. See them in TallyPrime: Display More Reports → Exception Reports → Optional Vouchers (or in the Day Book: F12 / Ctrl+B → show Optional vouchers). Open one and press Ctrl+L to make it a regular entry. To post regular entries directly, untick “Post … as Optional vouchers” in Client setup → Tally.";

// a ledger used by waiting bills that Tally does not have: pick the right one, or create it
function LedgerFix({ x }) {
  const [to, setTo] = useState(() => suggestLedgers(x.name, x.role, 1)[0] || "");
  return (
    <tr>
      <td><b>{x.name}</b></td><td>{ROLE[x.role] || x.role}</td><td className="n">{x.bills}</td>
      <td><select value={to} aria-label={"Tally ledger for " + x.name} onChange={(ev) => setTo(ev.target.value)}>
        <option value="">— Choose the Tally ledger —</option>{(S.bank.ledgers.list || []).map((l) => <option key={l.name}>{l.name}</option>)}
      </select></td>
      <td style={{ whiteSpace: "nowrap" }}>
        <button className="btn small primary" onClick={() => billFixPick(x.name, x.role, to)}>Replace</button>{" "}
        <button className="linkbtn" onClick={() => billFixLedger(x.role, x.name, null)}>Create in Tally</button>
      </td>
    </tr>
  );
}

// what the last posting run said
function PostResult({ bp, waiting }) {
  const unconf = waiting.filter((e) => e.postUnconfirmed && !e.postUnconfirmed.pending), failed = bp.failed || [], notPosted = failed.filter((f) => !f.unread).length;
  return <>
    {bp.busy && <p className="bk-alert" style={{ margin: "10px 0 0" }}>{bp.busy}</p>}
    {bp.error && <p className="bk-alert bad" style={{ margin: "10px 0 0" }}>{bp.error}</p>}
    {unconf.length > 0 && !bp.done && <div className="bk-alert bad" style={{ margin: "10px 0 0" }}>
      <b>{plural(unconf.length, "bill is", "bills are")} in Tally, not yet read back:</b> {unconf.map((e) => e.x.invoiceNo + " · " + e.x.vendorName).join("; ")}.
      Check Tally first. <button className="btn small" onClick={() => doAct("billCheckWaiting")}>Check these in Tally</button></div>}
    {bp.cancelled && <p className="bk-alert" style={{ margin: "10px 0 0" }}>{bp.cancelled}</p>}
    {bp.done && <div className={"bk-alert" + (bp.unverified || failed.length ? " bad" : "")} data-post-result="" style={{ margin: "10px 0 0" }}>
      {(bp.ok || 0) - (bp.altered || 0)} in Tally (verified) · <b>{bp.company || ""}</b>{bp.altered ? " · " + bp.altered + " altered in Tally" : ""}{bp.dup ? " · " + bp.dup + " already in Tally (not posted again)" : ""}{notPosted > 0 ? " · " + notPosted + " failed" : ""}
      {(bp.masters || []).length > 0 && <div style={{ marginTop: 4 }} data-post-masters="">Ledgers: {bp.masters.map((m) => m.name + ": " + m.word).join(" · ")}</div>}
      {bp.optional > 0 && <div style={{ marginTop: 4 }}><b>{bp.optional} went in as Optional vouchers.</b> {OPTIONAL_HELP}</div>}
      {bp.unverified > 0 && <div style={{ marginTop: 4 }}><b>{bp.unverified} in Tally, not yet read back.</b> {bp.unverified > 1 ? "They stay" : "It stays"} in the waiting list until FinCom finds {bp.unverified > 1 ? "them" : "it"} in Tally. Look in Tally; if it is not there, post again. Use <b>Settings → FinCom Bridge → Test reading entries</b> and send the result if this repeats.</div>}
    </div>}
    {bp.done && notPosted > 0 && <div className="bk-alert bad" style={{ margin: "10px 0 0" }}>
      <b>{notPosted} failed.</b> They are back in <b>To review</b> with Tally’s reason on each.
      <ul>{failed.filter((f) => !f.unread).map((f, i) => <li key={i}>{f.no} · {f.party}: Failed: {f.msg}</li>)}</ul>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <button className="btn small primary" onClick={() => doAct("billRetry")}>Retry these {notPosted}</button>
        <button className="btn small" onClick={() => goStep("review")}>Open them in To review</button>
        {/already\s+exists/i.test(failed.map((f) => f.msg).join(" ")) && <span className="note">Tally already has these voucher numbers. In Tally, set the Purchase voucher type’s numbering to Automatic, or retry: numbers get the supplier’s initials.</span>}
      </div>
    </div>}
  </>;
}

// the last "Check sent bills in Tally"
function CheckResult({ bc }) {
  if (bc.error) return <p className="bk-alert bad" style={{ margin: "8px 0 0" }}>{bc.error}</p>;
  if (!bc.at) return null;
  const miss = (bc.missing || []).map((id) => D().entries[id]).filter((e) => e && e.exportedAt), wrong = bc.wrongDate || [];
  return (
    <div className={"bk-alert" + (miss.length || wrong.length ? " bad" : "")} style={{ margin: "8px 0 0" }}>
      <b>{bc.checked} sent bills checked in {bc.company}:</b> {bc.found} found{bc.optional ? " (" + bc.optional + " as Optional vouchers — Display More Reports → Exception Reports → Optional Vouchers)" : ""}
      {miss.length > 0 && <><br /><b>{miss.length} not in Tally:</b>
        <ul>{miss.map((e) => <li key={e.id}>{e.x.invoiceNo} · {e.x.vendorName} · {fmtDate(e.x.invoiceDate)}</li>)}</ul>
        <button className="btn small primary" onClick={() => doAct("billRepost")}>Mark these {miss.length} as not sent (to post them again)</button></>}
      {wrong.length > 0 && <><br /><b>{wrong.length} in Tally under the wrong date</b> (correct the date in Tally, or delete it there and post again):
        <ul>{wrong.map((w, i) => <li key={i}>{w.no} · {w.party} · in Tally on {fmtDate(w.got)}, should be {fmtDate(w.want)}</li>)}</ul></>}
    </div>
  );
}

// review of 02-Oct-2026: the postings in FinCom's cloud for this client, from the server, with what to do. Request of
// 02-Oct-2026: a failed posting no longer stays for ever (Dismiss; dismissed by FinCom when a later posting put every
// entry in, "Posted later at 07:51"); finished postings of the last 7 days, the rest under "Show older and dismissed";
// Retry only while something is left to send; the list changes by itself (no Refresh)
const ITEM_STATE = { waiting: ["Waiting for Tally", "warn"], sending: ["Sending", "warn"], sent: ["In Tally, not yet read back", "warn"], in_tally: ["In Tally (verified)", "ok"], altered: ["Altered in Tally", "ok"], failed: ["Failed", "bad"] };
const JOB_STATE = { waiting: ["Waiting for the Tally computer", "warn"], taken: ["Taken by the Tally computer", "warn"], running: ["Sending to Tally", "warn"], done: ["Posted", "ok"], failed: ["Failed", "bad"], cancelled: ["Cancelled", "bad"] };
function QueueJobs() {
  const [all, setAll] = useState(false);
  CloudJobs.load();
  const jobs = CloudJobs.view(S.coId, all), every = CloudJobs.forClient(S.coId);
  if (!every.length) return null;
  const hidden = every.length - CloudJobs.view(S.coId, false).length;
  return <div className="bk-alert" data-post-jobs="" style={{ margin: "10px 0 0" }}>
    <b>Postings in FinCom’s cloud</b>
    {!jobs.length ? <p className="nr" style={{ margin: "6px 0 0" }}>Nothing in the last 7 days needs you.</p> :
    <table className="data" style={{ marginTop: 6 }}><thead><tr><th>Queued</th><th>Into</th><th>Entries</th><th>State</th><th>What happened</th></tr></thead><tbody>
      {jobs.map((j) => { const ok = [].concat(j.results || []).filter((r) => r && r.ok).length;
        const stopped = j.status === "failed" || j.status === "cancelled", later = stopped ? CloudJobs.postedLater(j) : null, left = stopped ? CloudJobs.leftToSend(j) : null;
        // request of 02-Oct-2026: every finished posting can be dismissed (done, failed, cancelled, posted later)
        const finished = ["done", "failed", "cancelled"].includes(j.status) && !j.checking;
        const auto = stopped && (later || (j.dismissed_at && j.dismiss_auto)), byHand = finished && j.dismissed_at && !j.dismiss_auto;
        let [label, cls] = JOB_STATE[j.status] || [j.status, ""];
        if (auto) [label, cls] = [j.dismiss_note && j.dismiss_auto ? j.dismiss_note : "Posted later at " + fmtTime(later), "ok"];
        else if (stopped && left === 0) [label, cls] = [label + " · nothing left to send", "ok"];
        return <tr key={j.id} data-job={j.id} data-job-state={auto ? "later" : byHand ? "dismissed" : j.status} style={byHand ? { opacity: 0.65 } : undefined}><td>{fmtDateTime(j.created_at)}</td><td>{j.company}</td><td className="n">{ok + " of " + (j.n || 0)}</td>
          <td><span className={"tag " + cls}>{label}</span><div className="nr">{fmtDateTime(j.updated_at || j.created_at)}</div>
            {byHand && <div className="nr" data-dismissed="">{"Dismissed by " + memberName(j.dismissed_by) + " · " + fmtDateTime(j.dismissed_at)}</div>}</td>
          <td>{j.message || "—"}
            {[].concat(j.items || []).length > 0 && <ul className="nr" style={{ margin: "4px 0 0 16px", padding: 0 }}>{j.items.map((it) => { const e = D().entries[it.id];
              return <li key={it.id}>{(e ? e.x.invoiceNo + " · " + e.x.vendorName : it.id) + ": "}<span className={"tag " + (ITEM_STATE[it.state] || ["", ""])[1]}>{(ITEM_STATE[it.state] || [it.state])[0] + (it.state === "failed" && it.reason ? ":" : "")}</span>{it.reason ? " " + it.reason : ""}</li>; })}</ul>}
            {finished && <div className="row" style={{ marginTop: 4, gap: 8, alignItems: "center" }}>
              {stopped && !auto && (left === 0 ? <span className="nr" data-nothing-left="">Nothing left to send: every entry is in Tally.</span>
                : <><button className="btn small primary" data-retry="" onClick={() => CloudJobs.retry(j)}>Retry</button>
                  <span className="nr">{left ? left + " of " + (CloudJobs.idsOf(j) || []).length + " still to send. " : ""}Entries already in Tally are not sent twice.</span></>)}
              {byHand ? <button className="btn small" data-undismiss="" onClick={() => CloudJobs.undismiss(j)}>Show in the list again</button>
                : CloudJobs.dismissOk && <button className="btn small" data-dismiss="" onClick={() => CloudJobs.dismiss(j)}>Dismiss</button>}
            </div>}</td></tr>; })}
    </tbody></table>}
    {(all || hidden > 0) && <div className="row" style={{ marginTop: 6 }}><a href="#" data-jobs-all="" onClick={(ev) => { ev.preventDefault(); setAll(!all); }}>{all ? "Show only the last 7 days" : "Show older and dismissed (" + hidden + ")"}</a></div>}
  </div>;
}

// C15: one line — what this client's entries go into, through which bridge, and ready or what to do
function PostLine({ co }) {
  const l = postLineFor(co);
  const go = l.go === "cotally" ? goChooseTallyCompany : l.go === "tally" ? goTallyPage : null;
  return <div className={"bk-alert" + (l.state ? "" : " bad")} data-post-line="" style={{ margin: "0 0 12px" }}>
    {"Posting into: "}<b>{l.company}</b>{l.bridge ? " · " + l.bridge : ""}{" · "}
    {l.state ? <span className="tag ok" data-post-ready="">{l.state}</span>
      : go ? <button className="btn small primary" data-post-action="" onClick={go}>{l.action}</button> : <b data-post-action="">{l.action}</b>}
  </div>;
}

// B14: a posting stopped by the company check — nothing was sent, not Tally's reason; the entries stay waiting
function NotAllowed({ co }) {
  const st = S.postStop && S.postStop.cid === co.id ? S.postStop : null;
  if (!st) return null;
  // review 21c: a choice only guessed (the company, or a ledger of Client setup) stops posting: one line saying which
  const guess = /^Confirm the Tally company/.test(st.msg), led = /^Posting waits/.test(st.msg);
  if (guess || led) return <div className="bk-alert bad" data-not-allowed="" data-guessed="" style={{ margin: "0 0 12px" }}>
    <b>{"Not sent to Tally: " + (guess ? "confirm the Tally company." : "a ledger is not confirmed.")}</b> {st.msg} The entries are still waiting here.
    <div className="row" style={{ gap: 8, marginTop: 6 }}><button className="btn small primary" data-choose-company="" onClick={() => { if (guess) goChooseTallyCompany(); else { S.step = null; S.tab = /TDS/.test(st.msg) || /expense/.test(st.msg) ? "cotds" : "cotally"; render(); window.scrollTo(0, 0); } }}>{guess ? "Confirm the Tally company" : "Open Client setup"}</button>
      <button className="linkbtn" onClick={() => { S.postStop = null; render(); }}>Dismiss</button></div>
  </div>;
  return <div className="bk-alert bad" data-not-allowed="" style={{ margin: "0 0 12px" }}>
    <b>Not sent to Tally: choose the Tally company.</b> {notAllowedRest(st.msg)} The entries are still waiting here.
    <div className="row" style={{ gap: 8, marginTop: 6 }}><button className="btn small primary" data-choose-company="" onClick={() => goChooseTallyCompany()}>Choose the Tally company</button>
      <button className="linkbtn" onClick={() => { S.postStop = null; render(); }}>Dismiss</button></div>
  </div>;
}

const KIND = { bill: "", bank: "bank", sale: "sale" };
const LED = [["party", "Party"], ["expense", "Expense"], ["gst", "GST"], ["tds", "TDS"]];
// C16: one table of the entries waiting or on their way
function Entries({ rows, canPost }) {
  const closed = (r) => r.kind === "bill" && typeof ClosedP === "object" ? ClosedP.note(r.e.x.invoiceDate, !!(r.e.snapshot && r.e.snapshot.tds)) : [];
  return <div className="tblwrap"><table className="data" data-post-table="">
    <thead><tr><th>Date</th><th>Party</th><th>Bill no.</th><th className="n">Amount</th><th>Ledgers</th><th>State</th><th></th></tr></thead>
    <tbody>{rows.map((r) => { const cp = closed(r), busy = /^(Sending|In Tally)/.test(r.state[0]);
      return <tr key={r.kind + r.id} data-post-row={r.id} data-kind={r.kind}>
        <td>{fmtDate(r.date)}{cp.length > 0 && <> <span className="tag warn cp-tag" title={"Closed period: " + cp.join("; ")}>closed period</span></>}</td>
        <td>{r.party}{KIND[r.kind] && <> <span className="tag">{KIND[r.kind]}</span></>}{r.kind === "bill" && r.e.noteKind && <> <span className="tag">{r.e.noteKind === "credit" ? "credit note" : "debit note"}</span></>}</td>
        <td>{r.no}</td><td className="n">{money(r.amount)}</td>
        <td className="nr" data-ledgers="">{LED.filter(([k]) => r.led[k] && r.led[k].length).map(([k, t]) => <div key={k}>{t + ": " + r.led[k].join(", ")}</div>)}</td>
        <td><span className={"tag " + r.state[1]} data-state="">{r.state[0]}</span></td>
        <td className="ac" style={{ whiteSpace: "nowrap" }}>
          <button className="btn small" data-preview="" onClick={() => postPreviewOne(r.kind, r.id)}>Preview</button>{" "}
          {r.sent ? (r.e.goneFromTally ? <button className="btn small" onClick={() => doAct("billRepostGone")}>Post again</button>
              : canPost && <button className="btn small" onClick={() => doAct("billCheck")}>Check in Tally</button>)
            : r.kind !== "sale" ? canPost && <button className="btn small" data-post-one="" disabled={busy} onClick={() => postOneToTally(r.kind, r.id)}>Post</button>
            : <button className="btn small" onClick={() => goDocType("sales")}>Open in Sales</button>}{" "}
          {!r.sent && <button className="btn small" data-back="" disabled={busy} onClick={() => postBackToReview(r.kind, r.id)}>Back to review</button>}
        </td>
      </tr>; })}</tbody>
  </table></div>;
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
  const waiting = v.filter((e) => e.status === "approved" && !e.exportedAt).sort(byDate);
  // in Tally only when confirmed there (review of 02-Oct-2026); a Tally file made, or a posting not confirmed, is listed apart
  setTimeout(() => { TallyProof.check(co.id).catch(() => {}); if (!co.postTo) autoPostTo(co).catch(() => {}); }, 0);
  const sent = v.filter(billInTally).length, unsure = v.filter((e) => e.status === "approved" && e.exportedAt && !billInTally(e));
  const ledgers = [...new Set(waiting.flatMap((e) => (e.snapshot ? e.snapshot.lines : []).map((l) => l.ledger)))].filter(Boolean);
  // with Tally's ledger list at hand, names are put in Tally's spelling and the ones Tally lacks are listed
  const ctx = !!(S.bank && S.bank.cid === co.id && !S.bank.loading && hasLedgerList());
  if (ctx) canonicalizeBills(waiting);
  const issues = ctx ? billLedgerIssues(waiting) : [];
  const canPost = canPostTally(co), bc = S.billCheck || {};
  const undoable = v.filter((e) => e.exportedAt && e.tally && e.tally.guid).length;
  const rows = postRows(co), toPost = rows.filter((r) => !r.sent && !/^(Sending|In Tally)/.test(r.state[0])).length;
  // the one count for Tally (the header chip, the tab and the dashboard say the same: postCountFor, src/js/59)
  const nBills = postCountFor(co.id), nOther = rows.filter((r) => r.kind !== "bill").length;
  const bankRep = S.bank && S.bank.cid === co.id ? S.bank.postReport : null;
  const more = (fn) => (ev) => { const d = ev.currentTarget.closest("details"); if (d) d.open = false; fn(); };
  return (
    <section className="poststep" data-post-page="">
      <PostLine co={co} />
      <NotAllowed co={co} />
      <p className="note" data-post-count="" style={{ margin: "0 0 8px" }}><b>{plural(nBills, "bill", "bills")} for Tally</b>{nOther ? " · " + plural(nOther, "other entry", "other entries") + " (bank, sales)" : ""}{sent ? " · " + sent + " in Tally" : ""}</p>
      {rows.length ? <Entries rows={rows} canPost={canPost} /> : <p className="note" data-post-empty="">Nothing is waiting to be posted.</p>}
      {issues.length > 0 && <div className="bk-alert bad" style={{ margin: "10px 0 0" }}>
        <b>{plural(issues.length, "ledger is", "ledgers are")} not in Tally.</b> Bills using them are not posted until you choose the right Tally ledger (or create it). Fixes are saved for future bills.
        <table className="data" style={{ marginTop: 8 }}>
          <thead><tr><th>Name used</th><th>Used as</th><th className="n">Bills</th><th>Tally ledger</th><th></th></tr></thead>
          <tbody>{issues.map((x) => <LedgerFix key={x.role + x.name} x={x} />)}</tbody>
        </table>
      </div>}
      {unsure.length > 0 && <div className="bk-alert bad" data-post-unsure="" style={{ margin: "10px 0 0" }}>
        <b>{plural(unsure.length, "bill is", "bills are")} not counted as in Tally:</b>
        <ul>{unsure.map((e) => <li key={e.id}>{e.x.invoiceNo} · {e.x.vendorName} · {tallyStateOf(e)[1]}</li>)}</ul>
        <div className="row" style={{ gap: 8 }}>{canPost && <button className="btn small" disabled={!!bc.busy} onClick={() => doAct("billCheck")}>Check them in Tally</button>}
          {unsure.some((e) => e.goneFromTally) && <button className="btn small primary" onClick={() => doAct("billRepostGone")}>Post the ones no longer in Tally again</button>}</div></div>}
      {!(S.billPost && S.billPost.notAllowed) && <PostResult bp={S.billPost || {}} waiting={waiting} />}
      {bankRep && !bankRep.notAllowed && <div style={{ marginTop: 10 }}><PostReport rep={bankRep} /></div>}
      <CheckResult bc={bc} />
      <div className="row" style={{ marginTop: 14, gap: 8, alignItems: "center" }}>
        <button className="btn primary" data-post-main="" disabled={!toPost || !canPost} onClick={() => doAct("postAll")}>{"Post " + toPost + " to Tally"}</button>
        {!canPost && toPost > 0 && <span className="note">No Tally to post to from here: use More → Download Tally file.</span>}
        <details className="bk-menu" data-more="post"><summary className="btn">More</summary><div className="bk-menu-list">
          <button disabled={!waiting.length} onClick={more(() => doAct("xml"))}>Download Tally file<small>The approved bills as a file to import in Tally</small></button>
          {/* read by doAct("xml") */}
          <label className="chk" style={{ padding: "4px 10px" }}><input type="checkbox" id="markSent" defaultChecked /> Mark these as sent after download</label>
          <button onClick={more(() => doAct("csv"))}>Download TDS register (Excel CSV)</button>
          {canPost && undoable > 0 && <button onClick={more(() => doAct("billUnpost"))}>Take an entry back out of Tally<small>{undoable} posted bills can be removed from Tally from here</small></button>}
          {canPost && sent > 0 && <button disabled={!!bc.busy} onClick={more(() => doAct("billCheck"))}>{bc.busy ? "Checking Tally…" : "Check sent bills in Tally"}<small>Confirms that every bill marked as sent is really in Tally</small></button>}
          {waiting.length > 1 && <button onClick={more(() => doAct("billBackAll"))}>Send all {waiting.length} bills back to review</button>}
          <button onClick={more(() => setSteps(!steps))}>{steps ? "Hide the import steps" : "How to import the file into Tally"}</button>
          <button className="danger" onClick={more(() => doAct("clearSent"))}>Clear sent invoices older than 90 days<small>They move to “Deleted”, where each can be restored; deductee year totals are kept</small></button>
        </div></details>
      </div>
      {steps && <ImportSteps co={co} ledgers={ledgers} />}
      <QueueJobs />
    </section>
  );
}
// the old name of this page (a client page with no other screen): the same page
export const Export = PostStep;
