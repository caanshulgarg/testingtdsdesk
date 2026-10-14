// The TDS and GST ledgers, confirmed on the TDS and GST pages (the owner's request of 14-Oct-2026: "Earlier TDS and GST
// ledger confirmation in TDS and GST pages was good UI; we should do that from there only, so remove that from
// Settings"). In the style of that page (the Tally ledgers tab beside TDS and GST, FinCom 2.4.1): one status line for
// the ledgers from Tally, Please check, one table a row a ledger with ONE answer, Confirm / Change, and folded at the foot
// the other ledgers and notices. New here:
//   - every TDS or GST ledger of the client's Tally (FinCom's cloud copy: group, opening, Tally's nature of payment), also
//     those no entry uses yet;
//   - where each answer came from: "FinCom's rules" (Tally's master, the day book, the name; what the returns use today,
//     flagged in To fix until confirmed), "AI guess" with its reason (only where the rules cannot tell; never counted
//     until a person confirms it), or "Not known";
//   - Unconfirm on a confirmed ledger (back to "to confirm" with its last answer, who and when kept; filed returns named,
//     never changed), "Confirm all shown";
//   - the ledgers FinCom posts to (were Client setup's boxes), each chosen from the client's Tally ledgers with a search.
// The working is TaxLed (src/js/81-tax-ledgers.js); the pieces shared with the old tab are books/Ledgers.jsx.
//
// State: S.ledKind (tds | gst | all), S.ledQ (the find box), S.ledEdit (the row being changed), S.tlPick (the posting
// choice whose picker is open) and S.tlPickQ (its search).
import { Editor, changeRow, Example, PleaseCheck, Status, UndoLine, Others, Notices, pleaseLines } from "./Ledgers.jsx";
const plural = (k, one, many) => k + " " + (k === 1 ? one : many);
const money = (v) => "₹" + INR.format(r2(Math.abs(v || 0)));
const KIND_LABEL = { tds: "TDS ledgers", gst: "GST ledgers", all: "TDS and GST ledgers" };

// where the answer came from, in a word, with the AI's reason
function Source({ r }) {
  if (r.src === "confirmed") return null;
  if (r.src === "ai") return <div className="tl-src" data-tl-src="ai"><span className="tag warn">AI guess</span> <span className="note" data-tl-ai-reason="">{r.why || "read from the name, group and entries"}</span></div>;
  if (r.src === "rule") return <div className="tl-src" data-tl-src="rule"><span className="tag">FinCom’s rules</span>{r.why ? <span className="note" title={r.why}>{" " + r.why.split("; ")[0].slice(0, 90)}</span> : null}</div>;
  return <div className="tl-src" data-tl-src="none"><span className="tag bad">Not known</span> <span className="note">FinCom could not tell: choose with Change</span></div>;
}

// what the answer is, in the words of the page it is on: TDS (section, nature of payment, rate, deductee type) or GST
// (head and side, rate, input tax credit)
function Detail({ r }) {
  const bits = [];
  if (r.kind === "tds" && r.nature) bits.push("Nature: " + r.nature);
  if (r.kind === "tds" && r.dtype) bits.push("Deductee: " + r.dtype);
  if (r.itc) bits.push(r.itc);
  return bits.length ? <div className="nr" data-tl-detail="">{bits.join(" · ")}</div> : null;
}

