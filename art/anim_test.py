"""走路动画样张：B 样张朝右（PixelLab 标签 north-east）。"""
import sys
import pixellab
from export_camel import SOURCE
OUT = pixellab.ART / "out" / "style" / "walk"
character_id = "89454d14-e682-4f82-b47b-4aade0ae2a87"
actual = sys.argv[1] if len(sys.argv) > 1 else "east"
frames = pixellab.animate_character(f"walkB-{actual}", {
    "character_id": character_id,
    "mode": "v3",
    "action_description": "camel walking forward at a steady pace, legs stepping in a natural gait, head bobbing slightly",
    "frame_count": 8,
    "directions": [SOURCE[actual]],
}, OUT)
print({k: len(v) for k, v in frames.items()}, "spent", round(pixellab.spent_usd(), 4))
