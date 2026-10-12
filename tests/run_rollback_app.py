"""python3 run_rollback_app.py - the app's one-click rollback (.github/scripts/rollback-app.sh; reliability item 1).
Never against origin: a made-up copy of main is built here as a local bare repository, with seven publishes of review/
made the way app/publish-preview.sh makes them ("Preview: React FinCom from branch ... at review/"), a bridge update in
between, and the uptime watch's status/ commits. Then, in a clone of it:
  - a rollback puts review/ back to the previous publish's app files, never the bridge's (review/assets/bridge-go/**,
    latest.json, the setups), leaves everything outside review/ alone, says what went back, and pushes one commit;
  - a second rollback goes one publish further back; --to goes to a named publish (forward too);
  - it refuses a build older than N publishes, a commit that is not a publish, a published app that is no publish's,
    and (the guard) a change that would touch a bridge file;
  - DRY=1 pushes nothing.
A failure here fails CI (tests/ci/tests.txt)."""
import os, re, shutil, subprocess, tempfile, json
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", ".github", "scripts", "rollback-app.sh")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="rollback-")
bare, seed, clone = (os.path.join(root, n) for n in ("main.git", "seed", "clone"))
ENV = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.com", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.com",
           GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_NOSYSTEM="1")
def git(*a, cwd=seed, check=True):
    r = subprocess.run(["git", *a], cwd=cwd, env=ENV, capture_output=True, text=True)
    if check and r.returncode: raise SystemExit("git %s failed: %s" % (a, r.stderr))
    return r.stdout.strip()
def write(rel, text, base=seed):
    p = os.path.join(base, rel); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w").write(text)
def read(rel, base):
    p = os.path.join(base, rel); return open(p).read() if os.path.exists(p) else None
