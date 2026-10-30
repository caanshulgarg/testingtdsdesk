// The one-time AI mapping's place on the page (fin/AiMap.jsx, a lazy chunk of its own: loaded only where it shows).
// earlierMapping(fy): a run of an earlier year with codes accepted, so this year shows "Use last year's mapping" (Tb.jsx)
// in place of the one-time button.
import { lazy, Suspense } from "react";
const AiMap = lazy(() => import("./AiMap.jsx"));
export const earlierMapping = (fy) => ((((S.books || {}).fs || {}).aimap || {}).runs || []).some((r) => +r.fy < +fy && Object.values(r.dec || {}).some((x) => x && x.d === "accepted"));
export default function AiMapSlot(props) { return <Suspense fallback={null}><AiMap {...props} /></Suspense>; }
