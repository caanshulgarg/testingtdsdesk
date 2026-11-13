-- Upload limits on two Storage buckets (13-Nov-2026, branch next-sec-server).
-- NOT run on staging by the app's builders: the owner runs it. Runs after 189 (it needs nothing of it, nor of 183 to
-- 188, which are other branches'). It sets a bucket only where that bucket is there: call-files is made by migration
-- 102, tally-days by server/tally-cloud/migration.sql.
--
--   call-files   the files people send in a call's chat, and each person's microphone pieces. The bucket's list of
--                types becomes: the app's list for chat files (app/src/calls/rules.js STORE_TYPES; documents, pictures,
--                plain text, zip and JSON), plain bytes (application/octet-stream), audio/* and video/*. Any file may
--                still be sent in a chat: the fincom-call function tells the page the type to put it under, a type of
--                STORE_TYPES as it is and anything else as plain bytes. tests/run_migration190.py checks the list here
--                against STORE_TYPES. Set only where the bucket has no list (allowed_mime_types is null); its size
--                limit (20 MB, from migration 102) is not changed.
--                Deploy the app and the fincom-call function first: an older page puts a file under the type the
--                browser gives it, and Storage refuses a type that is not listed.
--   tally-days   the day books (gzip): a size limit of 64 MB where it has none (file_size_limit is null).
-- No other bucket is touched (assistant-files, call-recordings and tally-uploads stay as they are).
-- Two updates of storage.buckets and nothing else: no table, function, policy or stored file is changed. One
-- transaction, lock_timeout 10 s. Safe to run twice, and on a database without Storage (it then does nothing).

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
       'application/zip', 'application/json', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation']
   where id = 'call-files' and allowed_mime_types is null;
  update storage.buckets set file_size_limit = 67108864 where id = 'tally-days' and file_size_limit is null;
end $$;

commit;
