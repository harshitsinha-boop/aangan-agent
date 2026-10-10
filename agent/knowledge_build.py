"""Builds the agent's knowledge text from the studio's own services.md and qualified.md ONLY (never pricing.md).

Two deliberate edits, each asserted so a silent source change fails loudly:
  1. qualified.md's budget criterion quotes an example rupee figure. The agent must never hold or speak a figure
     except the single internal budget rule in the system prompt, so the example is removed.
  2. The two source files disagree on the minimum timeline (qualified.md: 8-10 weeks; services.md: 6 weeks).
     Both are replaced with the [[MIN_COMPLETION_WEEKS]] placeholder, filled from the Supabase `config` table.
     TODO(Nikhil): confirm the real number.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "context-source"
OUT = ROOT / "agent" / "knowledge"

FORBIDDEN = re.compile(r"₹|\blakh\b|\bcrore\b|per\s+sq\.?\s*ft|\brs\.?\s*\d", re.I)


def _replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"knowledge build: expected text for '{label}' not found; source changed, review it")
    return text.replace(old, new, 1)


def sanitize_qualified(text: str) -> str:
    text = _replace_once(
        text,
        "address the misalignment on the call. It's kinder than discovering it at consultation.",
        "address the misalignment on the call, honestly and without stating any figure. It's kinder than discovering it at consultation.",
        "budget wording",
    )
    text = _replace_once(
        text,
        "would cost — for example, ₹1–1.5 lakh for a full flat redesign — address",
        "would cost, address",
        "budget example figure",
    )
    text = _replace_once(
        text,
        "within 8–10 weeks of the consultation",
        "no sooner than about [[MIN_COMPLETION_WEEKS]] weeks after the consultation",
        "timeline",
    )
    return text


def sanitize_services(text: str) -> str:
    return _replace_once(
        text,
        "we cannot begin execution on a project that needs to be ready in under 6 weeks from today.",
        "a project that must be ready in less than about [[MIN_COMPLETION_WEEKS]] weeks cannot be taken on.",
        "minimum lead time",
    )


def build() -> dict[str, str]:
    services = sanitize_services((SRC / "services.md").read_text(encoding="utf-8"))
    qualified = sanitize_qualified((SRC / "qualified.md").read_text(encoding="utf-8"))
    for name, body in (("services.md", services), ("qualified.md", qualified)):
        if FORBIDDEN.search(body):
            raise SystemExit(f"knowledge build: {name} still contains a currency or rate reference after sanitising")
    return {"services.md": services, "qualified.md": qualified}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, body in build().items():
        (OUT / name).write_text(body, encoding="utf-8")
        print(f"wrote agent/knowledge/{name} ({len(body)} chars)")


if __name__ == "__main__":
    main()
