// assistant-send (deployed name): the firm's owner emails a client's ticked questions (Daily Check). The handler is
// handler.ts. Not deployed yet (migration 206 first). Secrets by name: RESEND_API_KEY, ASSISTANT_MAIL_FROM,
// ASSISTANT_MAIL_LIVE (left unset on staging: test mode).
import { handler } from "./handler.ts";

if (import.meta.main) Deno.serve(handler({ env: (k) => Deno.env.get(k), fetch: (i, o) => fetch(i, o) }));
