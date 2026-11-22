// deno test --no-check server/assistant-send/handler_test.ts - the send function with a stand-in database and Resend (no
// network): owner only, only questions still needed, test mode to the firm only, both switches for a real address, every
// try logged; and assistant-night refuses anyone but the timer. Made-up data only.
import { handler } from "./handler.ts";
import { handler as night } from "../assistant-night/handler.ts";

const eq = (a: unknown, b: unknown, w: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(w + ": got " + JSON.stringify(a) + ", want " + JSON.stringify(b)); };
const Q1 = "11111111-1111-4111-8111-111111111111", Q2 = "22222222-2222-4222-8222-222222222222";

function stand(o: { owner?: boolean; realSend?: boolean; questions?: any[]; contacts?: any[]; resendOk?: boolean; limit?: boolean; resendThrows?: boolean }) {
  const calls: any = { resend: [], done: [], begin: [] };
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url), body = init.body ? JSON.parse(String(init.body)) : null;
    if (u.endsWith("/rest/v1/rpc/ask_send_prepare")) {
      if (o.owner === false) return new Response(JSON.stringify({ message: "Only the firm's owner sends questions." }), { status: 403 });
      return new Response(JSON.stringify({ firm_id: "11111111-1111-4111-8111-111111111111", by: "aaaaaaaa-0000-4000-8000-000000000001", questions: o.questions ?? [{ id: Q1, text: "₹48,000 paid to Ramesh on 05-Nov: what is it for?", state: "draft" }], contacts: o.contacts ?? [{ name: "Anil", email: "accounts@sampletraders.example", whatsapp: "" }],
        real_send: !!o.realSend, test_to: "office@samplefirm.example", client: "Sample Traders", firm: "Sample & Co", real_today: 0, firm_today: 0, test_today: 0 }));
    }
    if (u.endsWith("/rest/v1/rpc/ask_send_begin")) {
      if ((init.headers as any).Authorization !== "Bearer service") return new Response(JSON.stringify({ message: "permission denied" }), { status: 401 });
      if (o.limit) return new Response(JSON.stringify({ message: "Already emailed this client today. Try tomorrow." }), { status: 400 });
      calls.begin.push(body); return new Response("7");
    }
    if (u.endsWith("/rest/v1/rpc/ask_send_finish")) { calls.done.push(Object.assign({}, body, calls.begin[0])); return new Response(JSON.stringify({ ok: true, marked: calls.begin[0].p_test ? 0 : calls.begin[0].p_ids.length })); }
    if (u.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ email: "owner@samplefirm.example" }));
    if (u === "https://api.resend.com/emails" && o.resendThrows) throw new Error("connection reset");
    if (u === "https://api.resend.com/emails") { calls.resend.push(body); return new Response(JSON.stringify(o.resendOk === false ? { message: "bad" } : { id: "re_1" }), { status: o.resendOk === false ? 500 : 200 }); }
    if (u.endsWith("/rest/v1/rpc/gst_cron_ok")) return new Response("false");
    return new Response("not here", { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
const env = (live = "") => (k: string) => ({ SUPABASE_URL: "https://stand.example", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", RESEND_API_KEY: "re_test_key", ASSISTANT_MAIL_FROM: "Sample & Co <mail@samplefirm.example>", ASSISTANT_MAIL_LIVE: live } as Record<string, string>)[k];
const ask = (h: (r: Request) => Promise<Response>, b: unknown, jwt = "user-token") => h(new Request("https://fn.example", { method: "POST", headers: { Authorization: "Bearer " + jwt }, body: JSON.stringify(b) })).then(async (r) => ({ status: r.status, j: await r.json() }));

Deno.test("signed out, or nothing ticked: refused", async () => {
  const s = stand({});
  eq((await ask(handler({ env: env(), fetch: s.fetch }), { client_id: "c1", ask_ids: [Q1] }, "anon")).status, 401, "anon key");
  eq((await ask(handler({ env: env(), fetch: s.fetch }), { client_id: "c1", ask_ids: [] })).status, 400, "no question");
  eq(s.calls.resend.length, 0, "nothing sent");
});
Deno.test("staff (not the owner): refused, nothing sent", async () => {
  const s = stand({ owner: false });
  const r = await ask(handler({ env: env("yes"), fetch: s.fetch }), { client_id: "c1", ask_ids: [Q1] });
  eq(r.status, 403, "status"); eq(s.calls.resend.length, 0, "nothing sent");
});
Deno.test("test mode (the default): only the firm's address, marked TEST, logged as a test", async () => {
  for (const [live, realSend] of [["", false], ["yes", false], ["", true], ["no", true]] as [string, boolean][]) {
    const s = stand({ realSend });
    const r = await ask(handler({ env: env(live), fetch: s.fetch }), { client_id: "c1", ask_ids: [Q1] });
    eq([r.j.ok, r.j.test, r.j.to], [true, true, ["office@samplefirm.example"]], "reply " + live + "/" + realSend);
    eq(s.calls.resend[0].to, ["office@samplefirm.example"], "Resend to");
    eq([s.calls.resend[0].cc, s.calls.resend[0].bcc], [undefined, undefined], "no cc or bcc");
    if (!s.calls.resend[0].subject.startsWith("[TEST] ") || !s.calls.resend[0].text.includes("1. ₹48,000 paid to Ramesh")) throw new Error("marked TEST with the question");
    eq([s.calls.done[0].p_test, s.calls.done[0].p_status, s.calls.done[0].p_meant, s.calls.done[0].p_send], [true, "sent", ["accounts@sampletraders.example"], 7], "claimed and logged as a test (service role)");
  }
});
Deno.test("both switches on: the client's contacts", async () => {
  const s = stand({ realSend: true });
  const r = await ask(handler({ env: env("yes"), fetch: s.fetch }), { client_id: "c1", ask_ids: [Q1] });
  eq([r.j.test, s.calls.resend[0].to, s.calls.resend[0].reply_to], [false, ["accounts@sampletraders.example"], "office@samplefirm.example"], "real send, replies to the firm");
  eq(s.calls.done[0].p_test, false, "logged as real");
});
Deno.test("nothing still needed (resolved or closed): nothing sent", async () => {
  const s = stand({ questions: [] });
  const r = await ask(handler({ env: env("yes"), fetch: s.fetch }), { client_id: "c1", ask_ids: [Q2] });
  eq([r.j.ok, s.calls.resend.length], [false, 0], "nothing sent");
});
Deno.test("the day's limit refused at the claim: nothing sent", async () => {
  const s = stand({ realSend: true, limit: true });
  const r = await ask(handler({ env: env("yes"), fetch: s.fetch }), { client_id: "c1", ask_ids: [Q1] });
  eq([r.j.ok, s.calls.resend.length, r.j.error], [false, 0, "Already emailed this client today. Try tomorrow."], "refused");
});
Deno.test("the network breaks on the way to Resend: the claim finished as failed, never left sending", async () => {
  const s = stand({ resendThrows: true });
  let threw = false;
  try { await ask(handler({ env: env(), fetch: s.fetch }), { client_id: "c1", ask_ids: [Q1] }); } catch { threw = true; }
  eq([threw, s.calls.done.length, s.calls.done[0] && s.calls.done[0].p_status], [true, 1, "failed"], "finished as failed");
});
Deno.test("Resend fails: said plainly, logged as failed", async () => {
  const s = stand({ resendOk: false });
  const r = await ask(handler({ env: env(), fetch: s.fetch }), { client_id: "c1", ask_ids: [Q1] });
  eq([r.j.ok, s.calls.done[0].p_status], [false, "failed"], "failed");
});
Deno.test("assistant-night: only the timer or the service role", async () => {
  const s = stand({});
  const h = night({ env: env(), fetch: s.fetch });
  const r1 = await h(new Request("https://fn.example", { method: "POST", headers: { Authorization: "Bearer user-token" }, body: JSON.stringify({ action: "client", firm_id: "11111111-1111-4111-8111-111111111111", client_id: "c1" }) }));
  eq(r1.status, 401, "a signed-in person");
  const r2 = await h(new Request("https://fn.example", { method: "POST", headers: { "x-cron-key": "wrong" }, body: "{}" }));
  eq(r2.status, 401, "a wrong cron key");
  const r3 = await h(new Request("https://fn.example", { method: "POST", headers: { Authorization: "Bearer service" }, body: JSON.stringify({ action: "client", firm_id: "nope", client_id: "c1" }) }));
  eq(r3.status, 400, "the service role, a bad firm id");
});

Deno.test("assistant-night: the console's switches cannot be read: nothing checked (closed), the run marked failed", async () => {
  const fails: any[] = [];
  const fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url);
    if (u.includes("/rest/v1/firms?") || u.includes("/rest/v1/subscriptions?") || u.includes("/rest/v1/clients?")) return new Response(JSON.stringify({ message: "upstream timeout" }), { status: 504 });
    if (u.endsWith("/rest/v1/rpc/night_fail")) { fails.push(JSON.parse(String(init.body))); return new Response("null"); }
    return new Response("[]");
  }) as typeof globalThis.fetch;
  const h = night({ env: env(), fetch });
  const r = await h(new Request("https://fn.example", { method: "POST", headers: { Authorization: "Bearer service" }, body: JSON.stringify({ action: "client", firm_id: "11111111-1111-4111-8111-111111111111", client_id: "c1" }) }));
  const j = await r.json();
  eq([j.ok, fails.length, fails[0] && fails[0].p_status], [false, 1, "failed"], "closed");
});
