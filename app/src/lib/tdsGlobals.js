// The TDS screens' own program, kept out of legacy.js (its size budget, tests/run_stability.py) and loaded with them
// (next-challan-match): the one challan matcher's rules, shared with the tds-challan-match function
// (server/_shared/tdsmatch.js, an ES module here, its names put on globalThis as the one-file site has them), TDSMatch
// (src/js/86) and the deductees' PANs (PANCheck, TDSPanFix: src/js/87), each marked @react-lazy (build.py lazy_files).
import * as TM from "../../../server/_shared/tdsmatch.js";
Object.assign(globalThis, TM);
import "../../../src/js/86-tds-match.js";
import "../../../src/js/87-pan-check.js";
import "../../../src/js/88-tds-added.js";
import "../../../src/js/89-tds-adjust.js";