function Act({ b, r }) {
  if (S.ledEdit === r.n) return null;
  const change = <button className="linkbtn" data-led-change={r.n} onClick={() => changeRow(b, r)}>Change</button>;
  if (r.ok) return <span className="led-act led-act-ok">
    <span className="cfm-ok" data-led-okby="" data-choice-state="confirmed">{"✓ Confirmed" + (r.okBy ? " by " + r.okBy : "") + (r.okAt ? ", " + fmtDateTime(r.okAt) : "")}</span>
    <button className="linkbtn" data-led-unconfirm={r.n} title="Back to “to confirm”, keeping this answer" onClick={() => TaxLed.unconfirm(b, r.n)}>Unconfirm</button>{change}
    {/* a Change (or the check's answer taken) can be undone: the answer before it comes back (LedPage.undoRow) */}
    {r.m && /^(change|check)$/.test(r.m.okHow || "") && r.m.prev !== undefined && <button className="linkbtn" data-led-undo={r.n} title="Put back the answer before this change" onClick={() => LedPage.undoRow(b, r.n)}>Undo change</button>}</span>;
  return <span className="led-act">
    {r.ans && r.ans.what ? <button className="btn small" data-led-confirm={r.n} onClick={() => TaxLed.confirm(b, [r.n], "row")}>Confirm</button> : null}{change}</span>;
}

function Ledger({ r }) {
  return <td><b className="led-name">{r.n}</b>
    <div className="nr">{[r.group, r.open != null && r.open !== 0 ? "Opening " + money(r.open) + (r.open < 0 ? " Dr" : " Cr") : ""].filter(Boolean).join(" · ")}</div>
    {!r.inBooks && r.tally && <div className="nr" data-tl-tally-only="">In Tally, no entries yet</div>}</td>;
}

function Table({ b, rows, which }) {
  return <table className="led-t nocards" data-led-table={which}><thead><tr><th>Ledger in your Tally</th><th>FinCom reads it as</th><th className="n">Used in (entries)</th><th>Example entry</th><th className="ac"></th></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.n} data-key={r.n} data-ok={r.ok ? "1" : "0"} data-src={r.src}>
      <Ledger r={r} />
      <td>{S.ledEdit === r.n ? <Editor b={b} n={r.n} seed={r.src === "ai" ? r.ans : null} /> : <>
        <span className={"led-says" + (r.ans && r.ans.what ? "" : " led-unknown")} data-tl-says="">{r.says}</span><Detail r={r} /><Source r={r} />
        {r.unok && <div className="nr" data-tl-unok="">{"Unconfirmed by " + r.unok.by + ", " + fmtDateTime(r.unok.at) + (r.unok.was && r.unok.was.by ? " (confirmed before by " + r.unok.was.by + ")" : "")}</div>}
        {r.unok && (r.unok.filed || []).length > 0 && <div className="nr warn" data-tl-filed="">{TaxLed.filedSay(r.unok.filed)}</div>}</>}</td>
      <td className="n" data-led-used="">{r.used ? Number(r.used).toLocaleString("en-IN") : <span className="note">not used yet</span>}</td>
      <td className="led-ex"><Example x={r.ex} /></td>
      <td className="ac"><Act b={b} r={r} /></td></tr>)}</tbody></table>;
}

// the AI's state in one line: reading, done (how many, from the cache), off for the firm, or could not be asked
function AiLine({ b, rows }) {
  const cid = b.cid, busy = TaxLed.ai.busy[cid], last = TaxLed.ai.last[cid], err = TaxLed.ai.err[cid], on = TaxLed.aiOn();
  const open = rows.filter((r) => !r.ok && (r.src === "none" || r.src === "ai")), guessed = rows.filter((r) => !r.ok && r.src === "ai").length;
  if (!open.length && !last) return null;
  let text = "", act = null;
  if (busy) text = "AI is reading the ledgers FinCom’s rules could not tell…";
  else if (!on || err === "off") text = "AI is off for the firm, so the rules’ guesses are shown" + (open.length ? " (" + plural(open.length, "ledger", "ledgers") + " left to you)" : "") + ". The owner can switch it on in Settings › AI help.";
  else if (err) { text = "AI could not be asked: " + err + ". The rules’ guesses are shown."; act = <button className="linkbtn" data-tl-ai-ask="" onClick={() => TaxLed.ask(b)}>Try again</button>; }
  else if (guessed) text = plural(guessed, "AI guess", "AI guesses") + " where FinCom’s rules could not tell. A guess counts in nothing until you confirm it.";
  else if (TaxLed.toAsk(b, rows).length) act = <button className="linkbtn" data-tl-ai-ask="" onClick={() => TaxLed.ask(b)}>{"Ask AI about " + plural(TaxLed.toAsk(b, rows).length, "ledger", "ledgers") + " FinCom could not tell"}</button>;
  if (!text && !act) return null;
  return <p className="note tl-ai" data-tl-ai={busy ? "busy" : !on || err === "off" ? "off" : err ? "error" : guessed ? "done" : "ready"}>{text}{text && act ? " " : ""}{act}</p>;
}

