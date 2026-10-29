// node run_cloud_parse_json.mjs - the owner, 28-Oct-2026: "Build JSON also: anyone can upload XML or JSON; the system
// understands it and updates it." A Day Book (and the masters) exported by TallyPrime 7.1 as JSON is read exactly as the
// same entries exported as XML, on Tally's own captures (tests/fixtures/real-tally-7.1-json, the real-Tally harness's mode
// dbjson, runs in SOURCE.txt): the JSON turned into Tally's XML (server/_shared/tallyjson.js, through the app's
// app/src/lib/tallyJson.js) is read by the cloud's parse.js and the browser's Books into the same entries and lines,
// field for field, as Tally's own XML of them; every non-empty field and attribute of every voucher and master is the
// same; the file read a piece at a time (any piece boundary), in UTF-8 / UTF-16LE, with or without the byte-order mark,
// gives the same XML; a zip of several files gives each one.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDay } from "../server/tally-cloud/parse.js";
import { jsonScanner, elemXml, isJsonText, jsonKindOf } from "../server/_shared/tallyjson.js";
import { TallyJson } from "../app/src/lib/tallyJson.js";
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(HERE, "fixtures", "real-tally-7.1-json");
const {load, HTML} = require("./harness");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const h = load(HTML, ["num", "r2", "Books"]);
const B = h.x.Books;
const dec = (b) => b[0] === 0xFF && b[1] === 0xFE ? b.toString("utf16le").slice(1) : b.toString("utf8").replace(/^﻿/, "");
const ent = (t) => t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
// every non-empty field (path=value) and attribute of an element
function leaves(x){
  const out = [], st = []; const re = /<(\/?)([A-Za-z_][\w.:]*)((?:\s+[\w.:]+="[^"]*")*)\s*(\/?)>|([^<]+)/g; let m, txt = "";
  while ((m = re.exec(x))){
    if (m[5] !== undefined){ txt += m[5]; continue; }
    if (m[1]){ const v = ent(txt).trim(); if (v) out.push(st.join("/") + "=" + v); st.pop(); txt = ""; continue; }
    st.push(m[2]); txt = "";
    for (const a of m[3].matchAll(/([\w.:]+)="([^"]*)"/g)) if (ent(a[2]).trim()) out.push(st.join("/") + "@" + a[1] + "=" + ent(a[2]).trim());
    if (m[4]) st.pop();
  }
  return out.sort();
}
const elems = (text, tag) => [...text.matchAll(new RegExp("<" + tag + "[\\s>][\\s\\S]*?</" + tag + ">", "g"))].map((m) => m[0]);
const key = (x) => (x.match(/<GUID>([^<]*)<\/GUID>/) || x.match(/ NAME="([^"]*)"/) || [])[1];
const file = (name, type) => new File([fs.readFileSync(path.join(FX, name))], name, {type: type || ""});
// the JSON as the app turns it into Tally's XML (the whole file, as chosen on Books > From Tally)
async function viaApp(name, bytes){ const f = bytes ? new File([bytes], name) : file(name); const r = await TallyJson.unpack([f]); return r[0]; }
const sortBy = (a, k) => a.slice().sort((x, y) => String(k(x)).localeCompare(String(k(y))));
const canon = (o) => JSON.stringify(o, (k, v) => v instanceof Set ? [...v].sort() : v);

const pairs = [];
for (const [x, j, what] of [["daybook-ui.xml", "daybook-ui.json", "the Day Book of 1-Apr-2026 to 31-Mar-2027 exported on Tally's screen (Alt+F2, Alt+E Current, F8 File Format)"],
                            ["transactions-ui.xml", "transactions-ui.json", "Export > Company Data > Transactions (its own period, May 2026)"],
                            ["daybook-1apr-http.xml", "daybook-1apr-native.json", "the Day Book of 1-Apr-2026 (Tally's port: XML; the JSON request, run 40733556381)"]]) {
  if (fs.existsSync(path.join(FX, x)) && fs.existsSync(path.join(FX, j))) pairs.push([x, j, what]);
}
ok(pairs.length >= 1, "real captures of the same Day Book as XML and as JSON: " + pairs.map((p) => p[1]).join(", "));

for (const [xn, jn, what] of pairs){
  console.log("== " + what + ": " + xn + " / " + jn);
  const X = dec(fs.readFileSync(path.join(FX, xn))), Jraw = fs.readFileSync(path.join(FX, jn)), J = dec(Jraw);
  ok(isJsonText(J) && jsonKindOf(J.slice(0, 262144)) === "daybook", jn + ": told as a Tally JSON Day Book by its content");
  const r = await viaApp(jn);
  ok(r && r.file && !r.why, jn + ": turned into Tally's XML by the app (" + (r.why || (r.file && r.file.size + " bytes")) + ")");
  const T = await r.file.text();
  const xv = elems(X, "VOUCHER"), jv = elems(T, "VOUCHER");
  ok(xv.length && xv.length === jv.length, "the same number of vouchers: XML " + xv.length + ", JSON " + jv.length);
  // field for field
  const jm = new Map(jv.map((v) => [key(v), v]));
  let same = 0; const diffs = [];
  for (const v of xv){ const w = jm.get(key(v)); if (!w){ diffs.push("not in the JSON: " + key(v)); continue; }
    const a = leaves(v), b = leaves(w); if (a.join("\n") === b.join("\n")) same++; else { const A = new Set(a), Bs = new Set(b); diffs.push(key(v) + ": " + a.filter((l) => !Bs.has(l)).slice(0, 3).join(" | ") + " <> " + b.filter((l) => !A.has(l)).slice(0, 3).join(" | ")); } }
  ok(same === xv.length, "every voucher's every non-empty field and attribute the same (" + same + " of " + xv.length + ")" + (diffs.length ? ": " + diffs.slice(0, 3).join(" ; ") : ""));
  // the cloud's reader
  const px = parseDay(xv.map((v) => "<TALLYMESSAGE>" + v + "</TALLYMESSAGE>").join("")), pj = parseDay(T);
  const cv = (p) => canon({v: sortBy(p.vouchers, (v) => v.guid), l: p.lines.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), n: p.n, skipped: p.skipped, alterMax: p.alterMax, dates: p.dates.slice().sort()});
  ok(px.n === xv.length - px.skipped && cv(px) === cv(pj), "parse.js: the same entries and lines, field for field (" + px.n + " entries, " + px.lines.length + " lines, AlterID up to " + px.alterMax + ")");
  // the browser's reader
  const bx = await B.importDayBook(file(xn)), bj = await B.importDayBook(r.file);
  const cb = (q) => canon({v: sortBy(q.vouchers, (v) => v.id), m: q.meta});
  ok(bx.vouchers.length === xv.length - 0 && cb(bx) === cb(bj), "the browser's Books.importDayBook: the same entries, field for field (" + bx.vouchers.length + "), the same company and dates");
  const fx1 = await B.fileCompany(file(xn)), fj1 = await B.fileCompany(r.file);
  // Tally's JSON request names no company (its XML export does, SVCURRENTCOMPANY): the company is then told by its GUID part
  ok(fx1.guid && fx1.guid === fj1.guid && (fj1.name === fx1.name || (!fj1.name && !/svcurrentcompany/i.test(J))), "the company told from the file the same: the GUID part " + fj1.guid + ", the name " + (fj1.name ? "the same (" + fj1.name + ")" : "not in this JSON (the XML's: " + fx1.name + ")"));
  // pieces: any boundary, every encoding
  const whole = jsonScanner().push(J).map(elemXml).join("");
  let cutsOk = true;
  for (const k of [1, 7, 4093, 65536]){
    let st = null, o2 = ""; for (let i = 0; i < J.length; i += k){ const s3 = jsonScanner(st); o2 += s3.push(J.slice(i, i + k)).map(elemXml).join(""); st = JSON.parse(JSON.stringify(s3.state())); }
    if (o2 !== whole) cutsOk = false; }
  ok(cutsOk, "read in pieces of 1, 7, 4,093 and 65,536 characters, the state carried as plain JSON (as FinCom's server does): the same XML");
  const encs = [["UTF-8 with the BOM", Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(J, "utf8")])], ["UTF-16LE with the BOM", Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(J, "utf16le")])], ["UTF-16LE without the BOM", Buffer.from(J, "utf16le")]];
  for (const [w, bytes] of encs){ const r2 = await viaApp(jn, bytes); ok(r2 && r2.file && (await r2.file.text()) === T, jn + " saved as " + w + ": the same XML"); }
}

