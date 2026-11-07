/* Board resolution: noting the resignation of a director (s.168 Companies Act 2013; DIR-12 within 30 days, rule 15).
   Wording to be checked by a Company Secretary before use. */
export default {
  key: "director-resignation", title: "Resignation of director", kind: "resolution", law: "s.168", group: "Directors & KMP", form: "DIR-12",
  fields: [
    { k: "director", label: "Director who resigned", type: "director" },
    { k: "letter", label: "Resignation letter dated", type: "date" },
    { k: "from", label: "Resignation effective from", type: "date" },
  ],
  subject: "Resignation of {{director}} (DIN {{director.din}}) from the Board",
  minute: "The Chairman informed the Board of the letter dated {{letter}} from {{director}} (DIN {{director.din}}) resigning from the office of Director of the Company. The Board took note of it and passed the following resolution unanimously:",
  text: `RESOLVED THAT pursuant to the provisions of section 168 of the Companies Act, 2013 and the rules made thereunder, the Board hereby takes note of the resignation of {{director}} (DIN {{director.din}}) from the office of Director of the Company, tendered by the letter dated {{letter}}, with effect from {{from}}.

RESOLVED FURTHER THAT the Board places on record its appreciation of the services rendered by {{director}} during the tenure as a Director of the Company.

RESOLVED FURTHER THAT any other Director of the Company be and is hereby authorised to file Form DIR-12 with the Registrar of Companies, to make the necessary entries in the statutory registers, and to do all such acts as may be necessary to give effect to this resolution.`,
  note: "DIR-12 within 30 days (the director may file DIR-11).",
};
