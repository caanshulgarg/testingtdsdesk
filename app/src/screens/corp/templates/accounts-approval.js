/* Board resolution: approval of the financial statements and the Board's report (s.134 Companies Act 2013). A One Person
   Company: one director signs the financial statements (s.134(1), [[opc:...]]); s.134(6) has no OPC exception: the
   Board's report as for every company (the Chairperson, or two directors, or the director where there is one). Otherwise, signing,
   s.134(1): the financial statements by the Chairperson where authorised by the Board, or by two directors, one of whom is
   the managing director where there is one, and by the CEO, the CFO and the company secretary where appointed; s.134(6):
   the Board's report by the Chairperson where authorised by the Board, or else by two directors, one of them the managing
   director where there is one.
   Wording to be checked by a Company Secretary before use. */
export default {
  key: "accounts-approval", title: "Approval of financial statements and Board's report", kind: "resolution", law: "s.134", group: "Accounts & audit",
  fields: [
    { k: "fyEnd", label: "Financial year ended", type: "date", def: "fyEnd" },
    { k: "signers", label: "The two Directors who sign (one the Managing Director, where there is one)", type: "directors", def: "first2" },
    { k: "agmDate", label: "AGM proposed on", type: "date" },
    { k: "agmTime", label: "AGM time", type: "text", def: "11:00 A.M." },
  ],
  subject: "Approval of the financial statements for the financial year ended {{fyEnd}} and the Board's report",
  minute: "The draft financial statements of the Company for the financial year ended {{fyEnd}}, together with the draft Board's report, were placed before the Board. After discussion, the Board passed the following resolution unanimously:",
  text: `RESOLVED THAT pursuant to section 134 of the Companies Act, 2013 and the rules made thereunder, the financial statements of the Company for the financial year ended {{fyEnd}}, comprising the balance sheet as at that date, the statement of profit and loss and the cash flow statement (where applicable) for the year then ended, and the notes thereto, as placed before the Board, be and are hereby approved.

RESOLVED FURTHER THAT the Board's report for the said financial year, as placed before the Board, be and is hereby approved.

[[notopc:RESOLVED FURTHER THAT the financial statements be signed on behalf of the Board by the Chairperson of the Company where authorised by the Board, or else by the following two Directors, one of whom is the Managing Director where there is one, and by the Chief Executive Officer, the Chief Financial Officer and the Company Secretary of the Company, where they are appointed:]][[opc:RESOLVED FURTHER THAT the financial statements be signed on behalf of the Board by the following Director, the Company being a One Person Company (section 134(1) of the Companies Act, 2013):]]

{{signers:list}}

RESOLVED FURTHER THAT the Board's report be signed by the Chairperson of the Company where authorised by the Board, or else by at least two Directors, one of whom is the Managing Director where there is one, or by the Director where there is one Director (section 134(6)).

RESOLVED FURTHER THAT the Annual General Meeting of the Company be held on {{agmDate}} at {{agmTime}} at the registered office of the Company, and that any Director be and is hereby authorised to issue the notice of the meeting to the members.`,
  note: "Then: the AGM; AOC-4 within 30 days of it, MGT-7/7A within 60 days.",
};
