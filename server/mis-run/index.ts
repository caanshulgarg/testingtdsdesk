// mis-run (deployed name; ROUND 105 B6): My MIS on a schedule. The handler is handler.ts; this file serves it with ExcelJS
// from npm. verify_jwt off: the handler checks the user's token itself, and the database's timer with x-cron-key.
import { handler } from "./handler.ts";

export function main() {
  Deno.serve(handler({
    env: (k) => Deno.env.get(k),
    fetch: (i, o) => fetch(i, o),
    excel: async () => (await import("npm:exceljs@4.4.0")).default,
  }));
}
if (import.meta.main) main();
