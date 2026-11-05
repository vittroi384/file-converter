# PDF 첫 페이지를 PyMuPDF로 그려, 원본 JPEG를 Pillow가 EXIF대로 바로 세운 그림과 비교한다(e2e에서 호출).
# 출력: {"ok": bool, "diff": 평균 차이, "size": [...]}  — 빨강·파랑 사각형 위치가 맞으면 차이가 작다.
import json, sys
import pymupdf as fitz
from PIL import Image, ImageOps, ImageChops, ImageStat

pdf, jpg = sys.argv[1], sys.argv[2]
truth = ImageOps.exif_transpose(Image.open(jpg)).convert('RGB')
page = fitz.open(pdf)[0]
pix = page.get_pixmap(matrix=fitz.Matrix(truth.width / page.rect.width, truth.height / page.rect.height))
got = Image.frombytes('RGB', (pix.width, pix.height), pix.samples).resize(truth.size)
diff = sum(ImageStat.Stat(ImageChops.difference(got, truth)).mean) / 3
# 뒤집혔다면 큰 색 사각형이 엇갈려 평균 차이가 커진다(같은 그림이면 JPEG 손실 정도만)
print(json.dumps({'ok': diff < 8, 'diff': round(diff, 2), 'size': [pix.width, pix.height]}))
