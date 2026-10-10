import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..')
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((f) => {
    const rel = join(dir, f)
    if (['node_modules', '.next', 'preview', 'build'].includes(f)) return []
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(f) ? [rel] : []
  })
const files = ['app', 'components', 'lib'].flatMap(walk)
const src = (f: string) => readFileSync(join(root, f), 'utf8')

describe('dashboard access model (open dashboard, closed database)', () => {
  it('has no login page, session proxy or auth guard left in the app', () => {
    for (const f of files) {
      expect(f).not.toMatch(/app\/login\//)
      expect(src(f)).not.toMatch(/signInWithPassword|requireAdmin|@supabase\/ssr/)
    }
    expect(() => statSync(join(root, 'proxy.ts'))).toThrow()
  })

  it('the service-role client is only ever imported by server code (never a client component)', () => {
    for (const f of files) {
      const code = src(f)
      if (/^\s*['"]use client['"]/m.test(code.slice(0, 200))) {
        expect(code, f).not.toMatch(/supabase\/admin|dashboard\/db|SUPABASE_SERVICE_ROLE_KEY/)
      }
    }
  })

  it('the service-role key is never exposed through a NEXT_PUBLIC_ variable', () => {
    for (const f of [...files, '.env.example']) expect(src(f)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/)
  })

  it('there are no write actions behind the open dashboard (no server actions under /dashboard)', () => {
    for (const f of files.filter((x) => x.startsWith('app/dashboard') || x.startsWith('components/dashboard'))) {
      expect(src(f), f).not.toMatch(/['"]use server['"]/)
      expect(src(f), f).not.toMatch(/\.(insert|update|delete|upsert)\(/)
    }
  })

  it('search engines are told to stay away', () => expect(src('app/robots.ts')).toMatch(/disallow: '\/'/))
})
