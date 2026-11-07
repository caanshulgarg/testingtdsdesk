/* Board resolution: appointment of the first auditor (s.139(6) Companies Act 2013: by the Board within 30 days of
   incorporation, to hold office till the first AGM; ADT-1 within 15 days, rule 4(2)).
   Wording to be checked by a Company Secretary before use. */
export default {
  key: "first-auditor", title: "Appointment of first auditor", kind: "resolution", law: "s.139(6)", group: "Accounts & audit", form: "ADT-1",
  fields: [
    { k: "firm", label: "Audit firm", type: "text", ph: "Firm name", def: "profile.auditor" },
    { k: "frn", label: "Firm registration no.", type: "text", ph: "FRN", def: "profile.auditorFrn" },
    { k: "fee", label: "Remuneration", type: "text", ph: "as mutually agreed", def: "as may be mutually agreed between the Board and the auditors" },
  ],
  subject: "Appointment of {{firm}} as the first auditors of the Company",
  minute: "The Chairman informed the Board that {{firm}}, Chartered Accountants (FRN {{frn}}), had given their consent and the certificate under section 141 of the Companies Act, 2013. After discussion, the Board passed the following resolution unanimously:",
  text: `RESOLVED THAT pursuant to section 139(6) of the Companies Act, 2013 and the rules made thereunder, {{firm}}, Chartered Accountants (Firm Registration No. {{frn}}), be and are hereby appointed as the first auditors of the Company, to hold office from the conclusion of this meeting until the conclusion of the first Annual General Meeting of the Company, at a remuneration {{fee}}.

RESOLVED FURTHER THAT any Director of the Company be and is hereby authorised to inform the auditors of their appointment, to file Form ADT-1 with the Registrar of Companies, and to do all such acts as may be necessary to give effect to this resolution.`,
  note: "With it: the auditor's consent and certificate (s.139(1), s.141); ADT-1 within 15 days.",
};
