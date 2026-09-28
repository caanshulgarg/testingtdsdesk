# FinCom (test site and source)

The test site is published from this repository at https://staging.fincom.live (live: caanshulgarg/tds-desk at https://app.fincom.live; the website: caanshulgarg/fincom-site at https://fincom.live).

- `src/`: the source, joined by `build.py` into one page for live and for test.
- `tests/`: rule, screen and bridge tests (see docs/testing.md). The client's Tally files go in `tests/data/`, which is never committed.
- `bridge/`: the Tally Bridge (1.10.0).
- `docs/`: [architecture](docs/architecture.md), [writing and running tests](docs/testing.md), [setup](docs/setup.md).

`index.html` and `assets/` at the top are the current test build. Client data never goes into this repository.
