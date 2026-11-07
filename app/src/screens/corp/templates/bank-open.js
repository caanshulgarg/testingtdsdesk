/* Board resolution: opening of a bank account (s.179 Companies Act 2013: the Board's powers).
   Wording to be checked by a Company Secretary before use.
   A template: `text` with {{fields}}; the meeting's fields (date, time, venue, place, the director who signs the certified
   copy) and {{company}} are every resolution's own (docModel.js). A paragraph starting "RESOLVED" is printed with those
   words in bold; a line {{field:list}} is the directors picked, one a line with their designation and DIN. */
export default {
  key: "bank-open", title: "Opening of bank account", kind: "resolution", law: "s.179", group: "Banking",
  fields: [
    { k: "bank", label: "Bank", type: "text", ph: "Bank name" },
    { k: "branch", label: "Branch", type: "text", ph: "Branch" },
    { k: "acType", label: "Type of account", type: "choice", options: ["current", "savings", "cash credit / overdraft"], def: "current" },
    { k: "signatories", label: "Authorised signatories", type: "directors", def: "all" },
    { k: "mode", label: "Mode of operation", type: "choice", options: ["any one of the following authorised signatories, singly", "any two of the following authorised signatories, jointly"], def: "any one of the following authorised signatories, singly" },
  ],
  subject: "Opening of a {{acType}} account with {{bank}}, {{branch}} branch",
  minute: "The Chairman informed the Board of the need to open a {{acType}} account with {{bank}}, {{branch}} branch, for the business of the Company. After discussion, the Board passed the following resolution unanimously:",
  text: `RESOLVED THAT pursuant to the provisions of section 179 of the Companies Act, 2013 read with the rules made thereunder, the consent of the Board of Directors be and is hereby accorded to open a {{acType}} account in the name of the Company with {{bank}}, {{branch}} branch (the “Bank”).

RESOLVED FURTHER THAT the said account be operated by {{mode}}:

{{signatories:list}}

RESOLVED FURTHER THAT the Bank be and is hereby authorised to honour cheques, bills of exchange, promissory notes and other instructions signed as above, and that any Director of the Company be and is hereby authorised to sign the account opening form and such other documents, and to do all such acts, deeds and things as may be necessary to give effect to this resolution.

RESOLVED FURTHER THAT a copy of this resolution, certified to be true by any Director of the Company, be furnished to the Bank.`,
  note: "For the bank: a certified true copy, KYC of each signatory, the MOA and AOA, the certificate of incorporation.",
};
