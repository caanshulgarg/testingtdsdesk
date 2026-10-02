// A purchase bill: what was read from it, GST, the TDS decision and the draft entry for Tally. Editable while it is a
// draft. Was viewDetail() and its helpers (field, docWarnHtml, itemsHtml, partyHistHtml, ytdSourceHtml,
// rereadButtons, viewGst) in src/js/19, 01 and 27. Every change goes through billSet…/billGst/… in src/js/27.
import ReadBadge from "../parts/ReadBadge.jsx";
import BillDoc from "../parts/BillDoc.jsx";

const money_ = (n) => money(n);
const isFree = (m) => /^(free (OCR|\(PDF)|Google OCR$)/.test(m);
const costNote = (m) => /^free (OCR|\(PDF)/.test(m) ? ": no cost" : m === "Google OCR" ? ": Google OCR, no Claude cost" : /text only/.test(m) ? ": low Claude cost" : /^Claude/.test(m) ? ": normal Claude cost" : "";

function Field({ e, label, k, ro, type = "text", wide, value }) {
  const unsure = !ro && e.uncertain && e.uncertain.indexOf(k) >= 0;
  const v = value !== undefined ? value : e.x[k];
  return (
    <label className={"f" + (wide ? " wide" : "") + (unsure ? " unsure" : "")}>
      <span>{label}</span>
      <input type={type} value={v == null ? "" : v} readOnly={ro} data-fk={"x:" + k}
        {...(type === "number" ? { step: "0.01", inputMode: "decimal" } : {})}
        onChange={(ev) => billSetX(e, k, ev.target.value)} />
    </label>
  );
}

function Items({ e }) {
  const s = itemSummary(e.x);
  if (!s) return null;
  if (s.unreliable) return <p className="note" style={{ margin: "6px 0" }}>The line items on this bill could not be read reliably, so only the totals are used.</p>;
  return (
    <details className="itembox" open={s.multi}>
      <summary>What was billed · {s.items.length} line{s.items.length === 1 ? "" : "s"}{s.multi && <> <span className="tag">two GST rates</span></>}</summary>
      <div className="tblwrap"><table className="data">
        <thead><tr><th>Description</th><th>HSN/SAC</th><th className="n">Quantity</th><th className="n">Rate</th><th className="n">Value</th><th className="n">GST</th></tr></thead>
        <tbody>{s.items.map((i, k) => (
          <tr key={k}><td>{i.desc}</td><td>{i.hsn || "—"}</td><td className="n">{i.qty ? i.qty + (i.unit ? " " + i.unit : "") : "—"}</td>
            <td className="n">{i.rate ? money(i.rate) : "—"}</td><td className="n">{money(num(i.taxable))}</td><td className="n">{i.gstRate == null ? "—" : i.gstRate + "%"}</td></tr>
        ))}</tbody>
      </table></div>
      {(s.rates.length > 1 || s.multi) && <>
        <h4 style={{ margin: "10px 0 4px", fontSize: 14 }}>By GST rate</h4>
        <div className="tblwrap"><table className="data">
          <thead><tr><th>Rate</th><th>HSN/SAC</th><th className="n">Taxable</th><th className="n">GST</th></tr></thead>
          <tbody>{s.rates.map((r, k) => (
            <tr key={k}><td>{r.rate == null ? "rate not shown" : r.rate + "%"}</td><td>{r.hsn.size ? Array.from(r.hsn).join(", ") : "—"}</td>
              <td className="n">{money(r.taxable)}</td><td className="n">{r.rate ? money(r2((r.taxable * r.rate) / 100)) : "—"}</td></tr>
          ))}</tbody>
        </table></div>
      </>}
    </details>
  );
}

// why this bill may not belong here: not a tax invoice, or billed to someone else
function DocWarnings({ e }) {
  const co = CO(), x = e.x, bill = String(x.buyerGstin || "").toUpperCase(), ship = String(x.shipGstin || "").toUpperCase();
  const notBill = e.docKind && !e.docOverride, elsewhere = co.gstin && bill && bill !== co.gstin && !e.buyerOverride, deliveredHere = ship && ship === co.gstin;
  return <>
    {notBill && <div className="bigwarn"><b>This is {DOC_KIND_TEXT[e.docKind] || "not a tax invoice"}, not a purchase bill.</b>
      <div>Nothing should be booked from it. Wait for the supplier's tax invoice and book that one instead.</div>
      <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={() => doAct("docIsBill")}>It is a tax invoice — carry on</button></div></div>}
    {elsewhere && <div className="bigwarn"><b>This bill is not made out to {co.name}.</b>
      <div>It is billed to <b>{bill}</b>{deliveredHere ? <>, and only <b>delivered</b> to this client. The purchase belongs to the party it is billed to.</> : ", while this client’s GSTIN is " + co.gstin + "."} Check whether it was filed under the wrong client.</div>
      <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={() => doAct("buyerOk")}>It does belong here — carry on</button></div></div>}
  </>;
}

function ReadBits({ e, ro }) {
  return <>
    <div className="row" style={{ marginTop: 8 }}>
      {!ro && S.files[e.id] && S.engine && <button className="btn small" onClick={() => doAct("reread")}>Read again carefully</button>}
      {e.readMode && <span className="note">Read by {e.readMode}</span>}
    </div>
    {e.readNote && <p className="note" style={{ margin: "6px 0 0" }}>{e.readNote}</p>}
    {e.readTrace && e.readTrace.length > 0 && <details className="trace" open={e.status === "draft"}>
      <summary>How this bill was read</summary>
      <ol>{e.readTrace.map((t, i) => <li key={i} className={t.ok ? "tok" : "tno"}><b>{(t.ok ? "✓ " : "✗ ") + t.step}</b>{t.note ? ": " + t.note : ""}</li>)}</ol>
    </details>}
    {e.freeWhy && !ro && !(e.readTrace && e.readTrace.length) && <p className="note" style={{ margin: "6px 0 0" }}>Free reading was not enough: {e.freeWhy}.</p>}
  </>;
}

function Gst({ e, c, ro, snap }) {
  if (ro) {
    const s = snap || {};
    if (!s.rcm && !s.blocked && !s.noItc) return null;
    return <section><h3>GST</h3><p className="note" style={{ margin: 0 }}>
      {s.rcm ? "Reverse charge: " + catLabel(RCM_CATS, s.rcm.cat) + " @ " + s.rcm.rate + "%, tax " + money_(s.rcm.tax) + ". " : ""}
      {s.blocked ? "GST credit blocked: " + catLabel(BLOCK_CATS, s.blocked) + "." : ""}
      {s.noItc ? (s.noItc === "unregistered" ? "No input credit: the client has no GSTIN." : "No input credit: billed to another GSTIN.") : ""}</p></section>;
  }
  const gd = c.gd, r = c.rcmTax, itc = c.itc || { ok: true, pos: {} }, pos = itc.pos || {};
  const blocked175 = !!gd.block;
  const bcat = blocked175 ? gd.block.cat : (e.itcBlock && e.itcBlock.cat) || (gd.blockSuggest && gd.blockSuggest.cat) || BLOCK_CATS[0].id;
  const stateName = (k) => k + (typeof GST_STATES === "object" && GST_STATES[k] ? " " + GST_STATES[k] : "");
  return (
    <section><h3>GST</h3>
      <p className={itc.ok ? "note" : "bk-warn"} style={{ margin: "0 0 8px" }}>
        {itc.ok ? "Input credit: allowed unless blocked below. " : itc.why === "unregistered" ? "No input credit: this client has no GSTIN, so the GST is added to the expense. " : "No input credit: the bill is billed to GSTIN " + e.x.buyerGstin + ", not this client's. The GST is added to the expense. "}
        {pos.sup && pos.home ? "Place of supply: supplier in " + stateName(pos.sup) + ", client in " + stateName(pos.home) + ", so " + (pos.expect === "igst" ? "IGST" : "CGST + SGST") + " is expected" + (pos.charged && pos.charged !== pos.expect ? "; the bill charges " + (pos.charged === "igst" ? "IGST" : "CGST + SGST") + ". Check it." : ".") : ""}</p>
      <div className="gstgrid">
      <div className="gstbox">
        <label className="chk"><input type="checkbox" checked={!!r} onChange={(ev) => billGst(e, "rcm", ev.target.checked)} /> <b>Reverse charge applies</b></label>
        {gd.rcmSuggest && <div className="suggest">Suggested: {catLabel(RCM_CATS, gd.rcmSuggest.cat)} <span className="note">({gd.rcmSuggest.why})</span>
          <div className="row" style={{ marginTop: 6 }}><button className="btn small" onClick={() => doAct("rcmApply")}>Apply reverse charge</button><button className="btn small" onClick={() => doAct("rcmDismiss")}>Not reverse charge</button></div></div>}
        {r && <>
          <div className="grid" style={{ marginTop: 6 }}>
            <label className="f wide"><span>Category</span><select value={e.rcm.cat} onChange={(ev) => billGst(e, "rcmCat", ev.target.value)}>
              {RCM_CATS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
            <label className="f"><span>Rate %</span><input type="number" step="0.01" defaultValue={e.rcm.rate} key={e.id + ":" + e.rcm.cat} onChange={(ev) => billGst(e, "rcmRate", ev.target.value)} /></label>
            <label className="chk" style={{ alignSelf: "end" }}><input type="checkbox" checked={!!r.inter} onChange={(ev) => billGst(e, "rcmInter", ev.target.checked)} /> Inter-state (IGST)</label>
          </div>
          <p className="note" style={{ margin: "6px 0 0" }}>Tax payable under reverse charge: <b>{money_(r.tax)}</b> ({r.inter ? "IGST " + money_(r.igst) : "CGST " + money_(r.cgst) + " + SGST " + money_(r.sgst)}){c.blocked ? ", with no input credit" : ", and the same amount taken as input credit"}. Check the rate against the current notification.</p>
        </>}
      </div>
      <div className="gstbox">
        <label className="chk"><input type="checkbox" checked={blocked175} onChange={(ev) => billGst(e, "block", ev.target.checked)} /> <b>GST credit is blocked (section 17(5))</b></label>
        {gd.blockSuggest && <div className="suggest">Possibly blocked: {catLabel(BLOCK_CATS, gd.blockSuggest.cat)} <span className="note">(because {gd.blockSuggest.why})</span>
          <div className="row" style={{ marginTop: 6 }}><button className="btn small" onClick={() => doAct("blockAccept")}>Accept: block credit</button><button className="btn small" onClick={() => doAct("blockReject")}>Reject: credit allowed</button></div></div>}
        {blocked175 && <>
          <label className="f" style={{ marginTop: 6 }}><span>Category</span><select value={bcat} onChange={(ev) => billGst(e, "blockCat", ev.target.value)}>
            {BLOCK_CATS.map((x) => <option key={x.id} value={x.id}>{x.label + " — " + x.sec}</option>)}</select></label>
          <p className="note" style={{ margin: "6px 0 0" }}>{gd.block.from === "client" ? "Blocked by this client's setting. Untick to claim credit on this bill. " : ""}GST of {money_(c.gstTotal + (r ? r.tax : 0))} is added to the expense instead of input credit.</p>
        </>}
      </div>
    </div></section>
  );
}

// how much of the year's limit is used, with this bill
function Meter({ m }) {
  const scale = Math.max(m.limit, m.used + m.add) || 1;
  const usedPct = Math.min(100, (m.used / scale) * 100), addPct = Math.min(100 - usedPct, (m.add / scale) * 100), limPct = Math.min(100, (m.limit / scale) * 100);
  return (
    <div className="meter">
      <div className="bar" role="img" aria-label={m.label + ": " + money0(m.used + m.add) + " of " + money0(m.limit)}>
        <div className="used" style={{ width: usedPct + "%" }} />
        <div className={"add" + (m.used + m.add > m.limit ? " over" : "")} style={{ left: usedPct + "%", width: addPct + "%" }} />
        <div style={{ position: "absolute", top: -2, bottom: -2, left: "calc(" + limPct + "% - 1px)", width: 2, background: "var(--ink)" }} />
      </div>
      <div className="cap"><span>{m.label}</span><span>{(m.used ? money0(m.used) + " earlier + " : "") + money0(m.add) + " this bill / limit " + money0(m.limit)}</span></div>
    </div>
  );
}

// the year so far for this supplier: from Tally when read, else only the bills entered here
function YtdSource({ e, c }) {
  const party = c.party, fy = fyOf(e.x.invoiceDate), t = tallyYtdFor(party, fy, e), led = partyLedgerName(party, e), busy = S.ytdBusy === e.id;
  const fetch = (label) => <button className="linkbtn" disabled={busy} onClick={() => doAct("ytdFetch")}>{label}</button>;
  if (t) {
    const ours = ourYtd(party, fy, c.rule.id, S.coId, true), n = t.vouchers;
    return <p className="note" style={{ margin: "4px 0 0" }}>Year so far: <b>{money0(t.credited)}</b> credited to {t.ledger} in Tally ({n} voucher{n === 1 ? "" : "s"}, GST left out)
      {ours.credited ? <> + <b>{money0(ours.credited)}</b> from {ours.bills} bill{ours.bills === 1 ? "" : "s"} here not yet in Tally</> : null}
      {" · read " + fmtDateTime(t.at) + " "}{fetch(busy ? "Reading…" : "Check again")}</p>;
  }
  if (!bridgeLive()) return <p className="note" style={{ margin: "4px 0 0" }}>This year’s total counts only the bills entered here. Connect the Tally Bridge to include what is already booked in Tally.</p>;
  if (!led) return <p className="note" style={{ margin: "4px 0 0" }}>Choose the supplier’s Tally ledger below to check what was already credited to it this year.</p>;
  return <p className="note" style={{ margin: "4px 0 0" }}>This year’s total counts only the bills entered here. {fetch(busy ? "Reading from Tally…" : "Check " + led + " in Tally")}</p>;
}

function Tds({ e, c, v, ro }) {
  const newType = e.confirmType && !ro && !(c.party && c.party.natureDefault) && !c.skip;
  return (
    <section><h3>TDS decision</h3><div className="decision"><div>
      <label className={"f" + (newType ? " unsure" : "")} style={{ marginBottom: 10 }}><span>Payment type</span>
        <select value={e.natureId} disabled={ro} onChange={(ev) => billSetChoice(e, "natureId", ev.target.value)}>
          {rules().map((r) => <option key={r.id} value={r.id}>{r.label + (r.old !== "—" ? " (old " + r.old + ")" : "")}</option>)}
        </select></label>
      {newType && <div className="row" style={{ margin: "-4px 0 10px" }}><button className="btn small" onClick={() => doAct("confirmType")}>Confirm payment type</button><span className="note">New supplier: the payment type decides the TDS section.</span></div>}
      {e.ai && e.ai.reason && <p className="note" style={{ margin: "-4px 0 10px" }}>{/Claude/.test(e.readMode || "") || !e.readMode ? "Claude: " + e.ai.reason : "Guessed from the bill: " + e.ai.reason.replace(/^Free reading:\s*/, "")}</p>}
      <p className={"verdict " + (v.applicable ? "yes" : "nope")}>{v.applicable ? (v.skip ? "TDS applies: " + money_(v.tdsWould) + ", not booked" : "TDS applies: " + money_(v.tds)) : "No TDS on this invoice"}</p>
      {(v.tdsWould > 0 || e.tdsSkip || !v.never) && !ro ? (
        <div className="skipbox">
          {(v.tdsWould > 0 && !v.anyway) || v.skip
            ? <label className="chk"><input type="checkbox" checked={v.tdsWould > 0 && !v.skip} onChange={(ev) => billBookTds(e, ev.target.checked)} /> <b>Deduct TDS on this bill</b></label>
            : <label className="chk"><input type="checkbox" checked={v.tdsWould > 0} onChange={(ev) => billDeductAnyway(e, ev.target.checked)} /> <b>Deduct anyway (expected to cross the limit)</b></label>}
          {v.tdsWould <= 0 && !v.skip && <p className="note" style={{ margin: "4px 0 0" }}>Below the limits, so no TDS is due and none is deducted. Tick “Deduct anyway” only if you expect this supplier to cross the yearly limit; your name and the reason are recorded.</p>}
          {v.skip && (v.skip.from === "bill"
            ? <label className="f" style={{ marginTop: 6 }}><span>Why not</span><select value={e.tdsSkip || ""} onChange={(ev) => billSetChoice(e, "tdsSkip", ev.target.value)}>
                {Object.entries(SKIP_REASONS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            : <p className="note" style={{ margin: "4px 0 0" }}>Not booked: {skipText(v.skip)}. Tick the box to book it on this bill anyway.</p>)}
        </div>
      ) : ro && v.skip ? <p className="note" style={{ margin: "0 0 8px" }}>Not booked: {skipText(v.skip)}</p> : null}
      <ul className="why">{v.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
      {v.meter && v.meter.limit ? <><Meter m={v.meter} /><YtdSource e={e} c={c} /></> : null}
      {v.catchUp > 0 && !ro && <label className="chk" style={{ marginTop: 10 }}><input type="checkbox" checked={!!e.includeCatchUp} onChange={(ev) => billSetChoice(e, "includeCatchUp", ev.target.checked)} /> Include TDS on earlier bills ({money0(v.catchUp)}) in this entry</label>}
    </div>
    <dl className="figs">
      <dt>Section</dt><dd>{v.ref}</dd><dt>Old section</dt><dd>{v.old}</dd>
      <dt>PAN</dt><dd>{v.pan ? v.pan + (v.indHuf ? " (Ind/HUF)" : "") : "Not found"}</dd><dt>Tax year</dt><dd>{v.fy}</dd>
      <dt>Value before GST</dt><dd>{money_(v.base)}</dd><dt>TDS base</dt><dd>{money_(v.applicable ? v.tdsBase : 0)}</dd>
      <dt>Rate</dt><dd title={v.rateNote}>{v.never ? "—" : v.rate + "%"}</dd>
      {v.skip && <><dt>TDS that applies</dt><dd>{money_(v.tdsWould)}</dd></>}
      <dt className="big">{v.skip ? "TDS booked" : "TDS"}</dt><dd className="big">{money_(v.tds)}</dd>
    </dl></div></section>
  );
}

// a ledger on the draft entry: typed (with the Tally ledger list, data-ac), checked against Tally, fixable
function LedgerCell({ e, l, ro, tallyCtx }) {
  const edit = !ro && (l.role === "expense" || l.role === "party");
  const key = l.role === "expense" ? "expenseLedger" : "partyLedger";
  const h = e.partyHist, ex = l.ledger && tallyCtx && !e.exportedAt ? exactLedger(l.ledger) : null;
  return <>
    {edit ? <input type="text" data-e={key} data-fk={"e:" + key} data-ac="1" autoComplete="off" value={e[key] || ""}
      aria-label={l.role === "expense" ? "Expense ledger" : "Party ledger"} placeholder={l.role === "expense" ? "Expense ledger" : "Party ledger"}
      onChange={(ev) => billSetText(e, key, ev.target.value)} /> : l.ledger ? l.ledger : <span className="missing">Ledger not set</span>}
    {edit && l.role === "party" && e.partyFromTally && <div className="note">From Tally: {e.partyFromTally}</div>}
    {l.ledger && tallyCtx && !e.exportedAt && (ex
      ? <> <span className="lg-ok" title={"In Tally as “" + ex + "”"}>✔</span></>
      : <div className="lg-miss">Not in Tally
          {suggestLedgers(l.ledger, l.role, 2).map((n) => <span key={n}> <button className="linkbtn" onClick={() => billFixLedger(l.role, l.ledger, n)}>Use “{n}”</button></span>)}
          {" "}<button className="linkbtn" onClick={() => billFixLedger(l.role, l.ledger, null)}>Create in Tally</button></div>)}
    {l.role === "expense" && <>
      {e.expenseFrom && !e.expenseUserSet && <div className="nr" style={{ color: "var(--ledger)" }}>{e.expenseFrom}</div>}
      {h && h.top && h.top.length > 0 && <div className="phist"><span className="muted">Booked before for this supplier:</span>{" "}
        {h.top.map((t) => ro ? <span key={t.ledger} className="chip">{t.ledger} <b>{t.n}×</b> </span>
          : <span key={t.ledger}><button className={"chip" + (norm(t.ledger) === norm(e.expenseLedger) ? " on" : "")} onClick={() => billUseExpense(e, t.ledger)}>{t.ledger} <b>{t.n}×</b></button> </span>)}
      </div>}
    </>}
  </>;
}

function Slip({ e, c, ro, snap }) {
  const co = CO(), x = e.x, lines = snap ? snap.lines : c.lines;
  const tot = lines.reduce((a, l) => { a[l.side] += l.amt; return a; }, { Dr: 0, Cr: 0 });
  const tallyCtx = !!(S.bank && S.bank.cid === S.coId && !S.bank.loading && hasLedgerList());
  return (
    <section><h3>Draft entry for Tally: {co.tallyName || co.name}</h3><div className="slip">
      <div className="sh"><b>{co.voucherType} voucher</b><span>{fmtDate(x.invoiceDate) + (x.invoiceNo ? ", ref " + x.invoiceNo : "")}</span></div>
      <table className="vtbl">
        <thead><tr><th></th><th>Ledger</th><th className="n">Debit ₹</th><th className="n">Credit ₹</th></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={i}><td className="by">{l.side}</td><td><LedgerCell e={e} l={l} ro={ro} tallyCtx={tallyCtx} /></td>
            <td className="n">{l.side === "Dr" ? INR.format(l.amt) : ""}</td><td className="n">{l.side === "Cr" ? INR.format(l.amt) : ""}</td></tr>
        ))}</tbody>
        <tfoot><tr><td></td><td>Total</td><td className="n">{INR.format(r2(tot.Dr))}</td><td className="n">{INR.format(r2(tot.Cr))}</td></tr></tfoot>
      </table>
      {!ro && !tallyCtx && <p className="note" style={{ margin: "8px 0 0" }}>The ledgers are not checked against Tally yet: this client's ledger list has not been read.{" "}
        <button className="btn small" onClick={() => billReadLedgers()}>{bridgeLive(co) ? "Read the ledgers from Tally" : "Bring in the ledger list (from Tally)"}</button></p>}
      {!ro && c.missing.some((m) => /ledger/i.test(m)) && <p className="bk-warn" style={{ margin: "8px 0 0" }}>Approve waits until every line has a Tally ledger: {c.missing.filter((m) => /ledger/i.test(m)).join("; ")}.</p>}
      {ro ? <div className="narr">{e.narration}</div>
        : <label className="f" style={{ marginTop: 10 }}><span>Narration</span><input type="text" data-fk="e:narration" value={e.narration || ""} onChange={(ev) => billSetText(e, "narration", ev.target.value)} /></label>}
      {e.status === "approved" && <div className="stampmark">{e.exportedAt ? "Sent to Tally" : "Approved"}<small>{fmtDate((e.exportedAt || e.approvedAt || "").slice(0, 10))}</small></div>}
      {e.status === "rejected" && <div className="stampmark rej">No entry</div>}
    </div></section>
  );
}

// a duplicate with its original beside it, and the two choices (review of 02-Oct-2026)
function DupBeside({ e }) {
  const o = e.dupOf && e.dupOf.entryId ? D().entries[e.dupOf.entryId] : null;
  const rows = [["Supplier", (x) => x.x.vendorName || "—"], ["GSTIN / PAN", (x) => x.x.vendorGstin || x.x.vendorPan || "—"], ["Bill no.", (x) => x.x.invoiceNo || "—"],
    ["Date", (x) => x.x.invoiceDate ? fmtDate(x.x.invoiceDate) : "—"], ["Value", (x) => money(num(x.x.total))], ["File", (x) => x.fileName || "—"],
    ["Uploaded", (x) => x.createdAt ? fmtDateTime(x.createdAt) : "—"], ["Where it is", (x) => x.status === "duplicate" ? "held as duplicate" : x.status === "approved" ? "approved" + (x.approvedAt ? " on " + fmtDate(x.approvedAt.slice(0, 10)) : "") + " · " + tallyStateOf(x)[1] : statusLabel(x.status)]];
  return <section data-dup-beside=""><h3>Duplicate</h3>
    <p className="note" style={{ margin: "0 0 8px" }}>{(e.dupOf && e.dupOf.msg) || "Held as a duplicate."} It does not count towards limits and cannot be approved.</p>
    {o ? <table className="data"><thead><tr><th></th><th>This copy</th><th>The original</th></tr></thead><tbody>
      {rows.map(([label, f]) => { const a = f(e), b = f(o); return <tr key={label}><td>{label}</td><td>{a}</td><td className={a !== b ? "bad" : undefined}>{b}</td></tr>; })}
    </tbody></table> : <p className="note">The original is not on this computer.</p>}
    <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <button className="btn danger" onClick={() => doAct("delete")}>Delete this one</button>
      <button className="btn" onClick={() => doAct("notDup")}>Keep both</button>
      {o && <button className="btn" onClick={() => doAct("openOriginal")}>Open the original</button>}
    </div></section>;
}

export default function BillDetail({ id }) {
  const e = D().entries[id];
  if (!e) return null;
  if (S.reading[e.id]) return (
    <div className="detail">
      <section><div className="thinking"><span className="dot" />{S.reading[e.id]}: {e.fileName}. {/careful/i.test(S.reading[e.id]) ? "Handwritten and faint bills can take up to two minutes." : "This usually takes under a minute."}</div></section>
      {S.previews[e.id] && <section><img className="preview" src={S.previews[e.id]} alt="Invoice being read" /></section>}
    </div>
  );
  const co = CO(), c = compute(e), ro = e.status !== "draft", x = e.x, snap = e.status === "approved" && e.snapshot;
  const v = snap ? { applicable: snap.applicable, tds: snap.tds, tdsWould: snap.tdsWould != null ? snap.tdsWould : snap.tds, skip: snap.skip || null, why: snap.why || [], meter: snap.meter || null,
      ref: snap.ref, old: snap.old, pan: snap.pan, indHuf: !!snap.indHuf, fy: snap.fy || fyOf(x.invoiceDate), base: snap.base, tdsBase: snap.tdsBase, rate: snap.rate, rateNote: snap.rateNote || "",
      never: !!snap.never, flags: [], catchUp: 0 }
    : { applicable: c.applicable, tds: c.tds, tdsWould: c.tdsWould, skip: c.skip, why: c.why, meter: c.meter, ref: c.rule.ref, old: c.rule.old, pan: c.pan, indHuf: c.indHuf, fy: c.fy,
      base: c.base, tdsBase: c.tdsBase, rate: c.rate, rateNote: c.rateNote, never: c.rule.basis === "never", flags: e.status === "draft" ? c.flags : [], catchUp: c.catchUp, anyway: c.anyway };
  const closed = typeof ClosedP === "object" && x.invoiceDate && e.status !== "rejected" && !e.exportedAt ? ClosedP.note(x.invoiceDate, !!(e.snapshot && e.snapshot.tds)) : [];
  const f = (label, k, o = {}) => <Field e={e} label={label} k={k} ro={ro} {...o} />;
  return (
    <div className="detail">
      <section className="dhead">
        <div>
          <h2>{x.vendorName || "New invoice"}</h2>
          {e.readMode && <div className={"readby " + (isFree(e.readMode) ? "isfree" : /Claude/.test(e.readMode) ? "isclaude" : "")}>Read by {e.readMode}{costNote(e.readMode)}</div>}
          {e.checks && e.checks.length > 0 && e.status === "draft" && <div className="note" style={{ marginTop: 2 }}>Checks passed: {e.checks.join(" · ")}</div>}
          <div className="note">{e.fileName}{e.routedBy ? ", filed here by " + e.routedBy : ""}{c.party || !x.vendorName ? "" : ", new deductee"}</div>
        </div>
        {e.status === "draft" && <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <span className="note">Read again:</span>
          <button className="btn small" onClick={() => rereadEntry(e, null)}>Free</button>
          <button className="btn small" disabled={!googleReady()} title={googleReady() ? undefined : "Google OCR is not set up"} onClick={() => rereadEntry(e, "google")}>Google OCR</button>
          <button className="btn small" disabled={!claudeReady()} title={claudeReady() ? undefined : "Claude is not available here"} onClick={() => rereadEntry(e, "claude")}>Claude</button>
        </div>}
        <div className="actions">{e.status === "draft" && canDeleteBills() && <button className="linkbtn" onClick={() => billDelete(e.id)}>Delete…</button>}</div>
      </section>
      {e.readError && <section><p className="banner" style={{ margin: 0 }}>{e.readError}</p></section>}
      {!ro && e.readMode !== "free (partly read)" && (e.handwritten || (e.uncertain && e.uncertain.length > 0)) && <section><p className="banner" style={{ margin: 0 }}>
        {e.handwritten ? "Handwritten bill. " : ""}
        {e.uncertain && e.uncertain.length ? "Fields marked in amber need a quick look. Compare them with the image; to correct one, click in the box and type. When they are right, press “Fields look right” in the bar at the bottom." : "Check the figures against the image."}
        {e.legibility ? " Claude noted: " + e.legibility : ""}</p></section>}
      <DocWarnings e={e} />
      {closed.length > 0 && <div className="banner cp-banner"><b>Closed period.</b> This bill is dated {fmtDate(x.invoiceDate)}: {closed.join("; ")}. It can still be posted; FinCom will ask first.</div>}
      <section className={e.fileName !== "Manual entry" ? "withprev" : ""}>
        {e.fileName !== "Manual entry" && <BillDoc e={e} />}
        <div>
          <h3>Invoice details</h3>
          <div className="grid">
            {f("Supplier name", "vendorName", { wide: true })}
            {f("GSTIN", "vendorGstin")}{f("PAN", "vendorPan", { value: x.vendorPan || v.pan })}
            {f("Invoice no.", "invoiceNo")}{f("Invoice date", "invoiceDate", { type: "date" })}
            {f("Taxable value", "taxable", { type: "number" })}{f("CGST", "cgst", { type: "number" })}
            {f("SGST", "sgst", { type: "number" })}{f("IGST", "igst", { type: "number" })}
            {f("Invoice total", "total", { type: "number" })}
            {e.natureId.indexOf("rent") === 0 && f("Months billed", "rentMonths", { type: "number" })}
            {f("Billed to GSTIN", "buyerGstin")}
            {x.shipGstin && x.shipGstin !== x.buyerGstin && f("Delivered to GSTIN", "shipGstin")}
            {f("What was supplied", "description", { wide: true })}
          </div>
          <Items e={e} />
          <ReadBits e={e} ro={ro} />
        </div>
      </section>
      <Gst e={e} c={c} ro={ro} snap={snap} />
      <Tds e={e} c={c} v={v} ro={ro} />
      {v.flags.length > 0 && <section><h3>Check before approving</h3><ul className="flags">{v.flags.map((fl, i) => <li key={i} className={fl.lvl}>{fl.t}</li>)}</ul></section>}
      <Slip e={e} c={c} ro={ro} snap={snap} />
      {e.status === "deleted" && <section><p className="banner" style={{ margin: 0 }}>Deleted {fmtDateTime(e.deleted && e.deleted.at)} by {(e.deleted && e.deleted.by) || "—"}: {(e.deleted && e.deleted.reason) || "no reason given"}.{" "}
        {canDeleteBills() && <button className="btn small" onClick={() => billRestore(e.id)}>Restore</button>}</p></section>}
      {e.status === "duplicate" && <DupBeside e={e} />}
    </div>
  );
}
