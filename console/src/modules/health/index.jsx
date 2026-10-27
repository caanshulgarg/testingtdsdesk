// System health: bridges per firm, waiting / stuck / failed jobs, queues, scheduled jobs, and the Sentry summary (only
// when a Sentry token is set on the Keys page).
import { Activity } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, ErrorNote, Loading, Page } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtNum, fmtTime } from "../../lib/format.js";
import { href } from "../../lib/route.js";

const STATE = [{ value: "online", label: "Online" }, { value: "idle", label: "Idle (seen today)" }, { value: "offline", label: "Offline" }];
const stTone = (s) => ({ online: "good", idle: "warn", offline: "bad", failed: "bad", running: "warn", waiting: "neutral", taken: "warn", succeeded: "good" }[s] || "neutral");
const ago = (m) => (m === null || m === undefined ? "never" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago");
const secs = (s) => (s === null || s === undefined ? "–" : s < 60 ? s + " s" : s < 3600 ? Math.round(s / 60) + " min" : Math.round(s / 3600) + " h");
const BRIDGES = [
  { key: "firm", label: "Firm", type: "text", render: (r) => <a href={href("firms/" + r.firm_id)} onClick={(e) => e.stopPropagation()}>{r.firm}</a> },
  { key: "name", label: "Computer", type: "text" },
  { key: "state", label: "State", type: "select", options: STATE, render: (r) => <Chip tone={stTone(r.state)} testid="bridge-state">{(STATE.find((s) => s.value === r.state) || {}).label}</Chip> },
  { key: "version", label: "Bridge version", type: "text" },
  { key: "last_seen", label: "Last beat", type: "date", render: (r) => <span title={fmtTime(r.last_seen)}>{ago(r.minutes_ago)}</span> },
  { key: "minutes_ago", label: "Minutes since", type: "number", hidden: true },
  { key: "created_at", label: "Added", type: "date", phone: false },
];
const JOB_STATUS = [{ value: "waiting", label: "Waiting" }, { value: "taken", label: "Taken" }, { value: "running", label: "Running" }, { value: "failed", label: "Failed" }];
const JOBS = [
  { key: "source", label: "Kind", type: "select", options: [{ value: "tally_post", label: "Posting to Tally" }, { value: "tally_read", label: "Reading from Tally" }] },
  { key: "firm", label: "Firm", type: "text" },
  { key: "client_id", label: "Client id", type: "text", phone: false },
  { key: "status", label: "Status", type: "select", options: JOB_STATUS, render: (r) => <Chip tone={stTone(r.status)}>{r.status}{r.stuck ? " · stuck" : ""}</Chip> },
  { key: "stuck", label: "Stuck (30 min no change)", type: "bool", hidden: true },
  { key: "message", label: "Message", type: "text", phone: false },
  { key: "created_at", label: "Made", type: "date", phone: false },
  { key: "updated_at", label: "Changed", type: "date" },
  { key: "age_min", label: "Age (minutes)", type: "number", hidden: true },
];
const QUEUES = [
  { key: "name", label: "Queue or table", type: "text" },
  { key: "kind", label: "Kind", type: "select", options: [{ value: "queue", label: "pgmq queue" }, { value: "table", label: "Job table" }] },
  { key: "waiting", label: "Waiting", type: "number", align: "end" },
  { key: "failed", label: "Failed, 24 h", type: "number", align: "end" },
  { key: "oldest_sec", label: "Oldest waiting", type: "number", align: "end", render: (r) => secs(r.oldest_sec) },
  { key: "total", label: "Total", type: "number", align: "end", phone: false },
];
const CRON = [
  { key: "name", label: "Job", type: "text" },
  { key: "schedule", label: "Schedule", type: "text", render: (r) => <code>{r.schedule}</code> },
  { key: "active", label: "Active", type: "bool" },
  { key: "last_status", label: "Last run", type: "select", options: [{ value: "succeeded", label: "Succeeded" }, { value: "failed", label: "Failed" }, { value: "running", label: "Running" }],
    render: (r) => (r.last_status ? <Chip tone={stTone(r.last_status)}>{r.last_status} · {fmtTime(r.last_start)}</Chip> : <span className="muted">Never ran</span>) },
  { key: "last_start", label: "Last start", type: "date", hidden: true },
  { key: "last_failed_at", label: "Last failure", type: "date", phone: false, render: (r) => (r.last_failed_at ? fmtTime(r.last_failed_at) : "–") },
  { key: "runs_24h", label: "Runs, 24 h", type: "number", align: "end", phone: false },
  { key: "failed_24h", label: "Failed, 24 h", type: "number", align: "end" },
  { key: "last_message", label: "Last message", type: "text", phone: false },
];
const SENTRY = [
  { key: "title", label: "Issue", type: "text", render: (r) => (r.link ? <a href={r.link} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{r.title}</a> : r.title) },
  { key: "project", label: "Project", type: "select", options: ["fincom-app", "fincom-functions", "fincom-console"] },
  { key: "level", label: "Level", type: "select", options: ["fatal", "error", "warning", "info"] },
  { key: "count", label: "Events", type: "number", align: "end" },
  { key: "users", label: "People", type: "number", align: "end", phone: false },
  { key: "last_seen", label: "Last seen", type: "date" },
  { key: "first_seen", label: "First seen", type: "date", phone: false },
];

function Tile({ label, value, sub, tone }) {
  return <div className={"tile" + (tone ? " tile-" + tone : "")}><span className="tile-label">{label}</span><span className="tile-value">{value}</span>{sub && <span className="tile-sub">{sub}</span>}</div>;
}

function Health({ me }) {
  const { loading, data: s, error, reload } = useAction("health.summary");
  return (
    <Page title="System health" sub={s ? "As of " + fmtTime(s.as_of) : ""} actions={<button className="btn ghost" onClick={reload}>Refresh</button>}>
      <ErrorNote error={error} onRetry={reload} />
      {loading && !s && <Loading />}
      {s && (
        <div className="tiles" data-testid="health-tiles">
          <Tile label="Bridges online" value={`${fmtNum(s.bridges_online)} of ${fmtNum(s.bridges)}`} sub={`${fmtNum(s.bridges_idle)} idle · ${fmtNum(s.bridges_offline)} offline`} />
          <Tile label="Jobs waiting" value={fmtNum(s.jobs_waiting)} sub={`${fmtNum(s.jobs_stuck)} stuck`} />
          <Tile label="Jobs failed, 24 h" value={fmtNum(s.jobs_failed_24h)} sub="Tally postings and reads" />
          <Tile label="Scheduled jobs" value={s.cron_available ? fmtNum(s.cron_jobs) : "–"} sub={s.cron_available ? `${fmtNum(s.cron_failed_24h)} failed runs in 24 h` : "pg_cron is not on this database"} />
        </div>
      )}
      <section className="card"><h2>Bridges</h2>
        <DataTable id="hb" action="health.bridges" columns={BRIDGES} me={me} exportName="bridges" defaultPreset={3}
                   presets={[{ label: "Online", filters: { state: { op: "in", values: ["online"] } } }, { label: "Idle", filters: { state: { op: "in", values: ["idle"] } } },
                             { label: "Offline", filters: { state: { op: "in", values: ["offline"] } } }, { label: "All", filters: {} }]} />
      </section>
      <section className="card"><h2>Jobs waiting, stuck or failed</h2>
        <DataTable id="hj" action="health.jobs" columns={JOBS} me={me} exportName="jobs" defaultPreset={3}
                   presets={[{ label: "Failed", filters: { status: { op: "in", values: ["failed"] } } }, { label: "Stuck", filters: { stuck: { op: "is", value: true } } },
                             { label: "Waiting", filters: { status: { op: "in", values: ["waiting", "taken", "running"] } } }, { label: "All", filters: {} }]} />
      </section>
      <section className="card"><h2>Queues</h2>
        <DataTable id="hq" action="health.queues" columns={QUEUES} me={me} exportName="queues" rowKey="name" />
      </section>
      <section className="card"><h2>Scheduled jobs</h2>
        <DataTable id="hc" action="health.cron" columns={CRON} me={me} exportName="cron" rowKey="name"
                   presets={[{ label: "All", filters: {} }, { label: "Failed today", filters: { failed_24h: { op: "range", from: 1, to: null } } }]} />
      </section>
      {s?.sentry && me.actions.includes("health.sentry") && (
        <section className="card" data-testid="sentry"><h2>Errors in the last 24 hours (Sentry)</h2>
          <DataTable id="hs" action="health.sentry" columns={SENTRY} me={me} exportName="sentry" />
        </section>
      )}
      <p className="muted small">Server function error rates need Supabase's log access (a management token, not kept online), so they are not shown here; see the Supabase dashboard.</p>
    </Page>
  );
}

export const module = { id: "health", label: "System health", icon: Activity, action: "health.summary", routes: [{ path: /^health$/, render: (_, me) => <Health me={me} /> }] };