// the masters
console.log("== the masters (List of Accounts): masters-http.xml / masters-native.json");
if (fs.existsSync(path.join(FX, "masters-native.json"))){
  const X = dec(fs.readFileSync(path.join(FX, "masters-http.xml")));
  const r = await viaApp("masters-native.json");
  ok(r && r.file, "masters-native.json turned into Tally's XML (" + (r.why || r.file.size + " bytes") + ")");
  const T = await r.file.text();
  for (const tag of ["LEDGER", "GROUP", "VOUCHERTYPE", "COSTCENTRE", "COSTCATEGORY", "STOCKITEM", "UNIT", "GODOWN", "CURRENCY"]){
    const xs = elems(X, tag), js = elems(T, tag); const jm = new Map(js.map((v) => [key(v), v]));
    const bad = xs.filter((v) => !jm.has(key(v)) || leaves(v).join("\n") !== leaves(jm.get(key(v))).join("\n"));
    ok(xs.length === js.length && !bad.length, tag + ": " + xs.length + " in the XML, " + js.length + " from the JSON, every field the same" + (bad.length ? " (differ: " + bad.slice(0, 3).map(key).join(", ") + ")" : ""));
  }
  const mx = await B.importMasters(file("masters-http.xml")), mj = await B.importMasters(r.file);
  ok(mx.count > 50 && canon(mx) === canon(mj), "the browser's Books.importMasters: the same ledgers, PANs, GSTINs, groups (" + mx.count + " ledgers)");
  // Export > Company Data > Masters on Tally's screen as JSON (Master.json; zero values left out, as Tally writes it)
  const u = await viaApp("master-ui.json"), mu = await B.importMasters(u.file);
  ok(u.file && canon(mu) === canon(mx), "Master.json exported on Tally's screen: Books.importMasters reads the same ledgers, PANs, GSTINs, groups as List of Accounts' XML (" + mu.count + ")");
}

