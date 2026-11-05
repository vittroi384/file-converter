// 랜딩 페이지 스크롤 장면: 작업 종류마다 '전 → 후' 한 장면(CSS 스크롤 타임라인만, JS 0). 기본은 끝난 상태의 정지 그림.
// 숫자·이름은 전부 코드에서 온다:
// - 형식 바꾸기: ops/codecs.ts가 실제로 쓰는 디코더·인코더, JPG로 갈 때 투명 → 흰 배경(flatten), 다시 인코딩이라 EXIF·GPS 없음
// - 용량 줄이기: demo.json(데모 사진의 실제 탐색 기록)
// - 크기 줄이기: 4032×3024는 예시(1200만 화소 폰 사진), 1920은 이 페이지 기본값, 결과는 fitSize와 같은 계산
// - PDF 줄이기: 같은 사진은 SHA-256으로 하나로, 기본 품질은 프리셋 값, 긴 변 2000px(ops/pdf.ts maxSide 기본값)
// - PDF → 이미지: A4(595.28×841.89pt)를 DPI/72배로 올림한 픽셀(ops/pdf.ts와 같은 식), 파일 이름 _p1.jpg 형식
// - 데이터: ops/data.ts 규칙 그대로(앞자리 0은 글자로, 수는 수로) — 표본 3줄의 실제 변환 결과
// 장면을 lazy로 떼면 구운 HTML에 인라인 스크립트가 생겨 CSP에 막힌다(devlog 24절) → 바로 불러온다.
import type { CSSProperties, ReactNode } from 'react';
import type { ActionId, Dict } from '../i18n/types.ts';
import { useI18n } from '../i18n/context.ts';
import { SCENE_TITLE } from '../i18n/landing-scenes.ts';
import type { LandingData } from './page-data.ts';
import { FileTag } from './FileTag.tsx';
import { before, after, probes, target } from './demo.json';
import '../landing-scenes.css';

type V = Record<string, string | number>;
const css = (o: V) => o as CSSProperties;
// 장면 진행 s%~e% 동안 나타난다(.ls-a). 정지 그림에선 무시된다
const at = (s: number, e: number, o: V = {}) => css({ '--s': `${s}%`, '--e': `${e}%`, ...o });
const kb = (b: number) => Math.round(b / 1024);

// 세는 숫자: 정지 그림은 결과 값, 움직일 땐 from → to
const Num = ({ from, to, s, e }: { from: number; to: number; s: number; e: number }) => (
  <b className="num ls-n" style={at(s, e, { '--from': from, '--to': to })}><span className="ls-st">{to}</span><span className="ls-lv" /></b>
);
// 쪽 하나(c: 원본 문서 번호 → 색). out이면 차례로 빠져나가며 흐려진다
const Pg = ({ c, s, out }: { c: number; s: number; out?: boolean }) => <i className={`ls-pg c${c} ls-a${out ? ' ls-o' : ''}`} style={at(s, s + 8)} />;
const Flow = ({ a, b, mid = <span className="ls-arrow">→</span> }: { a: ReactNode; b: ReactNode; mid?: ReactNode }) => <div className="ls-flow">{a}{mid}{b}</div>;
const GPS = <s>EXIF · GPS</s>;

