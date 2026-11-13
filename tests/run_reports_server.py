"""python3 run_reports_server.py - the Assistant's report tools (server/assistant/tools/reports.ts) through a mock context:
deno test server/assistant/tools/reports_test.ts, and the projected statements (tools/projection.ts) through a fake model endpoint:
server/assistant/projection_test.ts (its live call runs only with ANTHROPIC_API_KEY set). Without Deno it says "skipped" and passes, as the other server tests do."""
import os, shutil, subprocess, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
deno = os.environ.get("DENO") or shutil.which("deno")
if not deno:
    print("skipped: deno not installed"); sys.exit(0)
r = subprocess.run([deno, "test", "--allow-read", "--allow-run", "--allow-env", "--allow-net", "--allow-sys", "server/assistant/tools/reports_test.ts", "server/assistant/projection_test.ts"], cwd=ROOT)
sys.exit(r.returncode)
