// 주소 → 화면. 서버(SSG·SSR)와 브라우저가 같은 규칙을 쓴다.
// 미리 만든 랜딩 27개 + 지원하는 형식 조합(a-to-b)은 그 자리에서 만들어지는 롱테일 랜딩(SSR이 맡는다).
import { parsePath, type Locale } from '../i18n/locales.ts';
import { LANDINGS, landingBySlug, type LandingDef, type Fmt } from '../i18n/landings.ts';

export type Route =
  | { kind: 'home'; locale: Locale }
  | { kind: 'landing'; locale: Locale; slug: string; def: LandingDef; prerendered: boolean }
  | { kind: 'admin'; locale: Locale }
  | { kind: 'notfound'; locale: Locale; slug: string };

const IMG_IN: Fmt[] = ['heic', 'jpg', 'png', 'webp', 'avif', 'psd', 'svg'];
const IMG_OUT: Fmt[] = ['jpg', 'png', 'webp', 'avif'];
const DATA: Fmt[] = ['xlsx', 'csv', 'json', 'yaml'];
const slugName = (f: Fmt) => (f === 'xlsx' ? 'excel' : f);
const fromSlug = (s: string): Fmt | null => { const f = s === 'excel' ? 'xlsx' : s; return ([...IMG_IN, ...DATA] as string[]).includes(f) ? (f as Fmt) : null; };

// 목록에 없는 조합으로 랜딩 만들기(예: avif-to-png, yaml-to-csv). 없는 조합이면 null → 404
export function dynamicLanding(slug: string): LandingDef | null {
  const m = /^([a-z]+)-to-([a-z]+)$/.exec(slug);
  if (!m) return null;
  const from = fromSlug(m[1]!), to = fromSlug(m[2]!);
  if (!from || !to || from === to) return null;
  if (IMG_IN.includes(from) && IMG_OUT.includes(to)) {
    const pick = (fs: string[]) => fs.filter(s => s !== slug && landingBySlug(s)).slice(0, 3);
    return { slug, def: { kind: 'convert', from, to }, action: 'convert', preset: { to }, accept: 'image/*,.heic,.heif,.psd,.svg', related: pick([`${slugName(to)}-to-${slugName(from)}`, `${slugName(from)}-to-jpg`, 'compress-image', `jpg-to-${slugName(to)}`]) };
  }
  if (DATA.includes(from) && DATA.includes(to)) {
    return { slug, def: { kind: 'data', from, to }, action: 'data', preset: { to }, accept: '.xlsx,.csv,.tsv,.json,.yaml,.yml', related: ['excel-to-csv', 'csv-to-json', 'json-to-csv'].filter(s => s !== slug) };
  }
  return null;
}

// SSR이 그 자리에서 만들 수 있는 조합 전부(사이트맵에도 싣는다)
export function allDynamicSlugs(): string[] {
  const out: string[] = [];
  for (const a of IMG_IN) for (const b of IMG_OUT) if (a !== b) out.push(`${slugName(a)}-to-${slugName(b)}`);
  for (const a of DATA) for (const b of DATA) if (a !== b) out.push(`${slugName(a)}-to-${slugName(b)}`);
  return out.filter(s => !landingBySlug(s));
}

export function resolve(pathname: string): Route {
  const { locale, slug } = parsePath(pathname);
  if (!slug) return { kind: 'home', locale };
  if (slug === 'admin') return { kind: 'admin', locale };
  const fixed = landingBySlug(slug);
  if (fixed) return { kind: 'landing', locale, slug, def: fixed, prerendered: true };
  const dyn = dynamicLanding(slug);
  if (dyn) return { kind: 'landing', locale, slug, def: dyn, prerendered: false };
  return { kind: 'notfound', locale, slug };
}

export const PRERENDER_SLUGS = LANDINGS.map(l => l.slug);
