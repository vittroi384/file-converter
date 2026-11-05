# 두 번째 검증 그림: v2 기준(사진 데이터로만 정함)을 정한 뒤 처음 만든 그림. 기준을 다시 맞추는 데 쓰지 않는다.
# 실행: python tools/make-chroma-holdout2.py
import os, random
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'bench', 'data', 'chroma-holdout2')
os.makedirs(OUT, exist_ok=True)
random.seed(2026)
def font(sz, bold=False):
    for f in (('malgunbd.ttf' if bold else 'malgun.ttf'), 'arial.ttf'):
        try: return ImageFont.truetype(f, sz)
        except OSError: pass
    return ImageFont.load_default()

# 1) 엑셀 같은 표: 칸마다 연한 색 바탕 + 진한 색 숫자
im = Image.new('RGB', (720, 480), (255, 255, 255)); d = ImageDraw.Draw(im); f = font(13)
for r in range(20):
    for c in range(8):
        bg = random.choice([(255, 255, 255), (226, 239, 218), (252, 228, 214), (221, 235, 247)])
        d.rectangle([c * 90, r * 24, c * 90 + 89, r * 24 + 23], fill=bg, outline=(200, 200, 200))
        d.text((c * 90 + 6, r * 24 + 4), f'{random.randint(-999, 9999):,}', fill=(192, 0, 0) if random.random() < 0.3 else (0, 97, 0), font=f)
im.save(os.path.join(OUT, 'spreadsheet.png'))

# 2) 만화풍: 평평한 색면 + 검은 외곽선 + 색 말풍선 글자
im = Image.new('RGB', (720, 480), (250, 240, 200)); d = ImageDraw.Draw(im)
for _ in range(25):
    x, y, r = random.randrange(720), random.randrange(480), random.randrange(20, 80)
    d.ellipse([x - r, y - r, x + r, y + r], fill=random.choice([(240, 90, 90), (90, 180, 240), (120, 210, 120), (250, 200, 60)]), outline=(20, 20, 20), width=3)
d.text((40, 400), '와! 색이 번지면 안 돼!', fill=(220, 30, 120), font=font(34, True))
im.save(os.path.join(OUT, 'comic.png'))

# 3) 로고: 채도 높은 바탕에 다른 색 글자
im = Image.new('RGB', (720, 480), (0, 82, 204)); d = ImageDraw.Draw(im)
d.text((60, 160), 'LocalConvert', fill=(255, 196, 0), font=font(80, True))
d.text((64, 280), '파일을 어디에도 보내지 않고', fill=(255, 120, 120), font=font(32))
im.save(os.path.join(OUT, 'logo.png'))

# 4) 발표 슬라이드: 흰 바탕 색 글머리표·강조 글자
im = Image.new('RGB', (720, 480), (255, 255, 255)); d = ImageDraw.Draw(im)
d.text((40, 30), '2분기 결과', fill=(30, 30, 30), font=font(36, True))
for i, (c, t) in enumerate([((0, 112, 192), '매출 12% 증가'), ((192, 0, 0), '비용 3% 감소'), ((0, 150, 80), '신규 고객 1,204명'), ((112, 48, 160), '재방문율 41%')]):
    d.ellipse([50, 110 + i * 80, 66, 126 + i * 80], fill=c)
    d.text((84, 100 + i * 80), t, fill=c, font=font(28))
im.save(os.path.join(OUT, 'slide.png'))
print('ok', sorted(os.listdir(OUT)))
