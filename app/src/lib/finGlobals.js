// The Financial statements page's own program, kept out of legacy.js (its size budget, tests/run_stability.py) and loaded
// with it (ROUND 99): FinSt (src/js/88), the model of the statements in the owner's audit format, marked @react-lazy
// (build.py lazy_files). A screen that shows them imports this file.
import "../../../src/js/88-fin-statements.js";
// last year's balance sheet, uploaded (FinPyBs: read, codes, the PY column and the suggestions), with the page too
import "../../../src/js/88-fin-pybs.js";
// FinCom's balance sheet matched with the audited one (FinRecon: the differences, the proposals, approving them)
import "../../../src/js/88-fin-recon.js";
