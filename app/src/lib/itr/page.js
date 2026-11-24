// The rest of FinCom on the page, as the return's files read it. FinCom's program (legacy.js, src/js) is a classic
// script: a function it declares is a property of window, but a const or a let (S, FS, TDS, MIS, Cloud …) is not; it
// is a name of the page's global scope, which a module reaches only by the bare name. page() answers both, window first
// (the tests' stand-ins on globalThis still count). The owner's review of 23-Nov-2026: read as window.S and window.FS,
// the page's return saw no books, kept none of the answers and took every client for "Other" (so ITR-5).
/* global S, FS, TDS, TDSReg, TDSWatch, MIS, Cloud, GSTAmend, Audit */
const W = typeof window === "object" ? window : globalThis;
const NAMES = { S: () => S, FS: () => FS, TDS: () => TDS, TDSReg: () => TDSReg, TDSWatch: () => TDSWatch, MIS: () => MIS, Cloud: () => Cloud, GSTAmend: () => GSTAmend, Audit: () => Audit };
const P = new Proxy(W, { get(t, k) { const v = t[k]; if (v !== undefined || !NAMES[k]) return v; try { return NAMES[k](); } catch (e) { return undefined; } } });
export const page = () => P;
