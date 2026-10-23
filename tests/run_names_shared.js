// node run_names_shared.js - one rule for Tally names (finding 4, 02-Oct-2026): the app (Books reading a day book in the
// browser, and ledClean / ledKey of src/js/00-core.js) and the cloud reader (server/tally-cloud/parse.js, parseDay, as
// tally-ingest runs it) are fed the same names in the same day book, and must give the same clean names and keys.
// Both call server/_shared/names.js; this also checks the app's build carries that file unchanged.
// "Orchid Lane Hospitality Pvt Ltd&#13;&#10;(Noida)" was two ledgers before: the cloud read the line break as two spaces.
const fs = require("fs"), path = require("path");
const {load, HTML} = require("./harness");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const J = JSON.stringify;

// [as written in Tally's XML, the clean name, its key]
const NAMES = [
  ["Orchid Lane Hospitality Pvt Ltd&#13;&#10;(Noida)", "Orchid Lane Hospitality Pvt Ltd (Noida)", "orchid lane hospitality pvt ltd (noida)"],
  ["Kashi IT&#10;Solutions", "Kashi IT Solutions", "kashi it solutions"],
  ["MCS Project Pvt Ltd\r\n", "MCS Project Pvt Ltd", "mcs project pvt ltd"],
  ["Rakvik Tech\r\nPrivate Limited", "Rakvik Tech Private Limited", "rakvik tech private limited"],
  ["RAKVIK TECHNOLOGIES PRIVATE LIMITED&amp;#13;&amp;#10;&amp;#13;&amp;#10;", "RAKVIK TECHNOLOGIES PRIVATE LIMITED", "rakvik technologies private limited"],
  ["R &amp; D Services", "R & D Services", "r & d services"],
  ["&#4; Primary", "Primary", "primary"],
  ["   Leading And Trailing   ", "Leading And Trailing", "leading and trailing"],
  ["Arktos  Control &amp; Instruments", "Arktos  Control & Instruments", "arktos control & instruments"],
  ["Elen  Blossoms &#13;&#10;  and Greens Ltd", "Elen  Blossoms and Greens Ltd", "elen blossoms and greens ltd"],
  ["Yellow Media Pvt. Ltd", "Yellow Media Pvt. Ltd", "yellow media pvt. ltd"],
  ["Yellow Media Pvt Ltd", "Yellow Media Pvt Ltd", "yellow media pvt ltd"],
  ["Shree &quot;Ganesh&quot; &apos;Traders&apos; &lt;Delhi&gt;", "Shree \"Ganesh\" 'Traders' <Delhi>", "shree \"ganesh\" 'traders' <delhi>"],
  ["Caf&#233; Rupee &#8377; Ltd", "Café Rupee ₹ Ltd", "café rupee ₹ ltd"]
];
// one entry per name: the name as the party and as a ledger line (balanced by a bank line)
const day = '<ENVELOPE>' + NAMES.map(([raw], i) =>
  '<TALLYMESSAGE><VOUCHER REMOTEID="g-' + i + '" VCHTYPE="Sales"><DATE>20260302</DATE><GUID>g-' + i + '</GUID><ALTERID>' + (i + 1) + '</ALTERID>' +
  '<VOUCHERNUMBER>' + (i + 1) + '</VOUCHERNUMBER><PARTYLEDGERNAME>' + raw + '</PARTYLEDGERNAME>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + raw + '</LEDGERNAME><AMOUNT>-' + (100 + i) + '.00</AMOUNT></ALLLEDGERENTRIES.LIST>' +
  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><AMOUNT>' + (100 + i) + '.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>').join("") + '</ENVELOPE>';

(async () => {
  const shared = await import(path.join(__dirname, "..", "server", "_shared", "names.js"));
  const cloud = await import(path.join(__dirname, "..", "server", "tally-cloud", "parse.js"));
  const h = load(HTML, ["num", "r2", "Books"]), X = h.x;

  // 0. the app's build carries server/_shared/names.js as it is (build.py puts it first, without its export line)
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "_shared", "names.js"), "utf8").replace(/^export \{[^}]*\};\s*$/m, "");
  const html = fs.readFileSync(HTML, "utf8");
  ok(html.indexOf(src) >= 0, "the app's build carries server/_shared/names.js unchanged (" + path.relative(process.cwd(), HTML) + ")");
  ok(X.ledClean("A&#13;&#10;B") === "A B" && X.ledKey("A  B") === "a b" && X.ledNm("A\r\n") === "A", "00-core's ledClean, ledKey and ledNm answer through it");

  // 1. the app's path: Books reads the day book; the cloud's: parseDay
  const app = await X.Books.importDayBook(new Blob([day], {type: "text/xml"}));
  const av = new Map(app.vouchers.map(v => [v.id, v]));
  const r = cloud.parseDay(day);
  const cv = new Map(r.vouchers.map(v => [v.guid, v]));
  ok(app.vouchers.length === NAMES.length && r.n === NAMES.length, "every entry read by both (" + app.vouchers.length + ", " + r.n + ")");
  NAMES.forEach(([raw, clean, key], i) => {
    const a = av.get("g-" + i), c = cv.get("g-" + i);
    const aLed = a && a.ent.find(e => e.l !== "HDFC Bank"), cLed = r.lines.find(l => l[0] === "g-" + i && l[1] !== "HDFC Bank");
    const got = {
      appParty: a && a.party, appLedger: aLed && aLed.l, cloudParty: c && c.party, cloudLedger: cLed && cLed[1],
      appClean: X.ledClean(raw), cloudClean: cloud.cleanName(raw), sharedClean: shared.namesClean(raw)
    };
    const same = Object.values(got).every(x => x === clean);
    ok(same, J(raw) + " -> " + J(clean) + (same ? "" : " " + J(got)));
    const keys = {app: X.ledKey(raw), appOfRead: aLed && X.ledKey(aLed.l), cloud: cloud.namesKey(raw), cloudOfRead: cLed && cloud.namesKey(cLed[1]), shared: shared.namesKey(raw)};
    const kSame = Object.values(keys).every(x => x === key);
    ok(kSame, "  key " + J(key) + (kSame ? "" : " " + J(keys)));
  });

  // 2. the masters as the app reads them (Books.importMasters: the ledger's name and its group) match too
  const masters = '<ENVELOPE>' + NAMES.map(([raw], i) => '<TALLYMESSAGE><LEDGER NAME="' + raw.replace(/"/g, "&quot;") + '"><PARENT>Sundry Debtors&#13;&#10;</PARENT></LEDGER></TALLYMESSAGE>').join("") + '</ENVELOPE>';
  const m = await X.Books.importMasters(new Blob([masters], {type: "text/xml"}));
  const under = (m && (m.under || (m.data && m.data.under))) || {};
  const want = NAMES.map(n => n[1]).sort(), have = Object.keys(under).sort();
  ok(J(have) === J(want), "the masters' names read by the app are the same clean names" + (J(have) === J(want) ? "" : ": " + J(have)));
  ok(Object.values(under).every(p => p === "Sundry Debtors"), "their group too, without its line break");

  // 3. keys meet what they should and nothing more
  ok(shared.namesKey("Orchid Lane Hospitality Pvt Ltd  (Noida)") === shared.namesKey("Orchid Lane Hospitality Pvt Ltd&#13;&#10;(Noida)"), "a name with two spaces meets the same name with a line break, by key");
  ok(shared.namesClean("Orchid Lane Hospitality Pvt Ltd  (Noida)") !== shared.namesClean("Orchid Lane Hospitality Pvt Ltd (Noida)"), "but its clean name keeps the two spaces (the name Tally posts to)");
  ok(shared.namesKey("Yellow Media Pvt. Ltd") !== shared.namesKey("Yellow Media Pvt Ltd"), "\"Pvt. Ltd\" and \"Pvt Ltd\" stay two keys (no new equivalences)");
  ok(shared.namesClean(null) === "" && shared.namesKey(undefined) === "", "nothing in, nothing out");

  console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
