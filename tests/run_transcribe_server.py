"""python3 run_transcribe_server.py - the fincom-transcribe function (clearer listening: Groq's Whisper) under Deno, with
Supabase and Groq stubbed (server/fincom-transcribe/transcribe_test.ts): who may call it, the 5 MB and 60 s limits, the
words prompt with the client's own ledger and party names (the caller's firm only), nothing kept but one usage row,
Groq's 429 as "limit", no key as "nokey", and the minutes used today; the full model under 30 s, the Hinglish prompt,
Devanagari in English letters, the names corrected (server/fincom-transcribe/names_test.ts) and the checked AI step.
Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it the test says skipped (on CI it fails)."""
import os, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  FAIL no Deno (CI must run this test)" if os.environ.get("GITHUB_ACTIONS") else "skipped: no deno (set DENO)"); raise SystemExit(1 if os.environ.get("GITHUB_ACTIONS") else 0)
env = dict(os.environ, NO_COLOR="1")
if os.path.exists("/root/.ccr/ca-bundle.crt"): env.setdefault("DENO_CERT", "/root/.ccr/ca-bundle.crt")
r = subprocess.run([DENO, "test", "--allow-net", "--allow-env", "server/fincom-transcribe/transcribe_test.ts", "server/fincom-transcribe/names_test.ts"], cwd=os.path.join(HERE, ".."), env=env, capture_output=True, text=True, timeout=300)
out = r.stdout + r.stderr
for line in out.splitlines():
    if " ... ok" in line or " ... FAILED" in line: print("   ", line.strip())
print(("  ok   " if r.returncode == 0 else "  FAIL ") + "deno test server/fincom-transcribe/transcribe_test.ts names_test.ts")
if r.returncode: print(out[-4000:])
raise SystemExit(1 if r.returncode else 0)
