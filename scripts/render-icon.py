"""Build the Home Screen icon from Playfair Display outlines.

The SVG files contain paths only. Rendering the PNGs does not need the font
installed. Playfair Display is used here under the SIL Open Font License;
see assets/icon/OFL.txt.
"""
from pathlib import Path

import cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
FONT = ROOT / "assets" / "icon" / "PlayfairDisplay-wght.ttf"
OUT_SVG = ROOT / "assets" / "icon" / "icon.svg"
OUT_MASK = ROOT / "assets" / "icon" / "icon-maskable.svg"
ICONS = ROOT / "public" / "icons"

GOLD = "#C9993F"
NAVY = "#0B2350"
PAPER = "#F3ECDF"
SIZE = 512


def font_at(weight: float) -> TTFont:
    source = TTFont(FONT)
    return instantiateVariableFont(source, {"wght": weight}, inplace=False)


def glyph_names(font: TTFont, text: str) -> list[str]:
    cmap = font.getBestCmap()
    names = []
    for char in text:
        name = cmap.get(ord(char))
        if not name:
            raise SystemExit(f"missing glyph for {char!r}")
        names.append(name)
    return names


def text_group(font: TTFont, text: str, size: float, tracking: float, cx: float, baseline: float, fill: str) -> str:
    glyph_set = font.getGlyphSet()
    hmtx = font["hmtx"]
    upem = font["head"].unitsPerEm
    names = glyph_names(font, text)
    scale = size / upem
    track_units = tracking / scale
    widths = [hmtx[name][0] for name in names]
    total = sum(widths) + track_units * (len(names) - 1)
    cursor = -total / 2
    parts = []
    for name, width in zip(names, widths):
        pen = SVGPathPen(glyph_set)
        glyph_set[name].draw(pen)
        commands = pen.getCommands()
        if commands:
            parts.append(f'<path d="{commands}" transform="translate({cursor:.2f} 0)"/>')
        cursor += width + track_units
    return (
        f'<g fill="{fill}" transform="translate({cx:.2f} {baseline:.2f}) scale({scale:.5f} {-scale:.5f})">'
        + "".join(parts)
        + "</g>"
    )


def emblem() -> str:
    perfect = font_at(560)
    numeral = font_at(700)
    parts = [
        f'<circle cx="256" cy="256" r="226" fill="none" stroke="{GOLD}" stroke-width="5"/>',
        text_group(perfect, "PERFECT", 34, 7.2, 256, 168, GOLD),
        f'<rect x="176" y="186" width="160" height="2" fill="{GOLD}"/>',
        text_group(numeral, "10", 220, 4, 256, 360, NAVY),
    ]
    return "".join(parts)


def svg(maskable: bool) -> str:
    inner = emblem()
    # Maskable icons are cropped to a circle. Scale the mark so the ring stays
    # inside the center 80% safe zone; the warm background still fills the tile.
    if maskable:
        inner = f'<g transform="translate(256 256) scale(0.76) translate(-256 -256)">{inner}</g>'
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{SIZE}" height="{SIZE}">\n'
        f'<rect width="{SIZE}" height="{SIZE}" fill="{PAPER}"/>\n'
        f"{inner}\n</svg>\n"
    )


def png(source: str, dest: Path, size: int) -> None:
    cairosvg.svg2png(bytestring=source.encode(), write_to=str(dest), output_width=size, output_height=size)


def main() -> None:
    regular = svg(False)
    masked = svg(True)
    OUT_SVG.write_text(regular)
    OUT_MASK.write_text(masked)
    png(regular, ICONS / "icon-512.png", 512)
    png(regular, ICONS / "icon-192.png", 192)
    png(regular, ICONS / "apple-touch-icon.png", 180)
    png(regular, ICONS / "favicon-32.png", 32)
    png(masked, ICONS / "icon-maskable-512.png", 512)
    print("wrote icons")


if __name__ == "__main__":
    main()
