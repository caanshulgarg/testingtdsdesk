// The console's switches, checked at the door of every function that writes a firm's data with the service role on a
// person's request (console phase 1b, 27-Oct-2026; migration 118). The database refuses a paused firm's writes through
// can_write() and its posting to Tally through console_post_guard, but a function using the service role skips both, so
// each one asks here first:
//   firms.status      'active' | 'suspended' | 'closed'  (suspended or closed: the firm is read-only)
//   clients.status    'active' | 'deactivated'           (a switched-off company: no uploads, no posting)
// Answer: null (go ahead) or {status: 403, reason, error} in plain words, the same words the app shows.
// Before migration 118 runs the columns are missing: the read fails and the answer is null (as before). Any other failure
// to read is also null, logged: the database's own guards still hold for everything that goes through can_write().
export type Gate = { status: number; reason: "firm_paused" | "company_off"; error: string };
export type Read = (table: "firms" | "clients", cols: string, eq: Record<string, string>) => Promise<any | null>;

export const pausedWords = (reason?: string | null) =>
  "Your firm's FinCom account is paused" + (reason ? ": " + String(reason).slice(0, 300) : "") + ". You can still view your work. Contact FinCom.";
export const companyOffWords = (name?: string | null, reason?: string | null) =>
  (name ? String(name).slice(0, 120) : "This company") + " is switched off by FinCom" + (reason ? ": " + String(reason).slice(0, 300) : "") +
  ". You can still view its work; uploads and posting to Tally are off.";

// a PostgREST reader: rest(path, token) gives the rows (and throws on an error answer), as the functions' own helpers do
export const viaRest = (rest: (path: string, token: string) => Promise<any>, token: string): Read => async (t, cols, eq) => {
  const f = Object.entries(eq).map(([k, v]) => "&" + k + "=eq." + encodeURIComponent(v)).join("");
  const rows = await rest("/rest/v1/" + t + "?select=" + cols + f + "&limit=1", token);
  return Array.isArray(rows) ? rows[0] || null : null;
};
// a supabase-js client (the service role's)
// deno-lint-ignore no-explicit-any
export const viaClient = (db: any): Read => async (t, cols, eq) => {
  let q = db.from(t).select(cols);
  for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message || String(error));
  return data || null;
};

export async function firmGate(read: Read, firm: string, client?: string | null): Promise<Gate | null> {
  if (!firm) return null;
  const quiet = (e: unknown) => {
    const m = String((e as Error)?.message || e);
    if (!/status|does not exist|42703|PGRST204|schema cache/i.test(m)) console.error("firmGate: could not read the firm's status", m.slice(0, 200));
    return null;
  };
  // both at once (one round trip, not two: the functions count their waves before the AI); each failure on its own
  const [f, c] = await Promise.all([read("firms", "status,status_reason", { id: firm }).catch(quiet),
    client ? read("clients", "name,status,status_reason", { firm_id: firm, id: String(client) }).catch(quiet) : Promise.resolve(null)]);
  if (f && f.status && f.status !== "active") return { status: 403, reason: "firm_paused", error: pausedWords(f.status_reason) };
  if (c && c.status && c.status !== "active") return { status: 403, reason: "company_off", error: companyOffWords(c.name, c.status_reason) };
  return null;
}
