// fincom-call (deployed name): calls inside FinCom (server/video-calls/handler.ts says what it does). Deployed as a
// one-line index.ts that imports this file from GitHub at a pinned commit and calls main(), as fincom-transcribe is;
// verify_jwt off (it checks the member's token, or the guest's signed token, itself).
import { handler } from "./handler.ts";

export function main() {
  Deno.serve(handler({ env: (k) => Deno.env.get(k), fetch: (i, o) => fetch(i, o) }));
}
if (import.meta.main) main();
