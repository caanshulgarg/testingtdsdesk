// node --experimental-strip-types test-crypto.mjs  (after: npm i aes-js@3.1.2) - GSTN decryption against VMS's real March 2B
import aesjs from "aes-js"; import { makeGstCrypto } from "./gstcrypto.ts"; import fs from "fs"; import crypto from "crypto";
const C = makeGstCrypto(aesjs);
const pad = u => { const n = 16 - (u.length % 16); const o = new Uint8Array(u.length + n); o.set(u); o.fill(n, u.length); return o; };
const enc = (key, bytes) => Buffer.from(new aesjs.ModeOfOperation.ecb(key).encrypt(pad(bytes))).toString("base64");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
// as the GSP and GSTN would: app_key (32 chars), SEK, REK, the 2B JSON as base64
const appKey = "Xo8lBiPr3atUJ7c0LjG2kDHVAThCvMZE", sek = crypto.randomBytes(32), rek = crypto.randomBytes(32);
const real = fs.readFileSync("/mnt/user-data/uploads/returns_R2B_07AADCV3366N1ZU_032026.json", "utf8"), j = JSON.parse(real).data;
const sekEnc = enc(Buffer.from(appKey, "utf8"), sek), rekEnc = enc(sek, rek), dataEnc = enc(rek, Buffer.from(Buffer.from(JSON.stringify(j)).toString("base64")));
const out = C.openData(dataEnc, rekEnc, sekEnc, appKey);
ok(out.gstin === "07AADCV3366N1ZU" && out.rtnprd === "032026" && JSON.stringify(out) === JSON.stringify(j), "VMS's real March 2B, encrypted as GSTN does, comes back whole (" + Object.keys(out.docdata).join(", ") + ")");
// a REK sent as base64 text inside the cipher, and data sent as plain JSON inside
const rekEnc2 = enc(sek, Buffer.from(rek.toString("base64"))), dataEnc2 = enc(rek, Buffer.from(JSON.stringify({x: 1})));
ok(C.openData(dataEnc2, rekEnc2, sekEnc, appKey).x === 1, "also when the REK is base64 text and the data plain JSON");
// an app_key given as base64 of 32 bytes
const ak2 = crypto.randomBytes(32), sekEnc3 = enc(ak2, sek);
ok(C.openData(dataEnc, rekEnc, sekEnc3, ak2.toString("base64")).gstin === "07AADCV3366N1ZU", "and when the app_key is base64 of 32 bytes");
let err = ""; try { C.openData(dataEnc, rekEnc, sekEnc, "Yo8lBiPr3atUJ7c0LjG2kDHVAThCvMZE"); } catch (e) { err = e.message; }
ok(/padding|JSON|Unexpected/.test(err), "a wrong key is caught, never returned as data (" + err + ")");
console.log(fails ? fails + " FAILED" : "all passed");
