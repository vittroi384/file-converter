"""Flate 사진 판별 '기준 정하기' 세트(검증 세트는 따로, 기준을 정한 뒤에 만든다: make-flate-holdout.py).
실행: python bench/make-flate-calib.py → bench/data/pdf-flate/calib/{photo,graphic}/*.png
사진: Kodak 22장 + 그 회색판 6장 + 절반 축소 6장 + Unsplash 한 장에서 자른 4장.
그림: 기존 색 시험 그림 11장(bench/data/chroma*) + 여기서 그린 글자·도표·화면 그림(축소판·JPEG 거친 판 포함)."""
import io, pathlib, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = pathlib.Path('bench/data/pdf-flate/calib')
P, G = ROOT / 'photo', ROOT / 'graphic'
for d in (P, G): d.mkdir(parents=True, exist_ok=True)
F = 'C:/Windows/Fonts/'
def font(name, size):
    return ImageFont.truetype(F + name, size)
rnd = random.Random(1)
WORDS = ('the quick brown fox jumps over lazy dog report quarterly revenue growth table figure section results method data '
         '분기 매출 보고서 결과 표 그림 방법 자료 요약 회의 일정 담당 확인').split()
def sentence(n): return ' '.join(rnd.choice(WORDS) for _ in range(n))

# ── 사진 ──
kodak = sorted(pathlib.Path('bench/data/kodak').glob('*.png'))
for f in kodak: Image.open(f).convert('RGB').save(P / f.name)
for f in kodak[::4]: Image.open(f).convert('L').convert('RGB').save(P / f'gray-{f.name}')
for f in kodak[1::4]:
    im = Image.open(f).convert('RGB'); im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(P / f'half-{f.name}')
u = Image.open('bench/data/assets/unsplash-l50OANxqQXE.jpg').convert('RGB')
for k, (x, y, s) in enumerate([(0, 0, 1600), (1800, 1200, 1200), (500, 2000, 1400), (2600, 300, 1000)]):
    u.crop((x, y, x + s, y + s)).resize((800, 800), Image.LANCZOS).save(P / f'unsplash-{k}.png')

# ── 그림 ──
for d in ('chroma', 'chroma-holdout', 'chroma-holdout2'):
    for f in pathlib.Path('bench/data', d).glob('*.png'): Image.open(f).convert('RGB').save(G / f'{d}-{f.name}')

def doc_page(w=900, h=1200, fnt='arial.ttf', size=16, bg='white', fg='black'):
    im = Image.new('RGB', (w, h), bg); dr = ImageDraw.Draw(im)
    y = 40
    dr.text((40, y), sentence(5).title(), font=font('arialbd.ttf', size + 10), fill=fg); y += size * 3
    while y < h - 60:
        if rnd.random() < 0.1: y += size; dr.text((40, y), sentence(4), font=font('arialbd.ttf', size + 4), fill=fg); y += size * 2
        dr.text((40, y), sentence(12), font=font(fnt, size), fill=fg); y += int(size * 1.5)
    return im

def code_page(w=1000, h=700):
    im = Image.new('RGB', (w, h), (30, 30, 30)); dr = ImageDraw.Draw(im)
    dr.rectangle((0, 0, 48, h), fill=(37, 37, 38))
    cols = [(86, 156, 214), (206, 145, 120), (220, 220, 170), (156, 220, 254), (106, 153, 85), (212, 212, 212)]
    for i, y in enumerate(range(10, h - 20, 20)):
        dr.text((8, y), f'{i + 1:3d}', font=font('consola.ttf', 14), fill=(133, 133, 133))
        x = 60 + 16 * rnd.randint(0, 4)
        for _ in range(rnd.randint(1, 6)):
            wd = rnd.choice(['const', 'return', 'await', 'value', '"text"', 'fn(x)', '// note', '=>', 'if', '{']); c = rnd.choice(cols)
            dr.text((x, y), wd, font=font('consola.ttf', 14), fill=c); x += 9 * (len(wd) + 1)
    return im

