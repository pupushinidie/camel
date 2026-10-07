"""第一轮风格样张（地面和道具，pixflux 同步出图）。结果在 out/style/ground/。"""
from __future__ import annotations

import sys

import pixellab

OUT = pixellab.ART / "out" / "style" / "ground"

ITEMS = {
    # 赛道格：俯视的砂岩石板
    "tile": ("top-down view of a single square sandstone paving slab, warm beige stone with small cracks and worn edges, game tile, flat lighting, fills the whole image", 64, 64),
    # 赛道外的沙地
    "sand": ("top-down view of smooth golden desert sand with soft wind ripples and a few tiny pebbles, seamless texture, fills the whole image", 128, 128),
    # 金字塔的砖面（做成 CSS 立体金字塔的四个面）
    "brick": ("front view of an ancient egyptian pyramid wall made of large sandstone blocks in staggered rows, warm sunlit, texture fills the whole image", 64, 64),
    # 观众板：欢呼的小人群立牌 / 喝倒彩的小人群立牌
    "cheer": ("a small group of three desert villagers in colorful robes cheering with raised arms, standing on a small wooden sign base, full body, side view", 64, 64),
    "boo": ("a small group of three grumpy desert villagers in dark robes booing with thumbs down, standing on a small wooden sign base, full body, side view", 64, 64),
}


def make(name: str, seed: int) -> None:
    prompt, w, h = ITEMS[name]
    body = {
        "description": prompt,
        "image_size": {"width": w, "height": h},
        "no_background": name in ("cheer", "boo"),
        "outline": "single color black outline" if name in ("cheer", "boo") else "lineless",
        "seed": seed,
    }
    pixellab.generate_image(f"{name}-c{seed % 10}", body, OUT)


if __name__ == "__main__":
    names = sys.argv[1:] or list(ITEMS)
    for name in names:
        for seed in (101, 102, 103):
            make(name, seed)
        print(name, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
