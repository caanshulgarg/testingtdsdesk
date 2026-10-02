// The checks over a bank statement: the balance from FinCom's copy, the reconciliation with Tally (what to post, delete or
// replace), lines marked posted that Tally no longer has, entries in Tally twice or under the wrong date, the lines being
// shown, a statement whose running balance breaks, and the report of the last posting. Was bankBalanceHtml,
// bankBalanceInner, reconHtml, goneHtml, dupFindHtml, bankFocusHtml, focusBtn (src/js/24), fixBanner (src/js/21) and
// postReportHtml (src/js/26). The work is in src/js; buttons go through bankAct, bankFocusGo, reconPick, reconExcelGo.

import { useEffect } from "react";

const Btn = ({ act, className = "btn small", children, disabled, title, ...rest }) => <button className={className} disabled={disabled} title={title} onClick={() => bankAct(act)} {...rest}>{children}</button>;
const inr = (v) => money(v || 0), abs = (v) => money(Math.abs(v || 0));
const plural2 = (n, one, many) => n + (n === 1 ? one : many);

// show only some lines of the statement, with what they are
// the cloud's refusal starts "Choose the Tally company …", which the banner's heading already says: said once
export function notAllowedRest(msg){ return String(msg || "").replace(/^\s*choose the tally company.*?may post to[^.]*\.\s*/i, ""); }
export function FocusBtn({ title, ids, label, note }) {
  if (!ids || !ids.length) return null;
  return <button className="linkbtn" onClick={() => bankFocusGo(title, ids, note)}>{label || "Show " + (ids.length === 1 ? "this line" : "these " + ids.length + " lines")}</button>;
}

