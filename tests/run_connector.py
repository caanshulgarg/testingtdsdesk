"""python3 run_connector.py - the FinCom Connector (Windows app) under Mono, against the real bridge and a stand-in Tally:
it installs the bridge, keeps it running (and starts it again when it stops), checks the computer, packs the log for
support without keys, and updates the bridge only with a file that matches its fingerprint, going back when a new
bridge does not start. The window itself is drawn once on a virtual screen to see it opens."""
import os, sys, subprocess, tempfile, threading, functools, http.server, shutil, time
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import fake_tally, socket
# a bridge left from another test must not hold the bridge's port: this test is about the Connector's own bridge
def port_free(p):
    s_ = socket.socket(); 
    try: s_.bind(("127.0.0.1", p)); return True
    except OSError: return False
    finally: s_.close()
for _ in range(30):
    if port_free(9100): break
    for pid in subprocess.run(["pgrep", "-f", "TDSBridge.ps1"], capture_output=True, text=True).stdout.split():
        if int(pid) != os.getpid():
            try: os.kill(int(pid), 9)
            except Exception: pass
    time.sleep(1)
fake_tally.start()
home = tempfile.mkdtemp(prefix="fincom-home-")
upd = tempfile.mkdtemp(prefix="fincom-upd-")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=upd); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8150), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
subprocess.run(["sh", os.path.join(ROOT, "connector", "build.sh")], check=True, stdout=subprocess.DEVNULL)
shutil.copy(os.path.join(HERE, "fake.json"), os.path.join(home, "fake.json"))
# a test signing key: the Connector checks update lists against its public half
from cryptography.hazmat.primitives.asymmetric import rsa as _rsa
import base64 as _b64
_k = _rsa.generate_private_key(public_exponent=65537, key_size=2048); _n = _k.private_numbers(); _p = _n.public_numbers
_b = lambda i, n=None: _b64.b64encode(i.to_bytes(n or (i.bit_length() + 7) // 8, "big")).decode()   # .NET wants the private parts at their full length
open(os.path.join(upd, "..", "fincom-test-pub.xml"), "w").write("<RSAKeyValue><Modulus>%s</Modulus><Exponent>%s</Exponent></RSAKeyValue>" % (_b(_p.n), _b(_p.e)))
open(os.path.join(upd, "..", "fincom-test-priv.xml"), "w").write("<RSAKeyValue><Modulus>%s</Modulus><Exponent>%s</Exponent><P>%s</P><Q>%s</Q><DP>%s</DP><DQ>%s</DQ><InverseQ>%s</InverseQ><D>%s</D></RSAKeyValue>" % (
    _b(_p.n), _b(_p.e), _b(_n.p, 128), _b(_n.q, 128), _b(_n.dmp1, 128), _b(_n.dmq1, 128), _b(_n.iqmp, 128), _b(_n.d, 256)))
env = dict(os.environ, FINCOM_TEST="1", FINCOM_TEST_PUBKEY=os.path.join(upd, "..", "fincom-test-pub.xml"), FINCOM_TEST_SIGNKEY=os.path.join(upd, "..", "fincom-test-priv.xml"), FINCOM_HOME=home, FINCOM_PWSH=os.environ.get("PWSH", "/opt/pwsh/pwsh"), TDSBRIDGE_FAKE=os.path.join(home, "fake.json"), FINCOM_UPDATE_WAIT="40")
fails = 0
r = subprocess.run(["mono", os.path.join(ROOT, "connector", "FinComConnector.exe"), "--selftest", "--updates", upd], env=env, capture_output=True, text=True, timeout=900)
print(r.stdout.rstrip()); 
if r.returncode != 0: print(r.stderr[-2000:]); fails += 1
# the window, on a virtual screen: it opens, and the program keeps running in the tray
xv = subprocess.Popen(["Xvfb", ":77", "-screen", "0", "1280x800x24"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
gui = subprocess.Popen(["mono", os.path.join(home, "FinComConnector.exe")], env=dict(env, DISPLAY=":77"), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(25)
alive = gui.poll() is None
out = ""
if alive: gui.terminate()
try: out = gui.communicate(timeout=10)[0]
except Exception: pass
ok = alive and "Exception" not in out
print(("  ok   " if ok else "  FAIL ") + "the window opens and the program stays running" + ("" if ok else ": " + out[-1500:]))
if not ok: fails += 1
xv.terminate()
for p in subprocess.run(["pgrep", "-f", home], capture_output=True, text=True).stdout.split():
    try: os.kill(int(p), 15)
    except Exception: pass
print("all passed" if not fails else str(fails) + " FAILED")
sys.exit(1 if fails else 0)
