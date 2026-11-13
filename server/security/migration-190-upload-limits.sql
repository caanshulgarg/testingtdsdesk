-- Upload limits on two Storage buckets (13-Nov-2026, branch next-sec-server; security review of 13-Nov-2026, L8).
-- NOT run on staging by the app's builders: the owner runs it. Runs after 189 (it needs nothing of it, nor of 183 to
-- 188, which are other branches'); needs the buckets of migration 102 (call-files) and of tally-cloud's first
-- migration (tally-days), and does nothing for one that is not there.
--
--   call-files   the files people send in a call's chat, and each person's microphone pieces. Any file may be sent;
--                the fincom-call function tells the page the type to put it under: a listed type as it is, anything
--                else as plain bytes (application/octet-stream; app/src/calls/rules.js STORE_TYPES, the same list as
--                here, checked by tests/run_migration190.py). With this the bucket itself takes only those types, so
--                nothing is kept under a type a browser would run. Set only where no list is set.
--                Deploy the app and the fincom-call function first: an older page puts a file under the type the
--                browser gives it, and Storage would refuse one that is not listed.
--   tally-days   the day books (gzip), written by the service role only: a size limit of 64 MB (a day's book is at
--                most 60 MB unzipped), where it had none.
-- No other bucket is touched: assistant-files keeps "any type" (Ask FinCom's attachments), with its own 25 MB limit.
-- Add-only in effect: no object, table, function or policy is changed; two settings are filled in where they were
-- empty. One transaction, lock_timeout 10 s. Safe to run twice, and on a database without Storage.

begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'migration-190: storage.buckets is not on this database; skipped';
    return;
  end if;
  update storage.buckets
     set allowed_mime_types = array[
       'application/octet-stream', 'audio/*', 'video/*',
       'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/bmp', 'image/tiff', 'text/plain', 'text/csv',
       'application/zip', 'application/json', 'application/xml', 'text/xml', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation']
   where id = 'call-files' and allowed_mime_types is null;
  update storage.buckets set file_size_limit = 67108864 where id = 'tally-days' and file_size_limit is null;
end $$;

commit;
