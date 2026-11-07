/* Board resolution: appointment of an additional director (s.161(1) Companies Act 2013; DIR-12 within 30 days, s.170(2)).
   Wording to be checked by a Company Secretary before use. */
export default {
  key: "additional-director", title: "Appointment of additional director", kind: "resolution", law: "s.161(1)", group: "Directors & KMP", form: "DIR-12",
  fields: [
    { k: "name", label: "Name of the person appointed", type: "text", ph: "Name" },
    { k: "din", label: "DIN", type: "text", ph: "00000000" },
    { k: "from", label: "Appointed with effect from", type: "date" },
    { k: "category", label: "Category", type: "choice", options: ["Non-executive Director", "Executive Director", "Independent Director"], def: "Non-executive Director" },
  ],
  subject: "Appointment of {{name}} (DIN {{din}}) as an Additional Director",
  minute: "The Chairman informed the Board that {{name}} (DIN {{din}}) had given consent in Form DIR-2 to act as a Director and the declaration that he or she is not disqualified under section 164 of the Companies Act, 2013. After discussion, the Board passed the following resolution unanimously:",
  text: `RESOLVED THAT pursuant to the provisions of section 161(1) of the Companies Act, 2013, the rules made thereunder and the Articles of Association of the Company, {{name}} (DIN {{din}}), who has given consent in Form DIR-2 and is not disqualified to be appointed a director, be and is hereby appointed as an Additional Director ({{category}}) of the Company with effect from {{from}}, to hold office up to the date of the next Annual General Meeting of the Company.

RESOLVED FURTHER THAT any Director of the Company be and is hereby authorised to file Form DIR-12 with the Registrar of Companies, to make the necessary entries in the statutory registers, and to do all such acts, deeds and things as may be necessary to give effect to this resolution.`,
  note: "With it: DIR-2 (consent), DIR-8 (not disqualified), MBP-1 (interest); DIR-12 within 30 days.",
};
