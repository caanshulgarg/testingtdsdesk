// What a function's log may say of a firm's data (13-Nov-2026, security review L6). Plain module, no imports.
// Company, ledger and party names, notes people typed and the heads of a GST service's answers are not written to the
// log: a name is logged as a short mark worked out from it (the same name gives the same mark, so lines about one
// company can still be followed), a list as its count, an answer as its error codes.
export function nm(v: unknown): string {
  const s = String(v ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return "name#" + h.toString(16).padStart(8, "0");
}
// the error codes in a service's answer (JSON or not), and nothing else of it
export function errorCodes(text: unknown): string[] {
  const out: string[] = [];
  const re = /"(error_cd|errorCode|ErrorCode|error_code|errorCodes|status_cd|Status|status|code|ErrorCodes)"\s*:\s*"?([A-Za-z0-9_.:-]{1,40})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text ?? ""))) && out.length < 8) out.push(m[1] + "=" + m[2]);
  return out;
}
