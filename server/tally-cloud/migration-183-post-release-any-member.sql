-- migration-183-post-release-any-member.sql (13-Nov-2026, branch next-release-any-member). Written, NOT run yet: the owner
-- reads it and runs it.
-- Why (the owner's decision, 13-Nov-2026): any member of the firm who may post (an owner or staff: can_write()), not only
-- an owner, may release a bill marked "Deleted in Tally" so it can be posted again: "I checked in Tally: not there –
-- release", with a fresh reason, the warning "If it is in Tally, it will be posted twice", and kept with the member's name
-- and the time (tally_post_release_core: tally_post_marks.by_user, the entry's words). A look-only member ('readonly') is
-- refused, as is a firm FinCom's console has paused (118's can_write()).
-- What 183 does: tally_post_owner_release(p_job, p_id, p_why) from its latest text (174), the role check only: can_write()
-- in place of members.role = 'owner' (the rule tally_post_job_mark_posted and tally_post_settle_ask of 55 use); the words of
-- the refusal name who may. Everything else as 174: a reason required, never while the posting is waiting, taken or
-- running, released through tally_post_release_core with the warning in the words; the answer's 'owner' kept (the page
-- reads ok). Nothing made, dropped or deleted; no rows changed. Grants restated as 174 (authenticated; not public, anon).
-- One transaction, lock_timeout 10 s, safe twice. Runs after 174 (and 55).
-- Deploy order: 183, then the page of this branch (before 183 the page's member gets the server's words, "only an owner of
-- the firm can say this", and the release waits under Post to Tally > Errors).
-- Tested on pg_stand: tests/run_migration183.py (RED_WITHOUT_183=1 fails).

begin;
set local lock_timeout = '10s';

create or replace function public.tally_post_owner_release(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); why text := left(btrim(coalesce(p_why, '')), 400); j tally_post_jobs%rowtype;
begin
  if f is null or not can_write() then
    raise exception 'only a member of the firm who may post (an owner or staff) can say this' using errcode = '42501'; end if;
  if why = '' then raise exception 'say where you looked in Tally (kept with your name and the time)'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f for update;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if j.status in ('waiting', 'taken', 'running') then
    return jsonb_build_object('ok', false, 'error', 'This posting is still being sent to Tally; wait for it to finish, then settle the entry.');
  end if;
  return tally_post_release_core(f, auth.uid(), p_job, p_id, left('I checked in Tally: not there (' || why || '). If it is in Tally, it will be posted twice.', 500)) || jsonb_build_object('owner', true);
end $function$;
revoke all on function public.tally_post_owner_release(uuid, text, text) from public, anon;
grant execute on function public.tally_post_owner_release(uuid, text, text) to authenticated;

commit;
