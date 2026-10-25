// node run_pair_spake.mjs - FinCom Bridge 2.4.7: the page's side of the pairing (src/js/24-pair-spake.js, SPAKE2 over RFC
// 3526 group 14) against the bridge's own vectors (bridge-go/testdata/r247/spake-vectors.json, written and checked by
// bridge-go/r247pair_test.go TestR247SpakeVectors): w, X from a fixed x, the bridge's Y and confirmation for a fixed y,
// and the page's confirmation. A wrong confirmation and a Y outside the group are refused; a run with random x agrees
// with the Go vectors' Y only through the protocol (the page's own random start verifies against a bridge step computed
// here in BigInt, the same formulas).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const src = fs.readFileSync(path.join(ROOT, "src/js/24-pair-spake.js"), "utf8");
const v = JSON.parse(fs.readFileSync(path.join(ROOT, "bridge-go/testdata/r247/spake-vectors.json"), "utf8"));
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, BigInt, Uint8Array, Math, Number, String, Array, Promise, console });
vm.runInContext(src + "\n;globalThis.PairSpake = PairSpake;", ctx);
const S = ctx.PairSpake;

let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };

const w = await S.w(v.Code, v.Ctx);
ok(w.toString(16) === v.W, "w = H(code, context) mod q, as the bridge has it");
const st = await S.start(v.Code, v.Ctx, BigInt("0x" + v.Xe));
ok(st.X === v.X, "X = g^x * M^w from the vector's x");
const ca = await S.finish(st, v.Y, v.ConfirmB);
ok(ca === v.ConfirmA, "the bridge's confirmation verified; the page's confirmation as the bridge expects it");
ok((await S.finish(st, v.Y, "0".repeat(64))) === null, "a wrong confirmation from the bridge is refused");
const pm1 = (S.P - 1n).toString(16).padStart(512, "0");
ok((await S.finish(st, pm1, v.ConfirmB)) === null, "Y = p-1 (outside the group) is refused");
ok((await S.finish(st, "abcd", v.ConfirmB)) === null, "a Y that is not 512 hex digits is refused");
const wrong = await S.start(v.Code === "000000" ? "000001" : "000000", v.Ctx, BigInt("0x" + v.Xe));
ok((await S.finish(wrong, v.Y, v.ConfirmB)) === null, "a wrong code does not verify the bridge's answer");
const rnd = await S.start(v.Code, v.Ctx);
ok(/^[0-9a-f]{512}$/.test(rnd.X) && rnd.X !== v.X, "a random start gives a fresh X");
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
