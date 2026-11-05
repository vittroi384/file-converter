"""PWA 아이콘 생성. 실행: python tools/make-icons.py apps/web/public/icons"""
import sys, math, pathlib
from PIL import Image, ImageDraw
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)

def icon(size, maskable=False):
    s = size * 4  # 4배로 그리고 줄여서 가장자리를 부드럽게
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    grad = Image.new('RGBA', (s, s))
    px = grad.load()
    a, b = (59, 91, 253), (109, 74, 255)
    for y in range(s):
        for x in range(s):
            t = (x + y) / (2 * s)
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)
    mask = Image.new('L', (s, s), 0)
    r = 0 if maskable else int(s * 0.22)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    c, rad, w = s / 2, s * (0.20 if maskable else 0.25), int(s * 0.055)
    # 두 개의 반원 화살표(변환). PIL 각도는 3시 방향에서 시계 방향.
    for start, end in ((200, 335), (20, 155)):
        d.arc([c - rad, c - rad, c + rad, c + rad], start, end, fill='white', width=w)
        t = math.radians(end)
        p = (c + rad * math.cos(t), c + rad * math.sin(t))
        tan = (-math.sin(t), math.cos(t))   # 시계 방향 진행 방향
        nor = (math.cos(t), math.sin(t))    # 바깥쪽
        h, half = s * 0.11, s * 0.075
        tip = (p[0] + tan[0] * h, p[1] + tan[1] * h)
        d.polygon([tip, (p[0] + nor[0] * half, p[1] + nor[1] * half), (p[0] - nor[0] * half, p[1] - nor[1] * half)], fill='white')
    return img.resize((size, size), Image.LANCZOS)

icon(192).save(out / 'icon-192.png')
icon(512).save(out / 'icon-512.png')
icon(512, maskable=True).save(out / 'icon-maskable-512.png')
icon(180, maskable=True).convert('RGB').save(out / 'apple-touch-icon.png')
icon(48).save(out / 'favicon-48.png')
print('ok')
