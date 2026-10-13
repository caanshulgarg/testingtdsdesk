// Integrations (the owner's request of 13-Oct-2026: "one Integrations page, with Tally, Zoho, and later Busy and anything
// else"). The firm's page #/integrations: a card for each integration in INTEGRATIONS (src/js/74-zoho-books.js: a new one
// is one entry there), each with its icon, name, one status line and one button; a card opens its own page:
//   #/integrations/zoho   Zoho Books: whether FinCom's Zoho app is set up (Yes / No, never the id), the organisations
//                         connected (the client each one feeds, last and next read, today's calls against the limit,
//                         errors), Connect, Reconnect, Read now and Disconnect. Never a token, a key or a secret: only
//                         "Connected · token valid until …".
//   Tally                 the Tally page (#/tally), as it is.
//   Busy                  coming soon (disabled).
// Who may do what: every member sees it; only the firm's owner connects, links, reconnects or disconnects (the function
// refuses anyone else too); the owner or staff may ask for a read now.
import { useEffect, useState } from "react";
import { Plug, BookOpen, CircleDashed, ArrowLeft, RefreshCw } from "lucide-react";
import Button from "../parts/Button.jsx";
import Loading from "../parts/Loading.jsx";
import "./integrations.css";

const ICON = { tally: BookOpen, zoho: Plug, busy: CircleDashed };
const isOwner = () => !!(S.account && S.account.me && S.account.me.role === "owner");
const canWrite = () => !!(S.account && S.account.me && ["owner", "staff"].includes(S.account.me.role));
const when = (t) => (t ? fmtDateTime(t) : "—");
const clientName = (id) => ((S.companies || {})[id] || {}).name || (id ? "client " + id : "—");

function openCard(x) {
  if (x.soon) return;
  if (x.id === "tally") { S.tallyFocus = ""; navHome("tally"); return; }
  goIntegrations(x.page);
}

function Card({ x }) {
  const Icon = ICON[x.icon] || Plug, s = x.status() || {}, tone = s.state === "ok" ? "ok" : s.state === "warn" ? "warn" : s.state === "soon" ? "no" : "";
  return <div className={"integ-card" + (x.soon ? " soon" : "")} data-integ={x.id} data-state={s.state || ""}>
    <div className="integ-head"><i className="side-chip" data-tone={x.id === "zoho" ? "rose" : x.id === "tally" ? "teal" : "slate"} aria-hidden="true"><Icon width={18} height={18} strokeWidth={2} /></i>
      <h3>{x.name}</h3></div>
    <p className="integ-line" data-integ-line=""><span className={"tag " + tone}>{s.line || "—"}</span></p>
    {x.note && <p className="note" data-integ-note="">{x.note}</p>}
    <Button className="btn small" disabled={!!x.soon} onClick={() => openCard(x)} data-integ-open={x.id}>{x.soon ? "Coming soon" : x.id === "tally" ? "Open Tally" : "Open " + x.name}</Button>
  </div>;
}

function Hub() {
  const [, tick] = useState(0);
  useEffect(() => { ZohoB.load(); ZohoB.config().then(() => tick((n) => n + 1)); const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, []);
  return <div className="pane" data-pane="integrations">
    <h2>Integrations</h2>
    <p className="note">Where each client's books come from, and where FinCom posts. Open one to set it up.</p>
    <div className="integ-grid">{INTEGRATIONS.map((x) => <Card key={x.id} x={x} />)}</div>
  </div>;
}

// the organisations a Zoho sign-in reaches, each with the client it feeds (the owner picks; a client of another PAN is refused)
function PickOrg({ grant }) {
  const [busy, setBusy] = useState(""), [pick, setPick] = useState({});
  const clients = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const linked = new Set(ZohoB.conns().filter((c) => c.status !== "disconnected").map((c) => c.org));
  const orgs = (grant.orgs || []).filter((o) => !linked.has(o.id));
  const guess = (o) => (clients.find((c) => o.gstin && String(c.gstin || "").toUpperCase().slice(2, 12) === String(o.gstin).slice(2, 12)) || {}).id || "";
  if (!orgs.length) return null;
  return <div className="card" data-zoho-pick="">
    <h3>Choose the client each organisation belongs to</h3>
    <p className="note">Zoho has given FinCom access. Link each organisation to its FinCom client; its books are read in at once and then every few minutes.</p>
    <table className="bk-table compact gf-off"><thead><tr><th>Organisation</th><th>GSTIN</th><th>FinCom client</th><th></th></tr></thead><tbody>
      {orgs.map((o) => { const v = pick[o.id] !== undefined ? pick[o.id] : guess(o);
        return <tr key={o.id} data-zoho-org={o.id}><td>{o.name}</td><td>{o.gstin || "—"}</td>
          <td><select value={v} onChange={(e) => setPick(Object.assign({}, pick, { [o.id]: e.target.value }))} disabled={!isOwner()} data-zoho-client="">
            <option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.gstin ? " · " + c.gstin : ""}</option>)}</select></td>
          <td className="ac"><Button className="btn small primary" disabled={!isOwner() || !v || !!busy} title={isOwner() ? undefined : "Only the firm's owner can link"}
            onClick={async () => { setBusy(o.id); await ZohoB.link(grant.id, o.id, v); setBusy(""); }} data-zoho-link={o.id}>{busy === o.id ? "Linking and reading…" : "Link"}</Button></td></tr>; })}
    </tbody></table>
  </div>;
}

