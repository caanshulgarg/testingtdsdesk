# Security review: FinCom Bridge 2.1.8

Reviewed: 03-Oct-2026 (night), the diff 7162400..a11a37e read hunk by hunk (bridge-go, server/tally-cloud/index.ts,
server/tally-cloud/migration-43-posting-reply.sql), beside the code review of the same range (bridge-2.1.8-code-review.md:
its findings 1, 2 and 5 are the ones with a security edge, a second copy of an entry in a client's books).

Threat focus: a new request shape to Tally outside the allow-list (the batched TALLYMESSAGE); a posting reaching Tally twice
(the owner's first rule); a setting from the cloud widening what this computer may post to or how much it sends per
request; input from the cloud used without bounds (settings, posts, releases); a key, a code or a path in a text sent to
the cloud or written to the log; narration or amounts in the log; the beat body; a new local route or a person-only route
opened to a page; the cloud storing an accepted entry as failed, releasing a locked id, or taking a timing from a device
that does not own the job; the migration's grants.

## Findings
- None high or medium in the security sense (no new route, no new host, no new request shape, no key or path leaks). The
  two high findings of the code review are correctness faults with a client-books consequence and are listed first.
- C1 (from the code review, HIGH there): an import in flight is recorded only after Tally answers; a restart in that
  window resends it (confirmed with a throwaway test). Not exploitable from outside (it needs the bridge to die or be
  stopped mid-request), but Windows updates and the self-update do exactly that; a duplicate voucher in a client's books is
  the harm the whole design exists to prevent. Fix before build: note before sending (code review, finding 1).
- C2 (from the code review, HIGH there): a job that ends "failed" while holding a no-answer entry lets the cloud's
  tally_post_ids_sync free that id (confirmed on the pg stand); a job queued to another computer then sends the entry
  again. Fix before build: a no-answer entry makes the job done (code review, finding 2).
- L1 (low): applyCloudSettings (config.go:363) applies whatever the beat's answer carries: a list of any length, names of
  any length, and PostOnly [] (any company) over a list the installer or the owner set by hand. The cloud side allows this
  only to an owner of the firm (tally_device_post_settings: members.role = 'owner', the device of the firm, not revoked,
  advisory lock, names cleaned to 20 x 200, batches 1..500 or refused), and the owner's standing rule names this the
  owner's FinCom-side choice; the bridge's trust in the beat's answer is the same trust it already places in the read
  stop, the release and the owner's id releases. Noted: the bridge should still bound the list itself (20 names, 200
  characters) before writing it to its settings file and its beat. Test: TestBeatSettingsBounded.
- L2 (informational): the log's "Tally replied" line (post.go:237, the first 400 characters of the IMPORTRESULT, as in
  2.1.7) and the job's failed line carry Tally's LINEERROR words; those name a ledger or a voucher type at most, never a
  FinCom amount or narration (the request's body is never logged). The settings line names the PostOnly companies.
- L3 (informational): the needs-review message is unbounded in the bridge (code review, finding 6): a 500-voucher batch
  with 500 line errors makes a posts_update of tens of megabytes every 3 s from this computer to the cloud. Not an attack
  (the input is Tally's reply), but a self-inflicted load on FinCom's function; capped by the code-review fix.

## Found safe
- No new request shape: every import is importEnvelope (the fixed importHead the allow-list's Import fast path matches at
  the very start of the request) with one TALLYMESSAGE holding the vouchers; the company check is the existing one;
  nothing else is asked of Tally from a posting (TestPostNoReadBackRequests, onlyPostingRequests); TestAllowListUnchanged
  green: the hash of allowlist.go against docs/tally-allowlist.md is as before. The removed read-backs stay in the code for
  the read test and Check Tally only.
- Nothing in the bridge reaches a host but Tally and FinCom: no new URL, no new client; the beat and posts_update carry
  the same endpoints with new fields (counts, ids, seconds, the company name, ISO times). The request's failure detail
  (tallyTrouble) stays in progress.json; the error text sent on a job that could not start carries a setting's name
  (AllowImport) and no path; protectLogText still masks the key in every log line.
- Person-only routes stay person-only: server.go is not in the diff; /jobs, /jobs/resume, /jobs/cancel and /import keep the
  X-Bridge-Key and the origin rule; /tray/, /measure and the read test keep the no-Origin, no-Sec-Fetch gate.
- PostOnly refusal before anything is sent: the job (jobs.go:443) and /import (postingAllowedFor) refuse before the
  company check; the installer's setPostOnly never replaces a list marked "fincom" or "owner" or set by hand; POSTONLY=any
  still clears only an installer list.
- Bounds: batch sizes clamped 1..500 in the bridge (clampBatch) and in the cloud (cleanBatch, the function's check); the
  cloud cuts results and items to 5000, reqs to 1000, every string, and the item states to its list (which must gain the
  two new states: code review, finding 3). The bridge's /jobs payload bounds are as in 2.1.7 (the cloud's queue is
  written by FinCom's pages, each entry an owner's or staff's own posting).
- The cloud never stores an accepted entry as failed: acceptedRes keeps every ok / accepted / held / counted result; a
  needsReview result without accepted is never an acceptance; a byReply + ok result is taken and never held open;
  tally_post_job_settle makes a needs-review posting done, not failed; ids of a needs-review request Tally made something
  of are locked (tally_post_result_taken) and released only when nothing was created ('needs review: ' + message, cut to
  500); tally_post_id_release's reason is cut to 500 on every path. No path where a byReply ok result releases an id.
- Timing is stored by the same update that is scoped .eq("device_id", dev.id) and refused when the bridge is not the main
  one (mayPost); a device cannot write another device's job.
- Migration 43: add-only; tally_device_post_settings security definer, search_path public, pg_temp, owner-only, firm-
  scoped device, revoked from public and anon; tally_post_id_accept_reply service role only (auth.role() check and
  revoke), calling 36b's accept so an owner's release rules hold; tally_post_job_accepted security definer, revoked from
  authenticated; the settle function immutable and table-free; the five device columns readable by authenticated under the
  table's existing firm policy; nothing deleted; runs again over used tables (run_migration43.py).
- The beat body: three scalars more; the broadcast "said" key includes them so a change reaches the pages without a
  larger payload.
- Error paths: an import "not reached" records nothing and asks again after a pause; a timeout or closed connection
  records every entry as sent; nothing is sent to Tally while the read stop, the probe hold or the allow-list refuses.

## Not verified here
- The real Tally's import time per voucher at 500 per request (the 20 s cap, code review finding 7) and whether its
  LINEERROR texts can carry amounts: the stand answers in milliseconds and in fixed words.
- The deno function's behaviour on a cloud where migration 43 is missing beyond what the fallbacks in index.ts say
  (accept_reply -> accept, timing dropped): run_tally_ingest covers the fallbacks' patterns, not a live project without 43.
- FinCom's pages on the new result fields (byReply, needs_review, batchEnd) and the Retry / Post again choice on a done
  job with needs-review entries (code review, finding 11): app code is outside this range.

Range: 7162400..a11a37e (bridge-go/, server/tally-cloud/index.ts, server/tally-cloud/migration-43-posting-reply.sql)
