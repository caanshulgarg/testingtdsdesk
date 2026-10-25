// fast-firstopen (25-Oct-2026): a month of a book's day files in one answer, for a client opened for the first time on a
// computer (FinCom's FirstOpen, src/js/95). The days go as they are kept in the bucket tally-days (each gzipped), so the
// server neither opens nor packs anything again and the browser keeps each day as it came:
//   4 bytes   the length N of the list (unsigned, big-endian)
//   N bytes   the list, JSON in UTF-8: [{day: "YYYYMMDD", at: tally_days.at, n: the day's bytes (0: no file)}]
//   then each day's gzip bytes in the list's order
// Read by the browser with the same rule (FirstOpen.unpack); tests: server/tally-cloud/monthpack_test.ts,
// tests/run_books_speed.py (the Leads stand answers the same way).

/** @param {{day: string, at: string, gz: Uint8Array | null}[]} days */
export function packMonth(days) {
  const list = days.map((d) => ({ day: d.day, at: d.at, n: d.gz ? d.gz.length : 0 }));
  const head = new TextEncoder().encode(JSON.stringify(list));
  const total = 4 + head.length + list.reduce((t, x) => t + x.n, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, head.length, false);
  out.set(head, 4);
  let at = 4 + head.length;
  for (const d of days) if (d.gz) { out.set(d.gz, at); at += d.gz.length; }
  return out;
}

/** @param {ArrayBuffer | Uint8Array} buf @returns {{day: string, at: string, gz: Uint8Array | null}[]} */
export function unpackMonth(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u.length < 4) throw new Error("not a month of day files");
  const n = new DataView(u.buffer, u.byteOffset, u.byteLength).getUint32(0, false);
  if (4 + n > u.length) throw new Error("not a month of day files");
  const list = JSON.parse(new TextDecoder().decode(u.subarray(4, 4 + n)));
  if (!Array.isArray(list)) throw new Error("not a month of day files");
  let at = 4 + n;
  const out = list.map((x) => {
    const len = Number(x && x.n) || 0, gz = len ? u.slice(at, at + len) : null;
    at += len;
    return { day: String(x.day || ""), at: String(x.at || ""), gz };
  });
  if (at !== u.length) throw new Error("a month of day files cut short");
  return out;
}

// the last day of a month "YYYYMM" as "YYYY-MM-DD"
export function monthEnd(ym) {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(4, 6));
  return ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
}