// a search over the client's Tally ledgers ("TDS payable 194C"); onPick with the ledger's name
function TallyPick({ id, cid, onPick, prefer, label }) {
  const open = S.tlPick === id, q = open ? S.tlPickQ || "" : "";
  if (!open) return <button className="linkbtn" data-tl-pick-open={id} onClick={() => { S.tlPick = id; S.tlPickQ = ""; render(); }}>{label || "Choose from Tally"}</button>;
  const hits = TaxLed.find(cid, q, { prefer, max: 12 });
  return <div className="tl-pick" data-tl-pick={id}>
    <input type="search" autoFocus aria-label="Find a ledger in Tally" data-fk={"tlpick-" + id} value={q} placeholder="Find a ledger in Tally, e.g. TDS payable 194C" onChange={(ev) => setAndShow("tlPickQ", ev.target.value, true)} />
    <ul className="tl-hits">{hits.map((l) => <li key={l.name}><button className="linkbtn" data-tl-pick-opt={l.name} onClick={() => { S.tlPick = ""; S.tlPickQ = ""; onPick(l.name); }}>{l.name}</button>{l.group && <span className="nr">{" " + l.group}</span>}</li>)}
      {!hits.length && <li className="note" data-tl-pick-none="">{Ledgers.list(cid).length ? "No ledger in Tally matches." : "No ledgers from Tally yet."}</li>}</ul>
    <button className="linkbtn" onClick={() => { S.tlPick = ""; render(); }}>Cancel</button>
  </div>;
}

