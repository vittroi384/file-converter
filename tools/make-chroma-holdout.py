# 색 번짐 '처음 보는' 검증 그림(기준값 0.05를 정할 때 쓰지 않은 그림). 실행: python tools/make-chroma-holdout.py
import os, math, random
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'bench', 'data', 'chroma-holdout')
os.makedirs(OUT, exist_ok=True)
random.seed(7)
def font(sz):
    for f in ('consola.ttf', 'malgun.ttf', 'arial.ttf'):
        try: return ImageFont.truetype(f, sz)
        except OSError: pass
    return ImageFont.load_default()

# 1) 어두운 테마 코드 편집기
im = Image.new('RGB', (720, 480), (30, 31, 34)); d = ImageDraw.Draw(im); f = font(15)
cols = [(204, 120, 50), (106, 171, 115), (152, 118, 170), (104, 151, 187), (187, 181, 41), (169, 183, 198)]
for i in range(26):
    x = 12
    for w in ['const', f'v{i}', '=', 'await', 'fetch(', f'"/api/{i}"', ');']:
        d.text((x, 8 + i * 18), w, fill=random.choice(cols), font=f); x += 9 * len(w) + 8
im.save(os.path.join(OUT, 'code-dark.png'))

# 2) 지도: 베이지 바탕 색 도로·작은 지명
im = Image.new('RGB', (720, 480), (242, 236, 222)); d = ImageDraw.Draw(im); f = font(12)
for _ in range(40):
    x, y = random.randrange(720), random.randrange(480)
    d.line([(x, y), (x + random.randrange(-300, 300), y + random.randrange(-200, 200))], fill=random.choice([(230, 140, 40), (250, 200, 60), (90, 150, 220)]), width=random.choice([1, 2, 3]))
for _ in range(30):
    d.text((random.randrange(680), random.randrange(470)), random.choice(['역삼', '서초', 'Gangnam', 'Park', '시청']), fill=(70, 70, 160), font=f)
im.save(os.path.join(OUT, 'map.png'))

# 3) 막대 차트 + 작은 색 범례 글자
im = Image.new('RGB', (720, 480), (255, 255, 255)); d = ImageDraw.Draw(im); f = font(11)
pal = [(31, 119, 180), (255, 127, 14), (44, 160, 44), (214, 39, 40), (148, 103, 189)]
for i in range(30):
    h = random.randrange(40, 380); c = pal[i % 5]
    d.rectangle([20 + i * 23, 440 - h, 36 + i * 23, 440], fill=c)
    d.text((18 + i * 23, 444), f'{i}', fill=c, font=f)
for j, c in enumerate(pal): d.text((560, 20 + j * 16), f'계열 {j} series', fill=c, font=f)
im.save(os.path.join(OUT, 'bar-chart.png'))

# 4) 부드러운 그라데이션(사진 같은 바탕) 위 색 글자(밈·썸네일)
im = Image.new('RGB', (720, 480)); px = im.load()
for y in range(480):
    for x in range(720):
        px[x, y] = (int(120 + 60 * math.sin(x / 90)), int(110 + 50 * math.cos(y / 70)), int(140 + 40 * math.sin((x + y) / 120)))
d = ImageDraw.Draw(im); f = font(30)
for i, c in enumerate([(255, 40, 40), (40, 220, 255), (255, 230, 0), (255, 60, 200)]):
    d.text((30, 40 + i * 100), '오늘의 할인 SALE 50%', fill=c, font=f)
im.save(os.path.join(OUT, 'gradient-text.png'))
print('ok', sorted(os.listdir(OUT)))
