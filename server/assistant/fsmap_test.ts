// deno test server/assistant/fsmap_test.ts (run by tests/run_fs_aimap_server.py). The one-time AI mapping of the Financial
// statements page (fincom-assistant, action "fs_aimap"; server/assistant/fsmap.ts and server/_shared/fsaimap.js) with Claude
// and Supabase FAKED:
//   - a stubbed reply with the right codes: each ledger's code and reason come back, and FinCom's own check (faTie: per head,
//     the sum of the ledgers' balances against the audited figure) finds every head tied;
//   - a wrong code: kept as the AI's proposal, and the check shows the gap on both heads (never forced);
//   - no figures in the reply: whatever else the model writes (amounts, balances, adjustments) is dropped; a code not in the
//     list, an id not sent, a ledger twice: dropped;
//   - the cap: over the firm's monthly limit, no call;
//   - only the allowed fields go to the model (the request body asserted): ledger names, Tally groups, balances, the
//     balance sheet's lines, the code list; nothing else about the client (its name, GSTIN, PAN, entries); identifiers in a
//     name masked going out and put back in the reason;
//   - the switches: the firm's (assistant_settings), FinCom's for the feature (ai_allowed "fs_aimap"; before its registry
//     row is in, the assistant's switch); the cost added and one log line (assistant_log, feature "fs_aimap").
import { FA_SYSTEM, faClean, faParse, faTie } from "../_shared/fsaimap.js";
import { handler } from "./index.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

// a small made-up company: a debit positive, in rupees. Willow Labs is a debtor in Tally, a loan to a related party in the
// audited balance sheet; Bluebell is a micro enterprise. Profit 30,000 (sales 1,00,000 less rent 70,000) sits in reserves.
const LEDGERS = [
  { name: "Equity Share Capital", group: "Capital Account", bal: -100000 },
  { name: "Profit & Loss A/c", group: "Reserves & Surplus", bal: -50000 },
  { name: "Bluebell Print Works", group: "Sundry Creditors", bal: -20000 },
  { name: "Juniper Travels", group: "Sundry Creditors", bal: -30000 },
  { name: "Orchid Retail", group: "Sundry Debtors", bal: 80000 },
  { name: "Willow Labs", group: "Sundry Debtors", bal: 90000 },
  { name: "Northbank Current A/c 29AABCL1234F1Z5", group: "Bank Accounts", bal: 60000 },
  { name: "Software Services", group: "Sales Accounts", bal: -100000 },
  { name: "Rent", group: "Indirect Expenses", bal: 70000 },
];
const RIGHT: Record<string, string> = { "Equity Share Capital": "3A", "Profit & Loss A/c": "4A", "Bluebell Print Works": "6A", "Juniper Travels": "6B", "Orchid Retail": "10A",
  "Willow Labs": "12H", "Northbank Current A/c 29AABCL1234F1Z5": "11A", "Software Services": "13A", "Rent": "17A" };
