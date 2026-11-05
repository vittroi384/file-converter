"""e2e 테스트용 파일 생성. 실행: python tools/make-e2e-fixtures.py <Kodak 폴더> <출력 폴더>  (pillow, pillow-heif)"""
import sys, pathlib
from PIL import Image, ImageDraw
import pillow_heif
pillow_heif.register_heif_opener()
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
a = Image.open(src / 'kodim05.png').convert('RGB')
b = Image.open(src / 'kodim14.png').convert('RGB')
a.save(out / 'photo.jpg', quality=95)
# 투명 배경 PNG
t = Image.new('RGBA', (300, 200), (0, 0, 0, 0)); d = ImageDraw.Draw(t)
d.ellipse([20, 20, 180, 180], fill=(59, 91, 253, 255)); d.rectangle([150, 60, 280, 140], fill=(255, 120, 0, 160))
t.save(out / 'transparent.png')
# 스캔본 같은 PDF: 큰 사진 2쪽(Pillow는 RGB를 DCTDecode JPEG로 넣는다)
big = [im.resize((im.width * 3, im.height * 3), Image.LANCZOS) for im in (a, b)]
big[0].save(out / 'scan.pdf', save_all=True, append_images=big[1:], resolution=150, quality=95)
small = Image.new('RGB', (400, 300), (240, 240, 240)); ImageDraw.Draw(small).rectangle([50, 50, 350, 250], outline=(0, 0, 0), width=4)
small.save(out / 'one-page.pdf')
# 아이폰 형식
a.save(out / 'iphone.heic', quality=80)
# 엑셀 한국어 CSV(EUC-KR)
(out / 'excel-korean.csv').write_bytes('이름,전화,점수\n김철수,01012345678,90\n이영희,01098765432,85.5\n'.encode('euc-kr'))
(out / 'icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#3b5bfd"/><circle cx="60" cy="60" r="30" fill="#fff"/></svg>')
print('ok')
