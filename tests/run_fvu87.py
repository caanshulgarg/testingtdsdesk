"""python3 run_fvu87.py - FinCom's own 26Q, 27Q, 27EQ and 24Q files of FY 2025-26 (the made-up books of fvu_books.js, every
quarter) run through Protean's TDS Standalone FVU 8.7 itself, as a person would before filing: every error the FVU finds
is a failure, except the known limits of FVU 8.7 below.

Protean's FVU is Protean's software and is never committed. The test looks for it at $FINCOM_FVU87 (the folder holding
TDS_STANDALONE_FVU_8.7.jar and its jars), else at the folder it was first tried from; without it the test says
"skipped: FVU not present" and passes, so CI stays green.

The FVU is called by FinCom's small caller tests/fvu/FincomFvu.java (compiled here against the jar), with no .csi file:
the FVU's check of each challan against OLTAS (the challan file downloaded from the TIN site for the TAN) is turned off,
every other check runs. A clean run here says the file is laid out and filled as FVU 8.7 wants; it is not a file for filing.

Known limits of FVU 8.7 (June 2024), older than the law of FY 2025-26:
  T_FV_6138  it caps the standard deduction (16(ia)) at 50,000; from FY 2024-25 it is 75,000 in the new regime (section
             16(ia) as amended by the Finance (No. 2) Act, 2024): expected on a new-regime employee's section 16 record.
  T-FV-4301  it has no section code for 194T (partners, from 1 April 2025): expected on the 194T record of 26R2 only.

next-fvu87 (24-Oct-2026): besides the 16 files, the cases of fvu_books.js cases() (26R2: remarks T, B, Y, a 194Q below
the limit, an inoperative PAN, 194T; 27D2: a treaty-rate deductee with a PAN and one with nature 99, both with their
foreign address kept; 26P3: a challan of the year before; 26O4: one of two years before), each with what FVU 8.7 must say
(EXPECT): nothing, or exactly the errors named.
Needs java and javac (a JDK)."""
import os, re, sys, glob, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
JAR = "TDS_STANDALONE_FVU_8.7.jar"
CANDIDATES = [os.environ.get("FINCOM_FVU87", ""),
              "/tmp/claude-0/-home-user-testingtdsdesk/fc6433d8-fb2a-5779-8c56-1198c4462f3b/scratchpad/fvu87/TDS_STANDALONE_FVU_8.7"]
FVU = next((d for d in CANDIDATES if d and os.path.isfile(os.path.join(d, JAR))), None)
if not FVU or not shutil.which("java") or not shutil.which("javac"):
    print("skipped: FVU not present" if not FVU else "skipped: no JDK (java and javac) for the FVU")
    sys.exit(0)
OUT = os.path.join(HERE, "out", "fvu87"); IN = os.path.join(OUT, "in"); CLS = os.path.join(OUT, "classes")
for d in (IN, CLS): os.makedirs(d, exist_ok=True)
for f in glob.glob(os.path.join(IN, "*")): os.remove(f)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
cp = os.pathsep.join([os.path.join(FVU, JAR), os.path.join(FVU, "*")])
subprocess.run(["javac", "-cp", os.path.join(FVU, JAR), "-d", CLS, os.path.join(HERE, "fvu", "FincomFvu.java")], check=True)
built = subprocess.run(["node", os.path.join(HERE, "fvu_books.js"), IN], capture_output=True, text=True, cwd=HERE)
ok(built.returncode == 0, "FinCom built the files (" + (built.stderr.strip()[-300:] or "ok") + ")")
files = sorted(glob.glob(os.path.join(IN, "*.txt")))
# the cases (fvu_books.js cases()): the FVU's error codes each must give, no more, no fewer ("": none)
EXPECT = {"26R2.txt": {"T-FV-4301"}, "27D2.txt": set(), "26P3.txt": set(), "26O4.txt": {"T-FV-3166"}}
ok(len(files) == 16 + len(EXPECT), "20 files: 26Q, 27Q, 27EQ, 24Q, four quarters each, and the cases " + ", ".join(EXPECT) + " (" + str(len(files)) + ")")

def known(name, line, text):
    """an error of FVU 8.7's own age (see above), on the record it names"""
    f = line.split("^")
    if len(f) > 5 and f[5] == "T-FV-4301" and name == "26R2.txt":
        rec = text.split("\r\n")[int(f[0]) - 1].split("^") if f[0].isdigit() else []
        return len(rec) > 32 and rec[1] == "DD" and rec[12] == "Anil Partner"
    if len(f) > 5 and f[5] == "T_FV_6138" and name.startswith("24Q"):
        rec = text.split("\r\n")[int(f[0]) - 1].split("^") if f[0].isdigit() else []
        return len(rec) > 6 and rec[1] == "S16" and rec[5] == "16(ia)" and float(rec[6]) <= 75000
    return False

for path in files:
    name = os.path.basename(path)
    r = subprocess.run(["java", "-Djava.awt.headless=true", "-cp", cp + os.pathsep + CLS, "FincomFvu", path, os.path.join(OUT, name[:-4] + ".err")],
                       capture_output=True, text=True, cwd=OUT, timeout=300)
    out = r.stdout
    ok("--- result buffer:" in out, name + ": the FVU ran")
    errs = [l.strip() for l in out.split("--- result buffer:", 1)[-1].split("\n") if re.match(r"^\S+\^", l.strip())]
    text = open(path, newline="").read()
    bad = [e for e in errs if not known(name, e, text)]
    for e in errs:
        if e not in bad: print("        known limit of FVU 8.7: " + e)
    if name in EXPECT and EXPECT[name]:
        got = {e.split("^")[5] for e in errs if len(e.split("^")) > 5}
        rest = [e for e in bad if e.split("^")[5] not in EXPECT[name]]
        ok(EXPECT[name] <= got and not rest, name + ": FVU 8.7 gives " + ", ".join(sorted(EXPECT[name])) + " and nothing else" + ("" if not rest and EXPECT[name] <= got else ": " + " | ".join((rest or errs or ["no error"])[:6])))
    else:
        ok(not bad, name + ": no error" + ("" if not bad else ": " + " | ".join(bad[:6])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
