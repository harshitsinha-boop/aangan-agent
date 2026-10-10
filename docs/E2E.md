# End-to-end test through Vaani's playground

**Status: NOT YET RUN.** It needs three things that do not exist yet: a Vaani API key, a deployed app URL Vaani can reach, and the
Supabase service-role key in the app's environment. Everything below is the runbook, so it is a short job once they do.

## 0. Prerequisites (free tier is enough)
1. **Vercel**: import the GitHub repo, add every variable from `.env.example` (`SUPABASE_SERVICE_ROLE_KEY`, `VAANI_*`, `RESEND_*`,
   `EMAIL_TEST_REDIRECT`, `GEMINI_*`, `ACTION_TOKEN_SECRET`, `CRON_SECRET`), deploy, note the `*.vercel.app` URL → `NEXT_PUBLIC_APP_URL`.
2. **Supabase cron**: in the SQL editor run `select vault.create_secret('<app url>', 'app_url'); select vault.create_secret('<CRON_SECRET>', 'cron_secret');`.
3. **Vaani agent** (`docs/AGENT.md`): build ONE dummy cURL tool in the dashboard, run `push_agent.py discover <agent_id>`, adjust
   `tool_to_vaani()` if the shape differs, then `apply --create aangan-call-agent --yes` and `alert --create aangan-alert-agent --yes`
   (put the new id in `VAANI_ALERT_AGENT_ID`). Give the alert agent a phone number for the fallback test only if you accept the cost.
4. **Vaani webhook**: Settings → Webhooks → `https://<app>/api/vaani/webhook?token=<VAANI_WEBHOOK_SECRET>`.

## 1. Dry run without Vaani (works today once the service key is set)
`npm run dev`, then `npx tsx --env-file=.env.local scripts/simulate-calls.ts T01 T05 T10 T14 T09`. This drives the real
webhook → classify (Gemini) → Supabase → handoff email (Resend, to `EMAIL_TEST_REDIRECT`). Check the dashboard, then run `supabase/sim-clean.sql`.

## 2. Playground calls (`python agent/e2e_playground.py <agent_id>` prints a URL; speak to the agent)
| # | Say | Expect |
|---|---|---|
| 1 | T01-style: 3BHK Kothrud, 1,400 sq ft, done by March, owner | Qualified; asks site or studio; offers 2-3 real slots; books; asks email; handoff email arrives with Accept / Reassign |
| 2 | Ask "how much per sq ft?" twice, then book | Verbatim pricing script both times; still books; **no figure anywhere in the transcript** |
| 3 | Nashik project | Polite area decline; no tools called; `calls.outcome = declined`, reason `area` |
| 4 | "My budget is a lakh and a half for a kitchen and a bedroom" | Honest "likely below what such a project would cost with us", no figure; declined / budget |
| 5 | Existing client complaint (designer silent) | Apologises, takes name/project/designer, `escalate`, promises callback in 15 min; URGENT email; do NOT click Acknowledge, and after 5 min a fallback call is placed |
| 6 | Hang up after one sentence, call back | First: abandoned (no lead, no email). Second: agent acknowledges the earlier call (`lookup_caller`) |
| 7 | Hindi, then Marathi | Agent switches language; quality notes for Nikhil (STT/TTS voice choice) |
| 8 | Click Accept in the email, then click it again | First: confirmation page then "accepted"; second: "already used" |

## 3. What to verify and record (the open questions)
- Does the tool receive this call's id and the caller's number? (If not, `lookup_caller`/`book` need a fallback key: see `docs/AGENT.md`.)
- Does the inbound webhook carry the caller number? (`calls.caller_id` populated?)
- Does the webhook arrive signed, or only via `?token=`?
- Median time to answer and per-call duration look sane on the dashboard; cost stays ₹0 until rates are set.
- Tool latency: each tool must answer in < 3 s (check Vercel logs).
