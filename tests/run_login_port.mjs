// node tests/run_login_port.mjs '<json>' - the Tally page's per-login port (app/src/lib/tallyPort.js freePort, which
// connectSteps.js ownPort returns) for each case [login, [ports seen]], printed as a JSON list. FinCom Bridge 2.5.5's
// loginport255_test.go runs it and compares the bridge's port with the page's (made-up login names only).
import { freePort } from "../app/src/lib/tallyPort.js";

const cases = JSON.parse(process.argv[2] || "[]");
console.log(JSON.stringify(cases.map(([login, seen]) => freePort(new Set(seen || []), login))));
