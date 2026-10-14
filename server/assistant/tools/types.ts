// The interface of a tool module that plugs into FinCom Assistant (docs/assistant-tools.md): the audit (tools/audit.ts) and
// the reports (tools/reports.ts) each export TOOLS: ExtTool[]; tools/index.ts lists the modules. Plain types, no imports
// beyond files.ts's.
import type { DocSpec } from "../files.ts";

export type Col = { k: string, label: string, t?: "text" | "amount" | "int" | "date" | "pct" };
// a table FinCom computed (never a figure from the AI): shown under the answer, right-aligned amounts, a date opens the entry
export type ToolTable = { tool: string, title: string, columns: Col[], rows: Record<string, unknown>[], summary?: Record<string, number | string | boolean | null>,
  basis?: string, period?: { from?: string | null, to?: string | null, as_on?: string | null } };
export type FileOut = { id: string, name: string, kind: string, path: string, expires: string, bytes?: number };

export type ExtCtx = {
  clientId: string | null, clientName: string, today: string,        // today: YYYY-MM-DD, India
  firm: { name: string, lines: string[] },
  rpc: (fn: string, args: Record<string, unknown>) => Promise<any>,   // a SQL function as the signed-in user (RLS); SECURITY INVOKER, read-only functions only
  book: (tool: string, input: Record<string, unknown>) => Promise<any>, // one of the assistant's book tools by name (tools.ts), same parameters as Claude gives
  makeFile: (spec: DocSpec, fileName: string) => Promise<FileOut | null>, // xlsx / docx / pdf (files.ts), stored 30 days in the firm's bucket
  uploadFile: (bytes: Uint8Array, fileName: string, kind: string) => Promise<FileOut | null>, // any bytes (zip ...), same storage
  progress: (label: string) => void,                                  // a line in the panel while a long tool runs ("Benford: done")
  aiText: (prompt: string, o?: { maxTokens?: number }) => Promise<string>, // the AI's words ONLY (commentary, ranking): masked, Opus, counted against the cap; marked amber
  // for a firm-wide tool (firmWide: true, e.g. the certificates): the firm's clients, a client's record and kept files, SQL
  // for a named client, the files uploaded in this chat, reading one, the AI reading a document (extraction only: Sonnet,
  // masked text or the document, counted against the cap, labelled by the tool), the certificates' store (migration 83)
  clients?: (text: string | null) => Promise<{ client: string, name: string, gstin?: string }[]>,
  clientInfo?: (id: string) => Promise<Record<string, unknown> | null>,
  clientFiles?: (id: string) => Promise<{ path: string, name: string, type: string }[]>,
  rpcFor?: (client: string, fn: string, args: Record<string, unknown>) => Promise<any>,
  uploads?: { path: string, name: string, type: string }[],
  readFile?: (path: string) => Promise<Uint8Array | null>,
  aiRead?: (prompt: string, doc?: { bytes: Uint8Array, type: string } | null) => Promise<string>,
  // deno-lint-ignore no-explicit-any
  store?: any,
  noFont?: boolean,
  firmWide?: boolean,
};
export type ExtResult = {
  tables?: ToolTable[],      // shown, green ("Checked against the books ✓") when label is "books"
  files?: FileOut[],         // listed in the chat with a download button
  forModel?: string,         // what the model reads back (keep it short: totals; FinCom masks it)
  aiText?: string,           // AI-written narrative to show, marked "AI-drafted, review before use"
  error?: string,            // the tool could not run: said to the model, which tells the user
};
export type ExtTool = {
  name: string,              // snake_case, unique across all modules (prefix: audit_*, report_*)
  description: string,       // for the model: when to call it
  input_schema: Record<string, unknown>,   // strict JSON schema: every object additionalProperties false, every property required (null allowed)
  task: "heavy" | "book",    // heavy: the turn runs on Opus 5.5 at high effort (audit, 3CD, Schedule III, DCF)
  label: "books" | "ai",     // books: the tables are FinCom's computations (green); ai: amber
  words: RegExp,             // the question words that route to this tool's task (e.g. /audit the books|working papers/i)
  run: (input: Record<string, unknown>, ctx: ExtCtx) => Promise<ExtResult>,
  firmWide?: boolean,        // runs with no client open (the tool names its clients); the keyword router and Haiku leave its questions alone
};