const LINES = [
  { head: "Shareholders' funds", line: "Share capital", amt: 100000, code: "3A" }, { head: "Shareholders' funds", line: "Reserves and surplus", amt: 80000, code: "4A" },
  { head: "Trade payables", line: "Total outstanding dues of micro and small enterprises", amt: 20000, code: "6A" },
  { head: "Trade payables", line: "Total outstanding dues of creditors other than micro and small enterprises", amt: 30000, code: "6B" },
  { head: "Current assets", line: "Trade receivables", amt: 80000, code: "10A" }, { head: "Current assets", line: "Cash and bank balances", amt: 60000, code: "11A" },
  { head: "Note 13 Short-term loans and advances", line: "Loans and advances to related parties", amt: 90000, code: "12H" },
];
const INFO: Record<string, { head: string, sign: number, side: string }> = {
  "3A": { head: "sc", sign: -1, side: "BS" }, "4A": { head: "rs", sign: -1, side: "BS" }, "6A": { head: "tpm", sign: -1, side: "BS" }, "6B": { head: "tpo", sign: -1, side: "BS" },
  "10A": { head: "tr", sign: 1, side: "BS" }, "11A": { head: "cash", sign: 1, side: "BS" }, "12H": { head: "stla", sign: 1, side: "BS" }, "13A": { head: "", sign: -1, side: "PL" }, "17A": { head: "", sign: 1, side: "PL" },
};
const CODES = Object.keys(INFO).map((code) => ({ code, label: "label of " + code }));
const AUDITED = (() => { const a: Record<string, number> = {}; LINES.forEach((z) => { const h = INFO[z.code].head; a[h] = (a[h] || 0) + z.amt; }); return a; })();
// what the app sends, with fields that must never reach the model
const BODY = (extra: Record<string, unknown> = {}) => ({
  action: "fs_aimap", client_id: "c-1", mode: "close",
  ledgers: LEDGERS.map((l) => ({ ...l, gstin: "29AABCL1234F1Z5", pan: "AABCL1234F", vouchers: [{ narr: "secret narration" }], samples: ["20250405 Purchase 1800"], address: "12 Secret Road" })),
  lines: LINES.map((z) => ({ ...z, py: 12345, note: 13 })), codes: CODES.map((c) => ({ ...c, extra: "x" })),
  client: { name: "ZZ Client", gstin: "29AABCL1234F1Z5" }, firm: { name: "Made-up & Associates" }, ...extra,
});

// Claude, faked: answers from a table by the masked names it was sent (ids L1, L2, ...)
class FakeClaude {
  calls: Record<string, any>[] = [];
  constructor(public answer: (sent: { id: string, name: string }[]) => unknown[], public extra: Record<string, unknown> = {}) {}
  beta = { messages: { stream: (p: Record<string, any>) => {
    this.calls.push(p);
    const sent = JSON.parse(String(p.messages[0].content)).ledgers as { id: string, name: string }[];
    const msg = { content: [{ type: "text", text: JSON.stringify({ ledgers: this.answer(sent), ...this.extra }) }], usage: { input_tokens: 4000, output_tokens: 900 }, stop_reason: "end_turn" };
    return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => msg };
  } } };
}
const byName = (codeOf: (n: string) => string) => (sent: { id: string, name: string }[]) => sent.map((l) => ({ id: l.id, code: codeOf(l.name.replace(/GSTIN_1/, "29AABCL1234F1Z5")), reason: "read from the name " + l.name }));

