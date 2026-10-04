// A client's bank statement: every line gets a Tally ledger (suggested by rules and past choices, or set by hand),
// then goes to Tally. Was viewBank (src/js/22), bankTable, bankRowHtml, viewBankGroups and bankBar (src/js/23).
//
// State: B() is the open client's bank data (S.bank): rows, statements (stmts, cur), what is ticked (sel), the
// search (q), the tab (filter), how many lines are drawn (limit), the last change that can be undone (undo).
// A line's state is attention (no ledger) → suggested → ready → sent (in Tally), or intally / ignored.
// The actions are in src/js/22-23: bankAct("bankPost"), bankRowAct("accept", id), bankSetLedger(id, name), …
//
// The checks over a statement are parts/BankChecks.jsx; the rules tab and the settings panel parts/BankSettings.jsx.
// The column filters' chips are parts/ChipBar.jsx.
import { useRef } from "react";
import { BankSettings, RulesPanel } from "../parts/BankSettings.jsx";
import { PostReport, FixBanner, BankBalance, Recon, Gone, DupFind, BankFocus } from "../parts/BankChecks.jsx";
import ColHead from "../parts/ColHead.jsx";
import LedgerBox from "../parts/LedgerBox.jsx";
import { BankLedger } from "../parts/Confirm.jsx";
import { BusyCard } from "../parts/Reading.jsx";
import { ChipBar, NoMatch } from "../parts/ChipBar.jsx";

const MODE_NAME = { ATM: "ATM cash withdrawal", CASH: "Cash deposit", CHARGES: "Bank charges", INTEREST: "Interest credit" };
const EMPTY = { review: "Nothing to review. Every entry has a ledger.", ready: "No entries are ready yet.", done: "Nothing posted or ignored yet." };
const live = () => Bridge.on() && Bridge.up();


