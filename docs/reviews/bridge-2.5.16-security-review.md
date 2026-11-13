# Security review: FinCom Bridge 2.5.16 (security work; older days read in the day; stops that lift by themselves; the by-type split; Tally's port)

Status: independent review pending. The coordinator's full security review of FinCom Bridge (13-Nov-2026) is the source
of the security items; their fixes, and the day-reading and port items added on 13-Nov-2026, are to be reviewed
independently before the release exe is built and release-check.sh is run.

Range: c851cd1dc..1fd25c431 (origin/staging-next with 2.5.15 at c851cd1dc, which holds 2.5.15's signed commit 2bf75a4c7; the whole of 2.5.16 through the port items and their test fix)

Areas for the reviewer (no finding details are written here; the repository is public):
- The security items of 2.5.16 (e0c77945d to d2b7fd47a): local settings and files the bridge trusts, the Windows
  service's folder, start and rights, per-user files on a shared computer, browser keys and pairing, the sites the
  bridge answers, logging of refused requests, tally.ini files never written in TallyPrime's program folder.
- The day-reading items (51a2b5a92, 4ec2bf553, 900928f02): no new Tally request; the gate's FinComDayHeads exception
  widened only to F2 for the day being read by type; new cloud kind period_day_stop (a book of this computer's own
  company and GUID only, as the other period kinds); migration 197's grants (the table and the bridge's two functions
  service_role only; the page's status for members of the book's firm).
- The port items (bf0ebdf00): Windows' own lists only, nothing sent to Tally, no tally.ini written; the beat's new
  fields (lastKeyAt, tallyPortNotSaved) carry no secret; the page still requires the bridge to prove itself at the port
  FinCom's cloud names before anything secret is sent.
