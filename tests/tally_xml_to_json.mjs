// node tally_xml_to_json.mjs IN.xml OUT.json [utf8|utf8bom|utf16] - a Tally XML export written as TallyPrime 7.1 writes the
// same objects in JSON (its "Native JSON", as captured in tests/fixtures/real-tally-7.1-json by run 40733556381): for the
// tests only, to make JSON Day Books of the made-up books (tests/fixtures/books). {"status": "1", "data": {"tallymessage":
// [{"metadata": {"type": "Voucher", "remoteid", ...}, "date": ..., "allledgerentries": [{...}], "oldauditentryids":
// [{"metadata": true, "type": "Number"}, "-1"], "gstregistration": {"value": ..., "taxtype": ...}, "isoptional": false}]}}
import fs from "fs";
const [inp, out, enc] = process.argv.slice(2);
const raw = fs.readFileSync(inp);
const text = raw[0] === 0xFF && raw[1] === 0xFE ? raw.toString("utf16le").slice(1) : raw.toString("utf8").replace(/^﻿/, "");
const ent = (t) => t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attrsOf = (s) => { const a = {}; for (const m of String(s || "").matchAll(/([\w.:]+)="([^"]*)"/g)) a[m[1].toLowerCase()] = ent(m[2]); return a; };
// a tree of the XML: {tag, attrs, kids: [], text}
function tree(x){
  const root = {tag: "", attrs: {}, kids: [], text: ""}, st = [root];
  const re = /<(\/?)([A-Za-z_][\w.:]*)((?:\s+[\w.:]+="[^"]*")*)\s*(\/?)>|([^<]+)/g; let m;
  while ((m = re.exec(x))){
    if (m[5] !== undefined){ st[st.length - 1].text += m[5]; continue; }
    if (m[1]){ st.pop(); continue; }
    const n = {tag: m[2], attrs: attrsOf(m[3]), kids: [], text: ""}; st[st.length - 1].kids.push(n);
    if (!m[4]) st.push(n);
  }
  return root;
}
const bool = (v) => v === "Yes" ? true : v === "No" ? false : v;
function obj(n){
  const o = {};
  for (const k of n.kids){
    const key = k.tag.toLowerCase();
    if (/\.list$/.test(key)){
      const name = key.slice(0, -5), inner = k.tag.slice(0, -5);
      const leafy = k.kids.length && k.kids.every((c) => c.tag === inner && !c.kids.length);
      if (leafy){
        const arr = Object.keys(k.attrs).length ? [Object.assign({metadata: true}, k.attrs)] : [];
        k.kids.forEach((c) => { const v = ent(c.text).trim(); if (v) arr.push(Object.keys(c.attrs).length ? Object.assign({value: v}, c.attrs) : v); });
        if (arr.length > (Object.keys(k.attrs).length ? 1 : 0)) (o[name] = o[name] || []).push(...arr);
      } else if (k.kids.length){
        (o[name] = o[name] || []).push(obj(k));
      }
      continue;
    }
    if (k.kids.length){ o[key] = Object.assign(Object.keys(k.attrs).length ? {metadata: k.attrs} : {}, obj(k)); continue; }
    const v = ent(k.text).trim();
    if (!v) continue;
    o[key] = Object.keys(k.attrs).length ? Object.assign({value: v}, k.attrs) : bool(v);
  }
  return o;
}
const t = tree(text), msgs = [];
(function walk(n){ for (const k of n.kids){ if (k.tag === "TALLYMESSAGE"){ k.kids.forEach((c) => msgs.push(Object.assign({metadata: Object.assign({type: c.tag === "VOUCHER" ? "Voucher" : c.tag.charAt(0) + c.tag.slice(1).toLowerCase()}, c.attrs)}, obj(c)))); } else walk(k); } })(t);
const js = JSON.stringify({status: "1", data: {tallymessage: msgs}}, null, 1);
const bytes = enc === "utf16" ? Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(js, "utf16le")]) : enc === "utf8bom" ? Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(js, "utf8")]) : Buffer.from(js, "utf8");
fs.writeFileSync(out, bytes);
console.log(JSON.stringify({messages: msgs.length, vouchers: msgs.filter((m) => m.metadata.type === "Voucher").length, bytes: bytes.length}));
