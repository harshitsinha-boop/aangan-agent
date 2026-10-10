-- Removes everything supabase/demo-seed.sql created and resets cost rates to 0.
delete from public.email_events where email_message_id like 'demo-msg-%';
delete from public.consultations where lead_id in (select l.id from public.leads l join public.calls c on c.id = l.call_id where c.vaani_call_id like 'demo-%');
delete from public.handoffs where lead_id in (select l.id from public.leads l join public.calls c on c.id = l.call_id where c.vaani_call_id like 'demo-%');
delete from public.escalations where call_id in (select id from public.calls where vaani_call_id like 'demo-%');
delete from public.leads where call_id in (select id from public.calls where vaani_call_id like 'demo-%');
delete from public.call_costs where call_id in (select id from public.calls where vaani_call_id like 'demo-%');
delete from public.calls where vaani_call_id like 'demo-%';
delete from public.callers where phone like '+91900000000_';
update public.cost_rates set inr_per_unit = 0;
