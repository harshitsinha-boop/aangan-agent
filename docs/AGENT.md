# Vaani agent (Phase 3)

| File | What |
|---|---|
| `agent/system-prompt.md` | The prompt (version-controlled, v0.1.0). `[[PLACEHOLDERS]]` are filled from the Supabase `config` table at push time. |
| `agent/knowledge/*.md` | Sanitised copies of `services.md` + `qualified.md` (never `pricing.md`). Regenerate with `npm run agent:knowledge`; CI fails if stale. |
| `agent/tools.json` | The 4 tools. Tests fail if they drift from `lib/tools/schemas.ts`. |
| `agent/push_agent.py` | `plan` (offline render to `agent/build/`), `discover <agent_id>`, `apply --agent-id <id> --yes`. Uses `vaani-sdk`. |

## Why the knowledge lives in the prompt
Vaani's API can set FAQs and guardrails, but uploading documents for RAG is dashboard-only. The two files total about 6 KB,
so embedding them is more reliable than retrieval (no missed lookups) and keeps the whole agent reproducible from the repo.
FAQ pairs and guardrails are also pushed through the API.

## Price safety (layers)
1. The agent never receives `pricing.md` or any rate; the knowledge build strips the one rupee example in `qualified.md`.
2. The only number in the prompt is the internal budget floor, used in a single "never say this" rule (you required this).
3. The pricing script is verbatim in the prompt and in the FAQ; the push script aborts if it is missing.
4. `tests/agent` fails CI if a pricing-guide figure or phrase appears anywhere the agent can see. Phase 6 adds reply-level tests.

## Running it
```bash
python3 -m venv agent/.venv && agent/.venv/bin/pip install -r agent/vaani-requirements.txt
npm run agent:plan                                   # inspect agent/build/*
agent/.venv/bin/python agent/push_agent.py discover <agent_id>   # after building ONE dummy tool in the Vaani dashboard
agent/.venv/bin/python agent/push_agent.py apply --create aangan-call-agent --yes   # needs VAANI_API_KEY + deployed app URL
```

## Unverified against Vaani (see `plan` output)
Tool JSON shape; how tools receive the call id and caller number; Marathi quality; webhook scope (per-agent vs workspace);
warm-transfer setup; inbound number (paid). `tool_to_vaani()` is the single function to adjust once `discover` shows the real shape.