// a zip of several files (made here: Tally's files stored and deflated), each read as if chosen on its own; an Excel file
console.log("== a zip, Excel, a report as shown");
{
  const zlib = await import("zlib");
  const crc = (b) => { let c = ~0; for (const x of b){ c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; } return ~c >>> 0; };
  const zip = (files) => { const parts = [], cd = []; let off = 0;
    for (const [name, data, deflate] of files){ const nm = Buffer.from(name), body = deflate ? zlib.deflateRawSync(data) : data, c = crc(data);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(c, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
      parts.push(lh, nm, body); cd.push(ch, nm); off += 30 + nm.length + body.length; }
    const cdb = Buffer.concat(cd), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat(parts.concat([cdb, end])); };
  const jn = pairs[0][1], xn = pairs[0][0];
  const z = zip([["Apr/" + jn, fs.readFileSync(path.join(FX, jn)), true], [xn, fs.readFileSync(path.join(FX, xn)), false], ["masters.json", fs.readFileSync(path.join(FX, "masters-native.json")), true], ["__MACOSX/._x", Buffer.from("x"), false]]);
  const out = await TallyJson.unpack([new File([z], "three.zip")]);
  ok(out.length === 3 && out.every((o) => o.file) && out[0].file.name === jn && out[1].file.name === xn && out[2].file.name === "masters.json", "a zip of a JSON Day Book (in a folder), an XML Day Book and JSON masters: three files, each opened (" + out.map((o) => o.file ? o.file.name + " " + o.file.size : o.why).join("; ") + ")");
  const a = await B.importDayBook(out[0].file), b = await B.importDayBook(out[1].file);
  ok(a.vouchers.length === b.vouchers.length && canon(sortBy(a.vouchers, (v) => v.id)) === canon(sortBy(b.vouchers, (v) => v.id)), "the JSON and the XML from the zip read into the same entries (" + a.vouchers.length + ")");
  const xl = zip([["[Content_Types].xml", Buffer.from("<Types/>"), true], ["xl/workbook.xml", Buffer.from("<workbook/>"), true]]);
  const e1 = await TallyJson.unpack([new File([xl], "DayBook.xlsx")]);
  ok(e1[0].why === "DayBook.xlsx: This is an Excel export. Export the Day Book as XML or JSON instead: Day Book → F2 period → E (Export) → Format: XML or JSON.", "an Excel Day Book (.xlsx): " + e1[0].why);
  const e2 = await TallyJson.unpack([new File([Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0])], "DayBook.xls")]);
  ok(/^DayBook\.xls: This is an Excel export\./.test(e2[0].why || ""), "an old Excel file (.xls): said the same (" + e2[0].why + ")");
  const rep = await TallyJson.unpack([new File([JSON.stringify({dspvchdate: ["1-Apr-26"], dspvchledaccount: ["Cash"], dspvchdramt: ["100"]})], "DayBook.json")]);
  ok(/as Tally shows it on the screen/.test(rep[0].why || ""), "a JSON of the report as shown (no entries): said plainly (" + rep[0].why + ")");
  const no = await TallyJson.unpack([new File([JSON.stringify({hello: "world"})], "other.json")]);
  ok(/holds no Tally entries or masters/.test(no[0].why || ""), "a JSON that is not Tally's: said plainly (" + no[0].why + ")");
  const pdf = await TallyJson.unpack([new File([Buffer.from("%PDF-1.7\n")], "DayBook.pdf")]);
  ok(/is a PDF/.test(pdf[0].why || ""), "a PDF: said plainly (" + pdf[0].why + ")");
}
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
