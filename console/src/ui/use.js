import { useCallback, useEffect, useState } from "react";
import { call } from "../lib/api.js";

// loads one action's answer; reload() asks again
export function useAction(action, params, deps = []) {
  const [st, set] = useState({ loading: true, data: null, error: "" });
  const key = JSON.stringify(params || {});
  const load = useCallback(() => {
    let live = true;
    set((s) => ({ ...s, loading: true, error: "" }));
    call(action, params || {}).then((data) => live && set({ loading: false, data, error: "" }), (e) => live && set({ loading: false, data: null, error: e.message }));
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, key, ...deps]);
  useEffect(load, [load]);
  return { ...st, reload: load };
}
