"""第一轮风格样张：骆驼（8 方向）、赛道地面、金字塔。结果在 out/style/。
用法：python style_test.py <样张名> [...]，不带参数跑全部。"""
from __future__ import annotations

import sys
import pathlib

import pixellab

OUT = pixellab.ART / "out" / "style"

CAMELS = {
    # A：桌游木头棋子那样整只涂成队色
    "camelA-red": "a racing camel painted solid bright red all over like a wooden board game piece, one hump, chunky simple shape, cute",
    # B：真实沙色骆驼，披队色鞍毯和头饰
    "camelB-red": "a sandy tan dromedary (single hump) racing camel wearing a bright red saddle blanket and red head tassels, one hump",
    # C：Q 版大头
    "camelC-red": "a cute chibi dromedary racing camel with big head and short legs, red fur, single hump, cartoon",
    # A2：A 的单峰、更饱和版本
    "camelA2-red": "a dromedary racing camel with a single hump, painted glossy saturated crimson red all over like a lacquered wooden toy, simple chunky shape",
}


def camel(name: str, prompt: str, seed: int = 11) -> None:
    pixellab.create_character(name, {
        "description": prompt,
        "image_size": {"width": 64, "height": 64},
        "view": "low top-down",
        "template_id": "horse",
        "seed": seed,
        "no_background": True,
        "outline": "single color black outline",
        "detail": "medium detail",
    }, OUT / name)


if __name__ == "__main__":
    names = sys.argv[1:] or list(CAMELS)
    for name in names:
        if name in CAMELS:
            camel(name, CAMELS[name])
            print(name, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
