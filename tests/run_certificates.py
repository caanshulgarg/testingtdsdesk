"""python3 run_certificates.py - the Assistant's CA certificates (server/assistant/tools/certificates.ts, certlib.ts):
the net worth arithmetic, the reading of signed statements, the formats and the templates (certlib_test.ts), and the chat
with Claude mocked: several clients, the questions, typed and signed figures, the books only when asked, confirmation,
then Word, PDF and Excel with the right figures and the UDIN blank (certificates_test.ts). Made-up companies only.
Without Deno it says "skipped" and passes, as the other server tests do."""
import os, shutil, subprocess, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
deno = shutil.which("deno")
if not deno:
    print("skipped: deno not installed"); sys.exit(0)
r = subprocess.run([deno, "test", "--allow-read", "--allow-run", "--allow-env", "--allow-sys", "--allow-net",
                    "server/assistant/tools/certlib_test.ts", "server/assistant/tools/certificates_test.ts"], cwd=ROOT)
sys.exit(r.returncode)