def chart(w=900, h=600, kind='bar'):
    im = Image.new('RGB', (w, h), 'white'); dr = ImageDraw.Draw(im)
    dr.text((w // 2 - 100, 15), 'Monthly revenue', font=font('arialbd.ttf', 20), fill='black')
    for k in range(6):
        y = 80 + k * 80; dr.line((70, y, w - 30, y), fill=(220, 220, 220)); dr.text((20, y - 8), str(500 - k * 100), font=font('arial.ttf', 13), fill=(80, 80, 80))
    pal = [(31, 119, 180), (255, 127, 14), (44, 160, 44), (214, 39, 40)]
    n = 12
    vals = [[rnd.randint(60, 440) for _ in range(n)] for _ in range(3)]
    for s in range(3 if kind == 'line' else 2):
        pts = []
        for i in range(n):
            x = 90 + i * (w - 140) // n; v = vals[s][i]
            if kind == 'bar': dr.rectangle((x + s * 22, 480 - v, x + s * 22 + 20, 480), fill=pal[s])
            pts.append((x + 15, 480 - v))
        if kind == 'line': dr.line(pts, fill=pal[s], width=3)
    for i in range(n): dr.text((90 + i * (w - 140) // n, 490), f'M{i + 1}', font=font('arial.ttf', 12), fill='black')
    return im

def ui(w=1100, h=750, dark=False):
    bg, fg, card = ((24, 26, 31), (230, 230, 230), (40, 43, 50)) if dark else ((246, 247, 249), (30, 30, 30), (255, 255, 255))
    im = Image.new('RGB', (w, h), bg); dr = ImageDraw.Draw(im)
    dr.rectangle((0, 0, w, 56), fill=(37, 99, 235)); dr.text((20, 16), 'Dashboard  설정  보고서', font=font('malgun.ttf', 18), fill='white')
    for r in range(2):
        for c in range(3):
            x, y = 30 + c * 350, 90 + r * 320
            dr.rounded_rectangle((x, y, x + 320, y + 290), 14, fill=card, outline=(210, 210, 215))
            dr.text((x + 18, y + 16), sentence(3), font=font('malgun.ttf', 16), fill=fg)
            for k in range(6): dr.text((x + 18, y + 56 + k * 26), sentence(5)[:34], font=font('malgun.ttf', 13), fill=fg)
            dr.rounded_rectangle((x + 18, y + 230, x + 140, y + 268), 8, fill=(37, 99, 235)); dr.text((x + 40, y + 238), 'Open', font=font('arialbd.ttf', 15), fill='white')
    return im

def gradient(w=1000, h=600, diag=False, text=True):
    im = Image.new('RGB', (w, h)); px = im.load()
    for y in range(h):
        for x in range(w):
            t = ((x + y) / (w + h)) if diag else y / h
            px[x, y] = (int(20 + 120 * t), int(40 + 60 * t), int(120 + 100 * (1 - t)))
    if text:
        dr = ImageDraw.Draw(im)
        dr.text((60, 200), '2026 사업 계획', font=font('malgunbd.ttf', 64), fill='white')
        dr.text((60, 300), sentence(8), font=font('arial.ttf', 26), fill=(230, 230, 255))
    return im

def sheet(w=1000, h=700):
    im = Image.new('RGB', (w, h), 'white'); dr = ImageDraw.Draw(im)
    for c in range(9): dr.line((c * 110, 0, c * 110, h), fill=(208, 215, 229))
    for r in range(0, h, 24):
        dr.line((0, r, w, r), fill=(208, 215, 229))
        for c in range(9): dr.text((c * 110 + 4, r + 5), str(rnd.randint(0, 99999)) if r else f'Col {c}', font=font('calibri.ttf', 14), fill='black')
    return im

def mixed(w=1000, h=900, photo=kodak[3]):
    im = doc_page(w, h, size=15); ph = Image.open(photo).convert('RGB').resize((w - 80, (w - 80) * 2 // 3))
    im.paste(ph, (40, 120)); return im

def jpegged(im, q):
    b = io.BytesIO(); im.save(b, 'JPEG', quality=q); return Image.open(io.BytesIO(b.getvalue())).convert('RGB')

def binarized_scan(w=1000, h=1300):
    im = doc_page(w, h, fnt='georgia.ttf', size=18).convert('L')
    noise = Image.effect_noise((w, h), 25); im = Image.blend(im, noise, 0.15)
    return im.point(lambda v: 255 if v > 140 else 0).convert('RGB')

gs = {
    'doc-arial': doc_page(), 'doc-georgia': doc_page(fnt='georgia.ttf', size=14), 'doc-batang': doc_page(fnt='batang.ttc', size=15),
    'doc-small': doc_page(1240, 1754, size=11), 'code': code_page(), 'bar': chart(), 'line': chart(kind='line'),
    'ui-light': ui(), 'ui-dark': ui(dark=True), 'slide-vgrad': gradient(), 'slide-dgrad': gradient(diag=True),
    'sheet': sheet(), 'mixed-doc-photo': mixed(), 'binarized-scan': binarized_scan(),
}
extra = {}
for k in ('doc-arial', 'code', 'ui-light', 'bar', 'slide-dgrad'):
    im = gs[k]; extra[f'{k}-half'] = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
for k in ('doc-georgia', 'ui-dark', 'line'):
    extra[f'{k}-jpeg85'] = jpegged(gs[k], 85)
extra['doc-blur'] = gs['doc-batang'].filter(ImageFilter.GaussianBlur(0.8))
# 같은 색 바탕이 깨진 어려운 그림: 잡음·강한 JPEG·디더링 그라디언트·사진 위 글자
def noisy(im, s):  # 회색 잡음을 6% 섞는다(스캔·저가 카메라 캡처 흉내)
    return Image.blend(im, Image.merge('RGB', [Image.effect_noise(im.size, s)] * 3), 0.06)
extra['doc-noise'] = noisy(gs['doc-arial'], 40)
extra['ui-noise'] = noisy(gs['ui-light'], 40)
extra['doc-jpeg50'] = jpegged(gs['doc-arial'], 50)
extra['ui-light-jpeg60'] = jpegged(gs['ui-light'], 60)
dith = gradient(diag=True, text=False).convert('P', palette=Image.ADAPTIVE, colors=64).convert('RGB')
d = ImageDraw.Draw(dith); d.text((60, 220), 'Quarterly Review', font=font('arialbd.ttf', 60), fill='white'); d.text((60, 320), sentence(8), font=font('arial.ttf', 24), fill='white')
extra['slide-dither'] = dith
cap = Image.open(kodak[10]).convert('RGB'); d = ImageDraw.Draw(cap)
d.text((30, 30), '제주 여행 2026', font=font('malgunbd.ttf', 48), fill='white'); d.text((30, 420), sentence(6), font=font('arial.ttf', 22), fill='yellow')
(ROOT / 'ambiguous').mkdir(exist_ok=True); cap.save(ROOT / 'ambiguous' / 'photo-with-caption.png')  # 사진 위 글자: 어느 쪽도 정답이 아님(따로 보고)
for k, im in {**gs, **extra}.items(): im.save(G / f'{k}.png')
print('photo', len(list(P.glob('*.png'))), 'graphic', len(list(G.glob('*.png'))))
