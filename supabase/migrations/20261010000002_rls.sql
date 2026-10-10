-- Row Level Security on EVERY table. Default posture: deny.
-- Server routes use the service-role key (bypasses RLS) and never ship to the browser.
-- The dashboard (Supabase Auth session) is allowed read access only if the user is in admin_users.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- Lock down grants first: browsers (anon) get nothing; signed-in users only what policies allow.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke execute on function public.book_slot(uuid, uuid) from anon, authenticated;
grant execute on function public.is_admin() to authenticated;
alter default privileges in schema public revoke all on tables from anon;

alter table public.designers          enable row level security;
alter table public.callers            enable row level security;
alter table public.calls              enable row level security;
alter table public.leads              enable row level security;
alter table public.consultations      enable row level security;
alter table public.availability_slots enable row level security;
alter table public.handoffs           enable row level security;
alter table public.escalations        enable row level security;
alter table public.action_tokens      enable row level security;
alter table public.email_events       enable row level security;
alter table public.cost_rates         enable row level security;
alter table public.call_costs         enable row level security;
alter table public.config             enable row level security;
alter table public.admin_users        enable row level security;

-- Read-only for admins (dashboard).
create policy admin_read on public.callers       for select to authenticated using (public.is_admin());
create policy admin_read on public.calls         for select to authenticated using (public.is_admin());
create policy admin_read on public.consultations for select to authenticated using (public.is_admin());
create policy admin_read on public.handoffs      for select to authenticated using (public.is_admin());
create policy admin_read on public.escalations   for select to authenticated using (public.is_admin());
create policy admin_read on public.email_events  for select to authenticated using (public.is_admin());
create policy admin_read on public.call_costs    for select to authenticated using (public.is_admin());
create policy admin_read on public.admin_users   for select to authenticated using (public.is_admin());

-- Leads: admins read, and may update (mark won/lost, enter project value).
create policy admin_read   on public.leads for select to authenticated using (public.is_admin());
create policy admin_update on public.leads for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Admin-managed reference data.
create policy admin_all on public.designers          for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.availability_slots for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.cost_rates         for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.config             for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- action_tokens: deliberately NO policies and no grants. Only the service role can touch it.
revoke all on public.action_tokens from authenticated;
-- Browser-side admins must not write call data directly.
revoke insert, delete on public.leads from authenticated;
