// "Columns read as …" on a bank statement read through the columns FinCom's AI gave for its layout, or a person's (the
// owner, 24-Nov-2026: the one-time AI reading of the columns by default, remembered per client and layout; plain words).
//   ColsLine   the statement's small line, with Change: the columns put right are kept for this layout (co.aiColumns,
//              how "person") and the statement is read again with them (readAgain below)
//   ColsChoose a file not read (the AI not available, or it could not tell): the same choice, then the file is read
//   (the choice itself: parts/ColsPick.jsx)
// The mapping lives in app/src/lib/aiColumns.js (one module with registers.js's SheetAI).
import { useState } from "react";
import { keep, saidCols, carry, inFlight, extraLines } from "../../lib/aiColumns.js";
import ColsPick from "../ColsPick.jsx";
/* global S, B, CO, Store, whoAmI, toast, render, uploadStatements, readStatement, checkBalances, bankTake, bankAside, bankErr, charge, uid, suggestAll, matchTallyBook,
   countStates, bankLinks, CloudDocs, BankDB, postJobOf, CloudJobs, Trash, Cloud, saveBank, FileStore, fmtDate, bankSaveTimer */

const who = () => { try { return whoAmI(); } catch (e) { return ""; } };

// the statement read again with the columns just kept (the review of aead82472): the file is read FIRST; only when that
// read gives lines is the old statement put aside (as "Delete this statement" does: kept to restore) and the new one put
// in its place, with the person's ledger choices carried over (aiColumns.js carry) and the lines in Tally kept exactly as
// they are. Busy, a line being posted, or a read that fails: the old statement stays where it was, and that is said.
// Charged only for lines beyond those paid for the first time. -> true when the statement was replaced
const say = (m) => { try { toast(m); } catch (e) { /* no toast here */ } };
const jobOf = (cid) => (r) => { try { const j = typeof postJobOf === "function" ? postJobOf(cid, r.id) : null; return j && (typeof CloudJobs !== "object" || CloudJobs.live(j)) ? j : null; } catch (e) { return null; } };
export async function readAgain(b, st) {
  const cid = b.cid, stays = " The statement stays as it was; the columns are kept for this layout.";
  if (b.busy || (uploadStatements.on && uploadStatements.on.has(cid))) { say("FinCom is reading another statement now." + stays + " Press Change again in a moment to read this one with them."); return false; }
  const old = b.cur === st.id ? b.rows : ((await BankDB.get("stmt:" + cid + ":" + st.id)) || []);
  if (old.some((r) => inFlight(r, jobOf(cid)))) { say("Some lines of this statement are being posted to Tally now." + stays); return false; }
  let file = S.files["st:" + st.id];
  if (!file) try { file = await FileStore.get(cid, "st:" + st.id, st.docPath, st.fileName); } catch (e) { file = null; }
  if (!file) { say("The statement's file is not on this computer." + stays + " Upload it again to read it with them."); return false; }
  const on = uploadStatements.on || (uploadStatements.on = new Set());
  on.add(cid); b.busy = "Reading " + st.fileName + " again with these columns…"; render();
  try {
    let parsed;
    try { parsed = await readStatement(file, (m) => { b.busy = st.fileName + ": " + m; render(); }); } catch (e) { say(st.fileName + " could not be read with these columns: " + bankErr(e) + stays); return false; }
    if (!parsed.rows.length) { say(st.fileName + ": no lines were read with these columns." + stays); return false; }
    const chk = checkBalances(parsed.rows, parsed.meta), co = CO(cid), acc = (co.bankAccounts || []).find((a) => a.id === st.acctId) || { id: st.acctId, bank: st.bank };
    // the old statement out of the way for the repeat check only (nothing written until the new reading is in hand)
    const oldKeys = Object.keys(b.keys).filter((k) => b.keys[k] === st.id), keys = Object.assign({}, b.keys);
    oldKeys.forEach((k) => { delete keys[k]; });
    const sid = uid("st"), x = await bankTake(parsed, acc, { cid, keys, stmts: b.stmts.filter((s) => s.id !== st.id) }, sid, co.name, chk, file, st.hash);
    if (!x.rows.length) { say(st.fileName + ": no lines were read with these columns." + stays); return false; }
    const c = carry(old, x.rows), paid = old.filter((r) => !bankAside(r)).length, extra = extraLines(paid, x.rows.length - x.held);
    if (extra > 0 && !(await charge("bank", extra, file.name, extra + " more statement lines read again"))) { say(stays.trim()); return false; }
    // now the swap: the old statement to the deleted ones (More → Restore), the new one in its place
    await Trash.put(cid, "statement", (st.bank || "Statement") + " " + fmtDate(st.from) + " to " + fmtDate(st.to) + " (" + st.n + " rows)", { st, keys: oldKeys, rows: old }, "columns read again");
    oldKeys.forEach((k) => { delete b.keys[k]; });
    Object.assign(b.keys, x.nk);
    c.rows.forEach((r) => { if (r.fp && !r.id.startsWith(sid)) b.keys[r.fp] = sid; });
    if (typeof Cloud === "object") Cloud.delete("bank_stmt", cid, cid + ":" + st.id, "columns read again");
    try { clearTimeout(bankSaveTimer); } catch (e) { /* none waiting */ }
    b.stmts = b.stmts.filter((s) => s.id !== st.id).concat([x.st]); b.stmtsTrash = null;
    b.cur = sid; b.rows = c.rows; b.sel.clear(); b.sticky.clear(); b.undo = null;
    suggestAll(c.rows.filter((r) => !r.userSet), true); matchTallyBook(acc, c.rows);   // (a ledger the person chose is theirs)
    x.st.counts = countStates(c.rows); x.st.links = bankLinks(c.rows); x.st.n = c.rows.filter((r) => !bankAside(r)).length;
    S.files["st:" + sid] = file; FileStore.put(cid, "st:" + sid, file); CloudDocs.add(cid, "st:" + sid, file, "stmt");
    await BankDB.set("stmt:" + cid + ":" + sid, c.rows);
    saveBank({ stmts: true, keys: true, rows: true });
    say(st.fileName + " read again with these columns: " + c.rows.length + " lines" + (c.carried ? ", " + c.carried + " with the ledger chosen before" : "") + (c.kept ? ", " + c.kept + " already in Tally kept as they are" : "") + (c.lost ? ". " + c.lost + " earlier lines not read again are in More → Restore" : "") + ".");
    return true;
  } finally { on.delete(cid); b.busy = ""; render(); }
}

