"""python3 run_tds_challan_match_server.py - the server side of the TDS challan matcher's AI step (next-challan-match,
17-Oct-2026), under Deno, with Claude and Supabase faked (never the real Anthropic API, never a real database):
  server/tds-challan-match/match_test.ts     the AI step: nothing left, no key, failed, not JSON; a split that adds up
                                             kept, one that does not refused; interest within what is left
  server/tds-challan-match/handler_test.ts   the function: one call with only the agreed fields (PAN masked); valid
                                             pairings back, invalid and over-use refused; AI off; over the cap; roles
Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it the test says skipped (on CI it fails)."""
import os, sys, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, "..")
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  FAIL no Deno (CI must run this test)" if os.environ.get("GITHUB_ACTIONS") else "skipped: no deno (set DENO)"); raise SystemExit(1 if os.environ.get("GITHUB_ACTIONS") else 0)
files = ["server/tds-challan-match/match_test.ts", "server/tds-challan-match/handler_test.ts"]
r = subprocess.run([DENO, "test", "--allow-read", "--allow-env", "--no-prompt"] + files, cwd=ROOT, capture_output=True, text=True, env=dict(os.environ, NO_COLOR="1"))
print(r.stdout[-6000:]); print(r.stderr[-3000:] if r.returncode else "")
print("\nall passed" if r.returncode == 0 else "\nFAILED"); sys.exit(r.returncode)
