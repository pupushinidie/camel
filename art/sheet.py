"""把 8 方向角色拼成一行预览图：python sheet.py <目录> <输出.png> [放大倍数]"""
import sys, pathlib
from PIL import Image
DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west']
folder = pathlib.Path(sys.argv[1]); out = sys.argv[2]; s = int(sys.argv[3]) if len(sys.argv) > 3 else 3
name = folder.name
ims = [Image.open(folder / f'{name}-{d}.png').convert('RGBA') for d in DIRS]
w, h = ims[0].size
sheet = Image.new('RGBA', (w * s * 8, h * s), (235, 215, 170, 255))
for i, im in enumerate(ims):
    sheet.alpha_composite(im.resize((w * s, h * s), Image.NEAREST), (i * w * s, 0))
sheet.save(out)
