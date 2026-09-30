// The deductees (suppliers) of the open client: what was credited to each this year, and one opened to edit.
// Was viewParties() in src/js/19 and its handlers in src/js/27.
const save = (p, now) => { if (now) Store.saveParty(S.coId, p); else later("p" + p.id, () => Store.saveParty(S.coId, p), 600); };
const set = (p, k, v, now) => { p[k] = /^(pan|gstin)$/.test(k) ? String(v).toUpperCase().trim() : v; save(p, now); render(); };

function Pf({ p, label, k, type = "text" }) {
  return <label className="f"><span>{label}</span>
    <input type={type} value={p[k] == null ? "" : p[k]} {...(type === "number" ? { step: "0.01" } : {})} onChange={(ev) => set(p, k, ev.target.value)} /></label>;
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
        <Pf p={p} label="Ledger name in Tally" k="ledgerName" /><Pf p={p} label="Expense ledger" k="expenseLedger" />
        <label className="f"><span>Usual payment type</span>
          <select value={p.natureDefault || ""} onChange={(ev) => set(p, "natureDefault", ev.target.value, true)}>
            <option value="">Decide per invoice</option>{rules().map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select></label>
        <Pf p={p} label="Lower deduction rate %" k="ldcRate" type="number" /><Pf p={p} label="Certificate valid to" k="ldcValidTo" type="date" />
      </div>
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
      <div className="tblwrap"><table className="data">
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

// suppliers on bills waiting for review: fill their PAN, type and earlier amounts before the first approval
function PendingSuppliers() {
  const list = pendingSuppliers();
  if (!list.length) return null;
  return <div className="tblwrap" style={{ marginTop: 14 }}><table className="data">
    <thead><tr><th>New supplier, not yet approved</th><th>PAN</th><th>Payment type on the bill</th><th className="n">Bills waiting</th><th className="n">Total</th><th></th></tr></thead>
    <tbody>{list.map((k) => <tr key={k.key}>
      <td>{k.name} <span className="tag warn">new</span></td><td>{k.pan || "—"}</td><td>{k.natureId && k.natureId !== "none" ? ruleOf(k.natureId).label : "—"}</td>
      <td className="n">{k.bills}</td><td className="n">{money0(k.total)}</td>
      <td><button className="linkbtn" onClick={() => { const p = addPendingSupplier(k.key); if (p) { S.partySel = p.id; render(); } }}>Save and fill in</button></td></tr>)}</tbody>
  </table></div>;
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
    {!ps.length ? <div className="pane"><p className="empty" style={{ padding: 0 }}>No suppliers saved yet. They are added when you approve a bill, or add one now.</p></div> : (
      <div className="tblwrap" style={{ marginTop: 14 }}><table className="data">
        <thead><tr><th>Supplier</th><th>PAN</th><th>Usual payment type</th><th className="n">Credited {fy}</th><th className="n">TDS base {fy}</th><th></th></tr></thead>
        <tbody>{ps.map((q) => {
          const y = Object.values((q.ytd && q.ytd[fy]) || {}), tot = (k) => y.reduce((a, v) => a + num(v[k]), 0);
          return <tr key={q.id} className={S.partySel === q.id ? "sel" : ""}>
            <td>{q.name}</td><td>{q.pan || "—"}</td><td>{q.natureDefault ? ruleOf(q.natureDefault).label : "—"}</td>
            <td className="n">{money0(tot("credited"))}</td><td className="n">{money0(tot("tdsBase"))}</td>
            <td className="n"><button className="btn small" aria-label={"Edit " + q.name} onClick={() => { S.partySel = q.id; render(); }}>Edit</button></td></tr>;
        })}</tbody>
      </table></div>
    )}
    {p && <Party p={p} fy={fy} />}
  </>;
}
