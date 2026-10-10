-- Raw record of what Vaani sends our tool and webhook endpoints (no auth headers), so real-call problems are diagnosable
-- from data instead of guesses. Service role only (RLS on, no policies). Pruned after 14 days by the SLA cron.
create table if not exists public.request_log (
  id      uuid primary key default gen_random_uuid(),
  at      timestamptz not null default now(),
  route   text not null,
  status  int,
  body    jsonb,
  headers jsonb,
  note    text
);
create index if not exists request_log_at_idx on public.request_log (at desc);
alter table public.request_log enable row level security;
revoke all on public.request_log from anon, authenticated;