function RowLedger({ r }) {
  const b = B(), tip = r.why || undefined;
  if (!["attention", "suggested", "ready"].includes(r.state)) {
    const canUndo = r.state === "sent" && r.tally && r.tally.guid && live();
    // with no Tally ledger chosen for the account, a line is not said to be gone from Tally (review of 02-Oct-2026)
    const noLed = !bankLedgerReady(CO(), accountFor(curStmt() || {}));
    // round 15 (B1): bridge 2.1.8 said Tally's voucher id (or the batch's last id) when the line went: that, with the
    // company, the time in IST and who pressed Post; an older line as before
    const mark = r.state === "sent" && !r.goneFromTally && typeof postMarkOf === "function" ? postMarkOf(r) : null, words = mark ? postMarkWords(mark) : "";
    const matched = r.state === "sent" && typeof postMatched === "function" ? postMatched(r.id, b.cid) : null;
    const status = r.goneFromTally && noLed ? "Not found in Tally · choose this account’s Tally ledger to check and post"
      : r.goneFromTally ? "Not in Tally any more (deleted there?) · " + (r.state === "intally" ? "was found when reconciling" : "posted " + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : ""))
      : words ? words + (r.checking ? " · checking in Tally…" : "")
      // round 17a: posted by Tally's reply (bridge 2.1.8 does not read back) and no id came with it: posted, not "not found"
      : r.state === "sent" && r.postByReply === true && !bankMatched(r) ? "Posted to Tally (Tally's reply) · " + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : "")
      : r.state === "sent" && !bankMatched(r) ? (r.postedVia === "bridge" ? "Sent to Tally " : "In a Tally file ") + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : "") + (r.checking ? " · checking in Tally…" : " · not found in Tally yet")
      : r.state === "sent" ? "In Tally · posted " + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : "") + (r.tally && r.tally.number ? " · voucher " + r.tally.number : "")
      : r.state === "intally" ? "Already in Tally" + (r.tallyRef ? ": " + r.tallyRef : "") + (r.tallyHow ? " (" + r.tallyHow + ")" : "") : "Ignored";
    return <><span className="lgtext">{r.ledger || "—"}</span><span className="src muted" data-posted-line={words ? "" : undefined} data-batch-n={mark && mark.batchN || undefined}>{status}
      {matched && <> <span className="tag ok" data-matched="">Matched with Tally</span></>}
      {canUndo && <> <button className="linkbtn" onClick={() => bankRowAct("unpost", r.id)}>Take it back</button></>}</span></>;
  }
  const held = b.postedTags && String(b.postedTags[fpHash(r.fp || r.id)] || "").startsWith("unconfirmed");
  const rule = r.ruleId && (allRules().find((x) => x.id === r.ruleId) || { name: "gone" });
  return <>
    {r.state === "ready" && r.postError && <span className="src bad" title={r.postError}>Tally: {r.postError}
      {held && <> <button className="linkbtn" onClick={() => bankRowAct("notintally", r.id)}>I checked — it is not in Tally</button></>}</span>}
    <LedgerBox className={"lgbox" + (r.state === "suggested" ? " sugg" : r.state === "ready" ? " done" : "")} value={r.ledger || ""}
      fk={"bled:" + r.id} data-bled={r.id} placeholder="Select ledger" aria-label={"Ledger for " + (r.dec.name || r.narr.slice(0, 30))}
      onCommit={(v) => bankSetLedger(r.id, v)} />
    {r.state === "suggested" ? <span className="src" title={tip}>Suggested · {r.srcLabel || "Match"}</span>
      : r.state === "ready" ? <span className="src ok" title={tip}>{r.source === "you" || r.userSet ? "Set by you" : r.srcLabel || "Confirmed"}{r.vtype === "Contra" ? " · Contra" : ""}{r.billRef ? " · Bill " + r.billRef : ""}</span>
      : <span className="src muted" title={tip}>{hasLedgerList() ? "No match found" : "Import the ledger list"}</span>}
    {/* the rule's name opens it in the old rule editor */}
    {rule && <span className="src" data-legacy=""><button className="linkbtn" data-redit={r.ruleId}>rule: {ruleLabel(rule)}</button></span>}
    {r.tdsAtPay > 0 && <span className="src">TDS {money(r.tdsAtPay)} deducted at payment</span>}
    {(r.splits || []).length > 0 && <span className="src">split: {r.splits.map((sp) => sp.ledger + " " + money(sp.amt)).join(", ")}</span>}
  </>;
}

function RowActions({ r }) {
  const act = (a) => () => bankRowAct(a, r.id);
  const rule = <button className="linkbtn" title="Make a rule from this line" onClick={act("rule")}>Rule</button>;
  const ignore = <button className="icon" title="Ignore this entry" aria-label="Ignore" onClick={act("ignore")}>✕</button>;
  if (r.state === "suggested") return <><button className="btn small primary" onClick={act("accept")}>Confirm</button>{rule}{ignore}</>;
  if (r.state === "ready") return <>{live() && <><button className="btn small" onClick={act("post")}>Post</button> </>}{rule} <button className="linkbtn" onClick={act("unready")}>Undo</button></>;
  if (r.state === "attention") return <>{rule}{ignore}</>;
  return r.state === "sent" ? null : <button className="linkbtn" onClick={act("restore")}>Restore</button>;
}

