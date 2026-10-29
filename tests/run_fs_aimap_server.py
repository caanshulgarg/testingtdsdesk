"""python3 run_fs_aimap_server.py - the one-time AI mapping of the Financial statements page (server/assistant/fsmap.ts,
server/_shared/fsaimap.js and the fincom-assistant function's "fs_aimap"), with Claude and Supabase faked: deno test
server/assistant/fsmap_test.ts (a stubbed reply: the right codes tie every head, a wrong code shows a gap, no figures in
the reply, the firm's monthly cap, only the allowed fields in the request body, the switches, the cost and the log line).
Without Deno it says "skipped" and passes, as the other server tests do (CI has Deno)."""
import os, shutil, subprocess, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
deno = shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not deno:
    print("skipped: deno not installed"); sys.exit(0)
r = subprocess.run([deno, "test", "--allow-net", "--allow-read", "--allow-env", "--allow-sys", "server/assistant/fsmap_test.ts"], cwd=ROOT)
print("\nALL PASSED" if r.returncode == 0 else "\nFAILED")
sys.exit(r.returncode)
