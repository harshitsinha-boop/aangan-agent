#!/usr/bin/env python3
"""Render and push the Aangan call-agent configuration to Vaani through the vaani-sdk.

  python agent/push_agent.py plan                       # render everything to agent/build/, no network, no secrets needed
  python agent/push_agent.py discover <agent_id>        # print an existing agent's tools (learn Vaani's tool JSON shape)
  python agent/push_agent.py apply --agent-id <id> --yes
  python agent/push_agent.py apply --create "aangan-call-agent" --yes
  python agent/push_agent.py alert --create "aangan-alert-agent" --yes   # outbound escalation-fallback agent (VAANI_ALERT_AGENT_ID)

Secrets are read from the environment / .env.local (VAANI_API_KEY, VAANI_TOOL_SECRET, NEXT_PUBLIC_APP_URL,
optionally SUPABASE service key to read the live `config` table). Nothing secret is written to agent/build/ unless
--with-secrets is passed (the tool config needs the tool secret to be pushed, so `apply` always includes it).

Items marked VERIFY are guesses the Vaani docs do not settle; `plan` lists them and the playground test (Phase 6)
confirms each one.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AGENT = ROOT / "agent"
BUILD = AGENT / "build"
sys.path.insert(0, str(AGENT))
import knowledge_build  # noqa: E402

DEFAULTS = {
    "min_completion_weeks": 8,
    "commercial_min_sqft": 500,
    "commercial_max_sqft": 3000,
    "budget_floor_inr": 300000,
}

GREETING = (
    "Namaste! You've reached Aangan Studio. I'm Aangan's AI assistant, and this call is recorded. "
    "How can I help you today?"
)

AREA_KEYWORDS = [
    "Aangan", "Nikhil", "Kothrud", "Baner", "Aundh", "Wakad", "Koregaon Park", "Kalyani Nagar", "Viman Nagar",
    "Hadapsar", "Magarpatta", "NIBM", "Kondhwa", "Undri", "Shivane", "Warje", "Erandwane", "Deccan", "Pimpri",
    "Chinchwad", "Pimple Saudagar", "Pimple Nilakh", "Ravet", "Hinjewadi", "Kharadi", "Nanded City", "Talegaon",
    "Lonavala", "Nashik", "Vastu", "BHK", "PCMC", "Dahanukar Colony",
]

FAQ = {
    "Are you an AI?": "Yes, I'm Aangan's AI assistant. This call is recorded, and your designer is a real person.",
    "Where do you work?": "We design and build interiors across Pune city and PCMC.",
    "Do you do only advice or decor?": "We are a full-service studio, so our projects are design and execution together. We don't do advice-only visits.",
    "Is the consultation free?": "Your designer will walk you through everything at the consultation, with no obligation. I can book it for you right now if you'd like.",
    "How long does a project take?": "Design takes about three to four weeks from the first consultation, and execution follows, depending on the size of the project and the site.",
    "Do you take commercial projects?": "Yes, offices, clinics and studios of a suitable size. We don't take restaurants, hotels, retail stores or gyms.",
}

PRICING_SCRIPT = (
    "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it "
    "in detail at the consultation. I can book that for you right now if you'd like."
)

VERIFY = [
    "Vaani cURL-tool JSON shape (persona.actions.functions[]); use `discover` on a dashboard-built tool first",
    "How a tool receives this call's id and the caller's number (dynamic variable names)",
    "Marathi STT/TTS quality; voice choice (Voice Lab audition), pronunciation of 'Aangan'",
    "Whether the general webhook is per-agent (agent config has a `webhook` key) or workspace-level (dashboard)",
    "transfer_call tool configuration and the studio-head number for warm transfer",
    "Inbound number assignment (paid; needs approval) via deployment config",
]


def load_env() -> None:
    f = ROOT / ".env.local"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


def fetch_config() -> tuple[dict, str]:
    """Live values from the Supabase `config` table, else defaults."""
    url, key = os.environ.get("NEXT_PUBLIC_SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        try:
            req = urllib.request.Request(f"{url}/rest/v1/config?select=key,value", headers={"apikey": key, "Authorization": f"Bearer {key}"})
            with urllib.request.urlopen(req, timeout=10) as r:
                rows = json.load(r)
            return {**DEFAULTS, **{row["key"]: row["value"] for row in rows}}, "supabase"
        except Exception as e:  # noqa: BLE001
            print(f"warning: could not read Supabase config ({e}); using defaults", file=sys.stderr)
    return dict(DEFAULTS), "defaults"


def render_prompt(cfg: dict) -> str:
    kb = knowledge_build.build()
    knowledge = "\n\n".join(f"## {name}\n{body.strip()}" for name, body in kb.items())
    text = (AGENT / "system-prompt.md").read_text(encoding="utf-8")
    text = text.split("-->", 1)[1].lstrip("\n")  # strip the version/authoring comment
    lakh = cfg["budget_floor_inr"] / 100000
    values = {
        "MIN_COMPLETION_WEEKS": str(cfg["min_completion_weeks"]),
        "COMMERCIAL_MIN_SQFT": f"{int(cfg['commercial_min_sqft']):,}",
        "COMMERCIAL_MAX_SQFT": f"{int(cfg['commercial_max_sqft']):,}",
        "BUDGET_FLOOR_LAKH": f"{lakh:g}",
        "KNOWLEDGE": knowledge,
    }
    # KNOWLEDGE contains placeholders of its own, so fill it first, then the rest.
    text = text.replace("[[KNOWLEDGE]]", values.pop("KNOWLEDGE"))
    for k, v in values.items():
        text = text.replace(f"[[{k}]]", v)
    if "[[" in text:
        raise SystemExit("unfilled placeholder in rendered prompt")
    if PRICING_SCRIPT not in text:
        raise SystemExit("the verbatim pricing script is missing from the prompt")
    return text


def tool_to_vaani(tool: dict, base_url: str, secret: str) -> dict:
    """Vaani's stored custom-tool layout (learned from a tool created in the dashboard): function_name / description /
    function_params (JSON schema, with `required`) / agent_config.params {api_endpoint, method, headers, timeout_ms}.
    The LLM fills function_params; Vaani sends them as the JSON body."""
    import uuid
    fid = str(uuid.uuid5(uuid.NAMESPACE_URL, "aangan:" + tool["name"]))
    return {
        "id": fid, "function_id": fid, "function_name": tool["name"], "description": tool["description"],
        "function_params": tool["parameters"], "is_custom": True,
        "agent_config": {"is_enabled": True, "params": {
            "api_endpoint": base_url.rstrip("/") + tool["path"], "method": "POST", "timeout_ms": 8000,
            "headers": {"Authorization": f"Bearer {secret}"}, "query_params": {}, "store_variables": {},
        }},
    }


def build_payloads(cfg: dict, base_url: str, secret: str) -> dict:
    tools = json.loads((AGENT / "tools.json").read_text())["tools"]
    prompt = render_prompt(cfg)
    persona = {
        "identity": {
            "system_prompt": prompt,
            "greeting_message": {"agent_message": GREETING, "interruptible": False, "let_user_speak_first": False, "agent_speech_delay": 1},
        },
        "senses_capabilities": {
            "language": "en",
            "auto_detect": True,  # VERIFY: English/Hindi/Marathi switching
            "ears": {"stt": {"primary": {"provider": "deepgram", "model": "nova-3", "keywords": AREA_KEYWORDS}}},
            "brain": {"llm": {"primary": {"provider": "google", "model": "gemini-3.5-flash", "parameters": {"temperature": 0.3, "top_p": 1, "max_tokens": 300}}}},
        },
        "actions": {"functions": [tool_to_vaani(t, base_url, secret) for t in tools]},
        "memories": {"use_previous_call_contexts": True, "max_history_calls": 3},
    }
    training = {
        "knowledge": {"use_rag": False},  # knowledge is embedded in the prompt (2 short files; RAG upload is dashboard-only)
        "know_how": {"faq": FAQ, "guardrails": {"level": "medium", "sexual": True, "violence": True, "threatning": True}},
    }
    analysis = {
        "evaluations": {
            "dispositions": {
                "enabled": True,
                "prompt_based": [
                    {"name": "consultation_booked", "type": "bool", "prompt": "Did the agent book a consultation for the caller?"},
                    {"name": "existing_client_complaint", "type": "bool", "prompt": "Was the caller an existing client complaining about an ongoing project?"},
                    {"name": "asked_for_price", "type": "bool", "prompt": "Did the caller ask what the project would cost?"},
                ],
            }
        },
        "extraction": {
            "data_collection": {
                "enabled": True,
                "data_points": [
                    {"name": "caller_name", "prompt": "The caller's name.", "nullable": True},
                    {"name": "caller_email", "prompt": "The caller's email address, if given.", "nullable": True},
                    {"name": "project_location", "prompt": "The area in Pune or PCMC where the project is.", "nullable": True},
                    {"name": "project_type", "prompt": "What the caller wants designed (e.g. 3BHK redesign, office fitout).", "nullable": True},
                ],
            }
        },
    }
    return {"persona": persona, "training": training, "analysis": analysis}


def cmd_plan(args) -> None:
    cfg, src = fetch_config()
    base = os.environ.get("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
    secret = "<VAANI_TOOL_SECRET>"
    p = build_payloads(cfg, base, secret)
    BUILD.mkdir(exist_ok=True)
    (BUILD / "system-prompt.rendered.md").write_text(p["persona"]["identity"]["system_prompt"], encoding="utf-8")
    for k, v in p.items():
        (BUILD / f"{k}.json").write_text(json.dumps(v, indent=2, ensure_ascii=False), encoding="utf-8")
    prompt = p["persona"]["identity"]["system_prompt"]
    print(f"config source: {src}  ->  {cfg}")
    print(f"rendered prompt: {len(prompt)} chars (~{len(prompt)//4} tokens); tools: {[t['function_name'] for t in p['persona']['actions']['functions']]}")
    print(f"wrote {BUILD.relative_to(ROOT)}/ (gitignored)\n\nVERIFY (unconfirmed against Vaani):")
    for v in VERIFY:
        print(f"  - {v}")


def client():
    from vaani_sdk import VaaniClient  # imported lazily so `plan` needs no dependencies

    key = os.environ.get("VAANI_API_KEY")
    if not key:
        raise SystemExit("VAANI_API_KEY is not set (Vaani dashboard > Settings > API Keys)")
    return VaaniClient(api_key=key)


def get_agent_raw(agent_id: str) -> dict:
    """Plain GET: vaani-sdk 0.3.1's agents.get() validates against a model that does not match the API response."""
    key = os.environ.get("VAANI_API_KEY")
    if not key:
        raise SystemExit("VAANI_API_KEY is not set (Vaani dashboard > Settings > API Keys)")
    req = urllib.request.Request(f"https://api.vaanivoice.ai/api/agents/{agent_id}", headers={"X-API-Key": key})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def cmd_discover(args) -> None:
    raw = get_agent_raw(args.agent_id)
    cfg = raw.get("config", raw)
    print(json.dumps({"actions": (cfg.get("persona") or {}).get("actions"), "webhook": cfg.get("webhook")}, indent=2, default=str))


