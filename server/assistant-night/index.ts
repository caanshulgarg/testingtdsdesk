// assistant-night (deployed name): Daily Check's night check for one client. The handler is handler.ts. verify_jwt off: the
// handler checks the timer's x-cron-key or the service role itself. Not deployed yet (migration 206 first).
import { handler } from "./handler.ts";

if (import.meta.main) Deno.serve(handler({ env: (k) => Deno.env.get(k), fetch: (i, o) => fetch(i, o) }));
