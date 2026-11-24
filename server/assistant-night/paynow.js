// "Make the journal now" (the Payroll page; the owner, 23-Nov-2026): one month's payroll finding and entry, as the night
// made them (dailyjournals.js payrollNow), kept in the cloud the way night_apply keeps them (migration 207), and nothing
// else: no other finding, no night_runs row (tonight's run goes on as before, and makes the same entry again: the same
// dedupe, so never a second one). Plain JavaScript, shared with the Node tests; rest(path, token, init) is the handler's
// service-role PostgREST call.
//   existingNow(rest, firm, cid, ym)  the month's entry already made (by the night or this button), or null
//   applyNow({rest, firm, cid, night, by}, res)  -> {kind: made | updated | already | you | kept | none, id?, state?}
//   keepNow(rest, firm, cid, months, seen)  (review B2, re-review 2) for tonight's run: the entries made now for a month the
//     night does not make itself (the running month), as dedupes for night_apply to keep, and that month's open findings
//     (Needs you), as they are, for night_apply to leave alone: {entries, findings}
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

// the month's entry as it is (ready, held, approving, approved or rejected), with its voucher
async function liveRow(rest, firm, cid, ym) {
  const rows = await rest("/rest/v1/night_entries?select=id,state,decided_by,voucher&" + where(firm, cid) + "&dedupe=eq." + enc(dedupeOf(ym)));
  return (Array.isArray(rows) ? rows : []).find((x) => LIVE.includes(x.state)) || null;
}
const sameVoucher = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});

