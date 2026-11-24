// deno test --no-check server/assistant-night/handler_test.ts - Daily Check phase 2's "Remind by itself" (assistant-night,
// action "remind") with a stand-in database and Resend (no network): the timer only; the same guard as a person's send
// (test mode: the firm's own address only, whatever the contacts and the firm's switch say); a real address only with both
// switches; every try logged (the send log and remind_logged). Made-up data only.
import { handler } from "./handler.ts";

const eq = (a: unknown, b: unknown, w: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(w + ": got " + JSON.stringify(a) + ", want " + JSON.stringify(b)); };
const F = "11111111-1111-4111-8111-111111111111", OWN = "aaaaaaaa-0000-4000-8000-000000000001", Q1 = "33333333-3333-4333-8333-333333333333";
const CONTACTS = [{ name: "Anil", email: "accounts@sampletraders.example" }, { name: "Priya", email: "priya@sampletraders.example" }];
function stand(o: { due?: any[]; realSend?: boolean; testTo?: string; ownerEmail?: string; resendOk?: boolean; limit?: boolean }) {
  const calls: any = { due: [], begin: [], finish: [], logged: [], resend: [] };
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url), body = init.body ? JSON.parse(String(init.body)) : null, auth = (init.headers as any || {}).Authorization;
    if (u.endsWith("/rest/v1/rpc/gst_cron_ok")) return new Response(body && body.k === "the-cron-key" ? "true" : "false");
    if (u === "https://api.resend.com/emails") { calls.resend.push(body); return new Response(JSON.stringify(o.resendOk === false ? { message: "bad" } : { id: "re_9" }), { status: o.resendOk === false ? 500 : 200 }); }
    if (auth !== "Bearer service") return new Response(JSON.stringify({ message: "permission denied" }), { status: 401 });
    if (u.endsWith("/rest/v1/rpc/remind_due")) { calls.due.push(body); return new Response(JSON.stringify(o.due ?? [{ firm_id: F, client_id: "c1", by: OWN, questions: [{ id: Q1, text: "Please send the HDFC bank statement (account ending 2231) for October 2026.", state: "asked" }],
      contacts: CONTACTS, real_send: !!o.realSend, test_to: o.testTo ?? "office@samplefirm.example", owner_email: o.ownerEmail ?? "owner@samplefirm.example", client: "Sample Traders", firm: "Sample & Co" }])); }
    if (u.endsWith("/rest/v1/rpc/ask_send_begin")) { if (o.limit) return new Response(JSON.stringify({ message: "20 test emails today already. Try tomorrow." }), { status: 400 }); calls.begin.push(body); return new Response("41"); }
    if (u.endsWith("/rest/v1/rpc/ask_send_finish")) { calls.finish.push(body); return new Response(JSON.stringify({ ok: true })); }
    if (u.endsWith("/rest/v1/rpc/remind_logged")) { calls.logged.push(body); return new Response("null"); }
    return new Response("not here", { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
const env = (live = "") => (k: string) => ({ SUPABASE_URL: "https://stand.example", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", RESEND_API_KEY: "re_test_key", ASSISTANT_MAIL_FROM: "Sample & Co <mail@samplefirm.example>", ASSISTANT_MAIL_LIVE: live } as Record<string, string>)[k];
const remind = (h: (r: Request) => Promise<Response>, headers: Record<string, string> = { "x-cron-key": "the-cron-key" }) =>
  h(new Request("https://fn.example", { method: "POST", headers, body: JSON.stringify({ action: "remind" }) })).then(async (r) => ({ status: r.status, j: await r.json() }));
const CLIENT = /sampletraders/;

Deno.test("reminders: only the timer (a person, a wrong key: refused, nothing read)", async () => {
  const s = stand({});
  eq((await remind(handler({ env: env(), fetch: s.fetch }), { Authorization: "Bearer user-token" })).status, 401, "a signed-in person");
  eq((await remind(handler({ env: env(), fetch: s.fetch }), { "x-cron-key": "wrong" })).status, 401, "a wrong key");
  eq(s.calls.due.length, 0, "nothing read");
});

Deno.test("reminders, test mode (the default): the firm's address only, marked TEST and Reminder, logged", async () => {
  const s = stand({});
  const r = await remind(handler({ env: env(), fetch: s.fetch }));
  eq([r.status, r.j.reminders, r.j.sent, r.j.test, s.calls.finish[0] && s.calls.finish[0].p_why], [200, 1, 1, true, ""], "one test reminder");
  eq(s.calls.due[0], { p_live: false }, "remind_due told the server's switch is off");
  const m = s.calls.resend[0];
  eq(m.to, ["office@samplefirm.example"], "only the firm's own address");
  eq([m.cc, m.bcc], [undefined, undefined], "no cc, no bcc");
  if (!/^\[TEST\] Reminder: /.test(m.subject) || !/^\[TEST: not sent to the client/.test(m.text) || !m.text.includes("HDFC bank statement")) throw new Error("marked as a test reminder, with the question: " + m.subject);
  eq([s.calls.begin[0].p_test, s.calls.begin[0].p_by, s.calls.begin[0].p_sent_to], [true, OWN, ["office@samplefirm.example"]], "claimed as a test, for the owner who turned it on");
  eq([s.calls.finish[0].p_status, s.calls.logged[0].p_status, s.calls.logged[0].p_send], ["sent", "sent", 41], "finished and logged with its send");
});

Deno.test("reminders: never a client's address in test mode, whatever the firm's switch says", async () => {
  for (const realSend of [false, true]) for (const live of ["", "no", "YES", "yes "]) {
    const s = stand({ realSend });
    await remind(handler({ env: env(live), fetch: s.fetch }));
    const to = s.calls.resend.flatMap((m: any) => [].concat(m.to || [], m.cc || [], m.bcc || []));
    if (to.some((a: string) => CLIENT.test(a))) throw new Error("a client's address reached Resend: " + realSend + " " + JSON.stringify(live));
    eq(s.calls.begin.every((b: any) => b.p_test === true), true, "claimed as a test");
  }
});

Deno.test("reminders: both switches on: the client's contacts (only then)", async () => {
  const s = stand({ realSend: true });
  const r = await remind(handler({ env: env("yes"), fetch: s.fetch }));
  eq(s.calls.due[0], { p_live: true }, "remind_due told real sending may be on");
  eq([s.calls.resend[0].to, r.j.test], [["accounts@sampletraders.example", "priya@sampletraders.example"], false], "the client's addresses");
  if (/\[TEST/.test(s.calls.resend[0].subject)) throw new Error("not marked a test");
});

Deno.test("reminders: refused by the guard (no firm address), the day's limit, Resend failing: nothing sent wrongly, each logged", async () => {
  const a = stand({ testTo: "", ownerEmail: "" });
  await remind(handler({ env: env(), fetch: a.fetch }));
  eq([a.calls.resend.length, a.calls.begin.length, a.calls.logged[0].p_status], [0, 0, "refused"], "no firm address: refused before any claim, logged");
  const b = stand({ limit: true });
  await remind(handler({ env: env(), fetch: b.fetch }));
  eq([b.calls.resend.length, b.calls.logged[0].p_status], [0, "refused"], "the day's limit: nothing sent, logged");
  const c = stand({ resendOk: false });
  const r = await remind(handler({ env: env(), fetch: c.fetch }));
  eq([c.calls.finish[0].p_status, c.calls.logged[0].p_status, r.j.sent], ["failed", "failed", 0], "Resend failing: finished as failed, logged");
  const d = stand({ due: [] });
  eq((await remind(handler({ env: env(), fetch: d.fetch }))).j.reminders, 0, "none due: nothing");
});

// "Make the journal now" (the Payroll page; the owner, 23-Nov-2026): action payroll_now, called by a signed-in person of the
// client's firm (their own token, never the timer's key), for one month that has ended. The books are read as the night
// reads them (deps.inputFor stands in for the cloud's books here); the night's own entry is kept, once; tonight's run untouched
const USER = "user-token", ME = "aaaaaaaa-0000-4000-8000-000000000009";
function payStand(o: { member?: any; client?: any; entries?: any[]; findings?: any[]; mfa?: boolean }) {
  const calls: any = { paths: [], posts: [] };
  const db: any = { night_entries: o.entries || [], night_findings: o.findings || [], daily_log: [], night_runs: [] };
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url), m = (init.method || "GET").toUpperCase(), body = init.body ? JSON.parse(String(init.body)) : null, auth = (init.headers as any || {}).Authorization;
    calls.paths.push(m + " " + u.replace("https://stand.example", ""));
    if (u.endsWith("/auth/v1/user")) return auth === "Bearer " + USER ? new Response(JSON.stringify({ id: ME })) : new Response("{}", { status: 401 });
    if (u.endsWith("/rest/v1/rpc/mfa_ok")) return auth === "Bearer " + USER ? new Response(JSON.stringify(o.mfa !== false)) : new Response("{}", { status: 401 });
    if (auth !== "Bearer service") return new Response(JSON.stringify({ message: "permission denied" }), { status: 401 });
    if (u.includes("/rest/v1/members")) return new Response(JSON.stringify(o.member === undefined ? [{ firm_id: F, role: "owner", active: true }] : o.member));
    if (u.includes("/rest/v1/clients")) return new Response(JSON.stringify(o.client === undefined ? (u.includes("firm_id=in.(") && u.includes(F) && u.includes("id=eq.c1") ? [{ id: "c1", firm_id: F, deleted: false }] : []) : o.client));
    const t = (u.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
    if (t && db[t]) {
      if (m === "GET") return new Response(JSON.stringify(db[t].filter((r: any) => !u.includes("dedupe=eq.") || u.includes("dedupe=eq." + encodeURIComponent(r.dedupe)))));
      if (m === "POST") { const rows = [].concat(body).map((r: any, i: number) => Object.assign({ id: t + (db[t].length + i + 1) }, r)); db[t].push(...rows); calls.posts.push(t); return new Response(JSON.stringify(rows)); }
      if (m === "PATCH") { const id = decodeURIComponent((u.match(/[?&]id=eq\.([^&]+)/) || [])[1] || ""), st = (u.match(/[?&]state=in\.\(([^)]*)\)/) || [])[1];
        const hit = db[t].filter((r: any) => id && r.id === id && (!st || st.split(",").includes(r.state)));
        hit.forEach((r: any) => Object.assign(r, body)); return new Response(JSON.stringify(hit)); }
    }
    return new Response("[]");
  };
  return { fetch: fetch as typeof globalThis.fetch, calls, db };
}
const NOW = () => new Date("2026-11-23T10:00:00Z");
const ready = { kind: "made", finding: { kind: "payroll_due", key: "payroll:202610", state: "resolved", facts: { ym: "202610", short: "Payroll Oct 2026" }, evidence: [], candidates: [] },
  picks: [], entry: { finding_key: "payroll_due|payroll:202610", source: "payroll", dedupe: "payroll:202610", work_ref: "dc-x", voucher: { type: "Journal", kind: "payroll", date: "20261031", lines: [] }, reason: "Payroll", why: "Payroll Oct 2026", evidence: [], checks: [], ready: true } };
const payNow = (h: (r: Request) => Promise<Response>, body: any, headers: Record<string, string> = { Authorization: "Bearer " + USER }) =>
  h(new Request("https://fn.example", { method: "POST", headers, body: JSON.stringify(Object.assign({ action: "payroll_now" }, body)) })).then(async (r) => ({ status: r.status, j: await r.json() }));
const mk = (s: any, made: any = ready) => handler({ env: env(), fetch: s.fetch, now: NOW, inputFor: async () => ({ inp: { today: "20261123" }, made }) } as any);

Deno.test("payroll now: only a signed-in person of the client's firm", async () => {
  const s = payStand({});
  eq((await payNow(mk(s), { client_id: "c1", ym: "202610" }, {})).status, 401, "no token");
  eq((await payNow(mk(s), { client_id: "c1", ym: "202610" }, { Authorization: "Bearer anon" })).status, 401, "the anon key");
  eq((await payNow(mk(payStand({ member: [] })), { client_id: "c1", ym: "202610" })).status, 403, "not in a firm");
  eq((await payNow(mk(payStand({ member: [{ firm_id: F, role: "viewer", active: true }] })), { client_id: "c1", ym: "202610" })).status, 403, "a viewer");
  eq((await payNow(mk(s), { client_id: "c-other", ym: "202610" })).status, 404, "another firm's client");
  eq((await payNow(mk(s), { client_id: "c1", ym: "2026-10" })).status, 400, "a month not YYYYMM");
  eq((await payNow(mk(payStand({ mfa: false })), { client_id: "c1", ym: "202610" })).status, 403, "the two-step sign-in not finished");
  eq((await payNow(mk(payStand({ member: [{ firm_id: F, role: "owner", active: false }] })), { client_id: "c1", ym: "202610" })).status, 403, "switched off in the firm");
  eq(s.calls.posts.length, 0, "nothing written");
});
Deno.test("payroll now: a person of two firms: the firm the client is in, only as owner or staff there", async () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const s = payStand({ member: [{ firm_id: OTHER, role: "owner", active: true }, { firm_id: F, role: "staff", active: true }] });
  const r = await payNow(mk(s), { client_id: "c1", ym: "202610" });
  eq([r.status, r.j.kind, s.db.night_entries.length, s.db.night_entries[0].firm_id], [200, "made", 1, F], "made in the client's own firm");
  const v = payStand({ member: [{ firm_id: OTHER, role: "owner", active: true }, { firm_id: F, role: "viewer", active: true }] });
  eq((await payNow(mk(v), { client_id: "c1", ym: "202610" })).status, 404, "a viewer in the client's firm: not found among the firms they write in");
});
Deno.test("payroll now: books not in the cloud, Daily Check off: said in plain words", async () => {
  const h = (skipped: string) => handler({ env: env(), fetch: payStand({}).fetch, now: NOW, inputFor: async () => ({ skipped }) } as any);
  const b = await payNow(h("books"), { client_id: "c1", ym: "202610" });
  eq([b.j.kind, /not in FinCom/.test(b.j.words)], ["none", true], "no books in the cloud: " + b.j.words);
  const g = await payNow(h("paused"), { client_id: "c1", ym: "202610" });
  eq([g.j.kind, /switched off/.test(g.j.words)], ["none", true], "switched off: " + g.j.words);
});
Deno.test("payroll now: the running month: made, with the plain note", async () => {
  const s = payStand({});
  const r = await payNow(mk(s, Object.assign({}, ready, { running: true, words: "Nov 2026 isn’t over yet. This is made from the salary kept now." })), { client_id: "c1", ym: "202611" });
  eq([r.j.kind, r.j.running, r.j.words], ["made", true, "Nov 2026 isn’t over yet. This is made from the salary kept now."], "made, said not over");
});
Deno.test("payroll now: made once, the night's own entry; tonight's run untouched", async () => {
  const s = payStand({});
  const r = await payNow(mk(s), { client_id: "c1", ym: "202610" });
  eq([r.status, r.j.ok, r.j.kind], [200, true, "made"], "made");
  eq(s.db.night_entries.length, 1, "one entry");
  eq(s.db.night_entries[0].voucher, ready.entry.voucher, "the night's voucher");
  eq(s.calls.paths.some((p: string) => /night_runs|night_apply|night_fail/.test(p)), false, "no night_runs, night_apply or night_fail");
  const again = await payNow(mk(s), { client_id: "c1", ym: "202610" });
  eq([again.j.kind, s.db.night_entries.length], ["already", 1], "pressed again: already there, never twice");
});
Deno.test("payroll now: an entry already made is said before the books are read", async () => {
  const s = payStand({ entries: [{ id: "e1", firm_id: F, client_id: "c1", dedupe: "payroll:202610", state: "approved" }] });
  let read = 0;
  const h = handler({ env: env(), fetch: s.fetch, now: NOW, inputFor: async () => { read++; return { inp: {}, made: ready }; } } as any);
  const r = await payNow(h, { client_id: "c1", ym: "202610" });
  eq([r.j.kind, r.j.id, r.j.state, read], ["already", "e1", "approved", 0], "already: its id and state, the books not read");
});
// (re-review 1) the running month's entry still ready: Make now again reads the books and gives it the new figures (the
// same entry); one approved is said before the books are read, as before
Deno.test("payroll now: the running month made again: the ready entry takes the new figures", async () => {
  const nov = (lines: any[]) => ({ kind: "made", running: true, words: "Nov 2026 isn’t over yet. This is made from the salary kept now.",
    finding: { kind: "payroll_due", key: "payroll:202611", state: "resolved", facts: { ym: "202611", short: "Payroll Nov 2026" }, evidence: [], candidates: [] }, picks: [],
    entry: { finding_key: "payroll_due|payroll:202611", source: "payroll", dedupe: "payroll:202611", work_ref: "dc-y", voucher: { type: "Journal", kind: "payroll", date: "20261130", lines }, reason: "Payroll", why: "Payroll Nov 2026", evidence: [], checks: [], ready: true } });
  const old = { id: "e7", firm_id: F, client_id: "c1", dedupe: "payroll:202611", state: "ready", decided_by: null, voucher: { type: "Journal", kind: "payroll", date: "20261130", lines: [{ ledger: "Salary", dr: 80000 }] } };
  const s = payStand({ entries: [old] });
  let read = 0;
  const h = (made: any) => handler({ env: env(), fetch: s.fetch, now: NOW, inputFor: async () => { read++; return { inp: {}, made }; } } as any);
  const r = await payNow(h(nov([{ ledger: "Salary", dr: 81000 }])), { client_id: "c1", ym: "202611" });
  eq([r.j.kind, r.j.id, read, s.db.night_entries.length, s.db.night_entries[0].voucher.lines[0].dr], ["updated", "e7", 1, 1, 81000], "the books read; the same entry, the new figures");
  s.db.night_entries[0].state = "approved";
  const a = await payNow(h(nov([{ ledger: "Salary", dr: 82000 }])), { client_id: "c1", ym: "202611" });
  eq([a.j.kind, a.j.state, read, s.db.night_entries[0].voucher.lines[0].dr], ["already", "approved", 1, 81000], "approved: said, the books not read, never changed");
});
Deno.test("payroll now: the month not over, Needs you, nothing to make: said in plain words", async () => {
  const notyet = await payNow(mk(payStand({}), { kind: "notyet", words: "Nov 2026 isn’t over yet." }), { client_id: "c1", ym: "202611" });
  eq([notyet.status, notyet.j.kind, notyet.j.words], [200, "notyet", "Nov 2026 isn’t over yet."], "not over");
  const s = payStand({});
  const you = await payNow(mk(s, { kind: "you", picks: [], words: "Payroll Oct 2026: salary booked ₹90,000, the sheet says ₹80,000.", finding: { kind: "payroll_due", key: "payroll:202610", state: "you", facts: { ym: "202610" }, evidence: [], candidates: [] } }), { client_id: "c1", ym: "202610" });
  eq([you.j.kind, s.db.night_entries.length, s.db.night_findings.length], ["you", 0, 1], "Needs you: the finding kept, no entry");
});