function fakeSupa(o: { enabled?: boolean, cap?: any, ai?: (a: any) => any } = {}) {
  const log: string[] = [], rpcs: Record<string, any>[] = [];
  const j = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "Content-Type": "application/json" } });
  const f = (async (u: string | URL, init: RequestInit = {}) => {
    const url = String(u), path = url.replace(/^https?:\/\/[^/]+/, ""), body = init.body ? JSON.parse(String(init.body)) : null;
    log.push((init.method || "GET") + " " + path.split("?")[0]);
    if (path.startsWith("/auth/v1/user")) return j({ id: "u-1" });
    if (path.startsWith("/rest/v1/rpc/mfa_ok")) return j(true);
    if (path.startsWith("/rest/v1/members")) return j([{ firm_id: "f-1", role: "owner", active: true }]);
    if (path.startsWith("/rest/v1/assistant_settings")) return j([{ enabled: o.enabled !== false }]);
    if (path.startsWith("/rest/v1/clients")) return j([{ id: "c-1", name: "ZZ Client", deleted: false }]);
    if (path.startsWith("/rest/v1/platform_secrets")) return j([{ value: "sk-test" }]);
    if (path.startsWith("/rest/v1/rpc/")) rpcs.push({ fn: path.slice("/rest/v1/rpc/".length).split("?")[0], body });
    if (path.startsWith("/rest/v1/rpc/asst_cap_take")) return j(o.cap || { ok: true });
    if (path.startsWith("/rest/v1/rpc/asst_cost_add")) return j({ inr: 1.23, spent_inr: 10, cap_inr: 3000 });
    if (path.startsWith("/rest/v1/rpc/ai_allowed")) return j(o.ai ? o.ai(body) : { ok: true, reason: "on", model: null });
    if (path.startsWith("/rest/v1/rpc/")) return j({});
    return j({ message: "not faked: " + path }, 404);
  }) as unknown as typeof fetch;
  return { f, log, rpcs };
}
async function post(h: (r: Request) => Promise<Response>, body: Record<string, unknown>) {
  const res = await h(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json", Origin: "https://staging.fincom.live" }, body: JSON.stringify(body) }));
  const text = await res.text();
  return { status: res.status, text, j: JSON.parse(text) };
}
const env = (k: string) => ({ SUPABASE_URL: "http://stand", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[k];
const quiet = { report() {}, mismatch() {}, listen() {}, wrap: (x: unknown) => x } as never;
const make = (c: FakeClaude, s = fakeSupa()) => ({ s, h: handler({ env, fetch: s.f, anthropic: () => c as never, sentry: quiet }) });
// FinCom's check on the proposals: each ledger at the code proposed, the profit in reserves
const tieOf = (props: { name: string, code: string }[]): any => {
  const code: Record<string, string> = Object.fromEntries(props.map((p) => [p.name, p.code]));
  return faTie(LEDGERS.map((l) => ({ code: code[l.name] || "", bal: l.bal })), INFO as any, AUDITED as any, { profitHead: "rs" } as any);
};

Deno.test("a stubbed reply with the right codes: each ledger's code and reason back; every head ties", async () => {
  const c = new FakeClaude(byName((n) => RIGHT[n]));
  const { s, h } = make(c);
  const r = await post(h, BODY());
  eq(r.status, 200, "200");
  eq(c.calls.length, 1, "one call");
  eq(r.j.proposals.length, LEDGERS.length, "a proposal for every ledger");
  eq(r.j.proposals.map((p: any) => [p.name, p.code]), LEDGERS.map((l) => [l.name, RIGHT[l.name]]), "the codes, by the real names");
  assert(r.j.proposals.every((p: any) => /^read from the name /.test(p.reason)), "each with its reason");
  const t = tieOf(r.j.proposals);
  assert(t.heads.length === 7 && t.heads.every((x: any) => x.diff === 0 && x.tied), "every head ties: " + JSON.stringify(t.heads));
  eq(t.heads.find((x: any) => x.head === "rs").fin, 80000, "reserves: 50,000 brought forward + 30,000 profit of the year");
  eq([r.j.cost.inr, r.j.asked], [1.23, 9], "the run's cost in rupees (asst_cost_add) and the ledgers asked");
  assert(r.j.cost.usd > 0, "the cost in dollars");
  assert(s.rpcs.some((x) => x.fn === "asst_cost_add" && x.body.p_feature === "fs_aimap"), "the cost added to the firm's month, feature fs_aimap");
  const lg = s.rpcs.find((x) => x.fn === "asst_log_add");
  assert(lg && lg.body.p_feature === "fs_aimap" && lg.body.p_calls === 1 && lg.body.p_in === 4000 && lg.body.p_out === 900 && lg.body.p_cost_inr === 1.23, "one log line (assistant_log): " + JSON.stringify(lg && lg.body));
  assert(!/Willow|Bluebell|80000/.test(String(lg.body.p_question)), "the log line names no ledger and no figure: " + lg.body.p_question);
});

Deno.test("a wrong code: kept as the AI's proposal, and FinCom's check shows the gap on both heads (never forced)", async () => {
  const c = new FakeClaude(byName((n) => n === "Willow Labs" ? "10A" : RIGHT[n]));
  const { h } = make(c);
  const r = await post(h, BODY());
  eq(r.status, 200, "200");
  eq(r.j.proposals.find((p: any) => p.name === "Willow Labs").code, "10A", "the wrong code is the AI's proposal, shown as it is");
  const t = tieOf(r.j.proposals), H = (id: string): any => t.heads.find((x: any) => x.head === id);
  eq([H("tr").aud, H("tr").fin, H("tr").diff, H("tr").tied], [80000, 170000, -90000, false], "trade receivables: a gap of 90,000");
  eq([H("stla").aud, H("stla").fin, H("stla").diff, H("stla").tied], [90000, 0, 90000, false], "loans and advances: the other side of the gap");
  assert(["sc", "rs", "tpm", "tpo", "cash"].every((id) => H(id).tied), "the other heads tie");
});

Deno.test("no figures in the reply: amounts and anything else the model writes are dropped; unknown codes and ids too", async () => {
  const c = new FakeClaude((sent) => [
    ...sent.map((l) => ({ id: l.id, code: RIGHT[l.name.replace(/GSTIN_1/, "29AABCL1234F1Z5")], reason: "fits", amount: 999999, bal: 1, balance: 5, adjust: { dr: "x", cr: "y", amt: 10 } })),
    { id: "L999", code: "6B", reason: "not a ledger sent" }, { id: sent[0].id, code: "4A", reason: "the same ledger twice" },
  ], { adjustments: [{ dr: "Rent", cr: "Cash", amount: 5000 }], figures: { tr: 1 } });
  const c2 = new FakeClaude((sent) => sent.map((l, i) => ({ id: l.id, code: i === 3 ? "99Z" : RIGHT[l.name.replace(/GSTIN_1/, "29AABCL1234F1Z5")], reason: "x" })));
  const r = await post(make(c).h, BODY());
  eq(r.status, 200, "200");
  eq(r.j.proposals.length, LEDGERS.length, "one proposal a ledger sent: an id not sent and a second answer dropped");
  assert(r.j.proposals.every((p: any) => JSON.stringify(Object.keys(p).sort()) === JSON.stringify(["code", "name", "reason"])), "each proposal: name, code, reason only: " + JSON.stringify(r.j.proposals[0]));
  assert(!/999999|amount|adjust|balance|figures/.test(r.text), "nothing of the model's figures in the reply: " + r.text.slice(0, 300));
  eq(r.j.proposals[0].code, "3A", "the first answer kept, not the duplicate");
  const r2 = await post(make(c2).h, BODY());
  eq([r2.j.proposals.length, r2.j.bad], [LEDGERS.length - 1, 1], "a code not in the list is dropped and counted");
  eq(r2.j.proposals.some((p: any) => p.name === "Juniper Travels"), false, "... that ledger has no proposal");
  // the parser alone: text around the JSON, and nothing but text
  eq(faParse("no json here", { byId: { L1: "A" }, codes: new Set(["3A"]) } as any).ok, false, "unreadable text: not ok");
});

Deno.test("the cap: over the firm's monthly limit, no call; the cap's own words", async () => {
  const c = new FakeClaude(byName((n) => RIGHT[n]));
  const s = fakeSupa({ cap: { ok: false, why: "inr", cap_inr: 3000, cap: 500 } });
  const r = await post(make(c, s).h, BODY());
  eq([r.status, r.j.kind, c.calls.length], [429, "cap", 0], "429, no call");
  assert(/this month's ₹3,000/.test(r.j.error) && /1st of next month/.test(r.j.error), "the monthly cap's words: " + r.j.error);
  assert(!s.rpcs.some((x) => x.fn === "asst_cost_add"), "nothing charged");
  const s2 = fakeSupa({ cap: { ok: false, why: "calls", cap_inr: 3000, cap: 500 } }), c2 = new FakeClaude(byName((n) => RIGHT[n]));
  const r2 = await post(make(c2, s2).h, BODY());
  eq([r2.status, c2.calls.length], [429, 0], "the day's calls used: no call");
});

Deno.test("only the allowed fields go to the model (the request body): names, groups, balances, the balance sheet's lines, the codes", async () => {
  const c = new FakeClaude(byName((n) => RIGHT[n]));
  const r = await post(make(c).h, BODY());
  eq(r.status, 200, "200");
  const req = c.calls[0], all = JSON.stringify(req);
  eq(Object.keys(req).sort(), ["max_tokens", "messages", "model", "output_config", "system", "thinking"], "the request's keys");
  eq(req.messages.length, 1, "one message");
  const sent = JSON.parse(String(req.messages[0].content));
  eq(Object.keys(sent).sort(), ["balance_sheet", "codes", "ledgers"], "the message: the balance sheet, the codes, the ledgers");
  assert(sent.ledgers.every((l: any) => JSON.stringify(Object.keys(l).sort()) === JSON.stringify(["bal", "group", "id", "name"])), "a ledger: id, name, group, balance: " + JSON.stringify(sent.ledgers[0]));
  assert(sent.balance_sheet.every((z: any) => JSON.stringify(Object.keys(z).sort()) === JSON.stringify(["amt", "code", "head", "line"])), "a line: head, line, amount, code: " + JSON.stringify(sent.balance_sheet[0]));
  assert(sent.codes.every((z: any) => JSON.stringify(Object.keys(z).sort()) === JSON.stringify(["code", "label"])), "a code: code, label");
  eq(sent.ledgers.map((l: any) => l.bal), LEDGERS.map((l) => l.bal), "the balances as sent");
  for (const bad of ["ZZ Client", "AABCL1234F", "29AABCL1234F1Z5", "secret narration", "Secret Road", "20250405", "Made-up & Associates", "c-1", "12345"])
    assert(!all.includes(bad), "not sent to the model: " + bad);
  assert(sent.ledgers.some((l: any) => l.name === "Northbank Current A/c GSTIN_1"), "an identifier in a ledger's name masked going out");
  eq(r.j.proposals.find((p: any) => p.name.startsWith("Northbank")).reason, "read from the name Northbank Current A/c 29AABCL1234F1Z5", "... and put back in the reason");
  eq(req.system[0].text, FA_SYSTEM, "the system prompt: FinCom's own, no client in it");
  eq(req.output_config.format.type, "json_schema", "structured JSON output");
  // the app's own cleaning is the same rule (faClean): the extra fields never leave the browser either
  const cl = faClean(BODY() as any);
  assert(!JSON.stringify(cl).includes("secret narration") && !JSON.stringify(cl).includes("ZZ Client"), "faClean keeps only the allowed fields");
});

Deno.test("the switches: the firm's assistant off, FinCom's switch for the feature, before its registry row (the assistant's switch)", async () => {
  const c = new FakeClaude(byName((n) => RIGHT[n]));
  const a = await post(make(c, fakeSupa({ enabled: false })).h, BODY());
  eq([a.status, a.j.kind, c.calls.length], [403, "off", 0], "the firm's assistant off: 403, no call");
  assert(/Settings › AI help/.test(a.j.error), "says where to switch it on: " + a.j.error);
  const s = fakeSupa({ ai: (x) => x.p_feature === "fs_aimap" ? { ok: false, reason: "feature_off", message: "AI for Financial statements mapping is switched off by FinCom." } : { ok: true, reason: "on" } });
  const b = await post(make(c, s).h, BODY());
  eq([b.status, b.j.kind, b.j.error, c.calls.length], [403, "ai_off", "AI for Financial statements mapping is switched off by FinCom.", 0], "FinCom's switch for fs_aimap off: refused, no call");
  assert(!s.log.some((x) => x.includes("platform_secrets")), "the key is not even read");
  // migration 129 not run yet: fs_aimap unregistered -> the assistant's own switch decides
  const s3 = fakeSupa({ ai: (x) => x.p_feature === "fs_aimap" ? { ok: false, reason: "unregistered", message: "not registered" } : { ok: true, reason: "on" } });
  const r3 = await post(make(c, s3).h, BODY());
  eq([r3.status, c.calls.length], [200, 1], "unregistered: the assistant's switch (on) lets it run");
  const s4 = fakeSupa({ ai: (x) => x.p_feature === "fs_aimap" ? { ok: false, reason: "unregistered", message: "not registered" } : { ok: false, reason: "killed", message: "AI for Ask FinCom is switched off by FinCom." } });
  const r4 = await post(make(c, s4).h, BODY());
  eq([r4.status, r4.j.kind, c.calls.length], [403, "ai_off", 1], "unregistered and the assistant off (the kill switch): refused, no call");
  const c5 = new FakeClaude(() => []);
  const r5 = await post(make(c5).h, { ...BODY(), client_id: undefined });
  eq([r5.status, c5.calls.length], [400, 0], "no client: 400, no call");
  const r6 = await post(make(c5).h, { ...BODY(), ledgers: [] });
  eq([r6.status, c5.calls.length], [400, 0], "no ledgers: 400, no call");
});
