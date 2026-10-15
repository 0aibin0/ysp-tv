#!/usr/bin/env python3
"""Generate the launcher icon (TV banner + normal icon) with Pillow."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"D:\Desktop\deepseek-dsh\yangshipin-tv\app\src\main\res\drawable"
os.makedirs(OUT, exist_ok=True)

ACCENT = (78, 161, 255)
ACCENT2 = (24, 92, 190)
BG = (10, 14, 22)


def font(size):
    """Best available CJK-capable font, else Pillow's default."""
    for p in [
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
    ]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def draw_icon(size, pad_ratio=0.0):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Rounded dark tile
    m = int(size * pad_ratio)
    d.rounded_rectangle([m, m, size - m - 1, size - m - 1],
                        radius=int(size * 0.20), fill=BG + (255,))

    # Screen outline (a TV set)
    sx0, sy0 = int(size * 0.14), int(size * 0.20)
    sx1, sy1 = int(size * 0.86), int(size * 0.68)
    d.rounded_rectangle([sx0, sy0, sx1, sy1], radius=int(size * 0.055),
                        outline=ACCENT + (255,), width=max(2, int(size * 0.032)))

    # Play triangle inside the screen
    cx, cy = size * 0.5, (sy0 + sy1) / 2.0
    r = size * 0.115
    d.polygon([(cx - r * 0.72, cy - r), (cx - r * 0.72, cy + r), (cx + r * 0.95, cy)],
              fill=ACCENT + (255,))

    # Stand
    d.rectangle([int(size * 0.42), sy1 + int(size * 0.02),
                 int(size * 0.58), sy1 + int(size * 0.075)], fill=ACCENT2 + (255,))
    d.rounded_rectangle([int(size * 0.32), sy1 + int(size * 0.075),
                         int(size * 0.68), sy1 + int(size * 0.115)],
                        radius=int(size * 0.02), fill=ACCENT2 + (255,))
    return img


def draw_banner(w, h):
    """Android TV home-screen banner (320x180 dp): picture + label."""
    img = Image.new("RGBA", (w, h), BG + (255,))
    d = ImageDraw.Draw(img)

    # Subtle vertical gradient
    for y in range(h):
        t = y / float(h - 1)
        c = (int(10 + 16 * t), int(14 + 22 * t), int(22 + 34 * t), 255)
        d.line([(0, y), (w, y)], fill=c)

    # TV glyph on the left
    gx0, gy0 = int(w * 0.055), int(h * 0.22)
    gx1, gy1 = int(w * 0.30), int(h * 0.72)
    d.rounded_rectangle([gx0, gy0, gx1, gy1], radius=int(h * 0.07),
                        outline=ACCENT + (255,), width=max(2, int(h * 0.035)))
    cx, cy = (gx0 + gx1) / 2.0, (gy0 + gy1) / 2.0
    r = h * 0.13
    d.polygon([(cx - r * 0.7, cy - r), (cx - r * 0.7, cy + r), (cx + r * 0.9, cy)],
              fill=ACCENT + (255,))
    d.rectangle([int((gx0 + gx1) / 2 - w * 0.018), gy1 + int(h * 0.015),
                 int((gx0 + gx1) / 2 + w * 0.018), gy1 + int(h * 0.055)],
                fill=ACCENT2 + (255,))

    # Text
    f1 = font(int(h * 0.30))
    f2 = font(int(h * 0.155))
    tx = int(w * 0.36)
    d.text((tx, int(h * 0.27)), "央视频", font=f1, fill=(255, 255, 255, 255))
    d.text((tx, int(h * 0.60)), "电视直播", font=f2, fill=ACCENT + (255,))
    return img


def save(img, name):
    p = os.path.join(OUT, name)
    img.save(p, "PNG")
    print(f"wrote {p}  {img.size}")


save(draw_banner(640, 360), "tv_banner.png")
save(draw_icon(432), "ic_launcher.png")
print("done")
