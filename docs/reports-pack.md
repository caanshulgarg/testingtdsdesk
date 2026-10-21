# Reports pack: Board's Report, Independent Auditor's Report, management representation letter (ROUND 100)

Model (pure, node-testable): `app/src/lib/reports/` — `law.js` (every limit as data, with the date it takes effect),
`facts.js` (figures from `FinSt.build` and the day book), `applicability.js`, `questionnaire.js`, `board.js`, `audit.js`,
`mrl.js`, `doc.js` (the document model and its HTML), `docx.js` (Word), `zip.js`; `index.js` exports `pack({d, dR,
vouchers, store, fy})`. Files: `app/src/lib/reportsExport.js` (`window.ReportsPack`). Screen: the "Reports" menu of the
Financial statements page (`app/src/screens/books/fin/Reports.jsx`, a lazy chunk; the page keeps its seven tabs).
Tests: `tests/run_reports_pack.js`, `tests/run_reports_pack_ui.py`.

## Limits (law.js)
- Small company (s.2(85)): paid-up ≤ ₹10 crore and turnover of the preceding year ≤ ₹100 crore from 1-Dec-2025 (owner
  confirmed 20-Oct-2026 for 31-Mar-2026 accounts); ₹4 cr / ₹40 cr before; never public, holding, subsidiary, s.8 or
  under a special Act. The earlier limits' result is shown beside in a year of change.
- CARO 2020 para 1(2): banking, insurance, s.8, OPC, small company excluded; private company exempt when capital +
  reserves ≤ ₹1 cr, bank / FI borrowings ≤ ₹1 cr at any time, revenue ≤ ₹10 cr, and not a holding company or a
  subsidiary of a public company. No CARO change for FY 2025-26.
- IFC (s.143(3)(i)): OPC, small company, or private company with turnover < ₹50 cr and borrowings < ₹25 cr and no
  filing default are exempt.
- CSR (s.135): preceding year net worth ≥ ₹500 cr, turnover ≥ ₹1,000 cr or net profit ≥ ₹5 cr; 2% of the 3-year average.
- Also: MR-3, committees, vigil, evaluation, independent directors, internal audit (s.138), cost records, WC limits.

## Answers
`b.fs.reports[fy] = {a: {key: value}, at}` (synced with the books). Resolution: given this year → last year's (not the
one-year answers, `carry: false`; the AGM number counted on) → from the books / Details (`pre`) → default. Figures FinCom
reads from the books are never carried. A required, applicable answer still blank is marked in the text and counted.

## Downloads
- Word: `docx` 9.5.1 (npm, `dist/index.iife.js` unchanged) served as `assets/docx.iife.js`, sha256
  `bb2908d72ffd8a3d896b455563733d3a2e708e1384a5140e05b3c6dd0b2f676d`, MIT (`assets/docx-LICENSE.txt`), loaded on first use.
- PDF: the print view (A4), like FinPdf. "Download all as one PDF": the statements' pages then the three reports.
- "Download all as a zip": the statements' Excel workbook and the three Word files (no PDF is made in the browser).
