// After a 2B is fetched (Fetch now, or the daily run), the 2B matching runs by itself (round 72b): a run is queued for the
// GSTIN and the year (gst2b_enqueue, migration-95) and gst-2b-match is woken with the service key. Only a 2B fetched whole
// (status ok); a failure here never fails the fetch (the timer of migration-95b picks up what was queued).
export type AfterDeps = { rpc: (fn: string, args: Record<string, unknown>) => Promise<any>, poke: () => Promise<unknown> };
export async function after2b(deps: AfterDeps, firm: string, gstin: string, form: string, period: string, status: string): Promise<{ queued: boolean, why?: string }> {
  if (form !== "2B" || status !== "ok") return { queued: false, why: "not a 2B fetched whole" };
  try {
    const q = await deps.rpc("gst2b_enqueue", { p_firm: firm, p_gstin: gstin, p_period: period, p_why: "fetched" });
    if (!q || !q.queued) return { queued: false, why: String(q?.why || "") };
    await deps.poke().catch(() => {});
    return { queued: true };
  } catch (e) {
    return { queued: false, why: String((e as Error).message || e).slice(0, 200) };
  }
}
