-- OPTIONAL demo data so the dashboard has something to show. Everything is tagged: vaani_call_id starts with 'demo-',
-- phones are +91900000xxxx. Remove it all with supabase/demo-clean.sql. Never run against a live production database.
-- Also sets non-zero cost rates so the cost panels show something; demo-clean.sql resets them to 0.

update public.cost_rates set inr_per_unit = case component
  when 'telephony_min' then 1.2 when 'stt_min' then 0.4 when 'tts_min' then 0.9 when 'llm_call' then 0.15
  when 'platform_min' then 2.0 when 'email' then 0.05 end where effective_from = current_date or true;

insert into public.callers (phone, name, email, is_existing_client) values
  ('+919000000001', 'Priya Kulkarni', 'priya@example.invalid', false), ('+919000000002', 'Rahul Verma', null, false),
  ('+919000000003', 'Suresh Patil', null, false), ('+919000000004', 'Sheetal Deshpande', null, true),
  ('+919000000005', 'Aarti Mehta', 'aarti@example.invalid', false), ('+919000000006', 'Kiran Joshi', null, false),
  ('+919000000007', 'Meera Rao', null, false), ('+919000000008', null, null, false)
on conflict (phone) do nothing;

with m as (select id, phone from public.callers where phone like '+91900000000_')
insert into public.calls (vaani_call_id, caller_id, started_at, rang_at, answered_at, ended_at, duration_s, after_hours, language, intent, outcome, decline_reason, summary, transcript)
select v.cid, m.id, v.t, v.t, v.t + interval '2 seconds', v.t + (v.dur || ' seconds')::interval, v.dur, v.ah, v.lang, v.intent, v.outcome, v.reason, v.summary, v.transcript
from (values
 ('demo-01','+919000000001', now() - interval '3 days 14 hours', 252, true,  'en','new_lead','qualified',null,'Priya wants her 3BHK in Kothrud fully redesigned with execution by March and booked a site visit.', E'[22:10:01] AGENT: Namaste! You''ve reached Aangan Studio. I''m Aangan''s AI assistant, and this call is recorded. How can I help you today?\n\n[22:10:09] USER: Hi, I got your number from a friend, Shruti Joshi. We have a 3BHK in Kothrud and want to redo the whole thing.\n\n[22:10:20] AGENT: That sounds like a lovely project. Roughly how large is the flat?\n\n[22:10:26] USER: About 1400 square feet carpet.'),
 ('demo-02','+919000000002', now() - interval '2 days 3 hours', 305, false, 'en','new_lead','qualified',null,'Rahul wants a full redesign of a 2BHK in Wakad before moving in; asked about price and accepted the standard answer.', E'[11:02:11] AGENT: Hello, this is Aangan''s AI assistant; this call is recorded.\n\n[11:02:20] USER: Can you tell me roughly how much it would cost?\n\n[11:02:26] AGENT: Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you''d like.'),
 ('demo-03','+919000000003', now() - interval '2 days 5 hours', 160, false, 'en','new_lead','declined','area','Suresh is in Nashik, outside the service area.', null),
 ('demo-04','+919000000006', now() - interval '1 day 4 hours', 200, false, 'hi','new_lead','declined','advice_only','Caller wanted colour advice only, no execution.', null),
 ('demo-05','+919000000007', now() - interval '1 day 20 hours', 220, true,  'en','new_lead','declined','budget','Volunteered a budget well below what the scope needs.', null),
 ('demo-06','+919000000005', now() - interval '20 hours', 400, false, 'en','new_lead','qualified',null,'Aarti, a friend of Nikhil, wants a complete 4BHK redesign in Koregaon Park and booked a site visit.', null),
 ('demo-07','+919000000004', now() - interval '6 hours', 350, false, 'en','complaint','escalated',null,'Existing client says her designer has been silent for five days.', E'[11:32:03] AGENT: Namaste, Aangan Studio''s AI assistant; this call is recorded.\n\n[11:32:10] USER: I need to speak to someone right now. My designer has not replied in five days.'),
 ('demo-08','+919000000008', now() - interval '3 hours', 12, true,  null,'other','abandoned',null,'Caller hung up before saying anything.', null)
) as v(cid, ph, t, dur, ah, lang, intent, outcome, reason, summary, transcript)
join m on m.phone = v.ph
on conflict (vaani_call_id) do nothing;

