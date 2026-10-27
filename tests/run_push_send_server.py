"""python3 run_push_send_server.py - the push-send stub (branch next-mobile: push notifications to the FinCom phone app) under
Deno, with Supabase and Google stubbed (server/push-send/handler_test.ts): the service role only; no FCM key, nothing sent;
a signed OAuth request then one FCM HTTP v1 message a phone in use of the firm (or the members named); a phone FCM says is
gone marked disabled, never deleted; a bad body refused.
Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it the test says skipped (on CI it fails)."""
import os, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  FAIL no Deno (CI must run this test)" if os.environ.get("GITHUB_ACTIONS") else "skipped: no deno (set DENO)"); raise SystemExit(1 if os.environ.get("GITHUB_ACTIONS") else 0)
env = dict(os.environ, NO_COLOR="1")
if os.path.exists("/root/.ccr/ca-bundle.crt"): env.setdefault("DENO_CERT", "/root/.ccr/ca-bundle.crt")
r = subprocess.run([DENO, "test", "--allow-net", "--allow-env", "--allow-read", "--allow-sys", "server/push-send/handler_test.ts"], cwd=os.path.join(HERE, ".."), env=env, capture_output=True, text=True, timeout=600)
out = r.stdout + r.stderr
for line in out.splitlines():
    if " ... ok" in line or " ... FAILED" in line: print("   ", line.strip())
print(("  ok   " if r.returncode == 0 else "  FAIL ") + "deno test server/push-send/handler_test.ts")
if r.returncode: print(out[-4000:])
raise SystemExit(1 if r.returncode else 0)
