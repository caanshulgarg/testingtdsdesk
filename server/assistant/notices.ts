// A notice, end to end (the owner's request of 13-Oct-2026, "will it prepare the reply and tell the attachments to
// provide"): for every notice the assistant reads, FinCom decides from the notice's type and its issues
//   - the documents the department will expect, each "ready from FinCom" (FinCom makes it now from the books), "you must
//     attach" (FinCom does not hold it) or "not applicable" (the books show the issue does not arise);
//   - the annexures: each "ready" document made from the book tools (never a figure from the AI), numbered Annexure 1...N;
//   - the reply pack: one ZIP with the DRAFT reply (Word and PDF), every annexure, the Citations annexure when case law is
//     cited, and an index of the annexures and of the documents the user must still add.
// The lists below are FinCom's own (the CBIC and CBDT practice as the firm knows it); the model may add documents it found
// in an official source during the answer (add_documents), each with its link.

import { zipSync, strToU8 } from "npm:fflate@0.8.2";
import { DocSpec, makeDocx, makePdf, makeXlsx, safeName, Section, TableData } from "./files.ts";
import { Checked } from "./citations.ts";

export type Issue = { type: string, point: string, amount: number | null, period: string | null };
export type Notice = {
  law: string, form: string, kind: string, summary: string, notice_no: string, din: string, notice_date: string | null, section: string, period: string,
  id_no: string, amount: number | null, reply_by: string | null, asked: string[], issues: Issue[], months: string[], fy: string | null, reference: string,
};
export type Item = { id: string, name: string, why: string, status: "ready" | "attach" | "na", annex?: number, note?: string, source?: string, done?: boolean };
export type Annexure = { n: number, id: string, title: string, why: string, tables: (TableData & { tool: string, params: Record<string, unknown>, summary?: Record<string, unknown> })[] };

export const KINDS: Record<string, string> = {
  gst_asmt10: "GST ASMT-10 (scrutiny of returns)", gst_drc01: "GST DRC-01 (show cause / demand)", gst_drc01a: "GST DRC-01A (intimation before show cause)",
  gst_reg17: "GST REG-17 (show cause for cancellation)", gst_reg31: "GST REG-31 (suspension of registration)",
  it_143_1a: "Income tax 143(1)(a) (adjustment proposed)", it_143_2: "Income tax 143(2) (scrutiny)", it_148: "Income tax 148 / 148A (income escaping assessment)",
  it_133_6: "Income tax 133(6) (information called for)", tds_default: "TDS default (TRACES) / justification report", it_penalty: "Income tax penalty 270A / 271", other: "Other notice",
};
export const ISSUES = ["itc_mismatch", "rcm", "turnover_mismatch", "tds_credit", "tds_default", "cash", "high_value", "registration", "income", "other"];

// the period helpers: "2026-02" -> 2026-02-01 .. 2026-02-28; "2025-26" -> 2025-04-01 .. 2026-03-31
const last = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function monthsSpan(months: string[]): { from: string, to: string } | null {
  const ms = months.filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
  if (!ms.length) return null;
  const [y2, m2] = ms[ms.length - 1].split("-").map(Number);
  return { from: ms[0] + "-01", to: ms[ms.length - 1] + "-" + String(last(y2, m2)).padStart(2, "0") };
}
export function fySpan(fy: string | null): { from: string, to: string } | null {
  const m = String(fy || "").match(/^(\d{4})-(\d{2})$/);
  return m ? { from: m[1] + "-04-01", to: (Number(m[1]) + 1) + "-03-31" } : null;
}
const addMonths = (d: string, n: number) => { const [y, m] = d.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const yy = t.getUTCFullYear(), mm = t.getUTCMonth() + 1; return yy + "-" + String(mm).padStart(2, "0") + "-" + String(last(yy, mm)).padStart(2, "0"); };

export function kindOf(n: Partial<Notice>): string {
  if (n.kind && KINDS[n.kind]) return n.kind;
  const f = String(n.form || "").toLowerCase().replace(/[\s_]/g, ""), s = String(n.section || "").toLowerCase();
  if (/asmt-?10/.test(f)) return "gst_asmt10";
  if (/drc-?01a/.test(f)) return "gst_drc01a";
  if (/drc-?0?1/.test(f)) return "gst_drc01";
  if (/reg-?17/.test(f)) return "gst_reg17";
  if (/reg-?31/.test(f)) return "gst_reg31";
  if (/143\(1\)/.test(f + s)) return "it_143_1a";
  if (/143\(2\)/.test(f + s)) return "it_143_2";
  if (/148/.test(f + s)) return "it_148";
  if (/133\(6\)/.test(f + s)) return "it_133_6";
  if (/justification|traces|tds default|201|200a/.test(f + s)) return "tds_default";
  if (/270a|271/.test(f + s)) return "it_penalty";
  return "other";
}

