// node fixture_cache.js [OUT] - the made-up books in tests/fixtures/books read the way the app reads a day book
// (Books.importDayBook), kept as JSON like tests/data/books-cache.json: what the tests load when there is no real export.
// harness.js and books_data.py run it when the cache is missing or older than the day book or the app.
process.env.TDSDESK_NO_FIXCACHE = "1";
const fs = require("fs"), path = require("path"), {load, openBlob, HTML, FIXTURE_DIR, FIXTURE_CACHE} = require("./harness");
(async () => {
  const out = process.argv[2] || FIXTURE_CACHE;
  const {x} = load(HTML, ["num", "r2", "Books"]);
  const db = await x.Books.importDayBook(await openBlob(path.join(FIXTURE_DIR, "DayBook.xml")));
  db.meta.file = "DayBook.xml";
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify({vouchers: db.vouchers, meta: db.meta}));
  console.log("fixture books: " + db.vouchers.length + " vouchers, " + db.meta.from + " to " + db.meta.to + " -> " + out);
})().catch(e => { console.error(e); process.exit(2); });
