# 색 번짐 시험 그림: 밝기 차이는 작고 색 차이가 큰 가는 선·글자(4:2:0 색 줄이기에 약한 그림).
# 실행: python tools/make-chroma-fixtures.py → bench/data/chroma/*.png
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'bench', 'data', 'chroma')
os.makedirs(OUT, exist_ok=True)
W, H = 640, 480
try:
    font = ImageFont.truetype('malgunbd.ttf', 22)
except OSError:
    font = ImageFont.load_default()

# 1) 회색 바탕 빨간·파란 글자(밝기가 바탕과 비슷하게 고른 색)
im = Image.new('RGB', (W, H), (150, 150, 150))
d = ImageDraw.Draw(im)
for i, y in enumerate(range(10, H - 20, 30)):
    d.text((12, y), 'Chroma bleed 색 번짐 TEST 0123456789 ' * 2, fill=(225, 80, 80) if i % 2 == 0 else (60, 120, 255), font=font)
im.save(os.path.join(OUT, 'text-isoluminant.png'))

# 2) 1·2px 빨강/초록 줄무늬(밝기 비슷)
im = Image.new('RGB', (W, H))
px = im.load()
for y in range(H):
    for x in range(W):
        band = (x // (1 if y < H // 2 else 2)) % 2
        px[x, y] = (200, 90, 90) if band else (70, 150, 70)
im.save(os.path.join(OUT, 'stripes-red-green.png'))

# 3) 표·차트 같은 화면 캡처: 흰 바탕 색 글자·얇은 색 선
im = Image.new('RGB', (W, H), (255, 255, 255))
d = ImageDraw.Draw(im)
for i in range(12):
    c = [(220, 20, 60), (0, 128, 0), (30, 60, 220), (200, 120, 0)][i % 4]
    d.line([(20, 30 + i * 36), (W - 20, 60 + i * 30)], fill=c, width=2)
    d.text((24, 36 + i * 36), f'Series {i}: 매출 {i * 137}만', fill=c, font=font)
im.save(os.path.join(OUT, 'chart-capture.png'))
print('ok', sorted(os.listdir(OUT)))
