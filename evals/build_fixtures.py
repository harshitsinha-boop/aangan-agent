#!/usr/bin/env python3
"""One-off: turns the phone-call section (T01-T20) of context-source/Aangan_Sep 2026_Enquiries.pdf into
evals/fixtures/phone.json. Re-run only if the PDF changes. Needs `pip install pypdf`.

Front desk -> AGENT, Caller -> USER (Vaani's transcript format). Staff 'Note:' lines are NOT part of the call (they state the
answer), so they are kept as metadata only and never fed to the classifier."""
import json, re, sys
from pathlib import Path
import pypdf

ROOT = Path(__file__).resolve().parent.parent
pdf = pypdf.PdfReader(str(ROOT / "context-source" / "Aangan_Sep 2026_Enquiries.pdf"))
text = "\n".join(p.extract_text() for p in pdf.pages)
text = re.sub(r"[ \t ]+", " ", text)
text = re.sub(r"\n\s*\n+", "\n", text)
text = re.sub(r"\n(?! ?(Front Desk|Caller|Note|T\d\d|SECTION|Missed))", " ", text)  # re-join wrapped lines
phone = text[text.index("T01 ·"): text.index("SECTION 2")]

MONTHS = {m: i for i, m in enumerate(["January","February","March","April","May","June","July","August","September","October","November","December"], 1)}
blocks = re.split(r"\n(?=T\d\d ·)", phone.strip())
out = []
for b in blocks:
    lines = [l.strip() for l in b.split("\n") if l.strip()]
    head = lines[0]
    m = re.match(r"(T\d\d) · Phone · (\d+) (\w+) · (\d+:\d+)(am|pm)", head)
    if not m:
        print("skip header:", head, file=sys.stderr); continue
    tid, day, month, hhmm, ampm = m.groups()
    h, mi = map(int, hhmm.split(":"))
    h = h % 12 + (12 if ampm == "pm" else 0)
    date = f"2026-{MONTHS[month]:02d}-{int(day):02d}"
    turns, note = [], None
    for l in lines[1:]:
        if l.startswith("Note:"): note = l[5:].strip(); continue
        if l.startswith("Missed call"): continue
        if l.startswith("Front Desk:"): turns.append("AGENT: " + l[len("Front Desk:"):].strip())
        elif l.startswith("Caller:"): turns.append("USER: " + l[len("Caller:"):].strip())
        elif turns: turns[-1] += " " + l
    out.append({"id": tid, "header": head, "date": date, "time": f"{h:02d}:{mi:02d}", "tz": "Asia/Kolkata",
                "transcript": "\n\n".join(turns) if turns else None, "staffNote": note, "headerRaw": head})
# T17 contains two separate calls (a dropped one, then the real one)
for f in out:
    if f["id"] == "T17":
        t = f["transcript"]
        # first call is the dropped one: everything up to the second 'Good afternoon' greeting
        i = t.index("AGENT: Good afternoon", 10)
        a, b = t[:i].strip(), t[i:].strip()
        a = re.split(r"\s+Second call", a)[0].strip()
        f["transcript"] = None
        f["parts"] = {"T17a": {"time": "14:14", "transcript": a}, "T17b": {"time": "14:16", "transcript": b}}
def squash(o):
    if isinstance(o, str): return re.sub(r" {2,}", " ", o)
    if isinstance(o, dict): return {k: squash(v) for k, v in o.items()}
    if isinstance(o, list): return [squash(v) for v in o]
    return o
out = squash(out)
Path(ROOT / "evals" / "fixtures" / "phone.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"wrote {len(out)} fixtures:", [f["id"] for f in out])
