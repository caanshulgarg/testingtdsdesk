/* Board resolution: approval of the financial statements and the Board's report (s.134 Companies Act 2013).
   Wording to be checked by a Company Secretary before use. */
export default {
  key: "accounts-approval", title: "Approval of financial statements and Board's report", kind: "resolution", law: "s.134", group: "Accounts & audit",
  fields: [
    { k: "fyEnd", label: "Financial year ended", type: "date", def: "fyEnd" },
    { k: "signers", label: "Directors who sign the financial statements", type: "directors", def: "first2" },
    { k: "agmDate", label: "AGM proposed on", type: "date" },
    { k: "agmTime", label: "AGM time", type: "text", def: "11:00 A.M." },
  ],
  subject: "Approval of the financial statements for the financial year ended {{fyEnd}} and the Board's report",
  minute: "The draft financial statements of the Company for the financial year ended {{fyEnd}}, together with the draft Board's report, were placed before the Board. After discussion, the Board passed the following resolution unanimously:",
  text: `RESOLVED THAT pursuant to section 134 of the Companies Act, 2013 and the rules made thereunder, the financial statements of the Company for the financial year ended {{fyEnd}}, comprising the balance sheet as at that date, the statement of profit and loss and the cash flow statement (where applicable) for the year then ended, and the notes thereto, as placed before the Board, be and are hereby approved.

RESOLVED FURTHER THAT the Board's report for the said financial year, as placed before the Board, be and is hereby approved.

RESOLVED FURTHER THAT the financial statements be signed on behalf of the Board by the following Directors, and the Board's report by the Chairperson or by two Directors:

{{signers:list}}

RESOLVED FURTHER THAT the Annual General Meeting of the Company be held on {{agmDate}} at {{agmTime}} at the registered office of the Company, and that any Director be and is hereby authorised to issue the notice of the meeting to the members.`,
  note: "Then: the AGM; AOC-4 within 30 days of it, MGT-7/7A within 60 days.",
};
