// "How this page works" (clean-up batch 3, 11-Oct-2026): a short word on what a page is for and how to use it, folded
// to one line until asked for. For the pages with no guide article of their own behind the top bar's "How this tab
// works" (Overview, Transactions, Accounts, Client setup).
const WORDS = {
  dash: ["Where this client stands, and what to do next.",
    "Getting ready lists the steps that let FinCom work for this client; it folds away once they are done. The four counts open their pages: bills to read and review, bills ready to post, and bank lines to review. More about this client holds TDS, Bank and Sales at a glance."],
  txn: ["Every document uploaded for this client in one register: purchase bills, sales invoices and bank lines.",
    "Choose Purchase, Sales or Bank at the top, find by number, party, file or amount, and choose the columns you want. Download gives the list as Excel or CSV. Nothing here changes Tally."],
  fs: ["The balance sheet and the profit and loss, made from the books brought in from Tally.",
    "Choose the period and the format (Schedule III or ICAI) and the statements are drawn with their notes. Mapping says where each Tally group goes; change it there if a ledger sits in the wrong head."],
  setup: ["This client’s own details and choices: the company, its suppliers and customers, Tally, GST and the rest.",
    "Choose a section on the left. A change is kept as a draft until you press Save, which shows only when something has changed."],
};

export default function HowPage({ page }) {
  const w = WORDS[page];
  if (!w) return null;
  return <details className="howto" data-howto={page}><summary>How this page works</summary><div>{w.map((t, i) => <p key={i}>{t}</p>)}</div></details>;
}
