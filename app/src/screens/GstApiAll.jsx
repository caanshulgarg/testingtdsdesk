// Settings → GST API: every client's GSTIN and its GST portal connection in one view: connected or not, when the
// taxpayer's API access period ends (a reminder 3 days before), the returns the firm's server has fetched (2B, filed
// GSTR-1 and 3B) and the e-invoice user. Fetch now from here; the OTP itself is given in the client's GST tab.
// The data is GSTAPI.firmStatus (src/js/39) from the gst-taxpro function.
import { useEffect, useState } from "react";

const per = (n) => { const t = new Date(Date.now() + 5.5 * 3600000); let y = t.getUTCFullYear(), m = t.getUTCMonth() + 1 - n; while (m < 1) { m += 12; y--; } return String(m).padStart(2, "0") + y; };
const ymOfPer = (p) => p.slice(2, 6) + p.slice(0, 2);

export default function GstApiAll() {
  const [st, setSt] = useState(null), [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [f, setF] = useState("");
  const clients = Object.values(S.companies || {}).filter((c) => !c.deleted && GSTIN_RE.test(String(c.gstin || "").toUpperCase()))
    .map((c) => ({ id: c.id, name: c.name, gstin: String(c.gstin).toUpperCase() })).sort((a, b) => a.name.localeCompare(b.name));
  const load = () => GSTAPI.firmStatus(clients.map((c) => c.gstin)).then(setSt, (e) => setMsg("Could not ask the server: " + ((e && e.message) || e)));
  useEffect(() => { if (GSTAPI.on() && !st) load(); }, []);
  if (!GSTAPI.on()) return <div className="pane"><h2>GST API, all clients</h2><p className="note">Sign in to the firm account to see every client's GST portal connection.</p></div>;
  const sess = {}, ret = {}, acc = {};
  ((st && st.sessions) || []).forEach((s) => { sess[s.gstin] = s; });
  ((st && st.returns) || []).forEach((r) => { ret[r.gstin + "|" + r.form + "|" + r.period] = r; });
  ((st && st.accounts) || []).forEach((a) => { acc[a.gstin] = a; });
  const now = Date.now(), last = per(1);
  const stateOf = (g) => {
    const s = sess[g];
    if (!s) return { k: "none", t: "Not connected" };
    if (s.endedAt || Date.parse(s.until) < now) return { k: "ended", t: "Ended" + (s.error ? ": " + s.error : "") };
    const left = s.accessUntil ? Math.ceil((Date.parse(s.accessUntil) - now) / 86400000) : null;
    return left != null && left <= 3 ? { k: "soon", t: "Ends in " + Math.max(0, left) + " day" + (left === 1 ? "" : "s"), left } : { k: "live", t: "Connected", left };
  };
  const keptText = (g, form) => { const r = ret[g + "|" + form + "|" + last]; return !r ? "—" : r.status === "ok" ? "✓ " + fmtDate(String(r.fetched_at).slice(0, 10)) : r.status === "none" ? "not yet" : "failed"; };
  const rows = clients.map((c) => Object.assign({}, c, { st: stateOf(c.gstin) })).filter((c) => !f || c.st.k === f);
  const count = (k) => clients.filter((c) => stateOf(c.gstin).k === k).length;
  const fetchNow = async (c, form) => {
    setBusy(c.gstin + form);
    try { const x = await GSTAPI.fetch(c.gstin, form, ymOfPer(last)); setMsg(c.name + ": " + GSTAPI.formOf[form] + " for " + GSTR.label(ymOfPer(last)) + (x.none ? " is not there yet." : " fetched.")); }
    catch (e) { setMsg(c.name + ": " + ((e && e.message) || e)); }
    setBusy(""); load();
  };
  return <div className="pane" data-pane="gstapi-all">
    <h2>GST API, all clients</h2>
    <p className="note">Each client's GST portal connection through the firm's GST API (TaxPro). FinCom keeps a connection alive until the taxpayer's API access period ends, fetches 2B after the 14th and the filed GSTR-1 and 3B each morning, and reminds you 3 days before access ends. The OTP is given in the client's GST tab (2B).</p>
    <div className="gf-chips" style={{ margin: "8px 0" }}>
      {[["", "All", clients.length], ["live", "Connected", count("live")], ["soon", "Ending soon", count("soon")], ["ended", "Ended", count("ended")], ["none", "Not connected", count("none")]].map(([k, l, n]) =>
        <button key={k} className={"gf-chip" + (f === k ? " on" : "") + (k === "soon" && n ? " warn" : "")} onClick={() => setF(k)}>{l} <b>{n}</b></button>)}
      <button className="btn small" onClick={() => { setSt(null); load(); }}>Refresh</button>
    </div>
    {msg && <p className="note">{msg}</p>}
    {!st ? <p className="note">Asking the server…</p> : <div className="bk-tablewrap"><table className="bk-table compact">
      <thead><tr><th>Client</th><th>GSTIN</th><th>Portal connection</th><th className="dt">Access ends</th><th>2B {GSTR.label(ymOfPer(last))}</th><th>GSTR-1</th><th>3B</th><th>E-invoice user</th><th></th></tr></thead>
      <tbody>{rows.map((c) => { const s = sess[c.gstin], a = acc[c.gstin], live = c.st.k === "live" || c.st.k === "soon";
        return <tr key={c.id} data-gstin={c.gstin} data-state={c.st.k}>
          <td><button className="linkbtn" onClick={() => openCompany(c.id)}>{c.name}</button></td><td>{c.gstin}</td>
          <td><span className={"tag " + (c.st.k === "live" ? "ok" : c.st.k === "soon" ? "warn" : c.st.k === "ended" ? "bad" : "no")}>{c.st.t}</span>{s && s.username ? <div className="nr">{s.username}</div> : null}</td>
          <td>{s && s.accessUntil ? fmtDate(String(s.accessUntil).slice(0, 10)) : "—"}</td>
          <td>{keptText(c.gstin, "2B")}</td><td>{keptText(c.gstin, "R1")}</td><td>{keptText(c.gstin, "3B")}</td>
          <td>{a ? a.username + (a.last_error ? " (sign-in failed)" : "") : "—"}</td>
          <td className="ac">{live && <>{["2B", "R1", "3B"].map((fm) => <button key={fm} className="btn small" disabled={!!busy} onClick={() => fetchNow(c, fm)}>{busy === c.gstin + fm ? "…" : "Fetch " + GSTAPI.formOf[fm]}</button>)}</>}</td>
        </tr>; })}</tbody></table></div>}
    {st && st.host && <p className="note">E-invoice and e-way bill go to the IRP's <b>{st.host}</b>{st.host === "sandbox" ? " (test) until the firm's server is switched to production" : ""}.</p>}
  </div>;
}
