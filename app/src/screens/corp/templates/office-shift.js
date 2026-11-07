/* Board resolution: shifting of the registered office within the same city, town or village (s.12(5) Companies Act 2013:
   within the local limits, by the Board; INC-22 within 30 days, s.12(4) and rule 27).
   Wording to be checked by a Company Secretary before use. */
export default {
  key: "office-shift", title: "Shifting of registered office within the same city", kind: "resolution", law: "s.12", group: "Registered office", form: "INC-22",
  fields: [
    { k: "fromAddr", label: "From (present address)", type: "text", def: "profile.office" },
    { k: "toAddr", label: "To (new address)", type: "text", ph: "New address" },
    { k: "from", label: "With effect from", type: "date" },
  ],
  subject: "Shifting of the registered office of the Company within the local limits",
  minute: "The Chairman informed the Board that, for administrative convenience, the registered office of the Company may be shifted within the local limits of the same city. After discussion, the Board passed the following resolution unanimously:",
  text: `RESOLVED THAT pursuant to section 12 of the Companies Act, 2013 and the rules made thereunder, the registered office of the Company be shifted from {{fromAddr}} to {{toAddr}}, within the local limits of the same city, town or village, with effect from {{from}}.

RESOLVED FURTHER THAT any Director of the Company be and is hereby authorised to file Form INC-22 with the Registrar of Companies with the proof of the new office, to inform the authorities concerned, and to do all such acts as may be necessary to give effect to this resolution.`,
  note: "INC-22 within 30 days, with proof of the office and a no-objection from its owner.",
};