function ZohoPage() {
  const [, tick] = useState(0), [hook, setHook] = useState({}), [busy, setBusy] = useState("");
  const redraw = () => tick((n) => n + 1);
  useEffect(() => { ZohoB.load(true).then(redraw); ZohoB.config().then(redraw); }, []);
  const cfg = ZohoB.st.cfg, data = ZohoB.st.data;
  const back = { expired: "The Zoho sign-in took too long or was used already. Connect again.", refused: "Zoho Books access was not given. Nothing changed.",
    failed: "Zoho did not confirm the sign-in. Connect again.", "not-india": "That Zoho account is not on Zoho's India data centre (zoho.in). FinCom reads Indian organisations only." }[S.zohoBack || ""];
  const grant = S.zohoGrant && data ? (data.grants || []).find((g) => g.id === S.zohoGrant && !g.revoked) : null;
  const conns = ZohoB.conns().filter((c) => c.status !== "disconnected"), gone = ZohoB.conns().filter((c) => c.status === "disconnected");
  const run = async (k, f) => { setBusy(k); try { await f(); } finally { setBusy(""); redraw(); } };
  return <div className="pane" data-pane="integ-zoho">
    <p><button className="linkbtn" onClick={() => goIntegrations("")} data-integ-back=""><ArrowLeft width={14} height={14} /> Integrations</button></p>
    <h2>Zoho Books</h2>
    <p className="note">A client who keeps the books in Zoho Books: FinCom reads them (only what changed, every few minutes) into the same place as Tally's, so TDS, GST, MIS and the due list work as for a Tally client, and posts approved purchase bills and bank entries back into Zoho. FinCom never edits or deletes anything in Zoho it did not create.</p>
    {back && <p className="note warn" data-zoho-back="">{back}</p>}
    <div className="card" data-zoho-setup="">
      <p><b>FinCom's Zoho app set up:</b> <span className={"tag " + (cfg && cfg.configured ? "ok" : "no")} data-zoho-configured={cfg ? String(!!cfg.configured) : ""}>{!cfg ? "…" : cfg.configured ? "Yes" : "No"}</span></p>
      {cfg && !cfg.configured && <p className="note">Connecting waits for the firm's Zoho API client (made once in Zoho's API Console). Until it is in place nothing can be connected.</p>}
      {cfg && cfg.configured && <div className="row" style={{ gap: 8 }}>
        <Button className="btn primary" disabled={!isOwner() || !!busy} title={isOwner() ? undefined : "Only the firm's owner can connect Zoho Books"} onClick={() => run("connect", () => ZohoB.connect())} data-zoho-connect="">Connect Zoho Books</Button>
        {!isOwner() && <span className="note">Only the firm's owner can connect, reconnect or disconnect.</span>}
      </div>}
    </div>
    {grant && <PickOrg grant={grant} />}
    {!data ? <Loading what="the Zoho organisations" /> : !conns.length ? <p className="note" data-zoho-none="">No Zoho organisation is connected yet.</p> :
      <table className="bk-table compact gf-off" data-zoho-conns=""><thead><tr><th>Organisation</th><th>FinCom client</th><th>Access</th><th>Last read</th><th>Next read</th><th className="n">Calls today</th><th>Errors</th><th></th></tr></thead>
        <tbody>{conns.map((c) => <tr key={c.id} data-zoho-conn={c.org} data-status={c.status}>
          <td>{c.orgName}<div className="nr">{c.gstin || ""}</div></td>
          <td><button className="linkbtn" onClick={() => openCompany(c.client)}>{clientName(c.client)}</button><div className="nr">{c.entries} entries</div></td>
          <td><span className={"tag " + (c.status === "connected" ? "ok" : "bad")} data-zoho-access="">{ZohoB.tokenWords(c)}</span></td>
          <td>{when(c.lastSync)}</td><td>{c.status === "connected" ? when(c.nextSync) : "—"}</td>
          <td className="n" data-zoho-calls="">{num(c.callsToday).toLocaleString("en-IN")} of {num(c.cap).toLocaleString("en-IN")}</td>
          <td data-zoho-error="">{c.error ? <span className="tag warn" title={c.errorAt ? when(c.errorAt) : undefined}>{c.error}</span> : (c.posts && c.posts.errors ? <span className="tag warn">{c.posts.errors} posting error{c.posts.errors === 1 ? "" : "s"}</span> : "—")}</td>
          <td className="ac"><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
            <Button className="btn small" disabled={!canWrite() || !!busy || c.status !== "connected"} onClick={() => run("sync" + c.id, () => ZohoB.syncNow(c))} data-zoho-sync={c.org}><RefreshCw width={12} height={12} /> {busy === "sync" + c.id ? "Reading…" : "Read now"}</Button>
            <Button className="btn small" disabled={!isOwner() || !!busy} title={isOwner() ? "Sign in to Zoho again" : "Only the firm's owner can reconnect"} onClick={() => run("re", () => ZohoB.connect())} data-zoho-reconnect={c.org}>Reconnect</Button>
            <Button className="btn small" disabled={!isOwner() || !!busy} title={isOwner() ? "An address Zoho calls when something changes (Settings → Automation → Webhooks in Zoho)" : "Only the firm's owner"} onClick={() => run("hook", async () => { const u = await ZohoB.hookNew(c); if (u) setHook(Object.assign({}, hook, { [c.id]: u })); })} data-zoho-hook={c.org}>Webhook address</Button>
            <Button className="btn small danger" disabled={!isOwner() || !!busy} title={isOwner() ? undefined : "Only the firm's owner can disconnect"} onClick={() => run("off", () => ZohoB.disconnect(c))} data-zoho-disconnect={c.org}>Disconnect</Button>
          </div>
            {hook[c.id] && <p className="note" data-zoho-hook-url="">Shown once. In Zoho Books: Settings → Automation → Workflow Rules → a rule for Invoices, Bills and the rest with a Webhook action to <code>{hook[c.id]}</code> (method POST).</p>}
          </td></tr>)}</tbody></table>}
    {conns.map((c) => (c.log || []).length ? <details key={"l" + c.id} className="card" data-zoho-log={c.org}><summary>What FinCom did lately: {c.orgName}</summary>
      <ul className="plain">{c.log.map((l, i) => <li key={i}><span className="nr">{when(l.at)}</span> {l.kind === "sync" ? "Read" : l.kind === "full" ? "Read, and checked for deletions" : l.kind === "gone" ? "Deletions" : l.kind === "post" ? "Posted" : l.kind === "hook" ? "Zoho said something changed" : l.kind === "error" ? "Stopped" : l.kind}{l.message ? ": " + l.message : ""}{l.counts && l.counts.entries ? " (" + l.counts.entries + " entries)" : ""}</li>)}</ul></details> : null)}
    {gone.length ? <p className="note">Disconnected (nothing deleted): {gone.map((c) => c.orgName + " (" + clientName(c.client) + ")").join(", ")}.</p> : null}
    {cfg && cfg.configured && <p className="note">FinCom's Zoho access: {(cfg.scopes || []).length} permissions, India data centre. It reads every kind of document and creates only bills, expenses, journals and parties; it never edits or deletes.</p>}
  </div>;
}

export default function Integrations() {
  if (!(typeof Cloud === "object" && Cloud.on() && S.account)) return <div className="pane" data-pane="integrations"><h2>Integrations</h2><p className="note">Sign in to the firm account to see its integrations.</p></div>;
  return S.integPage === "zoho" ? <ZohoPage /> : <Hub />;
}
