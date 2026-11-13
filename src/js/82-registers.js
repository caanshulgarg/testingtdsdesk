/* ================================================================== */
/* Registers and party reconciliations: loaded when first used        */
/* ================================================================== */
// A register uploaded on Purchase or Sales (a sheet, a PDF table or JSON: GSTR-1, GSTR-2B, a portal's or an ERP's) and
// a party's statement for Reconciliations → Vendors / Customers are read by an engine of their own
// (app/src/lib/registers.js: SheetFmt, SheetImport, PartyRecon). It loads the first time it is needed, so the program
// every page loads stays within its budget; these few lines are what the rest of the program calls.
function isSheetFile(f){ return /\.(xlsx|xls|csv|json|txt)$/i.test(String(f && f.name || "")) || /json|csv|spreadsheet|excel/.test(String(f && f.type || "")); }
function registersLoad(){
  if (typeof SheetImport === "object") return Promise.resolve();
  return typeof window.loadRegisters === "function" ? window.loadRegisters() : Promise.reject(new Error("registers are read in the app only"));
}
// the bill reader (src/js/01-reading-bills.js: freeParse, extract, readWithRetry …) the same way: in the React app its own
// file, loaded the first time a bill is read (window.loadReader, app/src/main.jsx); in the one-file site already here.
// A file that cannot come rejects with {code: "reader_unavailable"} (errText says it in plain words)
function readerLoad(){
  if (typeof readWithRetry === "function") return Promise.resolve();
  if (typeof window.loadReader !== "function") return Promise.reject({code: "reader_unavailable"});
  return window.loadReader().then(() => { if (typeof readWithRetry !== "function") throw new Error("reader not in its file"); }).catch(() => { throw {code: "reader_unavailable"}; });
}
// a screen's own part of the program (GSTR-9 and 9C's PDF and Excel, the MIS pack, the printed sales invoice) comes with
// that screen's file (build.py @react-lazy; window.loadPart, app/src/main.jsx), not in this one: an action asked for
// before its file is in loads it first ("Loading…"), then does what was asked; once it is in, at once, as before
function withPart(k, name, f){
  if (typeof globalThis[name] === "function") return f();
  if (typeof window.loadPart !== "function"){ toast("This part of FinCom is not in this page."); return; }
  toast("Loading\u2026");
  window.loadPart(k).then(() => f(), e => toast("Could not load this part of FinCom: " + ((e && e.message) || e)));
}
function sheetStart(files, side, opts){ return registersLoad().then(() => SheetImport.start(files, side, opts), e => toast("A register cannot be read here: " + ((e && e.message) || e))); }
// open the Reconciliations page on Vendors (or Customers), and pick a statement to read
function reconGo(side){ S.step = null; S.tab = "books"; S.booksTab = "recon"; S.reconTab = side === "customer" ? "customers" : "vendors"; render(); window.scrollTo(0, 0); }
// the vendor reconciliation's old place, and the vendor's and the bank reconciliation's Excel (src/js/42, loaded with
// the screens that use it: app/src/lib/vendorRecon.js; these stay here for the first file's screens and the tests)
// "Edit type" on a bill held for a person (a sheet's negative amount its Type column did not explain): a bill, or a
// Debit Note (a return); its amounts are taken positive and it is held no more (app/src/screens/Bill.jsx)
function billSetKind(id, k){
  const e = D().entries[id]; if (!e || !k || !e.hold || !["draft", "duplicate"].includes(e.status)) return;   // only a held bill still waiting (never approved, never posted)
  ["taxable", "cgst", "sgst", "igst", "cess", "total"].forEach(f => { e.x[f] = Math.abs(num(e.x[f])); });
  if (k === "credit"){ e.noteKind = "credit"; e.tdsSkip = e.tdsSkip || "note"; } else { delete e.noteKind; if (e.tdsSkip === "note") delete e.tdsSkip; }   // (a return carries no TDS)
  delete e.hold; e.readNote = ""; e.uncertain = []; Store.saveEntry(S.coId, e); refreshStats(S.coId); render();
}
function vrOpen(){ S.vrec = null; if (typeof reconGo === "function") reconGo("vendor"); else render(); }
function vrExcel(){ vendorReconExcel().catch(e => toast("Could not make the file: " + (e.message || e))); }
function reconExcelGo(){ bankReconExcel().catch(e => toast("Could not make the file: " + (e.message || e))); }
