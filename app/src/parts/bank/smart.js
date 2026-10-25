// The bank page's quick filters, bulk changes and keys (the owner, 24-Oct-2026: "bank statement page is very basic, no
// filters.. it should be smart for any person to work.. like in particulars there should be a filter to search UPI or
// IMPS or anything and we will be able to complete entry"). Loaded with the bank page (its lazy chunk), not legacy.js.
//
// What is kept where (all on B(), the open client's bank data, for as long as the page is open):
//   b.chips   the quick chips on (UPI, IMPS, ...): a line shows when it is any of them;
//   b.sugOnly only lines with a suggestion to accept;
//   b.f, b.from, b.to, b.q  the column filters, dates and search the old code already keeps (bankColFilter, src/js/22),
//             so the tabs' counts, the ChipBar and "set them all" see the same filters;
//   b.ruleForm the "rule from this filter" being written; b.kbRow the line the keys are on.
// Nothing here posts: a change is a ledger, voucher type or narration on lines (with Undo); posting stays the bar's
// Post to Tally / Create Tally file (src/js/24, src/js/22).

// a chip: [key, words on it, what in the narration makes a line one, decodeNarr's modes that count too, a word for a rule]
export const CHIPS = [
  ["UPI", "UPI", /\bUPI\b/, ["UPI"], "UPI"],
  ["IMPS", "IMPS", /\bIMPS\b|\bMMT\b/, ["IMPS"], "IMPS"],
  ["NEFT", "NEFT", /\bNEFT\b/, ["NEFT"], "NEFT"],
  ["RTGS", "RTGS", /\bRTGS\b/, ["RTGS"], "RTGS"],
  ["Cheque", "Cheque", /\b(CHQ|CHEQUE|CLG|CTS)\b/, ["CHQ"], "CHQ"],
  ["ATM", "ATM", /\b(ATM|ATW|NWD|CDM)\b|CASH\s*(WDL|WITHDRAWAL|DEP)/, ["ATM", "CASH"], "ATW"],
  ["Card", "Card", /\b(POS|ECOM|VPS)\b|DEBIT\s*CARD/, ["CARD"], "POS"],
  ["Charges", "Charges", /CHRG|CHARGE|COMMISSION|\bFEES?\b|\bAMC\b|MIN\s*BAL/, ["CHARGES"], "CHARGES"],
  ["Interest", "Interest", /\bINT\.?\s*(PD|CR|PAID|CREDIT|COLL)\b|INTEREST/, ["INTEREST"], "INTEREST"],
  ["GST", "GST", /\b(GST|IGST|CGST|SGST|CPIN|GSTN)\b/, [], "GST"],
  ["TDS", "TDS", /\bTDS\b|ITNS\s*28[01]|OLTAS/, [], "TDS"],
  ["Salary", "Salary", /\bSAL(ARY|ARIES)?\b/, [], "SALARY"],
  ["NACH", "NACH", /\b(NACH|ACH|ECS)\b/, ["NACH"], "ACH"],
];
const chipOf = (k) => CHIPS.find((c) => c[0] === k);
export function chipHit(r, k) {
  const c = chipOf(k);
  return !!c && (c[2].test(String(r.narr || "").toUpperCase()) || c[3].includes(r.dec && r.dec.mode));
}
export const chipsOn = (b) => (b && b.chips) || [];

// the lines the table lists: the old filters (tab, search, columns, dates), then the chips and "suggestions only"
export function baseRows(b, rows) { return b.sugOnly ? rows.filter((r) => r.state === "suggested") : rows; }
export function smartRows(b, rows) {
  const on = chipsOn(b), f = (b && b.f) || {}, base = baseRows(b, rows).filter((r) => headPass(f, r));
  return on.length ? base.filter((r) => on.some((k) => chipHit(r, k))) : base;
}

