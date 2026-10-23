// One rule for a Tally ledger, group or party name, everywhere FinCom reads one (finding 4, 02-Oct-2026).
// Plain JavaScript with no imports, used as it is by:
//   - the cloud reader (server/tally-cloud/parse.js, under Deno in tally-ingest, and the Node tests): import
//   - the app: build.py puts this file, without its export line, at the head of the one-file app; the helpers of
//     src/js/00-core.js (ledEnt, ledNm, ledClean, ledKey) and Books.unesc (src/js/04) call these functions
// tests/run_names_shared.js feeds the same names to both and checks they come out the same.
//
// namesClean(name): the name as it is kept and shown. Entities decoded (also when Tally escaped them twice:
//   "&amp;#13;&amp;#10;"), each run of line breaks (CR, LF, raw or as &#13; &#10;) with the spaces and tabs around it
//   one space, the ends trimmed. A control character, or half of a UTF-16 pair (which the database cannot keep), is a
//   space. Spaces inside the name stay as they are: Tally keeps "Arktos  Control & Instruments"
//   with two, and the name FinCom posts must be Tally's own.
// namesKey(name): the name for matching only: namesClean, every run of white space one space, lower case. So
//   "A  B", "A B&#13;&#10;" and "a b" meet. Nothing else is made equal ("Pvt. Ltd" and "Pvt Ltd" stay two keys).
// namesBreaks(name): the line-break rule alone (no entities decoded), as the database's tally_nm.

function namesDecode(s){
  return String(s == null ? "" : s)
    .replace(/&(amp;)?#(x[0-9a-f]+|\d+);/gi, (m0, a, n) => {
      const c = /^x/i.test(n) ? parseInt(n.slice(1), 16) : parseInt(n, 10);
      return c === 13 || c === 10 ? "\n" : c === 9 || c === 160 ? " " : c >= 32 && c < 0x110000 && !(c >= 0xD800 && c <= 0xDFFF) ? String.fromCodePoint(c) : " ";
    })
    .replace(/&(amp;)?(amp|lt|gt|quot|apos|nbsp);/gi, (m0, a, n) => ({amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " "})[n.toLowerCase()]);
}
function namesBreaks(n){ return String(n == null ? "" : n).replace(/[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*/g, " ").trim(); }
function namesClean(n){ const s = String(n == null ? "" : n); return /&|\r|\n/.test(s) ? namesBreaks(namesDecode(s)) : namesBreaks(s); }
function namesKey(n){ return namesClean(n).replace(/\s+/g, " ").trim().toLowerCase(); }

export { namesDecode, namesBreaks, namesClean, namesKey };
