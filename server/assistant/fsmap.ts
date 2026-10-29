// The one-time AI mapping of the Financial statements page (fincom-assistant, action "fs_aimap"; the owner, 29-Oct-2026:
// "run one time ai here to match uploaded balance sheet and fincom generated balance sheet.. so that you will map the
// ledger heads accordingly.. and for next year it would be 1 click job for anyone"). One call, on the firm's cap like every
// Assistant call: the ledgers (name, Tally group, balance at the balance sheet's date), the audited balance sheet's lines
// and the code list (server/_shared/fsaimap.js keeps only those fields); identifiers in the names (PAN, GSTIN, ...) masked
// going out and put back in the reasons. The answer is a code and a reason per ledger, structured JSON; it sets no figure.
// The app then checks it head by head (faTie) and a person accepts it (app/src/screens/books/fin/AiMap.jsx).
// Plain module: no Deno, its imports its neighbours'.
import { costUsd, SONNET, Usage } from "./models.ts";
import { Masker } from "./mask.ts";
import { FA_SCHEMA, FA_SYSTEM, faClean, faInput, faParse, faPrompt } from "../_shared/fsaimap.js";

type StreamClient = { beta: { messages: { stream: (p: Record<string, unknown>) => { [Symbol.asyncIterator](): AsyncIterator<any>, finalMessage(): Promise<any> } } } };
export type MapDeps = {
  client: StreamClient,
  model?: string,                 // the console's choice (ai_allowed), else Sonnet
  capTake: () => Promise<{ ok: boolean, why?: string, cap_inr?: number, cap?: number }>,
  costAdd: (usd: number, u: Usage) => Promise<{ inr?: number } | null>,
};
export type MapResult = { state: "used" | "nothing" | "cap" | "failed" | "invalid", proposals: { name: string, code: string, reason: string }[], asked: number, notSent: number,
  bad: number, usd: number, inr: number, usage: Usage, cap?: { why: string, cap_inr: number, cap: number } };

export async function aiMap(deps: MapDeps, raw: unknown): Promise<MapResult> {
  const MODEL = deps.model || SONNET;
  const clean = faClean(raw), out: MapResult = { state: "nothing", proposals: [], asked: clean.ledgers.length, notSent: clean.notSent, bad: 0, usd: 0, inr: 0, usage: { input_tokens: 0, output_tokens: 0 } };
  if (!clean.ledgers.length || !clean.codes.length) return out;
  const cap = await deps.capTake().catch(() => ({ ok: false, why: "error" }));
  if (!cap.ok) { out.state = "cap"; out.cap = { why: String(cap.why || ""), cap_inr: Number((cap as any).cap_inr || 0), cap: Number((cap as any).cap || 0) }; return out; }
  const mk = new Masker("");
  const inp = faInput({ ...clean, ledgers: clean.ledgers.map((l: any) => ({ ...l, name: mk.text(l.name) })), lines: clean.lines.map((z: any) => ({ ...z, head: mk.text(z.head), line: mk.text(z.line) })) });
  const real: Record<string, string> = {}; clean.ledgers.forEach((l: any, i: number) => { real["L" + (i + 1)] = l.name; });
  let msg: any;
  try {
    const stream = deps.client.beta.messages.stream({
      model: MODEL, max_tokens: Math.min(32000, 3000 + inp.ledgers.length * 70), thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: FA_SCHEMA } },
      system: [{ type: "text", text: FA_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: faPrompt(inp) }],
    });
    for await (const _ev of stream) { /* read whole at the end */ }
    msg = await stream.finalMessage();
  } catch (e) { out.state = "failed"; (out as any).error = e; return out; }
  const u: Usage = msg?.usage || {};
  out.usage = u; out.usd = costUsd(MODEL, u);
  const added = await deps.costAdd(out.usd, u).catch(() => null);
  out.inr = Number(added?.inr || 0);
  const text = ((msg?.content || []) as any[]).filter((b) => b?.type === "text").map((b) => b.text).join("");
  const parsed = msg?.stop_reason === "refusal" || msg?.stop_reason === "max_tokens" ? { ok: false, list: [], bad: 0 } : faParse(text, { byId: real, codes: new Set(inp.codes.map((c: any) => c.code)) });
  if (!parsed.ok) { out.state = msg?.stop_reason === "max_tokens" || msg?.stop_reason === "refusal" ? "failed" : "invalid"; return out; }
  out.state = "used"; out.bad = parsed.bad;
  out.proposals = parsed.list.map((p: any) => ({ name: p.name, code: p.code, reason: mk.unmask(p.reason) }));
  return out;
}
