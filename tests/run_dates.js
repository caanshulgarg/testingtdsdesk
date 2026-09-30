// TZ=Asia/Kolkata node run_dates.js - addDays (src/js/24) gives the same day wherever the computer is
const fs = require("fs"), src = fs.readFileSync(__dirname + "/../src/js/24-tally-bridge.js", "utf8");
const addDays = new Function(src.match(/function addDays\(iso, n\)\{[^\n]*\}/)[0] + "; return addDays;")();
const cases = [["2025-04-01", -1, "2025-03-31"], ["2025-12-31", 1, "2026-01-01"], ["2024-02-28", 1, "2024-02-29"], ["2025-03-01", -1, "2025-02-28"], ["2025-06-15", 0, "2025-06-15"]];
let bad = 0;
cases.forEach(([d, n, want]) => { const got = addDays(d, n); console.log((got === want ? "  ok   " : "  FAIL ") + d + " " + (n >= 0 ? "+" : "") + n + " = " + got); if (got !== want) bad++; });
console.log(bad ? "\nFAILED: " + bad : "\nall passed"); process.exit(bad ? 1 : 0);
