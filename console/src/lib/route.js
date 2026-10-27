// Hash routes: #/<path>?<query>. The query keeps a table's search, filters, sort and page, so a view can be bookmarked.
import { useEffect, useState } from "react";

export function parse(h = location.hash) {
  const s = h.replace(/^#\/?/, "");
  const i = s.indexOf("?");
  return { path: (i < 0 ? s : s.slice(0, i)) || "dashboard", query: new URLSearchParams(i < 0 ? "" : s.slice(i + 1)) };
}
export function href(path, query) {
  const q = query ? (typeof query === "string" ? query : query.toString()) : "";
  return "#/" + path + (q ? "?" + q : "");
}
export const go = (path, query) => { location.hash = href(path, query); };
// change the query without adding a history entry for every keystroke
export function setQuery(query) {
  const { path } = parse();
  const h = href(path, query);
  if (h !== location.hash) { history.replaceState(null, "", h); dispatchEvent(new HashChangeEvent("hashchange")); }
}
export function useRoute() {
  const [r, setR] = useState(parse);
  useEffect(() => { const f = () => setR(parse()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return r;
}
