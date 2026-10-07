"""把选定的场景装饰、地面贴图、远景和界面小图导出到 apps/web/public/art，尺寸写进 src/decor-sprites.json。

选择记在 selection.json（他在画廊里定的 + 我推荐、他还没看过的）。
- 装饰立牌、拱门：裁掉透明边，底边就是落地点。
- 远景：fix_seam.py 已经把原图左右对调、重画了中间的接缝，导出的这张可以横向无缝重复（天上只有一个太阳）。
- 下注票：骆驼剪影按队色换色，每色一张。

用法：python props.py
"""
from __future__ import annotations

import colorsys
import json

from PIL import Image

import pixellab
from camels import TEAM

ART = pixellab.ART
OUT = ART / "out"
WEB = ART.parent / "apps/web/public/art"
SIZES = ART.parent / "apps/web/src/decor-sprites.json"
SELECTION = json.loads((ART / "selection.json").read_text())


def source(key: str) -> Image.Image:
    """selection.json 里记的是 out/ 下的相对路径。"""
    return Image.open(OUT / SELECTION[key]).convert("RGBA")


def cropped(image: Image.Image) -> Image.Image:
    box = image.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    return image.crop(box) if box else image


# 下注票上骆驼剪影的队色（剪影在米色票面上，要够深才看得清）
TICKET_INK = {"red": (2, 0.68, 0.42), "yellow": (42, 0.92, 0.44), "blue": (214, 0.68, 0.42), "green": (120, 0.55, 0.34), "purple": (276, 0.52, 0.44)}


def tint_ticket(image: Image.Image, team: str) -> Image.Image:
    """把票面上的暗红骆驼剪影换成队色；边框是低饱和的粉褐色，不动。"""
    out = image.copy()
    px = out.load()
    hue, saturation, lightness = TICKET_INK[team]
    r2, g2, b2 = (round(c * 255) for c in colorsys.hls_to_rgb(hue / 360, lightness, saturation))
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if (h * 360 >= 340 or h * 360 <= 20) and s > 0.3 and l < 0.35:
                px[x, y] = (r2, g2, b2, a)
    return out


def backdrop() -> None:
    image = source("backdrop")
    image.save(WEB / "ground/backdrop.png", optimize=True)
    print("远景最上面一行的颜色", "#%02x%02x%02x" % image.getpixel((0, 0))[:3], "尺寸", image.size)


def main() -> None:
    sizes: dict[str, dict[str, int]] = {}
    (WEB / "decor").mkdir(parents=True, exist_ok=True)
    (WEB / "ui").mkdir(parents=True, exist_ok=True)
    for kind in ["palm", "shrub", "rocks", "tent", "stand", "flag", "brazier", "obelisk", "arch"]:
        image = cropped(source(kind))
        image.save(WEB / f"decor/{kind}.png", optimize=True)
        sizes[kind] = {"width": image.width, "height": image.height}
    for key, target in [("tile", "ground/tile.png"), ("sand", "ground/sand.png"), ("brick", "ground/brick.png"),
                        ("strata", "ground/strata.png"), ("cheer", "spectators/cheer.png"), ("boo", "spectators/boo.png")]:
        source(key).save(WEB / target, optimize=True)
    backdrop()
    for key in ["coin", "pyramid-ticket", "card-back", "partner"]:
        cropped(source(key)).save(WEB / f"ui/{key}.png", optimize=True)
    source("hero").save(WEB / "ui/hero.png", optimize=True)
    ticket = cropped(source("ticket"))
    for team in TEAM:
        tint_ticket(ticket, team).save(WEB / f"ui/ticket-{team}.png", optimize=True)
    SIZES.write_text(json.dumps(sizes, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(sizes, ensure_ascii=False))


if __name__ == "__main__":
    main()
