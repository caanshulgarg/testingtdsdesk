// The company's details for the statements (the workbooks' Inputs sheet), in a drawer from the page's header:
// CIN, address, holding company, shares and their holders over 5%, directors or partners with DIN, the signing place,
// date and UDIN. The auditor comes from the firm's settings unless typed here. Each box is kept as it is left
// (FinSt.inputsSet: b.fs.inputs, per client, synced). Also the format (from the entity type unless chosen) and the stock
// when Tally does not keep it (FS's settings, as the Accounts page had them).
import DetailDrawer from "../../../parts/DetailDrawer.jsx";
import CommitBox from "../../../parts/CommitBox.jsx";
import Button from "../../../parts/Button.jsx";

const keep = (o) => { FinSt.inputsSet(o); render(); };
const aud = (k, v) => keep({ auditor: Object.assign({}, (((S.books || {}).fs || {}).inputs || {}).auditor, { [k]: v }) });
function Box({ label, value, on, type = "text", ...rest }) {
  return <label>{label}<CommitBox type={type} aria-label={label} value={value == null ? "" : value} onCommit={(v) => on(type === "number" ? (v === "" ? "" : +v) : v.trim())} {...rest} /></label>;
}
// a list of people (holders, directors, partners): rows of boxes, a row added or removed
function People({ title, list, cols, save, add }) {
  const put = (i, k, v) => { const l = list.map((x) => Object.assign({}, x)); l[i][k] = v; save(l); };
  return <>
    <h5>{title}</h5>
    {list.map((p, i) => <div key={i} className="fin-rowx" data-fin-person={title}>
      {cols.map(([k, l, t]) => <CommitBox key={k} type={t || "text"} aria-label={l + " " + (i + 1)} placeholder={l} value={p[k] == null ? "" : p[k]} onCommit={(v) => put(i, k, t === "number" ? +v || 0 : v.trim())} />)}
      <button type="button" className="linkbtn" onClick={() => save(list.filter((_, j) => j !== i))}>Remove</button></div>)}
    <div><button type="button" className="linkbtn" onClick={() => save(list.concat([add]))}>{"Add " + title.toLowerCase().replace(/s$/, "").replace(/holders over 5%/, "holder")}</button></div>
  </>;
}

export default function Details({ d }) {
  const i = d.inputs, co = i.kind === "co", c = FS.cfg(S.books), A = i.auditor || {}, firmIs = i.entity === "F" || i.entity === "L";
  const sh = i.shares || {};
  return <DetailDrawer kind="finInputs" title="Details for the statements" description="Kept for this client and used on every year’s statements">
    <div className="fin-dl" data-fin-details="">
      <label>Format<select aria-label="Format" value={c.kind === "co" ? "co" : "nc"} onChange={(ev) => fsKindSet(ev.target.value)}>
        <option value="co">Company: Schedule III (Division I)</option><option value="nc">Firm, LLP, proprietor, trust: ICAI format</option></select></label>
      <Box label="Name" value={i.name} on={(v) => keep({ name: v })} />
      {co && <Box label="CIN" value={i.cin} on={(v) => keep({ cin: v.toUpperCase() })} />}
      {!co && firmIs && <Box label="LLPIN or registration number" value={i.cin} on={(v) => keep({ cin: v.toUpperCase() })} />}
      <Box label="PAN" value={i.pan} on={(v) => keep({ pan: v.toUpperCase() })} />
      <label>Registered office<CommitBox as="textarea" rows={2} aria-label="Registered office" value={i.address || ""} onCommit={(v) => keep({ address: v.trim() })} /></label>
      {co && <>
        <Box label="Holding company" value={i.holding} on={(v) => keep({ holding: v })} />
        <h5>Shares</h5>
        <div className="two">
          <Box label="Equity shares issued" type="number" value={sh.number} on={(v) => keep({ shares: Object.assign({}, sh, { number: v }) })} />
          <Box label="Face value (₹)" type="number" value={sh.face} on={(v) => keep({ shares: Object.assign({}, sh, { face: v }) })} />
          <Box label="Authorised shares" type="number" value={sh.authorised} on={(v) => keep({ shares: Object.assign({}, sh, { authorised: v }) })} />
        </div>
        <People title="Holders over 5%" list={sh.holders || []} cols={[["name", "Name"], ["n", "Shares", "number"]]} add={{ name: "", n: 0 }} save={(l) => keep({ shares: Object.assign({}, sh, { holders: l }) })} />
        <People title="Directors" list={i.directors || []} cols={[["name", "Name"], ["din", "DIN"], ["desig", "Designation"]]} add={{ name: "", din: "", desig: "Director" }} save={(l) => keep({ directors: l })} />
      </>}
      {!co && <People title="Partners" list={i.partners || []} cols={[["name", "Name"], ["din", "DPIN / DIN"], ["desig", "Designation"]]} add={{ name: "", din: "", desig: "Partner" }} save={(l) => keep({ partners: l })} />}
      <h5>Signing</h5>
      <div className="two">
        <Box label="Place" value={i.place} on={(v) => keep({ place: v })} />
        <Box label="Date" type="date" value={i.date} on={(v) => keep({ date: v })} />
      </div>
      <Box label="UDIN" value={i.udin} on={(v) => keep({ udin: v.toUpperCase() })} />
      <h5>Auditor</h5>
      <p className="note" style={{ margin: 0 }}>From the firm’s settings; change it here for this client only.</p>
      <div className="two">
        <Box label="Firm" value={A.firm} on={(v) => aud("firm", v)} />
        <Box label="FRN" value={A.frn} on={(v) => aud("frn", v)} />
        <Box label="Partner" value={A.partner} on={(v) => aud("partner", v)} />
        <Box label="Membership no." value={A.mno} on={(v) => aud("mno", v)} />
      </div>
      <h5>Stock, when Tally does not keep it</h5>
      <div className="two">
        <label>Opening stock<CommitBox type="number" step="0.01" aria-label="Opening stock" value={(c.stock || {}).open || ""} onCommit={(v) => { fsStockSet("open", v); render(); }} /></label>
        <label>Closing stock<CommitBox type="number" step="0.01" aria-label="Closing stock" value={(c.stock || {}).close || ""} onCommit={(v) => { fsStockSet("close", v); render(); }} /></label>
      </div>
      <div><Button className="btn small" onClick={() => closeDetail()}>Done</Button></div>
    </div>
  </DetailDrawer>;
}
