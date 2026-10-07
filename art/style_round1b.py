"""第一轮补充：单块石板的赛道格、真正在喝倒彩的观众。"""
import pixellab
OUT = pixellab.ART / "out" / "style" / "ground"
JOBS = [
    ("tile2", "top-down view of one single large square sandstone slab with beveled darker edges and a few small cracks, one stone only, fills the whole image", 64, False, (301, 302, 303)),
    ("boo2", "three grumpy desert villagers in dark robes booing angrily, giving thumbs down and shaking fists, frowning faces, standing together on a small wooden sign base, full body, side view", 64, True, (311, 312, 313)),
]
for name, prompt, size, transparent, seeds in JOBS:
    for seed in seeds:
        pixellab.generate_image(f"{name}-c{seed % 10}", {
            "description": prompt,
            "image_size": {"width": size, "height": size},
            "no_background": transparent,
            "outline": "single color black outline" if transparent else "lineless",
            "seed": seed,
        }, OUT)
    print(name, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
