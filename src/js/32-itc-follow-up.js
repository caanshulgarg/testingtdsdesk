/* ================================================================== */
/* ITC follow-up: what is kept for writing to suppliers               */
/* ================================================================== */
// Since next-itc-simple (24-Oct-2026) the follow-up is part of the 2B reconciliation: each line's decision is
// app/src/lib/itcSync.js (ITCDec, S.books.itcDec; the old decisions in itcTrack[reg].dec are read there, never lost), the
// letters to suppliers app/src/lib/itcFinal.js (ITCF.letters) and the 2B reconciliation's "Write to suppliers". What
// stays here is the store of the dates suppliers were written to and their contacts (itcTrack[reg].sent, .contact).
// ITCT: the whole object is in server/_shared/gst3b.js (the GSTR-3B engine, shared with the gst-run function)
