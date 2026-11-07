/* Minutes of a meeting of the Board (s.118 Companies Act 2013; rule 25 Companies (Management and Administration) Rules
   2014; Secretarial Standard SS-1 para 7): the attendance, the Chairman, the quorum (s.174: one third of the total
   strength or two directors, whichever is higher), the standard items, the business transacted with each resolution in
   full, each page numbered and initialled by the Chairman, the last page signed and dated by him or her.
   Wording to be checked by a Company Secretary before use.
   The business items are picked from the board resolution templates (templates/*.js: each has `minute`, the words that
   introduce its resolution in minutes). */
export default {
  key: "minutes", title: "Minutes of board meeting", kind: "minutes", law: "s.118 · SS-1", group: "General meetings",
  fields: [
    { k: "serial", label: "Serial no.", type: "text", ph: "3/2026-27" },
    { k: "startPage", label: "First page no. in the minutes book", type: "text", def: "1" },
    { k: "endTime", label: "Meeting ended at", type: "text", def: "12:00 Noon" },
    { k: "inAttendance", label: "In attendance", type: "text", ph: "Company Secretary, Statutory Auditor (optional)" },
    { k: "prevDate", label: "Previous board meeting held on", type: "date", def: "profile.lastBoard" },
    { k: "signedOn", label: "Minutes signed on", type: "date" },
  ],
  // the standard items, in order; each may be taken out except the Chairman and the quorum
  standard: [
    { k: "chair", title: "Chairman", fixed: true, text: "{{chairman}} took the Chair. The Chairman welcomed the Directors and, the requisite quorum being present throughout the meeting, called the meeting to order.",
      // the attendance short of the quorum (s.174): said so; such minutes cannot be marked Final
      noQuorum: "{{chairman}} took the Chair. The quorum required under section 174 of the Companies Act, 2013 was not present." },
    { k: "leave", title: "Leave of absence", text: "{{leaveText}}" },
    { k: "prev", title: "Confirmation of the minutes of the previous meeting", text: "The minutes of the meeting of the Board held on {{prevDate}}, circulated in draft and taken as read, were confirmed and signed by the Chairman." },
    { k: "mbp", title: "Disclosure of interest", text: "The Board noted the disclosures of interest received from the Directors in Form MBP-1 under section 184(1) of the Companies Act, 2013, and the declarations in Form DIR-8 under section 164(2)." },
  ],
  close: { title: "Vote of thanks", text: "There being no other business, the meeting ended at {{endTime}} with a vote of thanks to the Chair." },
  attendance: ["In person", "Video conference", "Leave of absence", "Absent"],
};
