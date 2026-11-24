// "Columns read as …" on a bank statement read through the columns FinCom's AI gave for its layout, or a person's (the
// owner, 24-Nov-2026: the one-time AI reading of the columns by default, remembered per client and layout; plain words).
//   ColsLine   the statement's small line, with Change: the columns put right are kept for this layout (co.aiColumns,
//              how "person") and the statement is read again with them (not charged twice), unless a line of it is in
//              Tally already: then they are kept for the next statement of this layout and this one stays as it is
//   ColsChoose a file not read (the AI not available, or it could not tell): the same choice, then the file is read
//   (the choice itself: parts/ColsPick.jsx)
// The mapping lives in app/src/lib/aiColumns.js (one module with registers.js's SheetAI).
import { useState } from "react";
import { keep, saidCols } from "../../lib/aiColumns.js";
import ColsPick from "../ColsPick.jsx";
/* global S, B, CO, Store, whoAmI, toast, render, uploadStatements, Trash, Cloud, saveBank, FileStore, fmtDate, bankSaveTimer */

const who = () => { try { return whoAmI(); } catch (e) { return ""; } };

// the statement out of the list as "Delete this statement" puts it (src/js/23 deleteStatement, kept to restore), with no
// question, then the same file read again with the columns just kept
async function readAgain(b, st) {
  let file = S.files["st:" + st.id];
  if (!file) try { file = await FileStore.get(b.cid, "st:" + st.id, st.docPath, st.fileName); } catch (e) { file = null; }
  if (!file) { toast("Kept for this layout. Upload the statement again to read it with these columns."); return; }
  const rows = b.cur === st.id ? b.rows : [], keys = Object.keys(b.keys).filter((k) => b.keys[k] === st.id);
  await Trash.put(b.cid, "statement", (st.bank || "Statement") + " " + fmtDate(st.from) + " to " + fmtDate(st.to) + " (" + st.n + " rows)", { st, keys, rows }, "columns read again");
  keys.forEach((k) => { delete b.keys[k]; });
  b.stmts = b.stmts.filter((x) => x.id !== st.id);
  if (typeof Cloud === "object") Cloud.delete("bank_stmt", b.cid, b.cid + ":" + st.id, "columns read again");
  b.stmtsTrash = null;
  try { clearTimeout(bankSaveTimer); } catch (e) { /* none waiting */ }
  if (b.cur === st.id) { b.cur = null; b.rows = []; b.sel.clear(); b.sticky.clear(); b.undo = null; }
  saveBank({ stmts: true, keys: true });
  await uploadStatements([file], { again: true });
}

export function ColsLine({ st }) {
  const [open, setOpen] = useState(false);
  const c = st && st.cols;
  if (!c || !c.map) return null;
  const save = async (m) => {
    const b = B(), co = CO(b.cid);
    keep(co, "bank", c.head, m, "person", who()); Store.saveCompany(co);
    setOpen(false);
    if (b.rows.some((r) => r.state === "sent")) { st.cols = Object.assign({}, c, { map: m, how: "person" }); saveBank({ stmts: true }); toast("Kept for the next statement of this layout. This one has entries in Tally already, so its lines stay as they are."); render(); return; }
    toast("Reading " + st.fileName + " again with these columns…");
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
