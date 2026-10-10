-- If Vaani does not give tools the call's id, the tool routes key the call as 'tool-<phone digits>-<epoch>'. When the post-call
-- webhook later arrives with the REAL id, adopt_tool_call() folds that tool-created call (and its lead / escalation / caller) into
-- the real call row, so a booking made mid-call is not orphaned from its transcript.
create or replace function public.adopt_tool_call(p_real text, p_phone text default null, p_window_minutes int default 120)
returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.calls; r public.calls; n int;
begin
  select * into r from calls where vaani_call_id = p_real;
  if p_phone is not null then
    select * into s from calls
     where vaani_call_id like 'tool-' || regexp_replace(p_phone, '\D', '', 'g') || '-%'
       and created_at >= now() - make_interval(mins => p_window_minutes) and transcript is null
     order by created_at desc limit 1;
  else
    -- No phone on the webhook: only adopt when there is exactly ONE recent candidate (never guess between callers).
    select count(*) into n from calls where vaani_call_id like 'tool-%' and created_at >= now() - interval '20 minutes' and transcript is null;
    if n = 1 then select * into s from calls where vaani_call_id like 'tool-%' and created_at >= now() - interval '20 minutes' and transcript is null; end if;
  end if;
  if s.id is null then return r.id; end if;
  if r.id is null then
    update calls set vaani_call_id = p_real where id = s.id;
    return s.id;
  end if;
  if s.id = r.id then return r.id; end if;
  update leads set call_id = r.id where call_id = s.id and not exists (select 1 from leads x where x.call_id = r.id);
  update escalations set call_id = r.id where call_id = s.id and not exists (select 1 from escalations x where x.call_id = r.id);
  update calls set caller_id = coalesce(r.caller_id, s.caller_id),
                   intent = coalesce(r.intent, s.intent), outcome = coalesce(r.outcome, s.outcome) where id = r.id;
  begin delete from calls where id = s.id; exception when foreign_key_violation then null; end; -- keep it if something still points at it
  return r.id;
end $$;
revoke execute on function public.adopt_tool_call(text, text, int) from public, anon, authenticated;
grant  execute on function public.adopt_tool_call(text, text, int) to service_role;
