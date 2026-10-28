"""python3 v8.py <captures/batch/diff.txt>  (tally-versions mode batch, collect job; harness only)

Prints the job's v8 line and one MEASURE line per phase and form from zz_fcbatch_diff_test.go's DIFF lines. A form
passes when, in every phase, every entry it answered kept exactly the fields FinComVoucherObject's answer keeps (lines
in another order allowed: FinCom's reader does not use the order), none missing, none extra, none held by the strip."""
import re, sys

NAME = "v8 kept fields identical to FinComVoucherObject's, through the bridge's strip"
try:
    lines = [l.rstrip("\n") for l in open(sys.argv[1], encoding="utf-8") if l.startswith("DIFF ")]
except OSError:
    lines = []
if not lines:
    print("HARNESS %s: the diff wrote nothing" % NAME)
    sys.exit(0)
forms = {}
for l in lines:
    print("MEASURE diff " + l[5:])
    m = re.match(r"DIFF (\S+) (\S+): asked (\d+), kept fields identical (\d+), identical but lines in another order (\d+), differ (\d+), missing (\d+), extra (\d+), held by the strip \(batch (\d+), one-by-one (\d+)\), no one-by-one answer (\d+)", l)
    if not m:
        continue
    ph, fm = m.group(1), m.group(2)
    asked, same, unord, differ, missing, extra, hb, ho, noref = (int(x) for x in m.groups()[2:])
    ok = asked > 0 and differ == 0 and missing == 0 and extra == 0 and hb == 0 and ho == 0 and same + unord + noref == asked and noref < asked
    forms.setdefault(fm, []).append((ph, ok, "%s %s: %d/%d identical (%d with lines in another order), differ %d, missing %d, extra %d, held %d" % (ph, fm, same + unord, asked, unord, differ, missing, extra, hb + ho)))
good = sorted(f for f, v in forms.items() if all(ok for _, ok, _ in v))
ev = "; ".join(t for f in sorted(forms) for _, _, t in forms[f])
if good:
    print("PASS %s: every entry identical in every phase for %s; %s" % (NAME, ", ".join(good), ev))
else:
    print("FAIL %s: no form identical on every entry (captures/batch/diff.txt); %s" % (NAME, ev))
