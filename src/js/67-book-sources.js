/* ================================================================== */
/* The books from both sources: the Day Book and the bridge           */
/* ================================================================== */
// Round 44 (the owner's decision of 11-Oct-2026): TDS, TCS, GSTR-1, GSTR-3B, the amendments and the challans read one
// set of entries made from both ways an entry reaches FinCom:
//   - the Day Book the CA uploads (on this computer, or the day files the cloud keeps from an upload: Books.importDayBook);
//   - the entries the bridge sends by itself, kept in FinCom's cloud copy (tally_vouchers / tally_lines / tally_bills,
//     written by tally-ingest; read here as Look up and the ledger checks already read them, no new database function).
// One entry is one Tally GUID. The later version wins by Tally's AlterID; the same version that came both ways is counted
// once (the Day Book's, which carries more of the entry). An entry the cloud copy marks deleted in Tally leaves the
// books (kept in b.gone, as a Day Book read again keeps it). Cancelled and optional entries keep their marks, so every
// return leaves them out exactly as before. Each entry says where it came from: v.src "bridge", else the Day Book.
// BookSrc: the whole object is in server/_shared/gst3b.js (the GSTR-3B engine, shared with the gst-run function)
