"""
Generate every BayanFlow icon and installer bitmap from one geometry definition.

Run by hand when the mark changes; it is deliberately NOT part of `npm run build`,
because these outputs change roughly once a year and are committed to the repo.

    python scripts/make-icons.py

Needs Pillow. Reads nothing from the project; writes:

    src/assets/tray-icon.ico        tray, both windows, app icon, installer icon
    build/installerHeaderIcon.ico   NSIS header icon
    build/installerHeader.bmp       NSIS top banner, 150x57
    build/installerSidebar.bmp      NSIS welcome page, 164x314
    build/uninstallerSidebar.bmp    same, for the uninstaller

Two things here are not obvious and are the reason this file exists:

1.  **Every size is drawn at its own size, not downscaled from one big image.**
    The previous icon shipped a single 256x256 image and let Windows shrink it to
    16px, which is what turned thin line art into a smudge. Small sizes get their
    own tuned geometry below.

2.  **The .ico writer is hand-rolled, and small sizes are written as BMP/DIB
    rather than PNG.** Pillow's own ICO save resizes one source image, which is
    exactly the bug above. And NSIS does not reliably accept PNG-compressed ICO
    entries for an installer icon, so anything 64px or smaller is stored as an
    uncompressed 32bpp DIB. Only the 256px entry is PNG, which is universal.
"""

from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# The mark: a pill with an indicator lamp on the left, on its own dark tile.
#
# The tile is not decoration. Windows draws an .ico exactly as given and does not
# recolour it for a light taskbar the way macOS does, so a bare white mark would
# vanish for anyone running Windows in light mode. One file serves the tray, both
# windows, the app icon and the installer, so it has to carry its own ground.
#
# All coordinates are on a 32x32 grid and scale with the target size.
# ---------------------------------------------------------------------------

GROUND = (12, 13, 15, 255)      # #0c0d0f — the tile
PILL   = (236, 234, 228, 255)   # #eceae4 — paper-white, matches --bf-text
LAMP   = (63, 224, 138, 255)    # #3fe08a — exactly --bf-live, the recording colour

# The proportions matter more than the shapes. A dot that fills the pill's height
# reads as a TOGGLE KNOB — the first draft of this icon looked like a settings
# switch, which was caught by rendering it rather than by reasoning about it. The
# lamp has to stay near 42% of the pill's height, with visible white around it,
# and the pill has to stay near 3:1 rather than a toggle's 2:1.
BASE = {
    "tile_r": 7.5,
    "pill_x": 4.0, "pill_y": 12.0, "pill_w": 24.0, "pill_h": 8.0,
    "lamp_cx": 9.2, "lamp_cy": 16.0, "lamp_r": 1.7,
}

# Hand-tuning for sizes where the base geometry runs out of pixels.
#
# Two separate things happen here. The pill gets proportionally FATTER as the
# icon gets smaller, so the lamp keeps enough pixels to read as a lamp rather
# than a speck. And every value is chosen so that, once multiplied by size/32, it
# lands on a WHOLE PIXEL — a pill edge sitting on a half pixel gets a grey blend
# row from the downsampler, which is the soft-edged look this whole file exists
# to avoid. At 16px the scale is 0.5, so the numbers are even; at 24px it is
# 0.75, so they are multiples of four.
TUNING = {
    16: {"tile_r": 6.0, "pill_x": 4.0, "pill_y": 10.0, "pill_w": 24.0, "pill_h": 12.0,
         "lamp_cx": 9.0, "lamp_r": 2.5},
    20: {"tile_r": 6.4, "pill_x": 4.0, "pill_y": 11.2, "pill_w": 24.0, "pill_h": 9.6,
         "lamp_cx": 9.6, "lamp_r": 2.24},
    24: {"tile_r": 6.67, "pill_x": 4.0, "pill_y": 10.667, "pill_w": 24.0, "pill_h": 10.667,
         "lamp_cx": 9.333, "lamp_r": 2.24},
}

SUPERSAMPLE = 8

TRAY_SIZES = [16, 20, 24, 32, 48, 64, 256]
HEADER_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]


def geometry(size: int) -> dict:
    g = dict(BASE)
    g.update(TUNING.get(size, {}))
    return g


def draw_mark(size: int) -> Image.Image:
    """Render the mark at one pixel size, supersampled then downsampled."""
    g = geometry(size)
    s = size * SUPERSAMPLE
    k = s / 32.0  # 32-grid unit -> supersampled pixel

    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=g["tile_r"] * k, fill=GROUND)

    x0 = g["pill_x"] * k
    y0 = g["pill_y"] * k
    x1 = x0 + g["pill_w"] * k
    y1 = y0 + g["pill_h"] * k
    d.rounded_rectangle([x0, y0, x1, y1], radius=(g["pill_h"] * k) / 2.0, fill=PILL)

    cx = g["lamp_cx"] * k
    cy = g["lamp_cy"] * k
    r = g["lamp_r"] * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=LAMP)

    return img.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------------------
# .ico writer
# ---------------------------------------------------------------------------

