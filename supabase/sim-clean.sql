-- Removes calls created by scripts/simulate-calls.ts (vaani_call_id like 'sim-%') and everything hanging off them.
delete from public.email_events where email_message_id in (select email_message_id from public.handoffs where lead_id in (select l.id from public.leads l join public.calls c on c.id = l.call_id where c.vaani_call_id like 'sim-%'));
delete from public.action_tokens where target_id in (select id from public.handoffs where lead_id in (select l.id from public.leads l join public.calls c on c.id = l.call_id where c.vaani_call_id like 'sim-%'));
delete from public.consultations where lead_id in (select l.id from public.leads l join public.calls c on c.id = l.call_id where c.vaani_call_id like 'sim-%');
delete from public.handoffs where lead_id in (select l.id from public.leads l join public.calls c on c.id = l.call_id where c.vaani_call_id like 'sim-%');
delete from public.leads where call_id in (select id from public.calls where vaani_call_id like 'sim-%');
delete from public.call_costs where call_id in (select id from public.calls where vaani_call_id like 'sim-%');
delete from public.escalations where call_id in (select id from public.calls where vaani_call_id like 'sim-%');
delete from public.calls where vaani_call_id like 'sim-%';
delete from public.callers where phone like '+9190%' and id not in (select caller_id from public.calls where caller_id is not null);
