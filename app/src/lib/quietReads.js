// next-tally-table (04-Nov-2026): the Tally page's own reads (the summary, the checks, the held lines, the opening balances)
// start from the page's drawing, each at most every 20 s to 5 min. The rows are now worked out after the drawing (lib/
// tallySimple.js rowsFor): the drawing still starts the reads that are due, at its moment, and the working-out starts
// none (QUIET.on), so the page reads exactly as often as before (tests/run_tally_poll.py)
export const QUIET = { on: 0 };
