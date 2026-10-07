"""把 PixelLab 8 方向角色导出到网页用的目录：public/art/camels/<名字>/<方向>.png。

PixelLab v3 返回的方向名和画面对不上：标 south-east 的那张其实正对镜头（south），
south-east / east / north-east / north 依次在 east / north-east / north / north-west 里；
朝左的几张（标 south、west、south-west）互相重复，没有真正朝左后方的。
所以只取朝右的 5 张（正面、右前、右、右后、背面），朝左的 3 张用朝右的水平翻转：
左右对称，转到任何角度都不会突然换一只骆驼。
每批导出后都用 sheet.py 拼一行肉眼核对：正面 → 右前 → 右 → 右后 → 背面 → 左后 → 左 → 左前。
用法：python export_camel.py <out 下的角色目录> <导出名>
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image

import pixellab

DIRECTIONS = pixellab.DIRECTIONS  # south, south-east, east, north-east, north, north-west, west, south-west
WEB = pixellab.ART.parent / "apps/web/public/art/camels"


# 画面实际朝向 → PixelLab 给的方向名
SOURCE = {"south": "south-east", "south-east": "east", "east": "north-east", "north-east": "north", "north": "north-west"}
# 朝左的方向 → 翻转哪一张
MIRROR = {"south-west": "south-east", "west": "east", "north-west": "north-east"}


def export(folder: pathlib.Path, name: str) -> None:
    target = WEB / name
    target.mkdir(parents=True, exist_ok=True)
    for direction, label in SOURCE.items():
        Image.open(folder / f"{folder.name}-{label}.png").save(target / f"{direction}.png")
    for direction, source in MIRROR.items():
        Image.open(target / f"{source}.png").transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(target / f"{direction}.png")


if __name__ == "__main__":
    export(pathlib.Path(sys.argv[1]), sys.argv[2])
