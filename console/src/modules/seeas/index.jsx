// "See as this firm": a read-only summary of one firm's main screens, made on the server from the firm's data (never
// with a firm user's session). Opening it needs a reason; it is recorded, and the firm sees a notice in its bell:
// "FinCom support viewed your account on <date>: <reason>". The log of every view is the module's list.
import { useState } from "react";
import { Eye } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, ErrorNote, Facts, Loading, Page, ReasonButton } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtDate, fmtInr, fmtNum, fmtTime } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";

const VIEWS = [
  { key: "at", label: "When", type: "date", render: (r) => fmtTime(r.at) },
  { key: "firm", label: "Firm", type: "text" },
  { key: "admin", label: "By", type: "text" },
  { key: "role", label: "Role", type: "select", options: ["owner", "support"], phone: false },
  { key: "reason", label: "Reason (the firm sees it)", type: "text" },
  { key: "client_data", label: "Client names", type: "bool", phone: false },
];
const stTone = (s) => ({ online: "good", idle: "warn", offline: "bad", active: "good", suspended: "warn", closed: "bad" }[s] || "neutral");

function Views({ me }) {
  return (
    <Page title="Firm views" sub="Every “See as this firm”: who, when and why. Open one from a firm's page or a ticket.">
      <DataTable id="views" action="seeas.views" columns={VIEWS} me={me} exportName="firm-views" onRow={(r) => go("seeas/" + r.firm_id)} />
    </Page>
  );
}

function Snapshot({ d }) {
  const t = d.tally || {}, c = d.clients || {}, cr = d.credit || {};
  return (
    <div data-testid="seeas-view">
      <div className="note readonly-banner" role="note">
        Read-only view of <b>{d.firm.name}</b>, made from its data at {fmtTime(d.at)}. Nothing here can be changed, and no one is signed in as the firm.
        The firm was told: “{d.notice}”
      </div>
      <div className="chips"><Chip tone={stTone(d.firm.status)}>{d.firm.status}</Chip>{d.firm.status_reason && <span className="muted">{d.firm.status_reason}</span>}</div>
      <div className="cols">
        <section className="card"><h2>Plan and credit</h2>
          <Facts items={[["Plan", d.plan?.name || "No plan"], ["Period from", fmtDate(d.plan?.period_start)], ["Credit", fmtInr(cr.balance)], ["Warning level", fmtInr(cr.low_balance_warn)], ["Charging", cr.charging ? "On" : "Off"]]} />
          <ul className="list">{(cr.entries || []).map((e, i) => <li key={i}><span>{e.kind}{e.code ? " · " + e.code : ""}</span><span className="muted">{fmtInr(e.amount)} → {fmtInr(e.balance_after)} · {fmtDate(e.at)}</span></li>)}</ul>
        </section>
        <section className="card"><h2>Clients</h2>
          <Facts items={[["Clients", fmtNum(c.total)], ["Active", fmtNum(c.active)], ["Switched off", fmtNum(c.switched_off)], ["Deleted by the firm", fmtNum(c.deleted)], ["With a GSTIN", fmtNum(c.with_gstin)], ["Linked to Tally", fmtNum(t.linked_clients)]]} />
          {c.names ? <ul className="list" data-testid="seeas-names">{c.names.map((x, i) => <li key={i}><span>{x.name}</span><span className="muted">{x.gstin || ""} {x.status}</span></li>)}</ul>
                   : <p className="muted small" data-testid="seeas-counts-only">Counts only: the firm has not allowed FinCom to see its clients' names.</p>}
        </section>
        <section className="card"><h2>Tally</h2>
          <ul className="list">{(t.devices || []).map((x, i) => <li key={i}><span>{x.name} <span className="muted">{x.version}</span></span><Chip tone={stTone(x.state)}>{x.state} · {fmtTime(x.last_seen)}</Chip></li>)}</ul>
          {(t.devices || []).length === 0 && <p className="muted">No computer with FinCom Bridge.</p>}
          {t.postings && <Facts items={[["Postings waiting", fmtNum(t.postings.waiting)], ["Failed, 7 days", fmtNum(t.postings.failed_7d)], ["Posted, 7 days", fmtNum(t.postings.done_7d)], ["Last posted", fmtTime(t.postings.last_done)]]} />}
        </section>
        <section className="card"><h2>Team and recent activity</h2>
          <Facts items={[["People", fmtNum(d.team?.active)], ...Object.entries(d.team?.by_role || {}).map(([k, v]) => [k, fmtNum(v)])]} />
          <ul className="list">{(d.activity || []).map((a, i) => <li key={i}><span>{a.what}</span><span className="muted">{fmtTime(a.at)}</span></li>)}</ul>
        </section>
      </div>
    </div>
  );
}

function SeeAs({ me, firm }) {
  const f = useAction("firm.get", { firm_id: firm });
  const [d, setD] = useState(null);
  const name = f.data?.name || "this firm";
  return (
    <Page title={"See as " + name} sub={<a href={href("firms/" + firm)}>← {name}</a>}
          actions={<ReasonButton me={me} action="seeas.open" params={{ firm_id: firm }} label={d ? "Refresh the view" : "Open the read-only view"} tone="primary"
                                 title={"See as " + name} confirm="Open" onDone={setD}
                                 extra={() => <div className="note note-warn" role="note">The firm will see this in its bell: “FinCom support viewed your account on {fmtDate(new Date())}: <i>your reason</i>”. Write a reason the firm will understand.</div>} />}>
      <ErrorNote error={f.error} />
      {f.loading && !f.data && <Loading />}
      {!d && <p className="muted">The view is made from the firm's data on the server when you open it. It shows plan, credit, client counts, Tally status and recent activity, never the books.</p>}
      {d && <Snapshot d={d} />}
      {me.actions.includes("seeas.views") && (
        <section className="card"><h2>Earlier views of this firm</h2>
          <DataTable key={d?.view_id || "0"} id="fviews" action="seeas.views" params={{ firm_id: firm }} columns={VIEWS.filter((c) => c.key !== "firm")} me={me} exportName="firm-views" empty="Never viewed." />
        </section>
      )}
    </Page>
  );
}

export const module = {
  id: "seeas", label: "Firm views", icon: Eye, action: "seeas.views",
  routes: [
    { path: /^seeas$/, render: (_, me) => <Views me={me} /> },
    { path: /^seeas\/([0-9a-f-]{36})$/, render: (m, me) => <SeeAs me={me} firm={m[1]} key={m[1]} /> },
  ],
};
