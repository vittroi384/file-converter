"""Flate 사진 판별 '검증' 세트(기준을 photo-detect.ts에 고정한 **뒤에** 만듦. 기준 세트와 출처가 다르다).
1) python -I bench/make-flate-holdout.py photos   → picsum.photos(Unsplash 사진) 30장 받아 사진 세트 + 섞인 화면용 사진
2) node bench/make-flate-holdout-shots.mjs        → Edge 화면 캡처(그림 세트)
3) python -I bench/make-flate-holdout.py variants → 캡처 일부의 축소·JPEG·잡음판, 사진 위 글자(애매 세트)
결과: bench/data/pdf-flate/holdout/{photo,graphic,ambiguous}/*.png"""
import io, json, pathlib, sys, urllib.request
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path('bench/data/pdf-flate')
SRC, H = ROOT / 'holdout-src', ROOT / 'holdout'
DL = SRC / 'dl'  # 받은 파일(신뢰 안 함)은 따로
for d in (DL, H / 'photo', H / 'graphic', H / 'ambiguous'): d.mkdir(parents=True, exist_ok=True)

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'bench'}), timeout=60) as r: return r.read()

if sys.argv[1] == 'photos':
    # 목록 2쪽의 앞 31개를 고르지 않고 그대로(사진 골라내기 없음). 마지막 1장은 섞인 화면·애매 세트용
    ids = [x['id'] for x in json.loads(get('https://picsum.photos/v2/list?page=2&limit=31'))]
    for k, i in enumerate(ids):
        f = DL / f'{i}.jpg'
        if not f.exists(): f.write_bytes(get(f'https://picsum.photos/id/{i}/1600/1200'))
        im = Image.open(f).convert('RGB')
        if k == 30: im.resize((1000, 750), Image.LANCZOS).save(SRC / 'news.png'); continue
        if k % 2 == 0: im = im.resize((1000, 750), Image.LANCZOS)  # 절반은 줄여서(JPEG 흔적이 옅어진다), 절반은 받은 크기 그대로
        im.save(H / 'photo' / f'picsum-{i}.png')
        if k % 5 == 0: im.convert('L').convert('RGB').save(H / 'photo' / f'gray-picsum-{i}.png')
    print('photos', len(list((H / 'photo').glob('*.png'))))

elif sys.argv[1] == 'variants':
    G = H / 'graphic'
    def jpegged(im, q):
        b = io.BytesIO(); im.save(b, 'JPEG', quality=q); return Image.open(io.BytesIO(b.getvalue())).convert('RGB')
    for name in ('article@1x', 'wiki@1x', 'dashboard@1x', 'code@1x', 'invoice@1x', 'mobile-chat@3x'):
        im = Image.open(G / f'{name}.png').convert('RGB')
        im.resize((im.width * 2 // 3, im.height * 2 // 3), Image.LANCZOS).save(G / f'{name}-small.png')
        jpegged(im, 75).save(G / f'{name}-jpeg75.png')
        Image.blend(im, Image.merge('RGB', [Image.effect_noise(im.size, 50)] * 3), 0.08).save(G / f'{name}-noise.png')
    # 사진 위 글자(밈·표지): 어느 쪽도 정답이 아니라 따로 센다
    im = Image.open(SRC / 'news.png').convert('RGB'); d = ImageDraw.Draw(im)
    d.text((40, 40), 'SUMMER SALE 50%', font=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 72), fill='white')
    d.text((40, 640), '가을 신상품 안내 — 11월 30일까지', font=ImageFont.truetype('C:/Windows/Fonts/malgunbd.ttf', 36), fill=(255, 230, 0))
    im.save(H / 'ambiguous' / 'photo-poster.png')
    print('graphic', len(list(G.glob('*.png'))))
