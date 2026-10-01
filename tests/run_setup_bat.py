"""python3 run_setup_bat.py - the setup file the app hands out writes the bridge into the folder it makes, and it is the bridge in the repository."""
import base64, os, re, subprocess, sys, tempfile, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, "..")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# review of 01-Oct-2026: two setup files. assets/bridge-setup-test.txt is the testing builds' download and must be the
# bridge in the repository; assets/bridge-setup.txt is the live download, changed only by make_setup.py --live, and
# the live build must ask for it (so a merge never changes what live users download by itself)
def check(name, current, built, built_label):
    print("== " + name)
    raw = base64.b64decode(open(os.path.join(ROOT, "assets", name + ".txt")).read().strip())
    sha = open(os.path.join(ROOT, "assets", name + ".sha256")).read().split()[0]
    ok(hashlib.sha256(raw).hexdigest() == sha, "the published SHA-256 is the setup file's")
    text = raw.decode("utf-8", "replace"); lines = text.split("\r\n")
    dest = re.search(r'set "DEST=%LOCALAPPDATA%\\([^"]+)"', text).group(1)
    ok(any(re.match(r'if not exist "%DEST%" mkdir "%DEST%"', l) for l in lines), "the setup makes its folder: " + dest)
    cmd = [l for l in lines if l.startswith('powershell -NoProfile -ExecutionPolicy Bypass -Command "$p')][0]
    t = tempfile.mkdtemp(); bat = os.path.join(t, "Setup-FinCom-Bridge.bat"); open(bat, "wb").write(raw)
    la = os.path.join(t, "LocalAppData"); os.makedirs(os.path.join(la, dest))
    ps = cmd.split('-Command "', 1)[1].rsplit('"', 1)[0].replace("%~f0", bat)
    r = subprocess.run([os.environ.get("PWSH", "pwsh"), "-NoProfile", "-Command", ps], env=dict(os.environ, LOCALAPPDATA=la), capture_output=True, text=True)
    ok(r.returncode == 0 and not r.stderr.strip(), "the install step runs without an error" + (": " + r.stderr[:200] if r.stderr.strip() else ""))
    f = os.path.join(la, dest, "TDSBridge.ps1")
    got = open(f, "rb").read() if os.path.exists(f) else b""
    if current:
        want = open(os.path.join(ROOT, "bridge", "TDSBridge.ps1"), "rb").read()
        ok(got.lstrip(b"\xef\xbb\xbf") == want.lstrip(b"\xef\xbb\xbf"), "the bridge written is the one in the repository")
    v = re.search(rb"\$BridgeVersion = '([0-9.]+)'", got)
    ok(bool(v), "version " + (v.group(1).decode() if v else "?"))
    js = open(built, encoding="utf-8").read()
    ok('BRIDGE_SETUP_SHA = "' + sha[:16] + '"' in js and 'BRIDGE_SETUP_ID = "' + name + '"' in js, built_label + " asks for this setup file by its name and fingerprint, so no old copy is served from a cache")
check("bridge-setup-test", True, os.path.join(ROOT, "app", "legacy", "test.js"), "the testing build")
check("bridge-setup", False, os.path.join(ROOT, "app", "legacy", "live.js"), "the live build")
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
