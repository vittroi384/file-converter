// 첫 화면의 스크롤 장면들(CSS 스크롤 타임라인만, JS 0바이트). 숫자는 전부 실제 값:
// - 탐색 장면: tools/make-demo.ts가 데모 사진으로 실제 탐색한 기록(곡선 15점·시도 순서)
// - 형식 지도: 실제로 되는 변환 조합만
// 지원 안 하는 브라우저·움직임 줄이기에선 마지막 상태의 정적 그림이 된다(styles.css).
import type { CSSProperties } from 'react';
import { useI18n } from '../i18n/context.ts';
import type { DemoData } from './page-data.ts';
import { FileTag } from './FileTag.tsx';
import { bytes } from './format.ts';

const css = (o: Record<string, string | number>) => o as CSSProperties;

// ── 탐색 장면: 실제 탐색 기록으로 그린 품질–SSIM 그래프 ──
// 시도는 좁은 구간(품질 79~86)에 몰린다 → 처음엔 30~100 전체를 그려 점·글자가 겹쳤다. 확대해서 그린다
const X0 = 60, X1 = 95, Y0 = 0.9, Y1 = 1;
const sx = (q: number) => 40 + ((q - X0) / (X1 - X0)) * 500;
const sy = (v: number) => 290 - ((Math.min(Y1, Math.max(Y0, v)) - Y0) / (Y1 - Y0)) * 270;

