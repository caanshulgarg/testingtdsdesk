// node tests/run_own_rule.mjs - the final review of next-fix-linkedguid: the page's "open in your own Tally" follows the
// bridge's ONE rule for reads and postings (bridge-go linkguid.go tallyToPost over ownersUntold): a Tally whose owner
// Windows cannot tell counts as this user's only while Windows tells the owner of no Tally; such a company's words are
// the posting's ("Tally on port N has it open, but Windows cannot tell whose…"). A plain PC where no owner is known: as
// before. Made-up companies only. Exits 1 on a failure.
import { ownRule, hereNames, untoldOf, untoldWords, upBeat } from "../app/src/lib/ownBridge.js";

let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const co = (...n) => n.map((name) => ({ name }));
const sess = (port, mine, cs, extra) => Object.assign({ port, ok: true, skipped: false, companies: co(...cs) }, mine === undefined ? {} : { mine }, extra || {});
const open = (ss) => ss.flatMap((s) => s.companies.map((c) => ({ name: c.name, port: s.port, mine: s.mine })));
const st = (ss) => ({ sessions: ss, open: open(ss) });
const names = (s) => [...hereNames(s).values()].sort();

// a shared server: this user's own Tally, and one whose owner Windows cannot tell
const shared = st([sess(9000, true, ["A CO"]), sess(9001, null, ["B CO"])]);
ok(JSON.stringify(names(shared)) === '["A CO"]', "shared: only this user's own Tally's companies (" + names(shared) + ")");
const u = untoldOf(shared);
ok(u.get("b co") && u.get("b co").join(",") === "9001" && !u.has("a co"), "shared: the owner-unknown Tally's company is said where (" + [...u] + ")");
ok(untoldWords(u.get("b co")) === "Tally on port 9001 has it open, but Windows cannot tell whose Tally that is (it may be running as administrator), so nothing is sent to it; run Tally normally as your own Windows user",
  "the posting's words: " + untoldWords(u.get("b co")));
// another user's Tally named: the owner-unknown one still left out
const other = st([sess(9000, false, ["C CO"], { skipped: true }), sess(9001, undefined, ["B CO"])]);
ok(names(other).length === 0 && untoldOf(other).has("b co"), "another user's (skipped) told: the owner-unknown one is not this user's (" + names(other) + ")");
// a plain PC: no owner told
const plain = st([sess(9000, null, ["B CO"])]);
ok(JSON.stringify(names(plain)) === '["B CO"]' && untoldOf(plain).size === 0, "plain PC: as before (" + names(plain) + ")");
const plainNoSess = { open: [{ name: "B CO", port: 9000 }] };
ok(JSON.stringify(names(plainNoSess)) === '["B CO"]', "an older answer with no sessions: as before (" + names(plainNoSess) + ")");
// the rule itself
const r = ownRule([{ mine: true }, { mine: null }]);
ok(r({ mine: true }) && !r({ mine: null }) && !r({ mine: false }) && !r({}), "rule: told elsewhere, unknown is not own");
const r2 = ownRule([{ mine: null }, {}]);
ok(r2({ mine: null }) && r2({}) && !r2({ mine: false }), "rule: none told, unknown is own; another's never");
// the beat: openElsewhere owner unknown (the bridge's own rule there)
const bu = untoldOf({ beat: { companies: [{ name: "B CO", open: false, openElsewhere: { port: 9001, why: "owner unknown" } }, { name: "D CO", open: false, openElsewhere: { port: 9002, why: "other user" } }] } });
ok(bu.get("b co") && bu.get("b co").join(",") === "9001" && !bu.has("d co"), "beat: the owner-unknown Tally said where (" + [...bu] + ")");

// the beat's ports (owner "unknown" when Windows cannot tell): this user's Tally answers only by the same rule
const port = (p, ok, owner, extra) => Object.assign({ port: p, ok, skipped: false, owner: owner || "", reason: ok ? "open" : "not answering" }, extra || {});
ok(!upBeat({ ports: [port(9000, false), port(9001, true, "unknown")] }), "beat: own Tally down, only an owner-unknown one answers while another owner is known: not up");
ok(!upBeat({ ports: [port(9000, false, "", { skipped: true, reason: "another user" }), port(9001, true, "unknown")] }), "beat: another user's told, the owner-unknown one answers: not up");
ok(upBeat({ ports: [port(9000, true), port(9001, true, "unknown")] }), "beat: own Tally answers: up");
ok(upBeat({ ports: [port(9001, true, "unknown")] }), "beat: plain PC, the owner-unknown one answers: up (as before)");
ok(upBeat({ ports: [], tally: true }) && !upBeat({ ports: [] }), "beat: no ports said: the beat's tally flag (as before)");

console.log(fails ? "\n" + fails + " failure(s)" : "\nall passed");
process.exit(fails ? 1 : 0);
