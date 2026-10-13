"""python3 run_assistant_agent.py - FinCom Assistant's function end to end with Claude mocked (server/assistant/assistant_test.ts
under Deno): a throwaway PostgreSQL with migration 77 and the fixture books (assistant_stand.py), a Supabase stand-in in
front of it (assistant_supa.py), and the function's handler called as the app calls it. What is checked is listed in the
test file: routing by a fixed transcript of tool calls with the figures to the paisa, the fallback and its amber label, the
citation check (a made-up voucher dropped), the cross-check of the AI's figures (a mismatch row and one scrubbed Sentry
event; a matching figure green), web links, the refusal to post or delete, files (Excel cells to the paisa, Word, PDF), a
notice, RLS, the "Wrong answer?" button and the log. Then the cap, here: a firm at its cap gets the message, not Claude.
Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it the test says skipped (on CI it fails)."""
import os, sys, json, shutil, subprocess, uuid
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import assistant_stand as A, assistant_supa as SUPA
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  FAIL no Deno (CI must run this test)" if os.environ.get("GITHUB_ACTIONS") else "skipped: no deno (set DENO)"); raise SystemExit(1 if os.environ.get("GITHUB_ACTIONS") else 0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
ROOT = os.path.join(HERE, "..")
db = A.start(55477)
try:
    A.migrate(db); A.load_fixture(db); A.add_notice_data(db)
    db.sql("insert into assistant_settings (firm_id, enabled, consent) values ('%s', true, true);" % A.FIRM)
    port = 9476
    srv = SUPA.start(db, port)
    env = dict(os.environ, STAND_URL="http://127.0.0.1:%d" % port, NO_COLOR="1")
    if os.path.exists("/root/.ccr/ca-bundle.crt"): env.setdefault("DENO_CERT", "/root/.ccr/ca-bundle.crt")
    r = subprocess.run([DENO, "test", "--allow-net", "--allow-read", "--allow-env", "server/assistant/assistant_test.ts", "server/assistant/router_test.ts"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=600)
    out = r.stdout + r.stderr
    for line in out.splitlines():
        if (" ... ok" in line or " ... FAILED" in line) and "=>" not in line: print("   ", line.strip())
    ok(r.returncode == 0, "deno test server/assistant/assistant_test.ts and router_test.ts")
    if r.returncode: print(out[-6000:])
    # the cap: a firm at its cap gets the message and Claude is not called
    db.sql("insert into assistant_usage (firm_id, day, cost_inr) values ('%s', (now() at time zone 'Asia/Kolkata')::date, 150) on conflict (firm_id, day) do update set cost_inr = 150;" % A.FIRM)
    capt = r"""
import { handler } from "./server/assistant/index.ts";
let called = 0;
const claude = { beta: { messages: { stream: () => { called++; throw new Error("Claude must not be called"); } } } };
const h = handler({ env: (k: string) => ({ SUPABASE_URL: Deno.env.get("STAND_URL")!, SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[k], fetch: (...a: Parameters<typeof fetch>) => fetch(...a), anthropic: () => claude as never });
const res = await h(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer tok-aaaaaaaa-0000-4000-8000-000000000001" }, body: JSON.stringify({ action: "ask", question: "What is the TDS rate on commission?", client_id: null }) }));
const ev = (await res.text()).split("\n\n").filter((x) => x.startsWith("data: ")).map((x) => JSON.parse(x.slice(6)));
console.log(JSON.stringify({ called, err: ev.find((e) => e.t === "error"), done: ev.find((e) => e.t === "done") }));
"""
    p = os.path.join(ROOT, "tests", "out", "cap_check.ts"); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w").write(capt.replace("./server/", "../../server/"))
    r2 = subprocess.run([DENO, "run", "--allow-net", "--allow-read", "--allow-env", p], cwd=ROOT, env=env, capture_output=True, text=True, timeout=300)
    j = json.loads((r2.stdout.strip().splitlines() or ["{}"])[-1]) if r2.returncode == 0 else {}
    if r2.returncode: print(r2.stdout[-2000:] + r2.stderr[-3000:])
    ok(j.get("called") == 0 and (j.get("err") or {}).get("kind") == "cap" and "cap" not in str((j.get("err") or {}).get("message", "x")).lower().split("limit")[0][:0] and "₹150" in (j.get("err") or {}).get("message", ""),
       "the cap: Claude not called; the message says the firm used today's ₹150 (%s)" % (j.get("err") or {}).get("message"))
    used = db.one("select cost_inr from assistant_usage where firm_id = '%s' and day = (now() at time zone 'Asia/Kolkata')::date" % A.FIRM)
    ok(float(used) == 150, "the spend stays at the cap (%s)" % used)
    n = db.one("select count(*) from assistant_log where firm_id = '%s' and question = 'What is the TDS rate on commission?' and calls = 0" % A.FIRM)
    ok(str(n) == "1", "the capped question is logged with no calls")
finally:
    db.stop()
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
