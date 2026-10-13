// node assistant_books.js OUT.json - the made-up books of tests/fixtures/books as FinCom's cloud copy holds them, for the
// FinCom Assistant tests (run_assistant_sql.py and the others): read by the app's own code (Books.importDayBook via the
// fixture cache, Books.importMasters, Books.mapLedgers, GST2B.fromJson), the way the bridge and the app put them in the
// cloud: each ledger with its group chain and opening, each entry with its lines (Tally's sign: a debit is negative), the
// ledger list's kinds ("map"), the masters' details ("ledInfo", with the MSME type) and the 2Bs ("twoBs").
const fs = require("fs"), path = require("path"), {load, openBlob, HTML, FIXTURE_DIR} = require("./harness");
const NAMES = ["num", "r2", "Books", "GST2B", "INR"];
(async () => {
  const out = process.argv[2] || path.join(__dirname, "out", "assistant-books.json");
  const {x} = load(HTML, NAMES);
  const db = await x.Books.importDayBook(await openBlob(path.join(FIXTURE_DIR, "DayBook.xml")));
  const ms = await x.Books.importMasters(await openBlob(path.join(FIXTURE_DIR, "Master.xml")));
  const map = x.Books.mapLedgers(db.vouchers, {});
  const chain = (p) => { const c = []; while (p && !c.includes(p) && c.length < 30) { c.push(p); p = ms.groups[p] || ""; } return c; };
  const names = new Set(Object.keys(ms.info).concat(db.vouchers.flatMap((v) => v.ent.map((e) => e.l))));
  const ledgers = Array.from(names).sort().map((n) => {
    const i = ms.info[n] || {}, p = i.group || ms.under[n] || "";
    return {name: n, parent: p, chain: chain(p), open: Number(i.ob || 0), pan: i.pan || (ms.pans[n] || ""), gstin: i.gstin || (ms.gstins[n] || ""), msme: i.msme || ""};
  });
  const twoBs = fs.readdirSync(FIXTURE_DIR).filter((f) => /^returns_R2B_.*\.json$/.test(f)).map((f) => {
    const t = x.GST2B.fromJson(JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8")));
    return {item: "." + t.gstin + "|" + t.period, data: t};
  });
  const vouchers = db.vouchers.map((v) => ({guid: v.id, day: v.date.slice(0, 4) + "-" + v.date.slice(4, 6) + "-" + v.date.slice(6), vtype: v.type, vno: v.no, party: v.party || "", narration: v.narr || "",
    ref: v.ref || "", gstin: v.gstin || "", cmp: v.cmp || "", rcm: !!v.rcm, cancelled: !!v.cancel, optional: !!v.opt, alter: v.alt || 0, lines: v.ent.map((e) => [e.l, e.a])}));
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify({ledgers, groups: ms.groups, vouchers, map, ledInfo: ms.info, groupInfo: ms.groupInfo, twoBs, from: db.meta.from, to: db.meta.to}, null, 0));
  console.log("assistant books: " + ledgers.length + " ledgers, " + vouchers.length + " vouchers, " + twoBs.length + " 2Bs -> " + out);
})().catch((e) => { console.error(e); process.exit(2); });
