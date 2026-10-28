// FinCom Console (console-admin function): the shared types. Plain module, no imports: the Deno tests load it with fakes.
//
// A MODULE is one file in server/console/modules/<name>.ts that exports `module: Module` and is listed once in
// server/console/registry.ts. Each of its actions says who may call it (roles), whether it reads or writes, whether a
// reason is required, and what it touches (target). The router (core/router.ts) does everything else, in this order,
// for every call: origin, sign-in (Supabase token), two-step (aal2), rate limit, active console admin, the action's
// role, the reason, the audit row, then run(). An action never checks roles itself; it may refuse with ConsoleError.

export type Role = "owner" | "billing" | "support" | "viewer";
export const ROLES: Role[] = ["owner", "billing", "support", "viewer"];
export const ALL: Role[] = ROLES;

// origin: the console site the call came from (one of Deps.origins): where an invite's email link brings the person back
export type Caller = { id: string; email: string; role: Role; ip: string; ua: string; origin: string };

// the services an action may use (index.ts wires the real ones with the service role; tests pass fakes)
export interface Deps {
  getUser(jwt: string): Promise<{ id: string; email: string } | null>;       // Supabase Auth checks the token
  adminRow(userId: string): Promise<{ role: string; active: boolean } | null>;
  rpc(fn: string, args: Record<string, unknown>): Promise<any>;            // a database function (service role); throws Error(message)
  mfaFactors(userId: string): Promise<{ id: string; factor_type: string; status: string }[]>;
  mfaDelete(userId: string, factorId: string): Promise<void>;
  authBan(userId: string, banned: boolean): Promise<void>;                 // Supabase Auth: ban (sign-in refused) or lift it
  rateHit(bucket: string, key: string, max: number, windowS: number): Promise<boolean>;   // migration 112's auth_rate_hit
  origins: string[];                                                        // the sites allowed to call
  log(msg: string, err?: unknown): void;
  // outbound calls (a key's Test, the Sentry summary, a support reply's email): index.ts gives fetch with a time limit
  http?(url: string, init?: RequestInit): Promise<Response>;
  // Supabase Auth's admin invite (POST /auth/v1/invite, service role): a new login with no password and an email whose
  // link brings the person to redirectTo to choose one. Throws an Error with status and code (GoTrue's error_code).
  // It makes no member row: the person is in no firm (admins.add).
  authInvite?(email: string, redirectTo: string, data: Record<string, unknown>): Promise<{ id: string }>;
  // this function's own secrets, read only for the names modules/keys.ts lists (never SUPABASE_SERVICE_ROLE_KEY)
  env?(name: string): string | undefined;
}

export type Target = { type: string; id: string } | null;

export interface Ctx {
  caller: Caller;
  deps: Deps;
  allowed: string[];                        // the action names this caller's role may use (for "me")
  // writes one console_audit row; throws when it cannot be written (the router then refuses the call)
  audit(action: string, target: Target, before: unknown, after: unknown, reason?: string | null): Promise<void>;
}

export type ActionDef = {
  roles: Role[];                            // who may call it. Checked by the router, never by the action
  kind: "read" | "write";
  reason?: boolean;                         // a reason (5 to 1000 characters) is required
  // "router" (default): the router writes the audit row (action name, target, params summary) BEFORE run(); if it
  // cannot, run() never happens. "self": the action's own database function writes the change and its audit row in
  // one transaction (admins.*); use it for every change that a SQL function can make.
  audit?: "router" | "self";
  target?: (p: any) => Target;              // what the call is about, for the audit row
  summary?: (p: any) => unknown;            // what goes in the audit row's "after" for a router-written row (never secrets)
  list?: ListSpec;                          // a list action: the router validates q/filters/sort/page and supports export
  run(ctx: Ctx, p: any): Promise<unknown>;
};

export type Module = {
  name: string;                             // the module's name; actions are named "<something>.<verb>" by convention
  actions: Record<string, ActionDef>;
};

// ---- lists (the DataTable's server half; core/listquery.ts) ----
export type ColType = "text" | "select" | "date" | "number" | "bool";
export type ListSpec = { columns: Record<string, ColType>; search: string[]; defaultSort: { col: string; dir: "asc" | "desc" } };
export type Filter =
  | { op: "contains"; value: string }
  | { op: "in"; values: string[] }
  | { op: "range"; from?: string | number | null; to?: string | number | null }
  | { op: "is"; value: boolean };
export type ListQuery = {
  q: string; filters: Record<string, Filter>; sort: { col: string; dir: "asc" | "desc" }; page: number; size: number; export: boolean;
};

export class ConsoleError extends Error {
  constructor(public status: number, message: string, public reason = "") { super(message); }
}
