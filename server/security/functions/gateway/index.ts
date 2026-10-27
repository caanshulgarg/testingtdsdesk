// TDS Desk gateway (deployed as "gateway"): firms use Claude and Google Vision through this, never holding the keys.
// What it does is in handler.ts (who may ask, the charge, the provider call) and policy.ts (the models, sizes and price
// the server allows, security review 27-Oct-2026 F6). Deploy all of index.ts, handler.ts, policy.ts, classify.ts and
// cors.ts (with ../_shared/cors.ts).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handler } from "./handler.ts";

Deno.serve(handler({ env: (k) => Deno.env.get(k), fetch: (i, o) => fetch(i, o), client: (u, k, o) => createClient(u, k, o) }));
