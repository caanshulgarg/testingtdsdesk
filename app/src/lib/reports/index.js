// The reports pack (ROUND 100): the Board's Report, the Independent Auditor's Report and the management representation
// letter, built from the financial statements (FinSt) and the questionnaire. Pure: node-testable (tests/run_reports_pack.js).
//
//   pack({d, dR, vouchers, store, fy})  -> {c (context), board, audit, mrl, docs: [board, audit, mrl], missing (questions)}
import { makeContext } from "./context.js";
import { boardReport } from "./board.js";
import { auditorReport } from "./audit.js";
import { mrl } from "./mrl.js";
import { missing } from "./questionnaire.js";

export function pack(o) {
  const c = makeContext(o);
  const board = boardReport(c), audit = auditorReport(c), letter = mrl(c);
  return { c, board, audit, mrl: letter, docs: [board, audit, letter], missing: missing(c.R, c.ap, c.f) };
}
export { makeContext } from "./context.js";
export { applicability, smallTest } from "./applicability.js";
export { facts, relatedTx, longDate } from "./facts.js";
export { QUESTIONS, SECTIONS, Q, resolve, missing, setAnswer, shown, isMissing } from "./questionnaire.js";
export { LAW, SMALL, classFromCin } from "./law.js";
export { docHtml, PRINT_CSS, runsText, money } from "./doc.js";
export { boardReport } from "./board.js";
export { auditorReport } from "./audit.js";
export { mrl } from "./mrl.js";
