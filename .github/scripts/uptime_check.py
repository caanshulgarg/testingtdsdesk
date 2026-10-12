"""The uptime watch's check (reliability item 3), run every 5 minutes by .github/workflows/uptime.yml on main.
Python's standard library only. Three services, as the status page (status/index.html) names them:
  FinCom app                staging.fincom.live/review/ answers 200 and holds the FinCom marker (<title>FinCom</title>)
  Cloud (database)          the staging database's health endpoint (auth/v1/health, with the public publishable key)
  Tally connection service  the bridge's update list (review/assets/bridge-go/latest.json) answers, and its setup's
                            SHA-256 is the one published next to the setup; once an hour the setup and the bridge are
                            downloaded and their SHA-256 worked out (UPTIME_FULL=1 forces it)
A failing check is tried once more after UPTIME_RETRY_SEC (10) seconds before it counts.
status/status.json (STATUS_FILE) is written only when a service's state changes, when failures reach 2 in a row, or when
the last write is 55 minutes old or more: few commits. On the 2nd failure in a row one GitHub issue labelled "site-down"
is opened (or the open one updated); when all is good again it is closed with a comment.
Outputs (GITHUB_OUTPUT): ok=true|false, changed=true|false. The script itself exits 0; the workflow fails the run on ok=false.
Settings (environment): SITE_URL, SUPABASE_URL, SUPABASE_KEY, STATUS_FILE, GITHUB_TOKEN/GITHUB_REPOSITORY/GITHUB_API_URL
(issues; skipped without a token), UPTIME_NOW (tests), UPTIME_TIMEOUT (20 s), UPTIME_RETRY_SEC, UPTIME_FULL."""
import os, json, time, hashlib, datetime, urllib.request, urllib.error

SITE = os.environ.get("SITE_URL", "https://staging.fincom.live").rstrip("/")
DB = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "")
STATUS_FILE = os.environ.get("STATUS_FILE", "status/status.json")
TIMEOUT = float(os.environ.get("UPTIME_TIMEOUT", "20"))
RETRY = float(os.environ.get("UPTIME_RETRY_SEC", "10"))
EVERY = 5
NAMES = {"app": "FinCom app", "cloud": "Cloud (database)", "bridge": "Tally connection service"}
MARKER = b"<title>FinCom</title>"
UA = "FinCom-uptime-watch (+https://github.com/caanshulgarg/testingtdsdesk)"

def parse(s): return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
def iso(t): return t.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def ist(t): return (t + datetime.timedelta(hours=5, minutes=30)).strftime("%d-%b-%Y %I:%M %p IST")
NOW = parse(os.environ["UPTIME_NOW"]) if os.environ.get("UPTIME_NOW") else datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
FULL = os.environ.get("UPTIME_FULL") == "1" or NOW.minute < EVERY

def get(url, headers=None, method="GET", limit=64 << 20):
    rq = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache", **(headers or {})}, method=method)
    try:
        with urllib.request.urlopen(rq, timeout=TIMEOUT) as r: return r.status, r.read(limit)
    except urllib.error.HTTPError as e: return e.code, b""
def bust(url): return url + ("&" if "?" in url else "?") + "uptime=" + str(int(NOW.timestamp()))

# ---- the checks: each returns "" when good, else a short note of what is wrong (no secret, no business data)
def check_app():
    code, body = get(bust(SITE + "/review/"))
    if code != 200: return "staging.fincom.live/review/ answered %d" % code
    if MARKER not in body: return "the page answered without the FinCom marker"
    return ""
def check_cloud():
    if not DB or not KEY: return "no database address or key set"
    code, _ = get(DB + "/auth/v1/health", {"apikey": KEY, "Authorization": "Bearer " + KEY})
    return "" if code == 200 else "the database's health check answered %d" % code
def check_bridge():
    code, body = get(bust(SITE + "/review/assets/bridge-go/latest.json"))
    if code != 200: return "latest.json answered %d" % code
    try:
        lj = json.loads(body); setup = lj["setup"]; want = setup["sha256"].lower(); url = setup["url"]
    except Exception: return "latest.json could not be read"
    if len(want) != 64: return "latest.json has no setup SHA-256"
    code, body = get(bust(url + ".sha256"))
    if code != 200: return "the setup's .sha256 answered %d" % code
    if body.split()[:1] != [want.encode()]: return "latest.json's SHA-256 is not the published setup's (.sha256)"
    code, _ = get(url, method="HEAD")
    if code != 200: return "the setup answered %d" % code
    if FULL:
        for part in ("setup", "bridge"):
            p = lj.get(part) or {}
            if not p.get("url"): continue
            code, data = get(p["url"])
            if code != 200: return "the %s download answered %d" % (part, code)
            if hashlib.sha256(data).hexdigest() != str(p.get("sha256", "")).lower(): return "the %s's SHA-256 is not latest.json's" % part
    return ""
CHECKS = {"app": check_app, "cloud": check_cloud, "bridge": check_bridge}

def run_check(fn):
    note = ""
    for attempt in range(2):
        try: note = fn()
        except Exception as e: note = "no answer (%s)" % type(e).__name__
        if not note: return ""
        if attempt == 0 and RETRY: time.sleep(RETRY)
    return note

