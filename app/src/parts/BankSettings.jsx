// A client's bank settings (the Tally ledger list, each bank account's ledger, the ledgers for standard entries,
// automation, clean up) and its written rules (with the rules FinCom can make from past choices). Shown over the bank
// screen, and in Client setup (Bank accounts, Rules). Was bankSettingsHtml (src/js/23), viewRulesPanel and
// viewSuggestions (src/js/22); the ledger lists are parts/LedgerSelect.jsx. Buttons go through bankAct; choices through
// bankSetAccLedger, bankStdLedger, bankOptSet, ruleAct, bankSettingsShow (src/js/23). The ticks on suggested rules are
// read from their boxes (data-sug) by ruleMakeSug, as before.

import LedgerSelect from "./LedgerSelect.jsx";

const Btn = ({ act, className = "btn small", children, disabled }) => <button className={className} disabled={disabled} onClick={() => bankAct(act)}>{children}</button>;

function Panel() {
  const b = B(), co = CO(), std = Object.keys(BANK_LEDGER_DEFAULTS), pendingNew = b.newLed.filter((l) => !l.sent).length, nh = Object.keys(b.hist.rows).length;
  return <div className="bk-panel" role="dialog" aria-modal="true" aria-labelledby="bkSetT"><div className="bk-panel-head"><h2 id="bkSetT">{"Bank settings — " + co.name}</h2><button className="icon" aria-label="Close" onClick={() => bankSettingsShow(false)}>✕</button></div>
    <section><h3>Tally ledger list</h3>{bridgeLive(co) ? <><p className="note">{"Live from Tally (" + Bridge.openFor(co).name + "): " + b.ledgers.list.length + " ledgers, updated " + (b.ledgers.importedAt ? fmtDateTime(b.ledgers.importedAt) : "—") + "."}</p><Btn act="bankSync">Refresh from Tally</Btn></>
      : <>{hasLedgerList() ? <p className="note">{b.ledgers.list.length + " ledgers, imported " + fmtDate(b.ledgers.importedAt.slice(0, 10)) + " from " + (b.ledgers.file || "Tally") + "." + (Date.now() - new Date(b.ledgers.importedAt) > 30 * 864e5 ? " Over 30 days old: update it." : "")}</p>
        : <p className="note">Not imported yet. In Tally: Display More Reports → List of Accounts → Export (Excel or XML).</p>}
        <Btn act="ledPick">{hasLedgerList() ? "Update ledger list" : "Import ledger list"}</Btn>
        {pendingNew > 0 && <p className="note">{plural(pendingNew, "new ledger") + " will be created in Tally with the next Tally file."}</p>}</>}</section>
    <section><h3>Bank accounts</h3>{(co.bankAccounts || []).length ? <div className="bk-form">{co.bankAccounts.map((a) =>
      <label key={a.id}><span>{a.bank + (a.last4 ? " ··" + a.last4 : "") + (a.ifsc ? " · " + a.ifsc : "")}</span><LedgerSelect aria-label={"Ledger for " + a.bank} selected={exactLedger(a.ledger)} prefer={BANK_GROUPS} onPick={(v) => bankSetAccLedger(a.id, v)} /></label>)}</div>
      : <p className="note">Bank accounts are added when you upload their statements.</p>}</section>
    <section><h3>Ledgers for standard entries</h3><p className="note">Found automatically in the ledger list; change them if this client uses different ledgers.</p><div className="bk-form">{std.map((k) =>
      <label key={k}><span>{BANK_LEDGER_LABELS[k]}</span><LedgerSelect aria-label={BANK_LEDGER_LABELS[k]} selected={stdLedger(co, k)} onPick={(v) => bankStdLedger(k, v)} /></label>)}</div></section>
    <section><h3>Automation</h3>
      <label className="chk"><input type="checkbox" checked={co.bankAuto !== false} onChange={(ev) => bankOptSet("bankAuto", ev.target.checked)} /> Mark sure matches as Ready (saved rules, exact bill matches, standard entries)</label>
      <label className="chk"><input type="checkbox" checked={!!co.bankOptional} onChange={(ev) => bankOptSet("bankOptional", ev.target.checked)} /> Post bank entries into Tally as Optional vouchers (they then have to be made regular in Tally)</label>
      <label className="chk"><input type="checkbox" checked={co.bankAutoApply !== false} onChange={(ev) => bankOptSet("bankAutoApply", ev.target.checked)} /> When I choose a ledger for an entry, use it for every entry of the same party and remember it</label></section>
    <section><h3>Clean up</h3><p className="note">{b.rules.length + " saved rules · " + nh + " remembered decisions · " + b.stmts.length + " statements"}</p><div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <Btn act="bankClearRules" disabled={!b.rules.length}>Forget saved rules</Btn><Btn act="bankClearHist" disabled={!nh}>Forget remembered decisions</Btn><Btn act="bankDelAll" className="btn small danger" disabled={!b.stmts.length}>Delete all statements</Btn></div></section>
  </div>;
}

// over the bank screen (a click outside closes it), or inline in Client setup
export function BankSettings({ inline }) {
  if (inline) return <div className="setup-inline"><div className="bk-overlay"><Panel /></div></div>;
  return <div className="bk-overlay" onClick={(ev) => { if (ev.target === ev.currentTarget) bankSettingsShow(false); }}><Panel /></div>;
}

