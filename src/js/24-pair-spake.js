/* ================================================================== */
/* FinCom Bridge 2.4.7: pairing with a typed code, without an offline */
/* test for it (SPAKE2, the page's side; bridge-go/pairspake.go)       */
/* ================================================================== */
// Until 2.4.6 the bridge gave FinCom's page pairProof = HMAC(code, nonce || id || port): one such proof let whoever held
// it find the 6-digit code among 10^6 at once. A 2.4.7 bridge gives no such proof; a typed code is checked with SPAKE2
// over RFC 3526's 2048-bit group: the page sends X = g^x * M^w (w = H(code, the bridge's id, port and window salt) mod q),
// the bridge answers Y = g^y * N^w and its confirmation, the page checks it (the bridge knows the code) and sends its own;
// each run tests one code, online, and counts against the bridge's five tries. Checked against the bridge's own vectors by
// tests/run_pair_spake.mjs (bridge-go/testdata/r247/spake-vectors.json).
const PairSpake = (() => {
  const B = (s) => BigInt(s);
  const P = B("0x" + "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
    "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
    "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
    "15728E5A8AACAA68FFFFFFFFFFFFFFFF");
  const ONE = B(1), TWO = B(2), ZERO = B(0);
  const Q = (P - ONE) / TWO;
  const enc = new TextEncoder();
  const hex = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, "0")).join("");
  const sha = async (u8) => new Uint8Array(await crypto.subtle.digest("SHA-256", u8));
  const pow = (b, e, m) => { let r = ONE; b %= m; while (e > ZERO) { if (e & ONE) r = (r * b) % m; e >>= ONE; b = (b * b) % m; } return r; };
  const h512 = (v) => v.toString(16).padStart(512, "0");
  // 288 bytes of SHA-256 in counter mode, as the bridge's spakeExpand
  const expand = async (label) => { let s = ""; for (let i = 0; i < 9; i++) s += hex(await sha(enc.encode(label + "|" + i))); return B("0x" + s); };
  let MN = null;
  const mn = async () => MN || (MN = [pow((await expand("FinCom pair v2 M")) % P, TWO, P), pow((await expand("FinCom pair v2 N")) % P, TWO, P)]);
  const w = async (code, ctx) => (await expand("FinCom pair v2 w|" + code + "|" + ctx)) % Q;
  const scalar = () => { const a = new Uint8Array(32); crypto.getRandomValues(a); const v = B("0x" + hex(a)); return v === ZERO ? ONE : v; };
  const element = (s) => {
    if (typeof s !== "string" || !/^[0-9a-f]{512}$/.test(s)) return null;
    const v = B("0x" + s);
    return v > ONE && v < P - ONE && pow(v, Q, P) === ONE ? v : null;
  };
  const transcript = async (parts) => {
    const chunks = [];
    for (const p of parts) { const b = enc.encode(p), n = new Uint8Array(8); let l = b.length; for (let i = 7; i >= 0; i--) { n[i] = l & 255; l = Math.floor(l / 256); } chunks.push(n, b); }
    const all = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0)); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    return sha(all);
  };
  const mac = async (k, who) => { const key = await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(who)))); };
  // the page's start: {x, w, X, ctx}; x given only by the tests
  async function start(code, ctx, x) {
    const [M] = await mn(), wv = await w(String(code), ctx), xv = x || scalar();
    return { x: xv, w: wv, ctx, X: h512((pow(TWO, xv, P) * pow(M, wv, P)) % P) };
  }
  // the bridge's answer checked; the page's confirmation, or null (a wrong code, or not the bridge)
  async function finish(st, Ys, confirmB) {
    const Y = element(Ys);
    if (!Y || typeof confirmB !== "string") return null;
    const [, N] = await mn();
    const Z = pow((Y * pow(N, Q - st.w, P)) % P, st.x, P);
    if (Z === ONE) return null;
    const k = await transcript(["FinCom pair v2", st.ctx, st.X, Ys, h512(Z), h512(st.w)]);
    if (await mac(k, "bridge") !== confirmB.toLowerCase()) return null;
    return mac(k, "page");
  }
  return { P, Q, w, start, finish };
})();
