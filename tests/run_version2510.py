"""python3 run_version2510.py - bridge 2.5.10 is the first version with a two-digit last part: every place that compares a
bridge's version compares it as numbers (2.5.10 > 2.5.9), never as text ("2.5.10" < "2.5.9"). Each comparison is taken
from its own source as written and run under Node:
  - the cloud: tally-ingest's newer / atLeast (the release offered, the features a bridge has), updategate.js olderThan;
  - the page: the Tally page's vnum and verAtLeast (screens/Tally.jsx: "Install FinCom Bridge <latest>", the light row),
    lib/tallySimple.js, lib/connectSteps.js vk, lib/tallyConnect.js's k, and legacy's bridgeVer (src/js/24-tally-bridge.js).
The bridge's own self-update (update.go newerVersion) is the Go test TestR2510Versions."""
import os, re, sys, json, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, "..")
NODE = shutil.which("node") or "/opt/node22/bin/node"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def src(path): return open(os.path.join(ROOT, path), encoding="utf-8").read()
def grab(path, rx, what):
    m = re.search(rx, src(path), re.S | re.M)
    ok(bool(m), "%s: %s found in its source" % (path, what))
    return m.group(0) if m else ""
ts = lambda s: re.sub(r"\((\w+): (?:string|unknown)(?:, (\w+): (?:string|unknown))?\)(?:: \w+)?", lambda m: "(" + ", ".join(x for x in m.groups() if x) + ")", s)
parts = {
    "newer": ts(grab("server/tally-cloud/index.ts", r"^const newer = .*?;$", "newer")),
    "atLeast": ts(grab("server/tally-cloud/index.ts", r"^function atLeast\(.*?\n\}", "atLeast")),
    "olderThan": grab("server/tally-cloud/updategate.js", r"^export function olderThan\(.*?\n\}", "olderThan").replace("export ", ""),
    "vnum": grab("app/src/screens/Tally.jsx", r"^const vnum = .*?;$", "vnum"),
    "verAtLeast": grab("app/src/screens/Tally.jsx", r"^const verAtLeast = .*?return true; \};", "verAtLeast"),
    "vkSimple": grab("app/src/lib/tallySimple.js", r"^const vk = .*?;$", "vk").replace("const vk", "const vkSimple"),
    "vkSteps": grab("app/src/lib/connectSteps.js", r"^const vk = .*?;$", "vk").replace("const vk", "const vkSteps"),
    "kConnect": grab("app/src/lib/tallyConnect.js", r"const k = \(x\) => .*?;$", "k").strip().replace("const k", "const kConnect"),
    "bridgeVer": "const num = (x) => Number(x) || 0;\n" + grab("src/js/24-tally-bridge.js", r"^function bridgeVer\(v\)\{.*?\}$", "bridgeVer"),
}
js = "\n".join(parts.values()) + """
const r = {
  newer: [newer("2.5.10", "2.5.9") > 0, newer("2.5.9", "2.5.10") < 0, newer("2.5.10", "2.5.10") === 0],
  atLeast: [atLeast("2.5.10", "2.5.3"), atLeast("2.5.10", "2.5.10"), !atLeast("2.5.9", "2.5.10")],
  olderThan: [olderThan("2.5.9", "2.5.10"), !olderThan("2.5.10", "2.5.9")],
  vnum: [vnum("2.5.10") > vnum("2.5.9"), vnum("2.5.9") < vnum("2.5.10")],
  verAtLeast: [verAtLeast("2.5.10", "2.5.9"), !verAtLeast("2.5.9", "2.5.10")],
  vkSimple: [vkSimple("2.5.10") > vkSimple("2.5.9"), vkSimple("2.5.10") >= vkSimple("2.5.3")],
  vkSteps: [vkSteps("2.5.10") > vkSteps("2.5.9")],
  kConnect: [kConnect("2.5.10") >= kConnect("2.4.8"), kConnect("2.5.10") > kConnect("2.5.9")],
  bridgeVer: [bridgeVer("2.5.10") > bridgeVer("2.5.9"), bridgeVer("2.5.10") >= bridgeVer("1.12.3")],
};
console.log(JSON.stringify(r));
"""
if not fails:
    p = subprocess.run([NODE, "-e", js], capture_output=True, text=True)
    ok(p.returncode == 0, "the comparisons run (%s)" % p.stderr.strip()[:300])
    if p.returncode == 0:
        for k, v in json.loads(p.stdout).items():
            ok(all(v), "%s: 2.5.10 compared as numbers with 2.5.9 (%s)" % (k, v))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