function Row({ r, sel }) {
  const party = MODE_NAME[r.dec.mode] || r.dec.name || r.dec.upi || "";
  const sub = [r.dec.mode !== "OTHER" ? r.dec.mode : "", r.dec.chq ? "Chq " + r.dec.chq : r.dec.utr || ""].filter(Boolean).join(" · ");
  const flag = r.balOk === false ? <> <span className="flag bad" title="This entry does not agree with the running balance">!</span></>
    : r.repaired ? <> <span className="flag warn" title="Amount read from the balance change: check it">≈</span></> : null;
  return (
    <tr className={"st-" + r.state + (sel ? " picked" : "")}>
      <td className="ck"><input type="checkbox" aria-label="Select" checked={sel} disabled={r.state === "sent"} onChange={() => {}}
        onClick={(ev) => bankToggleRow(r.id, ev.target.checked, ev.shiftKey)} /></td>
      <td className="dt" title={fmtDate(r.date)}>{shortDate(r.date)}</td>
      <td className="pt"><div className="pn">{party || r.narr.slice(0, 60)}</div><div className="nr" title={r.narr}>{sub && <><span className="md">{sub}</span> </>}{r.narr}</div></td>
      <td className="n">{bkAmt(r.debit)}{r.debit ? flag : null}</td>
      <td className="n">{bkAmt(r.credit)}{r.credit ? flag : null}</td>
      <td className="lg"><RowLedger r={r} /></td>
      <td className="ac"><RowActions r={r} /></td>
    </tr>
  );
}

function Table({ tab }) {
  const b = B(), all = bankVisibleRows(), total = all.length, list = all.slice(0, b.limit);
  const nSel = all.filter((r) => b.sel.has(r.id)).length;
  return <>
    <div className="bk-tablewrap">
      <table className="bk-table">
        <thead><tr>
          <th className="ck"><input type="checkbox" aria-label="Select all" checked={!!nSel && nSel === total} onChange={(ev) => bankSelAll(ev.target.checked)} /></th>
          <ColHead t="bank" k="date" label="Date" cls="dt" /><ColHead t="bank" k="narr" label="Particulars" /><ColHead t="bank" k="wd" label="Withdrawal" cls="n" />
          <ColHead t="bank" k="dep" label="Deposit" cls="n" /><ColHead t="bank" k="led" label="Ledger" cls="lg" /><th className="ac"></th>
        </tr></thead>
        <tbody>{list.map((r) => <Row key={r.id} r={r} sel={b.sel.has(r.id)} />)}</tbody>
      </table>
      {!total && (bankRangeOn() ? <NoMatch t="bank" /> : <div className="bk-none">{EMPTY[tab] || "Nothing here."}</div>)}
    </div>
    {/* a long statement: more lines load as the end comes into view (the scroll listener in src/js/23 finds this button) */}
    {total > list.length && <div className="bk-more"><button className="btn small" data-act="bankMore" onClick={() => bankAct("bankMore")}>Show {Math.min(100, total - list.length)} more ({total - list.length} left)</button></div>}
  </>;
}

// one line per party among the entries to review, to give all its entries one ledger
function Group({ g }) {
  const sug = Object.entries(g.ledgers).sort((a, b) => b[1] - a[1])[0];
  return (
    <tr>
      <td className="pt"><div className="pn">{g.name}</div><div className="nr" title={g.sample}>{g.sample}</div></td>
      <td className="n">{g.n}</td><td className="n">{bkAmt(g.out)}</td><td className="n">{bkAmt(g.inn)}</td>
      <td className="lg">
        <LedgerBox className={"lgbox" + (sug ? " sugg" : "")} value={sug ? sug[0] : ""} fk={"gkey:" + g.key} data-gkey={g.key} placeholder="Select ledger"
          aria-label={"Ledger for " + g.name} id={"g-" + g.key} />
        {sug && <span className="src">Suggested for {sug[1]} of {g.n}</span>}
      </td>
      <td className="ac"><button className="btn small primary" onClick={() => { const inp = document.getElementById("g-" + g.key); applyGroup(g.key, inp ? inp.value : ""); acClose(); }}>Apply</button></td>
    </tr>
  );
}

