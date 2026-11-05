// 사진인지 판별(화면 캡처·글자·도표는 아님). Flate 사진을 JPEG로 바꿀지 정할 때 쓴다.
// 틀려서 비싼 쪽은 '글자를 사진으로' → 애매하면 사진이 아니라고 본다.
// 줄을 띄엄띄엄(최대 약 256줄) 골라 그 줄과 바로 아랫줄만 본다 → 큰 스캔도 몇 ms.

export interface PhotoFeatures {
  eq: number; // 이웃 화소(가로·세로)가 완전히 같은 비율. 그림·글자는 넓은 같은 색 바탕 → 높다
  hard: number; // 이웃 밝기 차이가 아주 큰(≥ 96) 비율. 글자·선 테두리
  top: number; // 밝기를 16칸으로 나눴을 때 가장 많은 칸의 비율. 문서는 잡음이 있어도 바탕(흰색) 한 칸에 몰린다
}

type Img = { width: number; height: number; data: ArrayLike<number> };

export function photoFeatures(img: Img): PhotoFeatures {
  const { width: w, height: h, data: d } = img;
  const rowStep = Math.max(1, Math.floor((h - 1) / 256));
  const colStep = Math.max(1, Math.floor(w / 1024)); // 아주 넓은 사진은 가로도 띄엄띄엄(짝은 바로 옆·아래 화소)
  const luma = (i: number) => 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  const hist = new Uint32Array(16);
  let pairs = 0, eq = 0, hard = 0, n = 0;
  for (let y = 0; y + 1 < h; y += rowStep) {
    for (let x = 0; x < w; x += colStep) {
      const i = (y * w + x) * 4;
      const li = luma(i);
      hist[li >> 4]!++; n++;
      for (let k = x + 1 < w ? 0 : 1; k < 2; k++) {
        const j = k === 0 ? i + 4 : i + w * 4;
        pairs++;
        if (d[i] === d[j] && d[i + 1] === d[j + 1] && d[i + 2] === d[j + 2]) eq++;
        else if (Math.abs(li - luma(j)) >= 96) hard++;
      }
    }
  }
  return { eq: eq / Math.max(1, pairs), hard: hard / Math.max(1, pairs), top: Math.max(...hist) / Math.max(1, n) };
}

// 기준(bench/data/pdf-flate/calib: 사진 38장·그림 39장에서 정함. 검증은 그 뒤 만든 다른 출처의 세트로: bench/make-flate-holdout.py, bench/flate-classify.ts)
// 사진 최댓값 eq 0.185 · top 0.502 · hard 0.0202 에 여유를 두고 자른다. 그림은 셋 중 하나 이상에서 걸린다.
export const PHOTO_LIMITS = { eq: 0.25, top: 0.6, hard: 0.03 };

export function isPhoto(img: Img): boolean {
  if (img.width < 64 || img.height < 64) return false; // 너무 작으면 판단 근거가 적고 줄어들 것도 없다
  const f = photoFeatures(img);
  return f.eq < PHOTO_LIMITS.eq && f.top < PHOTO_LIMITS.top && f.hard < PHOTO_LIMITS.hard;
}
