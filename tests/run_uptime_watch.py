"""python3 run_uptime_watch.py - the uptime watch (.github/scripts/uptime_check.py, run every 5 minutes by
.github/workflows/uptime.yml; reliability item 3). Against made-up servers on this computer (never the real site,
database or GitHub): a site (review/ with the FinCom marker, the bridge's latest.json and its setup), a database's health
endpoint (which asks for the public key), and GitHub's issues API. Each check is run as the workflow runs it, the clock
set by the test:
  - all good: status/status.json written the first time, then only when a state changes or once an hour;
  - the site down (500, or no FinCom marker), the database down, latest.json's SHA not the setup's: that service is
    "problem", the run fails (ok=false), and on the 2nd failure in a row one GitHub issue labelled site-down is opened;
    later failures update it (never a second issue); recovery closes it with a comment and writes the state at once;
  - incidents older than 31 days are dropped; the file holds what the status page needs (status/index.html).
A failure here fails CI (tests/ci/tests.txt)."""
import os, json, threading, hashlib, subprocess, tempfile, http.server, datetime, re
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", ".github", "scripts", "uptime_check.py")
WF = os.path.join(HERE, "..", ".github", "workflows", "uptime.yml")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

KEY = "sb_publishable_test_key"
SETUP = b"MZ fake setup " * 1000; BRIDGE = b"MZ fake bridge " * 1000
st = {"site": 200, "marker": True, "db": 200, "sha_ok": True, "sha_file_ok": True}
gh = {"issues": [], "calls": []}

