// Step 3 of a client, "Post to Tally": everything approved and not yet in Tally, in one place — purchase bills, bank
// lines, sales invoices. Was viewPostStep() (src/js/02) and viewExport() (src/js/27).
//
// Posting itself stays in the business logic: postBillsToTally, checkBillsInTally, exportXml, … are reached through
// doAct("billPost") and friends; bank buttons through bankAct(). What a posting run reports back lives in
// S.billPost (bills) and S.bank.postReport (bank); S.billCheck is the last "Check sent bills in Tally".
import { useState } from "react";
import Legacy from "../parts/Legacy.jsx";

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
  const unconf = waiting.filter((e) => e.postUnconfirmed), failed = bp.failed || [], notPosted = failed.length - (bp.unverified || 0);
  return <>
    {bp.busy && <p className="bk-alert" style={{ margin: "10px 0 0" }}>{bp.busy}</p>}
    {bp.error && <p className="bk-alert bad" style={{ margin: "10px 0 0" }}>{bp.error}</p>}
    {unconf.length > 0 && !bp.done && <div className="bk-alert bad" style={{ margin: "10px 0 0" }}>
      <b>{plural(unconf.length, "bill was", "bills were")} sent to Tally earlier but not confirmed there:</b> {unconf.map((e) => e.x.invoiceNo + " · " + e.x.vendorName).join("; ")}.
      Check Tally first. <button className="btn small" onClick={() => doAct("billCheckWaiting")}>Check these in Tally</button></div>}
    {bp.done && <div className={"bk-alert" + (bp.unverified || failed.length ? " bad" : "")} style={{ margin: "10px 0 0" }}>
      {bp.ok || 0} posted into <b>{bp.company || ""}</b> and confirmed there{bp.dup ? " · " + bp.dup + " already in Tally (not posted again)" : ""}{notPosted > 0 ? " · " + notPosted + " not posted" : ""}
      {bp.optional > 0 && <div style={{ marginTop: 4 }}><b>{bp.optional} went in as Optional vouchers.</b> {OPTIONAL_HELP}</div>}
      {bp.unverified > 0 && <div style={{ marginTop: 4 }}><b>{bp.unverified} not confirmed:</b> Tally replied ‘created’ but the entry could not be found afterwards, so {bp.unverified > 1 ? "they stay" : "it stays"} in the waiting list. Look in Tally; if it is not there, post again. Use <b>Settings → Tally Bridge → Test reading entries</b> and send the result if this repeats.</div>}
    </div>}
    {bp.done && failed.length > 0 && <div className="bk-alert bad" style={{ margin: "10px 0 0" }}>
      <b>{failed.length} not posted.</b> They are back in <b>To review</b> with Tally’s reason on each.
      <ul>{failed.map((f, i) => <li key={i}>{f.no} · {f.party}: {f.msg}</li>)}</ul>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <button className="btn small primary" onClick={() => doAct("billRetry")}>Retry these {failed.length}</button>
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

// the approved bills waiting, and the ways to get them into Tally
export function Export() {
  const co = CO(), v = Object.values(D().entries);
  const waiting = v.filter((e) => e.status === "approved" && !e.exportedAt).sort(byDate);
  const sent = v.filter((e) => e.exportedAt).length;
  const totTds = waiting.reduce((a, e) => a + (e.snapshot ? e.snapshot.tds : 0), 0);
  const ledgers = [...new Set(waiting.flatMap((e) => (e.snapshot ? e.snapshot.lines : []).map((l) => l.ledger)))].filter(Boolean);
  // with Tally's ledger list at hand, names are put in Tally's spelling and the ones Tally lacks are listed
  const ctx = !!(S.bank && S.bank.cid === co.id && !S.bank.loading && hasLedgerList());
  if (ctx) canonicalizeBills(waiting);
  const issues = ctx ? billLedgerIssues(waiting) : [];
  const canPost = Bridge.on() && Bridge.up(), bc = S.billCheck || {};
  const undoable = v.filter((e) => e.exportedAt && e.tally && e.tally.guid).length;
  const closed = (e) => typeof ClosedP === "object" ? ClosedP.note(e.x.invoiceDate, !!(e.snapshot && e.snapshot.tds)) : [];
  return (
    <div className="two">
      <div className="pane" style={{ marginTop: 0 }}>
        <h2>{waiting.length} approved entr{waiting.length === 1 ? "y" : "ies"} waiting</h2>
        <p className="note" style={{ margin: "0 0 12px" }}>TDS in these entries: {money(totTds)}. {sent} sent earlier.</p>
        {waiting.length > 0 && <>
          <div className="tblwrap"><table className="data">
            <thead><tr><th>Date</th><th>Supplier</th><th>Bill no.</th><th className="n">Amount</th><th>Section</th><th className="n">TDS</th><th></th></tr></thead>
            <tbody>{waiting.map((e) => {
              const cp = closed(e);
              return <tr key={e.id}>
                <td>{fmtDate(e.x.invoiceDate)}{cp.length > 0 && <> <span className="tag warn cp-tag" title={"Closed period: " + cp.join("; ")}>closed period</span></>}</td>
                <td>{e.x.vendorName}{e.noteKind && <> <span className="tag">{e.noteKind === "credit" ? "credit note" : "debit note"}</span></>}</td>
                <td>{e.x.invoiceNo || ""}</td><td className="n">{INR.format(num(e.x.total))}</td><td>{e.snapshot.ref}</td><td className="n">{money0(e.snapshot.tds)}</td>
                <td className="ac" style={{ whiteSpace: "nowrap" }}>
                  <button className="btn small" onClick={() => billBack(e.id)}>Back to review</button>{" "}
                  <button className="btn small danger" title="Delete this bill" onClick={() => billDelete(e.id)}>Delete</button>
                </td>
              </tr>;
            })}</tbody>
          </table></div>
          {waiting.length > 1 && <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={() => doAct("billBackAll")}>Send all {waiting.length} back to review</button></div>}
        </>}
        {issues.length > 0 && <div className="bk-alert bad" style={{ margin: "10px 0 0" }}>
          <b>{plural(issues.length, "ledger is", "ledgers are")} not in Tally.</b> Bills using them are not posted until you choose the right Tally ledger (or create it). Fixes are saved for future bills.
          <table className="data" style={{ marginTop: 8 }}>
            <thead><tr><th>Name used</th><th>Used as</th><th className="n">Bills</th><th>Tally ledger</th><th></th></tr></thead>
            <tbody>{issues.map((x) => <LedgerFix key={x.role + x.name} x={x} />)}</tbody>
          </table>
        </div>}
        <PostResult bp={S.billPost || {}} waiting={waiting} />
        {canPost && undoable > 0 && <div className="row" style={{ marginTop: 10 }}><button className="btn small" onClick={() => doAct("billUnpost")}>Take an entry back out of Tally</button><span className="note">{undoable} posted bills can be removed from Tally from here.</span></div>}
        {canPost && sent > 0 && <div className="row" style={{ marginTop: 10 }}><button className="btn small" disabled={!!bc.busy} onClick={() => doAct("billCheck")}>{bc.busy ? "Checking Tally…" : "Check sent bills in Tally"}</button><span className="note">Confirms that every bill marked as sent is really in Tally.</span></div>}
        <CheckResult bc={bc} />
        <div className="row" style={{ marginTop: 14 }}>
          {canPost && <button className="btn primary" disabled={!waiting.length} onClick={() => doAct("billPost")}>Post {waiting.length} to Tally</button>}
          <button className={"btn" + (canPost ? "" : " primary")} disabled={!waiting.length} onClick={() => doAct("xml")}>Download Tally file</button>
          <button className="btn" onClick={() => doAct("csv")}>Download TDS register (Excel CSV)</button>
        </div>
        {/* read by doAct("xml") */}
        <label className="chk" style={{ marginTop: 12 }}><input type="checkbox" id="markSent" defaultChecked /> Mark these as sent after download</label>
        <div style={{ marginTop: 16 }}>
          <button className="btn small" onClick={() => doAct("clearSent")}>{S.arm === "clearSent" ? "Click again to clear" : "Clear sent invoices older than 90 days"}</button>
          <div className="note" style={{ marginTop: 4 }}>Frees space. Download the register first; deductee year totals are kept.</div>
        </div>
      </div>
      {bridgeLive(co) ? (
        <div className="pane" style={{ marginTop: 0 }}><h2>Straight into Tally</h2><p className="note">{Bridge.openFor(co).name} is open in Tally. <b>Post to Tally</b> checks for bills already booked (same bill number and party), then creates the rest{co.createOptional ? " as Optional vouchers" : ""}. Any bill Tally refuses is listed with Tally’s reason.</p></div>
      ) : (
        <div className="pane" style={{ marginTop: 0 }}><h2>Import into Tally</h2>
          <ol className="steps">
            <li>Download the Tally file and unzip it to get the .xml file.</li>
            <li>Open <b>{co.tallyName || co.name}</b> in TallyPrime.</li>
            <li>Check these ledgers exist in it with the same names{ledgers.length ? ": " + ledgers.join(", ") : ""}.</li>
            <li>Go to Gateway of Tally, then Import, then Transactions, and choose the .xml file.</li>
            <li>{co.createOptional ? "The vouchers arrive as Optional. Review them in Day Book (include optional vouchers), then regularise them." : "The vouchers post straight to the books. Review them in Day Book."}</li>
          </ol>
          <p className="note" style={{ margin: "12px 0 0" }}>The file names this company, so Tally will not import it into a different one. These are plain accounting entries; Tally's Form 140 (old 26Q) screen may list them under exceptions until the nature of payment is set on the TDS ledger.</p>
        </div>
      )}
    </div>
  );
}

// the whole step: a card per kind of entry, then a section for each
export function PostStep() {
  const co = CO(), v = Object.values(D().entries);
  const bills = v.filter((e) => e.status === "approved" && !e.exportedAt), billAmt = bills.reduce((a, e) => a + num(e.x.total), 0);
  const bankOn = S.bank && S.bank.cid === co.id && !S.bank.loading;
  const ready = bankOn ? S.bank.rows.filter((r) => r.state === "ready") : [], st = bankOn ? curStmt() : null;
  const salesOn = S.sales && S.sales.cid === co.id, sales = salesOn ? S.sales.list.filter((x) => x.status === "approved" && !x.postedAt) : [];
  const card = (id, title, n, sub) => <a className={"pcard" + (S.postFocus === id ? " on" : "")} href={"#post-" + id}><span>{title}</span><b>{n}</b><small>{sub}</small></a>;
  return (
    <section className="poststep">
      <div className="post-sum">
        {card("bills", "Purchase bills", bills.length, bills.length ? INR.format(billAmt) : "nothing approved")}
        {card("bank", "Bank lines", bankOn ? ready.length : "…", bankOn ? (st ? st.name || "current statement" : "no statement open") : "loading")}
        {card("sales", "Sales invoices", salesOn ? sales.length : "—", "posted from the Sales list")}
      </div>
      <p className="note" style={{ margin: "0 0 16px" }}>Every entry is checked against Tally before it goes, and read back after. Nothing is posted twice.</p>
      <section className="psec" id="post-bills"><h3>Purchase bills</h3><Export /></section>
      <section className="psec" id="post-bank"><h3>Bank lines</h3>
        {!bankOn ? <p className="note">Loading the bank statements…</p>
          : !st ? <p className="note">No bank statement yet. <button className="linkbtn" onClick={() => goDocType("bank", "collect")}>Upload one</button>.</p>
          : <>
            {/* the posting report is shared with the Bank and Sales screens, still old ones */}
            <Legacy html={S.bank.postReport ? postReportHtml(S.bank.postReport) : ""} />
            <div className="row" style={{ alignItems: "center", gap: 12 }}>
              <span><b>{ready.length}</b> line{ready.length === 1 ? "" : "s"} ready in {st.name || "this statement"}</span>
              {ready.length > 0 && Bridge.on() && Bridge.up() && <button className="btn primary" onClick={() => bankAct("bankPost")}>Post {plural(ready.length, "bank line", "bank lines")}</button>}
              <button className="btn small" onClick={() => doAct("toBankReady")}>See the lines</button>
              {S.bank.stmts.length > 1 && <span className="note">{S.bank.stmts.length} statements: choose another in the bank tab</span>}
            </div>
          </>}
      </section>
      <section className="psec" id="post-sales"><h3>Sales invoices</h3><p className="note">Sales invoices are posted from the list on the Sales tab.</p>
        <button className="btn small" onClick={() => goDocType("sales")}>Open sales</button></section>
    </section>
  );
}