// a ready document: which book tools make it, for the notice's period
type Exec = (tool: string, input: Record<string, unknown>) => Promise<any>;
type Maker = { id: string, title: string, why: string, make: (n: Notice, x: Exec, span: { from: string, to: string }) => Promise<{ tool: string, input: Record<string, unknown> }[]> };
const MAKERS: Record<string, Maker> = {
  itc_recon: { id: "itc_recon", title: "Input tax reconciliation: books, GSTR-2B and GSTR-3B", why: "answers the difference in input tax credit month by month",
    make: async (_n, _x, sp) => [{ tool: "itc_3way", input: { from: sp.from, to: sp.to, gstin: null } }, { tool: "itc_vs_2b", input: { from: sp.from, to: sp.to, gstin: null } }] },
  rcm_details: { id: "rcm_details", title: "Reverse-charge supplies and tax", why: "shows the credit of tax paid under reverse charge, which GSTR-2B never shows",
    make: async (_n, _x, sp) => [{ tool: "rcm", input: { from: sp.from, to: sp.to } }] },
  purchase_register: { id: "purchase_register", title: "Party-wise purchase register", why: "every bill behind the credit taken, supplier by supplier",
    make: async (_n, _x, sp) => [{ tool: "purchase_register", input: { from: sp.from, to: sp.to, party: null } }] },
  ledger_extracts: { id: "ledger_extracts", title: "Ledger extracts of the parties in question", why: "the parties' accounts in the books for the period",
    make: async (_n, x, sp) => {
      const parties = new Set<string>();
      const r2 = await x("itc_vs_2b", { from: sp.from, to: sp.to, gstin: null });
      for (const r of (r2 && r2.rows) || []) if (Math.abs(Number(r.diff) || 0) >= 1 && r.party) parties.add(String(r.party));
      const rc = await x("rcm", { from: sp.from, to: sp.to });
      for (const r of (rc && rc.rows) || []) if (r.party) parties.add(String(r.party));
      return Array.from(parties).sort().slice(0, 8).map((p) => ({ tool: "ledger_entries", input: { ledger: p, from: sp.from, to: sp.to, limit: null } }));
    } },
  payment_proofs: { id: "payment_proofs", title: "Payments to the suppliers in question (with UTR or cheque where recorded)", why: "proof that the suppliers were paid (rule 37: within 180 days)",
    make: async (_n, x, sp) => {
      const rc = await x("rcm", { from: sp.from, to: sp.to });
      const pr = await x("purchase_register", { from: sp.from, to: sp.to, party: null });
      const parties = new Set<string>([...((rc && rc.rows) || []).map((r: any) => r.party), ...((pr && pr.rows) || []).map((r: any) => r.party)].filter(Boolean));
      const to = addMonths(sp.to, 6);
      return Array.from(parties).sort().slice(0, 8).map((p) => ({ tool: "payments_list", input: { from: sp.from, to, party: p } }));
    } },
  turnover_recon: { id: "turnover_recon", title: "Turnover reconciliation: books, GSTR-1 and GSTR-3B", why: "answers the difference in outward supplies month by month",
    make: async (_n, _x, sp) => [{ tool: "turnover_3way", input: { from: sp.from, to: sp.to, gstin: null } }, { tool: "sales_by_month", input: { from: sp.from, to: sp.to } }] },
  tds_26as: { id: "tds_26as", title: "Form 26AS against the books", why: "the TDS credit deductor by deductor: 26AS and the books",
    make: async (n) => [{ tool: "tds_vs_26as", input: { fy: n.fy } }] },
  tds_receivable: { id: "tds_receivable", title: "Ledger extract: TDS receivable", why: "every TDS credit entered in the books for the year",
    make: async (n, x, sp) => {
      const r = await x("find_ledgers", { text: "TDS Receivable", group: null, as_on: sp.to });
      const names = ((r && r.rows) || []).map((z: any) => String(z.ledger || "")).filter((z: string) => /tds/i.test(z) && /receiv/i.test(z)).slice(0, 4);
      return names.map((l: string) => ({ tool: "ledger_entries", input: { ledger: l, from: sp.from, to: sp.to, limit: null } }));
    } },
  tds_details: { id: "tds_details", title: "TDS deductee-wise details, with when each deduction was paid", why: "every deduction, its deductee and section, and the payment against it",
    make: async (_n, _x, sp) => [{ tool: "tds_deductees", input: { from: sp.from, to: sp.to, section: null } }, { tool: "tds_late", input: { from: sp.from, to: sp.to } }] },
  profit_loss: { id: "profit_loss", title: "Profit and loss from the books", why: "the year's results as in the books",
    make: async (_n, _x, sp) => [{ tool: "profit_and_loss", input: { from: sp.from, to: sp.to } }] },
  cash_transactions: { id: "cash_transactions", title: "Cash transactions: 40A(3) and 269ST", why: "cash paid or received over the limits",
    make: async (_n, _x, sp) => [{ tool: "cash_payments_40a3", input: { from: sp.from, to: sp.to } }, { tool: "cash_receipts_269st", input: { from: sp.from, to: sp.to } }] },
  bank_payments: { id: "bank_payments", title: "Payments through the bank in the period", why: "the source and trail of the transactions in question",
    make: async (_n, _x, sp) => [{ tool: "payments_list", input: { from: sp.from, to: sp.to, party: null } }] },
  sales_months: { id: "sales_months", title: "Sales month by month from the books", why: "the business is carried on: supplies in the recent months",
    make: async (_n, _x, sp) => [{ tool: "sales_by_month", input: { from: sp.from, to: sp.to } }] },
};

