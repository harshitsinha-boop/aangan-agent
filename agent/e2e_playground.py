#!/usr/bin/env python3
"""Open a Vaani WebRTC playground session against the Aangan agent (no phone number needed).

  agent/.venv/bin/python agent/e2e_playground.py <agent_id>          # prints a session URL to open in a browser and talk to the agent
  agent/.venv/bin/python agent/e2e_playground.py <agent_id> --details <call_id>   # fetch transcript/summary/entities afterwards

Needs VAANI_API_KEY (env or .env.local). See docs/E2E.md for the scripted calls and what to check in Supabase."""
import argparse, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
f = ROOT / ".env.local"
if f.exists():
    for line in f.read_text().splitlines():
        if line.strip() and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip().strip('"'))

ap = argparse.ArgumentParser()
ap.add_argument("agent_id"); ap.add_argument("--details")
a = ap.parse_args()
if not os.environ.get("VAANI_API_KEY"):
    sys.exit("VAANI_API_KEY is not set (Vaani dashboard > Settings > API Keys)")
from vaani_sdk import VaaniClient  # noqa: E402

with VaaniClient(api_key=os.environ["VAANI_API_KEY"]) as c:
    if a.details:
        d = c.get_call_details(a.details)
        print(json.dumps({k: d.raw.get(k) for k in ("summary", "entity", "call_eval_tag")}, indent=2, default=str))
        print("\nTRANSCRIPT\n", d.raw.get("transcription") or d.raw.get("transcript"))
    else:
        s = c.sessions.create(agent_id=a.agent_id, ui_type="widget", grace_period=60, session_ttl=1800, metadata={"purpose": "aangan-e2e"})
        print("Open this in a browser and speak to the agent:\n", s.session_url)
