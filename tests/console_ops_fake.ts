// tests/console_ops_fake.ts: in-memory fakes of migrations 122 and 123's console_* functions (keys, health, support,
// see as this firm, exports, announcements, feature flags), the outbound calls (providers, Sentry, Resend) and the
// function's secrets, keeping the database's rules (roles, audit rows written with the change, last 4 only, the same
// value refused, ...). Used by server/console/handler_test.ts (every role x action) and ops_test.ts, and by
// tests/console_stand.ts (the console's screens in Playwright). No network.
export const NOPE = Symbol("not an ops rpc");
type AuditRow = { who: string; role: string; action: string; target_type: string | null; target_id: string | null; before: unknown; after: unknown; reason: string | null; ip?: string | null };
export type OpsOpts = {
  audit: (r: AuditRow) => void;               // the caller's audit table
  auditRows?: () => any[];                    // its rows, for console_export_audit
  roleOf: (id: string) => string | undefined; // an active console admin's role
  emailOf: (id: string) => string;
  firms: { id: string; name: string; plan_id?: string | null; balance?: number }[];
  plans?: { id: string; name: string }[];
};
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const OPS = { T1: U(501), T2: U(502), A1: U(601), P1: U(201), P2: U(202) };
const now = () => new Date().toISOString();
const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
const last4 = (v?: string | null) => (v && v.length >= 12 ? v.slice(-4) : null);

// the function's secrets (Supabase function secrets are project-wide)
export const ENV: Record<string, string> = {
  RESEND_API_KEY: "re_test_resendkey_0001", ZOHO_CLIENT_ID: "1000.ZOHOCLIENTID42", ZOHO_CLIENT_SECRET: "zoho-secret-value-9999",
  TAXPRO_ASP_ID: "ENV-ASP-ID-000077", FYN_RELAY_KEY: "fyn-relay-key-123456", FYN_RELAY_URL: "https://relay.example.test",
  SENTRY_API_TOKEN: "sntrys_test_token_0042", SENTRY_ORG: "fincom",
};
// the providers: a key with "bad" in it is refused, any other accepted
export function opsHttp(log: { url: string; init?: RequestInit }[] = []) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    log.push({ url, init });
    const h = new Headers(init?.headers || {});
    const auth = (h.get("authorization") || "") + (h.get("x-api-key") || "") + url + String(init?.body || "");
    const bad = /bad/i.test(auth);
    const j = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (url.includes("sentry.io") && url.includes("/issues/")) return bad ? j(401, { detail: "Invalid token" }) : j(200, [
      { id: "1", title: "TypeError: x is undefined", culprit: "app/src/x.js", project: { slug: "fincom-app" }, level: "error", count: "42", userCount: 7, lastSeen: ago(1), firstSeen: ago(30), permalink: "https://fincom.sentry.io/issues/1/" },
      { id: "2", title: "Tally did not answer", culprit: "tally-ingest", project: { slug: "fincom-functions" }, level: "warning", count: "5", userCount: 2, lastSeen: ago(3), firstSeen: ago(50), permalink: "javascript:alert(1)" },
    ]);
    if (url.includes("accounts.zoho")) return j(200, { error: bad ? "invalid_client" : "invalid_code" });
    if (url.includes("vision.googleapis.com")) return bad ? j(400, { error: { message: "API key not valid. Please pass a valid API key. key=" + new URL(url).searchParams.get("key") } }) : j(400, { error: { message: "Request must specify image and features." } });
    if (url.endsWith("/health")) return j(200, { ok: true });
    if (url.includes("api.resend.com/emails")) return j(200, { id: "em_1" });
    return bad ? j(401, { error: { message: "invalid key " + (h.get("x-api-key") || h.get("authorization") || "") } }) : j(200, { data: [{ id: "x" }] });
  };
}