class Site(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype="text/html"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers()
        if self.command != "HEAD": self.wfile.write(body)
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/review/":
            if st["site"] != 200: return self.send(st["site"], b"error")
            return self.send(200, (b"<!DOCTYPE html><html><head><title>FinCom</title></head><body><div id=app></div></body></html>" if st["marker"] else b"<html><body>Site not found</body></html>"))
        if p == "/review/assets/bridge-go/latest.json":
            port = self.server.server_address[1]
            sha = hashlib.sha256(SETUP).hexdigest() if st["sha_ok"] else "0" * 64
            return self.send(200, json.dumps({"at": "2026-10-11T04:42:21Z",
                "bridge": {"version": "2.4.2", "url": "http://127.0.0.1:%d/review/assets/bridge-go/FinComBridge-2.4.2.exe" % port, "sha256": hashlib.sha256(BRIDGE).hexdigest()},
                "setup": {"version": "2.4.2", "url": "http://127.0.0.1:%d/review/assets/bridge-go/FinComBridge-Setup-2.4.2.exe" % port, "sha256": sha}}).encode(), "application/json")
        if p == "/review/assets/bridge-go/FinComBridge-Setup-2.4.2.exe": return self.send(200, SETUP, "application/octet-stream")
        if p == "/review/assets/bridge-go/FinComBridge-2.4.2.exe": return self.send(200, BRIDGE, "application/octet-stream")
        if p == "/review/assets/bridge-go/FinComBridge-Setup-2.4.2.exe.sha256":
            return self.send(200, ((hashlib.sha256(SETUP).hexdigest() if st["sha_file_ok"] else "1" * 64) + "  FinComBridge-Setup-2.4.2.exe\n").encode(), "text/plain")
        self.send(404, b"not found")
class Db(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith("/auth/v1/health") and self.headers.get("apikey") == KEY and st["db"] == 200:
            b = b'{"version":"v2","name":"GoTrue","description":"GoTrue is a user registration and authentication API"}'; self.send_response(200)
        else:
            b = b'{"message":"no"}'; self.send_response(st["db"] if st["db"] != 200 else 401)
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
class Gh(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0); return json.loads(self.rfile.read(n) or b"{}")
    def do_GET(self):
        gh["calls"].append(("GET", self.path, self.headers.get("Authorization")))
        if self.path.startswith("/repos/o/r/issues?"):
            return self.reply(200, [i for i in gh["issues"] if i["state"] == "open" and "site-down" in [l["name"] for l in i["labels"]]])
        self.reply(404, {})
    def do_POST(self):
        b = self.body(); gh["calls"].append(("POST", self.path, b))
        if self.path == "/repos/o/r/issues":
            i = {"number": len(gh["issues"]) + 1, "state": "open", "title": b["title"], "body": b["body"], "labels": [{"name": l} for l in b.get("labels", [])], "comments": []}
            gh["issues"].append(i); return self.reply(201, i)
        m = re.match(r"^/repos/o/r/issues/(\d+)/comments$", self.path)
        if m: gh["issues"][int(m.group(1)) - 1]["comments"].append(b["body"]); return self.reply(201, {})
        self.reply(404, {})
    def do_PATCH(self):
        b = self.body(); gh["calls"].append(("PATCH", self.path, b))
        m = re.match(r"^/repos/o/r/issues/(\d+)$", self.path)
        if m: gh["issues"][int(m.group(1)) - 1].update({k: v for k, v in b.items() if k in ("state", "body", "title", "state_reason")}); return self.reply(200, gh["issues"][int(m.group(1)) - 1])
        self.reply(404, {})
servers = []
for H in (Site, Db, Gh):
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=s.serve_forever, daemon=True).start(); servers.append(s)
SITE, DB, GH = ("http://127.0.0.1:%d" % s.server_address[1] for s in servers)

work = tempfile.mkdtemp(prefix="uptime-")
STATUS = os.path.join(work, "status", "status.json")
T0 = datetime.datetime(2026, 10, 12, 4, 2, tzinfo=datetime.timezone.utc)
def check(minutes, **extra):
    out = os.path.join(work, "out.txt"); open(out, "w").close()
    env = dict(os.environ, SITE_URL=SITE, SUPABASE_URL=DB, SUPABASE_KEY=KEY, GITHUB_API_URL=GH, GITHUB_REPOSITORY="o/r", GITHUB_TOKEN="tkn",
               GITHUB_OUTPUT=out, STATUS_FILE=STATUS, UPTIME_RETRY_SEC="0", UPTIME_NOW=(T0 + datetime.timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z"), UPTIME_TIMEOUT="3", **extra)
    r = subprocess.run(["python3", SCRIPT], env=env, capture_output=True, text=True, timeout=120)
    o = dict(l.split("=", 1) for l in open(out).read().splitlines() if "=" in l)
    s = json.load(open(STATUS)) if os.path.exists(STATUS) else None
    return r, o, s
svc = lambda s, k: s["services"][k]

# ---- all good, the first time: written
r, o, s = check(0)
ok(r.returncode == 0, "the check itself runs (exit 0; a failed check is said by ok=false)\n" + r.stdout[-500:] + r.stderr[-1500:])
ok(o.get("ok") == "true" and o.get("changed") == "true", "all good; the first status written (%s)" % o)
ok(s and [svc(s, k)["name"] for k in ("app", "cloud", "bridge")] == ["FinCom app", "Cloud (database)", "Tally connection service"], "three services named for the status page")
ok(s and all(svc(s, k)["ok"] for k in ("app", "cloud", "bridge")) and s["checked"] == "2026-10-12T04:02:00Z" and s["watch_since"] == s["checked"], "all good, the check's time, the watch's start")
ok(s and s.get("incidents") == [] and s.get("fail_streak") == 0, "no incidents, no failure streak")
ok(not gh["issues"], "no issue")
# ---- 5 minutes later: nothing changed, nothing written
r, o, s2 = check(5)
ok(o.get("ok") == "true" and o.get("changed") == "false" and s2["checked"] == s["checked"], "5 minutes later, all good: nothing written (no commit)")
# ---- an hour after the last write: written
r, o, s = check(62)
ok(o.get("changed") == "true" and s["checked"] == "2026-10-12T05:04:00Z", "once an hour, written even when nothing changed")

# ---- the site down: a failure, written at once; no issue on the first failure
st["site"] = 500
r, o, s = check(65)
ok(o.get("ok") == "false" and o.get("changed") == "true", "the site answering 500: the run fails (ok=false), the state written at once")
ok(not svc(s, "app")["ok"] and svc(s, "cloud")["ok"] and svc(s, "bridge")["ok"] and "500" in svc(s, "app")["note"], "FinCom app: problem (%s); the others all good" % svc(s, "app")["note"])
ok(s["fail_streak"] == 1 and len(s["incidents"]) == 1 and s["incidents"][0]["service"] == "app" and s["incidents"][0]["end"] is None, "an open incident of the app; failure 1")
ok(not gh["issues"], "no issue after one failure")
ok("::error" in r.stdout and "FinCom app" in r.stdout, "the run's log says what failed")
# ---- 2nd failure in a row: one issue labelled site-down
r, o, s = check(70)
ok(o.get("ok") == "false" and s["fail_streak"] == 2 and o.get("changed") == "true", "failure 2 in a row: written (the streak reached 2)")
ok(len(gh["issues"]) == 1 and gh["issues"][0]["state"] == "open" and [l["name"] for l in gh["issues"][0]["labels"]] == ["site-down"], "one issue opened, labelled site-down")
ok("FinCom app" in gh["issues"][0]["title"] + gh["issues"][0]["body"] and "500" in gh["issues"][0]["body"], "the issue says what is down: " + gh["issues"][0]["title"])
ok(all(c[2] == "Bearer tkn" for c in gh["calls"] if c[0] == "GET"), "GitHub is called with the workflow's own token")
# ---- 3rd: the same issue updated, never a second; the marker gone counts as down too
st["site"] = 200; st["marker"] = False
r, o, s = check(75)
ok(o.get("ok") == "false" and not svc(s, "app")["ok"] and "marker" in svc(s, "app")["note"].lower(), "the page answering without the FinCom marker: still a problem (%s)" % svc(s, "app")["note"])
ok(len(gh["issues"]) == 1 and "marker" in gh["issues"][0]["body"].lower(), "the one issue updated, no second issue")
ok(o.get("changed") == "true", "what is wrong changed (500 -> no marker): written")
r, o, s = check(77)
ok(o.get("ok") == "false" and o.get("changed") == "false" and len(gh["issues"]) == 1, "the same problem again: nothing new written, the same issue")
# ---- the database down too
st["db"] = 503
r, o, s = check(80)
ok(not svc(s, "cloud")["ok"] and o.get("changed") == "true" and len([i for i in s["incidents"] if i["end"] is None]) == 2, "the database down: Cloud (database) problem, written at once, two open incidents")
ok(len(gh["issues"]) == 1 and "Cloud (database)" in gh["issues"][0]["body"], "the issue now names both")
# ---- all recover: the issue closed, the state written at once, the incidents ended
st.update(site=200, marker=True, db=200)
r, o, s = check(85)
ok(o.get("ok") == "true" and o.get("changed") == "true" and s["fail_streak"] == 0, "recovered: ok, written at once, the streak back to 0")
ok(all(i["end"] == "2026-10-12T05:27:00Z" for i in s["incidents"]), "each incident ended at the check that found it good")
ok(gh["issues"][0]["state"] == "closed" and gh["issues"][0]["comments"] and "recovered" in gh["issues"][0]["comments"][-1].lower(), "the issue closed, with a comment that it recovered")

# ---- the bridge: latest.json's SHA must be the setup's
st["sha_file_ok"] = False
r, o, s = check(90)
ok(o.get("ok") == "false" and not svc(s, "bridge")["ok"] and "sha" in svc(s, "bridge")["note"].lower(), "the setup's .sha256 not latest.json's: Tally connection service problem (%s)" % svc(s, "bridge")["note"])
st["sha_file_ok"] = True; st["sha_ok"] = False
r, o, s = check(95, UPTIME_FULL="1")
ok(o.get("ok") == "false" and not svc(s, "bridge")["ok"], "the setup itself not matching latest.json (the hourly full check): problem")
ok(len(gh["issues"]) == 2 and gh["issues"][1]["state"] == "open", "2nd failure in a row of a new outage: a new issue (the old one is closed)")
st["sha_ok"] = True
r, o, s = check(100, UPTIME_FULL="1")
ok(o.get("ok") == "true" and svc(s, "bridge")["ok"] and gh["issues"][1]["state"] == "closed", "the full check: the setup's SHA-256 matches latest.json; recovered, issue closed")

# ---- old incidents dropped (older than 31 days), the watch's start kept
r, o, s = check(60 * 24 * 33)
ok(s["incidents"] == [] and s["watch_since"] == "2026-10-12T04:02:00Z", "33 days later: incidents older than 31 days dropped")
ok(set(s) >= {"checked", "watch_since", "services", "incidents", "fail_streak", "every_minutes"}, "status.json holds what the page needs (%s)" % sorted(s))

# ---- the workflow
wf = open(WF).read()
ok(re.search(r"cron: *['\"]\*/5 \* \* \* \*['\"]", wf), "the workflow runs every 5 minutes (GitHub's smallest interval)")
ok("workflow_dispatch" in wf and "ref: main" in wf, "and by hand; on main")
ok(re.search(r"issues: write", wf) and re.search(r"contents: write", wf), "it may write status/ and issues")
ok(not re.search(r"secrets\.(?!GITHUB_TOKEN)", wf) and "service_role" not in wf, "no secret but the workflow's own token")
ok("sb_publishable_" in wf and "https://qbocskaiewaxqcvaunzc.supabase.co" in wf and len(re.findall(r"[a-z]{20}\.supabase\.co", wf)) == 1, "only the staging database, with its public (publishable) key as the app has it")
ok(re.search(r"grep -v '\^status/'", wf), "the commit is refused if anything outside status/ would change")
ok("exit 1" in wf and "steps.check.outputs.ok" in wf, "a failed check fails the run (GitHub emails the owner)")
for s_ in servers: s_.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
