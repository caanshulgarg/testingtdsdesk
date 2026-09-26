// GSTN's encryption as returned through a GSP: the data is AES-256-ECB (PKCS#7) under the REK; the REK is under the
// session key SEK; the SEK is under the app_key of the OTP session. The data, once decrypted, is base64 of the JSON.
// Written once, used by the edge function (Deno, npm:aes-js) and tested in Node.
export function makeGstCrypto(aesjs: any) {
  const b64dec = (s: string): Uint8Array => { const bin = atob(String(s).replace(/\s+/g, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const utf8 = (s: string) => new TextEncoder().encode(s);
  const unpad = (u: Uint8Array) => { const n = u[u.length - 1]; if (n < 1 || n > 16 || n > u.length) throw new Error("bad padding"); for (let i = u.length - n; i < u.length; i++) if (u[i] !== n) throw new Error("bad padding"); return u.slice(0, u.length - n); };
  const dec = (key: Uint8Array, cipherB64: string): Uint8Array => {
    if (key.length !== 32) throw new Error("key is " + key.length + " bytes, not 32");
    const c = b64dec(cipherB64); if (!c.length || c.length % 16) throw new Error("cipher text is not whole AES blocks");
    return unpad(new aesjs.ModeOfOperation.ecb(key).decrypt(c));
  };
  // the app_key: 32 characters used as they are, or base64 of 32 bytes
  const appKeyBytes = (k: string): Uint8Array => { const s = String(k || ""); if (s.length === 32) return utf8(s); const b = b64dec(s); if (b.length === 32) return b; throw new Error("app_key is not 32 bytes"); };
  const sekBytes = (sek: string, appKey: string) => dec(appKeyBytes(appKey), sek);
  // data and rek as the GSP returns them, to the JSON
  const openData = (data: string, rek: string, sek: string, appKey: string): any => {
    const s = sekBytes(sek, appKey), r = dec(s, rek);
    const inner = r.length === 32 ? r : b64dec(new TextDecoder().decode(r));
    const plain = new TextDecoder().decode(dec(inner, data)).trim();
    const text = plain.startsWith("{") || plain.startsWith("[") ? plain : new TextDecoder().decode(b64dec(plain));
    return JSON.parse(text);
  };
  return { openData, sekBytes, dec, b64dec };
}
