// "My MIS" described in words (ROUND 105, B4): Ask FinCom's build_mis tool. The model turns the person's words ("a monthly
// P&L with last year beside it, and my top 10 customers in lakhs") into a report DEFINITION; FinCom checks it here before
// it is shown: against the schema (server/_shared/misdef.js: a wrong value is replaced and said), against the client's real
// groups and ledgers (the cloud copy: asst_ledger_pick for a ledger or party, asst_find_ledgers for a group; a name not in
// the books comes back flagged, with the closest names, for the person to correct in the builder), and it carries no
// figure: the AI never states an amount here, a typed budget or an amount in a title is taken out (stripAmounts). The
// figures are worked out in the person's browser by the engine (app/src/lib/misCustom.js) from the books.
// Plain module: no Deno API, so its test stubs the database's answers.
import { checkNames, normalizeDef, stripAmounts, TOOL_GUIDE } from "../_shared/misdef.js";

// a request to build, make or change an MIS (or a management report or dashboard), in English or Hinglish
const NOUN = "(?:mis|m\\.i\\.s\\.?|management (?:information|report)s?|dashboard|one[- ]pager|monthly (?:report|pack))";
const VERB = "(?:build|make|create|design|set ?up|prepare|draft|want|need|give me|show me a|chahiye|bana\\w*|bano|banao|taiyar)";
const ASK_BEFORE = new RegExp("\\b" + VERB + "\\b.{0,60}\\b" + NOUN + "\\b", "i");
const ASK_AFTER = new RegExp("\\b" + NOUN + "\\b.{0,40}\\b" + VERB + "\\b", "i");
export function misAsked(q: string): boolean {
  const s = String(q || "");
  if (/^\s*(what|how|why|explain)\b/i.test(s) && !/\b(please|for me|bana|build|make)\b/i.test(s)) return false;
  return /\bmy mis\b/i.test(s) || ASK_BEFORE.test(s) || ASK_AFTER.test(s);
}

export const BUILD_MIS_TOOL = {
  name: "build_mis",
  description: "Lay out the client's MIS (a custom management report) the user describes: its blocks (tables, charts, KPI tiles), what each shows (MIS heads and profit lines, Tally groups, ledgers, Financial-statement codes, customers, suppliers, GST, receivables or payables by age, ratios), by month, quarter or year, compared with last year or a budget, in rupees, thousands, lakhs or crores. FinCom checks the layout against the client's real groups and ledgers, opens it in the My MIS builder and works out every figure from the books. You never state a figure: you only write the layout.",
  input_schema: { type: "object", additionalProperties: false, required: ["definition_json", "summary"], properties: {
    definition_json: { type: "string", description: TOOL_GUIDE },
    summary: { type: "string", description: "one line in the user's words saying what the report shows (no figures)" } } },
};

export const MIS_SYSTEM = "My MIS: when the user asks to build, make or change an MIS (a management report, a dashboard, a director's one-pager) for the client open, call build_mis with its layout. Use groups and ledgers by their names in the client's books (find_ledgers when unsure; never make one up). Never write a figure, an amount or a budget in it: FinCom works out every figure from the books and opens the layout in the builder. If FinCom says a name is not in the books, say which and that the user can pick one in the builder.";

export type Look = (kind: "ledger" | "group" | "party", name: string) => Promise<{ name?: string, choices?: string[] } | null>;
export type MisChecked = { ok: boolean, def: any, unknown: { kind: string, name: string, where: string, choices: string[] }[], problems: string[], parseError?: string };

// the database's answers made into the definition's look-up: a ledger or a party by asst_ledger_pick (the same name up to
// case, spacing and punctuation, or the one name it starts or contains); a group by asst_find_ledgers (a ledger under it)
const RESERVED = ["Bank Accounts", "Bank OCC A/c", "Bank OD A/c", "Branch / Divisions", "Capital Account", "Cash-in-Hand", "Current Assets", "Current Liabilities", "Deposits (Asset)", "Direct Expenses",
  "Direct Incomes", "Duties & Taxes", "Fixed Assets", "Indirect Expenses", "Indirect Incomes", "Investments", "Loans & Advances (Asset)", "Loans (Liability)", "Misc. Expenses (ASSET)", "Provisions",
  "Purchase Accounts", "Reserves & Surplus", "Sales Accounts", "Secured Loans", "Stock-in-Hand", "Sundry Creditors", "Sundry Debtors", "Suspense A/c", "Unsecured Loans"];
const key = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
export function lookFromDb(exec: (fn: string, args: Record<string, unknown>) => Promise<any>, client: string): Look {
  return async (kind, name) => {
    if (kind === "group") {
      const r = await exec("asst_find_ledgers", { p_client: client, p_text: null, p_group: name, p_as_on: null });
      const rows: any[] = (r && Array.isArray(r.rows)) ? r.rows : [];
      const same = rows.find((x) => key(x.group) === key(name)) || null;
      const res = RESERVED.find((g) => key(g) === key(name));
      if (same) return { name: String(same.group) };
      if (res && rows.length) return { name: res };
      if (rows.length) return { name };
      const groups = Array.from(new Set(RESERVED.filter((g) => key(g).includes(key(name).slice(0, 4)) || key(name).includes(key(g).slice(0, 4)))));
      return { choices: groups.slice(0, 5) };
    }
    const p = await exec("asst_ledger_pick", { p_client: client, p_text: name });
    if (p && p.ledger) return { name: String(p.ledger) };
    return { choices: ((p && p.choices) || []).map(String) };
  };
}

// the model's layout checked: parsed, normalised (no amounts), each name looked up
export async function checkMis(input: { definition_json?: unknown, summary?: unknown }, look: Look): Promise<MisChecked> {
  let raw: any = null;
  try { raw = JSON.parse(String(input.definition_json || "")); } catch (e) { return { ok: false, def: null, unknown: [], problems: [], parseError: "definition_json is not valid JSON: " + String((e as Error).message || e).slice(0, 200) }; }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.blocks) || !raw.blocks.length) return { ok: false, def: null, unknown: [], problems: [], parseError: "the layout needs at least one block" };
  const n = normalizeDef(raw, { noAmounts: true });
  const clean = stripAmounts(n.def);
  const c = await checkNames(clean, look);
  return { ok: !c.unknown.length && !n.problems.length, def: c.def, unknown: c.unknown.map((u: any) => ({ kind: u.kind, name: u.name, where: u.where, choices: u.choices })), problems: n.problems };
}

// no figure leaves here: every number in the definition is a setting (a unit, decimals, how many rows), never an amount
export function figuresIn(def: any): number[] {
  const out: number[] = [];
  const walk = (x: any, k: string) => {
    if (typeof x === "number" && !["unit", "dec", "top", "v"].includes(k)) out.push(x);
    else if (x && typeof x === "object") Object.entries(x).forEach(([kk, v]) => walk(v, kk));
    else if (typeof x === "string" && /(₹|rs\.?\s*)\s*\d|\b\d{1,3}(,\d{2,3})+\b/i.test(x)) out.push(NaN);
  };
  walk(def, "");
  return out;
}
