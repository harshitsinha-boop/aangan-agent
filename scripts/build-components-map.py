#!/usr/bin/env python3
"""Generates public/components-map.svg: the Aangan call agent as a swimlane "Components Map"
(lanes = who/what does the work, columns = Trigger / Input / Context / Processing / AI / Output).
   python3 scripts/build-components-map.py"""
from pathlib import Path
from xml.sax.saxutils import escape

LABEL_W, COL_W, TOP, HEAD_H, PAD = 168, 214, 64, 40, 24
COLS = ["Trigger", "Input", "Context", "Processing", "AI", "Output"]
LANES = [  # (name, subtitle, height, band colour)
    ("Caller", "(User)", 112, "#e4e7fb"),
    ("Voice platform", "(Vaani)", 124, "#dcf0ee"),
    ("System", "(Vercel + Supabase)", 218, "#fbf1cf"),
    ("AI models", "(LLMs)", 218, "#e2f2df"),
    ("Email service", "(Resend)", 108, "#fbe1e6"),
    ("CRM", "(HubSpot)", 108, "#f6e4f5"),
    ("Studio team", "(Designers, Nikhil)", 128, "#fde8d6"),
]
FILL = {  # box fill / stroke per lane
    0: ("#c9cffa", "#5a63c8"), 1: ("#bfe6e1", "#2a8f86"), 2: ("#f6e29a", "#b58a00"), 3: ("#c9e8c2", "#3f8f33"),
    4: ("#f7c3cd", "#c2415d"), 5: ("#ecc8ea", "#9a3f95"), 6: ("#f9d0ae", "#c0661a"),
}
BW, BH, BGAP = 188, 84, 12

lane_y, y = [], TOP + HEAD_H
for _, _, h, _ in LANES:
    lane_y.append(y); y += h
H = y + 78
W = LABEL_W + COL_W * len(COLS) + PAD

boxes = {}  # id -> dict(x, y, lane, col, lines)
def box(id_, lane, col, lines, slot=0):
    h = LANES[lane][2]
    by = lane_y[lane] + (h - BH) / 2 if h < 150 else lane_y[lane] + BGAP + slot * (BH + BGAP + 6)
    boxes[id_] = dict(x=LABEL_W + col * COL_W + (COL_W - BW) / 2, y=by, lane=lane, col=col, lines=lines)

box("A", 0, 0, ["Calls the studio", "day or night, in English,", "Hindi or Marathi"])
box("B", 1, 1, ["Answers instantly", "says it is Aangan's AI", "assistant; call is recorded"])
box("C", 1, 2, ["Prompt + studio rules", "services, 5-point rubric,", "never speaks a price"])
box("CTX", 2, 2, ["Studio data (Supabase)", "slots, designers, config:", "hours, min weeks, budget"])
box("E", 2, 3, ["Live tools (mid-call)", "look up caller, offer slots,", "book (atomic), escalate"], 0)
box("F", 2, 3, ["After the call", "webhook: transcript, cost,", "after-hours, SLA cron (1 min)"], 1)
box("L", 3, 4, ["Agent brain (in Vaani)", "decides what to say and", "which tool to call"], 0)
box("G", 3, 4, ["Post-call AI (Gemini)", "reads transcript for facts;", "rules decide the outcome"], 1)
box("O5", 1, 5, ["Fallback alert call", "to Nikhil if an escalation", "is not acknowledged in 5 min"])
box("O1", 2, 5, ["Lead + handoff saved", "designer assigned, signed", "single-use action links"])
box("O2", 4, 5, ["Handoff email", "Accept / Reassign; booking", "confirmation; URGENT alert"])
box("O3", 5, 5, ["HubSpot deal", "contact + summary note;", "stage follows the lead"])
box("O4", 6, 5, ["One-click accept", "dashboard: calls, leads,", "cost vs pipeline"])

def pt(b, side):
    b = boxes[b]; x, y = b["x"], b["y"]
    return {"r": (x + BW, y + BH / 2), "l": (x, y + BH / 2), "t": (x + BW / 2, y), "b": (x + BW / 2, y + BH)}[side]

