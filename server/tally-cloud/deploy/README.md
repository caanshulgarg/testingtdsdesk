# tally-ingest deploy copy (bridge 2.3.1)

The deploy tool takes each file's whole text in one call; `index.ts` at 09b1b23 (256,424 bytes) is over its limit
(about 180 KB). With the owner's approval of 06-Oct-2026, `index.deploy.ts` is `index.ts` with its full-line `//`
comments removed (`python3 tests/tools/strip_comment_lines.py server/tally-cloud/index.ts server/tally-cloud/deploy/index.deploy.ts`),
166,862 bytes, and is deployed as the function's `index.ts`.

| File | sha256 |
|---|---|
| server/tally-cloud/index.ts (source, 09b1b23) | e45f02b8bad8ea84e1e7ec953fb54127c159bd57c179cab58bcfe1b2173c1b9b |
| server/tally-cloud/deploy/index.deploy.ts (deployed as index.ts) | 685574acd17c8ff98773b0f725d0dee8378cb0d3d3cd10a9a2e9434100a7e31c |

Proof the code is the same:
- No removed line lies inside a multi-line template string (a scan of every backtick string: 0 removed lines inside one).
- `npx esbuild <file> --format=esm --legal-comments=none --minify-whitespace` gives byte-identical output for both files:
  sha256 3a04f95cabd9841c1178a6833e987eff26ac114ef4dc486f0dcc053fbedbc0e5 (esbuild 0.28.2).

parse.js, ../_shared/names.js and ../_shared/cors.ts are deployed byte for byte from 09b1b23.
