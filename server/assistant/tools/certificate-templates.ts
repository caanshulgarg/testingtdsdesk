// The wording of FinCom's CA certificates (certificates.ts): ONE file, edited by hand. It is the JSON that was
// certificate-templates.json, kept as a module so the deployed function bundles it with its code (a .json import with an
// import attribute is not bundled at deploy). Edit the text between the quotes only; the rules are in _about below.
export default {
  "_about": [
    "The wording of FinCom's CA certificates (server/assistant/tools/certificates.ts). One file, edited by hand; every paragraph carries 'confirm': the owner approved this wording on 14-Oct-2026 ('approved by the owner on 14-Oct-2026'); a paragraph changed later goes back to 'to confirm by the owner' until approved again.",
    "Placeholders are {{name}}. Never put a client's name, PAN, CIN, address or figure, or the firm's own details, in this file: they come from FinCom at run time.",
    "Kinds of item: 'p' a paragraph (b bold, center, heading), 'table' one of the figure tables (turnover, networth, bvps), 'sign' the signature block, 'pb' a page break.",
    "Order of preference when a certificate is made: the format uploaded for that job, then the firm's default (settings: 'icai' unless the owner chose 'firm', 'Use our usual format'), and with nothing chosen the ICAI format.",
    "The UDIN is never filled by FinCom: {{udin}} is always printed as a blank line for the partner to write in after generating it on the UDIN portal."
  ],
  "placeholders": {
    "client_name": "the entity's name as in the signed financial statements (else FinCom's client name)",
    "client_ids": "CIN / LLPIN / PAN line, when known (blank otherwise)",
    "client_address": "the registered office or principal place of business",
    "client_kind_word": "Company / Firm / LLP",
    "addressee": "to whom the certificate is addressed (the bank, the tender authority, or 'The Board of Directors' / 'The Partners')",
    "purpose": "the purpose the certificate is asked for (e.g. submission to <bank> for <facility>, tender no. ...)",
    "years_text": "the financial years covered, e.g. 2023-24, 2024-25 and 2025-26",
    "fy_last": "the last financial year, e.g. 2025-26",
    "as_on": "the date of the net worth, e.g. 31-03-2026",
    "auditor": "who audited the financial statements, per year (typed by the user or read from the signed copy)",
    "basis_text": "the basis of the figures: the signed (audited) financial statements, or the books where the user chose so for a year",
    "subject": "Turnover / Net Worth / Turnover and Net Worth",
    "table_turnover": "the turnover table",
    "table_networth": "the net worth working table",
    "firm_name": "the firm's name (firm settings)",
    "frn": "the firm registration number (firm settings)",
    "signatory": "the signing partner's name (firm settings)",
    "designation": "Partner / Proprietor (firm settings)",
    "membership_no": "the signing partner's ICAI membership no. (firm settings)",
    "place": "the place of signing (firm settings, default)",
    "date": "the date of the certificate (today unless the user gives another)",
    "udin": "ALWAYS BLANK: a line for the partner to write the UDIN"
  },
  "templates": {
    "icai": {
      "name": "ICAI format (Guidance Note on Reports or Certificates for Special Purposes)",
      "turnover": [
        { "p": "INDEPENDENT PRACTITIONER'S CERTIFICATE ON TURNOVER", "b": 1, "center": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "To,\n{{addressee}}", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "1. This certificate is issued in accordance with the terms of our engagement with {{client_name}} (\"the {{client_kind_word}}\"){{client_ids}}, having its registered office at {{client_address}}.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "2. We have been requested by the Management of the {{client_kind_word}} to certify the turnover (Revenue from operations) of the {{client_kind_word}} for the financial years {{years_text}}, as stated in the Statement below (\"the Statement\"), for the purpose of {{purpose}}.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Management's Responsibility", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "3. The preparation of the Statement is the responsibility of the Management of the {{client_kind_word}}, including the preparation and maintenance of all accounting and other relevant supporting records and documents. This responsibility includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the Statement and applying an appropriate basis of preparation, and making estimates that are reasonable in the circumstances.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Practitioner's Responsibility", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "4. Our responsibility is to provide reasonable assurance whether the turnover stated in the Statement is in agreement with {{basis_text}}. The financial statements were audited by {{auditor}}.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "5. We conducted our examination of the Statement in accordance with the Guidance Note on Reports or Certificates for Special Purposes issued by the Institute of Chartered Accountants of India (\"ICAI\"). The Guidance Note requires that we comply with the ethical requirements of the Code of Ethics issued by the ICAI.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "6. We have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that Perform Audits and Reviews of Historical Financial Information, and Other Assurance and Related Services Engagements.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Opinion", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "7. Based on our examination as above, and the information and explanations given to us, we certify that the turnover of the {{client_kind_word}} stated below is in agreement with {{basis_text}}:", "confirm": "approved by the owner on 14-Oct-2026" },
        { "table": "turnover", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Restriction on Use", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "8. This certificate is addressed to and provided to {{addressee}} solely for the purpose of {{purpose}} and should not be used by any other person or for any other purpose. Accordingly, we do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this certificate is shown or into whose hands it may come without our prior consent in writing.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "sign": 1, "confirm": "approved by the owner on 14-Oct-2026" }
      ],
      "networth": [
        { "p": "INDEPENDENT PRACTITIONER'S CERTIFICATE ON NET WORTH", "b": 1, "center": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "To,\n{{addressee}}", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "1. This certificate is issued in accordance with the terms of our engagement with {{client_name}} (\"the {{client_kind_word}}\"){{client_ids}}, having its registered office at {{client_address}}.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "2. We have been requested by the Management of the {{client_kind_word}} to certify the net worth of the {{client_kind_word}} as on {{as_on}}, as worked out in the Statement below (\"the Statement\"), for the purpose of {{purpose}}.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Management's Responsibility", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "3. The preparation of the Statement is the responsibility of the Management of the {{client_kind_word}}, including the preparation and maintenance of all accounting and other relevant supporting records and documents. This responsibility includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the Statement and applying an appropriate basis of preparation, and making estimates that are reasonable in the circumstances.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Practitioner's Responsibility", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "4. Our responsibility is to provide reasonable assurance whether the figures in the Statement are in agreement with {{basis_text}} and whether the net worth has been worked out as described below. The financial statements were audited by {{auditor}}.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "5. We conducted our examination of the Statement in accordance with the Guidance Note on Reports or Certificates for Special Purposes issued by the Institute of Chartered Accountants of India (\"ICAI\"). The Guidance Note requires that we comply with the ethical requirements of the Code of Ethics issued by the ICAI.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "6. We have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that Perform Audits and Reviews of Historical Financial Information, and Other Assurance and Related Services Engagements.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Opinion", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "7. Based on our examination as above, and the information and explanations given to us, we certify that the net worth of the {{client_kind_word}} as on {{as_on}}, worked out below from {{basis_text}}, is as follows. Net worth is taken as the aggregate of the paid-up share capital and all reserves created out of profits and securities premium, after deducting the aggregate value of the accumulated losses and deferred expenditure and miscellaneous expenditure not written off, and does not include reserves created out of revaluation of assets (section 2(57) of the Companies Act, 2013); for a firm or an LLP, the partners' capital and current accounts.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "table": "networth", "confirm": "approved by the owner on 14-Oct-2026" },
        { "table": "bvps", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Restriction on Use", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "8. This certificate is addressed to and provided to {{addressee}} solely for the purpose of {{purpose}} and should not be used by any other person or for any other purpose. Accordingly, we do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this certificate is shown or into whose hands it may come without our prior consent in writing.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "sign": 1, "confirm": "approved by the owner on 14-Oct-2026" }
      ],
      "combined": [
        { "p": "INDEPENDENT PRACTITIONER'S CERTIFICATE ON TURNOVER AND NET WORTH", "b": 1, "center": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "To,\n{{addressee}}", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "1. This certificate is issued in accordance with the terms of our engagement with {{client_name}} (\"the {{client_kind_word}}\"){{client_ids}}, having its registered office at {{client_address}}.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "2. We have been requested by the Management of the {{client_kind_word}} to certify the turnover (Revenue from operations) of the {{client_kind_word}} for the financial years {{years_text}} and its net worth as on {{as_on}}, as stated in the Statement below (\"the Statement\"), for the purpose of {{purpose}}.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Management's Responsibility", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "3. The preparation of the Statement is the responsibility of the Management of the {{client_kind_word}}, including the preparation and maintenance of all accounting and other relevant supporting records and documents. This responsibility includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the Statement and applying an appropriate basis of preparation, and making estimates that are reasonable in the circumstances.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Practitioner's Responsibility", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "4. Our responsibility is to provide reasonable assurance whether the figures in the Statement are in agreement with {{basis_text}}. The financial statements were audited by {{auditor}}.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "5. We conducted our examination of the Statement in accordance with the Guidance Note on Reports or Certificates for Special Purposes issued by the Institute of Chartered Accountants of India (\"ICAI\"). The Guidance Note requires that we comply with the ethical requirements of the Code of Ethics issued by the ICAI.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "6. We have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that Perform Audits and Reviews of Historical Financial Information, and Other Assurance and Related Services Engagements.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Opinion", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "7. Based on our examination as above, and the information and explanations given to us, we certify that the turnover and the net worth of the {{client_kind_word}} stated below are in agreement with {{basis_text}}. Net worth is worked out as in section 2(57) of the Companies Act, 2013 (excluding reserves created out of revaluation of assets); for a firm or an LLP, the partners' capital and current accounts.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "A. Turnover", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "table": "turnover", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "B. Net worth as on {{as_on}}", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "table": "networth", "confirm": "approved by the owner on 14-Oct-2026" },
        { "table": "bvps", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Restriction on Use", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "8. This certificate is addressed to and provided to {{addressee}} solely for the purpose of {{purpose}} and should not be used by any other person or for any other purpose. Accordingly, we do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this certificate is shown or into whose hands it may come without our prior consent in writing.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "sign": 1, "confirm": "approved by the owner on 14-Oct-2026" }
      ]
    },
    "firm": {
      "name": "The firm's usual format (from the firm's own certificates, 14-Oct-2026)",
      "turnover": [
        { "p": "Turnover Certificate", "b": 1, "center": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "To,\n{{addressee}}", "if": "addressee", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "We have verified the Audited Statement of Accounts and other relevant documents of {{client_name}}{{client_ids}} having registered office at {{client_address}} pertaining to the financial year {{years_text}}. Based on our verification of the aforesaid statement and records, we certify that the following details are true to the best of our information and according to the explanation given to us.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "table": "turnover", "average": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "This certificate is issued at the request of {{client_name}} for the purpose of {{purpose}}.", "if": "purpose", "confirm": "approved by the owner on 14-Oct-2026" },
        { "sign": 1, "confirm": "approved by the owner on 14-Oct-2026" }
      ],
      "networth": [
        { "p": "Networth Certificate", "b": 1, "center": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "To,\n{{addressee}}", "if": "addressee", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "This is to certify that Networth of M/S {{client_name}}{{client_ids}}, having its registered office address at {{client_address}} has been calculated as under:", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Networth as on #: {{as_on}}", "confirm": "approved by the owner on 14-Oct-2026" },
        { "table": "networth", "confirm": "approved by the owner on 14-Oct-2026" },
        { "table": "bvps", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "# Networth calculated as per the audited annual report for the financial year {{fy_last}}.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "This is to certify that the above-mentioned information is true to the best of our knowledge and belief, according to the books and documents produced before us for verification.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "sign": 1, "confirm": "approved by the owner on 14-Oct-2026" }
      ],
      "combined": [
        { "p": "To,\n{{addressee}}", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Independent Practitioner's Report on certification of Turnover and Networth of M/S {{client_name}} as on {{date}} for the financial years {{years_text}}:", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Management's Responsibility for the Certificate", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "The preparation of the Statement is the responsibility of the Management of M/S {{client_name}} including the preparation and maintenance of all accounting and other relevant supporting records and documents. This responsibility includes the design, implementation and maintenance of internal control relevant to the preparation and presentation of the Statement and applying an appropriate basis of preparation and making estimates that are reasonable in the circumstances.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Practitioner's Responsibility", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "We conducted our examination of the Statement in accordance with the Guidance Note on Reports or Certificates for Special Purposes issued by the Institute of Chartered Accountants of India. The Guidance Note requires that we comply with the ethical requirements of the Code of Ethics issued by the Institute of Chartered Accountants of India.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "We have complied with the relevant applicable requirements of the Standard on Quality Control (SQC) 1, Quality Control for Firms that Perform Audits and Reviews of Historical Financial Information and Other Assurance and Related Services Engagements.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "We have verified the books of accounts and related documents of M/S {{client_name}} and on verification of records, we hereby certify the Annual Turnover of the mentioned entity during the financial years {{years_text}} and its Networth as on {{as_on}}. For details refer Annexure I.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Restriction on Use", "b": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "The certificate providing the information is addressed to and provided to {{addressee}} on the request of M/S {{client_name}}. Accordingly, our certificate should not be distributed or otherwise made available to any other person or used for any other purpose. Accordingly, we do not accept or assume any liability or any duty of care for any other purpose or to any other person to whom this certificate is shown or into whose hands it may come without our prior consent in writing.", "confirm": "approved by the owner on 14-Oct-2026" },
        { "sign": 1, "encl": "Annexure - I", "confirm": "approved by the owner on 14-Oct-2026" },
        { "pb": 1 },
        { "p": "ANNEXURE - I", "b": 1, "center": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Turnover Statement:", "b": 1, "center": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "table": "turnover", "confirm": "approved by the owner on 14-Oct-2026" },
        { "p": "Networth Statement as on {{as_on}}:", "b": 1, "center": 1, "confirm": "approved by the owner on 14-Oct-2026" },
        { "table": "networth", "confirm": "approved by the owner on 14-Oct-2026" },
        { "sign": 1, "confirm": "approved by the owner on 14-Oct-2026" }
      ]
    }
  },
  "sign": {
    "lines": ["For {{firm_name}}", "Chartered Accountants", "FRN: {{frn}}", "", "", "{{signatory}}", "({{designation}})", "M. No. {{membership_no}}", "UDIN: {{udin}}", "", "Place: {{place}}", "Date: {{date}}"],
    "confirm": "approved by the owner on 14-Oct-2026"
  },
  "basis": {
    "signed": "the audited financial statements of the {{client_kind_word}} for the financial year {{fy}}",
    "books": "the books of account of the {{client_kind_word}} for the financial year {{fy}} (not audited: the signed financial statements were not available)",
    "typed": "the audited financial statements of the {{client_kind_word}} for the financial year {{fy}} (figures as given by the Management)",
    "confirm": "approved by the owner on 14-Oct-2026"
  }
};
