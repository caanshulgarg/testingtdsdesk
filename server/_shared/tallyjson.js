// Tally's JSON exports read as Tally's XML (the owner, 28-Oct-2026: "anyone can upload XML or JSON; the system understands
// it and updates it"). TallyPrime 7.1 writes a report exported as JSON (Data Exchange) in Tally's object schema: the
// same objects and fields as its XML export, the tags in lower case, a list as an array, an object's attributes (type,
// remote id, voucher type, action, view) in its "metadata". Each object of the export is turned back into the XML element
// Tally itself writes for it, so the one reader of Tally's XML (the browser's Books.importDayBook, the cloud's parse.js, the
// bridge's copy) reads a JSON export exactly as the XML export of the same entries: the same GUIDs, the same rows.
// Shared by the app (app/src/lib/tallyJson.js, loaded only when a JSON or zip file is chosen) and FinCom's server
// (server/tally-cloud: a JSON Day Book in Storage cut into days). No imports: plain JavaScript for both.

// the first characters of a text without its byte-order mark and white space
function jsonHead(text){ return String(text || "").replace(/^﻿/, "").replace(/^\s+/, "").slice(0, 1); }
// a JSON text (an object or an array at the start), not XML
function isJsonText(text){ const c = jsonHead(text); return c === "{" || c === "["; }

