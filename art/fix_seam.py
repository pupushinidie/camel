"""远景做成能横向无缝重复的一张图：把原图左右对调（原来的两条边缘挪到正中相接），
再用 bitforge 只重画中间那一列，让沙丘自然地连起来。天上只有一个太阳。
结果在 out/r2/seam/，挑好的那张由 props.py 导出。"""
from __future__ import annotations

import sys

from PIL import Image, ImageDraw

import pixellab

OUT = pixellab.ART / "out" / "r2" / "seam"
OUT.mkdir(parents=True, exist_ok=True)
source = Image.open(pixellab.ART / "out/r2/props/backdrop-c2.png").convert("RGBA")
rolled = Image.new("RGBA", source.size)
rolled.paste(source.crop((200, 0, 400, 200)), (0, 0))
rolled.paste(source.crop((0, 0, 200, 200)), (200, 0))
rolled.save(OUT / "rolled.png")
window = rolled.crop((100, 0, 300, 200))
window.save(OUT / "window.png")
mask = Image.new("RGB", (200, 200), "black")
ImageDraw.Draw(mask).rectangle((44, 84, 155, 199), fill="white")  # 接缝在窗口 x=100
mask.save(OUT / "mask.png")
for seed in [int(s) for s in sys.argv[1:]] or [611, 612, 613]:
    name = f"roll-c{seed % 10}"
    pixellab.generate_image(name, {
        "description": "desert sand dunes at sunset, a large dune ridge on the left sloping gently down toward low rolling dunes on the right, warm red, orange and maroon sand, distant haze",
        "image_size": {"width": 200, "height": 200},
        "inpainting_image": pixellab.b64_image(OUT / "window.png"),
        "mask_image": pixellab.b64_image(OUT / "mask.png"),
        "no_background": False,
        "seed": seed,
    }, OUT, endpoint="/create-image-bitforge")
    full = rolled.copy()
    full.paste(Image.open(OUT / f"{name}.png").convert("RGBA"), (100, 0))
    full.save(OUT / f"{name}-full.png")
print("spent", round(pixellab.spent_usd(), 4))
