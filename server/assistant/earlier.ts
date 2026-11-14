// Files attached earlier in the same chat, read again for a later question (the owner, 14-Nov-2026: an earlier CMA and last
// year's balance sheet were attached; "pls prepare cma data on this basis", asked later with nothing attached, sent only
// the files' names and one-line summaries, so the AI never saw them). A question that refers back to them ("this", "on this
// basis", "same file", "the balance sheet I gave", "earlier CMA", in Hindi or Hinglish too), or that asks for work whose
// data is in such a file (a CMA, statements, a register), has the relevant files of the thread re-attached by their path:
// index.ts reads them from the bucket as it reads a new upload (with the user's own token; a sheet through filetable.ts).
// Which ones: the most recent first, then those whose kind or summary matches the question; a few at most, within the
// message's bytes and the model's budget (attachrules.js shares the tokens). The turn says which were used ("Using: …").
// Who: a file is read again only from the firm's own folder for the client open (<firm>/<client or _firm>/uploads/...),
// and only when its upload record (assistant_uploads, read as the user: row-level security keeps it to the firm) says
// this same user uploaded it. Another firm's, another client's or another member's file is never pulled.
export type EarlierFile = { path: string, name: string, type: string, kind: string, summary: string };
export type UploadRow = { path?: string, client_id?: string | null, created_by?: string | null, size?: number | string | null, kind?: string | null };
export type Picked = EarlierFile & { size: number };

// at most 4 files read again a question, 30 MB of them; never more than the message's own limits leave (index.ts)
export const EARLIER = { files: 4, bytes: 30 * 1024 * 1024 };

// a reference back to what was attached: English, Hinglish (Hindi in English letters) and Hindi
const NOT_FILE = "(?!\\s+(?:year|years|month|months|quarter|week|fy|f\\.y\\.|period|client|company|time|question|answer)\\b)";
const FILE_NOUN = "(?:file|files|sheet|sheets|excel|excels|xlsx|xls|csv|pdf|pdfs|attachment|attachments|document|documents|doc|docs|data|format|workings?|cma|balance\\s*sheets?|bs|statements?|accounts|upload|uploads)";
const BACK = [
  /\b(?:on|in|at|by|with)\s+(?:this|that|the\s+same|these|those|same)\s+basis\b/i,
  /\bbased\s+on\s+(?:this|that|it|these|those|them|the\s+(?:above|earlier|previous|same))\b/i,
  new RegExp("\\b(?:same|above|earlier|previous|prior|attached|uploaded|old|older|last|given|shared|sent|provided)\\s+" + FILE_NOUN + "\\b", "i"),
  new RegExp("\\b(?:this|that|these|those)\\s+" + FILE_NOUN + "\\b", "i"),
  new RegExp("\\bthe\\s+(?:file|files|sheet|excel|pdf|attachment|attachments|document|cma|balance\\s*sheet|bs|statements?)\\s+(?:i|we)\\b", "i"),
  /\b(?:i|we)\s+(?:have\s+|had\s+|just\s+)?(?:gave|given|sent|shared|attached|uploaded|provided)\b/i,
  new RegExp("\\b(?:from|using|use|with|per|as\\s+per|like|in|refer(?:\\s+to)?)\\s+(?:this|that|it|these|those|them|above)\\b" + NOT_FILE, "i"),
  /\b(?:earlier|previous|last)\s+one\b/i,
  /\b(?:compare|read|check|see|open|summari[sz]e|explain|review|go\s+through)\s+(?:these|those|them|both|it|the\s+two)\b/i,
  // Hinglish
  /\b(?:is|isi|iss|us|usi|uss)\s+(?:hisaab|hisab|ke|ki|ka|ko|se|me|mein|par|pe)\b/i,
  /\b(?:is|isi|iss|us|usi|uss)\s+(?:basis|base|file|sheet|excel|data|format|cma|balance\s*sheet)\s+(?:ke|ki|ka|ko|se|me|mein|par|pe|per|wali|wala|jaisa|jaisi)\b/i,
  /\b(?:iske|iska|iski|isme|ismein|isse|isko|uske|uska|uski|usme|usmein|usse|usko|wahi|wohi|vahi|vohi)\b/i,
  /\b(?:pehle|pahle|pehli|pichhl[aie]|pichl[aie]|purani|purana|purane|upar|uper|oopar)\s+(?:wali|wala|wale|di|diya|dia|bheji|bheja|file|sheet|excel|cma|balance|bs|data)\b/i,
  /\b(?:jo|jaise|jaisa)\s+(?:maine|mene|humne|hamne|maine\s+jo)\b/i,
  /\b(?:maine|mene|humne|hamne)\s+(?:\w+\s+){0,3}(?:di|diya|dia|bheji|bheja|upload|attach|share)\b/i,
  // Hindi
  /(?:इस|इसी|उस|उसी)\s*(?:के|की|का|में|से|को|पर|आधार|बेसिस|फ़ाइल|फाइल|शीट|डेटा)|इसके|इसका|इसकी|इसमें|इससे|उसके|उसका|उसकी|उसमें|उससे|वही|पहले\s*(?:वाली|वाला|दी|दिया|भेजी|भेजा)|पिछल|ऊपर\s*(?:वाली|वाला|दी|दिया)|जो\s*(?:मैंने|हमने)|(?:मैंने|हमने)\s*.{0,24}(?:दी|दिया|भेजी|भेजा)/,
];
// "these", "both", "all", "them": every relevant file, not only the latest
const PLURAL = /\b(?:these|those|them|both|all|files|sheets|attachments|documents|dono|sab|sabhi|saari|sari)\b|दोनों|सभी|सब/i;
export const refersBack = (q: string): boolean => BACK.some((r) => r.test(String(q || "")));

