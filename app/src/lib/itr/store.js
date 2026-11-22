// Where a client's return work is kept: b.itr, a part of the client's books (BOOKS_KEYS, src/js/18), synced item by item
// to the firm account like the TDS uploads (client_book_items: each key of b.itr is one item, so two people working on
// two files never clash). Keys:
//   "<ay>|ais", "<ay>|tis", "<ay>|as26", "<ay>|prefill"          one a year: a new import of the kind replaces it
//   "<ay>|ecr|<yyyymm>", "<ay>|pfchallan|<yyyymm>|<trrn>", "<ay>|esic|<yyyymm>|<challan>"   one a month (and challan)
//   "<ay>|state"   the owner's answers: form, regime, details for the return, differences accepted with a note, the
//                  JSON versions made (add-only)
// A file brought in goes to the firm's private storage only (bucket client-docs, <firm>/<client>/itr<ay>-<kind>-<name>,
// the Inbox's documents' bucket and row security); never to this computer's store, the repository or a log. Signed
// out, the file is read and what it holds is kept, but the file itself is not stored (the page says so).
// The same file again (same SHA-256) changes nothing; another file for the same key replaces the earlier one (its
// stored copy is removed when its name differed).
import { read, belongs } from "./imports.js";

export const AY_KEY = "2026";
const ik = (ay, f) => ay + "|" + f.key;

// deps (the page passes the app's, the tests stand-ins): {books(), save(), clients(), open(), upload(path, blob, type) ->
// {ok, path} | throws, remove(path), firm(), user(), now(), sha(bytes) -> hex}
export function makeStore(deps) {
  const d = deps;
  const all = () => { const b = d.books(); if (!b) return {}; if (!b.itr || typeof b.itr !== "object") b.itr = {}; return b.itr; };
  const files = (ay = AY_KEY) => Object.entries(all()).filter(([k, v]) => k.startsWith(ay + "|") && k !== ay + "|state" && v && v.kind).map(([k, v]) => Object.assign({ id: k }, v));
  const state = (ay = AY_KEY) => all()[ay + "|state"] || {};
  function setState(patch, ay = AY_KEY) {
    const it = all(), cur = it[ay + "|state"] || {};
    it[ay + "|state"] = Object.assign({}, cur, patch, { at: d.now(), by: d.user() });
    return d.save();
  }
  // bring a file in: {name, bytes (Uint8Array), text (or pdf lines), type}
  async function bring(file, ay = AY_KEY, opts = {}) {
    const f = read(file.name, file.text);
    if (f.error) return { ok: false, refused: true, code: f.error.code, text: f.error.text };
    const open = d.open(), who = belongs(f, open, d.clients(), ay, !!opts.confirmed);
    if (!who.ok) return { ok: false, refused: true, code: who.code, text: who.text, other: who.other || "", confirm: !!who.confirm };
    const sha = await d.sha(file.bytes), id = ik(ay, f), it = all(), was = it[id];
    if (was && was.sha === sha) return { ok: true, same: true, id, file: was, text: "Already in: this same file was brought in on " + String(was.at || "").slice(0, 10) + ". Nothing changed." };
    let docPath = "", stored = false, storeNote = "";
    const safe = String(file.name || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
    if (d.firm()) {
      const path = d.firm() + "/" + open.id + "/itr" + ay + "-" + f.key.replace(/\|/g, "-") + "-" + safe;
      try { await d.upload(path, file.bytes, file.type || "application/octet-stream"); docPath = path; stored = true; }
      catch (e) { storeNote = "The file could not be stored in the firm's storage (" + ((e && e.message) || "no answer") + "); what it holds is kept. Bring it in again to store it."; }
    } else storeNote = "Signed out: what the file holds is kept, the file itself is not stored. Sign in and bring it in again to keep the file.";
    if (was && was.docPath && was.docPath !== docPath && stored) { try { await d.remove(was.docPath); } catch (e) { /* an old copy left is harmless; replaced on the next import */ } }
    it[id] = { kind: f.kind, label: f.label, key: f.key, name: file.name, size: file.bytes ? file.bytes.length : 0, sha, at: d.now(), by: d.user(), pan: f.pan || "", ay: f.ay, wageMonth: f.wageMonth || "",
      estCode: f.estCode || "", docPath, stored, assumed: !!f.assumed, read: f.read, data: f.data, paidOn: f.paidOn || "", trrn: f.trrn || "", challan: f.challan || "" };
    if (who.ask) it[id].ask = who.ask;
    await d.save();
    return { ok: true, replaced: !!was, id, file: it[id], storeNote, ask: who.ask || null,
      text: (was ? "Replaced the " + f.label + " brought in on " + String(was.at || "").slice(0, 10) + "." : f.label + " brought in.") + (storeNote ? " " + storeNote : "") };
  }
  async function drop(id) {
    const it = all(), was = it[id]; if (!was) return false;
    delete it[id]; await d.save();
    if (was.docPath) { try { await d.remove(was.docPath); } catch (e) { /* left; harmless */ } }
    return true;
  }
  // a difference accepted with the owner's note (never without one)
  // bound to the check's figures (fp, verify.js fingerprint): a change to either side lapses it
  function accept(checkId, note, fp, ay = AY_KEY) {
    const t = String(note || "").trim(); if (t.length < 3) return { ok: false, text: "Write a short note on why this difference is accepted." };
    if (!fp) return { ok: false, text: "The check's figures are not known: open the check again." };
    const s = state(ay), acc = Object.assign({}, s.accepted || {}); acc[checkId] = { note: t, fp, at: d.now(), by: d.user() };
    setState({ accepted: acc }, ay); return { ok: true };
  }
  function unaccept(checkId, ay = AY_KEY) { const s = state(ay), acc = Object.assign({}, s.accepted || {}); delete acc[checkId]; return setState({ accepted: acc }, ay); }
  function addVersion(v, ay = AY_KEY) { const s = state(ay), vs = (s.versions || []).slice(); vs.push(v); return setState({ versions: vs }, ay); }
  return { files, state, setState, bring, drop, accept, unaccept, addVersion };
}

// the app's own deps (the legacy globals: S.books, saveBooks, Cloud, CO, S.companies)
export function appDeps() {
  const G = typeof window === "object" ? window : globalThis;
  const S = () => G.S || {};
  return {
    books: () => (S().books && S().books.cid === S().coId ? S().books : null),
    save: () => (typeof G.saveBooks === "function" ? G.saveBooks() : Promise.resolve()),
    clients: () => Object.values(S().companies || {}).map((c) => ({ id: c.id, name: c.name, pan: String(c.pan || "").toUpperCase(), pfCode: (c.itr || {}).pfCode || c.pfCode || "", esiCode: (c.itr || {}).esiCode || c.esiCode || "" })),
    open: () => { const c = (S().companies || {})[S().coId] || {}; const st = ((S().books || {}).itr || {})[AY_KEY + "|state"] || {}; return { id: c.id, name: c.name, pan: String(c.pan || "").toUpperCase(), pfCode: st.pfCode || "", esiCode: st.esiCode || "" }; },
    firm: () => (G.Cloud && G.Cloud.on && G.Cloud.on() && G.Cloud.st && G.Cloud.st.firm && S().account ? G.Cloud.st.firm : ""),
    user: () => (S().account && (S().account.name || S().account.email)) || "",
    now: () => new Date().toISOString(),
    sha: async (bytes) => { const h = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, "0")).join(""); },
    upload: async (path, bytes, type) => {
      const Cloud = G.Cloud; await Cloud.fresh().catch(() => {});
      const c = Cloud.cfg(), url = c.url.replace(/\/+$/, "") + "/storage/v1/object/client-docs/" + path.split("/").map(encodeURIComponent).join("/");
      const send = () => fetch(url, { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token, "x-upsert": "true", "Content-Type": type }, body: bytes });
      let r = await send();
      if (r.status === 401) { await Cloud.refreshToken(Cloud.sess().access_token); r = await send(); }
      if (!r.ok) throw new Error("storage answered " + r.status);
      return { ok: true, path };
    },
    remove: async (path) => { const Cloud = G.Cloud, c = Cloud.cfg(); await fetch(c.url.replace(/\/+$/, "") + "/storage/v1/object/client-docs/" + path.split("/").map(encodeURIComponent).join("/"), { method: "DELETE", headers: { apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token } }); },
  };
}

