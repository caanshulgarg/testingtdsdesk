"""python3 run_console_server.py - the console-admin function (server/console) under Deno with every service faked
(server/console/handler_test.ts): every role against every action (allowed: runs and is audited; refused: 403 and the
refusal audited), aal1 refused, a login that is not an admin refused, a reason required for every write, nothing runs
when the audit row cannot be written, the last owner and own-role rules, the switch-off actions, the lists' server-side
filters / sort / paging / CSV export, the Viewer's hidden emails; and the phase 5 modules (server/console/ops_test.ts: keys never shown, tested and rotated;
support desk; see as this firm; exports; health; announcements; flags). Skipped (and passes) without Deno, as the other
function tests."""
import os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
DENO = os.environ.get("DENO") or subprocess.run(["sh", "-c", "command -v deno"], capture_output=True, text=True).stdout.strip()
if not DENO:
    print("skipped: no deno"); sys.exit(0)
r = subprocess.run([DENO, "test", "--no-lock", "server/console/"], cwd=os.path.join(HERE, ".."), env=dict(os.environ, NO_COLOR="1"), capture_output=True, text=True, timeout=600)
print(r.stdout[-6000:], r.stderr[-3000:])
print("\nall passed" if r.returncode == 0 else "\nFAILED"); sys.exit(r.returncode)
