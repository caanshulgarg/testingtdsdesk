"""FinCom Bridge's update list is signed so the bridges update themselves (tools/bridge_list_sign.py).

1. The signing tool with a throwaway key: signs the exact bytes, the signature verifies, a changed list is refused,
   a wrong passphrase signs nothing, without a passphrase only a kept signature that verifies is accepted, and no
   private key is left behind in the temporary folder.
2. The kept list (assets-test/bridge-go/latest.json + .sig) verifies with the bridge's built-in key, checked two ways:
   this tool's own RSA check, and openssl with the key rebuilt from bridge-go/update.go; a changed list fails both.
3. The published lists on main (next/ and review/assets/bridge-go/), where there is one: a .sig beside each
   latest.json, and it verifies.
4. The release scripts sign/verify: publish-preview.sh signs the built list before anything is published, and
   promote-next.sh refuses a next/ whose list does not verify.
  python3 tests/run_bridge_list_signed.py"""
import base64, glob, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import bridge_list_sign as bls  # noqa: E402

fails = []


def ok(cond, what):
    print(("PASS " if cond else "FAIL ") + what)
    if not cond:
        fails.append(what)


def run(*a, **k):
    return subprocess.run(list(a), capture_output=True, **k)


def der_len(n):
    if n < 128:
        return bytes([n])
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(b)]) + b


def der(tag, body):
    return bytes([tag]) + der_len(len(body)) + body


