"""python3 run_cloud_groups.py - review of 01-Oct-2026: the cloud copy keeps every ledger with its group, Tally's groups
(so each ledger's chain up to its primary group is known), and the party's GSTIN, HSN and GST rate on entries.
The bridge (TDSBridge.ps1) runs against the fake Tally with made-up books (make_fake_books.py) and the fake cloud;
the cloud's parser (server/tally-cloud/parse.js) reads the days it got. Needs PowerShell 7 (PWSH, default /opt/pwsh/pwsh)."""
import os as _os, shutil as _sh, sys
HERE = _os.path.dirname(_os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_fake_books
DATA = make_fake_books.main(_os.path.join(HERE, "out", "fakebooks"))
_os.environ["TDSDESK_DATA"] = DATA
BRUN = _os.path.join(HERE, "out", "cloudgroups")
_sh.rmtree(BRUN, ignore_errors=True); _os.makedirs(BRUN, exist_ok=True)
_sh.copy(_os.path.join(HERE, "..", "bridge", "TDSBridge.ps1"), _os.path.join(BRUN, "TDSBridge.ps1"))
_sh.copy(_os.path.join(HERE, "fake.json"), _os.path.join(BRUN, "fake.json"))
for f in __import__("glob").glob(_os.path.join(HERE, "out", "fake-tally-*.pkl")): _os.remove(f)    # the made-up books read afresh
import json, os, time, subprocess, urllib.request, urllib.parse, glob, re
import fake_tally, fake_cloud
fake_tally.start(); fake_cloud.start()
os.environ["TDSBRIDGE_FAKE"] = _os.path.join(BRUN, "fake.json")
FROM = "20260301"
json.dump({"TallyTimeoutSec": 20, "KeepInStep": True, "KeepStartSec": 3, "KeepCycleSec": 3, "KeepBudgetSec": 30, "KeepCheckEvery": 4, "KeepIdleMin": 1,
           "KeepFrom": FROM, "KeepSharePct": 100, "KeepNightSharePct": 100, "CloudLinksSec": 5, "CloudStateSec": 5, "CloudBatchKB": 400}, open(_os.path.join(BRUN, "tds-bridge.config.json"), "w"))
br = subprocess.Popen([os.environ.get("PWSH", "/opt/pwsh/pwsh"), "-NoProfile", "-File", _os.path.join(BRUN, "TDSBridge.ps1")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=BRUN)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def until(fn, secs=180, step=1.0):
    t = time.time()
    while time.time() - t < secs:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        time.sleep(step)
    return None
CO = fake_tally.COMPANY
def man():
    d = [x for x in glob.glob(_os.path.join(BRUN, "sync", "*")) if _os.path.isdir(x)]
    f = _os.path.join(d[0], "manifest.json") if d else ""
    return json.load(open(f, encoding="utf-8-sig")) if f and _os.path.exists(f) else None
def call(path, body=None, raw=None):
    key = json.load(open(_os.path.join(BRUN, "tds-bridge.config.json"), encoding="utf-8-sig"))["Key"]
    data = raw.encode() if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request("http://127.0.0.1:9100" + path, data=data, headers={"X-Bridge-Key": key, "Origin": "https://caanshulgarg.github.io", "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())
LEDGERS = {n: p for n, p, _ in make_fake_books.LEDGERS}; GROUPS = dict(make_fake_books.GROUPS)
def chain(led):
    out, p = [], LEDGERS.get(led, "")
    while p and len(out) < 30: out.append(p); p = GROUPS.get(p, "")
    return out
try:
    until(lambda: urllib.request.urlopen("http://127.0.0.1:9100/ping", timeout=2).read(), 60)
    ok(until(lambda: (man() or {}).get("phase") == "live", 300), "the made-up company is kept in step")
    r = call("/cloudlink", {"url": "http://127.0.0.1:9200/tally-ingest", "key": fake_cloud.KEY})
    ok(r.get("connected"), "this computer is connected to the (fake) cloud")
    ok(until(lambda: CO in fake_cloud.LINKS, 60), "the cloud is told which companies this computer has")
    fake_cloud.LINKS[CO] = "client-1"
    got = until(lambda: fake_cloud.LEDGERS.get(CO) if (fake_cloud.LEDGERS.get(CO) or {}).get("groups") else None, 240, 2)
    ok(bool(got), "once linked, the ledgers go with Tally's groups")
    got = got or {}
    sent = {l[0]: l for l in got.get("ledgers", [])}
    ok(set(LEDGERS) <= set(sent), "every ledger goes, also those with no opening balance (%d of %d)" % (len(set(LEDGERS) & set(sent)), len(LEDGERS)))
    ok(all(sent[n][1] == LEDGERS[n] for n in LEDGERS if n in sent), "each with its group, as in Tally")
    grp = {g[0]: g[1] for g in got.get("groups", [])}
    ok(grp == GROUPS, "the groups: each with its parent, a primary group with none (%d groups)" % len(grp))
    ok(chain("Cab Hire") == ["Travel Costs", "Office Costs", "Indirect Expenses"], "so a ledger's chain up to its primary group can be worked out: Cab Hire → " + " → ".join(chain("Cab Hire")))
    # opening balances from a trial balance file (Tally's TB lists only ledgers with a balance, and no groups):
    # the cloud still gets every ledger with its group, and the opening from the file
    n0 = len([c for c in fake_cloud.CALLS if c[0] == "ledgers"])
    tb = {"openAsOn": "20260228", "ledgers": [{"name": n, "parent": "", "open": str(ob)} for n, p, ob in make_fake_books.LEDGERS if ob]}
    r = call("/seedbal?company=" + urllib.parse.quote(CO), raw=json.dumps(tb))
    ok(r and r.get("ok") and r.get("ledgers") == len(tb["ledgers"]), "opening balances taken from a trial balance file (%s)" % json.dumps(r))
    ok(until(lambda: len([c for c in fake_cloud.CALLS if c[0] == "ledgers"]) > n0, 120, 2), "and the ledgers go to the cloud again")
    got = fake_cloud.LEDGERS.get(CO) or {}
    sent = {l[0]: l for l in got.get("ledgers", [])}
    ok(set(LEDGERS) <= set(sent) and all(sent[n][1] == LEDGERS[n] for n in LEDGERS), "after the trial balance file: still every ledger, with its group (the bridge's ledger list fills what the file lacks)")
    ok(float(sent["ZZ Bank"][2]) == -200000 and float(sent["Cab Hire"][2]) == 0, "and the opening balances from the file (ZZ Bank %s, Cab Hire %s)" % (sent["ZZ Bank"][2], sent["Cab Hire"][2]))
    ok(len(got.get("groups", [])) == len(GROUPS), "and the groups with them")
    # Update now (and FinCom's "Send ledgers and groups now", which asks the same): every ledger and group read again
    # and sent, though nothing changed in Tally (bridge 1.14.8)
    n1 = len([c for c in fake_cloud.CALLS if c[0] == "ledgers"])
    fake_cloud.LEDGERS.pop(CO, None)
    r = call("/keep?company=" + urllib.parse.quote(CO), {"now": True})
    got2 = until(lambda: fake_cloud.LEDGERS.get(CO) if len([c for c in fake_cloud.CALLS if c[0] == "ledgers"]) > n1 else None, 180, 2)
    ok(bool(got2) and len(got2.get("ledgers", [])) >= len(LEDGERS) and len(got2.get("groups", [])) == len(GROUPS), "Update now: every ledger and group sent again (%d ledgers, %d groups)" % (len((got2 or {}).get("ledgers", [])), len((got2 or {}).get("groups", []))))
    logs = "".join(open(f, encoding="utf-8", errors="replace").read() for f in glob.glob(_os.path.join(BRUN, "*.log")))
    ok("every ledger and group read from Tally, to go to the cloud" in logs, "the bridge's log says so")
    # the cloud's parser on the days it got: the party's GSTIN, the place of supply, and HSN and rate on the lines
    days = [t for (c, d), t in sorted(fake_cloud.DAYS.items()) if c == CO]
    ok(len(days) >= 20, "the days went to the cloud (%d)" % len(days))
    js = "import {parseDay} from %s; const out = []; for (const t of JSON.parse(require_stdin())) out.push(parseDay(t)); process.stdout.write(JSON.stringify(out));" % json.dumps("file://" + _os.path.join(HERE, "..", "server", "tally-cloud", "parse.js"))
    js = js.replace("require_stdin()", "(await import('fs')).readFileSync(0, 'utf8')")
    res = json.loads(subprocess.run(["node", "--input-type=module", "-e", js], input=json.dumps(days), capture_output=True, text=True, timeout=120).stdout or "[]")
    vs = [v for r in res for v in r["vouchers"]]; ls = [l for r in res for l in r["lines"]]
    alpha = [v for v in vs if v["party"] == "ZZ Alpha Customers" and v["type"] == "Sales"]
    ok(alpha and all(v["gstin"] == "27AAACZ1234A1Z5" and v["pos"] == "Maharashtra" for v in alpha), "the party's GSTIN and place of supply are read (%d sales to ZZ Alpha)" % len(alpha))
    cons = [l for l in ls if l[1] == "Consultancy Income"]
    ok(cons and all(l[3] == "998311" and l[4] == 18 for l in cons), "HSN/SAC and GST rate on the income line (998311 @ 18%%, %d lines)" % len(cons))
    goods = [l for l in ls if l[1] == "Goods Sold"]
    ok(goods and all(l[3] == "6109" and l[4] == 5 for l in goods), "and on goods (6109 @ 5%%)")
    party_lines = [l for l in ls if l[1] == "ZZ Alpha Customers"]
    ok(party_lines and all(l[3] == "" and l[4] is None for l in party_lines), "a party's line carries no HSN or rate")
    ok(len(ls) == sum(len(re.findall(r"<ALLLEDGERENTRIES\.LIST>", t)) for t in days), "every line is read, as before (%d)" % len(ls))
    alpha_bills = [b for l in ls if l[1] == "ZZ Alpha Customers" for b in (l[5] or [])]
    new_refs = [b for b in alpha_bills if b[1] == "New Ref"]; agst = [b for b in alpha_bills if b[1] == "Agst Ref"]
    ok(len(new_refs) == 20 and all(b[0].startswith("A/") and b[2] < 0 and b[3] == 30 for b in new_refs), "bill-wise: each sale's New Ref with its bill name, amount and 30 credit days (%d)" % len(new_refs))
    ok(len(agst) == 2 and all(b[0] == "A/1" and b[2] == 5000 and b[3] is None for b in agst), "bill-wise: a receipt against bill A/1 (%d)" % len(agst))
    ok(all(not (l[5] or []) for l in ls if l[1] in ("Consultancy Income", "Output IGST", "Cab Hire")), "a line with no bill-wise details carries none")
finally:
    br.kill()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