# ---- GitHub's issues (the workflow's own token)
API = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
REPO = os.environ.get("GITHUB_REPOSITORY", ""); TOKEN = os.environ.get("GITHUB_TOKEN", "")
def gh(method, path, body=None):
    rq = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Accept": "application/vnd.github+json", "User-Agent": UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(rq, timeout=20) as r: return json.loads(r.read() or b"null")
def run_url():
    rid = os.environ.get("GITHUB_RUN_ID")
    return "%s/%s/actions/runs/%s" % (os.environ.get("GITHUB_SERVER_URL", "https://github.com"), REPO, rid) if rid else ""
def issues(down, notes, streak, first_fail):
    if not TOKEN or not REPO: return
    try:
        open_ = gh("GET", "/repos/%s/issues?state=open&labels=site-down&per_page=10" % REPO) or []
        if down and streak >= 2:
            names = ", ".join(NAMES[k] for k in down)
            body = ("**Down:** %s\n\n" % names + "\n".join("- **%s**: %s" % (NAMES[k], notes[k]) for k in down) +
                    "\n\nFailing since %s (%d checks in a row, one every %d minutes). Last check %s.\n" % (ist(first_fail), streak, EVERY, ist(NOW)) +
                    ("\nThe run: %s\n" % run_url() if run_url() else "") + "\nStatus page: %s/status/\n\nThis issue closes itself when the checks pass again." % SITE)
            if open_:
                gh("PATCH", "/repos/%s/issues/%d" % (REPO, open_[0]["number"]), {"title": "Site down: " + names, "body": body})
            else:
                try: gh("POST", "/repos/%s/labels" % REPO, {"name": "site-down", "color": "d73a4a", "description": "Opened and closed by the uptime watch"})
                except Exception: pass   # already there
                gh("POST", "/repos/%s/issues" % REPO, {"title": "Site down: " + names, "body": body, "labels": ["site-down"]})
        elif not down:
            for i in open_:
                gh("POST", "/repos/%s/issues/%d/comments" % (REPO, i["number"]), {"body": "Recovered: every check passed at %s. Closing." % ist(NOW)})
                gh("PATCH", "/repos/%s/issues/%d" % (REPO, i["number"]), {"state": "closed", "state_reason": "completed"})
    except Exception as e:
        print("::warning::the site-down issue could not be updated (%s)" % type(e).__name__)

def main():
    prev = None
    try: prev = json.load(open(STATUS_FILE, encoding="utf-8"))
    except Exception: prev = None
    notes = {k: run_check(fn) for k, fn in CHECKS.items()}
    down = [k for k in CHECKS if notes[k]]
    pserv = (prev or {}).get("services", {})
    streak = ((prev or {}).get("fail_streak", 0) + 1) if down else 0
    incidents = list((prev or {}).get("incidents", []))
    for k in CHECKS:
        was = pserv.get(k, {}).get("ok", True)
        if was and notes[k]: incidents.append({"service": k, "start": iso(NOW), "end": None})
        if not was and not notes[k]:
            for i in incidents:
                if i["service"] == k and i["end"] is None: i["end"] = iso(NOW)
    cutoff = NOW - datetime.timedelta(days=31)
    incidents = [i for i in incidents if i["end"] is None or parse(i["end"]) >= cutoff]
    services = {k: {"name": NAMES[k], "ok": not notes[k], "note": notes[k],
                    "since": pserv.get(k, {}).get("since") if prev and pserv.get(k, {}).get("ok", True) == (not notes[k]) else iso(NOW)} for k in CHECKS}
    # a state: good, or the problem's note (a different problem is a change too)
    state_changed = prev is None or any(pserv.get(k, {}).get("ok") != services[k]["ok"] or pserv.get(k, {}).get("note", "") != services[k]["note"] for k in CHECKS)
    stale = prev is None or NOW - parse(prev.get("checked", "1970-01-01T00:00:00Z")) >= datetime.timedelta(minutes=55)
    changed = state_changed or stale or ((prev or {}).get("fail_streak", 0) < 2 <= streak)
    first_fail = min([parse(i["start"]) for i in incidents if i["end"] is None] or [NOW])
    for k in CHECKS:
        print(("ok      " if not notes[k] else "PROBLEM ") + NAMES[k] + ("" if not notes[k] else ": " + notes[k]))
        if notes[k]: print("::error::%s: %s" % (NAMES[k], notes[k]))
    if changed:
        st = {"checked": iso(NOW), "every_minutes": EVERY, "watch_since": (prev or {}).get("watch_since", iso(NOW)), "site": SITE,
              "services": services, "incidents": incidents, "fail_streak": streak}
        os.makedirs(os.path.dirname(os.path.abspath(STATUS_FILE)), exist_ok=True)
        tmp = STATUS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f: json.dump(st, f, indent=1, ensure_ascii=False); f.write("\n")
        os.replace(tmp, STATUS_FILE)
    issues(down, notes, streak, first_fail)
    summary = "all good" if not down else "problem: " + ", ".join(NAMES[k] for k in down)
    print("%s (%s); status %s" % (summary, ist(NOW), "written" if changed else "unchanged"))
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f: f.write("ok=%s\nchanged=%s\nsummary=%s\n" % ("false" if down else "true", "true" if changed else "false", summary))

if __name__ == "__main__":
    main()
