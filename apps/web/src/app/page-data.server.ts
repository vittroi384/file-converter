// 서버 전용: 주소 → 페이지 데이터(현지화된 랜딩 문구·도구 목록). 브라우저 묶음엔 들어가지 않는다.
import { getLandingT } from '../i18n/all.ts';
import { LANDINGS, landingBySlug, type LandingDef } from '../i18n/landings.ts';
import { resolve, dynamicLanding } from './routes.ts';
import type { Locale } from '../i18n/locales.ts';
import type { PageData, ToolLink, DemoData } from './page-data.ts';

const groupOf = (d: LandingDef): ToolLink['group'] =>
  d.def.kind === 'data' ? 'data' : ['merge-pdf', 'split-pdf', 'compress-pdf', 'pdf-to-image', 'images-to-pdf'].includes(d.def.kind) ? 'pdf' : 'image';

export function toolLink(locale: Locale, d: LandingDef): ToolLink {
  const T = getLandingT(locale);
  const k = d.def;
  const title = k.kind === 'convert' || k.kind === 'data'
    ? `${T.name[k.from]} → ${T.name[k.to]}`
    : T.build(k).title.split(/ — | – |：|:/)[0]!.trim();
  return { slug: d.slug, title, group: groupOf(d), ...('from' in k ? { from: k.from } : {}), ...('to' in k ? { to: k.to } : {}) };
}

export function pageData(pathname: string, demo?: DemoData): PageData {
  const r = resolve(pathname);
  const tools = LANDINGS.map(d => toolLink(r.locale, d));
  if (r.kind === 'landing') {
    const T = getLandingT(r.locale);
    const def = r.def;
    return {
      locale: r.locale, kind: 'landing', path: pathname, tools,
      landing: {
        slug: def.slug, action: def.action, preset: def.preset, accept: def.accept, copy: T.build(def.def),
        related: def.related.map(s => landingBySlug(s) ?? dynamicLanding(s)).filter((x): x is LandingDef => !!x).map(d => toolLink(r.locale, d)),
        ...('from' in def.def ? { from: def.def.from } : {}), ...('to' in def.def ? { to: def.def.to } : {}),
      },
    };
  }
  return { locale: r.locale, kind: r.kind, path: pathname, tools, ...(r.kind === 'home' && demo ? { demo } : {}) };
}
