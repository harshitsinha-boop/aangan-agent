-- Dashboard aggregates. SECURITY INVOKER: runs as the signed-in user, so RLS applies and a non-admin gets zeros.
-- Filter semantics: a call is "in scope" when its start time (else creation time) is in [p_from, p_to) and it matches the
-- after-hours / outcome filters. Everything call-derived (leads, handoffs, consultations, costs, escalations) follows the calls.
-- Cost: Vaani exposes no per-call cost, so call_costs are computed at ingest from cost_rates x usage; email cost is
-- (distinct emails sent in range) x current email rate.

create or replace function public.dashboard_metrics(
  p_from timestamptz,
  p_to timestamptz,
  p_after_hours_only boolean default false,
  p_outcome text default null
) returns jsonb
language sql stable security invoker set search_path = public as $$
with c as (
  select * from calls
   where coalesce(started_at, created_at) >= p_from and coalesce(started_at, created_at) < p_to
     and (not p_after_hours_only or after_hours)
     and (p_outcome is null or outcome = p_outcome)
),
l as (select ld.*, c.after_hours from leads ld join c on c.id = ld.call_id),
cons as (select k.*, l.after_hours from consultations k join l on l.id = k.lead_id where k.status <> 'cancelled'),
h as (select hf.* from handoffs hf join l on l.id = hf.lead_id),
e as (select es.* from escalations es join c on c.id = es.call_id),
email_rate as (
  select coalesce((select inr_per_unit from cost_rates where component = 'email' and effective_from <= current_date
                    order by effective_from desc limit 1), 0) as r
),
emails_sent as (
  select count(distinct email_message_id) as n from email_events
   where type = 'sent' and occurred_at >= p_from and occurred_at < p_to
),
cost_rows as (
  select cc.component, sum(cc.inr) as inr from call_costs cc join c on c.id = cc.call_id group by cc.component
),
cost_json as (
  select coalesce(jsonb_object_agg(component, round(inr::numeric, 2)), '{}'::jsonb) as by_component, coalesce(sum(inr), 0) as calls_total from cost_rows
),
totals as (
  select
    (select count(*) from c) as calls,
    (select count(*) from c where after_hours) as after_hours_calls,
    (select count(*) from l where status <> 'lost' or true) as leads,
    (select count(*) from cons) as consultations,
    (select calls_total from cost_json) + (select n from emails_sent) * (select r from email_rate) as cost_total
)
select jsonb_build_object(
  'calls_answered',       (select calls from totals),
  'after_hours_calls',    (select after_hours_calls from totals),
  'after_hours_pct',      case when (select calls from totals) = 0 then null
                               else round(100.0 * (select after_hours_calls from totals) / (select calls from totals), 1) end,
  'median_time_to_answer_s',
      (select round((percentile_cont(0.5) within group (order by extract(epoch from (answered_at - rang_at))))::numeric, 1)
         from c where answered_at is not null and rang_at is not null and answered_at >= rang_at),
  'outcomes',             coalesce((select jsonb_object_agg(coalesce(outcome, 'unknown'), n) from (select outcome, count(*) n from c group by 1) x), '{}'::jsonb),
  'decline_reasons',      coalesce((select jsonb_object_agg(decline_reason, n) from (select decline_reason, count(*) n from c where outcome = 'declined' and decline_reason is not null group by 1) x), '{}'::jsonb),
  'consultations_booked', (select consultations from totals),
  'designer_pickup', jsonb_build_object(
      'median_minutes', (select round((percentile_cont(0.5) within group (order by extract(epoch from (accepted_at - sent_at)) / 60.0))::numeric, 1)
                           from h where accepted_at is not null and sent_at is not null),
      'accepted',       (select count(*) from h where accepted_at is not null),
      'waiting',        (select count(*) from h where accepted_at is null and reassigned_at is null and sent_at is not null),
      'reassigned',     (select count(*) from h where reassigned_at is not null)),
  'escalations', jsonb_build_object(
      'total',          (select count(*) from e),
      'acknowledged',   (select count(*) from e where acknowledged_at is not null),
      'unacknowledged', (select count(*) from e where acknowledged_at is null),
      'median_minutes_to_ack', (select round((percentile_cont(0.5) within group (order by extract(epoch from (acknowledged_at - sent_at)) / 60.0))::numeric, 1)
                                  from e where acknowledged_at is not null and sent_at is not null),
      'fallback_calls', (select count(*) from e where fallback_call_at is not null)),
  'email_bounces', jsonb_build_object(
      'count', (select count(distinct email_message_id) from email_events where type = 'bounced' and occurred_at >= p_from and occurred_at < p_to),
      'complaints', (select count(distinct email_message_id) from email_events where type = 'complained' and occurred_at >= p_from and occurred_at < p_to)),
  'conversion', jsonb_build_object(
      'leads', (select count(*) from l), 'won', (select count(*) from l where status = 'won'), 'lost', (select count(*) from l where status = 'lost'),
      'pct', case when (select count(*) from l) = 0 then null else round(100.0 * (select count(*) from l where status = 'won') / (select count(*) from l), 1) end),
  'pipeline', jsonb_build_object(
      'value_inr',     (select coalesce(sum(project_value_inr), 0) from l where status <> 'lost'),
      'won_value_inr', (select coalesce(sum(project_value_inr), 0) from l where status = 'won'),
      'missing_value', (select count(*) from l where status <> 'lost' and project_value_inr is null)),
  -- Leads that a human-staffed phone would likely have missed: after-hours calls that ended in a booked consultation.
  'after_hours_booked', jsonb_build_object(
      'leads',         (select count(distinct lead_id) from cons where after_hours),
      'value_inr',     (select coalesce(sum(project_value_inr), 0) from l where after_hours and status <> 'lost' and id in (select lead_id from cons)),
      'missing_value', (select count(*) from l where after_hours and status <> 'lost' and project_value_inr is null and id in (select lead_id from cons))),
  'cost', jsonb_build_object(
      'total_inr',                 round((select cost_total from totals)::numeric, 2),
      'by_component',              (select by_component from cost_json) || jsonb_build_object('email', round(((select n from emails_sent) * (select r from email_rate))::numeric, 2)),
      'per_call',                  case when (select calls from totals) = 0 then null else round(((select cost_total from totals) / (select calls from totals))::numeric, 2) end,
      'per_qualified_lead',        (select case when count(*) = 0 then null else round(((select cost_total from totals) / count(*))::numeric, 2) end from c where outcome in ('qualified', 'qualified_with_note')),
      'per_booked_consultation',   case when (select consultations from totals) = 0 then null else round(((select cost_total from totals) / (select consultations from totals))::numeric, 2) end,
      'rates_configured',          (select count(*) from cost_rates where inr_per_unit > 0) > 0)
);
$$;

revoke execute on function public.dashboard_metrics(timestamptz, timestamptz, boolean, text) from public, anon;
grant  execute on function public.dashboard_metrics(timestamptz, timestamptz, boolean, text) to authenticated;