def cmd_apply(args) -> None:
    if not args.yes:
        raise SystemExit("refusing to push without --yes (this changes the live agent)")
    secret = os.environ.get("VAANI_TOOL_SECRET")
    base = os.environ.get("NEXT_PUBLIC_APP_URL")
    if not secret or not base or base.startswith("http://localhost"):
        raise SystemExit("set VAANI_TOOL_SECRET and a PUBLIC NEXT_PUBLIC_APP_URL (the deployed Vercel URL); Vaani must be able to reach the tools")
    cfg, _ = fetch_config()
    p = build_payloads(cfg, base, secret)
    with client() as c:
        agent_id = args.agent_id
        if args.create:
            created = c.create_agent(agent_display_name=args.create, config={"persona": p["persona"]})
            agent_id = created.agent_id
            print(f"created agent {agent_id}")
        elif not agent_id:
            raise SystemExit("pass --agent-id or --create <name>")
        c.update_agent_persona(agent_id, persona=p["persona"])
        c.update_agent_training(agent_id, training=p["training"])
        c.update_agent_analysis(agent_id, analysis=p["analysis"])
        print(f"pushed persona, training and analysis to {agent_id}")
        print("NOT pushed: inbound phone number (paid, dashboard), webhook registration (dashboard), voice choice (Voice Lab).")


