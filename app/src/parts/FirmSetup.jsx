// The firm's details, asked once at an owner's first sign-in when the firm has no name yet (review item 32): the name
// (filled in from sign-up), address and logo. Kept in the firm's settings; also editable in Settings → Firm details.
import { useState } from "react";

export default function FirmSetup() {
  const a = S.account || {};
  const [d, setD] = useState({ name: S.firm.firmName || (a.firm && a.firm.name) || "", address: S.firm.firmAddress || "", logo: S.firm.firmLogo || "" });
  const [err, setErr] = useState("");
  if (!firmSetupDue()) return null;
  const pick = (ev) => { const f = ev.target.files && ev.target.files[0]; if (f) firmLogoRead(f).then((logo) => { setErr(""); setD({ ...d, logo }); }, (e) => setErr(e.message)); };
  return (
    <div className="firmsetup-scrim">
      <div className="cbx" role="dialog" aria-modal="true" aria-labelledby="fsT">
        <h2 id="fsT">Your firm’s details</h2>
        <p className="note">Shown in the header, on letters and on reports. You can change them later in Settings → Firm details.</p>
        <label className="f"><span>Firm name</span><input type="text" aria-label="Firm name" value={d.name} autoFocus onChange={(ev) => setD({ ...d, name: ev.target.value })} /></label>
        <label className="f" style={{ marginTop: 8 }}><span>Address</span><textarea rows={3} aria-label="Firm address" value={d.address} onChange={(ev) => setD({ ...d, address: ev.target.value })} /></label>
        <label className="f" style={{ marginTop: 8 }}><span>Logo (optional)</span><input type="file" accept="image/*" aria-label="Firm logo" onChange={pick} /></label>
        {d.logo && <img src={d.logo} alt="Logo" style={{ maxHeight: 60, marginTop: 6 }} />}
        {err && <p className="bk-warn">{err}</p>}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn" onClick={() => { S.firmSetupLater = true; render(); }}>Later</button>
          <button className="btn primary" onClick={() => firmSetupSave(d)}>Save</button>
        </div>
      </div>
    </div>
  );
}
