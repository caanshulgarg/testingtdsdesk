// deno test server/fincom-transcribe/names_test.ts (run by tests/run_transcribe_server.py). Whisper's words made right:
// Devanagari to English letters for Hinglish, the client's names and the firm's words corrected only on a confident,
// unique match, an amount never changed, and the AI step's answer refused when a number changed.
import { checkAiFix, correctNames, devanagariShare, diffWords, soundKey, toLatin, variantsOf } from "./names.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

const NAMES = [
  { name: "Richa Khandelwal", group: "Sundry Debtors" },
  { name: "HDFC Bank A/c", group: "Bank Accounts" },
  { name: "AIR ESS EXIM PRIVATE LIMITED", group: "Sundry Creditors" },
  { name: "Cash", group: "Cash-in-Hand" },
  { name: "Salary", group: "Indirect Expenses" },
  { name: "Larkspur Sales @ 18%", group: "Sales Accounts" },
  "Leads Insurance Private Limited",
  "Karan Mehta",
];

Deno.test("Devanagari to English letters: a small fixed mapping", () => {
  eq(toLatin("रिचा खंडेलवाल को एक लाख का पेमेंट"), "richa khandelval ko ek lakh ka pement", "a Hinglish sentence");
  eq(toLatin("टैली में एंट्री करो"), "taili men entri karo", "Tally, an entry");
  eq(toLatin("ज़रूरी फ़ाइल ५०० रुपये"), "zaruri fail 500 rupye", "nukta letters and Devanagari digits");
  eq(toLatin("TDS 194J का चालान"), "TDS 194J ka chalan", "English words stay as they are");
  assert(devanagariShare("रिचा को 1 lakh") > 0.5 && devanagariShare("Richa ko 1 lakh") === 0, "the share of Devanagari letters");
  // and then the names: khandelval -> Khandelwal
  eq(correctNames(toLatin("रिचा खंडेलवाल को एक लाख का पेमेंट"), NAMES).text, "Richa Khandelwal ko ek lakh ka pement", "transliterated, then the name corrected");
});

Deno.test("the sound key: Indian spellings of one name meet", () => {
  eq(soundKey("Khandelwaal"), soundKey("Khandelwal"), "aa and a");
  eq(soundKey("khandelval"), soundKey("Khandelwal"), "v and w");
  eq(soundKey("Leeds"), soundKey("Leads"), "ee and ea");
  assert(soundKey("Mehta") !== soundKey("Gupta"), "different names differ");
  eq(variantsOf("HDFC Bank A/c").map((v) => [v.said, v.to]), [["HDFC Bank A/c", "HDFC Bank A/c"], ["HDFC Bank", "HDFC Bank A/c"]], "A/c: said without it, written as in Tally");
  eq(variantsOf("Leads Insurance Private Limited").map((v) => [v.said, v.to])[1], ["Leads Insurance", "Leads Insurance"], "Private Limited: said and written without it");
});

Deno.test("names corrected: the owner's cases", () => {
  const r = correctNames("richa khandelwaal ko 1 lakh ka payment, teddy mein entry", NAMES);
  eq(r.text, "Richa Khandelwal ko 1 lakh ka payment, Tally mein entry", "a party's name and Tally");
  eq(r.changes, [{ from: "richa khandelwaal", to: "Richa Khandelwal" }, { from: "teddy", to: "Tally" }], "the changes, from and to");
  eq(correctNames("leeds insurance ke liye bill", NAMES).text, "Leads Insurance ke liye bill", "the firm's client, without Private Limited");
  eq(correctNames("hdfc bank se transfer", NAMES), { text: "HDFC Bank A/c se transfer", changes: [{ from: "hdfc bank", to: "HDFC Bank A/c" }], doubts: [] }, "a bank ledger, written as in Tally");
  eq(correctNames("Air Ess Exim ka bill.", NAMES).text, "AIR ESS EXIM ka bill.", "a creditor said without Private Limited; the full stop kept");
  eq(correctNames("gst r1 aur gstr 3b file karo, 2 lac ka tax", NAMES).text, "GSTR-1 aur GSTR-3B file karo, 2 lakh ka tax", "the firm's words: returns, lakh after a number");
  eq(correctNames("Richa Khandelwal ko payment", NAMES).changes, [], "already right: no change");
  eq(correctNames("cash aur salary", NAMES).changes, [], "a single everyday word that differs only in capitals is left alone");
  eq(correctNames("karna hai kal", NAMES).changes, [], "a Hindi word near a name (karna, Karan) is never changed");
});

Deno.test("an unsure or shared name is left alone", () => {
  const two = ["Mohan Lal", "Mohan Lall"];
  const r = correctNames("mohan laal ko 5000 do", two);
  eq(r.text, "mohan laal ko 5000 do", "two names as near: neither is chosen");
  eq(r.changes, [], "no change");
  assert(r.doubts.includes("Mohan Lal") && r.doubts.includes("Mohan Lall"), "both kept as doubts for the AI step: " + JSON.stringify(r.doubts));
  eq(correctNames("sharma traders", ["Sharma Traders Delhi", "Sharma Traders Agra"]).changes, [], "a name two ledgers start with: left alone");
  eq(correctNames("verma ji ka hisaab", NAMES).changes, [], "a name not in the books: left alone");
});

Deno.test("amounts are never changed", () => {
  const names = ["Shree 420 Traders", "Unit 7 Rentals", "Larkspur Sales @ 18%"];
  for (const s of ["1,25,000 ka payment", "shree 421 traders ko 500", "unit 1 rentals se 18 percent", "194J ka TDS 10 percent", "2.5 lakh rupees aur 3 crore"]) {
    const r = correctNames(s, names);
    eq((r.text.match(/\d[\d,.]*/g) || []).join("|"), (s.match(/\d[\d,.]*/g) || []).join("|"), "the numbers of " + JSON.stringify(s));
  }
  eq(correctNames("shree 420 tradrs ko 500", names).text, "Shree 420 Traders ko 500", "a name with its own number, said with the same number, is corrected");
});

Deno.test("the AI step's answer: taken only with every number unchanged and only names' or the firm's words new", () => {
  const before = "mohan laal ko 1,25,000 ka payment teddy mein";
  const allowed = ["Mohan Lal", "Mohan Lall"];
  eq(checkAiFix(before, "Mohan Lal ko 1,25,000 ka payment Tally mein", allowed), { ok: true }, "names and Tally fixed");
  eq(checkAiFix(before, "Mohan Lal ko 1,52,000 ka payment Tally mein", allowed).ok, false, "a changed amount: refused");
  eq(checkAiFix(before, "Mohan Lal ko 1,25,000 ka payment Tally mein 2 baar", allowed).ok, false, "a number added: refused");
  eq(checkAiFix("ek lakh ka payment", "do lakh ka payment", allowed).ok, false, "a number word changed: refused");
  eq(checkAiFix(before, "Mohan Lal ko 1,25,000 ka receipt Tally mein", allowed).why, "word", "a word that is not a name's: refused (the meaning)");
  eq(checkAiFix(before, "", allowed).ok, false, "empty: refused");
  eq(diffWords(before, "Mohan Lal ko 1,25,000 ka payment Tally mein"), [{ from: "mohan laal", to: "Mohan Lal" }, { from: "teddy", to: "Tally" }], "the changes, from and to");
});