// the work a question asks for and the kinds of file its data is in (a CMA needs the earlier CMA and the balance sheet)
const TOPICS: { re: RegExp, kinds: string[], words: RegExp }[] = [
  { re: /\bcma\b|credit\s+monitoring|\bmpbf\b|permissible\s+bank\s+finance|working\s+capital\s+(?:assessment|limit)|\bprojected\s+balance\s+sheet|सीएमए/i, kinds: ["cma", "balance_sheet"],
    words: /\bcma\b|credit\s+monitoring|operating\s+statement|mpbf|balance\s*sheet|\bbs\b|financial\s+statements?|final\s+accounts|audited/i },
  { re: /\bprojections?\b|\bprojected\b|\bdscr\b|\bforecast/i, kinds: ["balance_sheet", "cma"], words: /\bcma\b|balance\s*sheet|\bbs\b|financial\s+statements?|projection/i },
  { re: /\bbalance\s*sheets?\b|\bbs\b|financial\s+statements?|final\s+accounts|audited|schedule\s*(?:iii|3)|बैलेंस\s*शीट/i, kinds: ["balance_sheet"],
    words: /balance\s*sheet|\bbs\b|financial\s+statements?|final\s+accounts|audited|schedule\s*(?:iii|3)/i },
  { re: /\bbank\s+statements?\b|\bstatement\s+of\s+account/i, kinds: ["bank"], words: /bank|statement\s+of\s+account/i },
  { re: /\bregisters?\b|\bgstr-?\s?(?:1|2b)\b/i, kinds: ["register"], words: /register|gstr/i },
  { re: /\b26\s*as\b|\bais\b|\btis\b|\btraces\b/i, kinds: ["as26"], words: /26\s*as|\bais\b|\btis\b|traces/i },
  { re: /\bcertificates?\b/i, kinds: ["certificate"], words: /certificate/i },
];
const STOP = new Set("the a an and or of for to in on at by with from this that these those it is are was be please pls plz kindly prepare make give me my our we i you data file files sheet same basis earlier previous last attached also as per do".split(" "));
const words = (s: string) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter((w) => w.length > 2 && !STOP.has(w)));

// what FinCom can read again from the bucket by itself: a PDF, a picture, a sheet, a text file (a Word file or a zip was
// read by the page when it was attached; it stays listed by its name and summary)
export const rereadable = (f: { name: string, type: string }) =>
  /\.(pdf|png|jpe?g|webp|gif|xlsx|xlsm|xls|csv|txt|json|xml)$/i.test(String(f.name || "")) || /pdf|^image\/|spreadsheet|ms-excel|text\/csv|^text\/plain|json/i.test(String(f.type || ""));

// a path the user may have read again: the firm's own folder for the client open, an upload (never a notice, a file the
// assistant made, another client's or another firm's); no climbing out of it
export function allowedPath(path: string, firm: string, clientId: string | null): boolean {
  const p = String(path || ""), seg = p.split("/");
  if (!firm || !p.startsWith(firm + "/") || p.includes("..") || p.includes("\\") || /[\0-\x1f]/.test(p) || seg.length !== 4 || seg[2] !== "uploads" || !seg[3]) return false;
  const folders = clientId ? [clientId, clientId.replace(/[^A-Za-z0-9_-]/g, "_")] : ["_firm"];
  return folders.includes(seg[1]);
}
// the upload's record: this firm's (row-level security), this client's, this user's
export function ownedBy(row: UploadRow | null | undefined, o: { path: string, user: string, clientId: string | null }): boolean {
  return !!row && row.path === o.path && !!o.user && row.created_by === o.user && (row.client_id ?? null) === (o.clientId ?? null);
}