// the bank ledger's balance from FinCom's copy (Tally is never asked for a balance: FinCom Bridge 2.1.4), with "Balance
// from FinCom's copy · books as of 15:34". After a posting, only once the entries posted are read back (in Tally and in
// the copy): until then "Posted · balance not yet checked", and checked by itself once they are. Never an error
function BalanceInner({ st }) {
  const b = B(), t = st.tallyBal, live = Bridge.on() && Bridge.up();
  const copy = typeof TCloud === "object" && TCloud.on();
  const waiting = typeof bankNotReadBack === "function" ? bankNotReadBack(b.rows, b.cid).length : 0;
  // posted and waiting for the read-back: the copy's state looked at every half a minute; checked once read back
  useEffect(() => {
    if (!t || !t.pending || b.balBusy) return undefined;
    if (!waiting) { const id = setTimeout(() => checkBankBalance({ quiet: true }), Math.max(0, 10000 - (Date.now() - (t.at || 0)))); return () => clearTimeout(id); }
    const id = setInterval(() => { if (copy) TCloud.status(b.cid, true).then(() => render(), () => {}); }, 30000);
    return () => clearInterval(id);
  }, [t && t.at, t && t.pending, waiting, b.balBusy]);
  const btn = copy || live ? <Btn act="bankBalCheck" disabled={!!b.balBusy}>{b.balBusy ? "Checking…" : t ? "Check again" : "Check with FinCom's copy"}</Btn> : null;
  const line = t && (t.line || (typeof copyLine === "function" ? copyLine(b.cid) : ""));
  const when = <>{line && <span className="muted" data-copy-line="" style={{ display: "block" }}>{line}</span>}{t && t.at && <span className="muted">{"checked " + fmtDateTime(t.at)}</span>}</>;
  const Box = ({ cls, children }) => <div className={"bk-balbox bk-bal" + (cls ? " " + cls : "")}>{children}{btn}<button className="icon bk-x" title="Close" aria-label="Close" onClick={() => bankAct("balHide")}>×</button></div>;
  if (!t) return <Box><div><b>Balance in FinCom's copy:</b> <span className="muted">{"not checked yet." + (copy ? " FinCom checks it after every posting, once the entries posted are read back." : " Sign in to the firm account to check it.")}</span></div></Box>;
  if (t.pending) return <Box><div data-bal-pending=""><b>Posted · balance not yet checked</b> <span className="muted">{"(" + plural2(t.pending, " entry", " entries") + " posted, not read back yet: the balance is checked once " + (t.pending === 1 ? "it is" : "they are") + " confirmed in Tally and in FinCom's copy)"}</span></div></Box>;
  // not answered yet (or a check from before, with Tally's error): said, never as an error
  if (t.notYet || t.error) return <Box><div data-bal-notyet=""><b>Balance not yet checked</b> <span className="muted">{"· " + (t.notYet || "FinCom's copy has not answered yet") + "."}</span>{when}</div></Box>;
  const on = fmtDate(t.to), where = t.how === "copy" ? "" : " in Tally";
  if (t.diff === null) return <Box><div><b>{t.ledger + where + " on " + on + ":"}</b> {inr(t.tClose)} <span className="muted">(the statement has no closing balance to compare with)</span>{when}</div></Box>;
  if (Math.abs(t.diff) < 0.01) return <Box cls="ok"><div>✔ <b>The books agree with the bank.</b> {t.ledger + where + " on " + on + " is " + inr(t.tClose) + ", the statement's closing balance."}{when}</div></Box>;
  const li = [];
  if (t.diffOpen && Math.abs(t.diffOpen) >= 0.01) li.push(<li key="o"><b>Opening balance:</b>{" the books on " + fmtDate(t.openAsOn) + " are " + inr(t.tOpen) + ", the statement opens at " + inr(t.sOpen) + " (" + abs(t.diffOpen) + " apart). Entries before " + fmtDate(t.from) + " are missing or different in Tally: post the earlier statement first."}</li>);
  if (t.notIn.length) li.push(<li key="n"><b>{plural2(t.notIn.length, " line is", " lines are") + " not in Tally yet"}</b>{" (" + abs(t.notInEffect) + " " + (t.notInEffect >= 0 ? "net in" : "net out") + ") "}<FocusBtn title="not in Tally yet" ids={t.notIn} /></li>);
  if (t.left.length) li.push(<li key="l"><b>{plural2(t.left.length, " line was", " lines were") + " left out"}</b>{" (" + abs(t.leftEffect) + ") "}<FocusBtn title="left out, not posted" ids={t.left} /></li>);
  if (t.missing && t.missing.length) li.push(<li key="m"><b>{plural2(t.missing.length, " line is", " lines are") + " marked as in Tally, but Tally does not show " + (t.missing.length === 1 ? "it" : "them") + " for these dates"}</b>{" (" + abs(t.missingEffect) + "): deleted in Tally, or under another date. "}<FocusBtn title="marked in Tally, not found there" ids={t.missing} /></li>);
  if (t.extra && t.extra.length) li.push(<li key="x"><b>{plural2(t.extra.length, " entry is", " entries are") + " in Tally for these dates but not on the statement"}</b>{" (" + abs(t.extraEffect) + "):"}
    <div className="tblwrap" style={{ marginTop: 6, maxHeight: 240, overflow: "auto" }}><table className="data"><thead><tr><th>Date</th><th>Voucher</th><th>Party / ledger</th><th className="n">In</th><th className="n">Out</th><th></th></tr></thead><tbody>
      {t.extra.slice(0, 300).map((x, i) => <tr key={i}><td>{fmtDate(x.date)}</td><td>{[x.type, x.number].filter(Boolean).join(" ")}</td><td>{x.party}</td><td className="n">{x.eff > 0 ? inr(x.eff) : ""}</td><td className="n">{x.eff < 0 ? inr(-x.eff) : ""}</td><td>{x.note || ""}</td></tr>)}</tbody></table></div></li>);
  if (!t.extra) li.push(<li key="r">{live && <><Btn act="reconRun" className="btn small primary">Reconcile with Tally</Btn>{" "}</>}<span className="muted">{"pairs every statement line with the entries of " + t.ledger + " in Tally, and lists what to post and what to delete to make them agree"}</span></li>);
  if (t.unexplained !== undefined && Math.abs(t.unexplained) >= 0.01) li.push(<li key="u"><b>{abs(t.unexplained) + " is not explained"}</b> by the lines above: check the amounts of the entries in Tally against the statement.</li>);
  else if (t.extra) li.push(<li key="t" className="muted">These together make up the whole difference.</li>);
  return <Box cls="bad"><div style={{ flex: 1 }}><div>✖ <b>The books do not agree with the bank.</b> {t.ledger + where + " on " + on + " is "}<b>{inr(t.tClose)}</b>; the statement closes at <b>{inr(t.sClose)}</b>. Difference <b>{abs(t.diff)}</b>{" (" + (t.diff > 0 ? "the books are lower" : "the books are higher") + ")."}{when}</div>
    {li.length > 0 && <ul className="bk-bal-why">{li}</ul>}</div></Box>;
}

// the statement's closing balance against Tally's (every form of the box can be closed; a new check shows it again)
export function BankBalance({ st }) {
  const t = st.tallyBal;
  if (st.tallyBalHidden && st.tallyBalHidden === (t ? t.at : "none")) return null;
  return <BalanceInner st={st} />;
}

