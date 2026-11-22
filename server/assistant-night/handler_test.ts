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
