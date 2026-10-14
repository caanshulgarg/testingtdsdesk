// A turn that failed: what the user is told, and the codes Sentry gets (Sentry FINCOM-CLOUD-STAGING-1, 14-Oct-2026).
// Before this every failure that was not a 429, 401/403 or 5xx said "The assistant could not answer just now; try again"
// and reached Sentry as "turn failed other", with nothing to say what had failed. Now each kind has its own words, and the
// event carries the error's class, the HTTP status, the API's error type, the step of the turn, the model, the API's
// request id, and the book tool that failed before with the database's error code. Codes only: never the question, the
// client, a figure, or the API's own message (which can quote the request). Plain module: no Deno, no imports.
import type { TurnTrace } from "./agent.ts";

export type Failure = { kind: string, message: string, errorClass: string, tags: Record<string, string | undefined> };

const ERROR_CLASS = /^[A-Z][A-Za-z]{0,40}(Error|Exception)$/;
const ADMIN = " Ask the administrator (Account › Platform). Answers from FinCom's own book tools and the checks before filing keep working.";

export function classify(e: unknown, trace?: TurnTrace): Failure {
  const x = (e || {}) as any;
  const status = typeof x.status === "number" ? x.status : undefined;
  const ctor = x.constructor && typeof x.constructor.name === "string" ? x.constructor.name : "";
  const errorClass = ERROR_CLASS.test(ctor) ? ctor : (typeof x.name === "string" && ERROR_CLASS.test(x.name) ? x.name : "Error");
  // the API's error body: {type: "error", error: {type, message}} (the SDK keeps it as .error)
  const body = x.error && typeof x.error === "object" ? x.error : null;
  const apiType = String((body && body.error && body.error.type) || (body && body.type !== "error" && body.type) || "");
  const apiText = String((body && body.error && body.error.message) || x.message || "");
  const requestId = String(x.requestID || x.request_id || (x.headers && typeof x.headers.get === "function" && x.headers.get("request-id")) || "");
  const model = trace?.model || "";
  const isApi = status !== undefined || /^(API[A-Za-z]*Error|AnthropicError)$/.test(errorClass);
  let kind: string, message: string;
  if (x.source === "db") {
    // FinCom's own database (a cap, a log, a book tool's read): not the AI service
    kind = "database"; message = "FinCom could not read what it needed from its database (it has been reported to FinCom). Try again in a minute; if it keeps happening, tell FinCom support.";
    return { kind, message, errorClass, tags: { step: trace?.step || "turn", status: status !== undefined ? String(status) : undefined, model: undefined, tool: trace?.tool, db_code: (typeof x.code === "string" && /^([0-9A-Z]{5}|PGRST[0-9]{3})$/.test(x.code) ? x.code : undefined) || trace?.dbCode } };
  }
  if (status === 429) { kind = "rate_limit"; message = "Claude is busy; try again in a minute."; }
  else if (status === 401 || status === 403) { kind = "bad_key"; message = "The platform's Claude key was refused." + ADMIN; }
  else if (status !== undefined && /credit balance|billing|purchase credits/i.test(apiText)) { kind = "billing"; message = "AI answers are paused: the platform's Claude account is out of credit." + ADMIN; }
  else if (status === 404 || (status === 400 && apiType === "not_found_error")) {
    kind = "model_unavailable"; message = "The platform's Claude account cannot use the AI model FinCom asks for" + (model ? " (" + model + ")" : "") + "." + ADMIN;
  }
  else if (status === 413) { kind = "too_long"; message = "This question and its attachments are too large for the AI; ask about a shorter period or attach less."; }
  else if (status !== undefined && status >= 400 && status < 500) { kind = "ai_request"; message = "The AI service turned this request down (a fault on FinCom's side; it has been reported). Ask again in other words, or use FinCom's own reports for now."; }
  else if (status !== undefined && status >= 500) { kind = "overloaded"; message = "Claude is overloaded just now; try again in a few minutes."; }
  else if (/Timeout/.test(errorClass) || x.name === "AbortError" || x.name === "TimeoutError") { kind = "timeout"; message = "The AI took too long to answer; try again, or ask about a shorter period."; }
  else if (isApi) { kind = "network"; message = "FinCom could not reach the AI service; try again in a minute."; }
  else { kind = "internal"; message = "Something went wrong in FinCom while answering (it has been reported to FinCom). Try again; if it keeps happening, tell FinCom support."; }
  return {
    kind, message, errorClass,
    tags: {
      step: trace?.step || "turn",
      status: status !== undefined ? String(status) : undefined,
      api_error: apiType || undefined,
      model: model || undefined,
      request_id: requestId || undefined,
      tool: trace?.tool,
      db_code: trace?.dbCode,
    },
  };
}