// the reconciliation with Tally: the statement worked from Tally's balance, then what is on one side only, or differs
export function Recon() {
  const b = B(), st = curStmt(), R = S.recon;
  if (!R || !st || R.sid !== st.id) return null;
  const rowById = new Map(b.rows.map((r) => [r.id, r])), live = Bridge.on() && Bridge.up();
  const balanced = R.unexplained !== null && Math.abs(R.sClose - R.tClose) < 0.01;
  const head = <div className="recon-head"><div><h3>{"Bank reconciliation · " + R.ledger}</h3><div className="note">{R.company + " · " + fmtDate(R.from) + " to " + fmtDate(R.to) + " · " + R.pairs + " lines matched · read " + fmtTime(R.at)}</div></div>
    <div className="row" style={{ gap: 8 }}><button className="btn small" onClick={() => reconExcelGo()}>Download Excel</button>{live && <Btn act="reconRun">Reconcile again</Btn>}<Btn act="reconClose">Close</Btn></div></div>;
  if (balanced && !R.missing.length && !R.extra.length && !R.differ.length)
    return <section className="recon">{head}<div className="bk-bal ok"><div>✔ <b>Reconciled.</b> {"Every line of the statement is in Tally once, and nothing else is. " + R.ledger + " in Tally on " + fmtDate(R.to) + " is " + abs(R.tClose) + ", the same as the statement."}</div></div></section>;
  const Line = ({ label, v, sign, note }) => <tr><td>{label}{note && <> <span className="muted">{note}</span></>}</td><td className="n">{v ? (sign || "") + abs(v) : "—"}</td></tr>;
  const miss = R.missing.map((id) => rowById.get(id)).filter(Boolean);
  const mIn = r2(miss.reduce((a, r) => a + num(r.credit), 0)), mOut = r2(miss.reduce((a, r) => a + num(r.debit), 0));
  const xIn = r2(R.extra.reduce((a, i) => a + Math.max(0, R.T[i].eff), 0)), xOut = r2(R.extra.reduce((a, i) => a + Math.max(0, -R.T[i].eff), 0));
  const canPost = miss.filter((r) => ["ready", "sent", "intally"].includes(r.state) && r.ledger && exactLedger(r.ledger));
  const needLedger = miss.filter((r) => !canPost.includes(r) && r.state !== "ignored"), left = miss.filter((r) => r.state === "ignored");
  const dup = new Map(R.dupOf);
  return <section className="recon">{head}
    <table className="data recon-stmt"><tbody>
      <tr><td><b>{"Balance in Tally on " + fmtDate(R.to)}</b></td><td className="n"><b>{(R.tClose < 0 ? "−" : "") + abs(R.tClose)}</b></td></tr>
      <Line label="Add: deposits on the statement, not in Tally" v={mIn} sign="+ " /><Line label="Less: withdrawals on the statement, not in Tally" v={mOut} sign="− " />
      <Line label="Less: receipts in Tally, not on the statement" v={xIn} sign="− " /><Line label="Add: payments in Tally, not on the statement" v={xOut} sign="+ " />
      {R.differ.length > 0 && <Line label="Amounts that differ (statement less Tally)" v={R.dEff} sign={R.dEff >= 0 ? "+ " : "− "} />}
      {Math.abs(R.openDiff) >= 0.01 && <Line label="Opening balance difference" v={R.openDiff} sign={R.openDiff >= 0 ? "+ " : "− "} note={"Tally on " + fmtDate(addDays(R.from, -1)) + " is " + abs(R.tOpen) + "; the statement opens at " + abs(R.sOpen) + ": entries before " + fmtDate(R.from) + " differ — reconcile the earlier statement"} />}
      {R.unexplained !== null && Math.abs(R.unexplained) >= 0.01 && <Line label="Not explained by the lines below" v={R.unexplained} sign={R.unexplained >= 0 ? "+ " : "− "} />}
      <tr className="tot"><td><b>{"Balance as per the bank statement on " + fmtDate(R.to)}</b></td><td className="n"><b>{R.sClose === null ? "—" : (R.sClose < 0 ? "−" : "") + abs(R.sClose)}</b></td></tr></tbody></table>
    {(R.deleteProblems || []).length > 0 && <div className="bk-alert bad" style={{ marginTop: 10 }}><b>{"Tally did not delete " + R.deleteProblems.length + " entr" + (R.deleteProblems.length === 1 ? "y" : "ies") + "."}</b> What Tally said:<ul style={{ margin: "6px 0 0" }}>{R.deleteProblems.slice(0, 20).map((x, i) => <li key={i}>{x}</li>)}</ul>
      <div className="note">If Tally says the voucher cannot be found, it may already be gone: press Reconcile again. If a Tally security setting blocks deleting, delete these in Tally (Alt+D on the voucher).</div></div>}
    {miss.length > 0 && <div className="recon-sec"><h4>On the statement, not in Tally <span className="cnt">{miss.length}</span></h4>
      <div className="tblwrap"><table className="data"><thead><tr><th>Date</th><th>Particulars</th><th className="n">Withdrawal</th><th className="n">Deposit</th><th>Ledger</th><th>Why</th></tr></thead><tbody>
        {miss.slice(0, 400).map((r) => <tr key={r.id}><td>{fmtDate(r.date)}</td><td>{r.dec.name || r.narr.slice(0, 50)}</td><td className="n">{r.debit ? abs(r.debit) : ""}</td><td className="n">{r.credit ? abs(r.credit) : ""}</td><td>{r.ledger || "—"}</td>
          <td>{r.state === "ignored" ? "left out" : ["sent", "intally"].includes(r.state) ? "marked as posted, but Tally does not have it" : r.state === "ready" ? "not posted yet" : "needs a ledger"}</td></tr>)}</tbody></table></div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>{live && canPost.length > 0 && <Btn act="reconPost" className="btn small primary">{"Post " + (canPost.length === 1 ? "it" : "these " + canPost.length) + " to Tally"}</Btn>}
        {needLedger.length > 0 && <span className="note">{needLedger.length + " need a ledger first "}<FocusBtn title="need a ledger before they can be posted" ids={needLedger.map((r) => r.id)} label="Show them" /></span>}
        {left.length > 0 && <span className="note">{left.length + " were left out on purpose "}<FocusBtn title="left out, not posted" ids={left.map((r) => r.id)} label="Show them" /></span>}</div></div>}
    {R.extra.length > 0 && <div className="recon-sec"><h4>In Tally, not on the statement <span className="cnt">{R.extra.length}</span></h4>
      <p className="note" style={{ margin: "0 0 6px" }}>Tick the entries to delete from Tally. Copies and entries FinCom posted are ticked already; check entries typed in Tally before deleting them.</p>
      <div className="tblwrap"><table className="data"><thead><tr><th></th><th>Date</th><th>Voucher</th><th>Party / ledger</th><th className="n">In</th><th className="n">Out</th><th>What it is</th></tr></thead><tbody>
        {R.extra.map((i) => { const t = R.T[i]; return <tr key={i}><td><input type="checkbox" aria-label={"Delete " + [t.type, t.number].filter(Boolean).join(" ")} checked={R.pick.has(i)} disabled={!live} onChange={(ev) => reconPick(i, ev.target.checked)} /></td><td>{fmtDate(t.date)}</td><td>{[t.type, t.number].filter(Boolean).join(" ")}</td><td>{t.party}</td>
          <td className="n">{t.eff > 0 ? abs(t.eff) : ""}</td><td className="n">{t.eff < 0 ? abs(t.eff) : ""}</td>
          <td>{dup.has(i) ? "a second copy of " + fmtDate((rowById.get(dup.get(i)) || {}).date) + "'s line" : t.tag ? "posted by FinCom, from another statement or an old copy" : "typed in Tally"}{t.narr && !t.tag && <div className="muted" style={{ fontSize: 12 }}>{t.narr.slice(0, 80)}</div>}</td></tr>; })}</tbody></table></div>
      {live && <div className="row" style={{ gap: 8, marginTop: 8 }}><Btn act="reconDelete" className="btn small danger" disabled={!R.pick.size}>{"Delete the " + R.pick.size + " ticked from Tally"}</Btn></div>}</div>}
    {R.differ.length > 0 && <div className="recon-sec"><h4>Amount differs <span className="cnt">{R.differ.length}</span></h4>
      <div className="tblwrap"><table className="data"><thead><tr><th>Date</th><th>Particulars</th><th className="n">Statement</th><th className="n">Tally</th><th>Tally voucher</th></tr></thead><tbody>
        {R.differ.map((d, i) => { const r = rowById.get(d.rowId), t = R.T[d.ti]; return <tr key={i}><td>{fmtDate(r.date)}</td><td>{r.dec.name || r.narr.slice(0, 50)}</td><td className="n">{abs(bankEffect(r))}</td><td className="n">{abs(t.eff)}</td><td>{[t.type, t.number].filter(Boolean).join(" ")}</td></tr>; })}</tbody></table></div>
      {live && <div className="row" style={{ gap: 8, marginTop: 8 }}><Btn act="reconReplace" className="btn small primary">{"Replace " + (R.differ.length === 1 ? "it" : "them") + " in Tally with the statement’s amount"}</Btn></div>}</div>}
  </section>;
}

