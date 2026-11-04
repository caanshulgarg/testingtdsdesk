"""FinCom Bridge's update list (latest.json) and FinCom's signature on it (latest.json.sig).

The bridge (bridge-go/update.go checkForUpdate) fetches latest.json AND latest.json.sig from its update address and
updates itself only when the signature (RSA PKCS#1 v1.5, SHA-256, base64) verifies with the public key built into it
(updatePublicKeyXML). Without a good signature nothing is installed ("The list of updates has no signature, so nothing
was changed."). This is the same key as the FinCom Connector's (connector/publish.py): connector/signing-key.enc,
opened with the passphrase kept in the staging project's vault (name connector_signing_passphrase).

  python3 tools/bridge_list_sign.py sign   <dir>   sign <dir>/latest.json (its exact bytes) into <dir>/latest.json.sig,
                                                   then verify it as below. The passphrase comes from
                                                   FINCOM_SIGNING_PASS or the file named by FINCOM_SIGNING_PASS_FILE.
                                                   Without either, a latest.json.sig already in <dir> (the one kept
                                                   with the list in assets-test/bridge-go/) is used if, and only if, it
                                                   verifies.
  python3 tools/bridge_list_sign.py verify <dir>   exit 1 unless <dir>/latest.json.sig verifies for the exact bytes of
                                                   <dir>/latest.json with the bridge's built-in key, and a list changed
                                                   by one byte does not.

The private key exists only in a temporary file (mode 600) that is removed as soon as the signature is made; neither it
nor the passphrase is ever printed. RSA PKCS#1 v1.5 signatures are deterministic: the same list always gives the same
signature."""
import base64, hashlib, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPDATE_GO = os.path.join(ROOT, "bridge-go", "update.go")
KEY_ENC = os.path.join(ROOT, "connector", "signing-key.enc")
# SHA-256's DigestInfo prefix (RFC 8017, 9.2 note 1)
SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


def bridge_key(update_go=UPDATE_GO):
    """(n, e) of the key built into the bridge (updatePublicKeyXML)."""
    x = re.search(r'const updatePublicKeyXML = "([^"]+)"', open(update_go, encoding="utf-8").read())
    if not x:
        raise SystemExit("No updatePublicKeyXML in " + update_go)
    n = re.search(r"<Modulus>([^<]+)</Modulus>", x.group(1)).group(1)
    e = re.search(r"<Exponent>([^<]+)</Exponent>", x.group(1)).group(1)
    return int.from_bytes(base64.b64decode(n), "big"), int.from_bytes(base64.b64decode(e), "big")


def verifies(body, sig_text, key):
    """What the bridge's verifySigned does: base64 (spaces around trimmed), RSA PKCS#1 v1.5 with SHA-256."""
    n, e = key
    k = (n.bit_length() + 7) // 8
    try:
        sig = base64.b64decode(sig_text.strip(), validate=True)
    except Exception:
        return False
    if len(sig) != k:
        return False
    s = int.from_bytes(sig, "big")
    if s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, "big")
    t = SHA256_PREFIX + hashlib.sha256(body).digest()
    want = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    return len(t) + 11 <= k and em == want


def check(d, key=None):
    """None when <d>'s list is signed well; else why not."""
    key = key or bridge_key()
    lj, ls = os.path.join(d, "latest.json"), os.path.join(d, "latest.json.sig")
    if not os.path.isfile(lj):
        return "no latest.json in " + d
    if not os.path.isfile(ls):
        return "no latest.json.sig in " + d
    body, sig = open(lj, "rb").read(), open(ls, "r", encoding="ascii", errors="replace").read()
    if not verifies(body, sig, key):
        return d + "/latest.json.sig does not verify for this latest.json with the bridge's built-in key (bridge-go/update.go)"
    if verifies(body + b" ", sig, key) or verifies(body[:-1] + bytes([body[-1] ^ 1]), sig, key):
        return "a changed list verifies too: the check itself is wrong"
    return None


def passphrase():
    pw = os.environ.get("FINCOM_SIGNING_PASS") or ""
    f = os.environ.get("FINCOM_SIGNING_PASS_FILE") or ""
    if not pw and f:
        pw = open(f, encoding="utf-8").read().strip()
    return pw


def sign(d, key_enc=KEY_ENC, key=None):
    lj, ls = os.path.join(d, "latest.json"), os.path.join(d, "latest.json.sig")
    body = open(lj, "rb").read()
    pw = passphrase()
    if not pw:
        why = check(d, key)
        if why:
            raise SystemExit("Not signed: no signing passphrase (FINCOM_SIGNING_PASS or FINCOM_SIGNING_PASS_FILE), and the "
                             "list's kept signature does not do: " + why)
        print("Bridge update list: the kept latest.json.sig verifies for this latest.json (no new signature made)")
        return
    tdir = tempfile.mkdtemp(prefix="fc-sign-")
    os.chmod(tdir, 0o700)
    kf = os.path.join(tdir, "k.pem")
    try:
        r = subprocess.run(["openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-in", key_enc,
                            "-out", kf, "-pass", "env:FC_PW"], env=dict(os.environ, FC_PW=pw), capture_output=True)
        if r.returncode != 0:
            raise SystemExit("Not signed: the signing key could not be opened (wrong passphrase?)")
        os.chmod(kf, 0o600)
        r = subprocess.run(["openssl", "dgst", "-sha256", "-sign", kf], input=body, capture_output=True)
        if r.returncode != 0:
            raise SystemExit("Not signed: openssl could not sign the list")
        sig = r.stdout
    finally:
        try:
            os.remove(kf)
        except FileNotFoundError:
            pass
        os.rmdir(tdir)
    with open(ls, "w", encoding="ascii") as f:
        f.write(base64.b64encode(sig).decode())
    why = check(d, key)
    if why:
        os.remove(ls)
        raise SystemExit("Not signed: " + why)
    print("Bridge update list signed: " + ls + " (sha256 of the list " + hashlib.sha256(body).hexdigest()[:16] + "...)")


def main(argv):
    if len(argv) != 3 or argv[1] not in ("sign", "verify"):
        raise SystemExit(__doc__)
    if argv[1] == "sign":
        sign(argv[2])
    why = check(argv[2])
    if why:
        raise SystemExit("Bridge update list NOT signed well: " + why)
    print("Bridge update list verifies with the bridge's built-in key: " + os.path.join(argv[2], "latest.json"))


if __name__ == "__main__":
    main(sys.argv)
