#!/usr/bin/env python
"""Build the presentation deck.

Six slides for a two-minute slot, with the live demo landing between slide 3 and slide 4. Styled to
the same instrument-panel palette as the UI so the deck and the demo do not look like two projects.

    uv run python scripts/build_slides.py
"""

from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "docs" / "dhruva.pptx"

# The UI's tokens, so the deck and the product read as one thing.
BASE = RGBColor(0x0B, 0x0D, 0x12)
SURFACE = RGBColor(0x12, 0x15, 0x1C)
INK = RGBColor(0xF2, 0xF4, 0xF8)
INK_DIM = RGBColor(0x9A, 0xA4, 0xB8)
INK_MUTED = RGBColor(0x6B, 0x76, 0x8C)
COHERENCE = RGBColor(0x35, 0xDC, 0xF2)
ALARM = RGBColor(0xF5, 0x41, 0x23)
PASS = RGBColor(0x4A, 0xD9, 0x91)

W, H = Inches(13.333), Inches(7.5)


def deck() -> Presentation:
    prs = Presentation()
    prs.slide_width, prs.slide_height = W, H
    return prs


def blank(prs: Presentation):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.background.fill
    bg.solid()
    bg.fore_color.rgb = BASE
    return slide


def text(
    slide,
    left,
    top,
    width,
    height,
    content,
    *,
    size=24,
    color=INK,
    bold=False,
    align=PP_ALIGN.LEFT,
    font="Helvetica Neue",
    spacing=1.15,
):
    box = slide.shapes.add_textbox(left, top, width, height)
    frame = box.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = MSO_ANCHOR.TOP
    lines = content.split("\n")
    for i, line in enumerate(lines):
        para = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
        para.alignment = align
        para.line_spacing = spacing
        run = para.add_run()
        run.text = line
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color
        run.font.name = font
    return box


def kicker(slide, content, color=INK_MUTED):
    text(
        slide,
        Inches(0.9),
        Inches(0.55),
        Inches(11),
        Inches(0.4),
        content,
        size=13,
        color=color,
        font="Courier New",
        bold=True,
    )


def rule(slide, top, color=COHERENCE, width=Inches(1.6), height=Emu(28575)):
    from pptx.enum.shapes import MSO_SHAPE

    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.9), top, width, height)
    bar.fill.solid()
    bar.fill.fore_color.rgb = color
    bar.line.fill.background()
    bar.shadow.inherit = False
    return bar


def panel(slide, left, top, width, height, color=SURFACE):
    from pptx.enum.shapes import MSO_SHAPE

    box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    box.fill.solid()
    box.fill.fore_color.rgb = color
    box.line.color.rgb = RGBColor(0x25, 0x2B, 0x38)
    box.line.width = Pt(1)
    box.shadow.inherit = False
    box.adjustments[0] = 0.04
    return box


