// tds-challan-match (deployed name): which challan pays which TDS deduction, step g of the one matcher (next-challan-match,
// 17-Oct-2026): one Claude call for what the rules a to f left. The handler is handler.ts; this file serves it with the
// official Anthropic SDK (the version Ask FinCom and gst-2b-match use). verify_jwt off: the handler checks the user's token
// itself.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { AiClient } from "./match.ts";
import { handler } from "./handler.ts";

Deno.serve(handler({
  env: (k) => Deno.env.get(k),
  fetch: (i, o) => fetch(i, o),
  anthropic: (key) => new Anthropic({ apiKey: key, maxRetries: 1, timeout: 120_000 }) as unknown as AiClient,
}));
