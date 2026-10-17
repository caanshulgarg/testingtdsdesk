"""python3 run_2b_automatch_server.py - the server side of the 2B matching that runs by itself (round 72b), under Deno, with
Claude and Supabase faked (never the real Anthropic API, never a real database):
  server/gst-2b-match/match_test.ts     the AI step: one call on claude-sonnet-5-5 with only the left-overs and only GSTIN,
                                        name, number, date and amounts; auto-accept against suggest; an answer not JSON
                                        refused; cap reached / AI off / no key / failed: the rules stand; the cost logged
  server/gst-2b-match/handler_test.ts   the function: the app's run kept, the same inputs answered again free, Match again,
                                        AI off, the queued run after a fetch (service key / timer key), accept, roles
  server/gst-taxpro/automatch_test.ts   the trigger after a 2B is fetched (gst2b_enqueue, the function woken)
Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it the test says skipped (on CI it fails)."""
import os, sys, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, "..")
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  FAIL no Deno (CI must run this test)" if os.environ.get("GITHUB_ACTIONS") else "skipped: no deno (set DENO)"); raise SystemExit(1 if os.environ.get("GITHUB_ACTIONS") else 0)
files = ["server/gst-2b-match/match_test.ts", "server/gst-2b-match/handler_test.ts", "server/gst-taxpro/automatch_test.ts"]
r = subprocess.run([DENO, "test", "--allow-read", "--allow-env", "--no-prompt"] + files, cwd=ROOT, capture_output=True, text=True, env=dict(os.environ, NO_COLOR="1"))
print(r.stdout[-6000:]); print(r.stderr[-3000:] if r.returncode else "")
print("\nall passed" if r.returncode == 0 else "\nFAILED"); sys.exit(r.returncode)
