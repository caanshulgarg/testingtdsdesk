// node run_cloudup.js - a part of the day book chosen in FinCom goes to FinCom's cloud: every day of the dates chosen,
// each day's entries only (an empty day sent as empty), in batches the cloud takes; the trial balance's openings too
const zlib = require("zlib");
const {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["num", "BridgeSeed", "TCloudUp"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const posts = [];
Object.assign(ctx, {Blob, Response, CompressionStream, btoa, fetch: async (url, o) => { posts.push(JSON.parse(o.body)); return {ok: true, json: async () => ({ok: true, done: (JSON.parse(o.body).days || []).map(d => d.day)})}; },
  Cloud: {on: () => true, st: {firm: {id: "f"}}, cfg: () => ({key: "anon"}), sess: () => ({access_token: "t"})}, TCloud: {ingestUrl: () => "https://x/functions/v1/tally-ingest"},
  CO: () => ({name: "Test"}), Bridge: {openFor: () => ({name: "Test Co"})}});
ctx.S.coId = "c1";
const v = (d, k) => '<VOUCHER VCHTYPE="Sales"><DATE>' + d + "</DATE><GUID>g" + d + k + "</GUID><ALTERID>" + k + "</ALTERID></VOUCHER>";
const text = "<ENVELOPE>" + ["20250402", "20250402", "20250415", "20250601", "20250710"].map((d, i) => "<TALLYMESSAGE>" + v(d, i) + "</TALLYMESSAGE>").join("") + "</ENVELOPE>";
(async () => {
  const r = await x.TCloudUp.days(text, {from: "20250401", to: "20250630"}, null);
  const days = posts.flatMap(p => p.days || []);
  ok(r.days === 91 && days.length === 91, "every day of 1 April to 30 June sent: " + days.length);
  ok(posts.every(p => p.kind === "upload_days" && p.client === "c1" && p.company === "Test Co" && (p.days || []).length <= 31), "in batches of a month at most, for this client (" + posts.length + " requests)");
  const unz = d => zlib.gunzipSync(Buffer.from(days.find(z => z.day === d).gz, "base64")).toString();
  ok((unz("20250402").match(/<VOUCHER /g) || []).length === 2 && !/<VOUCHER /.test(unz("20250403")), "each day carries its own entries; an empty day is sent empty");
  ok(!days.some(z => z.day === "20250710"), "nothing outside the dates chosen");
  posts.length = 0;
  await x.TCloudUp.opening("20250401", "20250331", {"HDFC BANK": {open: -1000, parent: "Bank Accounts"}});
  ok(posts[0].kind === "upload_ledgers" && posts[0].openAsOn === "20250331" && posts[0].ledgers[0][0] === "HDFC BANK" && posts[0].ledgers[0][2] === "-1000", "the opening balances go too, as on the day before");
  ctx.Cloud.on = () => false;
  const r2 = await x.TCloudUp.days(text, {from: "20250401", to: "20250430"});
  ok(r2.skipped && /signed in/.test(r2.skipped), "not signed in: nothing sent, and it says so");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