// ── 형식 바꾸기 ──
const PHOTO = ['heic', 'jpg', 'webp', 'avif'];
const DEC: V = { heic: 'libheif · WASM', psd: 'ag-psd', svg: 'resvg · WASM' };
const ENC: V = { jpg: 'MozJPEG', png: 'OxiPNG', webp: 'libwebp', avif: 'libavif' };
function convert(d: LandingData) {
  const from = d.from!, to = d.to!, photo = PHOTO.includes(from), pic = `ls-pic ${photo ? 'ph' : 'gr'}`;
  return (
    <>
      <Flow
        a={<div className="ls-card"><i className={`${pic} f-${from} ls-dec`}><b /><b /></i><FileTag fmt={from} /></div>}
        mid={<div className="ls-pipe">
          <span className="ls-chip ls-a" style={at(10, 25)}>{DEC[from] ?? 'Browser'}</span>
          <span className="ls-px ls-a" style={at(28, 45)}>RGBA</span>
          <span className="ls-chip ls-a" style={at(48, 62)}>{ENC[to]} · WASM</span>
        </div>}
        b={<div className="ls-card ls-a" style={at(56, 64)}><i className={`${pic} to-${to} ls-a ls-wipe`} style={at(62, 82)} /><FileTag fmt={to} /></div>}
      />
      <p className="ls-notes ls-a" style={at(82, 95)}>{photo ? GPS : to === 'jpg' ? <span><i className="ls-alpha" /> → #FFFFFF</span> : null}</p>
    </>
  );
}

// ── 용량 줄이기: 데모 사진의 실제 탐색. 막대가 시도마다 그 크기로 ──
function compress(_: LandingData, t: Dict) {
  const v: V = {};
  [before, ...probes].forEach((p, i) => { v[`--k${i}`] = kb(p.bytes); v[`--r${i}`] = +(p.bytes / before.bytes).toFixed(3); });
  return (
    <>
      <div className="ls-bars" style={css(v)}>
        <FileTag fmt={before.fmt} small /><span className="ls-track"><i className="ls-bar" /></span><b className="num">{kb(before.bytes)} KB</b>
        <FileTag fmt={after.fmt} small />
        <span className="ls-track">
          <i className="ls-bar ls-res" />
          {probes.map((p, i) => <i key={i} className={`ls-dot ls-a${p.ssim >= target ? ' ok' : ''}`} style={at(18 + i * 18, 24 + i * 18, { left: `${(p.bytes / before.bytes) * 100}%` })} />)}
        </span>
        <b className="num ls-kb"><span className="ls-st">{kb(after.bytes)}</span><span className="ls-lv" /> KB</b>
      </div>
      <p className="ls-notes">
        <span className="delta down">−{Math.round((1 - after.bytes / before.bytes) * 100)}%</span>
        <span className="num">SSIM {after.ssim.toFixed(3)} ≥ {target}</span>
        <span>{t.ui.tries(after.q, after.tries)}</span>
        <span className="dim">{t.hero.demoCaption}</span>
      </p>
    </>
  );
}

// ── 크기 줄이기 ──
function resize(d: LandingData) {
  const W = 4032, H = 3024, M = Number(d.preset.maxWidth) || 1920, h = Math.round((H * M) / W);
  const mp = (w: number, x: number) => (w * x / 1e6).toFixed(1);
  return (
    <>
      <div className="ls-frame"><i className="ls-pic ph ls-shrink" style={css({ '--r': (M / W).toFixed(3) })} /></div>
      <p className="ls-notes">
        <span className="num dim">{W} × {H} · {mp(W, H)} MP</span>
        <span className="num">→ <Num from={W} to={M} s={15} e={70} /> × <Num from={H} to={h} s={15} e={70} /> · {mp(M, h)} MP</span>
        <span className="ls-chip">Lanczos3</span>
      </p>
    </>
  );
}

// ── PDF 합치기: 문서 셋(사진도 한 쪽이 된다)이 목록 순서대로 한 묶음으로 ──
const MERGE = [['pdf', 2], ['pdf', 3], ['jpg', 1]] as const;
function merge(_: LandingData, t: Dict) {
  const seq = MERGE.flatMap(([, n], i) => Array.from({ length: n }, () => i));
  let j = 0;
  return (
    <Flow
      a={<div className="ls-docs">{MERGE.map(([f, n], i) => (
        <div key={i} className="ls-doc"><span className="num ls-i">{i + 1}</span><FileTag fmt={f} small /><span className="ls-pgs">{Array.from({ length: n }, () => <Pg key={j} c={i} s={12 + j++ * 11} out />)}</span></div>
      ))}</div>}
      b={<div className="ls-doc ls-out"><FileTag fmt="pdf" /><span className="ls-pgs">{seq.map((c, k) => <Pg key={k} c={c} s={12 + k * 11} />)}</span><small className="ls-a" style={at(80, 92)}>{t.ui.pages(seq.length)}</small></div>}
    />
  );
}

// ── PDF 나누기: 범위대로 ──
function split(_: LandingData, t: Dict) {
  const G = [[1, 3], [4, 6]] as const;
  return (
    <Flow
      a={<div className="ls-docs"><div className="ls-doc"><FileTag fmt="pdf" /><span className="ls-pgs">{[0, 1, 2, 3, 4, 5].map(k => <Pg key={k} c={0} s={14 + k * 11} out />)}</span></div>
        <span className="ls-chip">{t.fields.ranges}: {G.map(g => g.join('-')).join(',')}</span></div>}
      b={<div className="ls-docs">{G.map(([a, b], g) => (
        <div key={g} className="ls-doc"><FileTag fmt="pdf" small /><small className="num">_p{a}-{b}.pdf</small><span className="ls-pgs">{[0, 1, 2].map(k => <Pg key={k} c={g + 1} s={14 + (g * 3 + k) * 11} />)}</span></div>
      ))}</div>}
    />
  );
}

// ── PDF 용량 줄이기: 같은 사진 하나로 → 사진만 다시 압축 ──
const Page = ({ q }: { q?: boolean }) => <i className={`ls-page${q ? ' ls-q' : ''}`}><i className="ls-pic ph" /></i>;
function compressPdf(d: LandingData) {
  return (
    <Flow
      a={<div className="ls-card"><span className="ls-pgs"><Page /><Page /></span><FileTag fmt="pdf" /></div>}
      mid={<div className="ls-pipe">
        <span className="ls-chip ls-a" style={at(10, 28)}>SHA-256 · 2 → 1</span>
        <span className="ls-chip ls-a" style={at(32, 50)}>JPEG q{d.preset.quality ?? 65}</span>
        <span className="ls-chip ls-a" style={at(52, 66)}>≤ 2000 px</span>
      </div>}
      b={<div className="ls-card ls-a" style={at(68, 84)}><span className="ls-pgs"><Page q /><Page q /></span><FileTag fmt="pdf" /></div>}
    />
  );
}

// ── PDF → 이미지: 쪽마다 한 장 ──
function pdfToImage(d: LandingData) {
  const to = d.preset.to ?? 'png', dpi = Number(d.preset.dpi ?? 150), px = (pt: number) => Math.ceil((pt * dpi) / 72);
  return (
    <>
      <Flow
        a={<div className="ls-card"><span className="ls-pgs">{[0, 1, 2].map(k => <i key={k} className="ls-page ls-a ls-o" style={at(15 + k * 22, 30 + k * 22)}><i className="ls-pic ph" /></i>)}</span><FileTag fmt="pdf" /></div>}
        b={<div className="ls-outs">{[1, 2, 3].map(k => (
          <div key={k} className="ls-card ls-a" style={at(15 + (k - 1) * 22, 30 + (k - 1) * 22)}><i className="ls-page"><i className="ls-pic ph" /></i><small className="num">_p{k}.{to}</small></div>
        ))}</div>}
      />
      <p className="ls-notes"><FileTag fmt={to} small /><span className="num">A4 · {dpi} DPI → {px(595.28)} × {px(841.89)} px</span></p>
    </>
  );
}

// ── 사진 → PDF: 쪽 크기 = 사진 크기, 위치 정보는 지운다 ──
const SHOTS = [['jpg', '4 / 3'], ['jpg', '3 / 4'], ['png', '1']] as const;
function imagesToPdf(_: LandingData, t: Dict) {
  return (
    <>
      <Flow
        a={<div className="ls-outs">{SHOTS.map(([f, r], k) => <div key={k} className="ls-card ls-a ls-o" style={at(12 + k * 22, 28 + k * 22)}><i className="ls-pic ph" style={{ aspectRatio: r }} /><FileTag fmt={f} small /></div>)}</div>}
        b={<div className="ls-card"><span className="ls-pgs">{SHOTS.map(([, r], k) => <i key={k} className="ls-page ls-fit ls-a" style={at(12 + k * 22, 28 + k * 22, { aspectRatio: r })}><i className="ls-pic ph" /></i>)}</span><FileTag fmt="pdf" /></div>}
      />
      <p className="ls-notes">{GPS}<span>{t.ui.pages(SHOTS.length)}</span></p>
    </>
  );
}

// ── 데이터: 같은 세 줄이 다른 형식으로(ops/data.ts 실제 결과) ──
const ROWS = [['007', '김민지', 12], ['042', '山田', 3], ['019', 'José', 40]] as const;
type Row = (typeof ROWS)[number];
const Z = ({ v, q }: { v: string; q?: boolean }) => <mark>{q ? `"${v}"` : v}</mark>; // 앞자리 0 = 글자 그대로
const LINE: Record<string, (r: Row, last: boolean) => ReactNode> = {
  csv: r => <><Z v={r[0]} />,{r[1]},{r[2]}</>,
  json: (r, last) => <>{'  {"code": '}<Z v={r[0]} q />{`, "name": "${r[1]}", "qty": ${r[2]}}${last ? '' : ','}`}</>,
  yaml: r => <>{'- code: '}<Z v={r[0]} q />{`\n  name: ${r[1]}\n  qty: ${r[2]}`}</>,
};
const HEAD: V = { csv: 'code,name,qty', json: '[' };
function Data({ f, out }: { f: string; out?: boolean }) {
  const s = (k: number) => at(14 + k * 20, 26 + k * 20);
  if (f === 'xlsx') return (
    <table className="ls-sheet"><thead><tr><th /><th>A</th><th>B</th><th>C</th></tr></thead>
      <tbody><tr><th>1</th><td>code</td><td>name</td><td>qty</td></tr>
        {ROWS.map((r, k) => <tr key={k} className={out ? 'ls-a' : 'ls-hl'} style={s(k)}><th>{k + 2}</th><td><Z v={r[0]} /></td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody></table>
  );
  return (
    <pre className="ls-code">
      {HEAD[f] && <span>{HEAD[f]}</span>}
      {ROWS.map((r, k) => <span key={k} className={out ? 'ls-a' : 'ls-hl'} style={s(k)}>{LINE[f]!(r, k === 2)}</span>)}
      {f === 'json' && <span>]</span>}
    </pre>
  );
}
function data(d: LandingData) {
  const side = (f: string, out?: boolean) => <div className="ls-src"><FileTag fmt={f} small />{f === 'csv' && out && <small>UTF-8 BOM</small>}<Data f={f} out={out} /></div>;
  return <Flow a={side(d.from!)} b={side(d.to!, true)} />;
}

const BODY: Partial<Record<ActionId, (d: LandingData, t: Dict) => ReactNode>> = {
  convert: d => (d.from && d.to ? convert(d) : resize(d)), compress, 'pdf-merge': merge, 'pdf-split': split,
  'pdf-compress': compressPdf, 'pdf-to-image': pdfToImage, 'image-to-pdf': imagesToPdf, data: d => (d.from && d.to ? data(d) : null),
};

export function LandingScene({ data: d }: { data: LandingData }) {
  const { t, locale } = useI18n();
  const body = BODY[d.action]?.(d, t);
  if (!body) return null;
  const resizing = d.action === 'convert' && !d.from;
  return (
    <section className={`scene ls ls-${resizing ? 'resize' : d.action}`} aria-labelledby="ls-title">
      <div className="scene-stage">
        <header className="scene-head">
          <h2 id="ls-title" className="section-title">{SCENE_TITLE[locale]}</h2>
          {!resizing && <p className="lede">{t.actions[d.action].desc}</p>}
        </header>
        <div className="ls-fig" aria-hidden="true">{body}</div>
      </div>
    </section>
  );
}
