// deno test server/tally-cloud/monthpack_test.ts - tally-ingest's month_days answer (fast-firstopen, 25-Oct-2026): a
// month of day files in one answer, read back by the browser with the same rule (FirstOpen.unpack is unpackMonth, set by
// app/src/lib/firstOpen.js). Each day's bytes come back exactly as kept, with its tally_days.at, in the list's order; a
// day with no file comes back with none; an answer cut short or not of this shape is refused, never half read.
import { packMonth, unpackMonth, monthEnd } from "./monthpack.js";

function assert(c: unknown, w: string) { if (!c) throw new Error(w); }
const gz = async (s: string) => new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
const text = async (u: Uint8Array) => await new Response(new Blob([u as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))).text();

Deno.test("a month of day files: every day's bytes and time back as kept, in order", async () => {
  const days = [
    { day: "20261001", at: "2026-10-20T07:46:51.123456+00:00", gz: await gz("<ENVELOPE><VOUCHER>one ₹ 1,000 &amp; GST</VOUCHER></ENVELOPE>") },
    { day: "20261002", at: "2026-10-20T07:46:52+00:00", gz: null },
    { day: "20261003", at: "2026-10-21T01:00:00+00:00", gz: await gz("<ENVELOPE>" + "<VOUCHER>x</VOUCHER>".repeat(5000) + "</ENVELOPE>") },
  ];
  const packed = packMonth(days);
  assert(packed instanceof Uint8Array, "the answer is bytes");
  const back = unpackMonth(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength));
  assert(back.length === 3, "three days back");
  for (let i = 0; i < 3; i++) {
    assert(back[i].day === days[i].day && back[i].at === days[i].at, "day " + i + ": its date and time");
    const a = days[i].gz, b = back[i].gz;
    assert((a === null) === (b === null), "day " + i + ": a file only where there was one");
    if (a && b) assert(a.length === b.length && a.every((x, k) => x === b[k]), "day " + i + ": the same bytes");
  }
  assert((await text(back[0].gz!)).includes("₹ 1,000 &amp; GST"), "the day's text as kept");
  // a Uint8Array view (not starting at 0) reads the same
  const view = new Uint8Array(packed.length + 7); view.set(packed, 7);
  assert(unpackMonth(view.subarray(7)).length === 3, "a view of the answer reads the same");
});

Deno.test("an empty month, and answers that are not a month of day files", () => {
  assert(unpackMonth(packMonth([])).length === 0, "an empty month: no days");
  const p = packMonth([{ day: "20261001", at: "x", gz: new Uint8Array([1, 2, 3, 4]) }]);
  let refused = 0;
  for (const bad of [p.subarray(0, p.length - 1), p.subarray(0, 3), new TextEncoder().encode('{"ok":false,"error":"No such client in this firm."}'), new Uint8Array([0, 0, 0, 2, 0x7b, 0x7d])]) {
    try { unpackMonth(bad); } catch (_) { refused++; }
  }
  assert(refused === 4, "cut short, too short, a JSON error and a list that is not one: refused (" + refused + " of 4)");
});

Deno.test("the month's last day", () => {
  assert(monthEnd("202602") === "2026-02-28" && monthEnd("202402") === "2024-02-29" && monthEnd("202603") === "2026-03-31" && monthEnd("202604") === "2026-04-30", "February, a leap year, 31 and 30 days");
});
