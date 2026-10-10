-- Advisor: pg_net must not live in `public`. Supabase's pg_net is not relocatable, so recreate it.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
