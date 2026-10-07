"""生成选图画廊：out/gallery.json + out/gallery.html。可以反复运行，生成过程中随时刷新。
本地查看：python -m http.server 8766 --directory art/out，然后打开 http://localhost:8766/gallery.html"""
from __future__ import annotations

import json
import shutil
import time

import pixellab

ART = pixellab.ART
OUT = ART / "out"


def files(prefix: str, folder: str = "style/ground") -> list[str]:
    return sorted(p.relative_to(OUT).as_posix() for p in (OUT / folder).glob(f"{prefix}-c[0-9].png"))


def image_item(item_id: str, title: str, note: str, sources: list[tuple[str, str, str]], recommended: str | None, **extra) -> dict:
    """sources: (候选编号, 图片路径, 说明)"""
    return {
        "id": item_id, "title": title, "note": note, "kind": "image", **extra,
        "candidates": [{"id": cid, "src": src, "label": label, **({"recommended": True} if cid == recommended else {})} for cid, src, label in sources],
    }


def round1() -> dict:
    camel_note = ("每只骆驼 8 个朝向，转地图时按视角自动换。每行从左到右：正面、右前、右、右后、背面、左后、左、左前"
                  "（左边三张用右边的水平翻转，保证左右一致）。\n选定后按这个画风出 5 只赛驼和 2 只疯骆驼，再给每个朝向做走路动画。")
    camels = [
        ("A", "style/strips/camelA-red.png", "红棕色整只上色（模型画成了双峰）"),
        ("A2", "style/strips/camelA2-red.png", "想要「漆成深红的木头玩具」，出来还是写实毛色、双峰"),
        ("B", "style/strips/camelB-red.png", "沙色单峰骆驼 + 队色鞍毯和流苏：颜色靠鞍毯区分"),
        ("C", "style/strips/camelC-red.png", "Q 版大头（棕色、双峰）"),
    ]
    tiles = [(f"{p.split('/')[-1][:-4]}", p, "") for p in files("tile") + files("tile2")]
    labels = {"tile-c3": "现在截图里用的这张：自带小砖纹，看不出一格一格", "tile2-c2": "单块石板、深色描边，格子之间分得清"}
    tiles = [(cid, src, labels.get(cid, "")) for cid, src, _ in tiles]
    boos = [(p.split('/')[-1][:-4], p, "") for p in files("boo") + files("boo2")]
    return {
        "round": "r1",
        "title": "沙丘赛驼 · 第一轮：定画风",
        "updated": time.strftime("%m-%d %H:%M"),
        "spent": pixellab.spent_usd(),
        "intro": ("规则引擎、服务器、2.5D 赛道都已经能玩了（截图是本地真实对局）。这一轮先定画风，定了再批量出全套。\n"
                  "每项点「选这张」，或者「都不满意，重画」并写备注。最后把页面底部那段文字复制给我。\n"
                  "最后两项是规格书没写清楚的规则，我先按「推荐」做了，你确认或改。"),
        "preview": [{"src": "style/shots/board-placeholder.png",
                     "caption": "现在的样子：骆驼暂时用一只红鞍毯样张加滤镜变色（所以颜色怪），赛道格是 tile-c3。拖动旋转、上下拖调角度、滚轮缩放。"},
                    {"src": "style/walk/walkB-east.gif",
                     "caption": "走路动画样张（B 画风朝右，8 帧）。骆驼在赛道上移动时播放，8 个朝向各做一套。"}],
        "items": [
            image_item("camel", "骆驼画风", camel_note, camels, "B", wide=True, scale=2),
            {"id": "crazy", "title": "疯骆驼（黑、白）长什么样", "kind": "choice",
             "note": "疯骆驼逆着跑、不参与排名，最好一眼看出和赛驼不一样。",
             "candidates": [
                 {"id": "1", "label": "一只黑毛、一只白毛的骆驼，不披鞍毯，样子邋遢一点", "recommended": True},
                 {"id": "2", "label": "和赛驼一样的沙色骆驼，只是披黑 / 白鞍毯"},
             ]},
            image_item("tile", "赛道格", "16 格每格一张，格号叠在左上角。", tiles, "tile2-c2"),
            image_item("sand", "赛道外的沙地", "整块地面重复铺。", [(p.split('/')[-1][:-4], p, "") for p in files("sand")], "sand-c2", scale=2),
            image_item("brick", "金字塔砖面", "金字塔是立体的（四个面），这张贴在面上重复铺。第一次的提示词画成了门洞，这两张是重画的。",
                       [(p.split('/')[-1][:-4], p, "") for p in files("brick2")], "brick2-c2"),
            image_item("cheer", "观众板 · 欢呼面（+1 格）", "立在格子上的一小群观众，骆驼停上来时会跳起来。", [(p.split('/')[-1][:-4], p, "") for p in files("cheer")], "cheer-c3"),
            image_item("boo", "观众板 · 嘘面（−1 格）", "这 6 张都不太像在喝倒彩（boo2-c1 竖的其实是大拇指）。\n我的建议：先定欢呼那张，再用 PixelLab 的局部修改把它改成「同一群人竖倒拇指、皱眉」，两面风格一致。同意就选「都不满意，重画」。", boos, None),
            {"id": "rule-flip", "title": "规则：观众板能不能原地翻面", "kind": "choice",
             "note": "规格书写的是「把它移到另一个合法格子并重新选朝向」，没说能不能留在原格只翻面。原样放回（同格同面）无论哪种都不允许，否则等于跳过回合。",
             "candidates": [
                 {"id": "可以", "label": "可以：同一格换个朝向也算一次行动（现在的做法）", "recommended": True},
                 {"id": "不可以", "label": "不可以：必须移到另一格"},
             ]},
            {"id": "rule-clamp", "title": "规则：终局下注扣钱、不够付时怎么算", "kind": "choice",
             "note": "规格书只规定了赛段结算「金币 = max(0, 原金币 + 本次净额)」。终局两个牌堆没说。\n例：0 金的玩家在冠军牌堆先押错一张（−1）、后押对一张（+5）。逐张算得 5；按牌堆算净额得 4。",
             "candidates": [
                 {"id": "按牌堆", "label": "冠军、垫底牌堆各算一次净额，不够付到 0（和赛段结算一致，现在的做法）", "recommended": True},
                 {"id": "逐张", "label": "逐张翻开逐张结算，像实体游戏一样，没钱时那张白扣"},
                 {"id": "合起来", "label": "两个牌堆合起来算一次净额"},
             ]},
        ],
    }


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "gallery.json").write_text(json.dumps(round1(), ensure_ascii=False, indent=1))
    shutil.copyfile(ART / "gallery.html", OUT / "gallery.html")
    print("gallery ok, spent", round(pixellab.spent_usd(), 4))
