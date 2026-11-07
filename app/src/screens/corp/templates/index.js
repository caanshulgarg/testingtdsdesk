// The documents of Resolutions & minutes: ten templates to start (07-Nov-2026, the owner's list) and the minutes.
// Each template is a data file (its text with {{fields}} and the fields' schema) with a header comment that its
// wording is to be checked by a Company Secretary before use.
import bankOpen from "./bank-open.js";
import bankSignatories from "./bank-signatories.js";
import additionalDirector from "./additional-director.js";
import directorResignation from "./director-resignation.js";
import accountsApproval from "./accounts-approval.js";
import firstAuditor from "./first-auditor.js";
import casualVacancy from "./casual-vacancy.js";
import officeShift from "./office-shift.js";
import borrowing from "./borrowing.js";
import boardNotice from "./board-notice.js";
import minutes from "./minutes.js";

export const TEMPLATES = [bankOpen, bankSignatories, additionalDirector, directorResignation, accountsApproval, firstAuditor, casualVacancy, officeShift, borrowing, boardNotice];
export const MINUTES = minutes;
export const ALL = TEMPLATES.concat([minutes]);
export const byKey = (k) => ALL.find((t) => t.key === k) || null;
export const GROUPS = ["All", "Banking", "Directors & KMP", "Accounts & audit", "Registered office", "General meetings"];