// lines marked as posted that Tally no longer has
export function Gone() {
  const b = B(), g = b.gone, st = curStmt();
  if (!g || !st || g.sid !== st.id || !g.ids.length) return null;
  const n = g.ids.length, all = n === g.marked;
  return <div className="bk-bal bad"><div style={{ flex: 1 }}><b>{plural2(n, " line is", " lines are") + " marked as posted, but " + (n === 1 ? "is" : "are") + " no longer in Tally."}</b>{" " + (all ? "None of this statement’s posted lines are in " + g.ledger + " in " + g.company + " any more" + (g.bankLines ? "" : " (Tally shows no entries in this ledger for these dates)") + "." : "They were probably deleted in Tally, or moved to another company.")}
    <div className="row" style={{ marginTop: 8, gap: 8 }}><Btn act="goneBack" className="btn small primary">{"Put " + (n === 1 ? "it" : "them") + " back in Post to Tally"}</Btn><FocusBtn title="no longer in Tally" ids={g.ids} label={"Show " + (n === 1 ? "it" : "them")} /><Btn act="goneKeep" className="linkbtn">Leave them as posted</Btn></div></div></div>;
}

// FinCom's entries found in Tally twice, or under the wrong date
export function DupFind() {
  const d = S.dupFind;
  if (!d) return null;
  const amt = (v) => money(d.amountOf(v));
  const Tbl = ({ list, withWant }) => <div className="tblwrap" style={{ marginTop: 6, maxHeight: 260, overflow: "auto" }}><table className="data"><thead><tr><th>{withWant ? "In Tally on" : "Date"}</th>{withWant && <th>Should be</th>}<th>Type</th><th>Voucher</th><th>Party</th><th className="n">Amount</th></tr></thead><tbody>
    {list.slice(0, 400).map((v, i) => <tr key={i}><td>{fmtDate(tallyToIso(v.date))}</td>{withWant && <td>{fmtDate(v.wantDate)}</td>}<td>{v.type || ""}</td><td>{v.number || ""}</td><td>{v.party || ""}</td><td className="n">{amt(v)}</td></tr>)}</tbody></table></div>;
  const bad = d.extra.length || d.wrongDate.length || d.strangers.length;
  if (!bad) return <div className="bigwarn" style={{ borderColor: "var(--ledger)" }}><b>All clear.</b>{" " + d.tagged + " entries posted by FinCom were checked in " + d.company + " (" + fmtDate(d.from) + " to " + fmtDate(d.to) + "): each is there once, on its statement date. "}<Btn act="dupClose" className="linkbtn">Close</Btn></div>;
  return <div className="bigwarn" style={{ borderColor: "var(--stop)" }}>
    {d.wrongDate.length > 0 && <><b>{plural2(d.wrongDate.length, " entry is", " entries are") + " in " + d.company + " under the wrong date."}</b>
      <div>Remove them; the lines then show as not posted, and Post puts them in again with the statement’s date. <FocusBtn title="in Tally under the wrong date" ids={Array.from(new Set(d.wrongDate.map((v) => v.rowId).filter(Boolean)))} label="Show their statement lines" /></div><Tbl list={d.wrongDate} withWant />
      <div className="row" style={{ marginTop: 8 }}><Btn act="dupRemoveWrong" className="btn small primary">{"Remove the " + d.wrongDate.length + " wrong-date entr" + (d.wrongDate.length === 1 ? "y" : "ies") + " from Tally"}</Btn></div></>}
    {d.extra.length > 0 && <><div style={{ marginTop: d.wrongDate.length ? 12 : 0 }}><b>{plural2(d.extra.length, " entry is", " entries are") + " in " + d.company + " twice."}</b></div>
      <div>For each one, the first copy is kept and the later copy is removed.</div><Tbl list={d.extra} />
      <div className="row" style={{ marginTop: 8 }}><Btn act="dupRemove" className="btn small primary">{"Remove the " + d.extra.length + " extra cop" + (d.extra.length === 1 ? "y" : "ies") + " from Tally"}</Btn></div></>}
    {d.strangers.length > 0 && <div style={{ marginTop: 10 }}><b>{plural2(d.strangers.length, " entry", " entries") + " posted by FinCom " + (d.strangers.length === 1 ? "has an amount that is" : "have amounts that are") + " not on this statement:"}</b>{" " + d.strangers.slice(0, 40).map((v) => fmtDate(tallyToIso(v.date)) + " " + (v.party || "") + " " + amt(v)).join("; ") + ". They were probably read from an earlier or different copy of the statement. Check them against the bank, and delete them in Tally if they are wrong."}</div>}
    <div className="row" style={{ marginTop: 8 }}><Btn act="dupClose" className="linkbtn">Close</Btn></div></div>;
}

