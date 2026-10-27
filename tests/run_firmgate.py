"""python3 run_firmgate.py - the console's switches (migration 118) at the door of every function that writes a firm's
data with the service role (server/_shared/firmgate.ts, console phase 1b): an active firm goes ahead; a suspended or
closed firm is refused with the app's words and the reason; a switched-off company likewise; before migration 118 (no
status column) or on a failed read, as before. With the gateway's own check (server/security/functions/gateway). Skipped
(and passes) without Deno, as the other function tests."""
import os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
DENO = os.environ.get("DENO") or subprocess.run(["sh", "-c", "command -v deno"], capture_output=True, text=True).stdout.strip() or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else "")
if not DENO:
    print("skipped: no deno"); sys.exit(0)
r = subprocess.run([DENO, "test", "-A", "--no-lock", "server/_shared/firmgate_test.ts", "server/security/functions/gateway/handler_test.ts", "server/security/functions/signin/handler_test.ts"], cwd=os.path.join(HERE, ".."), env=dict(os.environ, NO_COLOR="1"), capture_output=True, text=True, timeout=600)
print(r.stdout[-6000:], r.stderr[-3000:])
print("\nall passed" if r.returncode == 0 else "\nFAILED"); sys.exit(r.returncode)
