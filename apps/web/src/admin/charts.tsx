// 라이브러리 없는 SVG 차트. 규칙: 선 2px, 축·격자는 흐리게, 색은 고정 순서, 값은 늘 글자로도(색만으로 구분 금지).
import { useMemo, useRef, useState } from 'react';
import type { Series } from './api.ts';

const SLOTS = 8;
export const seriesVar = (i: number) => `var(--s${(i % SLOTS) + 1})`;

export function fmtNum(v: number, unit = ''): string {
  if (!isFinite(v)) return '–';
  if (unit === '%') return `${(v * 100).toFixed(v >= 0.995 && v < 1 ? 1 : 0)}%`;
  if (unit === 's') return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(1)}초`;
  if (unit === 'ms') return v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}초`;
  if (unit === 'B') return v < 1048576 ? `${Math.round(v / 1024)}KB` : `${(v / 1048576).toFixed(1)}MB`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}천`;
  return Number.isInteger(v) ? String(v) : v.toFixed(v < 10 ? 2 : 1);
}

export interface LineSpec { name: string; points: [number, number][]; slot?: number }

// slot: 색을 대상에 고정(조회 결과 순서가 바뀌어도 '성공'은 늘 같은 색). 없으면 이름 순으로 정한다.
export function toLines(series: Series[] | undefined, label: (m: Record<string, string>) => string, slot?: (m: Record<string, string>) => number): LineSpec[] {
  return (series ?? []).slice().sort((a, b) => label(a.metric).localeCompare(label(b.metric), 'ko')).map(s => ({
    name: label(s.metric),
    slot: slot?.(s.metric),
    points: (s.values ?? []).map(([t, v]) => [t * 1000, Number(v)] as [number, number]).filter(p => isFinite(p[1])),
  })).filter(l => l.points.length);
}

// 선 차트 + 세로선·값 표(가장 가까운 시점)
// 점 간격이 평소(가장 짧은 간격)의 3배를 넘으면 거기서 끊는다
export function segments(points: [number, number][]): [number, number][][] {
  if (points.length < 2) return [points];
  let step = Infinity;
  for (let i = 1; i < points.length; i++) step = Math.min(step, points[i]![0] - points[i - 1]![0]);
  const out: [number, number][][] = [[points[0]!]];
  for (let i = 1; i < points.length; i++) {
    if (points[i]![0] - points[i - 1]![0] > step * 3) out.push([]);
    out[out.length - 1]!.push(points[i]!);
  }
  return out;
}

// 배포 시각: 버전별 처음 기록 시각(초, tfirst_over_time 결과). api·web을 버전으로 합쳐 이른 쪽을 쓰고,
// 기간 시작 2분 안에 처음 보인 버전은 '기간 전부터 있던 것'이라 뺀다
export function deployTimes(series: Series[] | undefined, rangeStartMs: number): { t: number; label: string }[] {
  const byVersion = new Map<string, number>();
  for (const s of series ?? []) {
    const v = s.metric.version ?? '?', t = Number(s.value?.[1]) * 1000;
    if (isFinite(t)) byVersion.set(v, Math.min(byVersion.get(v) ?? Infinity, t));
  }
  return [...byVersion].filter(([, t]) => t > rangeStartMs + 120_000).map(([label, t]) => ({ t, label })).sort((a, b) => a.t - b.t);
}

export function LineChart({ lines, unit = '', height = 180, yMax, markers = [] }: { lines: LineSpec[]; unit?: string; height?: number; yMax?: number; markers?: { t: number; label: string }[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, L = 44, R = 10, T = 10, B = 22;
  const { x0, x1, ymax, times } = useMemo(() => {
    const all = lines.flatMap(l => l.points);
    const ts = [...new Set(all.map(p => p[0]))].sort((a, b) => a - b);
    const max = yMax ?? Math.max(1e-9, ...all.map(p => p[1])) * 1.1;
    const last = ts[ts.length - 1] ?? 1;
    // 시점이 하나뿐이면 시작=끝이 돼 점이 왼쪽 축에 붙었다 → 가장 최근 값으로 보고 오른쪽 끝에 둔다
    return { x0: ts.length > 1 ? ts[0]! : last - 1, x1: last, ymax: max, times: ts };
  }, [lines, yMax]);
  if (!lines.length) return <Empty />;
  const sx = (t: number) => L + ((t - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const sy = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const ticks = [0, 0.5, 1].map(f => f * ymax);
  const hoverT = hover !== null ? times[hover] : undefined;
  const timeFmt = (t: number) => { const d = new Date(t); return (x1 - x0) > 2 * 86400_000 ? `${d.getMonth() + 1}/${d.getDate()}` : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const t = x0 + ((e.clientX - r.left) / r.width * W - L) / (W - L - R) * (x1 - x0);
    let best = 0;
    times.forEach((tt, i) => { if (Math.abs(tt - t) < Math.abs(times[best]! - t)) best = i; });
    setHover(best);
  };
  return (
    <div className="chart" ref={box} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {/* 축 글자는 그래프 영역(.plot) 기준으로 놓는다: 범례가 두 줄로 꺾이면 바깥 상자 기준 '0'이 아래로 밀렸다(모바일 스크린샷) */}
      <div className="plot" style={{ height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`선 차트: ${lines.map(l => l.name).join(', ')}`}>
        {ticks.map(v => <line key={v} x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="grid" />)}
        {lines.map((l, i) => l.points.length >= 3 ? (
          // 자료가 빈 구간(서버가 꺼져 있던 때 등)은 선을 끊는다: 이어 그리면 없던 값이 있었던 것처럼 보였다
          <g key={l.name}>{segments(l.points).map((seg, k) => (
            <g key={k}>
              {/* 선 아래 옅은 면(계열이 둘 이하일 때만: 많으면 겹쳐 탁해진다) */}
              {lines.length <= 2 && seg.length > 1 && <polygon className="area" fill={seriesVar(l.slot ?? i)} points={`${sx(seg[0]![0])},${sy(0)} ${seg.map(p => `${sx(p[0])},${sy(p[1])}`).join(' ')} ${sx(seg[seg.length - 1]![0])},${sy(0)}`} />}
              <polyline fill="none" stroke={seriesVar(l.slot ?? i)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
                points={seg.map(p => `${sx(p[0])},${sy(p[1])}`).join(' ')} />
            </g>
          ))}</g>
        ) : (
          // 점이 1~2개면 선 길이가 0이라 안 보인다(서비스 시작 직후 실제로 겪음) → 8px 점으로
          // 원은 가로로 늘린 SVG에서 납작해진다 → 길이 0 선 + 둥근 끝(두께는 늘어나지 않음)으로 늘 동그란 점
          <g key={l.name}>{l.points.map(p => <line key={p[0]} className="dot" x1={sx(p[0])} x2={sx(p[0])} y1={sy(p[1])} y2={sy(p[1])} stroke={seriesVar(l.slot ?? i)} strokeWidth={8} strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}</g>
        ))}
        {hoverT !== undefined && <line x1={sx(hoverT)} x2={sx(hoverT)} y1={T} y2={H - B} className="cross" vectorEffect="non-scaling-stroke" />}
        {/* 배포 세로선: 배포 직후 오류·지연이 늘면 바로 보인다 */}
        {markers.filter(m => m.t >= x0 && m.t <= x1).map(m => (
          <line key={m.t} x1={sx(m.t)} x2={sx(m.t)} y1={T} y2={H - B} className="deploy" vectorEffect="non-scaling-stroke"><title>{`배포 ${m.label}`}</title></line>
        ))}
      </svg>
      <div className="axis-y">{ticks.slice().reverse().map(v => <span key={v}>{fmtNum(v, unit)}</span>)}</div>
      </div>
      <div className="axis-x"><span>{timeFmt(x0)}</span><span>{timeFmt(x1)}</span></div>
      {lines.length > 1 && <div className="legend">{lines.map((l, i) => <span key={l.name}><i style={{ background: seriesVar(l.slot ?? i) }} />{l.name}</span>)}</div>}
      {hoverT !== undefined && (
        <div className="tip" style={{ left: `${Math.min(70, Math.max(5, (sx(hoverT) / W) * 100))}%` }}>
          <b>{new Date(hoverT).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b>
          {lines.map((l, i) => { const p = l.points.find(q => q[0] === hoverT); return p ? <div key={l.name}><i style={{ background: seriesVar(l.slot ?? i) }} />{l.name}<span>{fmtNum(p[1], unit)}</span></div> : null; })}
        </div>
      )}
    </div>
  );
}

// 가로 막대 목록: 이름·값을 늘 글자로 함께 표시. 이름이 글자로 있으니 색은 한 가지(8색을 돌려 쓰면 9번째가 1번과 겹쳤다)
export function BarList({ rows, unit = '', max }: { rows: { label: string; value: number; colorIndex?: number }[]; unit?: string; max?: number }) {
  if (!rows.length) return <Empty />;
  const m = max ?? Math.max(...rows.map(r => r.value), 1e-9);
  return (
    <ul className="bars">
      {rows.map(r => (
        <li key={r.label} title={`${r.label}: ${fmtNum(r.value, unit)}`}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track"><i style={{ width: `${Math.max(1.5, (r.value / m) * 100)}%` }} /></span>
          <span className="bar-value">{fmtNum(r.value, unit)}</span>
        </li>
      ))}
    </ul>
  );
}

export type Status = 'good' | 'warn' | 'bad' | 'none';
export function StatusBadge({ s, children }: { s: Status; children?: React.ReactNode }) {
  const icon = s === 'good' ? '●' : s === 'warn' ? '▲' : s === 'bad' ? '■' : '○';
  const word = s === 'good' ? '좋음' : s === 'warn' ? '주의' : s === 'bad' ? '나쁨' : '자료 없음';
  return <span className={`status ${s}`}><span aria-hidden="true">{icon}</span>{children ?? word}</span>;
}

export function Empty({ text = '아직 자료가 없어요' }: { text?: string }) {
  return <div className="empty">{text}</div>;
}
