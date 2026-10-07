"""第三轮：终点拱门重画。他的意见：黑白的线太生硬。
候选：暖色（米色 + 赭红）方格旗布两张、红金条纹旗布两张（pixflux），再把原来的 arch-c1 的黑白方格换成暖色做对照。
结果在 out/r3/。"""
from __future__ import annotations

import colorsys

from PIL import Image

import pixellab

OUT = pixellab.ART / "out" / "r3"
JOBS = [
    ("arch-check", "a wooden finish line arch gate made of two carved wooden posts and a crossbeam, a cloth banner with a soft cream and terracotta checkered pattern hanging from the beam, warm desert colors, gentle shading, front view, symmetrical", (811, 812)),
    ("arch-stripe", "a wooden finish line arch gate made of two carved wooden posts and a crossbeam, a long cloth banner with red and gold stripes and tassels hanging from the beam, warm desert colors, gentle shading, front view, symmetrical", (821, 822)),
]


def recolor_c1() -> None:
    """原来的 arch-c1：黑格换成深赭，白格换成米色，保留明暗。"""
    image = Image.open(pixellab.ART / "out/r2/props/arch-c1.png").convert("RGBA")
    px = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if s < 0.12:  # 只动黑白灰（方格），木头是有颜色的
                if l > 0.55:
                    nr, ng, nb = colorsys.hls_to_rgb(40 / 360, 0.80 + (l - 0.55) * 0.2, 0.55)
                else:
                    nr, ng, nb = colorsys.hls_to_rgb(14 / 360, 0.22 + l * 0.35, 0.55)
                px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    image.save(OUT / "arch-warm-c1.png")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    recolor_c1()
    for name, prompt, seeds in JOBS:
        for seed in seeds:
            pixellab.generate_image(f"{name}-c{seed % 10}", {
                "description": prompt,
                "image_size": {"width": 128, "height": 96},
                "no_background": True,
                "outline": "single color black outline",
                "seed": seed,
            }, OUT)
        print(name, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
