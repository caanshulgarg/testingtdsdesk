/* ================================================================== */
/* "How this tab works": a guide to every GST and TDS tab, one tap    */
/* away, kept open while you move between tabs                        */
/* ================================================================== */
const Help = {
  // each tab: what it is for, what to do step by step, where its figures come from, what to watch
  T: {
    "gst:r1": {t: "GSTR-1", what: "Your outward supplies for the month, worked out from Tally\u2019s sales vouchers and credit and debit notes, table by table as the return asks: 4A B2B, 5 B2C large, 6 exports and SEZ, 7 B2C small by place of supply and rate, 8 nil, exempt and non-GST, 9B notes, 11 advances, 12 HSN and 13 documents issued. It gives you the JSON the portal takes.",
      steps: ["Choose the month and, if the client has more than one, the GSTIN.", "Read the checks at the top \u2014 customers without a GSTIN or with a wrong one, place of supply, rates that cannot be right. Correct them in Tally and read the day book again; do not correct them here.", "Tie the totals to the sales register in Tally for the month.", "Look at B2C large: inter-state sales to unregistered customers above \u20b91 lakh (\u20b92.5 lakh before 1 August 2024) go invoice by invoice.", "Download the GSTR-1 JSON and upload it on the portal (Returns \u2192 GSTR-1 \u2192 Prepare offline \u2192 Upload). Use the Excel to review with the client first.", "After filing, a copy is kept here; later changes in Tally show up under Amendments.", "If a customer tells you they rejected one of your invoices or credit notes in their IMS, find it under \u201cRejected by customers in IMS\u201d at the bottom."],
      from: "Tally sales, credit note and debit note vouchers; HSN, rate and unit from each item or ledger line; the customer\u2019s GSTIN and state from the ledger master (Tally\u2019s dated registration details); marketplace sales from the Sales tab.",
      watch: ["A voucher changed after the month is filed is an amendment in a later month, never a second filing of that month.", "Cancelled vouchers are counted in table 13.", "An invoice with two rates is split rate by rate in the JSON.", "A credit note rejected by the customer in IMS: the portal adds its tax back to your liability in the next month; that is put into 3.1(a) here."]},
    "gst:r3b": {t: "GSTR-3B", what: "The month\u2019s summary return and the tax to pay: 3.1 outward supplies and reverse charge, 3.2 inter-state supplies to unregistered persons, 4 input tax credit, 5 exempt and non-GST inward supplies, and 6 payment with the credit set off.",
      steps: ["Choose the basis for credit at the top: \u201cas far as 2B shows it\u201d (the law, section 16(2)(aa)) whenever the month\u2019s 2B is here, or \u201cas booked\u201d.", "In the first month only, type the opening balance of the electronic credit ledger for each tax; later months carry it forward.", "Check 4(A)(5) and the lines for bills held back (not in 2B yet) and released (from an earlier month, now in 2B).", "Type 4(B)(2) and 4(D)(1) if there is anything to reverse or reclaim; rules 42 and 43 come from the Reversal tab.", "Check the set-off and the cash to pay in table 6.", "Pay the cash through a challan (PMT-06), then download the 3B JSON or fill the return from the Excel.", "Under \u201cFiling, interest and late fee\u201d, read the portal\u2019s checks (DRC-01B, DRC-01C) before filing.", "After filing, type the dates GSTR-1 and 3B were filed \u2014 late fee and interest are worked out \u2014 and click \u201cMark this 3B as filed\u201d so the month stays as filed.", "Download the set-off journal and import it into Tally, so the GST ledgers there agree with the portal."],
      from: "3.1(a) from sales less credit notes, plus tax on advances; 3.1(d) from the reverse charge payable ledger; table 4 from every voucher carrying input tax, limited to what 2B shows; 4(D)(2) from 2B\u2019s not-available lines; rules 42/43 from Reversal.",
      watch: ["A bill not in 2B gives no credit that month; it is taken in the month its 2B carries it.", "Documents rejected in IMS give no credit; a rejected supplier credit note does not reduce it.", "Credit is used in the order the law sets: IGST first, then CGST and SGST (sections 49 and 49A, rule 88A).", "Our own credit notes rejected by customers are added back to 3.1(a) in the month the portal adds them.", "Rule 37 is off unless switched on for the GSTIN. When on, credit on a bill unpaid 180 days after its date is reversed in 4(B)(2) in the month the 181st day falls in, and taken back in 4(A)(5) and 4(D)(1) when it is paid.", "Late fee is \u20b950 a day (\u20b920 for nil), capped by the year-before turnover; interest is 18% a year on tax paid in cash after the due date (section 50)."]},
    "gst:inreg": {t: "Input register", what: "Every purchase-side document with input tax, line by line \u2014 rate by rate and HSN by HSN \u2014 with whether it is in 2B.",
      steps: ["Choose the month.", "Use the funnel on any column to narrow the list: supplier, rate, status, amount range.", "Look at \u201cNot in 2B\u201d and \u201cIn 2B, differs\u201d first; they are followed up under ITC follow-up.", "Download the Excel for the file or the client."],
      from: "Tally purchases, journals and payments carrying input tax; the 2B for the month.", watch: ["Status needs that month\u2019s 2B; without it every line says \u201c2B not brought in\u201d.", "Reverse charge and blocked credit (section 17(5)) are shown but are not expected in 2B the same way."]},
    "gst:r2b": {t: "2B reconciliation", what: "The portal\u2019s GSTR-2B set against the bills in Tally, bill by bill.",
      steps: ["Download GSTR-2B as JSON from the portal (Returns \u2192 GSTR-2B \u2192 Download JSON), month by month, and bring the files in here. Several at once is fine.", "Read the matched count, then the differences: amounts differ, probably the same bill (confirm or say no), in 2B not in Tally, in Tally not in 2B.", "Confirm the probable matches \u2014 they are usually a number written differently or a supplier without GSTIN in Tally.", "Fill missing supplier GSTINs in Tally\u2019s ledger masters; that alone clears most differences.", "Download the Excel of the reconciliation, then work the open items under ITC follow-up."],
      from: "The 2B JSON files and Tally\u2019s inward vouchers.", watch: ["Bills are matched on the supplier\u2019s GSTIN and the bill number, allowing prefixes like EXP/IN/39/2025-26 against 39.", "A bill booked and exactly reversed is set aside, not treated as missing.", "Documents rejected in IMS are shown apart; they give no credit."]},
    "gst:follow": {t: "ITC follow-up", what: "Everything 2B and Tally do not agree on, across every month, carried until it is settled \u2014 with the last date to take the credit and one letter per supplier.",
      steps: ["Click a category chip to see its items; the red ones need action.", "For each item choose what to do: follow up the supplier, book it in Tally, reject in IMS, take the credit, and so on. Your choice follows the bill from month to month.", "Before filing 3B, open the Excel\u2019s \u201cIMS actions\u201d sheet and do those actions on the portal\u2019s IMS.", "Under \u201cSuppliers to write to\u201d, copy, email or WhatsApp the letter; the date is kept.", "Bring in the 2B for months not yet checked; until then those bills sit in \u201cNot checked yet\u201d."],
      from: "Worked out again each time from the books and every 2B brought in. Only your decisions, notes, contacts and the dates you wrote are kept.",
      watch: ["Credit for a year\u2019s bills can be taken only up to 30 November after the year (section 16(4)); items near that date are marked.", "Once 3B is filed, an IMS action for that month cannot be changed."]},
    "gst:adv": {t: "Advances", what: "Money received before the invoice for services, and the tax on it (tables 11A and 11B of GSTR-1, carried into 3.1(a)).",
      steps: ["Check each receipt listed as an advance.", "Tick \u201cNot an advance\u201d for a receipt against an earlier invoice or a loan.", "Correct the rate where the nearest invoice gives the wrong one.", "When the invoice is issued, the advance is adjusted in 11B."],
      from: "Receipts from customers in Tally, before the customer\u2019s invoice.", watch: ["An advance billed in the same month is left out, as the return asks.", "Advances for goods are not taxed on receipt."]},
    "gst:rev": {t: "Reversal", what: "Credit to reverse on common inputs and services used for exempt and taxable supplies (rule 42) and on common capital goods (rule 43), month by month and for the year.",
      steps: ["Check which ledgers are marked common and which supplies are exempt.", "Check the month\u2019s turnover split.", "Read the reversal worked out; it goes into 4(B)(1) of 3B.", "After the year, compare the annual figure with the monthly total and reverse or reclaim the difference by the September return."],
      from: "Tally input tax ledgers and turnover by class of supply.", watch: ["Credit on exclusively exempt supplies is not common; it is reversed in full."]},
    "gst:amend": {t: "Amendments", what: "Your books now, set against each GSTR-1 already filed, and the amendments that follow (9A invoices, 9C notes, 10 B2C small).",
      steps: ["Returns downloaded here are kept automatically. For a month filed some other way, bring in the JSON that was uploaded.", "Choose the month to see what has changed since it was filed.", "Download the GSTR-1 JSON with these amendments for the current month.", "If the month\u2019s 3B is not filed yet (and the month is July 2024 or later), use the GSTR-1A section below instead: the correction lands in the same month and your customer sees it in that month\u2019s 2B."],
      from: "The filed copies and the books as they stand.", watch: ["A renumbered invoice or a corrected customer GSTIN is one amendment.", "Amendments for a year are possible up to 30 November after the year."]},
    "gst:g9": {t: "GSTR-9", what: "The annual return for the year, from the books month by month, with 8A from 2B.",
      steps: ["Choose any month of the year and the GSTIN.", "Check tables 4 and 5 (outward) against the year\u2019s GSTR-1s, and 6 to 8 (credit) against the 3Bs.", "Type what the books cannot give under \u201cFigures not in the books\u201d: 4K/4L, 10, 11, 14, 15, 16, 19 and the like.", "Download the PDF or Excel and fill the offline tool from it."],
      from: "The year\u2019s vouchers, the 3B working, every 2B for 8A.", watch: ["8A needs every 2B of the year here.", "Due 31 December after the year."]},
    "gst:g9c": {t: "GSTR-9C", what: "The reconciliation of the annual return with the audited accounts: turnover (5 and 7), tax (9) and credit (12).",
      steps: ["Type the turnover as per the audited financial statements.", "Enter the adjustments and the reasons for each unreconciled figure.", "Download the PDF or Excel for the self-certified statement."],
      from: "GSTR-9 as worked out here, and your typed figures.", watch: ["Needed when the year\u2019s turnover is above \u20b95 crore."]},
    "tds:years": {t: "TDS \u2014 the years", what: "Every financial year in the books with its deductions, TDS, challans and what is still open.",
      steps: ["Click a year to open it.", "A red figure under \u201cNot against a challan\u201d or \u201cWithout PAN\u201d is work before the returns."], from: "Tally\u2019s TDS payable ledgers and the salary sheet.", watch: []},
    "tds:year": {t: "TDS \u2014 the year", what: "The year\u2019s four quarters with 26Q (other than salary) and 24Q (salary), and the due dates.",
      steps: ["Click the amount in a quarter to open that return.", "Use \u201cCertificates and rate questions\u201d for lower-deduction certificates.", "Download the year\u2019s working for the file."],
      from: "Tally vouchers with TDS; the salary sheet for 24Q.", watch: ["Due: Q1 31 July, Q2 31 October, Q3 31 January, Q4 31 May."]},
    "tds:certs": {t: "Certificates and rate questions", what: "Lower or nil deduction certificates (section 197) and deductions made at a rate that does not match the law.",
      steps: ["Add each certificate: number, PAN, section, rate, limit and period.", "Deductions under a certificate stop being flagged as short.", "Correct the rest in Tally, or note why the rate is right."],
      from: "Tally deductions and the certificates typed here.", watch: ["A deductee without a valid PAN is deducted at 20% or the rate in force, whichever is higher (section 206AA).", "A certificate applies only up to its amount and within its period."]},
    "tds:26Q:challans": {t: "26Q \u2014 Challans", what: "The TDS deposited for the quarter and which deductions each challan pays.",
      steps: ["Check each challan\u2019s date, BSR code and serial number against the counterfoil or OLTAS.", "Click \u201cPut them against challans\u201d to set deductions against challans by section and date.", "Look at \u201cNot against a challan\u201d \u2014 either the TDS is unpaid or a challan is missing from the books."],
      from: "Payments debiting the TDS payable ledgers in Tally.", watch: ["A challan paid late brings interest under section 201(1A); see the checks tab."]},
    "tds:26Q:deductees": {t: "26Q \u2014 Deductees", what: "Each deductee\u2019s payments and TDS for the quarter.", steps: ["Fill any missing or wrong PAN in Tally.", "Check the section chosen for each deductee."], from: "Tally deductions grouped by PAN, or by name where there is none.", watch: ["Without a valid PAN the return carries higher-rate flags and the deductee gets no credit."]},
    "tds:26Q:deductions": {t: "26Q \u2014 Deductions", what: "Every deduction line that goes into the return.", steps: ["Filter by section, deductee or challan.", "Check dates of payment or credit and the amounts."], from: "Each Tally voucher with TDS.", watch: []},
    "tds:26Q:checks": {t: "26Q \u2014 Interest, late fee and checks", what: "Interest for late deduction or late payment, the late filing fee, and rate questions for the quarter.",
      steps: ["Read the interest under section 201(1A): 1% a month for late deduction, 1.5% a month for late payment.", "Read the late fee under section 234E: \u20b9200 a day, not more than the TDS.", "Pay these with the challan before filing, and settle the rate questions."],
      from: "Deduction and challan dates.", watch: []},
    "tds:24Q:employees": {t: "24Q \u2014 Employees", what: "Each employee\u2019s salary and TDS for the quarter, from the salary sheet.", steps: ["Bring in the payroll sheet you already prepare (Excel or CSV).", "Check each employee\u2019s PAN and TDS."], from: "The salary sheet; Tally only shows net pay.", watch: []},
    "tds:24Q:challans": {t: "24Q \u2014 Challans", what: "Challans for salary TDS in the quarter.", steps: ["Check each challan against the counterfoil."], from: "Tally\u2019s salary TDS payments.", watch: []},
    "tds:24Q:annex2": {t: "24Q \u2014 Annexure II", what: "The whole year\u2019s salary details per employee, filed with Q4.", steps: ["Check gross salary, exemptions, deductions and tax for each employee.", "Tie the TDS to what was deducted over the year."], from: "The salary sheet for the year.", watch: []},
    "tds:24Q:checks": {t: "24Q \u2014 Checks", what: "What to fix before filing: missing PANs, TDS that differs from the books, and the like.", steps: ["Fix each item listed, in the sheet or in Tally."], from: "The salary sheet and the books.", watch: []}
  },
  key(){
    if (S.view !== "company" || S.tab !== "books" || !S.books || S.books.loading) return "";
    const t = typeof booksTab === "function" ? booksTab() : "";
    if (t === "gst") return "gst:" + (S.gstPart || "r1");
    if (t === "tds"){ const v = S.tdsView || "years"; return v === "return" ? "tds:" + (S.tdsForm || "26Q") + ":" + (S.tdsTab || "") : "tds:" + v; }
    return "";
  },
  html(k){
    const x = this.T[k]; if (!x) return "";
    return '<div class="help-head"><b>How this tab works: ' + esc(x.t) + '</b><button class="linkbtn" data-help="close" aria-label="Close">\u2715</button></div>' +
      "<h4>What it is for</h4><p>" + esc(x.what) + "</p>" +
      (x.steps && x.steps.length ? "<h4>What to do</h4><ol>" + x.steps.map(s => "<li>" + esc(s) + "</li>").join("") + "</ol>" : "") +
      (x.from ? "<h4>Where the figures come from</h4><p>" + esc(x.from) + "</p>" : "") +
      (x.watch && x.watch.length ? "<h4>Watch for</h4><ul>" + x.watch.map(s => "<li>" + esc(s) + "</li>").join("") + "</ul>" : "");
  },
  // after every render: a button beside the tab bar, and the panel kept in step with the tab shown
  after(){
    const k = this.key(), has = !!this.T[k];
    let p = document.getElementById("helpPanel");
    if (has){
      // on the row of month and downloads under the GST tabs, where there is room; on TDS, the line of years and quarters
      const gnav = document.querySelector('#app nav.sbar[aria-label="GST"]'), grow = gnav && gnav.nextElementSibling && gnav.nextElementSibling.classList.contains("revfilter") ? gnav.nextElementSibling : null;
      const bar = grow || gnav || document.querySelector("#app .tds-crumbs");
      if (bar && !bar.querySelector("[data-help]")) bar.insertAdjacentHTML("beforeend", '<button class="help-btn" data-help="open" title="How this tab works">? How this tab works</button>');
    }
    if (S.helpOpen && has){
      if (!p){ p = document.createElement("aside"); p.id = "helpPanel"; p.className = "help-panel"; p.setAttribute("aria-label", "How this tab works"); document.body.appendChild(p); }
      if (p.dataset.k !== k){ p.innerHTML = this.html(k); p.dataset.k = k; }
    } else if (p) p.remove();
    document.body.classList.toggle("help-on", !!(S.helpOpen && has));
  }
};
if (typeof document !== "undefined") document.addEventListener("click", e => {
  const t = e.target.closest("[data-help]"); if (!t) return;
  S.helpOpen = t.dataset.help === "open" ? !S.helpOpen : false; Help.after();
});
// Esc closes the guide and nothing else: the app's own Esc (which leaves the screen) must not run as well
if (typeof document !== "undefined") document.addEventListener("keydown", e => { if (e.key === "Escape" && S.helpOpen && document.getElementById("helpPanel")){ e.stopImmediatePropagation(); e.preventDefault(); S.helpOpen = false; Help.after(); } }, true);