// which Tally export a JSON text is, from its first part: "daybook" (vouchers), "masters" (ledgers / groups), "report" (a
// report as shown on the screen: rows of columns, no objects), "" (not Tally's)
function jsonKindOf(head){
  const h = String(head || "");
  if (/"metadata"\s*:\s*\{[^{}]*"type"\s*:\s*"Voucher"/i.test(h) || /"vouchertypename"\s*:/i.test(h)) return "daybook";
  if (/"metadata"\s*:\s*\{[^{}]*"type"\s*:\s*"(Ledger|Group|Currency|CostCentre|StockItem|Unit|VoucherType)"/i.test(h)) return "masters";
  if (/"tallymessage"\s*:/i.test(h)) return "tally";
  if (/"(dspvchdate|dspvchledaccount|dspaccname|dspvchtype|dspvchnumber|dspvchdramt|dspvchcramt)"\s*:/i.test(h)) return "report";
  return "";
}

// ---- the stream: each object of the export's message list, cut out whole as it comes (any size, any piece boundary)
// The message list is the array under "tallymessage" (any letter case); an export with no such key (a bare array of
// objects) is read at its first array level. State is carried between pieces, so a voucher across two pieces is whole.
// init: the state a previous scanner left (state(), plain JSON: FinCom's server carries it from one piece of a file to the next)
function jsonScanner(init){
  const st = Object.assign({stack: [], inStr: false, esc: false, expectKey: false, key: "", keyBuf: null, buf: "", cap: -1, capDepth: -1, sawList: false, n: 0}, init || {});
  st.stack = (st.stack || []).map((f) => ({t: f.t, key: f.key, depth: f.depth}));
  // the list whose elements are the export's objects: "tallymessage", else a top-level array
  const isList = (frame) => frame && frame.t === "[" && (/^tallymessage$/i.test(frame.key) || (frame.depth === 0));
  function push(text){
    const out = [];
    const s = st.buf + String(text || "");
    let i = st.buf.length;
    for (; i < s.length; i++){
      const c = s.charCodeAt(i);
      if (st.inStr){
        if (st.esc){ st.esc = false; if (st.keyBuf !== null) st.keyBuf += s[i]; continue; }
        if (c === 92){ st.esc = true; if (st.keyBuf !== null) st.keyBuf += "\\"; continue; }       // \
        if (c === 34){                                                                              // "
          st.inStr = false;
          if (st.keyBuf !== null){ try { st.key = JSON.parse('"' + st.keyBuf + '"'); } catch (e){ st.key = st.keyBuf; } st.keyBuf = null; }
          continue;
        }
        if (st.keyBuf !== null) st.keyBuf += s[i];
        continue;
      }
      if (c === 34){ st.inStr = true; const top = st.stack[st.stack.length - 1]; st.keyBuf = top && top.t === "{" && st.expectKey ? "" : null; continue; }
      if (c === 123 || c === 91){                                                                   // { [
        const top = st.stack[st.stack.length - 1];
        const frame = {t: c === 123 ? "{" : "[", key: top && top.t === "{" ? st.key : top ? top.key : "", depth: st.stack.length};
        if (c === 123 && st.cap < 0 && isList(top)){ st.cap = i; st.capDepth = st.stack.length; }
        if (c === 91 && isList(frame)) st.sawList = true;
        st.stack.push(frame); st.expectKey = c === 123; continue;
      }
      if (c === 125 || c === 93){                                                                   // } ]
        st.stack.pop();
        if (c === 125 && st.cap >= 0 && st.stack.length === st.capDepth){ out.push(s.slice(st.cap, i + 1)); st.cap = -1; st.capDepth = -1; st.n++; }
        st.expectKey = false; continue;
      }
      if (c === 44){ const top = st.stack[st.stack.length - 1]; st.expectKey = !!(top && top.t === "{"); continue; }   // ,
      if (c === 58){ st.expectKey = false; continue; }                                              // :
    }
    // keep only what is still needed: the object being cut out, else nothing (the state says where we are)
    if (st.cap >= 0){ st.buf = s.slice(st.cap); st.cap = 0; } else st.buf = "";
    return out;
  }
  // the state to carry (the part of an object not yet whole is st.buf)
  const state = () => ({stack: st.stack, inStr: st.inStr, esc: st.esc, expectKey: st.expectKey, key: st.key, keyBuf: st.keyBuf, buf: st.buf, cap: st.cap, capDepth: st.capDepth, sawList: st.sawList, n: st.n});
  return {push, state, carried: () => st.buf.length};
}

// ---- one object of the export as the XML element Tally writes for it
// What TallyPrime 7.1 writes (run 40733556381, tests/fixtures/real-tally-7.1-json): an object's attributes in "metadata"
// ({"type": "Voucher", "remoteid", "vchkey", "vchtype", "action", "objview"}; the type "Voucher Type" is the element
// VOUCHERTYPE); a list of objects as an array ("allledgerentries": [...] for ALLLEDGERENTRIES.LIST); a list of values with
// its attributes first ("oldauditentryids": [{"metadata": true, "type": "Number"}, "-1"] for <OLDAUDITENTRYIDS.LIST
// TYPE="Number"><OLDAUDITENTRYIDS>-1</...>); a value with attributes as {"value", ...} ("gstregistration": {"value":
// "...", "taxtype": "GST", "taxregistration": ""}); Yes / No as true / false; an empty value left out
const XML_ESC = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"};
// text as Tally writes it in XML: the five entities, a control character as its number (Tally's "&#4; Not Applicable",
// a line break in a narration "&#13;&#10;")
function xmlText(v){
  return String(v).replace(/[&<>"']/g, (m) => XML_ESC[m]).replace(/[\u0000-\u001f]/g, (m) => "&#" + m.charCodeAt(0) + ";");
}
function scalar(v){
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v == null) return "";
  return String(v);
}
const TAG = (k) => String(k).toUpperCase().replace(/[^A-Z0-9_.:]/g, "");
const isMeta = (e) => !!e && typeof e === "object" && !Array.isArray(e) && e.metadata === true;
const isVal = (e) => !!e && typeof e === "object" && !Array.isArray(e) && Object.prototype.hasOwnProperty.call(e, "value") && !(e.metadata && typeof e.metadata === "object");
function attrs(meta, skip){
  let a = "";
  for (const k of Object.keys(meta || {})){
    if (k === "metadata" || (skip && skip.test(k))) continue;
    const v = meta[k]; if (v == null || typeof v === "object") continue;
    a += " " + TAG(k) + '="' + xmlText(scalar(v)) + '"';
  }
  return a;
}
function children(o){
  let x = "";
  for (const k of Object.keys(o)){
    if (k === "metadata") continue;
    const v = o[k], t = TAG(k);
    if (!t) continue;
    if (Array.isArray(v)){
      const lt = /\.LIST$/.test(t) ? t : t + ".LIST", inner = lt.slice(0, -5);
      const head = v.length && isMeta(v[0]) ? v[0] : null, items = head ? v.slice(1) : v;
      if (items.some((e) => e && typeof e === "object" && !isVal(e))) {
        // a list of objects: one element each
        for (const e of items) x += "<" + lt + attrs(head) + attrs(e && e.metadata) + ">" + (e && typeof e === "object" ? children(e) : xmlText(scalar(e))) + "</" + lt + ">";
      } else {
        // a list of values: one list element, the values inside it
        x += "<" + lt + attrs(head) + ">" + items.map((e) => isVal(e) ? "<" + inner + attrs(e, /^value$/) + ">" + xmlText(scalar(e.value)) + "</" + inner + ">" : "<" + inner + ">" + xmlText(scalar(e)) + "</" + inner + ">").join("") + "</" + lt + ">";
      }
      continue;
    }
    if (isVal(v)){ x += "<" + t + attrs(v, /^value$/) + ">" + xmlText(scalar(v.value)) + "</" + t + ">"; continue; }
    if (v && typeof v === "object"){ x += "<" + t + attrs(v.metadata) + ">" + children(v) + "</" + t + ">"; continue; }
    x += "<" + t + ">" + xmlText(scalar(v)) + "</" + t + ">";
  }
  return x;
}
// {metadata: {type: "Voucher", remoteid, vchkey, vchtype, action, objview}, date, guid, ...} -> <VOUCHER REMOTEID=...>...</VOUCHER>
function objXml(o){
  if (!o || typeof o !== "object" || Array.isArray(o)) return "";
  const m = o.metadata && typeof o.metadata === "object" ? o.metadata : {};
  const type = TAG(String(m.type || (o.vouchertypename != null ? "Voucher" : "")).replace(/\s+/g, ""));
  if (!type) return "";
  return "<" + type + attrs(m, /^type$/i) + ">" + children(o) + "</" + type + ">";
}
// an element's text (from the scanner) as XML; "" when it is not an object Tally exports
function elemXml(text){ let o; try { o = JSON.parse(text); } catch (e){ return ""; } return objXml(o); }

// the XML envelope a Tally XML export has, around the converted objects (the company named when the JSON names it)
function envelopeHead(company){
  return "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>" +
    (company ? "<STATICVARIABLES><SVCURRENTCOMPANY>" + xmlText(company) + "</SVCURRENTCOMPANY></STATICVARIABLES>" : "") + "</REQUESTDESC><REQUESTDATA>";
}
const ENVELOPE_FOOT = "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>";
// the company a JSON export names (svcurrentcompany anywhere in its first part)
function jsonCompany(head){ const m = String(head || "").match(/"svcurrentcompany"\s*:\s*"((?:[^"\\]|\\.)*)"/i); if (!m) return ""; try { return JSON.parse('"' + m[1] + '"'); } catch (e){ return m[1]; } }

export { isJsonText, jsonKindOf, jsonScanner, objXml, elemXml, xmlText, envelopeHead, ENVELOPE_FOOT, jsonCompany };
