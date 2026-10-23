// node tests/run_gateway_errors.js - the gateway says every failure as one kind (review of 02-Oct-2026: a bill not
// read only said "The Claude API refused the request"). Loads server/security/functions/gateway/classify.ts itself.
const path = require("path"), fs = require("fs");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  const G = await import(path.join(__dirname, "..", "server/security/functions/gateway/classify.ts"));
  const cases = [
    // [status, error.type, message, kind]
    [402, "billing_error", "Billing issue", "no_credit"],
    [400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.", "no_credit"],
    [429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit", "rate_limit"],
    [529, "overloaded_error", "Overloaded", "overloaded"],
    [503, "", "", "overloaded"],
    [413, "request_too_large", "Request exceeds the maximum allowed number of bytes.", "too_large"],
    [400, "invalid_request_error", "messages.0.content.0.image.source.base64: image exceeds 5 MB maximum: 6291456 bytes > 5242880 bytes", "too_large"],
    [400, "invalid_request_error", "The PDF specified is password protected.", "pdf_password"],
    [400, "invalid_request_error", "The document is encrypted and cannot be read.", "pdf_password"],
    [400, "invalid_request_error", "messages.0.content.0.image.source.media_type: Input should be 'image/jpeg', 'image/png', 'image/gif' or 'image/webp'", "unsupported_type"],
    [400, "invalid_request_error", "Could not process image", "unsupported_type"],
    [400, "invalid_request_error", "Unsupported document type", "unsupported_type"],
    [401, "authentication_error", "invalid x-api-key", "bad_key"],
    [403, "permission_error", "Your API key does not have permission to use the specified resource.", "bad_key"],
    [404, "not_found_error", "model: claude-sonnet-9", "bad_model"],
    [500, "api_error", "Internal server error", "other"],
    [400, "invalid_request_error", "messages: at least one message is required", "other"],
  ];
  for (const [st, t, m, want] of cases) {
    const got = G.classify(st, t, m);
    ok(got === want, st + " " + (t || "-") + " “" + m.slice(0, 60) + "” -> " + want + (got === want ? "" : " (got " + got + ")"));
  }
  ok(G.classify(0, "", "") === "other", "nothing known -> other");
  ok(G.KINDS.length === 12 && ["no_credit", "rate_limit", "overloaded", "too_large", "pdf_password", "unsupported_type", "timed_out", "declined", "bad_key", "bad_model", "not_reached", "other"].every((k) => G.KINDS.includes(k)), "the twelve kinds");
  // a 200 the model declined
  const d = G.declined({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" }, content: [] });
  ok(d && d.kind === "declined" && d.category === "cyber", "200 with stop_reason refusal -> declined, with its category (" + JSON.stringify(d) + ")");
  ok(G.declined({ stop_reason: "end_turn", content: [] }) === null, "200 end_turn is not a failure");
  // the gateway's own words
  ok(/claude-sonnet-4-6/.test(G.errorText("bad_model", { model: "claude-sonnet-4-6" })), "bad_model names the model refused: " + G.errorText("bad_model", { model: "claude-sonnet-4-6" }));
  ok(/25 MB/.test(G.errorText("too_large", { limitMb: 25 })), "too_large says the limit");
  ok(/\(cyber\)/.test(G.errorText("declined", { category: "cyber" })), "declined says its category");
  ok(G.KINDS.every((k) => G.errorText(k).length > 10), "every kind has words");
  // the HTTP status the app sees: never a provider 401/403 (the app would sign in again)
  ok(G.replyStatus("bad_key", 401) === 502 && G.replyStatus("bad_key", 403) === 502, "a provider 401/403 answers 502");
  ok(G.replyStatus("rate_limit", 429) === 429 && G.replyStatus("overloaded", 529) === 529 && G.replyStatus("timed_out", 0) === 504 && G.replyStatus("declined", 200) === 422 && G.replyStatus("not_reached", 0) === 502, "429, 529, 504 (timed out), 422 (declined), 502 (not reached)");
  // the gateway uses all of it, logs one line per failure, times out at 120 s and reads the file name
  const src = fs.readFileSync(path.join(__dirname, "..", "server/security/functions/gateway/index.ts"), "utf8");
  ok(/from "\.\/classify\.ts"/.test(src) && /evt: "gateway_fail"/.test(src) && /request_id/.test(src) && /TIMEOUT_MS = 120_000/.test(src) && /body\.file/.test(src) && /\.slice\(0, 200\)/.test(src), "index.ts: classify.ts, one gateway_fail line, 120 s timeout, body.file (200 chars)");
  ok(!/console\.log\([^)]*(payload|messages|key\b|prompt)/.test(src), "the log line never holds the payload, messages, prompt or key");
  ok((src.match(/await refund\(\)/g) || []).length >= 6, "every failure after the charge is refunded");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
