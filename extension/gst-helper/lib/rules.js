/* FinCom GST helper: the plain rules (no AI, no guessing). Shared by the content script, the side panel and the tests.
 * Money is compared in paise (whole numbers), so 0.1 + 0.2 never differs from 0.3.
 *   tables1(json)      GSTR-1 JSON (FinCom's own file) -> FinCom's figures per portal table
 *   records1(json, k)  the records of one table, flat, in the order they are typed into the portal
 *   fields3b(json)     GSTR-3B JSON (FinCom's threeBJson) -> every 3B box the helper types, with its value
 *   compare(a, b)      FinCom against the portal, box by box: the differences, to the paisa
 */
(function (root) {
  "use strict";
  const paise = (v) => {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return Math.round(v * 100);
    // the portal's own text: "₹ 1,23,456.78", "(-) 500.00", "-500", "1,000"
    let s = String(v).replace(/[₹,\s]/g, "").replace(/^Rs\.?/i, "");
    let neg = false;
    if (/^\(-\)/.test(s)) { neg = true; s = s.slice(3); }
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
    if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return NaN;
    const n = Math.round(parseFloat(s) * 100);
    return neg ? -n : n;
  };
  const rupees = (p) => (p < 0 ? "-" : "") + (Math.abs(p) / 100).toFixed(2);
  const money = (p) => { const n = Math.abs(p) / 100, s = n.toFixed(2), [i, d] = s.split("."); const l3 = i.slice(-3), rest = i.slice(0, -3);
    return (p < 0 ? "-" : "") + "₹" + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + l3 + "." + d; };

  // the portal's GSTR-1 tables, in its own order, with the JSON part each is filed from
  const R1 = [
    ["b2b", "4A, 4B, 6B, 6C - B2B, SEZ, DE invoices", "inv"],
    ["b2ba", "9A - Amended B2B invoices", "inv"],
    ["b2cl", "5 - B2C (Large) invoices", "inv"],
    ["b2cla", "9A - Amended B2C (Large) invoices", "inv"],
    ["exp", "6A - Exports invoices", "inv"],
    ["expa", "9A - Amended exports invoices", "inv"],
    ["b2cs", "7 - B2C (Others)", "row"],
    ["b2csa", "10 - Amended B2C (Others)", "row"],
    ["nil", "8 - Nil rated, exempted and non-GST supplies", "nil"],
    ["cdnr", "9B - Credit / Debit notes (Registered)", "nt"],
    ["cdnra", "9C - Amended credit / debit notes (Registered)", "nt"],
    ["cdnur", "9B - Credit / Debit notes (Unregistered)", "flat"],
    ["cdnura", "9C - Amended credit / debit notes (Unregistered)", "flat"],
    ["at", "11A(1), 11A(2) - Tax liability (advances received)", "adv"],
    ["ata", "11A - Amended tax liability (advances received)", "adv"],
    ["txpd", "11B(1), 11B(2) - Adjustment of advances", "adv"],
    ["txpda", "11B - Amended adjustment of advances", "adv"],
    ["hsn", "12 - HSN-wise summary of outward supplies", "hsn"],
    ["doc_issue", "13 - Documents issued", "doc"],
  ];
  const HEADS = ["txval", "iamt", "camt", "samt", "csamt"];
  const zero = () => ({ n: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
  const addItems = (t, itms, sign) => (itms || []).forEach((it) => { const d = it.itm_det || it;
    t.txval += sign * paise(d.txval !== undefined ? d.txval : d.ad_amt); t.iamt += sign * paise(d.iamt); t.camt += sign * paise(d.camt); t.samt += sign * paise(d.samt); t.csamt += sign * paise(d.csamt); });
  // a credit note takes its value off, as the portal's summary nets it (question to the owner: confirm on the real summary)
  const noteSign = (x) => (String(x.ntty || "C").toUpperCase() === "C" ? -1 : 1);

  function tables1(json) {
    const out = {};
    R1.forEach(([k, label, shape]) => {
      const part = json && json[k];
      if (!part || (Array.isArray(part) && !part.length)) return;
      const t = Object.assign(zero(), { key: k, label });
      if (shape === "inv") part.forEach((g) => (g.inv || []).forEach((i) => { t.n++; t.val += paise(i.val); addItems(t, i.itms, 1); }));
      else if (shape === "nt") part.forEach((g) => (g.nt || []).forEach((i) => { const s = noteSign(i); t.n++; t.val += s * paise(i.val); addItems(t, i.itms, s); }));
      else if (shape === "flat") part.forEach((i) => { const s = noteSign(i); t.n++; t.val += s * paise(i.val); addItems(t, i.itms, s); });
      else if (shape === "row") part.forEach((r) => { t.n++; if (r.itms) addItems(t, r.itms, 1); else addItems(t, [r], 1); });
      else if (shape === "adv") part.forEach((r) => { t.n++; addItems(t, r.itms, 1); });
      else if (shape === "nil") { t.nil = 0; t.expt = 0; t.ngsup = 0; (part.inv || []).forEach((r) => { t.n++; t.nil += paise(r.nil_amt); t.expt += paise(r.expt_amt); t.ngsup += paise(r.ngsup_amt); }); }
      else if (shape === "hsn") { const rows = [].concat(part.data || [], part.hsn_b2b || [], part.hsn_b2c || []); rows.forEach((r) => { t.n++; addItems(t, [r], 1); }); }
      else if (shape === "doc") { t.totnum = 0; t.cancel = 0; t.net = 0; ((part.doc_det) || []).forEach((d) => (d.docs || []).forEach((x) => { t.n++; t.totnum += +x.totnum || 0; t.cancel += +x.cancel || 0; t.net += +x.net_issue || 0; })); }
      if (t.n) out[k] = t;
    });
    return out;
  }

  // the records of one table, as they are typed into the portal's "Add record" form
  function records1(json, k) {
    const part = json && json[k];
    if (!part) return [];
    const items = (itms) => (itms || []).map((it) => { const d = it.itm_det || it; return { rt: +d.rt, txval: d.txval !== undefined ? d.txval : d.ad_amt, iamt: d.iamt || 0, camt: d.camt || 0, samt: d.samt || 0, csamt: d.csamt || 0 }; });
    if (["b2b", "b2ba", "cdnr", "cdnra"].includes(k)) {
      const inner = k.startsWith("cdnr") ? "nt" : "inv";
      return [].concat(...part.map((g) => (g[inner] || []).map((i) => Object.assign({ ctin: g.ctin }, i, { itms: items(i.itms) }))));
    }
    if (["b2cl", "b2cla"].includes(k)) return [].concat(...part.map((g) => (g.inv || []).map((i) => Object.assign({ pos: g.pos }, i, { itms: items(i.itms) }))));
    if (["exp", "expa"].includes(k)) return [].concat(...part.map((g) => (g.inv || []).map((i) => Object.assign({ exp_typ: g.exp_typ }, i, { itms: items(i.itms) }))));
    if (["cdnur", "cdnura"].includes(k)) return part.map((i) => Object.assign({}, i, { itms: items(i.itms) }));
    if (["b2cs", "b2csa"].includes(k)) return part.map((r) => r.itms ? Object.assign({}, r, { itms: items(r.itms) }) : Object.assign({}, r, { itms: items([r]) }));
    if (["at", "ata", "txpd", "txpda"].includes(k)) return part.map((r) => Object.assign({}, r, { itms: items(r.itms) }));
    if (k === "nil") return (part.inv || []).map((r) => Object.assign({}, r));
    if (k === "hsn") return [].concat((part.data || []).map((r) => Object.assign({ tab: "all" }, r)), (part.hsn_b2b || []).map((r) => Object.assign({ tab: "b2b" }, r)), (part.hsn_b2c || []).map((r) => Object.assign({ tab: "b2c" }, r)));
    if (k === "doc_issue") return [].concat(...((part.doc_det || []).map((d) => (d.docs || []).map((x) => Object.assign({ doc_num: d.doc_num }, x)))));
    return [];
  }

  // GSTR-3B: every box the helper types, keyed as selectors.js names them; values in rupees as FinCom worked them out
  function fields3b(j) {
    const f = [], add = (sec, key, label, v) => f.push({ sec, key, label, value: +(+v || 0).toFixed(2) });
    const sd = j.sup_details || {};
    const five = (sec, pre, label, o, cols) => cols.forEach((c) => add(sec, pre + "." + c, label + " · " + COL[c], (o || {})[c]));
    five("3.1", "3.1a", "3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", sd.osup_det, HEADS);
    five("3.1", "3.1b", "3.1(b) Outward taxable supplies (zero rated)", sd.osup_zero, ["txval", "iamt", "csamt"]);
    five("3.1", "3.1c", "3.1(c) Other outward supplies (nil rated, exempted)", sd.osup_nil_exmp, ["txval"]);
    five("3.1", "3.1d", "3.1(d) Inward supplies (liable to reverse charge)", sd.isup_rev, HEADS);
    five("3.1", "3.1e", "3.1(e) Non-GST outward supplies", sd.osup_nongst, ["txval"]);
    const ie = j.itc_elg || {}, by = (list, ty) => (list || []).find((x) => x.ty === ty) || {};
    [["4A1", "IMPG", "4(A)(1) Import of goods"], ["4A2", "IMPS", "4(A)(2) Import of services"], ["4A3", "ISRC", "4(A)(3) Inward supplies liable to reverse charge"],
      ["4A4", "ISD", "4(A)(4) Inward supplies from ISD"], ["4A5", "OTH", "4(A)(5) All other ITC"]].forEach(([k, ty, l]) => {
      const cols = ty === "IMPG" || ty === "IMPS" ? ["iamt", "csamt"] : ["iamt", "camt", "samt", "csamt"]; five("4", k, l, by(ie.itc_avl, ty), cols); });
    five("4", "4B1", "4(B)(1) As per rules 38, 42 and 43 of CGST Rules and section 17(5)", by(ie.itc_rev, "RUL"), ["iamt", "camt", "samt", "csamt"]);
    five("4", "4B2", "4(B)(2) Others", by(ie.itc_rev, "OTH"), ["iamt", "camt", "samt", "csamt"]);
    five("4", "4D1", "4(D)(1) ITC reclaimed which was reversed under 4(B)(2) in earlier tax period", by(ie.itc_inelg, "RUL"), ["iamt", "camt", "samt", "csamt"]);
    five("4", "4D2", "4(D)(2) Ineligible ITC under section 16(4) and ITC restricted due to PoS rules", by(ie.itc_inelg, "OTH"), ["iamt", "camt", "samt", "csamt"]);
    const iw = (j.inward_sup || {}).isup_details || [], g = iw.find((x) => x.ty === "GST") || {}, n = iw.find((x) => x.ty === "NONGST") || {};
    add("5", "5.gst.inter", "5 From a supplier under composition scheme, exempt and nil rated supply · Inter-State", g.inter);
    add("5", "5.gst.intra", "5 From a supplier under composition scheme, exempt and nil rated supply · Intra-State", g.intra);
    add("5", "5.nongst.inter", "5 Non-GST supply · Inter-State", n.inter);
    add("5", "5.nongst.intra", "5 Non-GST supply · Intra-State", n.intra);
    return f;
  }
  // 3.2: one row per place of supply, typed as rows (unregistered persons; composition and UIN holders when FinCom has them)
  function rows32(j) {
    const s = j.inter_sup || {}, rows = [];
    [["unreg_details", "Supplies made to unregistered persons"], ["comp_details", "Supplies made to composition taxable persons"], ["uin_details", "Supplies made to UIN holders"]]
      .forEach(([k, l]) => (s[k] || []).forEach((r) => rows.push({ kind: k, label: l, pos: String(r.pos).padStart(2, "0"), txval: +r.txval || 0, iamt: +r.iamt || 0 })));
    return rows;
  }
  // 4(C) net ITC, worked out by the portal: what FinCom expects it to read
  function net4c(j) { const n = ((j.itc_elg || {}).itc_net) || {}; return ["iamt", "camt", "samt", "csamt"].map((c) => ({ key: "4C." + c, label: "4(C) Net ITC available · " + COL[c], value: +n[c] || 0 })); }
  const COL = { txval: "Taxable value", iamt: "Integrated tax", camt: "Central tax", samt: "State/UT tax", csamt: "Cess", val: "Invoice value", n: "Records" };

  // FinCom's set-off (sections 49, 49A, rule 88A) against the portal's "Payment of tax" table
  function setoffRows(pay) {
    if (!pay) return [];
    const u = pay.use || {}, c = pay.cash || {}, r = [];
    const H = { igst: "Integrated tax", cgst: "Central tax", sgst: "State/UT tax", cess: "Cess" };
    // tax payable: the month's outward tax (never below nil) and the reverse charge tax
    if (pay.due) ["igst", "cgst", "sgst", "cess"].forEach((h) => r.push({ key: "pay.liab." + h, label: "Tax payable: " + H[h], value: Math.max(0, +pay.due[h] || 0) + (+((pay.rcmCash || {})[h]) || 0) }));
    [["igst", "igst"], ["igst", "cgst"], ["igst", "sgst"], ["cgst", "cgst"], ["cgst", "igst"], ["sgst", "sgst"], ["sgst", "igst"], ["cess", "cess"]].forEach(([from, to]) =>
      r.push({ key: "pay.itc." + from + "." + to, label: "Paid through ITC: " + H[from] + " credit against " + H[to], value: +((u[from] || {})[to] || 0) }));
    ["igst", "cgst", "sgst", "cess"].forEach((h) => r.push({ key: "pay.cash." + h, label: "Paid in cash: " + H[h], value: +(c[h] || 0) }));
    return r;
  }

  // FinCom against the portal. expected: [{key,label,value(rupees),count?}]; got: {key: text or number read from the portal}
  // The owner's rule (17-Oct-2026): a money difference under Rs 1.00 is rounding (shown grey, needs no reason); Rs 1.00 or
  // more is a difference (highlighted). A count that differs, or a box the portal did not show, is always a difference
  // (never taken as zero).
  const ROUNDING = 100;   // paise
  function compare(expected, got) {
    const rows = expected.map((e) => {
      const has = Object.prototype.hasOwnProperty.call(got, e.key), p = has ? paise(got[e.key]) : NaN, f = paise(e.value);
      const read = has && !Number.isNaN(p), d = read ? p - f : NaN;
      const ok = read && d === 0, rounding = read && !e.count && d !== 0 && Math.abs(d) < ROUNDING;
      return { key: e.key, label: e.label, fincom: rupees(f), portal: has ? (Number.isNaN(p) ? String(got[e.key]) : rupees(p)) : "not shown", diff: read ? rupees(d) : "", ok, rounding, status: ok ? "same" : rounding ? "rounding" : "differs" };
    });
    return { rows, differences: rows.filter((r) => r.status === "differs"), rounding: rows.filter((r) => r.rounding), agree: rows.every((r) => r.status !== "differs") };
  }
  // GSTR-1: FinCom's tables against the portal's summary read back, table by table
  function compare1(fin, portal) {
    const exp = [], got = {};
    Object.values(fin).forEach((t) => {
      const cols = t.key === "nil" ? ["n", "nil", "expt", "ngsup"] : t.key === "doc_issue" ? ["n", "totnum", "cancel", "net"] : ["n", "val", "txval", "iamt", "camt", "samt", "csamt"].filter((c) => c !== "val" || !["b2cs", "b2csa", "at", "ata", "txpd", "txpda", "hsn"].includes(t.key));
      cols.forEach((c) => { const key = t.key + "." + c, count = c === "n" || t.key === "doc_issue"; exp.push({ key, label: t.label + " · " + (C1[c] || c), value: count ? (t[c] || 0) : (t[c] || 0) / 100, count });
        const p = portal[t.key]; if (p && p[c] !== undefined) got[key] = p[c]; });
    });
    // a table the portal shows that FinCom has nothing for
    Object.keys(portal).forEach((k) => { if (!fin[k]) { const p = portal[k]; if (p && (+p.n || 0) > 0) { exp.push({ key: k + ".n", label: k + " · records (FinCom has none)", value: 0, count: true }); got[k + ".n"] = p.n; } } });
    // counts are compared as whole numbers, not paise
    const res = compare(exp, got);
    res.rows.forEach((r, i) => { if (exp[i].count) { r.fincom = String(exp[i].value); if (r.portal !== "not shown") r.portal = String(Math.round(paise(got[exp[i].key]) / 100)); r.diff = r.portal === "not shown" ? "" : String(Math.round(paise(got[exp[i].key]) / 100) - exp[i].value); } });
    return res;
  }
  const C1 = { n: "Records", val: "Value", txval: "Taxable value", iamt: "Integrated tax", camt: "Central tax", samt: "State/UT tax", csamt: "Cess", nil: "Nil rated", expt: "Exempted", ngsup: "Non-GST", totnum: "Total number", cancel: "Cancelled", net: "Net issued" };

  // the ARN the portal shows after filing: 15 characters, AA + state code + ... (never made up: only read from the page)
  const ARN_RE = /\bAA\d{2}\d{4}[0-9A-Z]{7}\b/;
  function arnIn(text) { const m = String(text || "").match(ARN_RE); return m ? m[0] : ""; }

  // the words of a button the helper must never press: filing, payment, posting to the ledger, the OTP / DSC steps
  const NEVER = /(^file$|^file\b|\bfile (gstr|return|with|statement|nil)|\bsubmit\b|e-?sign|\bevc\b|\bdsc\b|make payment|post credit|offset liabilit|pay now|proceed to file|create challan|generate challan|\bsign\b)/i;
  function forbidden(text) { return NEVER.test(String(text || "").replace(/\s+/g, " ").trim()); }

  const R = { paise, rupees, money, ROUNDING, R1, tables1, records1, fields3b, rows32, net4c, setoffRows, compare, compare1, arnIn, forbidden, COL, C1 };
  root.GSTH_RULES = R;
  if (typeof module !== "undefined" && module.exports) module.exports = R;
})(typeof self !== "undefined" ? self : globalThis);