def der_int(v):
    b = v.to_bytes((v.bit_length() + 8) // 8, "big")
    return der(0x02, b)


def spki_pem(n, e):
    """The bridge's key (n, e) as a PEM public key for openssl."""
    rsa = der(0x30, der_int(n) + der_int(e))
    alg = der(0x30, bytes.fromhex("06092a864886f70d010101") + bytes.fromhex("0500"))
    spki = der(0x30, alg + der(0x03, b"\x00" + rsa))
    b = base64.b64encode(spki).decode()
    return "-----BEGIN PUBLIC KEY-----\n" + "\n".join(b[i:i + 64] for i in range(0, len(b), 64)) + "\n-----END PUBLIC KEY-----\n"


def openssl_verifies(pem, body, sig_b64, tdir):
    pf, bf, sf = (os.path.join(tdir, x) for x in ("pub.pem", "body", "sig"))
    open(pf, "w").write(pem)
    open(bf, "wb").write(body)
    open(sf, "wb").write(base64.b64decode(sig_b64.strip()))
    return run("openssl", "dgst", "-sha256", "-verify", pf, "-signature", sf, bf).returncode == 0


with tempfile.TemporaryDirectory() as t:
    # 1. the tool with a throwaway key (never the real one)
    priv, enc, d = os.path.join(t, "priv.pem"), os.path.join(t, "key.enc"), os.path.join(t, "list")
    os.makedirs(d)
    run("openssl", "genrsa", "-out", priv, "2048", check=True)
    run("openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-in", priv, "-out", enc, "-pass", "pass:test-only", check=True)
    mod = run("openssl", "rsa", "-in", priv, "-noout", "-modulus", text=True, check=True).stdout.strip().split("=")[1]
    tkey = (int(mod, 16), 65537)
    body = b'{\n "bridge": {"version": "9.9.9", "url": "https://example.invalid/b.exe", "sha256": "' + b"0" * 64 + b'"}\n}\n'
    open(os.path.join(d, "latest.json"), "wb").write(body)
    os.environ.pop("FINCOM_SIGNING_PASS", None)
    os.environ["FINCOM_SIGNING_PASS_FILE"] = os.path.join(t, "pw")
    open(os.environ["FINCOM_SIGNING_PASS_FILE"], "w").write("test-only\n")
    before = set(glob.glob(os.path.join(tempfile.gettempdir(), "fc-sign-*")))
    bls.sign(d, key_enc=enc, key=tkey)
    sig = open(os.path.join(d, "latest.json.sig")).read()
    ok(bls.verifies(body, sig, tkey), "1a the signature made verifies for the exact bytes")
    ok(open(os.path.join(d, "latest.json"), "rb").read() == body, "1b the list itself is not changed by signing")
    ok(not bls.verifies(body.replace(b"9.9.9", b"9.9.8"), sig, tkey), "1c a changed version is refused")
    ok(not bls.verifies(body + b"\n", sig, tkey), "1d one more byte is refused")
    ok(not bls.verifies(body, sig, bls.bridge_key()), "1e a list signed with another key is refused by the bridge's key")
    ok(set(glob.glob(os.path.join(tempfile.gettempdir(), "fc-sign-*"))) == before, "1f no temporary key folder left behind")
    ok(b"PRIVATE" not in open(os.path.join(d, "latest.json.sig"), "rb").read(), "1g the .sig holds no key")
    pem = spki_pem(*tkey)
    ok(openssl_verifies(pem, body, sig, t), "1h openssl agrees (the same signature, the key rebuilt from n and e)")
    # a wrong passphrase signs nothing
    open(os.environ["FINCOM_SIGNING_PASS_FILE"], "w").write("wrong\n")
    os.remove(os.path.join(d, "latest.json.sig"))
    try:
        bls.sign(d, key_enc=enc, key=tkey); refused = False
    except SystemExit:
        refused = True
    ok(refused and not os.path.exists(os.path.join(d, "latest.json.sig")), "1i a wrong passphrase: refused, no .sig written")
    # no passphrase: a kept signature only if it verifies
    del os.environ["FINCOM_SIGNING_PASS_FILE"]
    open(os.path.join(d, "latest.json.sig"), "w").write(sig)
    try:
        bls.sign(d, key_enc=enc, key=tkey); kept = True
    except SystemExit:
        kept = False
    ok(kept, "1j no passphrase: the kept signature that verifies is used")
    open(os.path.join(d, "latest.json"), "wb").write(body.replace(b"9.9.9", b"9.9.7"))
    try:
        bls.sign(d, key_enc=enc, key=tkey); stale = False
    except SystemExit:
        stale = True
    ok(stale, "1k no passphrase and a kept signature for another list: refused")

    # 2. the kept list, with the bridge's real built-in key
    real = bls.bridge_key()
    ok(real[0].bit_length() == 3072 and real[1] == 65537, "2a the bridge's key read from bridge-go/update.go (3072-bit, e=65537)")
    kd = os.path.join(ROOT, "assets-test", "bridge-go")
    ok(bls.check(kd) is None, "2b assets-test/bridge-go/latest.json.sig verifies with the bridge's key (" + str(bls.check(kd)) + ")")
    kb = open(os.path.join(kd, "latest.json"), "rb").read()
    ks = open(os.path.join(kd, "latest.json.sig")).read() if os.path.exists(os.path.join(kd, "latest.json.sig")) else ""
    rpem = spki_pem(*real)
    ok(openssl_verifies(rpem, kb, ks, t), "2c openssl verifies it with the key rebuilt from updatePublicKeyXML")
    ok(not openssl_verifies(rpem, kb.replace(b'"2.', b'"3.', 1), ks, t), "2d a changed list fails with openssl")
    ok(not bls.verifies(kb.replace(b'"2.', b'"3.', 1), ks, real), "2e a changed list fails with the tool")

    # 3. what main publishes (when the repository has main)
    for folder in ("next", "review"):
        p = folder + "/assets/bridge-go/latest.json"
        lb = run("git", "-C", ROOT, "show", "origin/main:" + p)
        if lb.returncode != 0:
            print("SKIP 3 " + p + " not on origin/main")
            continue
        ls = run("git", "-C", ROOT, "show", "origin/main:" + p + ".sig", text=True)
        ok(ls.returncode == 0 and bls.verifies(lb.stdout, ls.stdout, real), "3 origin/main:" + p + ".sig exists and verifies")

    # 4. the scripts
    pp = open(os.path.join(ROOT, "app", "publish-preview.sh")).read()
    pn = open(os.path.join(ROOT, "app", "promote-next.sh")).read()
    ok("bridge_list_sign.py\" sign" in pp and pp.index("bridge_list_sign.py") < pp.index("main_checkout\n"), "4a publish-preview.sh signs the built list before it touches main")
    ok("bridge_list_sign.py\" verify" in pn and pn.index("bridge_list_sign.py") < pn.index("replace_folder next review"), "4b promote-next.sh verifies next/'s list before copying it to review/")

print("all passed" if not fails else str(len(fails)) + " failed")
sys.exit(1 if fails else 0)
