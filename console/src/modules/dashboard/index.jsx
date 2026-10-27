import { Gauge } from "lucide-react";
import { ErrorNote, Loading, Page } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtDate, fmtInr, fmtNum } from "../../lib/format.js";
import { href } from "../../lib/route.js";

function Tile({ label, value, sub, to }) {
  const inner = <><span className="tile-label">{label}</span><span className="tile-value">{value}</span>{sub && <span className="tile-sub">{sub}</span>}</>;
  return to ? <a className="tile" href={to}>{inner}</a> : <div className="tile">{inner}</div>;
}
function Dashboard() {
  const { loading, data: d, error, reload } = useAction("dashboard");
  return (
    <Page title="Dashboard" sub={d ? "As of " + new Date(d.as_of).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) + " India time" : ""}
          actions={<button className="btn ghost" onClick={reload}>Refresh</button>}>
      <ErrorNote error={error} onRetry={reload} />
      {loading && !d && <Loading />}
      {d && (
        <>
          <div className="tiles" data-testid="tiles">
            <Tile label="Firms" value={fmtNum(d.firms)} sub={`${fmtNum(d.signups_7d)} new this week`} to={href("firms")} />
            <Tile label="Active people, 7 days" value={fmtNum(d.active_7d)} sub={`${fmtNum(d.active_30d)} in 30 days · ${fmtNum(d.people)} in all`} to={href("users")} />
            <Tile label="Bridges online" value={`${fmtNum(d.bridges_online)} of ${fmtNum(d.bridges)}`} sub="seen in the last 5 minutes" />
            <Tile label="Failed postings today" value={fmtNum(d.failed_jobs_today)} sub="Tally posting jobs" />
            <Tile label="AI calls today" value={fmtNum(d.ai_calls_today)} sub="Ask FinCom, bill reading, OCR" />
            <Tile label="Credit held by firms" value={fmtInr(d.credit_held)} sub={`${fmtNum(d.low_balance)} firms at or below their warning level`} />
          </div>
          <div className="cols">
            <section className="card">
              <h2>Firms by plan</h2>
              <ul className="bars">
                {(d.by_plan || []).map((p) => (
                  <li key={p.plan}><span>{p.plan}</span><meter min={0} max={Math.max(1, d.firms)} value={p.n} aria-label={p.plan} /><b>{fmtNum(p.n)}</b></li>
                ))}
              </ul>
            </section>
            <section className="card">
              <h2>Recent sign-ups</h2>
              <ul className="list">
                {(d.recent || []).map((f) => <li key={f.id}><a href={href("firms/" + f.id)}>{f.name}</a><span className="muted">{f.plan || "No plan"} · {fmtDate(f.created_at)}</span></li>)}
                {(d.recent || []).length === 0 && <li className="muted">None yet.</li>}
              </ul>
            </section>
          </div>
        </>
      )}
    </Page>
  );
}
export const module = { id: "dashboard", label: "Dashboard", icon: Gauge, action: "dashboard", routes: [{ path: /^dashboard$/, render: () => <Dashboard /> }] };
