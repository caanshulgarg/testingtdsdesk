// e-Form due dates: the rules FinCom works the dates out by, in ONE place, each with the section or rule it rests on, so
// a Company Secretary can check them (and change them here when the law changes). Phase 1, 07-Nov-2026.
//
// FinCom does not file on the MCA portal: it works out what is due and when, prepares what it can, and keeps the SRN the
// person types back in after filing with DSC on the portal.
//
// DIR-3 KYC: how often, a SETTING (the review of 30f70eea6: not hard-coded). The owner decided (07-Nov-2026): Rule 12A of
// the Companies (Appointment and Qualification of Directors) Rules 2014 as amended, once every three financial years, by
// 30 June. "annual" (every year by 30 September, the rule before) is kept as the other choice.
//   triennial  the next KYC is due in the third financial year after the last one done, by 30 June after that year
//              (last done in FY 2023-24: due in FY 2026-27, by 30-Jun-2027); none recorded: due for the year, by 30 June
//   annual     every director holding a DIN on 31 March of the year, by 30 September after it
export const DIR3_KYC = {
  use: "triennial",
  triennial: { every: 3, month: 6, day: 30, words: "once every three financial years, by 30 June (rule 12A, as amended)" },
  annual: { every: 1, month: 9, day: 30, words: "every year by 30 September (rule 12A, before its amendment)" },
};
export const kycRule = () => DIR3_KYC[DIR3_KYC.use] || DIR3_KYC.triennial;
const dueOn = (y, r) => (y + 1) + "-" + String(r.month).padStart(2, "0") + "-" + String(r.day).padStart(2, "0");
// a director's KYC as at a year: {done, due, next, words}; kyc = the years the director's KYC was done (Directors & KMP).
// done: nothing to file for this year (filed this year, or, three-yearly, the next one falls in a later year); due: the
// date the next KYC is due; next: the financial year it falls in
export function kycFor(d, fy) {
  const r = kycRule(), y = +String(fy).slice(0, 4), done = (d.kyc || []).map((x) => +String(x).slice(0, 4)).filter((z) => z <= y);
  const last = done.length ? Math.max(...done) : null;
  if (r.every === 1) return { done: done.includes(y), due: dueOn(y, r), next: y, words: r.words };
  const next = last == null ? y : last + r.every;
  const nfy = next + "-" + String(next + 1).slice(2);
  return { done: next > y, due: dueOn(next, r), next: nfy, words: r.words };
}

// a small company is a private company (s.2(85)): the tick is not used for a public or a section 8 company
const smallCo = (p) => !!p.small && (!p.cls || p.cls === "private");

// ANNUAL: the forms of every financial year. `from` is what the time limit runs from:
//   "agm"    the date of the AGM of the year (or, while it is not entered, the last day the AGM could be held: s.96(1),
//            six months from the end of the year, nine months for the first year)
//   "fixed"  a calendar day after the year: `month`, `day`, `yearAfter` (0 = the calendar year in which the year ends)
//   "fyEnd"  `days` after the end of the year (31 March)
//   "agmLast" `days` after the last day the AGM could be held (an OPC holds none, s.96(1))
//   "half"   MSME-1, twice a year, for each half-year
// `applies(p)` -> true, or the reason it is not needed (shown as "Not needed: ..."); p is the company's profile.
export const ANNUAL = [
  { form: "AOC-4", what: "Financial statements", from: "agm", days: 30, steps: ["Statements", "Figures in AOC-4 order", "Attachments", "Ready for MCA"],
    law: "s.137(1) Companies Act 2013; rule 12(2) Companies (Accounts) Rules 2014: within 30 days of the AGM. OPC: within 180 days of the end of the year (s.137(1), first proviso).",
    opc: { from: "fyEnd", days: 180 }, // 27 September
    applies: () => true, builder: "aoc4", tell: "from Books or upload" },
  { form: "MGT-7", what: "Annual return", from: "agm", days: 60, steps: ["Shareholders & directors", "Meetings held", "Attachments", "Checked"],
    law: "s.92(4) Companies Act 2013; rule 11(1) Companies (Management and Administration) Rules 2014: within 60 days of the AGM (or of the day it should have been held).",
    applies: (p) => (p.cls === "opc" || smallCo(p) ? "a small company or OPC files MGT-7A instead (rule 11(1), from FY 2020-21)" : true) },
  { form: "MGT-7A", what: "Annual return · small company / OPC", from: "agm", days: 60, steps: ["Shareholders & directors", "Meetings held", "Attachments", "Checked"],
    law: "s.92(4) Companies Act 2013; rule 11(1) Companies (Management and Administration) Rules 2014 (as amended 2021): small companies and OPCs, within 60 days of the AGM.",
    opc: { from: "agmLast", days: 60 }, // an OPC holds no AGM: 60 days from the day it would have been due (29 November)
    applies: (p) => (p.cls === "opc" || smallCo(p) ? true : "only small companies and OPCs file MGT-7A (rule 11(1))") },
  { form: "ADT-1", what: "Appointment of auditor", from: "agm", days: 15, steps: ["Auditor's consent & certificate", "Resolution", "Attachments", "Checked"],
    law: "s.139(1) Companies Act 2013; rule 4(2) Companies (Audit and Auditors) Rules 2014: within 15 days of the meeting at which the auditor is appointed.",
    applies: (p, fy) => (!p.auditorTill || p.auditorTill <= fy ? true : "the auditor continues: appointed till the AGM of FY " + p.auditorTill) },
  { form: "DIR-3 KYC", what: "Director KYC", from: "kyc", perDirector: true, steps: ["Details & OTP", "DSC", "Checked", "Ready"],
    law: "Rule 12A Companies (Appointment and Qualification of Directors) Rules 2014: every director holding a DIN; as amended, once every three financial years by 30 June (DIR-3 KYC or DIR-3 KYC-WEB); how often is the setting DIR3_KYC above.",
    applies: () => true },
  { form: "DPT-3", what: "Return of deposits & outstanding loans", from: "fixed", month: 6, day: 30, yearAfter: 0, steps: ["Loans & receipts listed", "Auditor's certificate", "Attachments", "Checked"],
    law: "Rule 16 Companies (Acceptance of Deposits) Rules 2014: by 30 June, as at 31 March (also for receipts that are not deposits, rule 2(1)(c)).",
    applies: () => true },
  { form: "MSME-1", what: "Dues to micro & small suppliers over 45 days · half-yearly", from: "half", steps: ["Dues listed", "Reasons", "Checked", "Ready"],
    law: "Specified Companies (Furnishing of information about payment to micro and small enterprise suppliers) Order 2019 (s.405): by 31 October for April–September and by 30 April for October–March, when such dues are outstanding over 45 days.",
    halves: [{ key: "H1", label: "Apr–Sep", month: 10, day: 31, yearAfter: -1 }, { key: "H2", label: "Oct–Mar", month: 4, day: 30, yearAfter: 0 }],
    applies: (p) => (p.msmeNone ? "no dues to micro or small suppliers over 45 days" : true) },
];

