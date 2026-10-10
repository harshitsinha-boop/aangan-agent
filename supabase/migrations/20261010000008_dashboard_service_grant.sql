-- The dashboard now reads through the service role on the server (no login). dashboard_metrics runs SECURITY INVOKER,
-- so with the service role (which bypasses RLS) it sees all rows. Grant explicitly rather than rely on default privileges.
grant execute on function public.dashboard_metrics(timestamptz, timestamptz, boolean, text) to service_role;