function Groups() {
  const b = B(), q = b.q.trim().toLowerCase();
  const all = bankGroups().filter((g) => !q || (g.name + " " + g.sample).toLowerCase().includes(q)), groups = all.slice(0, b.limit);
  return <>
    <div className="bk-tablewrap">
      <table className="bk-table">
        <thead><tr><th>Party</th><th className="n">Entries</th><th className="n">Withdrawals</th><th className="n">Deposits</th><th className="lg">Ledger for all its entries</th><th className="ac"></th></tr></thead>
        <tbody>{groups.map((g) => <Group key={g.key} g={g} />)}</tbody>
      </table>
      {!all.length && <div className="bk-none">Nothing to review.</div>}
    </div>
    {all.length > groups.length && <div className="bk-more"><button className="btn small" data-act="bankMore" onClick={() => bankAct("bankMore")}>Show more parties ({all.length - groups.length} left)</button></div>}
  </>;
}

// after a search: give every line found the same ledger
function Found() {
  const b = B(), box = useRef(null);
  const hits = bankVisibleRows().filter((r) => r.state !== "sent" && r.state !== "intally");
  return (
    <div className="bk-found"><b>{hits.length}</b> entr{hits.length === 1 ? "y" : "ies"} match “{b.q.trim()}”
      {hits.length > 0 && <> · <span className="muted">set them all to</span>{" "}
        <input ref={box} type="text" className="bk-allled" data-ac="1" data-fk="allled" autoComplete="off" placeholder="a ledger from Tally" defaultValue={b.allLed || ""} aria-label="Ledger for all found" />
        <button className="btn small primary" onClick={() => applyToVisible(box.current.value.trim())}>Set all {hits.length}</button></>}
      {" "}<button className="linkbtn" onClick={() => bankAct("bankClearSearch")}>Clear</button>
    </div>
  );
}

function LastFail({ f }) {
  return (
    <div className="bk-alert bad"><b>{f.file} was not read.</b> {f.msg}
      <div className="row" style={{ gap: 8, marginTop: 8 }}><span className="note">Read it again:</span>
        <button className="btn small" onClick={() => bankAct("bankRetryFree")}>Try again</button>
        <button className="btn small" disabled={!googleReady()} title={googleReady() ? undefined : "Google OCR is not set up"} onClick={() => bankAct("bankRetryGoogle")}>With Google OCR</button>
        <button className="btn small primary" disabled={!claudeReady()} title={claudeReady() ? undefined : "Claude is not available here"} onClick={() => bankAct("bankRetryClaude")}>With Claude</button>
        <button className="linkbtn" onClick={() => bankAct("bankCopyReport")}>Copy details for support</button>
        <button className="linkbtn" onClick={() => bankAct("bankDismissFail")}>Dismiss</button>
      </div>
      {/* read by "Copy details for support" */}
      <textarea id="bankReport" readOnly hidden value={f.report || ""} />
    </div>
  );
}

// before the ledgers are known, suggestions cannot be made: how to get them
function LedgerSetup({ co }) {
  if (hasLedgerList()) return null;
  if (B().ledgersLoading || (typeof TCloud === "object" && TCloud.on() && TCloud.has(co.id))) return <div className="bk-setup"><div><b>Loading ledgers from FinCom’s cloud copy of the books…</b><div className="note">The ledgers of {(TCloud.book(co.id) || {}).company || co.name}, as the Tally computer last sent them.</div></div></div>;
  if (bridgeLive(co)) return <div className="bk-setup"><div><b>Loading ledgers from Tally…</b><div className="note">{Bridge.openFor(co).name} is open in Tally.</div></div></div>;
  if (live()) return <div className="bk-setup"><div><b>Open {Bridge.tallyName(co)} in TallyPrime</b><div className="note">Its ledgers load automatically once it is open. Or import the ledger list from a file.</div></div><button className="btn small" onClick={() => bankAct("ledPick")}>Import from file</button></div>;
  return <div className="bk-setup"><div><b>Import the Tally ledger list for {co.name}</b><div className="note">Suggestions only use ledgers that exist in Tally. In Tally: Display More Reports → List of Accounts → Export (Excel or XML). With FinCom Bridge this happens automatically.</div></div><button className="btn primary small" onClick={() => bankAct("ledPick")}>Import ledger list</button></div>;
}

