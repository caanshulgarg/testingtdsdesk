"""Write a copy of a TypeScript file with its full-line // comments removed (lines whose first non-space characters
are //). Nothing else changes: no trailing comment, no whitespace, no code. Used to fit tally-ingest's index.ts under
the deploy tool's size limit; prove the code is the same with esbuild (see server/tally-cloud/deploy/README.md)."""
import re, sys
src, dst = sys.argv[1], sys.argv[2]
t = open(src, encoding="utf-8").read()
open(dst, "w", encoding="utf-8").write("\n".join(l for l in t.split("\n") if not re.match(r"^\s*//", l)))
