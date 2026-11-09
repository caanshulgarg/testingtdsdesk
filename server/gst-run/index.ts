// gst-run (deployed name; next-cloud-gst): a client's GSTR-3B worked out in the cloud by the app's own engine. The handler
// is handler.ts. verify_jwt off: the handler checks the member's token itself. Not deployed yet (migrations 151 and 153
// come first).
import { handler } from "./handler.ts";

export function main() {
  Deno.serve(handler({ env: (k) => Deno.env.get(k), fetch: (i, o) => fetch(i, o) }));
}
if (import.meta.main) main();
