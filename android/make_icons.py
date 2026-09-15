#!/usr/bin/env python3
# آیکون لانچر سِتب — پس‌زمینهٔ سبز گرادیانی + «س» سفید (B Nazanin)
# خروجی: legacy ic_launcher.png (rounded square) + adaptive ic_launcher_fg.png (transparent)
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "res")
FONT = "/home/z/my-project/upload/B-NAZANIN.TTF"
GREEN_TOP = (16, 145, 106)   # #10916A
GREEN_BOT = (4, 77, 58)      # #044D3A

def gradient(size, top, bot, radius=None):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    g = Image.new("RGBA", (size, size))
    px = g.load()
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(top[0] + (bot[0] - top[0]) * t)
        gg = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        for x in range(size):
            px[x, y] = (r, gg, b, 255)
    if radius:
        mask = Image.new("L", (size, size), 0)
        d = ImageDraw.Draw(mask)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
        img.paste(g, (0, 0), mask)
        return img
    return g

def draw_glyph(canvas, box_size, glyph_ratio=0.62, color=(255, 255, 255, 255)):
    s = canvas.size[0]
    target = int(s * glyph_ratio)
    # س را در بوم موقت بزرگ می‌کشیم تا کیفیت بالا بماند
    tmp = int(box_size * 4)
    font = ImageFont.truetype(FONT, tmp)
    bbox = ImageDraw.Draw(Image.new("L", (tmp, tmp))).textbbox((0, 0), "\u0633", font=font)
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    scale = target / max(gw, gh)
    nw, nh = max(1, int(gw * scale)), max(1, int(gh * scale))
    layer = Image.new("RGBA", (nw, nh), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((-bbox[0] * scale, -bbox[1] * scale), "\u0633",
                               font=ImageFont.truetype(FONT, int(tmp * scale)), fill=color)
    canvas.alpha_composite(layer, ((s - nw) // 2, (s - nh) // 2))

# ---- adaptive foreground: 108dp با ناحیهٔ امن ۶۶٪ (گراف در 62٪ مرکز) ----
FG_SIZES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
for dens, s in FG_SIZES.items():
    d = os.path.join(OUT, f"mipmap-{dens}")
    os.makedirs(d, exist_ok=True)
    big = 1024
    fg = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw_glyph(fg, big, glyph_ratio=0.60)
    fg = fg.resize((s, s), Image.LANCZOS)
    fg.save(os.path.join(d, "ic_launcher_fg.png"))
    print("fg", dens, s)

# ---- legacy: rounded square gradient + س ----
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for dens, s in LEGACY.items():
    d = os.path.join(OUT, f"mipmap-{dens}")
    os.makedirs(d, exist_ok=True)
    big = 512
    ic = gradient(big, GREEN_TOP, GREEN_BOT, radius=int(big * 0.18))
    draw_glyph(ic, big, glyph_ratio=0.60)
    ic = ic.resize((s, s), Image.LANCZOS)
    ic.save(os.path.join(d, "ic_launcher.png"))
    print("legacy", dens, s)

print("DONE")
