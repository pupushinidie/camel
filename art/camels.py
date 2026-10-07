"""把骆驼导出成网页用的精灵图：apps/web/public/art/camels/<骆驼>/{still,walk}.png + src/camel-sprites.json。

- 静止图（still.png）：一行 8 格，顺序同 DIRECTIONS（正面 south 开始逆时针）。
- 走路（walk.png）：8 行（方向）× N 列（帧）。没做好的方向用静止图顶上。
- PixelLab 的方向名和画面差一位，只取朝右半边 5 个方向，朝左 3 个用水平翻转（见 export_camel.py）。
- 走路动画的画布是 88×88，静止图是 64×64：用动画第 0 帧（就是那张静止图）找出偏移，统一放进 88×88，
  再按所有帧的并集裁边：脚底贴住画布底边，左右以画布中心对称（翻转后不会错位）。
- 5 只赛驼共用底骆驼 B 的图，只把鞍毯、笼头、流苏的红色换成队色（像实体游戏里一模一样的骆驼棋子）。
- 黑、白两只疯骆驼是单独生成的角色（黑毛、白毛，不披鞍毯）。

用法：python camels.py
"""
from __future__ import annotations

import colorsys
import json
import pathlib

from PIL import Image

import pixellab
from export_camel import MIRROR, SOURCE

ART = pixellab.ART
OUT = ART / "out"
WEB = ART.parent / "apps/web/public/art/camels"
MANIFEST = ART.parent / "apps/web/src/camel-sprites.json"
DIRECTIONS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]
CANVAS = 88

# 每只骆驼的来源：静止图目录（PixelLab 原始命名），以及每个实际方向的走路帧目录和文件前缀
SOURCES = {
    "base": {
        "still": OUT / "style/camelB-red",
        "walk": {
            "east": (OUT / "style/walk", "walkB-east-north-east"),
            "south": (OUT / "r2/base-walk", "base-walk-south-south-east"),
            "south-east": (OUT / "r2/base-walk", "base-walk-south-east-east"),
            "north-east": (OUT / "r2/base-walk", "base-walk-north-east-north"),
            "north": (OUT / "r2/base-walk", "base-walk-north-north-west"),
        },
    },
}
# 疯骆驼：第二轮选的黑 s11、白 s11，各自的走路动画在 out/r2/<名字>-walk/
for _crazy, _folder in [("black", "crazy-black-s11"), ("white", "crazy-white-s11")]:
    SOURCES[_crazy] = {
        "still": OUT / "r2" / _folder,
        "walk": {actual: (OUT / "r2" / f"{_folder}-walk", f"{_folder}-walk-{actual}-{label}") for actual, label in SOURCE.items()},
    }

# 队色：鞍毯像素按亮度映射到目标色的一段亮度区间
TEAM = {
    "red": None,  # 原样
    "yellow": (46, 0.86, (0.26, 0.72)),
    "blue": (214, 0.70, (0.16, 0.60)),
    "green": (118, 0.58, (0.15, 0.56)),
    "purple": (276, 0.58, (0.17, 0.60)),
}
SADDLE_LIGHTNESS = (0.14, 0.52)  # 原图鞍毯红色的亮度范围


def is_saddle(r: int, g: int, b: int) -> bool:
    """鞍毯、笼头、流苏：色相在红区（345°–12°）且饱和度 > 0.55；骆驼毛色的暗红褐阴影饱和度更低，不算。"""
    h, _, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    hue = h * 360
    return (hue >= 345 or hue <= 12) and s > 0.55


def recolor(image: Image.Image, team: str) -> Image.Image:
    spec = TEAM[team]
    if spec is None:
        return image.copy()
    hue, saturation, (low, high) = spec
    src_low, src_high = SADDLE_LIGHTNESS
    out = image.copy()
    px = out.load()
    cache: dict[tuple[int, int, int], tuple[int, int, int]] = {}
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0 or not is_saddle(r, g, b):
                continue
            key = (r, g, b)
            if key not in cache:
                _, l, _ = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
                t = min(1.0, max(0.0, (l - src_low) / (src_high - src_low)))
                nr, ng, nb = colorsys.hls_to_rgb(hue / 360, low + t * (high - low), saturation)
                cache[key] = (round(nr * 255), round(ng * 255), round(nb * 255))
            px[x, y] = (*cache[key], a)
    return out


