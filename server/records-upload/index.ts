// records-upload: a large save from the browser, gzipped, passed on to PostgREST as the person (handler.ts).
// Deployed as uploaded files: index.ts, handler.ts, ../_shared/cors.ts; verify_jwt ON (only a signed-in person's token
// gets in; PostgREST then applies that person's row level security). Uses SUPABASE_URL and SUPABASE_ANON_KEY only.
// Rollback: delete the function; the app then sends every save uncompressed, as before (app/src/lib/gzUpload.js).
import { corsFor } from "../_shared/cors.ts";
import { makeHandler } from "./handler.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(makeHandler({
  restUrl: URL_.replace(/\/+$/, "") + "/rest/v1",
  anonKey: ANON,
  fetch: (i, o) => fetch(i, o),
  cors: (req) => corsFor(req),
}));