def _dib_entry(img: Image.Image) -> bytes:
    """One uncompressed 32bpp DIB, the format NSIS is guaranteed to understand.

    An icon DIB declares double its real height: the top half is the colour
    bitmap, the bottom half is a 1bpp AND mask. Rows run bottom-up. The mask is
    all zeros here because the tile is fully opaque and the alpha channel does
    the real work.
    """
    w, h = img.size
    px = img.convert("RGBA").load()

    xor = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))

    mask_row = ((w + 31) // 32) * 4  # each mask row padded to 4 bytes
    and_mask = bytes(mask_row * h)

    header = struct.pack(
        "<IiiHHIIiiII",
        40,        # biSize
        w,         # biWidth
        h * 2,     # biHeight — colour bitmap + mask
        1,         # biPlanes
        32,        # biBitCount
        0,         # biCompression = BI_RGB
        len(xor),  # biSizeImage
        0, 0,      # pixels-per-metre
        0, 0,      # palette
    )
    return header + bytes(xor) + and_mask


def write_ico(path: Path, sizes: list[int]) -> None:
    images = [(n, draw_mark(n)) for n in sizes]

    payloads = []
    for n, img in images:
        if n >= 256:
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            payloads.append(buf.getvalue())
        else:
            payloads.append(_dib_entry(img))

    offset = 6 + 16 * len(images)
    directory = b""
    for (n, _), data in zip(images, payloads):
        directory += struct.pack(
            "<BBBBHHII",
            n if n < 256 else 0,   # 0 means 256 in an .ico
            n if n < 256 else 0,
            0, 0, 1, 32,
            len(data),
            offset,
        )
        offset += len(data)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        struct.pack("<HHH", 0, 1, len(images)) + directory + b"".join(payloads)
    )
    print(f"  {path.relative_to(ROOT)}  ({len(sizes)} sizes: {', '.join(map(str, sizes))})")


# ---------------------------------------------------------------------------
# Installer bitmaps. NSIS wants plain 24-bit BMP with no alpha.
# ---------------------------------------------------------------------------

def _font(names: list[str], size: int):
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _flatten(mark: Image.Image, onto: Image.Image, x: int, y: int) -> None:
    onto.paste(mark.convert("RGB"), (x, y), mark)


def write_header_bmp(path: Path) -> None:
    """The banner in the top-right of the installer's interior pages.

    This one is WHITE, and that is not a style slip: NSIS draws its header bar in
    the system light colour and prints the page title next to this bitmap in dark
    text. A dark banner floats in that bar as an obvious rectangle. The previous
    art got this right — verified by reading its corner pixels — so the dark tile
    provides the contrast here instead of the background.
    """
    w, h = 150, 57
    img = Image.new("RGB", (w, h), (255, 255, 255))
    d = ImageDraw.Draw(img)

    mark = draw_mark(32)
    _flatten(mark, img, 12, (h - 32) // 2)

    d.text((54, 15), "BayanFlow", font=_font(["segoeuisb.ttf", "segoeui.ttf"], 15), fill=(23, 24, 29))
    d.text((55, 33), "dictation", font=_font(["consola.ttf"], 10), fill=(113, 116, 127))

    img.save(path, format="BMP")
    print(f"  {path.relative_to(ROOT)}  ({w}x{h})")


def write_sidebar_bmp(path: Path, subtitle: str) -> None:
    w, h = 164, 314
    img = Image.new("RGB", (w, h), (8, 8, 9))
    d = ImageDraw.Draw(img)

    # A faint horizon so the panel is not a flat rectangle. Kept very low
    # contrast: this sits behind installer text drawn by Windows, not by us.
    for y in range(h):
        t = y / h
        v = int(8 + 10 * (1 - t) ** 2)
        d.line([(0, y), (w, y)], fill=(v, v, v + 1))

    mark = draw_mark(64)
    _flatten(mark, img, (w - 64) // 2, 54)

    title = _font(["segoeuisb.ttf", "segoeui.ttf"], 17)
    sub = _font(["consola.ttf"], 10)
    tw = d.textlength("BayanFlow", font=title)
    d.text(((w - tw) / 2, 134), "BayanFlow", font=title, fill=PILL[:3])
    sw = d.textlength(subtitle, font=sub)
    d.text(((w - sw) / 2, 157), subtitle, font=sub, fill=(125, 126, 120))

    d.line([(46, 182), (w - 46, 182)], fill=(30, 31, 33))

    img.save(path, format="BMP")
    print(f"  {path.relative_to(ROOT)}  ({w}x{h})")


def main() -> None:
    print("Icons:")
    write_ico(ROOT / "src" / "assets" / "tray-icon.ico", TRAY_SIZES)
    write_ico(ROOT / "build" / "installerHeaderIcon.ico", HEADER_ICON_SIZES)
    print("Installer art:")
    write_header_bmp(ROOT / "build" / "installerHeader.bmp")
    write_sidebar_bmp(ROOT / "build" / "installerSidebar.bmp", "hold. speak. done.")
    write_sidebar_bmp(ROOT / "build" / "uninstallerSidebar.bmp", "remove BayanFlow")


if __name__ == "__main__":
    main()