-- leads for the qualified calls
insert into public.leads (call_id, caller_id, project_type, location, carpet_area_sqft, current_state, timeline, source_or_referrer, priority, status, project_value_inr, rubric_verdict, uncertainty_notes)
select c.id, c.caller_id, v.pt, v.loc, v.area, v.cs, v.tl, v.src, v.pri, v.st, v.val,
  jsonb_build_object('real_project', jsonb_build_object('status','pass'), 'service_area', jsonb_build_object('status','pass'), 'timeline', jsonb_build_object('status','pass'),
                     'budget', jsonb_build_object('status','pass','note','not mentioned'), 'decision_maker', jsonb_build_object('status', v.dm, 'note', v.dmn)), v.unc
from (values
 ('demo-01','3BHK full redesign','Kothrud',1400,'Kitchen, living room, two bedrooms','Done by March','Referral: Shruti Joshi',false,'consult_booked',850000::numeric,'unclear','husband agrees, not on the call','Spouse is co-owner and was not on the call.'),
 ('demo-02','2BHK full redesign','Wakad',950,'Modular kitchen, wardrobes, living, two bedrooms','Move in November','Instagram',false,'accepted',null::numeric,'pass',null,null),
 ('demo-06','4BHK full redesign','Koregaon Park',2400,'Complete redesign, flooring, kitchen, four bedrooms','Back in by February','Referral: close friend of Nikhil',true,'won',2600000::numeric,'pass',null,null)
) as v(cid, pt, loc, area, cs, tl, src, pri, st, val, dm, dmn, unc)
join public.calls c on c.vaani_call_id = v.cid
on conflict (call_id) do nothing;

-- escalation (acknowledged late, with a fallback call)
insert into public.escalations (call_id, client_name, project, designer_name, issue_summary, sent_at, acknowledged_at, acknowledged_by, fallback_call_at)
select id, 'Sheetal Deshpande', '2BHK Viman Nagar', 'Aryan', 'No reply from designer for five days; three messages and two calls unanswered.', started_at, started_at + interval '9 minutes', 'nikhil@example.invalid', started_at + interval '5 minutes'
from public.calls where vaani_call_id = 'demo-07' on conflict (call_id) do nothing;

-- handoffs + consultations
insert into public.handoffs (lead_id, designer_id, email_message_id, sent_at, delivered_at, opened_at, accepted_at)
select l.id, (select id from public.designers where not is_principal order by name limit 1), 'demo-msg-' || c.vaani_call_id, c.ended_at + interval '1 minute', c.ended_at + interval '2 minutes', c.ended_at + interval '25 minutes',
       case c.vaani_call_id when 'demo-01' then c.ended_at + interval '40 minutes' when 'demo-06' then c.ended_at + interval '90 minutes' else null end
from public.leads l join public.calls c on c.id = l.call_id where c.vaani_call_id like 'demo-%' on conflict do nothing;

insert into public.consultations (lead_id, designer_id, slot_start, slot_end, visit_type)
select l.id, (select id from public.designers where not is_principal order by name limit 1), now() + interval '3 days', now() + interval '3 days 90 minutes', 'site'
from public.leads l join public.calls c on c.id = l.call_id where c.vaani_call_id in ('demo-01', 'demo-02', 'demo-06')
  and not exists (select 1 from public.consultations k where k.lead_id = l.id);

insert into public.call_costs (call_id, component, units, inr)
select c.id, x.component, round((c.duration_s / 60.0)::numeric, 2), round((c.duration_s / 60.0 * x.rate)::numeric, 2)
from public.calls c cross join (values ('telephony_min', 1.2), ('stt_min', 0.4), ('tts_min', 0.9), ('platform_min', 2.0)) as x(component, rate)
where c.vaani_call_id like 'demo-%' on conflict do nothing;

insert into public.email_events (email_message_id, type, occurred_at, payload) values
  ('demo-msg-demo-01', 'sent', now() - interval '3 days', null), ('demo-msg-demo-02', 'sent', now() - interval '2 days', null), ('demo-msg-demo-06', 'sent', now() - interval '19 hours', null),
  ('demo-msg-demo-02', 'bounced', now() - interval '2 days', '{"data": {"to": ["aryan@example.invalid"]}}'::jsonb)
on conflict do nothing;