export async function applyNow(ctx, res) {
  const { rest, firm, cid, night, by } = ctx;
  if (!res || (res.kind !== "made" && res.kind !== "you")) return { kind: "none" };
  const ym = String((res.finding.facts || {}).ym || String(res.finding.key || "").replace(/^payroll:/, ""));
  const log = (what, ref, ev) => rest("/rest/v1/daily_log", "", { method: "POST", body: JSON.stringify({ firm_id: firm, client_id: cid, what, ref, evidence: ev }) }).catch(() => null);
  // (re-review 1) the running month (the night never makes it): made again from the salary kept now. Its entry still ready
  // or held, nobody's decision on it, takes the new figures (the same row, by its dedupe); approved or being approved: never
  // changed. A month that has ended is the night's to update tonight
  const cur = res.running ? await liveRow(rest, firm, cid, ym) : null;
  const open = cur && (cur.state === "ready" || cur.state === "held") && !cur.decided_by;
  if (res.kind === "made") { const ex = await existingNow(rest, firm, cid, ym); if (ex && !open) return Object.assign({ kind: "already" }, ex);
    if (open && sameVoucher(cur.voucher, res.entry.voucher) && cur.state === (res.entry.ready ? "ready" : "held")) return { kind: "already", id: cur.id, state: cur.state }; }
  for (const p of res.picks || []) await putFinding(rest, firm, cid, night, p);
  const f = await putFinding(rest, firm, cid, night, res.finding);
  if (res.kind === "you" || f.state !== "resolved" || f.undone) {
    // the new figures need a person: the running month's entry made from the old ones is taken back (never approved so)
    if (open) await rest("/rest/v1/night_entries?id=eq." + enc(cur.id) + "&state=in.(ready,held)&decided_by=is.null", "", { method: "PATCH", body: JSON.stringify({ state: "withdrawn", updated_at: new Date().toISOString() }) });
    await log("payroll_now", res.finding.key, Object.assign({ ym, by, kind: f.state === "resolved" ? "kept" : f.state }, open ? { withdrawn: cur.id } : {}));
    return { kind: res.kind === "you" ? "you" : "kept", state: f.state };
  }
  const e = res.entry;
  const row = { firm_id: firm, client_id: cid, finding_id: f.id, source: e.source, dedupe: e.dedupe, work_ref: e.work_ref || "", voucher: e.voucher || {}, reason: e.reason || "", why: e.why || "",
    evidence: e.evidence || [], checks: e.checks || [], state: e.ready ? "ready" : "held" };
  // a withdrawn one (the night no longer made it) is made again in its place, as night_apply does; else a new row, never a
  // second one (the unique dedupe: one made meanwhile by the night is kept and said)
  const old = ((await rest("/rest/v1/night_entries?select=id,state,decided_by&" + where(firm, cid) + "&dedupe=eq." + enc(e.dedupe))) || [])[0];
  let id = "";
  if (open && old && old.id === cur.id) {
    // only while still ready or held and nobody's: one claimed meanwhile is left as it is, and said
    const { firm_id, client_id, dedupe, ...upd } = row;
    const done = await rest("/rest/v1/night_entries?id=eq." + enc(cur.id) + "&state=in.(ready,held)&decided_by=is.null", "", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(Object.assign(upd, { updated_at: new Date().toISOString() })) });
    if (!(Array.isArray(done) && done.length)) { const ex = await existingNow(rest, firm, cid, ym); return Object.assign({ kind: "already" }, ex || {}); }
    await log("payroll_now", cur.id, { ym, by, kind: "updated", ready: !!e.ready });
    return { kind: "updated", id: cur.id, state: row.state };
  }
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
// withdraw.
// (re-review 2) night_apply also clears, on a complete run, every open finding (ask or you, nobody's decision) the run did
// not pass: the running month's Needs you made with the button would go the same night. Passed back as they are (state,
// facts, choices: night_apply then changes nothing of them): that month's payroll finding, its Tally check (sent_check),
// and, while it waits on a ledger pick, the payroll ledger picks still open. Never one the run passes itself (seen: the
// run's own findings), one a person decided, or one of a month the night makes. Not read: thrown (the night stops for the
// client rather than withdraw or clear them unseen)
const PICKS = new Set(["salaryExpense", "tds", "profTax", "pf", "esi", "salaryPayable"]);
export async function keepNow(rest, firm, cid, months, seen) {
  const last = (months || []).slice().sort().pop() || "", later = (ym) => !!ym && ym > last;
  const rows = await rest("/rest/v1/night_entries?select=dedupe,state&" + where(firm, cid) + "&dedupe=like." + enc("payroll:*") + "&state=in.(ready,held)");
  if (!Array.isArray(rows)) throw new Error("the payroll entries could not be read");
  const entries = [];
  rows.forEach((r) => { const m = /^payroll:(\d{6})$/.exec(String((r && r.dedupe) || ""));
    if (m && later(m[1]) && (r.state === "ready" || r.state === "held") && !entries.some((x) => x.dedupe === r.dedupe)) entries.push({ dedupe: r.dedupe }); });
  const fs = await rest("/rest/v1/night_findings?select=kind,key,state,facts,evidence,candidates,decided_by&" + where(firm, cid) + "&kind=in.(payroll_due,sent_check,ledger_pick)&state=in.(ask,you)&decided_by=is.null");
  if (!Array.isArray(fs)) throw new Error("the payroll findings could not be read");
  const had = new Set((seen || []).map((f) => f && f.kind + "|" + f.key)), findings = [], put = (f) => {
    const k = f.kind + "|" + f.key; if (had.has(k)) return; had.add(k);
    findings.push({ kind: f.kind, key: f.key, state: f.state, facts: f.facts || {}, evidence: f.evidence || [], candidates: f.candidates || [] }); };
  const open = fs.filter((f) => f && (f.state === "ask" || f.state === "you") && !f.decided_by);
  const mine = open.filter((f) => f.kind === "payroll_due" && later((/^payroll:(\d{6})$/.exec(String(f.key || "")) || [])[1]));
  mine.forEach(put);
  open.filter((f) => f.kind === "sent_check" && later((/^sent:payroll:(\d{6}):/.exec(String(f.key || "")) || [])[1])).forEach(put);
  if (mine.some((f) => (f.facts || {}).waits)) open.filter((f) => f.kind === "ledger_pick" && PICKS.has(String(f.key || "").replace(/^led:/, ""))).forEach(put);
  return { entries, findings };
}
