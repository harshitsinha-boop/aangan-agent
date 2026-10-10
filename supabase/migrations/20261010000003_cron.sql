-- Scheduled jobs: Supabase pg_cron + pg_net call our Vercel routes (Vercel Hobby cron is daily only).
-- Secrets are NOT in this file. Set them once per environment (SQL editor):
--   select vault.create_secret('https://<your-app>.vercel.app', 'app_url');
--   select vault.create_secret('<same value as CRON_SECRET env var>', 'cron_secret');
-- Until both exist the jobs are harmless no-ops.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists private;

create or replace function private.invoke_app_cron(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise notice 'invoke_app_cron: app_url / cron_secret not set in vault; skipping %', p_path;
    return;
  end if;
  perform net.http_post(
    url                  := rtrim(v_url, '/') || p_path,
    headers              := jsonb_build_object('Content-Type', 'application/json',
                                                'Authorization', 'Bearer ' || v_secret),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end $$;
revoke all on function private.invoke_app_cron(text) from public;

-- SLA: escalation fallback calls + handoff reminders/reassignment. Every minute.
select cron.schedule('aangan-sla-check', '* * * * *', $$select private.invoke_app_cron('/api/cron/sla-check')$$);
-- Safety net for missed Vaani post-call webhooks: backfill from call history. Every 5 minutes.
select cron.schedule('aangan-sync-calls', '*/5 * * * *', $$select private.invoke_app_cron('/api/cron/sync-calls')$$);