// ---- the header filters this page adds to the old ones (25-Oct-2026, the owner: "I need filters within column as
// earlier"). Date, Particulars, Withdrawal, Deposit and Ledger keep the old pop-up (colPopHtml, src/js/23: b.from / b.to,
// b.f.narr, modes, wmin..dmax, led, leds); Balance (b.f.bmin, bmax), Status (b.f.sts: states) and Type (b.f.vts:
// voucher types) are kept on b.f too and read here. They combine with the chips, the search and each other. ----
const set = (v) => v !== undefined && v !== null && v !== "";
export const STATE_WORDS = { attention: "No ledger", suggested: "Suggested", ready: "Ready to post", sent: "In Tally", intally: "Already in Tally", ignored: "Ignored" };
export function headPass(f, r) {
  if (set(f.bmin) || set(f.bmax)) {
    if (!set(r.balance)) return false;
    const v = num(r.balance);
    if (set(f.bmin) && v < num(f.bmin)) return false;
    if (set(f.bmax) && v > num(f.bmax)) return false;
  }
  if (f.sts && f.sts.length && !f.sts.includes(r.state)) return false;
  if (f.vts && f.vts.length && !f.vts.includes(vtypeOf(r))) return false;
  return true;
}
export function headOn(f, k) {
  f = f || {};
  return k === "bal" ? set(f.bmin) || set(f.bmax) : k === "st" ? !!(f.sts && f.sts.length) : k === "vt" ? !!(f.vts && f.vts.length) : false;
}
// what the header filters hold, as chips (the old columns' from colChips, src/js/23, and this page's three)
export function headChips(b) {
  const f = b.f || {}, out = typeof colChips === "function" ? colChips("bank").map(([k, w]) => ({ k, w, old: true })) : [];
  const rng = (a, z) => (set(a) && set(z) ? money(a) + " – " + money(z) : set(a) ? "≥ " + money(a) : "≤ " + money(z));
  if (headOn(f, "bal")) out.push({ k: "bal", w: "Balance " + rng(f.bmin, f.bmax) });
  if (headOn(f, "st")) out.push({ k: "st", w: "Status: " + f.sts.map((s) => STATE_WORDS[s] || s).join(", ") });
  if (headOn(f, "vt")) out.push({ k: "vt", w: "Type: " + f.vts.join(", ") });
  return out;
}
export function headClear(k, old) {
  if (old) { colChipX("bank", k); return; }
  const b = B(); b.f = Object.assign({}, b.f || {});
  ({ bal: ["bmin", "bmax"], st: ["sts"], vt: ["vts"] }[k] || []).forEach((x) => delete b.f[x]);
  b.limit = 100; b.sticky.clear(); b.sel.clear(); redraw();
}

// ---- the client's ledger list from its books (25-Oct-2026, Testing AAD: "I have already uploaded masters xml.. still it
// is asking again"). The ledger masters uploaded on Books -> From Tally (bringMastersFile, src/js/23) are kept in the
// books (ledInfo, under; shared through client_book_items), but every ledger box and the bank's "Bring in the Tally
// ledger list" read only Ledgers (src/js/58: FinCom's cloud copy of the books, the bridge, or a list kept in this
// browser). A client with no book in the cloud and no bridge (Testing AAD) so had no list on the bank page. Now, when
// Ledgers has none, the books' list is taken as the client's list (src "file", dated when the masters were uploaded, so a
// later cloud or bridge read still replaces it), and the bank's lines are suggested again. The books are opened for it
// when they are not open yet (as the bill page does). ----
export function booksLedgerList(bk) {
  const info = (bk && bk.ledInfo) || {}, under = (bk && bk.under) || {}, groups = (bk && bk.groups) || {};
  const names = Array.from(new Set(Object.keys(info).concat(Object.keys(under).filter((n) => !groups[n])))).filter(Boolean).sort((a, z) => a.localeCompare(z));
  return names.map((n) => ({ name: n, group: (info[n] && info[n].group) || under[n] || "", gstin: String((info[n] && info[n].gstin) || ((bk.gstins || {})[n]) || "").toUpperCase(),
    pan: String((info[n] && info[n].pan) || ((bk.pans || {})[n]) || "").toUpperCase(), taxType: (info[n] && info[n].taxType) || "", dutyHead: (info[n] && info[n].dutyHead) || "", tdsNature: (info[n] && info[n].tdsNature) || "" }));
}
// "loading": the books are being opened; "taken": the list came from them now; "": nothing there (or a list is held)
export function ledgersFromBooks(cid) {
  if (typeof Ledgers !== "object" || !cid || Ledgers.list(cid).length) return "";
  const bk = S.books && S.books.cid === cid ? S.books : null;
  if (!bk) { if (typeof openBooks === "function") setTimeout(() => { if (!(S.books && S.books.cid === cid) && S.coId === cid) openBooks(cid).then(() => redraw(), () => {}); }, 0); return "loading"; }
  if (bk.openFailed) return "";
  if (bk.loading) return "loading";
  const list = booksLedgerList(bk);
  if (!list.length) return "";
  const at = bk.ledInfoAt || "";
  const parents = {}; Object.entries(bk.groups || {}).forEach(([g, p]) => { if (g) parents[g] = typeof p === "string" ? p : (p && p.parent) || ""; });
  if (!Ledgers.take(cid, { list, parents, at: at || new Date().toISOString(), srcAt: at || "1970-01-01T00:00:00.000Z", src: "file", file: "Ledger masters uploaded on Books" + (at ? " " + fmtDate(at.slice(0, 10)) : "") })) return "";
  if (typeof ledgersChanged === "function") setTimeout(() => { try { ledgersChanged(cid); } catch (e) {} redraw(); }, 0);
  return "taken";
}
// each chip's count among the lines the other filters leave
export function chipCounts(b, rows) {
  const base = baseRows(b, rows), n = {};
  CHIPS.forEach((c) => { n[c[0]] = 0; });
  base.forEach((r) => CHIPS.forEach((c) => { if (chipHit(r, c[0])) n[c[0]]++; }));
  return n;
}
export function smartOn(b) { return !!(b && (chipsOn(b).length || b.sugOnly || (b.q || "").trim() || bankRangeOn() || ["bal", "st", "vt"].some((k) => headOn(b.f, k)))); }

