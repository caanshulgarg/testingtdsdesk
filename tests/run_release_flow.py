"""python3 tests/run_release_flow.py - the release flow's scripts (docs/RELEASE-FLOW.md): app/publish-preview.sh next,
app/promote-next.sh and app/rollback-review.sh, run against a made-up "main" in a temporary git repository (a bare repo
as origin), never the real one. The builds are small made-up ones (index.html, build.json, legacy.js, …): what is checked
is what the scripts do with main, not the app (tests/run_trial_address.py opens real builds at /review/ and /next/).
  1. a build published to next/ sits beside review/: review/ untouched, only next/ changes on main;
  2. promote: review/ becomes exactly the files tried at next/ (the same git blobs), with review/last-good.json naming
     the build it replaced and the commit holding it; promoting again, or an older build, is refused and changes nothing;
  3. rollback: review/ exactly as in the commit last-good.json names, twice in a row (one build further back each time);
     without last-good.json it asks for a commit, and takes one;
  4. DRY=1 pushes nothing; a publish straight to review/ writes last-good.json too, and the same build again keeps it.
  python3 tests/run_release_flow.py"""
import os, sys, json, time, shutil, tempfile, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(os.path.dirname(HERE), "app")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

T = tempfile.mkdtemp(prefix="fincom-release-")
ENV = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.invalid", GIT_COMMITTER_NAME="t",
           GIT_COMMITTER_EMAIL="t@example.invalid", GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_NOSYSTEM="1")
ENV.pop("DRY", None)
def sh(args, cwd, env=None, check=True):
    r = subprocess.run(args, cwd=cwd, env=dict(ENV, **(env or {})), capture_output=True, text=True)
    if check and r.returncode: raise SystemExit("command failed: %s\n%s%s" % (args, r.stdout, r.stderr))
    return r
ORIGIN, MAIN, SRC = os.path.join(T, "origin.git"), os.path.join(T, "main"), os.path.join(T, "src")
git_main = lambda *a: sh(["git"] + list(a), MAIN).stdout.strip()

def fake_build(d, label, age_h):
    """a made-up build like app/dist-test: its id is base36(ms when built)-hex, as vite.config.js makes it"""
    bid = "%s-%s" % (base36(int((time.time() - age_h * 3600) * 1000)), label.encode().hex()[:6].ljust(6, "0"))
    os.makedirs(os.path.join(d, "assets"), exist_ok=True)
    files = {
        "index.html": '<!DOCTYPE html><html><head><script id="fincom-boot">"%s"</script><script src="./guard.js"></script>'
                      '<link rel="modulepreload" href="./assets/index-%s.js"></head><body><script defer src="./legacy.js?v=%s"></script></body></html>' % (bid, label, label),
        "build.json": json.dumps({"build": bid, "stamp": "React · build " + label}),
        "legacy.js": "var SUPA='https://qbocskaiewaxqcvaunzc.supabase.co';var BUILD=%r;\n" % label,
        "legacy.js.map": "{}", "guard.js": "/*g*/", "oldcheck.js": "/*o*/",
        "sw.js": 'const VERSION="%s";const FILES=["./","./assets/index-%s.js"];' % (bid, label),
        "assets/index-%s.js" % label: "console.log(%r)" % label,
    }
    for f, t in files.items():
        with open(os.path.join(d, f), "w") as h: h.write(t)
    return bid
def base36(n):
    s = ""
    while n: n, r = divmod(n, 36); s = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + s
    return s or "0"

def publish(folder, label, age_h, banner="", env=None, check=True):
    """app/publish-preview.sh <folder> with a made-up build in app/dist-test (FINCOM_SKIP_BUILD=1)"""
    d = os.path.join(SRC, "app", "dist-test"); shutil.rmtree(d, ignore_errors=True)
    bid = fake_build(d, label, age_h)
    r = sh(["./publish-preview.sh", folder, banner], os.path.join(SRC, "app"), dict({"FINCOM_SKIP_BUILD": "1"}, **(env or {})), check=check)
    return bid, r
def run(script, *args, env=None):
    return sh(["./" + script] + list(args), os.path.join(SRC, "app"), env, check=False)
def head():
    sh(["git", "fetch", "-q", "origin"], MAIN); sh(["git", "reset", "-q", "--hard", "origin/main"], MAIN)
    return git_main("rev-parse", "HEAD")
