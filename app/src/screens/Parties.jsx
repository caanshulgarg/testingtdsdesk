// The deductees (suppliers) of the open client: what was credited to each this year, and one opened to edit.
// Was viewParties() in src/js/19 and its handlers in src/js/27.
import ListTable from "../parts/ListTable.jsx";
import DateBox from "../parts/DateBox.jsx";
const save = (p, now) => { if (now) Store.saveParty(S.coId, p); else later("p" + p.id, () => Store.saveParty(S.coId, p), 600); };
const set = (p, k, v, now) => { p[k] = /^(pan|gstin)$/.test(k) ? String(v).toUpperCase().trim() : v; save(p, now); render(); };

// the supplier's matched ledger (review 20): FinCom's guess (from a bill waiting) until a person confirms it here, or
// approves a bill of the supplier; a confirmed one is never replaced by a guess or an older copy (src/js/60)
function PartyLedgerTag({ p }) {
  const c = partyChoice(p);
  if (!c || !c.value) return null;
  if (c.state === "confirmed") return <div className="cfm-ok" data-choice="party" data-choice-state="confirmed">{"✔ confirmed" + (c.by ? " by " + c.by : "")}</div>;
  return <div className="cfm-guess" data-choice="party" data-choice-state="guessed"><span className="tag warn">guessed, confirm</span>{" "}
    <button type="button" className="linkbtn" data-choice-confirm="party" onClick={() => Drafts.direct(() => { partyChoiceSet(p, p.ledgerName, "confirmed"); Store.saveParty(S.coId, p); render(); }, { bypass: true })}>Confirm</button></div>;
}
function Pf({ p, label, k, type = "text" }) {
  return <label className="f"><span>{label}</span>
    <input type={type} value={p[k] == null ? "" : p[k]} {...(type === "number" ? { step: "0.01" } : {})} onChange={(ev) => set(p, k, ev.target.value)} /></label>;
}

// lower deduction certificates (old section 197) for this deductee: one per section and period, with the amount it covers
function Ldc({ p }) {
  const list = (Array.isArray(p.ldc) ? p.ldc : []);
  const upd = (i, k, v) => { p.ldc = list.map((c, j) => j === i ? Object.assign({}, c, { [k]: k === "no" ? String(v).toUpperCase().trim() : v }) : c); save(p); render(); };
  const add = () => { p.ldc = list.concat([{ no: "", rule: p.natureDefault || "", rate: "", from: "", to: "", limit: "" }]); save(p, true); render(); };
  const off = (i) => { p.ldc = list.map((c, j) => j === i ? Object.assign({}, c, { deleted: true, deletedAt: new Date().toISOString() }) : c); save(p, true); render(); };
  return <div style={{ marginTop: 14 }} data-pane="ldc">
    <h3 style={{ margin: "0 0 6px" }}>Lower deduction certificates</h3>
    <p className="note" style={{ margin: "0 0 8px" }}>The rate applies to this deductee's bills of that payment type within the dates, up to the amount; above it, the normal rate. The certificate number goes into the return with remark A.</p>
    {list.some((c) => !c.deleted) && <div className="tblwrap"><table className="data" data-statement="">
      <thead><tr><th>Certificate no.</th><th>Payment type</th><th className="n">Rate %</th><th>From</th><th>To</th><th className="n">Amount covered</th><th className="n">Used</th><th></th></tr></thead>
      <tbody>{list.map((c, i) => c.deleted ? null : <tr key={i}>
        <td><input type="text" aria-label="Certificate number" value={c.no || ""} style={{ width: 120 }} onChange={(ev) => upd(i, "no", ev.target.value)} /></td>
        <td><select aria-label="Payment type" value={c.rule || ""} onChange={(ev) => upd(i, "rule", ev.target.value)}><option value="">Any</option>
          {rules().filter((r) => r.basis !== "never").map((r) => <option key={r.id} value={r.id}>{r.label} ({r.old})</option>)}</select></td>
        <td className="n"><input type="number" step="0.01" aria-label="Rate" value={c.rate} style={{ width: 70 }} onChange={(ev) => upd(i, "rate", ev.target.value)} /></td>
        <td><DateBox aria-label="From" value={c.from || ""} onChange={(ev) => upd(i, "from", ev.target.value)} /></td>
        <td><DateBox aria-label="To" value={c.to || ""} onChange={(ev) => upd(i, "to", ev.target.value)} /></td>
        <td className="n"><input type="number" step="1" aria-label="Amount covered" value={c.limit} style={{ width: 110 }} onChange={(ev) => upd(i, "limit", ev.target.value)} /></td>
        <td className="n">{num(c.limit) ? "₹" + INR.format(ldcUsed(p, c, S.coId)) : "—"}</td>
        <td><button className="linkbtn" onClick={() => off(i)}>Remove</button></td></tr>)}</tbody></table></div>}
    <button className="btn small" style={{ marginTop: 6 }} onClick={add}>Add a certificate</button>
  </div>;
}