def build() -> Path:
    prs = deck()

    # 1 — title
    s = blank(prs)
    rule(s, Inches(2.5))
    text(s, Inches(0.9), Inches(2.8), Inches(11.5), Inches(1.6), "Dhruva", size=88, bold=True)
    text(
        s,
        Inches(0.9),
        Inches(4.2),
        Inches(11.5),
        Inches(0.8),
        "Rollback without amnesia.",
        size=34,
        color=COHERENCE,
    )
    text(
        s,
        Inches(0.9),
        Inches(5.1),
        Inches(11.5),
        Inches(1.2),
        "A supervisor that catches an agent losing the plot, rolls it back —\n"
        "and keeps what it learned.",
        size=22,
        color=INK_DIM,
    )
    text(
        s,
        Inches(0.9),
        Inches(6.6),
        Inches(11.5),
        Inches(0.4),
        "Long Horizon Agents Build Day  ·  AGI House",
        size=13,
        color=INK_MUTED,
        font="Courier New",
    )

    # 2 — the problem
    s = blank(prs)
    kicker(s, "THE PROBLEM")
    text(
        s,
        Inches(0.9),
        Inches(1.3),
        Inches(11.5),
        Inches(1.6),
        "Long-horizon agents don't crash.\nThey drift.",
        size=54,
        bold=True,
    )
    text(
        s,
        Inches(0.9),
        Inches(3.2),
        Inches(11.5),
        Inches(1.4),
        "A tool lies. A constraint gets compacted away. The agent keeps working —\n"
        "confidently, on the wrong thing. You find out an hour later.",
        size=24,
        color=INK_DIM,
    )
    rule(s, Inches(4.9), color=ALARM)
    text(
        s,
        Inches(0.9),
        Inches(5.2),
        Inches(11.5),
        Inches(1.4),
        "Rollback is the obvious fix. But rollback is lossy:\n"
        "it destroys everything the agent legitimately learned.",
        size=26,
        color=ALARM,
        bold=True,
    )

    # 3 — the mechanism
    s = blank(prs)
    kicker(s, "THE MECHANISM")
    text(
        s,
        Inches(0.9),
        Inches(1.15),
        Inches(11.5),
        Inches(0.9),
        "Separate work state from knowledge.",
        size=42,
        bold=True,
    )

    panel(s, Inches(0.9), Inches(2.3), Inches(5.5), Inches(3.4))
    text(
        s,
        Inches(1.25),
        Inches(2.6),
        Inches(4.9),
        Inches(0.5),
        "WORK STATE",
        size=15,
        color=INK_MUTED,
        font="Courier New",
        bold=True,
    )
    text(
        s,
        Inches(1.25),
        Inches(3.15),
        Inches(4.9),
        Inches(2.4),
        "Hash-chained checkpoints,\nminted only on verified windows.\n\nOn breach: restored.",
        size=22,
        color=INK,
    )

    panel(s, Inches(6.9), Inches(2.3), Inches(5.5), Inches(3.4))
    text(
        s,
        Inches(7.25),
        Inches(2.6),
        Inches(4.9),
        Inches(0.5),
        "KNOWLEDGE",
        size=15,
        color=COHERENCE,
        font="Courier New",
        bold=True,
    )
    text(
        s,
        Inches(7.25),
        Inches(3.15),
        Inches(4.9),
        Inches(2.4),
        "Append-only, taint-tracked.\n\n"
        "On breach: kept — minus what\nprovenance traces to the poison.",
        size=22,
        color=INK,
    )

    text(
        s,
        Inches(0.9),
        Inches(6.0),
        Inches(11.5),
        Inches(0.9),
        "C = 0.6·alignment + 0.2·repetition + 0.2·progress     "
        "— two of three terms are arithmetic, not sampled.",
        size=16,
        color=INK_MUTED,
        font="Courier New",
    )

    # 4 — demo marker
    s = blank(prs)
    rule(s, Inches(3.0))
    text(s, Inches(0.9), Inches(3.3), Inches(11.5), Inches(1.2), "Demo", size=76, bold=True)
    text(
        s,
        Inches(0.9),
        Inches(4.6),
        Inches(11.5),
        Inches(0.8),
        "A real run. Replayed from its own event log.",
        size=26,
        color=COHERENCE,
    )

    # 5 — the result
    s = blank(prs)
    kicker(s, "THE RESULT  ·  IDENTICAL TASK, IDENTICAL INJECTION")
    text(
        s,
        Inches(0.9),
        Inches(1.15),
        Inches(11.5),
        Inches(0.9),
        "The only variable is whether the supervisor may act.",
        size=34,
        bold=True,
    )

    panel(s, Inches(0.9), Inches(2.4), Inches(5.5), Inches(2.9))
    text(
        s,
        Inches(1.25),
        Inches(2.7),
        Inches(4.9),
        Inches(0.5),
        "SUPERVISED",
        size=15,
        color=COHERENCE,
        font="Courier New",
        bold=True,
    )
    text(
        s,
        Inches(1.25),
        Inches(3.2),
        Inches(4.9),
        Inches(1.2),
        "12/12",
        size=64,
        bold=True,
        color=PASS,
    )
    text(
        s,
        Inches(1.25),
        Inches(4.5),
        Inches(4.9),
        Inches(0.6),
        "1 breach · 1 rollback · recovered",
        size=17,
        color=INK_DIM,
    )

    panel(s, Inches(6.9), Inches(2.4), Inches(5.5), Inches(2.9))
    text(
        s,
        Inches(7.25),
        Inches(2.7),
        Inches(4.9),
        Inches(0.5),
        "UNSUPERVISED",
        size=15,
        color=ALARM,
        font="Courier New",
        bold=True,
    )
    text(
        s,
        Inches(7.25),
        Inches(3.2),
        Inches(4.9),
        Inches(1.2),
        "0/12",
        size=64,
        bold=True,
        color=ALARM,
    )
    text(
        s,
        Inches(7.25),
        Inches(4.5),
        Inches(4.9),
        Inches(0.6),
        "2 breaches detected · 0 rollbacks",
        size=17,
        color=INK_DIM,
    )

    text(
        s,
        Inches(0.9),
        Inches(5.7),
        Inches(11.5),
        Inches(1.0),
        "The control arm is not blind. It scores the drift identically —\n"
        "it just never intervenes.",
        size=22,
        color=INK_DIM,
    )

    # 6 — the measured claim
    s = blank(prs)
    kicker(s, "MEASUREMENTS")
    text(
        s,
        Inches(0.9),
        Inches(1.15),
        Inches(11.5),
        Inches(0.9),
        "Eviction has to be precise, or it's just amnesia.",
        size=34,
        bold=True,
    )

    rows = [
        ("policy", "kept", "clean lost", "poisoned kept", INK_MUTED, True),
        ("keep everything", "3", "0", "1", INK_DIM, False),
        ("evict the range", "1", "1", "0", INK_DIM, False),
        ("by provenance", "2", "0", "0", PASS, False),
    ]
    top = Inches(2.5)
    for i, (a, b, c, d, colr, hdr) in enumerate(rows):
        y = top + Inches(0.72 * i)
        fnt = 20 if not hdr else 15
        text(
            s,
            Inches(0.95),
            y,
            Inches(4.2),
            Inches(0.6),
            a,
            size=fnt,
            color=colr,
            font="Courier New",
            bold=not hdr,
        )
        for j, val in enumerate((b, c, d)):
            text(
                s,
                Inches(5.4 + 2.4 * j),
                y,
                Inches(2.2),
                Inches(0.6),
                val,
                size=fnt,
                color=colr,
                font="Courier New",
                bold=not hdr,
                align=PP_ALIGN.CENTER,
            )

    text(
        s,
        Inches(0.9),
        Inches(5.9),
        Inches(11.5),
        Inches(1.0),
        "Evicting the whole discarded range — what rollback means without provenance —\n"
        "destroys knowledge the agent earned. Keeping everything carries the lie forward.",
        size=20,
        color=INK_DIM,
    )

    # 7 — close
    s = blank(prs)
    rule(s, Inches(2.2))
    text(
        s,
        Inches(0.9),
        Inches(2.5),
        Inches(11.5),
        Inches(2.4),
        "Framework-agnostic.\nThree adapter seams.\nOne append-only event log.",
        size=44,
        bold=True,
        spacing=1.25,
    )
    text(
        s,
        Inches(0.9),
        Inches(5.3),
        Inches(11.5),
        Inches(0.9),
        "Everything you saw — live view, provenance graph, twin, replay —\n"
        "derives from that one log.",
        size=22,
        color=INK_DIM,
    )
    text(
        s,
        Inches(0.9),
        Inches(6.6),
        Inches(11.5),
        Inches(0.4),
        "github.com/poudelsubhan/dhruva",
        size=15,
        color=COHERENCE,
        font="Courier New",
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(OUT)
    return OUT


if __name__ == "__main__":
    path = build()
    print(f"wrote {path} ({path.stat().st_size // 1024} KB)")