// what the user must attach (FinCom does not hold it)
const A = (id: string, name: string, why: string, note?: string): Item => ({ id, name, why, status: "attach", ...(note ? { note } : {}) });
const R = (maker: string): Item => ({ id: maker, name: MAKERS[maker].title, why: MAKERS[maker].why, status: "ready" });

// the checklist for a notice: by its kind, then by its issues
export function checklistFor(n: Notice): Item[] {
  const k = kindOf(n), types = new Set((n.issues || []).map((i) => i.type));
  const out: Item[] = [];
  const add = (...xs: Item[]) => { for (const x of xs) if (!out.some((y) => y.id === x.id)) out.push(x); };
  if (k.startsWith("gst_")) {
    if (types.has("itc_mismatch") || (k === "gst_asmt10" && !types.size) || types.has("rcm")) {
      add(R("itc_recon"), R("rcm_details"), R("purchase_register"), R("ledger_extracts"), R("payment_proofs"),
        A("invoices", "Purchase invoices of the suppliers in question", "the tax invoices behind the credit (section 16(2)(a))"),
        A("gstr3b_copy", "GSTR-3B as filed for the months", "the return the notice questions"),
        A("gstr2b_copy", "GSTR-2B for the months (from the portal)", "the department's own statement of credit"),
        A("credit_ledger", "Electronic credit and cash ledgers for the months", "the credit taken and the reverse-charge tax paid in cash"),
        A("rcm_proof", "Agreements or receipts for the reverse-charge services (rent agreement, lorry receipts)", "that the services were received and tax paid under reverse charge (sections 9(3) and 9(4))"),
        A("eway", "E-way bills for goods moved (where goods over Rs 50,000 were moved)", "movement of the goods on which credit was taken"));
    }
    if (types.has("turnover_mismatch")) add(R("turnover_recon"), A("gstr1_copy", "GSTR-1 as filed for the months", "the outward supplies reported"), A("credit_notes", "Credit notes and amendments of the period", "reductions of turnover"), A("einvoice", "E-invoice (IRN) list for the months", "the invoices reported on the IRP"));
    if (k === "gst_drc01" || k === "gst_drc01a") add(A("drc03", "DRC-03 challan, if any amount was paid", "payment made before or after the notice"), A("scn_order", "The order or intimation being answered", "the department's document"));
    if (k === "gst_reg17" || k === "gst_reg31" || types.has("registration")) add(R("sales_months"), A("returns_filed", "Status of returns filed (from the portal)", "returns are filed and up to date"),
      A("premises", "Proof of the place of business (rent agreement or ownership, electricity bill, photographs)", "the business exists at the registered place"), A("reg_cert", "GST registration certificate (REG-06)", "the registration in question"));
  } else if (k === "it_143_1a" || types.has("tds_credit")) {
    add(R("tds_26as"), R("tds_receivable"), A("form16a", "Form 16A from each deductor in question", "the deductor's certificate of the tax deducted"),
      A("itr", "ITR acknowledgement and the computation of income", "the return and the credit claimed in it"),
      A("ais", "AIS and TIS for the year (from the portal)", "the department's own statement"),
      A("confirmations", "Ledger confirmations from the deductors in question", "the deductor's account of the payments and the TDS"));
  } else if (k === "tds_default" || types.has("tds_default")) {
    add(R("tds_details"), A("challans", "Challan counterfoils (CSI) of the TDS paid", "payment of the tax deducted"), A("return_ack", "Acknowledgement of the TDS return (26Q / 24Q / 27Q)", "the return the default is in"),
      A("pan_cert", "PANs and any lower-deduction certificates (section 197)", "the rate applied"));
  } else if (k === "it_143_2") {
    add(R("profit_loss"), R("cash_transactions"), A("audit_report", "Tax audit report (3CA/3CB and 3CD), if audited", "the audited figures"), A("bank_statements", "Bank statements for the year", "the transactions"),
      A("itr", "ITR acknowledgement and the computation of income", "the return under scrutiny"), A("confirmations", "Confirmations from the parties in question", "the transactions with them"));
  } else if (k === "it_148" || k === "it_133_6") {
    add(R("bank_payments"), R("cash_transactions"), A("itr", "ITR acknowledgement and the computation of income", "the return for the year"), A("bank_statements", "Bank statements for the period", "the source of the transactions"),
      A("source_docs", "Documents of the transaction in question (agreements, invoices, deeds)", "the nature and source of the transaction"));
  } else if (k === "it_penalty") {
    add(A("order", "The assessment order the penalty arises from", "the addition the penalty is on"), A("bona_fide", "Evidence that the claim was made in good faith", "no under-reporting or misreporting"));
  }
  if (!out.length) add(A("notice_docs", "The documents the notice asks for", "as listed in the notice"));
  return out;
}

