// 스마트 압축: 목표 SSIM 이상인 결과 중 가장 작은 파일을 찾는 품질 탐색.
// 인코더를 직접 부르지 않고 evaluate(q)만 받는다 → 브라우저와 정답표 벤치에서 같은 코드를 쓴다.

export interface Probe {
  q: number;
  bytes: number;
  ssim: number;
}
export type Evaluate = (q: number) => Promise<Probe>;

export interface SearchOptions {
  target: number; // 목표 SSIM
  qMin?: number;
  qMax?: number;
}
export interface SearchResult {
  best: Probe | null; // 목표를 넘은 것 중 가장 작은 것. 없으면 null
  probes: Probe[]; // 실제로 인코딩한 순서
}

// 같은 q를 두 번 인코딩하지 않게 기억
function memo(evaluate: Evaluate) {
  const seen = new Map<number, Probe>();
  const probes: Probe[] = [];
  const ev = async (q: number) => {
    let p = seen.get(q);
    if (!p) { p = await evaluate(q); seen.set(q, p); probes.push(p); }
    return p;
  };
  return { ev, probes };
}

function pickBest(probes: Probe[], target: number): Probe | null {
  let best: Probe | null = null;
  for (const p of probes) if (p.ssim >= target && (!best || p.bytes < best.bytes)) best = p;
  return best;
}

// v1: 정수 이분 탐색. SSIM이 q에 대해 단조 증가한다고 가정.
export async function searchBinary(evaluate: Evaluate, o: SearchOptions): Promise<SearchResult> {
  const { ev, probes } = memo(evaluate);
  let lo = o.qMin ?? 1, hi = o.qMax ?? 100;
  if ((await ev(hi)).ssim < o.target) return { best: pickBest(probes, o.target), probes };
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((await ev(mid)).ssim >= o.target) hi = mid;
    else lo = mid + 1;
  }
  await ev(lo);
  return { best: pickBest(probes, o.target), probes };
}

// v2: 보간 탐색. [L(실패), H(통과)] 구간에서 목표값이 있을 자리를 비례로 찍는다.
// space: 'linear'는 SSIM 그대로, 'log'는 -log(1-SSIM)으로 편 곡선에서 보간(포화 구간이 덜 휜다).
// 보간이 구간을 절반 이상 못 줄이면 다음 한 번은 이분으로 찍는다(최악에도 이분 탐색 수준 보장).
export interface InterpOptions extends SearchOptions {
  space?: 'linear' | 'log';
  guess?: number; // v3: 첫 탐색 품질(예측값). 없으면 가운데
  step?: number; // v3: 예측값 주변을 찌르는 첫 간격(두 배씩 넓힌다)
  tol?: number; // v3: 구간 폭이 이 값 이하면 멈춘다(1이면 정확히)
  slope?: number; // v4: 품질 변화량 / f(SSIM) 변화량(예측표에서). 있으면 첫 시도 뒤 뉴턴식으로 점프
  strictStall?: boolean; // 비교용: v4까지의 정체 판정(한 번만 덜 줄어도 이분)
}
export async function searchInterp(evaluate: Evaluate, o: InterpOptions): Promise<SearchResult> {
  const { ev, probes } = memo(evaluate);
  const f = o.space === 'linear' ? (s: number) => s : (s: number) => -Math.log(Math.max(1e-6, 1 - s));
  const T = f(o.target);
  const qMin = o.qMin ?? 1, qMax = o.qMax ?? 100, tol = Math.max(1, o.tol ?? 1);
  let L = qMin - 1, fL = f(0); // 가상의 실패점(q=0 → SSIM 0)
  let H = qMax + 1, fH = Infinity; // 아직 통과점 모름
  const update = (q: number, p: Probe) => { if (p.ssim >= o.target) { H = q; fH = f(p.ssim); } else { L = q; fL = f(p.ssim); } return p.ssim >= o.target; };
  let q = Math.round(o.guess ?? (qMin + qMax) / 2);
  if (o.guess !== undefined) {
    // 1단계: 예측값에서 시작해 반대쪽 결과가 나올 때까지 바깥으로 넓히며 구간을 잡는다
    q = Math.min(qMax, Math.max(qMin, q));
    const first = await ev(q);
    let passed = update(q, first);
    let d = Math.max(1, Math.round(o.step ?? 4));
    if (o.slope) {
      // v4: 실제로 잰 SSIM과 목표의 차이 × 기울기만큼 한 번에 점프(최소 한 칸은 반대쪽으로)
      const jump = Math.round(o.slope * (T - f(first.ssim)));
      d = Math.max(1, Math.abs(jump) + 1); // +1: 반대쪽을 확실히 넘기 위한 여유
    }
    for (;;) {
      const next = passed ? Math.max(qMin, H - d) : Math.min(qMax, L + d);
      if (next === q) break; // 끝에 닿음
      q = next;
      const now = update(q, await ev(q));
      if (now !== passed) break;
      d *= 2;
    }
    if (H - L <= tol) return finish();
    q = isFinite(fH) && L >= qMin ? Math.round(L + ((T - fL) / (fH - fL)) * (H - L)) : (L + H) >> 1;
  }
  return loop();

  async function finish(): Promise<SearchResult> {
    if (H > qMax) await ev(qMax);
    return { best: pickBest(probes, o.target), probes };
  }
  async function loop(): Promise<SearchResult> {
  let lastSide: boolean | null = null;
  while (H - L > tol) {
    q = Math.min(H - 1, Math.max(L + 1, q));
    const before = H - L;
    const side = update(q, await ev(q));
    if (H - L <= tol) break;
    // 판단을 먼저: 구간을 절반도 못 줄였으면 다음은 이분.
    // (처음엔 다음 위치를 보간으로 정한 뒤에 판단해서 한 박자 늦게 적용되는 버그가 있었다)
    // v5: '같은 쪽 끝이 두 번 연속' 움직였을 때만 정체로 본다. 정답 근처에서 한 칸씩 좁히는 정상 수렴을
    //     정체로 오판해 이분으로 낭비하던 것을 실제 사진 추적에서 발견(devlog 3절)
    const stalled = H - L > before / 2 && (o.strictStall || lastSide === side);
    lastSide = side;
    if (H > qMax) { q = stalled ? qMax : (L + qMax + 1) >> 1; continue; } // 통과점이 아직 없으면 위로
    if (stalled) { q = (L + H) >> 1; continue; }
    q = Math.round(L + ((T - fL) / (fH - fL)) * (H - L));
  }
  return finish();
  }
}

