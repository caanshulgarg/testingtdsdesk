"""python3 run_records_upload_server.py - the records-upload function (large saves sent gzipped, 26-Oct-2026) under Deno,
with PostgREST stubbed with row level security (server/records-upload/handler_test.ts): gzip in, the same rows and the
same JSON text passed on as the person (never the service role); another firm's rows and a viewer's save refused by the
database and that answer passed back; no token, another path or Prefer, a plain body, bad gzip, not JSON, more than 20 MB
once decompressed (a gzip bomb) or 8 MB compressed refused before PostgREST. The app's side: run_gz_upload.py.
Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it the test says skipped (on CI it fails)."""
import os, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  FAIL no Deno (CI must run this test)" if os.environ.get("GITHUB_ACTIONS") else "skipped: no deno (set DENO)"); raise SystemExit(1 if os.environ.get("GITHUB_ACTIONS") else 0)
env = dict(os.environ, NO_COLOR="1")
r = subprocess.run([DENO, "test", "server/records-upload/handler_test.ts"], cwd=os.path.join(HERE, ".."), env=env, capture_output=True, text=True, timeout=300)
out = r.stdout + r.stderr
for line in out.splitlines():
    if " ... ok" in line or " ... FAILED" in line: print("   ", line.strip())
print(("  ok   " if r.returncode == 0 else "  FAIL ") + "deno test server/records-upload/handler_test.ts")
if r.returncode: print(out[-4000:])
raise SystemExit(1 if r.returncode else 0)
