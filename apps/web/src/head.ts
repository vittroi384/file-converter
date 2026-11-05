// 서버 전용: <head> 태그와 구조화 데이터(JSON-LD). 검색엔진·AI가 읽는 부분.
import { LOCALES, LOCALE_NAMES, localePath, DEFAULT_LOCALE } from './i18n/locales.ts';
import { getDict } from './i18n/all.ts';
import type { PageData } from './app/page-data.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// JSON-LD 안에 </script>가 들어가 블록을 깨지 않게
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

export function buildHead(data: PageData, siteUrl: string): string {
  const t = getDict(data.locale);
  const base = siteUrl.replace(/\/$/, '');
  const slug = data.landing?.slug ?? '';
  const url = base + localePath(data.locale, slug);
  const title = data.landing ? `${data.landing.copy.title} | ${t.site.name}` : data.kind === 'notfound' ? `404 | ${t.site.name}` : `${t.site.name} — ${t.site.tagline}`;
  const desc = data.landing?.copy.metaDescription ?? t.site.description;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    data.kind === 'notfound' || data.kind === 'admin' ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${url}" />`,
  ];
  if (data.kind === 'home' || data.kind === 'landing') {
    // 같은 내용의 다른 언어판(hreflang) + 언어를 모를 때의 기본(x-default)
    for (const l of LOCALES) tags.push(`<link rel="alternate" hreflang="${LOCALE_NAMES[l].htmlLang}" href="${base}${localePath(l, slug)}" />`);
    tags.push(`<link rel="alternate" hreflang="x-default" href="${base}${localePath(DEFAULT_LOCALE, slug)}" />`);
    tags.push(
      `<meta property="og:type" content="website" />`, `<meta property="og:site_name" content="${t.site.name}" />`,
      `<meta property="og:title" content="${esc(title)}" />`, `<meta property="og:description" content="${esc(desc)}" />`,
      `<meta property="og:url" content="${url}" />`, `<meta property="og:locale" content="${LOCALE_NAMES[data.locale].htmlLang.replace('-', '_')}" />`,
      `<meta property="og:image" content="${base}/og.png" />`, `<meta name="twitter:card" content="summary_large_image" />`,
    );
    tags.push(ld(structured(data, base, url, title, desc)));
  }
  return tags.join('\n    ');
}

function structured(data: PageData, base: string, url: string, title: string, desc: string) {
  const t = getDict(data.locale);
  const lang = LOCALE_NAMES[data.locale].htmlLang;
  const app = {
    '@type': 'WebApplication',
    name: data.landing ? data.landing.copy.title.split(/ — | – /)[0] : t.site.name,
    url, description: desc, inLanguage: lang,
    applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript and WebAssembly',
    isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: 'LocalConvert', url: base + '/' },
    featureList: data.tools.map(x => x.title),
  };
  const graph: object[] = [app];
  if (data.kind === 'home') {
    graph.unshift({ '@type': 'WebSite', name: t.site.name, url: base + localePath(data.locale), inLanguage: lang, description: t.site.description });
  }
  if (data.landing) {
    const c = data.landing.copy;
    graph.push(
      { '@type': 'HowTo', name: title, inLanguage: lang, step: c.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s })) },
      { '@type': 'FAQPage', inLanguage: lang, mainEntity: c.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: t.site.name, item: base + localePath(data.locale) },
        { '@type': 'ListItem', position: 2, name: c.title.split(/ — | – /)[0], item: url },
      ] },
    );
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}
