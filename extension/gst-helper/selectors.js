/* FinCom GST helper: EVERYTHING the helper knows about the GST portal's pages is in this one file.
 *
 * When the portal changes a page, only this file changes: bump `version`, fix the selector, and say what changed in
 * docs/gst-browser-helper.md ("When the portal changes"). The helper never guesses a field: before each step it checks
 * that every field the step needs is on the page, and if one is not, it stops and says which step and which field.
 *
 * A selector is {css, text?, in?, nth?}:
 *   css   a CSS selector (required)
 *   text  the element's own words must contain this (spaces and case ignored), for buttons and tiles without an id
 *   in    a selector for the part of the page to look in first (a tile, a modal, a table row)
 *   click true for a button the helper presses; the rules (lib/rules.js `forbidden`) refuse any filing, payment,
 *         signing or OTP button even if it were listed here
 * In css, {rt} is replaced by the rate with "." as "_" (18 -> 18, 0.25 -> 0_25), {k} by the table or row key.
 *
 * verified: false -- written from the portal's public screenshots, user manuals and FAQs (October 2026) and checked
 * against the local copy in tests/fixtures/gst-portal-fake only. The first run on the real portal will show any field
 * that is named differently: the helper stops there with the field's name, and this file is corrected.
 */
(function (root) {
  "use strict";
  const btn = (text, extra) => Object.assign({ css: "button, a.btn, input[type=button], input[type=submit]", text, click: true }, extra || {});
  const RATE_COLS = { txval: "input[name=txval]", iamt: "input[name=iamt]", camt: "input[name=camt]", samt: "input[name=samt]", csamt: "input[name=csamt]" };
  const rates = { row: "tr[data-rate='{rt}']", cols: RATE_COLS };
  const recordForm = (fields, extra) => Object.assign({ add: btn("ADD RECORD"), save: btn("SAVE"), back: btn("BACK"), list: { css: "table.records tbody tr" }, fields, rates }, extra || {});
  const F = (css) => ({ css });
  const PARTY = { ctin: F("#ctin"), inum: F("#inum"), idt: F("#idt"), val: F("#val"), pos: F("select#pos"), rchrg: F("input#rchrg"), inv_typ: F("select#inv_typ") };
  const NOTE = { ctin: F("#ctin"), ntty: F("select#ntty"), nt_num: F("#nt_num"), nt_dt: F("#nt_dt"), val: F("#val"), pos: F("select#pos"), rchrg: F("input#rchrg"), inv_typ: F("select#inv_typ") };
  const ORIG = { oinum: F("#oinum"), oidt: F("#oidt") };

  // the portal's summary table after "GENERATE SUMMARY": a row per table, found by its description; the columns
  // are the cells (td) counted from 1
  const SUM_COLS = { n: 2, val: 3, txval: 4, iamt: 5, camt: 6, samt: 7, csamt: 8 };
  const tile = (text, summary, form, extra) => Object.assign({ tile: { css: ".tile, .card, a, div[role=button]", text, click: true }, summary: { css: "table#summary tbody tr", text: summary }, cols: SUM_COLS, form }, extra || {});

  const SEL = {
    version: "2026.10.17-2",
    verified: false,
    pages: {
      login: {
        url: "https://services.gst.gov.in/services/login",
        match: "^https://services\\.gst\\.gov\\.in/services/login",
        fields: {
          username: { css: "input#username" },
          password: { css: "input#user_pass" },
          captcha: { css: "input#captcha" },          // typed by the person; the helper only puts the cursor there
        },
      },
      // the portal's home page after login (Welcome): its RETURN DASHBOARD button is the way into returns
      home: {
        url: "https://services.gst.gov.in/services/auth/fowelcome",
        match: "^https://services\\.gst\\.gov\\.in/services/auth/",
        fields: { returnDashboard: btn("RETURN DASHBOARD") },
      },
      dashboard: {
        url: "https://return.gst.gov.in/returns/auth/dashboard",
        match: "^https://return\\.gst\\.gov\\.in/returns/auth/dashboard",
        fields: {
          fy: { css: "select[name=fin]" },
          quarter: { css: "select[name=quarter]" },
          period: { css: "select[name=mon]" },
          search: btn("SEARCH"),
          r1: btn("PREPARE ONLINE", { in: { css: ".ret-tile", text: "GSTR1" } }),
          r1Offline: btn("PREPARE OFFLINE", { in: { css: ".ret-tile", text: "GSTR1" } }),
          iff: btn("PREPARE ONLINE", { in: { css: ".ret-tile", text: "IFF" } }),
          r3b: btn("PREPARE ONLINE", { in: { css: ".ret-tile", text: "GSTR3B" } }),
          r2b: btn("VIEW", { in: { css: ".ret-tile", text: "GSTR2B" } }),
        },
        // the portal's financial year, quarter and month options: their value as the page has it
        fyValue: (ym) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6), s = m >= 4 ? y : y - 1; return s + "-" + String(s + 1).slice(2); },
        quarterValue: (ym) => { const m = +ym.slice(4, 6); return m >= 4 && m <= 6 ? "Q1" : m <= 9 && m >= 7 ? "Q2" : m >= 10 ? "Q3" : "Q4"; },
        monthValue: (ym) => ym.slice(4, 6) + ym.slice(0, 4),
      },
      gstr1: {
        url: "https://return.gst.gov.in/returns/auth/gstr1",
        match: "^https://return\\.gst\\.gov\\.in/returns/auth/(gstr1|iff)",
        fields: {
          heading: { css: "h1, h2, h3, h4", text: "GSTR-1" },
          period: { css: "#ret-period" },
          generate: btn("GENERATE SUMMARY"),
          summaryTable: { css: "table#summary" },
          back: btn("BACK"),
          // the owner's decision of 17-Oct-2026: after filling and comparing, the helper opens the portal's File page (it
          // only shows the declaration, the signatory and the FILE WITH DSC / EVC buttons) and stops there; it never presses
          // FILE WITH DSC or FILE WITH EVC. opensFilePage: the one button the rules let it press although it says "File".
          openFile: { css: "button", text: "FILE STATEMENT", click: true, opensFilePage: true },
          fileDsc: { css: "button", text: "FILE WITH DSC" },
          fileEvc: { css: "button", text: "FILE WITH EVC" },
        },
        tables: {
          b2b: tile("4A, 4B, 6B, 6C - B2B, SEZ, DE Invoices", "B2B, SEZ, DE Invoices", recordForm(PARTY)),
          b2ba: tile("9A - Amended B2B Invoices", "Amended B2B Invoices", recordForm(Object.assign({}, ORIG, PARTY))),
          b2cl: tile("5 - B2C (Large) Invoices", "B2C (Large) Invoices", recordForm({ pos: F("select#pos"), inum: F("#inum"), idt: F("#idt"), val: F("#val") })),
          b2cla: tile("9A - Amended B2C (Large) Invoices", "Amended B2C (Large) Invoices", recordForm(Object.assign({}, ORIG, { pos: F("select#pos"), inum: F("#inum"), idt: F("#idt"), val: F("#val") }))),
          exp: tile("6A - Exports Invoices", "Exports Invoices", recordForm({ exp_typ: F("select#exp_typ"), inum: F("#inum"), idt: F("#idt"), val: F("#val"), sbpcode: F("#sbpcode"), sbnum: F("#sbnum"), sbdt: F("#sbdt") })),
          expa: tile("9A - Amended Exports Invoices", "Amended Exports Invoices", recordForm(Object.assign({}, ORIG, { exp_typ: F("select#exp_typ"), inum: F("#inum"), idt: F("#idt"), val: F("#val"), sbpcode: F("#sbpcode"), sbnum: F("#sbnum"), sbdt: F("#sbdt") }))),
          b2cs: tile("7 - B2C (Others)", "B2C (Others)", recordForm({ pos: F("select#pos"), typ: F("select#typ") })),
          b2csa: tile("10 - Amended B2C (Others)", "Amended B2C (Others)", recordForm({ omon: F("select#omon"), pos: F("select#pos"), typ: F("select#typ") })),
          nil: tile("8A, 8B, 8C, 8D - Nil Rated Supplies", "Nil Rated, Exempted and Non GST", { grid: "input#nil_{k}_{c}", save: btn("SAVE"), back: btn("BACK") }, { cols: { n: 2, nil: 3, expt: 4, ngsup: 5 } }),
          cdnr: tile("9B - Credit / Debit Notes (Registered)", "Credit/Debit Notes (Registered)", recordForm(NOTE)),
          cdnra: tile("9C - Amended Credit / Debit Notes (Registered)", "Amended Credit/Debit Notes (Registered)", recordForm(Object.assign({ ont_num: F("#ont_num"), ont_dt: F("#ont_dt") }, NOTE))),
          cdnur: tile("9B - Credit / Debit Notes (Unregistered)", "Credit/Debit Notes (Unregistered)", recordForm({ typ: F("select#ur_typ"), ntty: F("select#ntty"), nt_num: F("#nt_num"), nt_dt: F("#nt_dt"), val: F("#val"), pos: F("select#pos") })),
          cdnura: tile("9C - Amended Credit / Debit Notes (Unregistered)", "Amended Credit/Debit Notes (Unregistered)", recordForm({ ont_num: F("#ont_num"), ont_dt: F("#ont_dt"), typ: F("select#ur_typ"), ntty: F("select#ntty"), nt_num: F("#nt_num"), nt_dt: F("#nt_dt"), val: F("#val"), pos: F("select#pos") })),
          at: tile("11A(1), 11A(2) - Tax Liability (Advances Received)", "Tax Liability (Advances Received)", recordForm({ pos: F("select#pos") })),
          ata: tile("11A - Amended Tax Liability (Advance Received)", "Amended Tax Liability (Advance Received)", recordForm({ omon: F("select#omon"), pos: F("select#pos") })),
          txpd: tile("11B(1), 11B(2) - Adjustment of Advances", "Adjustment of Advances", recordForm({ pos: F("select#pos") })),
          txpda: tile("11B - Amended Adjustment of Advances", "Amended Adjustment of Advances", recordForm({ omon: F("select#omon"), pos: F("select#pos") })),
          hsn: tile("12 - HSN-wise summary of outward supplies", "HSN-wise summary of outward supplies", recordForm({ tab: F("select#hsn_tab"), hsn_sc: F("#hsn_sc"), desc: F("#desc"), uqc: F("select#uqc"), qty: F("#qty"), rt: F("select#rt"), txval: F("#txval"), iamt: F("#iamt"), camt: F("#camt"), samt: F("#samt"), csamt: F("#csamt") }, { rates: null })),
          doc_issue: tile("13 - Documents Issued", "Documents Issued", recordForm({ doc_num: F("select#doc_num"), from: F("#from"), to: F("#to"), totnum: F("#totnum"), cancel: F("#cancel") }, { rates: null }), { cols: { n: 2, totnum: 3, cancel: 4, net: 5 } }),
        },
        // the File / submit buttons, listed only so the helper can SAY where the person clicks; never pressed
        personClicks: [{ css: "button", text: "FILE WITH DSC" }, { css: "button", text: "FILE WITH EVC" }],
        arn: { css: ".alert-success, .modal .success, #arn-msg" },
      },
      upload: {
        url: "https://return.gst.gov.in/returns/auth/gstr/offlineupload",
        match: "^https://return\\.gst\\.gov\\.in/returns/auth/gstr/offlineupload",
        fields: {
          file: { css: "input[type=file]" },
          status: { css: "table#upload-history tbody tr:first-child td.status" },
          errorReport: btn("GENERATE ERROR REPORT"),
        },
      },
      gstr3b: {
        url: "https://return.gst.gov.in/returns2/auth/gstr3b",
        match: "^https://return\\.gst\\.gov\\.in/returns2/auth/gstr3b",
        tiles: {
          t31: { css: ".tile", text: "3.1 Tax on outward and reverse charge inward supplies", click: true },
          t311: { css: ".tile", text: "3.1.1 Supplies notified under section 9(5)", click: true },
          t32: { css: ".tile", text: "3.2 Inter-State supplies", click: true },
          t4: { css: ".tile", text: "4. Eligible ITC", click: true },
          t5: { css: ".tile", text: "5. Exempt, nil and Non GST inward supplies", click: true },
          t51: { css: ".tile", text: "5.1 Interest and Late fee", click: true },
        },
        confirm: btn("CONFIRM", { in: { css: ".modal.open" } }),
        fields: {
          heading: { css: "h1, h2, h3, h4", text: "GSTR-3B" },
          save: btn("SAVE GSTR-3B"),
          proceed: btn("PROCEED TO PAYMENT"),
        },
        rows32: { add: btn("ADD", { in: { css: "section.r32[data-kind='{k}']" } }), row: "section.r32[data-kind='{k}'] tbody tr:last-child", pos: "select[name=pos]", txval: "input[name=txval]", iamt: "input[name=iamt]" },
        // 3.1.1: FinCom does not work these out (see the doc's questions); the helper reads them, types nothing
        read311: { "3.1.1i.txval": { css: "#eco_9_5_txval" }, "3.1.1i.iamt": { css: "#eco_9_5_iamt" }, "3.1.1ii.txval": { css: "#eco_reg_txval" } },
        // worked out by the portal; read back, never typed
        computed: {
          "4C.iamt": { css: "#itc_net_iamt" }, "4C.camt": { css: "#itc_net_camt" }, "4C.samt": { css: "#itc_net_samt" }, "4C.csamt": { css: "#itc_net_csamt" },
          "5.1.int.iamt": { css: "#intr_iamt" }, "5.1.int.camt": { css: "#intr_camt" }, "5.1.int.samt": { css: "#intr_samt" }, "5.1.int.csamt": { css: "#intr_csamt" },
          "5.1.fee.camt": { css: "#latefee_camt" }, "5.1.fee.samt": { css: "#latefee_samt" },
        },
        // the "Payment of tax" table after PROCEED TO PAYMENT: the portal's own set-off, read back, never changed
        payment: { css: "table#payment" },
        paid: (key) => ({ css: "table#payment [data-cell='" + key + "']" }),
        personClicks: [{ css: "button", text: "MAKE PAYMENT/POST CREDIT TO LEDGER" }, { css: "button", text: "FILE GSTR-3B WITH DSC" }, { css: "button", text: "FILE GSTR-3B WITH EVC" }],
        arn: { css: ".alert-success, .modal .success, #arn-msg" },
      },
      gstr2b: {
        url: "https://gstr2b.gst.gov.in/gstr2b/auth/",
        match: "^https://gstr2b\\.gst\\.gov\\.in/gstr2b/auth",
        fields: { period: { css: "#ret-period" }, download: { css: "a#json-download", text: "DOWNLOAD", click: true } },
      },
      cashLedger: {
        url: "https://payment.gst.gov.in/payment/auth/ledger/cashledger",
        match: "^https://payment\\.gst\\.gov\\.in/payment/auth/ledger/cashledger",
        fields: { igst: { css: "table#cash-balance tr[data-head=igst] td.total" }, cgst: { css: "table#cash-balance tr[data-head=cgst] td.total" }, sgst: { css: "table#cash-balance tr[data-head=sgst] td.total" }, cess: { css: "table#cash-balance tr[data-head=cess] td.total" } },
      },
      creditLedger: {
        url: "https://payment.gst.gov.in/payment/auth/ledger/creditledger",
        match: "^https://payment\\.gst\\.gov\\.in/payment/auth/ledger/creditledger",
        fields: { igst: { css: "table#credit-balance td[data-head=igst]" }, cgst: { css: "table#credit-balance td[data-head=cgst]" }, sgst: { css: "table#credit-balance td[data-head=sgst]" }, cess: { css: "table#credit-balance td[data-head=cess]" } },
      },
      status: {
        url: "https://return.gst.gov.in/returns/auth/trackreturnstatus",
        match: "^https://return\\.gst\\.gov\\.in/returns/auth/trackreturnstatus",
        fields: { rows: { css: "table#return-status tbody tr" } },
        cols: { form: 1, period: 3, filed: 4, status: 5, arn: 6 },
      },
    },
  };
  // The owner's report of 17-Oct-2026: the real portal answers "Access Denied! Your session is expired or you don't have
  // permission…" to a returns / payment page opened by typing its address. So the helper NEVER types an address after
  // login (the pages' `url` above are for reference only; only pages.login.url is ever opened, and only when no logged-in
  // portal tab exists). It goes through the portal's own menu and buttons, written here, item by item, in the order clicked.
  SEL.menu = {
    fields: {
      services: { css: "nav a, nav button, nav li > span", text: "Services", click: true },
      returns: { css: "nav a, nav button, nav li > span", text: "Returns", click: true },
      returnsDashboard: { css: "nav a, nav button", text: "Returns Dashboard", click: true },
      trackStatus: { css: "nav a, nav button", text: "Track Return Status", click: true },
      ledgers: { css: "nav a, nav button, nav li > span", text: "Ledgers", click: true },
      cashLedger: { css: "nav a, nav button", text: "Electronic Cash Ledger", click: true },
      creditLedger: { css: "nav a, nav button", text: "Electronic Credit Ledger", click: true },
    },
    paths: {
      dashboard: ["services", "returns", "returnsDashboard"],
      status: ["services", "returns", "trackStatus"],
      cashLedger: ["services", "ledgers", "cashLedger"],
      creditLedger: ["services", "ledgers", "creditLedger"],
    },
  };
  // the portal's refusal page (the words it shows): the helper stops there and says how to get back in
  SEL.denied = { words: ["Access Denied", "session is expired"] };

  // the 3B boxes: where each is typed, and the tile it is in
  const BOX = {
    "3.1a": ["t31", "osup_det", ["txval", "iamt", "camt", "samt", "csamt"]], "3.1b": ["t31", "osup_zero", ["txval", "iamt", "csamt"]], "3.1c": ["t31", "osup_nil_exmp", ["txval"]],
    "3.1d": ["t31", "isup_rev", ["txval", "iamt", "camt", "samt", "csamt"]], "3.1e": ["t31", "osup_nongst", ["txval"]],
    "4A1": ["t4", "itc_avl_IMPG", ["iamt", "csamt"]], "4A2": ["t4", "itc_avl_IMPS", ["iamt", "csamt"]], "4A3": ["t4", "itc_avl_ISRC", ["iamt", "camt", "samt", "csamt"]],
    "4A4": ["t4", "itc_avl_ISD", ["iamt", "camt", "samt", "csamt"]], "4A5": ["t4", "itc_avl_OTH", ["iamt", "camt", "samt", "csamt"]],
    "4B1": ["t4", "itc_rev_RUL", ["iamt", "camt", "samt", "csamt"]], "4B2": ["t4", "itc_rev_OTH", ["iamt", "camt", "samt", "csamt"]],
    "4D1": ["t4", "itc_inelg_RUL", ["iamt", "camt", "samt", "csamt"]], "4D2": ["t4", "itc_inelg_OTH", ["iamt", "camt", "samt", "csamt"]],
  };
  Object.entries(BOX).forEach(([k, [t, id, cols]]) => cols.forEach((c) => { SEL.pages.gstr3b.fields["box:" + k + "." + c] = { css: "input#" + id + "_" + c, tile: t }; }));
  [["5.gst.inter", "isup_GST_inter"], ["5.gst.intra", "isup_GST_intra"], ["5.nongst.inter", "isup_NONGST_inter"], ["5.nongst.intra", "isup_NONGST_intra"]]
    .forEach(([k, id]) => { SEL.pages.gstr3b.fields["box:" + k] = { css: "input#" + id, tile: "t5" }; });
  root.GSTH_SEL = SEL;
  if (typeof module !== "undefined" && module.exports) module.exports = SEL;
})(typeof self !== "undefined" ? self : globalThis);
