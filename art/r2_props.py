"""第二轮 B 队列：场景装饰、远景、界面小图（pixflux 同步出图）。结果在 out/r2/props/。"""
from __future__ import annotations

import sys

import pixellab

OUT = pixellab.ART / "out" / "r2" / "props"

# 名字: (提示词, 宽, 高, 透明背景, 种子们)
ITEMS: dict[str, tuple[str, int, int, bool, tuple[int, ...]]] = {
    "backdrop": ("wide panoramic desert landscape at golden hour sunset, rolling sand dunes in the distance, two far away pyramids as silhouettes on the horizon, warm orange and purple sky with a few long clouds, low sun near the horizon, side view, no people", 400, 200, False, (401, 402, 403)),
    "palm": ("a single tall date palm tree with lush green fronds and a slightly curved ringed trunk, full height from roots to crown, side view", 64, 96, True, (411, 412, 413)),
    "shrub": ("a small clump of dry desert shrubs and tufts of golden grass", 48, 32, True, (421, 422)),
    "rocks": ("a small cluster of weathered sandstone desert rocks and boulders", 64, 48, True, (431, 432)),
    "tent": ("a bedouin desert tent with red and cream stripes, open entrance flap, wooden poles, side view", 96, 64, True, (441, 442)),
    "stand": ("a small wooden grandstand with a red and white striped canopy and a cheering crowd of desert villagers waving, side view", 128, 80, True, (451, 452)),
    "flag": ("a tall wooden pole with a long red triangular pennant flag waving in the wind", 32, 80, True, (461, 462)),
    "brazier": ("a standing bronze brazier on three legs with a burning orange fire", 32, 48, True, (471, 472)),
    "arch": ("a wooden finish line arch gate made of two tall posts and a crossbeam with a black and white checkered banner hanging from it, front view, symmetrical", 128, 96, True, (481, 482, 483)),
    "obelisk": ("a small ancient egyptian sandstone obelisk with carved hieroglyphs and a golden tip", 32, 96, True, (491, 492)),
    "strata": ("side view cross-section of desert ground, horizontal layers of sandstone strata in warm orange, tan and brown bands with small pebbles, texture fills the whole image", 128, 64, False, (501, 502)),
    "coin": ("a single shiny gold coin with an embossed camel on it, front view, game icon", 32, 32, True, (511, 512, 513)),
    "pyramid-ticket": ("a small golden pyramid shaped token with a carved eye, game icon", 32, 32, True, (521, 522)),
    "ticket": ("a blank vertical paper betting ticket with an ornate border and a camel silhouette stamp in the middle, flat front view, game card", 48, 64, True, (531, 532, 533)),
    "card-back": ("the back of a playing card with an ornate golden pyramid and rising sun pattern on dark blue, golden border, flat front view", 48, 64, False, (541, 542)),
    "partner": ("a small card with two hands shaking, flat front view, game icon", 48, 48, True, (551, 552)),
    "hero": ("a lively camel race around a great pyramid at sunset, several camels with colorful saddles running on a sand track, a cheering crowd under striped canopies, palm trees, warm golden light", 400, 224, False, (561, 562, 563)),
}


def make(name: str, seed: int) -> None:
    prompt, width, height, transparent, _ = ITEMS[name]
    pixellab.generate_image(f"{name}-c{seed % 10}", {
        "description": prompt,
        "image_size": {"width": width, "height": height},
        "no_background": transparent,
        "outline": "single color black outline" if transparent else "lineless",
        "seed": seed,
    }, OUT)


if __name__ == "__main__":
    for name in sys.argv[1:] or list(ITEMS):
        for seed in ITEMS[name][4]:
            make(name, seed)
        print(name, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
