// deno test server/tally-cloud/linknow_test.ts - next-tally-linknow (28-Oct-2026; the owner: "FinCom should not deny. If I
// click, it should link it."). On staging that day the owner clicked Link on "Salesify Marketing LLP 2026-27" (listed by
// Get companies, the bridge on NWS144) and tally_company_link refused 5 times (13:11:03-13:12:05 UTC): "no computer has
// reported … yet". The bridge's beat carried the company open from 13:10:54, but tally_companies is written only by the
// bridge's "companies" message, sent every CloudLinksSec (300 s): the row came at 13:16:08.
//   1. linkDevice: the device a click from a browser registers the company for: a live device of the caller's firm that
//      runs the browser's own bridge (its id in info.bridges), else one whose latest beat has the company open; never a
//      removed one, never another firm's (the caller's firm's devices only are passed in)
//   2. beatNewOpen: the companies a beat says open that the firm's tally_companies lacks (registered from the beat at once)
//   3. cleanCompany: the company's name as the bridge returned it (trimmed, no control characters, at most 200)
import { linkDevice, beatNewOpen, cleanCompany, latestEntryDay } from "./linknow.js";

function assert(c: unknown, w: string) { if (!c) throw new Error(w); }
const SAL = "Salesify Marketing LLP 2026-27", EDGE = "EDGE STRATEGIES - (from 1-Apr-24)";
const dev = (id: string, bridges: Record<string, { open?: string[] }>, extra: Record<string, unknown> = {}) =>
  ({ id, revoked: false, info: { beat: { open: Object.values(bridges).flatMap((b) => b.open || []) }, bridges }, ...extra });

Deno.test("linkDevice: the device that runs the browser's own bridge", () => {
  const devs = [dev("d-lap", { "go-0000aaaa1111": { open: [] } }), dev("d-nws", { "go-6b1ba45fbb1d": { open: [EDGE, SAL] } })];
  assert(linkDevice(devs, "go-6b1ba45fbb1d", SAL)?.id === "d-nws", "the bridge's own device");
  // the bridge's own device even when its beat has not carried the company yet (Get companies asked Tally just now)
  const fresh = [dev("d-nws", { "go-6b1ba45fbb1d": { open: [] } })];
  assert(linkDevice(fresh, "go-6b1ba45fbb1d", SAL)?.id === "d-nws", "its own device before the beat names the company");
});
Deno.test("linkDevice: else a device whose beat has the company open (spaces and case alike)", () => {
  const devs = [dev("d-lap", { "go-0000aaaa1111": { open: [] } }), dev("d-nws", { "go-6b1ba45fbb1d": { open: [SAL] } })];
  assert(linkDevice(devs, "", "salesify  marketing llp 2026-27")?.id === "d-nws", "found by the beat");
  assert(linkDevice(devs, "go-ffffffffffff", SAL)?.id === "d-nws", "an unknown bridge id: by the beat");
});
Deno.test("linkDevice: never a removed device, never a name no bridge has", () => {
  const gone = [dev("d-nws", { "go-6b1ba45fbb1d": { open: [SAL] } }, { revoked: true })];
  assert(linkDevice(gone, "go-6b1ba45fbb1d", SAL) === null, "a removed device is not used");
  const devs = [dev("d-lap", { "go-0000aaaa1111": { open: ["Other Co"] } })];
  assert(linkDevice(devs, "", SAL) === null, "no bridge of the firm has it and the bridge id is not given: none");
  assert(linkDevice(devs, "not-a-bridge-id", SAL) === null, "a malformed bridge id is not matched");
  assert(linkDevice([], "go-6b1ba45fbb1d", SAL) === null, "no device");
  assert(linkDevice(null as unknown as [], "go-6b1ba45fbb1d", SAL) === null, "nothing passed");
});
Deno.test("beatNewOpen: the open companies the firm's list lacks, once each", () => {
  const beat = { open: [EDGE, SAL], companies: [{ name: "GARG SHEKHAR & COMPANY", open: false }, { name: SAL, open: true }, { name: EDGE, open: true }] };
  const have = new Set(["GARG SHEKHAR & COMPANY", "VMS EVENTS PRIVATE LIMITED (2024-25)"]);
  const n = beatNewOpen(beat, have);
  assert(n.length === 2 && n.includes(SAL) && n.includes(EDGE), "the two new open companies (" + n.join(", ") + ")");
  assert(beatNewOpen(beat, new Set([SAL, EDGE])).length === 0, "nothing when the list has them");
  assert(beatNewOpen({ open: [], companies: [{ name: "Kept Only", open: false }] }, new Set()).length === 0, "a company kept but not open is not registered from the beat");
  assert(beatNewOpen({ open: ["  " + SAL + " "] }, new Set([SAL])).length === 0, "names trimmed");
  assert(beatNewOpen({}, new Set()).length === 0 && beatNewOpen(null, new Set()).length === 0, "an empty beat");
  const many = { open: Array.from({ length: 80 }, (_, i) => "Co " + i) };
  assert(beatNewOpen(many, new Set()).length === 50, "at most 50 a beat");
});
Deno.test("cleanCompany: the name as the bridge returned it", () => {
  assert(cleanCompany("  " + SAL + " ") === SAL, "trimmed");
  assert(cleanCompany(EDGE) === EDGE, "brackets and dashes kept");
  assert(cleanCompany("A\u0000B") === "", "control characters refused");
  assert(cleanCompany("x".repeat(250)) === "", "longer than 200 refused, never cut (another company's name)");
  assert(cleanCompany(undefined) === "" && cleanCompany(42) === "" && cleanCompany("   ") === "", "nothing");
});
Deno.test("latestEntryDay: the latest day with an entry (migration 127: a place counts once entries came from it)", async () => {
  const dec = async (d: { t?: string; bad?: boolean }) => { if (d.bad) throw new Error("not gzip"); return d.t || ""; };
  const v = "<ENVELOPE><VOUCHER REMOTEID='x'>1</VOUCHER></ENVELOPE>", empty = "<ENVELOPE></ENVELOPE>";
  assert(await latestEntryDay([{ day: "20261001", t: v }, { day: "20261003", t: empty }, { day: "20261002", t: v }], dec) === "20261002", "the latest day with an entry");
  assert(await latestEntryDay([{ day: "20261005", bad: true }, { day: "20261004", t: v }], dec) === "20261004", "a day not read is passed over");
  assert(await latestEntryDay([{ day: "20261003", t: empty }], dec) === "", "only empty days: none");
  assert(await latestEntryDay([{ day: "2026-10-03", t: v }, { day: "x", t: v }], dec) === "", "not a day: none");
  assert(await latestEntryDay(null, dec) === "" && await latestEntryDay([], dec) === "", "nothing");
  let reads = 0;
  await latestEntryDay(Array.from({ length: 30 }, (_, i) => ({ day: "202610" + String(i + 1).padStart(2, "0"), t: v })), async (d: { t?: string }) => { reads++; return d.t || ""; });
  assert(reads === 1, "one day read in the usual case (" + reads + ")");
});
