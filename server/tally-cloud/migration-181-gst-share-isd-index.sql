-- Migration 181 (12-Nov-2026, branch next-gst-isd-2b; review of c0d037200): an index of the entries Tally types
-- "Input Service Distributor", for migration 180's gst_share_ctx_version (called by every gst-run sweep, often several
-- times a minute). Without it the version reads every entry of the book (12 ms became 113 to 237 ms a call on a
-- 100,000-entry book); with it only the few ISD-typed ones (tests/run_migration181.py).
-- Run BEFORE migration 180. Not in a transaction: "create index concurrently" cannot be, and does not block the cloud
-- copy's writes while it is made. Its predicate is 180's, character for character (GSTR.ISD_RE's strings,
-- tests/isd_types.json), so the planner may use it.
-- Adds only this index (partial, small: no row unless it is ISD-typed). Safe to run twice. If a run is cut off, the
-- index may be left invalid: drop it by hand (drop index concurrently public.tally_vouchers_isd_typed) and run again.
set lock_timeout = '10s';

create index concurrently if not exists tally_vouchers_isd_typed on public.tally_vouchers (book_id)
  where deleted_at is null and gst_reg_type ~* '(input[ \t\n\r_-]*service[ \t\n\r_-]*distributor|^[ \t\n\r]*isd([^A-Za-z0-9_]|$))';

reset lock_timeout;