// the thread's files to read again for this question, most relevant first; [] when the question does not need them
export function pickEarlier(question: string, files: Partial<EarlierFile>[], o: { firm: string, clientId: string | null, max?: number, exclude?: string[] }): EarlierFile[] {
  const q = String(question || ""), back = refersBack(q), hit = TOPICS.filter((t) => t.re.test(q));
  if (!back && !hit.length) return [];
  // the kind the work is about first (a CMA's: the earlier CMA), then the kinds its data comes from (the balance sheet)
  const lead = new Set(hit.map((t) => t.kinds[0])), kinds = new Set(hit.flatMap((t) => t.kinds)), qw = words(q), skip = new Set(o.exclude || []);
  const seen = new Set<string>();
  // newest last in the thread: walked newest first; a notice keeps its own flow (the notice reply), never read again here
  const list = (files || []).slice().reverse().map((f) => ({ path: String(f?.path || ""), name: String(f?.name || ""), type: String(f?.type || ""), kind: String(f?.kind || ""), summary: String(f?.summary || "") })).filter((f) => {
    if (!f.path || seen.has(f.path) || skip.has(f.path)) return false;
    seen.add(f.path);
    return f.kind !== "notice" && allowedPath(f.path, o.firm, o.clientId) && rereadable(f);
  });
  if (!list.length) return [];
  const about = (f: EarlierFile) => String(f.name || "") + " " + String(f.summary || "");
  const score = (f: EarlierFile) => {
    let s = 0;
    if (lead.has(f.kind)) s += 4; else if (kinds.has(f.kind)) s += 3;
    if (hit.some((t) => t.words.test(about(f)))) s += 2;
    const fw = words(about(f));
    let n = 0; for (const w of qw) if (fw.has(w)) n++;
    return s + Math.min(n, 3);
  };
  const scored = list.map((f, i) => ({ f, i, s: score(f) }));
  const matched = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i);
  const max = Math.max(0, Math.min(o.max ?? EARLIER.files, EARLIER.files));
  let out: EarlierFile[];
  if (!back) out = matched.map((x) => x.f);                                 // the work asked needs the file's data
  else if (matched.length) out = [scored[0].f, ...matched.map((x) => x.f)];  // the latest, then the ones it names
  else out = PLURAL.test(q) ? list : [list[0]];                             // "on this basis": the latest; "these": all
  return [...new Set(out)].slice(0, max);
}

// the picked files whose records say this user uploaded them, within the files and bytes the message has room for; the
// rest are left out (said in `left`), the newest kept first
export function withinBudget(picked: EarlierFile[], rows: (UploadRow | null)[], o: { user: string, clientId: string | null, files: number, bytes: number }):
  { take: Picked[], refused: string[], left: string[] } {
  const take: Picked[] = [], refused: string[] = [], left: string[] = [];
  let bytes = 0;
  const room = Math.max(0, Math.min(o.files, EARLIER.files)), cap = Math.max(0, Math.min(o.bytes, EARLIER.bytes));
  picked.forEach((f, i) => {
    const row = rows[i];
    if (!ownedBy(row, { path: f.path, user: o.user, clientId: o.clientId })) { refused.push(f.path); return; }
    const size = Math.max(0, Number(row!.size) || 0);
    if (take.length >= room || bytes + size > cap) { left.push(f.name); return; }
    bytes += size;
    take.push({ ...f, kind: row!.kind && row!.kind !== "other" ? String(row!.kind) : f.kind || "other", size });
  });
  return { take, refused, left };
}

// the model's note above the files, and the line the answer starts with
export const usingLine = (names: string[]) => "Using: " + names.join(", ");
export function earlierNote(names: string[]): string {
  return "[FinCom read again, for this question, " + (names.length === 1 ? "this file" : "these " + names.length + " files") + " attached earlier in this conversation: "
    + names.map((n, i) => (i + 1) + ". " + n).join("; ") + ". They are given below with the files of this message. Work from them, and never ask for them again. "
    + "Begin your answer with this one line, as it is: \"" + usingLine(names) + "\".]";
}
