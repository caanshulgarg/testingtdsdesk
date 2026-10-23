// Every way a gateway call can fail, as one `kind` the app can say in plain words (review of 02-Oct-2026: a bill
// that was not read only said "The Claude API refused the request"). Pure functions, no Deno, no imports, and only
// syntax that Node's type stripping accepts, so tests/run_gateway_errors.js loads this very file.

export const KINDS = ["no_credit", "rate_limit", "overloaded", "too_large", "pdf_password", "unsupported_type", "timed_out",
  "declined", "bad_key", "bad_model", "not_reached", "other"];

// from the provider's answer: HTTP status, its error.type and error.message
export function classify(status: number, type?: string, message?: string): string {
  const st = Number(status) || 0, t = String(type || ""), m = String(message || "").toLowerCase();
  if (st === 402 || t === "billing_error" || (st === 400 && /credit balance/.test(m))) return "no_credit";
  if (st === 429 || t === "rate_limit_error") return "rate_limit";
  if (st === 529 || st === 503 || t === "overloaded_error") return "overloaded";
  if (st === 413 || t === "request_too_large" || /too large|too long|exceeds|\bsize\b/.test(m)) return "too_large";
  if (/password|encrypted/.test(m)) return "pdf_password";
  if (/media[ _-]?type|unsupported|not supported|unreadable|could not (process|read|be (processed|read))|invalid (image|document|pdf)/.test(m)) return "unsupported_type";
  if (st === 401 || st === 403 || t === "authentication_error" || t === "permission_error") return "bad_key";
  if (st === 404 || t === "not_found_error") return "bad_model";
  return "other";
}

// a 200 answer the model declined to give (stop_reason "refusal"): a failure, with its category when there is one
export function declined(data: any): { kind: string, category: string } | null {
  if (!data || data.stop_reason !== "refusal") return null;
  const d = data.stop_details || {};
  return { kind: "declined", category: String(d.category || d.type || "") };
}

// the gateway's own error text for each kind (the app has its own words; this is what the server log and an older
// app show). model: the model name that was sent; limit: the size limit in MB
export function errorText(kind: string, o?: { model?: string, category?: string, limitMb?: number, detail?: string }): string {
  const x = o || {};
  const said = x.detail ? " The reading service said: " + String(x.detail).slice(0, 300) : "";
  switch (kind) {
    case "no_credit": return "Out of credit on the reading service. Ask the administrator to add credit.";
    case "rate_limit": return "Too many bills at once for the reading service." + said;
    case "overloaded": return "The reading service is busy." + said;
    case "too_large": return "The file is too large for the reading service" + (x.limitMb ? " (the limit is " + x.limitMb + " MB)" : "") + "." + said;
    case "pdf_password": return "The PDF is password-protected." + said;
    case "unsupported_type": return "The reading service cannot open this type of file." + said;
    case "timed_out": return "The reading service did not answer in time.";
    case "declined": return "The model declined to read this file" + (x.category ? " (" + x.category + ")" : "") + ".";
    case "bad_key": return "The reading service's key is not working. Ask the administrator." + said;
    case "bad_model": return "The model name “" + (x.model || "") + "” was not accepted by the reading service." + said;
    case "not_reached": return "The reading service could not be reached.";
    default: return "The reading service refused the request." + said;
  }
}

// the HTTP status the gateway answers with: the provider's, except a provider 401/403 (the app would take it as its
// own sign-in running out and sign in again)
export function replyStatus(kind: string, upstream: number): number {
  if (kind === "timed_out") return 504;
  if (kind === "declined") return 422;
  if (kind === "not_reached" || kind === "bad_key") return 502;
  const st = Number(upstream) || 0;
  return st >= 400 && st < 600 && st !== 401 && st !== 403 ? st : 502;
}