def cmd_alert(args) -> None:
    """Create/update the small outbound agent that phones the studio head when an escalation is not acknowledged."""
    if not args.yes:
        raise SystemExit("refusing to push without --yes")
    prompt = (AGENT / "alert-agent-prompt.md").read_text(encoding="utf-8").split("-->", 1)[1].strip()
    greeting = (AGENT / "alert-greeting.txt").read_text(encoding="utf-8").strip()
    persona = {
        "identity": {"system_prompt": prompt, "greeting_message": {"agent_message": greeting, "interruptible": False, "let_user_speak_first": False}},
        "senses_capabilities": {"language": "en", "auto_detect": True},
    }
    with client() as c:
        agent_id = args.agent_id
        if args.create:
            agent_id = c.create_agent(agent_display_name=args.create, config={"persona": persona}).agent_id
            print(f"created alert agent {agent_id}; set VAANI_ALERT_AGENT_ID={agent_id} (Vercel + .env.local)")
        elif not agent_id:
            raise SystemExit("pass --agent-id or --create <name>")
        c.update_agent_persona(agent_id, persona=persona)
        print(f"pushed alert persona to {agent_id}")


def main() -> None:
    load_env()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("plan").set_defaults(fn=cmd_plan)
    d = sub.add_parser("discover"); d.add_argument("agent_id"); d.set_defaults(fn=cmd_discover)
    a = sub.add_parser("apply"); a.add_argument("--agent-id"); a.add_argument("--create"); a.add_argument("--yes", action="store_true"); a.set_defaults(fn=cmd_apply)
    al = sub.add_parser("alert"); al.add_argument("--agent-id"); al.add_argument("--create"); al.add_argument("--yes", action="store_true"); al.set_defaults(fn=cmd_alert)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
