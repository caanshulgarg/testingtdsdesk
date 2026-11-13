// Ask FinCom's attachments (the owner's request of 13-Nov-2026: 30 files a message, any type). Plain JavaScript with no
// imports and no DOM, used as it is by:
//   - the panel's Upload (app/src/parts/asst-upload.js): what may be attached, how it is stored, what the AI will be
//     given of each file and about what it costs, said BEFORE the question is sent;
//   - fincom-assistant (server/assistant/index.ts, under Deno): the same rules, enforced on what it actually read;
//   - the prices of the models (server/assistant/models.ts takes PRICES from here, so the estimate is the bill's own).
// What the AI reads natively: PDFs and pictures (PNG, JPEG, WebP, GIF). Everything else goes as the text FinCom took out
// of it (a sheet as a table, a Word file's words, a zip's list and the files inside it), or by its name, type and size.

export const ATTACH = {
  files: 30,                         // files a message
  fileBytes: 20 * 1024 * 1024,       // one file
  totalBytes: 100 * 1024 * 1024,     // all the files of a message together
  nativeBytes: 18 * 1024 * 1024,     // PDFs and pictures sent as they are, together (the API takes 32 MB a request, as base64)
  imageBytes: 5 * 1024 * 1024,       // one picture sent as it is (the API's limit)
  nativePages: 100,                  // PDF pages sent as they are, together (the API's limit a request)
  tokens: 100000,                    // what the files may take of the model's context, together (the rest: the prompt, tools, the answer)
  textChars: 200000,                 // the text of one file kept before the budget shares it out
  upAtOnce: 4,                       // uploads at the same time
  costWarnInr: 5,                    // "about ₹X of AI credit" is said from this much
};
export const PAGE_TOKENS = 2000, IMAGE_TOKENS = 1600, NAME_TOKENS = 60;
export const tokensOf = (chars) => Math.ceil((Number(chars) || 0) / 3.5);
export const charsOf = (tokens) => Math.floor((Number(tokens) || 0) * 3.5);

// US dollars per million tokens (platform.claude.com pricing as of Oct 2026): input, output, cache read
export const PRICES = {
  "claude-haiku-5-5": { in: 0.10, out: 0.50, read: 0.01 },
  "claude-sonnet-5-5": { in: 2, out: 10, read: 0.20 },
  "claude-opus-5-5": { in: 4, out: 20, read: 0.20 },
};
// the rupees a dollar, as assistant_caps holds it for a firm that set none (migration 77/96: inr_per_usd default 85)
export const INR_PER_USD = 85;
// what reading the files once costs, about: their tokens in, and an answer's ~2,000 tokens out. Files asked about go to
// Sonnet; a notice to Opus (models.ts taskOf)
export function attachInr(tokens, notice, rate = INR_PER_USD) {
  const p = PRICES[notice ? "claude-opus-5-5" : "claude-sonnet-5-5"];
  return ((Number(tokens) || 0) * p.in + 2000 * p.out) / 1e6 * rate;
}

// what a file is, by its first bytes (the name and the browser's type only when the bytes do not say)
export function sniff(head, name, type) {
  const b = head || [], n = String(name || "").toLowerCase(), t = String(type || "").toLowerCase();
  const at = (i, ...xs) => xs.every((x, k) => b[i + k] === x);
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0x50, 0x4b, 0x03, 0x04) || at(0, 0x50, 0x4b, 0x05, 0x06)) return /\.xlsx?m?$/.test(n) || /spreadsheetml/.test(t) ? "xlsx" : /\.docx$/.test(n) || /wordprocessingml/.test(t) ? "docx" : "application/zip";
  return "";
}
export const NATIVE = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/;

// the type a file is stored with in the private bucket: the ones that can never be shown as a page (a PDF, a picture
// that is not SVG, a sheet, a Word file, plain text, CSV, JSON, a zip); anything else as application/octet-stream, so
// nothing uploaded is ever served back as HTML, SVG or XML (which a browser would run)
const SAFE_TYPES = /^(application\/pdf|image\/(png|jpeg|webp|gif|heic|heif|bmp|tiff)|text\/(plain|csv)|application\/json|application\/zip|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document))$/;
export function storeType(name, type) {
  const t = String(type || "").toLowerCase().split(";")[0].trim();
  return SAFE_TYPES.test(t) ? t : "application/octet-stream";
}

