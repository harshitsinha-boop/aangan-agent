-- Atomic business operations used by the API routes (service role only).
-- Keeping these in SQL gives us real transactions: an action link is consumed and applied together or not at all.

-- Which designer gets a lead? Booked consultation's designer > principal (priority) > least-loaded designer.
create or replace function public.pick_designer(p_lead_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare d uuid; pri boolean;
begin
  select c.designer_id into d from consultations c
   where c.lead_id = p_lead_id and c.status = 'booked' order by c.created_at desc limit 1;
  if d is not null then return d; end if;

  select priority into pri from leads where id = p_lead_id;
  if coalesce(pri, false) then
    select id into d from designers where is_principal and active;
    if d is not null then return d; end if;
  end if;

  select dz.id into d from designers dz
   where dz.active and not dz.is_principal
   order by (select count(*) from handoffs h where h.designer_id = dz.id and h.reassigned_at is null and h.accepted_at is null), dz.name
   limit 1;
  if d is not null then return d; end if;

  select id into d from designers where is_principal and active;
  return d;
end $$;

-- Idempotent: returns the existing live handoff for a lead, or creates one.
create or replace function public.create_handoff(p_lead_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid; d uuid;
begin
  select id into hid from handoffs where lead_id = p_lead_id and reassigned_at is null;
  if hid is not null then return hid; end if;
  d := public.pick_designer(p_lead_id);
  if d is null then raise exception 'no_active_designer'; end if;
  insert into handoffs (lead_id, designer_id) values (p_lead_id, d) returning id into hid;
  update leads set status = 'handed_off' where id = p_lead_id and status = 'new';
  return hid;
end $$;

-- Close a handoff and open a new one. Default target: the principal (or, if the current owner already is
-- the principal, the least-loaded other active designer).
create or replace function public.reassign_handoff(p_handoff_id uuid, p_to uuid default null, p_now timestamptz default now())
returns uuid
language plpgsql security definer set search_path = public as $$
declare h handoffs; target uuid; newid uuid;
begin
  select * into h from handoffs where id = p_handoff_id and reassigned_at is null for update;
  if not found then raise exception 'handoff_not_live'; end if;

  target := p_to;
  if target is null then
    select id into target from designers where is_principal and active and id <> h.designer_id;
  end if;
  if target is null then
    select dz.id into target from designers dz
     where dz.active and dz.id <> h.designer_id
     order by (select count(*) from handoffs x where x.designer_id = dz.id and x.reassigned_at is null and x.accepted_at is null), dz.name
     limit 1;
  end if;
  if target is null then raise exception 'no_reassign_target'; end if;

  update handoffs set reassigned_at = p_now where id = h.id;
  insert into handoffs (lead_id, designer_id) values (h.lead_id, target) returning id into newid;
  update consultations set designer_id = target where lead_id = h.lead_id and status = 'booked';
  update leads set status = 'handed_off' where id = h.lead_id and status in ('new', 'handed_off', 'accepted');
  return newid;
end $$;

-- Apply an emailed action link. The token row is locked, validated, applied and burned in ONE transaction.
-- Only ever changes the single record the token was minted for.
create or replace function public.apply_action_token(p_hash text, p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare t action_tokens; h handoffs; e escalations; newid uuid;
begin
  select * into t from action_tokens where token_hash = p_hash for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  if t.used_at is not null then return jsonb_build_object('ok', false, 'code', 'used'); end if;
  if t.expires_at <= p_now then return jsonb_build_object('ok', false, 'code', 'expired'); end if;

  if t.target_table = 'handoffs' then
    select * into h from handoffs where id = t.target_id for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
    if h.reassigned_at is not null then return jsonb_build_object('ok', false, 'code', 'superseded'); end if;

    if t.action = 'accept' then
      if h.accepted_at is null then
        update handoffs set accepted_at = p_now where id = h.id;
        update leads set status = 'accepted' where id = h.lead_id and status in ('new', 'handed_off');
      end if;
      update action_tokens set used_at = p_now where id = t.id;
      return jsonb_build_object('ok', true, 'code', 'accepted', 'handoff_id', h.id, 'lead_id', h.lead_id);

    elsif t.action = 'reassign' then
      if h.accepted_at is not null then return jsonb_build_object('ok', false, 'code', 'already_accepted'); end if;
      newid := public.reassign_handoff(h.id, null, p_now);
      update action_tokens set used_at = p_now where id = t.id;
      return jsonb_build_object('ok', true, 'code', 'reassigned', 'handoff_id', h.id,
                                'new_handoff_id', newid, 'lead_id', h.lead_id);
    end if;

  elsif t.target_table = 'escalations' and t.action = 'acknowledge' then
    select * into e from escalations where id = t.target_id for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
    update action_tokens set used_at = p_now where id = t.id;
    if e.acknowledged_at is not null then
      return jsonb_build_object('ok', false, 'code', 'already_acknowledged', 'by', e.acknowledged_by);
    end if;
    update escalations set acknowledged_at = p_now, acknowledged_by = coalesce(t.recipient, 'unknown') where id = e.id;
    return jsonb_build_object('ok', true, 'code', 'acknowledged', 'escalation_id', e.id, 'by', coalesce(t.recipient, 'unknown'));
  end if;

  return jsonb_build_object('ok', false, 'code', 'invalid');
end $$;

-- Service role only: these must never be callable from a browser.
revoke execute on function public.pick_designer(uuid) from public, anon, authenticated;
revoke execute on function public.create_handoff(uuid) from public, anon, authenticated;
revoke execute on function public.reassign_handoff(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.apply_action_token(text, timestamptz) from public, anon, authenticated;
grant  execute on function public.pick_designer(uuid) to service_role;
grant  execute on function public.create_handoff(uuid) to service_role;
grant  execute on function public.reassign_handoff(uuid, uuid, timestamptz) to service_role;
grant  execute on function public.apply_action_token(text, timestamptz) to service_role;
