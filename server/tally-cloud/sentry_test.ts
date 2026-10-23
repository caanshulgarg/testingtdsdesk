// deno test server/tally-cloud/sentry_test.ts (run by tests/run_sentry_cloud.mjs, in CI) - tally-ingest's reports to
// Sentry (server/_shared/sentry.ts through server/_shared/sentry-scrub.js): the owner's conditions of 08-Oct-2026
// (docs/sentry.md). Made-up errors carrying GSTINs, PANs, amounts, names, narrations, Tally XML, emails, ids in URLs and
// a firm's id go in; the envelope that would be posted to Sentry may carry none of them, only an "event" item, only the
// allowed fields, the firm as a hash, and nothing at all off the staging database.
import { cloudReporter, parseStack } from "../_shared/sentry.ts";

const FX = JSON.parse(await Deno.readTextFile(new URL("../../tests/fixtures/sentry-sensitive.json", import.meta.url)));
const FIRM = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
// the staging database; any other (the live one, another project) is not staging
const STAGING = "https://qbocskaiewaxqcvaunzc.supabase.co", OTHER = "https://abcdefghijklmnopqrst.supabase.co";
const leaks = (s: string) => [...FX.strings, ...FX.tokens, FIRM, "6f1c2d3e"].filter((t: string) => s.includes(t));
function assert(c: unknown, w: string) { if (!c) throw new Error(w); }