// the ready documents made from the book tools, numbered; a document whose tools find nothing becomes "not applicable"
export async function makeAnnexures(n: Notice, items: Item[], exec: Exec, today: string): Promise<{ items: Item[], annexures: Annexure[] }> {
  const months = monthsSpan(n.months || []), fy = fySpan(n.fy);
  const span = months || fy || { from: today.slice(0, 4) + "-04-01", to: today };
  const out: Item[] = [], annexures: Annexure[] = [];
  for (const it of items) {
    if (it.status !== "ready") { out.push(it); continue; }
    const mk = MAKERS[it.id];
    const calls = await mk.make(n, exec, mk.id.startsWith("tds_") && fy ? fy : span);
    const tables: Annexure["tables"] = [];
    for (const c of calls) {
      const r = await exec(c.tool, c.input);
      if (!r || r.none || !Array.isArray(r.rows)) continue;
      tables.push({ tool: c.tool, params: c.input, title: r.title || c.tool, columns: (r.columns || []).filter((col: any) => col.k !== "guid"), rows: r.rows, basis: r.basis, summary: r.summary });
    }
    const hasRows = tables.some((t) => t.rows.length > 0);
    if (!hasRows) { out.push({ ...it, status: "na", note: "the books show nothing of this for the period" }); continue; }
    const a: Annexure = { n: annexures.length + 1, id: it.id, title: it.name, why: it.why, tables };
    annexures.push(a);
    out.push({ ...it, annex: a.n });
  }
  return { items: out, annexures };
}

// the reply's reference block (from the notice as read)
export function referenceLines(n: Notice): string[] {
  const L: [string, string | null | undefined][] = [["Notice no.", n.notice_no || n.reference], ["DIN / reference no.", n.din || n.reference], ["Notice date", n.notice_date], ["Section", n.section],
    ["Period (AY / FY / tax period)", n.period || (n.months || []).join(", ") || n.fy], [/^\d{2}[A-Z]{5}/.test(n.id_no || "") ? "GSTIN" : "PAN / GSTIN", n.id_no]];
  return L.filter(([, v]) => v).map(([k, v]) => k + ": " + v);
}

// the annexure numbers a reply cites must be the annexures there are, and every annexure must be cited
export function annexureCheck(body: string, annexures: Annexure[]): { ok: boolean, cited: number[], unknown: number[], uncited: number[] } {
  const cited = Array.from(new Set(Array.from(String(body || "").matchAll(/\bAnnexure[- ]?(\d{1,2})\b/gi), (m) => Number(m[1])))).sort((a, b) => a - b);
  const have = annexures.map((a) => a.n);
  const unknown = cited.filter((x) => !have.includes(x)), uncited = have.filter((x) => !cited.includes(x));
  return { ok: !unknown.length && !uncited.length, cited, unknown, uncited };
}

