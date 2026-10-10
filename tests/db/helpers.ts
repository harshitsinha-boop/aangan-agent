import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..', 'supabase')
export const sql = (p: string) => readFileSync(join(root, p), 'utf8')

/** Fresh in-process Postgres with the real migrations applied and Supabase's roles/auth stubbed. */
export async function makeDb(opts: { seed?: boolean } = {}) {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `)
  for (const m of ['01_schema', '02_rls', '04_rls_hardening', '06_handoff_functions', '07_dashboard_metrics']) {
    const n = m.slice(0, 2)
    await db.exec(sql(`migrations/202610100000${n}_${m.slice(3)}.sql`))
  }
  if (opts.seed) await db.exec(sql('seed.sql'))
  return db
}
