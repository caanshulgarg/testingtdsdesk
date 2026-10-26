// node tests/run_owasp_checks.js - the OWASP review of 26-Oct-2026 (branch next-sec-owasp), the fixes that need no
// database: (1) the gateway charges Google Vision per image and feature sent, whatever qty the caller names, and
// refuses images Google would fetch from a URL; (2) the admin and signup functions give the administrator's powers only
// after the two-step sign-in (is_superadmin(), aal2), as the database does; (3) .gitignore keeps .env files and keys out
// of git; (4) publish-preview.sh never commits source maps to main.
const path = require("path"), fs = require("fs");
const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  // ---- 1. gateway: what is charged for Vision
  const G = await import(path.join(ROOT, "server/security/functions/gateway/classify.ts"));
  ok(typeof G.chargeQty === "function", "classify.ts exports chargeQty");
  if (typeof G.chargeQty === "function") {
    const img = (n) => ({ image: { content: "AAAA" }, features: Array.from({ length: n }, () => ({ type: "DOCUMENT_TEXT_DETECTION" })) });
    const v = (rq) => ({ requests: rq });
    const cases = [
      // [code, qty, payload, want]
      ["vision", 1, v([img(1)]), 1],                         // what the app sends (src/js/01 googleOcr / googleWords)
      ["vision", 1, v([img(1), img(1), img(1)]), 3],         // 3 images for the price of 1: charged 3
      ["vision", 1, v(Array.from({ length: 16 }, () => img(1))), 16],
      ["vision", 1, v([img(4)]), 4],                         // one image, four features: Google bills four
      ["vision", 5, v([img(1)]), 5],                         // asking to pay more is kept
      ["vision", 1, v([{ image: { content: "AAAA" } }]), 1], // no features listed: still one unit
      ["claude", 1, { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "x" }] }, 1],
      ["claude", 3, { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "x" }] }, 3],
    ];
    for (const [code, qty, p, want] of cases) {
      const got = G.chargeQty(code, qty, p);
      ok(got === want, code + " qty " + qty + " (" + ((p.requests || []).length || "-") + " request(s)) -> " + want + (got === want ? "" : " (got " + got + ")"));
    }
  }
  ok(typeof G.visionRefusal === "function", "classify.ts exports visionRefusal");
  if (typeof G.visionRefusal === "function") {
    ok(G.visionRefusal([{ image: { content: "AAAA" } }]) === "", "an image sent inline is passed on");
    ok(!!G.visionRefusal([{ image: { source: { imageUri: "http://169.254.169.254/latest/meta-data/" } } }]), "an image Google would fetch from a URL is refused");
    ok(!!G.visionRefusal([{ image: { source: { gcsImageUri: "gs://someone-else/bucket.png" } } }]), "an image Google would read from Cloud Storage is refused");
    ok(!!G.visionRefusal([{ image: {} }]), "a request with no image is refused");
    ok(!!G.visionRefusal([{ image: { content: "AAAA" } }, null]), "a request that is not an object is refused");
  }
  const gw = read("server/security/functions/gateway/index.ts");
  ok(/chargeQty\(\s*code\s*,\s*qty\s*,/.test(gw), "gateway/index.ts charges chargeQty(code, qty, …), not the caller's qty");
  ok(/visionRefusal\(/.test(gw), "gateway/index.ts refuses URL images (visionRefusal)");

  // ---- 2. administrator powers only with the two-step sign-in
  const adm = read("server/security/functions/admin/index.ts");
  ok(/rpc\(\s*["']is_superadmin["']\s*\)/.test(adm), "admin: the administrator is is_superadmin() (platform_admins AND aal2), as in the database");
  ok(!/const superadmin = !!isAdminRow;/.test(adm), "admin: a platform_admins row alone no longer makes the caller the administrator");
  const su = read("server/signup/index.ts");
  const pa = (su.match(/async function platformAdmin[\s\S]*?\n}\n/) || [""])[0];
  ok(/rpc\(\s*["']is_superadmin["']\s*\)/.test(pa), "signup: platformAdmin() asks is_superadmin() (aal2), not mfa_ok() (true for anyone with no factor)");
  ok(!/rpc\(\s*["']mfa_ok["']\s*\)/.test(pa), "signup: platformAdmin() does not rely on mfa_ok()");

  // ---- 3. .gitignore: secrets never committed
  const gi = read(".gitignore").split("\n").map((s) => s.trim());
  for (const pat of [".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", ".dev.vars"]) ok(gi.includes(pat), ".gitignore has " + pat);
  ok(gi.includes("!.env.example"), ".gitignore still lets an .env.example (no values) be committed");

  // ---- 4. source maps stay off main (Cloudflare strips them as well; main is the site's source)
  const pp = read("app/publish-preview.sh");
  ok(/-name '\*\.map'[^\n]*-delete/.test(pp), "publish-preview.sh deletes *.map from the folder before committing to main");
  const at = pp.indexOf("-name '*.map'"), add = pp.indexOf('git add -A "$folder"');
  ok(at > 0 && add > at, "… before git add");

  console.log(fails ? "\n" + fails + " FAILED" : "\nALL OK");
  process.exit(fails ? 1 : 0);
})();
