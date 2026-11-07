// node tests/run_corp_store.mjs - Corporate's store (app/src/screens/corp/store.js) after the review of 08b05e4c8, on a
// stand-in of the server in this process (made-up rows only). The four scenarios of the review, each impossible or
// handled now, and the model's rules:
//   t1  a computer reads, another changes the email; this one changes the phone: the PATCH carries only what this edit
//       changed (laid over the row as the server now has it), the other's email kept;
//   t2  the line down: no tight loop of reads (the read waits 5 s, 15 s, 60 s ...), never from drawing;
//   t3  signed out: nothing can be changed, nothing is kept to send later, no copy adopted at sign-in;
//   t4  an edit, then a removal before it is sent: one conditional DELETE (no PATCH of the removed record); a later
//       change elsewhere sends no DELETE again; B's new copy of the form is left alone;
//   plus: lists merged three ways by row id; a DELETE never without updated_at, a removal of a row changed elsewhere
//   kept and said; a failed save said with Retry and saved on Retry; the read copy holds server rows only.
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
globalThis.LocalOwner = { P: "tdsdesk:", bound: { uid: "u1" }, stale: false, cur() { return this.bound; } };
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const W = (ms) => new Promise((r) => setTimeout(r, ms));
let tick = 0;
const st = () => "2026-11-07T10:00:00." + String(++tick).padStart(6, "0") + "+00:00";
const srv = { corp_profiles: [], corp_filings: [], corp_documents: [] };
let log = [], on = true, fail = "", calls = 0;
const parse = (path) => { const [t, q] = path.split("?"); const f = {}; (q || "").split("&").forEach((kv) => { const m = /^([a-z_]+)=eq\.(.*)$/.exec(kv); if (m) f[m[1]] = decodeURIComponent(m[2]); }); return { t, f }; };
const match = (r, f) => Object.entries(f).every(([k, v]) => String(r[k]) === v);
const cp = (x) => JSON.parse(JSON.stringify(x));
globalThis.Cloud = { on: () => on, st: { role: "owner" }, async api(path, o = {}) {
  calls++;
  const m = o.method || "GET", { t, f } = parse(path), rows = srv[t];
  log.push({ m, path, body: o.body ? cp(o.body) : null });
  if (fail) throw new TypeError("Failed to fetch");
  if (m === "GET") return cp(rows.filter((r) => match(r, f)));
  if (m === "POST") { if (rows.some((r) => r.client_id === o.body.client_id && (t === "corp_profiles" || r.ref === o.body.ref || r.id === o.body.id))) throw new Error("duplicate key (23505)");
    const r = Object.assign({}, cp(o.body), { updated_at: st() }); rows.push(r); return [cp(r)]; }
  if (m === "PATCH") { const hit = rows.filter((r) => match(r, f)); hit.forEach((r) => Object.assign(r, cp(o.body), { updated_at: st() })); return cp(hit); }
  if (m === "DELETE") { const gone = rows.filter((r) => match(r, f)); srv[t] = rows.filter((r) => !gone.includes(r)); return cp(gone); }
  return [];
} };
const S = await import("../app/src/screens/corp/store.js");

console.log("t1. only the changed fields, over the server's row");
srv.corp_profiles.push({ client_id: "c1", profile: { phone: "P0", email: "E0" }, directors: [], shareholders: [], charges: [], letterhead: {}, updated_at: st() });
S.corpOf("c1"); await W(50);
ok(S.corpOf("c1").profile.email === "E0" && S.corpOf("c1").cloud.state === "ready", "read from the server");
srv.corp_profiles[0].profile = { phone: "P0", email: "E1-from-C" }; srv.corp_profiles[0].updated_at = st();
S.saveProfile("c1", { phone: "P1" }); await W(700);
const patches = log.filter((l) => l.m === "PATCH");
ok(srv.corp_profiles[0].profile.email === "E1-from-C" && srv.corp_profiles[0].profile.phone === "P1", "the other computer's email kept, this phone saved (" + JSON.stringify(srv.corp_profiles[0].profile) + ")");
ok(patches.every((p) => !("directors" in p.body) && !("shareholders" in p.body)) && patches.every((p) => /updated_at=eq\./.test(p.path)), "the PATCHes carry only the profile (no lists untouched), conditional");
ok(patches[patches.length - 1].body.profile.email === "E1-from-C", "the PATCH sent laid over the server's row, not an old copy");

console.log("lists three ways by row id");
srv.corp_profiles[0].directors = [{ id: "d1", name: "A (made-up)", din: "00000011" }, { id: "d2", name: "B (made-up)", din: "00000022" }]; srv.corp_profiles[0].updated_at = st();
S.forget(); S.corpOf("c1"); await W(50);
srv.corp_profiles[0].directors = srv.corp_profiles[0].directors.concat([{ id: "d3", name: "C (made-up)", din: "00000033" }]); srv.corp_profiles[0].updated_at = st();
S.saveProfile("c1", { directors: S.corpOf("c1").profile.directors.map((d) => (d.id === "d1" ? Object.assign({}, d, { din: "00000099" }) : d)) }); await W(700);
ok(JSON.stringify(srv.corp_profiles[0].directors.map((d) => d.id + ":" + d.din)) === JSON.stringify(["d1:00000099", "d2:00000022", "d3:00000033"]), "a DIN changed here, a director added there: both (" + srv.corp_profiles[0].directors.map((d) => d.din) + ")");

