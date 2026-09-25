// node run_r1layout.js - our GSTR-1 JSON against the portal's own file (keys, HSN table 12, table 13), and 2B read against the portal's summary
const fs = require("fs"), {load, openBlob} = require("./harness"), {HTML, DATA, CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const PORTAL = process.env.TDSDESK_R1 || DATA + "/returns_25092026_R1_09AASCA7501M2Z4_offline_others_0-2.json";
const R2B = [["092025", 600705.5, 531250.21], ["122024", 282551.09, 379175.56], ["032025", 3974760.39, 1264340.92]];
(async () => {
  const {ctx, x} = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}});
  // plant: one sales invoice of March cancelled in Tally (no entries), in the same series
  const sale = b.vouchers.find(v => v.date.startsWith("202603") && v.type === "07 SALE");
  b.vouchers.push({id: "planted-cancel", date: "20260330", type: "07 SALE", no: sale.no.replace(/\d+$/, "9999"), cmp: sale.cmp, cancel: true, ent: [], hsn: []});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
  const P = JSON.parse(fs.readFileSync(PORTAL, "utf8"));
  const j = x.GSTR.toJson("202603", "07", {plain: true});
  // table 12
  ok(j.hsn && Array.isArray(j.hsn.hsn_b2b) && Array.isArray(j.hsn.hsn_b2c) && !j.hsn.data, "HSN in two lists, hsn_b2b and hsn_b2c, as the portal's September 2025 file");
  const pk = Object.keys(P.hsn.hsn_b2b[0]).sort().join(","), ours = Object.keys(j.hsn.hsn_b2b[0]).sort().join(",");
  ok(pk === ours, "HSN line has the portal's fields: " + ours);
  const svc = j.hsn.hsn_b2b.concat(j.hsn.hsn_b2c).filter(h => /^99/.test(h.hsn_sc));
  ok(svc.length && svc.every(h => h.uqc === "NA" && h.qty === 0), "services carry unit NA and no quantity, as the portal writes them");
  const caps = j.hsn.hsn_b2b.find(h => h.hsn_sc === "650500" && h.rt === 5);
  ok(caps && caps.uqc === "PCS" && caps.qty > 0 && /Xclamation/i.test(caps.desc), "goods carry Tally's unit, quantity and HSN description: " + JSON.stringify(caps && {uqc: caps.uqc, qty: caps.qty, desc: caps.desc}));
  const dec = x.GSTR.toJson("202504", "07", {plain: true});
  ok(dec.hsn && !dec.hsn.data && Array.isArray(dec.hsn.hsn_b2b), "April 2025 split too (from the January 2025 return period; the portal's December 2024 file has one list)");
  // table 13
  const dd = j.doc_issue.doc_det, n1 = dd.find(d => d.doc_num === 1), n5 = dd.find(d => d.doc_num === 5);
  ok(n1 && n1.docs.some(d => d.cancel === 1 && d.net_issue === d.totnum - 1), "documents issued: the cancelled invoice counted in its series");
  const cn = x.GSTR.outward("202603", "07").filter(r => r.kind === "CDNR");
  ok(!cn.length || (n5 && n5.docs.reduce((a, d) => a + d.totnum, 0) === cn.length), "credit notes under nature 5, as the portal files them (" + cn.length + ")");
  ok(Object.keys(P.doc_issue.doc_det[0].docs[0]).sort().join(",") === Object.keys(n1.docs[0]).sort().join(","), "table 13 lines have the portal's fields");
  // B2B invoice fields the upload needs, against the portal's
  const need = ["inum", "idt", "val", "pos", "rchrg", "inv_typ", "itms"], pinv = P.b2b[0].inv[0], oinv = j.b2b[0].inv[0];
  ok(need.every(k => k in pinv && k in oinv), "B2B invoices carry " + need.join(", "));
  ok(Object.keys(pinv.itms[0].itm_det).filter(k => k !== "camt" && k !== "samt" && k !== "iamt").every(k => k in oinv.itms[0].itm_det), "item fields as the portal's (rt, txval, csamt and the tax)");
  // 2B read against the portal's own summary
  R2B.forEach(([p, ig, cg]) => {
    const f = DATA + "/returns_R2B_09AASCA7501M2Z4_" + p + ".json";
    if (!fs.existsSync(f)) return;
    const t = x.GST2B.fromJson(JSON.parse(fs.readFileSync(f, "utf8")));
    const s = t.rows.filter(r => r.sec === "b2b").reduce((a, r) => ({igst: a.igst + r.igst, cgst: a.cgst + r.cgst}), {igst: 0, cgst: 0});
    ok(Math.abs(s.igst - ig) < 0.5 && Math.abs(s.cgst - cg) < 0.5, "2B " + p + ": B2B read as the portal's summary, IGST " + ig + ", CGST " + cg);
  });
  // a filed GSTR-1 downloaded from the portal is taken as filed
  const kept = x.GSTAmend.keep(P, "uploaded");
  ok(kept && kept.ym === "202509" && kept.gstin === "09AASCA7501M2Z4", "the portal's filed GSTR-1 is kept as the filed return for September 2025");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
