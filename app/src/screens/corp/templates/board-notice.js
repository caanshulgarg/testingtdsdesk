/* Notice of a meeting of the Board (s.173(3) Companies Act 2013: at least seven days' notice in writing to every director
   at the address registered with the company; SS-1 para 1.3: with the agenda and the notes on it).
   Wording to be checked by a Company Secretary before use. */
export default {
  key: "board-notice", title: "Notice of board meeting", kind: "notice", law: "s.173(3)", group: "General meetings",
  fields: [
    { k: "serial", label: "Meeting serial no.", type: "text", ph: "3/2026-27" },
    { k: "noticeDate", label: "Date of this notice", type: "date", def: "today" },
    { k: "agenda", label: "Agenda (one item a line)", type: "lines", def: "To grant leave of absence, if any\nTo confirm the minutes of the previous meeting of the Board\nTo note the disclosures of interest of the Directors (Form MBP-1)\nAny other business with the permission of the Chair" },
    { k: "signer", label: "Signed by", type: "director" },
  ],
  subject: "Notice of the meeting {{serial}} of the Board of Directors",
  text: `NOTICE is hereby given that the meeting {{serial}} of the Board of Directors of {{company}} will be held on {{meetingDay}}, {{meetingDate}} at {{meetingTime}} {{atVenue}}, to transact the following business:

{{agenda:lines}}

[[shortNotice=yes:The meeting is called at a notice shorter than seven days to transact urgent business (proviso to section 173(3) of the Companies Act, 2013); at least one independent director, where the Company has one, is to be present at it.]]

The notes on the agenda are enclosed. A Director who wishes to take part through video conferencing or other audio-visual means is requested to say so in advance, so that the arrangements can be made (rule 3 of the Companies (Meetings of Board and its Powers) Rules, 2014).`,
  note: "Seven days' notice at least (s.173(3)); a shorter notice only for urgent business, with an independent director present where the company has one.",
};
