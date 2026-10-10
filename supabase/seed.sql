-- Seed data. Every value marked TODO is a placeholder to be confirmed by Nikhil.

-- Designers. TODO(Nikhil): real names, emails, phones. Placeholder emails use the reserved
-- .invalid TLD so nothing can be sent to a real inbox by accident.
insert into public.designers (name, email, phone, is_principal, is_senior) values
  ('Nikhil Deshpande', 'nikhil@example.invalid', null, true,  true),
  ('Aryan',            'aryan@example.invalid',   null, false, true),
  ('Designer Three',   'designer3@example.invalid', null, false, false)
on conflict do nothing;

-- Business rules that are NOT settled live here, not in code.
insert into public.config (key, value, note) values
  ('min_completion_weeks',    '8',    'TODO(Nikhil): qualified.md says 8-10 weeks, services.md says 6. Unresolved.'),
  ('commercial_min_sqft',     '500',  'TODO(Nikhil): used by the front desk in T18; not written in services.md.'),
  ('commercial_max_sqft',     '3000', 'TODO(Nikhil): services.md says "approximately 3,000".'),
  ('business_hours',          '{"start":"10:00","end":"19:00","tz":"Asia/Kolkata"}', 'TODO(Nikhil): confirm. Which days (Sat/Sun)?'),
  ('answer_mode',             '"all_calls"', 'all_calls | after_hours_and_overflow'),
  ('escalation_ack_minutes',  '5',    'If an escalation is not acknowledged in this time, place a fallback call.'),
  ('handoff_accept_hours',    '2',    'Not accepted in this time (business hours): reminder; at the next threshold reassign to principal.'),
  ('budget_floor_inr',        '300000', 'TODO(Nikhil): internal only. Agent never speaks a number; below this volunteered total budget for a project with execution = budget mismatch.'),
  ('large_residential_sqft',  '3000', 'Residential projects at or above this size are flagged priority.'),
  ('escalation_token_hours',  '2',    'Escalation action-link lifetime.'),
  ('handoff_token_hours',     '72',   'Handoff action-link lifetime.'),
  ('escalation_callback_minutes', '15', 'Promise made to existing clients who complain.')
on conflict (key) do nothing;

-- Cost rates (INR per unit). TODO(Nikhil/Vaani invoice): REAL RATES NEEDED. Zero so the dashboard
-- never shows invented costs; fill these in and the dashboard cost panels become meaningful.
insert into public.cost_rates (component, inr_per_unit) values
  ('telephony_min', 0), ('stt_min', 0), ('tts_min', 0),
  ('llm_call', 0),      ('platform_min', 0), ('email', 0)
on conflict do nothing;

-- Availability: next 21 days, evenings and weekends included (designers' real slots: TODO).
-- Two site slots (10:30, 15:00) and one evening studio slot (18:00) per designer per day,
-- Sundays included. Slots are generated in Asia/Kolkata.
insert into public.availability_slots (designer_id, slot_start, slot_end, visit_type)
select d.id,
       ((day::date + t.start_time) at time zone 'Asia/Kolkata'),
       ((day::date + t.start_time + interval '90 minutes') at time zone 'Asia/Kolkata'),
       t.visit_type
from public.designers d
cross join generate_series(current_date + 1, current_date + 21, interval '1 day') as day
cross join (values (time '10:30', 'site'), (time '15:00', 'site'), (time '18:00', 'studio'))
       as t(start_time, visit_type)
where d.active
on conflict do nothing;

insert into public.config (key, value, note) values
  ('studio_address', '"Aangan Studio, Pune (address to be confirmed)"', 'TODO(Nikhil): studio address shown in caller confirmation emails.')
on conflict (key) do nothing;
