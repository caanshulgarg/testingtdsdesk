// Loads named top-level declarations from the app's main script into a Node context, so the
// real Books / GSTR / GSTAdv / GSTRev code runs against real Tally files.
const fs = require("fs"), vm = require("vm");
const CORE = ["ledNm", "ledEnt", "ledClean", "ledKey", "LED_IDX", "ledIdx", "ledLook", "ledUnder", "ledGroupPath", "toDateObj", "MONTHS3"];
function load(htmlPath, names){
  const s = fs.readFileSync(htmlPath, "utf8");
  const i = s.indexOf('<script id="app-main">') + '<script id="app-main">'.length, j = s.indexOf("</script>", i);
  const js = s.slice(i, j);
  const re = /\n(?:async function|function|const|let|var|class) ([A-Za-z_$][\w$]*)/g;
  const decl = []; let m;
  while ((m = re.exec(js))) decl.push({name: m[1], at: m.index});
  // the ledger-name helpers every report uses to find a ledger's group (00-core.js): always loaded, so a test's list of
  // names need not know them
  names = CORE.filter(n => !names.includes(n) && decl.some(d => d.name === n)).concat(names);
  const parts = names.map(n => {
    const k = decl.findIndex(d => d.name === n);
    if (k < 0) throw new Error("not found: " + n);
    return js.slice(decl[k].at, k + 1 < decl.length ? decl[k + 1].at : js.length);
  });
  const ctx = {console, TextDecoder, Intl, Math, JSON, Date, Set, Map, Array, Object, String, Number, RegExp, isFinite, parseFloat,
    S: {books: null, coId: "t"}, saveFile(){}, toast(){}, CO: () => ({name: "Test"})};
  vm.createContext(ctx);
  vm.runInContext(parts.join("\n") + "\n;globalThis.__x = {" + names.join(",") + "};", ctx);
  return {ctx, x: ctx.__x};
}
async function openBlob(p){ return fs.openAsBlob(p); }
const path = require("path");
const HTML = process.env.TDSDESK_HTML || path.join(__dirname, "..", "site-test", "index.html");
const OUT = process.env.TDSDESK_OUT || path.join(__dirname, "out");
require("fs").mkdirSync(OUT, {recursive: true});
// the books the tests read: TDSDESK_DATA, else a real client's export in tests/data (never committed), else the made-up
// books committed in tests/fixtures/books (FIXTURE true: the tests check the figures worked out by hand in EXPECTED.md)
const REAL_DIR = path.join(__dirname, "data"), FIXTURE_DIR = path.join(__dirname, "fixtures", "books");
const DATA = process.env.TDSDESK_DATA || (fs.existsSync(path.join(REAL_DIR, "Master.xml")) ? REAL_DIR : FIXTURE_DIR);
const FIXTURE = path.resolve(DATA) === path.resolve(FIXTURE_DIR);
const FIXTURE_CACHE = path.join(OUT, "fixture-books-cache.json");
function fixtureCache(){
  // read again when the day book or the app is newer than the cache
  const t = f => { try { return fs.statSync(f).mtimeMs; } catch (e){ return 0; } };
  if (!process.env.TDSDESK_NO_FIXCACHE && t(FIXTURE_CACHE) < Math.max(t(path.join(FIXTURE_DIR, "DayBook.xml")), t(HTML)))
    require("child_process").execFileSync(process.execPath, [path.join(__dirname, "fixture_cache.js"), FIXTURE_CACHE], {stdio: "inherit"});
  return FIXTURE_CACHE;
}
const CACHE = process.env.TDSDESK_CACHE || (FIXTURE ? fixtureCache() : path.join(__dirname, "data", "books-cache.json"));
module.exports = {load, openBlob, HTML, DATA, CACHE, OUT, FIXTURE, FIXTURE_DIR, FIXTURE_CACHE};
