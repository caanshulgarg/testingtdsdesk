// gst-run (deployed name; next-cloud-gst): a client's GSTR-3B worked out in the cloud by the app's own engine, a month or
// two per run. The handler is handler.ts. verify_jwt off: the handler checks the member's token, the service key or the
// timer's x-cron-key itself. Not deployed yet (migrations 151 and 153 come first). A run started by another (the next
// background run) is kept going after the reply by EdgeRuntime.waitUntil.
import { handler } from "./handler.ts";

export function main() {
  const rt = (globalThis as any).EdgeRuntime;
  Deno.serve(handler({ env: (k) => Deno.env.get(k), fetch: (i, o) => fetch(i, o),
    later: (p) => { const q = p.catch(() => {}); if (rt && typeof rt.waitUntil === "function") rt.waitUntil(q); } }));
}
if (import.meta.main) main();