// the ledgers FinCom posts to (were Client setup's GST, TDS and reverse charge boxes)
function PostLedgers({ b, kind }) {
  const co = CO(); if (!co) return null;
  const rows = kind === "gst" ? TaxLed.postKeys("gst").concat(Object.keys(RCM_LEDGER_DEFAULTS).map((k) => ["rcm:" + k, { rcmCgstIn: "Input CGST (RCM)", rcmSgstIn: "Input SGST (RCM)", rcmIgstIn: "Input IGST (RCM)", rcmCgstOut: "CGST payable (RCM)", rcmSgstOut: "SGST payable (RCM)", rcmIgstOut: "IGST payable (RCM)" }[k]]))
    : TaxLed.postKeys("tds");
  return <section className="led-sec" data-tl-post={kind}>
    <div className="led-sec-head"><h3>{kind === "gst" ? "GST ledgers FinCom posts to" : "TDS ledger of each payment type"}</h3></div>
    <p className="note">{kind === "gst" ? "Each purchase bill picks its own GST ledgers (as the supplier was booked before); a ledger confirmed here is used on every bill instead. Reverse charge entries debit the input side and credit the payable side."
      : "The TDS ledger each kind of payment is credited to, when FinCom posts a bill or a bank entry. Posting waits until it is confirmed."}</p>
    <table className="led-t nocards" data-led-table={"post-" + kind}><thead><tr><th>{kind === "gst" ? "For" : "Payment type"}</th><th>Ledger in your Tally</th><th className="ac"></th></tr></thead>
      <tbody>{rows.map(([key, label]) => {
        const rcm = key.startsWith("rcm:"), c = rcm ? null : choiceGet(co, key), v = rcm ? rcmLedger(co, key.slice(4)) : (c && c.value) || "", conf = c && c.state === "confirmed";
        const prefer = /duties|tax/i;
        return <tr key={key} data-tl-post-key={key} data-state={rcm ? "set" : conf ? "confirmed" : v ? "guessed" : "empty"}>
          <td>{label}</td>
          <td>{v ? <b>{v}</b> : <span className="note">not chosen</span>}
            {!rcm && v && !conf && <div className="nr">{c.unok ? "Unconfirmed by " + c.unok.by + ", " + fmtDateTime(c.unok.at) : c.old ? "Saved before: confirm it" : "FinCom’s guess: confirm it"}</div>}
            {!rcm && conf && <div className="nr" data-choice-state="confirmed">{"✓ Confirmed" + (c.by ? " by " + c.by : "") + (c.at ? ", " + fmtDateTime(c.at) : "")}</div>}
            {rcm && !(co.gst || {})[key.slice(4)] && <div className="nr">FinCom’s default name</div>}</td>
          <td className="ac"><span className="led-act">
            {!rcm && v && !conf && <button className="btn small" data-tl-post-confirm={key} onClick={() => { choiceConfirm(co, key, v); toast("Confirmed: " + v + "."); render(); }}>Confirm</button>}
            {!rcm && conf && <button className="linkbtn" data-tl-post-unconfirm={key} onClick={() => TaxLed.postUnconfirm(co, key)}>Unconfirm</button>}
            <TallyPick id={key} cid={co.id} prefer={prefer} label={v ? "Change" : "Choose from Tally"} onPick={(name) => TaxLed.postSet(co, key, name)} /></span></td></tr>;
      })}</tbody></table>
  </section>;
}

