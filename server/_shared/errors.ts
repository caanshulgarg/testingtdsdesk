// What a caller is told when something fails inside a function (13-Nov-2026, security review L3). Plain module.
// A message FinCom wrote for people ("Only the firm's owner can ...", "No such client in your firm.") goes back as it
// is. A message that reads like the database's, the storage's or the network's own (table, column and constraint names,
// SQL states, addresses) does not: the caller gets one fixed sentence with a short number, and the function's log has
// the number with the message, so support can find it.
export const TRY_AGAIN = "FinCom could not finish this just now. Try again; if it happens again, give support this number: ";
const INTERNAL = new RegExp([
  "relation ", "column ", "constraint", "violates", "syntax error", "schema cache", "PGRST\\d", "duplicate key", "does not exist", "permission denied", "row-level security",
  "null value", "invalid input", "deadlock", "statement timeout", "canceling statement", "could not (connect|serialize|obtain)", "\\b(22|23|25|28|40|42|53|54|55|57|58|P0|XX)[0-9A-Z]{3}\\b",
  "function public\\.", "public\\.[a-z_]+", "\\bjsonb?\\b", "\\buuid\\b", "operator ", "storage", "bucket", "fetch failed", "error sending request", "ECONN", "ETIMEDOUT", "EAI_AGAIN", "socket",
  "TypeError", "ReferenceError", "RangeError", "undefined", "is not a function", "Cannot read", "Unexpected token", "https?://", "\\bat [\\w.$]+ \\(", "\\bHTTP \\d{3}\\b", "JWT", "supabase",
].join("|"), "i");
export const looksInternal = (msg: string) => !msg || msg.length > 300 || INTERNAL.test(msg);
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
// the words for the caller; an internal message is logged under a number and replaced
export function publicError(where: string, e: unknown, log: (line: string) => void = console.error): string {
  const msg = String((e as any)?.message ?? e ?? "").trim();
  if (!looksInternal(msg)) return msg;
  const id = newId();
  log(JSON.stringify({ evt: "hidden_error", id, where, code: (e as any)?.code ?? null, message: msg.slice(0, 500) }));
  return TRY_AGAIN + id;
}
