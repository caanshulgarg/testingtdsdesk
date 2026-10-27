"""python3 run_contrast.py - the colour scheme of 02-Oct-2026: every text colour on the backgrounds it is used on meets WCAG AA
(4.5:1) in light and dark, read from the tokens in src/css/app.css."""
import re, os, sys
CSS = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "css", "app.css")).read()
def block(start):
    i = CSS.index(start); j = CSS.index("}", i); return dict(re.findall(r"--([a-z0-9-]+):(#[0-9A-Fa-f]{6})", CSS[i:j]))
light = block(":root{"); dark = block(':root[data-theme="dark"]{')
def lum(h):
    c = [int(h[k:k + 2], 16) / 255 for k in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True); return (la + 0.05) / (lb + 0.05)
PAIRS = [("ink", "paper"), ("ink", "sheet"), ("ink", "sheet-2"), ("muted", "paper"), ("muted", "sheet"), ("muted", "sheet-2"),
         ("brand", "sheet"), ("brand", "paper"), ("brand", "brand-tint"), ("on-brand", "brand"), ("on-brand", "brand-hover"),
         ("ok", "ok-soft"), ("ok", "sheet"), ("warn", "warn-soft"), ("warn", "sheet"), ("bad", "bad-soft"), ("bad", "sheet"), ("info", "info-soft"), ("info", "sheet"),
         ("side-ink", "side"), ("side-muted", "side"), ("side-ink", "side-hover"), ("side-on-ink", "side-on"), ("paper", "ink")]
fails = []
for name, t in (("light", light), ("dark", dark)):
    for fg, bg in PAIRS:
        r = ratio(t[fg], t[bg]); ok = r >= 4.5
        print(("  ok   " if ok else "  FAIL ") + "%-5s %-11s on %-11s %5.2f:1" % (name, fg, bg, r))
        if not ok: fails.append((name, fg, bg, r))
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
sys.exit(1 if fails else 0)
