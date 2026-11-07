// Dates as Corporate keeps them: ISO days "2026-09-30" (no time, no time zone), financial years "2025-26" (1 April to
// 31 March). Day arithmetic on UTC noon, so no clock change or time zone moves a day.
const M3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s + "T12:00:00Z"));
const t = (s) => Date.parse(s + "T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
export function addDays(s, n) { return isDay(s) ? iso(t(s) + n * 86400000) : ""; }
export function addMonths(s, n) {
  if (!isDay(s)) return "";
  const [y, m, d] = s.split("-").map(Number), to = new Date(Date.UTC(y, m - 1 + n, 1, 12)), last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0, 12)).getUTCDate();
  to.setUTCDate(Math.min(d, last));
  return iso(to.getTime());
}
export function daysBetween(a, b) { return isDay(a) && isDay(b) ? Math.round((t(b) - t(a)) / 86400000) : null; }
export function today() {
  // India's date (the firm's clients are Indian companies), whatever this computer's clock zone
  try { if (typeof istToday === "function") { const d = istToday(); return d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8); } } catch (e) { /* below */ }
  return iso(Date.now() + 5.5 * 3600000);
}
export function dmy(s) { if (!isDay(s)) return ""; const [y, m, d] = s.split("-"); return d + "-" + M3[+m - 1] + "-" + y; }
// "30-Sep" (the year left out)
export function dm(s) { return isDay(s) ? dmy(s).slice(0, 6) : ""; }
const sfx = (d) => (d % 100 >= 11 && d % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][d % 10] || "th");
export const ordinal = (n) => n + sfx(n);
// {weekday: "Friday", text: "25th September, 2026"} (the words of a notice or minutes)
export function dayLong(s) {
  if (!isDay(s)) return null;
  const [y, m, d] = s.split("-").map(Number), w = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  return { weekday: w, text: ordinal(d) + " " + ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1] + ", " + y };
}

// financial years
export const fyStart = (fy) => String(fy).slice(0, 4) + "-04-01";
export const fyEnd = (fy) => (+String(fy).slice(0, 4) + 1) + "-03-31";
export const fyOf = (s) => { if (!isDay(s)) return ""; const y = +s.slice(0, 4), m = +s.slice(5, 7), a = m < 4 ? y - 1 : y; return a + "-" + String(a + 1).slice(2); };
export const fyNext = (fy, n = 1) => { const a = +String(fy).slice(0, 4) + n; return a + "-" + String(a + 1).slice(2); };
// the last financial year that has ended (its accounts, AGM and annual forms are what is being worked on)
export const lastClosedFy = (on) => fyNext(fyOf(on || today()), -1);
// FinSt's year key (the year's first calendar year: "2025" for 2025-26)
export const finKey = (fy) => String(fy).slice(0, 4);

// how far a due date is: {days, tone: bad (past) / warn (within 30 days) / "" , words}
export function dueIn(due, on) {
  const n = daysBetween(on || today(), due);
  if (n == null) return { days: null, tone: "", words: "" };
  if (n < 0) return { days: n, tone: "bad", words: -n + (n === -1 ? " day" : " days") + " late" };
  if (n === 0) return { days: 0, tone: "warn", words: "due today" };
  return { days: n, tone: n <= 30 ? "warn" : "", words: n + (n === 1 ? " day" : " days") };
}