export function opsFake(o: OpsOpts) {
  const err = (code: string) => { throw new Error("console: " + code); };
  const need = (by: string, roles: string[]) => { const r = o.roleOf(by); if (!r || !roles.includes(r)) err("not_allowed"); return r!; };
  const add = (a: any, role: string, action: string, tt: string, tid: string, before: unknown, after: unknown) =>
    o.audit({ who: a.p_by, role, action, target_type: tt, target_id: tid, before, after, reason: a.p_reason ?? null, ip: a.p_ip ?? null });
  const plans = o.plans || [{ id: OPS.P1, name: "Pay as you go" }, { id: OPS.P2, name: "Monthly, all included" }];
  const firmName = (id: string) => o.firms.find((f) => f.id === id)?.name || "";

  // ---- keys
  const table: Record<string, { value: string; set_at: string; set_by: string | null }> = {
    claude_api_key: { value: "sk-ant-api03-OLDVALUE-abcd", set_at: ago(24 * 200), set_by: null },
    google_vision_key: { value: "AIzaSyBADVALUE-vision-0000", set_at: ago(24 * 20), set_by: null },
    call_guest_secret: { value: "g".repeat(48), set_at: ago(24 * 90), set_by: null },
  };
  const vault: Record<string, string> = { "gsp:taxpro:aspid": "VAULT-ASP-ID-001234" };
  const meta: Record<string, any> = {};
  const value = (name: string, store: string) => (store === "table" ? table[name]?.value : store === "vault" ? vault[name] : null) || null;

  // ---- support
  const tickets: any[] = [
    { id: OPS.T1, num: 1001, code: "T-1001", firm_id: o.firms[0]?.id, firm: o.firms[0]?.name, subject: "Cannot post to Tally", module: "Tally", category: "problem", priority: "high", status: "new",
      assignee: "", created_name: "Asha", created_email: "asha@abc.test", created_at: ago(10), updated_at: ago(10), respond_by: ago(6), resolve_by: ago(-14), first_response_at: null, last_by: "firm", replies: 1, notes: 0, sla: "breached",
      thread: [{ id: 1, author_name: "Asha", from_support: false, internal: false, body: "It fails every time", files: [], created_at: ago(10) }] },
    { id: OPS.T2, num: 1002, code: "T-1002", firm_id: o.firms[1]?.id, firm: o.firms[1]?.name, subject: "Billing question", module: "Billing", category: "billing", priority: "low", status: "waiting",
      assignee: "support@fincom.live", created_name: "Bina", created_email: "bina@gsc.test", created_at: ago(30), updated_at: ago(2), respond_by: ago(6), resolve_by: ago(-90), first_response_at: ago(20), last_by: "support", replies: 2, notes: 1, sla: "ok",
      thread: [{ id: 2, author_name: "Bina", from_support: false, internal: false, body: "Why this charge?", files: [], created_at: ago(30) }] },
  ];
  const row = (t: any) => { const { thread, ...r } = t; return { ...r, replies: thread.filter((m: any) => !m.internal).length, notes: thread.filter((m: any) => m.internal).length }; };

  // ---- see as, notices
  const views: any[] = [];
  const bell: any[] = [];

  // ---- announcements, flags
  const anns: any[] = [
    { id: OPS.A1, title: "Maintenance tonight", body: "11 pm to 12 am IST", severity: "warning", audience: "all", plan_ids: [], firm_ids: [], starts_at: ago(2), ends_at: null, dismissible: true, status: "live",
      created_by: null, created_at: ago(2), updated_at: ago(2) },
  ];
  const annJson = (a: any) => ({ ...a, state: a.status !== "live" ? a.status : Date.parse(a.starts_at) > Date.now() ? "scheduled" : a.ends_at && Date.parse(a.ends_at) <= Date.now() ? "ended" : "live",
    dismissed: a.id === OPS.A1 ? 3 : 0, firms_reached: a.audience === "all" ? o.firms.length : a.audience === "plans" ? o.firms.filter((f) => a.plan_ids.includes(f.plan_id)).length : a.firm_ids.length,
    plans: plans.filter((p) => a.plan_ids.includes(p.id)).map((p) => p.name), firms: o.firms.filter((f) => a.firm_ids.includes(f.id)).map((f) => f.name), created_by_email: a.created_by ? o.emailOf(a.created_by) : null });
  const flags: any[] = [{ key: "zoho_books", description: "Zoho Books link", default_on: false, updated_at: ago(48), updated_by: null }, { key: "new_tds_screen", description: "The new TDS screen", default_on: true, updated_at: ago(24), updated_by: null }];
  const rules: any[] = [];
  let ruleId = 0;
  const resolve = (firm: any) => flags.map((f) => {
    const live = (r: any) => !r.until || Date.parse(r.until) > Date.now();
    const fr = rules.find((r) => r.flag_key === f.key && r.scope === "firm" && r.target_id === firm.id && live(r));
    const pr = rules.find((r) => r.flag_key === f.key && r.scope === "plan" && r.target_id === firm.plan_id && live(r));
    return { key: f.key, value: fr ? fr.value : pr ? pr.value : f.default_on, why: fr ? "firm" : pr ? "plan" : "default", until: fr?.until || pr?.until || null };
  });

  const rpc = async (fn: string, a: any): Promise<any> => {
    switch (fn) {
      // keys
      case "console_secrets_status":
        return [...(a.p_table || []).map((n: string) => ({ name: n, store: "table", set: !!table[n], length: table[n]?.value.length || 0, last4: last4(table[n]?.value), set_at: table[n]?.set_at || null, set_by: table[n]?.set_by ? o.emailOf(table[n].set_by!) : null, ...(meta[n] || {}) })),
                ...(a.p_vault || []).map((n: string) => ({ name: n, store: "vault", set: !!vault[n], length: vault[n]?.length || 0, last4: last4(vault[n]), set_at: null, set_by: null, ...(meta[n] || {}) }))];
      case "console_secret_meta_get": return Object.fromEntries((a.p_names || []).filter((n: string) => meta[n]).map((n: string) => [n, meta[n]]));
      case "console_secret_last_used": return { claude: ago(2), vision: ago(72), groq: null };
      case "console_secret_value": return value(a.p_name, a.p_store);
      case "console_secret_set": {
        const role = need(a.p_by, ["owner"]);
        const old = value(a.p_name, a.p_store), v = String(a.p_value).trim();
        if (old === v) err("same_value");
        if (a.p_store === "table") table[a.p_name] = { value: v, set_at: now(), set_by: a.p_by }; else vault[a.p_name] = v;
        meta[a.p_name] = { rotated_at: now(), rotated_by: o.emailOf(a.p_by), rotate_reason: a.p_reason, last4_before: last4(old), last4: last4(v), last_test_at: null, last_test_ok: null, last_test_msg: null };
        add(a, role, "keys.set", "key", a.p_name, { set: !!old, last4: last4(old) }, { set: true, last4: last4(v), store: a.p_store });
        return { name: a.p_name, last4: last4(v), set_at: now() };
      }
      case "console_secret_rotated": {
        const role = need(a.p_by, ["owner"]);
        const before = meta[a.p_name]?.last4 || null;
        meta[a.p_name] = { ...(meta[a.p_name] || {}), rotated_at: now(), rotated_by: o.emailOf(a.p_by), rotate_reason: a.p_reason, last4_before: before, last4: a.p_last4, last_test_at: null, last_test_ok: null };
        add(a, role, "keys.rotated", "key", a.p_name, { last4: before }, { last4: a.p_last4, where: "function secret" });
        return { name: a.p_name, rotated_at: now() };
      }
      case "console_secret_tested":
        need(a.p_by, ["owner"]);
        meta[a.p_name] = { ...(meta[a.p_name] || {}), last_test_at: now(), last_test_ok: a.p_ok, last_test_msg: a.p_msg };
        return { name: a.p_name, ok: a.p_ok, at: now() };

      // health
      case "console_health_summary": return { bridges: 3, bridges_online: 1, bridges_idle: 1, bridges_offline: 1, jobs_waiting: 2, jobs_stuck: 1, jobs_failed_24h: 1, cron_jobs: 2, cron_failed_24h: 1, cron_available: true, pgmq_available: true, as_of: now() };
      case "console_health_bridges": return [
        { id: U(301), firm_id: o.firms[0]?.id, firm: o.firms[0]?.name, name: "OFFICE-PC1", version: "2.4.7", last_seen: ago(0.01), state: "online", minutes_ago: 0, created_at: ago(900) },
        { id: U(302), firm_id: o.firms[1]?.id, firm: o.firms[1]?.name, name: "GSC-LAPTOP", version: "2.4.5", last_seen: ago(2), state: "idle", minutes_ago: 120, created_at: ago(500) },
        { id: U(303), firm_id: o.firms[1]?.id, firm: o.firms[1]?.name, name: "GSC-OLD", version: "2.3.0", last_seen: ago(80), state: "offline", minutes_ago: 4800, created_at: ago(2000) }];
      case "console_health_jobs": return [
        { id: U(401), source: "tally_post", firm_id: o.firms[0]?.id, firm: o.firms[0]?.name, client_id: "c1", status: "failed", message: "Tally said: ledger not found", created_at: ago(1), updated_at: ago(1), stuck: false, age_min: 60 },
        { id: U(402), source: "tally_post", firm_id: o.firms[0]?.id, firm: o.firms[0]?.name, client_id: "c2", status: "waiting", message: "", created_at: ago(0.2), updated_at: ago(0.2), stuck: false, age_min: 12 },
        { id: U(403), source: "tally_read", firm_id: o.firms[1]?.id, firm: o.firms[1]?.name, client_id: "c3", status: "running", message: "", created_at: ago(2), updated_at: ago(1), stuck: true, age_min: 120 }];
      case "console_health_queues": return [
        { name: "pgmq: tally_recorder", kind: "queue", waiting: 4, failed: null, oldest_sec: 900, total: 1200 },
        { name: "tally_post_jobs", kind: "table", waiting: 2, failed: 1, oldest_sec: 600, total: 5 }];
      case "console_health_cron": return [
        { jobid: 1, name: "tally-post-register-settle", schedule: "*/10 * * * *", active: true, last_start: ago(0.1), last_end: ago(0.09), last_status: "succeeded", last_message: "1 row", last_failed_at: ago(3), runs_24h: 144, failed_24h: 1 },
        { jobid: 2, name: "monthly-run", schedule: "0 2 1 * *", active: true, last_start: ago(48), last_end: ago(48), last_status: "succeeded", last_message: "ok", last_failed_at: null, runs_24h: 0, failed_24h: 0 }];

      // support
      case "console_support_list": return tickets.map(row);
      case "console_support_get": { const t = tickets.find((x) => x.id === a.p_ticket); return t ? { ...row(t), thread: t.thread, firm_summary: { id: t.firm_id, name: t.firm, status: "active", balance: 1000, plan: "Pay as you go", members: 2 } } : null; }
      case "console_support_assignees": return [{ email: "owner@fincom.live", role: "owner" }, { email: "support@fincom.live", role: "support" }];
      case "console_support_reply": {
        const role = need(a.p_by, ["owner", "support"]);
        const t = tickets.find((x) => x.id === a.p_ticket); if (!t) err("no_ticket");
        const before = t.status;
        t.thread.push({ id: t.thread.length + 10, author_name: "FinCom support (" + o.emailOf(a.p_by).split("@")[0] + ")", from_support: true, internal: !!a.p_internal, body: a.p_body, files: [], created_at: now() });
        if (!a.p_internal) { t.first_response_at = t.first_response_at || now(); if (["new", "open"].includes(t.status)) t.status = "waiting"; t.last_by = "support"; t.sla = "ok"; }
        t.updated_at = now();
        add(a, role, a.p_internal ? "support.note" : "support.reply", "ticket", t.id, { status: before }, { internal: !!a.p_internal, chars: String(a.p_body).length });
        return row(t);
      }
      case "console_support_set": {
        const role = need(a.p_by, ["owner", "support"]);
        const t = tickets.find((x) => x.id === a.p_ticket); if (!t) err("no_ticket");
        if (a.p_status && !["new", "open", "waiting", "resolved", "closed"].includes(a.p_status)) err("bad_status");
        const b = { status: t.status, priority: t.priority, assignee: t.assignee };
        const n = { status: a.p_status ?? t.status, priority: a.p_priority ?? t.priority, assignee: a.p_assignee ?? t.assignee };
        if (JSON.stringify(b) === JSON.stringify(n)) err("same_status");
        Object.assign(t, n, { updated_at: now(), sla: ["resolved", "closed"].includes(n.status) ? "done" : t.sla });
        add(a, role, "support.set", "ticket", t.id, b, n);
        return row(t);
      }

      // see as this firm
      case "console_seeas": {
        const role = need(a.p_by, ["owner", "support"]);
        const f = o.firms.find((x) => x.id === a.p_firm); if (!f) err("no_firm");
        const id = U(700 + views.length);
        const words = "FinCom support viewed your account on " + new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) + ": " + a.p_reason;
        views.unshift({ id, at: now(), admin: o.emailOf(a.p_by), role, firm_id: f!.id, firm: f!.name, reason: a.p_reason, client_data: false });
        bell.push({ firm_id: f!.id, words });
        add(a, role, "seeas.open", "firm", f!.id, null, { view_id: id, client_data: false, notice: true });
        return {
          view_id: id, at: now(), client_data: false, notice: words,
          firm: { id: f!.id, name: f!.name, status: "active", created_at: ago(900) }, plan: { name: plans.find((p) => p.id === f!.plan_id)?.name || "Pay as you go", period_start: "2026-10-01" },
          credit: { balance: f!.balance ?? 1000, low_balance_warn: 500, charging: true, entries: [{ at: ago(2), kind: "charge", code: "claude", qty: 1, amount: -3.5, balance_after: 996.5 }, { at: ago(240), kind: "topup", code: null, qty: 1, amount: 1000, balance_after: 1000 }] },
          clients: { total: 12, active: 11, switched_off: 1, deleted: 2, with_gstin: 9, names: null },
          team: { active: 3, by_role: { owner: 1, staff: 2 } },
          tally: { devices: [{ name: "OFFICE-PC1", version: "2.4.7", last_seen: ago(0.01), state: "online" }], postings: { waiting: 1, failed_7d: 2, done_7d: 40, last_done: ago(1) }, linked_clients: 8 },
          activity: [{ at: ago(1), what: "post.voucher" }, { at: ago(5), what: "signin" }],
        };
      }
      case "console_view_list": return views.filter((v) => !a.p_firm || v.firm_id === a.p_firm);

      // exports
      case "console_ledger": {
        const rows = [
          { id: "1", at: ago(2), firm_id: o.firms[0]?.id, firm: o.firms[0]?.name, kind: "charge", code: "claude", qty: 1, amount: -3.5, amount_paise: -350, balance_after: 996.5, note: null, ref: null },
          { id: "2", at: ago(240), firm_id: o.firms[0]?.id, firm: o.firms[0]?.name, kind: "topup", code: null, qty: 1, amount: 1000, amount_paise: 100000, balance_after: 1000, note: "=opening", ref: "T1" },
          { id: "3", at: ago(30), firm_id: o.firms[1]?.id, firm: o.firms[1]?.name, kind: "charge", code: "bill", qty: 1, amount: -2, amount_paise: -200, balance_after: 173, note: null, ref: null }]
          .filter((r) => (!a.p_from || r.at >= a.p_from) && (!a.p_to || r.at < a.p_to));
        return { total: rows.length, rows: rows.slice(0, a.p_limit) };
      }
      case "console_export_audit": { const r = (o.auditRows?.() || []).slice().reverse(); return { total: r.length, rows: r.slice(0, a.p_limit) }; }

      // announcements
      case "console_notice_choices": return { plans, firms: o.firms.map((f) => ({ id: f.id, name: f.name })) };
      case "console_announcements_list": return anns.map(annJson);
      case "console_announcement_save": {
        const role = need(a.p_by, ["owner", "support"]);
        const p = a.p;
        let x = a.p_id ? anns.find((y) => y.id === a.p_id) : null;
        if (a.p_id && !x) err("no_announcement");
        if (x?.status === "ended") err("same_status");
        const before = x ? { ...x } : null;
        if (!x) { x = { id: U(800 + anns.length), created_by: a.p_by, created_at: now(), starts_at: now(), ends_at: null }; anns.unshift(x); }
        Object.assign(x, { title: p.title, body: p.body, severity: p.severity, audience: p.audience, plan_ids: p.plan_ids, firm_ids: p.firm_ids, dismissible: p.dismissible, status: p.status,
          starts_at: p.starts_at || x.starts_at, ends_at: p.ends_at || null, updated_at: now(), updated_by: a.p_by });
        add(a, role, "announcements.save", "announcement", x.id, before, { ...x });
        return annJson(x);
      }
      case "console_announcement_end": {
        const role = need(a.p_by, ["owner", "support"]);
        const x = anns.find((y) => y.id === a.p_id); if (!x) err("no_announcement");
        if (x.status === "ended") err("same_status");
        add(a, role, "announcements.end", "announcement", x.id, { status: x.status }, { status: "ended" });
        Object.assign(x, { status: "ended", ends_at: now(), updated_at: now() });
        return annJson(x);
      }

      // flags
      case "console_flags_list": return flags.map((f) => ({ ...f, updated_by_email: f.updated_by ? o.emailOf(f.updated_by) : null,
        rules: rules.filter((r) => r.flag_key === f.key && (!r.until || Date.parse(r.until) > Date.now())).length,
        firms_on: o.firms.filter((x) => resolve(x).find((r) => r.key === f.key)!.value).length, firms: o.firms.length,
        rule_list: rules.filter((r) => r.flag_key === f.key).map((r) => ({ ...r, target: r.scope === "plan" ? plans.find((p) => p.id === r.target_id)?.name : firmName(r.target_id),
          ended: !!r.until && Date.parse(r.until) <= Date.now(), updated_by_email: o.emailOf(r.updated_by) })) }));
      case "console_flag_save": {
        const role = need(a.p_by, ["owner"]);
        let f = flags.find((x) => x.key === a.p_key);
        const before = f ? { description: f.description, default_on: f.default_on } : null;
        if (!f) { f = { key: a.p_key }; flags.push(f); }
        Object.assign(f, { description: a.p_description, default_on: a.p_default_on, updated_at: now(), updated_by: a.p_by });
        add(a, role, "flags.save", "flag", a.p_key, before, { description: f.description, default_on: f.default_on });
        return f;
      }
      case "console_flag_rule_set": {
        const role = need(a.p_by, ["owner"]);
        if (!flags.some((f) => f.key === a.p_key)) err("no_flag");
        if (a.p_scope === "firm" && !o.firms.some((f) => f.id === a.p_target)) err("no_firm");
        if (a.p_scope === "plan" && !plans.some((p) => p.id === a.p_target)) err("no_plan");
        let r = rules.find((x) => x.flag_key === a.p_key && x.scope === a.p_scope && x.target_id === a.p_target);
        const before = r ? { ...r } : null;
        if (!r) { r = { id: ++ruleId, flag_key: a.p_key, scope: a.p_scope, target_id: a.p_target }; rules.push(r); }
        Object.assign(r, { value: a.p_value, until: a.p_until, note: a.p_note, updated_at: now(), updated_by: a.p_by });
        add(a, role, "flags.rule_set", "flag", a.p_key, before, { scope: r.scope, target_id: r.target_id, value: r.value, until: r.until });
        return r;
      }
      case "console_flag_rule_remove": {
        const role = need(a.p_by, ["owner"]);
        const i = rules.findIndex((x) => x.id === a.p_rule); if (i < 0) err("no_rule");
        const [r] = rules.splice(i, 1);
        add(a, role, "flags.rule_remove", "flag", r.flag_key, r, null);
        return { removed: r.id };
      }
      case "console_flags_for_firm": { const f = o.firms.find((x) => x.id === a.p_firm); return f ? resolve(f) : null; }
    }
    return NOPE;
  };
  return { rpc, table, vault, meta, tickets, views, bell, anns, flags, rules };
}
