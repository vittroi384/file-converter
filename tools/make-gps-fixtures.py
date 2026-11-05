# 위치 정보(GPS)가 든 시험 사진: JPEG(세로 회전 6 포함), PNG(eXIf), WebP(EXIF+XMP).
# 결과 파일에 GPS가 남는지 보는 시험용. 실행: python tools/make-gps-fixtures.py
import io, json, os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'e2e', 'fixtures', 'gps')
os.makedirs(OUT, exist_ok=True)

def exif(orientation=1):
    e = Image.Exif()
    e[0x010F] = 'LEAKCAM'        # Make: 결과에 남으면 안 되는 표식
    e[0x0112] = orientation
    gps = {1: 'N', 2: (37.0, 33.0, 59.0), 3: 'E', 4: (126.0, 58.0, 40.0), 0x1C: b'ASCII\0\0\0SECRETPLACE'}
    e[0x8825] = gps               # GPS IFD
    return e

# 가로 160×100 그림: 왼쪽 위 빨강, 오른쪽 아래 파랑(회전 확인용)
img = Image.new('RGB', (160, 100), (240, 240, 240))
d = ImageDraw.Draw(img)
d.rectangle([0, 0, 40, 30], fill=(220, 30, 30))
d.rectangle([120, 70, 159, 99], fill=(30, 30, 220))

XMP = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="37,33.98N"/></rdf:RDF></x:xmpmeta>'
img.save(os.path.join(OUT, 'gps.jpg'), 'JPEG', quality=60, exif=exif(1).tobytes())
for o in (3, 6, 8):
    img.save(os.path.join(OUT, f'gps-rot{o}.jpg'), 'JPEG', quality=60, exif=exif(o).tobytes())
img.save(os.path.join(OUT, 'gps.png'), 'PNG', exif=exif(1).tobytes())
img.save(os.path.join(OUT, 'gps.webp'), 'WEBP', quality=60, exif=exif(1).tobytes(), xmp=XMP)

# 정답: 똑바로 세운 크기
json.dump({'gps.jpg': [160, 100], 'gps-rot3.jpg': [160, 100], 'gps-rot6.jpg': [100, 160], 'gps-rot8.jpg': [100, 160], 'gps.png': [160, 100], 'gps.webp': [160, 100]}, open(os.path.join(OUT, 'expected.json'), 'w'))
for f in sorted(os.listdir(OUT)):
    b = open(os.path.join(OUT, f), 'rb').read()
    print(f, len(b), 'LEAKCAM' if b'LEAKCAM' in b else '', 'SECRETPLACE' if b'SECRETPLACE' in b else '', 'XMP-GPS' if b'GPSLatitude' in b else '')
