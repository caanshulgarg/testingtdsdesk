// Announcements from FinCom (the FinCom Console, migration 123): the live ones for this person's firm, as ONE slim bar
// at the bottom of the page, most severe first; dismissing one (when it may be dismissed) shows the next. Loaded lazily
// (App.jsx), asked once a few seconds after the page is up and again every 15 minutes, through announcements_active().
// Before migration 123 (the function missing) or signed out: nothing, no words. The same chunk loads the feature
// flags (lib/flags.js) once.
import { useEffect, useState } from "react";
import { loadFlags } from "../lib/flags.js";

const EVERY = 15 * 60 * 1000;
const SEV = { urgent: "var(--danger)", warning: "var(--warning)", info: "var(--text-muted)" };
let gone = new Set();     // dismissed in this tab (also told to the server)

export default function Announce() {
  const [list, setList] = useState([]);
  useEffect(() => {
    let live = true, t = 0, none = false;
    const load = () => {
      if (none || typeof Cloud !== "object" || !Cloud.on()) return;
      Cloud.api("rpc/announcements_active", { method: "POST", body: {} })
        .then((r) => { if (live) setList(Array.isArray(r) ? r : []); }, (e) => { if (/404|PGRST202|does not exist/i.test(String(e && e.message))) none = true; });
    };
    const first = setTimeout(() => { load(); loadFlags(); }, 3000);
    t = setInterval(load, EVERY);
    // the console's signal (src/js/99 Live.signal, firm_signals): a new announcement shows within seconds
    window.addEventListener("fincom:signal", load);
    return () => { live = false; clearTimeout(first); clearInterval(t); window.removeEventListener("fincom:signal", load); };
  }, []);
  const a = list.find((x) => !gone.has(x.id));
  if (!a) return null;
  const dismiss = () => {
    gone = new Set(gone).add(a.id); setList([...list]);
    Cloud.api("rpc/announcement_dismiss", { method: "POST", body: { p_id: a.id } }).catch(() => {});
  };
  return (
    <div role={a.severity === "urgent" ? "alert" : "status"} data-announce={a.severity} data-announce-id={a.id}
         style={{ position: "fixed", left: "50%", bottom: 56, transform: "translateX(-50%)", zIndex: 60, width: "min(44rem, calc(100vw - 32px))",
                  display: "flex", alignItems: "center", gap: 12, padding: "8px 8px 8px 16px", borderRadius: 999, background: "var(--surface-raised, var(--surface))",
                  color: "var(--foreground)", border: "1px solid " + (a.severity === "info" ? "var(--border)" : SEV[a.severity]), boxShadow: "var(--shadow-floating)" }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: SEV[a.severity] || SEV.info, flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}><b>{a.title}</b>{a.body ? " " + a.body : ""}</span>
      {a.dismissible && <button className="icon" onClick={dismiss} aria-label="Dismiss" title="Dismiss" data-announce-dismiss="">✕</button>}
    </div>
  );
}
