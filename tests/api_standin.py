"""python3 tests/api_standin.py <port> <file.sql> - a stand-in for the Management API's query call, on a throwaway
PostgreSQL (pg_stand) only: the file's whole text is sent as ONE query (psql -c, the simple query protocol, as the API
does: several statements are one implicit transaction), the last answer printed as JSON rows (t/f as true/false), an
error as {"message": "..."} with exit 0, as the API answers. STANDIN_PGOPTIONS (e.g. "-c lock_timeout=1s") is the
server's own setting for the session, to force a lock wait to be cut off."""
import csv, io, json, os, subprocess, sys
BIN = "/usr/lib/postgresql/16/bin"
port, path = sys.argv[1], sys.argv[2]
env = dict(os.environ, PGOPTIONS=os.environ.get("STANDIN_PGOPTIONS", ""))
r = subprocess.run(["runuser", "-u", "postgres", "--", "env", "PGOPTIONS=" + env["PGOPTIONS"], BIN + "/psql", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "postgres",
                    "-X", "-q", "--csv", "-v", "ON_ERROR_STOP=1", "-c", open(path).read()], capture_output=True, text=True)
if r.returncode:
    print(json.dumps({"message": "Failed to run sql query: " + r.stderr.strip()})); sys.exit(0)
rows = list(csv.DictReader(io.StringIO(r.stdout))) if r.stdout.strip() else []
print(json.dumps([{k: (True if v == "t" else False if v == "f" else v) for k, v in row.items()} for row in rows]))
