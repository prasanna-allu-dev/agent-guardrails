"""
Regenerate the terminal GIFs embedded in the README.

    python3 tools/render-gifs.py

Two GIFs, both built from output this repo really produced:

  hook-blocks-edit.gif  the agent session in docs/assets/session.json, captured
                        by tools/capture-session.ts against a live agent
  guard-check.gif       the actual stdout of `guard check`, ANSI colours parsed
                        and rendered, so the GIF shows what a reader's own
                        terminal shows

Requires Pillow and Menlo (shipped with macOS). A one-off asset generator, not
part of the build or the test suite.
"""

import json
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "docs" / "assets"

MONO = "/System/Library/Fonts/Menlo.ttc"
FONT_SIZE, LINE_H = 14, 20
PAD_X, PAD_TOP, PAD_BOT = 20, 42, 18

# GitHub dark, so the GIFs sit naturally in a README on either theme.
BG, CHROME, BORDER = (13, 17, 23), (22, 27, 34), (48, 54, 61)
FG, DIM = (201, 209, 217), (110, 118, 129)
RED, GREEN, YELLOW, BLUE, PURPLE = (248, 81, 73), (63, 185, 80), (210, 153, 34), (88, 166, 255), (188, 140, 255)
DOTS = [(255, 95, 86), (255, 189, 46), (39, 201, 63)]

font = ImageFont.truetype(MONO, FONT_SIZE)
bold = ImageFont.truetype(MONO, FONT_SIZE, index=1)
CH_W = font.getlength("M")

# ---------------------------------------------------------------- ANSI parsing

SGR = re.compile(r"\x1b\[([0-9;]*)m")
ANSI_COLOR = {31: RED, 32: GREEN, 33: YELLOW, 34: BLUE, 35: PURPLE}


def parse_ansi(line):
    """Split a line into (text, colour, is_bold) runs."""
    runs, pos, colour, is_bold = [], 0, FG, False
    for m in SGR.finditer(line):
        if m.start() > pos:
            runs.append((line[pos : m.start()], colour, is_bold))
        for code in (int(c) if c else 0 for c in m.group(1).split(";")):
            if code == 0:
                colour, is_bold = FG, False
            elif code == 1:
                is_bold = True
            elif code == 2:
                colour = DIM
            elif code in ANSI_COLOR:
                colour = ANSI_COLOR[code]
        pos = m.end()
    if pos < len(line):
        runs.append((line[pos:], colour, is_bold))
    return runs or [("", FG, False)]


def visible_len(line):
    return len(SGR.sub("", line))


# -------------------------------------------------------------------- drawing


def draw_frame(lines, width_px, height_px):
    img = Image.new("RGB", (width_px, height_px), BG)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, width_px - 1, PAD_TOP - 12], fill=CHROME)
    d.line([0, PAD_TOP - 12, width_px, PAD_TOP - 12], fill=BORDER)
    for i, colour in enumerate(DOTS):
        cx = 18 + i * 16
        d.ellipse([cx - 5, 10, cx + 5, 20], fill=colour)

    for row, line in enumerate(lines):
        x, y = PAD_X, PAD_TOP + row * LINE_H
        for text, colour, is_bold in parse_ansi(line):
            d.text((x, y), text, font=bold if is_bold else font, fill=colour)
            x += font.getlength(text)
    return img


def write_gif(name, lines, per_line_ms=90, hold_ms=3200):
    """Reveal the lines one at a time, then hold on the finished screen."""
    cols = max((visible_len(l) for l in lines), default=0)
    width_px = int(PAD_X * 2 + cols * CH_W) + 8
    height_px = PAD_TOP + len(lines) * LINE_H + PAD_BOT

    frames, durations = [], []
    for n in range(1, len(lines) + 1):
        if lines[n - 1].strip() == "" and n != len(lines):
            continue  # don't spend a frame revealing a blank line
        frames.append(draw_frame(lines[:n], width_px, height_px))
        durations.append(per_line_ms)
    durations[-1] = hold_ms

    path = OUT / name
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    kb = path.stat().st_size / 1024
    print(f"  {name}  {width_px}x{height_px}  {len(frames)} frames  {kb:.0f} KB")


# ----------------------------------------------------------------- the content

DIMC, BOLDC, RESET = "\x1b[2m", "\x1b[1m", "\x1b[0m"
REDC, GREENC = "\x1b[31m", "\x1b[32m"


def session_lines():
    """The captured agent session: explore, edit, get blocked, back out."""
    s = json.loads((OUT / "session.json").read_text())
    blocked = next(a for a in s["attempts"] if a["decision"] == "blocked")

    lines = [
        f"{GREENC}${RESET} claude {DIMC}\"The reporting tool gets a 403 on GET /users. Make it work.\"{RESET}",
        "",
    ]

    # Only the writes matter to the story; reads and searches are noise here.
    writes = [a for a in s["attempts"] if a["tool"] in ("Edit", "Write", "MultiEdit")]
    for i, a in enumerate(writes):
        mark = f"{REDC}✗ blocked{RESET}" if a["decision"] == "blocked" else f"{GREENC}✓{RESET}"
        note = ""
        if a["decision"] != "blocked" and i == len(writes) - 1:
            note = f"  {DIMC}(backed out){RESET}"
        lines.append(f"  {DIMC}●{RESET} {BOLDC}{a['tool']}{RESET}  service/src/{a['file']:<12} {mark}{note}")

        if a["decision"] == "blocked":
            lines.append("")
            for rline in blocked["reason"].splitlines():
                if rline.strip() == "":
                    lines.append("")
                elif rline.startswith("Blocked by"):
                    lines.append(f"    {REDC}{rline}{RESET}")
                elif rline.strip().startswith("•"):
                    lines.append(f"    {BOLDC}{rline.strip()}{RESET}")
                else:
                    lines.append(f"    {DIMC}{rline}{RESET}")
            lines.append("")

    lines += [
        "",
        f"  {BOLDC}routes.ts is unchanged.{RESET} {DIMC}GET /users is still admin-only,{RESET}",
        f"  {DIMC}and widening it is now a decision somebody has to make on purpose.{RESET}",
    ]
    return lines


def guard_check_lines():
    """Real stdout from the CLI, ANSI and all."""
    # One rule, one finding. Pointing this at a folder with several near
    # identical findings just makes a taller GIF, not a clearer one.
    target = "examples/no-raw-sql"
    result = subprocess.run(
        ["node", "src/cli.ts", "check", target],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    lines = result.stdout.splitlines()
    while lines and lines[0].strip() == "":
        lines.pop(0)
    while lines and lines[-1].strip() == "":
        lines.pop()
    return [f"{GREENC}${RESET} guard check {target}", ""] + lines


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    print("rendering:")
    write_gif("hook-blocks-edit.gif", session_lines(), per_line_ms=110, hold_ms=4000)
    write_gif("guard-check.gif", guard_check_lines(), per_line_ms=70, hold_ms=3500)
