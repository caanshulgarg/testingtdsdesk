"""python3 run_ledger_confirm_server.py - the AI guess for TDS and GST ledgers (server/assistant/ledgers.ts and the
fincom-assistant function's "ledger_guess"), with Claude and Supabase faked: deno test server/assistant/ledgers_test.ts
(one batch on Haiku, masked, cached per ledger, the firm's cap and switch, the cost of 100 ledgers). Without Deno it says
"skipped" and passes, as the other server tests do (CI has Deno)."""
import os, shutil, subprocess, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
deno = shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not deno:
    print("skipped: deno not installed"); sys.exit(0)
r = subprocess.run([deno, "test", "--allow-net", "--allow-read", "--allow-env", "--allow-sys", "server/assistant/ledgers_test.ts"], cwd=ROOT)
print("\nALL PASSED" if r.returncode == 0 else "\nFAILED")
sys.exit(r.returncode)
