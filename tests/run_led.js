// node run_led.js - the ledger master on the VMS books: guesses from Tally's masters and the day book
const fs = require("fs"), {load, openBlob} = require("./harness"), {HTML, DATA, CACHE, OUT} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "MONTHS", "fmtDate", "STATE_CODES", "Books", "LedMaster", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "INR"]);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  b.ledInfo = ms.info; b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b;
  const before = x.GSTR.threeB("202506", "07");
  x.LedMaster.refresh(b);
  const L = x.LedMaster, tax = Object.entries(b.map).filter(([n, m]) => L.taxLike(n, m, b.ledInfo[n]));
  console.log("tax ledgers: " + tax.length + ", to confirm: " + L.pending(b).length);
  tax.sort((a, c) => a[1].what.localeCompare(c[1].what)).forEach(([n, m]) => console.log("  " + n.padEnd(40) + " " + L.label(m.what).padEnd(34) + " " + [m.tax, m.side, m.reg, m.section, m.rate, m.gstRate].filter(v => v != null && v !== "").join(" ").padEnd(16) + " | " + (m.why || "") + (L.checks(b, n, m).length ? "  !! " + L.checks(b, n, m).join("; ") : "")));
  const g = n => b.map[n];
  ok(g("07 IGST INPUT").what === "gst" && g("07 IGST INPUT").tax === "IGST" && g("07 IGST INPUT").side === "input" && g("07 IGST INPUT").reg === "07", "07 IGST INPUT: GST, IGST, input, Delhi");
  ok(g("09 SGST  OUTPUT").side === "output" && g("09 SGST  OUTPUT").reg === "09", "09 SGST OUTPUT: output, UP");
  ok(g("07 Electronic Credit Ledger IGST").what === "gst_setoff" && g("07 CURRENT GST PAYABLE").what === "gst_setoff", "electronic credit ledger and current GST payable: set-off");
  ok(g("INTEREST AND LATE FEE ON GST").what === "gst_interest", "GST interest and late fee");
  ok(g("CONTROL A/C 07 IGST INPUT").what === "gst_control", "CONTROL A/C ... INPUT: control account, to confirm");
  ok(g("TDS ON CONTRACT 194C 2%").section === "194C" && g("TDS ON CONTRACT 194C 2%").rate === 2, "194C 2%");
  ok(g("TDS RECEIVABLE A.Y (2026-27)").what === "tds_receivable" && g("INTEREST ON TDS").what === "tds_interest", "TDS receivable and TDS interest");
  ok(g("TDS PAYABLE CURRENT").what === "tds_clearing" && !L.checks(b, "TDS PAYABLE CURRENT", g("TDS PAYABLE CURRENT")).length, "TDS PAYABLE CURRENT: a clearing account, by rule (month-end transfers in, bank payments out)");
  ok(g("TCS RECEIVABLE").what === "tcs_receivable", "TCS receivable");
  ok(!L.taxLike("SHORT AND EXCESS", g("SHORT AND EXCESS"), b.ledInfo["SHORT AND EXCESS"]) && !L.taxLike("EXP. PAYABLE", g("EXP. PAYABLE"), {}), "ordinary ledgers are not asked about");
  ok(L.pending(b).length === tax.length, "nothing counts as confirmed until you confirm it");
  // set-off ledgers no longer inflate value; control accounts leave ITC until confirmed as GST
  const after = x.GSTR.threeB("202506", "07");
  console.log("  June 3B ITC IGST: before " + before.itc.igst + ", with the guesses " + after.itc.igst);
  L.confirm(b, L.pending(b).map(z => z[0]), true);
  ok(L.pending(b).length === 0, "confirm all: nothing left");
  // a choice by hand
  L.applyWhat(g("CONTROL A/C 07 IGST INPUT"), "gst"); ok(g("CONTROL A/C 07 IGST INPUT").kind === "gst" && g("CONTROL A/C 07 IGST INPUT").tax === "IGST", "changing it to GST keeps its head");
  L.applyWhat(g("TDS PAYABLE CURRENT"), "none"); ok(!L.taxLike("TDS PAYABLE CURRENT", g("TDS PAYABLE CURRENT"), {}) , "'Not a tax ledger' takes it out of the masters");
  // a new ledger in Tally later is asked about
  b.ledInfo["07 IGST RCM PAYABLE"] = {group: "07 DELHI GST", taxType: "GST", dutyHead: "IGST"}; L.refresh(b);
  ok(g("07 IGST RCM PAYABLE").what === "gst_rcm" && g("07 IGST RCM PAYABLE").side === "output" && !g("07 IGST RCM PAYABLE").ok, "a new reverse-charge ledger: guessed and waiting for you");
  b.ledInfo["07 IGST INPUT 18%"] = {group: "07 DELHI GST", taxType: "GST", dutyHead: "IGST"}; L.refresh(b);
  ok(g("07 IGST INPUT 18%").gstRate === 18, "a rate-wise ledger carries its rate");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
