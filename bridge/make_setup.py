"""Rebuilds the Setup-FinCom-Bridge.bat the app hands out from bridge/TDSBridge.ps1, with its SHA-256 beside it so a
downloaded copy can be checked. Two files (review of 01-Oct-2026):
  python3 bridge/make_setup.py          assets/bridge-setup-test.txt (+ .sha256): the staging builds' download
  python3 bridge/make_setup.py --live   assets/bridge-setup.txt (+ .sha256): the live download, only when the owner decides
so a new bridge reaches the testing site without changing what live users download."""
import base64, hashlib, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = "bridge-setup" if "--live" in sys.argv else "bridge-setup-test"
asset = os.path.join(ROOT, "assets", NAME + ".txt")
raw = base64.b64decode(open(os.path.join(ROOT, "assets", "bridge-setup.txt")).read().strip())
head = raw[:raw.index(b"::PS1BEGIN::") + len(b"::PS1BEGIN::")] + b"\r\n"
# the folder the setup makes (DEST) must be the folder the program is written into; the rename once broke this
dest = re.search(rb'set "DEST=%LOCALAPPDATA%\\([^"]+)"', head).group(1)
writes = re.findall(rb"LOCALAPPDATA '([^'\\]+)\\TDSBridge\.ps1'", head)
assert writes and all(w == dest for w in writes), ("setup writes to", writes, "but makes", dest)
ps = open(os.path.join(ROOT, "bridge", "TDSBridge.ps1"), "rb").read()
if not ps.startswith(b"\xef\xbb\xbf"): ps = b"\xef\xbb\xbf" + ps
b64 = base64.b64encode(ps).decode()
bat = head + b"".join(b"::" + b64[i:i + 120].encode() + b"\r\n" for i in range(0, len(b64), 120))
open(asset, "w").write(base64.b64encode(bat).decode())
h = hashlib.sha256(bat).hexdigest()
open(os.path.join(ROOT, "assets", NAME + ".sha256"), "w").write(h + "  Setup-FinCom-Bridge.bat\n")
print(NAME + ": Setup-FinCom-Bridge.bat", len(bat), "bytes, SHA-256", h)
