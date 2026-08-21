#!/usr/bin/env python3
"""
Paint the rendered footer (stdin, truecolor ANSI from tools/render-footer.mjs)
into a preview PNG matching the existing gallery dimensions (1307x330).

Writes both assets/statusbar-preview.png (npm pi.image gallery) and
docs/assets/statusbar-preview.png (GitHub Pages) so they stay in sync.

    node tools/render-footer.mjs <theme.json> <width> | python3 tools/paint-preview.py <theme.json>
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1307, 330
TEXT_DEFAULT = (192, 202, 245)  # tokyo-night vars.fg


def load_theme(path: str) -> dict:
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        print(f"cannot read theme JSON at {path}", file=sys.stderr)
        sys.exit(1)


theme = load_theme(sys.argv[1] if len(sys.argv) > 1 else f"{Path.home()}/.pi/agent/themes/tokyo-night.json")
vars_ = theme.get("vars", {})


def rgb(ref: str) -> tuple[int, int, int]:
    hex_ = vars_.get(ref, ref)
    m = re.fullmatch(r"#?([0-9a-f]{6})", hex_, re.I)
    if not m:
        raise ValueError(f"cannot resolve color {ref!r}")
    h = m.group(1)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


BG = rgb("bg") if "bg" in vars_ else (26, 27, 38)
PANEL = rgb("bgSoft") if "bgSoft" in vars_ else (36, 40, 59)
BORDER = rgb(theme["colors"]["border"])

def find_font() -> Path:
    """Prefer a Nerd Font (icon glyphs), fall back to Menlo, else fail loudly."""
    for root in (Path.home() / "Library/Fonts", Path("/System/Library/Fonts"), Path("/usr/share/fonts")):
        if not root.exists():
            continue
        for cand in sorted(root.glob("*.ttf")) + sorted(root.glob("*.otf")):
            if "NerdFont" in cand.name and "Italic" not in cand.name and "Light" not in cand.name:
                return cand
    menlo = Path("/System/Library/Fonts/Menlo.ttc")
    if menlo.exists():
        return menlo
    print("no usable font found — install a Nerd Font (e.g. Caskaydia Cove) for icon glyphs", file=sys.stderr)
    sys.exit(1)


font_path = find_font()


def parse_ansi(text: str) -> list[tuple[str, tuple[int, int, int] | None]]:
    """Split into (char, fg) runs, honoring truecolor SGR and skipping OSC 8."""
    runs: list[tuple[str, tuple[int, int, int] | None]] = []
    fg: tuple[int, int, int] | None = None
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\x1b":
            if text[i + 1 : i + 2] == "[":
                j = text.find("m", i + 2)
                if j == -1:
                    break
                params = text[i + 2 : j]
                if params == "0":
                    fg = None
                else:
                    m = re.fullmatch(r"38;2;(\d+);(\d+);(\d+)", params)
                    if m:
                        try:
                            fg = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
                        except ValueError:
                            fg = None  # malformed SGR — treat as reset
                i = j + 1
                continue
            if text[i + 1 : i + 2] == "]":
                j = text.find("\x1b\\", i + 2)
                i = len(text) if j == -1 else j + 2
                continue
        runs.append((ch, fg))
        i += 1
    return runs


def main() -> None:
    lines = [l for l in sys.stdin.read().split("\n") if l]
    parsed = [parse_ansi(l) for l in lines]
    ncols = max(len(r) for r in parsed)

    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    pad_x, pad_y = 36, 30
    inner_w = W - 2 * pad_x

    # Largest font that fits ncols across the panel.
    font = ImageFont.truetype(str(font_path), 10)
    size = 10
    while size <= 96:
        cand = ImageFont.truetype(str(font_path), size)
        if ncols * cand.getlength("M") > inner_w or size * 1.55 * 2 + pad_y > 210:
            break
        font = cand
        size += 1
    advance = font.getlength("M")
    try:
        line_h = int((font.getmetrics()[0] + font.getmetrics()[1]) * 1.35)
    except (AttributeError, OSError):
        line_h = int(font.size * 1.45)
    panel_h = line_h * len(parsed) + 2 * pad_y
    panel_top = (H - panel_h) // 2
    panel_box = [pad_x - 24, panel_top - 10, W - pad_x + 24, panel_top + panel_h + 10]
    draw.rounded_rectangle(panel_box, radius=14, fill=PANEL, outline=BORDER, width=1)

    # Group same-color consecutive chars into drawable runs.
    for row, runs in enumerate(parsed):
        y = panel_top + pad_y + line_h * row + line_h // 2
        x = pad_x
        grouped: list[tuple[list[str], tuple[int, int, int] | None]] = []
        for ch, fg in runs:
            if grouped and grouped[-1][1] == fg:
                grouped[-1][0].append(ch)
            else:
                grouped.append(([ch], fg))
        for chars, fg in grouped:
            text = "".join(chars)
            draw.text((x, y), text, font=font, fill=fg or TEXT_DEFAULT, anchor="lm")
            x += advance * len(text)

    for out in (Path("assets/statusbar-preview.png"), Path("docs/assets/statusbar-preview.png")):
        try:
            img.save(out)
        except OSError as e:
            print(f"cannot write {out}: {e}", file=sys.stderr)
            sys.exit(1)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