// the lines being shown, when only some are
export function BankFocus() {
  const f = B().focus;
  if (!f) return null;
  return <div className="bk-focus"><div><b>{"Showing " + f.ids.length + " line" + (f.ids.length === 1 ? "" : "s") + ": " + f.title}</b>{f.note && <div className="note">{f.note}</div>}</div><Btn act="bankFocusOff">Show all lines</Btn></div>;
}

// lines that break the running balance: read those pages again
export function FixBanner() {
  const b = B(), st = curStmt();
  if (!b || !st) return null;
  const bad = breakRows();
  if (!bad.length) return null;
  const pages = pagesToFix(bad);
  return <div className="bk-alert bad"><b>{bad.length + " line" + (bad.length === 1 ? " does" : "s do") + " not fit the running balance."}</b>{" " + (pages.length ? "Something printed on page" + (pages.length === 1 ? " " : "s ") + pages.join(", ") + " was missed or misread." : "")}
    <div className="row" style={{ gap: 8, marginTop: 8 }}><span className="note">Read those pages again:</span><Btn act="fixFree">Free</Btn><Btn act="fixGoogle" disabled={!googleReady()}>Google OCR</Btn><Btn act="fixClaude" className="btn small primary" disabled={!claudeReady()}>Claude</Btn></div></div>;
}