// the deleted statements (soft deletes, kept on the server and in this browser), read once for the Restore item
function trashOf(b) {
  if (b && (b.stmtsTrash === undefined || b.stmtsTrash === null)) {
    b.stmtsTrash = [];
    Promise.all([Trash.list(b.cid, "statement"), BankDB.get("stmtsTrash:" + b.cid)]).then(([l, old]) => {
      b.stmtsTrash = l.concat((old || []).map((x) => ({ label: x.st.bank + " " + fmtDate(x.st.from) + " to " + fmtDate(x.st.to), at: x.at, by: x.by, reason: "" })));
      if (b.stmtsTrash.length) render();
    }, () => {});
  }
  return b.stmtsTrash || [];
}

// with no statement open, a deleted one can still be put back
function RestoreMenu() {
  const t = trashOf(B());
  if (!t.length) return null;
  return <details className="bk-menu" data-more="bank-restore"><summary className="btn small">More</summary><div className="bk-menu-list">
    <button onClick={() => bankAct("bankRestoreStmt")}>Restore a deleted statement<small>{Trash.say(t[0])}</small></button>
  </div></details>;
}

function MoreMenu({ tc }) {
  const b = B();
  trashOf(b);
  const M = ({ act, title, children, danger }) => <button className={danger ? "danger" : undefined} onClick={() => bankAct(act)}>{title}{children && <small>{children}</small>}</button>;
  return (
    <details className="bk-menu"><summary className="btn small">More</summary><div className="bk-menu-list">
      {live() ? <>
        <M act="reconRun" title="Reconcile with Tally">Every statement line against the bank ledger in Tally: what to post, what to delete</M>
        <M act="bankBalCheck" title="Check the balance with Tally">Tally’s bank balance against the statement’s closing</M>
        <M act="bankCheckTally" title="Mark lines already in Tally">Reads the bank ledger; lines found there are not posted again</M>
        <M act="dupFind" title="Find double or wrong-date entries">Entries from this statement that are in Tally twice or under another date</M>
        <M act="bankSync" title="Reload ledgers from Tally">After you create or rename a ledger in Tally</M>
        <M act="bankFile" title="Create a Tally file instead">Download an XML to import in Tally yourself</M>
      </> : <M act="bookPick" title="Match with Tally bank book" />}
      <M act="bankCsv" title="Download as Excel (CSV)" />
      {S.engine && tc.attention > 0 && <M act="bankClaude" title="Ask Claude for the remaining entries" />}
      <M act="bankClearStmt" title="Clear all decisions" />
      <M act="bankDelStmt" title="Delete this statement" danger>Asks for the client’s name; it can be restored</M>
      {(b.stmtsTrash || []).length > 0 && <M act="bankRestoreStmt" title="Restore a deleted statement">{Trash.say(b.stmtsTrash[0])}</M>}
    </div></details>
  );
}

