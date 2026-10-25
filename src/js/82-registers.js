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
function sheetStart(files, side, opts){ return registersLoad().then(() => SheetImport.start(files, side, opts), e => toast("A register cannot be read here: " + ((e && e.message) || e))); }
// open the Reconciliations page on Vendors (or Customers), and pick a statement to read
function reconGo(side){ S.step = null; S.tab = "books"; S.booksTab = "recon"; S.reconTab = side === "customer" ? "customers" : "vendors"; render(); window.scrollTo(0, 0); }
// the vendor reconciliation's old place, and the vendor's and the bank reconciliation's Excel (src/js/42, loaded with
// the screens that use it: app/src/lib/vendorRecon.js; these stay here for the first file's screens and the tests)
function vrOpen(){ S.vrec = null; if (typeof reconGo === "function") reconGo("vendor"); else render(); }
function vrExcel(){ vendorReconExcel().catch(e => toast("Could not make the file: " + (e.message || e))); }
function reconExcelGo(){ bankReconExcel().catch(e => toast("Could not make the file: " + (e.message || e))); }
