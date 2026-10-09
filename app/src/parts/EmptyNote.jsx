// What a list or page shows when it has nothing yet, drawn by Arc's EmptyState (src/arc/registry/components/empty-state).
// `what` is the caller's words, shown whole as the heading (they stay one sentence: "No bank lines yet. Use Upload
// statement…"); words with their own links or buttons are kept as they are, under the heading `title`.
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { Inbox } from "lucide-react";

const icon = <Inbox width={22} height={22} strokeWidth={1.5} />;
export default function EmptyNote({ what, title = "Nothing here yet", className = "", ...rest }) {
  const plain = what == null || typeof what === "string" || typeof what === "number";
  const head = plain ? String(what == null ? title : what).trim() : title;
  return <div className={("arc-empty " + className).trim()} {...rest}>
    <EmptyState title={head} description="" icon={icon} action={plain ? undefined : <div className="arc-empty-words">{what}</div>} />
  </div>;
}
