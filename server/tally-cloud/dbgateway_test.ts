// deno test --allow-read server/tally-cloud/dbgateway_test.ts (run by tests/run_devlookup_gateway.py, in CI) - the
// database's gateway error pages (FINCOM-CLOUD-STAGING-8, -B, -C, -9; 16-18 Nov 2026): while Postgres restarts, the
// gateway in front of Supabase answers a whole HTML page (Cloudflare's 520-525) and supabase-js hands it over as the
// error's message. dbgateway.js turns it into one short line, says which errors are worth one more try (reads only),
// and the Sentry report of two such pages (each with its own Ray ID and time) is the same text, so it is sent once.
// Made-up pages and hosts only.
import { dbErrorShort, isTransientDb, readRetry, dbReport, UNREACHABLE } from "./dbgateway.js";
import { cloudReporter } from "../_shared/sentry.ts";

function assert(c: unknown, w: string) { if (!c) throw new Error(w); }
const page = (code: number, words: string, ray: string, at: string) => `<!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<html class="no-js" lang="en-US"> <!--<![endif]-->
<head>
<title>madeupref.supabase.co | ${code}: ${words}</title>
<meta charset="UTF-8" />
</head>
<body>
<div id="cf-wrapper"><h1><span class="cf-error-type">Error</span> <span class="cf-error-code">${code}</span></h1>
<span class="cf-footer-item">Cloudflare Ray ID: <strong>${ray}</strong></span> <span>${at}</span>
<h2>What happened?</h2><p>The web server reported a ${words.toLowerCase()} error.</p>
<p>Please try again in a few minutes. Browser Working, Cloudflare Working, Host Error. Click here for more information.</p>
</div></body></html>`;
const P522a = page(522, "Connection timed out", "9a1b2c3d4e5f6071", "2026-11-18 06:00:50 UTC");
const P522b = page(522, "Connection timed out", "0f0e0d0c0b0a0918", "2026-11-18 06:00:58 UTC");
const P521 = page(521, "Web server is down", "1234567890abcdef", "2026-11-17 13:33:02 UTC");
const P525 = page(525, "SSL handshake failed", "fedcba0987654321", "2026-11-17 12:41:18 UTC");
const P520 = page(520, "Web server is returning an unknown error", "aaaabbbbccccdddd", "2026-11-17 13:03:30 UTC");

Deno.test("an HTML gateway page becomes one short line, the same for every Ray ID and time", () => {
  for (const [p, code, words] of [[P522a, 522, "Connection timed out"], [P521, 521, "Web server is down"], [P525, 525, "SSL handshake failed"], [P520, 520, "Web server is returning an unknown error"]] as const) {
    const s = dbErrorShort({ message: p }, code);
    assert(s.message === `the database gateway answered ${code}: ${words}`, "short words for " + code + ": " + s.message);
    assert(s.code === "GW" + code && s.status === code && s.gateway === true && s.transient === true, "code, status, gateway, transient for " + code + ": " + JSON.stringify(s));
    assert(!/[<>]|Ray|cloudflare|madeupref/i.test(s.message), "nothing of the page beyond its title: " + s.message);
  }
  assert(dbErrorShort({ message: P522a }, 522).message === dbErrorShort({ message: P522b }, 522).message, "two 522 pages: the same words");
  // the status not passed (an error thrown with the page as its message): read from the page's title
  const t = dbErrorShort(new Error(P521));
  assert(t.status === 521 && t.message === "the database gateway answered 521: Web server is down", "status from the title: " + JSON.stringify(t));
  // a page with no title: its status, plain words
  const n = dbErrorShort({ message: "<html><body>Bad gateway</body></html>" }, 502);
  assert(n.message === "the database gateway answered 502" && n.transient, "a page without a title: " + JSON.stringify(n));
  // a very long page: never more than 200 characters
  const long = dbErrorShort({ message: "<html><head><title>" + "x".repeat(5000) + "</title></head></html>" }, 520);
  assert(long.message.length <= 200, "short: " + long.message.length);
});