def find_offset(still: Image.Image, frame: Image.Image) -> tuple[int, int]:
    """静止图（64×64）在动画画布（88×88）里的位置：比对不透明像素，找完全对得上的偏移。"""
    best, best_score = (12, 12), -1
    s = still.load()
    f = frame.load()
    opaque = [(x, y) for y in range(still.height) for x in range(still.width) if s[x, y][3] > 0]
    for oy in range(frame.height - still.height + 1):
        for ox in range(frame.width - still.width + 1):
            score = sum(1 for x, y in opaque if f[x + ox, y + oy][:3] == s[x, y][:3] and f[x + ox, y + oy][3] > 0)
            if score > best_score:
                best, best_score = (ox, oy), score
    return best


def load_still(folder: pathlib.Path, actual: str) -> Image.Image:
    if actual in SOURCE:
        return Image.open(folder / f"{folder.name}-{SOURCE[actual]}.png").convert("RGBA")
    return load_still(folder, MIRROR[actual]).transpose(Image.Transpose.FLIP_LEFT_RIGHT)


def build(name: str) -> dict:
    """返回 {stills: {方向: 88×88}, walk: {方向: [88×88 帧]}}，已经按朝向翻转好。"""
    spec = SOURCES[name]
    stills64 = {d: load_still(spec["still"], d) for d in DIRECTIONS}
    stills: dict[str, Image.Image] = {}
    walk: dict[str, list[Image.Image]] = {}
    for actual in ["south", "south-east", "east", "north-east", "north"]:
        folder, prefix = spec["walk"].get(actual, (None, None))
        frames = sorted(folder.glob(f"{prefix}-[0-9][0-9].png")) if folder else []
        canvas = Image.new("RGBA", (CANVAS, CANVAS))
        if frames:
            images = [Image.open(p).convert("RGBA") for p in frames]
            ox, oy = find_offset(stills64[actual], images[0])
            canvas.alpha_composite(stills64[actual], (ox, oy))
            # 第 0 帧是静止图本身，循环用后面生成的帧
            walk[actual] = images[1:]
        else:
            canvas.alpha_composite(stills64[actual], ((CANVAS - 64) // 2, (CANVAS - 64) // 2))
        stills[actual] = canvas
    for left, right in MIRROR.items():
        stills[left] = stills[right].transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        if right in walk:
            walk[left] = [frame.transpose(Image.Transpose.FLIP_LEFT_RIGHT) for frame in walk[right]]
    return {"stills": stills, "walk": walk}


def crop_box(images: list[Image.Image]) -> tuple[int, int, int, int]:
    """所有帧不透明像素的并集；左右按画布中心对称扩展。"""
    left, top, right, bottom = CANVAS, CANVAS, 0, 0
    for image in images:
        box = image.getbbox()
        if not box:
            continue
        left, top, right, bottom = min(left, box[0]), min(top, box[1]), max(right, box[2]), max(bottom, box[3])
    half = max(CANVAS // 2 - left, right - CANVAS // 2)
    return CANVAS // 2 - half, top, CANVAS // 2 + half, bottom


def export(camel: str, frames: dict, box: tuple[int, int, int, int], transform=lambda image: image) -> dict:
    target = WEB / camel
    target.mkdir(parents=True, exist_ok=True)
    width, height = box[2] - box[0], box[3] - box[1]
    still = Image.new("RGBA", (width * 8, height))
    for index, direction in enumerate(DIRECTIONS):
        still.alpha_composite(transform(frames["stills"][direction].crop(box)), (index * width, 0))
    still.save(target / "still.png", optimize=True)
    entry: dict = {"width": width, "height": height}
    count = max((len(v) for v in frames["walk"].values()), default=0)
    if count:
        walk = Image.new("RGBA", (width * count, height * 8))
        for row, direction in enumerate(DIRECTIONS):
            sequence = frames["walk"].get(direction) or [frames["stills"][direction]] * count
            for column in range(count):
                walk.alpha_composite(transform(sequence[column % len(sequence)].crop(box)), (column * width, row * height))
        walk.save(target / "walk.png", optimize=True)
        entry["walkFrames"] = count
        entry["walkDirections"] = [d for d in DIRECTIONS if d in frames["walk"]]
    return entry


def main() -> None:
    manifest: dict = {}
    base = build("base")
    box = crop_box(list(base["stills"].values()) + [f for seq in base["walk"].values() for f in seq])
    for team in TEAM:
        manifest[team] = export(team, base, box, lambda image, team=team: recolor(image, team))
    for crazy in ["black", "white"]:
        frames = build(crazy)
        manifest[crazy] = export(crazy, frames, crop_box(list(frames["stills"].values()) + [f for seq in frames["walk"].values() for f in seq]))
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
