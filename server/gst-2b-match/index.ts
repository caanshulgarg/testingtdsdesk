// gst-2b-match (deployed name): GSTR-2B matched against the books by itself, round 72b. The handler is handler.ts; this
// file serves it with the official Anthropic SDK (the version Ask FinCom uses). verify_jwt off: the handler checks the
// user's token itself, and the platform's own callers (gst-taxpro with the service key, the timer with x-cron-key).
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { AiClient } from "./match.ts";
import { handler } from "./handler.ts";

Deno.serve(handler({
  env: (k) => Deno.env.get(k),
  fetch: (i, o) => fetch(i, o),
  anthropic: (key) => new Anthropic({ apiKey: key, maxRetries: 1, timeout: 120_000 }) as unknown as AiClient,
}));
