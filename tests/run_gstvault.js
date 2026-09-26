// node run_gstvault.js - Returns filed: portal PDFs recognised (form, GSTIN, period, ARN), the checklist by filing type,
// records filling the filing dates, and the year's zip
const fs = require("fs"), {load, openBlob, HTML, DATA, CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "normName", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ", "GSTV", "CRC_T", "crc32", "CO"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  const {ctx, x} = load(HTML, NAMES);
  Object.assign(ctx, {TextEncoder, Blob, DataView, ArrayBuffer, Uint8Array, Uint32Array});
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, twoBs: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
  ctx.S.companies = {c: {id: "c", name: "VMS Events Pvt Ltd", gstin: "07AADCV3366N1ZU"}}; ctx.S.coId = "c";
  const V = x.GSTV, G = ["07AADCV3366N1ZU", "09AADCV3366N1ZQ"];
  // how the portal prints its returns
  const r3b = "Form GSTR-3B\n[See rule 61(5)]\nYear 2025-26\nPeriod March\n1. GSTIN 07AADCV3366N1ZU\n2(a). Legal name of the registered person VMS EVENTS PRIVATE LIMITED\n2(c). ARN AA070426123456X\n2(d). Date of ARN 20/04/2026\n3.1 Details of Outward supplies and inward supplies liable to reverse charge (other than those covered by Table 3.1.1)";
  let d = V.detect(r3b, "download.pdf", G);
  ok(d.form === "r3b" && d.per === "202603" && d.gstin === "07AADCV3366N1ZU" && d.arn === "AA070426123456X" && d.arnDate === "2026-04-20" && d.sure, "GSTR-3B March 2026: form, period, GSTIN, ARN and its date read");
  const r1 = "FORM GSTR-1\n[See rule 59(1)]\nDetails of outward supplies of goods or services\nFinancial year 2025-26\nTax period February\n1. GSTIN 07AADCV3366N1ZU\n2(c). ARN AA0703261234567\n2(d). ARN date 11/03/2026\n4A Taxable outward supplies made to registered persons";
  d = V.detect(r1, "x.pdf", G);
  ok(d.form === "r1" && d.per === "202602" && d.arnDate === "2026-03-11", "GSTR-1 February 2026 (“ARN date”)");
  d = V.detect("Form GSTR-3B\nYear 2025-26\nPeriod January - March\nGSTIN 09AADCV3366N1ZQ\nDate of ARN 24/04/2026", "", G);
  ok(d.form === "r3b" && d.per === "202603" && d.gstin === "09AADCV3366N1ZQ", "a QRMP quarter's 3B (January - March) filed under its last month, for the UP GSTIN");
  d = V.detect("Invoice Furnishing Facility (IFF)\nFinancial year 2025-26 Tax period October\nGSTIN 07AADCV3366N1ZU\nGSTR-1 details", "", G);
  ok(d.form === "iff" && d.per === "202510", "IFF October, even though the text names GSTR-1");
  d = V.detect("FORM GSTR-1A\nFinancial Year 2025-26 Tax Period December\nGSTIN 07AADCV3366N1ZU", "", G);
  ok(d.form === "r1a" && d.per === "202512", "GSTR-1A December");
  d = V.detect("FORM GST CMP-08\nFinancial Year 2025-26\nQuarter Jan - Mar\nGSTIN 07AADCV3366N1ZU", "", G);
  ok(d.form === "cmp08" && d.per === "202603", "CMP-08 for Jan-Mar");
  d = V.detect("FORM GSTR-9\nAnnual Return\nFinancial Year 2024-25\nGSTIN 07AADCV3366N1ZU\nARN AA071225000111Q", "", G);
  ok(d.form === "gstr9" && d.per === "2024-25", "GSTR-9 2024-25");
  d = V.detect("FORM GSTR-9C\nReconciliation Statement\nFinancial Year 2024-25\nGSTIN 07AADCV3366N1ZU", "", G);
  ok(d.form === "gstr9c" && d.per === "2024-25", "GSTR-9C is not taken for GSTR-9");
  d = V.detect("", "GSTR3B_07AADCV3366N1ZU_022026.pdf", G);
  ok(d.form === "r3b" && d.per === "202602" && d.gstin === "07AADCV3366N1ZU" && d.sure, "a PDF with no readable text: read from the portal's file name");
  d = V.detect("GST PMT-06\nCPIN 26070700123456\nGSTIN 07AADCV3366N1ZU\nDate of deposit 24/11/2025", "challan.pdf", G);
  ok(d.form === "pmt06" && !d.sure && d.arnDate === "2025-11-24", "a PMT-06 challan with no period: waits to be sorted");
  d = V.detect("Form GSTR-3B Year 2025-26 Period March GSTIN 27AAACB1234C1Z5", "", G);
  ok(d.gstin === "27AAACB1234C1Z5", "another business's GSTIN is read as it is, so it can be refused");
  // the checklist follows the filing type
  let e = V.expected("2025-26", "07");
  ok(e.filter(r => r.form === "r1").length === 12 && e.filter(r => r.form === "r3b").length === 12 && e.some(r => r.form === "gstr9" && r.per === "2025-26" && r.due === "2026-12-31"), "monthly filer: 12 GSTR-1, 12 GSTR-3B and GSTR-9 for 2025-26");
  x.GSTSet.store("07").filing = [{type: "qrmp", from: "202510"}];
  e = V.expected("2025-26", "07");
  ok(e.filter(r => r.form === "r3b").length === 8 && e.filter(r => r.form === "iff").length === 4 && e.filter(r => r.form === "iff").every(r => r.optional), "QRMP from October: 6 monthly 3Bs and 2 quarterly; IFF in the quarters' first two months, optional");
  x.GSTSet.store("07").filing = [{type: "comp", from: "202604"}];
  e = V.expected("2026-27", "07");
  ok(e.filter(r => r.form === "cmp08").length === 4 && e.some(r => r.form === "gstr4" && r.due === "2027-06-30") && !e.some(r => r.form === "r3b" || r.form === "gstr9"), "composition in 2026-27: four CMP-08s and GSTR-4, no 3B or GSTR-9");
  x.GSTSet.store("07").filing = [];
  // a record: the ARN date fills the filing date typed on the GST screens, only when empty
  const rec = V.addRecord({reg: "07", form: "r3b", per: "202603", arn: "AA070426123456X", arnDate: "2026-04-20", name: "a.pdf", size: 10});
  ok(x.GSTF.peek("202603", "07").r3b === "2026-04-20" && V.status({form: "r3b", per: "202603"}, "07").s === "have", "a 3B PDF with its ARN date: March is shown as on file and its filing date filled");
  x.GSTF.rec("202602", "07").r3b = "2026-03-19";
  V.addRecord({reg: "07", form: "r3b", per: "202602", arnDate: "2026-03-22", name: "b.pdf", size: 10});
  ok(x.GSTF.peek("202602", "07").r3b === "2026-03-19", "a filing date already typed is not changed");
  ok(V.status({form: "r1", per: "202603", due: "2026-04-11"}, "07").s === "missing" && V.status({form: "r1", per: "202612", due: "2027-01-11"}, "07").s === "notdue", "missing when past its due date, not due yet otherwise");
  ok(V.fileName(rec) === "VMS-Events-Pvt-Ltd_07AADCV3366N1ZU_GSTR-3B_2026-03.pdf", "saved as client, GSTIN, return and period: " + V.fileName(rec));
  ok(V.perLabel("r3b", "202603", "07") === "Mar 2026" && V.years("07").includes("2025-26"), "periods and years named");
  // the year's zip opens as a zip with both files
  const z = V.zip([{name: "a.pdf", data: new TextEncoder().encode("%PDF-1.4 one")}, {name: "b.pdf", data: new TextEncoder().encode("%PDF-1.4 two!")}]);
  const zb = Buffer.from(await z.arrayBuffer()), outZ = (process.env.TDSDESK_OUT || "/tmp") + "/gstv-test.zip"; fs.writeFileSync(outZ, zb);
  const lst = require("child_process").execSync("python3 -c \"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip(), [(i.filename, len(z.read(i))) for i in z.infolist()])\" " + outZ).toString();
  ok(/None \[\('a\.pdf', 12\), \('b\.pdf', 13\)\]/.test(lst), "the year's zip holds every PDF, intact (" + lst.trim() + ")");
  const src = fs.readFileSync(HTML, "utf8"), sv = (src.match(/async function saveBooks\(\)\{[\s\S]*?\}\); \}/) || [""])[0];
  ok(/\bgstVault: b\.gstVault\b/.test(sv) && /job\.kind === "gstret"/.test(src), "records saved with the books; the cloud path is remembered once uploaded");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