function Suggestions() {
  const list = S.ruleSuggest;
  if (!list) return <div className="row" style={{ marginTop: 10 }}><Btn act="ruleFind">Look for rules in what we have done before</Btn></div>;
  if (!list.length) return <p className="note" style={{ marginTop: 10 }}>Nothing worth a rule yet — the same wording has to be booked to the same ledger at least three times. <Btn act="ruleFindClose" className="linkbtn">Hide</Btn></p>;
  const all = (ev) => document.querySelectorAll("[data-sug]").forEach((x) => { x.checked = ev.target.checked; });
  return <div className="bdiag" style={{ marginTop: 12 }}><b>{list.length + " rule" + (list.length === 1 ? "" : "s") + " we can make from what you have already done"}</b>
    <div className="tblwrap" style={{ marginTop: 6 }}><table className="data"><thead><tr><th className="ck"><input type="checkbox" aria-label="Tick all" defaultChecked onClick={all} /></th><th>When the line says</th><th>Money</th><th>Use this ledger</th><th className="n">Done before</th></tr></thead><tbody>
      {list.map((s, i) => <tr key={i}><td className="ck"><input type="checkbox" data-sug={i} aria-label={"Make: " + s.text} defaultChecked={!s.off} /></td><td><b>{s.text}</b><div className="nr">{String(s.sample).slice(0, 60)}</div></td>
        <td>{s.dir === "out" ? "going out" : s.dir === "in" ? "coming in" : "either"}</td><td>{s.ledger}</td><td className="n">{s.n + " times"}{s.agree < 100 && <div className="nr">{s.agree + "% the same"}</div>}</td></tr>)}</tbody></table></div>
    <div className="row" style={{ marginTop: 8 }}><Btn act="ruleMakeSug" className="btn small primary">Make the ticked rules</Btn><Btn act="ruleFindClose">Not now</Btn></div></div>;
}

function RuleRow({ r, scope, co }) {
  const p = rulePreview(r), led = ruleLedger(r, co), bad = r.then.action !== "ignore" && led && !exactLedger(led), n = (r.then.splits || []).length;
  return <tr className={r.off ? "off" : undefined} data-key={r.id}><td className="ord">{scope === "client" && <><button className="icon" title="Move up" onClick={() => ruleAct("up", r.id)}>↑</button><button className="icon" title="Move down" onClick={() => ruleAct("down", r.id)}>↓</button></>}</td>
    <td><b>{ruleLabel(r)}</b>{r.off && <> <span className="tag no">off</span></>}<div className="nr">{ruleWhenText(r)}</div></td>
    <td>{r.then.action === "ignore" ? <span className="tag">set aside</span> : <>{bad ? <span className="tag bad">{led + " not in Tally"}</span> : (led || "—")}{n > 0 && <div className="nr">{"split into " + (n + 1) + " lines"}</div>}{!r.then.ready && <div className="nr">shown for checking, not auto-ready</div>}</>}</td>
    <td className="n">{p.n ? <b>{p.n}</b> : "0"}<div className="nr">now showing</div></td>
    <td className="n">{(r.stats && r.stats.used) || 0}{r.stats && r.stats.over ? <div className="nr bad">{r.stats.over + " changed by hand"}</div> : null}</td>
    <td style={{ whiteSpace: "nowrap" }}><button className="btn small" onClick={() => ruleAct("edit", r.id)}>Change</button>{" "}<button className="linkbtn" onClick={() => ruleAct("toggle", r.id)}>{r.off ? "Use" : "Pause"}</button>{" "}
      {scope === "client" && <><button className="linkbtn" onClick={() => ruleAct("copy", r.id)}>Copy to…</button>{" "}</>}<button className="linkbtn" onClick={() => ruleAct("del", r.id)}>Delete</button></td></tr>;
}

// the client's rules, then the firm-wide ones, read from the top down
export function RulesPanel() {
  const b = B(), co = CO(b.cid), mine = clientRules(), firm = firmRules();
  return <section className="pane"><div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h2 style={{ margin: 0 }}>Rules</h2>
    <div><Btn act="ruleNew" className="btn small primary">New rule</Btn><Btn act="ruleRunNow">Apply to this statement</Btn>{mine.length > 0 && <Btn act="ruleCopyAll">Copy to other clients</Btn>}</div></div>
    <p className="note" style={{ margin: "6px 0 10px" }}>Rules are read from the top down; the first one that fits wins. Your own choices are never overwritten by a rule.</p>
    <div className="tblwrap"><table className="data"><thead><tr><th></th><th>Rule</th><th>Does</th><th className="n">Matches</th><th className="n">Used</th><th></th></tr></thead><tbody>
      {mine.length ? mine.map((r) => <RuleRow key={r.id} r={r} scope="client" co={co} />) : <tr><td colSpan={6} className="nr">{"No rules for " + co.name + " yet. Make one from any line, or press New rule."}</td></tr>}
      {firm.length > 0 && <><tr><td colSpan={6} style={{ background: "var(--paper)" }}><b>Firm-wide rules</b> — used for every client, after this client’s own rules</td></tr>{firm.map((r) => <RuleRow key={r.id} r={r} scope="firm" co={co} />)}</>}
    </tbody></table></div>
    {!firm.length && <p className="note" style={{ marginTop: 8 }}>Tip: bank charges, interest, salaries and the like are the same for every client. Make those firm-wide once.</p>}
    <Suggestions />
  </section>;
}

// Client setup, Bank accounts or Rules: the client's bank details are opened first
export function BankSetup({ which }) {
  const co = CO();
  if (!S.bank || S.bank.cid !== co.id || S.bank.loading) {
    if (!S.bank || S.bank.cid !== co.id) loadBank(co.id).then(() => render());
    return <p className="note">Loading this client’s bank details…</p>;
  }
  return which === "rules" ? <RulesPanel /> : <BankSettings inline />;
}
