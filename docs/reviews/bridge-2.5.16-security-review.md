# Security review: FinCom Bridge 2.5.16 (security work; older days read in the day; stops that lift by themselves; the by-type split; Tally's port)

Status: independently reviewed 14-Nov: code, security and two re-reviews, no blockers.

Range: c851cd1dc..44452446b (origin/staging-next with 2.5.15 at c851cd1dc, which holds 2.5.15's signed commit 2bf75a4c7; the whole of 2.5.16 through the code and security reviews' fixes, up to 053994f5d; after it the review notes and the merge of origin/staging-next d9bc68021 in 44452446b, which changed nothing under bridge-go/)

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

The security review of 2.5.16 (no critical or high finding) and what was done, as the code now does it:
- M1: the setup for all users reads the owner's earlier settings with the owner's rights (impersonated); the owner not
  signed in: the service reads them at its first start with the owner's rights. Windows only: on the test sheet.
- L1: FinCom's address (FinComUrl) is not carried over from the earlier settings; the setup sets it from its build.
- L2: the FVU file is looked at and fingerprinted with the owner's rights (the service: impersonated).
- L3: the FVU's Class-Path entries are percent-decoded before they are checked; a jar the FVU loads that names jars of
  its own is refused.
- L4: the /tray/ routes take the tray's own one-use proof only, never a browser's key.
- L5: the earlier link is taken only if, under the settings' lock after FinCom answered, no newer link was made;
  tally-ingest answers key_check at most 30 times an hour for one computer key; a bridge id with no Windows user
  recorded (or none said) is not known: the person connects FinCom again.

The re-review of the fixes (053994f5d): the deferred read of the earlier settings keeps their bridge id, browser keys, port
and link to FinCom over what the setup made new; key_check's limit is counted in the database (auth_rate_hit).