function Party({ p, fy }) {
  const ytd = (natureId, k, v) => {
    p.ytd = p.ytd || {}; p.ytd[fy] = p.ytd[fy] || {};
    const cur = p.ytd[fy][natureId] || { credited: 0, tdsBase: 0 };
    cur[k] = num(v); p.ytd[fy][natureId] = cur; save(p); render();
  };
  return (
    <div className="pane">
      <div className="row" style={{ justifyContent: "space-between" }}><h2>{p.name}</h2><button className="btn small" onClick={() => doAct("closeParty")}>Close</button></div>
      <div className="grid" style={{ marginTop: 10 }}>
        <Pf p={p} label="Name" k="name" /><Pf p={p} label="PAN" k="pan" /><Pf p={p} label="GSTIN" k="gstin" />
        <div><Pf p={p} label="Ledger name in Tally" k="ledgerName" /><PartyLedgerTag p={p} /></div><Pf p={p} label="Expense ledger" k="expenseLedger" />
        <label className="f"><span>Usual payment type</span>
          <select value={p.natureDefault || ""} onChange={(ev) => set(p, "natureDefault", ev.target.value, true)}>
            <option value="">Decide per invoice</option>{rules().map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select></label>
        {(p.ldcRate !== undefined && p.ldcRate !== "") || p.ldcValidTo ? <><Pf p={p} label="Lower deduction rate % (older entry)" k="ldcRate" type="number" /><Pf p={p} label="Certificate valid to" k="ldcValidTo" type="date" /></> : null}
      </div>
      <div className="skipbox" style={{ marginTop: 12 }}>
        <label className="chk"><input type="checkbox" checked={!!p.panInoperative} onChange={(ev) => { p.panInoperative = ev.target.checked; p.panCheckedOn = new Date().toISOString().slice(0, 10); save(p, true); render(); }} />
          {" "}<b>PAN inoperative</b> (not linked with Aadhaar): TDS at the higher rate</label>
        {p.panInoperative && p.panCheckedOn && <p className="note" style={{ margin: "4px 0 0" }}>Marked on {fmtDate(p.panCheckedOn)}. Clear it once the PAN is operative again.</p>}
        <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" checked={!!p.trc} onChange={(ev) => set(p, "trc", ev.target.checked, true)} /> Non-resident with a tax residency certificate and Form 10F on file</label>
        {p.trc && <div className="grid" style={{ marginTop: 6 }}><Pf p={p} label="Treaty (DTAA) rate %" k="dtaaRate" type="number" /><Pf p={p} label="Country" k="country" /></div>}
      </div>
      <Ldc p={p} />
      <div className="skipbox" style={{ marginTop: 12 }}>
        <label className="chk"><input type="checkbox" checked={!!p.noTds} onChange={(ev) => {
          p.noTds = ev.target.checked; if (p.noTds && !p.noTdsReason) p.noTdsReason = "na"; save(p, true); refreshStats(S.coId); render();
        }} /> <b>Do not book TDS for this supplier</b></label>
        <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" checked={!!p.transporter} onChange={(ev) => set(p, "transporter", ev.target.checked, true)} /> Transporter with ten or fewer goods carriages, declaration and PAN on file (no TDS on contract payments)</label>
        {p.noTds && <label className="f" style={{ marginTop: 6, maxWidth: 420 }}><span>Reason</span>
          <select value={p.noTdsReason || "na"} onChange={(ev) => set(p, "noTdsReason", ev.target.value, true)}>
            {Object.entries(SKIP_REASONS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select></label>}
        <p className="note" style={{ margin: "4px 0 0" }}>TDS is still worked out on each bill and shown; a single bill can still be booked with TDS.</p>
      </div>
      <h3 style={{ marginTop: 18 }}>Amounts credited in {fy}</h3>
      <p className="note" style={{ margin: "-6px 0 10px" }}>"TDS base" is the part of the credited amount on which TDS was already deducted.</p>
      <div className="tblwrap"><table className="data" data-statement="">
        <thead><tr><th>Payment type</th><th className="n">Credited (before GST)</th><th className="n">TDS base</th></tr></thead>
        <tbody>{rules().filter((r) => r.basis !== "never" && r.basis !== "always").map((r) => {
          const y = ytdOf(p, fy, r.id);
          return <tr key={r.id}><td>{r.label}</td>
            <td className="n"><input type="number" step="0.01" aria-label={r.label + ": credited"} key={p.id + fy + "credited"} defaultValue={y.credited || ""} onChange={(ev) => ytd(r.id, "credited", ev.target.value)} /></td>
            <td className="n"><input type="number" step="0.01" aria-label={r.label + ": TDS base"} key={p.id + fy + "tdsBase"} defaultValue={y.tdsBase || ""} onChange={(ev) => ytd(r.id, "tdsBase", ev.target.value)} /></td></tr>;
        })}</tbody>
      </table></div>
    </div>
  );
}

const ytdSum = (q, fy, k) => Object.values((q.ytd && q.ytd[fy]) || {}).reduce((a, v) => a + num(v[k]), 0);

// suppliers on bills waiting for review: fill their PAN, type and earlier amounts before the first approval
function PendingSuppliers() {
  const list = pendingSuppliers();
  if (!list.length) return null;
  // the one list table (spec K6): the supplier, the total waiting (amount), then the rest
  return <div style={{ marginTop: 14 }}><ListTable name="pendingSuppliers" className="data" rows={list} rowKey={(k) => k.key} unit={["supplier", "suppliers"]}
    cols={[
      { k: "name", role: "party", label: "Supplier not yet in FinCom’s list", v: (k) => k.name, cell: (k) => <>{k.name} {k.tally ? <span className="tag ok" title="Tally already has this supplier’s ledger">in Tally as {k.tally}</span> : <span className="tag warn">new</span>}</> },
      { k: "total", role: "amount", label: "Total", cls: "n", v: (k) => num(k.total), cell: (k) => money0(k.total) },
      { k: "pan", label: "PAN", v: (k) => k.pan || "", cell: (k) => k.pan || "—" },
      { k: "type", label: "Payment type on the bill", v: (k) => (k.natureId && k.natureId !== "none" ? ruleOf(k.natureId).label : ""), cell: (k) => (k.natureId && k.natureId !== "none" ? ruleOf(k.natureId).label : "—") },
      { k: "bills", label: "Bills waiting", cls: "n", v: (k) => k.bills, sum: true, fmt: String, cell: (k) => k.bills },
      { k: "ac", role: "act", cell: (k) => <button className="linkbtn" onClick={() => { const p = addPendingSupplier(k.key); if (p) { S.partySel = p.id; render(); } }}>Save and fill in</button> },
    ]} /></div>;
}

export default function Parties() {
  const parties = D().parties, ps = Object.values(parties).sort((a, b) => a.name.localeCompare(b.name)), fy = S.partyFy;
  const fys = Array.from(new Set([fyOf(null)].concat(...ps.map((p) => Object.keys(p.ytd || {}))))).sort().reverse();
  const p = S.partySel && parties[S.partySel];
  return <>
    <div className="row" style={{ justifyContent: "space-between" }}>
      {/* the heading ("Suppliers") is Client setup's */}
      <p className="note" style={{ margin: 0, maxWidth: "60ch" }}>Yearly TDS limits are checked against the amounts credited here. Add what was booked before FinCom was used for {CO().name}.</p>
      <div className="row">
        <label className="f"><span>Tax year</span><select value={fy} onChange={(ev) => { S.partyFy = ev.target.value; render(); }}>{fys.map((y) => <option key={y}>{y}</option>)}</select></label>
        <button className="btn" onClick={() => doAct("addParty")}>Add supplier</button>
      </div>
    </div>
    <PendingSuppliers />
    {!ps.length ? <div className="pane"><p className="empty lt-empty" data-list-empty="" style={{ padding: 0, border: 0 }}>No suppliers saved yet. They are added when you approve a bill, or use <b>Add supplier</b> to add one now.</p></div> : (
      <div style={{ marginTop: 14 }}><ListTable name="suppliers" className="data" rows={ps} rowKey={(q) => q.id} unit={["supplier", "suppliers"]}
        rowProps={(q) => ({ className: S.partySel === q.id ? "sel" : undefined })}
        cols={[
          { k: "name", role: "party", label: "Supplier", v: (q) => q.name, cell: (q) => q.name },
          { k: "cr", role: "amount", label: "Credited " + fy, cls: "n", v: (q) => ytdSum(q, fy, "credited"), cell: (q) => money0(ytdSum(q, fy, "credited")) },
          { k: "pan", label: "PAN", v: (q) => q.pan || "", cell: (q) => q.pan || "—" },
          { k: "type", label: "Usual payment type", v: (q) => (q.natureDefault ? ruleOf(q.natureDefault).label : ""), cell: (q) => (q.natureDefault ? ruleOf(q.natureDefault).label : "—") },
          { k: "base", label: "TDS base " + fy, cls: "n", v: (q) => ytdSum(q, fy, "tdsBase"), sum: true, cell: (q) => money0(ytdSum(q, fy, "tdsBase")) },
          { k: "ac", role: "act", cls: "n", cell: (q) => <button className="btn small" aria-label={"Edit " + q.name} onClick={() => { S.partySel = q.id; render(); }}>Edit</button> },
        ]} /></div>
    )}
    {p && <Party p={p} fy={fy} />}
  </>;
}