type Sent = { url: string, headers: Record<string, string>, body: string };
function stand(env: Record<string, string>) {
  const sent: Sent[] = [];
  const later: Promise<unknown>[] = [];
  const r = cloudReporter({
    release: "tally-ingest-2.4.0",
    env: (k: string) => env[k],
    fetch: (async (url: string, init: RequestInit) => { sent.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch,
    waitUntil: (p: Promise<unknown>) => { later.push(p); },
  });
  return { r, sent, settle: async () => { await Promise.all(later); } };
}
const items = (body: string) => body.split("\n").filter(Boolean).map((l) => JSON.parse(l));

Deno.test("every report: no business data, only an event item, only the allowed fields, the firm as a hash", async () => {
  const { r, sent, settle } = stand({ SUPABASE_URL: STAGING });
  // an Error with a stack from a user's folder, a database error object, plain strings, a thrown non-Error
  const e1 = new Error(FX.texts[0]);
  e1.stack = "Error: " + FX.texts[0] + "\n    at postOne (file:///home/priya/fincom/server/tally-cloud/index.ts:2994:11)\n    at Alpha_Traders (C:\\Users\\priya\\x\\Alpha_Traders_Invoice_AB-101.pdf:1:1)\n    at async Server.<anonymous> (ext:deno_http/00_serve.ts:12:3)";
  r.report("tally_ingest", e1, { kind: "posts_update", firm: FIRM });
  r.report("ledger_list", { code: "23505", message: FX.texts[7], details: "Key (name)=(ALPHA TRADERS) already exists", hint: FX.texts[3] }, { kind: "ledger_list", firm: FIRM });
  for (const t of FX.texts) r.report("beat", t, { kind: "beat", firm: FIRM });
  r.report("upload", { party: "ALPHA TRADERS", gstin: "09AANFG3202D1ZR", toString() { return FX.texts[1]; } }, { kind: "Upload of ALPHA TRADERS", firm: "ALPHA TRADERS" });
  await settle();
  assert(sent.length >= 3, "reports sent (" + sent.length + ")");
  for (const s of sent) {
    const all = s.url + JSON.stringify(s.headers) + s.body;
    const lk = leaks(all);
    assert(!lk.length, "no business data in what is sent: " + lk.join(", ") + "\n" + s.body.slice(0, 2000));
    assert(s.url === "https://o4512221111320576.ingest.us.sentry.io/api/4512221235118080/envelope/", "posted to tally-ingest's project, no query string: " + s.url);
    const [head, itemHead, ev, ...more] = items(s.body);
    assert(!more.length && itemHead.type === "event", "one item, of type event: " + JSON.stringify(itemHead));
    assert(Object.keys(head).every((k) => ["event_id", "sent_at", "dsn", "sdk"].includes(k)), "envelope header: " + Object.keys(head));
    const allowed = ["event_id", "timestamp", "platform", "level", "release", "environment", "exception", "message", "tags", "contexts", "sdk"];
    assert(Object.keys(ev).every((k) => allowed.includes(k)), "event fields: " + Object.keys(ev));
    assert(ev.environment === "staging" && ev.release === "tally-ingest-2.4.0", "staging, the release");
    assert(Object.keys(ev.tags || {}).every((k) => ["where", "kind", "firm"].includes(k)), "tags: " + JSON.stringify(ev.tags));
    if (ev.tags.firm) assert(/^[0-9a-f]{12}$/.test(ev.tags.firm), "the firm only as a hash: " + ev.tags.firm);
    assert(!("request" in ev) && !("user" in ev) && !("extra" in ev) && !("server_name" in ev), "no request, user, extra or server name");
    for (const v of ev.exception?.values || []) for (const f of v.stacktrace?.frames || []) assert(!/priya|Users|home/.test(f.filename), "no user's folder in a frame: " + f.filename);
  }
  const first = sent.map((s) => items(s.body)[2]).find((e) => e.tags.where === "tally_ingest");
  assert(first.tags.kind === "posts_update" && first.tags.where === "tally_ingest", "where and the request kind kept: " + JSON.stringify(first.tags));
  assert(first.exception.values[0].stacktrace.frames.some((f: { filename: string, function: string }) => f.filename === "tally-cloud/index.ts" && f.function === "postOne"), "the code location kept");
  const up = sent.map((s) => items(s.body)[2]).find((e) => e.tags.where === "upload");
  assert(up && !up.tags.kind && !up.tags.firm, "a kind or firm that is not one is dropped");
});

Deno.test("off the staging database, or switched off: nothing sent", async () => {
  for (const env of [{ SUPABASE_URL: OTHER }, { SUPABASE_URL: STAGING, FINCOM_SENTRY: "off" }, {}, { SUPABASE_URL: "https://qbocskaiewaxqcvaunzc.evil.example" }]) {
    const { r, sent, settle } = stand(env as Record<string, string>);
    r.report("tally_ingest", new Error("x"), {});
    await settle();
    assert(!sent.length && !r.on, "nothing sent for " + JSON.stringify(env));
  }
});

Deno.test("the handler wrapped: an unhandled error is reported and answered 500 without its words", async () => {
  const { r, sent, settle } = stand({ SUPABASE_URL: STAGING });
  const h = r.wrap(async (_req: Request) => { throw new Error(FX.texts[3]); });
  const res = await h(new Request("https://x.example/functions/v1/tally-ingest?client=cmufksrrqjub2g", { method: "POST", body: JSON.stringify({ kind: "beat", party: "ALPHA TRADERS" }) }));
  await settle();
  assert(res.status === 500, "answered 500");
  const t = await res.text();
  assert(!leaks(t).length, "the answer carries no business data: " + t);
  assert(sent.length === 1 && !leaks(sent[0].body).length && items(sent[0].body)[2].tags.where === "unhandled", "reported once, as unhandled");
});

Deno.test("a flood is cut: the same error at most once a minute, at most 30 reports a minute", async () => {
  const { r, sent, settle } = stand({ SUPABASE_URL: STAGING });
  for (let i = 0; i < 50; i++) r.report("beat", new Error("the same request failed"), {});
  for (let i = 0; i < 50; i++) r.report("beat", new Error("the request failed at step " + i), {});
  await settle();
  assert(sent.length <= 30, "at most 30 a minute (" + sent.length + ")");
  assert(sent.filter((s) => s.body.includes("the same request failed")).length === 1, "the same error once");
});

Deno.test("parseStack: V8 frames, oldest first, no folders", () => {
  const f = parseStack("Error: x\n    at a (file:///var/tmp/sb-compile-edge-runtime/tally-cloud/index.ts:10:5)\n    at file:///home/priya/x/parse.js:3:1\n    at new Foo (ext:core/01.ts:1:2)");
  assert(f.length === 3 && f[2].function === "a" && f[2].lineno === 10 && f[2].colno === 5 && f[0].function === "new Foo", JSON.stringify(f));
});