export default function Bank() {
  const b = B(), co = CO();
  if (!b || b.cid !== co.id) { loadBank(co.id); return <p className="note">Opening bank statements…</p>; }
  if (b.loading) return <p className="note">Opening bank statements…</p>;
  setTimeout(() => TallyProof.checkBank(co.id).catch(() => {}), 0);
  ensureFileInputs();
  const st = curStmt();
  const top = <>
    {(BankDB.mode === "memory only" || BankDB.lost) && <div className="bk-alert bad">This browser is not keeping bank statements{BankDB.lost ? " (storage is full)" : ""}. Create the Tally file before closing, or use Chrome.</div>}
    {/* what FinCom is doing floats in view wherever you are on the page */}
    {b.busy && <div className="busy-float"><BusyCard title={/Tally/.test(b.busy) ? "Working with Tally…" : "Working on the statement…"} detail={b.busy} /></div>}
    {b.moved && <div className="bk-alert"><b>{b.moved.file}</b> is a statement of {b.moved.name} (account ··{b.moved.last4}), so it was filed there.{" "}
      <button className="linkbtn" onClick={() => bankAct("bankOpenMoved")}>Open {b.moved.name}</button> <button className="linkbtn" onClick={() => bankAct("bankDismissMoved")}>Dismiss</button></div>}
    <PostReport rep={b.postReport} />
    <FixBanner />
    {b.lastFail && <LastFail f={b.lastFail} />}
    <LedgerSetup co={co} />
  </>;
  if (!st) return <>
    <div className="bk">
      {top}
      <div className="bk-empty" id="bankDrop" tabIndex={0} role="button" onClick={() => bankAct("bankPick")} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); bankAct("bankPick"); } }}>
        <div className="bk-empty-ic">⤒</div><h2>Upload a bank statement</h2>
        <p className="note">Excel or CSV from net banking works best. E-statement PDFs, scanned PDFs and photos are also read. Every entry is checked against the running balance.</p>
        <span className="btn primary">Choose files</span>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10, gap: 8 }}><button className="btn small" onClick={() => bankAct("bankSettings")}>Settings</button><RestoreMenu /></div>
    </div>
    {b.showSettings && <BankSettings />}
  </>;

  // the account's Tally ledger as chosen (review 19): shown from what was confirmed, whether or not the ledger list has
  // loaded yet; asked for only for a new account, a guess to confirm, or a ledger gone from a complete list
  const acc = accountFor(st), accLedger = bankLedgerChoice(CO(), acc).value, tc = tabCounts(bankRangeRows()), tab = bankTab();
  const repaired = b.rows.filter((r) => r.repaired).length, book = b.books[st.acctId];
  const sum = (k) => money(st[k === "debit" ? "totDr" : "totCr"] || b.rows.reduce((a, r) => a + num(r[k]), 0));
  let range = null;
  if (bankRangeOn()) {
    const inR = bankRangeRows();
    range = <ChipBar t="bank" shown={inR.length} total={b.rows.length + " lines"} extra={"out " + money(r2(inR.reduce((a, r) => a + num(r.debit), 0))) + " · in " + money(r2(inR.reduce((a, r) => a + num(r.credit), 0)))} />;
  }
  return <>
    <div className="bk">
      {/* the steps at the top of the page (review of 02-Oct-2026: they were about 490 px down) */}
      <div className="bk-bar">
        <div className="bk-tabs" role="tablist">
          {BANK_TABS.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k && !b.focus} onClick={() => bankTabGo(k)}>{t} <span className="cnt">{tc[k]}</span></button>)}
          <button role="tab" aria-selected={tab === "rules"} onClick={() => bankTabGo("rules")}>Rules <span className="cnt">{allRules().length}</span></button>
        </div>
        {tab === "review" && <label className="bk-switch"><input type="checkbox" checked={!!b.grouped} onChange={(ev) => bankSetGrouped(ev.target.checked)} /> Group by party</label>}
        <input type="search" className="bk-search" autoComplete="off" placeholder="Search the description, party or amount" aria-label="Search the statement" value={b.q} onChange={(ev) => bankSearch(ev.target.value)} />
      </div>
      <div className="bk-head">
        <div className="bk-id">
          {b.stmts.length > 1
            ? <select className="bk-stmtsel" aria-label="Statement" value={b.cur} onChange={(ev) => openStatement(ev.target.value)}>
                {b.stmts.slice().reverse().map((s) => <option key={s.id} value={s.id}>{stmtLabel(s)}</option>)}</select>
            : <h2 className="bk-title">{accLedger || st.bank}</h2>}
          <div className="bk-sub">{st.bank}{st.acct ? " · A/c " + st.acct : ""} · {fmtDate(st.from)} to {fmtDate(st.to)} · {b.rows.length} entries</div>
        </div>
        <dl className="bk-figs">
          <div><dt>Opening</dt><dd>{st.opening !== undefined ? money(st.opening) : "—"}</dd></div>
          <div><dt>Withdrawals</dt><dd>{sum("debit")}</dd></div><div><dt>Deposits</dt><dd>{sum("credit")}</dd></div>
          <div><dt>Closing</dt><dd>{st.closing !== undefined ? money(st.closing) : "—"}</dd></div>
        </dl>
        <div className="bk-actions"><button className="btn small" onClick={() => bankAct("bankSettings")}>Settings</button><MoreMenu tc={tc} /></div>
      </div>
      <div className="bk-check">
        {st.badRows ? <span className="bad">✖ {st.badRows} entries do not agree with the running balance — check them before posting</span>
          : <span className="ok">✔ The statement adds up: every line agrees with its running balance{st.summaryOk ? ", and opening + deposits − withdrawals = closing" : ""}</span>}
        {repaired > 0 && <> <span className="warn">· {repaired} amounts were read from the balance change (marked ≈)</span></>}
        {st.dupRows > 0 && <> <span className="muted">· {st.dupRows} entries skipped (already uploaded)</span></>}
        {book && <> <span className="muted">· {book.live ? "Checked against Tally " + fmtDateTime(book.importedAt) : "Matched with the Tally bank book"}</span></>}
      </div>
      {accLedger && (Bridge.on() || st.tallyBal) && <BankBalance st={st} />}
      <Recon />
      <BankLedger co={CO()} acc={acc.id ? acc : Object.assign({ id: st.acctId, bank: st.bank }, acc)} />
      {top}
      {range}
      <Gone /><DupFind /><BankFocus />
      {tab === "done" && !b.focus && live() && tc.done > 0 && <div className="bk-found"><span className="muted">Deleted some of these in Tally?</span> <button className="btn small" onClick={() => bankAct("goneCheck")}>Check they are still in Tally</button></div>}
      {b.offerRule && <div className="bk-found" style={{ borderColor: "var(--ledger)" }}><b>Keep this as a rule?</b> Every future line containing “{b.offerRule.text}” would go to <b>{b.offerRule.ledger}</b> by itself.{" "}
        <button className="btn small primary" onClick={() => bankAct("ruleFromBulk")}>Yes, make the rule</button><button className="linkbtn" onClick={() => bankAct("ruleNoThanks")}>No thanks</button></div>}
      {b.q.trim() && <Found key={b.q} />}
      {tab === "rules" ? <RulesPanel /> : tab === "review" && b.grouped ? <Groups /> : <Table tab={tab} />}
    </div>
    {b.showSettings && <BankSettings />}
  </>;
}