// What the AI is given of each file of a message, within the limits above. items, in the message's order:
//   {name, size, native: "pdf" | "image" | "", pages, chars (the text FinCom has of it), read (false: nothing could be read)}
// Back, for each: {mode: "native" | "text" | "name", chars (the text given), cut (shortened), why (said to the user, or "")};
// and the tokens of all of them. PDFs and pictures go as they are while they fit (pages, bytes, half the budget); a
// PDF that does not goes as its text. The texts share the rest fairly: a short file whole, the long ones cut alike.
export function fitAttachments(items, o = ATTACH) {
  const out = items.map(() => ({ mode: "name", chars: 0, cut: false, why: "", tokens: NAME_TOKENS }));
  let bytes = 0, pages = 0, tokens = 0;
  items.forEach((it, i) => {
    if (it.read === false || it.why) { out[i].why = it.why || "FinCom could not read this file: the AI gets its name and size only."; return; }
    if (!it.native) return;
    const size = Number(it.size) || 0, pg = it.native === "pdf" ? Math.max(1, Number(it.pages) || 0) : 0, tk = it.native === "pdf" ? pg * PAGE_TOKENS : IMAGE_TOKENS;
    const why = it.native === "image" && size > o.imageBytes ? "a picture over 5 MB cannot be shown to the AI"
      : it.native === "pdf" && !(Number(it.pages) > 0) ? "the PDF could not be opened as it is (locked or damaged)"
      : pages + pg > o.nativePages ? "the message's PDFs are over " + o.nativePages + " pages together"
      : bytes + size > o.nativeBytes ? "the PDFs and pictures are over " + Math.round(o.nativeBytes / 1048576) + " MB together"
      : tokens + tk > o.tokens / 2 ? "the files are too long to show the AI as they are" : "";
    if (!why) { out[i] = { mode: "native", chars: 0, cut: false, why: "", tokens: tk }; bytes += size; pages += pg; tokens += tk; return; }
    out[i].why = (Number(it.chars) > 0 ? "Read as its text: " : "Not read: ") + why + ".";
  });
  // the texts: the files with text that are not sent as they are, shortest first, each up to an equal share of what is left
  const texts = items.map((it, i) => i).filter((i) => out[i].mode !== "native" && items[i].read !== false && !items[i].why && Number(items[i].chars) > 0);
  let left = Math.max(0, o.tokens - tokens - (items.length - texts.length) * NAME_TOKENS);
  texts.sort((x, y) => items[x].chars - items[y].chars);
  texts.forEach((i, k) => {
    const share = Math.floor(left / (texts.length - k)), want = tokensOf(items[i].chars), give = Math.min(want, share);
    const chars = give === want ? Number(items[i].chars) : charsOf(give);
    left -= give;
    const cut = chars < Number(items[i].chars);
    out[i] = { mode: "text", chars, cut, tokens: give,
      why: (out[i].why || "") + (cut ? (out[i].why ? " " : "") + "Shortened to fit: the AI reads about the first " + Math.max(1, Math.round(chars * 100 / Number(items[i].chars))) + "% of it." : "") };
  });
  return { plan: out, tokens: out.reduce((a, p) => a + p.tokens, 0) };
}

// the zip's limits (the security review): what is opened inside a zip, and how far
export const ZIP = {
  entries: 500,                      // entries listed
  open: 30,                          // files read inside it
  entryBytes: 10 * 1024 * 1024,      // one file inside, unpacked
  totalBytes: 50 * 1024 * 1024,      // all the files inside, unpacked
  ratio: 100,                        // unpacked / packed above this: not opened (a zip bomb)
  depth: 2,                          // a zip in a zip is opened; one more level is listed only
};