tree = lambda rev, path: git_main("rev-parse", "%s:%s" % (rev, path))
def ls_tree(rev, path):
    """{file: blob} of a folder at a commit"""
    out = git_main("ls-tree", "-r", rev, path + "/")
    return {l.split("\t")[1][len(path) + 1:]: l.split()[2] for l in out.splitlines()}
def build_at(rev, path):
    r = sh(["git", "show", "%s:%s/build.json" % (rev, path)], MAIN, check=False)
    return json.loads(r.stdout)["build"] if r.returncode == 0 else None
def changed(a, b): return set(git_main("diff", "--name-only", a, b).split())
def last_good(rev="HEAD"):
    r = sh(["git", "show", rev + ":review/last-good.json"], MAIN, check=False)
    return json.loads(r.stdout) if r.returncode == 0 else None

try:
    # ---------------------------------------------------------------- a made-up main, and a source branch with app/
    sh(["git", "init", "-q", "--bare", "-b", "main", ORIGIN], T)
    sh(["git", "init", "-q", "-b", "main", MAIN], T)
    for f, t in {"index.html": "root", "_headers": "/*\n  X: y\n", "status/status.json": "{}", "review/README.txt": "kept by hand"}.items():
        os.makedirs(os.path.dirname(os.path.join(MAIN, f)), exist_ok=True)
        with open(os.path.join(MAIN, f), "w") as h: h.write(t)
    A = fake_build(os.path.join(MAIN, "review"), "A", 48)                # review/ as it is today: no last-good.json
    sh(["git", "add", "-A"], MAIN); sh(["git", "commit", "-qm", "main with review/ = A"], MAIN)
    sh(["git", "remote", "add", "origin", ORIGIN], MAIN); sh(["git", "push", "-q", "origin", "main"], MAIN)
    c_A = head()
    sh(["git", "init", "-q", "-b", "next-feature", SRC], T)
    os.makedirs(os.path.join(SRC, "app"))
    for f in ("publish-preview.sh", "promote-next.sh", "rollback-review.sh", "release-lib.sh"):
        shutil.copy2(os.path.join(APP, f), os.path.join(SRC, "app", f))
    with open(os.path.join(SRC, ".gitignore"), "w") as h: h.write("app/dist-test/\n")
    sh(["git", "add", "-A"], SRC); sh(["git", "commit", "-qm", "source"], SRC); sh(["git", "remote", "add", "origin", ORIGIN], SRC)

    print("1. publish to next/: beside review/, review/ untouched")
    B, r = publish("next", "B", 24, "REVIEW BUILD – Phase 2")
    c_B = head()
    ok(build_at(c_B, "next") == B and build_at(c_B, "review") == A, "next/ = B, review/ = A (%s / %s)" % (build_at(c_B, "next"), build_at(c_B, "review")))
    ok(changed(c_A, c_B) and all(f.startswith("next/") for f in changed(c_A, c_B)), "only next/ changed on main (%s)" % sorted(changed(c_A, c_B)))
    ok(tree(c_A, "review") == tree(c_B, "review"), "review/ the same tree as before")
    ok(last_good(c_B) is None, "a publish to next/ leaves review/ (no last-good.json written there)")
    ok(os.path.exists(os.path.join(SRC, "app", "dist-test", "index.html")) and not sh(["git", "worktree", "list", "--porcelain"], SRC).stdout.count("worktree ") > 1, "the temporary checkout of main is removed")

    print("2. promote: review/ = exactly what was tried at next/")
    r = run("promote-next.sh"); c_P = head()
    ok(r.returncode == 0 and build_at(c_P, "review") == B, "review/ = B (%s) %s" % (build_at(c_P, "review"), r.stderr.strip()[:200]))
    nxt, rev = ls_tree(c_P, "next"), ls_tree(c_P, "review")
    same = {f: b for f, b in rev.items() if f not in ("last-good.json", "README.txt")}
    ok(same == nxt, "every file of review/ is next/'s, byte for byte (the same blobs, %d files)" % len(nxt))
    ok(rev.get("README.txt") and git_main("show", c_P + ":review/README.txt") == "kept by hand", "review/README.txt (kept by hand) stays")
    lg = last_good(c_P) or {}
    ok(lg.get("build") == A and lg.get("commit") == c_B and lg.get("replacedBy") == B and lg.get("how") == "promote", "review/last-good.json names A and the commit holding it (%s)" % {k: lg.get(k) for k in ("build", "commit", "replacedBy", "how")})
    ok(all(f.startswith("review/") for f in changed(c_B, c_P)), "only review/ changed on main")
    r = run("promote-next.sh")
    ok(r.returncode != 0 and "already holds" in r.stderr and head() == c_P, "promoting again: refused, main unchanged (%s)" % r.stderr.strip()[:90])
    old, _ = publish("next", "OLD", 30); c_O = head()
    r = run("promote-next.sh")
    ok(r.returncode != 0 and "older build" in r.stderr and head() == c_O and build_at(c_O, "review") == B, "an older build at next/: refused, review/ still B (%s)" % r.stderr.strip()[:90])

    print("3. DRY=1 pushes nothing")
    D, _ = publish("next", "D", 1); c_D = head()
    r = run("promote-next.sh", env={"DRY": "1"})
    ok(r.returncode == 0 and "DRY: nothing pushed" in r.stdout and head() == c_D, "DRY promote: main unchanged")
    r = run("promote-next.sh"); c_P2 = head()
    ok(r.returncode == 0 and build_at(c_P2, "review") == D and (last_good(c_P2) or {}).get("build") == B and (last_good(c_P2) or {}).get("commit") == c_D, "promote D: review/ = D, last-good.json names B at %s" % c_D[:9])

    print("4. rollback: the previous review/, exactly")
    r = run("rollback-review.sh"); c_R1 = head()
    ok(r.returncode == 0 and build_at(c_R1, "review") == B, "review/ = B again (%s) %s" % (build_at(c_R1, "review"), r.stderr.strip()[:200]))
    ok(tree(c_R1, "review") == tree(c_D, "review"), "review/ the same tree as in that commit (last-good.json included)")
    ok(build_at(c_R1, "next") == D, "next/ left as it was (D)")
    ok(all(f.startswith("review/") for f in changed(c_P2, c_R1)), "only review/ changed on main")
    r = run("rollback-review.sh"); c_R2 = head()
    ok(r.returncode == 0 and build_at(c_R2, "review") == A and tree(c_R2, "review") == tree(c_A, "review"), "a second rollback: review/ = A, as at the start (%s)" % build_at(c_R2, "review"))
    r = run("rollback-review.sh")
    ok(r.returncode != 0 and "rollback-review.sh <commit>" in r.stderr and head() == c_R2, "no last-good.json: it asks for a commit, main unchanged")
    r = run("rollback-review.sh", c_P2); c_R3 = head()
    ok(r.returncode == 0 and build_at(c_R3, "review") == D and tree(c_R3, "review") == tree(c_P2, "review"), "./rollback-review.sh <commit>: review/ as in that commit (D)")
    r = run("rollback-review.sh", c_P2)
    ok(r.returncode != 0 and "already holds" in r.stderr, "the same again: refused")

    print("5. a publish straight to review/ writes last-good.json too")
    E, r = publish("review", "E", 0.5, "URGENT FIX"); c_E = head()
    lg = last_good(c_E) or {}
    ok(build_at(c_E, "review") == E and lg.get("build") == D and lg.get("commit") == c_R3 and lg.get("how") == "publish", "review/ = E, last-good.json names D at %s (%s)" % (c_R3[:9], lg.get("build")))
    sh(["./publish-preview.sh", "review", "URGENT FIX"], os.path.join(SRC, "app"), {"FINCOM_SKIP_BUILD": "1"})
    ok(head() == c_E, "the same build again: nothing changes, last-good.json kept")
    r = run("rollback-review.sh"); c_R4 = head()
    ok(r.returncode == 0 and build_at(c_R4, "review") == D, "and the rollback takes it back to D")
    _, r = publish("../review", "X", 0, check=False)
    ok(r.returncode != 0 and head() == c_R4, "a folder with a slash is refused")
    _, r = publish("status", "X", 0, check=False)
    ok(r.returncode != 0 and head() == c_R4, "status/ (the uptime job's) is not a preview folder")
finally:
    shutil.rmtree(T, ignore_errors=True)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