// EVENT: a form started when something happens in the company; the time limit runs from the event's date.
// `resolution`: the template of Resolutions & minutes that goes with it (templates/), when there is one.
export const EVENT = [
  { form: "DIR-12", event: "Director appointed or resigned", days: 30, resolution: "additional-director",
    law: "s.168(1) and s.170(2) Companies Act 2013; rule 18 Companies (Appointment and Qualification of Directors) Rules 2014: within 30 days of the appointment or the cessation." },
  { form: "INC-22", event: "Registered office shifted", days: 30, resolution: "office-shift",
    law: "s.12(4) Companies Act 2013; rule 27 Companies (Incorporation) Rules 2014: within 30 days of the change." },
  { form: "PAS-3", event: "Shares allotted", days: 15,
    law: "s.39(4) and s.42 Companies Act 2013; rule 12 Companies (Prospectus and Allotment of Securities) Rules 2014: within 15 days of the allotment." },
  { form: "SH-7", event: "Authorised capital increased", days: 30,
    law: "s.64(1) Companies Act 2013: within 30 days of the alteration of the share capital." },
  { form: "MGT-14", event: "Special resolution passed", days: 30,
    law: "s.117(1) and s.117(3) Companies Act 2013: within 30 days of passing the resolution (board resolutions under s.179(3) are exempt for private companies, s.462 notification of 05-Jun-2015)." },
  { form: "CHG-1", event: "Loan secured on assets", days: 30,
    law: "s.77(1) Companies Act 2013 (as amended 2019): within 30 days of creating the charge; 60 more days with additional fees (proviso); rule 3 Companies (Registration of Charges) Rules 2014." },
  { form: "ADT-1", event: "Auditor appointed", days: 15, resolution: "first-auditor",
    law: "s.139 Companies Act 2013; rule 4(2) Companies (Audit and Auditors) Rules 2014: within 15 days of the meeting that appointed the auditor (a casual vacancy, s.139(8), too)." },
  { form: "ADT-3", event: "Auditor resigned", days: 30, resolution: "casual-vacancy",
    law: "s.140(2) Companies Act 2013; rule 8 Companies (Audit and Auditors) Rules 2014: the auditor files within 30 days of resigning (the company fills the casual vacancy, s.139(8))." },
  { form: "INC-20A", event: "New company: commencement of business", days: 180,
    law: "s.10A(1)(a) Companies Act 2013; rule 23A Companies (Incorporation) Rules 2014: within 180 days of incorporation (companies with share capital)." },
];

// the four steps of a form: n of 4 done is "In progress (n of 4)"; all four is "Ready"; Filed needs its SRN and date
export const STATUS = { not_started: "Not started", in_progress: "In progress", ready: "Ready", filed: "Filed", not_needed: "Not needed" };
export const GENERIC_STEPS = ["Information collected", "Attachments ready", "Approved", "Checked"];
// an SRN as MCA gives it (V3: a letter and eight digits, e.g. "AB1234567"; V2: "R12345678"): checked loosely
export const srnOk = (s) => /^[A-Z][A-Z0-9]{6,11}$/.test(String(s || "").trim().toUpperCase());
