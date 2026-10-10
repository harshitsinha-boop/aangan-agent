# Email (Resend): setup notes

## What is sent
| Email | To | Trigger | Action links | Lifetime |
|---|---|---|---|---|
| Handoff | assigned designer | qualified lead after the call (or reassignment) | Accept, Reassign (+ dashboard) | 72 h |
| Reminder | assigned designer | not accepted after `handoff_accept_hours` of business time | Accept, Reassign | 72 h |
| URGENT escalation | principal + every senior designer (one email each, own link) | existing-client complaint | Acknowledge | 2 h |
| Booking confirmation | the caller, only if they gave an email | consultation booked | none | n/a |

Privacy: summary + dashboard link only; phone shown as `••••1234`; the transcript is never loaded by the sender and never rendered
(tests enforce both). Action links open a confirmation page; **a GET never changes data**, so mail scanners are harmless.

## Test phase (now): no domain needed
1. Create a free Resend account → API Keys → create a key with **Sending access** → `RESEND_API_KEY` in `.env.local` and Vercel.
2. Keep `EMAIL_FROM="Aangan Studio <onboarding@resend.dev>"`. Resend's shared test sender only delivers to **your own account email**.
3. Set `EMAIL_TEST_REDIRECT=<your Resend account email>`. Every email is then redirected there, with the intended recipient prefixed
   in the subject (`[to: aryan@…] New lead: …`), so you can see exactly who would have received what.
4. Preview templates offline: `npx tsx scripts/render-emails.ts` → open `emails/preview/*.html`.
5. Send real samples: `npx tsx --env-file=.env.local scripts/send-test-emails.ts`.
6. Delivery events: Resend → Webhooks → add `https://<your-app>.vercel.app/api/email/webhook`, select
   `email.sent`, `email.delivered`, `email.opened`, `email.bounced`, `email.complained`; copy the signing secret (`whsec_…`) to
   `RESEND_WEBHOOK_SECRET`. Open tracking is a per-domain Resend setting and may not be available on the test sender.
   The route verifies the Svix signature, ignores replays, stamps `handoffs.delivered_at` / `opened_at`, and stores bounces
   in `email_events` (the dashboard raises a bounce alert in Phase 5).

## Going live later (needs a domain; not done)
1. Verify a sending domain in Resend, ideally a subdomain such as `mail.<yourdomain>` so it stays isolated from other mail.
2. Add the DNS records Resend shows: **SPF** (TXT, includes Resend), **DKIM** (CNAME/TXT keys), and an **MX** for the return path
   if offered. Do not invent these; copy them from the Resend dashboard.
3. Add **DMARC** at `_dmarc.<domain>` (TXT). Start monitoring-only: `v=DMARC1; p=none; rua=mailto:<an inbox you read>`; move to
   `p=quarantine` after a few clean weeks.
4. Set `EMAIL_FROM="Aangan Studio <leads@<domain>>"`, remove `EMAIL_TEST_REDIRECT`, and replace the `@example.invalid`
   designer emails in the `designers` table with real addresses.
5. Re-run `send-test-emails.ts` and check headers in a real inbox: SPF, DKIM and DMARC should all read `pass`.

## Failure behaviour
- First-send and reminder use a `sent_at` / `reminder_sent_at` **claim**, so webhook + backfill + cron racing can never double-send.
- If sending fails the claim is released; the SLA cron (`runUnsentHandoffs`) retries a handoff with no `sent_at` after 2 minutes.
- If every escalation email fails, the fallback call to the studio head still fires after `escalation_ack_minutes`.
