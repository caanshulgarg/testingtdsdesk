// next-bank-overlap (08-Nov-2026): a bank statement that overlaps one already here (BankOverlap, src/js/96, marked
// @react-lazy): kept out of legacy.js (its size budget, tests/run_stability.py), loaded with the Bank screen and, for an
// upload from anywhere else (the inbox, the assistant, a drop), by uploadStatements through window.loadBankOverlap (main.jsx)
import "../../../src/js/96-bank-overlap.js";
export const BankOverlap = globalThis.BankOverlap;
