import { useI18n } from '../i18n/context.ts';
import { localePath } from '../i18n/locales.ts';
import type { PageData, ToolLink } from './page-data.ts';
import { Tool, type ToolProps } from './Tool.tsx';
import { Compare } from './CompareModal.tsx';
import { FileTag } from './FileTag.tsx';
import { Icon } from './icons.tsx';
import { bytes } from './format.ts';
// 장면은 바로 불러온다: lazy로 떼었더니 구운 HTML에 React의 인라인 완성 스크립트가 들어가 CSP에 막히고 #419 오류(e2e 콘솔 검사로 발견)
import { SearchScene, ParallelScene, FormatsScene, MetaScene } from './Scenes.tsx';

// 도구 아래 한 줄: 많이 찾는 랜딩으로 바로 가기(옛 '언어 10 · 작업 10…' 숫자 줄 자리). 제목은 메뉴와 같은 현지화된 이름
const QUICK = ['heic-to-jpg', 'compress-image', 'merge-pdf', 'png-to-jpg', 'pdf-to-jpg', 'excel-to-csv'];

type Shared = Pick<ToolProps, 'say' | 'onCompare' | 'registerCommands'>;

export function Home({ data, ...shared }: { data: PageData } & Shared) {
  const { t, locale } = useI18n();
  const d = data.demo;
  // 마우스 자리를 앱 창·카드에 넘긴다(styles.css가 그 자리에 빛을 그린다)
  const glow = (e: React.PointerEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.stage, .proof-item');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', `${e.clientX - r.left}px`);
    c.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <main className="main" onPointerMove={glow}>
      <section className="hero">
        <div className="hero-text">
          <p className="kicker">{t.hero.kicker}</p>
          <h1 className="display">{t.hero.title}</h1>
          <p className="lede">{t.hero.sub}</p>
        </div>
        {/* 앱 창: 파일 놓는 칸과 실제 변환 예를 한 판에. 파일을 넣으면 예는 접히고 작업 화면이 판을 다 쓴다(styles.css :has) */}
        <div className="stage">
          <div className="stage-bar"><span className="num">WebAssembly · Workers</span><span className="stage-pill"><Icon name="shield" size={14} />{t.proof.noUpload}</span></div>
          <div className="stage-body">
            <Tool {...shared} />
            {d && (
          <figure className="hero-demo">
            <Compare before={d.before.src} after={d.after.src} beforeLabel={t.hero.before} afterLabel={t.hero.after} width={d.before.width} height={d.before.height} />
            <figcaption>
              <span className="meter" aria-hidden="true"><i style={{ ['--r' as string]: (d.after.bytes / d.before.bytes).toFixed(3) }} /></span>
              <span className="row"><FileTag fmt={d.before.fmt} small /><span className="num">{bytes(d.before.bytes)}</span><span aria-hidden="true">→</span><FileTag fmt={d.after.fmt} small /><span className="num">{bytes(d.after.bytes)}</span><span className="delta down">−{Math.round((1 - d.after.bytes / d.before.bytes) * 100)}%</span></span>
              <span className="dim"><span className="nowrap">{t.hero.demoCaption}</span> · <span className="nowrap">SSIM {d.after.ssim.toFixed(3)}</span> · <span className="nowrap">{t.ui.tries(d.after.q, d.after.tries)}</span></span>
            </figcaption>
          </figure>
            )}
          </div>
        </div>
      </section>

      <nav className="quick" aria-label={t.scenes.popular}>
        <span>{t.scenes.popular}</span>
        {QUICK.map(s => data.tools.find(x => x.slug === s)).map(x => x && <a key={x.slug} href={localePath(locale, x.slug)}>{x.title}</a>)}
      </nav>

      <section className="proof" aria-label={t.proof.noUpload}>
        {([['shield', t.proof.noUpload, t.proof.noUploadBody], ['check', t.proof.noAds, t.proof.noAdsBody], ['cpu', t.proof.parallel, t.proof.parallelBody]] as const).map(([icon, h, p], i) => (
          <div key={i} className="proof-item reveal">
            <span className="proof-n num">0{i + 1}</span>
            <h3><Icon name={icon} size={18} /> {h}</h3>
            <p>{p}</p>
          </div>
        ))}
      </section>

      {d && <SearchScene demo={d} />}
      <ParallelScene />
      <FormatsScene />

      <section id="tools" className="index">
        <h2 className="section-title">{t.nav.tools}</h2>
        <div className="index-cols">
          {(['image', 'pdf', 'data'] as const).map(g => (
            <ToolGroup key={g} title={g === 'image' ? t.quick.convert.title : g === 'pdf' ? t.quick.pdf.title : t.quick.data.title} links={data.tools.filter(x => x.group === g)} base={l => localePath(locale, l)} />
          ))}
        </div>
      </section>

      <MetaScene />

      {/* 스크롤 장면: 구역이 화면 높이보다 길고, 무대는 고정된 채 스크롤 진행에 따라 움직인다(CSS 스크롤 타임라인, JS 없음).
          지원 안 하는 브라우저·움직임 줄이기 설정에선 마지막 상태 그대로의 정적 그림이 된다. */}
      <section id="privacy" className="journey"
        style={d ? { ['--kb-from' as string]: Math.round(d.before.bytes / 1024), ['--kb-to' as string]: Math.round(d.after.bytes / 1024) } : undefined}>
        <div className="journey-stage">
          <h2 className="section-title">{t.privacy.title}</h2>
          <div className="journey-grid">
            <div className="journey-scene" aria-hidden="true">
              <div className="j-device">
                <span className="j-label"><Icon name="lock" size={16} />Browser</span>
                <div className="j-file">
                  <span className="j-tags"><span className="j-before"><FileTag fmt={d?.before.fmt ?? 'jpg'} /></span><span className="j-after"><FileTag fmt={d?.after.fmt ?? 'webp'} /></span></span>
                  {d && <span className="j-kb num"><span className="j-kb-static">{bytes(d.after.bytes)}</span><span className="j-kb-live" /></span>}
                </div>
                <span className="j-bar"><span /></span>
                <small>WebAssembly · Workers</small>
              </div>
              <div className="j-wire"><span /><i className="j-block"><Icon name="x" size={22} /></i></div>
              <div className="j-server"><span>Server</span><strong className="j-zero">0 B</strong></div>
              <b className="j-shield"><Icon name="shield" size={15} />CSP · connect-src &apos;self&apos;</b>
            </div>
            <ol className="journey-steps">{t.privacy.body.map((p, i) => <li key={i}>{p}</li>)}</ol>
          </div>
        </div>
      </section>
    </main>
  );
}

export function ToolGroup({ title, links, base }: { title: string; links: ToolLink[]; base(slug: string): string }) {
  return (
    <div className="tool-group reveal">
      <h3>{title}</h3>
      <ul>
        {links.map(x => (
          <li key={x.slug}>
            <a href={base(x.slug)}>
              {x.from && x.to ? <><FileTag fmt={x.from} small /><span className="arrow" aria-hidden="true">→</span><FileTag fmt={x.to} small /></> : null}
              <span>{x.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
