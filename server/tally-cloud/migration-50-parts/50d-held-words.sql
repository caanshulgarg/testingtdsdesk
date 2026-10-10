-- Migration 50, part 4 of 4 (50d-held-words): the same text as server/tally-cloud/migration-50-recorder-held.sql, split so each part
-- fits a paste; run the parts in order, each once. Safe to run twice.
begin;
set local lock_timeout = '10s';

update public.tally_recorder_lines set held_why = case
    when held_why = 'unknown entry: not in the copy (the next day read decides)'
      then format('the entry is not in FinCom''s copy yet; it is applied by itself once a complete Day Book for %s is uploaded', coalesce(to_char(vch_date, 'DD-Mon-YYYY'), 'its date'))
    when held_why like 'FinCom posting % matched; no entry body (its posted XML could not be read): the next day read applies it'
      then replace(held_why, 'the next day read applies it', 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book')
    when held_why = 'unknown ledger: not in the copy'
      then 'unknown ledger: not in the copy, so nothing to mark deleted; the next ledger list from FinCom Bridge brings the ledgers up to date'
    when held_why = 'no GUID on the line: held, never a new row' and event in ('deleted', 'cancelled')     -- review L3
      then format('no entry GUID on the line: FinCom cannot tell which entry was %s, so this line is never applied by itself; uploading the Day Book for %s brings that day up to date', event, coalesce(to_char(vch_date, 'DD-Mon-YYYY'), 'its date'))
    else 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book' end
 where state = 'held'
   and (held_why in ('no entry body on the line: the next day read applies it', 'unknown entry: not in the copy (the next day read decides)', 'unknown ledger: not in the copy')
        or held_why like 'FinCom posting % matched; no entry body (its posted XML could not be read): the next day read applies it'
        or (held_why = 'no GUID on the line: held, never a new row' and event in ('created', 'altered', 'imported', 'deleted', 'cancelled')));

commit;
