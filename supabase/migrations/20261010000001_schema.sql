-- Aangan Studio after-hours call agent: core schema.
-- Enum-like columns use text + CHECK (easier to evolve than pg enums).
-- All timestamps are timestamptz (stored UTC; business hours evaluated in Asia/Kolkata).


create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- designers
create table public.designers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null,
  phone        text,
  is_principal boolean not null default false,
  is_senior    boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
-- At most one principal designer: handoff reassignment targets "the" principal.
create unique index designers_one_principal on public.designers (is_principal) where is_principal;

-- ------------------------------------------------------------------ callers
create table public.callers (
  id                 uuid primary key default gen_random_uuid(),
  phone              text not null unique check (phone ~ '^\+[1-9][0-9]{6,14}$'), -- E.164
  name               text,
  email              text,
  is_existing_client boolean not null default false,
  created_at         timestamptz not null default now()
);

-- -------------------------------------------------------------------- calls
create table public.calls (
  id             uuid primary key default gen_random_uuid(),
  vaani_call_id  text not null unique,
  caller_id      uuid references public.callers (id),
  started_at     timestamptz,
  ended_at       timestamptz,
  answered_at    timestamptz,           -- for "median time to answer"
  rang_at        timestamptz,
  duration_s     numeric,
  after_hours    boolean not null default false,
  language       text,
  intent         text check (intent in ('new_lead', 'complaint', 'other')),
  outcome        text check (outcome in ('qualified', 'qualified_with_note', 'declined', 'escalated', 'abandoned')),
  decline_reason text check (decline_reason in
                   ('area', 'advice_only', 'timeline', 'budget', 'too_small', 'too_large', 'out_of_scope', 'other')),
  transcript     text,
  summary        text,
  raw_payload    jsonb,
  created_at     timestamptz not null default now(),
  constraint decline_reason_only_when_declined
    check (decline_reason is null or outcome = 'declined')
);
create index calls_started_at_idx on public.calls (started_at desc);
create index calls_caller_idx on public.calls (caller_id, started_at desc);

-- -------------------------------------------------------------------- leads
-- Fields deliberately mirror the website form so WhatsApp / web-form intake can reuse this table.
create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  call_id           uuid unique references public.calls (id),  -- one lead per call
  caller_id         uuid references public.callers (id),
  project_type      text,
  location          text,
  carpet_area_sqft  integer check (carpet_area_sqft is null or carpet_area_sqft > 0),
  current_state     text,
  timeline          text,
  budget_volunteered text,
  source_or_referrer text,
  rubric_verdict    jsonb not null default '{}'::jsonb,   -- per criterion: {status: pass|unclear|fail, note}
  uncertainty_notes text,
  priority          boolean not null default false,
  status            text not null default 'new'
                    check (status in ('new', 'handed_off', 'accepted', 'consult_booked', 'won', 'lost')),
  project_value_inr numeric check (project_value_inr is null or project_value_inr >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index leads_status_idx on public.leads (status);
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------ availability_slots
create table public.availability_slots (
  id          uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.designers (id) on delete cascade,
  slot_start  timestamptz not null,
  slot_end    timestamptz not null,
  visit_type  text not null check (visit_type in ('site', 'studio')),
  is_booked   boolean not null default false,
  constraint slot_order check (slot_end > slot_start),
  unique (designer_id, slot_start, visit_type)
);
create index slots_open_idx on public.availability_slots (slot_start) where not is_booked;

-- off-hours aware scheduling lives in availability rows; no hours logic in code.

-- ------------------------------------------------------------ consultations
create table public.consultations (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id),
  designer_id uuid not null references public.designers (id),
  slot_id     uuid unique references public.availability_slots (id),  -- a slot can be booked once
  slot_start  timestamptz not null,
  slot_end    timestamptz not null,
  visit_type  text not null check (visit_type in ('site', 'studio')),
  status      text not null default 'booked' check (status in ('booked', 'completed', 'cancelled', 'no_show')),
  created_at  timestamptz not null default now()
);
create index consultations_lead_idx on public.consultations (lead_id);