export function SearchScene({ demo }: { demo: DemoData }) {
  const { t } = useI18n();
  const s = t.scenes.search;
  const probes = demo.probes ?? [], curve = demo.curve ?? [], target = demo.target ?? 0.97;
  if (probes.length < 2 || curve.length < 2) return null;
  const n = probes.length;
  // 장면 진행(0~100%) 나누기: 곡선 0~22, 시도 i는 28 + i×(56/n), 선택 표시 88~
  const at = (i: number) => Math.round(28 + i * (56 / n));
  const path = curve.filter(c => c.q >= X0 && c.q <= X1).map((c, i) => `${i ? 'L' : 'M'}${sx(c.q).toFixed(1)},${sy(c.ssim).toFixed(1)}`).join(' ');
  const strategy = (i: number) => s.steps[i === 0 ? 0 : i === n - 1 ? 3 : i === 1 ? 1 : 2];
  // 파일 크기 숫자: 시도마다 그 시도의 크기로(KB)
  const kbFrames = probes.map((p, i) => `${at(i)}%, ${at(i) + Math.round(56 / n) - 2}% { --kb: ${Math.round(p.bytes / 1024)}; }`).join(' ');
  const last = probes[n - 1]!;
  return (
    <section className="scene search-scene" aria-labelledby="search-title">
      <style>{`@keyframes s-kb { 0%, ${at(0) - 1}% { --kb: ${Math.round(probes[0]!.bytes / 1024)}; } ${kbFrames} 100% { --kb: ${Math.round(last.bytes / 1024)}; } }`}</style>
      <div className="scene-stage">
        <header className="scene-head">
          <h2 id="search-title" className="section-title">{s.title}</h2>
          <p className="lede">{s.sub}</p>
        </header>
        <div className="search-grid">
          <figure className="search-fig">
            <svg viewBox="0 0 560 334" role="img" aria-label={`${s.quality}–SSIM: ${probes.map(p => `q${p.q} ${p.ssim}`).join(', ')}`}>
              {[0.9, 0.925, 0.95, 0.975, 1].map(v => <g key={v}><line x1={40} x2={540} y1={sy(v)} y2={sy(v)} className="grid" /><text x={34} y={sy(v) + 4} className="axis" textAnchor="end">{v.toFixed(3)}</text></g>)}
              {[60, 70, 80, 90].map(q => <text key={q} x={sx(q)} y={310} className="axis" textAnchor="middle">{q}</text>)}
              <text x={290} y={326} className="axis label" textAnchor="middle">{s.quality} →</text>
              <path d={path} className="curve" pathLength={1} />
              <g className="target">
                <line x1={40} x2={540} y1={sy(target)} y2={sy(target)} />
                <text x={44} y={sy(target) - 6}>{s.target} {target}</text>
              </g>
              {probes.slice(1).map((p, i) => (
                <line key={`h${i}`} className="hop" x1={sx(probes[i]!.q)} y1={sy(probes[i]!.ssim)} x2={sx(p.q)} y2={sy(p.ssim)} pathLength={1}
                  style={css({ animationRange: `contain ${at(i + 1) - 4}% contain ${at(i + 1)}%` })} />
              ))}
              {probes.map((p, i) => {
                const ok = p.ssim >= target;
                return (
                  <g key={i} className={`probe${ok ? ' ok' : ''}${i === n - 1 ? ' pick' : ''}`} style={css({ animationRange: `contain ${at(i)}% contain ${at(i) + 4}%` })}>
                    <circle cx={sx(p.q)} cy={sy(p.ssim)} r={i === n - 1 ? 10 : 8} />
                    <text x={sx(p.q)} y={sy(p.ssim) + 4} textAnchor="middle" className="probe-n">{i + 1}</text>
                    {i === n - 1 && <text x={sx(p.q) - 14} y={sy(p.ssim) - 14} textAnchor="end" className="probe-l">q{p.q} · {p.ssim.toFixed(3)}</text>}
                  </g>
                );
              })}
            </svg>
            <figcaption className="search-size">
              <span>{s.size}</span>
              <b className="num"><span className="kb-static">{bytes(last.bytes)}</span><span className="kb-live" /></b>
              <span className="dim">{bytes(demo.before.bytes)} →</span>
            </figcaption>
          </figure>
          <ol className="search-steps">
            {probes.map((p, i) => (
              <li key={i} style={css({ animationRange: `contain ${at(i)}% contain ${i === n - 1 ? 100 : at(i + 1)}%` })} className={i === n - 1 ? 'last' : ''}>
                <span className="step-n num">{i + 1}</span>
                <span><b>{strategy(i)}</b><small className="num">q{p.q} → SSIM {p.ssim.toFixed(3)} · {bytes(p.bytes)} · {i === n - 1 ? s.pass : p.ssim >= target ? s.over : s.under}</small></span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ── 동시 처리 장면: 작업자 레인마다 파일이 흘러가 ZIP 하나로 ──
// 긴 구역(360vh)에서 파일 하나가 장면의 30%에 걸쳐 천천히 지나가고, 끝난 수는 파일이 실제로 끝나는 순간마다 하나씩 오른다
const LANE_FILES = [['jpg', 'heic', 'png'], ['heic', 'jpg', 'webp'], ['png', 'jpg', 'heic'], ['jpg', 'png', 'jpg']] as const;
const chipStart = (l: number, k: number) => 4 + k * 26 + l * 4;
const DONE = LANE_FILES.flatMap((fs, l) => fs.map((_, k) => chipStart(l, k) + 30)).sort((a, b) => a - b);
// 정수 계단: p%에 i+1이 되어 다음 지점 직전까지 머문다(이음 구간만 0.5%)
const stepFrames = (name: string, at: number[]) =>
  `@keyframes ${name} { 0%, ${at[0]! - 0.5}% { --n: 0; } ${at.map((p, i) => `${p}%, ${i + 1 < at.length ? at[i + 1]! - 0.5 : 100}% { --n: ${i + 1}; }`).join(' ')} }`;
export function ParallelScene() {
  const { t } = useI18n();
  const s = t.scenes.parallel;
  const total = DONE.length;
  return (
    <section className="scene parallel-scene" aria-labelledby="parallel-title">
      <style>{stepFrames('s-done', DONE)}</style>
      <div className="scene-stage">
        <header className="scene-head">
          <h2 id="parallel-title" className="section-title">{s.title}</h2>
          <p className="lede">{s.sub}</p>
        </header>
        <div className="lanes" aria-hidden="true">
          {LANE_FILES.map((files, l) => (
            <div key={l} className="lane">
              <span className="lane-name num">{s.worker} {l + 1}</span>
              <div className="lane-track">
                {files.map((f, k) => {
                  const start = chipStart(l, k);
                  return <span key={k} className="lane-chip" style={css({ animationRange: `contain ${start}% contain ${start + 30}%` })}><FileTag fmt={f} small /></span>;
                })}
                <span className="lane-bar" style={css({ animationRange: `contain ${chipStart(l, 0)}% contain ${chipStart(l, 2) + 30}%` })} />
              </div>
            </div>
          ))}
          <div className="zip-box"><FileTag fmt="zip" /><span className="num zip-count"><span className="stat-static">{total}</span><span className="n-live" style={css({ animationName: 's-done' })} />/{total}</span><span>{s.zip}</span></div>
        </div>
      </div>
    </section>
  );
}

// ── 형식 지도: 실제로 되는 조합만 선으로 ──
const INS = ['heic', 'psd', 'svg', 'png', 'jpg', 'pdf', 'xlsx', 'csv'] as const;
const OUTS = ['jpg', 'png', 'webp', 'avif', 'pdf', 'csv', 'json', 'xlsx'] as const;
const IMG_IN = ['heic', 'psd', 'svg', 'png', 'jpg'];
const EDGES: [string, string][] = [
  ...IMG_IN.flatMap(i => ['jpg', 'png', 'webp', 'avif', 'pdf'].map(o => [i, o] as [string, string])), // 이미지 변환·용량 줄이기·사진→PDF
  ['pdf', 'jpg'], ['pdf', 'png'], ['pdf', 'webp'], ['pdf', 'pdf'], // PDF→이미지, 합치기·나누기·줄이기
  ['xlsx', 'csv'], ['xlsx', 'json'], ['csv', 'json'], ['csv', 'xlsx'], // 데이터
];
// 장면: 입력 형식을 하나씩 골라(구간 11%) 그 형식에서 갈 수 있는 출력으로 선이 차례로 그려지고(강조),
// 다음 형식으로 넘어가면 차분한 색으로 남는다. 출력 이름은 처음 선이 닿을 때 또렷해진다. 아래 숫자는 그려진 조합 수.
const seg = (f: string) => 4 + INS.indexOf(f as never) * 11;
const ORDER = EDGES.map(([a], k) => EDGES.slice(0, k).filter(([x]) => x === a).length); // 같은 입력 안에서 몇 번째 선인지
const DRAWN = EDGES.map(([a], k) => seg(a) + ORDER[k]! + Math.round(0.6 * (11 - ORDER[k]!))); // 선이 다 그려지는 지점(아래 CSS s-edge의 60%)
const ARRIVE = OUTS.map(o => Math.min(...EDGES.flatMap(([, b], k) => (b === o ? [DRAWN[k]!] : []))));
export function FormatsScene() {
  const { t } = useI18n();
  const s = t.scenes.formats;
  const y = (i: number) => 24 + i * 40;
  const range = (a: number, b: number) => css({ '--a': `${a}%`, '--b': `${b}%` });
  return (
    <section className="scene formats-scene" aria-labelledby="formats-title">
      <style>{stepFrames('s-edges', [...DRAWN].sort((a, b) => a - b))}</style>
      <div className="scene-stage">
        <header className="scene-head">
          <h2 id="formats-title" className="section-title">{s.title}</h2>
          <p className="lede">{s.sub(EDGES.length)}</p>
        </header>
        <svg viewBox="0 -8 560 348" className="formats-map" role="img" aria-label={EDGES.map(([a, b]) => `${a}→${b}`).join(', ')}>
          <text x={60} y={4} className="axis" textAnchor="middle">{s.inputs}</text>
          <text x={500} y={4} className="axis" textAnchor="middle">{s.outputs}</text>
          {EDGES.map(([a, b], k) => {
            const y1 = y(INS.indexOf(a as never)), y2 = y(OUTS.indexOf(b as never));
            return <path key={k} d={`M104,${y1} C280,${y1} 280,${y2} 456,${y2}`} className={`edge e-${a}`} pathLength={1} style={range(seg(a) + ORDER[k]!, seg(a) + 11)} />;
          })}
          {INS.map((f, i) => <g key={f} className="node in" style={range(seg(f), seg(f) + 11)}><rect x={16} y={y(i) - 13} width={88} height={26} rx={5} /><text x={60} y={y(i) + 5} textAnchor="middle">{f.toUpperCase()}</text></g>)}
          {OUTS.map((f, i) => <g key={f} className="node out" style={range(ARRIVE[i]! - 2, ARRIVE[i]! + 6)}><rect x={456} y={y(i) - 13} width={88} height={26} rx={5} /><text x={500} y={y(i) + 5} textAnchor="middle">{f.toUpperCase()}</text></g>)}
        </svg>
        <p className="formats-count" aria-hidden="true"><b className="num"><span className="stat-static">{EDGES.length}</span><span className="n-live" style={css({ animationName: 's-edges' })} /></b> / {EDGES.length}</p>
      </div>
    </section>
  );
}