// the reply pack: reply (Word and PDF), the annexures (Excel), the citations, and the index
export async function replyPack(o: { notice: Notice, items: Item[], annexures: Annexure[], citations: Checked[], reply: { title: string, body: string },
  client: string, firm: { name: string, lines: string[] }, asOf: string, fetch?: typeof fetch, noFont?: boolean }): Promise<{ zip: Uint8Array, files: string[] }> {
  const files: Record<string, Uint8Array> = {};
  const base = (title: string, sections: Section[], format: DocSpec["format"], aiText: boolean, draft: boolean): DocSpec =>
    ({ format, title, client: o.client, firm: o.firm, sections, asOf: o.asOf, aiText, draft });
  const ok = o.citations.filter((c) => c.ok);
  const replySections: Section[] = [{ heading: "Reference", text: referenceLines(o.notice).join("\n") }, { heading: null, text: o.reply.body }];
  if (o.annexures.length) replySections.push({ heading: "Annexures", text: o.annexures.map((a) => "Annexure " + a.n + ": " + a.title).join("\n") + (ok.length ? "\nAnnexure " + (o.annexures.length + 1) + ": Citations (case law and circulars relied on)" : "") });
  files["01-Reply-DRAFT.docx"] = await makeDocx(base(o.reply.title, replySections, "docx", true, true));
  files["01-Reply-DRAFT.pdf"] = await makePdf(base(o.reply.title, replySections, "pdf", true, true), { fetch: o.fetch, noFont: o.noFont });
  for (const a of o.annexures) {
    const secs: Section[] = a.tables.map((t) => ({ heading: "Annexure " + a.n + " - " + (t.title || a.title), table: { title: t.title, columns: t.columns, rows: t.rows, basis: t.basis } }));
    files["Annexure-" + a.n + "-" + safeName(a.title).slice(0, 50).replace(/[-.]+$/, "") + ".xlsx"] = await makeXlsx(base("Annexure " + a.n + ": " + a.title, secs, "xlsx", false, false));
  }
  if (ok.length) {
    const t: TableData = { title: "Citations", columns: [{ k: "n", label: "No.", t: "int" }, { k: "case_name", label: "Case" }, { k: "court", label: "Court or tribunal" }, { k: "date", label: "Date" },
      { k: "citation", label: "Citation / appeal no." }, { k: "url", label: "Link" }, { k: "quote", label: "Line relied on" }, { k: "point", label: "Point" }, { k: "flags", label: "Flags" }, { k: "label", label: "Note" }],
      rows: ok.map((c, i) => ({ ...c, n: i + 1, flags: c.flags.join("; "), label: "Verify before filing" })), basis: "each case found and read on a free public source during the answer; the name and the line were checked on the page" };
    files["Annexure-" + (o.annexures.length + 1) + "-Citations.xlsx"] = await makeXlsx(base("Annexure " + (o.annexures.length + 1) + ": Citations - verify before filing", [{ heading: "Citations", table: t }], "xlsx", false, false));
  }
  const idx: Section[] = [
    { heading: "Annexures in this pack", table: { title: "Annexures", columns: [{ k: "n", label: "Annexure", t: "int" }, { k: "title", label: "What it is" }, { k: "file", label: "File" }, { k: "why", label: "Why it is attached" }],
      rows: [...o.annexures.map((a) => ({ n: a.n, title: a.title, why: a.why, file: Object.keys(files).find((f) => f.startsWith("Annexure-" + a.n + "-")) || "" })),
        ...(ok.length ? [{ n: o.annexures.length + 1, title: "Citations", why: "case law and circulars relied on (verify before filing)", file: "Annexure-" + (o.annexures.length + 1) + "-Citations.xlsx" }] : [])] } },
    { heading: "Documents you must still add", table: { title: "To add", columns: [{ k: "name", label: "Document" }, { k: "why", label: "Why" }, { k: "note", label: "Note" }, { k: "source", label: "Source" }],
      rows: o.items.filter((i) => i.status === "attach").map((i) => ({ name: i.name, why: i.why, note: i.note || "", source: i.source || "" })) } },
    { heading: "Not applicable", table: { title: "Not applicable", columns: [{ k: "name", label: "Document" }, { k: "note", label: "Why not" }], rows: o.items.filter((i) => i.status === "na").map((i) => ({ name: i.name, note: i.note || "" })) } },
  ];
  files["00-Index.xlsx"] = await makeXlsx(base("Reply pack: " + (KINDS[kindOf(o.notice)] || o.notice.form), idx, "xlsx", false, false));
  files["README.txt"] = strToU8("Reply pack made by FinCom on " + o.asOf + ".\r\nThe reply is a DRAFT for the CA to review. FinCom files nothing: file the reply on the portal yourself.\r\n" +
    "Annexure figures are from FinCom's books; the documents listed in 00-Index.xlsx under 'Documents you must still add' are not in this pack.\r\n");
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 6 }]])) as any);
  return { zip, files: Object.keys(files).sort() };
}
