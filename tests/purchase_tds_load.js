// The bill desk's own code (src/js/00-core.js, 01-documents-in-the-firm-account.js, 09-tds.js, 66-tds-smart.js, ...)
// loaded from the source, as build.py puts the program together (the shared files first, then src/js in ORDER.json), so a
// node test runs the real compute() and TDS rows without a build. Used by run_purchase_tds_audit.js.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const {load} = require("./harness");
const ROOT0 = path.join(__dirname, "..");
function programHtml(root){
  const ROOT = root || ROOT0;
  const b = fs.readFileSync(path.join(ROOT, "build.py"), "utf8");
  const shared = JSON.parse((b.match(/^SHARED_JS = (\[.*\])$/m) || [])[1].replace("NAMES_JS", '"server/_shared/names.js"'));
  const order = JSON.parse(fs.readFileSync(path.join(ROOT, "src/js/ORDER.json"), "utf8"));
  const js = shared.map(f => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/^export \{[^}]*\};\s*$/m, ""))
    .concat(order.map(f => fs.readFileSync(path.join(ROOT, "src/js", f), "utf8"))).join("");
  const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ptds-")), "index.html");
  fs.writeFileSync(html, '<script id="app-main">\n' + js + "\n</script>");
  return html;
}
module.exports = {programHtml, load};