def run(*args, env=None, cwd=None):
    e = dict(ENV, **(env or {}))
    r = subprocess.run(["bash", SCRIPT, *args], cwd=cwd or clone, env=e, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr

subprocess.run(["git", "init", "-q", "--bare", "-b", "main", bare], env=ENV, check=True)
subprocess.run(["git", "init", "-q", "-b", "main", seed], env=ENV, check=True)
# the site as main holds it: the old program, the welcome page, status/, the bridge's update list and setups
write("index.html", "old program"); write("status/status.json", '{"overall":"ok"}'); write("status/index.html", "status page")
write("assets/connector/latest.json", '{"root":1}'); write(".github/workflows/uptime.yml", "name: uptime")
git("add", "-A"); git("commit", "-qm", "site"); git("remote", "add", "origin", bare); git("push", "-q", "origin", "main")

BRIDGE = ["review/assets/bridge-go/latest.json", "review/assets/bridge-go/FinComBridge-Setup-2.4.1.exe", "review/assets/bridge-go/FinComBridge-Setup-2.4.1.exe.sha256",
          "review/assets/connector/latest.json", "review/assets/connector/latest.json.sig", "review/assets/bridge-setup.txt", "review/assets/bridge-setup.sha256",
          "review/assets/bridge-setup-test.txt"]
pubs = {}
def publish(n, bridge_ver="2.4.1", extra=None):
    """review/ replaced whole, as publish-preview.sh does: the app's files of build n, and the bridge's files"""
    shutil.rmtree(os.path.join(seed, "review"), ignore_errors=True)
    write("review/index.html", "<title>FinCom</title> build %d" % n)
    write("review/build.json", json.dumps({"build": "b%d" % n, "stamp": "2026-10-%02d" % n}))
    write("review/assets/index-%d.js" % n, "app %d" % n)
    write("review/assets/FirmSetup-%d.js" % n, "a screen whose name has Setup in it, an app file: %d" % n)
    write("review/legacy.js", "legacy %d" % n)
    if n == 6: write("review/assets/only-in-6.js", "6")
    for b in BRIDGE: write(b, "bridge %s %s" % (bridge_ver, b))
    for k, v in (extra or {}).items(): write(k, v)
    git("add", "-A"); git("commit", "-qm", "Preview: React FinCom from branch stability (abc%04d) at review/" % n)
    pubs[n] = git("rev-parse", "HEAD")
for n in range(1, 8):
    publish(n, bridge_ver="2.4.2" if n >= 5 else "2.4.1")
    if n == 3:   # the uptime watch writes status/ between publishes
        write("status/status.json", '{"overall":"problem"}'); git("add", "-A"); git("commit", "-qm", "Status: problem"); git("push", "-q", "origin", "main")
git("push", "-q", "origin", "main")
write("status/status.json", '{"overall":"ok","n":7}'); git("add", "-A"); git("commit", "-qm", "Status: all good"); git("push", "-q", "origin", "main")
subprocess.run(["git", "clone", "-q", bare, clone], env=ENV, check=True)
head0 = git("rev-parse", "main", cwd=bare)

def app_files(sha, cwd=clone):
    return {p: git("show", "%s:%s" % (sha, p), cwd=cwd) for p in git("ls-tree", "-r", "--name-only", sha, "--", "review", cwd=cwd).split("\n") if p and p not in BRIDGE}
def tree_files(sha, prefix, cwd=clone):
    return {p: git("show", "%s:%s" % (sha, p), cwd=cwd) for p in git("ls-tree", "-r", "--name-only", sha, "--", prefix, cwd=cwd).split("\n") if p}

# ---- a dry run: nothing pushed
rc, out = run(env={"DRY": "1"})
ok(rc == 0 and git("rev-parse", "main", cwd=bare) == head0, "DRY=1: the rollback is shown, nothing pushed (exit %d)" % rc)
ok("b6" in out and "b7" in out, "DRY=1 says what would go back: build b7 -> b6\n" + out[-800:])

# ---- the first rollback: build 7 -> build 6
git("fetch", "-q", "origin", cwd=clone)
rc, out = run()
print(out)
head1 = git("rev-parse", "main", cwd=bare)
ok(rc == 0 and head1 != head0, "the rollback pushed one commit to main (exit %d)" % rc)
ok(git("rev-parse", head1 + "^", cwd=bare) == head0, "one commit, on top of what main was")
subj = git("log", "-1", "--format=%s", head1, cwd=bare)
ok(subj.startswith("Rollback: review/ back to the app of"), "the commit says it is a rollback: " + subj)
git("fetch", "-q", "origin", cwd=clone)
ok(app_files(head1) == app_files(pubs[6]), "review/'s app files are exactly build 6's (added files gone, removed files back)")
ok(read("review/assets/only-in-6.js", clone) is None and "review/assets/only-in-6.js" in git("ls-tree", "-r", "--name-only", head1, cwd=clone), "a file only build 6 had is back")
ok("review/assets/index-7.js" not in git("ls-tree", "-r", "--name-only", head1, cwd=clone), "a file only build 7 had is gone")
changed = [p for p in git("diff", "--name-only", head0, head1, cwd=clone).split("\n") if p]
ok(changed and all(p.startswith("review/") for p in changed), "only review/ changed (%d files)" % len(changed))
ok(not [p for p in changed if p in BRIDGE], "no bridge file changed (bridge-go, latest.json, setups)")
ok(tree_files(head1, "status") == tree_files(head0, "status") and tree_files(head1, ".github") == tree_files(head0, ".github"), "status/ and .github/ untouched")
ok("b7" in out and "b6" in out and re.search(r"index-7\.js", out) and re.search(r"index-6\.js", out), "it prints what went back (builds b7 -> b6, the files)")
ok(pubs[6][:9] in out, "it names the publish it went back to (%s)" % pubs[6][:9])

# ---- again: build 6 -> build 5 (the bridge 2.4.2 files stay as they are: build 5 had them too)
rc, out = run()
head2 = git("rev-parse", "main", cwd=bare); git("fetch", "-q", "origin", cwd=clone)
ok(rc == 0 and app_files(head2) == app_files(pubs[5]), "a second rollback goes one publish further back (build 5)")

# ---- back to build 4: its bridge was 2.4.1; the 2.4.2 bridge files are kept
rc, out = run()
head3 = git("rev-parse", "main", cwd=bare); git("fetch", "-q", "origin", cwd=clone)
ok(rc == 0 and app_files(head3) == app_files(pubs[4]), "a third: build 4's app")
ok(all(git("show", "%s:%s" % (head3, b), cwd=clone) == "bridge 2.4.2 " + b for b in BRIDGE), "the bridge files stay at 2.4.2 though build 4 shipped 2.4.1")

# ---- older than N publishes: refused (N = 5 by default: build 7 is 0, build 2 is 5 back, build 1 is 6 back)
rc, out = run("--steps", "3")   # from build 4: build 1, six publishes back
ok(rc != 0 and git("rev-parse", "main", cwd=bare) == head3 and "older than" in out, "a build older than 5 publishes is refused: " + out.strip().split("\n")[-1])
rc, out = run("--to", pubs[2][:10])
ok(rc == 0, "build 2, five back, is allowed with --to (exit %d)\n%s" % (rc, out[-600:]))
git("fetch", "-q", "origin", cwd=clone); head4 = git("rev-parse", "main", cwd=bare)
ok(app_files(head4) == app_files(pubs[2]), "--to: build 2's app")
rc, out = run("--to", pubs[7][:10])
git("fetch", "-q", "origin", cwd=clone); head5 = git("rev-parse", "main", cwd=bare)
ok(rc == 0 and app_files(head5) == app_files(pubs[7]), "--to forward: back to the newest build (7)")
rc, out = run("--to", pubs[3][:10], "--max", "2")
ok(rc != 0 and "older than" in out, "--max 2: build 3 (four back) refused")

# ---- not a publish
st = git("log", "-1", "--format=%H", "--grep=^Status:", "main", cwd=clone)
rc, out = run("--to", st[:10])
ok(rc != 0 and "not a publish" in out, "a commit that is not a publish of review/ is refused: " + out.strip().split("\n")[-1])

# ---- the published app matches no publish (changed by hand): refused, unless --to says where to
w = os.path.join(root, "hand"); subprocess.run(["git", "clone", "-q", bare, w], env=ENV, check=True)
write("review/assets/index-7.js", "edited by hand", base=w); git("commit", "-qam", "hand edit", cwd=w); git("push", "-q", "origin", "main", cwd=w)
git("fetch", "-q", "origin", cwd=clone); head6 = git("rev-parse", "main", cwd=bare)
rc, out = run()
ok(rc != 0 and git("rev-parse", "main", cwd=bare) == head6 and "matches no publish" in out, "an app that matches no publish: refused without --to")

# ---- the guard: anything that would change a bridge file stops it (a self-test switch changes one on purpose)
rc, out = run("--to", pubs[6][:10], env={"FINCOM_ROLLBACK_SELFTEST_TOUCH_BRIDGE": "1"})
ok(rc != 0 and git("rev-parse", "main", cwd=bare) == head6 and "bridge" in out.lower(), "a change to a bridge file is refused, nothing pushed: " + out.strip().split("\n")[-1])

# ---- a folder that is not a preview folder
rc, out = run("--folder", "assets")
ok(rc != 0, "only a preview folder (review, react, ...) can be rolled back")
rc, out = run("--steps", "0")
ok(rc != 0, "--steps must be 1 or more")

# ---- the workflow: by hand only, on main, and it runs this script
wf = open(os.path.join(HERE, "..", ".github", "workflows", "rollback-app.yml")).read()
ok("workflow_dispatch" in wf and "schedule" not in wf and "push:" not in wf, "the workflow runs only when started by hand")
ok("rollback-app.sh" in wf and "ref: main" in wf, "it checks out main and runs .github/scripts/rollback-app.sh")
ok("contents: write" in wf and "secrets." not in wf.replace("secrets.GITHUB_TOKEN", ""), "it pushes with the workflow's own token; no other secret")

# ---- app/publish-ops.sh puts this tooling (and the status page) on main, and nothing else
OPS = os.path.join(HERE, "..", "app", "publish-ops.sh")
before = git("rev-parse", "main", cwd=bare)
r = subprocess.run(["bash", OPS], env=dict(ENV, OPS_REMOTE=bare, DRY="1"), capture_output=True, text=True)
ok(r.returncode == 0 and git("rev-parse", "main", cwd=bare) == before and "DRY" in r.stdout, "publish-ops.sh DRY=1: nothing pushed\n" + r.stdout[-400:] + r.stderr[-400:])
r = subprocess.run(["bash", OPS], env=dict(ENV, OPS_REMOTE=bare), capture_output=True, text=True)
after = git("rev-parse", "main", cwd=bare)
ch = sorted(p for p in git("diff", "--name-only", before, after, cwd=bare).split("\n") if p)
ok(r.returncode == 0 and ch == sorted([".github/scripts/rollback-app.sh", ".github/scripts/uptime_check.py", ".github/workflows/rollback-app.yml", ".github/workflows/uptime.yml", "status/index.html"]),
   "publish-ops.sh: only the workflows, their scripts and status/index.html change on main (%s)" % ch)
ok(git("show", after + ":status/status.json", cwd=bare) == git("show", before + ":status/status.json", cwd=bare), "status/status.json (the watch's own) untouched")
r = subprocess.run(["bash", OPS], env=dict(ENV, OPS_REMOTE=bare), capture_output=True, text=True)
ok(r.returncode == 0 and git("rev-parse", "main", cwd=bare) == after and "already" in r.stdout, "run again: main already has them")
shutil.rmtree(root, ignore_errors=True)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
