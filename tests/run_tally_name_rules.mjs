// node tests/run_tally_name_rules.mjs - the one rule for linking a client to its Tally company (server/_shared/tallyname.js,
// 23-Oct-2026: Salesify was linked by itself to VMS EVENTS, and its own company "SALESIFY MARKETING LLP - (from 1-Apr-25)"
// never matched "Salesify Marketing LLP"). The names are the firm's own from staging.
import { tallyNameKey, sameTallyName, tallyYearKey, autoLinkFor, suggestFor, similarClients, clientNameFromTally } from "../server/_shared/tallyname.js";
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };

// 1. the normaliser: periods, LLP, Pvt Ltd, &, punctuation, case
const same = [
  ["Salesify Marketing LLP", "SALESIFY MARKETING LLP - (from 1-Apr-25)"],
  ["VMS Events Pvt. Ltd.", "VMS EVENTS PRIVATE LIMITED (2024-25)"],
  ["Master Cad Infra Solutions Pvt Ltd", "Master Cad Infra Solutions Private Limited (FY:25-26)"],
  ["Garg Shekhar and Company", "GARG SHEKHAR & COMPANY"],
  ["M/s Leads Insurance Brokers Private Limited", "LEADS INSURANCE BROKERS PVT LTD"],
  ["Alpha Traders L.L.P.", "ALPHA TRADERS LLP (from 1-Apr-2024)"],
  ["Beta (P) Ltd", "BETA PVT LTD - from 1-Apr-25"],
];
same.forEach(([a, b]) => ok(sameTallyName(a, b), "same company: " + JSON.stringify(a) + " = " + JSON.stringify(b) + " (" + tallyNameKey(a) + " | " + tallyNameKey(b) + ")"));
const differ = [["Salesify Marketing LLP", "VMS EVENTS PRIVATE LIMITED (2024-25)"], ["Alpha Traders", "Alpha Traders Two"], ["GB Texcoat", "GB TEXCOAT SOLUTION PRIVATE LIMITED"]];
differ.forEach(([a, b]) => ok(!sameTallyName(a, b), "not the same: " + JSON.stringify(a) + " / " + JSON.stringify(b)));
ok(clientNameFromTally("SALESIFY MARKETING LLP - (from 1-Apr-25)") === "SALESIFY MARKETING LLP", "a client's name from a Tally company: the period taken off");
ok(clientNameFromTally("Master Cad Infra Solutions Private Limited (FY:25-26)") === "Master Cad Infra Solutions Private Limited", "(FY:25-26) taken off");

// 2. automatic links: only the certain ones
const S1 = { id: "cmvkrssmhbi53l", name: "Salesify Marketing LLP", gstin: "", tallyName: "VMS EVENTS PRIVATE LIMITED (2024-25)" };
const S2 = { id: "cmvkrtpqqr6z9j", name: "Salesify Marketing LLP", gstin: "06AEVFS5010H1ZV", tallyName: "Salesify Marketing LLP" };
const GS = { id: "cmupe4m7upncpy", name: "Garg Shekhar & Company", gstin: "09AANFG3202D1ZR" };
const VMS = { name: "VMS EVENTS PRIVATE LIMITED (2024-25)", gstin: "" }, SAL = { name: "SALESIFY MARKETING LLP - (from 1-Apr-25)", gstin: "" };
ok(autoLinkFor(VMS, [S1, GS], []) === null, "a client whose Tally name (only) is VMS EVENTS is never linked to it by itself (the 23-Oct link)");
ok(autoLinkFor(SAL, [S1, S2, GS], []) === null, "two clients named Salesify Marketing LLP: nothing linked by itself, a person chooses");
const one = autoLinkFor(SAL, [S2, GS], []);
ok(one && one.client.id === S2.id && one.why === "name", "one client named Salesify Marketing LLP: linked by the normalised name (" + JSON.stringify(one) + ")");
ok(autoLinkFor(SAL, [S2, GS], new Set([S2.id])) === null, "not when that client is linked to another company already");
ok(autoLinkFor({ name: "SALESIFY MARKETING LLP - (from 1-Apr-25)", gstin: "09AANFG3202D1ZR" }, [S2, GS], []).client.id === GS.id, "the GSTIN wins over the name (same GSTIN as Garg Shekhar)");
const g = autoLinkFor({ name: "GSC NEW BOOKS 2026", gstin: "09AANFG3202D1ZR" }, [S2, GS], []);
ok(g && g.client.id === GS.id && g.why === "gstin", "same GSTIN, another name: linked (gstin)");
ok(autoLinkFor({ name: "SALESIFY MARKETING LLP", gstin: "09AAAAA0000A1Z5" }, [S2], []) === null, "same name but another PAN's GSTIN: not linked");
ok(autoLinkFor({ name: "GARG SHEKHAR & COMPANY", gstin: "" }, [Object.assign({}, GS, { deleted: true })], []) === null, "a removed client is never linked");

