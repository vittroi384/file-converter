"""큰 파일 측정용(저장소에 넣지 않음, bench/data/large). 실행: python tools/make-large-fixtures.py <Kodak 폴더> <출력 폴더>"""
import sys, pathlib, io
from PIL import Image
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
kodak = sorted(src.glob('*.png'))
def tile(w, h, seed=0):
    """Kodak 사진을 이어 붙여 실제 사진 같은 큰 이미지(단순 확대는 압축이 너무 잘 돼서 비현실적)"""
    im = Image.new('RGB', (w, h))
    i = seed
    for y in range(0, h, 512):
        for x in range(0, w, 768):
            im.paste(Image.open(kodak[i % len(kodak)]).convert('RGB'), (x, y)); i += 1
    return im
big = tile(8640, 5760)  # 약 5000만 화소
big.save(out / 'photo-50mp.jpg', quality=92)
twelve = [tile(4000, 3000, s) for s in range(4)]
for k in range(100):
    twelve[k % 4].save(out / f'batch-{k:03d}.jpg', quality=88)
# 200쪽 스캔 PDF(쪽마다 A4 300dpi 사진)
pages = [tile(2480, 3508, s).convert('RGB') for s in range(3)]
pages[0].save(out / 'scan-200p.pdf', save_all=True, append_images=[pages[(i + 1) % 3] for i in range(199)], resolution=300, quality=85)
for f in sorted(out.iterdir())[:3] + [out / 'photo-50mp.jpg', out / 'scan-200p.pdf']:
    print(f.name, round(f.stat().st_size / 1e6, 1), 'MB')