export default function TaxLedgers({ b, kind: pageKind }) {
  const cid = b.cid, kind = S.ledKind === "all" ? "all" : pageKind, q = String(S.ledQ || "").toLowerCase().trim();
  TaxLed.loadExt(cid);
  const all = TaxLed.forKind(b, kind);
  TaxLed.auto(b, all.rows.concat(all.more));
  const hit = (r) => !q || r.n.toLowerCase().includes(q) || String((r.ans || {}).section || "").toLowerCase().includes(q) || String(r.group || "").toLowerCase().includes(q) || r.says.toLowerCase().includes(q);
  const rows = all.rows.filter(hit), more = all.more.filter(hit);
  const shown = rows.concat(more).filter((r) => !r.ok && r.ans && r.ans.what);
  const others = LedPage.others(b).filter((r) => !q || r.n.toLowerCase().includes(q) || String(r.group || "").toLowerCase().includes(q));
  const okN = all.rows.filter((r) => r.ok).length, toN = all.rows.filter((r) => !r.ok).length;
  const inRows = new Set(all.rows.concat(all.more).map((r) => r.n));
  // the find box also searches the whole Tally list: a ledger not in the table can be marked as TDS or GST with Change
  const tallyHits = q && q.length >= 3 ? TaxLed.find(cid, q, { max: 8 }).filter((l) => !inRows.has(l.name)) : [];
  const setKind = (k) => { S.ledKind = k === pageKind ? "" : k; S.ledEdit = ""; render(); };
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((x, y) => x.name.localeCompare(y.name));
  return <div className="ledpage" data-ledpage="" data-tax-ledgers={kind}>
    <div className="tl-top">
      <p className="note"><button className="linkbtn" data-tl-back="" onClick={() => { S.ledKind = ""; if (pageKind === "gst") gstViewGo("year"); else tdsNav("year"); }}>{"← " + (pageKind === "gst" ? "GST returns" : "TDS returns")}</button></p>
      <nav className="sbar subnav" aria-label="Which ledgers">{[["tds", "TDS"], ["gst", "GST"], ["all", "All"]].map(([k, l]) =>
        <button key={k} data-tl-kind={k} aria-selected={kind === k} onClick={() => setKind(k)}>{l}</button>)}</nav>
    </div>
    <Status b={b} />
    <AiLine b={b} rows={all.rows.concat(all.more)} />
    <UndoLine b={b} />
    <PleaseCheck b={b} items={LedPage.review(b).filter((x) => kind === "all" || (TaxLed.kindOfWhat((x.m || {}).what) || kind) === kind)} lines={pleaseLines(b)} />
    <section className="led-sec" data-led-section="main">
      <div className="led-sec-head"><h3>{KIND_LABEL[kind] + " "}<span className="sbar-n">{all.rows.length}</span>{" "}<span className="note" data-tl-counts="">{okN + " confirmed · " + toN + " to confirm"}</span></h3>
        {shown.length > 0 && <button className="btn small primary" data-tl-confirm-shown="" onClick={() => TaxLed.confirm(b, shown.map((r) => r.n), "shown")}>{"Confirm all shown (" + shown.length + ")"}</button>}</div>
      <div className="led-tools">
        <input type="search" aria-label="Find a ledger" data-fk="ledq" value={S.ledQ || ""} placeholder="Find a ledger, section or group; or any Tally ledger, e.g. TDS payable 194C" onChange={(ev) => setAndShow("ledQ", ev.target.value, true)} />
        {cos.length > 1 && <select aria-label="Client" data-led-client="" style={{ width: "auto", maxWidth: "100%" }} value={cid} onChange={(ev) => { if (ev.target.value !== cid) Rec.openClientTab(ev.target.value, kind === "gst" ? "books:gst" : "books:tds"); }}>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      </div>
      {rows.length ? <Table b={b} rows={rows} which="main" /> : <p className="note" data-led-empty="main">{q ? "No " + (kind === "all" ? "GST or TDS" : kind.toUpperCase()) + " ledger matches." : "No " + (kind === "all" ? "GST or TDS" : kind.toUpperCase()) + " ledger yet."}</p>}
      {tallyHits.length > 0 && <div className="tl-tallyhits" data-tl-tally-hits="">
        <p className="note">{"Other ledgers in Tally matching “" + S.ledQ + "”: choose Change to count one as a TDS or GST ledger."}</p>
        <table className="led-t nocards"><tbody>{tallyHits.map((l) => <tr key={l.name} data-tl-tally-hit={l.name}><td><span className="led-name">{l.name}</span>{l.group && <div className="nr">{l.group}</div>}</td>
          <td>{S.ledEdit === l.name ? <Editor b={b} n={l.name} /> : <span className="note">{(b.map || {})[l.name] && b.map[l.name].what ? LedMaster.label(b.map[l.name].what) : "Not tax"}</span>}</td>
          <td className="ac">{S.ledEdit === l.name ? null : <button className="linkbtn" data-led-change={l.name} onClick={() => changeRow(b, { n: l.name, ok: !!((b.map || {})[l.name] || {}).ok, used: ((b.map || {})[l.name] || {}).n || 0, m: (b.map || {})[l.name] })}>Change</button>}</td></tr>)}</tbody></table>
      </div>}
    </section>
    {more.length > 0 && <section className="led-sec" data-led-section="unclear">
      <div className="led-sec-head"><h3>{"FinCom’s rules could not tell "}<span className="sbar-n">{more.length}</span></h3></div>
      <p className="note">Ledgers under Duties & Taxes, or with tax in their name, that the rules cannot place. An AI guess is shown where there is one; confirm it, or choose with Change.</p>
      <Table b={b} rows={more} which="unclear" />
    </section>}
    {(kind === "tds" || kind === "all") && <PostLedgers b={b} kind="tds" />}
    {(kind === "gst" || kind === "all") && <PostLedgers b={b} kind="gst" />}
    <Others b={b} rows={others} />
    <Notices b={b} cid={cid} />
  </div>;
}