const redraw = () => render();
export function toggleChip(k) {
  const b = B(), on = chipsOn(b);
  b.chips = on.includes(k) ? on.filter((x) => x !== k) : on.concat([k]);
  b.limit = 100; b.sticky.clear(); b.sel.clear(); b.ruleForm = null; redraw();
}
// a column filter kept where the old code reads it (bankColFilter, src/js/22)
export function setF(k, v) {
  const b = B(); b.f = Object.assign({}, b.f || {});
  if (v === "" || v === null || v === undefined || v === false) delete b.f[k]; else b.f[k] = v;
  b.limit = 100; b.sticky.clear(); b.sel.clear(); redraw();
}
export function setRange(k, v) { const b = B(); b[k] = v || ""; b.limit = 100; b.sticky.clear(); b.sel.clear(); redraw(); }
export function setSugOnly(on) { const b = B(); b.sugOnly = !!on; b.limit = 100; b.sticky.clear(); b.sel.clear(); redraw(); }
export function clearAll() {
  const b = B(); b.chips = []; b.sugOnly = false; b.q = ""; b.from = ""; b.to = ""; b.f = {}; b.ruleForm = null; b.limit = 100; b.sticky.clear(); b.sel.clear(); redraw();
}

// tick every line the filters show (not only the hundred drawn); a line in Tally cannot be ticked
export function selectAll(rows, on) {
  const b = B();
  rows.filter((r) => r.state !== "sent").forEach((r) => { if (on) b.sel.add(r.id); else b.sel.delete(r.id); });
  bankLightRefresh();
}

const open = (r) => !["sent", "intally"].includes(r.state);
const snap = (r) => Object.assign(rowSnapshot(r), { ruleNarr: r.ruleNarr || "", splits: (r.splits || []).map((x) => Object.assign({}, x)) });
// one change to some lines, with Undo in the bar (undoBank, src/js/22, puts the snapshots back)
function change(rows, what, fn) {
  const b = B();
  rows = rows.filter(open);
  if (!rows.length) { toast("Nothing to change: the lines ticked are in Tally already."); return 0; }
  const snaps = rows.map(snap);
  rows.forEach((r) => { fn(r); b.sticky.add(r.id); });
  b.undo = { what, label: entries(rows.length), n: rows.length, others: 0, snaps, ruleKeys: [], oldRules: [] };
  saveBank({ rows: true });
  return rows.length;
}
export const VTYPES = ["Payment", "Receipt", "Contra", "Journal"];
export const vtypeOf = (r) => r.vtype || (r.debit ? "Payment" : "Receipt");
// the voucher type of the ticked lines
export function bulkVtype(vt) {
  if (!VTYPES.includes(vt)) return;
  const b = B(), n = change(bankSelected(), "vtype", (r) => { r.vtype = vt; });
  b.sel.clear(); if (n) toast(entries(n) + ": voucher type " + vt + "."); redraw();
}
// one line's voucher type (the Type column)
export function setVtype(id, vt) {
  const r = bankRow(id); if (!r || !VTYPES.includes(vt) || vtypeOf(r) === vt) return;
  change([r], "vtype", (x) => { x.vtype = vt; }); redraw();
}
// a narration for the ticked lines: it goes before the bank's words in the voucher's narration ({month}, {party}, ...
// filled in per line, as a rule's narration: ruleNarr, src/js/22)
export function bulkNarr(tpl) {
  tpl = String(tpl || "").trim();
  if (!tpl) { toast("Type the narration first."); return; }
  const b = B(), n = change(bankSelected(), "narr", (r) => { r.ruleNarr = ruleNarr(tpl, r); });
  b.sel.clear(); if (n) toast(entries(n) + ": narration set."); redraw();
}

