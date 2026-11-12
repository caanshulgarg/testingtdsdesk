-- migration-173-gst-filing-once (12-Nov-2026, branch next-fix-gst-file-once; written, NOT run: the owner reads it and runs it
-- BEFORE the gst-taxpro function that uses it is deployed). Item 1 of the GST filing state-machine review: filing through the
-- GST API never sends the tax set-off (RETOFFSET) or the filing (RETFILE) twice. Add-only: four columns on gst_filings
-- (migration-94), no status value added, no CHECK changed, no row's data changed. Safe to run twice.
--   busy_token, busy_action, busy_until   the return's lease: each action that writes (save, summary, confirm, proceed,
--                                         evc_otp, file, track) takes it with one conditional update (where busy_until <
--                                         now(), returning the row), so of two at once only one runs and the other is told
--                                         it is already in progress; every write of the action is conditional on its
--                                         busy_token; the holder releases it (busy_until back to 1970). 10 minutes at most,
--                                         longer than any one action, so a crashed action never holds a return for long
--   file_tried_at                         set just before RETFILE is sent: a File whose answer had no ARN is followed by
--                                         RETTRACK (was it filed?) before RETFILE is sent again
-- A save the portal is still processing stays status 'saved' with save_state 'IP' (asked again by summary and track), so
-- no new status is needed. Written only by the function (service role); members read the row as before (RLS of migration-94).
begin;
set local lock_timeout = '10s';

alter table public.gst_filings add column if not exists busy_token text;
alter table public.gst_filings add column if not exists busy_action text;
alter table public.gst_filings add column if not exists busy_until timestamptz not null default '1970-01-01 00:00:00+00';
alter table public.gst_filings add column if not exists file_tried_at timestamptz;

comment on column public.gst_filings.busy_until is 'migration-173: the lease of the action running on this return (gst-taxpro); free when in the past';
comment on column public.gst_filings.file_tried_at is 'migration-173: when RETFILE was last sent; a File after it asks RETTRACK first';

-- the grants as migration-97 states them (members read, the service role writes); nothing for anon
revoke all on table public.gst_filings from anon;
revoke insert, update, delete, truncate, references, trigger on table public.gst_filings from authenticated;
grant select on table public.gst_filings to authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.gst_filings to service_role;

commit;