export function ColsLine({ st }) {
  const [open, setOpen] = useState(false);
  const c = st && st.cols;
  if (!c || !c.map) return null;
  const save = async (m) => {
    const b = B(), co = CO(b.cid);
    keep(co, "bank", c.head, m, "person", who()); Store.saveCompany(co);
    setOpen(false);
    await readAgain(b, st);
  };
  return <div className="bk-found bk-colsread" data-cols-read={c.how}>
    <span>{c.how === "person" ? "Columns read as you set them: " : "Columns read as: "}<b>{saidCols(c)}</b>.</span>
    {!open && <button type="button" className="linkbtn" data-cols-change="" onClick={() => setOpen(true)}>Change</button>}
    {open && <ColsPick head={c.head} map={c.map} onSave={save} onCancel={() => setOpen(false)} saveWords="Save and read again" />}
  </div>;
}

export function ColsChoose({ f }) {
  const [open, setOpen] = useState(false);
  if (!f || !Array.isArray(f.head) || !f.head.length) return null;
  const save = (m) => {
    const b = B(), co = CO(b.cid), file = b.lastFile;
    keep(co, "bank", f.head, m, "person", who()); Store.saveCompany(co);
    b.lastFail = null; render();
    if (file) uploadStatements([file]); else toast("Kept for this layout. Upload the statement again.");
  };
  return <div className="bk-colschoose" data-cols-choose="">
    {!open ? <span>FinCom could not tell which column is which. <button type="button" className="btn small" data-cols-open="" onClick={() => setOpen(true)}>Choose the columns</button></span>
      : <ColsPick head={f.head} map={{}} onSave={save} onCancel={() => setOpen(false)} saveWords="Save and read" />}
  </div>;
}
