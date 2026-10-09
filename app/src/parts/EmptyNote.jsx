// What a list or page shows when it has nothing yet, drawn by Arc's EmptyState (src/arc/registry/components/empty-state).
// `what` is the caller's words: a sentence ("No bills yet. Upload them above.") becomes the heading and the line under
// it; words with their own links or buttons are kept as they are, under the heading `title`.
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { Inbox } from "lucide-react";

const icon = <Inbox width={22} height={22} strokeWidth={1.5} />;
export function splitWords(s) {
  const t = String(s || "").trim(), i = t.search(/[.:!?]\s/);
  return i > 0 ? [t.slice(0, i + 1), t.slice(i + 2)] : [t, ""];
}
export default function EmptyNote({ what, title = "Nothing here yet", className = "", ...rest }) {
  const plain = what == null || typeof what === "string" || typeof what === "number";
  const [head, line] = plain ? splitWords(what == null ? title : what) : [title, ""];
  return <div className={("arc-empty " + className).trim()} {...rest}>
    <EmptyState title={head} description={line} icon={icon} action={plain ? undefined : <div className="arc-empty-words">{what}</div>} />
  </div>;
}
