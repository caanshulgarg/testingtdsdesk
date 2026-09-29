"""Puts the FinCom Connector and its bridge where FinCom hands them out (assets/connector/), with the update list
the Connector reads (latest.json: each file's version, address and SHA-256) and FinCom's signature on it
(latest.json.sig, RSA with SHA-256). The Connector refuses a list without a good signature.
  python3 connector/publish.py https://staging.fincom.live      (the test site; the live site gets its own base)
The signing key: connector/signing-key.enc, opened with the passphrase kept in the staging project's vault
(select decrypted_secret from vault.decrypted_secrets where name = 'connector_signing_passphrase'), given here as
FINCOM_SIGNING_PASS, or a key file as FINCOM_SIGNING_KEY."""
import hashlib, json, os, re, shutil, sys, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
base = (sys.argv[1] if len(sys.argv) > 1 else "https://staging.fincom.live").rstrip("/")
out = os.path.join(ROOT, "assets", "connector"); os.makedirs(out, exist_ok=True)
exe = os.path.join(ROOT, "connector", "FinComConnector.exe"); eng = os.path.join(ROOT, "bridge", "TDSBridge.ps1")
shutil.copy(exe, os.path.join(out, "FinComConnector.exe")); shutil.copy(eng, os.path.join(out, "TDSBridge.ps1"))
sha = lambda f: hashlib.sha256(open(f, "rb").read()).hexdigest()
cver = re.search(r'Version = "([0-9.]+)"', open(os.path.join(ROOT, "connector", "Core.cs")).read()).group(1)
ever = re.search(r"\$BridgeVersion = '([0-9.]+)'", open(eng, encoding="utf-8-sig").read()).group(1)
man = {"at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
       "app": {"version": cver, "url": base + "/assets/connector/FinComConnector.exe"},     # announced only; never "connector" (1.0.0-1.0.3 would swap themselves in)
       "engine": {"version": ever, "url": base + "/assets/connector/TDSBridge.ps1", "sha256": sha(os.path.join(out, "TDSBridge.ps1"))},
       "notes": "Keeps the Tally Bridge running; the copy of the books goes to FinCom's cloud."}
body = json.dumps(man, indent=1).encode("utf-8")
open(os.path.join(out, "latest.json"), "wb").write(body)
import subprocess, tempfile
key = os.environ.get("FINCOM_SIGNING_KEY") or ""
if not key:
    pw = os.environ.get("FINCOM_SIGNING_PASS") or (open("/root/.fincom/pass.txt").read().strip() if os.path.exists("/root/.fincom/pass.txt") else "")
    if not pw: sys.exit("No signing key: set FINCOM_SIGNING_PASS (from the vault) or FINCOM_SIGNING_KEY.")
    key = os.path.join(tempfile.mkdtemp(), "k.pem")
    subprocess.run(["openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-in", os.path.join(ROOT, "connector", "signing-key.enc"), "-out", key, "-pass", "env:FC_PW"], check=True, env=dict(os.environ, FC_PW=pw))
sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key], input=body, capture_output=True, check=True).stdout
if not os.environ.get("FINCOM_SIGNING_KEY"): os.remove(key)
import base64
open(os.path.join(out, "latest.json.sig"), "w").write(base64.b64encode(sig).decode())
print("Connector", cver, "bridge", ever, "->", out)
