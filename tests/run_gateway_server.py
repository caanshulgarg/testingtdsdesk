"""python3 run_gateway_server.py - the bill-reading gateway (server/security/functions/gateway) under Deno, with Supabase,
Anthropic and Google stubbed (server/security/functions/gateway/handler_test.ts). Security review 27-Oct-2026, F6: only
the models the app sends; max_tokens, images, image size and text capped by the server; the caller's qty ignored; the
charge is the model's reserve, then the real usage times the model's price; failures refunded; the two-step check kept.
Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it the test says skipped (on CI it fails)."""
import os, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  FAIL no Deno (CI must run this test)" if os.environ.get("GITHUB_ACTIONS") else "skipped: no deno (set DENO)"); raise SystemExit(1 if os.environ.get("GITHUB_ACTIONS") else 0)
env = dict(os.environ, NO_COLOR="1")
if os.path.exists("/root/.ccr/ca-bundle.crt"): env.setdefault("DENO_CERT", "/root/.ccr/ca-bundle.crt")
r = subprocess.run([DENO, "test", "--allow-net", "--allow-env", "server/security/functions/gateway/handler_test.ts"], cwd=os.path.join(HERE, ".."), env=env, capture_output=True, text=True, timeout=300)
out = r.stdout + r.stderr
for line in out.splitlines():
    if " ... ok" in line or " ... FAILED" in line: print("   ", line.strip())
print(("  ok   " if r.returncode == 0 else "  FAIL ") + "deno test server/security/functions/gateway/handler_test.ts")
if r.returncode: print(out[-4000:])
raise SystemExit(1 if r.returncode else 0)