console.log("t4. an edit, then a removal before it is sent");
const ref = "annual:DPT-3:2025-26";
S.saveFiling("c1", { ref, form: "DPT-3", kind: "annual", period: "2025-26", status: "in_progress", steps: 1 }); await W(700);
ok(srv.corp_filings.length === 1, "saved");
log = [];
S.saveFiling("c1", { ref, steps: 2 }); S.dropFiling("c1", ref); await W(700);
ok(srv.corp_filings.length === 0 && log.filter((l) => l.m === "PATCH").length === 0 && log.filter((l) => l.m === "DELETE").length === 1 && /updated_at=eq\./.test(log.find((l) => l.m === "DELETE").path),
  "one conditional DELETE, no PATCH of the removed record (" + log.map((l) => l.m).join(",") + ")");
ok(!S.corpOf("c1").filings.length && !Object.keys(S.corpOf("c1").pending).length, "gone here, nothing left to send");
srv.corp_filings.push({ client_id: "c1", ref, form: "DPT-3", kind: "annual", period: "2025-26", status: "ready", steps: 3, updated_at: st() });
log = [];
S.saveProfile("c1", { nic: "13990" }); await W(700);
ok(srv.corp_filings.length === 1 && !log.some((l) => l.m === "DELETE"), "B's new DPT-3 left alone, no DELETE sent again");

console.log("a removal of a row changed elsewhere; never a DELETE without updated_at");
S.forget(); S.corpOf("c1"); await W(50);
srv.corp_filings[0].steps = 4; srv.corp_filings[0].updated_at = st();
log = [];
S.dropFiling("c1", ref); await W(700);
ok(srv.corp_filings.length === 1 && S.corpOf("c1").filings.length === 1 && /changed on another computer/.test(S.cloudNote("c1").text), "kept, and said (" + S.cloudNote("c1").text + ")");
ok(log.filter((l) => l.m === "DELETE").every((l) => /updated_at=eq\./.test(l.path)), "every DELETE conditional");
S.saveFiling("c1", { ref: "annual:MSME-1:2025-26:H1", form: "MSME-1", kind: "annual", period: "2025-26" }); S.dropFiling("c1", "annual:MSME-1:2025-26:H1"); await W(700);
ok(!log.some((l) => l.m === "DELETE" && /MSME-1/.test(l.path)) && !srv.corp_filings.some((r) => /MSME/.test(r.ref)), "a record never saved: dropped, no DELETE");

console.log("a failed save: said, kept on screen, Retry");
fail = "net";
S.saveProfile("c1", { email: "kept@example.com" }); await W(700);
const n = S.cloudNote("c1");
ok(n.retry && /^Not saved: /.test(n.text) && S.corpOf("c1").profile.email === "kept@example.com", "Not saved, with Retry; the edit still on screen (" + n.text + ")");
const copyNow = JSON.parse(ls.get("tdsdesk:corp:c1"));
ok(copyNow.profile.row.email !== "kept@example.com" && !JSON.stringify(copyNow).includes("dirty"), "the read copy holds the server's rows only (no unsent field)");
fail = ""; S.retryNow("c1"); await W(300);
ok(srv.corp_profiles[0].profile.email === "kept@example.com" && /Saved to the firm account/.test(S.cloudNote("c1").text), "Retry: saved");

console.log("t2. the line down: no tight loop of reads, none from drawing");
fail = "net"; S.forget(); calls = 0;
globalThis.render = () => { S.corpOf("c1"); S.cloudNote("c1"); };
S.corpOf("c1"); await W(1000);
ok(calls <= 3, "requests in 1 s while offline: " + calls + " (the three tables read once)");
ok(S.corpOf("c1").cloud.state === "unread" && /could not be read/.test(S.cloudNote("c1").text), "the page says the firm's copy could not be read");
fail = ""; S.retryNow("c1"); await W(100);
ok(S.corpOf("c1").cloud.state === "ready", "read again on Retry (or online / its timer)");

console.log("t3. signed out");
on = false; S.forget(); calls = 0;
S.corpOf("c1"); S.saveProfile("c1", { phone: "typed signed out" }); await W(600);
ok(S.cloudNote("c1").signin && S.corpOf("c1").profile.phone !== "typed signed out" && !Object.keys(S.corpOf("c1").pending).length && calls === 0 && !S.canEdit("c1"),
  "Sign in to use Corporate; nothing changed, kept or sent (" + S.cloudNote("c1").text + ")");
on = true; S.corpOf("c1"); await W(100);
ok(S.corpOf("c1").cloud.state === "ready" && S.corpOf("c1").profile.phone !== "typed signed out", "signed in: the server's copy, nothing adopted");

console.log("\n" + (fails ? "FAILED: " + fails : "all passed"));
process.exit(fails ? 1 : 0);
