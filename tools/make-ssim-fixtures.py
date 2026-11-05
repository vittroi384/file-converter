"""SSIM 교차 검증용 기준 데이터 생성(scikit-image 값이 정답).
실행: python tools/make-ssim-fixtures.py <출력 폴더>   (scikit-image, pillow, numpy 필요)"""
import io, json, sys, pathlib
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from skimage.metrics import structural_similarity

out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(42)

def synth(w=256, h=192):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.zeros((h, w, 3), np.float32)
    img[..., 0] = 120 + 80 * np.sin(x / 23) * np.cos(y / 31)
    img[..., 1] = 100 + 0.4 * x + 30 * np.sin((x + y) / 9)
    img[..., 2] = 160 - 0.5 * y
    # 여러 크기 노이즈(질감)
    for s in (4, 16, 48):
        n = rng.normal(0, 18, (h // s + 2, w // s + 2, 3)).astype(np.float32)
        n = np.array(Image.fromarray(n[..., 0]).resize((w + 2 * s, h + 2 * s), Image.BICUBIC))[:h, :w]
        img += n[..., None]
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)  # 날카로운 경계
    d.rectangle([30, 30, 90, 80], outline=(255, 255, 255), width=3)
    d.ellipse([150, 60, 230, 150], fill=(20, 20, 40))
    d.line([0, 180, 256, 100], fill=(250, 220, 0), width=2)
    return im

def gray(im):
    a = np.asarray(im.convert('RGB'), np.float64)
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]

ref = synth()
ref.save(out / 'ref.png')
variants = {}
for q in (95, 80, 60, 30, 10):
    b = io.BytesIO(); ref.save(b, 'JPEG', quality=q); variants[f'jpeg{q}'] = Image.open(b).convert('RGB')
variants['blur'] = ref.filter(ImageFilter.GaussianBlur(1.2))
noisy = np.clip(np.asarray(ref, np.float32) + rng.normal(0, 12, (192, 256, 3)), 0, 255).astype(np.uint8)
variants['noise'] = Image.fromarray(noisy)

g0 = gray(ref)
result = {}
for k, im in variants.items():
    im.save(out / f'{k}.png')
    s = structural_similarity(g0, gray(im), data_range=255, gaussian_weights=True, sigma=1.5, use_sample_covariance=False)
    result[k] = round(float(s), 6)
(out / 'expected.json').write_text(json.dumps(result, indent=1))
print(result)