// ---- a rule from the filter: lines containing these words (in or out, in an amount range) go to one ledger ----
export function ruleWords(b) {
  const q = (b.q || "").trim();
  if (q) return q;
  const on = chipsOn(b);
  return on.length === 1 ? chipOf(on[0])[4] : "";
}
export function ruleStart() {
  const b = B(), f = b.f || {};
  const shown = b.rows.filter((r) => b.sel.has(r.id));
  const leds = new Set(shown.map((r) => r.ledger).filter(Boolean));
  b.ruleForm = { text: ruleWords(b), dir: f.dir || "any", min: f.min || "", max: f.max || "", ledger: leds.size === 1 ? Array.from(leds)[0] : "" };
  redraw();
}
export function ruleDraft(form, ledger) {
  return newRule({ name: (ledger || "Ledger") + " – " + form.text, scope: "client",
    when: { text: [{ op: "has", v: form.text }], dir: form.dir || "any", amtMin: form.min || "", amtMax: form.max || "", modes: [], acNo: "", account: "any", from: "", to: "" },
    then: { action: "set", ledger: ledger || "", kind: "", vtype: "", tdsNature: "", tdsAtPay: false, splits: [], narr: "", ready: true } });
}
// what the rule would do to the statement open now: lines it would set, and lines set by hand it leaves alone
export function rulePreviewNow(form) {
  const b = B(), st = curStmt(), acc = st ? accountFor(st) : null;
  if (!(form.text || "").trim()) return { hit: 0, now: 0, hand: 0 };
  const r = ruleDraft(form, "x"), hits = b.rows.filter((x) => ruleHits(r, x, acc));
  return { hit: hits.length, now: hits.filter((x) => open(x) && !x.userSet).length, hand: hits.filter((x) => open(x) && x.userSet).length };
}
export function ruleSave(form, ledger) {
  const b = B();
  if (!(form.text || "").trim()) { toast("Type the words the narration contains."); return false; }
  const l = exactLedger(ledger);
  if (!l) { toast(ledger ? "“" + ledger + "” is not a Tally ledger. Choose one from the list." : "Choose the ledger for these lines."); return false; }
  const r = ruleDraft(form, l);
  clientRules().unshift(r);
  saveRules("client");
  // runRules never changes a line set by hand (src/js/22); a statement uploaded later meets the rule in suggestAll
  const n = runRules(null, { force: false });
  b.ruleForm = null;
  toast("Rule saved: lines containing “" + form.text + "” go to " + l + (n ? " · " + entries(n) + " set now" : "") + " · future statements follow it.");
  redraw();
  return true;
}

