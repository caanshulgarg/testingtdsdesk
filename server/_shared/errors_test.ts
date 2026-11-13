// deno test --allow-read server/_shared/errors_test.ts - what a caller is told when something fails (security review L3)
import { looksInternal, publicError, TRY_AGAIN } from "./errors.ts";
function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }

Deno.test("L3: the database's, the storage's and the network's own messages are replaced by one sentence with a number; the log has the number and the message", () => {
  const raw = [
    'duplicate key value violates unique constraint "members_pkey"', 'relation "public.tally_books" does not exist', 'column firms.status does not exist',
    'new row violates row-level security policy for table "clients"', "Could not find the function public.mis_take(p_n) in the schema cache", 'null value in column "day" of relation "tally_alerts" violates not-null constraint',
    "permission denied for table platform_secrets", "invalid input syntax for type uuid: \"x\"", "canceling statement due to statement timeout", "The resource was not found in bucket tally-days",
    "error sending request for url (https://x.example/a?key=1)", "TypeError: Cannot read properties of undefined (reading 'id')", "HTTP 503", "", "x".repeat(301),
  ];
  for (const m of raw) {
    const lines: string[] = [];
    const said = publicError("test", new Error(m), (l) => lines.push(l));
    assert(said.startsWith(TRY_AGAIN) && /[0-9a-f]{8}$/.test(said), "replaced: " + m.slice(0, 40) + " -> " + said);
    const id = said.slice(-8), logged = JSON.parse(lines[0]);
    assert(lines.length === 1 && logged.id === id && logged.where === "test" && logged.message === m.slice(0, 500), "logged under the same number");
    for (const word of ["constraint", "relation", "column", "bucket", "public.", "https://", "TypeError"]) assert(!said.includes(word), "nothing of it in the answer");
  }
});

Deno.test("L3: FinCom's own words for people go back as they are, and nothing is logged", () => {
  for (const m of ["Only the firm's owner can connect Zoho Books.", "No such client in your firm.", "This month is locked. Unlock it first.", "the report Monthly MIS is no longer saved for this client",
    "Zoho allows 1,000 calls a day for this organisation; reading goes on after midnight.", "not allowed", "A user with this email address has already been registered"]) {
    const lines: string[] = [];
    assert(publicError("test", new Error(m), (l) => lines.push(l)) === m && !lines.length && !looksInternal(m), m);
  }
  assert(publicError("t", { message: "plain words", code: "P0001" }, () => {}) === "plain words", "an error object that is not an Error");
});

// the functions the review named: no raw message goes into an answer
Deno.test("L3: the functions named by the review answer through publicError", async () => {
  const root = new URL("../", import.meta.url);
  const RAW = /error: \(?(e as Error|error|mErr|fErr|chargeErr|err)\)?\.message\s*[},)]|error: String\(\(e as Error\)\??\.message \|\| e\)|error: \(error && error\.message\)/;
  for (const f of ["tally-cloud/index.ts", "gst-run/handler.ts", "gst-2b-match/handler.ts", "support-mail/handler.ts", "support-mail/index.ts", "zoho-books/index.ts", "security/functions/admin/index.ts", "signup/index.ts"]) {
    const src = await Deno.readTextFile(new URL(f, root));
    const hits = src.split("\n").map((l, i) => [i + 1, l] as [number, string]).filter(([, l]) => RAW.test(l) && !/^\s*\/\//.test(l));
    assert(hits.length === 0, f + ": a raw message in an answer at line " + hits.map((h) => h[0]).join(", "));
    assert(/publicError/.test(src), f + " uses publicError");
  }
});
