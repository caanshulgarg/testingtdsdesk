// node run_block17.js - blocked credit under section 17(5): 50 bills of the kinds a CA firm sees, each with the
// category it must (or must not) be flagged as. A change to the rules that brings back a false alarm fails here.
// Review item 1: an IT services bill (SAC 998314) was flagged "Membership of a club" from words elsewhere on the page.
// The bills are made up to look like real ones (codes, wording, ledgers); swap in real bills as they are collected.
const {load, HTML} = require("./harness");
const {x} = load(HTML, ["BLOCK_CATS", "blockRule", "billCodes", "suggestBlock"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const co = {gstBlock: {}};
// [what the bill is, expected category or null, description, [[item, hsn]...], expense ledger, page text (hint)]
const BILLS = [
  ["Shree Nandik Technologies: IT services", null, "Technical services - software support", [["Software support and maintenance", "998314"]], "Technical Services",
    "Shree Nandik Technologies ... Member of NASSCOM. Club membership no. 4471 of the Rotary Club. Membership fee paid. Thank you"],
  ["Software licence", null, "Annual licence renewal", [["Tally Prime Gold renewal", "997331"]], "Software Expenses", ""],
  ["Chartered accountant's audit fee", null, "Statutory audit fees FY 2025-26", [["Audit fee", "998221"]], "Audit Fees", "ICAI membership no. 401234"],
  ["Legal retainer", null, "Legal consultation", [["Professional fees", "998212"]], "Legal Expenses", ""],
  ["Office rent", null, "Rent for September 2026", [["Rent of office premises", "997212"]], "Rent", "Near Golf Course Road"],
  ["Hotel stay on business travel", null, "Room charges 2 nights", [["Room tariff", "996311"]], "Travelling Expenses", "Restaurant and bar on the ground floor"],
  ["Air ticket", null, "Air travel DEL-BOM", [["Air passenger transport", "996425"]], "Travelling Expenses", "Meals on board"],
  ["Courier", null, "Courier charges", [["Courier", "996812"]], "Courier Charges", ""],
  ["Internet", null, "Broadband charges", [["Internet access", "998422"]], "Internet Charges", ""],
  ["Mobile bill", null, "Postpaid bill", [["Telecom services", "998413"]], "Telephone Expenses", ""],
  ["Printing and stationery", null, "A4 paper and toner", [["A4 paper", "4802"], ["Toner", "8443"]], "Printing & Stationery", ""],
  ["Laptop purchase", null, "Dell Latitude laptop", [["Laptop", "8471"]], "Computers", ""],
  ["Raw material", null, "Steel sheets", [["CR sheet", "7209"]], "Purchase", ""],
  ["Job work", null, "Job work charges", [["Job work on customer's goods", "998898"]], "Job Work Charges", ""],
  ["Manpower supply", null, "Manpower supply September", [["Manpower", "998519"]], "Contract Labour", ""],
  ["Security agency (body corporate)", null, "Security guard services", [["Security services", "998525"]], "Security Charges", ""],
  ["Advertising", null, "Newspaper advertisement", [["Advertising space", "998363"]], "Advertisement", ""],
  ["Electricity repair", null, "Repair of DG set", [["Repair of generator", "998717"]], "Repairs & Maintenance", ""],
  ["Machinery purchase", null, "CNC lathe", [["Lathe", "8458"]], "Plant & Machinery", ""],
  ["Goods transport (GTA)", null, "Freight Delhi to Kanpur", [["Goods transport", "996511"]], "Freight Inward", ""],
  ["Consultancy with no codes", null, "Management consultancy for September", [], "Consultancy Charges", "Our partners are members of the Country Club"],
  ["Membership of a trade body", null, "Annual membership fee - CII", [["Membership services", "999511"]], "Subscription", ""],
  ["Professional body subscription (no code)", null, "ICAI annual membership fee", [], "Subscription", ""],
  ["Staff training", null, "Training programme", [["Commercial training", "999293"]], "Staff Training", "Lunch provided"],
  ["Housekeeping", null, "Housekeeping services", [["Cleaning services", "998533"]], "Housekeeping", ""],
  // must be flagged
  ["Restaurant bill", "food", "Food and beverages", [["Dinner", "996331"]], "Business Promotion", ""],
  ["Outdoor catering", "food", "Outdoor catering for event", [["Catering", "996334"]], "Staff Welfare", ""],
  ["Canteen contractor, no code", "food", "Canteen charges for September", [], "Staff Welfare", ""],
  ["Snacks bill by ledger", "food", "Office supplies", [], "Refreshments", ""],
  ["Car purchase", "motor", "Honda City ZX", [["Motor car", "87038040"]], "Vehicles", ""],
  ["Car insurance", "motor", "Private car package policy", [["Motor vehicle insurance", "997133"]], "Insurance", ""],
  ["Car servicing, no code", "motor", "Car service and repair", [], "Repairs & Maintenance", ""],
  ["Vehicle running by ledger", "motor", "Fuel and servicing", [], "Vehicle Running & Maintenance", ""],
  ["Gym membership", "club", "Gym membership for 12 months", [["Physical well-being", "999723"]], "Staff Welfare", ""],
  ["Golf club membership", "club", "Golf club annual subscription", [["Membership", "999599"]], "Subscription", ""],
  ["Fitness centre, no code", "club", "Fitness centre charges", [], "Staff Welfare", ""],
  ["Club by ledger", "club", "Annual subscription", [], "Club Membership", ""],
  ["Health insurance", "life_health_ins", "Group mediclaim policy", [["Health insurance", "997132"]], "Insurance", ""],
  ["Life insurance", "life_health_ins", "Term policy premium", [["Life insurance", "997131"]], "Insurance", ""],
  ["Mediclaim, no code", "life_health_ins", "Mediclaim premium for staff", [], "Insurance", ""],
  ["Hospital bill", "beauty_health", "Medical treatment of employee", [["Inpatient services", "999311"]], "Staff Welfare", ""],
  ["Salon", "beauty_health", "Salon services", [["Hairdressing", "999721"]], "Staff Welfare", ""],
  ["Spa, no code", "beauty_health", "Spa and cosmetic treatment", [], "Business Promotion", ""],
  ["Tour package for staff", "travel", "Holiday package Goa for staff", [["Tour operator", "998552"]], "Staff Welfare", ""],
  ["LTC, no code", "travel", "Leave travel concession", [], "Staff Welfare", ""],
  ["Construction of office building", "construction", "Construction of office building", [["Construction of building", "995411"]], "Building", ""],
  ["Works contract", "construction", "Works contract for boundary wall", [["Works contract", "995421"]], "Building", ""],
  ["Civil work, no code", "construction", "Civil work at factory", [], "Building", ""],
  ["Diwali gifts", "gifts", "Diwali gift hampers", [["Dry fruit hamper", "0813"]], "Business Promotion", ""],
  ["Gifts by ledger", "gifts", "Assorted items", [["Sweets", "1704"]], "Gifts to Customers", ""]
];
ok(BILLS.length === 50, "50 bills in the set (" + BILLS.length + ")");
BILLS.forEach(([what, want, description, items, ledger, hint]) => {
  const e = {x: {description, items: items.map(([desc, hsn]) => ({desc, hsn}))}, expenseLedger: ledger, hint};
  const s = x.suggestBlock(e, co);
  const got = s ? s.cat : null;
  ok(got === want, what + ": " + (want ? "flagged " + want : "not flagged") + (got !== want ? " (got " + got + (s ? ", " + s.why : "") + ")" : s ? " (" + s.why + ")" : ""));
});
// the flag says what triggered it
const sac = x.suggestBlock({x: {description: "Gym", items: [{desc: "Gym", hsn: "999723"}]}, expenseLedger: ""}, co);
ok(sac && sac.by === "code" && sac.hit === "999723" && /999723/.test(sac.why), "the reason names the code: " + (sac && sac.why));
const led = x.suggestBlock({x: {description: "", items: []}, expenseLedger: "Club Membership"}, co);
ok(led && led.by === "ledger" && /Club Membership/.test(led.why), "the reason names the ledger: " + (led && led.why));
const w = x.suggestBlock({x: {description: "Canteen charges", items: []}, expenseLedger: "Misc"}, co);
ok(w && w.by === "words" && /Canteen/.test(w.why), "the reason names the words: " + (w && w.why));
// the codes confirmed by the firm (30 Sep 2026)
const flag = (items, ledger, desc) => x.suggestBlock({x: {description: desc || "", items: items.map(([d, h]) => ({desc: d, hsn: h}))}, expenseLedger: ledger || ""}, co);
const is = (s, cat) => s && s.cat === cat;
ok(is(flag([["Outdoor catering", "996334"]]), "food"), "996334 outdoor catering: food");
ok(is(flag([["Grooming", "999729"]]), "beauty_health"), "999729: beauty");
ok(is(flag([["Annual subscription", "999591"]]), "club"), "99959x other membership organisations: club");
ok(flag([["CII membership", "999511"]]) === null, "999511 (a trade body, not 99959x): not flagged");
ok(is(flag([["Servicing of car", "998714"]]), "motor"), "998714 repair and servicing: motor");
ok(is(flag([["Room charges", "996311"]], "Staff Welfare", "Hotel stay for employee on leave travel (LTC)"), "travel"), "hotel 996311 on an employee's leave travel: travel");
ok(flag([["Room charges", "996311"]], "Travelling Expenses", "Hotel stay for sales meeting") === null, "hotel 996311 on business travel: not flagged");
ok(is(flag([["Air ticket", "996425"]], "LTC Reimbursement", ""), "travel"), "air ticket 9964 with an LTC ledger: travel");
ok(flag([["Air ticket", "996425"]], "Travelling Expenses", "Air travel DEL-BOM") === null, "air ticket 9964 on business: not flagged");
ok(flag([["Consultancy", "998311"]], "Staff Welfare - Canteen", "") === null, "codes decide: a consultancy code with a canteen ledger is not flagged");
// "Always blocked" only where the client says so, and never for construction or motor (flag for review only)
const blockAll = {gstBlock: Object.fromEntries(x.BLOCK_CATS.map(c => [c.id, "block"]))};
const r = (items, c) => (x.suggestBlock({x: {description: "", items: items.map(([d, h]) => ({desc: d, hsn: h}))}, expenseLedger: ""}, c) || {}).rule;
ok(r([["Dinner", "996331"]], co) === "flag", "no client setting: flag for review");
ok(r([["Dinner", "996331"]], blockAll) === "block", "client set food to always blocked: blocked");
ok(r([["Construction of building", "995411"]], blockAll) === "flag", "construction stays flag for review even if the client set always blocked");
ok(r([["Motor car", "87038040"]], blockAll) === "flag", "motor stays flag for review even if the client set always blocked");
// a client's "credit allowed" choice is respected
ok(x.suggestBlock({x: {description: "Gym", items: [{desc: "Gym", hsn: "999723"}]}, expenseLedger: ""}, {gstBlock: {club: "allow", beauty_health: "allow"}}) === null, "a category the client allows is not flagged");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
