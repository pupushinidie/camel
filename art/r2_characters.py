"""第二轮 A 队列：疯骆驼候选（黑、白各 2 个），底骆驼 B 另外 4 个朝向的走路动画。
结果在 out/r2/。按顺序一个一个跑（试用套餐同时只能跑一个后台任务）。"""
from __future__ import annotations

import json
import sys

import pixellab
from export_camel import SOURCE

OUT = pixellab.ART / "out" / "r2"
BASE_CAMEL = "89454d14-e682-4f82-b47b-4aade0ae2a87"  # 第一轮选定的 B（红鞍毯）
WALK = "camel walking forward at a steady pace, legs stepping in a natural gait, head bobbing slightly"

CRAZY = {
    "crazy-black": "a scruffy wild dromedary camel with shaggy jet black fur, single hump, no saddle, no harness, messy tufts of hair, crazed wide eyes",
    "crazy-white": "a scruffy wild dromedary camel with shaggy pale white fur, single hump, no saddle, no harness, messy tufts of hair, crazed wide eyes",
}


def crazy(name: str, seed: int) -> None:
    pixellab.create_character(f"{name}-s{seed}", {
        "description": CRAZY[name],
        "image_size": {"width": 64, "height": 64},
        "view": "low top-down",
        "template_id": "horse",
        "seed": seed,
        "no_background": True,
        "outline": "single color black outline",
        "detail": "medium detail",
    }, OUT / f"{name}-s{seed}")


def walk(character_id: str, name: str, actual: str) -> None:
    pixellab.animate_character(f"{name}-walk-{actual}", {
        "character_id": character_id,
        "mode": "v3",
        "action_description": WALK,
        "frame_count": 8,
        "directions": [SOURCE[actual]],
    }, OUT / f"{name}-walk")


if __name__ == "__main__":
    steps = sys.argv[1:] or ["crazy", "walk-base"]
    if steps == ["crazy-walk"]:
        steps = []
    if "crazy" in steps:
        for name in CRAZY:
            for seed in (11, 23):
                crazy(name, seed)
                print(name, seed, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
    if "walk-base" in steps:
        # east 第一轮已经做过（out/style/walk），这里补另外 4 个朝右半边的方向
        for actual in ["south", "south-east", "north-east", "north"]:
            walk(BASE_CAMEL, "base", actual)
            print("base walk", actual, "done; spent", round(pixellab.spent_usd(), 4), flush=True)


def crazy_walks() -> None:
    """选定的两只疯骆驼（黑 s11、白 s11）各做朝右半边 5 个方向的走路动画。"""
    for name in ["crazy-black-s11", "crazy-white-s11"]:
        meta = json.loads((OUT / name / f"{name}.json").read_text())
        for actual in ["south", "south-east", "east", "north-east", "north"]:
            walk(meta["character_id"], name, actual)
            print(name, "walk", actual, "done; spent", round(pixellab.spent_usd(), 4), flush=True)


if __name__ == "__main__" and "crazy-walk" in sys.argv[1:]:
    crazy_walks()