// the bar at the bottom: what is ticked and what can be done with it, or the counts and posting; and the last
// change, with Undo
export function BankBar() {
  const b = B();
  if (!b || b.loading || !curStmt()) return null;
  const tc = tabCounts(bankRangeRows()), nsel = b.sel.size;
  // review of 02-Oct-2026: with no Tally ledger chosen for this bank account nothing can be posted, and nothing can be
  // said about which lines are in Tally ("184 no longer in Tally · post them again" was shown for lines of an account
  // with no ledger): posting waits, said in one line with the way to choose it
  // posting waits until the account's ledger is confirmed (review 19, src/js/60 bankLedgerWhy): one line saying why
  const accNow = accountFor(curStmt()), noLed = !bankLedgerReady(CO(), accNow), whyLed = noLed ? bankLedgerWhy(CO(), accNow) : "";
  const chooseLed = () => { const el = document.querySelector('select[aria-label="Tally ledger for this bank account"]') || document.querySelector("[data-bank-ledger-confirm]"); if (el) { el.scrollIntoView({ block: "center" }); el.focus(); } else bankAct("bankSettings"); };
  let left, right;
  if (nsel) {
    const rows = bankSelected(), ready = rows.filter((r) => r.state === "ready").length;
    left = <><b>{nsel} selected</b> <span className="muted">· {money(r2(rows.reduce((a, r) => a + (r.debit || r.credit), 0)))}</span> <button className="linkbtn" onClick={() => bankAct("bankSelNone")}>Clear</button></>;
    right = <>
      {/* Enter in this box, or a ledger picked from its list, applies it (src/js/23) */}
      <input type="text" className="lgbox" data-bulkled="" data-fk="bulkled" data-ac="1" autoComplete="off" placeholder={"Ledger for the " + nsel + " selected"} aria-label="Ledger for the selected" />
      <button className="btn" onClick={() => bankAct("bankBulkLedger")}>Apply ledger</button>
      {rows.some((r) => r.state === "suggested") && <button className="btn primary" onClick={() => bankAct("bankBulkAccept")}>Confirm</button>}
      {rows.some((r) => ["attention", "suggested", "ready"].includes(r.state)) && <button className="btn" onClick={() => bankAct("bankBulkIgnore")}>Ignore</button>}
      {rows.some((r) => r.state === "ignored" || r.state === "intally") && <button className="btn" onClick={() => bankAct("bankBulkRestore")}>Restore</button>}
      {live() && ready > 0 && <button className="btn primary" disabled={noLed} title={noLed ? whyLed : undefined} onClick={() => bankAct("bankBulkPost")}>Post {ready} to Tally</button>}
    </>;
  } else {
    left = <><span className="bk-stat"><b>{tc.review}</b> to review</span><span className="bk-stat"><b>{tc.post}</b> ready to post</span>{tc.filed > 0 && <span className="bk-stat"><b>{tc.filed}</b> in a Tally file, not found in Tally</span>}
      {tc.gone > 0 && !noLed && <span className="bk-stat" data-bank-gone=""><b>{tc.gone}</b> no longer in Tally <button className="linkbtn" onClick={() => bankRepostGone()}>post them again</button></span>}
      {noLed && <span className="bk-stat bad" data-bank-noledger="">{whyLed + " "}<button className="linkbtn" onClick={chooseLed}>{/guessed/.test(whyLed) ? "Confirm the ledger" : "Choose the ledger"}</button></span>}</>;
    right = <>
      {tc.suggested > 0 && <button className="btn" onClick={() => bankAct("bankAcceptAll")}>Confirm all suggestions ({tc.suggested})</button>}
      {canPostTally(CO()) ? <button className="btn primary" disabled={!tc.post || noLed} title={noLed ? whyLed : undefined} onClick={() => bankAct("bankPost")}>Post to Tally ({tc.post})</button>
        : <button className="btn primary" disabled={!tc.post || noLed} title={noLed ? whyLed : undefined} onClick={() => bankAct("bankXml")}>Create Tally file ({tc.post})</button>}
    </>;
  }
  const u = !nsel && b.undo;
  const said = u && (u.what === "set" || u.what === "bulk"
    ? <>{u.label} → <b>{u.ledger}</b>{u.others ? " · also " + entries(u.others) + " of this party" : ""}{u.ruleKeys && u.ruleKeys.length ? " · remembered" : ""}</>
    : u.what === "clear" && u.n > 1 ? "All decisions cleared" : entries(u.n) + " " + ({ accept: "confirmed", ignore: "ignored", restore: "restored", clear: "cleared", unready: "moved back to review" }[u.what] || "changed"));
  return (
    <div className="actionbar bk-actionbar">
      {u && <div className="bk-snack"><span>{said}</span><button className="linkbtn" onClick={() => bankAct("bankUndo")}>Undo</button>
        {u.ruleKeys && u.ruleKeys.length > 0 && <button className="linkbtn" onClick={() => bankAct("bankForget")}>Don’t remember</button>}
        <button className="icon" aria-label="Close" onClick={() => bankAct("bankUndoOk")}>✕</button></div>}
      <div className="ab-left">{left}</div><div className="ab-right">{right}</div>
    </div>
  );
}
