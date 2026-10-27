// The console's one way to the data: the console-admin function. Every answer is {ok, data} or {ok:false, error}.
import { SUPABASE_KEY, SUPABASE_URL, signOut, token, touch } from "./auth.js";

export class ApiError extends Error { constructor(m, status, reason) { super(m); this.status = status; this.reason = reason; } }
export async function call(action, params = {}) {
  const t = await token();
  let r;
  try {
    r = await fetch(SUPABASE_URL + "/functions/v1/console-admin", {
      method: "POST", headers: { Authorization: "Bearer " + t, apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, action }),
    });
  } catch { throw new ApiError("Could not reach FinCom. Check the connection and try again.", 0, "network"); }
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) {
    if (r.status === 401) signOut("Your sign-in has ended. Sign in again.");
    throw new ApiError((j && j.error) || "Something went wrong. Nothing was changed.", r.status, (j && j.reason) || "");
  }
  touch();
  return j.data;
}
