// The firm's details, asked once at an owner's first sign-in when the firm has no name yet (review item 32): the name
// (filled in from sign-up), address and logo. Kept in the firm's settings; also editable in Settings → Firm details.
// Asked in Arc's Dialog (src/arc/registry/components/dialog); closing it (✕ or Esc) is "Later".
import { useRef, useState } from "react";
const FS_REF = { get current() { return document.querySelector('[data-overlay="firmsetup"]'); } };
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import Button from "./Button.jsx";
import LogoPick from "./LogoPick.jsx";
import { useDismiss } from "./dismiss.js";

export default function FirmSetup() {
  const a = S.account || {};
  const [d, setD] = useState({ name: S.firm.firmName || (a.firm && a.firm.name) || "", address: S.firm.firmAddress || "", logo: S.firm.firmLogo || "" });
  const [err, setErr] = useState("");
  const due = firmSetupDue();
  const start = useRef(null); if (due && !start.current) start.current = JSON.stringify(d);
  useDismiss(!!due, FS_REF, () => firmSetupLater(), { confirm: true, guard: () => !!start.current && JSON.stringify(d) !== start.current });
  const pick = (ev) => { const f = ev.target.files && ev.target.files[0]; if (f) firmLogoRead(f).then((logo) => { setErr(""); setD({ ...d, logo }); }, (e) => setErr(e.message)); };
  return (
    <Dialog open={!!due} onOpenChange={(open) => { if (!open && firmSetupDue()) firmSetupLater(); }}>
      {/* typed input: a click outside never closes it (the owner, 14-Oct-2026); Esc is "Later", asked first when
          something was typed (app/src/parts/dismiss.js); ✕ and Later as before */}
      <DialogContent className="firmsetup-scrim" data-overlay="firmsetup" title="Your firm’s details" onInteractOutside={(ev) => ev.preventDefault()} onEscapeKeyDown={(ev) => ev.preventDefault()}
        description="Shown in the header, on letters and on reports. You can change them later in Settings → Firm details.">
        <label className="f"><span>Firm name</span><input type="text" aria-label="Firm name" value={d.name} autoFocus onChange={(ev) => setD({ ...d, name: ev.target.value })} /></label>
        <label className="f" style={{ marginTop: 8 }}><span>Address</span><textarea rows={3} aria-label="Firm address" value={d.address} onChange={(ev) => setD({ ...d, address: ev.target.value })} /></label>
        <label className="f" style={{ marginTop: 8 }}><span>Logo (optional)</span><LogoPick has={!!d.logo} onChange={pick} /></label>
        {d.logo && <img src={d.logo} alt="Logo" style={{ maxHeight: 60, marginTop: 6 }} />}
        {err && <p className="bk-warn">{err}</p>}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <Button className="btn" title="Asked again tomorrow; or fill them in any time in Settings → Firm details" onClick={() => firmSetupLater()}>Later</Button>
          <Button className="btn primary" onClick={() => firmSetupSave(d)}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
