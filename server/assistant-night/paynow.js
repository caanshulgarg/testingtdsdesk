// "Make the journal now" (the Payroll page; the owner, 23-Nov-2026): one month's payroll finding and entry, as the night
// made them (dailyjournals.js payrollNow), kept in the cloud the way night_apply keeps them (migration 207), and nothing
// else: no other finding, no night_runs row (tonight's run goes on as before, and makes the same entry again: the same
// dedupe, so never a second one). Plain JavaScript, shared with the Node tests; rest(path, token, init) is the handler's
// service-role PostgREST call.
//   existingNow(rest, firm, cid, ym)  the month's entry already made (by the night or this button), or null
//   applyNow({rest, firm, cid, night, by}, res)  -> {kind: made | already | you | kept | none, id?, state?}
//   keepNow(rest, firm, cid, months)  (review B2) for tonight's run: the entries made now for a month the night does not
//     make itself (the running month), as dedupes for night_apply to keep
const enc = encodeURIComponent;
const LIVE = ["ready", "held", "approving", "approved", "rejected"];
const where = (firm, cid) => "firm_id=eq." + enc(firm) + "&client_id=eq." + enc(cid);
export const dedupeOf = (ym) => "payroll:" + ym;

export async function existingNow(rest, firm, cid, ym) {
  const rows = await rest("/rest/v1/night_entries?select=id,state,decided_by,updated_at&" + where(firm, cid) + "&dedupe=eq." + enc(dedupeOf(ym)));
  const r = (Array.isArray(rows) ? rows : []).find((x) => LIVE.includes(x.state));
  return r ? { id: r.id, state: r.state } : null;
}

// one finding, by night_apply's rule: a person's choice stays (decided, or dismissed); one undone is never resolved again
async function putFinding(rest, firm, cid, night, f) {
  const cur = ((await rest("/rest/v1/night_findings?select=id,state,evidence,decided_by,undone_at,last_seen&" + where(firm, cid) + "&kind=eq." + enc(f.kind) + "&key=eq." + enc(f.key))) || [])[0];
  let st = f.state, ev = st === "resolved" ? (f.evidence || []) : [];
  if (cur) {
    if (cur.decided_by || cur.state === "dismissed") { st = cur.state; ev = cur.evidence || []; }
    else if (cur.undone_at && st === "resolved") { st = cur.state === "you" ? "you" : "ask"; ev = []; }
    const patch = { facts: f.facts || {}, state: st, evidence: ev, last_seen: cur.last_seen && String(cur.last_seen) > night ? cur.last_seen : night };
    if (st === "you" && !cur.decided_by) patch.candidates = f.candidates || [];
    await rest("/rest/v1/night_findings?id=eq." + enc(cur.id), "", { method: "PATCH", body: JSON.stringify(patch) });
    return { id: cur.id, state: st, undone: !!cur.undone_at };
  }
  const row = { firm_id: firm, client_id: cid, kind: f.kind, key: f.key, facts: f.facts || {}, state: st, evidence: ev, candidates: st === "you" ? (f.candidates || []) : [], first_seen: night, last_seen: night };
  const made = await rest("/rest/v1/night_findings", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
  return { id: ((made || [])[0] || {}).id, state: st, undone: false };
}

export async function applyNow(ctx, res) {
  const { rest, firm, cid, night, by } = ctx;
  if (!res || (res.kind !== "made" && res.kind !== "you")) return { kind: "none" };
  const ym = String((res.finding.facts || {}).ym || String(res.finding.key || "").replace(/^payroll:/, ""));
  const log = (what, ref, ev) => rest("/rest/v1/daily_log", "", { method: "POST", body: JSON.stringify({ firm_id: firm, client_id: cid, what, ref, evidence: ev }) }).catch(() => null);
  if (res.kind === "made") { const ex = await existingNow(rest, firm, cid, ym); if (ex) return Object.assign({ kind: "already" }, ex); }
  for (const p of res.picks || []) await putFinding(rest, firm, cid, night, p);
  const f = await putFinding(rest, firm, cid, night, res.finding);
  if (res.kind === "you" || f.state !== "resolved" || f.undone) {
    await log("payroll_now", res.finding.key, { ym, by, kind: f.state === "resolved" ? "kept" : f.state });
    return { kind: res.kind === "you" ? "you" : "kept", state: f.state };
  }
  const e = res.entry;
  const row = { firm_id: firm, client_id: cid, finding_id: f.id, source: e.source, dedupe: e.dedupe, work_ref: e.work_ref || "", voucher: e.voucher || {}, reason: e.reason || "", why: e.why || "",
    evidence: e.evidence || [], checks: e.checks || [], state: e.ready ? "ready" : "held" };
  // a withdrawn one (the night no longer made it) is made again in its place, as night_apply does; else a new row, never a
  // second one (the unique dedupe: one made meanwhile by the night is kept and said)
  const old = ((await rest("/rest/v1/night_entries?select=id,state,decided_by&" + where(firm, cid) + "&dedupe=eq." + enc(e.dedupe))) || [])[0];
  let id = "";
  if (old && old.state === "withdrawn" && !old.decided_by) {
    const { firm_id, client_id, dedupe, ...upd } = row;
    await rest("/rest/v1/night_entries?id=eq." + enc(old.id) + "&state=eq.withdrawn", "", { method: "PATCH", body: JSON.stringify(Object.assign(upd, { updated_at: new Date().toISOString() })) });
    id = old.id;
  } else if (old) return { kind: "already", id: old.id, state: old.state };
  else {
    const made = await rest("/rest/v1/night_entries?on_conflict=firm_id,client_id,dedupe", "", { method: "POST", headers: { Prefer: "return=representation,resolution=ignore-duplicates" }, body: JSON.stringify(row) });
    id = ((made || [])[0] || {}).id || "";
    if (!id) { const ex = await existingNow(rest, firm, cid, ym); return Object.assign({ kind: "already" }, ex || {}); }
  }
  await log("payroll_now", id, { ym, by, kind: "made", ready: !!e.ready });
  return { kind: "made", id, state: row.state };
}

// (review B2) night_apply (migration 207) withdraws, on a complete run, every ready or held entry whose dedupe the run did not
// pass, and the night makes only the months that have ended (months: dailyjournals.js payrollMonths): the running month's
// entry made with the button would be withdrawn the same night. The night passes these with its own entries: a dedupe only
// (no finding_key, so night_apply makes and counts nothing of it, it only keeps it). Ready or held only: an approved one is
// never withdrawn, and one passed would be put back as ready. A month the night makes itself stays the night's to keep or
// withdraw. Not read: thrown (the night stops for the client rather than withdraw it unseen)
export async function keepNow(rest, firm, cid, months) {
  const last = (months || []).slice().sort().pop() || "";
  const rows = await rest("/rest/v1/night_entries?select=dedupe,state&" + where(firm, cid) + "&dedupe=like." + enc("payroll:*") + "&state=in.(ready,held)");
  if (!Array.isArray(rows)) throw new Error("the payroll entries could not be read");
  const out = [];
  rows.forEach((r) => { const m = /^payroll:(\d{6})$/.exec(String((r && r.dedupe) || ""));
    if (m && m[1] > last && (r.state === "ready" || r.state === "held") && !out.some((x) => x.dedupe === r.dedupe)) out.push({ dedupe: r.dedupe }); });
  return out;
}
