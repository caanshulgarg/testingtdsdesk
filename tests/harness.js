// Loads named top-level declarations from the app's main script into a Node context, so the
// real Books / GSTR / GSTAdv / GSTRev code runs against real Tally files.
const fs = require("fs"), vm = require("vm");
function load(htmlPath, names){
  const s = fs.readFileSync(htmlPath, "utf8");
  const i = s.indexOf('<script id="app-main">') + '<script id="app-main">'.length, j = s.indexOf("</script>", i);
  const js = s.slice(i, j);
  const re = /\n(?:async function|function|const|let|var|class) ([A-Za-z_$][\w$]*)/g;
  const decl = []; let m;
  while ((m = re.exec(js))) decl.push({name: m[1], at: m.index});
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
const DATA = process.env.TDSDESK_DATA || path.join(__dirname, "data");
const CACHE = process.env.TDSDESK_CACHE || path.join(__dirname, "data", "books-cache.json");
const OUT = process.env.TDSDESK_OUT || path.join(__dirname, "out");
require("fs").mkdirSync(OUT, {recursive: true});
module.exports = {load, openBlob, HTML, DATA, CACHE, OUT};