-- ----------------------------------------------------------------- handoffs
-- One row per assignment. Reassigning closes the old row (reassigned_at) and opens a new one.
create table public.handoffs (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references public.leads (id),
  designer_id        uuid not null references public.designers (id),
  email_message_id   text,
  sent_at            timestamptz,
  delivered_at       timestamptz,
  opened_at          timestamptz,
  accepted_at        timestamptz,
  reassigned_at      timestamptz,
  reminder_sent_at   timestamptz,
  created_at         timestamptz not null default now()
);
create index handoffs_lead_idx on public.handoffs (lead_id);
create index handoffs_message_idx on public.handoffs (email_message_id);
-- Only one live (not reassigned) handoff per lead.
create unique index handoffs_one_live_per_lead on public.handoffs (lead_id) where reassigned_at is null;

-- -------------------------------------------------------------- escalations
-- Spec columns plus the fields the URGENT email needs (client_name, project, designer_name, issue_summary).
create table public.escalations (
  id                     uuid primary key default gen_random_uuid(),
  call_id                uuid not null unique references public.calls (id),
  client_name            text,
  project                text,
  designer_name          text,
  issue_summary          text,
  sent_at                timestamptz,
  acknowledged_at        timestamptz,
  acknowledged_by        text,
  fallback_call_at       timestamptz,
  fallback_vaani_call_id text,
  created_at             timestamptz not null default now()
);
create index escalations_unacked_idx on public.escalations (sent_at) where acknowledged_at is null;

-- ------------------------------------------------------------ action_tokens
-- Only a hash of the token is stored. Single use, expiring (72h handoffs, 2h escalations: set by app).
create table public.action_tokens (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  action       text not null check (action in ('accept', 'reassign', 'acknowledge')),
  target_table text not null check (target_table in ('handoffs', 'escalations')),
  target_id    uuid not null,
  recipient    text,                         -- who the link was sent to (recorded as owner on acknowledge)
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index action_tokens_target_idx on public.action_tokens (target_table, target_id);

-- ------------------------------------------------------------- email_events
create table public.email_events (
  id               uuid primary key default gen_random_uuid(),
  email_message_id text not null,
  type             text not null check (type in ('sent', 'delivered', 'opened', 'bounced', 'complained')),
  occurred_at      timestamptz not null default now(),
  payload          jsonb,
  unique (email_message_id, type, occurred_at)   -- webhook replays are idempotent
);
create index email_events_type_idx on public.email_events (type, occurred_at desc);

-- --------------------------------------------------------------- cost_rates
create table public.cost_rates (
  id             uuid primary key default gen_random_uuid(),
  component      text not null check (component in
                   ('telephony_min', 'stt_min', 'tts_min', 'llm_call', 'platform_min', 'email')),
  inr_per_unit   numeric not null check (inr_per_unit >= 0),
  effective_from date not null default current_date,
  unique (component, effective_from)
);

-- --------------------------------------------------------------- call_costs
create table public.call_costs (
  id        uuid primary key default gen_random_uuid(),
  call_id   uuid not null references public.calls (id) on delete cascade,
  component text not null check (component in
              ('telephony_min', 'stt_min', 'tts_min', 'llm_call', 'platform_min', 'email')),
  units     numeric not null check (units >= 0),
  inr       numeric not null check (inr >= 0),
  unique (call_id, component)                    -- recompute = upsert
);

-- ------------------------------------------------------------------- config
create table public.config (
  key   text primary key,
  value jsonb not null,
  note  text
);

-- -------------------------------------------------------------- admin_users
-- Dashboard allow-list (Nikhil + admins). Referenced by RLS via public.is_admin().
-- user_id matches auth.users.id (no FK here so the schema also loads in non-Supabase test DBs).
create table public.admin_users (
  user_id    uuid primary key,
  email      text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------- atomic slot booking helper
-- Prevents double-booking under concurrent tool calls: the UPDATE is the lock.
-- Idempotent: if this lead already holds a consultation on this slot, returns it.
create or replace function public.book_slot(p_slot_id uuid, p_lead_id uuid)
returns public.consultations
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.availability_slots;
  c public.consultations;
begin
  select * into c from public.consultations where slot_id = p_slot_id and lead_id = p_lead_id;
  if found then return c; end if;

  update public.availability_slots set is_booked = true
   where id = p_slot_id and not is_booked
   returning * into s;
  if not found then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;

  insert into public.consultations (lead_id, designer_id, slot_id, slot_start, slot_end, visit_type)
  values (p_lead_id, s.designer_id, s.id, s.slot_start, s.slot_end, s.visit_type)
  returning * into c;

  update public.leads set status = 'consult_booked'
   where id = p_lead_id and status in ('new', 'handed_off', 'accepted');
  return c;
end $$;
revoke all on function public.book_slot(uuid, uuid) from public;
