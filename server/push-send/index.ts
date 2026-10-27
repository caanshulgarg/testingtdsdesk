// push-send (deployed name; branch next-mobile): the handler is handler.ts. verify_jwt off: the handler lets the service
// role only. Not deployed yet (the mobile plan's "push and server" phase).
import { handler } from "./handler.ts";

export function main() {
  Deno.serve(handler({ env: (k) => Deno.env.get(k), fetch: (i, o) => fetch(i, o) }));
}
if (import.meta.main) main();
