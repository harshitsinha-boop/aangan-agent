# API contract (Phase 2)

All tool and cron routes return JSON, validate input with zod, and are idempotent on `vaani_call_id` where noted.
Auth: tools use `Authorization: Bearer $VAANI_TOOL_SECRET` (or `x-aangan-secret`); cron uses `$CRON_SECRET`.

| Route | Auth | Purpose | Idempotency |
|---|---|---|---|
| `POST /api/tools/lookup-caller` `{phone, vaani_call_id?}` | tool secret | Recent record for repeat callers; links call to phone | upsert |
| `POST /api/tools/availability` `{visit_type?, priority?, prefer?, days_ahead?, limit?}` | tool secret | Open slots (>=12h ahead, max 2/day, priority = principal only) | read-only |
| `POST /api/tools/book` `{vaani_call_id, phone, slot_id, name?, email?, ...lead fields}` | tool secret | Atomic booking + draft lead + caller confirmation email | same call+slot returns the same consultation; 409 + alternatives if taken |
| `POST /api/tools/escalate` `{vaani_call_id, phone, name, project?, designer_name?, issue?}` | tool secret | Escalation + URGENT emails | one per call |
| `POST /api/vaani/webhook` | HMAC signature, or `?token=$VAANI_WEBHOOK_SECRET` | Call events; `call_postprocessing` runs ingestion after responding | ingest is upsert-based |
| `GET /api/actions/[token]` | token | Confirmation page only. **Never changes data.** | n/a |
| `POST /api/actions/[token]` | token | Applies accept / reassign / acknowledge in one DB transaction | single use |
| `POST /api/email/webhook` | Svix signature | Resend delivery events | unique (message, type, time) |
| `POST /api/cron/sla-check` | cron secret | Fallback call, handoff reminder/reassign | claims prevent duplicates |
| `POST /api/cron/sync-calls` | cron secret | Backfill calls whose webhook never arrived | skips ingested calls |

Known gaps (see ARCHITECTURE.md): inbound caller number delivery, tool-call context, webhook signing for general webhooks.
