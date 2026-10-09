// The firm's logo: Arc's small dropzone in place of the browser's "Choose File / No file chosen". The real file box is
// still there (type=file, its aria-label), only hidden from sight: the label around this part opens it on a click,
// Enter or Space, and a picture dropped on it goes to the same onChange, as {target: {files}}.
import { useState } from "react";
import { ImageUp } from "lucide-react";

export default function LogoPick({ label = "Firm logo", has, onChange }) {
  const [over, setOver] = useState(false);
  return <span className="logo-pick" data-over={over || undefined}
    onDragOver={(e) => { e.preventDefault(); setOver(true); }}
    onDragLeave={() => setOver(false)}
    onDrop={(e) => { e.preventDefault(); setOver(false); onChange({ target: { files: e.dataTransfer.files } }); }}>
    <input type="file" accept="image/*" aria-label={label} className="logo-pick-in" onChange={onChange} />
    <span className="logo-pick-face" aria-hidden="true">
      <ImageUp size={18} strokeWidth={1.75} />
      <span><b>{has ? "Change the logo" : "Choose a logo"}</b><small>PNG or JPG, or drop it here</small></span>
    </span>
  </span>;
}