// 3. suggestions: the likely ones on top, others kept; linked to another client: left out
const seen = [
  { company: "VMS EVENTS PRIVATE LIMITED (2024-25)", gstin: "", client: S1.id },
  { company: "SALESIFY MARKETING LLP - (from 1-Apr-25)", gstin: "", client: "" },
  { company: "ABC LTD", gstin: "", client: "" },
  { company: "GARG SHEKHAR & COMPANY", gstin: "09AANFG3202D1ZR", client: GS.id },
];
const sg = suggestFor(S2, seen);
ok(sg.map((x) => x.company).join("|") === "SALESIFY MARKETING LLP - (from 1-Apr-25)|ABC LTD" && sg[0].why === "name", "Salesify (the 2nd): its company on top, ABC LTD after, the linked ones left out (" + sg.map((x) => x.company + ":" + x.why).join(", ") + ")");
const s1 = suggestFor(S1, seen);
ok(s1[0].company === "VMS EVENTS PRIVATE LIMITED (2024-25)" || s1[0].company === "SALESIFY MARKETING LLP - (from 1-Apr-25)", "Salesify (the 1st): its own link kept in the list");
ok(s1.findIndex((x) => x.company.startsWith("SALESIFY")) < s1.findIndex((x) => x.company === "ABC LTD"), "Salesify's company above ABC LTD for the 1st Salesify too");

// 4. duplicates
const d = similarClients("salesify marketing llp.", "", [S2, GS]);
ok(d.length === 1 && d[0].client.id === S2.id && d[0].why === "same", "a new client 'salesify marketing llp.' is the same as Salesify Marketing LLP");
ok(similarClients("Zeta Ltd", "06AEVFS5010H1ZV", [S2, GS])[0].why === "gstin", "the same GSTIN is a duplicate whatever the name");
ok(similarClients("Salesify Marketing", "", [S2])[0].why === "like", "a name much alike is said too");
ok(similarClients("Gamma Industries", "", [S2, GS]).length === 0, "another name: no warning");
// 5. years of one business (24-Oct-2026, next-tally-one-page): a bare year at the end is one more period; the automatic
// rule (tallyNameKey, autoLinkFor) is unchanged
ok(tallyYearKey("Salesify Marketing LLP 2026-27") === tallyYearKey("SALESIFY MARKETING LLP - (from 1-Apr-25)"), "a new year 'Salesify Marketing LLP 2026-27' is the same business as '- (from 1-Apr-25)'");
ok(tallyYearKey("VMS EVENTS PRIVATE LIMITED (2024-25)") === tallyYearKey("VMS Events Pvt Ltd FY 2025-26"), "'FY 2025-26' too");
ok(tallyYearKey("Company 21") !== tallyYearKey("Company") && tallyYearKey("Alpha 123 Traders") === "alpha 123 traders", "a number that is not a year stays");
ok(!sameTallyName("Salesify Marketing LLP 2026-27", "Salesify Marketing LLP"), "tallyNameKey unchanged: FinCom does not link a bare-year company by itself");
// 6. a split company's date (31-Oct-2026; the owner: "this is different tally and splitted.. I need to connect to April 2018
// tally only.. I should have option to choose"): taken off to compare and suggest, never to link by itself
const POST = { id: "c-kestrel", name: "Kestrel Advisory Private Limited", gstin: "" };
[["Kestrel Advisory Private Limited 01 Apr 2018"], ["Kestrel Advisory Private Limited (from 1-Apr-2018)"], ["Kestrel Advisory Private Limited 2024-25"],
 ["Kestrel Advisory Private Limited (2024-25)"], ["Kestrel Advisory Private Limited from 01-04-2018"], ["Kestrel Advisory Private Limited - 1st April 2018"]].forEach(([n]) =>
  ok(clientNameFromTally(n) === "Kestrel Advisory Private Limited", "the split's date off: " + JSON.stringify(n) + " -> " + JSON.stringify(clientNameFromTally(n))));
["Studio 2020 Pvt Ltd", "Hotel 24-7 Services", "Garg Shekhar & Company", "Route 66 Traders"].forEach((n) => ok(clientNameFromTally(n) === n, "a name with a number kept whole: " + JSON.stringify(n)));
const sp = similarClients(clientNameFromTally("Kestrel Advisory Private Limited 01 Apr 2018"), "", [POST, GS]);
ok(sp.length === 1 && sp[0].client.id === POST.id && sp[0].why === "same", "the client of that name is found for the split company (" + JSON.stringify(sp.map((x) => x.why)) + ")");
ok(autoLinkFor({ name: "Kestrel Advisory Private Limited 01 Apr 2018", gstin: "" }, [POST], []) === null, "a split company is never linked by itself (a person chooses which split)");
ok(!sameTallyName("Kestrel Advisory Private Limited 01 Apr 2018", "Kestrel Advisory Private Limited"), "the splits stay different companies to tallyNameKey");

console.log(fails ? "\n" + fails + " failed" : "\nall passed");
process.exit(fails ? 1 : 0);
