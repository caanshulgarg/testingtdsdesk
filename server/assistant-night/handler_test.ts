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
// (review 3) the running month: nothing to make now (no salary kept, or it is in the books): its open entry taken back, said
Deno.test("payroll now: the running month with nothing to make: its open entry taken back, said why", async () => {
  const open = () => ({ id: "e8", firm_id: F, client_id: "c1", dedupe: "payroll:202611", state: "ready", decided_by: null, voucher: { type: "Journal", kind: "payroll", date: "20261130", lines: [] } });
  const s = payStand({ entries: [open()] });
  const r = await payNow(mk(s, { kind: "none", words: "No salary is kept with the books for Nov 2026." }), { client_id: "c1", ym: "202611" });
  eq([r.j.kind, r.j.withdrawn, s.db.night_entries[0].state], ["none", "e8", "withdrawn"], "no salary kept: the entry taken back");
  eq(r.j.words, "No salary is kept with the books for Nov 2026. The entry made for it earlier is taken back.", "said why, plainly");
  const b = payStand({ entries: [open()] });
  const rb = await payNow(mk(b, { kind: "none", words: "Nov 2026’s salary is already in the books, or its entry is on its way to Tally." }), { client_id: "c1", ym: "202611" });
  eq([rb.j.kind, b.db.night_entries[0].state, /already in the books/.test(rb.j.words), /taken back/.test(rb.j.words)], ["none", "withdrawn", true, true], "already in the books: taken back, said: " + rb.j.words);
  const o = payStand({});
  const ro = await payNow(mk(o, { kind: "none", words: "No salary is kept with the books for Oct 2026." }), { client_id: "c1", ym: "202610" });
  eq([ro.j.kind, ro.j.withdrawn, ro.j.words], ["none", undefined, "No salary is kept with the books for Oct 2026."], "a month that has ended, nothing made: said as before");
});
// (review 3) kept (the month's finding set aside or undone on Daily Check): Needs you, never the "made" note
Deno.test("payroll now: kept (set aside or undone on Daily Check): Daily Check needs you, no made note", async () => {
  const nov = Object.assign({}, ready, { running: true, words: "Nov 2026 isn’t over yet. This is made from the salary kept now.",
    finding: { kind: "payroll_due", key: "payroll:202611", state: "resolved", facts: { ym: "202611" }, evidence: [], candidates: [] },
    entry: Object.assign({}, ready.entry, { dedupe: "payroll:202611", voucher: { type: "Journal", kind: "payroll", date: "20261130", lines: [{ ledger: "Salary", dr: 1 }] } }) });
  const s = payStand({ entries: [{ id: "e9", firm_id: F, client_id: "c1", dedupe: "payroll:202611", state: "ready", decided_by: null, voucher: { type: "Journal", kind: "payroll", date: "20261130", lines: [] } }],
    findings: [{ id: "f1", firm_id: F, client_id: "c1", kind: "payroll_due", key: "payroll:202611", state: "dismissed", decided_by: ME, evidence: [] }] });
  const r = await payNow(mk(s, nov), { client_id: "c1", ym: "202611" });
  eq([r.j.kind, r.j.withdrawn, s.db.night_entries[0].state], ["kept", "e9", "withdrawn"], "kept, the open entry taken back");
  eq(r.j.words, "Daily Check needs you for Nov 2026. The entry made for it earlier is taken back.", "said plainly, no made note");
  const o = payStand({ findings: [{ id: "f2", firm_id: F, client_id: "c1", kind: "payroll_due", key: "payroll:202610", state: "dismissed", decided_by: ME, evidence: [] }] });
  const ro = await payNow(mk(o), { client_id: "c1", ym: "202610" });
  eq([ro.j.kind, ro.j.words, o.db.night_entries.length], ["kept", "Daily Check needs you for Oct 2026.", 0], "a month that has ended: Needs you, nothing made");
});
// (review 4) a person's press on Make now is their new decision: a month set aside ("Not needed", dismissed), or undone
// and asked of no one, is opened again and its entry made, logged with who pressed. The update after a save (no press)
// keeps the person's choice: kept, as before
Deno.test("payroll now: a press on a month set aside or undone: opened again and made, logged; the update after a save keeps it", async () => {
  const dismissed = () => [{ id: "f1", firm_id: F, client_id: "c1", kind: "payroll_due", key: "payroll:202610", state: "dismissed", decided_by: ME, decided_at: "2026-11-20T05:00:00Z", evidence: [] }];
  const a = payStand({ findings: dismissed() });
  const auto = await payNow(mk(a), { client_id: "c1", ym: "202610" });
  eq([auto.j.kind, a.db.night_entries.length, a.db.night_findings[0].state, a.db.night_findings[0].decided_by], ["kept", 0, "dismissed", ME], "no press (the update after a save): the person's choice stays, nothing made");
  const s = payStand({ findings: dismissed() });
  const r = await payNow(mk(s), { client_id: "c1", ym: "202610", press: true });
  eq([r.j.kind, r.j.reopened, s.db.night_entries.length, s.db.night_entries[0] && s.db.night_entries[0].state, s.db.night_entries[0] && s.db.night_entries[0].finding_id], ["made", "dismissed", 1, "ready", "f1"], "pressed: made, the entry there (ready), tied to the finding");
  eq([s.db.night_findings[0].state, s.db.night_findings[0].decided_by, s.db.night_findings[0].decided_at], ["resolved", null, null], "the finding opened again, as FinCom finds it now");
  const lg = s.db.daily_log.find((l: any) => l.evidence && l.evidence.kind === "reopened");
  eq([lg && lg.what, lg && lg.evidence.by, lg && lg.evidence.was, lg && lg.ref], ["payroll_now", ME, "dismissed", "f1"], "logged in daily_log: opened again, by who pressed");
  eq(s.db.daily_log.some((l: any) => l.evidence && l.evidence.kind === "made" && l.evidence.by === ME), true, "and the entry made, by them");
  // undone on Daily Check, back as a question to no one (ask, no question to the client): the press makes it
  const undone = () => [{ id: "f3", firm_id: F, client_id: "c1", kind: "payroll_due", key: "payroll:202610", state: "ask", decided_by: null, undone_by: ME, undone_at: "2026-11-21T05:00:00Z", evidence: [] }];
  const u0 = payStand({ findings: undone() });
  eq([(await payNow(mk(u0), { client_id: "c1", ym: "202610" })).j.kind, u0.db.night_entries.length], ["kept", 0], "undone, no press: kept, nothing made");
  const u = payStand({ findings: undone() });
  const ru = await payNow(mk(u), { client_id: "c1", ym: "202610", press: true });
  eq([ru.j.kind, ru.j.reopened, u.db.night_entries.length, u.db.night_findings[0].state, u.db.night_findings[0].undone_at], ["made", "undone", 1, "resolved", null], "undone and asked of no one, pressed: made, the entry there");
  // undone with a question to the client still open: it is the client's to answer; kept, nothing made
  const q = payStand({ findings: undone() });
  q.db.client_asks = [{ id: "q1", finding_id: "f3", state: "asked" }];
  const rq = await payNow(mk(q), { client_id: "c1", ym: "202610", press: true });
  eq([rq.j.kind, q.db.night_entries.length, q.db.night_findings[0].state], ["kept", 0, "ask"], "a question to the client open: kept");
  // the running month set aside, its old entry ready: pressed, the same entry made again from the salary kept now
  const nov = Object.assign({}, ready, { running: true, words: "Nov 2026 isn’t over yet. This is made from the salary kept now.",
    finding: { kind: "payroll_due", key: "payroll:202611", state: "resolved", facts: { ym: "202611" }, evidence: [], candidates: [] },
    entry: Object.assign({}, ready.entry, { dedupe: "payroll:202611", voucher: { type: "Journal", kind: "payroll", date: "20261130", lines: [{ ledger: "Salary", dr: 1 }] } }) });
  const n = payStand({ entries: [{ id: "e9", firm_id: F, client_id: "c1", dedupe: "payroll:202611", state: "ready", decided_by: null, voucher: { type: "Journal", kind: "payroll", date: "20261130", lines: [] } }],
    findings: [{ id: "f4", firm_id: F, client_id: "c1", kind: "payroll_due", key: "payroll:202611", state: "dismissed", decided_by: ME, evidence: [] }] });
  const rn = await payNow(mk(n, nov), { client_id: "c1", ym: "202611", press: true });
  eq([rn.j.kind, rn.j.id, n.db.night_entries[0].state, n.db.night_entries[0].voucher.lines.length, n.db.night_findings[0].state], ["updated", "e9", "ready", 1, "resolved"], "the running month, pressed: its entry made again (ready), never taken back");
});
// (review 5) the client's question, the same for a month set aside as for one undone: asked or answered, it is the
// client's to answer (kept); a Draft never sent to the client does not hold the press back, and stays as it is
Deno.test("payroll now: a press and the client's question: asked or answered kept; a draft never sent does not block", async () => {
  const dismissed = () => [{ id: "f1", firm_id: F, client_id: "c1", kind: "payroll_due", key: "payroll:202610", state: "dismissed", decided_by: ME, decided_at: "2026-11-20T05:00:00Z", evidence: [] }];
  const undone = () => [{ id: "f3", firm_id: F, client_id: "c1", kind: "payroll_due", key: "payroll:202610", state: "ask", decided_by: null, undone_by: ME, undone_at: "2026-11-21T05:00:00Z", evidence: [] }];
  // (review 7) the words: answered says what to do (close it, then press); asked: waiting for the answer
  const QW: Record<string, string> = { asked: "Waiting for the client’s answer for Oct 2026 on Daily Check › From clients.",
    answered: "The client has answered the question for Oct 2026 on Daily Check › From clients. Close it there, then press Make the journal now." };
  for (const qs of ["asked", "answered"]) {
    const d = payStand({ findings: dismissed() });
    d.db.client_asks = [{ id: "q1", finding_id: "f1", state: qs }];
    const r = await payNow(mk(d), { client_id: "c1", ym: "202610", press: true });
    // (review 6) From clients lists only questions whose finding is "ask": the month set aside is moved back there (as
    // undone: the night never resolves it by itself), so the page's "Open From clients" shows it with its question
    const f0 = d.db.night_findings[0];
    eq([r.j.kind, r.j.reopened, d.db.night_entries.length, f0.state, f0.decided_by, f0.decided_at, f0.undone_by, !!f0.undone_at, d.db.client_asks[0].state], ["kept", "dismissed", 0, "ask", null, null, ME, true, qs], "dismissed, a question " + qs + ": back to the client's question (ask), nothing made");
    eq(d.calls.paths.filter((x: string) => x.startsWith("PATCH /rest/v1/night_findings")), ["PATCH /rest/v1/night_findings?id=eq.f1&state=in.(dismissed)"], "the move guarded: only while still set aside");
    eq([r.j.client, r.j.words], [true, QW[qs]], "dismissed, a question " + qs + ": said as the client's (From clients), not Needs you");
    const lg = d.db.daily_log.find((l: any) => l.evidence && l.evidence.kind === "reopened");
    eq([lg && lg.ref, lg && lg.evidence.by, lg && lg.evidence.was, lg && lg.evidence.state], ["f1", ME, "dismissed", "ask"], "logged as reopened, by who pressed");
    // pressed again: it is the client's question now (no second move, nothing made)
    const r2 = await payNow(mk(d), { client_id: "c1", ym: "202610", press: true });
    eq([r2.j.kind, r2.j.client, r2.j.reopened, d.db.night_entries.length, d.db.night_findings[0].state], ["kept", true, undefined, 0, "ask"], "pressed again: still the client's, said so");
    // the update after a save (no press) never moves it
    const n = payStand({ findings: dismissed() });
    n.db.client_asks = [{ id: "q1", finding_id: "f1", state: qs }];
    const rn = await payNow(mk(n), { client_id: "c1", ym: "202610" });
    eq([rn.j.kind, n.db.night_findings[0].state, n.db.night_findings[0].decided_by, n.db.daily_log.some((l: any) => l.evidence && l.evidence.kind === "reopened")], ["kept", "dismissed", ME, false], "no press: set aside as it was, not logged");
    // new figures that need a person (Needs you): the same, never "It is on Needs you" for a finding that is not there
    const y = payStand({ findings: dismissed() });
    y.db.client_asks = [{ id: "q1", finding_id: "f1", state: qs }];
    const ry = await payNow(mk(y, { kind: "you", finding: Object.assign({}, ready.finding, { state: "you" }), picks: [], words: "Payroll Oct 2026: the sheet does not add up" }), { client_id: "c1", ym: "202610", press: true });
    eq([ry.j.kind, ry.j.client, ry.j.words, y.db.night_findings[0].state], ["kept", true, QW[qs], "ask"], "Needs you figures, a question " + qs + ": From clients, where it is");
  }
  // (review 7) asked of the client by a person's choice (Ask client: ask, decided): a press is their new decision, as for a
  // month set aside: its question a Draft never sent, or Closed: opened again (guarded: only while still ask) and made,
  // logged; Asked or Answered: the client's (kept, From clients, nothing made)
  const asked = () => [{ id: "f5", firm_id: F, client_id: "c1", kind: "payroll_due", key: "payroll:202610", state: "ask", decided_by: ME, decided_at: "2026-11-20T05:00:00Z", evidence: [] }];
  for (const qs of ["closed", "draft"]) {
    const ak = payStand({ findings: asked() });
    ak.db.client_asks = [{ id: "q5", finding_id: "f5", state: qs }];
    const rak = await payNow(mk(ak), { client_id: "c1", ym: "202610", press: true });
    const f5 = ak.db.night_findings[0];
    eq([rak.j.kind, rak.j.reopened, ak.db.night_entries.length, ak.db.night_entries[0] && ak.db.night_entries[0].finding_id, f5.state, f5.decided_by], ["made", "asked", 1, "f5", "resolved", null], "asked by a person, its question " + qs + ", pressed: opened again and made");
    eq(ak.calls.paths.filter((x: string) => x.startsWith("PATCH /rest/v1/night_findings")), ["PATCH /rest/v1/night_findings?id=eq.f5&state=in.(ask)"], "the reopen guarded: only while still ask");
    const lg = ak.db.daily_log.find((l: any) => l.evidence && l.evidence.kind === "reopened");
    eq([lg && lg.ref, lg && lg.evidence.by, lg && lg.evidence.was], ["f5", ME, "asked"], "logged as reopened, by who pressed");
    eq(ak.db.client_asks[0].state, qs, "the question left as it is");
  }
  const an = payStand({ findings: asked() });
  an.db.client_asks = [{ id: "q5", finding_id: "f5", state: "answered" }];
  const ran = await payNow(mk(an), { client_id: "c1", ym: "202610", press: true });
  eq([ran.j.kind, ran.j.client, ran.j.reopened, ran.j.words, an.db.night_entries.length, an.db.night_findings[0].state, an.db.night_findings[0].decided_by], ["kept", true, undefined, QW.answered, 0, "ask", ME], "asked by a person, the client answered: kept, the answer's words, nothing made");
  // no press (the update after a save): the person's choice stays
  const np = payStand({ findings: asked() });
  np.db.client_asks = [{ id: "q5", finding_id: "f5", state: "closed" }];
  const rnp = await payNow(mk(np), { client_id: "c1", ym: "202610" });
  eq([rnp.j.kind, np.db.night_entries.length, np.db.night_findings[0].state, np.db.night_findings[0].decided_by], ["kept", 0, "ask", ME], "no press: kept as the person chose");
  // (review 7, race) the question sent meanwhile (Asked between the first read and the reopen): nothing made, the client's
  for (const qs of ["asked", "answered"]) {
    const rc = payStand({ findings: asked() });
    rc.db.client_asks = [{ id: "q5", finding_id: "f5", state: "draft" }];
    const f0 = rc.fetch;
    rc.fetch = (async (url: any, init: RequestInit = {}) => {
      const out = await f0(url, init);
      if ((init.method || "").toUpperCase() === "PATCH" && String(url).includes("/rest/v1/night_findings?id=eq.f5&state=in.(ask)")) rc.db.client_asks[0].state = qs;
      return out;
    }) as typeof globalThis.fetch;
    const rr = await payNow(mk(rc), { client_id: "c1", ym: "202610", press: true });
    const fr = rc.db.night_findings[0];
    eq([rr.j.kind, rr.j.client, rr.j.words, rc.db.night_entries.length, fr.state, fr.decided_by, fr.undone_by, !!fr.undone_at], ["kept", true, QW[qs], 0, "ask", null, ME, true], "the question " + qs + " meanwhile: nothing made, the client's question (ask), said so");
  }
  const ua = payStand({ findings: undone() });
  ua.db.client_asks = [{ id: "q1", finding_id: "f3", state: "answered" }];
  const rua = await payNow(mk(ua), { client_id: "c1", ym: "202610", press: true });
  eq([rua.j.kind, rua.j.client, rua.j.words, ua.db.night_entries.length], ["kept", true, QW.answered, 0], "undone, the client answered: kept, the client's; close it, then press");
  const dd = payStand({ findings: dismissed() });
  dd.db.client_asks = [{ id: "q1", finding_id: "f1", state: "draft" }];
  const rd = await payNow(mk(dd), { client_id: "c1", ym: "202610", press: true });
  eq([rd.j.kind, rd.j.reopened, dd.db.night_entries.length, dd.db.night_findings[0].state, dd.db.client_asks[0].state], ["made", "dismissed", 1, "resolved", "draft"], "dismissed, a Draft never sent: made; the Draft stays as it is");
  const ud = payStand({ findings: undone() });
  ud.db.client_asks = [{ id: "q1", finding_id: "f3", state: "draft" }];
  const ru = await payNow(mk(ud), { client_id: "c1", ym: "202610", press: true });
  eq([ru.j.kind, ru.j.reopened, ud.db.night_entries.length, ud.db.night_findings[0].state, ud.db.client_asks[0].state], ["made", "undone", 1, "resolved", "draft"], "undone, a Draft never sent: made; the Draft stays as it is");
  eq(ud.calls.paths.some((x: string) => x.startsWith("PATCH /rest/v1/client_asks")) || dd.calls.paths.some((x: string) => x.startsWith("PATCH /rest/v1/client_asks")), false, "the Draft is not written to");
});
// (review 5) the reopen only while the finding is still set aside or undone: a decision made at the same moment stays
Deno.test("payroll now: a press races a decision on Daily Check: the decision stays, nothing made", async () => {
  const s = payStand({ findings: [{ id: "f1", firm_id: F, client_id: "c1", kind: "payroll_due", key: "payroll:202610", state: "dismissed", decided_by: ME, evidence: [] }] });
  const f0 = s.fetch;
  s.fetch = (async (url: any, init: RequestInit = {}) => {
    if ((init.method || "").toUpperCase() === "PATCH" && String(url).includes("/rest/v1/night_findings")) Object.assign(s.db.night_findings[0], { state: "you", decided_by: "u-other" });
    return f0(url, init);
  }) as typeof globalThis.fetch;
  const r = await payNow(mk(s), { client_id: "c1", ym: "202610", press: true });
  eq(s.calls.paths.some((x: string) => x.startsWith("PATCH /rest/v1/night_findings?id=eq.f1&state=in.(dismissed,ask)")), true, "the reopen guarded: only while dismissed or ask");
  eq([r.j.kind, r.j.reopened, s.db.night_entries.length, s.db.night_findings[0].state, s.db.night_findings[0].decided_by], ["kept", undefined, 0, "you", "u-other"], "the decision made meanwhile stays; nothing made");
  eq([r.j.client, r.j.words], [undefined, "Daily Check needs you for Oct 2026."], "said as Needs you");
  eq(s.db.daily_log.some((l: any) => l.evidence && l.evidence.kind === "reopened"), false, "not logged as opened again");
});
// (review 4) no salary in the cloud for the month: said so in a way the page can tell (nosalary)
Deno.test("payroll now: no salary in the cloud: marked for the page", async () => {
  const r = await payNow(mk(payStand({}), { kind: "none", nosalary: true, words: "No salary is kept with the books for Oct 2026." }), { client_id: "c1", ym: "202610" });
  eq([r.j.kind, r.j.nosalary], ["none", true], "nosalary passed on");
});
