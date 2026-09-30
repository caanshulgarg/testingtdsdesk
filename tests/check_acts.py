"""python3 check_acts.py - every action a React screen asks for by name has a handler: each doAct("x") and <Act act="x">
is a case in doAct (src/js/27), each bankAct("x") and bank <Btn act="x"> a case in bankClick (src/js/23). A name
with no case does nothing when pressed, silently."""
import re, glob, os, sys
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
files = glob.glob(os.path.join(root, "app/src/**/*.jsx"), recursive=True)
acts, bank = set(), set()
for f in files:
    s = open(f).read()
    acts |= set(re.findall(r'doAct\("([A-Za-z0-9]+)"', s)); bank |= set(re.findall(r'bankAct\("([A-Za-z0-9]+)"', s))
    m = re.search(r'const (?:Act|Btn|Sup) = \(\{ act[^;]*?=> \{?\s*(\w+)\(act', s)
    names = set(re.findall(r'<(?:Act|Btn) act="([A-Za-z0-9]+)"', s))
    if m and m.group(1) == "bankAct": bank |= names
    elif m and m.group(1) == "doAct": acts |= names
src = lambda pat: open(glob.glob(os.path.join(root, "src/js", pat))[0]).read()
s27, s23 = src("27-*.js"), src("23-*.js")
cases = set(re.findall(r'case "([A-Za-z0-9]+)"', s27[s27.index("function doAct(act, t){"):]))
bcases = set(re.findall(r'case "([A-Za-z0-9]+)"', s23[s23.index("function bankClick(t){"):]))
miss = sorted(a for a in acts if a not in cases) + sorted("bank:" + a for a in bank if a not in bcases)
print("  ok   every action has a handler (%d doAct, %d bankAct)" % (len(acts), len(bank)) if not miss else "  FAIL no handler for: " + ", ".join(miss))
print("\nall passed" if not miss else "\nFAILED: 1"); sys.exit(1 if miss else 0)
