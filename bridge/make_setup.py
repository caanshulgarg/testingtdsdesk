"""Rebuilds assets/bridge-setup.txt (the Setup-FinCom-Bridge.bat the app hands out) from bridge/TDSBridge.ps1,
and writes assets/bridge-setup.sha256 with the SHA-256 of the .bat, so a downloaded copy can be checked."""
import base64, hashlib, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
asset = os.path.join(ROOT, "assets", "bridge-setup.txt")
raw = base64.b64decode(open(asset).read().strip())
head = raw[:raw.index(b"::PS1BEGIN::") + len(b"::PS1BEGIN::")] + b"\r\n"
ps = open(os.path.join(ROOT, "bridge", "TDSBridge.ps1"), "rb").read()
if not ps.startswith(b"\xef\xbb\xbf"): ps = b"\xef\xbb\xbf" + ps
b64 = base64.b64encode(ps).decode()
bat = head + b"".join(b"::" + b64[i:i + 120].encode() + b"\r\n" for i in range(0, len(b64), 120))
open(asset, "w").write(base64.b64encode(bat).decode())
h = hashlib.sha256(bat).hexdigest()
open(os.path.join(ROOT, "assets", "bridge-setup.sha256"), "w").write(h + "  Setup-FinCom-Bridge.bat\n")
print("Setup-FinCom-Bridge.bat", len(bat), "bytes, SHA-256", h)