// v6(병렬): 한 차례에 후보 2개를 동시에 잰다. 하위 워커가 놀고 있을 때(파일 하나만 압축) 쓰는 선택지이고, 기본은 v5.
// - 1차: 예측값 ± 찌르는 간격 → 둘 사이에 답이 있으면 한 번에 구간이 잡힌다
// - 구간이 있으면: 보간으로 '처음 통과할 품질' c를 예측하고 c-1(미달 예상)과 c(통과 예상)를 함께 → 맞으면 그 차례에 끝
// - 한쪽만 알면: 뉴턴 점프 자리와 그 한 칸 바깥을 함께
// - 확인이 빗나가면 그다음부터는 보간 자리 + 구간 가운데(보간이 계속 빗나가는 곡선에서도 매 차례 절반)
// 정답표 벤치(bench/parallel-search.ts): 차례 수 v5 대비 -31%, 인코딩 수 +33%, 손해는 v5와 같음. Node 실제 인코딩 벽시계는 -12~-33%(두 개가 동시에 돌면 각각 5~14% 느려진다).
export async function searchInterpParallel(evaluate: Evaluate, o: InterpOptions): Promise<SearchResult & { rounds: number }> {
  const seen = new Map<number, Probe>();
  const probes: Probe[] = [];
  const f = o.space === 'linear' ? (s: number) => s : (s: number) => -Math.log(Math.max(1e-6, 1 - s));
  const T = f(o.target);
  const qMin = o.qMin ?? 1, qMax = o.qMax ?? 100, tol = Math.max(1, o.tol ?? 1);
  let L = qMin - 1, fL = f(0), H = qMax + 1, fH = Infinity, rounds = 0;
  // 구간 안쪽의 새 품질만 최대 2개 동시에. 모든 기존 시도는 L 이하나 H 이상에 있으므로 안쪽은 늘 새것이다.
  const batch = async (qs: number[]) => {
    const fresh = [...new Set(qs.map(q => Math.min(qMax, Math.max(qMin, Math.round(q)))))].filter(q => q > L && q < H && !seen.has(q)).slice(0, 2);
    if (!fresh.length) return false;
    rounds++;
    const got = await Promise.all(fresh.map(evaluate));
    for (const p of got) { seen.set(p.q, p); probes.push(p); }
    for (const p of got) if (p.ssim >= o.target && p.q < H) { H = p.q; fH = f(p.ssim); }
    for (const p of got) if (p.ssim < o.target && p.q > L && p.q < H) { L = p.q; fL = f(p.ssim); } // 통과점 위의 미달(비단조)은 무시
    return true;
  };
  const g = Math.round(o.guess ?? (qMin + qMax) / 2), a = Math.max(1, Math.round(o.step ?? (qMax - qMin) / 6));
  await batch([g - a, g + a]);
  let missed = false, grow = 1;
  while (H - L > tol) {
    let qs: number[];
    // 뉴턴 점프 크기(기울기가 없으면 첫 간격의 2배). 한쪽만 아는 차례가 이어지면 두 배씩(v3의 넓히기):
    // 목표 근처에서 곡선이 꺾이면 뉴턴이 계속 짧게 뛰어 한 칸씩 기어갔다(단위 테스트에서 25회)
    const jump = (df: number) => Math.max(1, o.slope ? Math.ceil(o.slope * df) : 2 * a) * grow;
    if (H > qMax) { const j = jump(T - fL); qs = [L + j, L + j + 1]; grow *= 2; }
    else if (L < qMin) { const j = jump(fH - T); qs = [H - j, H - j - 1]; grow *= 2; }
    else {
      const c = Math.min(H - 1, Math.max(L + 1, Math.ceil(L + ((T - fL) / (fH - fL)) * (H - L))));
      // 처음엔 예측 확인(c-1 미달, c 통과면 끝). 그게 빗나갔다면 보간을 덜 믿고 c와 구간 가운데를 함께 → 매 차례 절반은 준다
      qs = missed ? [c, (L + H) >> 1, c + 1, c - 1] : [c - 1, c, c + 1];
      missed = true; // 다음 차례가 있다는 건 이번 확인이 빗나갔다는 뜻
    }
    if (!(await batch(qs))) break;
  }
  if (H > qMax && !seen.has(qMax)) { rounds++; probes.push(await evaluate(qMax)); }
  return { best: pickBest(probes, o.target), probes, rounds };
}

export const strategies = {
  binary: searchBinary,
  interpLinear: (e: Evaluate, o: InterpOptions) => searchInterp(e, { ...o, space: 'linear' }),
  interpLog: (e: Evaluate, o: InterpOptions) => searchInterp(e, { ...o, space: 'log' }),
} as const;
export type Strategy = keyof typeof strategies;
