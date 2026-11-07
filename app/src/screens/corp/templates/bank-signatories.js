/* Board resolution: change of the authorised signatories of a bank account (s.179 Companies Act 2013).
   Wording to be checked by a Company Secretary before use. */
export default {
  key: "bank-signatories", title: "Change of bank signatories", kind: "resolution", law: "s.179", group: "Banking",
  fields: [
    { k: "bank", label: "Bank", type: "text", ph: "Bank name" },
    { k: "branch", label: "Branch", type: "text", ph: "Branch" },
    { k: "account", label: "Account number", type: "text", ph: "Account number" },
    { k: "removed", label: "Signatories removed", type: "text", ph: "Names, or none" },
    { k: "signatories", label: "Signatories from now on", type: "directors", def: "all" },
    { k: "mode", label: "Mode of operation", type: "choice", options: ["any one of the following authorised signatories, singly", "any two of the following authorised signatories, jointly"], def: "any one of the following authorised signatories, singly" },
  ],
  subject: "Change in the authorised signatories of account no. {{account}} with {{bank}}, {{branch}} branch",
  minute: "The Chairman informed the Board that the authorised signatories of the Company's account no. {{account}} with {{bank}}, {{branch}} branch, need to be changed. After discussion, the Board passed the following resolution unanimously:",
  text: `RESOLVED THAT in supersession of the earlier resolutions of the Board in this regard, {{removed}} shall cease to be authorised signatories of the Company's account no. {{account}} with {{bank}}, {{branch}} branch (the “Bank”), with immediate effect.

RESOLVED FURTHER THAT the said account be operated from now on by {{mode}}:

{{signatories:list}}

RESOLVED FURTHER THAT any Director of the Company be and is hereby authorised to inform the Bank, to submit the specimen signatures and such other documents as the Bank may require, and to do all such acts as may be necessary to give effect to this resolution, and that a copy of this resolution, certified to be true by any Director, be furnished to the Bank.`,
  note: "For the bank: a certified true copy, KYC and specimen signatures of the new signatories.",
};
