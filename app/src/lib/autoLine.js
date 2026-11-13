// next-speed-worker: the line of a run on its own (the day's audit, the month's MIS: src/js/06-audit.js autoSlice),
// drawn again by itself as the run goes ("fincom:auto", about every Audit.AUTO.DRAW_MS), not with the whole page: at
// 100,000 made-up entries a drawing of the Audit or MIS tab took 50-100 ms, every half second while the run went
import { useEffect, useReducer } from "react";
export function useAutoLine() {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (typeof window !== "object") return undefined;
    const f = () => bump();
    window.addEventListener("fincom:auto", f);
    return () => window.removeEventListener("fincom:auto", f);
  }, []);
}
