// "How this page works" (clean-up batch 3, 11-Oct-2026): a short word on what a page is for and how to use it, folded
// to one line until asked for. For the pages with no guide article of their own behind the top bar's "How this tab
// works" (Overview, Transactions, Financial statements, Client setup).
const WORDS = {
  dash: ["Where this client stands, and what to do next.",
    "Getting ready lists the steps that let FinCom work for this client; it folds away once they are done. The four counts open their pages: bills to read and review, bills ready to post, and bank lines to review. More about this client holds TDS, Bank and Sales at a glance."],
  txn: ["Every document uploaded for this client in one register: purchase bills, sales invoices and bank lines.",
    "Choose Purchase, Sales or Bank at the top, find by number, party, file or amount, and choose the columns you want. Download gives the list as Excel or CSV. Nothing here changes Tally."],
  fs: ["The balance sheet, profit and loss, cash flow, notes and computation of income, made from the trial balance brought in from Tally.",
    "Each ledger has a code that places it in a note (Trial balance & mapping); FinCom suggests one from its Tally group, and a code chosen by hand is remembered for the next year too. Click a figure to see its note, and a note’s line to see its ledgers. Checks must all read 0."],
  setup: ["This client’s own details and choices: the company, its suppliers and customers, Tally, GST and the rest.",
    "Choose a section on the left. A change is kept as a draft until you press Save, which shows only when something has changed."],
};

export default function HowPage({ page }) {
  const w = WORDS[page];
  if (!w) return null;
  return <details className="howto" data-howto={page}><summary>How this page works</summary><div>{w.map((t, i) => <p key={i}>{t}</p>)}</div></details>;
}