Deno.test("an ordinary database error is left as it is; only a lost connection is worth one more try", () => {
  const pg = { code: "57014", message: "canceling statement due to statement timeout" };
  const s = dbErrorShort(pg, 500);
  assert(s === pg, "an ordinary error object is handed back as it is");
  assert(!isTransientDb(pg, 500), "a statement timeout is not tried again (it would add to the load that caused it)");
  assert(!isTransientDb({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, 406), "two rows: not tried again");
  assert(!isTransientDb({ code: "42501", message: "permission denied for table tally_devices" }, 403), "permission: not tried again");
  for (const [e, st] of [[{ message: P522a }, 522], [{ message: "TypeError: fetch failed", details: "" }, 0], [{ code: "PGRST000", message: "Could not connect with the database" }, 503],
    [{ code: "PGRST001", message: "Database client error. Retrying the connection." }, 503], [{ code: "57P01", message: "terminating connection due to administrator command" }, 503],
    [{ code: "57P03", message: "the database system is not accepting connections" }, 503], [{ code: "08006", message: "connection terminated due to connection timeout" }, 500],
    [{ message: "error sending request: connection reset by peer" }, 0], [{ message: "" }, 504]] as const) {
    assert(isTransientDb(e, st), "worth one more try: " + st + " " + String((e as any).message).slice(0, 60));
  }
  assert(!isTransientDb(null, 200) && !isTransientDb(undefined, 0), "no error: nothing to try again");
});

Deno.test("readRetry: one more try after a short wait, only for a lost connection, never past the time allowed", async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => { waits.push(ms); };
  let n = 0;
  const flaky = async () => (++n === 1 ? { data: null, error: { message: P522a }, status: 522 } : { data: { id: "d1" }, error: null, status: 200 });
  const r1 = await readRetry(flaky, { sleep });
  assert(n === 2 && r1.data?.id === "d1" && !r1.error && r1.tries === 2, "a 522 then the row: the row (" + n + " " + JSON.stringify(r1) + ")");
  assert(waits.length === 1 && waits[0] >= 200 && waits[0] <= 400, "one short wait before the second try: " + waits);
  n = 0; waits.length = 0;
  const down = async () => { n++; return { data: null, error: { message: P521 }, status: 521 }; };
  const r2 = await readRetry(down, { sleep });
  assert(n === 2 && r2.tries === 2 && r2.error?.message === "the database gateway answered 521: Web server is down" && r2.error?.code === "GW521", "down: two tries, then the short error (" + n + " " + JSON.stringify(r2.error) + ")");
  n = 0; waits.length = 0;
  const timeout = async () => { n++; return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" }, status: 500 }; };
  const r3 = await readRetry(timeout, { sleep });
  assert(n === 1 && waits.length === 0 && r3.error?.code === "57014", "a statement timeout: one try only (" + n + ")");
  n = 0; waits.length = 0;
  const ok = async () => { n++; return { data: null, error: null, status: 200 }; };
  const r4 = await readRetry(ok, { sleep });
  assert(n === 1 && !r4.error && r4.data === null && r4.tries === 1, "no row (not an error): one try");
  // the first try took longer than the time allowed (a 522 after the gateway's own long wait): not tried again
  n = 0; waits.length = 0;
  let clock = 0;
  const slow = async () => { n++; clock += 8000; return { data: null, error: { message: P522a }, status: 522 }; };
  const r5 = await readRetry(slow, { sleep, now: () => clock, maxMs: 5000 });
  assert(n === 1 && waits.length === 0 && r5.error?.code === "GW522", "a slow 522: one try only, the short error (" + n + ")");
  // a thrown error (fetch itself failed) is an answer with that error, tried again once
  n = 0; waits.length = 0;
  const throws = async () => { n++; if (n === 1) throw new TypeError("fetch failed"); return { data: { id: "d2" }, error: null, status: 200 }; };
  const r6 = await readRetry(throws, { sleep });
  assert(n === 2 && r6.data?.id === "d2", "a thrown fetch failure: tried again (" + n + ")");
});

Deno.test("Sentry: gateway pages a few seconds apart (other Ray IDs, other 52x) are one fixed short report, its status a tag", async () => {
  const sent: string[] = [];
  const later: Promise<unknown>[] = [];
  const r = cloudReporter({
    release: "tally-ingest-2.4.0",
    env: (k: string) => ({ SUPABASE_URL: "https://qbocskaiewaxqcvaunzc.supabase.co" } as Record<string, string>)[k],
    fetch: (async (_u: string, init: RequestInit) => { sent.push(String(init.body)); return new Response("{}"); }) as unknown as typeof fetch,
    waitUntil: (p: Promise<unknown>) => { later.push(p); },
  });
  const a = dbReport({ message: P522a }), b = dbReport({ message: P522b }), c = dbReport(new Error(P525));
  assert(a && b && c, "a gateway page is reported as such");
  assert(dbReport({ code: "57014", message: "canceling statement due to statement timeout" }) === null && dbReport(new Error("x is not a function")) === null, "anything else: as before (null)");
  r.report("device_lookup", a!.err, { tags: a!.tags });
  r.report("device_lookup", b!.err, { tags: b!.tags });
  r.report("device_lookup", c!.err, { tags: c!.tags });
  await Promise.all(later);
  assert(sent.length === 1, "one report for the three pages within a minute (" + sent.length + ")");
  const ev = JSON.parse(sent[0].split("\n").filter(Boolean)[2]);
  const v = String(ev.exception?.values?.[0]?.value || "");
  assert(v === UNREACHABLE, "the report's words are the fixed short line, kept whole by the scrubber: " + v);
  assert(ev.tags?.status === "522" && ev.tags?.db_code === "GW522" && ev.tags?.where === "device_lookup", "the status and code as tags: " + JSON.stringify(ev.tags));
});
