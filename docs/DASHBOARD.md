# Dashboard (Phase 5)

## Access model: OPEN (owner's decision, test phase)
There is **no login**. Anyone with the URL can view `/dashboard`, which shows caller names and phone numbers, call summaries,
transcripts, lead details and pipeline values. This was chosen explicitly for the build/test phase.

What still protects the data layer:
- Every table keeps Row Level Security with **no anonymous policies**, so the database REST API stays closed to the internet.
- The pages read through the **service-role key on the server only**; a test fails if any client component could import it.
- The dashboard is **read-only** (no server actions, no writes); a test enforces that too.
- `robots.txt` disallows crawling and pages are `noindex`. This reduces discovery; it is not access control.

**Before this goes live with real callers, protect it** (DPDP: caller data is personal data). Options, cheapest first: a shared
password, Vercel Deployment Protection, or restore the per-person Supabase-auth version (login page, session proxy, RLS-based
admin check, lead edit form) from git commit `bb3ed2c`.

Not built because of this decision: the ForceField login page, per-user sign-in, and in-dashboard editing of lead status / project
value (set `leads.status` and `leads.project_value_inr` in Supabase for now; they feed conversion and pipeline numbers).

## Pages
- `/dashboard`: hero band (220px, ForceField, "This month: ₹X pipeline from after-hours calls · ₹Y system cost"), date-range
  picker, filters (after-hours only, outcome), KPI tiles, outcome split, decline reasons, cost, recent calls and leads, bounce alert.
- `/dashboard/calls/[id]`: summary, transcript, per-call cost. `/dashboard/leads/[id]`: fields, rubric, handoff timeline.
- `/dashboard/escalations`: who owns each, time to acknowledge, fallback calls. (Emails link to these two lead/escalation pages.)

## Numbers
All aggregates come from one SQL function, `dashboard_metrics` (tested against fixtures in `tests/db/metrics.test.ts`).
Cost: Vaani exposes no per-call cost, so it is computed at ingest from `cost_rates × usage` (all rates are **₹0 until you enter
them**; the dashboard says so). Email cost = distinct emails sent × email rate. "Pipeline from after-hours calls" counts leads from
after-hours calls that ended in a booked consultation, summing `project_value_inr`; leads without a value are listed as "awaiting a value".

## Demo data
`supabase/demo-seed.sql` / `demo-clean.sql` add and remove clearly tagged sample rows (and set sample cost rates). Never on production.

## ForceField
`components/brand/force-field-background.tsx` is a fresh implementation (the original file was not available) with the props from
the brief, and every required fix: client-only via `next/dynamic` (`force-field-lazy.tsx`), pixels read once per (re)build,
no per-point allocation, debounced `ResizeObserver` on the container, <=12,000 points, `IntersectionObserver` +
`visibilitychange` pause, static gradient for reduced-motion and touch-only devices, `aria-hidden`, restyled loading/error states, no
demo controls. Tune it in `lib/brand/particles.ts` (`brandParticles`). `public/brand/hero.jpg` is a generated placeholder: replace it with a real photograph.
