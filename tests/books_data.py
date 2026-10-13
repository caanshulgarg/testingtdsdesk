"""Where the browser and bridge tests find a client's books, as tests/harness.js does for the Node tests:
TDSDESK_DATA, else a real client's export in tests/data (Master.xml, DayBook.xml, books-cache.json: never committed), else
the made-up books committed in tests/fixtures/books. FIXTURE is True for the made-up books: the tests then check the
figures worked out by hand in tests/fixtures/books/EXPECTED.md, and use the names below instead of the real client's.

CACHE is the day book as the app reads it (Books.importDayBook), the JSON the tests load into the page: TDSDESK_CACHE, the
real tests/data/books-cache.json, or for the fixture one made by fixture_cache.js (again when the day book or app changes)."""
import os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_DIR = os.path.join(HERE, "data")
FIXTURE_DIR = os.path.join(HERE, "fixtures", "books")
DATA = os.environ.get("TDSDESK_DATA") or (REAL_DIR if os.path.exists(os.path.join(REAL_DIR, "Master.xml")) else FIXTURE_DIR)
FIXTURE = os.path.abspath(DATA) == os.path.abspath(FIXTURE_DIR)
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out"))
FIXTURE_CACHE = os.path.join(OUT, "fixture-books-cache.json")


def _mtime(p):
    try: return os.path.getmtime(p)
    except OSError: return 0


def cache():
    if os.environ.get("TDSDESK_CACHE"): return os.environ["TDSDESK_CACHE"]
    if not FIXTURE: return os.path.join(REAL_DIR, "books-cache.json")
    html = os.environ.get("TDSDESK_HTML", os.path.join(HERE, "..", "site-test", "index.html"))
    if _mtime(FIXTURE_CACHE) < max(_mtime(os.path.join(FIXTURE_DIR, "DayBook.xml")), _mtime(html)):
        subprocess.run(["node", os.path.join(HERE, "fixture_cache.js"), FIXTURE_CACHE], check=True)
    return FIXTURE_CACHE


CACHE = cache()

# the names and figures the tests use: the real client's (tests/data) or the fixture's (EXPECTED.md)
if FIXTURE:
    COMPANY = "Larkspur Fixture Events Private Limited"
    GSTIN, GSTIN09 = "07AAGCL4827M1Z3", "09AAGCL4827M1ZZ"
else:
    COMPANY = "VMS EVENTS PRIVATE LIMITED"
    GSTIN, GSTIN09 = "07AADCV3366N1ZU", "09AADCV3366N1ZQ"
