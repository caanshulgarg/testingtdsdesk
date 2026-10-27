// deno test server/console/ops_test.ts - the phase 5 modules (keys, announcements, flags, support, health, exports, see
// as this firm) through the REAL router, with tests/console_ops_fake.ts in place of the database and the providers.
// (Every role x action, and the reason rule, are in handler_test.ts.)
import { makeHandler } from "./core/router.ts";
import { type Deps } from "./core/types.ts";
import { MODULES } from "./registry.ts";
import { KEYS } from "./modules/keys.ts";
import { ENV, NOPE, OPS, opsFake, opsHttp } from "../../tests/console_ops_fake.ts";

function assert(c: unknown, msg = "assertion failed"): asserts c { if (!c) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} ${x} !== ${y}`); }
const ORIGIN = "https://console-staging.fincom.live";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ID = { owner: U(1), billing: U(2), support: U(3), viewer: U(4) };
const FIRM = U(101), FIRM2 = U(102);
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const tok = (uid: string) => `${b64({ alg: "HS256" })}.${b64({ sub: uid, aal: "aal2" })}.sig`;
const R = "a good reason";

function stand(o: { env?: Record<string, string>; noHttp?: boolean } = {}) {
  const audit: any[] = [];
  const roles: Record<string, string> = { [ID.owner]: "owner", [ID.billing]: "billing", [ID.support]: "support", [ID.viewer]: "viewer" };
  const emails: Record<string, string> = { [ID.owner]: "owner@fincom.live", [ID.billing]: "billing@fincom.live", [ID.support]: "support@fincom.live", [ID.viewer]: "viewer@fincom.live" };
  const ops = opsFake({ audit: (r) => audit.push(r), auditRows: () => audit, roleOf: (id) => roles[id], emailOf: (id) => emails[id] || "x@y.z",
    firms: [{ id: FIRM, name: "ABC Associates", plan_id: OPS.P1, balance: 1000 }, { id: FIRM2, name: "Garg Shekhar & Co", plan_id: OPS.P2, balance: 175 }] });
  const http: { url: string; init?: RequestInit }[] = [];
  const env = o.env || ENV;
  const deps: Deps = {
    getUser: async (jwt) => { const id = Object.values(ID).find((x) => tok(x) === jwt); return id ? { id, email: emails[id] } : null; },
    adminRow: async (id) => (roles[id] ? { role: roles[id], active: true } : null),
    rpc: async (fn, a) => {
      if (fn === "console_audit_add") { audit.push({ who: a.p_who, role: a.p_role, action: a.p_action, target_type: a.p_target_type, target_id: a.p_target_id, before: a.p_before, after: a.p_after, reason: a.p_reason }); return audit.length; }
      if (fn === "console_firms") return { total: 2, rows: [{ id: FIRM, name: "ABC Associates", owner_email: "asha@abc.test", status: "active", balance: 1000 }, { id: FIRM2, name: "=Garg", status: "active", balance: 175 }] };
      if (fn === "console_users") return { total: 7000, rows: [{ user_id: U(11), firm_id: FIRM, name: "Asha", email: "asha@abc.test", role: "owner", active: true }] };
      const r = await ops.rpc(fn, a);
      if (r !== NOPE) return r;
      throw new Error("no rpc " + fn);
    },
    mfaFactors: async () => [], mfaDelete: async () => {}, authBan: async () => {}, rateHit: async () => true,
    origins: [ORIGIN], log: () => {},
    http: o.noHttp ? undefined : opsHttp(http), env: (k) => env[k],
  };
  const h = makeHandler(deps, MODULES);
  const call = async (who: keyof typeof ID, action: string, params: Record<string, unknown> = {}) => {
    const r = await h(new Request("https://x/functions/v1/console-admin", { method: "POST", body: JSON.stringify({ action, ...params }),
      headers: { Origin: ORIGIN, Authorization: "Bearer " + tok(ID[who]), "Content-Type": "application/json" } }));
    const text = await r.text();
    return { status: r.status, body: JSON.parse(text), text };
  };
  return { call, audit, ops, http };
}
// every secret value the fakes hold: none of them may ever appear in an answer or an audit row
const SECRETS = (s: ReturnType<typeof stand>) => [...Object.values(s.ops.table).map((x) => x.value), ...Object.values(s.ops.vault), ...Object.values(ENV).filter((v) => !v.startsWith("https://") && v !== "fincom")];

Deno.test("keys: the list covers every key, with set / last 4 / powers / last used / rotation, and never a value", async () => {
  const s = stand();
  const r = await s.call("owner", "keys.list", { size: 100 });
  eq(r.status, 200);
  const rows = r.body.data.rows;
  eq(rows.length, KEYS.length, "every key");
  const by = Object.fromEntries(rows.map((x: any) => [x.name, x]));
  eq([by.claude_api_key.set, by.claude_api_key.last4, by.claude_api_key.rotate_due], [true, "abcd", true], "claude: set, last 4, older than 180 days");
  assert(by.claude_api_key.powers.includes("Bill reading") && by.claude_api_key.last_used, "powers and last used");
  eq([by.groq_api_key.set, by.groq_api_key.last4], [false, null], "groq not set");
  eq([by.RESEND_API_KEY.store, by.RESEND_API_KEY.set, by.RESEND_API_KEY.last4, by.RESEND_API_KEY.writable], ["env", true, "0001", false], "a function secret: read here, not writable");
  eq([by["gsp:taxpro:aspid"].store, by["gsp:taxpro:aspid"].last4, by["gsp:taxpro:aspid"].fallback_set], ["vault", "1234", true], "Vault, with its function-secret fallback");
  eq(by.call_guest_secret.last4, "gggg");
  assert(by.call_guest_secret.warn, "the guest secret warns");
  for (const v of SECRETS(s)) assert(!r.text.includes(v), "a value in the list: " + v);
  const f = await s.call("owner", "keys.list", { filters: { set: { op: "is", value: false } } });
  assert(f.body.data.rows.every((x: any) => !x.set), "filter: not set");
  const e = await s.call("owner", "keys.list", { export: "csv" });
  for (const v of SECRETS(s)) assert(!e.text.includes(v), "a value in the CSV");
  for (const who of ["support", "billing", "viewer"] as const) eq((await s.call(who, "keys.list")).status, 403, who);
});

Deno.test("keys: replace is write-only and audited as last 4 only; the same value, a function secret, a short value refused", async () => {
  const s = stand();
  const NEW = "sk-ant-api03-BRANDNEW-9z9z";
  let r = await s.call("owner", "keys.set", { name: "claude_api_key", value: "  " + NEW + " ", reason: "yearly rotation" });
  eq([r.status, r.body.data], [200, { name: "claude_api_key", last4: "9z9z", set_at: r.body.data.set_at }]);
  assert(!r.text.includes(NEW), "the answer has no value");
  eq(s.ops.table.claude_api_key.value, NEW, "trimmed and kept");
  const a = s.audit.filter((x) => x.action === "keys.set");
  eq(a.length, 1, "one audit row (written with the change)");
  eq([a[0].before.last4, a[0].after.last4, a[0].reason], ["abcd", "9z9z", "yearly rotation"]);
  assert(!JSON.stringify(s.audit).includes(NEW) && !JSON.stringify(s.audit).includes("OLDVALUE"), "no value in any audit row");
  r = await s.call("owner", "keys.set", { name: "claude_api_key", value: NEW, reason: R });
  eq([r.status, r.body.reason], [409, "same_value"]);
  r = await s.call("owner", "keys.set", { name: "RESEND_API_KEY", value: "re_whatever_123456", reason: R });
  eq([r.status, r.body.reason], [409, "env_key"]);
  assert(r.body.error.includes("supabase secrets set RESEND_API_KEY"), "says how to change it");
  eq((await s.call("owner", "keys.set", { name: "claude_api_key", value: "x", reason: R })).status, 400);
  eq((await s.call("owner", "keys.set", { name: "no_such_key", value: "abcdefgh", reason: R })).body.reason, "bad_key");
  eq((await s.call("owner", "keys.set", { name: "claude_api_key", value: NEW + "2" })).body.reason, "reason", "a reason is required");
  r = await s.call("owner", "keys.set", { name: "gsp:taxpro:password", value: "TaxPro-Pass-0001", reason: "new ASP password" });
  eq([r.status, s.ops.vault["gsp:taxpro:password"]], [200, "TaxPro-Pass-0001"], "Vault key");
});

Deno.test("keys: Test calls the provider, keeps passed or failed with the time, and never echoes the key", async () => {
  const s = stand();
  let r = await s.call("owner", "keys.test", { name: "claude_api_key" });
  eq([r.status, r.body.data.ok], [200, true]);
  assert(s.http.some((x) => x.url.startsWith("https://api.anthropic.com/v1/models")), "Anthropic's models list");
  eq(s.ops.meta.claude_api_key.last_test_ok, true, "kept");
  const t = s.audit.find((x) => x.action === "keys.test")!;
  eq(t.after, { name: "claude_api_key" }, "the audit row: the name only");
  // a bad key: the provider's answer repeats it; the console takes it out
  await s.call("owner", "keys.set", { name: "google_vision_key", value: "AIza-bad-key-0123456789", reason: R });
  r = await s.call("owner", "keys.test", { name: "google_vision_key" });
  eq(r.body.data.ok, false);
  assert(!r.text.includes("AIza-bad-key-0123456789") && r.body.data.msg.includes("[key]"), "the key taken out of the message: " + r.body.data.msg);
  assert(!JSON.stringify(s.ops.meta).includes("AIza-bad"), "not kept either");
  r = await s.call("owner", "keys.test", { name: "ZOHO_CLIENT_SECRET" });
  eq(r.body.data.ok, true, "Zoho: the id and secret together");
  r = await s.call("owner", "keys.test", { name: "groq_api_key" });
  eq([r.body.data.ok, r.body.data.msg], [false, "Not set."]);
  r = await s.call("owner", "keys.test", { name: "gsp:taxpro:aspid" });
  eq(r.body.data.ok, true, "TaxPro: present (no free check call)");
  r = await s.call("owner", "keys.test", { name: "call_guest_secret" });
  eq(r.body.data.ok, true, "internal: long enough");
  r = await s.call("owner", "keys.test", { name: "FYN_RELAY_KEY" });
  assert(r.body.data.ok && s.http.some((x) => x.url === "https://relay.example.test/health"), "FYN: the relay's health");
  for (const v of SECRETS(s)) assert(!JSON.stringify(s.audit).includes(v), "no value in the audit");
  const n = stand({ noHttp: true });
  eq((await n.call("owner", "keys.test", { name: "claude_api_key" })).body.data.ok, false, "no outbound calls: failed, said plainly");
});

Deno.test("keys: a function secret's rotation is recorded with its new last 4 (read here) and the reason", async () => {
  const s = stand();
  const r = await s.call("owner", "keys.rotated", { name: "RESEND_API_KEY", reason: "rotated after staff change" });
  eq(r.status, 200);
  eq([s.ops.meta.RESEND_API_KEY.last4, s.ops.meta.RESEND_API_KEY.rotate_reason], ["0001", "rotated after staff change"]);
  assert(!JSON.stringify(s.audit).includes(ENV.RESEND_API_KEY), "no value");
  eq((await s.call("owner", "keys.rotated", { name: "claude_api_key", reason: R })).body.reason, "not_env");
  eq((await s.call("owner", "keys.rotated", { name: "ZOHO_CLIENT_ID", reason: R }, )).status, 200);
  const e = stand({ env: {} });
  eq((await e.call("owner", "keys.rotated", { name: "RESEND_API_KEY", reason: R })).body.reason, "not_set");
});

Deno.test("support: list with filters, reply (emailed to the raiser), internal note (not emailed), status / assignee", async () => {
  const s = stand();
  let r = await s.call("support", "support.list", { filters: { sla: { op: "in", values: ["breached"] } } });
  eq(r.body.data.rows.map((x: any) => x.code), ["T-1001"]);
  r = await s.call("viewer", "support.list");
  assert(r.body.data.rows.every((x: any) => !x.created_email || x.created_email.includes("***")), "Viewer: emails partly hidden");
  r = await s.call("support", "support.reply", { ticket_id: OPS.T1, body: "We are on it." });
  eq([r.status, r.body.data.status, r.body.data.emailed], [200, "waiting", "sent"]);
  const m = s.http.find((x) => x.url === "https://api.resend.com/emails")!;
  assert(m && JSON.parse(String(m.init!.body)).to[0] === "asha@abc.test", "emailed to the person who raised it");
  r = await s.call("support", "support.reply", { ticket_id: OPS.T1, body: "note to self", internal: true });
  eq(r.body.data.emailed, "internal note");
  eq(s.http.filter((x) => x.url.includes("resend")).length, 1, "a note is not emailed");
  eq(s.audit.filter((x) => x.action === "support.reply" || x.action === "support.note").map((x) => x.action), ["support.reply", "support.note"]);
  assert(!JSON.stringify(s.audit).includes("We are on it"), "the audit row has the length, not the text");
  eq((await s.call("support", "support.reply", { ticket_id: OPS.T1, body: "  " })).status, 400);
  r = await s.call("support", "support.set", { ticket_id: OPS.T1, status: "resolved", assignee: "support@fincom.live" });
  eq([r.body.data.status, r.body.data.assignee], ["resolved", "support@fincom.live"]);
  eq((await s.call("support", "support.set", { ticket_id: OPS.T1, status: "resolved", assignee: "support@fincom.live" })).body.reason, "same_status");
  eq((await s.call("support", "support.set", { ticket_id: OPS.T1 })).status, 400);
  const g = await s.call("billing", "support.get", { ticket_id: OPS.T1 });
  assert(g.body.data.thread.some((x: any) => x.internal) && g.body.data.firm_summary.name, "one ticket: notes and the firm's summary");
  const n = stand({ env: {} });
  eq((await n.call("support", "support.reply", { ticket_id: OPS.T1, body: "hi" })).body.data.emailed, "not set up");
});

Deno.test("see as this firm: Owner or Support with a reason; audited, logged, the firm told; counts only", async () => {
  const s = stand();
  eq((await s.call("support", "seeas.open", { firm_id: FIRM })).body.reason, "reason");
  eq((await s.call("billing", "seeas.open", { firm_id: FIRM, reason: R })).status, 403);
  const r = await s.call("support", "seeas.open", { firm_id: FIRM, reason: "ticket T-1001: Tally posting" });
  eq(r.status, 200);
  const d = r.body.data;
  eq([d.firm.name, d.clients.total, d.clients.names, d.client_data], ["ABC Associates", 12, null, false]);
  assert(/^FinCom support viewed your account on \d\d \w{3} \d{4}: ticket T-1001: Tally posting$/.test(d.notice), d.notice);
  eq(s.ops.bell.map((x) => x.firm_id), [FIRM], "the firm's bell");
  const a = s.audit.filter((x) => x.action === "seeas.open");
  eq([a.length, a[0].reason, a[0].target_id], [1, "ticket T-1001: Tally posting", FIRM], "one audit row, written with the view");
  const v = await s.call("owner", "seeas.views", { firm_id: FIRM });
  eq(v.body.data.rows.map((x: any) => [x.admin, x.reason]), [["support@fincom.live", "ticket T-1001: Tally posting"]]);
  eq((await s.call("support", "seeas.open", { firm_id: U(999), reason: R })).status, 404);
  eq((await s.call("support", "seeas.open", { firm_id: "nope", reason: R })).status, 400);
});

Deno.test("exports: the ledger list (date range) and Export everything (Owner, reason, 4 files, audited before and after)", async () => {
  const s = stand();
  let r = await s.call("billing", "exports.ledger", { filters: { at: { op: "range", from: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10) } } });
  eq(r.body.data.rows.map((x: any) => x.id), ["1", "3"], "the 10-day-old top-up left out");
  r = await s.call("billing", "exports.ledger", { export: "csv" });
  assert(r.body.data.csv.startsWith("at,firm,kind,code,qty,amount,amount_paise") && r.body.data.csv.includes("'=opening"), "ledger CSV, a formula made plain text");
  eq((await s.call("billing", "exports.all", { reason: R })).status, 403);
  eq((await s.call("owner", "exports.all", {})).body.reason, "reason");
  r = await s.call("owner", "exports.all", { reason: "monthly backup" });
  eq(r.status, 200);
  const files = r.body.data.files;
  eq(files.map((f: any) => f.name), ["firms.csv", "users.csv", "ledger.csv", "audit.csv"]);
  assert(files[0].csv.startsWith("id,name,owner_email") && files[0].csv.includes("'=Garg"), "firms CSV");
  eq([files[1].rows, files[1].total, files[1].truncated], [1, 7000, true], "a file at its limit says so");
  assert(files[3].csv.includes("exports.all"), "the change history includes the export itself");
  eq(s.audit.filter((x) => x.action.startsWith("exports.all")).map((x) => x.action), ["exports.all", "exports.all.done"]);
  eq(s.audit.find((x) => x.action === "exports.all.done").after.files.map((f: any) => f.rows), [2, 1, 3, s.audit.length - 1]);
});

Deno.test("health: summary (Sentry only with a token), lists with filters; Sentry links kept to sentry.io", async () => {
  const s = stand();
  let r = await s.call("viewer", "health.summary");
  eq([r.body.data.bridges_online, r.body.data.sentry, r.body.data.edge_errors], [1, true, "not_available"]);
  r = await s.call("viewer", "health.bridges", { filters: { state: { op: "in", values: ["offline"] } } });
  eq(r.body.data.rows.map((x: any) => x.name), ["GSC-OLD"]);
  r = await s.call("viewer", "health.jobs", { filters: { stuck: { op: "is", value: true } } });
  eq(r.body.data.rows.map((x: any) => x.status), ["running"]);
  r = await s.call("support", "health.cron", { filters: { failed_24h: { op: "range", from: 1 } } });
  eq(r.body.data.rows.map((x: any) => x.name), ["tally-post-register-settle"]);
  r = await s.call("support", "health.sentry");
  eq(r.body.data.rows.map((x: any) => [x.title, x.count, x.link]), [["TypeError: x is undefined", 42, "https://fincom.sentry.io/issues/1/"], ["Tally did not answer", 5, null]]);
  assert(!r.text.includes("sntrys_test_token"), "the token never leaves");
  const n = stand({ env: {} });
  eq((await n.call("owner", "health.summary")).body.data.sentry, false, "no token: hidden");
  eq((await n.call("owner", "health.sentry")).body.reason, "no_sentry");
});

Deno.test("announcements: checked before saving; made live, listed, ended", async () => {
  const s = stand();
  const n0 = s.audit.length;
  for (const [p, why] of [[{ title: "Hi" }, "title"], [{ title: "Hello", audience: "plans" }, "plans"], [{ title: "Hello", audience: "firms", firm_ids: ["x"] }, "firm id"],
                          [{ title: "Hello", severity: "loud" }, "severity"], [{ title: "Hello", starts_at: "2026-11-02T10:00:00Z", ends_at: "2026-11-01T10:00:00Z" }, "end"],
                          [{ title: "Hello", starts_at: "tomorrow" }, "date"]] as const) {
    eq((await s.call("support", "announcements.save", { ...p, reason: R })).status, 400, why);
  }
  eq(s.audit.length, n0, "nothing recorded for a refused form");
  let r = await s.call("support", "announcements.save", { title: "GST portal slow", body: "Expect delays", severity: "urgent", audience: "plans", plan_ids: [OPS.P2], status: "live", reason: "GSTN notice" });
  eq([r.status, r.body.data.state, r.body.data.firms_reached], [200, "live", 1]);
  r = await s.call("viewer", "announcements.list", { filters: { severity: { op: "in", values: ["urgent"] } } });
  eq(r.body.data.rows.map((x: any) => x.title), ["GST portal slow"]);
  r = await s.call("owner", "announcements.end", { id: OPS.A1, reason: "maintenance over" });
  eq(r.body.data.status, "ended");
  eq((await s.call("owner", "announcements.end", { id: OPS.A1, reason: R })).body.reason, "same_status");
  eq((await s.call("owner", "announcements.choices")).body.data.plans.length, 2);
});

Deno.test("flags: Owner sets a rule; the console shows each flag for a firm with why", async () => {
  const s = stand();
  let r = await s.call("owner", "flags.for_firm", { firm_id: FIRM2 });
  eq(r.body.data.rows.map((x: any) => [x.key, x.value, x.why]), [["new_tds_screen", true, "default"], ["zoho_books", false, "default"]]);
  eq((await s.call("owner", "flags.rule_set", { key: "zoho_books", scope: "plan", target_id: OPS.P2, value: true, reason: R })).status, 200);
  eq((await s.call("owner", "flags.rule_set", { key: "zoho_books", scope: "firm", target_id: FIRM2, value: false, reason: R, until: new Date(Date.now() + 86400000).toISOString() })).status, 200);
  r = await s.call("viewer", "flags.for_firm", { firm_id: FIRM2 });
  eq(r.body.data.rows.find((x: any) => x.key === "zoho_books").why, "firm");
  r = await s.call("viewer", "flags.rules", { key: "zoho_books" });
  eq(r.body.data.rows.map((x: any) => x.scope).sort(), ["firm", "plan"]);
  eq((await s.call("owner", "flags.rule_set", { key: "zoho_books", scope: "firm", target_id: FIRM2, value: true, reason: R, until: "2020-01-01T00:00:00Z" })).status, 400, "an end date in the past");
  eq((await s.call("owner", "flags.save", { key: "Bad Key", default_on: true, reason: R })).body.reason, "bad_key");
  eq((await s.call("owner", "flags.save", { key: "calls.recording", reason: R })).status, 400, "a default is required");
  eq((await s.call("owner", "flags.save", { key: "calls.recording", default_on: false, description: "Recording", reason: R })).status, 200);
  eq((await s.call("owner", "flag.get", { key: "nope" })).status, 404);
  const id = s.ops.rules[0].id;
  eq((await s.call("owner", "flags.rule_remove", { rule_id: id, reason: R })).status, 200);
  eq(s.audit.filter((x) => /^flags\.(save|rule_)/.test(x.action)).map((x) => x.action), ["flags.rule_set", "flags.rule_set", "flags.save", "flags.rule_remove"]);
});
