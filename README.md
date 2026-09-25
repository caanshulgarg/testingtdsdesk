# TDS Desk (test site and source)

The test site is published from this repository: https://caanshulgarg.github.io/testingtdsdesk/ (live: caanshulgarg/tds-desk).

- `src/`: the source, joined by `build.py` into one page for live and for test.
- Tests: kept in a private repository, because they check figures from a real client's books.
- `bridge/`: the Tally Bridge (1.10.0).
- `docs/`: [architecture](docs/architecture.md), [writing and running tests](docs/testing.md), [setup](docs/setup.md).

`index.html` and `assets/` at the top are the current test build. Client data never goes into this repository.
