// FinCom Assistant's launcher, at the foot of every page. In the app's first file; the panel itself (Assistant.jsx) is
// loaded the first time it opens (round 3, 14-Oct-2026: the first file stays within its budget, run_stability.py)
import { Sparkles } from "lucide-react";

export function AssistantLauncher() {
  const a = ASST.st();
  if (!S.firm || a.open || typeof Cloud !== "object" || !Cloud.on()) return null;
  if (a.settings === undefined) { a.settings = null; setTimeout(() => ASST.loadSettings(), 0); }
  if (!ASST.on()) return null;
  const co = S.view === "company" && CO();
  return <button className="asst-launch" data-asst-launch="" onClick={() => ASST.open()} title="FinCom Assistant (Ctrl+J)"><Sparkles size={16} /> {co ? "Ask about " + co.name : "Ask FinCom"}</button>;
}
