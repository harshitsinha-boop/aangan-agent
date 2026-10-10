-- Advisor fixes.
-- 1. is_admin() becomes SECURITY INVOKER (no RPC-exposed privilege escalation surface). It stays
--    non-recursive because admin_users is readable only for your own row.
-- 2. EXECUTE on functions is revoked from PUBLIC (the default grant), not just anon.
-- 3. set_updated_at gets a fixed search_path.
-- 4. action_tokens gets an explicit deny-all policy (service role only).

alter function public.set_updated_at() set search_path = '';

drop policy admin_read on public.admin_users;
create policy self_read on public.admin_users for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.book_slot(uuid, uuid) from public, anon, authenticated;

create policy deny_all on public.action_tokens for all to authenticated, anon using (false) with check (false);
