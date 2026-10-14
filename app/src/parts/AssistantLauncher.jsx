// FinCom Assistant's launcher, at the foot of every page. In the app's first file; the panel itself (Assistant.jsx) is
// loaded the first time it opens (round 3, 14-Oct-2026: the first file stays within its budget, run_stability.py)
import { Sparkles } from "lucide-react";

export function AssistantLauncher() {
  const a = ASST.st();
  if (!S.firm || a.open || typeof Cloud !== "object" || !Cloud.on()) return null;
  // the firm's setting is read again until it is known (the owner's report of 14-Oct-2026, src/js/75-assistant.js loadSettings)
  if (a.settings === undefined && !a.settingsBusy) setTimeout(() => ASST.loadSettings(), 0);
  if (!ASST.on()) return null;
  const co = S.view === "company" && CO();
  // a long client name is cut with an ellipsis (assistant.css); the whole name is in the tooltip (the owner's report of 14-Oct-2026)
  const words = co ? "Ask about " + co.name : "Ask FinCom";
  return <button className="asst-launch" data-asst-launch="" onClick={() => ASST.open()} title={words + " · FinCom Assistant (Ctrl+J)"} aria-label={words}><Sparkles size={16} /> <span className="asst-launch-txt">{words}</span></button>;
}
