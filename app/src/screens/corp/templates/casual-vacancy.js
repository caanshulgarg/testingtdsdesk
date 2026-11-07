/* Board resolution: filling a casual vacancy in the office of the auditor (s.139(8)(i) Companies Act 2013: by the Board
   within 30 days; when the vacancy is caused by the auditor's resignation, the appointment is also to be approved by the
   members at a general meeting within three months of the Board's; any other cause (death, disqualification ...): the
   Board alone). The cause is a field: [[cause=...:...]] keeps the words for it.
   Wording to be checked by a Company Secretary before use. */
export default {
  key: "casual-vacancy", title: "Casual vacancy of auditor", kind: "resolution", law: "s.139(8)", group: "Accounts & audit", form: "ADT-1",
  fields: [
    { k: "cause", label: "The vacancy was caused by", type: "choice", options: ["resignation", "death, disqualification or another cause"], def: "resignation" },
    { k: "old", label: "Outgoing auditor", type: "text", ph: "Firm name" },
    { k: "oldOn", label: "The vacancy arose on", type: "date" },
    { k: "firm", label: "New audit firm", type: "text", ph: "Firm name" },
    { k: "frn", label: "Firm registration no.", type: "text", ph: "FRN" },
    { k: "egm", label: "Members' approval at", type: "text", def: "a general meeting of the Company to be held within three months" },
  ],
  subject: "Appointment of {{firm}} as auditors to fill the casual vacancy",
  minute: "The Chairman informed the Board of the [[cause=resignation:resignation of]][[cause!=resignation:vacancy in the office of]] {{old}}, the statutory auditors, on {{oldOn}}, which caused a casual vacancy in the office of the auditor, and that {{firm}} (FRN {{frn}}) had given their consent and the certificate under section 141. After discussion, the Board passed the following resolution unanimously:",
  text: `RESOLVED THAT pursuant to section 139(8) of the Companies Act, 2013 and the rules made thereunder, {{firm}}, Chartered Accountants (Firm Registration No. {{frn}}), be and are hereby appointed as the statutory auditors of the Company to fill the casual vacancy [[cause=resignation:caused by the resignation of {{old}} on {{oldOn}}, subject to the approval of the members at {{egm}}]][[cause!=resignation:in the office of {{old}} that arose on {{oldOn}}]], to hold office until the conclusion of the next Annual General Meeting of the Company.

RESOLVED FURTHER THAT any Director of the Company be and is hereby authorised to [[cause=resignation:convene the general meeting for the members' approval, to ]]file Form ADT-1 with the Registrar of Companies, and to do all such acts as may be necessary to give effect to this resolution.`,
  note: "[[cause=resignation:The outgoing auditor files ADT-3 within 30 days; the members approve within three months; ADT-1 after their approval.]][[cause!=resignation:The Board fills the vacancy alone, within 30 days; ADT-1 within 15 days.]]",
};