// a File from the page -> {name, bytes, text, type}; a PDF is read to its text lines (pdf.js, scripts off), with the
// password tried from the client's date of birth / incorporation (26AS: DDMMYYYY; AIS: pan in small letters + DDMMYYYY)
export async function fileIn(file, o = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf" || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
  if (!isPdf) return { name: file.name, bytes, type: file.type || "text/plain", text: new TextDecoder("utf-8").decode(bytes) };
  const lines = await pdfLines(bytes, o.passwords || []);
  return { name: file.name, bytes, type: "application/pdf", text: { lines } };
}
async function pdfLines(bytes, passwords) {
  const G = window;
  if (typeof G.ensurePdfJs === "function") await G.ensurePdfJs();
  if (!G.pdfjsLib) throw { code: "pdf_unavailable", message: "The PDF reader could not be loaded." };
  let doc = null, lastErr = null;
  for (const pw of [undefined].concat(passwords)) {
    try { doc = await G.pdfjsLib.getDocument({ data: bytes.slice(), password: pw, isEvalSupported: false, enableXfa: false }).promise; break; }
    catch (e) { lastErr = e; if (!(e && /password/i.test(e.name || e.message || ""))) break; }
  }
  if (!doc) throw { code: /password/i.test((lastErr && (lastErr.name || lastErr.message)) || "") ? "pdf_password" : "pdf_bad", message: "The PDF could not be opened." };
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent(), rows = new Map();
    tc.items.forEach((it) => { const y = Math.round(it.transform[5]); const r = rows.get(y) || []; r.push(it); rows.set(y, r); });
    [...rows.keys()].sort((a, b) => b - a).forEach((y) => out.push(rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]).map((x) => x.str).join("  ").replace(/\s{3,}/g, "  ").trim()));
  }
  return out;
}
