"""python3 run_fvu12_forms.py - FinCom's Forms 138, 140, 143 and 144 through Protean's own FVU 1.2 (17-Aug-2026).

run_tds_forms_2025.js builds the files (tests/out/forms2025/): F<form> as FinCom makes them for a firm paying by challan,
V<form> the same as a State Government's by book adjustment, B<form> and G<form> from the owner's RPU samples. FVU 1.2
needs the challan file (.csi) from TIN / the e-filing portal for a challan ("C") file and stops before the deductee records
without it, so: a V or B file must pass with no error at all; an F file with none but T-FV-1041 (the .csi is missing);
a G file (the samples' own data) with none but T_FV_6506 (the samples leave the DDO serial number out).

FVU 1.2 is Protean's and is never committed: TDSDESK_FVU12 names the folder with TDS_STANDALONE_FVU_1.2.jar and its
libraries; without it (or without java / xvfb-run) the test says so and passes as skipped."""
import os, re, subprocess, sys, shutil, glob
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("TDSDESK_OUT") or os.path.join(HERE, "out")
FVU = os.environ.get("TDSDESK_FVU12", "")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

r = subprocess.run(["node", os.path.join(HERE, "run_tds_forms_2025.js")], cwd=HERE, capture_output=True, text=True)
ok(r.returncode == 0, "run_tds_forms_2025.js passes and writes the files" + ("" if r.returncode == 0 else ": " + r.stdout[-800:]))
jar = os.path.join(FVU, "TDS_STANDALONE_FVU_1.2.jar") if FVU else ""
if not (jar and os.path.exists(jar) and shutil.which("java") and shutil.which("javac") and shutil.which("xvfb-run")):
    print("  skip Protean's FVU 1.2 is not here (TDSDESK_FVU12=%r): nothing run through it" % FVU)
    print("\n" + ("%d FAILED" % len(fails) if fails else "all passed (FVU step skipped)")); sys.exit(1 if fails else 0)

work = os.path.join(OUT, "fvu12"); shutil.rmtree(work, ignore_errors=True); os.makedirs(work)
cp = jar + os.pathsep + os.path.join(FVU, "*")
c = subprocess.run(["javac", "-cp", cp, "-d", work, os.path.join(HERE, "fvu12", "RunFvu12.java")], capture_output=True, text=True)
ok(c.returncode == 0, "the harness compiles" + ("" if c.returncode == 0 else ": " + c.stderr[-500:]))
ALLOWED = {"F": {"T-FV-1041"}, "V": set(), "B": set(), "G": {"T_FV_6506"}}
files = sorted(glob.glob(os.path.join(OUT, "forms2025", "[FVBG]1[34]?.txt")))
ok(len(files) >= 14, "the statements to check: %s" % [os.path.basename(f) for f in files])
for f in files:
    name = os.path.basename(f)            # at most 12 characters, as the FVU wants
    shutil.copy(f, os.path.join(work, name))
    p = subprocess.run(["timeout", "180", "xvfb-run", "-a", "java", "-cp", cp + os.pathsep + work, "RunFvu12", name, os.path.join(work, "o" + name[:-4]), "0"],
                       cwd=work, capture_output=True, text=True)
    out = p.stdout.split("--- errors:", 1)
    errs = [l for l in (out[1].strip().splitlines() if len(out) > 1 else ["no answer: " + p.stdout[-300:] + p.stderr[-300:]]) if l.strip() and l.strip() != "(none)"]
    codes = {(l.split("^") + [""] * 6)[5] for l in errs}
    allowed = ALLOWED[name[0]]
    ok(codes <= allowed, "FVU 1.2: %s %s%s" % (name, "valid" if not errs else "only " + ", ".join(sorted(codes)) if codes <= allowed else "errors",
       "" if codes <= allowed else "\n         " + "\n         ".join(errs[:10])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