// ---- the keys: up and down move, Enter opens the ledger box, Space ticks, A accepts a suggestion ----
export const KEYS_HELP = "Keys on the list: ↑ ↓ move · Enter: the ledger box (type, Enter to set, then the next line) · Space: tick · A: accept the suggestion · Esc: back to the list";
const gridRows = (grid) => Array.from(grid.querySelectorAll("tbody tr[data-rid]"));
export function kbMark(grid, id) {
  const b = B(); b.kbRow = id || null;
  gridRows(grid).forEach((tr) => tr.classList.toggle("kb-on", tr.dataset.rid === id));
  const tr = id && grid.querySelector('tr[data-rid="' + id + '"]');
  if (tr && tr.scrollIntoView) tr.scrollIntoView({ block: "nearest" });
}
const kb = { editing: null, next: null, idx: 0 };
export function kbKey(ev, grid) {
  const t = ev.target;
  if (t !== grid) {
    // Esc in a ledger box whose list is closed: back to the list, on its line
    if (ev.key === "Escape" && t.dataset && t.dataset.bled) { ev.preventDefault(); kb.editing = null; grid.focus({ preventScroll: true }); kbMark(grid, t.dataset.bled); }
    return;
  }
  const rows = gridRows(grid), ids = rows.map((tr) => tr.dataset.rid);
  if (!ids.length) return;
  let i = ids.indexOf(B().kbRow);
  const go = (j) => { ev.preventDefault(); kbMark(grid, ids[Math.max(0, Math.min(ids.length - 1, j))]); };
  if (ev.key === "ArrowDown" || ev.key === "j") return go(i < 0 ? 0 : i + 1);
  if (ev.key === "ArrowUp" || ev.key === "k") return go(i < 0 ? 0 : i - 1);
  if (ev.key === "Home") return go(0);
  if (ev.key === "End") return go(ids.length - 1);
  if (i < 0) return;
  const id = ids[i], r = bankRow(id);
  if (ev.key === "Enter") {
    const box = grid.querySelector('input[data-bled="' + id + '"]');
    if (!box) return;
    ev.preventDefault();
    kb.editing = id; kb.next = ids[i + 1] || null; kb.idx = i;
    box.focus(); box.select && box.select();
    return;
  }
  if (ev.key === " ") { ev.preventDefault(); if (r && r.state !== "sent") bankToggleRow(id, !B().sel.has(id), false); return; }
  if ((ev.key === "a" || ev.key === "A") && r && r.state === "suggested") { ev.preventDefault(); bankRowAct("accept", id); setTimeout(() => kbAfter(grid, id), 30); return; }
  if (ev.key === "Escape") { ev.preventDefault(); kbMark(grid, null); }
}
// after a ledger set from the keys: the next line is current, and the list has the keys again
function kbAfter(grid, id) {
  const ids = gridRows(grid).map((tr) => tr.dataset.rid);
  let next = ids.includes(id) ? ids[ids.indexOf(id) + 1] : kb.next && ids.includes(kb.next) ? kb.next : ids[Math.min(kb.idx, ids.length - 1)];
  if (!next) next = ids[ids.length - 1] || null;
  grid.focus({ preventScroll: true });
  kbMark(grid, next);
}
export function kbChange(ev, grid) {
  const t = ev.target;
  if (!t || !t.dataset || !t.dataset.bled || kb.editing !== t.dataset.bled) return;
  const id = kb.editing; kb.editing = null;
  // the old picker leaves the box on the next turn (src/js/23 acPick); then the list takes the keys again
  setTimeout(() => { if (bankRow(id) && bankRow(id).ledger) kbAfter(grid, id); }, 40);
}

// ---- one line to several ledgers (Suvit's "split ledger"): FinCom posted splits only from a rule (then.splits, applyRule,
// src/js/22); bankVoucherXml already writes r.splits, one ledger line each. The parts must leave the rest to the line's
// own ledger, so the voucher adds up; not with TDS at payment (that voucher has its own lines)
export function splitCheck(r, parts) {
  const amt = r2(num(r.debit || r.credit));
  if (!exactLedger(r.ledger)) return { why: "Choose the line's own ledger first: the rest of the amount goes to it." };
  if (num(r.tdsAtPay) > 0) return { why: "This line has TDS at payment; split it in Tally." };
  const ok = [];
  for (const p of parts) {
    if (!String(p.ledger || "").trim() && !num(p.amt)) continue;
    const l = exactLedger(p.ledger);
    if (!l) return { why: "\u201c" + (p.ledger || "") + "\u201d is not a Tally ledger." };
    if (!(num(p.amt) > 0)) return { why: "Give " + l + " an amount." };
    ok.push({ ledger: l, amt: r2(num(p.amt)) });
  }
  if (!ok.length) return { why: "Add a ledger and its amount." };
  const used = r2(ok.reduce((a, p) => a + p.amt, 0)), left = r2(amt - used);
  if (left < 0) return { why: "The parts come to " + money(used) + ", more than the line's " + money(amt) + "." };
  return { parts: left > 0.009 ? ok.concat([{ ledger: exactLedger(r.ledger), amt: left }]) : ok, left, amt };
}
export function splitSave(id, parts) {
  const r = bankRow(id); if (!r) return false;
  const c = splitCheck(r, parts);
  if (c.why) { toast(c.why); return false; }
  change([r], "split", (x) => { x.splits = c.parts; if (x.state === "attention" || x.state === "suggested") { x.state = "ready"; x.userSet = true; } });
  B().splitOpen = null; toast("Split into " + c.parts.length + " ledgers."); redraw();
  return true;
}
export function splitClear(id) {
  const r = bankRow(id); if (!r || !(r.splits || []).length) return;
  change([r], "split", (x) => { x.splits = []; });
  B().splitOpen = null; redraw();
}
