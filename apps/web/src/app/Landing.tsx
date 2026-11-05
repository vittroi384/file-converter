import { useI18n } from '../i18n/context.ts';
import { localePath, type Locale } from '../i18n/locales.ts';
import type { LandingData } from './page-data.ts';
import { Tool, type ToolProps } from './Tool.tsx';
import { FileTag } from './FileTag.tsx';
import { ToolGroup } from './Home.tsx';
import { LandingScene } from './LandingScenes.tsx';

type Shared = Pick<ToolProps, 'say' | 'onCompare' | 'registerCommands'>;

export function Landing({ data, locale, ...shared }: { data: LandingData; locale: Locale } & Shared) {
  const { t } = useI18n();
  const c = data.copy;
  return (
    <main className="main landing">
      <nav className="crumbs" aria-label="breadcrumb">
        <a href={localePath(locale)}>{t.site.name}</a><span aria-hidden="true">/</span><span>{c.title.split(/ — | – /)[0]}</span>
      </nav>
      <header className="landing-head">
        {data.from && data.to && <div className="pair"><FileTag fmt={data.from} /><span className="arrow" aria-hidden="true">→</span><FileTag fmt={data.to} /></div>}
        <h1 className="display">{c.title}</h1>
        <p className="lede">{c.intro}</p>
      </header>

      <Tool {...shared} initialAction={data.action} preset={data.preset} accept={data.accept} />

      <LandingScene data={data} />

      <section className="howto">
        <h2 className="section-title">{t.howTo}</h2>
        <ol>{c.steps.map((s, i) => <li key={i}><span className="num">{i + 1}</span>{s}</li>)}</ol>
      </section>

      <section className="faq">
        <h2 className="section-title">{t.faqTitle}</h2>
        {c.faq.map((f, i) => (
          <details key={i} open={i === 0}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      {data.related.length > 0 && (
        <section className="related">
          <ToolGroup title={t.related} links={data.related} base={s => localePath(locale, s)} />
        </section>
      )}
    </main>
  );
}
