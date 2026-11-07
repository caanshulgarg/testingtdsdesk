/* Board resolution: borrowing (s.179(3)(d) Companies Act 2013: by a resolution at a meeting of the Board). A public company
   needs the members' special resolution under s.180(1)(c) to borrow beyond its paid-up capital, free reserves and
   securities premium; s.180 does not apply to a private company (notification GSR 464(E) of 05-Jun-2015), so the words on
   it are a public company's only ([[public:...]]).
   Wording to be checked by a Company Secretary before use. */
export default {
  key: "borrowing", title: "Borrowing", kind: "resolution", law: "s.179(3)(d)", group: "Banking",
  fields: [
    { k: "lender", label: "Lender", type: "text", ph: "Bank or lender" },
    { k: "facility", label: "Facility", type: "text", def: "a term loan" },
    { k: "amount", label: "Amount (₹)", type: "money" },
    { k: "security", label: "Security", type: "text", def: "the hypothecation of the Company's current assets" },
    { k: "signers", label: "Authorised to sign the loan documents", type: "directors", def: "first1" },
  ],
  subject: "Borrowing of ₹{{amount}} from {{lender}}",
  minute: "The Chairman informed the Board of the proposal to avail {{facility}} of ₹{{amount}} from {{lender}} for the business of the Company[[public:, and that the borrowing is within the limits of section 180(1)(c) of the Companies Act, 2013]]. After discussion, the Board passed the following resolution unanimously:",
  text: `RESOLVED THAT pursuant to section 179(3)(d) of the Companies Act, 2013 and the rules made thereunder, the consent of the Board be and is hereby accorded to borrow from {{lender}} by way of {{facility}} an amount not exceeding ₹{{amount}}, on the terms and conditions offered by {{lender}}, secured by {{security}}.

RESOLVED FURTHER THAT the following Directors be and are hereby authorised, severally, to negotiate and accept the terms, to sign the loan agreement, the documents of security and such other papers as may be required, and to do all such acts as may be necessary to give effect to this resolution:

{{signers:list}}

RESOLVED FURTHER THAT the Common Seal of the Company, if any, be affixed to the documents that need it, in the presence of any Director, and that the charge created be registered with the Registrar of Companies in Form CHG-1 within 30 days.`,
  note: "[[public:Check the s.180(1)(c) limit (a special resolution of the members beyond it); ]]CHG-1 within 30 days of creating the charge.",
};
