"""python3 run_video_calls_server.py - the fincom-call function (calls inside FinCom, stage 1, the owner's approval of
23-Oct-2026; Work together; the remote-help log) under Deno with everything outside it stubbed
(server/video-calls/handler_test.ts): who may call (401 without a sign-in), peer to peer with free STUN and 4 at most, the
Cloudflare SFU through the person's own session with the keys kept server-side, guests (link hash only, name and email, a
code by email, the waiting room, admitted, removed and the channel moved on, a run-out pass), a class's batch member coming
straight in, recording off for a client until the owner turns it on, the notice and consent log, the transcript through
fincom-transcribe with the caller's own token, the summary within the AI switch and cap, action items as the person's own
tasks, working together (host only, members only, ends with the call), remote help (owner or staff, reason logged) and the
meeting's .ics. Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it the test says skipped (on CI it fails)."""
import os, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  FAIL no Deno (CI must run this test)" if os.environ.get("GITHUB_ACTIONS") else "skipped: no deno (set DENO)"); raise SystemExit(1 if os.environ.get("GITHUB_ACTIONS") else 0)
env = dict(os.environ, NO_COLOR="1")
if os.path.exists("/root/.ccr/ca-bundle.crt"): env.setdefault("DENO_CERT", "/root/.ccr/ca-bundle.crt")
r = subprocess.run([DENO, "test", "--allow-net", "--allow-env", "server/video-calls/handler_test.ts"], cwd=os.path.join(HERE, ".."), env=env, capture_output=True, text=True, timeout=300)
out = r.stdout + r.stderr
for line in out.splitlines():
    if " ... ok" in line or " ... FAILED" in line: print("   ", line.strip())
print(("  ok   " if r.returncode == 0 else "  FAIL ") + "deno test server/video-calls/handler_test.ts")
if r.returncode: print(out[-4000:])
raise SystemExit(1 if r.returncode else 0)
