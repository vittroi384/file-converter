"""Flate → JPEG 결과가 실제 PDF 엔진(MuPDF)에서 제대로 그려지는지: 전·후 PDF를 쪽마다 그려 평균 차이를 본다.
실행: node bench/flate-pdf-demo.ts 다음 python bench/flate-render-check.py
그대로 둔 쪽은 0, 바뀐 사진 쪽은 JPEG 손실만큼(작은 값), 색 공간·크기·회색 처리가 틀리면 크게 튄다."""
import glob
import numpy as np, pymupdf
for before in sorted(glob.glob('bench/out/flate-*-before.pdf')):
    a, b = pymupdf.open(before), pymupdf.open(before.replace('-before', '-after'))
    assert len(a) == len(b)
    rows = []
    for i in range(len(a)):
        pa, pb = (d[i].get_pixmap(dpi=72) for d in (a, b))
        x = np.frombuffer(pa.samples, np.uint8).astype(float); y = np.frombuffer(pb.samples, np.uint8).astype(float)
        rows.append(f'p{i + 1} {pa.width}x{pa.height} n{pa.n}/{pb.n} 평균차 {np.abs(x - y).mean():.2f} 최대 {np.abs(x - y).max():.0f}')
    print(before.split('flate-')[1].replace('-before.pdf', ''), '|', ' | '.join(rows))
