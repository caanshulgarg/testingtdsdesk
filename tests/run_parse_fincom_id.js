// node run_parse_fincom_id.js - the cloud reader (server/tally-cloud/parse.js) takes FinCom's tag "TDSDesk:<id>" from the
// FULL narration of an entry (migration-37 item 14: tally_vouchers.fincom_id), before the narration is cut to 300
// characters: v.fid. The narration itself (narr) is as before: cut to 300 keeping the tag at its end when it is there.
const path = require("path");
let fails = 0;
const ok = (cond, what) => { console.log((cond ? "  ok   " : "  FAIL ") + what); if (!cond) fails++; };
const vch = (guid, narr) => '<VOUCHER REMOTEID="' + guid + '" VCHTYPE="Payment"><DATE>20260501</DATE><GUID>' + guid + '</GUID><ALTERID>5</ALTERID><VOUCHERNUMBER>1</VOUCHERNUMBER>' +
  '<NARRATION>' + narr + '</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Rent</LEDGERNAME><AMOUNT>-100</AMOUNT></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>100</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>';
(async () => {
  const { parseDay } = await import(path.join(__dirname, "..", "server", "tally-cloud", "parse.js"));
  const long = "x".repeat(400);
  const r = parseDay([
    vch("g1", "Rent for May | TDSDesk:ab12"),                       // the tag at the end of a short narration
    vch("g2", long + " | TDSDesk:cd.34-5_z"),                        // the tag at the end of a long one (shortNarr keeps it)
    vch("g3", "TDSDesk:ef56 | " + long),                             // the tag at the start of a long one: cut away from narr, still the id
    vch("g4", "no tag here"),
    vch("g5", "two TDSDesk:first and TDSDesk:second"),               // the first tag is the id
    vch("g6", "TDSDesk:&#13;&#10;broken"),                           // nothing usable after the colon
  ].join(""));
  const by = Object.fromEntries(r.vouchers.map(v => [v.guid, v]));
  ok(r.n === 6, "six entries read");
  ok(by.g1.fid === "ab12", "fid from a short narration (" + by.g1.fid + ")");
  ok(by.g1.narr === "Rent for May | TDSDesk:ab12", "narr unchanged for a short narration");
  ok(by.g2.fid === "cd.34-5_z", "fid with dots, dashes and underscores (" + by.g2.fid + ")");
  ok(by.g2.narr.length <= 300 && /TDSDesk:cd\.34-5_z$/.test(by.g2.narr), "a long narration is still cut to 300 keeping the tag at its end");
  ok(by.g3.fid === "ef56", "fid read from the full narration when the tag is at the start of a long one (" + by.g3.fid + ")");
  ok(by.g3.narr.length === 300 && by.g3.narr.startsWith("TDSDesk:ef56"), "narr cut to 300 as before");
  ok(by.g4.fid === null, "no tag: fid null (" + by.g4.fid + ")");
  ok(by.g5.fid === "first", "two tags: the first is the id");
  ok(by.g6.fid === null, "a tag with nothing usable after the colon: null (" + by.g6.fid + ")");
  ok(r.lines.length === 12 && r.lines.every(l => l.length === 6), "lines as before: [guid, ledger, amount, hsn, rate, bills]");
  console.log(fails ? "\n" + fails + " failure(s)" : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
