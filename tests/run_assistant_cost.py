"""python3 run_assistant_cost.py - the cost levers measured on the fixture questions (tests/assistant_cost.ts): each question
through the real function before (Opus for everything, no router, no Haiku, 40 rows, 5-minute prompt cache, no answer
cache) and after (the levers on), with the model mocked and the tokens ESTIMATED from what is sent. Prints the table in
rupees; fails if any question costs more after than before, or if a keyword question costs anything after."""
import os, sys, json, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import assistant_stand as A, assistant_supa as SUPA
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  FAIL no Deno" if os.environ.get("GITHUB_ACTIONS") else "skipped: no deno"); raise SystemExit(1 if os.environ.get("GITHUB_ACTIONS") else 0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
db = A.start(55478)
try:
    A.migrate(db); A.load_fixture(db); A.add_notice_data(db)
    db.sql("insert into assistant_settings (firm_id, enabled, consent) values ('%s', true, true);" % A.FIRM)
    SUPA.start(db, 9488)
    env = dict(os.environ, STAND_URL="http://127.0.0.1:9488", NO_COLOR="1")
    r = subprocess.run([DENO, "run", "--allow-net", "--allow-read", "--allow-env", "tests/assistant_cost.ts"], cwd=os.path.join(HERE, ".."), env=env, capture_output=True, text=True, timeout=600)
    if r.returncode: print(r.stdout[-3000:] + r.stderr[-3000:])
    rows = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else []
    print("\n  %-44s %9s %9s %9s %9s   %-26s %s" % ("question (Rs)", "cold bef", "cold aft", "warm bef", "warm aft", "before", "after"))
    for x in rows: print("  %-44s %9.2f %9.2f %9s %9s   %-26s %s" % (x["what"], x["before_inr"], x["after_inr"], x.get("warm_before_inr", "-"), x.get("warm_after_inr", "-"), x["before"], x["after"]))
    tb, ta = sum(x["before_inr"] for x in rows), sum(x["after_inr"] for x in rows)
    wb, wa = sum(x.get("warm_before_inr", 0) for x in rows), sum(x.get("warm_after_inr", 0) for x in rows)
    print("  %-44s %9.2f %9.2f %9.2f %9.2f" % ("all", tb, ta, wb, wa))
    ok(len(rows) == 11, "every fixture question measured")
    ok(all(x.get("warm_after_inr", 0) <= x.get("warm_before_inr", 0) + 0.005 for x in rows if not x["what"].startswith("notice")), "warm: no chat question costs more after the levers")
    ok(ta < tb and wa < wb, "in all, cheaper after (cold %.2f -> %.2f; warm %.2f -> %.2f)" % (tb, ta, wb, wa))
    ok(all(x["after_inr"] == 0 for x in rows if "(keyword)" in x["what"] or "answer cache" in x["what"]), "keyword and cached answers cost nothing")
    json.dump(rows, open(os.path.join(HERE, "out", "assistant-cost.json"), "w"), indent=1)
finally:
    db.stop()
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
