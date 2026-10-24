// node tests/run_call_rules.mjs - the rules FinCom's calls keep (app/src/calls/rules.js), shared by the app and the
// fincom-call function: who hosts and who comes straight in, the peer-to-peer limit, recording and consent, the days a
// recording is kept, the guest tokens (signed, run out, changed), the channel names, chat links, the transcript's order,
// the summary's shape, the .ics, the light-device suggestion, the network levels, working together's route and throttle,
// and remote help's RustDesk link (never a password).
import * as R from "../app/src/calls/rules.js";
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("== rooms");
ok(R.canHost("client", "owner") && R.canHost("class", "staff") && !R.canHost("client", "readonly") && !R.canHost("party", "owner"), "owner and staff host; look-only never; only the four kinds");
ok(R.directEntry("client", { member: true }) && !R.directEntry("client", { verified: true }) && R.directEntry("class", { batchMember: true, verified: true })
   && !R.directEntry("class", { batchMember: true, verified: false }) && !R.directEntry("help", { batchMember: true, verified: true }), "members straight in; a verified batch member to a class; everyone else waits");
ok(R.mediaMode(false) === "p2p" && R.mediaMode(true) === "sfu" && R.maxPeople("p2p") === 4 && R.roomFull("p2p", 4) && !R.roomFull("p2p", 3) && !R.roomFull("sfu", 4), "peer to peer: 4 people at most until Cloudflare's keys are set");
ok(same(R.STUN[0].urls, ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"]), "Cloudflare's free STUN");

console.log("== recording and consent");
ok(!R.recordingAllowed("client", null) && !R.recordingAllowed("client", { allow_recording: false }) && R.recordingAllowed("client", { allow_recording: true }), "a client's call: off unless the owner turned it on");
ok(!R.recordingAllowed("meeting", { client: "c1" }) && R.recordingAllowed("meeting", null) && R.recordingAllowed("class", null) && R.recordingAllowed("help", null), "a meeting for a client follows the client; a class, a help call: the host decides");
ok(R.retainDays("client", null) === 90 && R.retainDays("class", null) === 365 && R.retainDays("client", { retention_days: 30 }) === 30 && R.retainDays("client", { retention_days: 3 }) === 90, "90 days for a client, a year for a class, the client's own between 7 and 3650");
ok(R.retainUntil("class", null, "2026-10-23T05:00:00Z") === "2027-10-23", "a class's recording kept until a year on");
ok(R.mayPublish(false, false) && !R.mayPublish(true, false) && R.mayPublish(true, true), "while recording, nobody sends before they saw the notice and stayed");
ok(R.CONSENT_TEXT === "This call is being recorded", "the notice's words");
ok(R.mayStartRecording([{ notice: true }, {}]) && !R.mayStartRecording([{ notice: true }, { notice: false }]), "not started while someone cannot be shown the notice");

console.log("== tokens");
const secret = "s".repeat(48), room = "11111111-1111-4111-8111-111111111111", p = "22222222-2222-4222-8222-222222222222";
const t = await R.signGuest(secret, room, p, 1_800_000_000);
ok(/^v1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.\d{10}\.[A-Za-z0-9_-]{43}$/.test(t), "a guest pass: v1.room.person.expiry.signature");
ok(same(await R.verifyGuest(secret, t, 1_800_000_100), { room, participant: p, exp: 1_800_000_000 + R.GUEST_SESSION_SECS }), "read back within its hours");
ok((await R.verifyGuest(secret, t, 1_800_000_000 + R.GUEST_SESSION_SECS + 1)) === null, "run out: refused");
ok((await R.verifyGuest("t".repeat(48), t, 1_800_000_100)) === null, "another secret: refused");
const swapped = t.replace(p, "33333333-3333-4333-8333-333333333333");
ok((await R.verifyGuest(secret, swapped, 1_800_000_100)) === null, "another person's id put in: refused");
const later = t.replace(/\.(\d{10})\./, (m, n) => "." + (Number(n) + 99999) + ".");
ok((await R.verifyGuest(secret, later, 1_800_000_100)) === null, "a later expiry put in: refused");
let threw = false; try { await R.signGuest("short", room, p, 0); } catch (e) { threw = true; }
ok(threw, "no pass is signed with a short secret");
const lk = R.randomToken(32);
ok(R.linkTokenOk(lk) && !R.linkTokenOk(lk.slice(1)) && R.randomToken(32) !== lk, "a link token: 32 random bytes, base64url");
ok((await R.sha256Hex("abc")) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 as the database keeps it");
ok(/^\d{6}$/.test(R.otpCode()), "a six-figure code");
ok(R.emailOk("a@b.in") && !R.emailOk("a b@c.in") && !R.emailOk("x") && R.nameOk("Ram") && !R.nameOk("R") && !R.nameOk("<b>x</b>"), "email and name checks");
const t1 = await R.topicFor("k", 1), t2 = await R.topicFor("k", 2), c1 = await R.topicFor("k", 1, "cowork");
ok(/^call:[0-9a-f]{40}$/.test(t1) && t1 !== t2 && /^cowork:/.test(c1) && c1.slice(7) !== t1.slice(5), "channel names: from the key and epoch, never the key; working together its own");

console.log("== chat and transcript");
ok(same(R.chatParts("see https://x.in/a.pdf, then"), [{ text: "see " }, { link: "https://x.in/a.pdf" }, { text: ", then" }]) && same(R.chatParts("javascript:alert(1)"), [{ text: "javascript:alert(1)" }]), "links: http(s) only");
ok(R.chatOk("hi") && !R.chatOk("  ") && !R.chatOk("x".repeat(4001)) && R.FILE_MAX === 20 * 1024 * 1024, "a chat line 1 to 4000 letters; files 20 MB");
ok(R.safeFileName("../../etc/passwd") === ".._.._etc_passwd" && R.safeFileName("bill (1).pdf") === "bill _1_.pdf", "file names made safe");
ok(R.pieceEnds(55000, 0) && R.pieceEnds(9000, 1300) && !R.pieceEnds(5000, 3000) && !R.pieceEnds(20000, 500), "a piece ends at a pause after 8 s, or at 55 s");
const merged = R.mergeTranscript([{ who: "B", start_ms: 9000, text: "two" }, { who: "A", start_ms: 0, text: "one" }, { who: "B", start_ms: 15000, text: "three" }, { who: "A", start_ms: 30000, text: " " }]);
ok(same(merged, [{ who: "A", start_ms: 0, text: "one" }, { who: "B", start_ms: 9000, text: "two three" }]), "in the order said; one person's run joined; empty pieces dropped");
ok(R.transcriptText(merged) === "[00:00] A: one\n[00:09] B: two three", "as text with times");
ok(R.summaryOk({ summary: "x", decisions: [], actions: [{ title: "t", who: "", due: "2026-10-30" }] }) && !R.summaryOk({ summary: "", decisions: [], actions: [] })
   && !R.summaryOk({ summary: "x", decisions: [], actions: [{ title: "t", due: "30/10" }] }), "the summary's shape is checked");

console.log("== the invite");
const ics = R.icsFor({ uid: "r1", title: "Review; year end", start: "2026-10-25T05:30:00Z", minutes: 45, url: "https://staging.fincom.live/#join=x", organizer: { email: "o@a.in", name: "O" } });
ok(ics.includes("DTSTART:20261025T053000Z") && ics.includes("DTEND:20261025T061500Z") && ics.includes("SUMMARY:Review\\; year end") && ics.split("\r\n").every((l) => l.length <= 75), "an .ics: times in UTC, text escaped, lines folded");

console.log("== device and network");
ok(R.weakDevice({ hardwareConcurrency: 4 }) && R.weakDevice({ hardwareConcurrency: 8, deviceMemory: 2 }) && !R.weakDevice({ hardwareConcurrency: 8, deviceMemory: 8 }), "a light device: blur only suggested");
ok(same(R.effectsClean({ bg: "laser", touch: 7 }), { bg: "none", image: "", light: false, touch: 1 }) && same(R.effectsClean(null), R.EFFECTS_OFF), "effects off by default, cleaned");
ok(R.sendLevel(2e6, 0) === "high" && R.sendLevel(6e5, 0) === "mid" && R.sendLevel(2e5, 0) === "low" && R.sendLevel(1e5, 0) === "audio" && R.sendLevel(0, 0.2) === "audio", "a weak line: smaller picture, then audio only");
ok(R.layerFor(800) === "f" && R.layerFor(400) === "h" && R.layerFor(200) === "q" && R.layerFor(800, true) === "q", "the SFU layer by tile width");

console.log("== working together");
ok(R.mayCowork({ member: true }, true) && !R.mayCowork({ member: true }, false) && !R.mayCowork({ guest: true, member: false }, true), "members who can read the client; never a guest");
ok(same(R.routeOf({ view: "company", coId: "c1", tab: "books", books: { vouchers: [1] }, entries: {} }), { view: "company", coId: "c1", tab: "books" }), "only the route is sent, never data");
ok(same(R.routeClean({ view: "x".repeat(200), tab: "bank", evil: "1" }), { tab: "bank" }), "a route read back: known keys, short values");
let n = 0, clockMs = 0; const th = R.throttle(() => n++, R.POINTER_MS, () => clockMs);
for (let i = 0; i < 100; i++) { clockMs += 5; th(); }
ok(n <= 11 && n >= 9 && R.POINTER_MS === 50, "pointer updates about 20 a second (%d in 0.5 s)".replace("%d", n));

console.log("== remote help (RustDesk)");
ok(R.mayRemote("owner") && R.mayRemote("staff") && !R.mayRemote("readonly"), "owner or staff only");
ok(R.rustdeskUri("123 456 789") === "rustdesk://connection/new/123456789" && R.rustdeskUri("bad id!") === "", "RustDesk's own link, spaces dropped; a wrong ID gives none");
ok(!R.rustdeskUri("123456789").includes("password"), "never a password in the link");

console.log("== meeting codes and links");
const codes = new Set(); for (let i = 0; i < 2000; i++) codes.add(R.meetCode());
ok([...codes].every((c) => R.codeOk(c) && !/[ilo]/.test(c) && c.replace(/-/g, "").length === 10), "abc-defg-hij: ten lowercase letters, never i, l or o");
ok(codes.size === 2000, "2000 codes, no repeat");
ok(R.codeFrom(" ABC DEFG HJK ") === "abc-defg-hjk" && R.codeFrom("abcdefghjk") === "abc-defg-hjk" && R.codeFrom("https://staging.fincom.live/review/#/join/abc-defg-hjk") === "abc-defg-hjk", "typed with spaces, capitals, no dashes, or the whole link");
ok(R.codeFrom("abc-defg-hij") === "" && R.codeFrom("abc-def-hjk") === "" && R.codeFrom("") === "", "a code with a confusable letter or too short is no code");
ok(R.joinLink("https://staging.fincom.live/review/?v=1#/meetings", "abc-defg-hjk") === "https://staging.fincom.live/review/#/join/abc-defg-hjk", "one stable link from the page FinCom is on");
const inv = R.inviteText({ title: "Year-end review", host: "Anshul", firm: "Garg & Co", url: "https://x/#/join/abc-defg-hjk", code: "abc-defg-hjk", at: "2026-10-25T05:30:00Z", minutes: 45 });
ok(inv.includes("25-Oct-2026 11:00 IST") && inv.includes("Meeting code: abc-defg-hjk") && inv.includes("Join: https://x/#/join/abc-defg-hjk"), "the invitation: time in IST, link and code");
const mt = R.mailtoUrl(["a@x.test", "b@x.test"], "Invitation: X", "Join: https://x/#/join/a & b");
ok(mt.startsWith("mailto:a%40x.test,b%40x.test?subject=Invitation%3A%20X&body=") && mt.includes("%26"), "the mail app's link, everything encoded");
const g = R.googleCalUrl({ title: "Review", at: "2026-10-25T05:30:00Z", minutes: 45, url: "https://x/#/join/abc-defg-hjk" });
ok(g.startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE&text=Review&dates=20261025T053000Z/20261025T061500Z"), "Add to Google Calendar: the template link with start and end");

console.log("== subtitles");
ok(R.SUB_LANGS.length === 13 && R.subLangOk("ta") && R.subLangOk("hinglish") && !R.subLangOk("xx"), "13 languages");
ok(R.defaultSubLang(["ta-IN", "en"]) === "ta" && R.defaultSubLang(["fr-FR"]) === "en" && R.defaultSubLang([]) === "en", "the browser's language first, else English");
ok(R.whisperLang("tamil") === "ta" && R.whisperLang("Hindi") === "hi" && R.whisperLang("en") === "en", "Whisper's language read");
ok(same(R.subTargets([{ subs: true, lang: "hi" }, { subs: true, lang: "en" }, { subs: false, lang: "te" }, { subs: true, lang: "ta" }, { subs: true, lang: "hi" }], "ta"), ["hi", "en"]), "only languages switched on, once each, never the speaker's own");
ok(!R.subsNeeded([{ subs: false }], false) && R.subsNeeded([{ subs: true }], false) && R.subsNeeded([], true), "pieces only when someone reads subtitles or the transcript is kept");
const line = { text: "வணக்கம்", lang: "ta", tr: { hi: "नमस्ते", en: null } };
ok(R.subLine(line, "hi").text === "नमस्ते" && R.subLine(line, "ta").text === "வணக்கம்" && R.subLine(line, "en").paused && R.subLine(line, "en").text === "வணக்கம்", "each reads their own language; paused: the words as said");
ok(R.termsKept("Send Sharma Traders ₹1,25,000 for GSTR-3B under 194J", "Sharma Traders को ₹125000 GSTR-3B 194J के लिए भेजें", ["Sharma Traders"]), "a translation that kept names, amount and tax terms is taken");
ok(!R.termsKept("Pay 1,25,000 today", "आज भुगतान करें", []) && !R.termsKept("File GSTR-3B", "जीएसटीआर फाइल करें", []) && !R.termsKept("ask sharma traders", "व्यापारी से पूछें", ["Sharma Traders"]), "one that lost the amount, the return's name or a client's name is not");
ok(R.termsKept("Please send the bills", "कृपया बिल भेजें", []), "an ordinary capital at the start is no term");
ok(R.subPrompt("hi", ["Sharma Traders"]).includes("Sharma Traders") && R.subPrompt("hi").includes("194J") && R.subPrompt("hinglish").includes("Latin"), "the translation keeps names, amounts and tax terms");

console.log("\n" + (fails ? fails + " FAILED" : "all passed"));
process.exit(fails ? 1 : 0);
