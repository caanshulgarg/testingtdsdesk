// fast-firstopen (25-Oct-2026): a client's books brought into this browser for the first time (FirstOpen, src/js/95,
// marked @react-lazy): kept out of legacy.js and the first file (their size budgets, tests/run_stability.py) and loaded
// by TCloud.load (src/js/49) through window.loadFirstOpen (main.jsx) only when such books are opened. A month of day files
// from FinCom's server is read with the server's own rule (server/tally-cloud/monthpack.js)
import "../../../src/js/95-first-open.js";
import { unpackMonth } from "../../../server/tally-cloud/monthpack.js";
export const FirstOpen = globalThis.FirstOpen;
FirstOpen.unpack = unpackMonth;
