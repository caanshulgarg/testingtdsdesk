// System health (console-plan.md 3.13), read-only: bridges online / idle / offline per firm (tally_devices beats),
// waiting, stuck and failed jobs (tally_post_jobs, tally_jobs), queues (pgmq, job tables), scheduled jobs and their last
// runs (cron.job_run_details), and a Sentry summary only when a Sentry token and organisation are set (Keys). Edge
// function error rates need Supabase's log API (a management token, not kept online), so they are not shown here.
import { ALL, ConsoleError, type Ctx, type ListSpec, type Module } from "../core/types.ts";

export const BRIDGES_LIST: ListSpec = {
  columns: { firm: "text", name: "text", version: "text", state: "select", last_seen: "date", minutes_ago: "number", created_at: "date" },
  search: ["firm", "name", "version"], defaultSort: { col: "last_seen", dir: "desc" },
};
export const JOBS_LIST: ListSpec = {
  columns: { source: "select", firm: "text", client_id: "text", status: "select", stuck: "bool", message: "text", created_at: "date", updated_at: "date", age_min: "number" },
  search: ["firm", "client_id", "message", "id"], defaultSort: { col: "updated_at", dir: "desc" },
};
export const QUEUES_LIST: ListSpec = {
  columns: { name: "text", kind: "select", waiting: "number", failed: "number", oldest_sec: "number", total: "number" },
  search: ["name"], defaultSort: { col: "name", dir: "asc" },
};
export const CRON_LIST: ListSpec = {
  columns: { name: "text", schedule: "text", active: "bool", last_status: "select", last_start: "date", last_failed_at: "date", runs_24h: "number", failed_24h: "number", last_message: "text" },
  search: ["name", "schedule", "last_message"], defaultSort: { col: "name", dir: "asc" },
};
export const SENTRY_LIST: ListSpec = {
  columns: { title: "text", project: "select", level: "select", count: "number", users: "number", last_seen: "date", first_seen: "date" },
  search: ["title", "culprit", "project"], defaultSort: { col: "count", dir: "desc" },
};

// the Sentry token and organisation: Keys (platform_secrets) first, then this function's secrets
async function sentryKeys(ctx: Ctx): Promise<{ token: string; org: string } | null> {
  const get = async (name: string, env: string) => {
    let v = "";
    try { v = String((await ctx.deps.rpc("console_secret_value", { p_name: name, p_store: "table" })) || ""); } catch { v = ""; }
    return (v || ctx.deps.env?.(env) || "").trim();
  };
  const token = await get("sentry_api_token", "SENTRY_API_TOKEN"), org = await get("sentry_org", "SENTRY_ORG");
  return token && org ? { token, org } : null;
}

export const module: Module = {
  name: "health",
  actions: {
    "health.summary": {
      roles: ALL, kind: "read",
      run: async (ctx) => {
        const s = await ctx.deps.rpc("console_health_summary", {});
        return { ...(s || {}), sentry: !!(await sentryKeys(ctx)), edge_errors: "not_available" };
      },
    },
    "health.bridges": { roles: ALL, kind: "read", list: BRIDGES_LIST, run: async (ctx) => (await ctx.deps.rpc("console_health_bridges", {})) || [] },
    "health.jobs": { roles: ALL, kind: "read", list: JOBS_LIST, run: async (ctx) => (await ctx.deps.rpc("console_health_jobs", {})) || [] },
    "health.queues": { roles: ALL, kind: "read", list: QUEUES_LIST, run: async (ctx) => (await ctx.deps.rpc("console_health_queues", {})) || [] },
    "health.cron": { roles: ALL, kind: "read", list: CRON_LIST, run: async (ctx) => (await ctx.deps.rpc("console_health_cron", {})) || [] },
    // the top unresolved issues of the last 24 hours (a read-only token; never sent to the browser)
    "health.sentry": {
      roles: ["owner", "support"], kind: "read", list: SENTRY_LIST,
      run: async (ctx) => {
        const k = await sentryKeys(ctx);
        if (!k) throw new ConsoleError(404, "No Sentry token is set (Keys: Sentry read-only token and organisation).", "no_sentry");
        if (!ctx.deps.http) throw new ConsoleError(502, "Outbound calls are not available here.", "no_http");
        let r: Response;
        try {
          r = await ctx.deps.http("https://sentry.io/api/0/organizations/" + encodeURIComponent(k.org) + "/issues/?query=is%3Aunresolved&statsPeriod=24h&sort=freq&limit=25",
            { headers: { Authorization: "Bearer " + k.token } });
        } catch { throw new ConsoleError(502, "Sentry did not answer. Try again in a minute.", "sentry"); }
        if (!r.ok) throw new ConsoleError(502, "Sentry answered " + r.status + ". Check the token on the Keys page.", "sentry");
        const j = await r.json().catch(() => []);
        return (Array.isArray(j) ? j : []).map((x: any) => ({
          id: String(x.id || ""), title: String(x.title || "").slice(0, 200), culprit: String(x.culprit || "").slice(0, 200), project: String(x.project?.slug || ""),
          level: String(x.level || ""), count: Number(x.count || 0), users: Number(x.userCount || 0), last_seen: x.lastSeen || null, first_seen: x.firstSeen || null,
          link: /^https:\/\/[a-z0-9.-]*sentry\.io\//.test(String(x.permalink || "")) ? x.permalink : null,
        }));
      },
    },
  },
};
