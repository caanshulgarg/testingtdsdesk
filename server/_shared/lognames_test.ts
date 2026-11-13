// deno test --allow-read server/_shared/lognames_test.ts - what the functions' logs may say (security review L6)
import { errorCodes, nm } from "./lognames.ts";
function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }

Deno.test("L6: a name is logged as a mark: the same name the same mark, nothing of the name in it", () => {
  const a = nm("Larkspur Made-up Events Pvt Ltd"), b = nm("Larkspur Made-up Events Pvt Ltd"), c = nm("Larkspur Made-up Events Pvt Ltd.");
  assert(a === b && a !== c && /^name#[0-9a-f]{8}$/.test(a) && !/Larkspur|Events/i.test(a), a + " " + c);
  assert(/^name#[0-9a-f]{8}$/.test(nm(undefined)) && /^name#[0-9a-f]{8}$/.test(nm({ x: 1 })), "anything gives a mark");
});
Deno.test("L6: of a GST service's answer only the error codes are logged", () => {
  const body = '{"status_cd":"0","error":{"error_cd":"RET191113","message":"GSTIN 27AAACM1234Z1ZG of MADE-UP TRADERS (PAN AAACM1234Z) is not valid"}}';
  const codes = errorCodes(body);
  assert(JSON.stringify(codes) === '["status_cd=0","error_cd=RET191113"]', JSON.stringify(codes));
  assert(!/27AAACM|MADE-UP|AAACM1234Z|message/.test(JSON.stringify(codes)), "no GSTIN, name or PAN");
  assert(errorCodes("<html>Bad gateway MADE-UP TRADERS</html>").length === 0 && errorCodes(null).length === 0, "an answer with no codes: nothing");
});
Deno.test("L6: tally-ingest, gst-taxpro and gst-api write no company, ledger or party name, typed note or answer head to the log", async () => {
  const root = new URL("../", import.meta.url);
  const lines = async (f: string) => (await Deno.readTextFile(new URL(f, root))).split("\n").map((l, i) => [i + 1, l] as [number, string]).filter(([, l]) => /console\.(log|error|warn)\(/.test(l) && !/^\s*\/\//.test(l));
  const bare = [/[`,(+]\s*\$?\{?company\b(?!\))/, /\bc\.name\b/, /\bhave\.name\b/, /\br\.name\b/, /, from, "->", to\b/, /JSON\.stringify\((fresh|ren|auto\.full|end\.slice)/, /kept: kept\.slice/, /body\.note/, /String\(body\.name/];
  for (const [n, l] of await lines("tally-cloud/index.ts")) {
    const call = l.slice(l.search(/console\.(log|error|warn)\(/)).replace(/nm\([^()]*\)/g, "nm()");
    for (const re of bare) assert(!re.test(call), "tally-cloud/index.ts line " + n + " logs a name or typed text: " + call.slice(0, 120));
  }
  for (const f of ["gst-taxpro/index.ts", "gst-api/index.ts"]) for (const [n, l] of await lines(f)) assert(!/head:\s*(scrub\()?(safeText\()?text\.slice/.test(l), f + " line " + n + " logs the head of an answer");
});
