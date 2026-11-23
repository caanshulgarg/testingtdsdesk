// next-fix-audit-bank (22-Nov-2026): the bank lines' checks (src/js/22-bank-guards.js, marked @react-lazy): kept out of
// legacy.js (its size budget, tests/run_stability.py) and loaded with the first file, since a posting, a client's bank
// page opened from anywhere and an upload from the inbox or the assistant all use them
import "../../../src/js/22-bank-guards.js";
