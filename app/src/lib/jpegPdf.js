// Pages photographed on the phone (JPEG, each already cropped by the camera's own editor) put into one PDF, one page a
// photo, so a bill or statement of several pages goes into the upload and reading flow as one file (handleFiles, src/js/27).
// Mobile only (src/lib/native.js loads it); nothing here touches the page. Plain PDF 1.4: each JPEG embedded as it is
// (DCTDecode, no re-encoding), the page sized to fit A4's width at 150 dpi or the photo's own size if smaller.

// a JPEG's width, height and colour components (its SOF marker), or null when it is not a JPEG
export function jpegSize(bytes) {
  const b = bytes;
  if (!b || b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7) || m === 0xFF) { i++; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    // SOF0..SOF15, but DHT (C4), JPG (C8) and DAC (CC)
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], comps: b[i + 9] };
    }
    i += 2 + len;
  }
  return null;
}

const A4_W = 595.28, A4_H = 841.89;
// the page's size in points: the photo at 150 dpi, no wider than A4 (a phone's 12 MP photo is shrunk to A4's width)
export function pageSize(w, h) {
  let pw = (w / 150) * 72, ph = (h / 150) * 72;
  const k = Math.min(1, A4_W / pw, (A4_H * 1.5) / ph);
  pw *= k; ph *= k;
  return [Math.round(pw * 100) / 100, Math.round(ph * 100) / 100];
}

// jpegs: [Uint8Array] -> Uint8Array (the PDF's bytes). Throws on an image that is not a JPEG
export function jpegsToPdf(jpegs) {
  if (!jpegs || !jpegs.length) throw new Error("No page to put in the PDF.");
  const enc = new TextEncoder(), parts = [], offsets = [];
  let size = 0;
  const put = (x) => { const u = typeof x === "string" ? enc.encode(x) : x; parts.push(u); size += u.length; };
  const obj = (n, body) => { offsets[n] = size; put(n + " 0 obj\n"); body(); put("\nendobj\n"); };
  const n = jpegs.length, kids = [];
  // objects: 1 catalog, 2 pages, then for page k: 3+3k page, 4+3k image, 5+3k contents
  for (let k = 0; k < n; k++) kids.push((3 + 3 * k) + " 0 R");
  put("%PDF-1.4\n%âãÏÓ\n");
  obj(1, () => put("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => put("<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + n + " >>"));
  jpegs.forEach((jpg, k) => {
    const s = jpegSize(jpg);
    if (!s) throw new Error("Page " + (k + 1) + " is not a JPEG photo.");
    const [pw, ph] = pageSize(s.width, s.height), p = 3 + 3 * k;
    const cs = s.comps === 1 ? "/DeviceGray" : s.comps === 4 ? "/DeviceCMYK" : "/DeviceRGB";
    const draw = "q " + pw + " 0 0 " + ph + " 0 0 cm /Im" + k + " Do Q";
    obj(p, () => put("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pw + " " + ph + "] /Resources << /XObject << /Im" + k + " " + (p + 1) + " 0 R >> >> /Contents " + (p + 2) + " 0 R >>"));
    obj(p + 1, () => { put("<< /Type /XObject /Subtype /Image /Width " + s.width + " /Height " + s.height + " /ColorSpace " + cs + " /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpg.length + " >>\nstream\n"); put(jpg); put("\nendstream"); });
    obj(p + 2, () => put("<< /Length " + draw.length + " >>\nstream\n" + draw + "\nendstream"));
  });
  const total = 3 + 3 * n, xref = size;
  let x = "xref\n0 " + total + "\n0000000000 65535 f \n";
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  put(x + "trailer\n<< /Size " + total + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
  const out = new Uint8Array(size);
  let o = 0; for (const u of parts) { out.set(u, o); o += u.length; }
  return out;
}
