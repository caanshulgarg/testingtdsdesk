// node run_hang_invoker.mjs - hang-tally-sync (review of the "Page blocked" figures, FINCOM-APP-STAGING-G): what the hang
// reporter (app/src/hangWatch.js frameTags, invokerOf) sends of a long animation frame:
//   1. the invoker: an entry point's code name only (TimerHandler:setTimeout, DIV.onclick, IDBRequest.onsuccess); never
//      for a script file's own run (classic-script, module-script: its invoker is the file's address); an invoker that
//      carries an address (IFRAME[src=/review/client/<id>/...].onload, a URL) or an id (#...) is cut there or not sent;
//   2. render_ms: the rendering step without the scripts run in it (requestAnimationFrame callbacks from renderStart on),
//      which count in script_ms; other_ms the rest; nothing negative.
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { frameTags, invokerOf } = await import(path.join(HERE, "..", "app", "src", "hangWatch.js"));
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const inv = (invoker, invokerType = "event-listener") => invokerOf({ invoker, invokerType });

console.log("1. the invoker");
ok(inv("TimerHandler:setTimeout", "user-callback") === "TimerHandler:setTimeout" && inv("DIV.onclick") === "DIV.onclick" && inv("IDBRequest.onsuccess") === "IDBRequest.onsuccess", "code names kept");
ok(inv("https://staging.fincom.live/review/legacy.js", "classic-script") === "" && inv("https://staging.fincom.live/review/assets/index-x.js", "module-script") === "", "a script file's own run: no invoker");
ok(inv("IFRAME[src=/review/client/c000115838/books].onload") === "", "IFRAME[src=/review/client/<id>/...].onload: not sent (" + inv("IFRAME[src=/review/client/c000115838/books].onload") + ")");
ok(inv("DIV#zz-c000115838.onclick") === "", "an element's id: not sent (" + inv("DIV#zz-c000115838.onclick") + ")");
ok(inv("Window.fetch.then://x.example/c000115838") === "Window.fetch.then" || inv("Window.fetch.then://x.example/c000115838") === "", "an address after :// is cut off");
ok(inv("ALPHA TRADERS") === "" && inv("") === "" && invokerOf(null) === "", "words or nothing: not sent");
const t = frameTags([{ startTime: 1000, duration: 3000, renderStart: 3500, styleAndLayoutStart: 3800, scripts: [
  { startTime: 1000, duration: 2000, invoker: "IFRAME[src=/review/client/c000115838/books].onload", invokerType: "event-listener" },
  { startTime: 3500, duration: 200, invoker: "FrameRequestCallback", invokerType: "user-callback" }] }]);
ok(!("invoker" in t), "the longest script's invoker carries an address: no invoker tag (" + JSON.stringify(t) + ")");

console.log("2. the rendering step without its scripts");
ok(t.script_ms === "2200" && t.render_ms === "300" && t.style_ms === "200" && t.other_ms === "500", "script 2,200, render 300 (500 less the 200 ms rAF script), style 200, other 500: " + JSON.stringify(t));
const n = frameTags([{ startTime: 0, duration: 100, renderStart: 50, scripts: [{ startTime: 50, duration: 90 }] }]);
ok(Object.values(n).every((v) => !/^-/.test(v)), "nothing negative (" + JSON.stringify(n) + ")");

console.log(fails ? "\nFAILED: " + fails : "\nall passed");
process.exit(fails ? 1 : 0);
