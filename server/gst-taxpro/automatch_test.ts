// deno test server/gst-taxpro/automatch_test.ts (run by tests/run_2b_automatch_server.py). The trigger after a 2B is fetched
// (Fetch now, or the daily run): only a 2B fetched whole (status ok) queues a run (gst2b_enqueue) and wakes gst-2b-match
// with the service key; GSTR-1, 3B, a 2B not there yet, or a failure queue nothing; a failing queue never fails the fetch.
import { after2b } from "./automatch.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
function fake(queued = true, fail = false) {
  const rpcs: any[] = [], pokes: any[] = [];
  return { rpcs, pokes, deps: {
    rpc: async (fn: string, args: any) => { rpcs.push([fn, args]); if (fail) throw new Error("db down"); return { queued, id: 7, fy: "2026-27" }; },
    poke: async () => { pokes.push(1); return true; },
  } };
}

Deno.test("a 2B fetched whole: one run queued for the GSTIN and period, gst-2b-match woken", async () => {
  const f = fake();
  const r = await after2b(f.deps, "f-1", "09AANFG3202D1ZR", "2B", "092026", "ok");
  eq(f.rpcs, [["gst2b_enqueue", { p_firm: "f-1", p_gstin: "09AANFG3202D1ZR", p_period: "092026", p_why: "fetched" }]], "queued");
  eq(f.pokes.length, 1, "woken"); eq(r.queued, true, "said so");
});
Deno.test("GSTR-1, 3B, a 2B not there yet or failed: nothing queued", async () => {
  for (const [form, st] of [["R1", "ok"], ["3B", "ok"], ["2B", "none"], ["2B", "error"]]) {
    const f = fake();
    await after2b(f.deps, "f-1", "09AANFG3202D1ZR", form, "092026", st);
    eq([f.rpcs.length, f.pokes.length], [0, 0], form + " " + st);
  }
});
Deno.test("nothing to match yet (the app never sent the purchases): queued false, not woken; a failure never throws", async () => {
  const f = fake(false);
  await after2b(f.deps, "f-1", "09AANFG3202D1ZR", "2B", "092026", "ok");
  eq(f.pokes.length, 0, "not woken");
  const g = fake(true, true);
  const r = await after2b(g.deps, "f-1", "09AANFG3202D1ZR", "2B", "092026", "ok");
  eq([r.queued, g.pokes.length], [false, 0], "the fetch goes on");
});