// what the last posting to Tally did
export function PostReport({ rep }) {
  if (!rep) return null;
  // one clear word for each (review of 02-Oct-2026): In Tally (verified) / In Tally, not yet read back / Failed
  if (rep.notAllowed) return <div className="bk-alert bad" data-not-allowed=""><b>Not sent to Tally: choose the Tally company.</b>{" " + notAllowedRest(rep.notAllowed) + " "}
    <button className="btn small primary" onClick={() => goChooseTallyCompany()}>Choose the Tally company</button>{" "}<Btn act={rep.dismiss} className="linkbtn">Dismiss</Btn></div>;
  const verified = rep.checking ? 0 : (rep.posted || 0) - (rep.unread || 0);
  const bits = [rep.checking ? (rep.posted || 0) + " in Tally" + (rep.company ? " (" + rep.company + ")" : "") + ", not yet read back: FinCom reads them back by itself…" : verified + " in Tally (verified)" + (rep.company ? " · " + rep.company : "")];
  if (rep.unread) bits.push(rep.unread + " in Tally, not yet read back (Tally did not answer the check; use ‘Mark lines already in Tally’ later)");
  if (rep.optional) bits.push(rep.optional + " as Optional vouchers (Tally: Display More Reports → Exception Reports → Optional Vouchers)");
  if (rep.skipped) bits.push(rep.skipped + " already in Tally (not posted again)");
  if (rep.failed && rep.failed.length) bits.push(rep.failed.length + " not posted");
  if (rep.movedBack) bits.push(rep.movedBack + " moved back to review (ledger not in Tally)");
  const failed = rep.failed || [];
  return <div className={"bk-alert" + (failed.length ? " bad" : "")}><b>{"Tally, " + fmtTime(rep.at) + ":"}</b>{" " + bits.join(" · ")}
    {failed.length > 0 && <><ul style={{ margin: "6px 0 0" }}>{failed.slice(0, 20).map((f, i) => <li key={i}>{f.what + " — " + f.msg}</li>)}</ul>
      {failed.length > 20 && <div className="note">{"and " + (failed.length - 20) + " more"}</div>}
      {S.tab === "bank" && <FocusBtn title="not posted in the last posting" ids={failed.map((f) => f.id).filter(Boolean)} label="Show the lines not posted" />}</>}
    {" "}<Btn act={rep.dismiss} className="linkbtn">Dismiss</Btn></div>;
}
