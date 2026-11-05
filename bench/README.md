# bench

`bench/data`의 `kodak`·`pdf-flate`·`assets`·`large`는 용량·재배포 문제로 저장소에 넣지 않는다. 다시 만드는 방법:

- `kodak`: Kodak Lossless True Color Image Suite(https://r0k.us/graphics/kodak/)의 `kodim02~22.png`·`kodim24.png`를 받아 둔다.
- `assets/unsplash-l50OANxqQXE.jpg`: https://unsplash.com/photos/l50OANxqQXE (Unsplash License). `tools/make-demo.ts`가 쓴다.
- `pdf-flate/calib`: `python bench/make-flate-calib.py` (kodak·assets 필요). `pdf-flate/holdout`: `bench/make-flate-holdout.py` 첫머리의 세 단계.
- `large`: `python tools/make-large-fixtures.py bench/data/kodak bench/data/large`.
