// The new look's five status words (New · To review · Ready · Done · Problem; docs/UX-QUICKBOOKS-OF-INDIA.md §5), with
// a short "where" after them, for a bank line's states. Read by the Bank page's files only while the new look is on.
export const NL_BST = { attention: ["warn", "To review · no ledger"], suggested: ["warn", "To review · suggested"], ready: ["nl-ready", "Ready"], sent: ["ok", "Done · in Tally"], intally: ["ok", "Done · already in Tally"], ignored: ["no", "Set aside"] };
// a status word's tone (newlook.css .nl-pill[data-tone])
export const TONE = { New: "slate", "To review": "amber", Ready: "sky", Done: "emerald", Problem: "rose" };
export const toneOf = (w) => TONE[String(w || "").split(" · ")[0]] || "slate";