def arrow(a, b, via=None):
    A, B = boxes[a], boxes[b]
    if A["col"] < B["col"]:
        (x1, y1), (x2, y2) = pt(a, "r"), pt(b, "l")
        mx = via if via is not None else (x1 + x2) / 2
        d = f"M{x1:.0f},{y1:.0f} H{mx:.0f} V{y2:.0f} H{x2:.0f}"
    else:
        (x1, y1), (x2, y2) = pt(a, "b" if B["y"] > A["y"] else "t"), pt(b, "t" if B["y"] > A["y"] else "b")
        d = f"M{x1:.0f},{y1:.0f} V{y2:.0f}" if abs(x1 - x2) < 1 else f"M{x1:.0f},{y1:.0f} V{(y1 + y2) / 2:.0f} H{x2:.0f} V{y2:.0f}"
    return f'<path d="{d}" fill="none" stroke="#5f5f5f" stroke-width="1.6" stroke-dasharray="6 4" marker-end="url(#ah)"/>'

o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">',
     '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#5f5f5f"/></marker></defs>',
     f'<rect width="{W}" height="{H}" fill="#f8f4ed"/>',
     f'<text x="{W/2}" y="40" text-anchor="middle" font-size="23" font-weight="700" fill="#2b211a">Aangan Studio after-hours call agent · Components Map</text>']
# lanes
for i, (name, sub, h, col) in enumerate(LANES):
    o.append(f'<rect x="{LABEL_W}" y="{lane_y[i]}" width="{COL_W*len(COLS)}" height="{h}" fill="{col}"/>')
    o.append(f'<rect x="{PAD/2}" y="{lane_y[i]}" width="{LABEL_W-PAD/2}" height="{h}" fill="#5b4a3b"/>')
    o.append(f'<text x="{PAD/2+(LABEL_W-PAD/2)/2}" y="{lane_y[i]+h/2-2}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">{escape(name)}</text>')
    o.append(f'<text x="{PAD/2+(LABEL_W-PAD/2)/2}" y="{lane_y[i]+h/2+16}" text-anchor="middle" font-size="11" fill="#e8dccf">{escape(sub)}</text>')
# header + column guides
o.append(f'<rect x="{PAD/2}" y="{TOP}" width="{W-PAD}" height="{HEAD_H}" fill="#5b4a3b"/>')
o.append(f'<text x="{PAD/2+(LABEL_W-PAD/2)/2}" y="{TOP+25}" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">Actor</text>')
for c, name in enumerate(COLS):
    cx = LABEL_W + c * COL_W
    o.append(f'<text x="{cx+COL_W/2}" y="{TOP+25}" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">{name}</text>')
    if c: o.append(f'<line x1="{cx}" y1="{TOP+HEAD_H}" x2="{cx}" y2="{y}" stroke="#ffffff" stroke-opacity=".7" stroke-width="2"/>')
# arrows under boxes
for a, b, via in [("A","B",None),("B","C",None),("C","E",None),("CTX","E",None),("E","F",None),("F","G",None),("G","O1",None),
                  ("F","O5",None),("O1","O2",None),("O2","O3",None),("O3","O4",None)]:
    o.append(arrow(a, b, via))
for id_, b in boxes.items():
    fill, stroke = FILL[b["lane"]]
    o.append(f'<rect x="{b["x"]:.0f}" y="{b["y"]:.0f}" width="{BW}" height="{BH}" rx="9" fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>')
    for k, line in enumerate(b["lines"]):
        o.append(f'<text x="{b["x"]+BW/2:.0f}" y="{b["y"]+26+k*18:.0f}" text-anchor="middle" font-size="{13 if k==0 else 11.5}" font-weight="{700 if k==0 else 400}" fill="#2b211a">{escape(line)}</text>')
foot = y + 28
for k, t in enumerate([
    "Privacy: emails carry a summary and a dashboard link only; the transcript never leaves the system and the phone shows as last 4 digits. Action links change only their own record, once, and expire (72 h / 2 h).",
    "Safety: no price, rate or per-sq-ft figure is ever spoken (verified by CI). Escalations skip qualification; unacknowledged ones trigger an outbound call. Dashed arrows = data / control flow.",
]):
    o.append(f'<text x="{PAD/2}" y="{foot+k*19}" font-size="11.5" fill="#6b5d50">{escape(t)}</text>')
o.append("</svg>")
Path(__file__).resolve().parent.parent.joinpath("public", "components-map.svg").write_text("\n".join(o), encoding="utf-8")
print(f"wrote public/components-map.svg ({W}x{H})")
