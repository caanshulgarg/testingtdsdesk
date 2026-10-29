// Ask FinCom's memory of the conversation (the owner, 29-Oct-2026: "multiple times I asked.. no previous memory.. nothing..
// it was so dumb that I had to ask every time"). Loaded with the panel (Assistant.jsx), it gives ASST (src/js/75-assistant.js)
// what each question carries to fincom-assistant:
//   history()  the last six exchanges of this panel's conversation (this client, or the whole firm), short: the question,
//              the answer's words cut at 700 characters, and what FinCom showed under it ("[Shown: the statements card,
//              01-Apr-2026 to 30-Sep-2026 …; table Profit and loss …; file X.xlsx; attached Y.pdf]"), so "this" and "the
//              earlier message" have something to point at. The server bounds it again (agent.ts boundHistory);
//   thread()   the statements shown last (their period, comparative and notes: "an excel copy of this" is those
//              statements) and the files attached in this conversation with what FinCom found each to be (the Upload's
//              kind and summary), so "the balance sheet I attached in the earlier message" is that file.
// It also takes the answer's statements card event ("fs", server/assistant/fsask.ts) onto the turn.
const TURNS = 6, Q_MAX = 500, A_MAX = 700, SHOWN_MAX = 600;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || "")) ? d.slice(8, 10) + "-" + MON[+d.slice(5, 7) - 1] + "-" + d.slice(0, 4) : "");

// what FinCom showed under an answer, in words
export function shownOf(t) {
  const parts = [];
  if (t.fs) parts.push("the statements card, " + (t.fs.from && t.fs.to ? dmy(t.fs.from) + " to " + dmy(t.fs.to) : "the period on the Financial statements page") + ", compared with "
    + (t.fs.cmp === "fy" ? "the last full year" : "the same period last year") + (t.fs.notes === false ? ", without the notes" : ", with the notes"));
  (t.results || []).forEach((r) => {
    if (r.kind === "entries") { parts.push("entries drafted"); return; }
    if (r.kind === "mis") { parts.push("an MIS layout"); return; }
    const p = r.period || {}, per = p.from || p.to ? " " + (p.from ? dmy(p.from) + " to " : "to ") + dmy(p.to) : p.as_on ? " on " + dmy(p.as_on) : "";
    parts.push("table " + String(r.title || r.tool || "") + per + (r.tool ? " [" + r.tool + " " + JSON.stringify(r.params || {}) + "]" : ""));
  });
  (t.files || []).forEach((f) => parts.push("file " + f.name));
  (t.drafts || []).forEach((d) => parts.push("draft " + d.title));
  if (t.attach && t.attach.name) parts.push("attached " + t.attach.name);
  return parts.length ? " [Shown: " + parts.join("; ").slice(0, SHOWN_MAX) + "]" : "";
}

export function installMemory(A) {
  if (!A || A.__memory) return;
  A.__memory = true;
  A.history = function () {
    return this.turns().filter((t) => t.done && !t.error).slice(-TURNS).flatMap((t) => [
      { role: "user", content: String(t.q || "").slice(0, Q_MAX) },
      { role: "assistant", content: (this.plain(t.text).slice(0, A_MAX) + shownOf(t)).trim() || "(no words)" }]);
  };
  A.thread = function () {
    const list = this.turns().filter((t) => t.done && !t.error), last = list.filter((t) => t.fs).slice(-1)[0];
    const fs = last ? { from: last.fs.from || null, to: last.fs.to || null, cmp: last.fs.cmp === "fy" ? "fy" : "same", notes: last.fs.notes !== false } : null;
    const files = [], seen = new Set();
    const add = (f) => { if (!f || !f.path || seen.has(f.path)) return; seen.add(f.path); files.push({ path: f.path, name: String(f.name || "").slice(0, 160), type: f.type || "", kind: f.kind || "", summary: String(f.summary || "").slice(0, 300) }); };
    list.forEach((t) => add(t.attach));
    try { (typeof AUpload === "object" && AUpload.list ? AUpload.list() : []).filter((u) => u.path && u.state === "ready").forEach(add); } catch (e) { /* the Upload not loaded */ }
    (this.ups ? this.ups() : []).forEach(add);
    return { fs, files: files.slice(-10) };
  };
  // the statements card's event (and anything else) onto the turn
  const take0 = A.take;
  A.take = function (t, e) {
    if (e && e.t === "fs") { t.fs = e; return; }
    return take0.call(this, t, e);
  };
}

// ASST is the legacy program's (a const of src/js/75, a global of the page, not a property of window)
if (typeof ASST === "object") installMemory(ASST);
