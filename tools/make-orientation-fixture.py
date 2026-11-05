"""EXIF 회전 교차 검증용 JPEG. 정답은 Pillow의 exif_transpose 결과(내 회전 코드와 독립).
실행: python tools/make-orientation-fixture.py e2e/fixtures"""
import sys, json, pathlib
from PIL import Image, ImageDraw, ImageOps

out = pathlib.Path(sys.argv[1])
# 가로 300 × 세로 200, 왼쪽 위에 빨간 사각형 표식
im = Image.new('RGB', (300, 200), (230, 230, 230))
ImageDraw.Draw(im).rectangle([0, 0, 59, 39], fill=(220, 20, 20))
exif = Image.Exif()
exif[0x0112] = 6  # 시계 방향 90° 돌려서 봐야 하는 사진(폰 세로 촬영과 같은 경우)
im.save(out / 'rotated-exif6.jpg', quality=95, exif=exif)

upright = ImageOps.exif_transpose(Image.open(out / 'rotated-exif6.jpg'))
w, h = upright.size
# 빨간 표식이 어느 모서리로 갔는지
corners = {'tl': (5, 5), 'tr': (w - 6, 5), 'bl': (5, h - 6), 'br': (w - 6, h - 6)}
red = [k for k, (x, y) in corners.items() if upright.getpixel((x, y))[0] > 150 and upright.getpixel((x, y))[1] < 100]
(out / 'rotated-exif6.json').write_text(json.dumps({'width': w, 'height': h, 'redCorner': red[0]}))
print(w, h, red)
